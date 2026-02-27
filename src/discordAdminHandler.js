'use strict';

/**
 * discordAdminHandler — shared Discord admin command parser + executor
 *
 * Used by:
 *   - reception.js   (portal terminal  → "kick @user", "list roles", etc.)
 *   - sentinel.js    (@mention handler → "@Ghost kick @user")
 *
 * Model routing: Ollama (Qwen3-coder, free) → mini fallback for NLP parse.
 * Execution: direct discord.js API calls.
 * Privilege check: OWNER > ADMIN > MEMBER (MEMBER blocked from dangerous actions).
 * Dangerous actions for non-OWNER flow through Warden for approval.
 */

const ollama  = require('../openclaw/skills/ollama');
const mini    = require('./skills/openai-mini');
const discord = require('../openclaw/skills/discord');
const warden  = require('./warden');

// Actions that need ADMIN or OWNER
const ADMIN_ACTIONS = new Set([
  'kick_user', 'ban_user', 'timeout_user', 'mute_user',
  'delete_channel', 'delete_role',
  'assign_role', 'remove_role',
  'dm_user',
]);

// Actions that need Warden gate for non-OWNER
const DANGEROUS_ACTIONS = new Set(['kick_user', 'ban_user', 'timeout_user', 'mute_user']);

const PARSE_SYSTEM = `You are a Discord bot command parser. Extract the user's intent and return ONLY valid JSON.

Supported actions and exact schemas:
{ "action": "list_roles" }
{ "action": "list_members" }
{ "action": "find_user", "query": "string" }
{ "action": "create_role", "role_name": "string", "color": "hex or null" }
{ "action": "delete_role", "role_name": "string" }
{ "action": "assign_role", "role_name": "string", "user_id": "snowflake or null", "username": "string or null" }
{ "action": "remove_role", "role_name": "string", "user_id": "snowflake or null", "username": "string or null" }
{ "action": "create_channel", "channel_name": "string", "topic": "string or null" }
{ "action": "delete_channel", "channel_name": "string" }
{ "action": "kick_user", "user_id": "snowflake or null", "username": "string or null", "reason": "string or null" }
{ "action": "ban_user", "user_id": "snowflake or null", "username": "string or null", "reason": "string or null" }
{ "action": "timeout_user", "user_id": "snowflake or null", "username": "string or null", "duration_minutes": number, "reason": "string or null" }
{ "action": "mute_user", "user_id": "snowflake or null", "username": "string or null", "duration_minutes": number, "reason": "string or null" }
{ "action": "dm_user", "user_id": "snowflake or null", "username": "string or null", "message": "string" }

Rules:
- If a Discord @mention like <@123456789> or <@!123456789> appears, extract the numeric snowflake as user_id.
- "mute" and "timeout" are the same — map to timeout_user.
- role_name and channel_name must be extracted verbatim from the command.
- duration_minutes: if "1 hour" → 60, "30 min" → 30, not specified → 10.
- Return ONLY the JSON object. No explanation. No markdown.`;

/**
 * Parse a natural language Discord admin command using Ollama (free-first), mini fallback.
 */
async function _parse(text) {
  const messages = [
    { role: 'system', content: PARSE_SYSTEM },
    { role: 'user',   content: text },
  ];

  // Try Ollama first (free)
  try {
    const { result, escalate } = await ollama.tryChat(messages, { params: { num_ctx: 2048 } });
    if (!escalate && result?.message?.content) {
      const raw = result.message.content.trim()
        .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
        .replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return JSON.parse(raw);
    }
  } catch { /* fall through to mini */ }

  // Fallback: mini
  const { result, escalate } = await mini.tryChat(messages, { maxTokens: 256 });
  if (escalate || !result?.message?.content) throw new Error('Could not parse Discord command');
  const raw = result.message.content.trim()
    .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(raw);
}

/**
 * Resolve a user_id from parsed command.
 * If user_id already set (from @mention), use it.
 * If username set, look up by name in the target guild.
 */
async function _resolveUserId(parsed, guildId = null) {
  if (parsed.user_id) return parsed.user_id;
  if (parsed.username) {
    const found = await discord.findMemberByName(parsed.username, guildId);
    if (!found) throw new Error(`No member found matching "${parsed.username}". Try @mentioning them directly.`);
    return found.id;
  }
  return null;
}

/**
 * Parse and execute a natural language Discord admin command.
 *
 * @param {string} text       - raw command text (with @mention prefix already stripped in sentinel)
 * @param {string} userRole   - OWNER | ADMIN | AGENT | MEMBER
 * @param {string|null} guildId - Discord guild ID to target (null = primary guild)
 * @returns {Promise<string>} - reply to send back to user
 */
