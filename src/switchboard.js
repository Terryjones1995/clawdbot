'use strict';

/**
 * Switchboard — Intent Classifier & Router
 *
 * Single entry point for all Ghost commands.
 * Classifies intent and returns a routing decision.
 * Never executes actions — routes only.
 *
 * Classification pipeline (free-first):
 *   Pass 1 — Keyword matching     (instant, free)
 *   Pass 2 — Ollama qwen3-coder   (free, up to 2 attempts)
 *   Pass 3 — Claude Sonnet 4.6    (paid, escalation only)
 *
 * Usage:
 *   const switchboard = require('./switchboard');
 *   const decision = await switchboard.classify({ source, user_role, message, context });
 */

const fs        = require('fs');
const path      = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const ollama    = require('../openclaw/skills/ollama');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// ── Agent map ─────────────────────────────────────────────────────────────────

const AGENT_MAP = {
  control:   { agent: 'Warden',    requires_approval: false },
  ops:       { agent: 'Scribe',    requires_approval: false },
  research:  { agent: 'Scout',     requires_approval: false },
  discord:   { agent: 'Sentinel',  requires_approval: false },
  social:    { agent: 'Crow',      requires_approval: true  },
  dev:       { agent: 'Forge',     requires_approval: false },
  analytics: { agent: 'Lens',      requires_approval: false },
  email:     { agent: 'Courier',   requires_approval: true  },
  memory:    { agent: 'Archivist', requires_approval: false },
  sre:       { agent: 'Helm',      requires_approval: false },
};

// ── Dangerous action patterns (always flag requires_approval) ─────────────────

const DANGEROUS = [
  /mass.?dm/i, /bulk.?(?:dm|message)/i,
  /\bdelete\b/i, /\bpurge\b/i, /\bdrop\s+(?:table|db|database)\b/i,
  /\bpayment\b/i, /\bbilling\b/i,
  /\bcredential/i, /change.*password/i, /rotate.*(?:key|secret)/i,
  /deploy.*prod/i, /prod.*deploy/i,
  /(?:send|launch).*campaign/i,
  /call.*(?:people|user|them|him|her)/i,
];

// ── Pass 1: keyword rules ─────────────────────────────────────────────────────

// Each rule: keywords matched anywhere in message (case-insensitive)
const KEYWORD_RULES = [
  {
    domain: 'control',
    keywords: ['approve', 'deny', 'pending approval', 'queue review',
               'show.*approval', 'permission'],
  },
  {
    domain: 'ops',
    keywords: ["today's summary", 'daily summary', 'weekly digest',
               'remind me', 'set a reminder', 'status report', 'system status',
               'archive.*log'],
  },
  {
    domain: 'research',
    keywords: ['search for', 'research ', 'look up', 'find info about',
               "what's trending", 'trending in', 'competitive analysis',
               'web search', 'grok '],
  },
  {
    domain: 'discord',
    keywords: ['post in #', 'send to #', 'discord channel', 'mute @',
               'kick @', 'ban @', 'discord server', 'moderate '],
  },
  {
    domain: 'social',
    keywords: ['tweet', 'retweet', 'post on x', 'post on twitter',
               'draft a post', 'social media', 'dm @', 'x post'],
  },
  {
    domain: 'dev',
    keywords: ['fix the', 'fix this bug', 'implement ', 'build a ',
               'add a feature', 'refactor ', 'code review', 'review this pr',
               'architecture', 'debug ', 'write a function', 'write a script'],
  },
  {
    domain: 'analytics',
    keywords: ['analytics', 'posthog', 'how many users', 'dau', 'mau',
               'metric', 'funnel', 'retention', 'usage stats'],
  },
  {
    domain: 'email',
    keywords: ['send.*email', 'email campaign', 'newsletter', 'resend ',
               'draft.*email', 'email template'],
  },
  {
    domain: 'memory',
    keywords: ['remember that', 'recall ', 'what did we decide', 'store this',
               'retrieve from memory', 'look in memory', 'forget '],
  },
  {
    domain: 'sre',
    keywords: ['deploy ', 'docker ', 'container', 'server logs',
               'restart the', 'is the server', 'server up', 'uptime',
               'helm ', 'kubernetes', 'k8s'],
  },
];

function keywordMatch(message) {
  const lower = message.toLowerCase();
  const matches = [];

  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      const pattern = new RegExp(kw, 'i');
      if (pattern.test(lower)) {
        matches.push({ domain: rule.domain, keyword: kw });
        break;
      }
    }
  }

  if (matches.length === 1) {
    return { domain: matches[0].domain, reason: `keyword match: "${matches[0].keyword}"` };
  }
  if (matches.length > 1) {
    // Multiple matches — pick most specific (longest keyword)
    const best = matches.sort((a, b) => b.keyword.length - a.keyword.length)[0];
    return { domain: best.domain, reason: `best keyword match: "${best.keyword}"` };
  }
  return null;
}

// ── LLM system prompt ─────────────────────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are Switchboard, the intent classifier for the Ghost AI agent system.

Classify the user message into exactly one intent from this list:

