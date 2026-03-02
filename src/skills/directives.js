'use strict';

/**
 * Directives — Admin-defined auto-action rules for Ghost.
 *
 * Admins teach Ghost behaviors through natural conversation:
 *   "Ghost, when someone says test123, warn them"
 *   "Ghost, if anyone posts a discord invite link, delete the message"
 *
 * Fast regex-only matching on every message (no LLM in hot path).
 * Ollama used only for extraction when an admin teaches a new rule.
 */

const db     = require('../db');
const ollama = require('../../openclaw/skills/ollama');
const discord = require('../../openclaw/skills/discord');

// ── Detection regexes ────────────────────────────────────────────────────────
// Teaching: requires BOTH a trigger condition AND an action verb

const TEACHING_RE = /\b(when|if|whenever|every\s*time|any\s*time)\b[\s\S]{3,80}\b(delete|warn|mute|timeout|kick|ban|respond|reply|dm|log|remove)\b/i;
const RULE_RE     = /\b(from\s+now\s+on|always|never|i\s+want\s+you\s+to|you\s+should|make\s+sure)\b[\s\S]{3,80}\b(delete|warn|mute|timeout|kick|ban|respond|reply|dm|log|remove|block)\b/i;
const MANAGE_RE   = /\b(list|show|remove|delete|disable|enable)\b[\s\S]{0,20}\b(rules?|directives?|my\s+rules?)\b|\brule\s*#?\s*\d+/i;

/**
 * Pre-check: does this look like an admin teaching Ghost a new behavior?
 * High precision — requires both condition + action.
 */
function isTeachingMessage(text) {
  return TEACHING_RE.test(text) || RULE_RE.test(text);
}

/**
 * Pre-check: is admin managing existing rules?
 */
function isManageMessage(text) {
  return MANAGE_RE.test(text);
}

// ── LLM Extraction ──────────────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are a rule extraction system. Parse the admin's instruction into a JSON directive.

Output ONLY valid JSON (no markdown, no explanation):
{
  "type": "auto-action" or "behavioral",
  "trigger_type": "keyword" | "regex" | "link" | "attachment",
  "trigger_value": "the match pattern or keywords",
  "action": "delete" | "warn" | "timeout" | "kick" | "dm" | "log" | "respond",
  "action_params": { "message": "warning/response text", "duration_minutes": 10, "reason": "why" },
  "description": "human-readable summary of the rule"
}

Rules:
- "auto-action" = fires automatically on matching messages from regular members
- "behavioral" = modifies Ghost's personality/behavior (no trigger matching)
- trigger_type "keyword" for word/phrase matching, "regex" for patterns, "link" for URL detection, "attachment" for file types
- trigger_value: for keywords use the exact word/phrase; for regex use a JS-compatible pattern
- action_params.message: the warning/response text (use a sensible default if not specified)
- For behavioral directives, set trigger_type and trigger_value to null
- ALWAYS respond in English`;

async function extractDirective(text) {
  const messages = [
    { role: 'system', content: EXTRACT_PROMPT },
    { role: 'user',   content: text },
  ];
  const { result, escalate } = await ollama.tryChat(messages, { params: { num_ctx: 4096 } });
  if (escalate || !result?.message?.content) return null;

  const raw = result.message.content.trim();
  // Extract JSON from response (handle possible markdown code blocks)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // Validate required fields
    if (!parsed.description) return null;
    if (parsed.type === 'auto-action' && (!parsed.action || !parsed.trigger_value)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── In-memory cache ──────────────────────────────────────────────────────────
// Per-guild cache of active directives with pre-compiled regex patterns.
// Refreshed every 5 minutes or on create/delete.

const _cache = new Map(); // guildId → { directives, patterns, ts }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function _invalidateCache(guildId) {
  _cache.delete(guildId);
}

async function _getCache(guildId) {
  const cached = _cache.get(guildId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached;

  const directives = await db.getDirectives(guildId, { active: true });
  const patterns = [];
  for (const d of directives) {
    if (d.type !== 'auto-action' || !d.trigger_value) continue;
    try {
      let regex;
      if (d.trigger_type === 'regex') {
        regex = new RegExp(d.trigger_value, 'i');
      } else if (d.trigger_type === 'link') {
        // Match URLs containing the trigger value
        regex = new RegExp(`https?://[^\\s]*${d.trigger_value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s]*`, 'i');
      } else if (d.trigger_type === 'attachment') {
        // Attachment type — matched separately, regex is a dummy
        regex = null;
      } else {
        // Keyword — word boundary match
        const escaped = d.trigger_value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(`\\b${escaped}\\b`, 'i');
      }
      patterns.push({ directive: d, regex });
    } catch {
      // Bad regex — skip this directive
    }
  }

  const entry = { directives, patterns, ts: Date.now() };
  _cache.set(guildId, entry);
  return entry;
}

// ── Fast message checking (hot path — no LLM) ──────────────────────────────

/**
 * Check a message against all active directives for this guild.
 * Returns the first matching directive or null. O(n) regex scans, no network.
 */
async function checkMessage(guildId, channelId, channelName, content, hasAttachments) {
  if (!guildId) return null;
  const cache = await _getCache(guildId);
  if (!cache.patterns.length) return null;

  for (const { directive, regex } of cache.patterns) {
    if (directive.trigger_type === 'attachment') {
      if (hasAttachments) return directive;
      continue;
    }
    if (regex && regex.test(content)) return directive;
  }
  return null;
}

// ── Action execution ────────────────────────────────────────────────────────

/**
 * Execute the action defined in a directive. Only fires on MEMBER role.
 * OWNER and ADMIN are always exempt.
 */
