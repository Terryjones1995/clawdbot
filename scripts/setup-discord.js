#!/usr/bin/env node
'use strict';

/**
 * Ghost Discord Setup
 *
 * Creates (or updates) all Ghost channels in your Discord server:
 *   👻 ── GHOST HQ ──      →  📡・commands  🚨・alerts  📜・audit-log
 *   🏢 ── AGENT OFFICES ── →  one styled channel per agent
 *
 * Posts a pinned info embed in every channel.
 * Sets read-only permissions on alerts + audit-log.
 * Writes all channel IDs back to .env automatically.
 *
 * Safe to re-run — updates existing channels, skips already-posted embeds.
 * Run:  node scripts/setup-discord.js
 */

require('dotenv').config();

const { Client, GatewayIntentBits, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ── Agent definitions ─────────────────────────────────────────────────────────

const AGENTS = [
  {
    key:      'switchboard',
    display:  '🔀・switchboard',
    envKey:   'DISCORD_CH_SWITCHBOARD',
    topic:    '🧠 Route anything — type any message to classify it and see where Ghost sends it',
    name:     'Switchboard',
    emoji:    '🔀',
    color:    0x5865F2,
    role:     'Routes every message to the right Ghost agent. The central nervous system of the system.',
    model:    '`qwen2.5-coder:7b` → `claude-sonnet-4-6`',
    powers:   [
      'Keyword-based routing (instant, free)',
      '3-pass classification: keyword → Ollama → Claude',
      'Danger flag detection',
      'Natural language intent understanding',
    ],
    tip: 'Just type anything. I\'ll figure out where to send it.',
  },
  {
    key:      'warden',
    display:  '🛡️・warden',
    envKey:   'DISCORD_CH_WARDEN',
    topic:    '🔒 Approvals & permissions — !pending · !approve APR-XXXX · !deny APR-XXXX',
    name:     'Warden',
    emoji:    '🛡️',
    color:    0xED4245,
    role:     'Command & control. Manages the approval queue, permissions, and gates dangerous actions.',
    model:    'Rule-based (no LLM needed)',
    powers:   [
      '`!pending` — view the approval queue',
      '`!approve APR-XXXX` — approve a queued action',
      '`!deny APR-XXXX` — deny a queued action',
      'Auto-approves non-dangerous ADMIN actions',
      'AGENT role always denied for external actions',
    ],
    tip: 'Use `!pending` to check the queue, or `!approve` / `!deny` to resolve items.',
  },
  {
    key:      'scribe',
    display:  '📋・scribe',
    envKey:   'DISCORD_CH_SCRIBE',
    topic:    '📅 Reports & reminders — type: status · daily · weekly · remind me [text] at [ISO time]',
    name:     'Scribe',
    emoji:    '📋',
    color:    0x57F287,
    role:     'Ops summaries, daily briefings, weekly digests, and reminders. Auto-sends every morning.',
    model:    '`qwen2.5-coder:7b` → `claude-sonnet-4-6` for narrative reports',
    powers:   [
      'Daily briefing at 08:00 UTC (automatic)',
      'Weekly digest every Monday (automatic)',
      '`status` — today\'s status report on demand',
      '`daily` — daily activity summary',
      '`weekly` — weekly digest',
      '`remind me [text] at [ISO]` — set a reminder',
    ],
    tip: 'Try: **status**, **daily**, **weekly**, or **remind me to deploy at 2026-03-01T09:00:00Z**',
  },
  {
    key:      'scout',
    display:  '🔭・scout',
    envKey:   'DISCORD_CH_SCOUT',
    topic:    '🌐 Research & web — ask anything · prefix web: trend: or deep: for different modes',
    name:     'Scout',
    emoji:    '🔭',
    color:    0xFEE75C,
    role:     'Research, web queries, trend analysis, and competitive intelligence.',
    model:    '`qwen2.5-coder:7b` (factual) → `grok-3-mini` (web/trend) → `claude-sonnet-4-6` (deep)',
    powers:   [
      'Factual Q&A via Ollama (free)',
      'Live web & trend search via Grok',
      'Deep cross-source synthesis via Claude Sonnet',
      'Always cites sources',
    ],
    tip: 'Ask any question. Prefix **web:** for live search, **trend:** for trends, **deep:** for full analysis.',
  },
  {
    key:      'forge',
    display:  '⚒️・forge',
    envKey:   'DISCORD_CH_FORGE',
    topic:    '💻 Code & architecture — describe any dev task · add ESCALATE:HARD for Opus',
    name:     'Forge',
    emoji:    '⚒️',
    color:    0xEB459E,
    role:     'Code, bug fixes, features, and architecture. Full 3-tier model escalation.',
    model:    '`qwen2.5-coder:7b` → `claude-sonnet-4-6` → `claude-opus-4-6`',
    powers:   [
      'Bug fixes & simple features (free, local)',
      'Security, payments, auth → Claude Sonnet auto-escalation',
      'Full system design → Claude Opus',
      'Add **ESCALATE:HARD** anywhere to force Opus',
    ],
    tip: 'Describe any dev task: **fix the login bug**, **add /health endpoint**, or **design the payment system**.',
  },
  {
    key:      'lens',
    display:  '📊・lens',
    envKey:   'DISCORD_CH_LENS',
    topic:    '📈 Analytics & alerts — type: alerts · or ask about any metric from PostHog',
    name:     'Lens',
    emoji:    '📊',
    color:    0x3BA55C,
    role:     'Analytics via PostHog. Event counts, trends, funnels, and system health alerts.',
    model:    '`qwen2.5-coder:7b` (simple) → `claude-sonnet-4-6` (funnels/retention)',
    powers:   [
      'Event counts, trends, session data (PostHog)',
      'Funnel & retention analysis (Claude Sonnet)',
      'Local system alert thresholds — no PostHog needed',
      '`alerts` — check all thresholds instantly',
    ],
    tip: 'Try: **alerts**, **show command volume this week**, or **daily active users**.',
  },
  {
    key:      'courier',
    display:  '✉️・courier',
    envKey:   'DISCORD_CH_COURIER',
    topic:    '📬 Email via Resend — draft: [subject] · or describe a campaign to create',
    name:     'Courier',
    emoji:    '✉️',
    color:    0xFAA81A,
    role:     'Outbound email via Resend. Transactional alerts and Warden-gated bulk campaigns.',
    model:    '`qwen2.5-coder:7b` (transactional) → `claude-sonnet-4-6` (campaigns/sensitive)',
    powers:   [
      'Send single-recipient system alerts (no approval needed)',
      'Draft email campaigns with Claude Sonnet copy',
      'Bulk sends & campaign launches gated by Warden',
      'Auto-detects sensitive content (legal, apology, GDPR)',
    ],
    tip: 'Try: **draft: monthly newsletter** or **send status alert to owner**.',
  },
  {
    key:      'archivist',
    display:  '🗄️・archivist',
    envKey:   'DISCORD_CH_ARCHIVIST',
    topic:    '🧠 Memory search — remember: [text] to store · or ask anything to search',
    name:     'Archivist',
    emoji:    '🗄️',
    color:    0x9B59B6,
    role:     'Long-term memory via Pinecone vector DB. Store, search, and expire context across all agents.',
    model:    '`qwen2.5-coder:7b` (targeted) → `claude-sonnet-4-6` (deep synthesis, k>10)',
    powers:   [
      'Semantic vector search across all stored memory',
      'Store research findings, decisions, conversations',
      '90-day TTL with automatic expiry (OWNER can purge)',
      'Start with **remember:** to save something',
    ],
    tip: 'Ask anything from memory, or start with **remember:** to store context for later.',
  },
];

// ── Command center channel definitions ────────────────────────────────────────

const COMMAND_CHANNELS = [
  {
    plain:    'commands',
    display:  '📡・commands',
    topic:    '👋 Talk to Ghost here — type anything to route it, or !help for commands',
    readOnly: false,
    envKey:   'DISCORD_COMMANDS_CHANNEL_ID',
  },
  {
    plain:    'alerts',
    display:  '🚨・alerts',
    topic:    '⚡ Automated system alerts from Ghost agents — read only',
    readOnly: true,
    envKey:   'DISCORD_ALERTS_CHANNEL_ID',
  },
  {
    plain:    'audit-log',
    display:  '📜・audit-log',
    topic:    '🔒 Permanent append-only log of all Ghost agent activity — read only',
    readOnly: true,
    envKey:   'DISCORD_CH_AUDIT',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getOrCreateCategory(guild, name) {
  const existing = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === name
  );
  if (existing) {
    console.log(`  ↩️  Category exists: ${name}`);
    return existing;
  }
  const cat = await guild.channels.create({ name, type: ChannelType.GuildCategory });
  console.log(`  ✅ Created category: ${name}`);
  return cat;
}

async function getOrCreateChannel(guild, plainName, displayName, topic, parentId) {
  // Find by either the plain name OR the styled display name
  const existing = guild.channels.cache.find(
    c => c.type === ChannelType.GuildText &&
         c.parentId === parentId &&
         (c.name === plainName || c.name === displayName)
  );

  if (existing) {
    const updates = {};
    if (existing.name !== displayName)            updates.name  = displayName;
    if (topic && existing.topic !== topic)        updates.topic = topic;

    if (Object.keys(updates).length > 0) {
      await existing.edit(updates);
      console.log(`  ✏️  Updated: #${displayName}`);
    } else {
      console.log(`  ↩️  No changes: #${displayName}`);
    }
    return existing;
  }

  const ch = await guild.channels.create({
    name:   displayName,
    type:   ChannelType.GuildText,
    parent: parentId,
    topic,
  });
  console.log(`  ✅ Created: #${displayName}`);
  return ch;
}

async function setReadOnly(channel, everyoneRole, botUserId) {
  try {
    // Deny @everyone from sending messages
    await channel.permissionOverwrites.edit(everyoneRole, {
      SendMessages: false,
      ViewChannel:  true,
    });
    // Ensure bot can still post
    const botMember = channel.guild.members.cache.get(botUserId);
    if (botMember) {
      await channel.permissionOverwrites.edit(botMember, {
        SendMessages: true,
      });
    }
    console.log(`  🔒 Set read-only: #${channel.name}`);
  } catch (err) {
    console.warn(`  ⚠️  Could not set permissions on #${channel.name}: ${err.message}`);
  }
}

async function hasEmbedWithTitle(channel, titleFragment) {
  try {
    const msgs = await channel.messages.fetch({ limit: 20 });
    return msgs.some(m => m.author.bot && m.embeds.some(e => e.title?.includes(titleFragment)));
  } catch {
    return false;
  }
}

async function pinMessage(msg) {
  try { await msg.pin(); } catch { /* no MANAGE_MESSAGES — skip */ }
}

// ── Embeds ────────────────────────────────────────────────────────────────────

async function postCommandCenterEmbed(channel) {
  if (await hasEmbedWithTitle(channel, 'Ghost HQ')) return;

  const embed = new EmbedBuilder()
    .setColor(0x23272A)
    .setTitle('👻 Ghost HQ — Command Center')
    .setDescription('Your AI agent workspace. Type anything here or visit an agent\'s office to talk directly.')
    .addFields(
      {
        name:  '🕹️ Commands',
        value: [
          '`!help` — show all commands',
          '`!status` — system status',
          '`!pending` — approval queue *(OWNER/ADMIN)*',
          '`!approve APR-XXXX` — approve *(OWNER)*',
          '`!deny APR-XXXX` — deny *(OWNER)*',
          '',
          '*Or just type naturally — Ghost will route it.*',
        ].join('\n'),
        inline: false,
      },
      {
        name:  '🏢 Agent Offices',
        value: AGENTS.map(a => `${a.emoji} **#${a.display.split('・')[1]}** — ${a.name}`).join('\n'),
        inline: false,
      },
      {
        name:  '⚡ Free-first',
        value: 'Common tasks use `qwen2.5-coder:7b` (local, free). Claude only when needed.',
        inline: false,
      },
    )
    .setImage('https://i.imgur.com/placeholder.png') // remove if no banner
    .setFooter({ text: 'Ghost AI System • Always watching' })
    .setTimestamp();

  // Remove placeholder image line since we don't have one
  embed.setImage(null);

  const msg = await channel.send({ embeds: [embed] });
  await pinMessage(msg);
  console.log(`  📌 Embed posted in #${channel.name}`);
}

async function postAlertChannelEmbed(channel) {
  if (await hasEmbedWithTitle(channel, 'System Alerts')) return;

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🚨 System Alerts')
    .setDescription('Automated alerts from Ghost agents appear here.\n\n> This channel is **read-only** — agents post here when thresholds are crossed.')
    .addFields({
      name:  '⚠️ Alert Thresholds',
      value: [
        '`escalation_rate > 15%` of daily agent calls',
        '`error_rate > 5%` of daily events',
        '`approval_backlog > 10` pending items',
        '`bounce_rate > 5%` on email sends',
      ].join('\n'),
      inline: false,
    })
    .setFooter({ text: 'Ghost AI • Lens monitors every 60 seconds' })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
  await pinMessage(msg);
  console.log(`  📌 Embed posted in #${channel.name}`);
}

async function postAuditLogEmbed(channel) {
  if (await hasEmbedWithTitle(channel, 'Audit Log')) return;

  const embed = new EmbedBuilder()
    .setColor(0x4F545C)
    .setTitle('📜 Audit Log')
    .setDescription('Every Ghost agent action is logged here from `memory/run_log.md`.\n\n> **Append-only** — nothing is ever deleted from this record.')
    .addFields({
      name:  '📝 Entry Format',
      value: '```[LEVEL] timestamp | agent=X | action=Y | user_role=Z | model=M | outcome=O | note="..."```',
      inline: false,
    })
    .setFooter({ text: 'Ghost AI • Permanent record' })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
  await pinMessage(msg);
  console.log(`  📌 Embed posted in #${channel.name}`);
}

async function postAgentEmbed(channel, agent) {
  if (await hasEmbedWithTitle(channel, agent.name)) return;

  const embed = new EmbedBuilder()
    .setColor(agent.color)
    .setTitle(`${agent.emoji}  ${agent.name}`)
    .setDescription(`> ${agent.role}`)
    .addFields(
      {
        name:   '🤖 Models',
        value:  agent.model,
        inline: false,
      },
      {
        name:   '⚡ Capabilities',
        value:  agent.powers.map(p => `› ${p}`).join('\n'),
        inline: false,
      },
      {
        name:   '💬 How to use',
        value:  `\`\`\`${agent.tip}\`\`\``,
        inline: false,
      },
    )
    .setFooter({ text: `Ghost AI  •  ${agent.name} Office` })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
  await pinMessage(msg);
  console.log(`  📌 Embed posted in #${channel.name}`);
}

// ── .env writer ───────────────────────────────────────────────────────────────

function updateEnv(channelIds) {
  const envPath = path.join(__dirname, '../.env');
  let content   = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  for (const [key, value] of Object.entries(channelIds)) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, `${key}=${value}`);
    } else {
      if (content.includes('# DISCORD')) {
        content = content.replace(/(# DISCORD[\s\S]*?)(\n#|\s*$)/, `$1\n${key}=${value}$2`);
      } else {
        content += `\n${key}=${value}`;
      }
    }
  }

  fs.writeFileSync(envPath, content.trimEnd() + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const token   = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token)   { console.error('❌ DISCORD_BOT_TOKEN not set'); process.exit(1); }
  if (!guildId) { console.error('❌ DISCORD_GUILD_ID not set');  process.exit(1); }

  console.log('👻 Ghost Discord Setup\n');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
  });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.login(token).catch(reject);
  });

  console.log(`Connected as: ${client.user.tag}\n`);

  const guild = await client.guilds.fetch(guildId);
  await guild.channels.fetch();
  await guild.members.fetch();

  console.log(`Guild: ${guild.name}\n`);

  const everyoneRole = guild.roles.everyone;
  const botUserId    = client.user.id;
  const channelIds   = {};

  // ── Command Center ──────────────────────────────────────────────────────────

  console.log('── Command center ──');
  const commandCat = await getOrCreateCategory(guild, '👻 ── GHOST HQ ──');

  for (const def of COMMAND_CHANNELS) {
    const ch = await getOrCreateChannel(guild, def.plain, def.display, def.topic, commandCat.id);
    channelIds[def.envKey] = ch.id;

    if (def.readOnly) {
      await setReadOnly(ch, everyoneRole, botUserId);
    }
  }

  const commandsCh = guild.channels.cache.get(channelIds.DISCORD_COMMANDS_CHANNEL_ID);
  const alertsCh   = guild.channels.cache.get(channelIds.DISCORD_ALERTS_CHANNEL_ID);
  const auditCh    = guild.channels.cache.get(channelIds.DISCORD_CH_AUDIT);

  console.log('\n── Command center embeds ──');
  if (commandsCh) await postCommandCenterEmbed(commandsCh);
  if (alertsCh)   await postAlertChannelEmbed(alertsCh);
  if (auditCh)    await postAuditLogEmbed(auditCh);

  // ── Agent Offices ───────────────────────────────────────────────────────────

  console.log('\n── Agent offices ──');
  const officeCat = await getOrCreateCategory(guild, '🏢 ── AGENT OFFICES ──');

  console.log('\n── Agent office embeds ──');
  for (const agent of AGENTS) {
    const ch = await getOrCreateChannel(guild, agent.key, agent.display, agent.topic, officeCat.id);
    channelIds[agent.envKey] = ch.id;
    await postAgentEmbed(ch, agent);
  }

  // ── Write .env ──────────────────────────────────────────────────────────────

  console.log('\n── Writing .env ──');
  updateEnv(channelIds);
  console.log('  ✅ .env updated');

  console.log('\n✅ Ghost Discord setup complete!');
  console.log('Restart the server to pick up any new channel IDs.\n');

  client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
