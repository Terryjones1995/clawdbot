'use strict';

/**
 * Ghost Memory — Persistent facts extraction and injection
 *
 * After every conversation exchange, Ghost extracts durable facts and stores
 * them in the ghost_memory table (Neon). Before every response, relevant facts
 * are retrieved and injected into the system prompt.
 *
 * This makes Ghost progressively smarter — it accumulates knowledge about
 * users, the org, league, preferences, and decisions over time.
 *
 * Usage:
 *   const memory = require('./skills/memory');
 *
 *   // Before responding — get facts to inject into system prompt
 *   const facts = await memory.getRelevantFacts(userMessage);
 *
 *   // After responding — extract and store new facts (non-blocking)
 *   memory.extractAndStore(userMessage, assistantReply, threadId).catch(() => {});
 */

const crypto   = require('crypto');
const db       = require('../db');
const mini     = require('./openai-mini');
const ollama   = require('../../openclaw/skills/ollama');
const redis    = require('../redis');
const learning = require('./learning');
const registry = require('../agentRegistry');

const EXTRACT_SYSTEM = `You are a fact extractor for Ghost, an AI assistant managing a multi-agent Discord system and operations platform.

Given a conversation exchange (user message + assistant reply), extract any facts worth remembering permanently.

Focus on:
- People: names, roles, Discord usernames, contact info, preferences
- Organization: team names, projects, schedules, payments, decisions
- Preferences: how the user likes things done, communication style, tools they use
- Decisions: anything decided that should inform future responses

Skip:
- Temporary info or one-off questions
- Things already obvious from context
- Chitchat with no lasting value

Return ONLY a JSON array. Each item:
{ "key": "category:normalized_topic", "content": "Complete fact as a clear sentence.", "category": "person|org|preference|decision|misc" }

KEY FORMAT — use category:normalized_topic with underscores (no dashes), e.g.:
  preference:favorite_color, preference:communication_style
  person:taylor_discord_username, person:taylor_role
  org:team_count, org:season_start_date
  decision:payment_method

The same concept must ALWAYS produce the same key. Use the category prefix + a stable snake_case topic.
If no notable facts found, return [].`;

/**
 * Extract userId from a threadId.
 * portal-{userId} → userId
 * discord:{channelId}:{userId} → userId
 */
function _extractUserId(threadId) {
  if (!threadId) return null;
  if (threadId.startsWith('portal-')) return threadId.slice(7);
  const parts = threadId.split(':');
  if (parts[0] === 'discord' && parts.length === 3) return parts[2];
  return null;
}

/**
 * Delete conflicting facts in the same category/topic before upserting.
 * Prevents "favorite color is blue" AND "favorite color is red" coexisting.
 * Matches on category + first two underscore-segments of topic.
 */
async function _sweepConflicts(key, category) {
  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) return;
  const topic = key.slice(colonIdx + 1);
  const parts = topic.split('_');
  if (parts.length < 2) return;
  // Match keys with same category and same first two topic words but different full key
  const rawPrefix = `${category}:${parts.slice(0, 2).join('_')}`;
  const prefix = rawPrefix.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%';
  await db.query(
    'DELETE FROM ghost_memory WHERE category = $1 AND key LIKE $2 AND key != $3',
    [category, prefix, key],
  ).catch(() => {});
}

/**
 * Extract facts from a conversation exchange and store them in Neon.
 * Runs in the background — call with .catch(() => {}) to make non-blocking.
 *
 * @param {string} userMessage
 * @param {string} assistantReply
 * @param {string} threadId
 */
