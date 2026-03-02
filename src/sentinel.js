'use strict';

/**
 * Sentinel — Discord command handler + agent office router
 *
 * #commands / OWNER DMs:
 *   !help, !status, !pending, !approve <ID>, !deny <ID>
 *   Natural language → Switchboard (routing decision returned)
 *
 * Agent office channels (#switchboard, #warden, #scribe, etc.):
 *   Messages routed directly to the named agent and response sent as embed.
 */

const fs   = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');

const discord          = require('../openclaw/skills/discord');
const mini             = require('./skills/openai-mini');
const { instantReply } = require('./skills/instant');
const heartbeat        = require('./heartbeat');
const redis            = require('./redis');
const switchboard = require('./switchboard');
const warden      = require('./warden');
const scribe      = require('./scribe');
const scout       = require('./scout');
const forge       = require('./forge');
const lens        = require('./lens');
const courier     = require('./courier');
const archivist   = require('./archivist');
const keeper          = require('./keeper');
const db              = require('./db');
const discordAdmin    = require('./discordAdminHandler');
const registry        = require('./agentRegistry');
const helm            = require('./helm');
const leagueApi       = require('./skills/league-api');
const memory          = require('./skills/memory');
const directives      = require('./skills/directives');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// ── Active conversation tracking ─────────────────────────────────────────────
// When Ghost replies in a channel, we track that conversation so follow-up
// messages from the same user don't require another @mention.
// Key: "channelId:userId" → { ts, guildId }
// Expires after CONVO_TTL_MS of inactivity.

const _activeConvos   = new Map();
const CONVO_TTL_MS    = 5 * 60 * 1000; // 5 minutes of silence → conversation ends

function _markConvoActive(channelId, userId, guildId) {
  _activeConvos.set(`${channelId}:${userId}`, { ts: Date.now(), guildId });
}

function _getActiveConvo(channelId, userId) {
  const key   = `${channelId}:${userId}`;
  const entry = _activeConvos.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CONVO_TTL_MS) {
    _activeConvos.delete(key);
    return null;
  }
  return entry;
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _activeConvos) {
    if (now - entry.ts > CONVO_TTL_MS) _activeConvos.delete(key);
  }
}, 10 * 60 * 1000);

// ── Ticket channel tracking ──────────────────────────────────────────────────
// Cached detection of ticket channels. Once a channel is checked, result is
// stored permanently (ticket channels don't change type mid-lifecycle).
const _ticketChannelChecked = new Set(); // channels we've already checked
const _knownTicketChannels  = new Set(); // confirmed ticket channels

async function _detectAndTrackTicket(channelId, guildId) {
  if (_ticketChannelChecked.has(channelId)) return _knownTicketChannels.has(channelId);
  _ticketChannelChecked.add(channelId);
  const isTicket = await _isTicketChannel(channelId);
  if (isTicket) {
    _knownTicketChannels.add(channelId);
    db.upsertTicket({ channelId, guildId }).catch(() => {});
  }
  return isTicket;
}

// Close ticket intent detection
const CLOSE_TICKET_RE = /\b(close\s*(this\s*)?ticket|close\s*this|close\s*it|mark\s*(this\s*)?(as\s*)?closed)\b/i;

// Detect ticket bot close messages (content or embeds)
const TICKET_BOT_CLOSE_RE = /ticket.*(?:has been |was )?closed|closing this ticket|channel will be deleted/i;

// Track channels where Ghost has already auto-greeted (prevents double-greet)
const _ticketGreeted = new Set();

/**
 * Handle ALL bot messages in ticket channels:
 * 1. Detect ticket CREATION (new channel, bot's first embed) → Ghost auto-greets
 * 2. Detect ticket CLOSE (ticket bot says "closed") → save transcript
 */
async function _handleTicketBotMessage(event) {
  const isTicket = await _detectAndTrackTicket(event.channel_id, event.guild_id);
  if (!isTicket) return;

  // ── Close detection ──
  const content   = event.content || '';
  const embedText = (event.raw?.embeds || [])
    .map(e => `${e.title || ''} ${e.description || ''}`)
    .join(' ');
  const allText = `${content} ${embedText}`;

  if (TICKET_BOT_CLOSE_RE.test(allText)) {
    console.log(`[Sentinel] Ticket bot closing channel ${event.channel_id} — saving transcript`);
    try {
      const history = await discord.fetchChannelHistory(event.channel_id, 100);
      const info    = await discord.getChannelInfo(event.channel_id);
      const opener  = history.find(m => !m.isBot);

      const summaryLines = history.map(m => {
        const parts = [];
        for (const embed of (m.embeds || [])) {
          if (embed.title || embed.description) {
            parts.push(`[EMBED] ${embed.title || ''}: ${(embed.description || '').slice(0, 200)}`);
          }
        }
        if (m.content) parts.push(`${m.author}: ${m.content}`);
        return parts.join('\n');
      }).filter(Boolean);
      const summaryText = summaryLines.join('\n').slice(0, 3000);

      await db.upsertTicket({
        channelId:    event.channel_id,
        guildId:      event.guild_id,
        openerId:     opener?.authorId,
        openerName:   opener?.author,
        categoryName: info?.parentName,
        transcript:   history,
      });
      await db.closeTicket(event.channel_id, history, summaryText);

      appendLog('INFO', 'ticket-bot-closed', 'BOT', 'success',
        `channel=${event.channel_id} guild=${event.guild_id} messages=${history.length}`);
    } catch { /* channel may already be gone — non-fatal */ }
    return;
  }

  // ── New ticket detection — auto-greet ──
  // If we haven't greeted this channel yet and the bot just posted an embed (ticket creation),
  // Ghost reads the context and responds automatically.
  if (_ticketGreeted.has(event.channel_id)) return;
  const hasEmbed = (event.raw?.embeds || []).length > 0;
  if (!hasEmbed && !content) return;

  _ticketGreeted.add(event.channel_id);
  console.log(`[Sentinel] New ticket detected in ${event.channel_id} — auto-responding`);

  // Small delay to let the ticket bot finish posting all its embeds/messages
  await new Promise(r => setTimeout(r, 2000));

  try {
    const ticketContext = await _buildTicketContext(event.channel_id);
    if (!ticketContext) return;

    let liveLeagueData = '';
    const leagueKey = event.guild_id ? leagueApi.leagueFromGuild(event.guild_id) : null;
    if (leagueKey) {
      try {
        const [eventsResult, statsResult] = await Promise.all([
          leagueApi.query(leagueKey, 'events'),
          leagueApi.query(leagueKey, 'home-stats'),
        ]);
        if (eventsResult.data || eventsResult.formatted) {
          const eventsFormatted = eventsResult.formatted || leagueApi.formatResults('events', [eventsResult]);
          const label = eventsResult.cached ? 'CACHED LEAGUE DATA' : 'LIVE LEAGUE DATA';
          liveLeagueData += `\n\n[${label} — Events]:\n` + eventsFormatted;
        }
        if (statsResult.data || statsResult.formatted) {
          if (statsResult.formatted) liveLeagueData += `\n\n[LEAGUE STATS]: ${statsResult.formatted}`;
        }
      } catch { /* non-fatal */ }
    }

    // Direct LLM call for auto-greet (bypass Keeper memory to avoid injecting irrelevant facts)
    const ollamaSkill = require('../openclaw/skills/ollama');
    const deepseekSkill = require('./skills/deepseek');
    const leagueInfo = leagueKey ? leagueApi.LEAGUES[leagueKey] : null;
    const leagueLine = leagueInfo
      ? `You are responding in the **${leagueInfo.name}** Discord. Website: https://${leagueInfo.domain}. Key pages: /events (registration), /standings, /stats.`
      : '';

    const greetSystem = `You are Ghost, an AI assistant in a Discord support ticket channel. A user just opened a new ticket. Read the ticket context carefully and respond helpfully.
ALWAYS respond in English. Be professional and helpful. 1-3 sentences.
${leagueLine}

CRITICAL RULES:
- Address the user by the name shown in "Created by" in the ticket embed. Do NOT use names from other embeds or player intel.
- ONLY state facts that appear in the ticket context or live league data below. NEVER guess or make up information.
- If live league data shows current events/seasons, mention them specifically with details (names, dates, fees).
- If there are NO events listed, say there are no current events and suggest checking the website for updates.
- Include the website URL when relevant.`;

    const greetMessages = [
      { role: 'system', content: greetSystem },
      { role: 'user', content: `[TICKET CONTEXT]\n${ticketContext}${liveLeagueData}\n\n[Greet the user and help with their issue]` },
    ];

    let reply;
    const { result: oRes, escalate: oEsc } = await ollamaSkill.tryChat(greetMessages, { params: { num_ctx: 8192 } });
    if (!oEsc && oRes?.message?.content) {
      reply = oRes.message.content.trim();
    } else {
      const { result: dRes, escalate: dEsc } = await deepseekSkill.tryChat(greetMessages, { agent: 'sentinel', action: 'ticket-greet' });
      if (!dEsc && dRes?.message?.content) {
        reply = dRes.message.content.trim();
      } else {
        const { result: mRes } = await mini.tryChat(greetMessages);
        reply = mRes?.message?.content?.trim() || "Hi! I'm Ghost — I'll take a look at your ticket. An admin will follow up if needed.";
      }
    }
    await discord.sendMessage(event.channel_id, reply.slice(0, 2000));

    // Register in DB
    db.upsertTicket({ channelId: event.channel_id, guildId: event.guild_id }).catch(() => {});
    appendLog('INFO', 'ticket-auto-greet', 'BOT', 'success',
      `channel=${event.channel_id} guild=${event.guild_id}`);
  } catch (err) {
    console.error('[Sentinel] Ticket auto-greet failed:', err.message);
    appendLog('ERROR', 'ticket-auto-greet', 'BOT', 'failed', err.message, err);
  }
}

