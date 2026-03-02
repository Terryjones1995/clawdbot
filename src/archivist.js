'use strict';

/**
 * Archivist — Long-term memory agent (pgvector)
 *
 * Manages Ghost's long-term memory using Neon PostgreSQL + pgvector.
 * All memory lives in the ghost_memory table with semantic embeddings.
 *
 * Actions:
 *   store    — embed content and upsert to ghost_memory
 *   retrieve — semantic search via pgvector + optional LLM synthesis
 *   purge    — delete stale entries (delegates to memory.pruneMemory)
 *
 * Usage:
 *   const archivist = require('./archivist');
 *   await archivist.store({ type, content, tags, ttl_days });
 *   const res = await archivist.retrieve({ query, type_filter, top_k, output_format });
 */

const fs   = require('fs');
const path = require('path');

const db     = require('./db');
const ollama = require('../openclaw/skills/ollama');
const mini   = require('./skills/openai-mini');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// ── Escalation logic ──────────────────────────────────────────────────────────

/**
 * Determine model for optional synthesis on retrieve.
 */
function detectModel(action, query = '', topK = 5, outputFormat = 'raw') {
  if (action === 'store' || action === 'purge') {
    return { model: 'none', synthesize: false, reason: `${action} — no LLM needed` };
  }
  if (outputFormat === 'raw') {
    return { model: 'none', synthesize: false, reason: 'raw output — no LLM needed' };
  }

  const q = (query || '').toLowerCase();
  if (q.includes('escalate:hard') || q.includes('escalate: hard')) {
    return { model: 'claude-sonnet-4-6', synthesize: true, reason: 'ESCALATE:HARD flag' };
  }
  if (q.includes('escalate')) {
    return { model: 'claude-sonnet-4-6', synthesize: true, reason: 'ESCALATE flag' };
  }
  if (topK > 10) {
    return { model: 'claude-sonnet-4-6', synthesize: true, reason: 'large result set requires deep synthesis' };
  }
  return { model: 'qwen2.5:14b', synthesize: true, reason: 'targeted retrieval — local model sufficient' };
}

// ── Embedding ─────────────────────────────────────────────────────────────────

async function _embed(text) {
  const truncated = text.slice(0, 8000);
  const vec = await ollama.embed(truncated);
  if (!vec || !vec.length) throw new Error('Embedding returned empty vector — is Ollama running?');
  return vec;
}

// ── LLM synthesis ─────────────────────────────────────────────────────────────

const SYNTH_SYSTEM = `You are Archivist, Ghost AI's memory agent.
You're meticulous and slightly obsessive about accuracy — never fabricate memories, only report what was retrieved.
Based on retrieved entries, provide a clear, factual answer. Reference entries by number when relevant.
If nothing stored answers the query, say so plainly. Be concise (under 300 words). Plain text only.`;

async function _synthesize(query, entries, model) {
  const entriesText = entries
    .map((e, i) => `[${i + 1}] (${e.type}${e.score ? ` — score: ${e.score.toFixed(3)}` : ''})\n${e.content}`)
    .join('\n\n');

  const userMessage = `Query: ${query}\n\nRetrieved memory entries:\n${entriesText}`;

  if (model === 'claude-sonnet-4-6') {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error('ANTHROPIC_API_KEY required');
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 512,
        system:     SYNTH_SYSTEM,
        messages:   [{ role: 'user', content: userMessage }],
      });
      return res.content[0]?.text || '';
    } catch {
      // Fall through to mini
    }
  }

  const { result, escalate } = await mini.tryChat([
    { role: 'system', content: SYNTH_SYSTEM },
    { role: 'user',   content: userMessage },
  ]);

  return (!escalate && result?.message?.content) ? result.message.content : '';
}

// ── Entry ID generator ────────────────────────────────────────────────────────

