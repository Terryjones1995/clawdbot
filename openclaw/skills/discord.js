'use strict';

/**
 * Discord Connector — Sentinel
 *
 * Low-level wrapper around discord.js.
 * Implements the MVP API surface from connectors_plan.md.
 *
 * Usage:
 *   const discord = require('./openclaw/skills/discord');
 *   await discord.connect();
 *   discord.onMessage(event => { ... });
 *   await discord.sendMessage(channelId, 'hello');
 */

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../memory/run_log.md');

class DiscordConnector {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.token          = process.env.DISCORD_BOT_TOKEN;
    this.guildId        = process.env.DISCORD_GUILD_ID;
    this.commandsChId   = process.env.DISCORD_COMMANDS_CHANNEL_ID;
    this.alertsChId     = process.env.DISCORD_ALERTS_CHANNEL_ID;
    this.ownerUserId    = process.env.DISCORD_OWNER_USER_ID;

    this._handlers = [];
    this.ready = false;
  }

  // ── Connect ──────────────────────────────────────────────────────────────

  async connect() {
    if (!this.token) {
      console.warn('[Sentinel] DISCORD_BOT_TOKEN not set — Discord connector disabled.');
      return false;
    }

    this.client.once('clientReady', () => {
      this.ready = true;
      console.log(`[Sentinel] Connected as ${this.client.user.tag}`);
      this._log('INFO', 'connect', 'system', 'success', `bot=${this.client.user.tag}`);
    });

    this.client.on('messageCreate', (message) => {
      if (message.author.bot) return;

      // Ignore messages from other guilds — only respond in configured guild or DMs
      if (message.guild && message.guild.id !== this.guildId) return;

      const userRole = this._resolveRole(message.author.id, message.member);
      const event = {
        event:     'message',
        channel:   message.channel.name || 'dm',
        channel_id: message.channel.id,
        user:      message.author.tag,
        user_id:   message.author.id,
        user_role: userRole,
        content:   message.content,
        raw:       message,
      };

      this._handlers.forEach(fn => {
        try { fn(event); } catch (err) {
          console.error('[Sentinel] Handler error:', err.message);
        }
      });
    });

    this.client.on('error', (err) => {
      console.error('[Sentinel] Discord error:', err.message);
      this._log('ERROR', 'discord-error', 'system', 'failed', err.message);
    });

    await this.client.login(this.token);
    return true;
  }

  // ── Role Resolution ───────────────────────────────────────────────────────

  _resolveRole(userId, member) {
    if (userId === this.ownerUserId) return 'OWNER';
    if (member) {
      const names = member.roles.cache.map(r => r.name.toLowerCase());
      if (names.includes('admin'))  return 'ADMIN';
      if (names.includes('agent'))  return 'AGENT';
    }
    return 'MEMBER';
  }

  // ── Inbound ───────────────────────────────────────────────────────────────

  /** Register a handler for inbound messages. */
  onMessage(callback) {
    this._handlers.push(callback);
  }

  // ── Outbound ──────────────────────────────────────────────────────────────

  /** Send a message to any channel by ID. Accepts a string or full discord.js MessageCreateOptions. */
  async sendMessage(channelId, content) {
    this._assertReady();
    try {
      const channel = await this.client.channels.fetch(channelId);
      const payload = typeof content === 'string' ? { content } : content;
      const msg = await channel.send(payload);
      this._log('INFO', 'send-message', 'system', 'success', `channel=${channelId}`);
      return msg;
    } catch (err) {
      this._log('ERROR', 'send-message', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Send discord.js MessageCreateOptions (embeds, components, etc.) to a channel. */
  async send(channelId, options) {
    return this.sendMessage(channelId, options);
  }

  /** Send a DM to a user by ID. */
  async sendDM(userId, content) {
    this._assertReady();
    try {
      const user = await this.client.users.fetch(userId);
      const msg = await user.send(content);
      this._log('INFO', 'send-dm', 'system', 'success', `user=${userId}`);
      return msg;
    } catch (err) {
      this._log('ERROR', 'send-dm', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Convenience: send to #alerts channel. */
  async sendAlert(content) {
    if (!this.alertsChId) {
      console.warn('[Sentinel] DISCORD_ALERTS_CHANNEL_ID not set.');
      return;
    }
    return this.sendMessage(this.alertsChId, content);
  }

  /** Convenience: DM the OWNER. */
  async dmOwner(content) {
    if (!this.ownerUserId) {
      console.warn('[Sentinel] DISCORD_OWNER_USER_ID not set.');
      return;
    }
    return this.sendDM(this.ownerUserId, content);
  }

  // ── Moderation (Warden-gated — call only after approval) ─────────────────

  /** Delete a message. Warden-gated. */
  async deleteMessage(channelId, messageId) {
    this._assertReady();
    try {
      const channel = await this.client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      await message.delete();
      this._log('INFO', 'delete-message', 'system', 'success', `channel=${channelId} msg=${messageId}`);
    } catch (err) {
      this._log('ERROR', 'delete-message', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Kick a member. Warden-gated. */
  async kickUser(userId, reason = 'No reason provided') {
    this._assertReady();
    try {
      const guild  = await this.client.guilds.fetch(this.guildId);
      const member = await guild.members.fetch(userId);
      await member.kick(reason);
      this._log('INFO', 'kick-user', 'system', 'success', `user=${userId} reason="${reason}"`);
    } catch (err) {
      this._log('ERROR', 'kick-user', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Ban a member. Warden-gated. */
  async banUser(userId, reason = 'No reason provided') {
    this._assertReady();
    try {
      const guild = await this.client.guilds.fetch(this.guildId);
      await guild.bans.create(userId, { reason });
      this._log('INFO', 'ban-user', 'system', 'success', `user=${userId} reason="${reason}"`);
    } catch (err) {
      this._log('ERROR', 'ban-user', 'system', 'failed', err.message);
      throw err;
    }
  }

  // ── Role Management ───────────────────────────────────────────────────────

  /** List all roles in the guild. */
  async listRoles() {
    this._assertReady();
    const guild = await this.client.guilds.fetch(this.guildId);
    await guild.roles.fetch();
    return guild.roles.cache
      .filter(r => r.name !== '@everyone')
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
      .sort((a, b) => b.position - a.position);
  }

  /** Create a new guild role. */
  async createRole(name, { color = null, hoist = false, mentionable = false } = {}) {
    this._assertReady();
    try {
      const guild = await this.client.guilds.fetch(this.guildId);
      const role  = await guild.roles.create({
        name,
        ...(color ? { color } : {}),
        hoist,
        mentionable,
        reason: 'Created via Ghost portal',
      });
      this._log('INFO', 'create-role', 'system', 'success', `role="${name}" id=${role.id}`);
      return role;
    } catch (err) {
      this._log('ERROR', 'create-role', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Delete a guild role by name (case-insensitive). */
  async deleteRole(name) {
    this._assertReady();
    try {
      const guild = await this.client.guilds.fetch(this.guildId);
      await guild.roles.fetch();
      const role = guild.roles.cache.find(r => r.name.toLowerCase() === name.toLowerCase());
      if (!role) throw new Error(`Role "${name}" not found`);
      await role.delete('Deleted via Ghost portal');
      this._log('INFO', 'delete-role', 'system', 'success', `role="${name}"`);
      return role;
    } catch (err) {
      this._log('ERROR', 'delete-role', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Assign a role to a user by role name (case-insensitive). */
  async assignRole(userId, roleName) {
    this._assertReady();
    try {
      const guild  = await this.client.guilds.fetch(this.guildId);
      await guild.roles.fetch();
      const role   = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
      if (!role) throw new Error(`Role "${roleName}" not found`);
      const member = await guild.members.fetch(userId);
      await member.roles.add(role, 'Assigned via Ghost portal');
      this._log('INFO', 'assign-role', 'system', 'success', `user=${userId} role="${roleName}"`);
    } catch (err) {
      this._log('ERROR', 'assign-role', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Remove a role from a user by role name. */
  async removeRole(userId, roleName) {
    this._assertReady();
    try {
      const guild  = await this.client.guilds.fetch(this.guildId);
      await guild.roles.fetch();
      const role   = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
      if (!role) throw new Error(`Role "${roleName}" not found`);
      const member = await guild.members.fetch(userId);
      await member.roles.remove(role, 'Removed via Ghost portal');
      this._log('INFO', 'remove-role', 'system', 'success', `user=${userId} role="${roleName}"`);
    } catch (err) {
      this._log('ERROR', 'remove-role', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Delete a channel by name or ID. */
  async deleteChannel(nameOrId) {
    this._assertReady();
    try {
      const guild = await this.client.guilds.fetch(this.guildId);
      await guild.channels.fetch();
      const channel = guild.channels.cache.get(nameOrId)
        ?? guild.channels.cache.find(c => c.name.toLowerCase() === (nameOrId || '').toLowerCase());
      if (!channel) throw new Error(`Channel "${nameOrId}" not found`);
      await channel.delete('Deleted via Ghost');
      this._log('INFO', 'delete-channel', 'system', 'success', `channel="${nameOrId}"`);
      return channel;
    } catch (err) {
      this._log('ERROR', 'delete-channel', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** Timeout (mute) a member for durationMinutes. Requires MODERATE_MEMBERS permission. */
  async timeoutUser(userId, durationMinutes = 10, reason = 'Timed out by Ghost') {
    this._assertReady();
    try {
      const guild  = await this.client.guilds.fetch(this.guildId);
      const member = await guild.members.fetch(userId);
      const until  = new Date(Date.now() + durationMinutes * 60_000);
      await member.disableCommunicationUntil(until, reason);
      this._log('INFO', 'timeout-user', 'system', 'success',
        `user=${userId} duration=${durationMinutes}m reason="${reason}"`);
    } catch (err) {
      this._log('ERROR', 'timeout-user', 'system', 'failed', err.message);
      throw err;
    }
  }

  /** List members in the primary guild. Returns up to limit results. */
  async listMembers(limit = 100) {
    this._assertReady();
    const guild   = await this.client.guilds.fetch(this.guildId);
    const members = await guild.members.fetch({ limit });
    return [...members.values()].map(m => ({
      id:          m.id,
      username:    m.user.tag,
      displayName: m.displayName,
      roles:       m.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name),
      joinedAt:    m.joinedAt?.toISOString() ?? null,
    })).sort((a, b) => a.username.localeCompare(b.username));
  }

  /** Find a guild member by username, display name, or @mention snowflake. */
  async findMemberByName(query) {
    this._assertReady();
    const guild   = await this.client.guilds.fetch(this.guildId);
    const members = await guild.members.fetch();
    const lower   = (query || '').toLowerCase().replace(/[<@!>]/g, '');
    // Try ID match first (from mention extraction)
    const byId = members.get(lower);
    if (byId) {
      return {
        id:          byId.id,
        username:    byId.user.tag,
        displayName: byId.displayName,
        roles:       byId.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name),
      };
    }
    const found = members.find(m =>
      m.user.username.toLowerCase().includes(lower) ||
      m.displayName.toLowerCase().includes(lower) ||
      m.user.tag.toLowerCase().includes(lower)
    );
    if (!found) return null;
    return {
      id:          found.id,
      username:    found.user.tag,
      displayName: found.displayName,
      roles:       found.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name),
    };
  }

  /**
   * Return data for all guilds the bot is currently in.
   * Used by the Servers page — read-only, cross-guild.
   */
  async listGuilds() {
    this._assertReady();
    const result = [];
    for (const [, guild] of this.client.guilds.cache) {
      try {
        const full = await guild.fetch();
        await full.roles.fetch();
        const roles = full.roles.cache
          .filter(r => r.name !== '@everyone')
          .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
          .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
        const channels = [...full.channels.cache.values()]
          .filter(c => [0, 2, 15].includes(c.type))
          .map(c => ({
            id:   c.id,
            name: c.name,
            type: c.type === 0 ? 'text' : c.type === 2 ? 'voice' : 'forum',
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        result.push({
          id:          full.id,
          name:        full.name,
          icon:        full.iconURL({ size: 128 }) ?? null,
          memberCount: full.memberCount,
          botJoinedAt: full.joinedAt?.toISOString() ?? null,
          isPrimary:   full.id === this.guildId,
          channels,
          roles,
          features:    [...(full.features ?? [])],
        });
      } catch (err) {
        this._log('WARN', 'list-guilds', 'system', 'partial-fail', `guild=${guild.id} err=${err.message}`);
      }
    }
    // Primary guild first
    result.sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
    return result;
  }

  /** Create a text channel. */
  async createChannel(name, { topic = '', categoryId = null } = {}) {
    this._assertReady();
    try {
      const guild   = await this.client.guilds.fetch(this.guildId);
      const { ChannelType } = require('discord.js');
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        ...(topic ? { topic } : {}),
        ...(categoryId ? { parent: categoryId } : {}),
        reason: 'Created via Ghost portal',
      });
      this._log('INFO', 'create-channel', 'system', 'success', `channel="${name}" id=${channel.id}`);
      return channel;
    } catch (err) {
      this._log('ERROR', 'create-channel', 'system', 'failed', err.message);
      throw err;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _assertReady() {
    if (!this.ready) throw new Error('[Sentinel] Discord client not connected yet.');
  }

  _log(level, action, userRole, outcome, note) {
    const entry = `[${level}] ${new Date().toISOString()} | agent=Sentinel | action=${action} | user_role=${userRole} | model=discord.js | outcome=${outcome} | escalated=false | note="${note}"\n`;
    try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
  }
}

module.exports = new DiscordConnector();
