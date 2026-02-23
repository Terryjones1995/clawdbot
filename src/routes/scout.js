'use strict';

/**
 * Scout API routes
 *
 * POST /api/scout/research   — run a research query
 * POST /api/scout/triage     — dry-run: detect model without making LLM calls
 */

const express = require('express');
const scout   = require('../scout');

const router = express.Router();

// POST /api/scout/research
// Body: { query, type, depth, store_result }
router.post('/research', async (req, res) => {
  const { query, type = 'factual', depth = 'quick', store_result = false } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'query is required.' });
  }

  const validTypes  = ['web', 'trend', 'factual', 'competitive'];
  const validDepths = ['quick', 'deep'];

  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  if (!validDepths.includes(depth)) {
    return res.status(400).json({ error: `depth must be one of: ${validDepths.join(', ')}` });
  }

  try {
    const result = await scout.run({ query, type, depth, store_result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scout/triage
// Dry-run: returns which model would be used without calling any LLM.
// Body: { query, type, depth }
router.post('/triage', (req, res) => {
  const { query = '', type = 'factual', depth = 'quick' } = req.body;
  const { model, grok, reason } = scout.detectModel(type, depth, query);
  res.json({ model, grok, reason, type, depth });
});

module.exports = router;
