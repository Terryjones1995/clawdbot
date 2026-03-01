'use strict';

const express = require('express');
const db      = require('../db');

const router = express.Router();

// GET /api/lessons
router.get('/', async (req, res) => {
  const agent    = req.query.agent    || null;
  const category = req.query.category || null;
  const active   = req.query.active != null ? req.query.active === 'true' : null;
  const limit    = Math.min(parseInt(req.query.limit) || 100, 500);
  try {
    const lessons = await db.getLessons({ agent, category, active, limit });
    return res.json({ lessons, total: lessons.length });
  } catch (err) {
    console.error('[lessons] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/lessons
router.post('/', async (req, res) => {
  const { agent, lesson, category, severity, source, context } = req.body || {};
  if (!agent || !lesson) return res.status(400).json({ error: 'agent and lesson required' });
  try {
    const row = await db.createLesson({ agent, lesson, category, severity, source, context });
    return res.json({ lesson: row });
  } catch (err) {
    console.error('[lessons] create failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/lessons/:id
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const row = await db.updateLesson(id, req.body);
    if (!row) return res.status(404).json({ error: 'not found' });
    return res.json({ lesson: row });
  } catch (err) {
    console.error('[lessons] update failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/lessons/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const ok = await db.deleteLesson(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[lessons] delete failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