async function extractAndStore(userMessage, assistantReply, threadId) {
  registry.setStatus('archivist', 'working');
  try {
    const exchange = `User: ${userMessage}\n\nGhost: ${assistantReply}`;

    const { result, escalate } = await mini.tryChat([
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user',   content: exchange },
    ], { maxTokens: 512 });

    if (escalate || !result?.message?.content) {
      return;
    }

    let facts;
    try {
      const raw = result.message.content.trim()
        .replace(/^```(?:json)?\n?/, '')
        .replace(/\n?```$/, '');
      facts = JSON.parse(raw);
      if (!Array.isArray(facts)) return;
    } catch {
      return; // model returned garbage — skip silently
    }

    const userId = _extractUserId(threadId);
    const profileData = {};

    for (const fact of facts) {
      if (!fact.key || !fact.content) continue;
      const category = fact.category ?? 'misc';

      // Conflict sweep — remove stale facts with same category+topic prefix
      await _sweepConflicts(fact.key, category);

      // Generate embedding for semantic search (non-fatal — Ollama may be unavailable)
      let embedding = null;
      try {
        embedding = await ollama.embed(fact.content);
      } catch { /* non-fatal — store without embedding */ }

      await db.storeFact({
        key:      fact.key,
        content:  fact.content,
        category,
        source:   'conversation',
        threadId,
        embedding,
      }).catch(() => {});

      // Collect profile-relevant facts (person + preference categories)
      if ((category === 'person' || category === 'preference') && userId) {
        const topicKey = fact.key.split(':')[1] || fact.key;
        profileData[topicKey] = fact.content;
      }
    }

    // Merge profile-relevant facts into user_profiles
    if (Object.keys(profileData).length > 0 && userId) {
      db.upsertProfile(userId, profileData).catch(() => {});
    }

    if (facts.length > 0) {
      console.log(`[Memory] Stored ${facts.length} fact(s) from thread ${threadId}`);
      registry.pushEvent('archivist', `extracted ${facts.length} fact(s) from ${threadId}`, 'success');
    }
  } finally {
    registry.setStatus('archivist', 'idle');
  }
}

/**
 * Retrieve facts relevant to the current user message.
 * Tries semantic vector search first (Ollama embedding), falls back to ILIKE.
 * Returns a formatted string ready to inject into the system prompt,
 * or null if no facts are stored yet.
 *
 * @param {string} query    — the user's message
 * @param {number} limit    — max facts to include (default 15)
 */
const FACTS_TTL = 60; // 60 seconds

async function getRelevantFacts(query, limit = 15) {
  // Check Redis cache first (avoids Ollama embed + pgvector query)
  const cacheKey = `facts:${crypto.createHash('sha256').update(`${query}:${limit}`).digest('hex')}`;
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return cached === '' ? null : cached;
  }

  registry.setStatus('archivist', 'working');
  try {
    // Try to generate an embedding for semantic retrieval
    let queryEmbedding = null;
    try {
      queryEmbedding = await ollama.embed(query);
    } catch { /* Ollama unavailable — fall back to ILIKE */ }

    const rows = await db.getFacts(query, limit, queryEmbedding);
    if (!rows.length) {
      await redis.set(cacheKey, '', FACTS_TTL); // cache negative result
      registry.setStatus('archivist', 'idle');
      return null;
    }

    // Bump access tracking (non-blocking)
    const ids = rows.map(r => r.id).filter(Boolean);
    if (ids.length) db.touchFacts(ids).catch(() => {});

    // Group by category for cleaner injection
    const grouped = {};
    for (const row of rows) {
      const cat = row.category || 'misc';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(row.content);
    }

    const lines = [];
    for (const [cat, facts] of Object.entries(grouped)) {
      lines.push(`[${cat.toUpperCase()}]`);
      facts.forEach(f => lines.push(`• ${f}`));
    }

    const result = lines.join('\n');
    await redis.set(cacheKey, result, FACTS_TTL);
    registry.pushEvent('archivist', `recall: ${rows.length} facts for "${query.slice(0, 30)}"`, 'info');
    registry.setStatus('archivist', 'idle');
    return result;
  } catch {
    registry.setStatus('archivist', 'idle');
    return null; // non-fatal — DB unavailable
  }
}

