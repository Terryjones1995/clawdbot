'use strict';

/**
 * Archivist — Memory / Pinecone
 *
 * Manages Ghost's long-term memory across three tiers:
 *   Hot  → Redis        (future; skipped in MVP)
 *   Warm → Pinecone     (agent outputs, research, decisions — 90-day TTL)
 *   Cold → memory/ files (audit logs, approvals, schema — permanent)
 *
 * Actions:
 *   store    — embed content and upsert to Pinecone
 *   retrieve — semantic search + optional LLM synthesis
 *   purge    — delete Pinecone entries whose expires_at has passed
 *
 * Usage:
 *   const archivist = require('./archivist');
 *   await archivist.store({ type, content, tags, ttl_days });
 *   const res = await archivist.retrieve({ query, type_filter, top_k, output_format });
 *
 * Required env:
 *   PINECONE_API_KEY        — Pinecone API key
 *   PINECONE_INDEX_HOST     — full index host URL (from Pinecone dashboard)
 *   PINECONE_NAMESPACE      — namespace to use (default: 'ghost')
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const Anthropic = require('@anthropic-ai/sdk');
const ollama  = require('../openclaw/skills/ollama');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// ── Escalation logic ──────────────────────────────────────────────────────────

/**
 * Determine model for optional synthesis on retrieve.
 *
 * @param {string} action       - 'store' | 'retrieve' | 'purge'
 * @param {string} query        - natural language query (retrieve only)
 * @param {number} topK         - number of results requested
 * @param {string} outputFormat - 'raw' | 'summary'
 * @returns {{ model: string, synthesize: boolean, reason: string }}
 */
function detectModel(action, query = '', topK = 5, outputFormat = 'raw') {
  // store / purge never need LLM
  if (action === 'store' || action === 'purge') {
    return { model: 'none', synthesize: false, reason: `${action} — no LLM needed` };
  }

  // raw output — return results as-is, no synthesis
  if (outputFormat === 'raw') {
    return { model: 'none', synthesize: false, reason: 'raw output — no LLM needed' };
  }

  const q = (query || '').toLowerCase();

  // Explicit escalation flags
  if (q.includes('escalate:hard') || q.includes('escalate: hard')) {
    return { model: 'claude-sonnet-4-6', synthesize: true, reason: 'ESCALATE:HARD flag' };
  }
  if (q.includes('escalate')) {
    return { model: 'claude-sonnet-4-6', synthesize: true, reason: 'ESCALATE flag' };
  }

  // Large result sets require deep synthesis → Claude Sonnet
  if (topK > 10) {
    return { model: 'claude-sonnet-4-6', synthesize: true, reason: 'large result set requires deep synthesis' };
  }

  // Standard targeted retrieval → local model
  return { model: 'qwen3-coder', synthesize: true, reason: 'targeted retrieval — local model sufficient' };
}

// ── Pinecone HTTP client ──────────────────────────────────────────────────────

