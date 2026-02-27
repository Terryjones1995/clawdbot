'use strict';

/**
 * Redis — ioredis singleton with graceful degradation.
 *
 * If Redis is unavailable every exported method is a silent no-op and Ghost
 * continues working with Neon/file fallbacks. The process never crashes due to
 * Redis being down.
 *
 * Exported helpers:
 *   String cache:  get / set / del
 *   Hash ops:      hset / hget / hgetall / hdel
 *   Set ops:       sadd / srem / sismember / smembers
 *   Health:        ping
 */

const Redis = require('ioredis');

let client = null;
let _ready  = false;

function _init() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  const r = new Redis(url, {
    lazyConnect:         true,
    enableOfflineQueue:  false,   // don't queue commands while disconnected
    maxRetriesPerRequest: 0,      // fail fast rather than blocking
    connectTimeout:      3000,
    retryStrategy(times) {
      // Back off: 1s, 2s, 4s … up to 30s — keep retrying silently
      return Math.min(times * 1000, 30_000);
    },
  });

  r.on('connect', () => {
    _ready = true;
    console.log('[Redis] Connected');
  });

  r.on('ready', () => { _ready = true; });

  r.on('error', (err) => {
    // Only log the first error per disconnection to avoid log spam
    if (_ready) console.warn('[Redis] Connection lost:', err.message);
    _ready = false;
  });

  r.on('close', () => { _ready = false; });

  r.connect().catch(() => { /* handled by retryStrategy */ });

  return r;
}

function _client() {
  if (!client) client = _init();
  return client;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function get(key) {
  if (!_ready) return null;
  try { return await _client().get(key); } catch { return null; }
}

async function set(key, value, ttlSeconds = 0) {
  if (!_ready) return;
  try {
    if (ttlSeconds > 0) {
      await _client().set(key, value, 'EX', ttlSeconds);
    } else {
      await _client().set(key, value);
    }
  } catch { /* non-fatal */ }
}

async function del(key) {
  if (!_ready) return;
  try { await _client().del(key); } catch { /* non-fatal */ }
}

// ── Hash ops ──────────────────────────────────────────────────────────────────

async function hset(key, field, value) {
  if (!_ready) return;
  try { await _client().hset(key, field, value); } catch { /* non-fatal */ }
}

async function hget(key, field) {
  if (!_ready) return null;
  try { return await _client().hget(key, field); } catch { return null; }
}

async function hgetall(key) {
  if (!_ready) return null;
  try { return await _client().hgetall(key); } catch { return null; }
}

async function hdel(key, field) {
  if (!_ready) return;
  try { await _client().hdel(key, field); } catch { /* non-fatal */ }
}

// ── Set ops ───────────────────────────────────────────────────────────────────

async function sadd(key, member) {
  if (!_ready) return;
  try { await _client().sadd(key, member); } catch { /* non-fatal */ }
}

async function srem(key, member) {
  if (!_ready) return;
  try { await _client().srem(key, member); } catch { /* non-fatal */ }
}

async function sismember(key, member) {
  if (!_ready) return false;
  try { return (await _client().sismember(key, member)) === 1; } catch { return false; }
}

async function smembers(key) {
  if (!_ready) return null;
  try { return await _client().smembers(key); } catch { return null; }
}

// ── Increment ─────────────────────────────────────────────────────────────────

/**
 * Atomically increment a counter. Sets TTL (seconds) on first increment only.
 * Returns the new count, or null if Redis unavailable.
 */
async function incr(key, ttlSeconds = 0) {
  if (!_ready) return null;
  try {
    const count = await _client().incr(key);
    if (count === 1 && ttlSeconds > 0) {
      await _client().expire(key, ttlSeconds);
    }
    return count;
  } catch { return null; }
}

// ── Health ────────────────────────────────────────────────────────────────────

async function ping() {
  try {
    const res = await _client().ping();
    return res === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Returns a promise that resolves to true once Redis is ready, or false
 * if it hasn't connected within `timeoutMs` (default 5000ms).
 * Safe to call at boot time.
 */
function waitReady(timeoutMs = 5000) {
  if (_ready) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const r = _client();
    r.once('ready', () => { clearTimeout(timer); resolve(true); });
    r.once('error', () => { /* let timer handle it */ });
  });
}

module.exports = { get, set, del, hset, hget, hgetall, hdel, sadd, srem, sismember, smembers, incr, ping, waitReady };