control/approve | control/deny | control/permissions | control/queue-review
ops/daily-summary | ops/reminder-set | ops/status-report | ops/archive
research/web | research/trend | research/competitive | research/factual
discord/send-message | discord/moderate | discord/support | discord/alert
social/draft-tweet | social/post-tweet | social/retweet | social/dm | social/schedule
dev/bug-fix | dev/feature | dev/review | dev/architecture | dev/refactor
analytics/query | analytics/report | analytics/alert-setup
email/transactional | email/campaign-draft | email/campaign-send
memory/store | memory/retrieve | memory/purge
sre/health-check | sre/deploy | sre/restart | sre/logs

Respond with valid JSON only — no markdown, no explanation outside JSON:
{"intent":"domain/action","confidence":75,"reason":"brief reason"}

confidence is 0-100. Use <80 if you are not sure.`;

function parseJSON(raw) {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // Try extracting the first {...} block
    const m = raw.match(/\{[\s\S]*?\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch { return null; }
    }
    return null;
  }
}

// ── Pass 2: Ollama ────────────────────────────────────────────────────────────

async function ollamaClassify(message, context) {
  const userContent = context
    ? `Context: ${context}\n\nMessage: ${message}`
    : `Message: ${message}`;

  const { result, escalate, reason } = await ollama.tryChat([
    { role: 'system', content: CLASSIFICATION_PROMPT },
    { role: 'user',   content: userContent },
  ]);

  if (escalate) return { success: false, reason };

  const parsed = parseJSON(result?.message?.content || '');
  if (!parsed?.intent) return { success: false, reason: 'unparseable response' };
  if (parsed.confidence < 80) return { success: false, reason: `low confidence (${parsed.confidence})`, parsed };

  return { success: true, parsed };
}

// ── Pass 3: Claude Sonnet ─────────────────────────────────────────────────────

async function claudeClassify(message, context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, reason: 'ANTHROPIC_API_KEY not set' };
  }

  const client = new Anthropic({ apiKey });
  const userContent = context
    ? `Context: ${context}\n\nMessage: ${message}`
    : `Message: ${message}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      system: CLASSIFICATION_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const raw    = response.content[0]?.text || '';
    const parsed = parseJSON(raw);

    if (!parsed?.intent) return { success: false, reason: 'unparseable Claude response' };
    return { success: true, parsed, model: 'claude-sonnet-4-6' };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

// ── Build route ───────────────────────────────────────────────────────────────

function buildRoute(domain, intent, isDangerous, model, reason, escalated) {
  const mapping = AGENT_MAP[domain] || { agent: 'Warden', requires_approval: true };
  return {
    intent,
    agent:            mapping.agent,
    model,
    requires_approval: isDangerous || mapping.requires_approval,
    dangerous:        isDangerous,
    escalated,
    reason,
  };
}

// ── Main: classify ────────────────────────────────────────────────────────────

async function classify(input) {
  const { source = 'api', user_role = 'OWNER', message = '', context } = input;

  if (!message.trim()) {
    return { error: 'Empty message.' };
  }

  const isDangerous    = DANGEROUS.some(p => p.test(message));
  const forceEscalate  = /\bESCALATE\b/.test(message);

  // ── Pass 1: Keywords ──
  if (!forceEscalate) {
    const kw = keywordMatch(message);
    if (kw) {
      const intent = `${kw.domain}/unclassified`;
      const route  = buildRoute(kw.domain, intent, isDangerous, 'keyword', kw.reason, false);
      log(route, user_role, source, false);
      return route;
    }
  }

  // ── Pass 2: Ollama (up to 2 attempts) ──
  if (!forceEscalate) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await ollamaClassify(message, context);
      if (res.success) {
        const domain = res.parsed.intent.split('/')[0];
        const route  = buildRoute(domain, res.parsed.intent, isDangerous, 'qwen3-coder', res.parsed.reason, false);
        log(route, user_role, source, false);
        return route;
      }
    }
  }

  // ── Pass 3: Claude Sonnet (escalation) ──
  log({ intent: 'unknown', agent: 'Switchboard', model: 'claude-sonnet-4-6' }, user_role, source, true);
  const escalated = await claudeClassify(message, context);

  if (escalated.success) {
    const domain = escalated.parsed.intent.split('/')[0];
    const route  = buildRoute(domain, escalated.parsed.intent, isDangerous, escalated.model || 'claude-sonnet-4-6', escalated.parsed.reason, true);
    log(route, user_role, source, true);
    return route;
  }

  // ── Unclassifiable ──
  const fallback = {
    intent:           'unknown/unclassified',
    agent:            'Warden',
    model:            'none',
    requires_approval: true,
    dangerous:        isDangerous,
    escalated:        true,
    reason:           `unclassifiable after all passes — flagged for OWNER review. Last error: ${escalated.reason}`,
  };
  log(fallback, user_role, source, true);
  return fallback;
}

// ── Logging ───────────────────────────────────────────────────────────────────

function log(route, userRole, source, escalated) {
  const entry = [
    `[INFO]`,
    new Date().toISOString(),
    `| agent=Switchboard`,
    `| action=route`,
    `| user_role=${userRole}`,
    `| model=${route.model}`,
    `| outcome=success`,
    `| escalated=${escalated}`,
    `| note="intent=${route.intent} → agent=${route.agent} source=${source} approval=${route.requires_approval}"`,
  ].join(' ') + '\n';

  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = { classify };