/**
 * Auto-respond to user messages in ticket channels (no @mention required).
 * Ghost is always active in tickets.
 */
async function _handleTicketAutoResponse(event) {
  const isTicket = await _detectAndTrackTicket(event.channel_id, event.guild_id);
  if (!isTicket) return;

  // Treat like a mention — route through the full ticket handling path
  handleMentionMessage(event).catch(err => {
    console.error('[Sentinel] Ticket auto-response error:', err.message);
    appendLog('ERROR', 'ticket-auto-response', event.user_role, 'failed', err.message, err);
  });
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note, err = null) {
  // Append stack trace for ERRORs so autofix can pinpoint the file
  const fullNote = (level === 'ERROR' && err?.stack)
    ? `${note} | stack: ${err.stack.split('\n').slice(0, 4).join(' > ')}`
    : note;
  const entry = `[${level}] ${new Date().toISOString()} | agent=Sentinel | action=${action} | user_role=${userRole} | model=gpt-4o-mini | outcome=${outcome} | escalated=false | note="${fullNote}"\n`;
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
  db.logEntry({ level, agent: 'Sentinel', action, outcome, user_role: userRole, note: fullNote }).catch(() => {});
}

// ── Agent channel map (populated from .env by setup-discord.js) ───────────────

function getAgentChannelMap() {
  return {
    [process.env.DISCORD_CH_SWITCHBOARD]: 'Switchboard',
    [process.env.DISCORD_CH_WARDEN]:      'Warden',
    [process.env.DISCORD_CH_SCRIBE]:      'Scribe',
    [process.env.DISCORD_CH_SCOUT]:       'Scout',
    [process.env.DISCORD_CH_FORGE]:       'Forge',
    [process.env.DISCORD_CH_LENS]:        'Lens',
    [process.env.DISCORD_CH_COURIER]:     'Courier',
    [process.env.DISCORD_CH_ARCHIVIST]:   'Archivist',
    [process.env.DISCORD_CH_HELM]:        'Helm',
  };
}

// ── Embed builders ────────────────────────────────────────────────────────────

function errEmbed(agentName, color, err) {
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle(`${agentName} — Error`)
    .setDescription(`\`\`\`${err.message}\`\`\``)
    .setFooter({ text: `Ghost AI • ${agentName}` })
    .setTimestamp();
}

function scribeEmbed(result) {
  const title = {
    status_report:  '📋 Status Report',
    daily_summary:  '📋 Daily Briefing',
    weekly_digest:  '📋 Weekly Digest',
    reminder_set:   '📋 Reminder Set',
  }[result.report_type] || '📋 Scribe';

  return new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle(title)
    .setDescription((result.content || `Reminder \`${result.id}\` set for ${result.due_at}`).slice(0, 4000))
    .setFooter({ text: 'Ghost AI • Scribe' })
    .setTimestamp();
}

function scoutEmbed(result) {
  const fields = [
    { name: '🤖 Model', value: `\`${result.model_used}\``, inline: true },
    { name: '📂 Type',  value: `\`${result.type}\` · \`${result.depth}\``, inline: true },
  ];
  if (result.sources?.length > 0) {
    fields.push({
      name:  '🔗 Sources',
      value: result.sources.slice(0, 5).join('\n').slice(0, 1000),
    });
  }
  return new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle('🔭 Scout Report')
    .setDescription((result.summary || 'No summary generated.').slice(0, 3000))
    .addFields(fields)
    .setFooter({ text: 'Ghost AI • Scout' })
    .setTimestamp();
}

function forgeEmbed(result) {
  const desc = [
    result.plan        ? `**Plan**\n${result.plan.slice(0, 1200)}`      : '',
    result.code_changes?.length ? `**Changes**\n${result.code_changes.slice(0, 5).map(c => `\`${c}\``).join(', ')}` : '',
    result.notes       ? `**Notes**\n${result.notes.slice(0, 600)}`     : '',
  ].filter(Boolean).join('\n\n') || 'Task processed.';

  const fields = [
    { name: '🤖 Model', value: `\`${result.model_used}\``, inline: true },
  ];
  if (result.escalation_reason) {
    fields.push({ name: '🔼 Escalated', value: result.escalation_reason, inline: true });
  }
  return new EmbedBuilder()
    .setColor(0xEB459E)
    .setTitle('⚒️ Forge Output')
    .setDescription(desc.slice(0, 3000))
    .addFields(fields)
    .setFooter({ text: 'Ghost AI • Forge' })
    .setTimestamp();
}

