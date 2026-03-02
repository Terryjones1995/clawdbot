'use strict';

const express = require('express');
const db      = require('../db');
const ollama  = require('../../openclaw/skills/ollama');

const router = express.Router();

// GET /api/training — list knowledge entries from ghost_memory
router.get('/', async (req, res) => {
  const category = req.query.category || null;
  const source   = req.query.source   || null;
  const limit    = Math.min(parseInt(req.query.limit) || 200, 500);

  try {
    let sql = 'SELECT id, key, content, category, source, thread_id, created_at, updated_at FROM ghost_memory';
    const conditions = [];
    const params     = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (source) {
      params.push(source);
      conditions.push(`source = $${params.length}`);
    }

    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    params.push(limit);
    sql += ` LIMIT $${params.length}`;

    const { rows } = await db.query(sql, params);

    // Get distinct categories and sources for filter dropdowns
    const catRes = await db.query('SELECT DISTINCT category FROM ghost_memory ORDER BY category');
    const srcRes = await db.query('SELECT DISTINCT source FROM ghost_memory ORDER BY source');

    return res.json({
      entries:    rows,
      total:      rows.length,
      categories: catRes.rows.map(r => r.category),
      sources:    srcRes.rows.map(r => r.source),
    });
  } catch (err) {
    console.error('[training] query failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/training — add knowledge entry
router.post('/', async (req, res) => {
  const { key, content, category } = req.body || {};
  if (!content) return res.status(400).json({ error: 'content is required' });

  // Auto-generate key if not provided
  const slug = key || `training:${category || 'general'}:${Date.now()}`;

  try {
    // Generate embedding via Ollama
    let embedding = null;
    try {
      embedding = await ollama.embed(content);
    } catch { /* embeddings unavailable — store without */ }

    await db.storeFact({
      key:      slug,
      content,
      category: category || 'general',
      source:   'training',
      embedding,
    });

    // Fetch the stored entry to return it
    const { rows } = await db.query(
      'SELECT id, key, content, category, source, created_at, updated_at FROM ghost_memory WHERE key = $1',
      [slug],
    );

    return res.json({ entry: rows[0] || { key: slug, content, category } });
  } catch (err) {
    console.error('[training] create failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/training/bulk — add multiple knowledge entries at once
router.post('/bulk', async (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries) || !entries.length) {
    return res.status(400).json({ error: 'entries array is required' });
  }

  let stored = 0;
  const errors = [];

  for (const entry of entries) {
    if (!entry.content) { errors.push('Empty content'); continue; }

    const slug = entry.key || `training:${entry.category || 'general'}:${Date.now()}-${stored}`;

    try {
      let embedding = null;
      try { embedding = await ollama.embed(entry.content); } catch { /* non-fatal */ }

      await db.storeFact({
        key:      slug,
        content:  entry.content,
        category: entry.category || 'general',
        source:   'training',
        embedding,
      });
      stored++;
    } catch (err) {
      errors.push(`${slug}: ${err.message}`);
    }
  }

  return res.json({ stored, total: entries.length, errors: errors.length ? errors : undefined });
});

// PATCH /api/training/:id — update a knowledge entry
router.patch('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  const { content, category } = req.body || {};
  if (!content && !category) return res.status(400).json({ error: 'nothing to update' });

  try {
    const setClauses = [];
    const params     = [];

    if (content) {
      params.push(content);
      setClauses.push(`content = $${params.length}`);

      // Re-generate embedding if content changed
      try {
        const embedding = await ollama.embed(content);
        if (embedding) {
          const embStr = `[${embedding.join(',')}]`;
          params.push(embStr);
          setClauses.push(`embedding = $${params.length}::vector`);
        }
      } catch { /* non-fatal */ }
    }

    if (category) {
      params.push(category);
      setClauses.push(`category = $${params.length}`);
    }

    setClauses.push('updated_at = NOW()');
    params.push(id);

    const { rowCount } = await db.query(
      `UPDATE ghost_memory SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
      params,
    );

    if (!rowCount) return res.status(404).json({ error: 'not found' });

    const { rows } = await db.query(
      'SELECT id, key, content, category, source, created_at, updated_at FROM ghost_memory WHERE id = $1',
      [id],
    );

    return res.json({ entry: rows[0] });
  } catch (err) {
    console.error('[training] update failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/training/:id — delete a knowledge entry
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'invalid id' });

  try {
    const { rowCount } = await db.query('DELETE FROM ghost_memory WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[training] delete failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
