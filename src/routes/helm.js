'use strict';

/**
 * Helm API routes
 *
 * GET  /api/helm/health   — system health snapshot (PM2, disk, mem, Redis)
 * POST /api/helm/run      — run a Helm task
 * POST /api/helm/restart  — restart a PM2 app (OWNER/ADMIN only)
 */

const express = require('express');
const helm    = require('../helm');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    const result = await helm.run({ task: 'status', user_role: req.user?.role || 'ADMIN' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/run', async (req, res) => {
  const { task, context } = req.body || {};
  if (!task) return res.status(400).json({ error: 'task is required' });
  try {
    const result = await helm.run({ task, context, user_role: req.user?.role || 'AGENT' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/restart', async (req, res) => {
  const role = req.user?.role || 'AGENT';
  if (role !== 'OWNER' && role !== 'ADMIN') {
    return res.status(403).json({ error: 'Restart requires OWNER or ADMIN role.' });
  }
  const { app = 'ghost' } = req.body || {};
  try {
    const result = await helm.run({ task: `restart ${app}`, user_role: role });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
