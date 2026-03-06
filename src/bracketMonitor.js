'use strict';

/**
 * Bracket Monitor — Tournament game mediator.
 *
 * Monitors bracket match Discord channels, helps teams schedule game times,
 * and escalates when teams are unresponsive.
 *
 * State is persisted to Redis so it survives PM2 restarts.
 *
 * Escalation state machine:
 *   NEW → (12h no comms) → PINGED → (12h no response) → ESCALATED
 *   ESCALATED → (12h more) → FORFEIT_SUGGESTED
 *   Any state → human message → ACTIVE
 *   ACTIVE → both teams confirm → SCHEDULED
 *   ACTIVE → 12h silence → re-escalate from PINGED
 *   ACTIVE → 4h one-sided → DM the silent captain
 *   SCHEDULED → 1h before game → PRE_GAME_REMINDER
 *   SCHEDULED → game time passed + activity → POST_GAME (no more AI)
 */

const leagueDb = require('./skills/league-db');
const deepseek = require('./skills/deepseek');
const memory   = require('./skills/memory');
const db       = require('./db');
const redis    = require('./redis');
const registry = require('./agentRegistry');

const BOT_ID   = process.env.DISCORD_APP_ID || '';
const OWNER_ID = process.env.DISCORD_OWNER_USER_ID || '';

// Escalation states
const State = {
  NEW:               'NEW',
  PINGED:            'PINGED',
  ESCALATED:         'ESCALATED',
  FORFEIT_SUGGESTED: 'FORFEIT_SUGGESTED',
  ACTIVE:            'ACTIVE',
  SCHEDULED:         'SCHEDULED',
  REMINDED:          'REMINDED',
  POST_GAME:         'POST_GAME',       // teams are playing or played — no AI intervention
  REPORT_REQUESTED:  'REPORT_REQUESTED', // 8h after scheduled time — asked teams to report
};

// Timings (ms)
const PING_AFTER           = 12 * 60 * 60 * 1000;  // 12 hours before first ping
const ESCALATE_AFTER       = 12 * 60 * 60 * 1000;  // 12 hours after ping → escalate
const FORFEIT_AFTER        = 12 * 60 * 60 * 1000;  // 12 hours after escalation → forfeit
const REESCALATE_AFTER     = 12 * 60 * 60 * 1000;  // 12 hours silence in ACTIVE → re-ping
const DM_INACTIVE_AFTER    = 4 * 60 * 60 * 1000;   // 4 hours one-sided → DM silent captain
const PREGAME_REMINDER     = 60 * 60 * 1000;        // 1 hour before scheduled time
const AI_COOLDOWN          = 3 * 60 * 1000;          // 3 minutes between AI responses per channel
const MAX_FAILURES         = 5;
let _polling = false;
let _intervalPoll = null;
let _intervalScan = null;

// Active bracket channels: channelId → { matchId, team1, team2, escalationState, ... }
const _channels = new Map();
let _broadcast = () => {};

const REDIS_PREFIX = 'bracket:state:';

// ── Redis state persistence ───────────────────────────────────────────────────

async function _saveState(channelId, data) {
  const state = {
    escalationState:  data.escalationState,
    scheduledTime:    data.scheduledTime || '',
    scheduledTimeISO: data.scheduledTimeISO || '',
    lastActivityAt:   data.lastActivityAt || 0,
    lastEscalationAt: data.lastEscalationAt || 0,
    lastAiResponseAt: data.lastAiResponseAt || 0,
    lastMessageId:    data.lastMessageId || '',
    team1LastSeen:    data.team1LastSeen || 0,
    team2LastSeen:    data.team2LastSeen || 0,
    dmSentTo:         data.dmSentTo || '',
  };
  await redis.set(`${REDIS_PREFIX}${channelId}`, JSON.stringify(state), 7 * 24 * 3600).catch(() => {});
}

