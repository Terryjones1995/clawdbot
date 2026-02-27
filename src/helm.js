'use strict';

/**
 * Helm — SRE / Deploy Agent
 *
 * Handles:
 *   - System health checks (PM2 status, disk, memory, Redis, Neon)
 *   - Deployment actions (pm2 restart, git pull + restart)
 *   - Log tail / error retrieval
 *   - Automated alerting when errors exceed thresholds
 *
 * Model routing:
 *   - Health checks / status: qwen3-coder (free, local)
 *   - Deploy decisions: Claude Sonnet (safety-sensitive)
 *
 * Usage:
 *   const helm = require('./helm');
 *   const result = await helm.run({ task, context });
 */

const { execSync } = require('child_process');
const fs            = require('fs');
const path          = require('path');
const ollama        = require('../openclaw/skills/ollama');
const redis         = require('./redis');
const db            = require('./db');
const registry      = require('./agentRegistry');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');
const ROOT_DIR = path.join(__dirname, '..');

// ── Logging ───────────────────────────────────────────────────────────────────

function _log(level, action, outcome, note) {
  const entry = `[${level}] ${new Date().toISOString()} | agent=Helm | action=${action} | user_role=system | model=local | outcome=${outcome} | escalated=false | note="${note}"\n`;
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
  db.logEntry({ level, agent: 'Helm', action, outcome, note }).catch(() => {});
}

// ── System health checks ──────────────────────────────────────────────────────

function _pm2Status() {
  try {
    const raw = execSync('pm2 jlist', { timeout: 5000 }).toString();
    const procs = JSON.parse(raw);
    return procs.map(p => ({
      name:   p.name,
      status: p.pm2_env?.status ?? 'unknown',
      pid:    p.pid,
      uptime: p.pm2_env?.pm_uptime ? Math.round((Date.now() - p.pm2_env.pm_uptime) / 1000) : null,
      memory: p.monit?.memory ? Math.round(p.monit.memory / 1024 / 1024) : null,
      cpu:    p.monit?.cpu ?? null,
      restarts: p.pm2_env?.restart_time ?? 0,
    }));
  } catch (err) {
    return [{ name: 'unknown', status: 'error', error: err.message }];
  }
}

function _diskUsage() {
  try {
    const raw = execSync(`df -h ${ROOT_DIR} --output=size,used,avail,pcent`, { timeout: 3000 }).toString();
    const lines = raw.trim().split('\n');
    if (lines.length < 2) return null;
    const [size, used, avail, pcent] = lines[1].trim().split(/\s+/);
    return { size, used, avail, used_pct: parseInt(pcent) };
  } catch { return null; }
}

function _memUsage() {
  try {
    const raw = execSync('free -m', { timeout: 3000 }).toString();
    const line = raw.split('\n').find(l => l.startsWith('Mem:'));
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    return { total_mb: parseInt(parts[1]), used_mb: parseInt(parts[2]), free_mb: parseInt(parts[3]) };
  } catch { return null; }
}

async function _healthSnapshot() {
  const [pm2, disk, mem, redisOk] = await Promise.all([
    Promise.resolve(_pm2Status()),
    Promise.resolve(_diskUsage()),
    Promise.resolve(_memUsage()),
    redis.ping(),
  ]);

  // Recent error count from DB
  let recentErrors = 0;
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*) AS n FROM agent_logs WHERE level = 'ERROR' AND ts > NOW() - INTERVAL '1 hour'`
    );
    recentErrors = parseInt(rows[0]?.n ?? 0);
  } catch { /* non-fatal */ }

  return { pm2, disk, mem, redis: redisOk, recentErrors };
}

// ── Deploy actions (require OWNER role) ───────────────────────────────────────

function _pm2Restart(appName = 'ghost') {
  try {
    execSync(`pm2 restart ${appName}`, { timeout: 15000 });
    return { ok: true, action: `Restarted ${appName}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function _tailLog(lines = 50, which = 'out') {
  const file = path.join(ROOT_DIR, `logs/${which}.log`);
  try {
    const raw  = execSync(`tail -n ${lines} "${file}"`, { timeout: 5000 }).toString();
    return raw;
  } catch { return 'Log unavailable.'; }
}

// ── AI summarisation ──────────────────────────────────────────────────────────

const HELM_SYSTEM = `You are Helm, the SRE and deployment agent for Ghost AI.
You monitor system health, interpret metrics, and give terse, actionable status updates.
Be direct. No fluff. Flag anything abnormal. Recommend specific actions.
Respond with plain text — 3-6 sentences max unless detail is needed.`;

