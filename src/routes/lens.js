'use strict';

/**
 * Lens API routes
 *
 * POST /api/lens/query    — run an analytics query against PostHog
 * POST /api/lens/triage   — dry-run: detect model without making any calls
 * GET  /api/lens/alerts   — check local system alert thresholds
 */

const express = require('express');
const lens    = require('../lens');

const router = express.Router();

// POST /api/lens/query
// Body: { query_type, event, date_range, filters, output_format, custom_sql }
router.post('/query', async (req, res) => {
  const {
    query_type    = 'event_count',
    event         = null,
    date_range    = null,
    filters       = {},
    output_format = 'summary',
    custom_sql    = null,
  } = req.body;

  try {
    const result = await lens.run({ query_type, event, date_range, filters, output_format, custom_sql });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/lens/triage
// Dry-run: returns which model would be used. No PostHog calls made.
// Body: { query_type, output_format, query }
router.post('/triage', (req, res) => {
  const { query_type = 'event_count', output_format = 'summary', query = '' } = req.body;
  const { model, interpret, reason } = lens.detectModel(query_type, output_format, query);
  res.json({ model, interpret, reason, query_type, output_format });
});

// GET /api/lens/alerts
// Check local system thresholds (no PostHog required).
router.get('/alerts', (req, res) => {
  try {
    const alerts = lens.systemAlerts();
    res.json({
      alert_count: alerts.length,
      alerts,
      checked_at:  new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
