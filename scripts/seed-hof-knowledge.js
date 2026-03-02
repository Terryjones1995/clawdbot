#!/usr/bin/env node
'use strict';

/**
 * Seed HOF Ecosystem knowledge into ghost_memory table.
 * This makes all Ghost agents aware of the 4-league platform structure,
 * site pages, API endpoints, features, and competitive formats.
 *
 * Run: node scripts/seed-hof-knowledge.js
 */

require('dotenv').config();
const db     = require('../src/db');
const ollama = require('../openclaw/skills/ollama');

const FACTS = [
  // ── Platform Overview ──
  {
    key: 'org:hof_platform_overview',
    content: 'The HOF ecosystem is a unified competitive NBA 2K esports platform managing 4 independent leagues: HOF League (hof-arenas.com), Squad Finder (squadsfinder.com), URG Pro-Am (urg-promo.com), and BHL League (officialbhl.com). All 4 run on the same Squad Finder white-label SaaS platform sharing a single backend, but each has its own Discord server, website, branding, events, and payment configuration.',
    category: 'org',
  },
  {
    key: 'org:hof_tech_stack',
    content: 'All 4 league sites are React 18 SPAs (~1.7MB bundle) with Tailwind CSS, served from a Node.js/Express API with PostgreSQL (Prisma ORM). Auth is Discord OAuth. Payments via PayPal. Hosted on Replit. Fonts: Rajdhani (display), Inter (body). Dark mode only with glass-morphism design.',
    category: 'org',
  },
  {
    key: 'org:hof_org_ids',
    content: 'League organization IDs: HOF League = cmjkjlsnw0001gq0geuwgymtg (hof-arenas.com), Squad Finder = cmjjjl2mq0001gq0jz4a94s3o (squadsfinder.com), URG Pro-Am = cmjkmig7m0001gq0gttouwuju (urg-promo.com), BHL League = cmkhtsela0005gq0gudpkk8io (officialbhl.com).',
    category: 'org',
  },

  // ── League Stats ──
  {
    key: 'org:hof_league_stats',
    content: 'HOF League: 6,792 Discord members, 636 players, 88 teams, 783 monthly games, $1,000 prizes. Colors: purple #8b5cf6 primary, amber #f8a628 secondary.',
    category: 'org',
  },
  {
    key: 'org:squad_finder_stats',
    content: 'Squad Finder Leagues: 1,876 Discord members, 426 players, 57 teams, 557 monthly games, $2,950 prizes. Colors: orange #ff9000 primary, gold #ffc300 accent.',
    category: 'org',
  },
  {
    key: 'org:urg_stats',
    content: 'URG Pro-Am (Underrated Gaming League): 4,631 Discord members, 206 players, 33 teams, 146 monthly games, $1,000 prizes. Colors: blue #3b82f6 primary, cyan #06b6d4 accent.',
    category: 'org',
  },
  {
    key: 'org:bhl_stats',
    content: 'BHL League (Big Hoop League): 355 Discord members, 151 players, 25 teams, 216 monthly games, $3,000 prizes. Colors: crimson #9e001a primary, pink-rose #fb7185 accent.',
    category: 'org',
  },

  // ── Site Pages & Navigation ──
  {
    key: 'org:site_pages_navigation',
    content: 'All 4 league sites share the same page structure. Public pages: / (home with hero, live stats, top players/teams, weekly highlights, Discord widget), /events (browse and register for seasons/tournaments, entry fees, prize pools), /teams (all teams with rosters, W-L records, logos), /standings (team standings with W-L, Win%, PF/PA/Diff, L10, Team MMR), /stats (statistical leaders: PPG, RPG, APG, SPG, BPG, FG%, 3PT%), /leaderboard (player MMR rankings with rank tiers), /players (player directory), /rules (league rules by category), /news (AI-generated match reports and announcements).',
    category: 'org',
  },
  {
    key: 'org:site_pages_authenticated',
    content: 'Authenticated pages on all league sites: /my-teams (manage teams, accept/decline invites, create teams), /wallet (PayPal deposits, transfers, withdrawals, transaction history, team fund settings), /invoices (registration fees, fines), /@{username} or /player/{id} (player profile with stats, rank, builds), /profile (edit gamertag, position, console, email verification). Support chat is a floating AI widget available on all pages.',
    category: 'org',
  },
  {
    key: 'org:site_pages_admin',
    content: 'Admin panel at /admin on all league sites has 120+ API endpoints. Sections: Dashboard (overview metrics), League Management (events, matches, brackets, seasons, players, teams, stats, roster settings, suspensions, 10s), Commerce (orders, invoices, payments, wagers, coupons), Content (news with AI generation, rules with AI generation, media library, email campaigns with AI, social post generator), System (branding/appearance with 100+ color tokens, Discord channels/embeds, announcements, tickets, admin notes, data sync, maintenance).',
    category: 'org',
  },

  // ── Event Registration ──
  {
    key: 'org:event_registration_flow',
    content: 'Event registration flow on all league sites: Go to /events page → browse active seasons/tournaments → click Register → select or create team → add roster (5-15 players) → validate player eligibility via POST /api/registration/check-players → optionally apply coupon code via POST /api/registration/validate-coupon → pay entry fee via PayPal ($20-$75 depending on league/event) → submit via POST /api/registration/submit. Registration can have deadlines, team limits, and roster locks.',
    category: 'org',
  },
  {
    key: 'org:event_types',
    content: 'Event types across all leagues: SEASON (full league season with scheduled matches, standings, playoffs — $20-$75 entry), TOURNAMENT (single/double elimination brackets — $35-$40 entry), TENS (10-man automated draft pickup games — usually free, MMR/XP tracking), AFN_TOURNAMENT (afternoon quick tournaments — $40, 4-8 teams, BO3, ~2.5 hours), OVN_TOURNAMENT (overnight tournaments). Event lifecycle: Draft → Registration → Active → Ended → Archived.',
    category: 'org',
  },

  // ── Competitive Format ──
  {
    key: 'org:competitive_format',
    content: 'NBA 2K 5v5 Pro-Am competitive format. Consoles: PS5, Xbox Series X, PC. Rosters: 5-15 players per team. Match flow: Queue → Match Created → Discord Announcement → Game Played → Results Submitted (30-min deadline) → Stats Auto-Updated → AI Match Report Generated. Formats: BO1, BO3, BO5, BO7 series. Playoff eligibility: 15 games minimum, 33%+ win rate. Tiebreakers: H2H then point differential.',
    category: 'org',
  },
  {
    key: 'org:ranking_system',
    content: 'Player ranking system across all leagues: 19 tiers from Rookie to Legend. Progression: Rookie → Bronze I/II/III → Silver I/II/III → Gold I/II/III → Platinum I/II/III → Diamond I/II/III → Elite I/II/III → Champion → Legend. Metrics: MMR (Matchmaking Rating, skill-based), LP (League Points, progression), XP (Experience Points, activity), Floor Impact (composite efficiency). Stats tracked: PPG, RPG, APG, SPG, BPG, TPG, FG%, 3PT%, FT%, Efficiency Rating.',
    category: 'org',
  },

  // ── Financial System ──
  {
    key: 'org:financial_system',
    content: 'Each league has its own PayPal keys and wallet configuration. Features: personal wallets (PayPal deposits, user-to-user transfers, withdrawal requests), team wallets (fund pooling), entry fees ($20-$75/team), player add fee ($10 after roster lock), rename fees, escrow system for wagers, coupon/discount codes, auto-generated invoices with 24-hour payment deadline, auto-suspension for overdue invoices. All financial operations are atomic. Fines: $15 for missing league logo, $5 subsequent.',
    category: 'org',
  },

  // ── API Endpoints ──
  {
    key: 'org:api_endpoints_public',
    content: 'Public API endpoints (same structure on all 4 league sites): GET /api/public/branding (site config/colors), GET /api/public/home/stats (aggregate stats), GET /api/public/home/top-players, GET /api/public/home/top-teams, GET /api/public/home/weekly-highlights, GET /api/public/home/events, GET /api/teams (all teams with rosters), GET /api/standings, GET /api/leaderboard, GET /api/players, GET /api/statistics/leaders, GET /api/news, GET /api/rules, GET /api/seasons/public, GET /api/recent-games, GET /api/discord/member-count.',
    category: 'org',
  },
  {
    key: 'org:api_endpoints_auth',
    content: 'Authenticated API endpoints: GET /api/user/me, GET /api/player/profile/me, GET /api/my-teams, GET /api/invoices/my, GET /api/wagers/user-wallet (balance), GET /api/wagers/user-wallet/transactions, POST /api/registration/submit, POST /api/teams/join/{token}, POST /api/support/chat/session, POST /api/support/chat/message. Auth is Discord OAuth with CSRF token protection.',
    category: 'org',
  },

  // ── AI Features ──
  {
    key: 'org:platform_ai_features',
    content: 'AI features built into the Squad Finder platform (all 4 leagues): 1) Auto-generated match reports (author: "{League} Sports Desk", includes game recap, player spotlight, team analysis, predictions), 2) AI rules generation (POST /api/admin/rules/ai-generate), 3) AI news content (POST /api/admin/news/generate-ai-content), 4) AI email campaign improvement, 5) AI social media post generation, 6) AI support chat (floating widget with session-based conversations), 7) AI team balancing (MMR-aware).',
    category: 'org',
  },

  // ── Discord Integration ──
  {
    key: 'org:discord_integration',
    content: 'Each league has its own Discord server with a dedicated bot. Discord integration includes: OAuth login, avatar sync throughout site, automated match result embeds, tournament bracket channel creation, announcement posting, role assignment (captain roles on event start), member count widget on website, admin member management. Each league has dual bot architecture: Gameplay Bot + Marketing Bot. Ghost bot is in all 4 servers.',
    category: 'org',
  },

  // ── Rules Summary ──
  {
    key: 'org:league_rules_summary',
    content: 'Shared rules across all leagues: 3-strike conduct system (harassment/defamation = strikes, tracked across seasons), 15-minute no-show forfeit, gamertag must match registration, disputes via website ticket system only (not Twitter/DMs), 48-hour reschedule notice required, trades require admin approval during designated windows, 24-hour waiting period for released free agents, results must be reported within 30 minutes, roster lock deadlines enforced, non-refundable entry fees.',
    category: 'org',
  },

  // ── Top Teams ──
  {
    key: 'org:top_teams_current',
    content: 'Current top teams across leagues (as of March 2026): HOF League — Black Market (37-5, 88% WR, 10-0 L10, 1428 MMR), Out Of Sight (27-11, 71%), Lightsout Esports (21-4, 84%). Squad Finder — Out Of Sight (43-10, 81%), Break The Chain (31-8, 79.5%). URG — OG Wolfpack (15-9, 63%), Bodega Cats (10-0, 100%). BHL — Free Smoke (16-2), Workovertalent (16-6), Out Of Sight (13-5).',
    category: 'org',
  },

  // ── Global Player Model ──
  {
    key: 'org:global_player_model',
    content: 'Players are global entities across all 4 leagues. A player can compete in multiple leagues simultaneously, join teams across leagues, and maintain cross-league career statistics. Player profile includes: Discord ID, gamertag, position (PG/SG/SF/PF/C), console (PS5/XBX/PC), overall rating, multiple builds per player, rank tier, MMR, LP, XP, W/L record, win streaks, per-game stat averages (PPG/RPG/APG/FG%/3PT%), Floor Impact efficiency. Stats are league-scoped but career totals are global.',
    category: 'org',
  },

  // ── Matchmaking ──
  {
    key: 'org:matchmaking_system',
    content: 'Two queue types per league: Solo Queue (AI-assisted balancing, MMR-based matching, friend pairing logic, anti-sniping measures) and Team Queue (Team MMR matching, roster verification, voice channel enforcement optional, automated lobby setup). Queue endpoints: POST /api/admin/queues/create, GET /api/admin/queues/detailed, POST /api/admin/queues/reset. 10s mode has separate lobby system for pickup games.',
    category: 'org',
  },
];

