'use strict';

/**
 * Codex — HOF League Codebase & Knowledge Agent
 *
 * Answers questions about the HOF League system by:
 *   1. Searching the knowledge base (system_knowledge_base.json + league rules)
 *   2. Searching service/source files for code-level questions
 *   3. Answering with qwen3:8b (free-first) → escalate to Grok if needed
 *
 * Designed for Discord support: keeps answers concise, friendly, actionable.
 *
 * Usage:
 *   const codex = require('./codex');
 *   const answer = await codex.answer({ question, org_name, context });
 *   const files  = await codex.searchCode({ keyword });
 */

const fs   = require('fs');
const path = require('path');
const ollama = require('../openclaw/skills/ollama');

const LOG_FILE   = path.join(__dirname, '../memory/run_log.md');
const LEAGUE_DIR = path.join(__dirname, 'Leagues/HOF-LEAGUE-United');
const KB_FILE    = path.join(LEAGUE_DIR, 'data/rules/system_knowledge_base.json');
const RULES_FILE = path.join(LEAGUE_DIR, 'data/rules/league_rules_template.json');

const GROK_API_KEY = process.env.GROK_API_KEY;
const GROK_BASE    = 'https://api.x.ai/v1';

// ── Knowledge base loader ─────────────────────────────────────────────────────

let _kbCache = null;

function loadKnowledgeBase(orgName = 'HOF LEAGUE') {
  if (_kbCache) return _kbCache;

  let kb = '';
  let rules = '';

  try {
    const raw = fs.readFileSync(KB_FILE, 'utf8').replace(/\{ORG_NAME\}/g, orgName);
    const data = JSON.parse(raw);
    const topics = Object.values(data.topics ?? {});
    kb = topics.map(t => `### ${t.title}\n${t.info.join('\n')}`).join('\n\n');
  } catch (e) {
    appendLog('WARN', 'load-kb', 'codex', 'failed', e.message);
    kb = 'Knowledge base unavailable.';
  }

  // Rules file is large (~20KB) — skip loading into context by default.
  // Use searchCode() to pull relevant rules on-demand instead.
  rules = '';

  _kbCache = { kb, rules };
  return _kbCache;
}

// ── Code file searcher ────────────────────────────────────────────────────────

const CODE_SKIP = [
  'node_modules', 'public', '.git', 'logs',
  'attached_assets', 'dist', '.replit',
];

/**
 * Search source files for lines matching a keyword.
 * Returns top matching file snippets for context.
 */
