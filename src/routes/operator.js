'use strict';

const express  = require('express');
const router   = express.Router();
const operator = require('../operator');

/**
 * POST /api/operator/run
 * Run a complex task by dispatching sub-agents in parallel.
 *
 * Body:
 *   { task, context?, workers?, dry_run? }
 */
router.post('/run', async (req, res) => {
  const { task, context, workers, dry_run } = req.body ?? {};
  if (!task) return res.status(400).json({ error: 'task is required' });

  try {
    const result = await operator.run({ task, context, workers, dry_run });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/operator/plan
 * Dry-run only — returns the decomposed sub-task plan without executing.
 *
 * Body:
 *   { task, context? }
 */
router.post('/plan', async (req, res) => {
  const { task, context } = req.body ?? {};
  if (!task) return res.status(400).json({ error: 'task is required' });

  try {
    const subtasks = await operator.decompose(task, context);
    res.json({ task, subtasks, worker_count: subtasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
