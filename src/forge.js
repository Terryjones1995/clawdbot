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

const fs                      = require('fs');
const path                    = require('path');
const { execSync, spawn }     = require('child_process');
const Anthropic               = require('@anthropic-ai/sdk');
const mini           = require('./skills/openai-mini');
const codexModel     = require('./skills/openai-codex');
const { trackUsage } = require('./skills/usage-tracker');
const learning       = require('./skills/learning');
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

  // Bug fixes: gpt-5.3-codex (OpenAI's latest code model)
  if (task === 'bug-fix') return { model: 'gpt-5.3-codex', reason: 'bug-fix uses gpt-5.3-codex' };

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

  const start    = Date.now();
  const client   = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });
  trackUsage({ provider: 'anthropic', model, agent: 'forge', action: 'dev', input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0, latency_ms: Date.now() - start });
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

// Agent name → most likely source file
const AGENT_FILE_MAP = {
  sentinel:    'src/sentinel.js',
  scout:       'src/scout.js',
  scribe:      'src/scribe.js',
  forge:       'src/forge.js',
  helm:        'src/helm.js',
  lens:        'src/lens.js',
  keeper:      'src/keeper.js',
  warden:      'src/warden.js',
  archivist:   'src/archivist.js',
  courier:     'src/courier.js',
  ghost:       'src/routes/reception.js',
  codex:       'src/codex.js',
  switchboard: 'src/switchboard.js',
};

// Files that must never be auto-patched — they are the auto-fix engine itself.
// Corrupting these would break the repair system and create an infinite loop.
const PROTECTED_FILES = new Set([
  'src/forge.js',
  'server.js',
  'src/skills/usage-tracker.js',
  'src/skills/learning.js',
]);

