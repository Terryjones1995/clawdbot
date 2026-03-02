'use strict';

/**
 * Logs and Errors API routes
 *
 * GET /api/logs          — recent entries from agent_logs
 * GET /api/logs?level=   — filter by level: INFO|WARN|ERROR
 * GET /api/logs?agent=   — filter by agent name
 *
 * GET /api/errors        — ERROR-level entries only
 */

const express = require('express');
const db      = require('../db');

async function _queryLogs({ limit = 100, offset = 0, level = null, agent = null, action = null } = {}) {
  const params = [];
  const where  = [];

  if (level) {
    params.push(level.toUpperCase());
    where.push(`level = $${params.length}`);
  }
  if (agent) {
    params.push(agent);
    where.push(`LOWER(agent) = LOWER($${params.length})`);
  }
  if (action) {
    params.push(action.toLowerCase());
    where.push(`LOWER(action) = $${params.length}`);
  }

  const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const countParams = params.slice();
  const rowParams   = [...params, limit, offset];

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS cnt FROM agent_logs${whereClause}`, countParams),
    db.query(
      `SELECT id, ts, level, agent, action, outcome, model, user_role, note
       FROM agent_logs${whereClause}
       ORDER BY ts DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      rowParams,
    ),
  ]);

  return { rows: rowsRes.rows, total: countRes.rows[0]?.cnt ?? 0 };
}

// ── /api/logs router ─────────────────────────────────────────────────────────

const router = express.Router();

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 25, 500);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const level  = req.query.level  || null;
  const agent  = req.query.agent  || null;
  const action = req.query.action || null;

  try {
    const { rows, total } = await _queryLogs({ limit, offset, level, agent, action });
    return res.json({ logs: rows, total, limit, offset });
  } catch (err) {
    console.error('[logs] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── /api/errors router ───────────────────────────────────────────────────────

const errorsRouter = express.Router();

errorsRouter.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const agent = req.query.agent || null;

  try {
    const { rows, total } = await _queryLogs({ limit, level: 'ERROR', agent });
    return res.json({ errors: rows, total });
  } catch (err) {
    console.error('[errors] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/errors/resolve — manually mark an error as fixed by recording a repair log
errorsRouter.post('/resolve', async (req, res) => {
  const { filePath, agentName } = req.body || {};
  if (!filePath && !agentName) {
    return res.status(400).json({ error: 'filePath or agentName required' });
  }

  const file = filePath || (() => {
    const map = {
      sentinel: 'src/sentinel.js', scout: 'src/scout.js', scribe: 'src/scribe.js',
      forge: 'src/forge.js', helm: 'src/helm.js', lens: 'src/lens.js',
      keeper: 'src/keeper.js', warden: 'src/warden.js', archivist: 'src/archivist.js',
      courier: 'src/courier.js', ghost: 'src/routes/reception.js',
      switchboard: 'src/switchboard.js',
    };
    return map[(agentName || '').toLowerCase()] || null;
  })();

  if (!file) return res.status(400).json({ error: 'cannot determine file from agentName' });

  try {
    await db.logEntry({
      level:   'INFO',
      agent:   'Forge',
      action:  'autofix-claude',
      outcome: 'fixed',
      model:   'manual',
      note:    `file=${file}`,
    });
    return res.json({ ok: true, file });
  } catch (err) {
    console.error('[errors/resolve] failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { router, errorsRouter };
