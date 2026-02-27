'use strict';

/**
 * POST /api/reception
 *
 * Portal terminal endpoint — free-first routing (Ollama → Haiku fallback).
 *
 * Body:
 *   { message, userId?, username? }
 *
 * Response:
 *   { reply, agent, intent, model?, latency_ms }
 */

const express          = require('express');
const mini             = require('../skills/openai-mini');
const keeper           = require('../keeper');
const { instantReply } = require('../skills/instant');
const scout          = require('../scout');
const codex          = require('../codex');
const courier        = require('../courier');
const registry       = require('../agentRegistry');
const db             = require('../db');

const router = express.Router();

// ── Keyword routing table (instant, no LLM) ──
const KEYWORD_ROUTES = [
  // League/HOF knowledge → Codex (file-based, fast, no web needed)
  {
    patterns: [
      /\bhof\b/i, /\bhof league\b/i, /\bregist/i, /\bsign.?up\b/i,
      /\bhow.*join\b/i, /\bjoin.*league\b/i,
      /\broster\b/i, /\bcaptain\b/i, /\bmmr\b/i,
      /\bseason\b/i, /\bplayoff\b/i, /\bbracket\b/i,
      /\beligib/i, /\bpayment fee\b/i, /\bleague fee\b/i,
      /\bscore report\b/i, /\bsubmit.*score\b/i, /\bteam balance\b/i,
    ],
    agent: 'codex',
  },
  { patterns: [/\bemail\b/i, /\bsend.*mail\b/i, /\bdraft.*email\b/i],  agent: 'courier' },
  // Discord management → execute real Discord API actions (must stay before scout)
  {
    patterns: [
      // Role management
      /\bcreate.*role\b/i, /\bmake.*role\b/i, /\badd.*role\b/i,
      /\bdelete.*role\b/i, /\bremove.*role\b/i,
      /\blist.*roles\b/i, /\bshow.*roles\b/i,
      /\bassign.*role\b/i, /\bgive.*role\b/i,
      // Channel management
      /\bcreate.*channel\b/i, /\bmake.*channel\b/i, /\bdelete.*channel\b/i,
      // Moderation
      /\bkick\b/i, /\bban\b/i, /\btimeout\b/i, /\bmute\s+<@/i,
      // DM
      /\bsend.*dm\b/i, /\bdm\s+<@/i, /\bdirect.*message.*<@/i,
      // Member queries
      /\blist.*members\b/i, /\bshow.*members\b/i, /\bwho.*in.*server\b/i,
      /\bfind.*user\b/i, /\blook.*up.*user\b/i,
    ],
    agent: 'discord-admin',
  },
  // Web/trend/research → Scout (Grok web access)
  {
    patterns: [
      /\bresearch\b/i, /\bsearch\b/i, /\blook up\b/i, /\blookup\b/i,
      /\bsearch the web\b/i, /\bfind.*info\b/i, /\bwhat.*happening\b/i,
      /\btrend\b/i, /\bwho is\b/i, /\btell me about\b/i,
      /\btwitter\b/i, /\bx\.com\b/i, /\binstagram\b/i, /\blinkedin\b/i,
      /@\w+/,  // any @mention = social profile lookup
      /\bprofile\b/i, /\blatest news\b/i, /\bwhat('s| is) new\b/i,
      /\bcurrent(ly)?\b/i, /\bright now\b/i, /\btoday\b/i,
      /\bprice of\b/i, /\bweather\b/i, /\bstock\b/i,
    ],
    agent: 'scout',
  },
];

function keywordRoute(message) {
  const msg = message.toLowerCase();
  for (const rule of KEYWORD_ROUTES) {
    if (rule.patterns.some(p => p.test(msg))) return rule.agent;
  }
  return null;
}


router.post('/', async (req, res) => {
  const t0 = Date.now();
  const { message, userId = 'portal-user', username = 'User' } = req.body;

  if (!message?.trim()) return res.status(400).json({ error: 'message required' });

  // Step 0: Instant reply — greetings/acks, zero latency, no LLM
  const quick = instantReply(message.trim());
  if (quick) {
    return res.json({ reply: quick, agent: 'ghost', intent: 'chat', model: 'instant', latency_ms: Date.now() - t0 });
  }

  registry.setStatus('switchboard', 'working');

  try {
    // Step 1: Keyword routing (instant)
    const keywordAgent = keywordRoute(message.trim());

    if (keywordAgent === 'codex') {
      registry.setStatus('codex', 'working');
      try {
        const result = await codex.answer({ question: message.trim(), org_name: 'HOF LEAGUE' });
        registry.setStatus('codex', 'idle');
        registry.setStatus('switchboard', 'idle');
        db.logEntry({ level: 'INFO', agent: 'Codex', action: 'answer', outcome: 'success', model: result.model, note: `q="${message.slice(0,60)}"` });
        return res.json({ reply: result.answer, agent: 'codex', intent: 'league-knowledge', model: result.model, latency_ms: Date.now() - t0 });
      } catch (err) {
        registry.setStatus('codex', 'idle');
        db.logEntry({ level: 'ERROR', agent: 'Codex', action: 'answer', outcome: 'failed', note: err.message });
        // fall through to general chat
      }
    }

    if (keywordAgent === 'scout') {
      // Check ghost_memory first — if we already know the answer, skip the web call
      const memoryHit = await (async () => {
        try {
          const rows = await db.getFacts(message.trim(), 5);
          const relevant = rows.filter(r => r.relevant === 1 || r.relevant === '1');
          if (relevant.length >= 2) return relevant.map(r => `• ${r.content}`).join('\n');
        } catch { /* non-fatal */ }
        return null;
      })();

      if (memoryHit) {
        registry.setStatus('switchboard', 'idle');
        db.logEntry({ level: 'INFO', agent: 'Ghost', action: 'memory-hit', outcome: 'success', model: 'ghost_memory', note: `q="${message.slice(0,60)}"` });
        return res.json({ reply: `From memory:\n${memoryHit}`, agent: 'ghost', intent: 'memory', model: 'ghost_memory', latency_ms: Date.now() - t0 });
      }

      registry.setStatus('scout', 'working');
      try {
        const result = await scout.run({ query: message.trim(), type: 'web', depth: 'quick', store_result: false });
        registry.setStatus('scout', 'idle');
        registry.setStatus('switchboard', 'idle');
        db.logEntry({ level: 'INFO', agent: 'Scout', action: 'research', outcome: 'success', model: result.model_used, note: `q="${message.slice(0,60)}"` });
        return res.json({ reply: result.summary ?? 'Research complete.', agent: 'scout', intent: 'research', model: result.model_used, latency_ms: Date.now() - t0 });
      } catch (err) {
        registry.setStatus('scout', 'idle');
        db.logEntry({ level: 'ERROR', agent: 'Scout', action: 'research', outcome: 'failed', note: err.message });
        // fall through to general chat
      }
    }

    if (keywordAgent === 'courier') {
      registry.setStatus('courier', 'working');
      try {
        const { result, escalate } = await mini.tryChat([
          { role: 'system', content: 'You are Courier, an email specialist. Draft professional emails when asked. Keep it concise.' },
          { role: 'user',   content: message.trim() },
        ]);
        registry.setStatus('courier', 'idle');
        registry.setStatus('switchboard', 'idle');
        return res.json({ reply: result?.message?.content ?? 'Unable to draft email.', agent: 'courier', intent: 'email', model: mini.MODEL, latency_ms: Date.now() - t0 });
      } catch {
        registry.setStatus('courier', 'idle');
        // fall through to general chat
      }
    }

    if (keywordAgent === 'discord-admin') {
      registry.setStatus('sentinel', 'working');
      try {
        const discordAdmin = require('../discordAdminHandler');
        const userRole     = req.user?.role?.toUpperCase() || 'ADMIN';
        const reply        = await discordAdmin.run(message.trim(), userRole);
        registry.setStatus('sentinel', 'idle');
        registry.setStatus('switchboard', 'idle');
        db.logEntry({ level: 'INFO', agent: 'Sentinel', action: 'discord-admin', outcome: 'success', model: 'ollama/mini', note: `cmd="${message.slice(0,60)}"` });
        return res.json({ reply, agent: 'sentinel', intent: 'discord-admin', model: 'ollama/mini', latency_ms: Date.now() - t0 });
      } catch (err) {
        registry.setStatus('sentinel', 'idle');
        db.logEntry({ level: 'ERROR', agent: 'Sentinel', action: 'discord-admin', outcome: 'failed', note: err.message });
        return res.json({ reply: `Discord action failed: ${err.message}`, agent: 'sentinel', intent: 'discord-admin', latency_ms: Date.now() - t0 });
      }
    }

    // Step 2: General chat — keeper.chat() with persistent thread memory (Ollama free-first)
    registry.setStatus('ghost', 'working');

    const threadId = `portal-${userId}`;
    let reply, modelUsed;
    try {
      reply     = await keeper.chat(threadId, message.trim());
      modelUsed = process.env.OLLAMA_MODEL || 'ollama';
    } catch (err) {
      reply     = `Error: ${err.message}`;
      modelUsed = 'error';
    }

    registry.setStatus('ghost', 'idle');
    registry.setStatus('switchboard', 'idle');

    db.logEntry({ level: modelUsed === 'error' ? 'ERROR' : 'INFO', agent: 'Ghost', action: 'chat', outcome: modelUsed === 'error' ? 'failed' : 'success', model: modelUsed, note: `msg="${message.slice(0,60)}"` });

    return res.json({
      reply,
      agent:      'ghost',
      intent:     'chat',
      model:      modelUsed,
      latency_ms: Date.now() - t0,
    });

  } catch (err) {
    console.error('[Reception] Error:', err.message);
    registry.setStatus('switchboard', 'idle');
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
