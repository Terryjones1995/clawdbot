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

const discord     = require('../openclaw/skills/discord');
const heartbeat   = require('./heartbeat');
const switchboard = require('./switchboard');
const warden      = require('./warden');
const scribe      = require('./scribe');
const scout       = require('./scout');
const forge       = require('./forge');
const lens        = require('./lens');
const courier     = require('./courier');
const archivist   = require('./archivist');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note) {
  const entry = `[${level}] ${new Date().toISOString()} | agent=Sentinel | action=${action} | user_role=${userRole} | model=qwen3-coder | outcome=${outcome} | escalated=false | note="${note}"\n`;
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
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

async function handleScribeMessage(event) {
  const text = event.content.trim().toLowerCase();
  let result;

  if (text.startsWith('remind me') || text.startsWith('reminder')) {
    // Parse: "remind me [text] at [ISO]" or "reminder: [text] at [ISO]"
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

  await discord.send(event.channel_id, { embeds: [scribeEmbed(result)] });
}

async function handleScoutMessage(event) {
  let text  = event.content.trim();
  let type  = 'factual';
  let depth = 'quick';

  if (/^web:/i.test(text))   { type = 'web';   text = text.replace(/^web:\s*/i, ''); }
  else if (/^trend:/i.test(text)) { type = 'trend'; text = text.replace(/^trend:\s*/i, ''); }
  else if (/^deep:/i.test(text))  { depth = 'deep'; text = text.replace(/^deep:\s*/i, ''); }

  const result = await scout.run({ query: text, type, depth });
  await discord.send(event.channel_id, { embeds: [scoutEmbed(result)] });
}

async function handleForgeMessage(event) {
  const text = event.content.trim();
  const result = await forge.run({ task: 'feature', description: text, files: [], context: '' });
  await discord.send(event.channel_id, { embeds: [forgeEmbed(result)] });
}

async function handleLensMessage(event) {
  const text = event.content.trim().toLowerCase();

  if (text === 'alerts' || text === 'status' || text === 'check') {
    const alerts = lens.systemAlerts();
    await discord.send(event.channel_id, { embeds: [lensAlertsEmbed(alerts)] });
    return;
  }

  // Try a basic event_count query using the message as the event name hint
  const result = await lens.run({
    query_type:    'event_count',
    output_format: 'summary',
  });
  await discord.send(event.channel_id, { embeds: [lensQueryEmbed(result)] });
}

async function handleCourierMessage(event) {
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
  await discord.send(event.channel_id, { embeds: [courierEmbed(result)] });
}

async function handleArchivistMessage(event) {
  const text = event.content.trim();

  if (/^remember:/i.test(text)) {
    const content = text.replace(/^remember:\s*/i, '');
    const result  = await archivist.store({
      type:         'conversation',
      content,
      tags:         ['discord', event.user_role],
      source_agent: 'Sentinel',
    });
    await discord.send(event.channel_id, { embeds: [archivistEmbed(result)] });
    return;
  }

  if (text.toLowerCase() === 'purge' && event.user_role === 'OWNER') {
    const result = await archivist.purge();
    await discord.sendMessage(event.channel_id, `✅ Purge complete. Expired entries removed.`);
    return;
  }

  const result = await archivist.retrieve({
    query:         text,
    type_filter:   'all',
    top_k:         5,
    output_format: 'summary',
  });
  await discord.send(event.channel_id, { embeds: [archivistEmbed(result)] });
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

async function handleAgentMessage(event, agentName) {
  if (event.user_role === 'MEMBER') return;

  const thinking = await discord.sendMessage(event.channel_id,
    `*${agentName} is thinking…*`);

  try {
    switch (agentName) {
      case 'Scribe':       await handleScribeMessage(event);      break;
      case 'Scout':        await handleScoutMessage(event);       break;
      case 'Forge':        await handleForgeMessage(event);       break;
      case 'Lens':         await handleLensMessage(event);        break;
      case 'Courier':      await handleCourierMessage(event);     break;
      case 'Archivist':    await handleArchivistMessage(event);   break;
      case 'Warden':       await handleWardenMessage(event);      break;
      case 'Switchboard':  await handleSwitchboardMessage(event); break;
      default:
        await discord.sendMessage(event.channel_id, `⚠️ No handler for ${agentName}.`);
    }
  } catch (err) {
    console.error(`[Sentinel] ${agentName} error:`, err.message);
    appendLog('ERROR', `agent-${agentName.toLowerCase()}`, event.user_role, 'failed', err.message);
    await discord.send(event.channel_id, {
      embeds: [errEmbed(agentName, 0xED4245, err)],
    });
  } finally {
    // Delete the "thinking" message
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
    const pending = warden.getPending();
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
    const pending = warden.getPending();
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
    const result   = warden.resolve(id, decision, 'OWNER');

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

  await discord.send(channel_id, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x10A37F)
        .setTitle(`👁️ Vision — ${attachments.length > 1 ? `${attachments.length} images` : '1 image'}`)
        .setDescription(result.slice(0, 3000))
        .setImage(attachments[0].url)
        .setFooter({ text: 'Ghost AI • Vision · gpt-4o' })
        .setTimestamp(),
    ],
  });

  return true;
}

// ── Reception — classify + execute in one channel ────────────────────────────

const AGENT_HANDLERS = {
  Scribe:     handleScribeMessage,
  Scout:      handleScoutMessage,
  Forge:      handleForgeMessage,
  Lens:       handleLensMessage,
  Courier:    handleCourierMessage,
  Archivist:  handleArchivistMessage,
  Warden:     handleWardenMessage,
  Switchboard: handleNaturalLanguage,
};

async function handleReceptionMessage(event) {
  const { channel_id, content, user_role } = event;

  if (user_role === 'MEMBER') {
    await discord.sendMessage(channel_id, '❌ You need ADMIN or OWNER role to use Ghost.');
    return;
  }

  // Image attachments → vision (handle before any text routing)
  try {
    const handled = await handleVisionMessage(event);
    if (handled) return;
  } catch (err) {
    await discord.send(channel_id, { embeds: [errEmbed('Vision', 0xED4245, err)] });
    return;
  }

  // Handle ! commands directly
  if (content.trim().startsWith('!')) {
    await handleCommand(event);
    return;
  }

  // Greetings — respond friendly instead of routing
  if (/^(hi|hello|hey|sup|yo|howdy|hiya|greetings|good\s*(morning|afternoon|evening))[\s!?.]*$/i.test(content.trim())) {
    await discord.send(channel_id, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('👻 Ghost — Ready')
          .setDescription('Hey! Just tell me what you need and I\'ll get it done.\n\nExamples:\n› `research what\'s happening in AI`\n› `fix a bug in my code`\n› `show me today\'s briefing`\n› `check system alerts`\n› `remember: we chose Postgres`')
          .setFooter({ text: 'Ghost AI • Reception' }),
      ],
    });
    return;
  }

  // Immediate acknowledgement — so the user knows Ghost is working
  const waitMsg = await discord.send(channel_id, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⏳ Please wait…')
        .setDescription('*Ghost is on it — figuring out the best agent for your request.*')
        .setFooter({ text: 'Ghost AI • Reception' }),
    ],
  });

  // Step 1: classify
  const decision = await switchboard.classify({ source: 'discord', user_role, message: content });

  // Delete wait message before showing result
  try { await waitMsg.delete(); } catch { /* non-fatal */ }

  if (decision.error) {
    await discord.sendMessage(channel_id, `❌ Routing error: ${decision.error}`);
    return;
  }

  // Step 2: brief routing notice (auto-deleted after agent responds)
  const routingMsg = await discord.send(channel_id, {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`🔀 Routing to ${decision.agent}…`)
        .setDescription(`*${decision.reason || decision.intent}*`)
        .setFooter({ text: 'Ghost AI • Switchboard' }),
    ],
  });

  // Step 3: execute the agent — if unclassifiable, prompt the user
  if (decision.intent === 'unknown/unclassified') {
    await discord.send(channel_id, {
      embeds: [
        new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('🤔 Not sure what you need')
          .setDescription(`I couldn't figure out which agent handles that.\n\nTry being more specific:\n› \`research [topic]\`\n› \`fix [code issue]\`\n› \`status\` or \`daily\`\n› \`web: [search query]\`\n› \`remember: [note]\`\n\nOr visit an agent's office directly.`)
          .setFooter({ text: 'Ghost AI • Switchboard' }),
      ],
    });
    return;
  }

  try {
    const handler = AGENT_HANDLERS[decision.agent];
    if (handler) {
      await handler(event);
    } else {
      await discord.sendMessage(channel_id, `⚠️ No handler for agent: **${decision.agent}**`);
    }
  } catch (err) {
    console.error(`[Sentinel] Reception → ${decision.agent} error:`, err.message);
    appendLog('ERROR', 'reception-dispatch', user_role, 'failed', err.message);
    await discord.send(channel_id, { embeds: [errEmbed(decision.agent, 0xED4245, err)] });
  } finally {
    try { await routingMsg.delete(); } catch { /* non-fatal */ }
  }

  appendLog('INFO', 'reception-dispatch', user_role, 'success',
    `agent=${decision.agent} intent=${decision.intent}`);
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  const connected = await discord.connect();
  if (!connected) return;

  discord.onMessage((event) => {
    heartbeat.pulse();
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
        appendLog('ERROR', 'reception', event.user_role, 'failed', err.message);
      });
      return;
    }

    // Agent office channel — route to that agent
    if (agentName) {
      handleAgentMessage(event, agentName).catch(err => {
        console.error(`[Sentinel] ${agentName} error:`, err.message);
        appendLog('ERROR', 'agent-route', event.user_role, 'failed', err.message);
      });
      return;
    }

    // #commands or OWNER DM
    if (!inCommands && !isOwnerDM) return;
    if (event.user_role === 'MEMBER') return;

    const text = event.content.trim();
    if (text.startsWith('!')) {
      handleCommand(event).catch(err => {
        console.error('[Sentinel] Command error:', err.message);
        appendLog('ERROR', 'command-handler', event.user_role, 'failed', err.message);
      });
    } else {
      handleNaturalLanguage(event).catch(err => {
        console.error('[Sentinel] Switchboard error:', err.message);
        appendLog('ERROR', 'switchboard-route', event.user_role, 'failed', err.message);
      });
    }
  });

  console.log('[Sentinel] Command handler active.');
}

module.exports = { start };
