'use strict';

/**
 * League DB — Direct read access to the Squad Finder platform database.
 *
 * All 4 leagues (HOF, Squad Finder, URG, BHL) share one Neon PostgreSQL instance.
 * This module provides real-time queries for teams, players, matches, seasons, and stats.
 *
 * Usage:
 *   const leagueDb = require('./skills/league-db');
 *   const standings = await leagueDb.getStandings('hof');
 *   const player = await leagueDb.findPlayer('gamertag');
 *   const snapshot = await leagueDb.getFullSnapshot();
 */

const { Pool } = require('pg');

// Org ID → league key mapping
const ORG_IDS = {
  'cmjkjlsnw0001gq0geuwgymtg': 'hof',
  'cmjjjl2mq0001gq0jz4a94s3o': 'sf',
  'cmjkmig7m0001gq0gttouwuju': 'urg',
  'cmkhtsela0005gq0gudpkk8io': 'bhl',
};

const LEAGUE_NAMES = {
  hof: 'HOF League', sf: 'Squad Finder', urg: 'URG Pro-Am', bhl: 'BHL League',
};

const KEY_TO_ORG = {
  hof: 'cmjkjlsnw0001gq0geuwgymtg',
  sf:  'cmjjjl2mq0001gq0jz4a94s3o',
  urg: 'cmjkmig7m0001gq0gttouwuju',
  bhl: 'cmkhtsela0005gq0gudpkk8io',
};

// Guild ID → league key
const GUILD_TO_LEAGUE = {
  '776927230827167794':  'hof',
  '657244609428062226':  'sf',
  '751916925960978442':  'urg',
  '1105891245391347744': 'bhl',
};

// Lazy pool — only connect when first query runs
let _pool;
function getPool() {
  if (!_pool) {
    const url = process.env.LEAGUE_DATABASE_URL;
    if (!url) throw new Error('LEAGUE_DATABASE_URL not set');
    _pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 5, idleTimeoutMillis: 30000 });
    _pool.on('error', (err) => {
      console.error('[LeagueDB] Unexpected pool error:', err.message);
    });
  }
  return _pool;
}

