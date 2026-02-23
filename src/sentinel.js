'use strict';

/**
 * Sentinel — Discord command handler
 *
 * Binds the Discord connector to Ghost's command logic.
 * Handles inbound commands from #commands and OWNER DMs.
 * Manages the approval queue via !approve / !deny.
 *
 * Commands:
 *   !help           — list commands
 *   !status         — system status
 *   !pending        — list pending approvals (OWNER/ADMIN only)
 *   !approve <ID>   — approve a queued action (OWNER only)
 *   !deny <ID>      — deny a queued action (OWNER only)
 */

const fs   = require('fs');
const path = require('path');

const discord      = require('../openclaw/skills/discord');
const switchboard  = require('./switchboard');
const APPROVALS    = path.join(__dirname, '../memory/approvals.md');
const LOG_FILE     = path.join(__dirname, '../memory/run_log.md');

// ── Helpers ──────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note) {
  const entry = `[${level}] ${new Date().toISOString()} | agent=Sentinel | action=${action} | user_role=${userRole} | model=qwen3-coder | outcome=${outcome} | escalated=false | note="${note}"\n`;
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

function readApprovals() {
  if (!fs.existsSync(APPROVALS)) return '';
  return fs.readFileSync(APPROVALS, 'utf8');
}

function getPendingIds(content) {
  const matches = [...content.matchAll(/## \[([A-Z0-9-]+)\][\s\S]*?- \*\*Status:\*\* PENDING/g)];
  return matches.map(m => m[1]);
}

function resolveApproval(content, id, decision) {
  const status  = decision === 'approve' ? 'APPROVED' : 'DENIED';
  const resolved = new Date().toISOString();

  // Replace Status: PENDING with the decision, scoped to the right block
  const blockRe = new RegExp(
    `(## \\[${id}\\][\\s\\S]*?- \\*\\*Status:\\*\\*) PENDING([\\s\\S]*?- \\*\\*Resolved At:\\*\\*) null([\\s\\S]*?- \\*\\*Resolved By:\\*\\*) null`
  );
  if (!blockRe.test(content)) return null;

  return content.replace(blockRe, `$1 ${status}$2 ${resolved}$3 OWNER`);
}

// ── Command Router ────────────────────────────────────────────────────────────

async function handleCommand(event) {
  const text = event.content.trim();
  const { channel_id, user_id, user_role } = event;

  appendLog('INFO', 'inbound-command', user_role, 'received', `"${text.slice(0, 80)}"`);

  // !help
  if (text === '!help') {
    await discord.sendMessage(channel_id, [
      '**Ghost / Sentinel — Commands**',
      '`!help` — show this message',
      '`!status` — system status',
      '`!pending` — list pending approvals *(OWNER/ADMIN)*',
      '`!approve <ID>` — approve a queued action *(OWNER only)*',
      '`!deny <ID>` — deny a queued action *(OWNER only)*',
    ].join('\n'));
    return;
  }

  // !status
  if (text === '!status') {
    const port = process.env.OPENCLAW_PORT || 18789;
    await discord.sendMessage(channel_id, `✅ **Ghost online.** Gateway → \`http://localhost:${port}\``);
    return;
  }

  // !pending
  if (text === '!pending') {
    if (user_role !== 'OWNER' && user_role !== 'ADMIN') {
      await discord.sendMessage(channel_id, '❌ Insufficient permissions.');
      return;
    }
    const ids = getPendingIds(readApprovals());
    if (ids.length === 0) {
      await discord.sendMessage(channel_id, '✅ No pending approvals.');
    } else {
      await discord.sendMessage(channel_id,
        `⏳ **${ids.length} pending:** ${ids.map(id => `\`${id}\``).join(', ')}`);
    }
    return;
  }

  // !approve <ID> / !deny <ID>
  const approvalMatch = text.match(/^!(approve|deny)\s+([A-Z0-9-]+)$/i);
  if (approvalMatch) {
    if (user_role !== 'OWNER') {
      await discord.sendMessage(channel_id, '❌ Only OWNER can approve or deny actions.');
      return;
    }
    const decision = approvalMatch[1].toLowerCase();
    const id       = approvalMatch[2].toUpperCase();

    const original = readApprovals();
    if (!original.includes(`[${id}]`)) {
      await discord.sendMessage(channel_id, `⚠️ No approval request found with ID \`${id}\`.`);
      return;
    }
    if (!original.match(new RegExp(`\\[${id}\\][\\s\\S]*?Status:\\*\\* PENDING`))) {
      await discord.sendMessage(channel_id, `ℹ️ Request \`${id}\` is already resolved.`);
      return;
    }

    const updated = resolveApproval(original, id, decision);
    if (!updated) {
      await discord.sendMessage(channel_id, `❌ Could not resolve \`${id}\` — check approvals.md format.`);
      return;
    }

    fs.writeFileSync(APPROVALS, updated);
    const verb = decision === 'approve' ? '✅ Approved' : '❌ Denied';
    await discord.sendMessage(channel_id, `${verb} — request \`${id}\` has been **${decision === 'approve' ? 'approved' : 'denied'}**.`);
    appendLog(decision === 'approve' ? 'APPROVE' : 'DENY', `warden-${decision}`, 'OWNER', 'success', `id=${id}`);
    return;
  }

  // Unknown command
  if (user_role === 'OWNER' || user_role === 'ADMIN') {
    await discord.sendMessage(channel_id, `⚠️ Unknown command. Type \`!help\` for available commands.`);
  }
}

