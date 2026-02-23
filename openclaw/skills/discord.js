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

    this.client.once('ready', () => {
      this.ready = true;
      console.log(`[Sentinel] Connected as ${this.client.user.tag}`);
      this._log('INFO', 'connect', 'system', 'success', `bot=${this.client.user.tag}`);
    });

    this.client.on('messageCreate', (message) => {
      if (message.author.bot) return;

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

  /** Send a message to any channel by ID. */
  async sendMessage(channelId, content) {
    this._assertReady();
    try {
      const channel = await this.client.channels.fetch(channelId);
      const msg = await channel.send(content);
      this._log('INFO', 'send-message', 'system', 'success', `channel=${channelId}`);
      return msg;
    } catch (err) {
      this._log('ERROR', 'send-message', 'system', 'failed', err.message);
      throw err;
    }
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