async function executeAction(directive, event) {
  const { action, action_params: params } = directive;
  const reason = params?.reason || directive.description || 'Auto-moderation rule';

  try {
    switch (action) {
      case 'delete':
        if (event.raw?.id) {
          await discord.deleteMessage(event.channel_id, event.raw.id);
        }
        if (params?.message) {
          await discord.sendMessage(event.channel_id, `${params.message}`);
        }
        break;

      case 'warn':
        await discord.sendMessage(event.channel_id,
          params?.message || `<@${event.user_id}>, please don't do that.`);
        break;

      case 'timeout':
      case 'mute': {
        const mins = params?.duration_minutes || 10;
        await discord.timeoutUser(event.user_id, mins, reason, event.guild_id);
        if (params?.message) {
          await discord.sendMessage(event.channel_id, params.message);
        }
        break;
      }

      case 'kick':
        await discord.kickUser(event.user_id, reason, event.guild_id);
        if (params?.message) {
          await discord.sendMessage(event.channel_id, params.message);
        }
        break;

      case 'dm':
        // DM the user (best effort)
        try {
          const user = await discord.client.users.fetch(event.user_id);
          await user.send(params?.message || reason);
        } catch { /* can't DM — user may have DMs disabled */ }
        break;

      case 'log':
        // Just log it — no visible action
        break;

      case 'respond':
        await discord.sendMessage(event.channel_id,
          params?.message || 'This triggered an auto-response rule.');
        break;

      default:
        return;
    }

    // Bump hit counter
    db.bumpDirectiveHit(directive.id).catch(() => {});

    // Log the action
    db.logEntry({
      level: 'INFO',
      agent: 'Sentinel',
      action: `directive-${action}`,
      outcome: 'success',
      note: `rule=${directive.id} trigger="${directive.trigger_value}" user=${event.user_id} channel=${event.channel_id}`,
    }).catch(() => {});
  } catch (err) {
    db.logEntry({
      level: 'ERROR',
      agent: 'Sentinel',
      action: `directive-${action}`,
      outcome: 'failed',
      note: `rule=${directive.id} error=${err.message}`,
    }).catch(() => {});
  }
}

// ── Behavioral directives for system prompt ─────────────────────────────────

/**
 * Get all behavioral directives for a guild, formatted for system prompt injection.
 */
async function getBehavioralDirectives(guildId) {
  if (!guildId) return null;
  const cache = await _getCache(guildId);
  const behavioral = cache.directives.filter(d => d.type === 'behavioral');
  if (!behavioral.length) return null;
  return behavioral.map(d => `• ${d.description} (set by ${d.admin_name || 'admin'})`).join('\n');
}

// ── Admin management commands ──────────────────────────────────────────────

/**
 * Handle "list my rules", "remove rule #5", "disable rule #3", "enable rule #2"
 */
async function handleManageCommand(text, adminId, userRole, guildId) {
  if (!guildId) return 'Directives only work in guild channels.';

  const lower = text.toLowerCase();

  // List rules
  if (/\b(list|show)\b/i.test(lower) && /\brules?\b/i.test(lower)) {
    const isAll = /\ball\b/i.test(lower) && (userRole === 'OWNER' || userRole === 'ADMIN');
    const directives = isAll
      ? await db.getDirectives(guildId, { active: true })
      : await db.getDirectivesByAdmin(guildId, adminId);

    if (!directives.length) return isAll ? 'No active rules for this server.' : "You haven't set any rules yet.";

    const lines = directives.map((d, i) =>
      `**#${d.id}** — ${d.description}${d.active ? '' : ' *(disabled)*'} [${d.hit_count} hits]`
    );
    return (isAll ? '**All server rules:**\n' : '**Your rules:**\n') + lines.join('\n');
  }

  // Remove / delete rule
  const removeMatch = lower.match(/\b(?:remove|delete)\b[\s\S]*?#?(\d+)/);
  if (removeMatch) {
    const id = parseInt(removeMatch[1], 10);
    const deleted = await db.deleteDirective(id);
    if (deleted) {
      _invalidateCache(guildId);
      return `Rule #${id} has been removed.`;
    }
    return `Rule #${id} not found.`;
  }

  // Disable rule
  const disableMatch = lower.match(/\bdisable\b[\s\S]*?#?(\d+)/);
  if (disableMatch) {
    const id = parseInt(disableMatch[1], 10);
    const updated = await db.updateDirective(id, { active: false });
    if (updated) {
      _invalidateCache(guildId);
      return `Rule #${id} has been disabled.`;
    }
    return `Rule #${id} not found.`;
  }

  // Enable rule
  const enableMatch = lower.match(/\benable\b[\s\S]*?#?(\d+)/);
  if (enableMatch) {
    const id = parseInt(enableMatch[1], 10);
    const updated = await db.updateDirective(id, { active: true });
    if (updated) {
      _invalidateCache(guildId);
      return `Rule #${id} has been enabled.`;
    }
    return `Rule #${id} not found.`;
  }

  return "I can `list rules`, `remove rule #N`, `disable rule #N`, or `enable rule #N`.";
}

// ── Create directive (called from sentinel teaching path) ───────────────────

/**
 * Store a new directive from an admin's teaching message.
 */
async function storeDirective({ guildId, adminId, adminName, extracted }) {
  const row = await db.createDirective({
    guildId,
    adminId,
    adminName,
    type:         extracted.type || 'auto-action',
    triggerType:  extracted.trigger_type,
    triggerValue: extracted.trigger_value,
    action:       extracted.action,
    actionParams: extracted.action_params || {},
    description:  extracted.description,
  });
  _invalidateCache(guildId);
  return row;
}

module.exports = {
  isTeachingMessage,
  isManageMessage,
  extractDirective,
  storeDirective,
  checkMessage,
  executeAction,
  getBehavioralDirectives,
  handleManageCommand,
};
