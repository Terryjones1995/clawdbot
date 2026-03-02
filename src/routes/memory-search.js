'use strict';

const express = require('express');
const memory  = require('../skills/memory');
const ollama  = require('../../openclaw/skills/ollama');
const db      = require('../db');

const router = express.Router();

// POST /api/memory/search — semantic search for relevant facts
router.post('/search', async (req, res) => {
  const { query, limit } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });

  try {
    const facts = await memory.getRelevantFacts(query, limit || 15);
    const count = facts ? facts.split('\n').filter(l => l.startsWith('•')).length : 0;
    return res.json({ facts, count });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/store — store a new fact
router.post('/store', async (req, res) => {
  const { key, content, category, source } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content required' });

  const slug = key || `${category || 'misc'}:${Date.now()}`;

  try {
    let embedding = null;
    try { embedding = await ollama.embed(content); } catch { /* non-fatal */ }

    await db.storeFact({
      key:      slug,
      content,
      category: category || 'misc',
      source:   source || 'openclaw',
      embedding,
    });

    return res.json({ ok: true, key: slug });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/memory/extract — extract facts from a conversation exchange
router.post('/extract', async (req, res) => {
  const { userMessage, reply, threadId } = req.body || {};
  if (!userMessage || !reply) return res.status(400).json({ error: 'userMessage and reply required' });

  // Run non-blocking
  memory.extractAndStore(userMessage, reply, threadId || 'openclaw').catch(() => {});
  return res.json({ ok: true, status: 'processing' });
});

// GET /api/memory/stats — memory health stats
router.get('/stats', async (req, res) => {
  try {
    const stats = await memory.getMemoryStats();
    res.json({ ok: true, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/memory/prune — run memory cleanup
router.post('/prune', async (req, res) => {
  try {
    const results = await memory.pruneMemory();
    res.json({ ok: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
