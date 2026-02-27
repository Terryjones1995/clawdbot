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

const db   = require('../db');
const mini = require('./openai-mini');

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
{ "key": "unique-slug-identifier", "content": "Complete fact as a clear sentence.", "category": "person|org|league|preference|decision|misc" }

The key must be a stable, unique slug (e.g. "user-taylor-role", "hof-season-3-start", "team-raptors-captain").
If no notable facts found, return [].`;

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

  for (const fact of facts) {
    if (!fact.key || !fact.content) continue;
    await db.storeFact({
      key:      fact.key,
      content:  fact.content,
      category: fact.category ?? 'misc',
      source:   'conversation',
      threadId,
    }).catch(() => {});
  }

  if (facts.length > 0) {
    console.log(`[Memory] Stored ${facts.length} fact(s) from thread ${threadId}`);
  }
}

/**
 * Retrieve facts relevant to the current user message.
 * Returns a formatted string ready to inject into the system prompt,
 * or null if no facts are stored yet.
 *
 * @param {string} query    — the user's message
 * @param {number} limit    — max facts to include (default 15)
 */
async function getRelevantFacts(query, limit = 15) {
  try {
    const rows = await db.getFacts(query, limit);
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

module.exports = { extractAndStore, getRelevantFacts };
