'use strict';

/**
 * botAdmins — in-memory cache of portal-managed bot admins.
 *
 * These are Discord user IDs granted ADMIN privilege via the portal Servers page,
 * independent of Discord roles. Checked synchronously in _resolveRole().
 *
 * Usage:
 *   const botAdmins = require('./botAdmins');
 *   await botAdmins.load();   // called once at startup
 *   botAdmins.isAdmin('1234567890'); // → true/false
 */

const db = require('./db');

const _adminSet = new Set();

/**
 * Load all portal admins from the database into memory.
 * Called once at startup (after db.initSchema).
 */
async function load() {
  try {
    const rows = await db.listBotAdmins();
    _adminSet.clear();
    rows.forEach(r => _adminSet.add(r.user_id));
    console.log(`[BotAdmins] Loaded ${_adminSet.size} portal admin(s)`);
  } catch (err) {
    console.warn('[BotAdmins] Could not load admin list:', err.message);
  }
}

/** Returns true if the given Discord user ID is a portal-managed admin. */
function isAdmin(userId) {
  return _adminSet.has(userId);
}

/** Add a user to the in-memory set (call after db.addBotAdmin). */
function add(userId) {
  _adminSet.add(userId);
}

/** Remove a user from the in-memory set (call after db.removeBotAdmin). */
function remove(userId) {
  _adminSet.delete(userId);
}

/** Get current list of admin user IDs. */
function list() {
  return [..._adminSet];
}

module.exports = { load, isAdmin, add, remove, list };
