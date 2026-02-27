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

module.exports = { pool, query, initSchema, logEntry };
