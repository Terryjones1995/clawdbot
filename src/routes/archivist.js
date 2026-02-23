'use strict';

/**
 * Archivist API routes
 *
 * POST /api/archivist/store    — embed and store content to Pinecone
 * POST /api/archivist/retrieve — semantic search + optional synthesis
 * POST /api/archivist/purge    — delete expired entries (OWNER only)
 * POST /api/archivist/triage   — dry-run: model detection, no Pinecone calls
 */

const express   = require('express');
const archivist = require('../archivist');

const router = express.Router();

// POST /api/archivist/store
// Body: { type, content, tags, ttl_days, source_agent }
router.post('/store', async (req, res) => {
  const {
    type         = 'agent_output',
    content      = '',
    tags         = [],
    ttl_days     = 90,
    source_agent,
  } = req.body;

  if (!content) return res.status(400).json({ error: 'content is required.' });

  try {
    const result = await archivist.store({
      type, content, tags, ttl_days,
      source_agent: source_agent || req.user?.username || 'unknown',
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/archivist/retrieve
// Body: { query, type_filter, top_k, output_format }
router.post('/retrieve', async (req, res) => {
  const {
    query         = '',
    type_filter   = 'all',
    top_k         = 5,
    output_format = 'raw',
  } = req.body;

  if (!query) return res.status(400).json({ error: 'query is required.' });

  const validFormats = ['raw', 'summary'];
  if (!validFormats.includes(output_format)) {
    return res.status(400).json({ error: `output_format must be one of: ${validFormats.join(', ')}` });
  }

  try {
    const result = await archivist.retrieve({ query, type_filter, top_k, output_format });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/archivist/purge
// Warden-gated implicitly — only OWNER should call this.
router.post('/purge', async (req, res) => {
  if (req.user?.role !== 'OWNER') {
    return res.status(403).json({ error: 'Purge requires OWNER role.' });
  }

  const { namespace } = req.body;

  try {
    const result = await archivist.purge({ namespace });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/archivist/triage
// Returns model selection without calling Pinecone or any LLM.
// Body: { action, query, top_k, output_format }
router.post('/triage', (req, res) => {
  const {
    action        = 'retrieve',
    query         = '',
    top_k         = 5,
    output_format = 'raw',
  } = req.body;

  const { model, synthesize, reason } = archivist.detectModel(action, query, top_k, output_format);
  res.json({ model, synthesize, reason, action, top_k, output_format });
});

module.exports = router;
