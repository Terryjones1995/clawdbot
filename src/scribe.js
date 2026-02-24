'use strict';

/**
 * Scribe — Ops / Summaries / Reminders / Scheduler
 *
 * Reads memory/run_log.md and memory/reminders.json.
 * Generates daily briefings, weekly digests, on-demand status reports.
 * Fires reminders via Discord DM to OWNER.
 * Schedules itself: daily 08:00 UTC briefing, Monday weekly digest.
 *
 * Usage:
 *   const scribe = require('./scribe');
 *   scribe.start();                            // boot scheduler
 *   await scribe.dailySummary();               // on-demand
 *   const id = scribe.setReminder(text, iso);  // schedule reminder
 */

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const ollama    = require('../openclaw/skills/ollama');
const warden    = require('./warden');

const LOG_FILE       = path.join(__dirname, '../memory/run_log.md');
const REMINDERS_FILE = path.join(__dirname, '../memory/reminders.json');

// ── Log parser ────────────────────────────────────────────────────────────────

const LOG_LINE_RE = /^\[(\w+)\]\s+(\S+)\s+\|\s+agent=(\S+)\s+\|\s+action=(\S+)\s+\|\s+user_role=(\S+)\s+\|\s+model=(\S+)\s+\|\s+outcome=(\S+)\s+\|\s+escalated=(\S+)\s+\|\s+note="(.*)"/;

function parseLogLine(line) {
  const m = line.match(LOG_LINE_RE);
  if (!m) return null;
  return {
    level:     m[1],
    timestamp: m[2],
    date:      m[2].slice(0, 10),
    agent:     m[3],
    action:    m[4],
    user_role: m[5],
    model:     m[6],
    outcome:   m[7],
    escalated: m[8] === 'true',
    note:      m[9],
  };
}

function readLogEntries({ fromDate, toDate, agentFilter } = {}) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines   = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
  const entries = lines.map(parseLogLine).filter(Boolean);

  return entries.filter(e => {
    if (fromDate && e.date < fromDate) return false;
    if (toDate   && e.date > toDate)   return false;
    if (agentFilter && e.agent !== agentFilter) return false;
    return true;
  });
}

function statsFromEntries(entries) {
  const byAgent     = {};
  const byLevel     = {};
  const byModel     = {};
  let escalations   = 0;

  for (const e of entries) {
    byAgent[e.agent] = (byAgent[e.agent] || 0) + 1;
    byLevel[e.level] = (byLevel[e.level] || 0) + 1;
    byModel[e.model] = (byModel[e.model] || 0) + 1;
    if (e.escalated) escalations++;
  }

  return {
    total: entries.length,
    escalations,
    errors:    byLevel.ERROR   || 0,
    warnings:  byLevel.WARN    || 0,
    approvals: byLevel.APPROVE || 0,
    denials:   byLevel.DENY    || 0,
    blocks:    byLevel.BLOCK   || 0,
    byAgent,
    byModel,
  };
}

// ── Reminder store ────────────────────────────────────────────────────────────

