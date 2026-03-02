'use strict';

const express      = require('express');
const discordAdmin = require('../discordAdminHandler');

const router = express.Router();

// POST /api/admin/action — parse and execute a Discord admin command
router.post('/action', async (req, res) => {
  const { text, userRole, guildId } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const reply = await discordAdmin.run(text, userRole || 'ADMIN', guildId || null);
    return res.json({ reply });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
