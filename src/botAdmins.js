'use strict';

/**
 * botAdmins — Redis-backed + local Set cache of portal-managed bot admins.
 *
 * Redis Set `botadmins` is the source of truth across PM2 processes.
 * Local Set mirrors Redis for O(1) synchronous isAdmin() checks (no network).
 *
 * Usage:
 *   const botAdmins = require('./botAdmins');
 *   await botAdmins.load();   // called once at startup
 *   botAdmins.isAdmin('1234567890'); // → true/false (synchronous)
 */

const db    = require('./db');
const redis = require('./redis');

const REDIS_KEY = 'botadmins';
const _adminSet = new Set();

/**
 * Load all portal admins — try Redis first, fall back to DB.
 * Called once at startup (after db.initSchema).
 */
async function load() {
  try {
    // Try Redis Set first
    const members = await redis.smembers(REDIS_KEY);
    if (members && members.length > 0) {
      _adminSet.clear();
      members.forEach(id => _adminSet.add(id));
      console.log(`[BotAdmins] Loaded ${_adminSet.size} portal admin(s) from Redis`);
      return;
    }

    // Redis empty or unavailable — load from DB and seed Redis
    const rows = await db.listBotAdmins();
    _adminSet.clear();
    for (const r of rows) {
      _adminSet.add(r.user_id);
      await redis.sadd(REDIS_KEY, r.user_id);
    }
    console.log(`[BotAdmins] Loaded ${_adminSet.size} portal admin(s) from DB`);
  } catch (err) {
    console.warn('[BotAdmins] Could not load admin list:', err.message);
  }
}

/** Returns true if the given Discord user ID is a portal-managed admin. */
function isAdmin(userId) {
  return _adminSet.has(userId);
}

/**
 * Add a user — syncs to Redis Set, local Set, and DB.
 * Callers must also call db.addBotAdmin(userId, ...) for persistence.
 */
async function add(userId) {
  _adminSet.add(userId);
  await redis.sadd(REDIS_KEY, userId);
}

/**
 * Remove a user — syncs to Redis Set, local Set, and DB.
 * Callers must also call db.removeBotAdmin(userId) for persistence.
 */
async function remove(userId) {
  _adminSet.delete(userId);
  await redis.srem(REDIS_KEY, userId);
}

/** Get current list of admin user IDs. */
function list() {
  return [..._adminSet];
}

module.exports = { load, isAdmin, add, remove, list };
