'use strict';

/**
 * GET /api/jobs
 *
 * Returns recent agent activity from agent_logs as "jobs".
 *
 * Query params:
 *   limit  {number}  max results (default: 10)
 *   offset {number}  pagination offset (default: 0)
 *   status {string}  filter by status: running|completed|failed (optional)
 *   agent  {string}  filter by agent name (optional)
 */

const express = require('express');
const db      = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit)  || 10, 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
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
      where.push(`outcome IN ('success', 'sent', 'drafted', 'stored', 'completed', 'fixed', 'no-fix', 'received')`);
    } else if (status === 'running') {
      where.push(`outcome = 'running'`);
    }

    const whereClause = where.length ? ` WHERE ${where.join(' AND ')}` : '';

    // Get total count and paginated rows in parallel
    const countParams = params.slice();
    const rowParams   = [...params, limit, offset];
    const limitIdx    = rowParams.length - 1;
    const offsetIdx   = rowParams.length;

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

    const total = countRes.rows[0]?.cnt ?? 0;
    const jobs = rowsRes.rows.map(r => ({
      id:      String(r.id),
      agent:   r.agent,
      action:  r.action,
      outcome: r.outcome || '',
      level:   r.level || 'INFO',
      status:  mapOutcomeToStatus(r.level, r.outcome),
      model:   r.model || null,
      ts:      r.ts,
      note:    r.note || '',
    }));

    return res.json({ jobs, total, limit, offset });
  } catch (err) {
    console.error('[jobs] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function mapOutcomeToStatus(level, outcome) {
  if (level === 'ERROR') return 'failed';
  if (outcome === 'running' || outcome === 'working') return 'running';
  if (['success', 'sent', 'drafted', 'stored', 'completed', 'queued', 'fixed', 'received'].includes(outcome)) return 'completed';
  if (outcome === 'failed' || outcome === 'denied') return 'failed';
  return 'completed';
}

module.exports = router;
