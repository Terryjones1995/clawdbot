'use strict';

/**
 * Ticket Monitor — real-time ticket channel monitoring.
 *
 * Watches the platform DB for new tickets and monitors their Discord channels
 * for user messages, responding with AI-generated replies using live DB data.
 *
 * Two polling loops:
 *   1. Ticket poller (60s)  — detects new platform tickets, sends proactive response
 *   2. Channel poller (20s) — checks active ticket channels for new user messages
 */

const leagueDb = require('./skills/league-db');
const deepseek = require('./skills/deepseek');
const memory   = require('./skills/memory');
const learning = require('./skills/learning');
const db       = require('./db');
const registry = require('./agentRegistry');

const BOT_ID = process.env.DISCORD_APP_ID || '';

// Active ticket channels: channelId → { guildId, ticketId, ticketNumber, lastMessageId, subject, type, orgId, lastAiResponseAt }
const _channels = new Map();
let _lastTicketPoll = new Date().toISOString();
let _broadcast = () => {}; // set by init()
const AI_COOLDOWN = 2 * 60 * 1000; // 2 min between AI responses per channel
let _polling = false;
let _ticketPolling = false;
let _intervalTickets = null;
let _intervalMessages = null;
let _intervalRefresh = null;

// ── Discord REST helpers ──────────────────────────────────────────────────────