function loadReminders() {
  if (!fs.existsSync(REMINDERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8')); }
  catch { return []; }
}

function saveReminders(reminders) {
  fs.mkdirSync(path.dirname(REMINDERS_FILE), { recursive: true });
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
}

function nextReminderId() {
  const reminders = loadReminders();
  const max = reminders.reduce((m, r) => {
    const n = parseInt((r.id || 'REM-0000').split('-')[1], 10);
    return Math.max(m, n);
  }, 0);
  return `REM-${String(max + 1).padStart(4, '0')}`;
}

function setReminder(text, dueAt, userRole = 'OWNER') {
  if (!text || !dueAt) throw new Error('text and dueAt are required');
  const due = new Date(dueAt);
  if (isNaN(due.getTime())) throw new Error('dueAt must be a valid ISO8601 date');

  const reminders = loadReminders();
  const id = nextReminderId();
  reminders.push({
    id,
    text,
    due_at:     due.toISOString(),
    created_at: new Date().toISOString(),
    user_role:  userRole,
    fired:      false,
  });
  saveReminders(reminders);
  appendLog('INFO', 'reminder-set', userRole, 'success', `id=${id} due=${due.toISOString()}`);
  return id;
}

function cancelReminder(id) {
  const reminders = loadReminders();
  const idx = reminders.findIndex(r => r.id === id);
  if (idx === -1) return false;
  reminders.splice(idx, 1);
  saveReminders(reminders);
  appendLog('INFO', 'reminder-cancel', 'OWNER', 'success', `id=${id}`);
  return true;
}

function getDueReminders() {
  const now = new Date();
  return loadReminders().filter(r => !r.fired && new Date(r.due_at) <= now);
}

function markFired(id) {
  const reminders = loadReminders();
  const r = reminders.find(r => r.id === id);
  if (r) { r.fired = true; r.fired_at = new Date().toISOString(); }
  saveReminders(reminders);
}

// ── LLM synthesis (optional escalation) ──────────────────────────────────────

async function synthesise(prompt, escalate = false) {
  if (!escalate) {
    // Template-based: just return the prompt as-is (already formatted)
    return prompt;
  }

  // Escalate to Claude Sonnet for narrative quality
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return prompt; // fallback to template

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: 'You are Scribe, the ops agent for the Ghost AI system. You\'re calm, organized, and reliable — the kind of person who keeps everything running without drama. Rewrite the following operational report into a concise, readable summary. Keep it under 400 words. Plain text, no markdown headers.',
    messages: [{ role: 'user', content: prompt }],
  });
  return res.content[0]?.text || prompt;
}

// ── Report generators ─────────────────────────────────────────────────────────

async function dailySummary({ date, narrative = false } = {}) {
  const target   = date || new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const fromDate = date || yesterday;

  const entries  = readLogEntries({ fromDate, toDate: fromDate });
  const stats    = statsFromEntries(entries);
  const pending  = warden.getPending();
  const reminders = loadReminders().filter(r =>
    !r.fired && r.due_at.slice(0, 10) <= target
  );

  const agentLines = Object.entries(stats.byAgent)
    .sort((a, b) => b[1] - a[1])
    .map(([agent, count]) => `  • ${agent}: ${count}`)
    .join('\n') || '  • (none)';

  const pendingLines = pending.length
    ? pending.map(p => `  • \`${p.id}\` — ${p.requesting_agent} → \`${p.action}\``).join('\n')
    : '  • None';

  const reminderLines = reminders.length
    ? reminders.map(r => `  • ${r.due_at.slice(11, 16)} UTC — ${r.text}`).join('\n')
    : '  • None due';

  const template = [
    `**Ghost Daily Briefing — ${fromDate}**`,
    '',
    `**Activity (${stats.total} actions)**`,
    agentLines,
    stats.escalations ? `  ⬆️ ${stats.escalations} escalation(s)` : '',
    stats.errors      ? `  ❌ ${stats.errors} error(s)` : '',
    '',
    `**Pending Approvals (${pending.length})**`,
    pendingLines,
    '',
    `**Reminders**`,
    reminderLines,
  ].filter(l => l !== undefined).join('\n');

  const content = await synthesise(template, narrative || stats.total > 100);

  appendLog('INFO', 'daily-summary', 'system', 'success', `date=${fromDate} entries=${stats.total}`);
  return { report_type: 'daily_summary', content, date: fromDate, logged: true };
}

