'use strict';

const express = require('express');
const db      = require('../db');

const router = express.Router();

// GET /api/credits — aggregated usage stats by provider
router.get('/', async (req, res) => {
  const period = req.query.period || 'all';
  try {
    const stats = await db.getApiUsageStats({ period });
    return res.json({ providers: stats, period });
  } catch (err) {
    console.error('[credits] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/credits/recent — recent individual API calls
router.get('/recent', async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const period = req.query.period || 'all';
  try {
    const calls = await db.getApiUsageRecent({ limit, period });
    return res.json({ calls, total: calls.length });
  } catch (err) {
    console.error('[credits/recent] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
