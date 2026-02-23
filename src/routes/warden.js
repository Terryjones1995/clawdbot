'use strict';

/**
 * Warden API routes
 *
 * POST /api/warden/gate        — check/gate an action request
 * GET  /api/warden/pending     — list all pending approvals
 * GET  /api/warden/queue/:id   — get a specific approval item
 * POST /api/warden/resolve/:id — approve or deny a queued item
 */

const express = require('express');
const warden  = require('../warden');

const router = express.Router();

// POST /api/warden/gate
router.post('/gate', async (req, res) => {
  const { requesting_agent, action, user_role, payload, reason } = req.body;

  if (!action) return res.status(400).json({ error: 'action is required.' });

  try {
    const result = await warden.gate({
      requesting_agent: requesting_agent || 'unknown',
      action,
      user_role: user_role || req.user?.username || 'AGENT',
      payload:   payload  || {},
      reason:    reason   || '',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warden/pending
router.get('/pending', (req, res) => {
  try {
    res.json(warden.getPending());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warden/queue/:id
router.get('/queue/:id', (req, res) => {
  const item = warden.getById(req.params.id.toUpperCase());
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json(item);
});

// POST /api/warden/resolve/:id
router.post('/resolve/:id', (req, res) => {
  const { decision, note } = req.body;
  if (!decision || !['approve', 'deny'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approve" or "deny".' });
  }

  const result = warden.resolve(
    req.params.id.toUpperCase(),
    decision,
    req.user?.username || 'OWNER',
    note || ''
  );

  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
});

module.exports = router;