async function run(text, userRole = 'OWNER', guildId = null) {
  let parsed;
  try {
    parsed = await _parse(text);
  } catch (err) {
    return `I couldn't parse that Discord command. Try: "kick @user", "list roles", "create channel ops", "dm @user your message".`;
  }

  if (!parsed?.action) return `I couldn't identify a Discord action. Try "list roles" or "kick @username".`;

  // Privilege check — block MEMBERs from admin actions
  if (ADMIN_ACTIONS.has(parsed.action) && userRole === 'MEMBER') {
    return `You need **ADMIN** or **OWNER** role to run \`${parsed.action}\`. Ask an admin.`;
  }

  // Warden gate for dangerous actions (non-OWNER ADMINs get queued)
  if (DANGEROUS_ACTIONS.has(parsed.action) && userRole !== 'OWNER') {
    try {
      const gate = await warden.gate({
        requesting_agent: 'Sentinel',
        action:           parsed.action,
        user_role:        userRole,
        payload:          JSON.stringify(parsed),
        reason:           `Discord admin command: ${text.slice(0, 80)}`,
      });
      if (gate.decision === 'queued') {
        return `⚠️ Action queued for OWNER approval.\nID: \`${gate.approval_id}\`\nUse \`!approve ${gate.approval_id}\` in #commands to proceed.`;
      }
      if (gate.decision === 'denied') {
        return `❌ Action denied by Warden: ${gate.reason}`;
      }
      // decision === 'approved' — fall through to execute
    } catch (err) {
      return `Warden check failed: ${err.message}`;
    }
  }

  // Execute
  try {
    switch (parsed.action) {

      case 'list_roles': {
        const roles = await discord.listRoles(guildId);
        if (!roles.length) return 'No roles found in the server.';
        return `**Roles (${roles.length}):**\n${roles.map(r => `• ${r.name}`).join('\n')}`;
      }

      case 'list_members': {
        const members = await discord.listMembers(100, guildId);
        const shown   = members.slice(0, 30);
        const lines   = shown.map(m => `• **${m.displayName}** \`${m.username}\``);
        return `**Members (${members.length} total, showing ${shown.length}):**\n${lines.join('\n')}`;
      }

      case 'find_user': {
        const found = await discord.findMemberByName(parsed.query || '', guildId);
        if (!found) return `No member found matching \`${parsed.query}\`.`;
        return `**${found.displayName}** (@${found.username})\nID: \`${found.id}\`\nRoles: ${found.roles.join(', ') || 'none'}`;
      }

      case 'create_role': {
        const role = await discord.createRole(parsed.role_name, { color: parsed.color }, guildId);
        return `✅ Role **${role.name}** created.`;
      }

      case 'delete_role': {
        await discord.deleteRole(parsed.role_name, guildId);
        return `✅ Role **${parsed.role_name}** deleted.`;
      }

      case 'assign_role': {
        const uid = await _resolveUserId(parsed, guildId);
        if (!uid) return `Need a user to assign the role to. Try "@Ghost assign role ${parsed.role_name} to @username".`;
        await discord.assignRole(uid, parsed.role_name, guildId);
        return `✅ Role **${parsed.role_name}** assigned.`;
      }

      case 'remove_role': {
        const uid = await _resolveUserId(parsed, guildId);
        if (!uid) return `Need a user to remove the role from. Try "@Ghost remove role ${parsed.role_name} from @username".`;
        await discord.removeRole(uid, parsed.role_name, guildId);
        return `✅ Role **${parsed.role_name}** removed.`;
      }

      case 'create_channel': {
        const ch = await discord.createChannel(parsed.channel_name, { topic: parsed.topic }, guildId);
        return `✅ Channel **#${ch.name}** created.`;
      }

      case 'delete_channel': {
        await discord.deleteChannel(parsed.channel_name, guildId);
        return `✅ Channel **#${parsed.channel_name}** deleted.`;
      }

      case 'kick_user': {
        const uid = await _resolveUserId(parsed, guildId);
        if (!uid) return `Need a user to kick. Try "@Ghost kick @username".`;
        await discord.kickUser(uid, parsed.reason || 'Kicked by Ghost', guildId);
        return `✅ User kicked. Reason: ${parsed.reason || 'none'}`;
      }

      case 'ban_user': {
        const uid = await _resolveUserId(parsed, guildId);
        if (!uid) return `Need a user to ban. Try "@Ghost ban @username".`;
        await discord.banUser(uid, parsed.reason || 'Banned by Ghost', guildId);
        return `✅ User banned. Reason: ${parsed.reason || 'none'}`;
      }

      case 'timeout_user':
      case 'mute_user': {
        const uid  = await _resolveUserId(parsed, guildId);
        if (!uid) return `Need a user to timeout. Try "@Ghost timeout @username 10 minutes".`;
        const mins = parsed.duration_minutes || 10;
        await discord.timeoutUser(uid, mins, parsed.reason || 'Timed out by Ghost', guildId);
        return `✅ User timed out for **${mins} minutes**. Reason: ${parsed.reason || 'none'}`;
      }

      case 'dm_user': {
        const uid = await _resolveUserId(parsed, guildId);
        if (!uid) return `Need a user to DM. Try "@Ghost dm @username your message".`;
        if (!parsed.message) return `No message content to send.`;
        await discord.sendDM(uid, parsed.message);
        return `✅ DM sent.`;
      }

      default:
        return `Unknown action: \`${parsed.action}\`. Supported: list_roles, list_members, find_user, create/delete role, create/delete channel, kick, ban, timeout, dm_user.`;
    }
  } catch (err) {
    return `❌ Discord action failed: ${err.message}`;
  }
}

module.exports = { run };
