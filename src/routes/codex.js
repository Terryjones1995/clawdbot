'use strict';

const express = require('express');
const router  = express.Router();
const codex   = require('../codex');

/**
 * POST /api/codex/ask
 * Answer a player or admin question using the HOF League knowledge base.
 *
 * Body: { question, org_name?, context?, code_search? }
 */
router.post('/ask', async (req, res) => {
  const { question, org_name, context, code_search } = req.body ?? {};
  if (!question) return res.status(400).json({ error: 'question is required' });

  try {
    const result = await codex.answer({ question, org_name, context, code_search });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/codex/search
 * Search source files for a keyword — admin/dev use.
 *
 * Body: { keyword, maxResults? }
 */
router.post('/search', async (req, res) => {
  const { keyword, maxResults } = req.body ?? {};
  if (!keyword) return res.status(400).json({ error: 'keyword is required' });

  try {
    const results = codex.searchCode(keyword, maxResults ?? 5);
    res.json({ keyword, results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/codex/reload
 * Reload the knowledge base cache after updating JSON files.
 */
router.post('/reload', (req, res) => {
  try {
    codex.reloadKnowledgeBase();
    res.json({ reloaded: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
