'use strict';

/**
 * GET /api/jobs
 *
 * Returns recent agent activity from agent_logs as "jobs".
 * Maps log entries where action != 'chat' to structured job records.
 *
 * Query params:
 *   limit  {number}  max results (default: 50)
 *   status {string}  filter by status: running|completed|failed (optional)
 *   agent  {string}  filter by agent name (optional)
 */

const express = require('express');
const db      = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const status = req.query.status || null;
  const agent  = req.query.agent  || null;

  try {
    const params = [];
    const where  = [];

    if (agent) {
      params.push(agent);
      where.push(`LOWER(agent) = LOWER($${params.length})`);
    }

    if (status === 'failed') {
      where.push(`(level = 'ERROR' OR outcome = 'failed')`);
    } else if (status === 'completed') {
      where.push(`outcome IN ('success', 'sent', 'drafted', 'stored', 'completed')`);
    } else if (status === 'running') {
      where.push(`outcome = 'running'`);
    }

    const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    // Get total count and limited rows in parallel
    const countParams = params.slice();
    const rowParams   = [...params, limit];
    const [countRes, rowsRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS cnt FROM agent_logs${whereClause}`, countParams),
      db.query(`SELECT id, ts, level, agent, action, outcome, model, user_role, note FROM agent_logs${whereClause} ORDER BY ts DESC LIMIT $${rowParams.length}`, rowParams),
    ]);

    const total = countRes.rows[0]?.cnt ?? 0;
    const jobs = rowsRes.rows.map(r => ({
      id:     String(r.id),
      agent:  r.agent,
      action: r.action,
      status: mapOutcomeToStatus(r.level, r.outcome),
      model:  r.model || 'unknown',
      ts:     r.ts,
      note:   r.note || '',
    }));

    return res.json({ jobs, total });
  } catch (err) {
    console.error('[jobs] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function mapOutcomeToStatus(level, outcome) {
  if (level === 'ERROR') return 'failed';
  if (outcome === 'running' || outcome === 'working') return 'running';
  if (['success', 'sent', 'drafted', 'stored', 'completed', 'queued'].includes(outcome)) return 'completed';
  if (outcome === 'failed' || outcome === 'denied') return 'failed';
  return 'completed';
}

module.exports = router;
