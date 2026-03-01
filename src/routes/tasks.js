'use strict';

const express = require('express');
const db      = require('../db');

const router = express.Router();

// GET /api/tasks
router.get('/', async (req, res) => {
  const status   = req.query.status   || null;
  const agent_id = req.query.agent_id || null;
  try {
    const tasks = await db.getTasks({ status, agent_id });
    return res.json({ tasks, total: tasks.length });
  } catch (err) {
    console.error('[tasks] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  const { title, description, status, priority, agent_id } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    const task = await db.createTask({ title, description, status, priority, agent_id });
    return res.json({ task });
  } catch (err) {
    console.error('[tasks] create failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const task = await db.updateTask(id, req.body);
    if (!task) return res.status(404).json({ error: 'not found' });
    return res.json({ task });
  } catch (err) {
    console.error('[tasks] update failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  try {
    const ok = await db.deleteTask(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[tasks] delete failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