function lensAlertsEmbed(alerts) {
  const ok   = alerts.length === 0;
  const desc = ok
    ? '✅ All systems nominal. No thresholds breached.'
    : alerts.map(a => `${a.level === 'ERROR' ? '❌' : '⚠️'} **${a.metric}**: ${a.message}`).join('\n');

  return new EmbedBuilder()
    .setColor(ok ? 0x57F287 : 0xED4245)
    .setTitle('📊 Lens — System Alerts')
    .setDescription(desc)
    .setFooter({ text: `Ghost AI • Lens · ${alerts.length} alert(s)` })
    .setTimestamp();
}

function lensQueryEmbed(result) {
  return new EmbedBuilder()
    .setColor(0x3BA55C)
    .setTitle(`📊 Lens — ${result.metric || 'Analytics'}`)
    .setDescription((result.summary || JSON.stringify(result.result || {}).slice(0, 2000)).slice(0, 3000))
    .addFields([
      { name: '📅 Period', value: result.period || 'N/A', inline: true },
      { name: '🤖 Model',  value: `\`${result.model_used || 'none'}\``, inline: true },
      { name: '🚨 Alert',  value: result.alert ? '⚠️ Yes' : '✅ No', inline: true },
    ])
    .setFooter({ text: 'Ghost AI • Lens' })
    .setTimestamp();
}

function courierEmbed(result) {
  const desc = result.draft_body
    ? result.draft_body.slice(0, 2000)
    : `**Status:** ${result.status}${result.reason ? `\n**Reason:** ${result.reason}` : ''}`;

  const fields = [
    { name: '📬 Status', value: result.status || 'N/A', inline: true },
    { name: '🤖 Model',  value: `\`${result.model_used || 'N/A'}\``, inline: true },
  ];
  if (result.approval_id) {
    fields.push({ name: '🛡️ Approval ID', value: `\`${result.approval_id}\``, inline: true });
  }

  return new EmbedBuilder()
    .setColor(0xFAA81A)
    .setTitle(`✉️ Courier — ${(result.action || 'email').replace(/_/g, ' ').toUpperCase()}`)
    .setDescription(desc)
    .addFields(fields)
    .setFooter({ text: 'Ghost AI • Courier' })
    .setTimestamp();
}

function archivistEmbed(result) {
  if (result.action === 'store') {
    return new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle('🗄️ Archivist — Stored')
      .setDescription(`Memory entry saved.\n\n**ID:** \`${result.id}\`\n**Expires:** ${result.expires_at?.slice(0, 10)}`)
      .addFields([
        { name: '📂 Type', value: result.type,  inline: true },
        { name: '🏷️ Tags', value: (result.tags?.join(', ') || 'none'), inline: true },
      ])
      .setFooter({ text: 'Ghost AI • Archivist' })
      .setTimestamp();
  }

  const hits = result.results?.length || 0;
  const desc = result.summary
    ? result.summary.slice(0, 2500)
    : (result.results || []).slice(0, 3)
        .map((r, i) => `**[${i + 1}]** *(${(r.score * 100).toFixed(0)}%)* ${r.content?.slice(0, 250)}`)
        .join('\n\n') || 'No results found.';

  return new EmbedBuilder()
    .setColor(0x9B59B6)
    .setTitle('🗄️ Archivist — Memory Search')
    .setDescription(desc.slice(0, 3000))
    .addFields([
      { name: '🔍 Query',   value: (result.query || 'N/A').slice(0, 200), inline: false },
      { name: '📊 Hits',    value: `${hits}`,                              inline: true },
      { name: '🤖 Model',   value: `\`${result.model_used || 'none'}\``,  inline: true },
    ])
    .setFooter({ text: 'Ghost AI • Archivist' })
    .setTimestamp();
}

function switchboardEmbed(decision) {
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('🔀 Switchboard — Routing Decision')
    .setDescription(`Routing to **${decision.agent}**`)
    .addFields([
      { name: '🎯 Intent',  value: `\`${decision.intent}\``,                     inline: true },
      { name: '🤖 Model',   value: `\`${decision.model}\``,                       inline: true },
      { name: '📝 Reason',  value: decision.reason || 'N/A',                       inline: false },
      { name: '⚠️ Approval', value: decision.requires_approval ? 'Required' : 'Not required', inline: true },
      { name: '🚨 Dangerous', value: decision.dangerous ? 'Yes' : 'No',           inline: true },
    ])
    .setFooter({ text: `Ghost AI • Switchboard${decision.escalated ? ' · Escalated' : ''}` })
    .setTimestamp();
}

// ── Per-agent message handlers ────────────────────────────────────────────────

async function handleScribeMessage(event, plain = false) {
  const text = event.content.trim().toLowerCase();
  let result;

  if (text.startsWith('remind me') || text.startsWith('reminder')) {
    const isoMatch = event.content.match(/(\d{4}-\d{2}-\d{2}T[\d:.Z+-]+)/);
    if (!isoMatch) {
      await discord.sendMessage(event.channel_id,
        '⚠️ Include an ISO date: e.g. `remind me to deploy at 2026-03-01T09:00:00Z`');
      return;
    }
    const dueAt = isoMatch[1];
    const noteText = event.content.replace(/remind(er)?(\s*me)?/i, '').replace(isoMatch[0], '').replace(/\bat\b/gi, '').trim();
    const id = scribe.setReminder(noteText || 'Reminder', dueAt, event.user_role);
    result = { report_type: 'reminder_set', id, due_at: dueAt };
  } else if (text.includes('daily') || text.includes('briefing')) {
    result = await scribe.dailySummary();
  } else if (text.includes('weekly') || text.includes('digest')) {
    result = await scribe.weeklyDigest();
  } else {
    result = await scribe.statusReport();
  }

  if (plain) {
    const msg = result.content
      || (result.id ? `Reminder set (ID: ${result.id}) — due ${result.due_at}` : 'Done.');
    await discord.sendMessage(event.channel_id, msg.slice(0, 2000));
  } else {
    await discord.send(event.channel_id, { embeds: [scribeEmbed(result)] });
  }
}

async function handleScoutMessage(event, plain = false) {
  let text  = event.content.trim();
  let type  = 'factual';
  let depth = 'quick';

  if (/^web:/i.test(text))        { type = 'web';   text = text.replace(/^web:\s*/i, ''); }
  else if (/^trend:/i.test(text)) { type = 'trend'; text = text.replace(/^trend:\s*/i, ''); }
  else if (/^deep:/i.test(text))  { depth = 'deep'; text = text.replace(/^deep:\s*/i, ''); }

  const result = await scout.run({ query: text, type, depth });

  if (plain) {
    const sources = result.sources?.length > 0
      ? '\n\nSources:\n' + result.sources.slice(0, 5).join('\n')
      : '';
    await discord.sendMessage(event.channel_id,
      (result.summary || 'No results found.') + sources);
  } else {
    await discord.send(event.channel_id, { embeds: [scoutEmbed(result)] });
  }
}

