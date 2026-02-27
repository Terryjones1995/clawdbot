'use strict';

/**
 * Discord API routes:
 *   GET  /api/discord/guilds           — live guild data for all servers
 *   GET  /api/discord/admins           — list portal-managed bot admins
 *   POST /api/discord/admins           — add a bot admin by Discord user ID
 *   DELETE /api/discord/admins/:userId — remove a bot admin
 */

const express   = require('express');
const discord   = require('../../openclaw/skills/discord');
const db        = require('../db');
const botAdmins = require('../botAdmins');

const router = express.Router();

// ── Guilds ────────────────────────────────────────────────────────────────────

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

// ── Portal-managed Bot Admins ─────────────────────────────────────────────────

/** GET /api/discord/admins — list all portal admins */
router.get('/admins', async (req, res) => {
  try {
    const admins = await db.listBotAdmins();
    // Try to enrich with Discord username if bot is connected
    const enriched = await Promise.all(admins.map(async (a) => {
      if (discord.ready) {
        try {
          const user = await discord.client.users.fetch(a.user_id);
          return { ...a, discord_tag: user.tag };
        } catch { /* user not found — return as-is */ }
      }
      return { ...a, discord_tag: a.username ?? null };
    }));
    return res.json({ admins: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /api/discord/admins — add a bot admin */
router.post('/admins', async (req, res) => {
  const { userId, username } = req.body || {};
  if (!userId || !/^\d{17,20}$/.test(userId)) {
    return res.status(400).json({ error: 'userId must be a valid Discord snowflake (17-20 digit number).' });
  }
  try {
    // Try to resolve username from Discord
    let resolvedTag = username || null;
    if (discord.ready && !resolvedTag) {
      try {
        const user = await discord.client.users.fetch(userId);
        resolvedTag = user.tag;
      } catch { /* not resolvable — store as-is */ }
    }
    await db.addBotAdmin(userId, resolvedTag, req.user?.username || 'portal');
    await botAdmins.add(userId);
    return res.json({ ok: true, userId, username: resolvedTag });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/discord/admins/:userId — remove a bot admin */
router.delete('/admins/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    await db.removeBotAdmin(userId);
    await botAdmins.remove(userId);
    return res.json({ ok: true, userId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