async function _loadState(channelId) {
  const raw = await redis.get(`${REDIS_PREFIX}${channelId}`).catch(() => null);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function _clearState(channelId) {
  await redis.del(`${REDIS_PREFIX}${channelId}`).catch(() => {});
}

// ── Discord REST helpers ──────────────────────────────────────────────────────

async function discordApi(method, path, body) {
  const token = process.env.DISCORD_BOT_TOKEN;
  const opts = {
    method,
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://discord.com/api/v10${path}`, opts);
  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
    console.warn(`[BracketMonitor] Discord 429 on ${method} ${path} (retry-after: ${retryAfter}s)`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return fetch(`https://discord.com/api/v10${path}`, opts); // one retry
  }
  return res;
}

async function getChannelMessages(channelId, afterId, limit = 10) {
  const qs = afterId ? `?after=${afterId}&limit=${limit}` : `?limit=${limit}`;
  const res = await discordApi('GET', `/channels/${channelId}/messages${qs}`);
  if (!res.ok) return null;
  return res.json();
}

async function sendMessage(channelId, content) {
  const res = await discordApi('POST', `/channels/${channelId}/messages`, { content });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[BracketMonitor] Send failed (${channelId}): ${res.status} ${err}`);
    return null;
  }
  return res.json();
}

async function sendDM(userId, content) {
  const dmRes = await discordApi('POST', '/users/@me/channels', { recipient_id: userId });
  if (!dmRes.ok) return null;
  const dm = await dmRes.json();
  return sendMessage(dm.id, content);
}

async function sendTyping(channelId) {
  await discordApi('POST', `/channels/${channelId}/typing`).catch(() => {});
}

// ── Channel registration ──────────────────────────────────────────────────────

async function registerChannel(match) {
  if (!match.chatChannelId) return;
  if (_channels.has(match.chatChannelId)) return;

  const now = Date.now();

  // Try to restore state from Redis (survives restarts)
  const saved = await _loadState(match.chatChannelId);

  _channels.set(match.chatChannelId, {
    matchId:          match.matchId,
    matchNumber:      match.matchNumber,
    team1:            match.team1,
    team2:            match.team2,
    bracket:          match.bracket,
    round:            match.round,
    season:           match.season,
    league:           match.league,
    escalationState:  saved?.escalationState  || State.NEW,
    firstSeenAt:      now,
    lastActivityAt:   saved?.lastActivityAt   || now,
    lastEscalationAt: saved?.lastEscalationAt || null,
    lastAiResponseAt: saved?.lastAiResponseAt || now, // grace period on boot
    lastMessageId:    saved?.lastMessageId    || null,
    scheduledTime:    saved?.scheduledTime    || null,
    scheduledTimeISO: saved?.scheduledTimeISO || null,
    team1LastSeen:    saved?.team1LastSeen    || 0,
    team2LastSeen:    saved?.team2LastSeen    || 0,
    dmSentTo:         saved?.dmSentTo         || '',
    _failures:        0,
  });
}

// ── Initial greeting ──────────────────────────────────────────────────────────

async function sendInitialGreeting(channelId, data) {
  const { team1, team2, bracket, round, matchNumber } = data;

  // Check last 30 messages for existing bot messages (covers restart scenarios)
  const existing = await getChannelMessages(channelId, null, 30).catch(() => null);
  if (existing?.some(m => m.author?.id === BOT_ID)) {
    // Already greeted — just seed lastMessageId
    data.lastMessageId = existing[0]?.id || null;
    data.lastAiResponseAt = Date.now();
    return;
  }

  // Also skip greeting if there's recent human activity (within 6h)
  if (existing?.length) {
    const newestHumanMsg = existing.find(m => !m.author?.bot);
    if (newestHumanMsg) {
      const msgTime = new Date(newestHumanMsg.timestamp).getTime();
      if (Date.now() - msgTime < 6 * 60 * 60 * 1000) {
        // Humans active recently — don't re-greet, just seed
        data.lastMessageId = existing[0]?.id || null;
        data.escalationState = State.ACTIVE;
        data.lastActivityAt = Date.now();
        _saveState(channelId, data);
        return;
      }
    }
  }

  const mentions = [];
  if (team1.captainDiscordId) mentions.push(`<@${team1.captainDiscordId}>`);
  if (team2.captainDiscordId) mentions.push(`<@${team2.captainDiscordId}>`);

  const lines = [
    `**${bracket} — ${round} (Match #${matchNumber})**`,
    '',
    `**${team1.name}** vs **${team2.name}**`,
    '',
    `What's up captains, I'm Ghost — your match coordinator. Use this channel to work out a game time. Once both sides agree on a time, I'll lock it in automatically.`,
    '',
    `If anything comes up (scheduling issues, no-shows, disputes), just say so here and I'll help sort it out.`,
  ];

  if (mentions.length) {
    lines.push('', mentions.join(' '));
  }

  const sent = await sendMessage(channelId, lines.join('\n'));
  if (sent) {
    data.lastMessageId = sent.id;
    data.lastAiResponseAt = Date.now();
    _saveState(channelId, data);
    db.logEntry({
      level: 'INFO', agent: 'ghost', action: 'bracket:greeting',
      outcome: 'sent',
      note: `Match #${matchNumber}: ${team1.name} vs ${team2.name} in ${channelId}`,
    }).catch(() => {});
  }
}

// ── One-sided activity check ─────────────────────────────────────────────────

/**
 * Check if one captain is active but the other hasn't responded.
 * After DM_INACTIVE_AFTER (4h), DM the silent captain and note in chat.
 */
async function checkOneSidedActivity(channelId, data) {
  const now = Date.now();
  if (data.escalationState !== State.ACTIVE) return false;

  const t1Seen = data.team1LastSeen || 0;
  const t2Seen = data.team2LastSeen || 0;

  // Need at least one captain to have been seen
  if (!t1Seen && !t2Seen) return false;

  // Determine active vs silent
  let activeTeam = null;
  let silentTeam = null;

  if (t1Seen && (!t2Seen || now - t2Seen >= DM_INACTIVE_AFTER) && now - t1Seen < DM_INACTIVE_AFTER) {
    activeTeam = data.team1;
    silentTeam = data.team2;
  } else if (t2Seen && (!t1Seen || now - t1Seen >= DM_INACTIVE_AFTER) && now - t2Seen < DM_INACTIVE_AFTER) {
    activeTeam = data.team2;
    silentTeam = data.team1;
  }

  if (!activeTeam || !silentTeam) return false;
  if (!silentTeam.captainDiscordId) return false;

  // Don't DM the same captain repeatedly
  if (data.dmSentTo === silentTeam.captainDiscordId) return false;

  // DM the silent captain
  const dmText = [
    `Hey! Your bracket match **${data.team1.name}** vs **${data.team2.name}** (${data.bracket} — ${data.round}) needs scheduling.`,
    `**${activeTeam.name}** has been trying to coordinate in the match channel. Please respond in <#${channelId}> so you can get a game time locked in.`,
  ].join('\n');

  const dmSent = await sendDM(silentTeam.captainDiscordId, dmText).catch(() => null);

  // Note in the channel
  const chatMsg = `I've sent a DM to **${silentTeam.name}**'s captain to check in. Waiting on their response.`;
  const sent = await sendMessage(channelId, chatMsg);
  if (sent) {
    data.lastMessageId = sent.id;
    data.lastAiResponseAt = Date.now();
  }

  data.dmSentTo = silentTeam.captainDiscordId;
  _saveState(channelId, data);

  db.logEntry({
    level: 'INFO', agent: 'ghost', action: 'bracket:dm-inactive',
    outcome: dmSent ? 'dm-sent' : 'dm-failed',
    note: `Match #${data.matchNumber}: DMed ${silentTeam.name} captain (${activeTeam.name} active, ${silentTeam.name} silent for ${Math.round((now - (silentTeam === data.team1 ? t1Seen : t2Seen)) / 3600000)}h)`,
  }).catch(() => {});

  return true;
}

// ── Escalation state machine ──────────────────────────────────────────────────

async function checkEscalation(channelId, data) {
  const now = Date.now();
  const sinceLast = now - (data.lastActivityAt || data.firstSeenAt);
  const sinceEscalation = data.lastEscalationAt ? (now - data.lastEscalationAt) : Infinity;

  // SCHEDULED — check for pre-game reminder or transition to POST_GAME
  if (data.escalationState === State.SCHEDULED && (data.scheduledTimeISO || data.scheduledTime)) {
    const scheduled = data.scheduledTimeISO ? new Date(data.scheduledTimeISO) : _parseScheduledTime(data.scheduledTime);
    if (scheduled && !isNaN(scheduled.getTime())) {
      const timeUntilGame = scheduled.getTime() - now;

      // Pre-game reminder: within 1h of game time and haven't reminded yet
      if (timeUntilGame > 0 && timeUntilGame <= PREGAME_REMINDER) {
        data.escalationState = State.REMINDED;
        const mentions = [];
        if (data.team1.captainDiscordId) mentions.push(`<@${data.team1.captainDiscordId}>`);
        if (data.team2.captainDiscordId) mentions.push(`<@${data.team2.captainDiscordId}>`);

        const msg = [
          `🏀 **Game Time Approaching — Match #${data.matchNumber}**`,
          '',
          `**${data.team1.name}** vs **${data.team2.name}**`,
          `Scheduled: **${data.scheduledTime}**`,
          '',
          `${mentions.join(' ')} — your game is coming up soon. Make sure both teams are ready!`,
        ].join('\n');

        const sent = await sendMessage(channelId, msg);
        if (sent) data.lastMessageId = sent.id;
        _saveState(channelId, data);

        db.logEntry({
          level: 'INFO', agent: 'ghost', action: 'bracket:pre-game-reminder',
          outcome: 'sent', note: `Match #${data.matchNumber}: 1hr reminder for ${data.scheduledTime}`,
        }).catch(() => {});
        return;
      }

      // 30 min after scheduled time — go silent (POST_GAME)
      if (timeUntilGame < -30 * 60 * 1000) {
        data.escalationState = State.POST_GAME;
        _saveState(channelId, data);
        return;
      }
    }
    return; // Don't escalate while SCHEDULED
  }

  // REMINDED → game time passed → POST_GAME
  if (data.escalationState === State.REMINDED && (data.scheduledTimeISO || data.scheduledTime)) {
    const scheduled = data.scheduledTimeISO ? new Date(data.scheduledTimeISO) : _parseScheduledTime(data.scheduledTime);
    if (scheduled && !isNaN(scheduled.getTime()) && now - scheduled.getTime() > 30 * 60 * 1000) {
      data.escalationState = State.POST_GAME;
      _saveState(channelId, data);
      return;
    }
    return; // Don't escalate while REMINDED
  }

  // POST_GAME → 8h after scheduled time → ping captains to report
  if (data.escalationState === State.POST_GAME && (data.scheduledTimeISO || data.scheduledTime)) {
    const scheduled = data.scheduledTimeISO ? new Date(data.scheduledTimeISO) : _parseScheduledTime(data.scheduledTime);
    if (scheduled && !isNaN(scheduled.getTime()) && now - scheduled.getTime() >= 8 * 60 * 60 * 1000) {
      data.escalationState = State.REPORT_REQUESTED;
      _saveState(channelId, data);
      await requestGameReport(channelId, data);
      return;
    }
    return;
  }

  // REPORT_REQUESTED — terminal
  if (data.escalationState === State.REPORT_REQUESTED) return;

  // FORFEIT_SUGGESTED — terminal
  if (data.escalationState === State.FORFEIT_SUGGESTED) return;

  // ESCALATED → 12h more silence → FORFEIT_SUGGESTED
  if (data.escalationState === State.ESCALATED && sinceEscalation >= FORFEIT_AFTER) {
    data.escalationState = State.FORFEIT_SUGGESTED;
    data.lastEscalationAt = now;
    await suggestForfeit(channelId, data);
    _saveState(channelId, data);
    return;
  }

  // ACTIVE → check one-sided activity (4h) before full re-escalation
  if (data.escalationState === State.ACTIVE) {
    // One-sided check: one captain active, other silent for 4h → DM
    const handled = await checkOneSidedActivity(channelId, data);
    if (handled) return;

    // Full silence: 12h → re-escalate
    if (sinceLast >= REESCALATE_AFTER) {
      data.escalationState = State.PINGED;
      data.lastEscalationAt = now;
      await pingCaptains(channelId, data, 'No scheduling update in the last 12 hours. Can we get a time locked in?');
      _saveState(channelId, data);
      return;
    }
    return;
  }

  // NEW → 12h no comms → PINGED
  if (data.escalationState === State.NEW && sinceLast >= PING_AFTER) {
    data.escalationState = State.PINGED;
    data.lastEscalationAt = now;
    await pingCaptains(channelId, data, 'No response yet — please coordinate your match time here.');
    _saveState(channelId, data);
    return;
  }

  // PINGED → 12h after ping → ESCALATED
  if (data.escalationState === State.PINGED && sinceEscalation >= ESCALATE_AFTER) {
    data.escalationState = State.ESCALATED;
    data.lastEscalationAt = now;
    await escalateToAdmin(channelId, data);
    _saveState(channelId, data);
    return;
  }
}

async function pingCaptains(channelId, data, reason) {
  // Check recent messages to see which captains have responded
  const recentMsgs = await getChannelMessages(channelId, null, 30).catch(() => null);
  const recentHumanIds = new Set();
  if (recentMsgs) {
    // Only count messages from last 24h as "recent activity"
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const m of recentMsgs) {
      if (m.author?.bot) continue;
      if (new Date(m.timestamp).getTime() > cutoff) {
        recentHumanIds.add(m.author.id);
      }
    }
  }

  // Only ping captains who haven't responded recently
  const mentions = [];
  const silentTeams = [];
  for (const team of [data.team1, data.team2]) {
    if (team.captainDiscordId && !recentHumanIds.has(team.captainDiscordId)) {
      mentions.push(`<@${team.captainDiscordId}>`);
      silentTeams.push(team.name);
    }
  }

  // If both captains responded recently, skip the ping
  if (!mentions.length) return;

  const msg = `${mentions.join(' ')} — ${reason}`;
  const sent = await sendMessage(channelId, msg);
  if (sent) data.lastMessageId = sent.id;

  db.logEntry({
    level: 'INFO', agent: 'ghost', action: 'bracket:ping',
    outcome: 'sent', note: `Match #${data.matchNumber}: pinged ${silentTeams.join(', ')} (${data.escalationState})`,
  }).catch(() => {});
}

async function escalateToAdmin(channelId, data) {
  const ownerMention = OWNER_ID ? `<@${OWNER_ID}>` : 'Admin';

  // Identify which team(s) are silent
  const t1Seen = data.team1LastSeen || 0;
  const t2Seen = data.team2LastSeen || 0;
  let silentNote = 'No response from either team';
  if (t1Seen && !t2Seen) silentNote = `**${data.team2.name}** has not responded`;
  else if (t2Seen && !t1Seen) silentNote = `**${data.team1.name}** has not responded`;

  const msg = [
    `**Escalation — Match #${data.matchNumber}**`,
    `${data.team1.name} vs ${data.team2.name} (${data.bracket} — ${data.round})`,
    '',
    `${silentNote} after 24+ hours. ${ownerMention} — this match may need manual intervention.`,
  ].join('\n');

  const sent = await sendMessage(channelId, msg);
  if (sent) data.lastMessageId = sent.id;

  db.logEntry({
    level: 'WARN', agent: 'ghost', action: 'bracket:escalate',
    outcome: 'admin-notified', note: `Match #${data.matchNumber}: escalated to admin`,
  }).catch(() => {});

  registry.pushEvent('ghost', `Bracket match #${data.matchNumber} escalated — no response from teams`, 'warn');
}

async function suggestForfeit(channelId, data) {
  const ownerMention = OWNER_ID ? `<@${OWNER_ID}>` : 'Admin';

  // Determine which team to recommend forfeit for
  const t1Seen = data.team1LastSeen || 0;
  const t2Seen = data.team2LastSeen || 0;

  let forfeitTeam, activeTeam, recommendation;
  if (t1Seen && !t2Seen) {
    activeTeam = data.team1;
    forfeitTeam = data.team2;
  } else if (t2Seen && !t1Seen) {
    activeTeam = data.team2;
    forfeitTeam = data.team1;
  } else if (t1Seen && t2Seen) {
    activeTeam = t1Seen > t2Seen ? data.team1 : data.team2;
    forfeitTeam = t1Seen > t2Seen ? data.team2 : data.team1;
  }

  if (forfeitTeam) {
    recommendation = `**${activeTeam.name}** has been trying to schedule. **${forfeitTeam.name}** has not responded. **${forfeitTeam.name}** should be forfeited.`;
  } else {
    recommendation = `Neither team has responded. Both teams should be forfeited.`;
  }

  const msg = [
    `⚠️ **Forfeit — Match #${data.matchNumber}**`,
    '',
    `**${data.team1.name}** vs **${data.team2.name}**`,
    `${data.bracket} — ${data.round}`,
    '',
    recommendation,
    '',
    `${ownerMention}`,
  ].join('\n');

  const sent = await sendMessage(channelId, msg);
  if (sent) data.lastMessageId = sent.id;

  db.logEntry({
    level: 'WARN', agent: 'ghost', action: 'bracket:forfeit-suggested',
    outcome: 'admin-notified',
    note: `Match #${data.matchNumber}: forfeit recommended after extended no-response`,
  }).catch(() => {});

  registry.pushEvent('ghost', `Bracket match #${data.matchNumber}: forfeit recommended`, 'warn');
}

async function requestGameReport(channelId, data) {
  const mentions = [];
  if (data.team1.captainDiscordId) mentions.push(`<@${data.team1.captainDiscordId}>`);
  if (data.team2.captainDiscordId) mentions.push(`<@${data.team2.captainDiscordId}>`);

  const msg = [
    `📋 **Game Report Needed — Match #${data.matchNumber}**`,
    '',
    `**${data.team1.name}** vs **${data.team2.name}**`,
    `${data.bracket} — ${data.round}`,
    '',
    `Your game was scheduled for **${data.scheduledTime}**. Please report the result using the match embed at the top of this channel.`,
    '',
    mentions.length ? `${mentions.join(' ')} — submit your scores so the bracket can advance.` : 'Captains — submit your scores so the bracket can advance.',
  ].join('\n');

  const sent = await sendMessage(channelId, msg);
  if (sent) data.lastMessageId = sent.id;

  db.logEntry({
    level: 'INFO', agent: 'ghost', action: 'bracket:report-request',
    outcome: 'sent', note: `Match #${data.matchNumber}: requested game report (8h after ${data.scheduledTime})`,
  }).catch(() => {});

  registry.pushEvent('ghost', `Bracket match #${data.matchNumber}: requested game report`, 'info');
}

/**
 * Get current time in ET (Eastern Time) as a Date object.
 */
function _nowET() {
  // Build a Date whose UTC fields represent ET wall-clock time
  const str = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(str);
}

/**
 * Try to parse a scheduled time string into a Date (in ET).
 * Handles: "tonight at 9", "tomorrow 8pm", "3/5 at 7pm", "now", ISO strings, etc.
 */
function _parseScheduledTime(timeStr) {
  if (!timeStr) return null;

  // If it's already an ISO string, return directly
  if (/^\d{4}-\d{2}-\d{2}T/.test(timeStr)) {
    const d = new Date(timeStr);
    return isNaN(d.getTime()) ? null : d;
  }

  const lower = timeStr.toLowerCase().trim();
  const now = _nowET();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // "now" / "rn" / "right now"
  if (/^(now|rn|right now|lets go|run it)$/i.test(lower)) {
    return new Date(now.getTime() + 5 * 60 * 1000);
  }

  // Date pattern: "3/5 at 7pm", "3/5 7pm", "03/05 at 7:30pm"
  const dateMatch = lower.match(/(\d{1,2})\/(\d{1,2})(?:\s+(?:at\s+)?(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?)?/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1]) - 1;
    const day = parseInt(dateMatch[2]);
    let hour = dateMatch[3] ? parseInt(dateMatch[3]) : 19; // default 7pm
    const minutes = parseInt(dateMatch[4] || '0');
    const ampm = dateMatch[5];

    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (!ampm && hour >= 1 && hour <= 8) hour += 12;

    let year = now.getFullYear();
    const date = new Date(year, month, day, hour, minutes, 0, 0);
    // If the date is more than 30 days in the past, assume next year
    if (date.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
      date.setFullYear(year + 1);
    }
    return date;
  }

  // Extract hour from common patterns: "tonight at 9", "tomorrow 8pm", "9pm", "7:30"
  const hourMatch = lower.match(/(\d{1,2})\s*(?::(\d{2}))?\s*(am|pm)?/);
  if (!hourMatch) return null;

  let hour = parseInt(hourMatch[1]);
  const minutes = parseInt(hourMatch[2] || '0');
  const ampm = hourMatch[3];

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (!ampm && hour >= 1 && hour <= 8) hour += 12;

  let date = new Date(today);
  date.setHours(hour, minutes, 0, 0);

  if (lower.includes('tomorrow')) {
    date.setDate(date.getDate() + 1);
  } else if (lower.includes('tonight') && date < now) {
    return null;
  } else if (date < now) {
    date.setDate(date.getDate() + 1);
  }

  return date;
}