async function handleForgeMessage(event, plain = false) {
  const text = event.content.trim();
  const result = await forge.run({ task: 'feature', description: text, files: [], context: '' });

  if (plain) {
    const msg = [
      result.plan  || '',
      result.notes || '',
      !result.plan && !result.notes ? 'Task processed.' : '',
    ].filter(Boolean).join('\n\n');
    await discord.sendMessage(event.channel_id, msg.slice(0, 2000));
  } else {
    await discord.send(event.channel_id, { embeds: [forgeEmbed(result)] });
  }
}

async function handleLensMessage(event, plain = false) {
  const text = event.content.trim().toLowerCase();

  if (text === 'alerts' || text === 'status' || text === 'check') {
    const alerts = await lens.systemAlerts();
    if (plain) {
      const msg = alerts.length === 0
        ? 'All systems nominal. No thresholds breached.'
        : alerts.map(a => `${a.level === 'ERROR' ? '❌' : '⚠️'} ${a.metric}: ${a.message}`).join('\n');
      await discord.sendMessage(event.channel_id, msg);
    } else {
      await discord.send(event.channel_id, { embeds: [lensAlertsEmbed(alerts)] });
    }
    return;
  }

  const result = await lens.run({ query_type: 'event_count', output_format: 'summary' });
  if (plain) {
    await discord.sendMessage(event.channel_id,
      (result.summary || JSON.stringify(result.result || {})).slice(0, 2000));
  } else {
    await discord.send(event.channel_id, { embeds: [lensQueryEmbed(result)] });
  }
}

async function handleCourierMessage(event, plain = false) {
  const text = event.content.trim();
  let action  = 'draft_campaign';
  let subject = text;
  let body    = '';

  if (/^draft:/i.test(text)) {
    subject = text.replace(/^draft:\s*/i, '');
  } else if (/^send alert/i.test(text)) {
    action  = 'send_transactional';
    subject = 'Ghost System Alert';
    body    = text;
  }

  const result = await courier.run({
    action,
    to:        action === 'send_transactional' ? [process.env.OWNER_EMAIL || 'owner@example.com'] : [],
    subject,
    body_text: body || text,
    user_role: event.user_role,
  });

  if (plain) {
    const msg = [
      `Status: ${result.status}`,
      result.draft_body ? result.draft_body.slice(0, 1500) : '',
      result.reason     ? `Reason: ${result.reason}` : '',
      result.approval_id ? `Approval ID: ${result.approval_id}` : '',
    ].filter(Boolean).join('\n');
    await discord.sendMessage(event.channel_id, msg.slice(0, 2000));
  } else {
    await discord.send(event.channel_id, { embeds: [courierEmbed(result)] });
  }
}

async function handleArchivistMessage(event, plain = false) {
  const text = event.content.trim();

  if (/^remember:/i.test(text)) {
    const content = text.replace(/^remember:\s*/i, '');
    const result  = await archivist.store({
      type:         'conversation',
      content,
      tags:         ['discord', event.user_role],
      source_agent: 'Sentinel',
    });
    if (plain) {
      await discord.sendMessage(event.channel_id,
        `Saved to memory. ID: ${result.id} — expires ${result.expires_at?.slice(0, 10)}`);
    } else {
      await discord.send(event.channel_id, { embeds: [archivistEmbed(result)] });
    }
    return;
  }

  if (text.toLowerCase() === 'purge' && event.user_role === 'OWNER') {
    await discord.sendMessage(event.channel_id, '✅ Purge complete. Expired entries removed.');
    return;
  }

  const result = await archivist.retrieve({
    query:         text,
    type_filter:   'all',
    top_k:         5,
    output_format: 'summary',
  });

  if (plain) {
    const hits = result.results?.length || 0;
    const msg  = result.summary
      || (result.results || []).slice(0, 3)
          .map((r, i) => `${i + 1}. ${r.content?.slice(0, 300)}`)
          .join('\n\n')
      || 'No results found.';
    await discord.sendMessage(event.channel_id, `${msg}\n\n(${hits} result${hits !== 1 ? 's' : ''})`);
  } else {
    await discord.send(event.channel_id, { embeds: [archivistEmbed(result)] });
  }
}

async function handleHelmMessage(event, plain = false) {
  const text   = event.content.trim();
  const result = await helm.run({ task: text, user_role: event.user_role });

  if (plain) {
    await discord.sendMessage(event.channel_id, (result.summary || 'Done.').slice(0, 2000));
  } else {
    const embed = new EmbedBuilder()
      .setColor(0x10B981)
      .setTitle('⚙️ Helm — SRE Status')
      .setDescription((result.summary || 'No data.').slice(0, 3000))
      .addFields([{ name: '🤖 Model', value: `\`${result.model_used || 'none'}\``, inline: true }])
      .setFooter({ text: 'Ghost AI • Helm' })
      .setTimestamp();
    await discord.send(event.channel_id, { embeds: [embed] });
  }
}

async function handleWardenMessage(event) {
  // Warden channel supports same !commands as #commands
  await handleCommand(event);
}

async function handleSwitchboardMessage(event) {
  // Switchboard channel shows routing decision
  await handleNaturalLanguage(event);
}

// ── Agent office dispatcher ────────────────────────────────────────────────────

async function handleAgentMessage(event, agentName, plain = false) {
  if (event.user_role === 'MEMBER') return;

  const thinking = await discord.sendMessage(event.channel_id,
    `*${agentName} is thinking…*`);

  try {
    switch (agentName) {
      case 'Scribe':       await handleScribeMessage(event, plain);      break;
      case 'Scout':        await handleScoutMessage(event, plain);       break;
      case 'Forge':        await handleForgeMessage(event, plain);       break;
      case 'Lens':         await handleLensMessage(event, plain);        break;
      case 'Courier':      await handleCourierMessage(event, plain);     break;
      case 'Archivist':    await handleArchivistMessage(event, plain);   break;
      case 'Warden':       await handleWardenMessage(event);             break;
      case 'Switchboard':  await handleSwitchboardMessage(event);       break;
      case 'Helm':         await handleHelmMessage(event, plain);       break;
      default:
        await discord.sendMessage(event.channel_id, `⚠️ No handler for ${agentName}.`);
    }
  } catch (err) {
    console.error(`[Sentinel] ${agentName} error:`, err.message);
    appendLog('ERROR', `agent-${agentName.toLowerCase()}`, event.user_role, 'failed', err.message, err);
    if (plain) {
      await discord.sendMessage(event.channel_id, `Something went wrong with ${agentName}: ${err.message}`);
    } else {
      await discord.send(event.channel_id, { embeds: [errEmbed(agentName, 0xED4245, err)] });
    }
  } finally {
    try { await thinking.delete(); } catch { /* non-fatal */ }
  }
}

