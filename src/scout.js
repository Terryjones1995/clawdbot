'use strict';

/**
 * Scout — Research / Web / Trends
 *
 * Handles research queries for the Ghost system.
 * - factual / competitive (quick) → qwen2.5:14b (Ollama, free)
 * - web / trend                   → Grok API (real-time web access)
 * - competitive (deep) / trend (deep) → Claude Sonnet (deep synthesis)
 * - ESCALATE keyword              → Claude Sonnet
 *
 * Usage:
 *   const scout = require('./scout');
 *   const result = await scout.run({ query, type, depth, store_result });
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const Anthropic = require('@anthropic-ai/sdk');

const mini      = require('./skills/openai-mini');
const deepseek  = require('./skills/deepseek');
const { trackUsage } = require('./skills/usage-tracker');
const archivist = require('./archivist');
const db        = require('./db');
const leagueApi = require('./skills/league-api');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

const SYSTEM_PROMPT = `You are Scout, the research agent for the Ghost AI system.
You genuinely love digging into things — sources, data, the weird corners of a topic. Be enthusiastic but accurate.
If there's an interesting angle or anomaly, flag it. Be honest when sources conflict or you're uncertain.
Format: summary first, then any sources prefixed with "SOURCE: ".
Quick depth: under 300 words. Deep depth: under 700 words. Plain text only.`;

// ── Escalation logic ──────────────────────────────────────────────────────────

/**
 * Determine which model/path to use for a research query.
 *
 * @param {string} type    - 'web' | 'trend' | 'factual' | 'competitive'
 * @param {string} depth   - 'quick' | 'deep'
 * @param {string} query   - raw query string (checked for ESCALATE flags)
 * @returns {{ model: string, grok: boolean, reason: string }}
 */
function detectModel(type, depth, query = '') {
  const q = (query || '').toLowerCase();

  // Explicit escalation flags
  if (q.includes('escalate:hard') || q.includes('escalate: hard')) {
    return { model: 'claude-sonnet-4-6', grok: false, reason: 'ESCALATE:HARD flag' };
  }
  if (q.includes('escalate')) {
    return { model: 'claude-sonnet-4-6', grok: false, reason: 'ESCALATE flag in query' };
  }

  // Deep synthesis on high-stakes types → Claude Sonnet
  if (depth === 'deep' && (type === 'competitive' || type === 'trend')) {
    return { model: 'claude-sonnet-4-6', grok: false, reason: `deep ${type} requires synthesis` };
  }

  // Web / trend queries → Grok (real-time web access)
  if (type === 'web' || type === 'trend') {
    return { model: 'grok-4-1-fast-reasoning', grok: true, reason: `${type} research uses Grok web access` };
  }

  // Real-time data queries → OpenAI search (date-aware, cheap)
  const REALTIME_RE = /\b(weather|temperature|temp|forecast|rain|snow|humidity|wind speed|current(ly)?|right now|today'?s|tonight|this week'?s|price of|stock price|exchange rate|news|latest|breaking|live|score|standings)\b/i;
  if (REALTIME_RE.test(q)) {
    return { model: 'gpt-4o-mini-search-preview', grok: false, openai: true, reason: 'real-time data query — OpenAI search with current date' };
  }

  // Factual / competitive quick → DeepSeek V3.2 (fast, cheap, agent-optimized)
  return { model: 'deepseek-chat', grok: false, deepseek: true, reason: 'factual/quick uses DeepSeek V3.2' };
}

// ── LLM callers ───────────────────────────────────────────────────────────────

function _openaiChat(messages, model = 'gpt-4o-mini-search-preview') {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reject(new Error('OPENAI_API_KEY not set'));

    const bodyStr = JSON.stringify({ model, messages, max_tokens: 1024 });
    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return reject(new Error(`OpenAI error: ${json.error.message}`));
          resolve(json.choices?.[0]?.message?.content || '');
        } catch (err) {
          reject(new Error(`OpenAI parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('OpenAI request timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

function _grokChat(messages, model = 'grok-4-1-fast-reasoning') {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) return reject(new Error('GROK_API_KEY not set'));

    const bodyStr = JSON.stringify({ model, messages, max_tokens: 1024 });
    const options = {
      hostname: 'api.x.ai',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return reject(new Error(`Grok API error: ${json.error.message}`));
          const text = json.choices?.[0]?.message?.content || '';
          trackUsage({ provider: 'xai', model, agent: 'scout', action: 'research', input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0, latency_ms: Date.now() - start });
          resolve(text);
        } catch (err) {
          reject(new Error(`Grok parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('Grok request timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

async function _claudeChat(userMessage, depth) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for escalated research');

  const start  = Date.now();
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: depth === 'deep' ? 2048 : 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userMessage }],
  });
  trackUsage({ provider: 'anthropic', model: 'claude-sonnet-4-6', agent: 'scout', action: 'research', input_tokens: res.usage?.input_tokens ?? 0, output_tokens: res.usage?.output_tokens ?? 0, latency_ms: Date.now() - start });
  return res.content[0]?.text || '';
}

