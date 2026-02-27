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

const fs             = require('fs');
const path           = require('path');
const { execSync }   = require('child_process');
const Anthropic      = require('@anthropic-ai/sdk');
const mini           = require('./skills/openai-mini');
const codexModel     = require('./skills/openai-codex');
const archivist      = require('./archivist');
const db             = require('./db');

const ROOT_DIR = path.join(__dirname, '..');

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

  // Bug fixes: o4-mini (reasoning model, much better at debugging)
  if (task === 'bug-fix') return { model: 'o4-mini', reason: 'bug-fix uses o4-mini reasoning model' };

  // Default: gpt-4o-mini (fast, cheap)
  return { model: 'gpt-4o-mini', reason: null };
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

  let rawResponse = '';
  let modelUsed   = targetModel;
  let escalated   = targetModel !== 'gpt-4o-mini';
  let miniFailed  = false;

  // ── o4-mini (reasoning model — bug fixes) ──
  if (targetModel === 'o4-mini') {
    const { text, escalate, reason } = await codexModel.fixCode(SYSTEM_PROMPT, userMessage, 8192);
    if (!escalate) {
      rawResponse = text;
    } else {
      // o4-mini unavailable — fall through to Claude Sonnet
      miniFailed = true;
      modelUsed  = 'claude-sonnet-4-6';
      escalated  = true;
      logEscalation('o4-mini', 'claude-sonnet-4-6', `o4-mini unavailable: ${reason}`, task);
    }
  }

  // ── gpt-4o-mini (fast, cheap default) ──
  if (targetModel === 'gpt-4o-mini') {
    const { result, escalate, reason } = await mini.tryChat(
      [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }]
    );

    if (!escalate) {
      rawResponse = result?.message?.content || '';
    } else {
      // mini unavailable — bump to Sonnet
      miniFailed = true;
      modelUsed  = 'claude-sonnet-4-6';
      escalated  = true;
      logEscalation('gpt-4o-mini', 'claude-sonnet-4-6', `mini unavailable: ${reason}`, task);
    }
  }

  // ── Claude Sonnet or Opus (escalation path) ──
  if ((targetModel !== 'gpt-4o-mini' && targetModel !== 'o4-mini') || miniFailed) {
    if (escalationReason && !miniFailed) {
      logEscalation(targetModel, modelUsed, escalationReason, task);
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
    escalation_reason: escalated ? (escalationReason || 'mini unavailable') : null,
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

  // Store to Archivist — non-blocking, non-fatal
  archivist.store({
    type:         'agent_output',
    content:      `Task: ${task} — ${description}\n\nPlan:\n${result.plan}${result.notes ? '\n\nNotes: ' + result.notes : ''}`,
    tags:         [task, priority, modelUsed],
    source_agent: 'Forge',
    ttl_days:     180,
  }).catch(() => {});

  return result;
}

// ── Auto-fix ──────────────────────────────────────────────────────────────────

const AUTOFIX_SYSTEM = `You are Forge, an expert Node.js/JavaScript debugger for the Ghost AI system.
You will receive an error message and the full contents of the broken file.
Your job is to output the COMPLETE fixed file — every line, no placeholders, no "// ... rest of file".
The fix must be minimal and surgical — change only what is needed to resolve the error.

Rules:
1. Output ONLY the fixed file content. No explanation, no markdown fences, no JSON wrapper.
2. Preserve all existing logic, formatting, and comments unless they are wrong.
3. If the error is in an import/require, fix only that import.
4. If you cannot determine the fix with confidence, output the original file unchanged.`;

// Parse an error note/stack to extract a likely file path
function _extractFilePath(note = '', action = '') {
  // Look for src/something.js patterns in error note
  const patterns = [
    /src\/[\w/.-]+\.js/g,
    /openclaw\/[\w/.-]+\.js/g,
    /portal\/[\w/.-]+\.[jt]sx?/g,
  ];
  for (const p of patterns) {
    const m = note.match(p) || action.match(p);
    if (m) return m[0];
  }
  return null;
}

/**
 * Auto-fix: read recent errors, identify the broken file, fix it with o4-mini,
 * write it to disk, and restart Ghost.
 *
 * @param {object} opts
 *   - errorNote  {string}  specific error text (optional — fetched from DB if not given)
 *   - filePath   {string}  override file path to fix (optional)
 *   - restart    {boolean} restart ghost after fix (default true)
 *
 * @returns {{ fixed, filePath, model_used, summary, patch }}
 */
async function autoFix({ errorNote, filePath, restart = true } = {}) {
  // Step 1: get the error to fix
  let targetError = errorNote;
  let targetFile  = filePath;

  if (!targetError) {
    // Fetch most recent ERROR from agent_logs
    const { rows } = await db.query(
      `SELECT note, action, agent FROM agent_logs WHERE level = 'ERROR' ORDER BY ts DESC LIMIT 5`
    );
    if (!rows.length) return { fixed: false, summary: 'No errors found in agent_logs.' };

    // Use the first entry that has a recognisable file path
    for (const row of rows) {
      const fp = _extractFilePath(row.note || '', row.action || '');
      if (fp) {
        targetError = row.note;
        targetFile  = targetFile || fp;
        break;
      }
    }
    if (!targetError) {
      targetError = rows[0].note;
    }
  }

  if (!targetFile) {
    return {
      fixed:   false,
      summary: `Could not identify which file to fix from error:\n${targetError}`,
      model_used: 'none',
    };
  }

  // Step 2: read the file
  const absPath = path.isAbsolute(targetFile)
    ? targetFile
    : path.join(ROOT_DIR, targetFile);

  let originalContent;
  try {
    originalContent = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    return { fixed: false, summary: `Cannot read file ${targetFile}: ${err.message}`, model_used: 'none' };
  }

  // Step 3: call o4-mini to generate the fix
  const userPrompt = `ERROR:\n${targetError}\n\nFILE: ${targetFile}\n\`\`\`js\n${originalContent}\n\`\`\``;

  const { text: fixedContent, escalate, reason } = await codexModel.fixCode(AUTOFIX_SYSTEM, userPrompt, 16384);

  if (escalate || !fixedContent.trim()) {
    return {
      fixed:      false,
      filePath:   targetFile,
      model_used: 'o4-mini',
      summary:    `o4-mini failed to generate a fix: ${reason}`,
    };
  }

  // Strip any accidental markdown fences
  const clean = fixedContent.replace(/^```(?:js|javascript|typescript)?\n?/i, '').replace(/\n?```$/, '').trim();

  // Sanity check — must look like JS (has 'use strict' or require or function or const)
  if (!/\b(require|const|function|module\.exports|'use strict'|import )\b/.test(clean)) {
    return {
      fixed:      false,
      filePath:   targetFile,
      model_used: 'o4-mini',
      summary:    'Fix output did not look like valid JS — not applied for safety.',
    };
  }

  // Step 4: write the fix
  fs.writeFileSync(absPath, clean, 'utf8');

  log('autofix', 'system', 'o4-mini', 'applied', true, `file=${targetFile}`);

  // Step 5: restart Ghost
  let restartMsg = '';
  if (restart) {
    try {
      execSync('pm2 restart ghost', { timeout: 15000 });
      restartMsg = ' Ghost restarted.';
    } catch (err) {
      restartMsg = ` Restart failed: ${err.message}`;
    }
  }

  return {
    fixed:      true,
    filePath:   targetFile,
    model_used: 'o4-mini',
    summary:    `Fixed \`${targetFile}\` using o4-mini.${restartMsg}`,
    patch:      `Original ${originalContent.split('\n').length} lines → Fixed ${clean.split('\n').length} lines`,
  };
}

module.exports = { run, detectModel, autoFix };
