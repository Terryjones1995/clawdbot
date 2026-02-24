'use strict';

const express = require('express');
const keeper  = require('../keeper');

const router = express.Router();

// POST /api/keeper/chat
// Body: { threadId, message }
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
router.get('/history/:threadId', (req, res) => {
  const { threadId } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  res.json(keeper.getHistory(threadId, limit));
});

// GET /api/keeper/threads
router.get('/threads', (req, res) => {
  res.json(keeper.listThreads());
});

// POST /api/keeper/note
// Body: { threadId, note }
router.post('/note', (req, res) => {
  const { threadId, note } = req.body;
  if (!threadId || !note) return res.status(400).json({ error: 'threadId and note required' });
  keeper.addNote(threadId, note);
  res.json({ ok: true });
});

// DELETE /api/keeper/threads/:threadId
router.delete('/threads/:threadId', (req, res) => {
  keeper.clearThread(req.params.threadId);
  res.json({ ok: true });
});

module.exports = router;
