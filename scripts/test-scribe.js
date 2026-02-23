#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for Scribe (no LLM calls, no Discord).
 * Run: node scripts/test-scribe.js
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// Ensure memory dir exists and clear test reminder file first
const REMINDERS_FILE = path.join(__dirname, '../memory/reminders.json');
const backup = fs.existsSync(REMINDERS_FILE)
  ? fs.readFileSync(REMINDERS_FILE, 'utf8')
  : null;
fs.mkdirSync(path.join(__dirname, '../memory'), { recursive: true });
fs.writeFileSync(REMINDERS_FILE, '[]');

const scribe = require('../src/scribe');

let passed = 0;
let total  = 0;

function check(label, actual, expected) {
  total++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
    || (expected === true  && actual)
    || (expected === false && !actual)
    || (typeof expected === 'string' && typeof actual === 'string' && actual.includes(expected));
  if (ok) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    console.log(`❌ ${label}`);
    console.log(`   Expected: ${JSON.stringify(expected)}`);
    console.log(`   Actual:   ${JSON.stringify(actual)}`);
  }
}

// ── Reminder CRUD ─────────────────────────────────────────────────────────────

const id1 = scribe.setReminder('Pick up dry cleaning', '2099-01-01T09:00:00Z', 'OWNER');
check('setReminder returns REM-0001', id1, 'REM-0001');

const reminders = scribe.loadReminders();
check('loadReminders has 1 entry', reminders.length, 1);
check('reminder text correct',    reminders[0].text, 'Pick up dry cleaning');
check('reminder not fired',       reminders[0].fired, false);

const id2 = scribe.setReminder('Call accountant', '2099-06-15T14:00:00Z', 'ADMIN');
check('second reminder is REM-0002', id2, 'REM-0002');
check('loadReminders has 2 entries', scribe.loadReminders().length, 2);

const cancelled = scribe.cancelReminder('REM-0001');
check('cancelReminder returns true',          cancelled, true);
check('loadReminders has 1 entry after cancel', scribe.loadReminders().length, 1);

const notFound = scribe.cancelReminder('REM-9999');
check('cancelReminder non-existent returns false', notFound, false);

// ── getDueReminders ───────────────────────────────────────────────────────────

// Add a past-due reminder
scribe.setReminder('Past due task', '2000-01-01T00:00:00Z', 'OWNER');
const due = scribe.getDueReminders();
check('getDueReminders finds 1 due reminder', due.length, 1);
check('due reminder text correct', due[0].text, 'Past due task');

// ── Log parsing ───────────────────────────────────────────────────────────────

const entries = scribe.readLogEntries();  // may be empty or have real entries
check('readLogEntries returns array', Array.isArray(entries), true);

const stats = scribe.statsFromEntries([]);
check('statsFromEntries empty → total 0',      stats.total,       0);
check('statsFromEntries empty → errors 0',     stats.errors,      0);
check('statsFromEntries empty → escalations 0', stats.escalations, 0);

const fakeEntries = [
  { level: 'INFO',  agent: 'Forge',  model: 'qwen3-coder',      outcome: 'success', escalated: false },
  { level: 'ERROR', agent: 'Scribe', model: 'claude-sonnet-4-6', outcome: 'error',   escalated: true  },
  { level: 'INFO',  agent: 'Forge',  model: 'qwen3-coder',      outcome: 'success', escalated: false },
];
const s2 = scribe.statsFromEntries(fakeEntries);
check('statsFromEntries total = 3',       s2.total,       3);
check('statsFromEntries errors = 1',      s2.errors,      1);
check('statsFromEntries escalations = 1', s2.escalations, 1);
check('statsFromEntries byAgent.Forge = 2', s2.byAgent['Forge'], 2);
check('statsFromEntries byModel qwen3 = 2', s2.byModel['qwen3-coder'], 2);

// ── Report generators (no LLM) ────────────────────────────────────────────────

async function runReportTests() {
  const daily = await scribe.dailySummary({ narrative: false });
  check('dailySummary has report_type',    daily.report_type, 'daily_summary');
  check('dailySummary has content string', typeof daily.content === 'string', true);
  check('dailySummary content has Ghost',  daily.content, 'Ghost');

  const weekly = await scribe.weeklyDigest({ narrative: false });
  check('weeklyDigest has report_type',    weekly.report_type, 'weekly_digest');
  check('weeklyDigest has content string', typeof weekly.content === 'string', true);

  const status = await scribe.statusReport({});
  check('statusReport has report_type',    status.report_type, 'status_report');
  check('statusReport has content string', typeof status.content === 'string', true);
  check('statusReport content has Gateway', status.content, 'Gateway');

  // ── Summary ───────────────────────────────────────────────────────────────────

  console.log(`\n${passed}/${total} passed.`);

  // Restore original reminders file
  if (backup !== null) {
    fs.writeFileSync(REMINDERS_FILE, backup);
  } else {
    fs.unlinkSync(REMINDERS_FILE);
  }

  process.exit(passed === total ? 0 : 1);
}

runReportTests().catch(err => {
  console.error(err.message);
  process.exit(1);
});