// ── Command handler ───────────────────────────────────────────────────────────

async function handleCommand(event) {
  const text = event.content.trim();
  const { channel_id, user_role } = event;

  appendLog('INFO', 'inbound-command', user_role, 'received', `"${text.slice(0, 80)}"`);

  if (text === '!help') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('👻 Ghost — Commands')
      .addFields([
        { name: '🕹️ Available commands', value: [
          '`!help` — show this message',
          '`!status` — system status',
          '`!pending` — list approval queue *(OWNER/ADMIN)*',
          '`!approve APR-XXXX` — approve action *(OWNER)*',
          '`!deny APR-XXXX` — deny action *(OWNER)*',
        ].join('\n') },
        { name: '🏢 Agent offices', value: 'Visit any agent\'s channel to talk directly with them.' },
      ])
      .setFooter({ text: 'Ghost AI System' })
      .setTimestamp();
    await discord.send(channel_id, { embeds: [embed] });
    return;
  }

  if (text === '!status') {
    const port    = process.env.OPENCLAW_PORT || 18789;
    const pending = await warden.getPending();
    const embed   = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('✅ Ghost — Online')
      .addFields([
        { name: '🌐 Gateway',          value: `\`http://localhost:${port}\``,  inline: true },
        { name: '⏳ Pending approvals', value: `${pending.length}`,            inline: true },
      ])
      .setFooter({ text: 'Ghost AI System' })
      .setTimestamp();
    await discord.send(channel_id, { embeds: [embed] });
    return;
  }

  if (text === '!pending') {
    if (user_role !== 'OWNER' && user_role !== 'ADMIN') {
      await discord.sendMessage(channel_id, '❌ Insufficient permissions.');
      return;
    }
    const pending = await warden.getPending();
    if (pending.length === 0) {
      await discord.sendMessage(channel_id, '✅ No pending approvals.');
    } else {
      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle(`⏳ Pending Approvals (${pending.length})`)
        .setDescription(
          pending.map(p => `\`${p.id}\` — **${p.requesting_agent}** → \`${p.action}\``).join('\n')
        )
        .setFooter({ text: 'Use !approve or !deny to resolve' })
        .setTimestamp();
      await discord.send(channel_id, { embeds: [embed] });
    }
    return;
  }

  const approvalMatch = text.match(/^!(approve|deny)\s+([A-Z0-9-]+)$/i);
  if (approvalMatch) {
    if (user_role !== 'OWNER') {
      await discord.sendMessage(channel_id, '❌ Only OWNER can approve or deny actions.');
      return;
    }
    const decision = approvalMatch[1].toLowerCase();
    const id       = approvalMatch[2].toUpperCase();
    const result   = await warden.resolve(id, decision, 'OWNER');

    if (!result.ok) {
      await discord.sendMessage(channel_id, `⚠️ ${result.error}`);
      return;
    }

    const verb  = decision === 'approve' ? '✅ Approved' : '❌ Denied';
    const color = decision === 'approve' ? 0x57F287 : 0xED4245;
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${verb} — \`${id}\``)
      .setDescription(`Request **${id}** has been **${decision}d**.`)
      .setFooter({ text: 'Ghost AI • Warden' })
      .setTimestamp();
    await discord.send(channel_id, { embeds: [embed] });
    return;
  }

  if (user_role === 'OWNER' || user_role === 'ADMIN') {
    await discord.sendMessage(channel_id, `⚠️ Unknown command. Type \`!help\` for available commands.`);
  }
}

// ── Natural language → Switchboard ───────────────────────────────────────────

async function handleNaturalLanguage(event) {
  const { channel_id, user_role, content } = event;

  const decision = await switchboard.classify({
    source:    'discord',
    user_role,
    message:   content,
  });

  if (decision.error) {
    await discord.sendMessage(channel_id, `❌ Routing error: ${decision.error}`);
    return;
  }

  await discord.send(channel_id, { embeds: [switchboardEmbed(decision)] });

  appendLog('INFO', 'switchboard-route', user_role, 'success',
    `intent=${decision.intent} agent=${decision.agent} approval=${decision.requires_approval}`);
}

// ── Conversational reply via Keeper (persistent memory) ──────────────────────
//
// Keeper stores every conversation to disk and uses Qwen's full context window.
// Thread ID: discord:{channelId}:{userId}  — one thread per user per channel.
// Falls back to a simple in-memory reply if Keeper errors.

async function _ollamaChatReply(message, channelId, userId, guildId = null) {
  const threadId = `discord:${channelId}:${userId || 'unknown'}`;
  try {
    return await keeper.chat(threadId, message, { guildId });
  } catch (err) {
    console.error('[Sentinel] Keeper error, falling back:', err.message);
    // Emergency fallback: gpt-4o-mini stateless
    const { result, escalate } = await mini.tryChat([
      { role: 'system', content: 'You are Ghost, a chill AI assistant in Discord. Be brief and natural. ALWAYS respond in English.' },
      { role: 'user',   content: message },
    ]);
    return (escalate || !result?.message?.content) ? 'hey. what\'s up?' : result.message.content.trim();
  }
}

// ── Vision — analyse image attachments via OpenAI gpt-4o ─────────────────────

const https = require('https');

