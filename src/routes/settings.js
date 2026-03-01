'use strict';

const express = require('express');
const db      = require('../db');

const router = express.Router();

// GET /api/settings — all settings
router.get('/', async (req, res) => {
  try {
    const settings = await db.getAllSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[settings] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings — bulk upsert settings
router.put('/', async (req, res) => {
  const body = req.body || {};
  try {
    for (const [key, value] of Object.entries(body)) {
      await db.setSetting(key, value);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[settings] save failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