// ── Correction Detection ──────────────────────────────────────────────────────

const CORRECTION_RE = /\b(no[,.]?\s+(actually|that'?s|you'?re|it'?s|wrong)|actually[,.]?\s+(it'?s|that'?s|the|no)|that'?s\s+(wrong|incorrect|not right)|you'?re\s+wrong|you('re| are)\s+incorrect|wrong[,.\s]|incorrect[,.\s]|not\s+(quite|right|correct)|let me correct|correction[,:\s]|mistake[,:\s]|that\s+is\s+(wrong|incorrect)|that ain'?t right|nah[,.]?\s+(it'?s|that'?s|you)|stop saying)/i;

const CORRECTION_SYSTEM = `You are a lesson extractor for Ghost, an AI assistant.
The user is correcting a previous response. Extract the lesson clearly.

Return ONLY a JSON object:
{ "key": "lesson-unique-slug", "lesson": "Ghost was wrong about X. The correct answer is Y.", "category": "correction" }

The lesson must be a complete, standalone sentence that Ghost can use to avoid the same mistake.
If you cannot identify a clear correction, return null.`;

/**
 * Detect if the user is correcting Ghost, and store the lesson if so.
 * Call before extractAndStore on every message.
 *
 * @param {string} userMessage       — current user message
 * @param {string} previousReply     — Ghost's previous response (may be null)
 * @param {string} threadId
 */
async function detectAndStoreCorrection(userMessage, previousReply, threadId) {
  if (!CORRECTION_RE.test(userMessage)) return false;
  if (!previousReply) return false;

  const exchange = `Ghost previously said: "${previousReply.slice(0, 400)}"\n\nUser correction: "${userMessage}"`;

  const { result, escalate } = await mini.tryChat([
    { role: 'system', content: CORRECTION_SYSTEM },
    { role: 'user',   content: exchange },
  ], { maxTokens: 256 });

  if (escalate || !result?.message?.content) return false;

  let parsed;
  try {
    const raw = result.message.content.trim()
      .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    parsed = JSON.parse(raw);
    if (!parsed || !parsed.key || !parsed.lesson) return false;
  } catch {
    return false;
  }

  await db.storeFact({
    key:      parsed.key,
    content:  parsed.lesson,
    category: 'correction',
    source:   'correction',
    threadId,
  }).catch(() => {});

  // Also feed to learning system so agents can improve
  learning.learnFromCorrection('ghost', previousReply, userMessage, threadId).catch(() => {});

  console.log(`[Memory] Stored correction from thread ${threadId}: ${parsed.lesson.slice(0, 80)}`);
  return true;
}

// ── Memory Pruning ────────────────────────────────────────────────────────────

/**
 * Run memory cleanup — removes stale facts, archives old threads, prunes logs.
 * Called by Scribe's weekly scheduler.
 * Returns a summary of what was cleaned.
 */
async function pruneMemory() {
  const results = {};

  // 1. Prune stale ghost_memory facts
  try {
    results.facts = await db.pruneStaleMemory();
  } catch (err) {
    results.facts = { error: err.message };
  }

  // 2. Archive old conversation threads (clear messages, keep summary)
  try {
    results.archivedThreads = await db.archiveOldThreads();
  } catch (err) {
    results.archivedThreads = { error: err.message };
  }

  // 3. Prune old agent logs
  try {
    results.prunedLogs = await db.pruneOldLogs();
  } catch (err) {
    results.prunedLogs = { error: err.message };
  }

  const totalPruned = (results.facts?.total || 0) + (results.archivedThreads || 0) + (results.prunedLogs || 0);
  console.log(`[Memory] Pruning complete — ${totalPruned} items cleaned:`,
    JSON.stringify(results));

  return results;
}

/**
 * Get memory health stats.
 */
async function getMemoryStats() {
  return db.getMemoryStats();
}

// ── League Data Cache ─────────────────────────────────────────────────────────

const LEAGUE_CACHE_TTL = 24 * 60 * 60; // 24h in seconds (for Redis)
const LEAGUE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Cache league API results in ghost_memory for local-first retrieval.
 * @param {string} leagueKey - 'hof', 'sf', 'urg', 'bhl'
 * @param {string} dataType  - 'events', 'standings', etc.
 * @param {*}      data      - raw API response data
 * @param {string} formatted - human-readable formatted string
 */
async function cacheLeagueData(leagueKey, dataType, data, formatted) {
  const key = `league-cache:${leagueKey}:${dataType}`;
  const content = formatted || JSON.stringify(data);

  await db.storeFact({
    key,
    content,
    category: 'league-data',
    source:   'league-api-cache',
  }).catch(() => {});

  // Also cache in Redis for fast reads
  const redisKey = `leaguecache:${leagueKey}:${dataType}`;
  await redis.set(redisKey, JSON.stringify({ data, formatted: content, ts: Date.now() }), LEAGUE_CACHE_TTL);
}

/**
 * Get cached league data. Returns null if cache is missing or stale.
 * @param {string} leagueKey
 * @param {string} dataType
 * @param {number} [maxAgeMs] - max cache age in ms (default 24h)
 * @returns {{ data: *, formatted: string, ts: number } | null}
 */
async function getCachedLeagueData(leagueKey, dataType, maxAgeMs = LEAGUE_CACHE_MAX_AGE_MS) {
  // Try Redis first (fast)
  const redisKey = `leaguecache:${leagueKey}:${dataType}`;
  const cached = await redis.get(redisKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < maxAgeMs) return parsed;
    } catch { /* corrupt cache */ }
  }

  // Fallback: check ghost_memory (Neon)
  try {
    const { rows } = await db.query(
      `SELECT content, updated_at FROM ghost_memory
       WHERE key = $1 AND source = 'league-api-cache'
       LIMIT 1`,
      [`league-cache:${leagueKey}:${dataType}`],
    );
    if (rows.length && (Date.now() - new Date(rows[0].updated_at).getTime()) < maxAgeMs) {
      return { data: null, formatted: rows[0].content, ts: new Date(rows[0].updated_at).getTime() };
    }
  } catch { /* non-fatal */ }

  return null;
}