async function seed() {
  console.log('[Seed] Connecting to database...');
  await db.initSchema();

  console.log('[Seed] Ensuring Ollama is available for embeddings...');
  let embedAvailable = true;
  try {
    const test = await ollama.embed('test');
    if (!test || test.length < 10) embedAvailable = false;
  } catch {
    embedAvailable = false;
    console.warn('[Seed] Ollama embeddings unavailable — storing without vectors');
  }

  console.log(`[Seed] Storing ${FACTS.length} facts...`);
  let stored = 0;

  for (const fact of FACTS) {
    try {
      let embedding = null;
      if (embedAvailable) {
        embedding = await ollama.embed(fact.content);
      }

      await db.storeFact({
        key:       fact.key,
        content:   fact.content,
        category:  fact.category,
        source:    'seed-hof-knowledge',
        threadId:  null,
        embedding,
      });

      stored++;
      console.log(`  [${stored}/${FACTS.length}] ${fact.key}`);
    } catch (err) {
      console.error(`  FAILED: ${fact.key} — ${err.message}`);
    }
  }

  console.log(`\n[Seed] Done! Stored ${stored}/${FACTS.length} facts into ghost_memory.`);
  process.exit(0);
}

seed().catch(err => {
  console.error('[Seed] Fatal:', err);
  process.exit(1);
});