async function discordApi(method, path, body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const opts = {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://discord.com/api/v10${path}`, opts);
  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
    console.warn(`[TicketMonitor] Discord 429 on ${method} ${path} (retry-after: ${retryAfter}s)`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return fetch(`https://discord.com/api/v10${path}`, opts); // one retry
  }
  return res;
}

async function getChannelMessages(channelId, afterId, limit = 10) {
  const qs = afterId ? `?after=${afterId}&limit=${limit}` : `?limit=${limit}`;
  const res = await discordApi('GET', `/channels/${channelId}/messages${qs}`);
  if (!res.ok) return null;
  return res.json();
}

async function sendMessage(channelId, content) {
  const res = await discordApi('POST', `/channels/${channelId}/messages`, { content });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[TicketMonitor] Send failed (${channelId}): ${res.status} ${err}`);
    return null;
  }
  return res.json();
}

async function sendTyping(channelId) {
  await discordApi('POST', `/channels/${channelId}/typing`).catch(() => {});
}

// ── Channel registration ──────────────────────────────────────────────────────

function registerChannel(ticket) {
  if (!ticket.channelId) return;
  if (_channels.has(ticket.channelId)) return; // already monitored
  _channels.set(ticket.channelId, {
    guildId:       ticket.guildId,
    ticketId:      ticket.id,
    ticketNumber:  ticket.number || ticket.ticketNumber,
    subject:       ticket.subject,
    type:          ticket.type,
    orgId:         ticket.organizationId,
    userId:        ticket.userId,
    lastMessageId: null, // will be set on first poll
    lastAiResponseAt: Date.now(), // grace period — let OpenClaw handle initial response
  });
}

function unregisterChannel(channelId) {
  _channels.delete(channelId);
}

// ── Handle user message in ticket channel ─────────────────────────────────────

async function handleUserMessage(channelId, message, channelData) {
  // Cooldown: max one AI response per channel per 2 min
  if (channelData.lastAiResponseAt && (Date.now() - channelData.lastAiResponseAt) < AI_COOLDOWN) return;

  // Get fresh ticket data from platform DB
  const ticket = await leagueDb.getTicket(channelData.ticketId).catch(() => null);

  const contextParts = [];

  // Ticket info
  if (ticket) {
    contextParts.push(`Ticket #${ticket.number}: ${ticket.subject}`);
    contextParts.push(`Type: ${ticket.type} | Status: ${ticket.status} | League: ${ticket.league}`);
    if (ticket.description && ticket.description !== '....') {
      contextParts.push(`Description: ${ticket.description}`);
    }
    // Player profile (from the ticket JOIN)
    if (ticket.gamertag) {
      const profile = [`Player: ${ticket.gamertag} (${ticket.playerConsole || '?'})`];
      profile.push(`MMR: ${ticket.playerMmr || 0} | Rank: ${ticket.playerRank || 'Unranked'}`);
      if (ticket.playerRecord) profile.push(`Record: ${ticket.playerRecord}`);
      if (ticket.playerTeam) profile.push(`Team: ${ticket.playerTeam}`);
      contextParts.push(`\nPlayer profile:\n${profile.join('\n')}`);
    }
    // Match context
    if (ticket.matchId) {
      const matchCtx = await leagueDb.getMatchContext(ticket.matchId).catch(() => null);
      if (matchCtx) contextParts.push(`\nLinked match:\n${matchCtx}`);
    }
  } else {
    contextParts.push(`Ticket channel (ticket #${channelData.ticketNumber}): ${channelData.subject}`);
  }

  // Recent channel messages for conversation context
  const recentMsgs = await getChannelMessages(channelId, null, 20);
  if (recentMsgs?.length) {
    const convo = recentMsgs.reverse().map(m => {
      const author = m.author?.username || 'unknown';
      const isBot = m.author?.bot ? ' [BOT]' : '';
      let text = m.content || '';
      if (m.attachments?.length) {
        const attachDesc = m.attachments.map(a => {
          const type = a.content_type?.startsWith('image/') ? 'Image' : 'File';
          return `[${type}: ${a.filename}]`;
        }).join(' ');
        text += (text ? ' ' : '') + attachDesc;
      }
      if (m.embeds?.length) {
        const embedText = m.embeds
          .map(e => [e.title, e.description].filter(Boolean).join(': '))
          .filter(Boolean).join(' | ');
        if (embedText) text += (text ? '\n' : '') + '[Embed] ' + embedText;
      }
      return `${author}${isBot}: ${text}`;
    }).filter(l => l.split(': ').slice(1).join(': ').trim()).join('\n');
    if (convo) contextParts.push(`\nConversation history:\n${convo}`);
  }

  // Memory + lessons
  const userText = message.content || '';
  const [facts, lessons] = await Promise.all([
    memory.getRelevantFacts(userText, 30).catch(() => null),
    learning.getRelevantLessons('ghost', userText, 15).catch(() => null),
  ]);
  if (facts) contextParts.push(`\nRelevant knowledge:\n${facts}`);
  if (lessons) contextParts.push(`\nPast corrections:\n${lessons}`);

  const dateStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });

  const systemPrompt = [
    'You are Ghost, a professional AI support agent for an NBA 2K esports league Discord server.',
    `Current date/time: ${dateStr}`,
    'You are responding in a ticket channel. Read the conversation history carefully.',
    'Respond to the latest message from the user. Be helpful, specific, and concise (1-3 sentences).',
    'If you have player/match data, use it to give informed answers.',
    'If a human admin needs to handle this, say so clearly.',
    'ALWAYS respond in English. Never narrate or explain what you\'re doing.',
    '',
    contextParts.join('\n'),
  ].join('\n');

  try {
    await sendTyping(channelId);
    const reply = await deepseek.chat(systemPrompt, userText, 1024);

    if (reply === '(no response)' || !reply?.trim()) return;

    const sent = await sendMessage(channelId, reply);
    if (sent) {
      const ch = _channels.get(channelId);
      if (ch) {
        ch.lastMessageId = sent.id;
        ch.lastAiResponseAt = Date.now();
      }

      // Log + store memory + detect corrections (non-blocking)
      db.logEntry({
        level: 'INFO', agent: 'ghost', action: 'ticket:reply',
        outcome: 'sent',
        note: `Ticket #${channelData.ticketNumber}: replied to ${message.author?.username || 'user'}`,
      }).catch(() => {});
      memory.extractAndStore(userText, reply, channelId).catch(() => {});
      // Detect user corrections of Ghost's previous reply (if any)
      if (recentMsgs?.length) {
        // Find the most recent bot message (recentMsgs is oldest-first after .reverse())
        const prevBotMsg = [...recentMsgs].reverse().find(m => m.author?.bot && m.author?.id === BOT_ID);
        if (prevBotMsg?.content) {
          memory.detectAndStoreCorrection(userText, prevBotMsg.content, channelId).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error(`[TicketMonitor] Reply failed in ${channelId}:`, err.message);
  }
}

// ── Polling loops ─────────────────────────────────────────────────────────────

/**
 * Check platform DB for new tickets (runs every 60s).
 */
async function pollNewTickets() {
  if (_ticketPolling) return;
  _ticketPolling = true;
  try {
    const newTickets = await leagueDb.getNewTicketsSince(_lastTicketPoll);
    if (!newTickets.length) return;

    _lastTicketPoll = new Date().toISOString();

    for (const ticket of newTickets) {
      console.log(`[TicketMonitor] New ${ticket.type} ticket #${ticket.number} [${ticket.league}]: ${ticket.subject}`);

      // Log + broadcast
      db.logEntry({
        level: 'INFO', agent: 'ghost', action: 'ticket:new',
        outcome: 'detected',
        note: `#${ticket.number} [${ticket.league}] ${ticket.type}: ${ticket.subject} (by ${ticket.gamertag || ticket.discordUsername || 'unknown'})`,
      }).catch(() => {});

      _broadcast({ type: 'ticket:new', ticket });
      registry.pushEvent('ghost', `New ticket #${ticket.number} [${ticket.league}]: ${ticket.subject}`, 'info');

      // Register channel for follow-up monitoring only.
      // OpenClaw handles the initial greeting when Ghost is @mentioned in the ticket channel.
      // Sending a proactive response here would cause duplicate replies.
      registerChannel(ticket);
    }
  } catch (err) {
    console.error('[TicketMonitor] pollNewTickets failed:', err.message);
  } finally { _ticketPolling = false; }
}

/**
 * Check active ticket channels for new user messages (runs every 20s).
 */
async function pollChannelMessages() {
  if (_polling) return;
  _polling = true;
  try {
    if (!_channels.size) return;

    for (const [channelId, data] of _channels) {
      try {
        // Get messages after our last known message
        const messages = data.lastMessageId
          ? await getChannelMessages(channelId, data.lastMessageId, 5)
          : await getChannelMessages(channelId, null, 1); // first poll — just get latest to seed

        // null = channel deleted/forbidden (not just empty)
        if (messages === null) {
          if (!data._failures) data._failures = 0;
          data._failures++;
          if (data._failures >= 3) {
            console.log(`[TicketMonitor] Removing inaccessible channel ${channelId}`);
            _channels.delete(channelId);
          }
          continue;
        }

        if (!messages.length) continue;

        data._failures = 0;

        // First poll (seeding) — just record the latest message ID
        if (!data.lastMessageId) {
          data.lastMessageId = messages[0].id; // messages are newest-first from Discord
          continue;
        }

        // Update lastMessageId to newest before reversing (Discord returns newest-first)
        data.lastMessageId = messages.reduce((max, m) =>
          BigInt(m.id) > BigInt(max) ? m.id : max, data.lastMessageId);

        // Process new messages (reverse to oldest-first for processing)
        const userMessages = messages
          .reverse()
          .filter(m => {
            if (m.author?.bot) return false;
            if (m.mentions?.some(u => u.id === BOT_ID)) return false;
            if (m.mention_everyone) return false;
            return true;
          });

        if (!userMessages.length) continue;

        // Respond to the latest user message (batch — don't respond to each individually)
        const latestUserMsg = userMessages[userMessages.length - 1];
        await handleUserMessage(channelId, latestUserMsg, data);

      } catch (err) {
        // Channel might be deleted or inaccessible — remove after 3 failures
        if (!data._failures) data._failures = 0;
        data._failures++;
        if (data._failures >= 3) {
          console.log(`[TicketMonitor] Removing channel ${channelId} after 3 failures`);
          _channels.delete(channelId);
        }
      }
    }
  } finally { _polling = false; }
}

/**
 * Refresh the channel list — remove closed tickets, add newly opened ones.
 * Runs every 5 minutes.
 */
async function refreshChannels() {
  try {
    const openTickets = await leagueDb.getOpenTickets();
    const openChannelIds = new Set(openTickets.filter(t => t.channelId).map(t => t.channelId));

    // Remove channels for closed tickets
    for (const [channelId] of _channels) {
      if (!openChannelIds.has(channelId)) {
        console.log(`[TicketMonitor] Ticket closed, removing channel ${channelId}`);
        _channels.delete(channelId);
      }
    }

    // Add any open tickets we're not monitoring yet
    for (const ticket of openTickets) {
      if (ticket.channelId && !_channels.has(ticket.channelId)) {
        registerChannel(ticket);
      }
    }

    console.log(`[TicketMonitor] Monitoring ${_channels.size} ticket channels`);
  } catch (err) {
    console.error('[TicketMonitor] Refresh failed:', err.message);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init(broadcastFn) {
  _broadcast = broadcastFn || _broadcast;

  // Load all open tickets and register their channels
  try {
    const openTickets = await leagueDb.getOpenTickets();
    for (const ticket of openTickets) {
      registerChannel(ticket);
    }
    console.log(`[TicketMonitor] Initialized — monitoring ${_channels.size} ticket channels`);
  } catch (err) {
    console.error('[TicketMonitor] Init failed:', err.message);
  }

  // Start polling loops
  _intervalTickets  = setInterval(pollNewTickets, 60_000);      // new tickets every 60s
  _intervalMessages = setInterval(pollChannelMessages, 20_000); // channel messages every 20s
  _intervalRefresh  = setInterval(refreshChannels, 5 * 60_000); // refresh channel list every 5min

  // First polls
  setTimeout(pollNewTickets, 10_000);       // first ticket poll 10s after boot
  setTimeout(pollChannelMessages, 15_000);  // first message poll 15s after boot
}

function stop() {
  if (_intervalTickets)  { clearInterval(_intervalTickets);  _intervalTickets  = null; }
  if (_intervalMessages) { clearInterval(_intervalMessages); _intervalMessages = null; }
  if (_intervalRefresh)  { clearInterval(_intervalRefresh);  _intervalRefresh  = null; }
}

module.exports = {
  init, stop, registerChannel, unregisterChannel,
  pollNewTickets, pollChannelMessages,
  get activeChannels() { return _channels.size; },
};