// ── Admin Observation — passive learning from admin messages ──────────────────
//
// Ghost monitors all admin messages and extracts useful domain knowledge.
// This makes Ghost progressively learn how admins think, what they know,
// and how they handle situations — becoming more like them over time.

// Buffer: channelId → { messages: [{author, content, ts}], lastAnalysis: timestamp }
const _adminBuffer = new Map();
const OBSERVE_COOLDOWN_MS  = 5 * 60 * 1000;  // Analyze at most once per 5 min per channel
const OBSERVE_MIN_CHARS    = 30;              // Skip very short messages
const OBSERVE_BUFFER_MAX   = 10;              // Max messages to buffer before forcing analysis
const OBSERVE_FLUSH_MS     = 2 * 60 * 1000;  // Flush buffer after 2 min of silence

// Quick pre-filter: skip obvious noise that never contains extractable knowledge
const NOISE_RE = /^(![\w]+|<[@#]\d+>|https?:\/\/\S+|[^\w\s]{1,5}|lol|lmao|ok|bet|nah|yeah|yep|nope|idk|smh|bruh|haha|damn|true|facts|yo|hey|sup|gm|gn|gg|w+|l+)$/i;

function _isNoise(text) {
  const t = text.trim();
  if (t.length < OBSERVE_MIN_CHARS) return true;
  if (NOISE_RE.test(t)) return true;
  // Pure emoji messages
  if (/^[\p{Emoji}\s]+$/u.test(t)) return true;
  // Pure URL
  if (/^https?:\/\/\S+$/i.test(t)) return true;
  return false;
}

const OBSERVE_SYSTEM = `You are a knowledge extractor for Ghost, an AI assistant that manages Discord communities for NBA 2K esports leagues.

You are reading messages from league ADMINS — the people who run the leagues. Your job is to extract any useful knowledge that would help Ghost answer questions and assist users better.

Extract knowledge about:
- League operations: rules, schedules, processes, how things work
- Events/seasons: registration, fees, dates, formats, roster rules
- Players/teams: roster changes, bans, notable players, team info
- Platform: how the website works, features, settings, admin tools
- Decisions: policy changes, rule updates, announcements
- Community: how to handle situations, common issues, dispute resolution
- Anything an AI assistant would need to know to help run the league

SKIP:
- Casual chat, banter, memes, jokes
- Personal conversations unrelated to the league
- Messages that are just reactions or acknowledgments
- Things too vague or context-dependent to be useful standalone

Return ONLY a JSON array of extracted facts. Each fact must be a complete, standalone sentence.
Format: [{ "key": "category:topic_slug", "content": "Complete fact sentence.", "category": "org|decision|person|league-ops|event|rule" }]

Categories:
- org: organizational facts (team names, member roles, processes)
- decision: policy decisions, rule changes
- person: info about specific people (admins, players)
- league-ops: how the league operates day-to-day
- event: event/season/tournament details
- rule: rules, regulations, requirements

If NOTHING useful can be extracted, return [].
Keep it strict — only extract genuinely useful, durable knowledge.`;

/**
 * Buffer an admin message for observation. Non-blocking.
 * Messages are batched per channel and analyzed periodically.
 *
 * @param {string} channelId
 * @param {string} authorName - Discord username
 * @param {string} authorId   - Discord user ID
 * @param {string} content    - message text
 * @param {string} guildId    - guild the message was sent in
 */
function observeAdminMessage(channelId, authorName, authorId, content, guildId) {
  // Pre-filter noise synchronously — no async overhead
  if (_isNoise(content)) return;

  const key = channelId;
  if (!_adminBuffer.has(key)) {
    _adminBuffer.set(key, { messages: [], lastAnalysis: 0, guildId, flushTimer: null });
  }

  const buf = _adminBuffer.get(key);
  buf.messages.push({ author: authorName, authorId, content, ts: Date.now() });
  buf.guildId = guildId;

  // Clear existing flush timer and set a new one
  if (buf.flushTimer) clearTimeout(buf.flushTimer);
  buf.flushTimer = setTimeout(() => _flushBuffer(key), OBSERVE_FLUSH_MS);

  // Force flush if buffer is full
  if (buf.messages.length >= OBSERVE_BUFFER_MAX) {
    clearTimeout(buf.flushTimer);
    _flushBuffer(key);
  }
}

async function _flushBuffer(key) {
  const buf = _adminBuffer.get(key);
  if (!buf || buf.messages.length === 0) return;

  // Cooldown check
  if (Date.now() - buf.lastAnalysis < OBSERVE_COOLDOWN_MS) return;

  // Grab messages and clear buffer
  const messages = buf.messages.splice(0);
  buf.lastAnalysis = Date.now();

  // Analyze in background
  _analyzeAdminMessages(messages, buf.guildId).catch(err => {
    console.warn('[Memory] Admin observation analysis failed:', err.message);
  });
}

async function _analyzeAdminMessages(messages, guildId) {
  // Build a transcript of the buffered messages
  const transcript = messages
    .map(m => `${m.author}: ${m.content}`)
    .join('\n');

  if (transcript.length < 40) return; // Still too short after batching

  // Determine which league this is from
  const leagueApi = require('./league-api');
  const leagueKey = guildId ? leagueApi.leagueFromGuild(guildId) : null;
  const leagueName = leagueKey ? leagueApi.LEAGUES[leagueKey]?.name : 'Unknown league';

  const prompt = `League context: ${leagueName}\n\nAdmin messages:\n${transcript}`;

  // Use Ollama (free) for triage + extraction in one call
  const { result, escalate } = await ollama.tryChat([
    { role: 'system', content: OBSERVE_SYSTEM },
    { role: 'user',   content: prompt },
  ], { params: { num_ctx: 4096 } });

  if (escalate || !result?.message?.content) return;

  let facts;
  try {
    const raw = result.message.content.trim()
      .replace(/^```(?:json)?\n?/, '')
      .replace(/\n?```$/, '');
    // Handle /think blocks from reasoning models
    const jsonStart = raw.indexOf('[');
    const jsonEnd   = raw.lastIndexOf(']');
    if (jsonStart === -1 || jsonEnd === -1) return;
    facts = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(facts) || facts.length === 0) return;
  } catch {
    return; // Model returned garbage — skip silently
  }

  let stored = 0;
  for (const fact of facts) {
    if (!fact.key || !fact.content) continue;
    const category = fact.category ?? 'org';

    // Prefix key with league for scoping
    const scopedKey = leagueKey ? `${leagueKey}:${fact.key}` : fact.key;

    // Sweep conflicts before storing
    await _sweepConflicts(scopedKey, category);

    // Generate embedding
    let embedding = null;
    try {
      embedding = await ollama.embed(fact.content);
    } catch { /* non-fatal */ }

    await db.storeFact({
      key:      scopedKey,
      content:  fact.content,
      category,
      source:   'admin-observation',
      embedding,
    }).catch(() => {});

    stored++;
  }

  if (stored > 0) {
    console.log(`[Memory] Admin observation: extracted ${stored} fact(s) from ${messages.length} message(s) in ${leagueName}`);
    db.logEntry({
      level: 'INFO', agent: 'Memory', action: 'admin-observation',
      outcome: 'success', note: `${stored} facts from ${messages.length} msgs (${leagueName})`,
    }).catch(() => {});
  }
}

// Cleanup stale buffers every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, buf] of _adminBuffer) {
    if (buf.messages.length === 0 && now - buf.lastAnalysis > 30 * 60 * 1000) {
      if (buf.flushTimer) clearTimeout(buf.flushTimer);
      _adminBuffer.delete(key);
    }
  }
}, 30 * 60 * 1000);