async function weeklyDigest({ weekStart, narrative = false } = {}) {
  const now   = new Date();
  const start = weekStart || new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const end   = now.toISOString().slice(0, 10);

  const entries = readLogEntries({ fromDate: start, toDate: end });
  const stats   = statsFromEntries(entries);

  const agentLines = Object.entries(stats.byAgent)
    .sort((a, b) => b[1] - a[1])
    .map(([agent, count]) => `  • ${agent}: ${count} actions`)
    .join('\n') || '  • (none)';

  const modelLines = Object.entries(stats.byModel)
    .sort((a, b) => b[1] - a[1])
    .map(([model, count]) => `  • ${model}: ${count}`)
    .join('\n') || '  • (none)';

  const template = [
    `**Ghost Weekly Digest — ${start} → ${end}**`,
    '',
    `**Total Actions: ${stats.total}**`,
    agentLines,
    '',
    `**Model Usage**`,
    modelLines,
    '',
    `**Quality**`,
    `  • Escalations: ${stats.escalations}`,
    `  • Errors: ${stats.errors}`,
    `  • Approvals: ${stats.approvals}  |  Denials: ${stats.denials}  |  Blocks: ${stats.blocks}`,
  ].join('\n');

  const content = await synthesise(template, narrative);

  appendLog('INFO', 'weekly-digest', 'system', 'success', `week=${start} entries=${stats.total}`);
  return { report_type: 'weekly_digest', content, week_start: start, logged: true };
}

async function statusReport({ agentFilter } = {}) {
  const today   = new Date().toISOString().slice(0, 10);
  const entries = readLogEntries({ fromDate: today, agentFilter });
  const stats   = statsFromEntries(entries);
  const pending = warden.getPending();

  const port    = process.env.OPENCLAW_PORT || 18789;
  const content = [
    `**Ghost Status Report — ${new Date().toISOString()}**`,
    `Gateway: \`http://localhost:${port}\` ✅`,
    '',
    `**Today so far (${stats.total} actions)**`,
    `  Errors: ${stats.errors} | Escalations: ${stats.escalations} | Blocks: ${stats.blocks}`,
    '',
    `**Pending Approvals: ${pending.length}**`,
    pending.length
      ? pending.map(p => `  • \`${p.id}\` — ${p.requesting_agent} → \`${p.action}\``).join('\n')
      : '  • None',
  ].join('\n');

  appendLog('INFO', 'status-report', 'system', 'success', `entries_today=${stats.total}`);
  return { report_type: 'status_report', content, logged: true };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _schedulerStarted = false;

function start() {
  if (_schedulerStarted) return;
  _schedulerStarted = true;

  console.log('[Scribe] Scheduler started (tick: 60s)');

  setInterval(async () => {
    const now    = new Date();
    const hour   = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const day    = now.getUTCDay(); // 0=Sun, 1=Mon

    // Fire due reminders
    for (const reminder of getDueReminders()) {
      await _deliverToDiscord(`⏰ **Reminder** \`${reminder.id}\`\n${reminder.text}`);
      markFired(reminder.id);
      appendLog('INFO', 'reminder-fired', 'system', 'success', `id=${reminder.id}`);
    }

    // Daily briefing at 08:00 UTC
    if (hour === 8 && minute === 0) {
      const report = await dailySummary();
      await _deliverToDiscord(report.content);

      // Weekly digest on Mondays
      if (day === 1) {
        const digest = await weeklyDigest();
        await _deliverToDiscord(digest.content);
      }
    }
  }, 60_000);
}

async function _deliverToDiscord(content) {
  try {
    const discord   = require('../openclaw/skills/discord');
    const heartbeat = require('./heartbeat');
    if (!discord.ready) return;
    heartbeat.pulse();
    await discord.dmOwner(content);
  } catch { /* Discord may not be connected */ }
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Scribe',
    `| action=${action}`,
    `| user_role=${userRole}`,
    '| model=qwen3-coder',
    `| outcome=${outcome}`,
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = {
  start,
  dailySummary,
  weeklyDigest,
  statusReport,
  setReminder,
  cancelReminder,
  loadReminders,
  getDueReminders,
  readLogEntries,
  statsFromEntries,
};
