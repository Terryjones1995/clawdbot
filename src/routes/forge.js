'use strict';

/**
 * Forge API routes
 *
 * POST /api/forge        — run a dev task
 * POST /api/forge/triage — detect escalation model without running (dry-run)
 */

const express = require('express');
const forge   = require('../forge');

const router = express.Router();

// POST /api/forge
router.post('/', async (req, res) => {
  const { task, description, files, context, priority, user_role } = req.body;

  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'description is required.' });
  }

  try {
    const result = await forge.run({
      task:        task        || 'feature',
      description,
      files:       files       || [],
      context:     context     || '',
      priority:    priority    || 'medium',
      user_role:   user_role   || req.user?.username || 'OWNER',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/forge/triage — returns which model would be used, no LLM call
router.post('/triage', (req, res) => {
  const { task, description, files, context } = req.body;
  if (!description) return res.status(400).json({ error: 'description is required.' });

  const { model, reason } = forge.detectModel(
    task        || 'feature',
    description,
    files       || [],
    context     || ''
  );

  res.json({ model, reason, escalated: model !== 'qwen3-coder' });
});

module.exports = router;
