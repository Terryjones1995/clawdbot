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

const db     = require('../db');
const mini   = require('./openai-mini');
const ollama = require('../../openclaw/skills/ollama');

const EXTRACT_SYSTEM = `You are a fact extractor for Ghost, an AI assistant managing a league operations platform (HOF League) and Discord server.

Given a conversation exchange (user message + assistant reply), extract any facts worth remembering permanently.

Focus on:
- People: names, roles, Discord usernames, contact info, preferences
- Organization: team names, captains, MMR, schedules, payments, decisions
- League: season info, rules, registrations, brackets, scores
- Preferences: how the user likes things done, communication style, tools they use
- Decisions: anything decided that should inform future responses

Skip:
- Temporary info or one-off questions
- Things already obvious from context
- Chitchat with no lasting value

Return ONLY a JSON array. Each item:
{ "key": "category:normalized_topic", "content": "Complete fact as a clear sentence.", "category": "person|org|league|preference|decision|misc" }

KEY FORMAT — use category:normalized_topic with underscores (no dashes), e.g.:
  preference:favorite_color, preference:communication_style
  person:taylor_discord_username, person:taylor_role
  org:hof_league_season, league:season_3_start_date
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
  const prefix = `${category}:${parts.slice(0, 2).join('_')}%`;
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
  const exchange = `User: ${userMessage}\n\nGhost: ${assistantReply}`;

  const { result, escalate } = await mini.tryChat([
    { role: 'system', content: EXTRACT_SYSTEM },
    { role: 'user',   content: exchange },
  ], { maxTokens: 512 });

  if (escalate || !result?.message?.content) return;

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
async function getRelevantFacts(query, limit = 15) {
  try {
    // Try to generate an embedding for semantic retrieval
    let queryEmbedding = null;
    try {
      queryEmbedding = await ollama.embed(query);
    } catch { /* Ollama unavailable — fall back to ILIKE */ }

    const rows = await db.getFacts(query, limit, queryEmbedding);
    if (!rows.length) return null;

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

    return lines.join('\n');
  } catch {
    return null; // non-fatal — DB unavailable
  }
}

// ── Correction Detection ──────────────────────────────────────────────────────

const CORRECTION_RE = /\b(no[,.]?\s+(actually|that'?s|you'?re|it'?s)|actually[,.]?\s+(it'?s|that'?s|the|no)|that'?s (wrong|incorrect|not right)|you'?re wrong|you('re| are) incorrect|wrong[,.]|incorrect[,.]|not (quite|right|correct)|let me correct|correction[,:]|mistake[,:]|that is (wrong|incorrect))\b/i;

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

  console.log(`[Memory] Stored correction from thread ${threadId}: ${parsed.lesson.slice(0, 80)}`);
  return true;
}

module.exports = { extractAndStore, getRelevantFacts, detectAndStoreCorrection };
