'use strict';

/**
 * Forge API routes
 *
 * POST /api/forge        — run a dev task
 * POST /api/forge/triage — detect escalation model without running (dry-run)
 * POST /api/forge/autofix — fix a specific error with Claude Code CLI
 * POST /api/forge/fix-all — fire-and-forget bulk fix (progress via WS)
 */

const express          = require('express');
const { execSync }     = require('child_process');
const forge            = require('../forge');

const router = express.Router();

// POST /api/forge
router.post('/', async (req, res) => {
  const { task, description, files, context, priority, user_role } = req.body;

  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'description is required.' });
  }

  try {
    const result = await forge.run({
      task:        task        || 'feature',
      description,
      files:       files       || [],
      context:     context     || '',
      priority:    priority    || 'medium',
      user_role:   user_role   || req.user?.username || 'OWNER',
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/forge/autofix — fix a file using Claude Code CLI
router.post('/autofix', async (req, res) => {
  const { errorNote, filePath, agentName, restart } = req.body || {};
  try {
    const result = await forge.autoFixWithClaude({
      errorNote: errorNote || undefined,
      filePath:  filePath  || undefined,
      agentName: agentName || undefined,
    });

    if ((restart !== false) && result.fixed) {
      try { execSync('pm2 restart ghost', { timeout: 15000 }); }
      catch (e) { result.summary += ` (restart failed: ${e.message})`; }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/forge/fix-all — fire-and-forget bulk fix; progress via WebSocket
router.post('/fix-all', async (req, res) => {
  const { errors } = req.body || {};
  if (!Array.isArray(errors) || errors.length === 0) {
    return res.status(400).json({ error: 'errors array required' });
  }

  const capped = errors.slice(0, 20).map(e => ({
    id:        e.id        || String(Date.now() + Math.random()),
    errorNote: e.errorNote || e.note || '',
    agentName: e.agentName || e.agent || '',
    filePath:  e.filePath  || null,
  }));

  // Fire-and-forget — progress comes via WebSocket
  forge.fixAll(capped).catch(err =>
    console.error('[forge/fix-all] fixAll failed:', err.message)
  );

  res.json({ accepted: true, total: capped.length });
});

// POST /api/forge/triage — returns which model would be used, no LLM call
router.post('/triage', (req, res) => {
  const { task, description, files, context } = req.body;
  if (!description) return res.status(400).json({ error: 'description is required.' });

  const { model, reason } = forge.detectModel(
    task        || 'feature',
    description,
    files       || [],
    context     || ''
  );

  res.json({ model, reason, escalated: model !== 'qwen3-coder' });
});

module.exports = router;
