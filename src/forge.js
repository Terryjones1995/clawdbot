'use strict';

/**
 * Forge — Dev / Code / Architecture Agent
 *
 * Handles all software development tasks: bug fixes, features, reviews,
 * refactors, and architecture. Implements the full 3-tier escalation ladder:
 *
 *   qwen3-coder (free)  →  Claude Sonnet 4.6  →  Claude Opus 4.6
 *
 * Usage:
 *   const forge = require('./forge');
 *   const result = await forge.run({ task, description, files, context, priority });
 */

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const ollama    = require('../openclaw/skills/ollama');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Forge, the dev and architecture agent for the Ghost AI system.
You're a senior dev: direct, opinionated, allergic to vague requirements. You ship real code, not excuses.
If requirements are unclear, flag it immediately — don't guess and deliver garbage. MVP-first, no gold-plating.

Tech stack:
- Runtime: Node.js 18+
- Framework: Express 4
- AI: Anthropic SDK (Claude Sonnet/Opus), Ollama (qwen3-coder, local)
- DB: Neon (Postgres) via pg or Drizzle ORM
- Cache/Queue/Events: Redis (ioredis)
- Vector: Pinecone
- Email: Resend
- Analytics: PostHog
- Discord: discord.js v14
- Auth: JWT (jsonwebtoken) + bcryptjs

Project structure:
- server.js         — Express gateway (port 18789)
- src/              — server-side modules
- openclaw/agents/  — agent prompt files
- openclaw/skills/  — connector implementations
- memory/           — run_log.md, approvals.md (append-only)
- public/           — HTML UI files

Rules:
1. MVP-first: write the minimum code that solves the problem. No premature abstractions.
2. Output a numbered plan for any task estimated > 30 minutes.
3. Never include deployment steps — hand off to Helm.
4. Flag security risks explicitly in notes.
5. Be concrete: output real code, not pseudocode.

Respond with valid JSON only — no markdown fences, no prose outside JSON:
{
  "plan": "1. step one\\n2. step two\\n3. ...",
  "code_changes": [
    { "file": "relative/path/to/file.js", "change": "full file content or precise diff" }
  ],
  "notes": "warnings, follow-ups, security flags, or empty string"
}`;

// ── Escalation detection ──────────────────────────────────────────────────────

const SONNET_TRIGGERS = [
  { pattern: /auth|encrypt|bcrypt|jwt|secret|credential|api.?key|oauth|token/i,       reason: 'security-sensitive code' },
  { pattern: /payment|billing|stripe|invoice|financial|money/i,                        reason: 'code touching payments or financial APIs' },
  { pattern: /architecture|redesign|migrate|overhaul/i,                                reason: 'architectural change requiring strategic thinking' },
  { pattern: /ambiguous|unclear|not sure|unsure|what do you mean/i,                    reason: 'ambiguous requirements' },
];

const OPUS_TRIGGERS = [
  { pattern: /ESCALATE:HARD/,                                                           reason: 'OWNER flagged ESCALATE:HARD' },
  { pattern: /full.?system.?design|design.?from.?scratch|greenfield/i,                 reason: 'full system design from scratch' },
  { pattern: /performance.?critical|optimize.*algorithm|O\(n/,                         reason: 'performance-critical algorithm design' },
];

function detectModel(task, description, files = [], context = '') {
  const text = `${task} ${description} ${context}`;

  // Opus checks first (highest priority)
  for (const t of OPUS_TRIGGERS) {
    if (t.pattern.test(text)) {
      return { model: 'claude-opus-4-6', reason: t.reason };
    }
  }
  if (files.length >= 5 && task === 'bug-fix') {
    return { model: 'claude-opus-4-6', reason: 'complex debugging across 5+ files with unclear root cause' };
  }

  // Sonnet checks
  for (const t of SONNET_TRIGGERS) {
    if (t.pattern.test(text)) {
      return { model: 'claude-sonnet-4-6', reason: t.reason };
    }
  }
  if (files.length >= 3) {
    return { model: 'claude-sonnet-4-6', reason: `multi-file change (${files.length} files)` };
  }

  // Default: free
  return { model: 'qwen3-coder', reason: null };
}

// ── Message builder ───────────────────────────────────────────────────────────

function buildUserMessage(task, description, files, context, priority) {
  const parts = [
    `Task type: ${task}`,
    `Priority: ${priority}`,
    `Description: ${description}`,
  ];
  if (files.length > 0) parts.push(`Files involved: ${files.join(', ')}`);
  if (context)          parts.push(`Context / existing code:\n${context}`);
  return parts.join('\n\n');
}

// ── JSON parser (tolerant) ────────────────────────────────────────────────────

function parseJSON(raw) {
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
    return null;
  }
}

// ── Claude caller ─────────────────────────────────────────────────────────────

async function callClaude(model, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set — cannot escalate to Claude');

  const client   = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  return response.content[0]?.text || '';
}

// ── Logging ───────────────────────────────────────────────────────────────────

function log(action, userRole, model, outcome, escalated, note) {
  const entry = [
    '[INFO]',
    new Date().toISOString(),
    '| agent=Forge',
    `| action=${action}`,
    `| user_role=${userRole}`,
    `| model=${model}`,
    `| outcome=${outcome}`,
    `| escalated=${escalated}`,
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

function logEscalation(from, to, reason, task) {
  const entry = [
    '[ESCALATE]',
    new Date().toISOString(),
    `| agent=Forge`,
    `| from=${from}`,
    `| to=${to}`,
    `| trigger="${reason}"`,
    `| task="${task}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