// ── Ticket Analysis — extract lessons from closed ticket conversations ────────

const TICKET_ANALYSIS_SYSTEM = `You are analyzing a closed support ticket conversation. Extract useful lessons and patterns.

Focus on:
- Common issue types and root causes
- What solutions worked (or didn't)
- Knowledge gaps — things Ghost didn't know but should
- Process patterns — how tickets get resolved
- User sentiment — satisfaction signals

Return a JSON array. Each item:
{ "lesson": "Clear description of what was learned", "category": "issue-pattern|resolution|knowledge-gap|process|sentiment", "severity": "low|medium|high" }

If no meaningful lessons, return [].
Keep each lesson under 200 characters. Max 5 lessons per ticket.`;

/**
 * Analyze closed ticket transcripts and extract lessons.
 * Called nightly by Scribe. Returns { analyzed, lessons }.
 */
async function analyzeClosedTickets() {
  const tickets = await db.getUnanalyzedTickets(15);
  if (!tickets.length) return { analyzed: 0, lessons: 0 };

  let totalLessons = 0;

  for (const ticket of tickets) {
    try {
      // Build transcript text from JSONB array
      const msgs = Array.isArray(ticket.transcript) ? ticket.transcript : [];
      if (msgs.length < 3) {
        await db.markTicketAnalyzed(ticket.channel_id);
        continue;
      }

      const transcript = msgs.map(m => {
        const parts = [];
        for (const embed of (m.embeds || [])) {
          if (embed.title || embed.description) {
            parts.push(`[EMBED] ${embed.title || ''}: ${(embed.description || '').slice(0, 300)}`);
          }
        }
        if (m.content) parts.push(`${m.isBot ? '[BOT] ' : ''}${m.author}: ${m.content}`);
        return parts.join('\n');
      }).filter(Boolean).join('\n');

      if (transcript.length < 50) {
        await db.markTicketAnalyzed(ticket.channel_id);
        continue;
      }

      const prompt = `Ticket from guild ${ticket.guild_id || 'unknown'}, category: ${ticket.category_name || 'unknown'}.\nOpened by: ${ticket.opener_name || 'unknown'}\n\n--- TRANSCRIPT ---\n${transcript.slice(0, 6000)}\n--- END ---\n\nExtract lessons:`;

      const ollamaLib = require('../../openclaw/skills/ollama');
      const { result, escalate } = await ollamaLib.tryChat([
        { role: 'system', content: TICKET_ANALYSIS_SYSTEM },
        { role: 'user',   content: prompt },
      ], { params: { num_ctx: 8192 } });

      if (escalate || !result?.message?.content) {
        await db.markTicketAnalyzed(ticket.channel_id);
        continue;
      }

      let raw = result.message.content.trim();
      // Handle /think blocks from reasoning models
      if (raw.includes('</think>')) raw = raw.split('</think>').pop().trim();
      const start = raw.indexOf('[');
      const end   = raw.lastIndexOf(']');
      if (start < 0 || end < 0) {
        await db.markTicketAnalyzed(ticket.channel_id);
        continue;
      }

      const lessons = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(lessons) || !lessons.length) {
        await db.markTicketAnalyzed(ticket.channel_id);
        continue;
      }

      for (const l of lessons.slice(0, 5)) {
        if (!l.lesson || l.lesson.length < 10) continue;

        let embedding = null;
        try { embedding = await ollamaLib.embed(l.lesson); } catch { /* non-fatal */ }

        await db.createLesson({
          agent:    'ghost',
          lesson:   l.lesson,
          category: l.category || 'ticket-insight',
          severity: l.severity || 'medium',
          source:   'ticket-analysis',
          context:  `ticket:${ticket.channel_id}:${ticket.guild_id || ''}`,
          embedding,
        });
        totalLessons++;
      }

      await db.markTicketAnalyzed(ticket.channel_id);
    } catch (err) {
      console.warn(`[Memory] Ticket analysis failed for ${ticket.channel_id}:`, err.message);
      await db.markTicketAnalyzed(ticket.channel_id);
    }
  }

  if (totalLessons > 0) {
    console.log(`[Memory] Ticket analysis: ${totalLessons} lesson(s) from ${tickets.length} ticket(s)`);
    db.logEntry({
      level: 'INFO', agent: 'Memory', action: 'ticket-analysis',
      outcome: 'success', note: `${totalLessons} lessons from ${tickets.length} tickets`,
    }).catch(() => {});
  }

  return { analyzed: tickets.length, lessons: totalLessons };
}

/**
 * Snapshot open ticket transcripts — check DB state of open tickets.
 * OpenClaw handles Discord channel access natively; this just checks
 * for stale tickets that may need cleanup.
 */
async function snapshotOpenTickets() {
  const openTickets = await db.getOpenTickets();
  let stale = 0;

  for (const t of openTickets) {
    // Check if ticket has been open for more than 7 days without update
    const updatedAt = new Date(t.updated_at || t.created_at);
    const daysSinceUpdate = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > 7) {
      await db.closeTicket(t.channel_id, null, 'Auto-closed: no activity for 7+ days');
      stale++;
    }
  }

  return { saved: stale, closed: stale, total: openTickets.length };
}

module.exports = {
  extractAndStore, getRelevantFacts, detectAndStoreCorrection,
  pruneMemory, getMemoryStats,
  cacheLeagueData, getCachedLeagueData,
  observeAdminMessage,
  analyzeClosedTickets, snapshotOpenTickets,
};
