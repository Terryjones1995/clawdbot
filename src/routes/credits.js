'use strict';

const express = require('express');
const db      = require('../db');

const router = express.Router();

// ── API key status cache (5 min TTL) ──────────────────────────────────────────
let _statusCache = null;
let _statusCacheTs = 0;
const STATUS_TTL = 5 * 60 * 1000;

// GET /api/credits/status — live API key health check for each provider
router.get('/status', async (req, res) => {
  const now = Date.now();
  if (_statusCache && now - _statusCacheTs < STATUS_TTL) {
    return res.json(_statusCache);
  }

  const status = {
    ollama:    { active: false, error: null },
    deepseek:  { active: false, error: null },
    openai:    { active: false, error: null },
    anthropic: { active: false, error: null },
    xai:       { active: false, error: null },
  };

  // Check Ollama
  try {
    const r = await fetch(`${process.env.OLLAMA_HOST || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(3000) });
    status.ollama.active = r.ok;
    if (!r.ok) status.ollama.error = `HTTP ${r.status}`;
  } catch (e) { status.ollama.error = 'Offline'; }

  // Check DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const r = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        status.deepseek.active = true;
      } else {
        const body = await r.json().catch(() => ({}));
        status.deepseek.error = body?.error?.message || `HTTP ${r.status}`;
      }
    } catch (e) { status.deepseek.error = e.message; }
  } else { status.deepseek.error = 'No API key'; }

  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        status.openai.active = true;
      } else {
        const body = await r.json().catch(() => ({}));
        status.openai.error = body?.error?.message || `HTTP ${r.status}`;
      }
    } catch (e) { status.openai.error = e.message; }
  } else { status.openai.error = 'No API key'; }

  // Check Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        status.anthropic.active = true;
      } else {
        const body = await r.json().catch(() => ({}));
        const msg = body?.error?.message || `HTTP ${r.status}`;
        status.anthropic.active = false;
        status.anthropic.error = msg.includes('credit balance') ? 'No credits remaining' : msg;
      }
    } catch (e) { status.anthropic.error = e.message; }
  } else { status.anthropic.error = 'No API key'; }

  // Check xAI / Grok
  if (process.env.GROK_API_KEY) {
    try {
      const r = await fetch('https://api.x.ai/v1/api-key', {
        headers: { Authorization: `Bearer ${process.env.GROK_API_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        status.xai.active = !body.api_key_blocked && !body.api_key_disabled;
        if (body.api_key_blocked) status.xai.error = 'Key blocked';
        if (body.api_key_disabled) status.xai.error = 'Key disabled';
      } else {
        status.xai.error = `HTTP ${r.status}`;
      }
    } catch (e) { status.xai.error = e.message; }
  } else { status.xai.error = 'No API key'; }

  _statusCache = { status, checked_at: new Date().toISOString() };
  _statusCacheTs = now;
  return res.json(_statusCache);
});

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
