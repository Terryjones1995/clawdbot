'use strict';

/**
 * GET /api/discord/guilds
 *
 * Returns live guild data for all servers Ghost is in.
 * Used by the portal Servers page.
 *
 * Response:
 *   { guilds: DiscordGuild[] }
 *
 * DiscordGuild:
 *   { id, name, icon, memberCount, botJoinedAt, isPrimary, channels[], roles[], features[] }
 */

const express = require('express');
const discord = require('../../openclaw/skills/discord');

const router = express.Router();

router.get('/guilds', async (req, res) => {
  try {
    if (!discord.ready) {
      return res.json({ guilds: [], status: 'disconnected' });
    }
    const guilds = await discord.listGuilds();
    return res.json({ guilds, status: 'ok' });
  } catch (err) {
    console.error('[Discord route] listGuilds error:', err.message);
    return res.status(500).json({ guilds: [], error: err.message });
  }
});

module.exports = router;