function searchCode(keyword, maxResults = 4, maxCharsPerFile = 1500) {
  const results = [];
  const kw = keyword.toLowerCase();

  function scanDir(dir) {
    if (results.length >= maxResults) return;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (results.length >= maxResults) break;
      const full = path.join(dir, entry);
      const rel  = path.relative(LEAGUE_DIR, full);
      if (CODE_SKIP.some(s => rel.startsWith(s))) continue;

      let stat;
      try { stat = fs.statSync(full); } catch { continue; }

      if (stat.isDirectory()) {
        scanDir(full);
      } else if (entry.endsWith('.js') || entry.endsWith('.md') || entry.endsWith('.json')) {
        try {
          const content = fs.readFileSync(full, 'utf8');
          if (content.toLowerCase().includes(kw)) {
            // Extract a relevant snippet around the first match
            const idx = content.toLowerCase().indexOf(kw);
            const start = Math.max(0, idx - 200);
            const end   = Math.min(content.length, idx + maxCharsPerFile);
            results.push({
              file:    rel,
              snippet: content.slice(start, end).trim(),
            });
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  scanDir(LEAGUE_DIR);
  return results;
}

// ── Answer engine ─────────────────────────────────────────────────────────────

function buildSystemPrompt(kb, rules, orgName) {
  return `You are Codex, the support agent for ${orgName} — a competitive NBA2K26 esports league platform.

You help players, captains, and admins by answering questions about:
- How the platform works (registration, matchmaking, rosters, scoring, payments)
- Technical issues and troubleshooting
- League rules and policies
- How features of the Discord bot and website work

KNOWLEDGE BASE:
${kb}

${rules ? `LEAGUE RULES SUMMARY:\n${rules}` : ''}

RESPONSE RULES:
- Be direct and helpful. Lead with the answer.
- Keep responses concise — this is Discord, not a novel.
- If the answer involves steps, use a numbered list.
- If you don't know something for certain, say so and suggest opening a ticket.
- Never make up rules or features you're not sure about.
- Always refer to the league as "${orgName}".
- Tone: friendly, professional, community-focused.`;
}

/**
 * Answer a question using the knowledge base + optional code search.
 *
 * @param {object} input
 *   - question   {string}  required — the question to answer
 *   - org_name   {string}  optional — league name (default: HOF LEAGUE)
 *   - context    {string}  optional — extra Discord context (channel name, previous messages)
 *   - code_search {boolean} optional — also search source files (default: false for player Qs)
 */
async function answer({ question, org_name = 'HOF LEAGUE', context = '', code_search = false } = {}) {
  if (!question) throw new Error('question is required');

  const { kb, rules } = loadKnowledgeBase(org_name);
  const systemPrompt  = buildSystemPrompt(kb, rules, org_name);

  // Build user message — prefix /no_think to skip qwen3 reasoning mode for support Qs
  let userMsg = `/no_think\n\n${question}`;
  if (context) userMsg = `/no_think\n\n[Context: ${context}]\n\nQuestion: ${question}`;

  // If code_search requested (admin/dev questions), find relevant code snippets
  if (code_search) {
    const keywords = question.split(/\s+/).filter(w => w.length > 4).slice(0, 3);
    const snippets = keywords.flatMap(kw => searchCode(kw, 2, 800));
    if (snippets.length > 0) {
      const codeContext = snippets.slice(0, 4)
        .map(s => `// File: ${s.file}\n${s.snippet}`)
        .join('\n\n---\n\n');
      userMsg += `\n\nRelevant source code:\n\`\`\`\n${codeContext.slice(0, 3000)}\n\`\`\``;
    }
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMsg },
  ];

  // Try qwen3:8b first (free)
  const { result, escalate, reason } = await ollama.tryChat(messages, {
    params: { temperature: 0.3 },
  });

  if (!escalate && result?.message?.content) {
    const text = result.message.content.trim();
    // Strip thinking tags — /no_think should prevent them, but strip as fallback
    const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (clean.length > 10) {
      appendLog('INFO', 'answer', 'codex', 'success', `model=qwen3:8b q="${question.slice(0, 60)}"`);
      return { answer: clean, model: 'qwen3:8b', logged: true };
    }
    // Log what we actually got so we can debug
    console.warn('[Codex] qwen3 response too short or empty. escalating.',
      `raw_len=${text.length} clean_len=${clean.length} preview="${text.slice(0, 80)}"`);
  } else if (escalate) {
    console.warn('[Codex] ollama.tryChat escalated:', reason);
  }

  // Escalate to Grok (xai) — faster than Claude, credits always available
  appendLog('INFO', 'answer', 'codex', 'escalating', `reason="${reason}" q="${question.slice(0, 60)}"`);
  try {
    if (!GROK_API_KEY) throw new Error('GROK_API_KEY not set');
    const res = await fetch(`${GROK_BASE}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'grok-3-fast-beta',
        max_tokens:  1024,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: question },   // plain question, no /no_think prefix
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Grok HTTP ${res.status}: ${body}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() ?? 'I could not generate an answer.';
    appendLog('INFO', 'answer', 'codex', 'success', `model=grok q="${question.slice(0, 60)}"`);
    return { answer: text, model: 'grok-3-fast-beta', logged: true };
  } catch (err) {
    console.error('[Codex] answer failed:', err.message);
    appendLog('ERROR', 'answer', 'codex', 'failed', err.message);
    return {
      answer: `I'm having trouble looking that up right now. Please open a ticket or ask an admin.`,
      model:  'error',
      logged: true,
    };
  }
}

/**
 * Reload the knowledge base cache (call after updating the JSON files).
 */
function reloadKnowledgeBase() {
  _kbCache = null;
  return loadKnowledgeBase();
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, agent, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Codex',
    `| action=${action}`,
    `| user_role=${agent}`,
    '| model=qwen3:8b',
    `| outcome=${outcome}`,
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

// Pre-warm the knowledge base at startup
try { loadKnowledgeBase(); } catch { /* non-fatal */ }

module.exports = { answer, searchCode, reloadKnowledgeBase, loadKnowledgeBase };