function _newId(type) {
  const ts  = Date.now();
  const rnd = Math.random().toString(36).slice(2, 7);
  return `${type}-${ts}-${rnd}`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

/**
 * Store content to ghost_memory with semantic embedding.
 *
 * @param {object} input
 *   - type          {string}   'research' | 'decision' | 'conversation' | 'agent_output' | 'approval'
 *   - content       {string}   text to embed and store
 *   - tags          {string[]} metadata tags (stored in key for searchability)
 *   - ttl_days      {number}   days before expiry (default: 90) — enforced by pruning system
 *   - source_agent  {string}   which agent is storing this
 */
async function store({ type = 'agent_output', content, tags = [], ttl_days = 90, source_agent = 'unknown' } = {}) {
  if (!content) throw new Error('content is required for store');

  const validTypes = ['research', 'decision', 'conversation', 'agent_output', 'approval'];
  if (!validTypes.includes(type)) throw new Error(`type must be one of: ${validTypes.join(', ')}`);

  const id  = _newId(type);
  const now = new Date();

  // Generate embedding
  let embedding = null;
  try {
    embedding = await _embed(content);
  } catch { /* non-fatal — store without embedding */ }

  // Store in ghost_memory with category=type, source=archivist:{source_agent}
  // Tags are encoded in the key for grep-ability
  const tagSuffix = tags.length ? `:${tags.join(',')}` : '';
  await db.storeFact({
    key:      `archivist:${id}${tagSuffix}`,
    content,
    category: type,
    source:   `archivist:${source_agent}`,
    threadId: tags[0] || null,
    embedding,
  });

  _appendLog('INFO', 'store', source_agent, 'success',
    `id=${id} type=${type} tags=[${tags.join(',')}] ttl=${ttl_days}d`);

  return {
    action:     'store',
    id,
    type,
    tags,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttl_days * 86400000).toISOString(),
    logged:     true,
  };
}

/**
 * Retrieve relevant context via pgvector semantic search.
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

  let results = [];

  // Try semantic search via pgvector
  let queryEmbedding = null;
  try {
    queryEmbedding = await _embed(query);
  } catch { /* Ollama unavailable — fall back to ILIKE */ }

  if (queryEmbedding) {
    const embStr = `[${queryEmbedding.join(',')}]`;
    const typeClause = type_filter !== 'all'
      ? `AND category = '${type_filter.replace(/'/g, "''")}'`
      : '';

    const { rows } = await db.query(
      `SELECT id, key, content, category, source, created_at, updated_at,
              1 - (embedding <=> $1::vector) AS score
       FROM ghost_memory
       WHERE embedding IS NOT NULL ${typeClause}
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embStr, top_k],
    );

    // Bump access tracking
    const ids = rows.map(r => r.id);
    if (ids.length) db.touchFacts(ids).catch(() => {});

    results = rows.map(r => ({
      id:           r.key,
      content:      r.content,
      tags:         r.key.includes(':') ? r.key.split(':').slice(2) : [],
      type:         r.category,
      source_agent: r.source?.replace('archivist:', '') || null,
      created_at:   r.created_at,
      score:        parseFloat(r.score) || 0,
    }));
  } else {
    // ILIKE fallback
    const rows = await db.getFacts(query, top_k, null);
    const ids = rows.map(r => r.id).filter(Boolean);
    if (ids.length) db.touchFacts(ids).catch(() => {});

    results = rows.map(r => ({
      id:           r.key || `fact-${r.id}`,
      content:      r.content,
      tags:         [],
      type:         r.category,
      source_agent: null,
      created_at:   r.updated_at,
      score:        0.5,
    }));
  }

  let summary = null;
  if (synthesize && results.length > 0) {
    summary = await _synthesize(query, results, model);
  }

  _appendLog('INFO', 'retrieve', 'system', 'success',
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
 * Purge stale entries. Delegates to the memory pruning system.
 */
async function purge() {
  const memory  = require('./skills/memory');
  const results = await memory.pruneMemory();

  _appendLog('INFO', 'purge', 'system', 'success',
    `pruned=${results.facts?.total || 0} threads=${results.archivedThreads || 0}`);

  return {
    action:  'purge',
    results,
    logged:  true,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

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

function _appendLog(level, action, userRole, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Archivist',
    `| action=${action}`,
    `| user_role=${userRole}`,
    '| model=nomic-embed-text',
    `| outcome=${outcome}`,
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
  db.logEntry({ level, agent: 'Archivist', action, outcome, note }).catch(() => {});
}

module.exports = { run, store, retrieve, purge, detectModel };