// ── Message intent classifier ─────────────────────────────────────────────────
//
// Pre-filters messages BEFORE calling the AI. A human coordinator instinctively
// knows which messages need attention — this replicates that instinct locally.
//
// Returns: 'RESPOND' | 'SKIP' | 'SCHEDULE_CHECK'
//   RESPOND        → definitely call AI (question, problem, dispute, help request)
//   SKIP           → definitely don't call AI (banter, acks, casual chat)
//   SCHEDULE_CHECK → might be a schedule confirmation — call AI to check

function classifyMessage(text, allBatchMessages, data) {
  if (!text) return 'SKIP';
  const t = text.trim();
  const lower = t.toLowerCase();

  // ── Definite SKIP — noise, banter, acknowledgments ──

  // Emoji-only or very short non-question
  if (/^[\p{Emoji}\s]+$/u.test(t)) return 'SKIP';
  if (t.length <= 3 && !t.includes('?')) return 'SKIP';

  // Common acknowledgments that never need Ghost
  const acks = /^(ok|okay|bet|aight|aight bet|cool|fasho|facts|yep|yea|yeah|yessir|nah|no|lol|lmao|lmfao|😂|💀|🤣|gg|ggs|good game|glhf|gl|word|true|fr|say less|less|ight|gotchu|got it|copy|heard|yo|sup|wsg|bro|bruh|man|dawg|ngl|smh|idk|idc|mb|my bad|np|no prob|all good|fosho|sheesh|fire|goated|tuff|valid|w|l|dub|tough|good luck|good looks)$/i;
  if (acks.test(lower)) return 'SKIP';

  // Just a gamertag or @mention with no question/context
  if (/^<@!?\d+>$/.test(t)) return 'SKIP';

  // Simple greetings
  if (/^(hey|hi|hello|wassup|what's good|whats good|sup|yo what's up|waddup)[\s!.]*$/i.test(lower)) return 'SKIP';

  // ── Definite RESPOND — someone needs help ──

  // Direct questions (contains ?)
  const hasQuestion = t.includes('?');

  // Question-word openers
  const questionOpener = /^(how|what|when|where|who|why|can|do|does|is|are|will|would|should|could|did|has|have|which)\b/i.test(lower);

  // Help / confusion signals
  const helpSignals = /\b(help|confused|don't know|dont know|not sure|what do i do|how does|how do i|idk what|no idea|need help|can someone|anyone know|explain|lost|stuck)\b/i;

  // Problem / issue reports
  const problemSignals = /\b(lag(ged|ging)?|disconnect(ed)?|crashed|kicked|frozen|no[- ]?show|didn'?t show|won'?t respond|not responding|ghosting|ghosted|can'?t join|can'?t connect|error|glitch|bug|broken|issue|problem)\b/i;

  // Disputes / conflict
  const disputeSignals = /\b(cheat(ing|ed|er)?|wrong score|score(s)? (is|are|was) wrong|that'?s not right|not right|dispute|unfair|lie|lying|cap|bs|bull|rigged|sus|sketchy|proof|screenshot|clip|evidence)\b/i;

  // Process / league questions
  const processSignals = /\b(report score|submit score|how (do|to) (report|submit)|forfeit|extension|reschedule|deadline|what happens if|what'?s the rule|rule(s)?|format|best of|series|server|east|west|which server|overtime|restart|spread)\b/i;

  // Frustration directed at the process/situation (not just trash talk)
  const frustrationSignals = /\b(this is (bs|bull|trash|ridiculous)|wtf is (going on|happening)|no one('?s| is) respond|been waiting|still waiting|how long|waste of time|tired of)\b/i;

  // Someone saying the other team isn't cooperating
  const unresponsiveSignals = /\b(they (won'?t|aren'?t|not|never) (respond|reply|answer|schedule|show)|other team (won'?t|isn'?t|not)|can'?t (reach|get ahold|contact)|no response from)\b/i;

  if (helpSignals.test(lower) || problemSignals.test(lower) || disputeSignals.test(lower) ||
      processSignals.test(lower) || frustrationSignals.test(lower) || unresponsiveSignals.test(lower)) {
    return 'RESPOND';
  }

  // Direct question with substance (not just "?")
  if (hasQuestion && t.length > 10) return 'RESPOND';
  if (questionOpener && t.length > 15) return 'RESPOND';

  // ── SCHEDULE_CHECK — might be confirming a time, let AI evaluate ──

  // Time-related words — could be proposing or confirming a game time
  const timeSignals = /\b(tonight|tomorrow|now|rn|right now|run it|let'?s go|ready|9(pm)?|10(pm)?|8(pm)?|7(pm)?|6(pm)?|11(pm)?|\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)|today|this evening|after work|later|what time|wtw|when we playing|when you free|wya)\b/i;

  // Game-activity signals — might mean they're starting
  const gameSignals = /\b(searching|loading|we('re| are)?\s*(ready|on|in|5|here)|got 5|squad up|invite|park|rec|send invite|join|lobby|code|5 (in|up|on)|running it|hopping on|getting on)\b/i;

  if (timeSignals.test(lower)) return 'SCHEDULE_CHECK';
  if (gameSignals.test(lower)) return 'SCHEDULE_CHECK';

  // Confirmations that might lock a schedule — "bet" was caught as ACK above,
  // but "bet [time]" or "bet we can do 9" is different
  if (/\b(bet|works|lock it|sounds good|down|im? down|that works|we good|perfect|confirmed)\b/i.test(lower) && t.length > 8) {
    return 'SCHEDULE_CHECK';
  }

  // ── SKIP by default — if nothing above matched, it's probably casual chat ──
  return 'SKIP';
}

/**
 * Determine if Ghost should engage based on conversation tempo.
 * If both teams are actively chatting (both seen in last 5 min), only engage for RESPOND.
 * If conversation is one-sided or stale, also engage for SCHEDULE_CHECK.
 */
function shouldEngageForMaybe(data) {
  const now = Date.now();
  const ACTIVE_WINDOW = 5 * 60 * 1000; // 5 minutes
  const t1Active = data.team1LastSeen && (now - data.team1LastSeen) < ACTIVE_WINDOW;
  const t2Active = data.team2LastSeen && (now - data.team2LastSeen) < ACTIVE_WINDOW;

  // Both teams chatting actively — they're handling it, skip SCHEDULE_CHECK
  if (t1Active && t2Active) return false;

  // Otherwise, one-sided or stale — engage to check schedule confirmations
  return true;
}

// ── AI mediation for user messages ────────────────────────────────────────────

async function handleUserMessage(channelId, messages, latest, data) {
  // POST_GAME / REPORT_REQUESTED — teams are playing/played, no AI intervention
  if (data.escalationState === State.POST_GAME || data.escalationState === State.REPORT_REQUESTED) return;

  // SCHEDULED or REMINDED — check if teams are starting the game, otherwise stay quiet
  if (data.escalationState === State.SCHEDULED || data.escalationState === State.REMINDED) {
    data.lastActivityAt = Date.now();
    // Detect game-start signals → transition to POST_GAME automatically
    const gameStart = /\b(we('re| are)?\s*(5|five|ready|in|on|here|searching|loading)|got 5|squad up|5 (in|up|on)|searching|loading (in|up)|running it|hopping on|let'?s go|game started|playing now|in the lobby)\b/i;
    if (gameStart.test(latest.content || '')) {
      data.escalationState = State.POST_GAME;
      _saveState(channelId, data);
    }
    return;
  }

  // Transition to ACTIVE on any human message
  data.escalationState = State.ACTIVE;
  data.lastActivityAt = Date.now();

  // Track per-team activity
  const authorId = latest.author?.id;
  if (authorId && data.team1.captainDiscordId === authorId) {
    data.team1LastSeen = Date.now();
  } else if (authorId && data.team2.captainDiscordId === authorId) {
    data.team2LastSeen = Date.now();
  }

  _saveState(channelId, data);

  // ── Intent classification — decide BEFORE calling AI ──
  const intent = classifyMessage(latest.content, messages, data);

  if (intent === 'SKIP') return;

  if (intent === 'SCHEDULE_CHECK' && !shouldEngageForMaybe(data)) return;

  // Rate limit — 3 min cooldown (checked after classification so state tracking still runs)
  if (data.lastAiResponseAt && (Date.now() - data.lastAiResponseAt) < AI_COOLDOWN) return;

  // Build context
  const now = new Date();
  const dateStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });

  const contextParts = [
    `Current date/time: ${dateStr}`,
    `Bracket match #${data.matchNumber}: ${data.team1.name} vs ${data.team2.name}`,
    `${data.bracket} — ${data.round} | ${data.season} | ${data.league}`,
    `Current state: ${data.escalationState}`,
  ];

  if (data.team1.captainGt) contextParts.push(`Team 1 captain: ${data.team1.captainGt}${data.team1.captainDiscordId ? ` (Discord: <@${data.team1.captainDiscordId}>)` : ''}`);
  if (data.team2.captainGt) contextParts.push(`Team 2 captain: ${data.team2.captainGt}${data.team2.captainDiscordId ? ` (Discord: <@${data.team2.captainDiscordId}>)` : ''}`);
  if (data.scheduledTime) contextParts.push(`Already scheduled time: ${data.scheduledTime}`);

  // Recent channel messages
  const recentMsgs = await getChannelMessages(channelId, null, 20);
  if (recentMsgs?.length) {
    const convo = recentMsgs.reverse().map(m => {
      const author = m.author?.username || 'unknown';
      const isBot = m.author?.bot ? ' [BOT]' : '';
      const ts = new Date(m.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      return `[${ts}] ${author}${isBot}: ${m.content || ''}`;
    }).filter(l => l.includes(': ') && l.split(': ').slice(1).join(': ').trim()).join('\n');
    if (convo) contextParts.push(`\nConversation (with timestamps):\n${convo}`);
  }

  // Pull relevant knowledge (rules, facts) for conflict resolution
  const userText = latest.content || '';
  const [facts, matchCtx] = await Promise.all([
    memory.getRelevantFacts(userText, 30).catch(() => null),
    data.matchId ? leagueDb.getMatchContext(data.matchId).catch(() => null) : null,
  ]);
  if (facts) contextParts.push(`\nRelevant league rules/knowledge:\n${facts}`);
  if (matchCtx) contextParts.push(`\nMatch details:\n${matchCtx}`);

  // Identify which captain sent this message
  let senderTeam = null;
  let otherTeam = null;
  if (authorId && data.team1.captainDiscordId === authorId) {
    senderTeam = data.team1;
    otherTeam = data.team2;
  } else if (authorId && data.team2.captainDiscordId === authorId) {
    senderTeam = data.team2;
    otherTeam = data.team1;
  }

  const teamContext = senderTeam && otherTeam
    ? `\nMessage sender: ${senderTeam.name} captain (${latest.author?.username}). Other captain: ${otherTeam.name}${otherTeam.captainDiscordId ? ` (<@${otherTeam.captainDiscordId}>)` : ''}.`
    : '';

  contextParts.push(`\nMessage classified as: ${intent} (${intent === 'RESPOND' ? 'help/question/problem detected' : 'possible schedule update'})`);

  const systemPrompt = [
    'You are Ghost, a tournament match coordinator / league admin assistant for an NBA 2K esports league.',
    'You are the mediator in bracket match channels — you help with scheduling, answer questions,',
    'resolve disputes, explain rules, and keep things moving. Think of yourself as a league coordinator',
    'who is present but only speaks when it adds value.',
    '',
    'RESPONSE FORMAT — respond with EXACTLY ONE of these:',
    '',
    '1. SCHEDULE_CONFIRMED: [specific time] — ONLY when BOTH teams explicitly agree on a SPECIFIC time.',
    '   One team proposes a time AND the other confirms ("bet", "cool", "works", "lock it", "aight").',
    '   The [time] MUST be a real date/time (e.g. "tonight 9pm", "3/5 at 7pm", "tomorrow 8pm", "now").',
    '   One proposal without confirmation is NOT enough.',
    '   If someone says "it\'s already locked" or "we already scheduled" but did NOT state an actual time',
    '   in this channel, ask them WHAT TIME — do NOT confirm without a specific time.',
    '',
    '2. POST_GAME — Teams are actively playing or have played (exchanging codes, "we 5 in",',
    '   "searching", "ready", talking about scores, box scores, game results),',
    '   OR teams say they already have a time scheduled and don\'t need Ghost\'s help',
    '   ("we already scheduled", "it\'s already locked in", "we already set a time", "we good").',
    '',
    '3. NO_RESPONSE — The message does NOT need Ghost to respond:',
    '   - Normal scheduling back-and-forth where both teams are already communicating',
    '   - One captain proposing a time — let the other captain see it and respond first',
    '   - Simple acknowledgments ("ok", "bet", "aight", "cool") when nothing is being confirmed',
    '   - Admin announcements or deadline reminders',
    '   - ANY message where Ghost\'s reply would just be narrating or restating what was said',
    '',
    '4. A brief reply (1-3 sentences max) — when someone needs Ghost\'s help as a coordinator:',
    '',
    '   RESPOND when:',
    '   - Someone asks a QUESTION — about rules, format, servers, process, deadlines, anything',
    '   - Someone is confused — "what do I do?", "how does this work?", "what happens now?"',
    '   - Someone reports a PROBLEM — lag/disconnect, no-show, wrong score, opponent not responding',
    '   - There is a DISPUTE — score disagreement, server argument, accusations, heated exchange',
    '   - Someone asks for HELP — with anything related to the match, league, or process',
    '   - Someone says the other team isn\'t responding or won\'t schedule — explain the process',
    '   - A team asks about forfeit rules or deadlines — explain clearly',
    '   - Someone doesn\'t know how to report scores — explain the match embed at top of channel',
    '   - Any situation where a league coordinator would naturally step in to help',
    '',
    '   DO NOT respond just to:',
    '   - Narrate what\'s happening ("Sounds like you proposed 9pm!") — not helpful',
    '   - Summarize progress ("Both teams are coordinating!") — obvious',
    '   - Ping the other captain about a time proposal — Ghost DMs them automatically if needed',
    '   - Be encouraging or cheerful for no reason',
    '',
    'CRITICAL RULES:',
    '- If someone needs help or has a question, ALWAYS respond — that is your job.',
    '- If both teams are just chatting and scheduling normally, stay out of it (NO_RESPONSE).',
    '- Read the conversation timestamps. The current date/time is in the context.',
    '- If a time is ALREADY locked (see "Already scheduled time"), do NOT re-confirm it.',
    '- Do NOT ping or mention the other captain. Ghost handles follow-ups automatically via DM.',
    '- For disputes, cite specific rules from the "Relevant league rules" context if available.',
    '- If you don\'t know a rule, say so and suggest they open a ticket or ask an admin.',
    '- Keep answers direct and concise — you\'re a coordinator, not a commentator.',
    '- ALWAYS respond in English.',
    teamContext,
  ].join('\n');

  const userName = latest.author?.username || 'player';

  try {
    const reply = await deepseek.chat(
      systemPrompt + '\n\n' + contextParts.join('\n'),
      `${userName}: ${userText}`,
      512,
    );

    // Check for NO_RESPONSE
    if (!reply?.trim() || reply.trim() === 'NO_RESPONSE' || reply.trim().startsWith('NO_RESPONSE') || reply === '(no response)') return;

    // Check for POST_GAME — teams are playing
    if (reply.trim() === 'POST_GAME' || reply.trim().startsWith('POST_GAME')) {
      data.escalationState = State.POST_GAME;
      _saveState(channelId, data);
      return;
    }

    // Check for schedule confirmation
    const schedMatch = reply.match(/SCHEDULE_CONFIRMED:\s*(.+)/i);
    if (schedMatch) {
      const rawTime = schedMatch[1].trim();
      const parsed = _parseScheduledTime(rawTime);

      // Reject if we can't parse a real time — ask for clarification instead
      if (!parsed) {
        const askMsg = `I need a specific time to lock in. What time are you playing? (e.g. "tonight 9pm", "tomorrow 8pm", "3/5 at 7pm")`;
        const sent = await sendMessage(channelId, askMsg);
        if (sent) { data.lastMessageId = sent.id; data.lastAiResponseAt = Date.now(); }
        return;
      }

      data.scheduledTime = rawTime;
      data.scheduledTimeISO = parsed.toISOString();
      data.escalationState = State.SCHEDULED;
      const confirmMsg = [
        `🔒 **Time Locked In** — **${data.scheduledTime}**`,
        '',
        `**${data.team1.name}** vs **${data.team2.name}**`,
        `${data.bracket} — ${data.round}`,
        '',
        `Both teams are locked. Show up and hoop — good luck! 🏀`,
      ].join('\n');
      const sent = await sendMessage(channelId, confirmMsg);
      if (sent) {
        data.lastMessageId = sent.id;
        data.lastAiResponseAt = Date.now();
        discordApi('PUT', `/channels/${channelId}/messages/${sent.id}/reactions/${encodeURIComponent('🔒')}/@me`).catch(() => {});
      }

      if (latest.id) {
        discordApi('PUT', `/channels/${channelId}/messages/${latest.id}/reactions/${encodeURIComponent('✅')}/@me`).catch(() => {});
      }

      _saveState(channelId, data);

      db.logEntry({
        level: 'INFO', agent: 'ghost', action: 'bracket:scheduled',
        outcome: 'confirmed', note: `Match #${data.matchNumber}: ${data.scheduledTime}`,
      }).catch(() => {});
      registry.pushEvent('ghost', `Bracket match #${data.matchNumber} scheduled: ${data.scheduledTime}`, 'info');
      return;
    }

    // Normal AI reply
    await sendTyping(channelId);
    const sent = await sendMessage(channelId, reply);
    if (sent) {
      data.lastMessageId = sent.id;
      data.lastAiResponseAt = Date.now();
      _saveState(channelId, data);
    }
  } catch (err) {
    console.error(`[BracketMonitor] AI reply failed in ${channelId}:`, err.message);
  }
}

// ── Polling loops ─────────────────────────────────────────────────────────────

/**
 * Scan platform DB for active bracket match channels (runs every 60 min + boot).
 */
async function scanBracketChannels() {
  try {
    const matches = await leagueDb.getActiveBracketMatches();
    let added = 0;

    for (const match of matches) {
      if (!_channels.has(match.chatChannelId)) {
        await registerChannel(match); // async now — loads Redis state
        added++;

        // Send initial greeting only for truly new channels (no saved state)
        const data = _channels.get(match.chatChannelId);
        if (data && data.escalationState === State.NEW && !data.lastMessageId) {
          sendInitialGreeting(match.chatChannelId, data).catch(err => {
            console.error(`[BracketMonitor] Greeting failed for match #${match.matchNumber}:`, err.message);
          });
        }
      }
    }

    // Remove channels whose matches are no longer active
    const activeChannelIds = new Set(matches.map(m => m.chatChannelId));
    for (const [channelId, data] of _channels) {
      if (!activeChannelIds.has(channelId)) {
        console.log(`[BracketMonitor] Match #${data.matchNumber} no longer active, removing channel ${channelId}`);
        _channels.delete(channelId);
        _clearState(channelId);
      }
    }

    if (added > 0) {
      console.log(`[BracketMonitor] Added ${added} new bracket channels (total: ${_channels.size})`);
    }
  } catch (err) {
    console.error('[BracketMonitor] Scan failed:', err.message);
  }
}

/**
 * Poll all active bracket channels for messages + run escalation (runs every 60s).
 */
async function pollChannels() {
  if (_polling) return;
  _polling = true;
  try {
  if (!_channels.size) return;

  for (const [channelId, data] of _channels) {
    try {
      // Check escalation timers
      await checkEscalation(channelId, data);

      // POST_GAME / REPORT_REQUESTED — skip message polling entirely
      if (data.escalationState === State.POST_GAME || data.escalationState === State.REPORT_REQUESTED) continue;

      // Get new messages
      const messages = data.lastMessageId
        ? await getChannelMessages(channelId, data.lastMessageId, 5)
        : await getChannelMessages(channelId, null, 1);

      if (!messages?.length) continue;

      // First poll — seed lastMessageId
      if (!data.lastMessageId) {
        data.lastMessageId = messages[0].id;
        _saveState(channelId, data);
        continue;
      }

      // Find the newest message ID
      data.lastMessageId = messages.reduce((max, m) =>
        BigInt(m.id) > BigInt(max) ? m.id : max, data.lastMessageId);

      // If ANY message @mentions Ghost (by mentions array OR text content), skip ALL.
      // OpenClaw handles @mentions — bracket monitor must not also respond.
      // Check both the mentions array AND the raw text for <@BOT_ID> since Discord
      // sometimes returns empty mentions array in history fetches.
      const botMentionText = `<@${BOT_ID}>`;
      const hasMention = messages.some(m => {
        if (m.author?.bot) return false;
        if (m.mentions?.some(u => u.id === BOT_ID)) return true;
        if (m.mention_everyone) return true;
        if (m.content?.includes(botMentionText)) return true;
        return false;
      });
      if (hasMention) {
        // Also update activity/team tracking before skipping
        for (const m of messages.filter(x => !x.author?.bot)) {
          const uid = m.author?.id;
          if (uid && data.team1.captainDiscordId === uid) data.team1LastSeen = Date.now();
          else if (uid && data.team2.captainDiscordId === uid) data.team2LastSeen = Date.now();
        }
        data.lastActivityAt = Date.now();
        _saveState(channelId, data);
        continue;
      }

      // Also skip if a bot message in this batch looks like an OpenClaw echo/reply
      // (OpenClaw sends responses within seconds of the @mention)
      const hasRecentBotReply = messages.some(m => m.author?.id === BOT_ID);
      if (hasRecentBotReply) {
        data.lastAiResponseAt = Date.now(); // prevent bracket monitor from also responding
        _saveState(channelId, data);
        continue;
      }

      // Filter to human messages only
      const userMessages = messages.filter(m => !m.author?.bot);

      if (!userMessages.length) continue;

      // Update activity + track per-team for ALL messages in the batch
      data.lastActivityAt = Date.now();
      data._failures = 0;
      for (const m of userMessages) {
        const uid = m.author?.id;
        if (uid && data.team1.captainDiscordId === uid) data.team1LastSeen = Date.now();
        else if (uid && data.team2.captainDiscordId === uid) data.team2LastSeen = Date.now();
      }

      // Pick the latest message for AI evaluation, pass full batch for context
      const latest = userMessages.sort((a, b) =>
        BigInt(a.id) > BigInt(b.id) ? 1 : -1
      ).pop();
      await handleUserMessage(channelId, userMessages, latest, data);

    } catch (err) {
      data._failures = (data._failures || 0) + 1;
      if (data._failures >= MAX_FAILURES) {
        console.log(`[BracketMonitor] Removing channel ${channelId} after ${MAX_FAILURES} failures`);
        _channels.delete(channelId);
        _clearState(channelId);
      }
    }
  }
  } finally { _polling = false; }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init(broadcastFn) {
  _broadcast = broadcastFn || _broadcast;

  await scanBracketChannels();
  console.log(`[BracketMonitor] Initialized — monitoring ${_channels.size} bracket channels`);

  _intervalPoll = setInterval(pollChannels, 60_000);
  _intervalScan = setInterval(scanBracketChannels, 60 * 60_000);

  setTimeout(pollChannels, 20_000);
}

function stop() {
  if (_intervalPoll) { clearInterval(_intervalPoll); _intervalPoll = null; }
  if (_intervalScan) { clearInterval(_intervalScan); _intervalScan = null; }
}

module.exports = {
  init, stop,
  get activeChannels() { return _channels.size; },
  get channelStates() {
    const states = {};
    for (const [id, d] of _channels) {
      states[id] = { matchNumber: d.matchNumber, state: d.escalationState, team1: d.team1.name, team2: d.team2.name };
    }
    return states;
  },
};
