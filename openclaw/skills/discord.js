'use strict';

/**
 * Discord Connector — STUB
 *
 * OpenClaw now owns the Discord gateway connection (port 18789).
 * This stub preserves the module interface so existing require() calls
 * don't crash, but all operations gracefully no-op since ready=false.
 *
 * Modules that still reference this: discordAdminHandler, warden, scribe.
 * Their code checks `discord.ready` before calling methods.
 */

const noop = async () => {};

module.exports = {
  ready: false,
  connect: noop,
  onMessage: () => {},
  sendMessage: noop,
  send: noop,
  sendDM: noop,
  sendAlert: noop,
  dmOwner: noop,
  deleteMessage: noop,
  kickUser: noop,
  banUser: noop,
  listRoles: async () => [],
  createRole: noop,
  deleteRole: noop,
  assignRole: noop,
  removeRole: noop,
  deleteChannel: noop,
  closeChannel: async () => false,
  timeoutUser: noop,
  listMembers: async () => [],
  findMemberByName: async () => null,
  listGuilds: async () => [],
  createChannel: noop,
  fetchChannelHistory: async () => [],
  getChannelInfo: async () => null,
};