// ── Natural language → Switchboard ───────────────────────────────────────────

async function handleNaturalLanguage(event) {
  const { channel_id, user_id, user_role, content } = event;

  await discord.sendMessage(channel_id, `⏳ Routing…`);

  const decision = await switchboard.classify({
    source:    'discord',
    user_role,
    message:   content,
  });

  if (decision.error) {
    await discord.sendMessage(channel_id, `❌ Routing error: ${decision.error}`);
    return;
  }

  const approvalNote = decision.requires_approval
    ? '\n⚠️ **Requires approval** before execution.'
    : '';

  const dangerNote = decision.dangerous
    ? '\n🚨 **Dangerous action detected** — Warden gate active.'
    : '';

  const escalatedNote = decision.escalated
    ? `\n🔼 Escalated to \`${decision.model}\`.`
    : '';

  await discord.sendMessage(channel_id, [
    `**Switchboard → ${decision.agent}**`,
    `Intent: \`${decision.intent}\``,
    `Model: \`${decision.model}\``,
    `Reason: ${decision.reason}`,
    approvalNote, dangerNote, escalatedNote,
  ].filter(Boolean).join('\n'));

  appendLog('INFO', 'switchboard-route', user_role, 'success',
    `intent=${decision.intent} agent=${decision.agent} approval=${decision.requires_approval}`);
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  const connected = await discord.connect();
  if (!connected) return;

  discord.onMessage((event) => {
    const inCommands = event.channel_id === process.env.DISCORD_COMMANDS_CHANNEL_ID;
    const isOwnerDM  = event.user_id === process.env.DISCORD_OWNER_USER_ID
                       && event.channel === 'dm';

    // Only handle messages from #commands or OWNER DMs
    if (!inCommands && !isOwnerDM) return;

    // Ignore regular members in #commands
    if (event.user_role === 'MEMBER') return;

    const text = event.content.trim();

    if (text.startsWith('!')) {
      // Hard commands (! prefix)
      handleCommand(event).catch(err => {
        console.error('[Sentinel] Command error:', err.message);
        appendLog('ERROR', 'command-handler', event.user_role, 'failed', err.message);
      });
    } else {
      // Natural language — forward to Switchboard
      handleNaturalLanguage(event).catch(err => {
        console.error('[Sentinel] Switchboard error:', err.message);
        appendLog('ERROR', 'switchboard-route', event.user_role, 'failed', err.message);
      });
    }
  });

  console.log('[Sentinel] Command handler active.');
}

module.exports = { start };
