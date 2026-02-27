'use strict';

/**
 * Operator — Sub-Agent Dispatcher / Task Orchestrator
 *
 * For daunting multi-step tasks, Operator:
 *   1. Decomposes the task into parallelizable sub-tasks (qwen3:8b)
 *   2. Maps each sub-task to the right worker agent
 *   3. Fires all workers in parallel (Promise.allSettled)
 *   4. Synthesizes results into a single coherent output (Claude Sonnet)
 *
 * Workers available:
 *   scout      — research / web / trend queries
 *   forge      — code generation / architecture / debugging
 *   scribe     — summaries / ops reports / scheduling
 *   courier    — email drafting
 *   lens       — analytics queries (PostHog)
 *   archivist  — memory store / retrieve
 *
 * Usage:
 *   const operator = require('./operator');
 *   const result = await operator.run({ task, context, workers });
 *
 * Model routing:
 *   Decompose  → qwen3:8b (Ollama, free)
 *   Workers    → each agent's own routing logic
 *   Synthesize → Claude Sonnet (paid — only once per job, not per worker)
 */

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const mini      = require('./skills/openai-mini');

// Worker agents
const scout     = require('./scout');
const forge     = require('./forge');
const scribe    = require('./scribe');
const courier   = require('./courier');
const lens      = require('./lens');
const archivist = require('./archivist');

const LOG_FILE  = path.join(__dirname, '../memory/run_log.md');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Worker registry ───────────────────────────────────────────────────────────

const WORKERS = {
  scout:     { label: 'Scout (Research)',    run: (p) => scout.run(p) },
  forge:     { label: 'Forge (Dev)',         run: (p) => forge.run(p) },
  scribe:    { label: 'Scribe (Ops)',        run: (p) => scribe.run(p) },
  courier:   { label: 'Courier (Email)',     run: (p) => courier.run(p) },
  lens:      { label: 'Lens (Analytics)',    run: (p) => lens.run(p) },
  archivist: { label: 'Archivist (Memory)',  run: (p) => archivist.run(p) },
};

const WORKER_TIMEOUT_MS = 60_000; // 60s per worker

// ── Decompose ─────────────────────────────────────────────────────────────────

const DECOMPOSE_SYSTEM = `You are Operator, a task decomposer for an AI agent system called Ghost.
Given a complex task, break it into parallelizable sub-tasks. Each sub-task must be assigned to exactly one worker.

Available workers:
- scout     → research, web search, trend analysis, factual lookups
- forge     → code generation, bug fixes, architecture design, code review
- scribe    → summaries, reports, meeting notes, scheduling, ops planning
- courier   → email drafting, email campaigns, outbound messages
- lens      → analytics queries, PostHog event data, metrics interpretation
- archivist → memory retrieval, storing context, searching past decisions

Rules:
- Only include workers that are genuinely needed for this task
- Parallel tasks should be independent of each other
- Each sub-task payload must be a valid JSON object matching that worker's input schema
- If the task only needs one worker, return just one sub-task
- Maximum 6 sub-tasks

Respond ONLY with a valid JSON array. No explanation, no markdown fences. Example:
[
  { "worker": "scout", "label": "Research X", "payload": { "query": "...", "type": "web", "depth": "quick" } },
  { "worker": "forge", "label": "Write Y function", "payload": { "task": "...", "action": "implement" } }
]`;

async function decompose(task, context = '') {
  const userMsg = [
    `Task: ${task}`,
    context ? `Context: ${context}` : null,
  ].filter(Boolean).join('\n');

  // Try gpt-4o-mini first (fast, cheap)
  const { result, escalate } = await mini.tryChat([
    { role: 'system', content: DECOMPOSE_SYSTEM },
    { role: 'user',   content: userMsg },
  ]);

  let raw = '';
  if (!escalate && result?.message?.content) {
    raw = result.message.content.trim();
  } else {
    // Fall back to Claude Sonnet for decomposition
    const msg = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: `${DECOMPOSE_SYSTEM}\n\n${userMsg}` }],
    });
    raw = msg.content[0]?.text?.trim() ?? '[]';
  }

  // Strip markdown fences if model added them
  raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    const plan = JSON.parse(raw);
    if (!Array.isArray(plan)) throw new Error('not an array');
    return plan.filter(s => s.worker && WORKERS[s.worker]);
  } catch {
    appendLog('WARN', 'decompose', 'system', 'parse-failed', `raw="${raw.slice(0, 80)}"`);
    return [];
  }
}

