'use strict';

/**
 * Scribe API routes
 *
 * POST /api/scribe/report           — generate a report on demand
 * POST /api/scribe/reminder         — set a reminder
 * GET  /api/scribe/reminders        — list all reminders
 * DELETE /api/scribe/reminder/:id   — cancel a reminder
 */

const express = require('express');
const scribe  = require('../scribe');

const router = express.Router();

// POST /api/scribe/report
// Body: { task: "daily_summary|weekly_digest|status_report", params: { date_range, agent_filter, narrative } }
router.post('/report', async (req, res) => {
  const { task = 'status_report', params = {} } = req.body;

  try {
    let report;

    switch (task) {
      case 'daily_summary':
        report = await scribe.dailySummary({
          date:      params.date_range  || null,
          narrative: params.narrative   || false,
        });
        break;

      case 'weekly_digest':
        report = await scribe.weeklyDigest({
          weekStart: params.week_start  || null,
          narrative: params.narrative   || false,
        });
        break;

      case 'status_report':
        report = await scribe.statusReport({
          agentFilter: params.agent_filter || null,
        });
        break;

      default:
        return res.status(400).json({ error: `Unknown task: ${task}. Use daily_summary, weekly_digest, or status_report.` });
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scribe/reminder
// Body: { text, due_at (ISO8601) }
router.post('/reminder', (req, res) => {
  const { text, due_at } = req.body;
  if (!text || !due_at) {
    return res.status(400).json({ error: 'text and due_at are required.' });
  }

  try {
    const id = scribe.setReminder(text, due_at, req.user?.username || 'OWNER');
    res.status(201).json({ id, text, due_at, fired: false });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/scribe/reminders
router.get('/reminders', (req, res) => {
  const { fired } = req.query;
  let reminders = scribe.loadReminders();
  if (fired === 'false') reminders = reminders.filter(r => !r.fired);
  if (fired === 'true')  reminders = reminders.filter(r =>  r.fired);
  res.json(reminders);
});

// DELETE /api/scribe/reminder/:id
router.delete('/reminder/:id', (req, res) => {
  const ok = scribe.cancelReminder(req.params.id.toUpperCase());
  if (!ok) return res.status(404).json({ error: 'Reminder not found.' });
  res.json({ ok: true, id: req.params.id.toUpperCase() });
});

// GET /api/scribe/brief — daily summary for portal Overview
router.get('/brief', async (req, res) => {
  try {
    const summary = await scribe.dailySummary({ narrative: false });
    res.json({
      briefing: summary.content || 'No briefing available.',
      period:   summary.date   || new Date().toISOString().slice(0, 10),
      ts:       new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
