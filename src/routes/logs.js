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

async function _queryLogs({ limit = 100, level = null, agent = null } = {}) {
  let sql    = `SELECT id, ts, level, agent, action, outcome, model, user_role, note FROM agent_logs`;
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

  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  params.push(limit);
  sql += ` ORDER BY ts DESC LIMIT $${params.length}`;

  return db.query(sql, params);
}

// ── /api/logs router ─────────────────────────────────────────────────────────

const router = express.Router();

router.get('/', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const level = req.query.level || null;
  const agent = req.query.agent || null;

  try {
    const { rows } = await _queryLogs({ limit, level, agent });
    return res.json({ logs: rows, total: rows.length });
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
    const { rows } = await _queryLogs({ limit, level: 'ERROR', agent });
    return res.json({ errors: rows, total: rows.length });
  } catch (err) {
    console.error('[errors] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = { router, errorsRouter };
