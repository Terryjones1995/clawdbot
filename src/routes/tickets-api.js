'use strict';

const express   = require('express');
const https     = require('https');
const db        = require('../db');
const discord   = require('../../openclaw/skills/discord');
const leagueApi = require('../skills/league-api');

const router = express.Router();

// ── Vision helper (extracted from sentinel.js) ─────────────────────────────

function _openaiVisionRequest(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('OPENAI_API_KEY not set'));

    const bodyStr = JSON.stringify({ model: 'gpt-4o', messages, max_tokens: 1024 });
    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return reject(new Error(`OpenAI vision error: ${json.error.message}`));
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (e) { reject(new Error(`OpenAI vision parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('OpenAI vision timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ── Ticket channel detection ────────────────────────────────────────────────

function _looksLikeTicketName(name) {
  if (!name) return false;
  const clean = name.replace(/[^\w\s-]/g, '').trim().toLowerCase();
  return /ticket|support|open-a-ticket/.test(clean);
}

async function _isTicketChannel(channelId) {
  try {
    const info = await discord.getChannelInfo(channelId);
    if (!info) return false;
    return _looksLikeTicketName(info.name) || _looksLikeTicketName(info.parentName);
  } catch { return false; }
}

// GET /api/tickets/detect/:channelId — is this a ticket channel?
router.get('/detect/:channelId', async (req, res) => {
  try {
    const isTicket = await _isTicketChannel(req.params.channelId);
    return res.json({ isTicket });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/context/:channelId — full ticket context with vision + league data
router.get('/context/:channelId', async (req, res) => {
  const { channelId } = req.params;
  const guildId = req.query.guildId || null;

  try {
    const isTicket = await _isTicketChannel(channelId);
    if (!isTicket) return res.json({ isTicket: false, context: null });

    const history = await discord.fetchChannelHistory(channelId, 50);
    if (!history.length) return res.json({ isTicket: true, context: null });

    // Collect image URLs for vision analysis
    const imageUrls = [];
    for (const msg of history) {
      const images = (msg.attachments || []).filter(a => a.contentType?.startsWith('image/'));
      for (const img of images) {
        imageUrls.push({ url: img.url, author: msg.author });
      }
    }

    // Vision analysis on ticket images
    let visionContext = '';
    if (imageUrls.length > 0) {
      try {
        const userContent = [
          { type: 'text', text: 'Describe each image in detail. Include all text, numbers, scores, stats, team names, player names, and any other relevant information you can read. Be thorough — this is evidence in a support ticket.' },
          ...imageUrls.map(img => ({ type: 'image_url', image_url: { url: img.url, detail: 'high' } })),
        ];
        const desc = await _openaiVisionRequest([{ role: 'user', content: userContent }]);
        if (desc) {
          visionContext = `\n\n[IMAGE ANALYSIS — ${imageUrls.length} screenshot(s) from ticket]:\n${desc}`;
        }
      } catch (err) {
        console.warn('[Tickets API] Vision failed:', err.message);
      }
    }

    // Build text context
    const lines = [];
    for (const msg of history) {
      for (const embed of msg.embeds) {
        if (embed.title || embed.description) {
          lines.push(`[EMBED from ${msg.author}]${embed.title ? ' ' + embed.title : ''}`);
          if (embed.description) lines.push(embed.description);
          for (const field of embed.fields) lines.push(`${field.name}: ${field.value}`);
        }
      }
      const images = (msg.attachments || []).filter(a => a.contentType?.startsWith('image/'));
      if (images.length > 0) lines.push(`[${msg.author} posted ${images.length} image(s)]`);
      if (msg.content) lines.push(`${msg.isBot ? '[BOT] ' : ''}${msg.author}: ${msg.content}`);
    }

    let context = '[TICKET CHANNEL]\n' + lines.join('\n').slice(0, 4000) + visionContext;

    // Fetch live league data for the guild
    const leagueKey = guildId ? leagueApi.leagueFromGuild(guildId) : null;
    if (leagueKey) {
      try {
        const [eventsResult, statsResult] = await Promise.all([
          leagueApi.query(leagueKey, 'events'),
          leagueApi.query(leagueKey, 'home-stats'),
        ]);
        if (eventsResult.data || eventsResult.formatted) {
          const formatted = eventsResult.formatted || leagueApi.formatResults('events', [eventsResult]);
          const label = eventsResult.cached ? 'CACHED LEAGUE DATA' : 'LIVE LEAGUE DATA';
          context += `\n\n[${label} — Events from ${eventsResult.league} website]:\n${formatted}`;
        }
        if (statsResult.data || statsResult.formatted) {
          const formatted = statsResult.formatted || leagueApi.formatResults('home-stats', [statsResult]);
          context += `\n\n[League Stats]:\n${formatted}`;
        }
      } catch { /* non-fatal */ }
    }

    return res.json({ isTicket: true, context });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets/close — close a ticket (save transcript, send embed, delete channel)
router.post('/close', async (req, res) => {
  const { channelId, guildId, userId } = req.body || {};
  if (!channelId) return res.status(400).json({ error: 'channelId required' });

  try {
    const { EmbedBuilder } = require('discord.js');

    await discord.sendMessage(channelId, '*Saving and closing ticket...*');

    const history = await discord.fetchChannelHistory(channelId, 100);
    const info    = await discord.getChannelInfo(channelId);
    const opener  = history.find(m => !m.isBot);

    // Build summary
    const summaryLines = history.map(m => {
      const parts = [];
      for (const embed of m.embeds) {
        if (embed.title || embed.description) {
          parts.push(`[EMBED] ${embed.title || ''}: ${(embed.description || '').slice(0, 200)}`);
        }
      }
      if (m.content) parts.push(`${m.author}: ${m.content}`);
      return parts.join('\n');
    }).filter(Boolean);
    const summaryText = summaryLines.join('\n').slice(0, 3000);

    // Save and close
    await db.upsertTicket({
      channelId,
      guildId,
      openerId:     opener?.authorId,
      openerName:   opener?.author,
      categoryName: info?.parentName,
      transcript:   history,
    });
    await db.closeTicket(channelId, history, summaryText);

    // Send closing embed
    await discord.sendMessage(channelId, {
      embeds: [new EmbedBuilder()
        .setTitle('Ticket Closed')
        .setDescription(`This ticket has been closed${userId ? ` by <@${userId}>` : ''}. The channel will be deleted in 60 seconds.`)
        .setColor(0x2ECC71)
        .setTimestamp()
      ],
    });

    // Delete after 60 seconds
    setTimeout(() => {
      discord.closeChannel(channelId).catch(() => {});
    }, 60_000);

    db.logEntry({
      level: 'INFO', agent: 'Tickets', action: 'ticket-closed',
      outcome: 'success', note: `channel=${channelId} guild=${guildId}`,
    }).catch(() => {});

    return res.json({ ok: true, message: 'Ticket closed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets/save-transcript — save current ticket state
router.post('/save-transcript', async (req, res) => {
  const { channelId, guildId } = req.body || {};
  if (!channelId) return res.status(400).json({ error: 'channelId required' });

  try {
    const history = await discord.fetchChannelHistory(channelId, 100);
    const info    = await discord.getChannelInfo(channelId);
    const opener  = history.find(m => !m.isBot);

    await db.upsertTicket({
      channelId,
      guildId,
      openerId:     opener?.authorId,
      openerName:   opener?.author,
      categoryName: info?.parentName,
      transcript:   history,
    });

    return res.json({ ok: true, messages: history.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
