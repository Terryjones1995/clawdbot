'use strict';

/**
 * POST /api/reception
 *
 * Portal terminal endpoint — instant responses via keyword routing + Claude Haiku.
 * No more Ollama CPU bottleneck. Typical latency: 1-3 seconds.
 *
 * Body:
 *   { message, userId?, username? }
 *
 * Response:
 *   { reply, agent, intent, model?, latency_ms }
 */

const express  = require('express');
const haiku    = require('../skills/haiku');
const scout    = require('../scout');
const courier  = require('../courier');
const registry = require('../agentRegistry');

const router = express.Router();

// ── Keyword routing table (instant, no LLM) ──
const KEYWORD_ROUTES = [
  { patterns: [/\bemail\b/i, /\bsend.*mail\b/i, /\bdraft.*email\b/i],  agent: 'courier' },
  { patterns: [/\bresearch\b/i, /\blook up\b/i, /\bsearch\b/i, /\bfind.*info\b/i, /\bleague\b/i, /\bscore\b/i], agent: 'scout' },
  { patterns: [/\btweet\b/i, /\bpost.*twitter\b/i, /\bpost.*x\b/i, /\bsocial\b/i], agent: 'viper' },
  { patterns: [/\bmarketing\b/i, /\bcampaign\b/i, /\bcontent\b/i, /\bad\b/i],      agent: 'pulse' },
  { patterns: [/\bsupport\b/i, /\bhelp.*with\b/i, /\bticket\b/i, /\bissue\b/i],    agent: 'atlas' },
];

function keywordRoute(message) {
  const msg = message.toLowerCase();
  for (const rule of KEYWORD_ROUTES) {
    if (rule.patterns.some(p => p.test(msg))) return rule.agent;
  }
  return null;
}

// System prompt for the Ghost AI persona
const GHOST_SYSTEM = `You are Ghost, an elite AI operations system. You are sharp, direct, and concise.
You manage a league operations platform. You can help with Discord, social media, marketing, research, and league management.
Be helpful, brief (2-3 sentences max unless asked for more), and professional.
Current date: ${new Date().toISOString().slice(0, 10)}.`;

router.post('/', async (req, res) => {
  const t0 = Date.now();
  const { message, userId = 'portal-user', username = 'User' } = req.body;

  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  registry.setStatus('nexus', 'working');

  try {
    // Step 1: Keyword routing (instant)
    const keywordAgent = keywordRoute(message.trim());

    if (keywordAgent === 'scout') {
      registry.setStatus('scout', 'working');
      try {
        const result = await scout.run({ query: message.trim(), type: 'factual', depth: 'quick', store_result: false });
        registry.setStatus('scout', 'idle');
        registry.setStatus('nexus', 'idle');
        return res.json({ reply: result.answer ?? result.summary ?? 'Research complete.', agent: 'scout', intent: 'research', model: result.model, latency_ms: Date.now() - t0 });
      } catch {
        // fall through to Haiku
      }
    }

    if (keywordAgent === 'courier') {
      registry.setStatus('courier', 'working');
      // For email drafts, use Haiku to compose
      const reply = await haiku.chat(
        'You are Courier, an email specialist. Draft professional emails when asked. Keep it concise.',
        message.trim(), 1024
      );
      registry.setStatus('courier', 'idle');
      registry.setStatus('nexus', 'idle');
      return res.json({ reply, agent: 'courier', intent: 'email', model: haiku.MODEL, latency_ms: Date.now() - t0 });
    }

    // Step 2: General chat via Haiku (fast)
    registry.setStatus('ghost', 'working');
    const reply = await haiku.chat(GHOST_SYSTEM, message.trim(), 512);
    registry.setStatus('ghost', 'idle');
    registry.setStatus('nexus', 'idle');

    return res.json({
      reply,
      agent:      'ghost',
      intent:     'chat',
      model:      haiku.MODEL,
      latency_ms: Date.now() - t0,
    });

  } catch (err) {
    console.error('[Reception] Error:', err.message);
    registry.setStatus('nexus', 'idle');
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
