'use strict';

/**
 * db.js — Neon PostgreSQL connection pool
 *
 * Single shared pg.Pool for the entire application.
 * All agents and routes import this module to query the DB.
 *
 * Usage:
 *   const db = require('./db');
 *   const { rows } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
 *   // or with a transaction:
 *   const client = await db.pool.connect();
 *   try { await client.query('BEGIN'); ... await client.query('COMMIT'); }
 *   finally { client.release(); }
 */

const { Pool } = require('pg');

if (!process.env.NEON_DATABASE_URL) {
  console.warn('[DB] NEON_DATABASE_URL not set — database features disabled');
}

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max:              10,   // max connections in pool
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Run a parameterized query against the pool.
 * @param {string}   text   — SQL string with $1, $2 … placeholders
 * @param {any[]}    params — parameter values (optional)
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms  = Date.now() - start;
    if (ms > 1000) console.warn(`[DB] Slow query (${ms}ms):`, text.slice(0, 80));
    return res;
  } catch (err) {
    console.error('[DB] Query error:', err.message, '| SQL:', text.slice(0, 80));
    throw err;
  }
}

/**
 * Initialize schema — create tables if they don't exist.
 * Called once at server startup.
 */
async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id           SERIAL PRIMARY KEY,
      username     TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role         TEXT NOT NULL DEFAULT 'user',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS agent_logs (
      id           BIGSERIAL PRIMARY KEY,
      ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      level        TEXT NOT NULL,
      agent        TEXT NOT NULL,
      action       TEXT NOT NULL,
      outcome      TEXT NOT NULL,
      model        TEXT,
      user_role    TEXT,
      note         TEXT
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS agent_logs_ts_idx    ON agent_logs (ts DESC)
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS agent_logs_agent_idx ON agent_logs (agent)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      thread_id   TEXT PRIMARY KEY,
      messages    JSONB NOT NULL DEFAULT '[]',
      summary     TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS conversations_updated_idx ON conversations (updated_at DESC)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ghost_memory (
      id          BIGSERIAL PRIMARY KEY,
      key         TEXT UNIQUE NOT NULL,
      content     TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'misc',
      source      TEXT NOT NULL DEFAULT 'conversation',
      thread_id   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS ghost_memory_fts_idx
      ON ghost_memory USING gin(to_tsvector('english', content))
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS ghost_memory_updated_idx ON ghost_memory (updated_at DESC)
  `);

  console.log('[DB] Schema ready');
}

/**
 * Insert a log entry into agent_logs table (non-fatal — won't crash agent on failure).
 */
async function logEntry({ level = 'INFO', agent, action, outcome, model = null, user_role = null, note = null } = {}) {
  if (!process.env.NEON_DATABASE_URL) return; // DB disabled
  try {
    await pool.query(
      `INSERT INTO agent_logs (level, agent, action, outcome, model, user_role, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [level, agent, action, outcome, model, user_role, note]
    );
  } catch { /* non-fatal */ }
}

// ── Conversation thread helpers ───────────────────────────────────────────────

/**
 * Load a conversation thread from Neon.
 * Returns null if not found.
 */
async function getThread(threadId) {
  const { rows } = await query(
    'SELECT * FROM conversations WHERE thread_id = $1',
    [threadId],
  );
  return rows[0] ?? null;
}

/**
 * Upsert a conversation thread into Neon.
 */
async function upsertThread({ threadId, messages, summary, createdAt }) {
  await query(
    `INSERT INTO conversations (thread_id, messages, summary, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (thread_id) DO UPDATE
       SET messages   = EXCLUDED.messages,
           summary    = EXCLUDED.summary,
           updated_at = NOW()`,
    [threadId, JSON.stringify(messages), summary ?? null, createdAt ?? new Date().toISOString()],
  );
}

/**
 * List all threads ordered by most recently updated.
 */
async function listThreads() {
  const { rows } = await query(
    `SELECT thread_id, summary, updated_at,
            jsonb_array_length(messages) AS message_count
     FROM conversations
     ORDER BY updated_at DESC`,
  );
  return rows;
}

// ── Ghost Memory helpers ──────────────────────────────────────────────────────

/**
 * Upsert a fact into ghost_memory.
 * If the key already exists, update content + updated_at.
 */
async function storeFact({ key, content, category = 'misc', source = 'conversation', threadId = null }) {
  await query(
    `INSERT INTO ghost_memory (key, content, category, source, thread_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key) DO UPDATE
       SET content    = EXCLUDED.content,
           category   = EXCLUDED.category,
           source     = EXCLUDED.source,
           updated_at = NOW()`,
    [key, content, category, source, threadId],
  );
}

/**
 * Retrieve facts relevant to a query using full-text search.
 * Falls back to most-recently-updated facts when nothing matches.
 * @param {string} queryText  — the user's message to match against
 * @param {number} limit      — max facts to return (default 15)
 */
async function getFacts(queryText = '', limit = 15) {
  const { rows } = await query(
    `SELECT content, category, updated_at,
            CASE WHEN $1 != '' AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
                 THEN 1 ELSE 0 END AS relevant
     FROM ghost_memory
     ORDER BY relevant DESC, updated_at DESC
     LIMIT $2`,
    [queryText, limit],
  );
  return rows;
}

/**
 * Get all stored facts (for inspection/debugging).
 */
async function getAllFacts() {
  const { rows } = await query('SELECT * FROM ghost_memory ORDER BY category, updated_at DESC');
  return rows;
}

module.exports = { pool, query, initSchema, logEntry, getThread, upsertThread, listThreads, storeFact, getFacts, getAllFacts };
