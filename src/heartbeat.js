'use strict';

/**
 * Heartbeat — Activity tracker + idle auto-shutdown
 *
 * Tracks real external activity (Discord messages, HTTP requests, Scribe sends).
 * After IDLE_SHUTDOWN_MINUTES of nothing, exits cleanly so PM2 restarts fresh.
 *
 * What counts as activity:
 *   - Any Discord message from a user
 *   - Any HTTP API request
 *   - Scribe sending a scheduled briefing or firing a reminder
 *
 * What does NOT count:
 *   - Internal Scribe tick (60s interval just checking the clock)
 *   - Background log writes
 *
 * Usage:
 *   const heartbeat = require('./heartbeat');
 *   heartbeat.start();      // call once at server boot
 *   heartbeat.pulse();      // call on any real activity
 *   heartbeat.getStatus();  // returns uptime/idle stats
 */

const fs   = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// Default: 2 hours idle → shutdown (PM2 will restart)
const IDLE_SHUTDOWN_MS = parseInt(process.env.IDLE_SHUTDOWN_MINUTES || '120', 10) * 60_000;

let lastActivity = Date.now();
let startedAt    = Date.now();
let _idleTimer   = null;

// ── Public API ────────────────────────────────────────────────────────────────

/** Record activity — resets the idle countdown. */
function pulse() {
  lastActivity = Date.now();
  _resetTimer();
}

/** Start the heartbeat. Call once at server boot. */
function start() {
  startedAt = Date.now();
  pulse();
  const mins = Math.round(IDLE_SHUTDOWN_MS / 60_000);
  console.log(`[Heartbeat] Started — idle shutdown after ${mins}m of inactivity`);
}

/** Current activity stats. */
function getStatus() {
  const now = Date.now();
  return {
    uptime_seconds:    Math.round((now - startedAt) / 1000),
    idle_seconds:      Math.round((now - lastActivity) / 1000),
    last_activity:     new Date(lastActivity).toISOString(),
    started_at:        new Date(startedAt).toISOString(),
    idle_shutdown_min: Math.round(IDLE_SHUTDOWN_MS / 60_000),
    status:            Math.round((now - lastActivity) / 1000) < 60 ? 'active' : 'idle',
  };
}

// ── Internals ─────────────────────────────────────────────────────────────────

function _resetTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  if (IDLE_SHUTDOWN_MS > 0) {
    _idleTimer = setTimeout(_shutdown, IDLE_SHUTDOWN_MS);
  }
}

function _shutdown() {
  const mins = Math.round(IDLE_SHUTDOWN_MS / 60_000);
  console.log(`[Heartbeat] No activity for ${mins}m — shutting down cleanly for PM2 restart`);
  _log('idle-shutdown', `idle=${mins}m — process exiting for PM2 restart`);
  // Give open connections a moment to close
  setTimeout(() => process.exit(0), 500);
}

function _log(action, note) {
  const entry = [
    '[INFO]',
    new Date().toISOString(),
    '| agent=Heartbeat',
    `| action=${action}`,
    '| user_role=system',
    '| model=none',
    '| outcome=success',
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = { start, pulse, getStatus };
