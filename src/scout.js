'use strict';

/**
 * Scout — Research / Web / Trends
 *
 * Handles research queries for the Ghost system.
 * - factual / competitive (quick) → qwen3-coder (Ollama, free)
 * - web / trend                   → Grok API (real-time web access)
 * - competitive (deep) / trend (deep) → Claude Sonnet (deep synthesis)
 * - ESCALATE keyword              → Claude Sonnet
 *
 * Usage:
 *   const scout = require('./scout');
 *   const result = await scout.run({ query, type, depth, store_result });
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const Anthropic = require('@anthropic-ai/sdk');
const ollama  = require('../openclaw/skills/ollama');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

const SYSTEM_PROMPT = `You are Scout, the research agent for the Ghost AI system.
Provide accurate, concise research summaries. Cite sources when known.
Format: write your summary, then list any sources on separate lines prefixed with "SOURCE: ".
Quick depth: under 300 words. Deep depth: under 700 words. Plain text only.`;

// ── Escalation logic ──────────────────────────────────────────────────────────

/**
 * Determine which model/path to use for a research query.
 *
 * @param {string} type    - 'web' | 'trend' | 'factual' | 'competitive'
 * @param {string} depth   - 'quick' | 'deep'
 * @param {string} query   - raw query string (checked for ESCALATE flags)
 * @returns {{ model: string, grok: boolean, reason: string }}
 */
function detectModel(type, depth, query = '') {
  const q = (query || '').toLowerCase();

  // Explicit escalation flags
  if (q.includes('escalate:hard') || q.includes('escalate: hard')) {
    return { model: 'claude-sonnet-4-6', grok: false, reason: 'ESCALATE:HARD flag' };
  }
  if (q.includes('escalate')) {
    return { model: 'claude-sonnet-4-6', grok: false, reason: 'ESCALATE flag in query' };
  }

  // Deep synthesis on high-stakes types → Claude Sonnet
  if (depth === 'deep' && (type === 'competitive' || type === 'trend')) {
    return { model: 'claude-sonnet-4-6', grok: false, reason: `deep ${type} requires synthesis` };
  }

  // Web / trend queries → Grok (real-time web access)
  if (type === 'web' || type === 'trend') {
    return { model: 'grok-4-1-fast-reasoning', grok: true, reason: `${type} research uses Grok web access` };
  }

  // Factual / competitive quick → free local model
  return { model: 'qwen2.5-coder:7b', grok: false, reason: 'factual/quick uses local model' };
}

// ── LLM callers ───────────────────────────────────────────────────────────────

function _grokChat(messages, model = 'grok-4-1-fast-reasoning') {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) return reject(new Error('GROK_API_KEY not set'));

    const bodyStr = JSON.stringify({ model, messages, max_tokens: 1024 });
    const options = {
      hostname: 'api.x.ai',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return reject(new Error(`Grok API error: ${json.error.message}`));
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (err) {
          reject(new Error(`Grok parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('Grok request timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

async function _claudeChat(userMessage, depth) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for escalated research');

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: depth === 'deep' ? 2048 : 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMessage }],
  });
  return res.content[0]?.text || '';
}

async function _ollamaChat(messages) {
  const { result, escalate, reason } = await ollama.tryChat(messages);
  if (escalate) return { text: null, escalate: true, reason };
  const text = result?.message?.content || '';
  return { text, escalate: false, reason: null };
}

// ── Response parser ───────────────────────────────────────────────────────────

function _parseResponse(text) {
  const lines   = (text || '').split('\n');
  const sources = [];
  const body    = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('SOURCE:') || trimmed.startsWith('Source:')) {
      const url = trimmed.replace(/^source:\s*/i, '').trim();
      if (url) sources.push(url);
    } else {
      body.push(line);
    }
  }

  return {
    summary: body.join('\n').trim(),
    sources,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run a research query.
 *
 * @param {object} input
 *   - query        {string}  required — the research question
 *   - type         {string}  'web' | 'trend' | 'factual' | 'competitive'  (default: 'factual')
 *   - depth        {string}  'quick' | 'deep'  (default: 'quick')
 *   - store_result {boolean} store to Archivist (future; logged as intent)
 *
 * @returns {object} { query, type, depth, summary, sources, model_used, escalated, escalation_reason, stored, flagged_urgent, logged }
 */
async function run({ query, type = 'factual', depth = 'quick', store_result = false } = {}) {
  if (!query) throw new Error('query is required');

  const { model, grok, reason } = detectModel(type, depth, query);
  const escalated = !grok && model !== 'qwen3-coder';

  const userMessage = [
    `Research query: ${query}`,
    `Type: ${type}`,
    `Depth: ${depth}`,
    'Provide a clear summary. List any relevant sources prefixed with "SOURCE: ".',
  ].join('\n');

  let rawText    = '';
  let actualModel = model;

  // ── Path 1: Grok (web/trend)
  if (grok) {
    try {
      rawText     = await _grokChat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ], model);
      actualModel = model;
    } catch (err) {
      appendLog('WARN', 'research', 'system', 'grok-failed',
        `query="${query.slice(0, 50)}" err=${err.message} — falling back to Ollama`);

      // Fall back to Ollama
      const ollamaRes = await _ollamaChat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ]);

      if (ollamaRes.escalate) {
        rawText     = await _claudeChat(userMessage, depth);
        actualModel = 'claude-sonnet-4-6';
      } else {
        rawText     = ollamaRes.text;
        actualModel = 'qwen3-coder';
      }
    }

  // ── Path 2: Claude Sonnet (escalated)
  } else if (escalated) {
    rawText     = await _claudeChat(userMessage, depth);
    actualModel = 'claude-sonnet-4-6';

  // ── Path 3: Ollama (free-first)
  } else {
    const ollamaRes = await _ollamaChat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userMessage },
    ]);

    if (ollamaRes.escalate) {
      rawText     = await _claudeChat(userMessage, depth);
      actualModel = 'claude-sonnet-4-6';
    } else {
      rawText     = ollamaRes.text;
      actualModel = 'qwen3-coder';
    }
  }

  const { summary, sources } = _parseResponse(rawText);

  // Trend results are flagged urgent for Sentinel to surface in Discord
  const flagged_urgent = type === 'trend' && sources.length > 0;

  appendLog('INFO', 'research', 'system', 'success',
    `type=${type} depth=${depth} model=${actualModel} sources=${sources.length} query="${query.slice(0, 60)}"`);

  return {
    query,
    type,
    depth,
    summary,
    sources,
    model_used:        actualModel,
    escalated:         actualModel !== 'qwen3-coder',
    escalation_reason: actualModel !== 'qwen3-coder' ? reason : null,
    stored:            false, // Archivist integration — future
    flagged_urgent,
    logged:            true,
  };
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Scout',
    `| action=${action}`,
    `| user_role=${userRole}`,
    '| model=qwen3-coder',
    `| outcome=${outcome}`,
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = { run, detectModel };