async function query(sql, params) {
  return getPool().query(sql, params);
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Get team standings for a league (or all leagues).
 */
async function getStandings(leagueKey, limit = 20) {
  const orgFilter = leagueKey && KEY_TO_ORG[leagueKey]
    ? 'AND t."organizationId" = $1' : '';
  const params = leagueKey && KEY_TO_ORG[leagueKey] ? [KEY_TO_ORG[leagueKey], limit] : [limit];
  const limitParam = params.length === 2 ? '$2' : '$1';

  const { rows } = await query(`
    SELECT t.name, t.wins, t.losses, t."seasonWins", t."seasonLosses", t."memberCount",
           t."organizationId", o.name as org_name
    FROM "Team" t JOIN "Organization" o ON t."organizationId" = o.id
    WHERE t."isArchived" IS NOT TRUE AND (t.wins + t.losses) > 0 ${orgFilter}
    ORDER BY t.wins DESC, t.losses ASC
    LIMIT ${limitParam}
  `, params);

  return rows.map(r => ({
    team: r.name, wins: r.wins, losses: r.losses,
    seasonWins: r.seasonWins, seasonLosses: r.seasonLosses,
    players: r.memberCount,
    winPct: r.wins + r.losses > 0 ? Math.round(r.wins / (r.wins + r.losses) * 100) : 0,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get top players by MMR for a league (or all leagues).
 */
async function getLeaderboard(leagueKey, limit = 20) {
  const orgFilter = leagueKey && KEY_TO_ORG[leagueKey]
    ? 'AND p."organizationId" = $1' : '';
  const params = leagueKey && KEY_TO_ORG[leagueKey] ? [KEY_TO_ORG[leagueKey], limit] : [limit];
  const limitParam = params.length === 2 ? '$2' : '$1';

  const { rows } = await query(`
    SELECT p.gamertag, p.mmr, p."rankTier", p.wins, p.losses, p."gamesPlayed",
           p.console, p."currentTeam", p."organizationId", o.name as org_name
    FROM "Player" p JOIN "Organization" o ON p."organizationId" = o.id
    WHERE p.mmr > 0 ${orgFilter}
    ORDER BY p.mmr DESC
    LIMIT ${limitParam}
  `, params);

  return rows.map(r => ({
    gamertag: r.gamertag, mmr: r.mmr, rank: r.rankTier,
    wins: r.wins, losses: r.losses, gamesPlayed: r.gamesPlayed,
    console: r.console, team: r.currentTeam,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Find a player by gamertag (fuzzy search).
 */
async function findPlayer(gamertag) {
  const { rows } = await query(`
    SELECT p.gamertag, p."displayName", p.mmr, p."rankTier", p.wins, p.losses,
           p."gamesPlayed", p.console, p."currentTeam", p."currentTeamLogo",
           p."currentWinStreak", p."bestWinStreak", p.lp, p.xp, p.positions,
           p."organizationId", o.name as org_name
    FROM "Player" p JOIN "Organization" o ON p."organizationId" = o.id
    WHERE p.gamertag ILIKE $1 OR p."displayName" ILIKE $1 OR p."discordUsername" ILIKE $1
    ORDER BY p.mmr DESC NULLS LAST
    LIMIT 10
  `, [`%${gamertag}%`]);

  return rows.map(r => ({
    gamertag: r.gamertag, displayName: r.displayName, mmr: r.mmr, rank: r.rankTier,
    wins: r.wins, losses: r.losses, gamesPlayed: r.gamesPlayed,
    console: r.console, team: r.currentTeam, positions: r.positions,
    winStreak: r.currentWinStreak, bestWinStreak: r.bestWinStreak, lp: r.lp, xp: r.xp,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Find a team by name (fuzzy search).
 */
async function findTeam(teamName) {
  const { rows } = await query(`
    SELECT t.name, t.tag, t.wins, t.losses, t."seasonWins", t."seasonLosses",
           t."memberCount", t."organizationId", o.name as org_name,
           owner.gamertag as owner_gamertag, owner."discordId" as owner_discord_id
    FROM "Team" t
    JOIN "Organization" o ON t."organizationId" = o.id
    LEFT JOIN "Player" owner ON t."ownerId" = owner.id
    WHERE t."isArchived" IS NOT TRUE AND (t.name ILIKE $1 OR t.tag ILIKE $1)
    ORDER BY t.wins DESC
    LIMIT 10
  `, [`%${teamName}%`]);

  return rows.map(r => ({
    team: r.name, tag: r.tag, wins: r.wins, losses: r.losses,
    seasonWins: r.seasonWins, seasonLosses: r.seasonLosses,
    players: r.memberCount,
    owner: r.owner_gamertag || null,
    ownerDiscordId: r.owner_discord_id || null,
    winPct: r.wins + r.losses > 0 ? Math.round(r.wins / (r.wins + r.losses) * 100) : 0,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get active seasons/events for a league (or all).
 */
async function getActiveSeasons(leagueKey) {
  const orgFilter = leagueKey && KEY_TO_ORG[leagueKey]
    ? 'AND s."organizationId" = $1' : '';
  const params = leagueKey && KEY_TO_ORG[leagueKey] ? [KEY_TO_ORG[leagueKey]] : [];

  const { rows } = await query(`
    SELECT s.name, s."eventType", s."prizePool", s."registrationFee",
           s."registrationsOpen", s."startDate", s."endDate", s."seasonNumber",
           s."organizationId", o.name as org_name,
           (SELECT count(*) FROM "TeamRegistration" tr WHERE tr."seasonId" = s.id) as team_count
    FROM "Season" s JOIN "Organization" o ON s."organizationId" = o.id
    WHERE s."isActive" = true ${orgFilter}
    ORDER BY o.name, s.name
  `, params);

  return rows.map(r => ({
    name: r.name, type: r.eventType, prizePool: r.prizePool,
    entryFee: r.registrationFee, registrationsOpen: r.registrationsOpen,
    startDate: r.startDate?.toISOString().slice(0, 10),
    endDate: r.endDate?.toISOString().slice(0, 10),
    teams: parseInt(r.team_count) || 0,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get recent match results.
 */
async function getRecentMatches(leagueKey, limit = 15) {
  const orgFilter = leagueKey && KEY_TO_ORG[leagueKey]
    ? 'AND sm."organizationId" = $1' : '';
  const params = leagueKey && KEY_TO_ORG[leagueKey] ? [KEY_TO_ORG[leagueKey], limit] : [limit];
  const limitParam = params.length === 2 ? '$2' : '$1';

  const { rows } = await query(`
    SELECT sm."matchNumber", sm."team1Score", sm."team2Score", sm.status,
           sm."completedAt", sm."isForfeit",
           t1.name as team1, t2.name as team2, tw.name as winner,
           s.name as season, sm."organizationId", o.name as org_name
    FROM "SeasonMatch" sm
    JOIN "Team" t1 ON sm."team1Id" = t1.id
    JOIN "Team" t2 ON sm."team2Id" = t2.id
    LEFT JOIN "Team" tw ON sm."winnerId" = tw.id
    JOIN "Season" s ON sm."seasonId" = s.id
    JOIN "Organization" o ON sm."organizationId" = o.id
    WHERE sm."completedAt" IS NOT NULL ${orgFilter}
    ORDER BY sm."completedAt" DESC
    LIMIT ${limitParam}
  `, params);

  return rows.map(r => ({
    match: r.matchNumber, team1: r.team1, team2: r.team2,
    score: `${r.team1Score ?? 0}-${r.team2Score ?? 0}`,
    winner: r.winner, forfeit: r.isForfeit, season: r.season,
    date: r.completedAt?.toISOString().slice(0, 10),
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get stat leaders (PPG, RPG, APG, etc.)
 */
async function getStatLeaders(leagueKey, stat = 'points', limit = 10) {
  const statCol = {
    points: 'ps."totalPoints"', rebounds: 'ps."totalRebounds"', assists: 'ps."totalAssists"',
    steals: 'ps."totalSteals"', blocks: 'ps."totalBlocks"', threes: 'ps."total3PM"',
    efficiency: 'ps."efficiencyRating"',
  }[stat] || 'ps."totalPoints"';

  const perGame = stat === 'efficiency'
    ? `ps."efficiencyRating"`
    : `CASE WHEN ps."gamesPlayed" > 0 THEN ${statCol}::float / ps."gamesPlayed" ELSE 0 END`;

  const orgFilter = leagueKey && KEY_TO_ORG[leagueKey]
    ? 'AND ps."organizationId" = $1' : '';
  const params = leagueKey && KEY_TO_ORG[leagueKey] ? [KEY_TO_ORG[leagueKey], limit] : [limit];
  const limitParam = params.length === 2 ? '$2' : '$1';

  const { rows } = await query(`
    SELECT p.gamertag, ps."gamesPlayed", ${perGame} as per_game,
           ps."totalPoints", ps."totalRebounds", ps."totalAssists",
           ps."totalSteals", ps."totalBlocks", ps."efficiencyRating",
           ps."lastTeamName", ps."organizationId", o.name as org_name
    FROM "PlayerStats" ps
    JOIN "Player" p ON ps."playerId" = p.id
    JOIN "Organization" o ON ps."organizationId" = o.id
    WHERE ps."gamesPlayed" >= 5 ${orgFilter}
    ORDER BY ${perGame} DESC
    LIMIT ${limitParam}
  `, params);

  return rows.map(r => ({
    gamertag: r.gamertag, gamesPlayed: r.gamesPlayed,
    perGame: Math.round(r.per_game * 10) / 10,
    totalPoints: r.totalPoints, totalRebounds: r.totalRebounds,
    totalAssists: r.totalAssists, totalSteals: r.totalSteals,
    totalBlocks: r.totalBlocks, efficiency: r.efficiencyRating,
    team: r.lastTeamName,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get team roster (players on a specific team).
 */
async function getTeamRoster(teamName) {
  const { rows } = await query(`
    SELECT p.gamertag, p.mmr, p."rankTier", p.wins, p.losses, p.console, p.positions,
           tm.role, t.name as team_name, t."organizationId", o.name as org_name
    FROM "TeamMember" tm
    JOIN "Player" p ON tm."playerId" = p.id
    JOIN "Team" t ON tm."teamId" = t.id
    JOIN "Organization" o ON t."organizationId" = o.id
    WHERE t.name ILIKE $1 AND t."isArchived" IS NOT TRUE
    ORDER BY
      CASE tm.role WHEN 'OWNER' THEN 0 WHEN 'CO_CAPTAIN' THEN 1 ELSE 2 END,
      p.mmr DESC NULLS LAST
  `, [`%${teamName}%`]);

  return rows.map(r => ({
    gamertag: r.gamertag, mmr: r.mmr, rank: r.rankTier,
    wins: r.wins, losses: r.losses, console: r.console, positions: r.positions,
    role: r.role,
    team: r.team_name,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Full snapshot — used by daily sync job to populate Ghost's knowledge base.
 * Returns a formatted text summary of all leagues.
 */
async function getFullSnapshot() {
  const parts = [];

  for (const [key, orgId] of Object.entries(KEY_TO_ORG)) {
    const name = LEAGUE_NAMES[key];
    const lines = [`## ${name}`];

    // Active seasons
    const seasons = await getActiveSeasons(key);
    if (seasons.length) {
      lines.push('**Active Events:**');
      seasons.forEach(s => {
        lines.push(`- ${s.name} (${s.type}) — ${s.teams} teams, $${s.prizePool || 0} prize${s.registrationsOpen ? ', OPEN for registration' : ''}`);
      });
    }

    // Top 5 teams
    const teams = await getStandings(key, 5);
    if (teams.length) {
      lines.push('**Top Teams:**');
      teams.forEach((t, i) => {
        lines.push(`- ${i+1}. ${t.team} (${t.wins}-${t.losses}, ${t.winPct}% WR)`);
      });
    }

    // Top 5 players
    const players = await getLeaderboard(key, 5);
    if (players.length) {
      lines.push('**Top Players:**');
      players.forEach((p, i) => {
        lines.push(`- ${i+1}. ${p.gamertag} (MMR: ${p.mmr}, ${p.rank || 'Unranked'}, ${p.console || '?'})`);
      });
    }

    // Last 3 matches
    const matches = await getRecentMatches(key, 3);
    if (matches.length) {
      lines.push('**Recent Matches:**');
      matches.forEach(m => {
        lines.push(`- ${m.season} #${m.match}: ${m.team1} ${m.score} ${m.team2} → ${m.winner || 'TBD'} (${m.date})`);
      });
    }

    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
}

// ── Season-specific queries ──────────────────────────────────────────────────

/**
 * Search seasons by name (fuzzy). Returns all matching (active or not).
 */
async function findSeason(name, leagueKey) {
  const orgFilter = leagueKey && KEY_TO_ORG[leagueKey]
    ? 'AND s."organizationId" = $2' : '';
  const params = leagueKey && KEY_TO_ORG[leagueKey] ? [`%${name}%`, KEY_TO_ORG[leagueKey]] : [`%${name}%`];

  const { rows } = await query(`
    SELECT s.id, s.name, s."eventType", s."prizePool", s."registrationFee",
           s."registrationsOpen", s."startDate", s."endDate", s."seasonNumber",
           s."isActive", s."organizationId", o.name as org_name,
           (SELECT count(*) FROM "TeamRegistration" tr WHERE tr."seasonId" = s.id) as team_count,
           (SELECT count(*) FROM "SeasonMatch" sm WHERE sm."seasonId" = s.id AND sm."completedAt" IS NOT NULL) as match_count
    FROM "Season" s JOIN "Organization" o ON s."organizationId" = o.id
    WHERE s.name ILIKE $1 ${orgFilter}
    ORDER BY s."isActive" DESC, s."startDate" DESC
    LIMIT 10
  `, params);

  return rows.map(r => ({
    id: r.id, name: r.name, type: r.eventType, prizePool: r.prizePool,
    entryFee: r.registrationFee, registrationsOpen: r.registrationsOpen,
    startDate: r.startDate?.toISOString().slice(0, 10),
    endDate: r.endDate?.toISOString().slice(0, 10),
    seasonNumber: r.seasonNumber, active: r.isActive,
    teams: parseInt(r.team_count) || 0,
    matchesPlayed: parseInt(r.match_count) || 0,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get season standings — teams ranked by wins within a specific season.
 * Aggregates wins/losses from completed SeasonMatch results (reliable across all seasons).
 */
async function getSeasonStandings(seasonId, limit = 20) {
  const { rows } = await query(`
    WITH match_results AS (
      SELECT sm."team1Id" as team_id,
             CASE WHEN sm."winnerId" = sm."team1Id" THEN 1 ELSE 0 END as won,
             CASE WHEN sm."winnerId" = sm."team2Id" THEN 1 ELSE 0 END as lost
      FROM "SeasonMatch" sm
      WHERE sm."seasonId" = $1 AND sm."completedAt" IS NOT NULL
      UNION ALL
      SELECT sm."team2Id" as team_id,
             CASE WHEN sm."winnerId" = sm."team2Id" THEN 1 ELSE 0 END as won,
             CASE WHEN sm."winnerId" = sm."team1Id" THEN 1 ELSE 0 END as lost
      FROM "SeasonMatch" sm
      WHERE sm."seasonId" = $1 AND sm."completedAt" IS NOT NULL
    )
    SELECT t.name as team_name, t.tag, t."memberCount",
           COALESCE(sum(mr.won), 0)::int as wins,
           COALESCE(sum(mr.lost), 0)::int as losses,
           tr.seed,
           s.name as season_name, s."organizationId", o.name as org_name
    FROM "TeamRegistration" tr
    JOIN "Season" s ON tr."seasonId" = s.id
    JOIN "Organization" o ON s."organizationId" = o.id
    JOIN "Team" t ON tr."teamId" = t.id
    LEFT JOIN match_results mr ON mr.team_id = t.id
    WHERE tr."seasonId" = $1 AND tr.status != 'CANCELLED'
    GROUP BY t.name, t.tag, t."memberCount", tr.seed, s.name, s."organizationId", o.name
    ORDER BY wins DESC, losses ASC, t.name ASC
    LIMIT $2
  `, [seasonId, limit]);

  return rows.map(r => ({
    team: r.team_name, tag: r.tag, seed: r.seed,
    wins: r.wins, losses: r.losses,
    players: r.memberCount,
    winPct: r.wins + r.losses > 0
      ? Math.round(r.wins / (r.wins + r.losses) * 100) : 0,
    season: r.season_name,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get recent matches for a specific season.
 */
async function getSeasonMatches(seasonId, limit = 20) {
  const { rows } = await query(`
    SELECT sm."matchNumber", sm."team1Score", sm."team2Score", sm.status,
           sm."completedAt", sm."isForfeit",
           t1.name as team1, t2.name as team2, tw.name as winner,
           s.name as season, s."organizationId", o.name as org_name
    FROM "SeasonMatch" sm
    JOIN "Team" t1 ON sm."team1Id" = t1.id
    JOIN "Team" t2 ON sm."team2Id" = t2.id
    LEFT JOIN "Team" tw ON sm."winnerId" = tw.id
    JOIN "Season" s ON sm."seasonId" = s.id
    JOIN "Organization" o ON sm."organizationId" = o.id
    WHERE sm."seasonId" = $1 AND sm."completedAt" IS NOT NULL
    ORDER BY sm."completedAt" DESC
    LIMIT $2
  `, [seasonId, limit]);

  return rows.map(r => ({
    match: r.matchNumber, team1: r.team1, team2: r.team2,
    score: `${r.team1Score ?? 0}-${r.team2Score ?? 0}`,
    winner: r.winner, forfeit: r.isForfeit, season: r.season,
    date: r.completedAt?.toISOString().slice(0, 10),
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

// ── Ticket queries ───────────────────────────────────────────────────────────

/**
 * Get open tickets (optionally filtered by league).
 */
async function getOpenTickets(leagueKey) {
  const orgFilter = leagueKey && KEY_TO_ORG[leagueKey]
    ? 'AND t."organizationId" = $1' : '';
  const params = leagueKey && KEY_TO_ORG[leagueKey] ? [KEY_TO_ORG[leagueKey]] : [];

  const { rows } = await query(`
    SELECT t.id, t."ticketNumber", t.subject, t.description, t.type, t.status,
           t."userId", t."channelId", t."guildId", t."claimedBy", t."matchId",
           t."createdAt", t."organizationId", o.name as org_name,
           p.gamertag, p."discordUsername", p."discordId", p.mmr, p."rankTier",
           p.wins, p.losses, p."currentTeam", p.console
    FROM "Ticket" t
    JOIN "Organization" o ON t."organizationId" = o.id
    LEFT JOIN "Player" p ON t."userId" = p."discordId" AND t."organizationId" = p."organizationId"
    WHERE t.status = 'OPEN' ${orgFilter}
    ORDER BY t."createdAt" DESC
  `, params);

  return rows.map(r => ({
    id: r.id, number: r.ticketNumber, subject: r.subject,
    description: r.description, type: r.type,
    userId: r.userId, channelId: r.channelId, guildId: r.guildId,
    gamertag: r.gamertag, discordUsername: r.discordUsername, discordId: r.discordId,
    mmr: r.mmr, rank: r.rankTier, record: r.wins != null ? `${r.wins}-${r.losses}` : null,
    team: r.currentTeam, console: r.console,
    claimed: r.claimedBy || null, matchId: r.matchId,
    createdAt: r.createdAt?.toISOString(),
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get a single ticket by ID with full details.
 */
async function getTicket(ticketId) {
  const { rows } = await query(`
    SELECT t.*, o.name as org_name,
           p.gamertag, p."discordUsername", p."discordId", p.mmr, p."rankTier",
           p.wins, p.losses, p."currentTeam", p.console, p."currentWinStreak",
           p."gamesPlayed", p.positions
    FROM "Ticket" t
    JOIN "Organization" o ON t."organizationId" = o.id
    LEFT JOIN "Player" p ON t."userId" = p."discordId" AND t."organizationId" = p."organizationId"
    WHERE t.id = $1
  `, [ticketId]);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id, number: r.ticketNumber, subject: r.subject,
    description: r.description, type: r.type, status: r.status,
    userId: r.userId, gamertag: r.gamertag,
    discordUsername: r.discordUsername, discordId: r.discordId,
    playerMmr: r.mmr, playerRank: r.rankTier,
    playerRecord: r.wins != null ? `${r.wins}-${r.losses}` : null,
    playerTeam: r.currentTeam, playerConsole: r.console,
    claimed: r.claimedBy, matchId: r.matchId,
    transcript: r.transcript,
    createdAt: r.createdAt?.toISOString(),
    closedAt: r.closedAt?.toISOString(),
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  };
}

/**
 * Get tickets created since a given timestamp (for polling new tickets).
 */
async function getNewTicketsSince(since) {
  const { rows } = await query(`
    SELECT t.id, t."ticketNumber", t.subject, t.description, t.type, t.status,
           t."userId", t."channelId", t."guildId", t."createdAt", t."organizationId",
           o.name as org_name,
           p.gamertag, p."discordUsername", p."discordId", p.mmr, p."rankTier",
           p.wins, p.losses, p."currentTeam", p.console
    FROM "Ticket" t
    JOIN "Organization" o ON t."organizationId" = o.id
    LEFT JOIN "Player" p ON t."userId" = p."discordId" AND t."organizationId" = p."organizationId"
    WHERE t."createdAt" > $1 AND t.status = 'OPEN'
    ORDER BY t."createdAt" ASC
  `, [since]);

  return rows.map(r => ({
    id: r.id, number: r.ticketNumber, subject: r.subject,
    description: r.description, type: r.type, status: r.status,
    userId: r.userId, channelId: r.channelId, guildId: r.guildId,
    gamertag: r.gamertag, discordUsername: r.discordUsername, discordId: r.discordId,
    mmr: r.mmr, rank: r.rankTier, record: r.wins != null ? `${r.wins}-${r.losses}` : null,
    team: r.currentTeam, console: r.console,
    createdAt: r.createdAt?.toISOString(),
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  }));
}

/**
 * Get ticket summary counts per league.
 */
async function getTicketStats() {
  const { rows } = await query(`
    SELECT t."organizationId", t.status, count(*) as cnt
    FROM "Ticket" t
    GROUP BY t."organizationId", t.status
    ORDER BY t."organizationId"
  `);

  const stats = {};
  for (const r of rows) {
    const key = ORG_IDS[r.organizationId] || r.organizationId;
    if (!stats[key]) stats[key] = { league: LEAGUE_NAMES[key] || key, open: 0, closed: 0 };
    if (r.status === 'OPEN') stats[key].open = parseInt(r.cnt);
    else stats[key].closed = parseInt(r.cnt);
  }
  return Object.values(stats);
}

/**
 * Find a player by Discord user ID (exact match within an org).
 */
async function findPlayerByDiscordId(discordId, orgId) {
  const orgFilter = orgId ? 'AND p."organizationId" = $2' : '';
  const params = orgId ? [discordId, orgId] : [discordId];

  const { rows } = await query(`
    SELECT p.gamertag, p."displayName", p.mmr, p."rankTier", p.wins, p.losses,
           p."gamesPlayed", p.console, p."currentTeam", p."currentWinStreak",
           p."bestWinStreak", p.lp, p.xp, p.positions,
           p."discordId", p."discordUsername",
           p."organizationId", o.name as org_name
    FROM "Player" p JOIN "Organization" o ON p."organizationId" = o.id
    WHERE p."discordId" = $1 ${orgFilter}
    ORDER BY p.mmr DESC NULLS LAST
    LIMIT 1
  `, params);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    gamertag: r.gamertag, displayName: r.displayName, mmr: r.mmr, rank: r.rankTier,
    wins: r.wins, losses: r.losses, gamesPlayed: r.gamesPlayed,
    console: r.console, team: r.currentTeam, positions: r.positions,
    winStreak: r.currentWinStreak, bestWinStreak: r.bestWinStreak, lp: r.lp, xp: r.xp,
    discordId: r.discordId, discordUsername: r.discordUsername,
    league: LEAGUE_NAMES[ORG_IDS[r.organizationId]] || r.org_name,
  };
}

/**
 * Get full profile context for a ticket — player + stats + team roster + recent matches.
 * Returns a formatted text block for AI system prompts.
 */
async function getPlayerProfileContext(discordId, orgId) {
  const player = await findPlayerByDiscordId(discordId, orgId);
  if (!player) return null;

  const lines = [`Player: ${player.gamertag} (${player.console || '?'})`];
  lines.push(`League: ${player.league}`);
  lines.push(`MMR: ${player.mmr || 0} | Rank: ${player.rank || 'Unranked'}`);
  lines.push(`Record: ${player.wins}-${player.losses} (${player.gamesPlayed} games)`);
  if (player.winStreak) lines.push(`Current win streak: ${player.winStreak}`);
  if (player.positions) lines.push(`Positions: ${player.positions}`);
  if (player.team) {
    lines.push(`Team: ${player.team}`);
    // Get team record + owner
    const teams = await findTeam(player.team);
    if (teams.length) {
      const t = teams[0];
      lines.push(`Team record: ${t.wins}-${t.losses} (${t.winPct}% WR, ${t.players} players)`);
      if (t.owner) lines.push(`Team owner: ${t.owner}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get match context for a ticket linked to a specific match.
 */
async function getMatchContext(matchId) {
  if (!matchId) return null;
  const { rows } = await query(`
    SELECT sm."matchNumber", sm."team1Score", sm."team2Score", sm.status,
           sm."completedAt", sm."isForfeit", sm."disputeReason",
           t1.name as team1, t2.name as team2, tw.name as winner,
           s.name as season
    FROM "SeasonMatch" sm
    JOIN "Team" t1 ON sm."team1Id" = t1.id
    JOIN "Team" t2 ON sm."team2Id" = t2.id
    LEFT JOIN "Team" tw ON sm."winnerId" = tw.id
    JOIN "Season" s ON sm."seasonId" = s.id
    WHERE sm.id = $1
  `, [matchId]);

  if (!rows.length) return null;
  const m = rows[0];
  const lines = [`Match #${m.matchNumber}: ${m.team1} vs ${m.team2}`];
  lines.push(`Season: ${m.season}`);
  lines.push(`Status: ${m.status}`);
  if (m.team1Score != null) lines.push(`Score: ${m.team1Score}-${m.team2Score}`);
  if (m.winner) lines.push(`Winner: ${m.winner}`);
  if (m.isForfeit) lines.push(`Forfeit: yes`);
  if (m.disputeReason) lines.push(`Dispute: ${m.disputeReason}`);
  return lines.join('\n');
}

/**
 * League key from guild ID.
 */
function leagueFromGuild(guildId) {
  return GUILD_TO_LEAGUE[guildId] || null;
}

// ── Bracket queries ──────────────────────────────────────────────────────────

/**
 * Get active bracket matches with chat channels.
 * Joins BracketMatch → EventBracket (IN_PROGRESS) → Team → Player (captain discordId).
 * Filters: chatChannelId IS NOT NULL, status PENDING/IN_PROGRESS, not BYE.
 */
async function getActiveBracketMatches() {
  const { rows } = await query(`
    SELECT bm.id, bm."matchNumber", bm.status, bm."chatChannelId",
           bm."team1Score", bm."team2Score", bm."createdAt",
           t1.name as team1_name, t1.id as team1_id,
           t2.name as team2_name, t2.id as team2_id,
           p1."discordId" as cap1_discord, p1.gamertag as cap1_gt,
           p2."discordId" as cap2_discord, p2.gamertag as cap2_gt,
           eb.id as bracket_id, eb.name as bracket_name, eb.status as bracket_status,
           eb."organizationId",
           br.name as round_name, br."roundNumber",
           s.name as season_name
    FROM "BracketMatch" bm
    JOIN "EventBracket" eb ON bm."bracketId" = eb.id
    JOIN "BracketRound" br ON bm."roundId" = br.id
    JOIN "Season" s ON eb."seasonId" = s.id
    LEFT JOIN "Team" t1 ON bm."team1Id" = t1.id
    LEFT JOIN "Team" t2 ON bm."team2Id" = t2.id
    LEFT JOIN "Player" p1 ON t1."ownerId" = p1.id
    LEFT JOIN "Player" p2 ON t2."ownerId" = p2.id
    WHERE bm."chatChannelId" IS NOT NULL
      AND eb.status = 'IN_PROGRESS'
      AND bm.status IN ('PENDING', 'IN_PROGRESS')
    ORDER BY eb.name, br."roundNumber", bm."orderInRound"
  `);

  return rows.map(r => ({
    matchId:       r.id,
    matchNumber:   r.matchNumber,
    status:        r.status,
    chatChannelId: r.chatChannelId,
    team1: { id: r.team1_id, name: r.team1_name, captainDiscordId: r.cap1_discord, captainGt: r.cap1_gt },
    team2: { id: r.team2_id, name: r.team2_name, captainDiscordId: r.cap2_discord, captainGt: r.cap2_gt },
    bracket:  r.bracket_name,
    round:    r.round_name,
    season:   r.season_name,
    league:   LEAGUE_NAMES[ORG_IDS[r.organizationId]] || 'Unknown',
    createdAt: r.createdAt?.toISOString(),
  }));
}

/**
 * Get a single bracket match by ID with full context.
 */
async function getBracketMatchById(matchId) {
  const { rows } = await query(`
    SELECT bm.*,
           t1.name as team1_name, t1.id as team1_id,
           t2.name as team2_name, t2.id as team2_id,
           tw.name as winner_name,
           p1."discordId" as cap1_discord, p1.gamertag as cap1_gt,
           p2."discordId" as cap2_discord, p2.gamertag as cap2_gt,
           eb.name as bracket_name, eb.format as bracket_format,
           eb."organizationId",
           br.name as round_name, br."roundNumber", br."seriesFormat",
           s.name as season_name
    FROM "BracketMatch" bm
    JOIN "EventBracket" eb ON bm."bracketId" = eb.id
    JOIN "BracketRound" br ON bm."roundId" = br.id
    JOIN "Season" s ON eb."seasonId" = s.id
    LEFT JOIN "Team" t1 ON bm."team1Id" = t1.id
    LEFT JOIN "Team" t2 ON bm."team2Id" = t2.id
    LEFT JOIN "Team" tw ON bm."winnerId" = tw.id
    LEFT JOIN "Player" p1 ON t1."ownerId" = p1.id
    LEFT JOIN "Player" p2 ON t2."ownerId" = p2.id
    WHERE bm.id = $1
  `, [matchId]);

  if (!rows.length) return null;
  const r = rows[0];
  return {
    matchId:     r.id,
    matchNumber: r.matchNumber,
    status:      r.status,
    chatChannelId: r.chatChannelId,
    team1: { id: r.team1_id, name: r.team1_name, score: r.team1Score, captainDiscordId: r.cap1_discord, captainGt: r.cap1_gt },
    team2: { id: r.team2_id, name: r.team2_name, score: r.team2Score, captainDiscordId: r.cap2_discord, captainGt: r.cap2_gt },
    winner:       r.winner_name,
    bracket:      r.bracket_name,
    bracketFormat: r.bracket_format,
    round:        r.round_name,
    roundNumber:  r.roundNumber,
    seriesFormat: r.seriesFormat,
    season:       r.season_name,
    league:       LEAGUE_NAMES[ORG_IDS[r.organizationId]] || 'Unknown',
    isForfeit:    r.isForfeit,
    createdAt:    r.createdAt?.toISOString(),
    completedAt:  r.completedAt?.toISOString(),
  };
}

/**
 * Get active brackets with match counts.
 */
async function getBracketOverview(leagueKey) {
  const orgFilter = leagueKey && KEY_TO_ORG[leagueKey]
    ? 'AND eb."organizationId" = $1' : '';
  const params = leagueKey && KEY_TO_ORG[leagueKey] ? [KEY_TO_ORG[leagueKey]] : [];

  const { rows } = await query(`
    SELECT eb.id, eb.name, eb.format, eb.status, eb."startedAt",
           eb."organizationId", s.name as season_name,
           count(bm.id) FILTER (WHERE bm.status IN ('PENDING','IN_PROGRESS')) as active_matches,
           count(bm.id) FILTER (WHERE bm.status = 'COMPLETED') as completed_matches,
           count(bm.id) as total_matches,
           count(bm."chatChannelId") FILTER (WHERE bm.status IN ('PENDING','IN_PROGRESS')) as channels
    FROM "EventBracket" eb
    JOIN "Season" s ON eb."seasonId" = s.id
    LEFT JOIN "BracketMatch" bm ON bm."bracketId" = eb.id AND bm.status != 'BYE'
    WHERE eb.status = 'IN_PROGRESS' ${orgFilter}
    GROUP BY eb.id, eb.name, eb.format, eb.status, eb."startedAt", eb."organizationId", s.name
    ORDER BY eb."startedAt" DESC
  `, params);

  return rows.map(r => ({
    id:       r.id,
    name:     r.name,
    format:   r.format,
    status:   r.status,
    season:   r.season_name,
    league:   LEAGUE_NAMES[ORG_IDS[r.organizationId]] || 'Unknown',
    activeMatches:    parseInt(r.active_matches) || 0,
    completedMatches: parseInt(r.completed_matches) || 0,
    totalMatches:     parseInt(r.total_matches) || 0,
    channels:         parseInt(r.channels) || 0,
    startedAt: r.startedAt?.toISOString(),
  }));
}

module.exports = {
  getStandings, getLeaderboard, findPlayer, findTeam,
  getActiveSeasons, getRecentMatches, getStatLeaders,
  getTeamRoster, getFullSnapshot, leagueFromGuild,
  findSeason, getSeasonStandings, getSeasonMatches,
  getOpenTickets, getTicket, getNewTicketsSince, getTicketStats,
  findPlayerByDiscordId, getPlayerProfileContext, getMatchContext,
  getActiveBracketMatches, getBracketMatchById, getBracketOverview,
  LEAGUE_NAMES, KEY_TO_ORG, GUILD_TO_LEAGUE, ORG_IDS, query,
};
