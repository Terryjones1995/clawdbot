#!/usr/bin/env node
'use strict';

/**
 * Ghost Discord Setup
 *
 * Creates all Ghost channels in your Discord server:
 *   👻 GHOST COMMAND CENTER  →  #commands  #alerts  #audit-log
 *   🏢 AGENT OFFICES         →  one channel per agent
 *
 * Posts a pinned info embed in every channel.
 * Writes all channel IDs back to .env automatically.
 *
 * Run once:  node scripts/setup-discord.js
 */

require('dotenv').config();

const { Client, GatewayIntentBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ── Agent definitions ─────────────────────────────────────────────────────────

const AGENTS = [
  {
    key:     'switchboard',
    envKey:  'DISCORD_CH_SWITCHBOARD',
    name:    'Switchboard',
    emoji:   '🔀',
    color:   0x5865F2,
    role:    'Routes every message to the right Ghost agent. The central nervous system of the system.',
    model:   '`qwen3-coder` (keyword) → `qwen3-coder` (Ollama) → `claude-sonnet-4-6`',
    powers:  [
      'Keyword-based routing (instant, free)',
      '3-pass classification: keyword → Ollama → Claude',
      'Danger flag detection',
      'Natural language intent understanding',
    ],
    tip: 'Just type anything. I\'ll figure out where to send it.',
  },
  {
    key:     'warden',
    envKey:  'DISCORD_CH_WARDEN',
    name:    'Warden',
    emoji:   '🛡️',
    color:   0xED4245,
    role:    'Command & control. Manages the approval queue, permissions, and gates dangerous actions.',
    model:   'Rule-based (no LLM)',
    powers:  [
      '`!pending` — list approval queue',
      '`!approve APR-XXXX` — approve a queued action',
      '`!deny APR-XXXX` — deny a queued action',
      'Auto-approves non-dangerous ADMIN actions',
      'AGENT role always denied for external actions',
    ],
    tip: 'Use `!pending` to check the queue, or `!approve` / `!deny` to resolve items.',
  },
  {
    key:     'scribe',
    envKey:  'DISCORD_CH_SCRIBE',
    name:    'Scribe',
    emoji:   '📋',
    color:   0x57F287,
    role:    'Ops summaries, daily briefings, weekly digests, and reminders. Sends auto-briefings every morning.',
    model:   '`qwen3-coder` → `claude-sonnet-4-6` for narrative reports',
    powers:  [
      'Daily briefing at 08:00 UTC (auto)',
      'Weekly digest every Monday (auto)',
      '`status` — today\'s status report',
      '`daily` — daily summary',
      '`weekly` — weekly digest',
      '`remind me [text] at [ISO time]` — set a reminder',
    ],
    tip: 'Try: **status**, **daily**, **weekly**, or **remind me to deploy at 2026-03-01T09:00:00Z**',
  },
  {
    key:     'scout',
    envKey:  'DISCORD_CH_SCOUT',
    name:    'Scout',
    emoji:   '🔭',
    color:   0xFEE75C,
    role:    'Research, web queries, trend analysis, and competitive intelligence.',
    model:   '`qwen3-coder` (factual) → `grok-3-mini` (web/trend) → `claude-sonnet-4-6` (deep)',
    powers:  [
      'Factual Q&A via Ollama (free)',
      'Live web & trend search via Grok',
      'Deep cross-source synthesis via Claude Sonnet',
      'Always cites sources',
    ],
    tip: 'Ask any question. Prefix **web:** for live search, **trend:** for trend analysis, **deep:** for full analysis.',
  },
  {
    key:     'forge',
    envKey:  'DISCORD_CH_FORGE',
    name:    'Forge',
    emoji:   '⚒️',
    color:   0xEB459E,
    role:    'Code, bug fixes, features, and architecture. Full 3-tier model escalation.',
    model:   '`qwen3-coder` (simple) → `claude-sonnet-4-6` (security/arch) → `claude-opus-4-6` (system design)',
    powers:  [
      'Bug fixes & simple features (free, local)',
      'Security, payments, auth → Claude Sonnet',
      'Full system design → Claude Opus',
      'Add **ESCALATE:HARD** to force Opus',
    ],
    tip: 'Describe any dev task: **fix the login bug**, **add /health endpoint**, or **design the payment system**.',
  },
  {
    key:     'lens',
    envKey:  'DISCORD_CH_LENS',
    name:    'Lens',
    emoji:   '📊',
    color:   0x3BA55C,
    role:    'Analytics via PostHog. Event counts, trends, funnels, and system health alerts.',
    model:   '`qwen3-coder` (counts/trends) → `claude-sonnet-4-6` (funnels/retention)',
    powers:  [
      'Event counts, trends, session data',
      'Funnel & retention analysis (Claude Sonnet)',
      'System alert thresholds (escalation rate, error rate, backlog)',
      '`alerts` — check all thresholds right now',
    ],
    tip: 'Try: **alerts**, **show command volume this week**, or **daily active users**.',
  },
  {
    key:     'courier',
    envKey:  'DISCORD_CH_COURIER',
    name:    'Courier',
    emoji:   '✉️',
    color:   0xFAA81A,
    role:    'Outbound email via Resend. Transactional alerts and Warden-gated bulk campaigns.',
    model:   '`qwen3-coder` (transactional) → `claude-sonnet-4-6` (campaigns/sensitive)',
    powers:  [
      'Single-recipient system alerts (no approval)',
      'Bulk sends & campaigns → Warden-gated',
      'Claude Sonnet for persuasive campaign copy',
      'Auto-detects sensitive content (legal, apology, GDPR)',
    ],
    tip: 'Try: **draft a welcome campaign** or **send status alert to owner**.',
  },
  {
    key:     'archivist',
    envKey:  'DISCORD_CH_ARCHIVIST',
    name:    'Archivist',
    emoji:   '🗄️',
    color:   0x9B59B6,
    role:    'Long-term memory via Pinecone vector DB. Store, search, and expire context across all agents.',
    model:   '`qwen3-coder` (targeted, k≤10) → `claude-sonnet-4-6` (deep synthesis, k>10)',
    powers:  [
      'Semantic vector search (Pinecone)',
      'Store research, decisions, agent outputs',
      '90-day TTL with auto-purge',
      'Start with **remember:** to store something',
    ],
    tip: 'Ask anything from memory, or start with **remember:** to store context.',
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

async function getOrCreateChannel(guild, name, parentId) {
  const existing = guild.channels.cache.find(
    c => c.type === ChannelType.GuildText && c.name === name && c.parentId === parentId
  );
  if (existing) {
    console.log(`  ↩️  Channel exists: #${name}`);
    return existing;
  }
  const ch = await guild.channels.create({
    name,
    type:   ChannelType.GuildText,
    parent: parentId,
  });
  console.log(`  ✅ Created channel: #${name}`);
  return ch;
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
  try { await msg.pin(); } catch { /* no MANAGE_MESSAGES permission — skip */ }
}

// ── Embeds ────────────────────────────────────────────────────────────────────

async function postCommandCenterEmbed(channel) {
  if (await hasEmbedWithTitle(channel, 'Ghost Command Center')) return;

  const embed = new EmbedBuilder()
    .setColor(0x23272A)
    .setTitle('👻 Ghost Command Center')
    .setDescription('Your AI agent workspace. Type commands here or visit any agent\'s office channel to talk directly.')
    .addFields(
      {
        name: '🕹️ Commands',
        value: [
          '`!help` — show all commands',
          '`!status` — system status',
          '`!pending` — approval queue *(OWNER/ADMIN)*',
          '`!approve APR-XXXX` — approve *(OWNER)*',
          '`!deny APR-XXXX` — deny *(OWNER)*',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🏢 Agent Offices',
        value: AGENTS.map(a => `${a.emoji} **#${a.key}** — ${a.name}`).join('\n'),
        inline: false,
      },
      {
        name: '⚡ Free-first principle',
        value: 'All common tasks use `qwen3-coder` (local, free). Paid models only when necessary.',
        inline: false,
      },
    )
    .setFooter({ text: 'Ghost AI System • Always watching' })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
  await pinMessage(msg);
  console.log(`  📌 Posted command center embed in #${channel.name}`);
}

async function postAlertChannelEmbed(channel) {
  if (await hasEmbedWithTitle(channel, 'System Alerts')) return;

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('🚨 System Alerts')
    .setDescription('Automated alerts from Ghost agents appear here.\n\nThis channel is **read-only** — agents post here when thresholds are crossed.')
    .addFields(
      {
        name: '⚠️ Alert Thresholds',
        value: [
          '• Escalation rate > 15% of daily calls',
          '• Error rate > 5% of daily events',
          '• Approval queue backlog > 10 items',
          '• Bounce rate > 5% (Courier)',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Ghost AI System • Lens monitors thresholds every 60s' })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
  await pinMessage(msg);
  console.log(`  📌 Posted alerts embed in #${channel.name}`);
}

async function postAuditLogEmbed(channel) {
  if (await hasEmbedWithTitle(channel, 'Audit Log')) return;

  const embed = new EmbedBuilder()
    .setColor(0x99AAB5)
    .setTitle('📜 Audit Log')
    .setDescription('Key system events are mirrored here from `memory/run_log.md`.\n\nAll entries are **append-only** — nothing is ever deleted from the audit trail.')
    .addFields(
      {
        name: '📝 Log Format',
        value: '`[LEVEL] timestamp | agent=X | action=Y | user_role=Z | model=M | outcome=O | note="..."`',
        inline: false,
      },
    )
    .setFooter({ text: 'Ghost AI System • Permanent record' })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
  await pinMessage(msg);
  console.log(`  📌 Posted audit log embed in #${channel.name}`);
}

async function postAgentEmbed(channel, agent) {
  if (await hasEmbedWithTitle(channel, agent.name)) return;

  const embed = new EmbedBuilder()
    .setColor(agent.color)
    .setTitle(`${agent.emoji} ${agent.name}`)
    .setDescription(agent.role)
    .addFields(
      {
        name:   '🤖 Models',
        value:  agent.model,
        inline: false,
      },
      {
        name:   '⚡ Capabilities',
        value:  agent.powers.map(p => `• ${p}`).join('\n'),
        inline: false,
      },
      {
        name:   '💬 How to use',
        value:  agent.tip,
        inline: false,
      },
    )
    .setFooter({ text: `Ghost AI System • ${agent.name} office` })
    .setTimestamp();

  const msg = await channel.send({ embeds: [embed] });
  await pinMessage(msg);
  console.log(`  📌 Posted ${agent.name} embed in #${channel.name}`);
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
      // Append under DISCORD section if it exists, otherwise at end
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

  if (!token)   { console.error('❌ DISCORD_BOT_TOKEN not set in .env'); process.exit(1); }
  if (!guildId) { console.error('❌ DISCORD_GUILD_ID not set in .env');  process.exit(1); }

  console.log('👻 Ghost Discord Setup\n');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  await new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('error', reject);
    client.login(token).catch(reject);
  });

  console.log(`Connected as: ${client.user.tag}\n`);

  const guild = await client.guilds.fetch(guildId);
  await guild.channels.fetch(); // populate cache

  console.log(`Guild: ${guild.name}\n`);

  // ── Command Center ────────────────────────────────────────────────────────

  console.log('── Creating command center channels ──');
  const commandCat  = await getOrCreateCategory(guild, '👻 GHOST COMMAND CENTER');
  const commandsCh  = await getOrCreateChannel(guild, 'commands',  commandCat.id);
  const alertsCh    = await getOrCreateChannel(guild, 'alerts',    commandCat.id);
  const auditCh     = await getOrCreateChannel(guild, 'audit-log', commandCat.id);

  console.log('\n── Posting command center embeds ──');
  await postCommandCenterEmbed(commandsCh);
  await postAlertChannelEmbed(alertsCh);
  await postAuditLogEmbed(auditCh);

  // ── Agent Offices ─────────────────────────────────────────────────────────

  console.log('\n── Creating agent office channels ──');
  const officeCat = await getOrCreateCategory(guild, '🏢 AGENT OFFICES');
  const channelIds = {
    DISCORD_COMMANDS_CHANNEL_ID: commandsCh.id,
    DISCORD_ALERTS_CHANNEL_ID:   alertsCh.id,
    DISCORD_CH_AUDIT:            auditCh.id,
  };

  console.log('\n── Posting agent embeds ──');
  for (const agent of AGENTS) {
    const ch = await getOrCreateChannel(guild, agent.key, officeCat.id);
    await postAgentEmbed(ch, agent);
    channelIds[agent.envKey] = ch.id;
  }

  // ── Write .env ────────────────────────────────────────────────────────────

  console.log('\n── Writing channel IDs to .env ──');
  updateEnv(channelIds);
  console.log('  ✅ .env updated');

  console.log('\n✅ Ghost Discord setup complete!');
  console.log('\nChannel IDs written to .env:');
  for (const [k, v] of Object.entries(channelIds)) {
    console.log(`  ${k}=${v}`);
  }
  console.log('\nRestart the server to pick up the new channel IDs.\n');

  client.destroy();
  process.exit(0);
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