// ── Execute workers in parallel ───────────────────────────────────────────────

async function executeWorkers(subtasks) {
  const jobs = subtasks.map(async (sub) => {
    const worker = WORKERS[sub.worker];
    const start  = Date.now();

    try {
      const resultPromise = worker.run(sub.payload ?? {});
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Worker ${sub.worker} timed out after ${WORKER_TIMEOUT_MS}ms`)), WORKER_TIMEOUT_MS)
      );
      const result = await Promise.race([resultPromise, timeoutPromise]);
      return {
        worker:   sub.worker,
        label:    sub.label ?? worker.label,
        success:  true,
        result,
        duration: Date.now() - start,
      };
    } catch (err) {
      appendLog('WARN', 'worker', sub.worker, 'failed', err.message);
      return {
        worker:   sub.worker,
        label:    sub.label ?? worker.label,
        success:  false,
        error:    err.message,
        duration: Date.now() - start,
      };
    }
  });

  return Promise.allSettled(jobs).then(settled =>
    settled.map(s => s.status === 'fulfilled' ? s.value : { success: false, error: s.reason?.message })
  );
}

// ── Synthesize ────────────────────────────────────────────────────────────────

const SYNTH_SYSTEM = `You are Operator, the orchestrator of the Ghost AI agent system.
You have received results from multiple specialist agents working in parallel.
Synthesize their outputs into a single, coherent, actionable response for the user.
Be concise. Lead with the most important findings. Use markdown formatting where helpful.
If any worker failed, acknowledge it briefly but don't dwell on it.`;

async function synthesize(task, workerResults) {
  const context = workerResults.map(r => {
    if (!r.success) return `## ${r.label ?? r.worker} — FAILED\n${r.error}`;
    const out = r.result?.summary ?? r.result?.output ?? r.result?.draft ?? JSON.stringify(r.result).slice(0, 800);
    return `## ${r.label ?? r.worker}\n${out}`;
  }).join('\n\n');

  const userMsg = `Original task: ${task}\n\nWorker outputs:\n${context}`;

  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2048,
    system:     SYNTH_SYSTEM,
    messages:   [{ role: 'user', content: userMsg }],
  });

  return msg.content[0]?.text?.trim() ?? 'Synthesis failed.';
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run a complex task by dispatching sub-agents in parallel.
 *
 * @param {object} input
 *   - task     {string}   required — the full task description
 *   - context  {string}   optional — extra context / background
 *   - workers  {string[]} optional — force specific workers (skip decomposition)
 *   - dry_run  {boolean}  optional — return plan without executing
 */
async function run({ task, context = '', workers: forceWorkers, dry_run = false } = {}) {
  if (!task) throw new Error('task is required');

  const start = Date.now();
  appendLog('INFO', 'start', 'system', 'running', `task="${task.slice(0, 80)}"`);

  // Step 1: Decompose
  let subtasks;
  if (forceWorkers?.length) {
    subtasks = forceWorkers.map(w => ({ worker: w, payload: { task } }));
  } else {
    subtasks = await decompose(task, context);
    if (subtasks.length === 0) {
      appendLog('WARN', 'decompose', 'system', 'no-subtasks', `task="${task.slice(0, 80)}"`);
      return { task, subtasks: [], results: [], summary: 'Could not decompose task into sub-tasks.', logged: true };
    }
  }

  if (dry_run) {
    return { task, subtasks, dry_run: true, logged: false };
  }

  // Step 2: Execute in parallel
  const results = await executeWorkers(subtasks);

  // Step 3: Synthesize
  const successCount = results.filter(r => r.success).length;
  const summary = successCount > 0
    ? await synthesize(task, results)
    : 'All workers failed — no results to synthesize.';

  const duration = Date.now() - start;
  appendLog('INFO', 'complete', 'system', 'success',
    `task="${task.slice(0, 60)}" workers=${subtasks.length} success=${successCount} duration=${duration}ms`);

  return {
    task,
    subtasks:      subtasks.map(s => ({ worker: s.worker, label: s.label })),
    results,
    summary,
    workers_run:   subtasks.length,
    workers_ok:    successCount,
    duration_ms:   duration,
    logged:        true,
  };
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, agent, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Operator',
    `| action=${action}`,
    `| worker=${agent}`,
    '| model=qwen3:8b→claude-sonnet-4-6',
    `| outcome=${outcome}`,
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = { run, decompose, executeWorkers };