async function _summarise(context, query) {
  const prompt = `System snapshot:\n${JSON.stringify(context, null, 2)}\n\nQuery: ${query}`;
  const { result, escalate } = await ollama.tryChat([
    { role: 'system', content: HELM_SYSTEM },
    { role: 'user',   content: prompt },
  ]);
  if (!escalate && result?.message?.content) return result.message.content.trim();
  return 'Unable to summarise — Ollama unavailable.';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {{ task: string, context?: string, user_role?: string }} req
 */
async function run({ task = '', context = '', user_role = 'AGENT' } = {}) {
  registry.setStatus('helm', 'working');
  _log('INFO', 'run', 'started', `task="${task.slice(0, 80)}"`);

  const text = `${task} ${context}`.toLowerCase();

  try {
    // ── Health / status ──
    if (/status|health|check|how.?is|ping|up|running/i.test(text)) {
      const snap    = await _healthSnapshot();
      const summary = await _summarise(snap, task || 'Give me a full system health summary.');
      _log('INFO', 'health-check', 'success', '');
      return {
        action:  'health_check',
        summary,
        data:    snap,
        model_used: 'qwen3-coder',
      };
    }

    // ── Log tail ──
    if (/log|tail|error.?log|out.?log/i.test(text)) {
      const which = /error/i.test(text) ? 'error' : 'out';
      const n     = parseInt(text.match(/\d+/)?.[0] ?? '50');
      const lines = _tailLog(Math.min(n, 200), which);
      _log('INFO', 'log-tail', 'success', `which=${which} lines=${n}`);
      return {
        action:     'log_tail',
        summary:    lines.slice(-3000),
        model_used: 'none',
      };
    }

    // ── Restart ──
    if (/restart|redeploy|deploy/i.test(text)) {
      if (user_role !== 'OWNER' && user_role !== 'ADMIN') {
        _log('DENY', 'restart', 'denied', 'insufficient role');
        return { action: 'restart', summary: 'Restart requires OWNER or ADMIN role.', model_used: 'none' };
      }
      const app    = /portal/i.test(text) ? 'ghost-portal' : 'ghost';
      const result = _pm2Restart(app);
      _log(result.ok ? 'INFO' : 'ERROR', 'restart', result.ok ? 'success' : 'failed', app);
      return {
        action:     'restart',
        summary:    result.ok ? `✅ ${result.action}` : `❌ Restart failed: ${result.error}`,
        model_used: 'none',
      };
    }

    // ── Generic Ollama Q&A ──
    const snap    = await _healthSnapshot();
    const summary = await _summarise(snap, task);
    _log('INFO', 'query', 'success', '');
    return { action: 'query', summary, data: snap, model_used: 'qwen3-coder' };

  } finally {
    registry.setStatus('helm', 'idle');
  }
}

/**
 * Quick sync health check — used by Lens.systemAlerts().
 * Returns array of alert objects.
 */
async function quickAlerts() {
  const snap   = await _healthSnapshot();
  const alerts = [];

  // PM2 process down
  for (const proc of snap.pm2) {
    if (proc.status !== 'online') {
      alerts.push({ level: 'ERROR', metric: `pm2.${proc.name}`, message: `Process ${proc.name} is ${proc.status}` });
    }
    if ((proc.restarts ?? 0) > 5) {
      alerts.push({ level: 'WARN', metric: `pm2.${proc.name}.restarts`, message: `${proc.name} has restarted ${proc.restarts} times` });
    }
    if ((proc.memory ?? 0) > 400) {
      alerts.push({ level: 'WARN', metric: `pm2.${proc.name}.mem`, message: `${proc.name} using ${proc.memory}MB RAM (threshold: 400MB)` });
    }
  }

  // Disk > 85%
  if (snap.disk?.used_pct > 85) {
    alerts.push({ level: 'WARN', metric: 'disk', message: `Disk ${snap.disk.used_pct}% full (${snap.disk.avail} free)` });
  }

  // Recent errors > 10/h
  if (snap.recentErrors > 10) {
    alerts.push({ level: 'WARN', metric: 'error_rate', message: `${snap.recentErrors} errors in the last hour` });
  }

  // Redis down
  if (!snap.redis) {
    alerts.push({ level: 'WARN', metric: 'redis', message: 'Redis unavailable — fallbacks active' });
  }

  return alerts;
}

module.exports = { run, quickAlerts };
