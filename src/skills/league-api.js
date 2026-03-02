'use strict';

/**
 * League API — Live data fetching from HOF ecosystem league sites.
 *
 * Fetches real-time data (events, standings, teams, stats, leaderboard, news)
 * from the 4 league websites that run on the Squad Finder SaaS platform.
 *
 * Usage:
 *   const leagueApi = require('./skills/league-api');
 *   const events = await leagueApi.query('hof', 'events');
 *   const all    = await leagueApi.queryAll('standings');
 */

const LEAGUES = {
  hof:   { name: 'HOF League',   domain: 'hof-arenas.com',   orgId: 'cmjkjlsnw0001gq0geuwgymtg' },
  sf:    { name: 'Squad Finder', domain: 'squadsfinder.com', orgId: 'cmjjjl2mq0001gq0jz4a94s3o' },
  urg:   { name: 'URG Pro-Am',   domain: 'urg-promo.com',    orgId: 'cmjkmig7m0001gq0gttouwuju' },
  bhl:   { name: 'BHL League',   domain: 'officialbhl.com',  orgId: 'cmkhtsela0005gq0gudpkk8io' },
};

// Map of guild IDs to league keys
const GUILD_TO_LEAGUE = {
  '776927230827167794':  'hof',
  '657244609428062226':  'sf',
  '751916925960978442':  'urg',
  '1105891245391347744': 'bhl',
};

// Endpoints available on all league sites
const ENDPOINTS = {
  events:       '/api/seasons/public',
  standings:    '/api/standings',
  teams:        '/api/teams',
  leaderboard:  '/api/leaderboard',
  stats:        '/api/statistics/leaders',
  news:         '/api/news',
  'top-teams':  '/api/public/home/top-teams',
  'top-players':'/api/public/home/top-players',
  'home-stats': '/api/public/home/stats',
  'recent-games':'/api/recent-games',
  rules:        '/api/rules',
  branding:     '/api/public/branding',
};

/**
 * Fetch a specific endpoint from a league's website.
 * @param {string} leagueKey - 'hof', 'sf', 'urg', or 'bhl'
 * @param {string} endpoint  - one of ENDPOINTS keys or a custom path
 * @param {object} [opts]    - { limit, timeout }
 * @returns {object} { league, endpoint, data, error }
 */
async function query(leagueKey, endpoint, opts = {}) {
  const league = LEAGUES[leagueKey];
  if (!league) return { league: leagueKey, endpoint, data: null, error: `Unknown league: ${leagueKey}` };

  const path    = ENDPOINTS[endpoint] || endpoint;
  const url     = `https://${league.domain}${path}`;
  const timeout = opts.timeout || 10_000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return { league: league.name, endpoint, data: null, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { league: league.name, endpoint, data, error: null };
  } catch (err) {
    return { league: league.name, endpoint, data: null, error: err.message };
  }
}

/**
 * Fetch an endpoint from all 4 leagues in parallel.
 * @param {string} endpoint - ENDPOINTS key or custom path
 * @returns {object[]} Array of { league, endpoint, data, error }
 */
async function queryAll(endpoint) {
  const keys = Object.keys(LEAGUES);
  return Promise.all(keys.map(k => query(k, endpoint)));
}

/**
 * Get league key from guild ID.
 */
function leagueFromGuild(guildId) {
  return GUILD_TO_LEAGUE[guildId] || null;
}

/**
 * Format live data into a human-readable summary for Ghost responses.
 * @param {string} queryType - 'events', 'standings', 'top-teams', etc.
 * @param {object[]} results - Array from queryAll() or single query()
 * @returns {string} formatted text
 */
