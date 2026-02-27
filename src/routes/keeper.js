'use strict';

const express = require('express');
const keeper  = require('../keeper');

const router = express.Router();

// POST /api/keeper/chat
router.post('/chat', async (req, res) => {
  const { threadId, message } = req.body;
  if (!threadId || !message) {
    return res.status(400).json({ error: 'threadId and message are required' });
  }
  try {
    const reply = await keeper.chat(threadId, message);
    res.json({ reply, threadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keeper/history/:threadId?limit=50
router.get('/history/:threadId', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    res.json(await keeper.getHistory(req.params.threadId, limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keeper/threads
router.get('/threads', async (req, res) => {
  try {
    res.json(await keeper.listThreads());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keeper/note
router.post('/note', async (req, res) => {
  const { threadId, note } = req.body;
  if (!threadId || !note) return res.status(400).json({ error: 'threadId and note required' });
  try {
    await keeper.addNote(threadId, note);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/keeper/threads/:threadId
router.delete('/threads/:threadId', async (req, res) => {
  try {
    await keeper.clearThread(req.params.threadId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