function _pineconeHost() {
  const raw = process.env.PINECONE_INDEX_HOST || '';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

function _pineconeRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.PINECONE_API_KEY;
    if (!apiKey) return reject(new Error('PINECONE_API_KEY not set'));

    const hostUrl = _pineconeHost();
    if (!hostUrl || hostUrl === 'https://') {
      return reject(new Error('PINECONE_INDEX_HOST not set'));
    }

    const url     = new URL(urlPath, hostUrl);
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Api-Key':      apiKey,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            return reject(new Error(`Pinecone HTTP ${res.statusCode}: ${json.message || raw}`));
          }
          resolve(json);
        } catch (err) {
          reject(new Error(`Pinecone parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('Pinecone request timeout')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function _embed(text) {
  // Truncate to ~8k chars to stay within embed model context limits
  const truncated = text.slice(0, 8000);
  const vec = await ollama.embed(truncated);
  if (!vec || !vec.length) throw new Error('Embedding returned empty vector — is Ollama running?');
  return vec;
}

// ── LLM synthesis ─────────────────────────────────────────────────────────────

const SYNTH_SYSTEM = `You are Archivist, Ghost AI's memory agent.
Based on retrieved memory entries, provide a clear, factual answer to the query.
Reference specific entries when relevant. Be concise (under 300 words). Plain text only.`;

async function _synthesize(query, entries, model) {
  const entriesText = entries
    .map((e, i) => `[${i + 1}] (${e.type} — score: ${e.score.toFixed(3)})\n${e.content}`)
    .join('\n\n');

  const userMessage = `Query: ${query}\n\nRetrieved memory entries:\n${entriesText}`;

  if (model === 'claude-sonnet-4-6') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for synthesis escalation');
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 512,
      system:     SYNTH_SYSTEM,
      messages:   [{ role: 'user', content: userMessage }],
    });
    return res.content[0]?.text || '';
  }

  // qwen3-coder via Ollama
  const { result, escalate, reason } = await ollama.tryChat([
    { role: 'system', content: SYNTH_SYSTEM },
    { role: 'user',   content: userMessage },
  ]);

  if (escalate) {
    appendLog('WARN', 'synthesize', 'system', 'ollama-failed', `escalating — ${reason}`);
    return _synthesize(query, entries, 'claude-sonnet-4-6');
  }
  return result?.message?.content || '';
}

// ── Entry ID generator ────────────────────────────────────────────────────────

function _newId(type) {
  const ts  = Date.now();
  const rnd = Math.random().toString(36).slice(2, 7);
  return `${type}-${ts}-${rnd}`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Store content to Pinecone (warm tier).
 *
 * @param {object} input
 *   - type          {string}   'research' | 'decision' | 'conversation' | 'agent_output' | 'approval'
 *   - content       {string}   text to embed and store
 *   - tags          {string[]} metadata tags
 *   - ttl_days      {number}   days before expiry (default: 90)
 *   - source_agent  {string}   which agent is storing this
 */
async function store({ type = 'agent_output', content, tags = [], ttl_days = 90, source_agent = 'unknown' } = {}) {
  if (!content) throw new Error('content is required for store');

  const validTypes = ['research', 'decision', 'conversation', 'agent_output', 'approval'];
  if (!validTypes.includes(type)) throw new Error(`type must be one of: ${validTypes.join(', ')}`);

  const id        = _newId(type);
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + ttl_days * 86400000);

  const vector = await _embed(content);

  const namespace = process.env.PINECONE_NAMESPACE || 'ghost';

  await _pineconeRequest('POST', '/vectors/upsert', {
    vectors: [{
      id,
      values:   vector,
      metadata: {
        type,
        tags,
        source_agent,
        created_at:      now.toISOString(),
        expires_at:      expiresAt.toISOString(),
        ttl_days,
        content_preview: content.slice(0, 200),
        content:         content.slice(0, 39000), // stay under 40KB Pinecone limit
      },
    }],
    namespace,
  });

  appendLog('INFO', 'store', source_agent, 'success',
    `id=${id} type=${type} tags=[${tags.join(',')}] ttl=${ttl_days}d`);

  return {
    action:     'store',
    id,
    type,
    tags,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    logged:     true,
  };
}

/**
 * Retrieve relevant context via semantic search.
 *
 * @param {object} input
 *   - query         {string}  natural language question
 *   - type_filter   {string}  'research' | 'decision' | 'all'
 *   - top_k         {number}  number of results (default: 5)
 *   - output_format {string}  'raw' | 'summary' (default: 'raw')
 */
async function retrieve({ query, type_filter = 'all', top_k = 5, output_format = 'raw' } = {}) {
  if (!query) throw new Error('query is required for retrieve');

  const { model, synthesize } = detectModel('retrieve', query, top_k, output_format);
  const namespace = process.env.PINECONE_NAMESPACE || 'ghost';

  const vector = await _embed(query);

  const queryBody = {
    vector,
    topK:            top_k,
    includeMetadata: true,
    namespace,
  };

  if (type_filter !== 'all') {
    queryBody.filter = { type: { $eq: type_filter } };
  }

  const data    = await _pineconeRequest('POST', '/query', queryBody);
  const results = (data.matches || []).map(m => ({
    id:         m.id,
    content:    m.metadata?.content || m.metadata?.content_preview || '',
    tags:       m.metadata?.tags || [],
    type:       m.metadata?.type || 'unknown',
    source_agent: m.metadata?.source_agent || null,
    created_at: m.metadata?.created_at || null,
    score:      m.score,
  }));

  let summary = null;
  if (synthesize && results.length > 0) {
    summary = await _synthesize(query, results, model);
  }

  appendLog('INFO', 'retrieve', 'system', 'success',
    `query="${query.slice(0, 50)}" type=${type_filter} k=${top_k} hits=${results.length} model=${model}`);

  return {
    action:      'retrieve',
    query,
    type_filter,
    results,
    summary,
    model_used:  model,
    logged:      true,
  };
}

/**
 * Purge expired Pinecone entries (TTL enforcement).
 * Uses Pinecone filter delete — requires a serverless index.
 *
 * @param {object} input
 *   - namespace {string}  override namespace (default: PINECONE_NAMESPACE || 'ghost')
 */
async function purge({ namespace: nsOverride } = {}) {
  const namespace = nsOverride || process.env.PINECONE_NAMESPACE || 'ghost';
  const cutoff    = new Date().toISOString();

  await _pineconeRequest('POST', '/vectors/delete', {
    filter:    { expires_at: { $lt: cutoff } },
    namespace,
  });

  appendLog('INFO', 'purge', 'system', 'success', `namespace=${namespace} cutoff=${cutoff}`);

  return {
    action:    'purge',
    namespace,
    cutoff,
    logged:    true,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Dispatch an Archivist action.
 *
 * @param {object} input - see store / retrieve / purge for params
 */
async function run(input = {}) {
  const { action = 'retrieve' } = input;

  switch (action) {
    case 'store':    return store(input);
    case 'retrieve': return retrieve(input);
    case 'purge':    return purge(input);
    default:
      throw new Error(`Unknown action: ${action}. Use: store, retrieve, purge`);
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Archivist',
    `| action=${action}`,
    `| user_role=${userRole}`,
    '| model=qwen3-coder',
    `| outcome=${outcome}`,
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = { run, store, retrieve, purge, detectModel };