function formatResults(queryType, results) {
  const parts = [];

  for (const r of Array.isArray(results) ? results : [results]) {
    if (r.error) {
      parts.push(`**${r.league}**: unavailable (${r.error})`);
      continue;
    }

    const data = r.data;
    if (!data) continue;

    switch (queryType) {
      case 'events': {
        const events = Array.isArray(data) ? data : data.seasons || data.events || [];
        if (!events.length) { parts.push(`**${r.league}**: No active events`); break; }
        const lines = events.slice(0, 5).map(e => {
          const name  = e.name || e.title || 'Unnamed';
          const fee   = e.entryFee || e.entry_fee ? `$${e.entryFee || e.entry_fee}` : 'Free';
          const teams = e.teamCount || e.team_count || e._count?.teams || '?';
          const status = e.status || '';
          return `  - ${name} (${fee}, ${teams} teams${status ? `, ${status}` : ''})`;
        });
        parts.push(`**${r.league}**:\n${lines.join('\n')}`);
        break;
      }
      case 'standings': {
        const teams = Array.isArray(data) ? data : data.standings || [];
        if (!teams.length) { parts.push(`**${r.league}**: No standings`); break; }
        const lines = teams.slice(0, 5).map((t, i) => {
          const name = t.name || t.team?.name || 'Unknown';
          const w = t.wins ?? t.w ?? 0, l = t.losses ?? t.l ?? 0;
          return `  ${i+1}. ${name} (${w}-${l})`;
        });
        parts.push(`**${r.league}** (top 5):\n${lines.join('\n')}`);
        break;
      }
      case 'top-teams': {
        const teams = Array.isArray(data) ? data : data.teams || [];
        if (!teams.length) { parts.push(`**${r.league}**: No teams`); break; }
        const lines = teams.slice(0, 5).map((t, i) => {
          const name = t.name || 'Unknown';
          const w = t.wins ?? 0, l = t.losses ?? 0;
          const wr = w + l > 0 ? `${Math.round(w/(w+l)*100)}%` : 'N/A';
          return `  ${i+1}. ${name} (${w}-${l}, ${wr} WR)`;
        });
        parts.push(`**${r.league}**:\n${lines.join('\n')}`);
        break;
      }
      case 'leaderboard':
      case 'top-players': {
        const players = Array.isArray(data) ? data : data.players || data.leaderboard || [];
        if (!players.length) { parts.push(`**${r.league}**: No players`); break; }
        const lines = players.slice(0, 5).map((p, i) => {
          const name = p.gamertag || p.username || p.name || 'Unknown';
          const mmr  = p.mmr || p.rating || '';
          const tier = p.tier || p.rank || '';
          return `  ${i+1}. ${name}${mmr ? ` (MMR: ${mmr})` : ''}${tier ? ` — ${tier}` : ''}`;
        });
        parts.push(`**${r.league}**:\n${lines.join('\n')}`);
        break;
      }
      default: {
        // Generic: just mention we have data
        const count = Array.isArray(data) ? data.length : Object.keys(data).length;
        parts.push(`**${r.league}**: ${count} entries`);
      }
    }
  }

  return parts.join('\n\n');
}

/**
 * Detect if a user message is asking about league data that we can answer with live API calls.
 * Returns { shouldQuery, queryType, leagueKey } or null.
 */
function detectLeagueQuery(message) {
  const m = message.toLowerCase();

  // Patterns to detect league-related queries
  const patterns = [
    { re: /(?:what|which|any|show|list|current|active|open|upcoming).*(?:events?|seasons?|tournaments?|register|registration|sign ?up)/i, type: 'events' },
    { re: /(?:standings|rankings?|leaderboard|table|bracket)/i, type: 'standings' },
    { re: /(?:top|best|leading|#1|number one).*(?:teams?|squads?)/i, type: 'top-teams' },
    { re: /(?:top|best|leading|mvp|#1).*(?:players?|gamers?)/i, type: 'top-players' },
    { re: /(?:recent|latest|last).*(?:games?|matches?|results?|scores?)/i, type: 'recent-games' },
    { re: /(?:stats|statistics|leaders|ppg|rpg|apg)/i, type: 'stats' },
    { re: /(?:news|announcements?|updates?|reports?).*(?:league|match|game)/i, type: 'news' },
    { re: /(?:league|match|game).*(?:news|announcements?|updates?|reports?)/i, type: 'news' },
    { re: /(?:rules|regulations|policies|code of conduct)/i, type: 'rules' },
  ];

  let queryType = null;
  for (const p of patterns) {
    if (p.re.test(m)) { queryType = p.type; break; }
  }
  if (!queryType) return null;

  // Detect specific league
  let leagueKey = null;
  if (/\bhof\b/i.test(m) || /hof.?arena/i.test(m))    leagueKey = 'hof';
  else if (/\bsquad\s?finder\b/i.test(m) || /\bsf\b/i.test(m)) leagueKey = 'sf';
  else if (/\burg\b/i.test(m) || /underrated/i.test(m)) leagueKey = 'urg';
  else if (/\bbhl\b/i.test(m) || /big\s?hoop/i.test(m)) leagueKey = 'bhl';

  return { shouldQuery: true, queryType, leagueKey };
}

module.exports = {
  query,
  queryAll,
  leagueFromGuild,
  formatResults,
  detectLeagueQuery,
  LEAGUES,
  ENDPOINTS,
  GUILD_TO_LEAGUE,
};