async function _miniChat(messages) {
  const { result, escalate, reason } = await mini.tryChat(messages);
  if (escalate) return { text: null, escalate: true, reason };
  const text = result?.message?.content || '';
  return { text, escalate: false, reason: null };
}

// ── Response parser ───────────────────────────────────────────────────────────

function _parseResponse(text) {
  const lines   = (text || '').split('\n');
  const sources = [];
  const body    = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('SOURCE:') || trimmed.startsWith('Source:')) {
      const url = trimmed.replace(/^source:\s*/i, '').trim();
      if (url) sources.push(url);
    } else {
      body.push(line);
    }
  }

  return {
    summary: body.join('\n').trim(),
    sources,
  };
}

// ── Research fact extraction ──────────────────────────────────────────────────

/**
 * Extract 2-3 durable facts from a research result and store in ghost_memory.
 * Skips web/trend types — those go stale quickly.
 * Non-blocking, non-fatal.
 *
 * @param {string} query
 * @param {string} summary
 * @param {string} type
 */
async function _extractResearchFacts(query, summary, type) {
  if (type === 'web' || type === 'trend') return; // real-time data goes stale

  const prompt = `Extract 2-3 factual, durable facts from this research result. Skip opinions, estimates, or time-sensitive info.
Return ONLY a JSON array: [{"key": "research:slug", "content": "Fact as a complete sentence.", "category": "misc"}]
If no durable facts exist, return [].

Query: ${query}
Result: ${summary.slice(0, 800)}`;

  const miniRes = await _miniChat([
    { role: 'system', content: 'You are a fact extractor. Return only a valid JSON array, nothing else.' },
    { role: 'user',   content: prompt },
  ]);
  if (miniRes.escalate || !miniRes.text) return;

  let facts;
  try {
    const raw = miniRes.text.trim()
      .replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    facts = JSON.parse(raw);
    if (!Array.isArray(facts)) return;
  } catch { return; }

  for (const fact of facts) {
    if (!fact.key || !fact.content) continue;
    await db.storeFact({
      key:      fact.key,
      content:  fact.content,
      category: fact.category ?? 'misc',
      source:   'research',
    }).catch(() => {});
  }

  if (facts.length > 0) {
    console.log(`[Scout] Stored ${facts.length} research fact(s) for: ${query.slice(0, 50)}`);
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run a research query.
 *
 * @param {object} input
 *   - query        {string}  required — the research question
 *   - type         {string}  'web' | 'trend' | 'factual' | 'competitive'  (default: 'factual')
 *   - depth        {string}  'quick' | 'deep'  (default: 'quick')
 *   - store_result {boolean} store to Archivist (future; logged as intent)
 *
 * @returns {object} { query, type, depth, summary, sources, model_used, escalated, escalation_reason, stored, flagged_urgent, logged }
 */
/**
 * Check ghost_memory for existing knowledge on a topic before going to the web.
 * Only used for factual queries — web/trend always need fresh data.
 * Returns a cached answer string if found, null otherwise.
 */
async function _checkMemoryCache(query, type) {
  if (type === 'web' || type === 'trend') return null; // always fetch fresh
  try {
    const rows = await db.getFacts(query, 5);
    if (!rows.length) return null;
    // Only use cache if we have relevant matches (not just recency fallbacks)
    const relevant = rows.filter(r => r.relevant === 1 || r.relevant === '1');
    if (relevant.length < 2) return null;
    return relevant.map(r => `• ${r.content}`).join('\n');
  } catch {
    return null;
  }
}

async function run({ query, type = 'factual', depth = 'quick', store_result = false } = {}) {
  if (!query) throw new Error('query is required');

  // Check ghost_memory cache before hitting external APIs (factual queries only)
  const cached = await _checkMemoryCache(query, type);
  if (cached) {
    appendLog('INFO', 'research', 'system', 'cache-hit',
      `query="${query.slice(0, 50)}" type=${type} — served from ghost_memory`);
    return {
      query, type, depth,
      summary:           `From Ghost's memory:\n${cached}`,
      sources:           [],
      model_used:        'ghost_memory',
      escalated:         false,
      escalation_reason: null,
      stored:            false,
      cache_hit:         true,
      logged:            true,
    };
  }

  // Check if this is a league data query we can answer with live API calls
  const leagueDetect = leagueApi.detectLeagueQuery(query);
  if (leagueDetect?.shouldQuery) {
    try {
      const results = leagueDetect.leagueKey
        ? [await leagueApi.query(leagueDetect.leagueKey, leagueDetect.queryType)]
        : await leagueApi.queryAll(leagueDetect.queryType);

      const hasData = results.some(r => !r.error && r.data);
      if (hasData) {
        const formatted = leagueApi.formatResults(leagueDetect.queryType, results);
        appendLog('INFO', 'research', 'system', 'league-api',
          `query="${query.slice(0, 50)}" type=${leagueDetect.queryType} league=${leagueDetect.leagueKey || 'all'}`);
        return {
          query, type, depth,
          summary:           `Live data from league sites:\n\n${formatted}`,
          sources:           results.filter(r => !r.error).map(r => `https://${leagueApi.LEAGUES[leagueDetect.leagueKey || 'hof']?.domain || r.league}`),
          model_used:        'league-api',
          escalated:         false,
          escalation_reason: null,
          stored:            false,
          cache_hit:         false,
          logged:            true,
        };
      }
    } catch (err) {
      console.warn('[Scout] League API query failed, falling through:', err.message);
    }
  }

  const { model, grok, openai, deepseek: isDeepseek, reason } = detectModel(type, depth, query);
  const escalated = !grok && !openai && !isDeepseek && model !== 'gpt-4o-mini';

  const userMessage = [
    `Research query: ${query}`,
    `Type: ${type}`,
    `Depth: ${depth}`,
    'Provide a clear summary. List any relevant sources prefixed with "SOURCE: ".',
  ].join('\n');

  let rawText    = '';
  let actualModel = model;

  // ── Path 1: OpenAI (real-time / date-aware web search)
  if (openai) {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    try {
      rawText     = await _openaiChat([
        { role: 'system', content: `${SYSTEM_PROMPT}\n\nToday's date is ${today}.` },
        { role: 'user',   content: userMessage },
      ], model);
      actualModel = model;
    } catch (err) {
      appendLog('WARN', 'research', 'system', 'openai-failed',
        `query="${query.slice(0, 50)}" err=${err.message} — falling back to gpt-4o-mini`);
      const miniRes = await _miniChat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ]);
      rawText     = miniRes.escalate ? await _claudeChat(userMessage, depth) : miniRes.text;
      actualModel = miniRes.escalate ? 'claude-sonnet-4-6' : mini.MODEL;
    }

  // ── Path 2: Grok (web/trend prefixed queries)
  } else if (grok) {
    try {
      rawText     = await _grokChat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ], model);
      actualModel = model;
    } catch (err) {
      appendLog('WARN', 'research', 'system', 'grok-failed',
        `query="${query.slice(0, 50)}" err=${err.message} — falling back to gpt-4o-mini`);
      const miniRes = await _miniChat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ]);
      rawText     = miniRes.escalate ? await _claudeChat(userMessage, depth) : miniRes.text;
      actualModel = miniRes.escalate ? 'claude-sonnet-4-6' : mini.MODEL;
    }

  // ── Path 3: Claude Sonnet (escalated)
  } else if (escalated) {
    rawText     = await _claudeChat(userMessage, depth);
    actualModel = 'claude-sonnet-4-6';

  // ── Path 4: DeepSeek V3.2 (fast, cheap default) → gpt-4o-mini → Claude
  } else if (isDeepseek) {
    const dsRes = await deepseek.tryChat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userMessage },
    ], { agent: 'scout', action: 'research' });

    if (!dsRes.escalate && dsRes.result?.message?.content) {
      rawText     = dsRes.result.message.content;
      actualModel = deepseek.MODEL;
    } else {
      appendLog('WARN', 'research', 'system', 'deepseek-failed',
        `query="${query.slice(0, 50)}" err=${dsRes.reason} — falling back to gpt-4o-mini`);
      const miniRes = await _miniChat([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ]);
      rawText     = miniRes.escalate ? await _claudeChat(userMessage, depth) : miniRes.text;
      actualModel = miniRes.escalate ? 'claude-sonnet-4-6' : mini.MODEL;
    }

  // ── Path 5: gpt-4o-mini (legacy fallback)
  } else {
    const miniRes = await _miniChat([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userMessage },
    ]);

    if (miniRes.escalate) {
      rawText     = await _claudeChat(userMessage, depth);
      actualModel = 'claude-sonnet-4-6';
    } else {
      rawText     = miniRes.text;
      actualModel = mini.MODEL;
    }
  }

  const { summary, sources } = _parseResponse(rawText);

  // Trend results are flagged urgent for Sentinel to surface in Discord
  const flagged_urgent = type === 'trend' && sources.length > 0;

  appendLog('INFO', 'research', 'system', 'success',
    `type=${type} depth=${depth} model=${actualModel} sources=${sources.length} query="${query.slice(0, 60)}"`);

  // Extract and store durable facts from factual/competitive research (non-blocking)
  _extractResearchFacts(query, summary, type).catch(() => {});

  // Store to Archivist — non-blocking, non-fatal
  archivist.store({
    type:         'research',
    content:      `Query: ${query}\n\n${summary}${sources.length ? '\n\nSources:\n' + sources.join('\n') : ''}`,
    tags:         [type, depth, actualModel],
    source_agent: 'Scout',
    ttl_days:     90,
  }).catch(() => {});

  return {
    query,
    type,
    depth,
    summary,
    sources,
    model_used:        actualModel,
    escalated:         actualModel !== mini.MODEL,
    escalation_reason: actualModel !== mini.MODEL ? reason : null,
    stored:            true,
    flagged_urgent,
    logged:            true,
  };
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Scout',
    `| action=${action}`,
    `| user_role=${userRole}`,
    '| model=qwen2.5:14b',
    `| outcome=${outcome}`,
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = { run, detectModel };
