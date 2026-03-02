'use strict';

const { EventEmitter } = require('events');

/** Emits 'error-logged' with the entry object whenever level=ERROR is stored. */
const events = new EventEmitter();

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
  // Enable pgvector extension (non-fatal — requires pgvector installed on Neon)
  try {
    await query(`CREATE EXTENSION IF NOT EXISTS vector`);
  } catch (err) {
    console.warn('[DB] pgvector extension unavailable — semantic search disabled:', err.message);
  }

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

  // Add embedding column if pgvector is available (non-fatal)
  try {
    await query(`ALTER TABLE ghost_memory ADD COLUMN IF NOT EXISTS embedding vector(768)`);
  } catch (err) {
    console.warn('[DB] Could not add embedding column (pgvector may be unavailable):', err.message);
  }

  // Access tracking columns for memory pruning
  try {
    await query(`ALTER TABLE ghost_memory ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ DEFAULT NOW()`);
    await query(`ALTER TABLE ghost_memory ADD COLUMN IF NOT EXISTS access_count INT NOT NULL DEFAULT 0`);
  } catch { /* non-fatal — columns may already exist */ }

  await query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id    TEXT PRIMARY KEY,
      username   TEXT,
      data       JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS message_feedback (
      id           BIGSERIAL PRIMARY KEY,
      thread_id    TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      rating       SMALLINT NOT NULL,
      note         TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS message_feedback_thread_idx ON message_feedback (thread_id)
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS portal_admins (
      user_id    TEXT PRIMARY KEY,
      username   TEXT,
      added_by   TEXT NOT NULL DEFAULT 'owner',
      added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── API Usage Tracking ──
  await query(`
    CREATE TABLE IF NOT EXISTS api_usage (
      id           BIGSERIAL PRIMARY KEY,
      ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      provider     TEXT NOT NULL,
      model        TEXT NOT NULL,
      agent        TEXT,
      action       TEXT,
      input_tokens  INT NOT NULL DEFAULT 0,
      output_tokens INT NOT NULL DEFAULT 0,
      cost         NUMERIC(12,8) NOT NULL DEFAULT 0,
      latency_ms   INT,
      thread_id    TEXT
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS api_usage_ts_idx ON api_usage (ts DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS api_usage_provider_idx ON api_usage (provider)`);

  // ── Tasks (Kanban) ──
  await query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id           BIGSERIAL PRIMARY KEY,
      title        TEXT NOT NULL,
      description  TEXT,
      status       TEXT NOT NULL DEFAULT 'todo',
      priority     TEXT NOT NULL DEFAULT 'medium',
      agent_id     TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status)`);

  // ── Ghost Settings (key-value) ──
  await query(`
    CREATE TABLE IF NOT EXISTS ghost_settings (
      key          TEXT PRIMARY KEY,
      value        JSONB NOT NULL DEFAULT '{}',
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Agent Lessons (learning system) ──
  await query(`
    CREATE TABLE IF NOT EXISTS agent_lessons (
      id           BIGSERIAL PRIMARY KEY,
      agent        TEXT NOT NULL,
      lesson       TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'general',
      severity     TEXT NOT NULL DEFAULT 'medium',
      source       TEXT NOT NULL DEFAULT 'manual',
      context      TEXT,
      active       BOOLEAN NOT NULL DEFAULT true,
      applied_count INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS agent_lessons_agent_idx ON agent_lessons (agent)`);
  await query(`CREATE INDEX IF NOT EXISTS agent_lessons_active_idx ON agent_lessons (active) WHERE active = true`);

  // Add embedding column for semantic lesson search (non-fatal)
  try {
    await query(`ALTER TABLE agent_lessons ADD COLUMN IF NOT EXISTS embedding vector(768)`);
  } catch (err) {
    console.warn('[DB] Could not add embedding column to agent_lessons:', err.message);
  }

  // ── Tickets ──
  await query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id              BIGSERIAL PRIMARY KEY,
      channel_id      TEXT NOT NULL UNIQUE,
      guild_id        TEXT,
      opener_id       TEXT,
      opener_name     TEXT,
      category_name   TEXT,
      status          TEXT NOT NULL DEFAULT 'open',
      transcript      JSONB DEFAULT '[]',
      summary         TEXT,
      lessons_extracted BOOLEAN NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at       TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets (status)`);
  await query(`CREATE INDEX IF NOT EXISTS tickets_guild_idx  ON tickets (guild_id)`);

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
    if (level === 'ERROR') {
      events.emit('error-logged', { level, agent, action, outcome, model, note });
    }
  } catch { /* non-fatal */ }
}

// ── Agent stats aggregation ──────────────────────────────────────────────────

/**
 * Per-agent stats from agent_logs — calls, errors, success rate, last active.
 * Returns { [agentName]: { total_calls, total_errors, calls_today, errors_today, successes, last_active } }
 */
async function getAgentStats() {
  if (!process.env.NEON_DATABASE_URL) return {};
  const { rows } = await query(`
    SELECT
      LOWER(agent)                                                              AS agent,
      COUNT(*)::int                                                             AS total_calls,
      COUNT(*) FILTER (WHERE level = 'ERROR')::int                              AS total_errors,
      COUNT(*) FILTER (WHERE ts > NOW() - INTERVAL '24 hours')::int             AS calls_today,
      COUNT(*) FILTER (WHERE level = 'ERROR' AND ts > NOW() - INTERVAL '24 hours')::int AS errors_today,
      COUNT(*) FILTER (WHERE outcome IN ('success','fixed'))::int               AS successes,
      MAX(ts)                                                                   AS last_active
    FROM agent_logs
    GROUP BY LOWER(agent)
  `);
  const map = {};
  for (const r of rows) map[r.agent] = r;
  return map;
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
 * If the key already exists, update content + updated_at (and embedding if provided).
 * @param {number[]|null} embedding — optional 768-dim vector from nomic-embed-text
 */
async function storeFact({ key, content, category = 'misc', source = 'conversation', threadId = null, embedding = null }) {
  if (embedding && Array.isArray(embedding)) {
    const embStr = `[${embedding.join(',')}]`;
    await query(
      `INSERT INTO ghost_memory (key, content, category, source, thread_id, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector)
       ON CONFLICT (key) DO UPDATE
         SET content    = EXCLUDED.content,
             category   = EXCLUDED.category,
             source     = EXCLUDED.source,
             embedding  = COALESCE(EXCLUDED.embedding, ghost_memory.embedding),
             updated_at = NOW()`,
      [key, content, category, source, threadId, embStr],
    );
  } else {
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
}

// Common English stop words to ignore when matching facts
const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','shall','should','may','might','must','can',
  'could','what','which','who','whom','this','that','these','those','i','me',
  'my','we','our','you','your','he','him','his','she','her','it','its','they',
  'them','their','when','where','why','how','all','both','each','some','such',
  'no','not','only','so','than','too','very','just','as','of','at','by','for',
  'with','about','into','through','before','after','above','below','to','from',
  'up','in','out','on','off','over','under','look','get','set','put','use',
  'make','give','take','know','see','tell','try','ask','call','let',
]);

/**
 * Retrieve facts relevant to a query.
 * If queryEmbedding is provided, uses pgvector cosine similarity (semantic search).
 * Falls back to ILIKE keyword matching when no embeddings or vector search fails.
 *
 * @param {string}       queryText       — the user's message to match against
 * @param {number}       limit           — max facts to return (default 15)
 * @param {number[]|null} queryEmbedding — optional 768-dim embedding for semantic search
 */
async function getFacts(queryText = '', limit = 15, queryEmbedding = null) {
  // Semantic vector search (pgvector) — preferred when embeddings are available
  if (queryEmbedding && Array.isArray(queryEmbedding)) {
    try {
      const embStr = `[${queryEmbedding.join(',')}]`;
      const { rows } = await query(
        `SELECT id, content, category, updated_at, 1 AS relevant
         FROM ghost_memory
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [embStr, limit],
      );
      if (rows.length > 0) return rows;
      // If no rows have embeddings yet, fall through to ILIKE
    } catch (err) {
      console.warn('[DB] Vector search failed, falling back to ILIKE:', err.message);
    }
  }

  // ILIKE keyword fallback — extract meaningful keywords (length > 3, not stop words)
  const keywords = (queryText || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  if (!keywords.length) {
    const { rows } = await query(
      `SELECT id, content, category, updated_at, 0 AS relevant
       FROM ghost_memory ORDER BY updated_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  // Build ILIKE conditions — a fact is "relevant" if content contains ANY keyword
  const conditions = keywords.map((_, i) => `LOWER(content) LIKE $${i + 2}`).join(' OR ');
  const params     = [limit, ...keywords.map(w => `%${w}%`)];

  const { rows } = await query(
    `SELECT id, content, category, updated_at,
            CASE WHEN ${conditions} THEN 1 ELSE 0 END AS relevant
     FROM ghost_memory
     ORDER BY relevant DESC, updated_at DESC
     LIMIT $1`,
    params,
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

// ── User Profile helpers ──────────────────────────────────────────────────────

/**
 * Get a user's profile. Returns null if not found.
 */
async function getProfile(userId) {
  const { rows } = await query(
    'SELECT user_id, username, data FROM user_profiles WHERE user_id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Merge data into a user's profile (shallow JSONB merge).
 */
async function upsertProfile(userId, data, username = null) {
  await query(
    `INSERT INTO user_profiles (user_id, username, data, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET data       = user_profiles.data || EXCLUDED.data,
           username   = COALESCE(EXCLUDED.username, user_profiles.username),
           updated_at = NOW()`,
    [userId, username, JSON.stringify(data)],
  );
}

// ── Feedback helpers ──────────────────────────────────────────────────────────

/**
 * Store thumbs up/down feedback for a Ghost reply.
 * @param {{ threadId, contentHash, rating, note }} params
 *   rating: 1 = good, -1 = bad
 */
async function storeFeedback({ threadId, contentHash, rating, note = null }) {
  await query(
    `INSERT INTO message_feedback (thread_id, content_hash, rating, note)
     VALUES ($1, $2, $3, $4)`,
    [threadId, contentHash, rating, note],
  );
}

// ── Portal Admin helpers ──────────────────────────────────────────────────────

async function listBotAdmins() {
  const { rows } = await query(
    'SELECT user_id, username, added_by, added_at FROM portal_admins ORDER BY added_at DESC',
  );
  return rows;
}

async function addBotAdmin(userId, username = null, addedBy = 'owner') {
  await query(
    `INSERT INTO portal_admins (user_id, username, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET username = COALESCE(EXCLUDED.username, portal_admins.username),
           added_by = EXCLUDED.added_by`,
    [userId, username, addedBy],
  );
}

async function removeBotAdmin(userId) {
  await query('DELETE FROM portal_admins WHERE user_id = $1', [userId]);
}

// ── API Usage helpers ─────────────────────────────────────────────────────────

async function logApiUsage({ provider, model, agent, action, input_tokens = 0, output_tokens = 0, cost = 0, latency_ms = null, thread_id = null }) {
  if (!process.env.NEON_DATABASE_URL) return;
  try {
    await pool.query(
      `INSERT INTO api_usage (provider, model, agent, action, input_tokens, output_tokens, cost, latency_ms, thread_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [provider, model, agent, action, input_tokens, output_tokens, cost, latency_ms, thread_id],
    );
  } catch { /* non-fatal */ }
}

async function getApiUsageStats({ period = 'all' } = {}) {
  let timeFilter = '';
  if (period === 'today')  timeFilter = `WHERE ts >= CURRENT_DATE`;
  else if (period === 'week')   timeFilter = `WHERE ts >= NOW() - INTERVAL '7 days'`;
  else if (period === 'month')  timeFilter = `WHERE ts >= NOW() - INTERVAL '30 days'`;

  const { rows } = await query(`
    SELECT provider,
           COUNT(*) AS calls,
           SUM(input_tokens)  AS total_input_tokens,
           SUM(output_tokens) AS total_output_tokens,
           SUM(cost)::numeric AS total_cost,
           MAX(model) AS last_model,
           MAX(ts)    AS last_call
    FROM api_usage ${timeFilter}
    GROUP BY provider
    ORDER BY total_cost DESC
  `);
  return rows;
}

async function getApiUsageRecent({ limit = 50, period = 'all' } = {}) {
  let timeFilter = '';
  if (period === 'today')  timeFilter = `WHERE ts >= CURRENT_DATE`;
  else if (period === 'week')   timeFilter = `WHERE ts >= NOW() - INTERVAL '7 days'`;
  else if (period === 'month')  timeFilter = `WHERE ts >= NOW() - INTERVAL '30 days'`;

  const { rows } = await query(
    `SELECT id, ts, provider, model, agent, action, input_tokens, output_tokens, cost, latency_ms
     FROM api_usage ${timeFilter}
     ORDER BY ts DESC LIMIT $1`,
    [Math.min(limit, 200)],
  );
  return rows;
}

// ── Task helpers ──────────────────────────────────────────────────────────────

async function createTask({ title, description = null, status = 'todo', priority = 'medium', agent_id = null }) {
  const { rows } = await query(
    `INSERT INTO tasks (title, description, status, priority, agent_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [title, description, status, priority, agent_id],
  );
  return rows[0];
}

async function getTasks({ status = null, agent_id = null } = {}) {
  let sql = `SELECT * FROM tasks`;
  const params = [];
  const where = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (agent_id) { params.push(agent_id); where.push(`agent_id = $${params.length}`); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, updated_at DESC`;
  const { rows } = await query(sql, params);
  return rows;
}

async function updateTask(id, updates) {
  const sets = [];
  const params = [id];
  for (const [key, val] of Object.entries(updates)) {
    if (['title', 'description', 'status', 'priority', 'agent_id'].includes(key)) {
      params.push(val);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  const { rows } = await query(
    `UPDATE tasks SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params,
  );
  return rows[0] ?? null;
}

async function deleteTask(id) {
  const { rowCount } = await query('DELETE FROM tasks WHERE id = $1', [id]);
  return rowCount > 0;
}

// ── Settings helpers ──────────────────────────────────────────────────────────

async function getSetting(key) {
  const { rows } = await query('SELECT value FROM ghost_settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO ghost_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}

async function getAllSettings() {
  const { rows } = await query('SELECT key, value FROM ghost_settings ORDER BY key');
  const result = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

// ── Lesson helpers ────────────────────────────────────────────────────────────

async function createLesson({ agent, lesson, category = 'general', severity = 'medium', source = 'manual', context = null, embedding = null }) {
  const embStr = embedding && Array.isArray(embedding) ? `[${embedding.join(',')}]` : null;
  const { rows } = await query(
    `INSERT INTO agent_lessons (agent, lesson, category, severity, source, context${embStr ? ', embedding' : ''})
     VALUES ($1, $2, $3, $4, $5, $6${embStr ? ', $7::vector' : ''}) RETURNING *`,
    embStr
      ? [agent, lesson, category, severity, source, context, embStr]
      : [agent, lesson, category, severity, source, context],
  );
  return rows[0];
}

async function getLessons({ agent = null, category = null, active = null, limit = 100 } = {}) {
  let sql = `SELECT * FROM agent_lessons`;
  const params = [];
  const where = [];
  if (agent)     { params.push(agent); where.push(`LOWER(agent) = LOWER($${params.length})`); }
  if (category)  { params.push(category); where.push(`category = $${params.length}`); }
  if (active !== null) { params.push(active); where.push(`active = $${params.length}`); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  params.push(Math.min(limit, 500));
  sql += ` ORDER BY updated_at DESC LIMIT $${params.length}`;
  const { rows } = await query(sql, params);
  return rows;
}

async function getActiveLessons(agent, limit = 10) {
  const { rows } = await query(
    `SELECT id, lesson, category, severity, source FROM agent_lessons
     WHERE LOWER(agent) = LOWER($1) AND active = true
     ORDER BY applied_count DESC, updated_at DESC LIMIT $2`,
    [agent, limit],
  );
  return rows;
}

async function getActiveLessonsByEmbedding(agent, embedding, limit = 5) {
  if (!embedding || !Array.isArray(embedding)) return getActiveLessons(agent, limit);
  try {
    const embStr = `[${embedding.join(',')}]`;
    const { rows } = await query(
      `SELECT id, lesson, category, severity, source FROM agent_lessons
       WHERE LOWER(agent) = LOWER($1) AND active = true AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector LIMIT $3`,
      [agent, embStr, limit],
    );
    if (rows.length > 0) return rows;
  } catch { /* fall back to non-semantic */ }
  return getActiveLessons(agent, limit);
}

async function updateLesson(id, updates) {
  const sets = [];
  const params = [id];
  for (const [key, val] of Object.entries(updates)) {
    if (['lesson', 'category', 'severity', 'active', 'context'].includes(key)) {
      params.push(val);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  const { rows } = await query(
    `UPDATE agent_lessons SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params,
  );
  return rows[0] ?? null;
}

async function incrementLessonApplied(id) {
  await query('UPDATE agent_lessons SET applied_count = applied_count + 1, updated_at = NOW() WHERE id = $1', [id]);
}

async function deleteLesson(id) {
  const { rowCount } = await query('DELETE FROM agent_lessons WHERE id = $1', [id]);
  return rowCount > 0;
}

// ── Memory Pruning ────────────────────────────────────────────────────────────

/**
 * Bump access tracking when a fact is retrieved.
 * @param {number[]} ids — array of ghost_memory row IDs
 */
async function touchFacts(ids) {
  if (!ids.length) return;
  await query(
    `UPDATE ghost_memory SET last_accessed_at = NOW(), access_count = access_count + 1 WHERE id = ANY($1::bigint[])`,
    [ids],
  ).catch(() => {});
}

/**
 * Prune stale/low-quality memories. Returns count of deleted rows.
 *
 * Rules:
 * 1. Conversation-extracted facts > 60 days old that have NEVER been accessed → delete
 * 2. Any fact > 180 days old with 0 access → delete
 * 3. League API cache entries > 48h old → delete (they get refreshed)
 * 4. Never touch: training, seed-hof-knowledge, manual sources unless > 365d
 */
async function pruneStaleMemory() {
  const results = { conversationPruned: 0, oldUnused: 0, staleCache: 0, ancientManual: 0 };

  // 1. Auto-extracted conversation facts — 60d + 0 access
  const r1 = await query(
    `DELETE FROM ghost_memory
     WHERE source = 'conversation' AND access_count = 0
       AND created_at < NOW() - INTERVAL '60 days'`,
  );
  results.conversationPruned = r1.rowCount || 0;

  // 2. Any fact — 180d + 0 access (except protected sources)
  const r2 = await query(
    `DELETE FROM ghost_memory
     WHERE source NOT IN ('training', 'seed-hof-knowledge', 'manual')
       AND access_count = 0
       AND created_at < NOW() - INTERVAL '180 days'`,
  );
  results.oldUnused = r2.rowCount || 0;

  // 3. Stale league API cache — 48h old
  const r3 = await query(
    `DELETE FROM ghost_memory
     WHERE source = 'league-api-cache'
       AND updated_at < NOW() - INTERVAL '48 hours'`,
  );
  results.staleCache = r3.rowCount || 0;

  // 4. Very ancient manually-added facts — 365d + 0 access
  const r4 = await query(
    `DELETE FROM ghost_memory
     WHERE source IN ('training', 'seed-hof-knowledge', 'manual')
       AND access_count = 0
       AND created_at < NOW() - INTERVAL '365 days'`,
  );
  results.ancientManual = r4.rowCount || 0;

  const total = results.conversationPruned + results.oldUnused + results.staleCache + results.ancientManual;
  return { total, ...results };
}

/**
 * Prune old conversations that haven't been updated in > 90 days.
 * Keeps summary, removes messages to free space.
 */
async function archiveOldThreads() {
  const { rowCount } = await query(
    `UPDATE conversations
     SET messages = '[]'::jsonb
     WHERE updated_at < NOW() - INTERVAL '90 days'
       AND messages != '[]'::jsonb`,
  );
  return rowCount || 0;
}

/**
 * Prune old agent_logs entries (> 90 days).
 */
async function pruneOldLogs() {
  const { rowCount } = await query(
    `DELETE FROM agent_logs WHERE ts < NOW() - INTERVAL '90 days'`,
  );
  return rowCount || 0;
}

/**
 * Get memory stats for monitoring.
 */
async function getMemoryStats() {
  const { rows } = await query(`
    SELECT
      COUNT(*) as total_facts,
      COUNT(*) FILTER (WHERE access_count = 0) as never_accessed,
      COUNT(*) FILTER (WHERE source = 'conversation') as from_conversations,
      COUNT(*) FILTER (WHERE source = 'league-api-cache') as league_cache,
      COUNT(*) FILTER (WHERE source IN ('training', 'seed-hof-knowledge', 'manual')) as curated,
      COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '30 days') as older_30d,
      COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '90 days') as older_90d
    FROM ghost_memory
  `);
  return rows[0] || {};
}

// ── Ticket helpers ───────────────────────────────────────────────────────────

/**
 * Create or update a ticket record.
 * Lightweight on first detection (just channel_id + guild_id).
 * Full data on save/close (transcript, opener, category).
 */
async function upsertTicket({ channelId, guildId = null, openerId = null, openerName = null, categoryName = null, transcript = null }) {
  const txJson = transcript ? JSON.stringify(transcript) : null;
  await query(
    `INSERT INTO tickets (channel_id, guild_id, opener_id, opener_name, category_name, transcript)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::jsonb, '[]'::jsonb))
     ON CONFLICT (channel_id) DO UPDATE
       SET guild_id       = COALESCE(EXCLUDED.guild_id, tickets.guild_id),
           opener_id      = COALESCE(EXCLUDED.opener_id, tickets.opener_id),
           opener_name    = COALESCE(EXCLUDED.opener_name, tickets.opener_name),
           category_name  = COALESCE(EXCLUDED.category_name, tickets.category_name),
           transcript     = CASE
             WHEN EXCLUDED.transcript IS NOT NULL AND EXCLUDED.transcript != '[]'::jsonb
             THEN EXCLUDED.transcript ELSE tickets.transcript END,
           updated_at     = NOW()`,
    [channelId, guildId, openerId, openerName, categoryName, txJson],
  );
}

async function getTicket(channelId) {
  const { rows } = await query('SELECT * FROM tickets WHERE channel_id = $1', [channelId]);
  return rows[0] ?? null;
}

async function closeTicket(channelId, transcript, summary = null) {
  await query(
    `UPDATE tickets
     SET status = 'closed', transcript = $2, summary = $3,
         closed_at = NOW(), updated_at = NOW()
     WHERE channel_id = $1`,
    [channelId, JSON.stringify(transcript), summary],
  );
}

async function getUnanalyzedTickets(limit = 20) {
  const { rows } = await query(
    `SELECT * FROM tickets
     WHERE status = 'closed' AND lessons_extracted = false
     ORDER BY closed_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

async function markTicketAnalyzed(channelId) {
  await query(
    'UPDATE tickets SET lessons_extracted = true, updated_at = NOW() WHERE channel_id = $1',
    [channelId],
  );
}

async function getOpenTickets() {
  const { rows } = await query(
    `SELECT channel_id, guild_id FROM tickets WHERE status = 'open' ORDER BY created_at DESC`,
  );
  return rows;
}

module.exports = {
  pool, query, initSchema, logEntry, events,
  getThread, upsertThread, listThreads,
  storeFact, getFacts, getAllFacts,
  getProfile, upsertProfile,
  storeFeedback,
  listBotAdmins, addBotAdmin, removeBotAdmin,
  logApiUsage, getApiUsageStats, getApiUsageRecent,
  createTask, getTasks, updateTask, deleteTask,
  getSetting, setSetting, getAllSettings,
  createLesson, getLessons, getActiveLessons, getActiveLessonsByEmbedding, updateLesson, incrementLessonApplied, deleteLesson,
  getAgentStats,
  touchFacts, pruneStaleMemory, archiveOldThreads, pruneOldLogs, getMemoryStats,
  upsertTicket, getTicket, closeTicket, getUnanalyzedTickets, markTicketAnalyzed, getOpenTickets,
};