// Parse an error note/stack to extract a likely file path
function _extractFilePath(note = '', action = '') {
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
 * Auto-fix: identify the broken file, fix it with gpt-5.3-codex,
 * write it to disk, and restart Ghost.
 *
 * @param {object} opts
 *   - errorNote  {string}  specific error text (optional — fetched from DB if not given)
 *   - filePath   {string}  override file path to fix (optional)
 *   - agentName  {string}  agent that logged the error — used to guess file when no path in note
 *   - restart    {boolean} restart ghost after fix (default true)
 *
 * @returns {{ fixed, filePath, model_used, summary, patch }}
 */
async function autoFix({ errorNote, filePath, agentName, restart = true } = {}) {
  // Step 1: get the error to fix
  let targetError = errorNote;
  let targetFile  = filePath;

  if (!targetError) {
    // Fetch most recent ERROR from agent_logs
    const { rows } = await db.query(
      `SELECT note, action, agent FROM agent_logs WHERE level = 'ERROR' ORDER BY ts DESC LIMIT 5`
    );
    if (!rows.length) return { fixed: false, summary: 'No errors found in agent_logs.' };

    // Use the first entry that has a recognisable file path, or fall back to agent mapping
    for (const row of rows) {
      const fp = _extractFilePath(row.note || '', row.action || '')
                 || AGENT_FILE_MAP[(row.agent || '').toLowerCase()];
      if (fp) {
        targetError = row.note;
        targetFile  = targetFile || fp;
        if (!agentName) agentName = row.agent;
        break;
      }
    }
    if (!targetError) targetError = rows[0].note;
  }

  // If still no file path, try agent name mapping
  if (!targetFile && agentName) {
    targetFile = AGENT_FILE_MAP[agentName.toLowerCase()];
  }

  if (!targetFile) {
    return {
      fixed:      false,
      summary:    `Could not identify which file to fix from error:\n${targetError}`,
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

  const modelUsed = fixedContent ? (codexModel.MODEL || 'gpt-5.3-codex') : 'gpt-5.3-codex';

  if (escalate || !fixedContent.trim()) {
    const summary = `gpt-5.3-codex failed to generate a fix: ${reason}`;
    db.logEntry({ level: 'WARN', agent: 'Forge', action: 'autofix', outcome: 'no-fix', model: modelUsed, note: `file=${targetFile} | ${summary}` }).catch(() => {});
    return {
      fixed:      false,
      filePath:   targetFile,
      model_used: modelUsed,
      summary,
    };
  }

  // Strip any accidental markdown fences
  const clean = fixedContent.replace(/^```(?:js|javascript|typescript)?\n?/i, '').replace(/\n?```$/, '').trim();

  // Sanity check — must look like JS (has 'use strict' or require or function or const)
  if (!/\b(require|const|function|module\.exports|'use strict'|import )\b/.test(clean)) {
    const summary = 'Fix output did not look like valid JS — not applied for safety.';
    db.logEntry({ level: 'WARN', agent: 'Forge', action: 'autofix', outcome: 'no-fix', model: modelUsed, note: `file=${targetFile} | ${summary}` }).catch(() => {});
    return {
      fixed:      false,
      filePath:   targetFile,
      model_used: modelUsed,
      summary,
    };
  }

  // Step 4: write the fix
  fs.writeFileSync(absPath, clean, 'utf8');

  log('autofix', 'system', modelUsed, 'applied', true, `file=${targetFile}`);
  db.logEntry({ level: 'INFO', agent: 'Forge', action: 'autofix', outcome: 'fixed', model: modelUsed, note: `file=${targetFile}` }).catch(() => {});
  learning.learnFromFix(agentName || 'unknown', targetError, `Fixed with ${modelUsed}`, targetFile).catch(() => {});

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

  const summary = `Fixed \`${targetFile}\` using ${modelUsed}.${restartMsg}`;
  return {
    fixed:      true,
    filePath:   targetFile,
    model_used: modelUsed,
    summary,
    patch:      `Original ${originalContent.split('\n').length} lines → Fixed ${clean.split('\n').length} lines`,
  };
}

// ── Auto-fix via Claude Code CLI ──────────────────────────────────────────────

/**
 * Convert a single stream-json JSONL event into a human-readable line.
 * Returns null for events that should be skipped.
 */
function _formatStreamLine(event) {
  if (!event || !event.type) return null;

  if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
    const parts = [];
    for (const block of event.message.content) {
      if (block.type === 'text' && block.text) {
        const t = block.text.trim().slice(0, 300);
        if (t) parts.push(t);
      } else if (block.type === 'tool_use') {
        const { name, input } = block;
        if      (name === 'Read') parts.push(`→ Read: ${input?.file_path || input?.path || ''}`);
        else if (name === 'Edit') parts.push(`→ Edit: ${input?.file_path || input?.path || ''}`);
        else if (name === 'Bash') parts.push(`$ ${(input?.command || '').slice(0, 120)}`);
        else                     parts.push(`→ ${name}: ${JSON.stringify(input || {}).slice(0, 80)}`);
      }
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  if (event.type === 'result' && event.result) {
    return String(event.result).slice(0, 300);
  }

  return null;
}

/**
 * Auto-fix a file using the Claude Code CLI.
 * Spawns `claude --print --output-format json ...` and writes the result.
 *
 * @param {object} opts
 *   - errorNote   {string}    error text
 *   - filePath    {string}    override file path (optional)
 *   - agentName   {string}    agent name — used to guess file when no path in note
 *   - onProgress  {Function}  optional streaming callback(text: string)
 *
 * @returns {{ fixed, filePath, model_used, summary, sessionId? }}
 */
async function autoFixWithClaude({ errorNote, filePath, agentName, onProgress } = {}) {
  // Resolve target file
  let targetFile = filePath;
  if (!targetFile && errorNote) targetFile = _extractFilePath(errorNote, '');
  if (!targetFile && agentName)  targetFile = AGENT_FILE_MAP[agentName.toLowerCase()];

  if (!targetFile) {
    return {
      fixed:      false,
      model_used: 'claude-code-cli',
      summary:    `Cannot identify which file to fix from error: ${(errorNote || '').slice(0, 120)}`,
    };
  }

  // Guard: never auto-patch the repair engine itself — would risk corruption + infinite loop
  if (PROTECTED_FILES.has(targetFile)) {
    return {
      fixed:      false,
      filePath:   targetFile,
      model_used: 'claude-code-cli',
      summary:    `Skipped auto-fix: ${targetFile} is a protected core file. Fix manually.`,
    };
  }

  const absPath = path.isAbsolute(targetFile)
    ? targetFile
    : path.join(ROOT_DIR, targetFile);

  const prompt = [
    'You are fixing a bug in the Ghost AI system (Node.js/Express).',
    '',
    `PROJECT ROOT: ${ROOT_DIR}`,
    '',
    'ERROR DETAILS:',
    `Agent: ${agentName || 'unknown'}`,
    `File: ${targetFile}`,
    `Error: ${errorNote || '(no error text provided)'}`,
    '',
    'YOUR TASK (complete in 3 turns max):',
    `Turn 1 — Read the file: ${absPath}`,
    'Turn 2 — Apply the fix using Edit (one targeted change only)',
    'Turn 3 — Done. Do NOT read back to verify. Do NOT restart services.',
    '',
    'Requirements:',
    '- Minimal surgical fix — change only the broken line(s)',
    '- Preserve all existing logic, comments, and formatting',
    '- If you cannot determine a safe fix with confidence, leave the file unchanged',
    '- No refactoring, no new features, no extra turns',
  ].join('\n');

  const streaming = typeof onProgress === 'function';

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let lineBuffer      = '';       // incomplete line buffer for stream-json mode
    let lastResultEvent = null;     // last type=result event in stream-json mode

    // Snapshot file contents before so we can detect whether claude actually changed it
    let fileBefore;
    try { fileBefore = fs.readFileSync(absPath, 'utf8'); } catch { fileBefore = null; }

    // Ghost runs as root; Claude CLI blocks --dangerously-skip-permissions for root.
    // Spawn Claude as the dedicated non-root 'forge' user via su.
    // Prompt is base64-encoded to avoid shell quoting issues.
    const outputFormat  = streaming ? 'stream-json' : 'json';
    const promptB64     = Buffer.from(prompt).toString('base64');
    const verboseFlag   = streaming ? '--verbose' : '';
    const claudeCmd     = `env -u CLAUDECODE claude --print ${verboseFlag} --output-format ${outputFormat} --max-turns 3 --allowedTools Read,Edit,Bash --dangerously-skip-permissions --setting-sources user -- "$(printf '%s' '${promptB64}' | base64 -d)"`;

    const child = spawn(
      'su',
      ['-s', '/bin/bash', 'forge', '-c', `cd ${ROOT_DIR} && ${claudeCmd}`],
      {
        env:        process.env,
        cwd:        ROOT_DIR,
        timeout:    180_000,   // 3 min — Sonnet fits comfortably (~60s start + ~10s fix)
        killSignal: 'SIGKILL', // force-kill on timeout, no waiting for graceful exit
      }
    );

    const spawnedAt = Date.now();
    let firstDataAt = null;

    if (streaming) {
      // Line-by-line JSONL processing
      child.stdout.on('data', (chunk) => {
        if (!firstDataAt) {
          firstDataAt = Date.now();
          console.log(`[Forge] First stdout from claude after ${((firstDataAt - spawnedAt) / 1000).toFixed(1)}s`);
        }
        lineBuffer += chunk.toString();
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop(); // keep incomplete trailing line
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event;
          try { event = JSON.parse(trimmed); } catch { continue; }
          if (event.type === 'result') lastResultEvent = event;
          const text = _formatStreamLine(event);
          if (text) onProgress(text);
        }
      });
    } else {
      child.stdout.on('data', d => { stdout += d.toString(); });
    }

    child.stderr.on('data', d => {
      if (!firstDataAt) {
        firstDataAt = Date.now();
        console.log(`[Forge] First stderr from claude after ${((firstDataAt - spawnedAt) / 1000).toFixed(1)}s`);
      }
      stderr += d.toString();
    });

    child.on('error', (err) => {
      const summary = `claude CLI spawn error: ${err.message}`;
      db.logEntry({ level: 'WARN', agent: 'Forge', action: 'autofix-claude', outcome: 'no-fix', model: 'claude-code-cli', note: `file=${targetFile} | ${summary}` }).catch(() => {});
      resolve({ fixed: false, filePath: targetFile, model_used: 'claude-code-cli', summary });
    });

    child.on('close', (code, signal) => {
      // Always check file changes first — Claude may have applied the fix before a timeout/signal
      let fileAfter;
      try { fileAfter = fs.readFileSync(absPath, 'utf8'); } catch { fileAfter = null; }
      const fileChanged = fileAfter !== null && fileBefore !== fileAfter;

      let resultText, sessionId;
      if (streaming) {
        resultText = lastResultEvent?.result ?? '';
        sessionId  = lastResultEvent?.session_id ?? undefined;
      } else {
        let parsed;
        try { parsed = JSON.parse(stdout); } catch { parsed = null; }
        resultText = parsed?.result ?? stdout.trim();
        sessionId  = parsed?.session_id ?? undefined;
      }

      if (fileChanged) {
        const killed = signal === 'SIGKILL' ? ' (fixed before timeout)' : '';
        const summary = `Fixed \`${targetFile}\` using Claude Code CLI (Sonnet 4.6).${killed}` + (sessionId ? ` Session: ${sessionId.slice(0, 8)}` : '');
        db.logEntry({ level: 'INFO', agent: 'Forge', action: 'autofix-claude', outcome: 'fixed', model: 'claude-sonnet-4-6', note: `file=${targetFile}` }).catch(() => {});
        // Feed to learning system so agents avoid this error pattern
        learning.learnFromFix(agentName || 'unknown', errorNote, summary, targetFile).catch(() => {});
        return resolve({ fixed: true, filePath: targetFile, model_used: 'claude-sonnet-4-6', summary, sessionId, result: resultText });
      }

      if (code !== 0) {
        // SIGKILL = timeout, null code = killed by signal
        const label   = signal === 'SIGKILL' ? 'timed out after 180s (SIGKILL)' : code !== null ? `exited ${code}` : `killed (${signal})`;
        const summary = `claude CLI ${label}: ${stderr.slice(0, 200)}`;
        db.logEntry({ level: 'WARN', agent: 'Forge', action: 'autofix-claude', outcome: 'no-fix', model: 'claude-sonnet-4-6', note: `file=${targetFile} | ${summary}` }).catch(() => {});
        return resolve({ fixed: false, filePath: targetFile, model_used: 'claude-sonnet-4-6', summary });
      }

      const summary = `Claude Code ran on \`${targetFile}\` but made no changes. ${String(resultText).slice(0, 150)}`;
      db.logEntry({ level: 'WARN', agent: 'Forge', action: 'autofix-claude', outcome: 'no-fix', model: 'claude-sonnet-4-6', note: `file=${targetFile} | no changes made` }).catch(() => {});
      resolve({ fixed: false, filePath: targetFile, model_used: 'claude-sonnet-4-6', summary });
    });
  });
}

// ── Fix All ────────────────────────────────────────────────────────────────────

let _fixAllRunning = false;

/**
 * Sequentially fix an array of errors using Claude Code CLI.
 * Emits forge:progress events for real-time WS feedback.
 *
 * @param {Array<{ id, errorNote, agentName, filePath? }>} errors
 * @returns {{ results, anyFixed, restartMsg }}
 */
async function fixAll(errors = []) {
  if (_fixAllRunning) {
    return { results: [], anyFixed: false, restartMsg: 'Fix All already running.' };
  }
  _fixAllRunning = true;

  const total = errors.length;
  db.events.emit('forge:progress', { type: 'fix-all:start', total, ts: new Date().toISOString() });

  const results = [];
  let anyFixed  = false;

  for (let i = 0; i < errors.length; i++) {
    const e = errors[i];

    db.events.emit('forge:progress', {
      type:    'fix-all:item-start',
      index:   i,
      total,
      errorId: e.id,
      agent:   e.agentName || '',
      file:    e.filePath || AGENT_FILE_MAP[(e.agentName || '').toLowerCase()] || '',
      ts:      new Date().toISOString(),
    });

    let r;
    try {
      r = await autoFixWithClaude({ errorNote: e.errorNote, filePath: e.filePath, agentName: e.agentName });
    } catch (err) {
      r = { fixed: false, filePath: e.filePath, model_used: 'claude-code-cli', summary: err.message };
    }

    if (r.fixed) anyFixed = true;
    results.push({ errorId: e.id, fixed: r.fixed, summary: r.summary, filePath: r.filePath });

    db.events.emit('forge:progress', {
      type:    'fix-all:item-done',
      errorId: e.id,
      fixed:   r.fixed,
      summary: r.summary,
      file:    r.filePath || '',
      ts:      new Date().toISOString(),
    });
  }

  let restartMsg = '';
  if (anyFixed) {
    try {
      execSync('pm2 restart ghost', { timeout: 15000 });
      restartMsg = 'Ghost restarted successfully.';
    } catch (err) {
      restartMsg = `Restart failed: ${err.message}`;
    }
  }

  db.events.emit('forge:progress', {
    type:       'fix-all:complete',
    anyFixed,
    restartMsg,
    results,
    ts:         new Date().toISOString(),
  });

  _fixAllRunning = false;
  return { results, anyFixed, restartMsg };
}

module.exports = { run, detectModel, autoFix, autoFixWithClaude, fixAll };
