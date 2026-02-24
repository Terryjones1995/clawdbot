'use strict';

/**
 * POST /api/reception
 *
 * Portal terminal endpoint — receives messages from the Next.js portal terminal,
 * classifies via Switchboard, routes to the appropriate agent, and returns a reply.
 *
 * Body:
 *   { message, userId?, username?, source?, channelId? }
 *
 * Response:
 *   { reply, agent, intent, model?, latency_ms }
 */

const express     = require('express');
const switchboard = require('../switchboard');
const keeper      = require('../keeper');
const scout       = require('../scout');
const forge       = require('../forge');
const scribe      = require('../scribe');
const archivist   = require('../archivist');

const router = express.Router();

// Fallback chat via keeper (context-aware conversation)
async function chatFallback(message, userId) {
  const threadId = `portal-${userId ?? 'default'}`;
  const reply    = await keeper.chat(threadId, message);
  return { reply, agent: 'keeper', intent: 'chat', model: 'qwen3:8b' };
}

router.post('/', async (req, res) => {
  const t0 = Date.now();
  const { message, userId = 'portal-user', username = 'Portal', source = 'portal-terminal' } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  let result;

  try {
    // 1 — Classify
    const decision = await switchboard.classify({
      source:    source,
      user_role: req.user?.username === process.env.DISCORD_OWNER_USER_ID ? 'OWNER' : 'ADMIN',
      message:   message.trim(),
    });

    const intent = decision.intent ?? 'unknown';
    const agent  = decision.agent  ?? 'keeper';

    // 2 — Route to agent
    if (intent === 'greeting' || intent === 'unknown/unclassified' || agent === 'keeper') {
      result = await chatFallback(message, userId);

    } else if (agent === 'Scout' || intent?.includes('research') || intent?.includes('lookup') || intent?.includes('search')) {
      const scoutResult = await scout.run({
        query:        message.trim(),
        type:         'factual',
        depth:        'quick',
        store_result: false,
      });
      result = {
        reply:  scoutResult.answer ?? scoutResult.summary ?? JSON.stringify(scoutResult),
        agent:  'scout',
        intent,
        model:  scoutResult.model,
      };

    } else if (agent === 'Forge' || intent?.includes('code')) {
      const forgeResult = await forge.review({ pr: message.trim(), userRole: 'ADMIN' });
      result = {
        reply:  forgeResult.review ?? forgeResult.feedback ?? JSON.stringify(forgeResult),
        agent:  'forge',
        intent,
        model:  forgeResult.model,
      };

    } else if (agent === 'Archivist' || intent?.includes('memory') || intent?.includes('recall')) {
      const archResult = await archivist.retrieve({ query: message.trim(), topK: 5 });
      const memories   = (archResult.results ?? []).slice(0, 3);
      const reply      = memories.length > 0
        ? memories.map((m, i) => `[${i+1}] ${m.content}`).join('\n\n')
        : 'No relevant memories found.';
      result = { reply, agent: 'archivist', intent, model: 'pinecone' };

    } else {
      // Unknown agent — fall back to keeper with context
      result = await chatFallback(
        `[Routed as ${intent} → ${agent}] ${message}`,
        userId,
      );
      result.agent  = agent;
      result.intent = intent;
    }

  } catch (err) {
    console.error('[Reception] Error:', err.message);
    // Attempt graceful fallback
    try {
      result = await chatFallback(message, userId);
    } catch (fallbackErr) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.json({
    ...result,
    latency_ms: Date.now() - t0,
  });
});

module.exports = router;