// ── Core: run ─────────────────────────────────────────────────────────────────

/**
 * Run a dev task through Forge.
 *
 * @param {object} input
 *   - task        {string}   bug-fix | feature | review | architecture | refactor
 *   - description {string}   what needs to be done
 *   - files       {string[]} relevant file paths (context only, not read from disk)
 *   - context     {string}   existing code, error messages, or other context
 *   - priority    {string}   low | medium | high | critical
 *   - user_role   {string}   OWNER | ADMIN | AGENT
 *
 * @returns {{ plan, code_changes, model_used, escalation_reason, notes, logged }}
 */
async function run(input) {
  const {
    task        = 'feature',
    description = '',
    files       = [],
    context     = '',
    priority    = 'medium',
    user_role   = 'OWNER',
  } = input;

  if (!description.trim()) throw new Error('description is required');

  const { model: targetModel, reason: escalationReason } = detectModel(task, description, files, context);
  const userMessage = buildUserMessage(task, description, files, context, priority);

  let rawResponse  = '';
  let modelUsed    = targetModel;
  let escalated    = targetModel !== 'qwen3-coder';
  let ollamaFailed = false;

  // ── qwen3-coder (free first) ──
  if (targetModel === 'qwen3-coder') {
    const { result, escalate, reason } = await ollama.tryChat(
      [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }]
    );

    if (!escalate) {
      rawResponse = result?.message?.content || '';
    } else {
      // Ollama unavailable — bump to Sonnet
      ollamaFailed = true;
      modelUsed    = 'claude-sonnet-4-6';
      escalated    = true;
      logEscalation('qwen3-coder', 'claude-sonnet-4-6', `Ollama unavailable: ${reason}`, task);
    }
  }

  // ── Claude Sonnet or Opus (escalation path) ──
  if (targetModel !== 'qwen3-coder' || ollamaFailed) {
    if (escalationReason && !ollamaFailed) {
      logEscalation('qwen3-coder', modelUsed, escalationReason, task);
    }
    rawResponse = await callClaude(modelUsed, userMessage);
  }

  // ── Parse response ──
  const parsed = parseJSON(rawResponse);

  const result = {
    plan:              parsed?.plan             || rawResponse,
    code_changes:      parsed?.code_changes     || [],
    notes:             parsed?.notes            || '',
    model_used:        modelUsed,
    escalation_reason: escalated ? (escalationReason || 'Ollama unavailable') : null,
    logged:            true,
  };

  log(
    task,
    user_role,
    modelUsed,
    'success',
    escalated,
    `files=${files.length} priority=${priority}`
  );

  return result;
}

module.exports = { run, detectModel };
