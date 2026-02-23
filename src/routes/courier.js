'use strict';

/**
 * Courier API routes
 *
 * POST /api/courier/send    — run a courier action (send, draft, list_manage)
 * POST /api/courier/triage  — dry-run: detect model + warden requirement
 */

const express = require('express');
const courier = require('../courier');

const router = express.Router();

// POST /api/courier/send
// Body: { action, to, subject, body_text, template_id, schedule_at, operation, list_id, emails }
router.post('/send', async (req, res) => {
  const {
    action      = 'send_transactional',
    to          = [],
    subject     = '',
    body_text   = '',
    template_id = null,
    schedule_at = null,
    operation   = null,
    list_id     = null,
    emails      = [],
  } = req.body;

  // Inject caller's role from their JWT session
  const user_role = req.user?.role || 'AGENT';

  try {
    const result = await courier.run({
      action, to, subject, body_text, template_id,
      schedule_at, user_role, operation, list_id, emails,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/courier/triage
// Returns model selection + warden requirement without making any external calls.
// Body: { action, to, subject, body_text }
router.post('/triage', (req, res) => {
  const { action = 'send_transactional', to = [], subject = '', body_text = '' } = req.body;

  const { model, draft, reason } = courier.detectModel(action, to, subject, body_text);

  const ALWAYS_GATED = ['send_campaign', 'list_manage'];
  const bulk = Array.isArray(to) && to.length > 1;
  const warden_required = ALWAYS_GATED.includes(action) || (action === 'send_transactional' && bulk);

  res.json({ model, draft, reason, action, warden_required, recipient_count: to.length });
});

module.exports = router;
