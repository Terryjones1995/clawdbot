'use strict';

/**
 * POST /api/route
 *
 * HTTP wrapper around Switchboard.
 * Accepts a command and returns a routing decision.
 *
 * Body: { source, user_role, message, context }
 * Response: { intent, agent, model, requires_approval, dangerous, escalated, reason }
 */

const express     = require('express');
const switchboard = require('../switchboard');

const router = express.Router();

router.post('/', async (req, res) => {
  const { source, user_role, message, context } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }

  try {
    const decision = await switchboard.classify({
      source:    source    || 'api',
      user_role: user_role || req.user?.username || 'OWNER',
      message,
      context,
    });
    res.json(decision);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