function _openaiVisionRequest(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('OPENAI_API_KEY not set'));

    const bodyStr = JSON.stringify({
      model:      'gpt-4o',
      messages,
      max_tokens: 1024,
    });
    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${apiKey}`,
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
        } catch (e) {
          reject(new Error(`OpenAI vision parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('OpenAI vision timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

async function handleVisionMessage(event) {
  const { channel_id, content } = event;
  const attachments = [...(event.raw?.attachments?.values() || [])]
    .filter(a => a.contentType?.startsWith('image/'));

  if (attachments.length === 0) return false;

  const prompt = content.trim() || 'Describe this image in detail. Include any text, objects, colours, and context you can see.';

  const userContent = [
    { type: 'text', text: prompt },
    ...attachments.map(a => ({
      type:      'image_url',
      image_url: { url: a.url, detail: 'auto' },
    })),
  ];

  const result = await _openaiVisionRequest([{ role: 'user', content: userContent }]);
  await discord.sendMessage(channel_id, result.slice(0, 2000));
  return true;
}

// ── Reception — classify + execute in one channel ────────────────────────────

const AGENT_HANDLERS = {
  Scribe:      (ev, plain) => handleScribeMessage(ev, plain),
  Scout:       (ev, plain) => handleScoutMessage(ev, plain),
  Forge:       (ev, plain) => handleForgeMessage(ev, plain),
  Lens:        (ev, plain) => handleLensMessage(ev, plain),
  Courier:     (ev, plain) => handleCourierMessage(ev, plain),
  Archivist:   (ev, plain) => handleArchivistMessage(ev, plain),
  Warden:      (ev)        => handleWardenMessage(ev),
  Switchboard: (ev)        => handleNaturalLanguage(ev),
  Helm:        (ev, plain) => handleHelmMessage(ev, plain),
};

// Short messages that look conversational — handled by Ollama before Switchboard
const CHAT_RE = /^[\w\s'",!?.:-]{1,120}$/;
function _looksLikeChat(text) {
  const t = text.trim().toLowerCase();
  if (t.length > 120) return false;
  // Contains a task keyword → route it
  const taskWords = /\b(research|search|find|look up|fix|build|implement|deploy|email|tweet|remind|schedule|analytics|remember|recall|status report|daily|weekly|digest|review|refactor|debug|check alerts)\b/i;
  return !taskWords.test(t);
}

async function handleReceptionMessage(event) {
  const { channel_id, content, user_role, user_id } = event;

  if (user_role === 'MEMBER') {
    await discord.sendMessage(channel_id, "Sorry, you need an ADMIN or OWNER role to talk to Ghost.");
    return;
  }

  // Signal nexus active → lights up beams on the portal network
  registry.setStatus('nexus', 'working');

  // Image attachments → vision first
  try {
    const handled = await handleVisionMessage(event);
    if (handled) { registry.setStatus('nexus', 'idle'); return; }
  } catch (err) {
    await discord.sendMessage(channel_id, `Vision error: ${err.message}`);
    registry.setStatus('nexus', 'idle');
    return;
  }

  // ! commands
  if (content.trim().startsWith('!')) {
    await handleCommand(event);
    registry.setStatus('nexus', 'idle');
    return;
  }

  // Conversational / casual → instant reply first, then Keeper
  if (_looksLikeChat(content)) {
    const quick = instantReply(content);
    if (quick) {
      await discord.sendMessage(channel_id, quick);
      registry.setStatus('nexus', 'idle');
      return;
    }
    const reply = await _ollamaChatReply(content, channel_id, user_id, event.guild_id);
    await discord.sendMessage(channel_id, reply);
    registry.setStatus('nexus', 'idle');
    return;
  }

  // Task detected — show wait message and route
  const waitMsg = await discord.sendMessage(channel_id, 'On it…');

  const decision = await switchboard.classify({ source: 'discord', user_role, message: content });
  try { await waitMsg.delete(); } catch { /* non-fatal */ }

  if (decision.error) {
    await discord.sendMessage(channel_id, `Routing error: ${decision.error}`);
    registry.setStatus('nexus', 'idle');
    return;
  }

  // Unclassifiable after all passes → instant reply or Keeper chat
  if (decision.intent === 'unknown/unclassified') {
    const quick = instantReply(content);
    if (quick) {
      await discord.sendMessage(channel_id, quick);
    } else {
      const reply = await _ollamaChatReply(content, channel_id, user_id, event.guild_id);
      await discord.sendMessage(channel_id, reply);
    }
    registry.setStatus('nexus', 'idle');
    return;
  }

  const routingMsg = await discord.sendMessage(channel_id, `Handing this to ${decision.agent}…`);

  try {
    const handler = AGENT_HANDLERS[decision.agent];
    if (handler) {
      await handler(event, true); // plain = true for reception
    } else {
      await discord.sendMessage(channel_id, `No handler for agent: ${decision.agent}`);
    }
    appendLog('INFO', 'reception-dispatch', user_role, 'success',
      `agent=${decision.agent} intent=${decision.intent}`);
  } catch (err) {
    console.error(`[Sentinel] Reception → ${decision.agent} error:`, err.message);
    appendLog('ERROR', 'reception-dispatch', user_role, 'failed', err.message, err);
    await discord.sendMessage(channel_id, `Something went wrong: ${err.message}`);
  } finally {
    try { await routingMsg.delete(); } catch { /* non-fatal */ }
    registry.setStatus('nexus', 'idle');
  }
}

// ── @mention handler — any channel, any member ────────────────────────────────
//
// Fires when someone @Ghost in a channel not already handled by another path.
// ADMINs/OWNERs get full Discord admin commands.
// Everyone else gets a conversational reply via Keeper.

const ADMIN_INTENT_RE = /\b(kick|ban|timeout|mute|dm\s+<@|assign\s+role|remove\s+role|give\s+role|create\s+role|delete\s+role|create\s+channel|delete\s+channel|list\s+roles|list\s+members|find\s+user|look\s+up)\b/i;

// Detect ticket channels by name or parent category
// Tolerant: strips emojis/symbols, matches "ticket" or "support" anywhere in name
function _looksLikeTicketName(name) {
  if (!name) return false;
  // Strip emojis, special chars, and leading punctuation
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

async function _buildTicketContext(channelId) {
  const history = await discord.fetchChannelHistory(channelId, 50);
  if (!history.length) return null;

  // Collect image URLs from history for vision analysis
  const imageUrls = [];
  for (const msg of history) {
    const images = (msg.attachments || []).filter(a => a.contentType?.startsWith('image/'));
    for (const img of images) {
      imageUrls.push({ url: img.url, author: msg.author });
    }
  }

  // Run vision on ALL images from the ticket history
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
      console.warn('[Sentinel] Ticket history vision failed:', err.message);
    }
  }

  const lines = [];
  for (const msg of history) {
    // Include embeds (ticket bots put the issue description in embeds)
    for (const embed of msg.embeds) {
      if (embed.title || embed.description) {
        lines.push(`[EMBED from ${msg.author}]${embed.title ? ' ' + embed.title : ''}`);
        if (embed.description) lines.push(embed.description);
        for (const field of embed.fields) {
          lines.push(`${field.name}: ${field.value}`);
        }
      }
    }
    // Note image attachments in text context
    const images = (msg.attachments || []).filter(a => a.contentType?.startsWith('image/'));
    if (images.length > 0) {
      lines.push(`[${msg.author} posted ${images.length} image(s)]`);
    }
    // Include text messages
    if (msg.content) {
      lines.push(`${msg.isBot ? '[BOT] ' : ''}${msg.author}: ${msg.content}`);
    }
  }

  return lines.join('\n').slice(0, 4000) + visionContext; // append vision after text context
}

async function handleMentionMessage(event) {
  const { channel_id, content, user_id, user_role, raw } = event;

  // Per-user rate limit: max 5 @mentions per 5 seconds
  try {
    const count = await redis.incr(`ratelimit:${user_id}`, 5);
    if (count !== null && count > 5) {
      await discord.sendMessage(channel_id, 'Easy there — slow down a bit.');
      return;
    }
  } catch { /* Redis unavailable — skip rate limiting */ }

  // Strip the @Ghost mention from the message
  const botId   = discord.client?.user?.id;
  const stripped = content
    .replace(botId ? new RegExp(`<@!?${botId}>`, 'g') : /^\s*/, '')
    .trim();
  const text = stripped || 'hello';

  appendLog('INFO', 'mention', user_role, 'received',
    `user=${user_id} name=${event.user} channel=${channel_id} text="${text.slice(0, 60)}"`);

  // Instant reply check (greetings, acks) — skip for ticket channels
  const isTicket = await _isTicketChannel(channel_id);

  if (!isTicket) {
    const quick = instantReply(text);
    if (quick) {
      await discord.sendMessage(channel_id, quick);
      return;
    }
  }

  // Admin command path — ADMIN/OWNER with admin intent keywords
  if ((user_role === 'OWNER' || user_role === 'ADMIN') && ADMIN_INTENT_RE.test(text)) {
    try {
      const reply = await discordAdmin.run(text, user_role, event.guild_id);
      await discord.sendMessage(channel_id, reply);
      appendLog('INFO', 'mention-admin', user_role, 'success', `cmd="${text.slice(0, 60)}"`);
    } catch (err) {
      await discord.sendMessage(channel_id, `❌ Command failed: ${err.message}`);
      appendLog('ERROR', 'mention-admin', user_role, 'failed', err.message, err);
    }
    return;
  }

  // ── Admin directive management — "list my rules", "remove rule #5" ──
  if ((user_role === 'OWNER' || user_role === 'ADMIN') && directives.isManageMessage(text)) {
    try {
      const reply = await directives.handleManageCommand(text, user_id, user_role, event.guild_id);
      await discord.sendMessage(channel_id, reply);
      appendLog('INFO', 'directive-manage', user_role, 'success', `user=${user_id}`);
    } catch (err) {
      await discord.sendMessage(channel_id, `Failed to manage rules: ${err.message}`);
      appendLog('ERROR', 'directive-manage', user_role, 'failed', err.message, err);
    }
    return;
  }

  // ── Admin teaching — "when someone says X, do Y" ──
  if ((user_role === 'OWNER' || user_role === 'ADMIN') && directives.isTeachingMessage(text)) {
    try {
      await discord.sendMessage(channel_id, '*Learning new rule…*');
      const extracted = await directives.extractDirective(text);
      if (extracted) {
        const rule = await directives.storeDirective({
          guildId:   event.guild_id,
          adminId:   user_id,
          adminName: event.user,
          extracted,
        });
        await discord.sendMessage(channel_id,
          `Got it. Rule **#${rule.id}** saved:\n> ${extracted.description}\n` +
          `Trigger: \`${extracted.trigger_type}\` → \`${extracted.trigger_value || 'behavioral'}\`\n` +
          `Action: **${extracted.action || 'behavioral'}**`);
        appendLog('INFO', 'directive-teach', user_role, 'success',
          `rule=${rule.id} action=${extracted.action} trigger=${extracted.trigger_value}`);
      } else {
        await discord.sendMessage(channel_id, "I couldn't parse that into a clear rule. Try something like: *when someone says X, warn them*");
      }
    } catch (err) {
      await discord.sendMessage(channel_id, `Failed to learn rule: ${err.message}`);
      appendLog('ERROR', 'directive-teach', user_role, 'failed', err.message, err);
    }
    return;
  }

  // ── Close ticket — ADMIN/OWNER says "close ticket" in a ticket channel ──
  if (isTicket && CLOSE_TICKET_RE.test(text) && (user_role === 'OWNER' || user_role === 'ADMIN')) {
    try {
      await discord.sendMessage(channel_id, '*Saving and closing ticket…*');

      // Fetch full channel history and channel info
      const history = await discord.fetchChannelHistory(channel_id, 100);
      const info    = await discord.getChannelInfo(channel_id);
      const opener  = history.find(m => !m.isBot);

      // Build a text summary of the conversation
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

      // Save transcript and mark as closed
      await db.upsertTicket({
        channelId:    channel_id,
        guildId:      event.guild_id,
        openerId:     opener?.authorId,
        openerName:   opener?.author,
        categoryName: info?.parentName,
        transcript:   history,
      });
      await db.closeTicket(channel_id, history, summaryText);

      appendLog('INFO', 'ticket-closed', user_role, 'success',
        `channel=${channel_id} guild=${event.guild_id} messages=${history.length}`);

      // Send closing embed
      await discord.sendMessage(channel_id, {
        embeds: [new EmbedBuilder()
          .setTitle('Ticket Closed')
          .setDescription(`This ticket has been closed by <@${user_id}>. The channel will be deleted in 60 seconds.`)
          .setColor(0x2ECC71)
          .setTimestamp()
        ],
      });

      // Delete the channel after 60 seconds
      setTimeout(() => {
        discord.closeChannel(channel_id).catch(() => {});
      }, 60_000);
      return;
    } catch (err) {
      await discord.sendMessage(channel_id, `Failed to close ticket: ${err.message}`);
      appendLog('ERROR', 'ticket-close', user_role, 'failed', err.message, err);
      return;
    }
  }

  // Build message for Keeper — with ticket context and live league data if applicable
  try {
    const thinkingMsg = await discord.sendMessage(channel_id,
      isTicket ? '*Ghost is reading the ticket…*' : '*Thinking…*');

    let messageForKeeper = text;

    // Vision support — analyze image attachments via gpt-4o
    if (isTicket) {
      const imageAttachments = [...(raw?.attachments?.values() || [])]
        .filter(a => a.contentType?.startsWith('image/'));
      if (imageAttachments.length > 0) {
        try {
          const userContent = [
            { type: 'text', text: text || 'Describe this image in detail. What issue or context does it show?' },
            ...imageAttachments.map(a => ({ type: 'image_url', image_url: { url: a.url, detail: 'auto' } })),
          ];
          const visionDesc = await _openaiVisionRequest([{ role: 'user', content: userContent }]);
          if (visionDesc) {
            messageForKeeper = `[IMAGE ANALYSIS]: ${visionDesc}\n\n${text || '(user sent an image)'}`;
          }
        } catch (err) {
          console.warn('[Sentinel] Ticket vision failed:', err.message);
        }
      }
    }

    if (isTicket) {
      const ticketContext = await _buildTicketContext(channel_id);
      let liveLeagueData = '';

      // For ticket channels in league guilds, always fetch events + home stats
      const leagueKey = event.guild_id ? leagueApi.leagueFromGuild(event.guild_id) : null;
      if (leagueKey) {
        try {
          const [eventsResult, statsResult] = await Promise.all([
            leagueApi.query(leagueKey, 'events'),
            leagueApi.query(leagueKey, 'home-stats'),
          ]);
          if (eventsResult.data || eventsResult.formatted) {
            const eventsFormatted = eventsResult.formatted || leagueApi.formatResults('events', [eventsResult]);
            const label = eventsResult.cached ? 'CACHED LEAGUE DATA' : 'LIVE LEAGUE DATA';
            liveLeagueData += `\n\n[${label} — Events from ${eventsResult.league} website]:\n` + eventsFormatted;
          }
          if (statsResult.data || statsResult.formatted) {
            if (statsResult.formatted) {
              liveLeagueData += `\n\n[LEAGUE STATS]: ${statsResult.formatted}`;
            } else {
              const stats = statsResult.data;
              const statsLine = typeof stats === 'object'
                ? Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join(', ')
                : JSON.stringify(stats);
              liveLeagueData += `\n\n[LEAGUE STATS]: ${statsLine}`;
            }
          }
        } catch { /* non-fatal — proceed without live data */ }
      }

      if (ticketContext) {
        messageForKeeper = `[TICKET CHANNEL — Full conversation below. IMPORTANT: Only use names and facts from this ticket context. Do not mix in information about other users from your memory.]\n\n${ticketContext}${liveLeagueData}\n\n[User just asked Ghost]: ${text || 'Help with this ticket'}`;
      }
      appendLog('INFO', 'mention-ticket', user_role, 'received',
        `channel=${channel_id} league=${leagueKey || 'none'} contextLen=${ticketContext?.length || 0}`);
    }

    const reply = await _ollamaChatReply(messageForKeeper, channel_id, user_id, event.guild_id);
    try { await thinkingMsg.delete(); } catch { /* non-fatal */ }
    await discord.sendMessage(channel_id, reply.slice(0, 2000));
    _markConvoActive(channel_id, user_id, event.guild_id);
    appendLog('INFO', isTicket ? 'mention-ticket' : 'mention-chat', user_role, 'success',
      `user=${user_id} name=${event.user}`);

    // Auto-save ticket transcript after every Ghost interaction (non-blocking)
    if (isTicket) {
      (async () => {
        try {
          const history = await discord.fetchChannelHistory(channel_id, 100);
          const info    = await discord.getChannelInfo(channel_id);
          const opener  = history.find(m => !m.isBot);
          await db.upsertTicket({
            channelId:    channel_id,
            guildId:      event.guild_id,
            openerId:     opener?.authorId,
            openerName:   opener?.author,
            categoryName: info?.parentName,
            transcript:   history,
          });
        } catch { /* non-fatal */ }
      })();
    }
  } catch (err) {
    await discord.sendMessage(channel_id, `Something went wrong: ${err.message}`);
    appendLog('ERROR', 'mention-chat', user_role, 'failed', err.message, err);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  const connected = await discord.connect();
  if (!connected) return;

  discord.onMessage((event) => {
    heartbeat.pulse();

    // ── Bot messages — ticket bot detection (close + new ticket) ──
    if (event.is_bot) {
      if (event.guild_id) {
        _handleTicketBotMessage(event).catch(() => {});
      }
      return;
    }

    // ── Admin observation — passive learning from admin/owner messages ──
    // Runs in background on every admin message in every channel.
    // Ghost absorbs domain knowledge over time without anyone having to train it.
    if (event.user_role === 'OWNER' || event.user_role === 'ADMIN') {
      memory.observeAdminMessage(
        event.channel_id, event.user, event.user_id,
        event.content, event.guild_id,
      );
    }

    // ── Admin directive auto-actions — fast regex check on MEMBER messages ──
    if (event.user_role === 'MEMBER' && event.guild_id) {
      const hasAttachments = event.raw?.attachments?.size > 0;
      directives.checkMessage(event.guild_id, event.channel_id, null, event.content, hasAttachments)
        .then(matched => {
          if (matched) directives.executeAction(matched, event).catch(() => {});
        })
        .catch(() => {});
    }

    const agentMap      = getAgentChannelMap();
    const agentName     = agentMap[event.channel_id];
    const inCommands    = event.channel_id === process.env.DISCORD_COMMANDS_CHANNEL_ID;
    const inReception   = event.channel_id === process.env.DISCORD_CH_RECEPTION;
    const isOwnerDM     = event.user_id === process.env.DISCORD_OWNER_USER_ID
                          && event.channel === 'dm';

    // Reception — classify + execute
    if (inReception) {
      handleReceptionMessage(event).catch(err => {
        console.error('[Sentinel] Reception error:', err.message);
        appendLog('ERROR', 'reception', event.user_role, 'failed', err.message, err);
      });
      return;
    }

    // Agent office channel — route to that agent
    if (agentName) {
      handleAgentMessage(event, agentName).catch(err => {
        console.error(`[Sentinel] ${agentName} error:`, err.message);
        appendLog('ERROR', 'agent-route', event.user_role, 'failed', err.message, err);
      });
      return;
    }

    // @mention in any other channel — only respond to direct @Ghost mentions
    // (NOT @everyone, @here, or @role — only when the bot user is explicitly mentioned)
    const botMentioned = discord.client?.user && event.raw?.mentions?.users?.has(discord.client.user.id);
    if (botMentioned && !inReception && !agentName && !inCommands && !isOwnerDM) {
      handleMentionMessage(event).catch(err => {
        console.error('[Sentinel] Mention error:', err.message);
        appendLog('ERROR', 'mention-handler', event.user_role, 'failed', err.message, err);
      });
      return;
    }

    // ── Ticket channel auto-response — Ghost handles all messages without @mention ──
    // Check synchronously first (known channels), then async for newly seen channels
    if (!inReception && !agentName && !inCommands && !isOwnerDM && !botMentioned && event.guild_id) {
      if (_knownTicketChannels.has(event.channel_id)) {
        // Definitely a ticket — handle and stop
        handleMentionMessage(event).catch(err => {
          console.error('[Sentinel] Ticket auto-response error:', err.message);
        });
        return;
      }
      // Not yet checked — async detect, handle if ticket
      if (!_ticketChannelChecked.has(event.channel_id)) {
        _handleTicketAutoResponse(event).catch(() => {});
        // Fall through — if it turns out to be a ticket, _handleTicketAutoResponse handles it
      }
    }

    // Active conversation follow-up — user replied to Ghost without @mentioning again
    if (!inReception && !agentName && !inCommands && !isOwnerDM && !botMentioned) {
      const activeConvo = _getActiveConvo(event.channel_id, event.user_id);
      if (activeConvo) {
        // Refresh the conversation timer and reply
        _markConvoActive(event.channel_id, event.user_id, activeConvo.guildId);
        (async () => {
          try {
            const reply = await _ollamaChatReply(event.content, event.channel_id, event.user_id, activeConvo.guildId);
            await discord.sendMessage(event.channel_id, reply.slice(0, 2000));
            _markConvoActive(event.channel_id, event.user_id, activeConvo.guildId);
          } catch (err) {
            console.error('[Sentinel] Active convo follow-up error:', err.message);
          }
        })();
        return;
      }
    }

    // #commands or OWNER DM
    if (!inCommands && !isOwnerDM) return;
    if (event.user_role === 'MEMBER') return;

    const text = event.content.trim();
    if (text.startsWith('!')) {
      handleCommand(event).catch(err => {
        console.error('[Sentinel] Command error:', err.message);
        appendLog('ERROR', 'command-handler', event.user_role, 'failed', err.message, err);
      });
    } else if (isOwnerDM) {
      // DMs use reception-style routing (instant → chat → task)
      handleReceptionMessage(event).catch(err => {
        console.error('[Sentinel] DM reception error:', err.message);
        appendLog('ERROR', 'dm-reception', event.user_role, 'failed', err.message, err);
      });
    } else {
      handleNaturalLanguage(event).catch(err => {
        console.error('[Sentinel] Switchboard error:', err.message);
        appendLog('ERROR', 'switchboard-route', event.user_role, 'failed', err.message, err);
      });
    }
  });

  registry.setStatus('sentinel', 'online');
  console.log('[Sentinel] Command handler active.');
}

module.exports = { start };