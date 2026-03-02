'use strict';

const express    = require('express');
const directives = require('../skills/directives');
const db         = require('../db');

const router = express.Router();

// POST /api/directives/check — check message against auto-action rules
router.post('/check', async (req, res) => {
  const { guildId, content, hasAttachments } = req.body || {};
  if (!guildId) return res.status(400).json({ error: 'guildId required' });

  try {
    const match = await directives.checkMessage(guildId, null, null, content || '', !!hasAttachments);
    return res.json({ match: match || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/directives/execute — execute a matched directive action
router.post('/execute', async (req, res) => {
  const { directiveId, event } = req.body || {};
  if (!directiveId || !event) return res.status(400).json({ error: 'directiveId and event required' });

  try {
    // Fetch the directive from DB
    const { rows } = await db.query('SELECT * FROM admin_directives WHERE id = $1', [directiveId]);
    if (!rows.length) return res.status(404).json({ error: 'directive not found' });

    await directives.executeAction(rows[0], event);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/directives/teach — extract and store a new directive from admin instruction
router.post('/teach', async (req, res) => {
  const { guildId, adminId, adminName, text } = req.body || {};
  if (!guildId || !text) return res.status(400).json({ error: 'guildId and text required' });

  try {
    const extracted = await directives.extractDirective(text);
    if (!extracted) {
      return res.json({ ok: false, error: "Couldn't parse that into a clear rule. Try: when someone says X, warn them" });
    }

    const rule = await directives.storeDirective({ guildId, adminId, adminName, extracted });
    return res.json({ ok: true, rule, extracted });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/directives/manage — list/remove/disable/enable rules
router.post('/manage', async (req, res) => {
  const { text, adminId, userRole, guildId } = req.body || {};
  if (!text || !guildId) return res.status(400).json({ error: 'text and guildId required' });

  try {
    const reply = await directives.handleManageCommand(text, adminId, userRole || 'ADMIN', guildId);
    return res.json({ reply });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
