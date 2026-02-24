'use strict';

/**
 * Lens — Analytics / PostHog
 *
 * Queries PostHog for events, funnels, retention, and session data.
 * Interprets results with qwen3-coder (simple) or Claude Sonnet (complex).
 * Checks local system thresholds (escalation rate, error rate, approval backlog).
 *
 * Usage:
 *   const lens = require('./lens');
 *   const result  = await lens.run({ query_type, event, date_range, output_format });
 *   const alerts  = await lens.systemAlerts();
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const Anthropic = require('@anthropic-ai/sdk');
const ollama  = require('../openclaw/skills/ollama');
const warden  = require('./warden');
const scribe  = require('./scribe');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// ── Escalation logic ──────────────────────────────────────────────────────────

/**
 * Determine whether and which LLM to use for interpretation.
 *
 * @param {string} queryType    - 'event_count' | 'trend' | 'funnel' | 'retention' | 'session' | 'custom'
 * @param {string} outputFormat - 'summary' | 'chart_data' | 'raw'
 * @param {string} query        - optional extra context (checked for ESCALATE flags)
 * @returns {{ model: string, interpret: boolean, reason: string }}
 */
function detectModel(queryType, outputFormat, query = '') {
  // Raw / chart data — no LLM interpretation needed
  if (outputFormat === 'raw' || outputFormat === 'chart_data') {
    return { model: 'none', interpret: false, reason: 'raw/chart data — no LLM needed' };
  }

  const q = (query || '').toLowerCase();

  // Explicit escalation flags
  if (q.includes('escalate:hard') || q.includes('escalate: hard')) {
    return { model: 'claude-sonnet-4-6', interpret: true, reason: 'ESCALATE:HARD flag' };
  }
  if (q.includes('escalate')) {
    return { model: 'claude-sonnet-4-6', interpret: true, reason: 'ESCALATE flag' };
  }

  // Complex / strategic queries → Claude Sonnet
  if (['funnel', 'retention', 'custom'].includes(queryType)) {
    return { model: 'claude-sonnet-4-6', interpret: true, reason: `${queryType} requires strategic interpretation` };
  }

  // Simple counts, trends, sessions → local model
  return { model: 'qwen3-coder', interpret: true, reason: 'simple metric — local model sufficient' };
}

// ── PostHog HTTP client ───────────────────────────────────────────────────────

function _posthogRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const apiKey    = process.env.POSTHOG_API_KEY;
    const hostRaw   = process.env.POSTHOG_HOST || 'https://app.posthog.com';
    const hostname  = hostRaw.replace(/^https?:\/\//, '').split('/')[0];

    if (!apiKey) return reject(new Error('POSTHOG_API_KEY not set'));

    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname,
      path:   urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            return reject(new Error(`PostHog HTTP ${res.statusCode}: ${json.detail || raw}`));
          }
          resolve(json);
        } catch (err) {
          reject(new Error(`PostHog parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('PostHog request timeout')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function _projectPath(suffix) {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  if (!projectId) throw new Error('POSTHOG_PROJECT_ID not set');
  return `/api/projects/${projectId}${suffix}`;
}

// ── PostHog query builders ────────────────────────────────────────────────────

async function _hogql(sql) {
  const data = await _posthogRequest('POST', _projectPath('/query/'), {
    query: { kind: 'HogQLQuery', query: sql },
  });
  return data; // { results, columns, types, ... }
}

async function _buildSql(queryType, event, dateRange, filters) {
  const from = dateRange?.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to   = dateRange?.to   || new Date().toISOString().slice(0, 10);

  const whereParts = [
    event ? `event = '${event.replace(/'/g, "''")}'` : null,
    `toDate(timestamp) >= '${from}'`,
    `toDate(timestamp) <= '${to}'`,
  ].filter(Boolean);

  const filterClauses = Object.entries(filters || {})
    .map(([k, v]) => `properties.${k} = '${String(v).replace(/'/g, "''")}'`)
    .join(' AND ');
  if (filterClauses) whereParts.push(filterClauses);

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  switch (queryType) {
    case 'event_count':
      return `SELECT count() as total FROM events ${where}`;

    case 'trend':
      return `SELECT toDate(timestamp) as day, count() as total
              FROM events ${where}
              GROUP BY day ORDER BY day`;

    case 'session':
      return `SELECT "$session_id", count() as actions, min(timestamp) as started, max(timestamp) as ended
              FROM events ${where} AND "$session_id" != ''
              GROUP BY "$session_id" ORDER BY started DESC LIMIT 50`;

    case 'funnel':
      // Funnel steps: event must be a comma-separated list
      return `SELECT count() as total FROM events ${where}`;

    case 'retention':
      return `SELECT toDate(timestamp) as cohort_day, uniqExact(distinct_id) as users
              FROM events ${where}
              GROUP BY cohort_day ORDER BY cohort_day`;

    case 'custom':
      return null; // caller provides raw HogQL

    default:
      return `SELECT count() as total FROM events ${where}`;
  }
}

// ── LLM interpretation ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Lens, the analytics agent for the Ghost AI system.
You're a numbers nerd — genuinely excited when data does something unexpected. Lead with what's interesting.
Identify trends and anomalies, flag small sample sizes, and always connect findings to what's actionable.
Keep summaries under 300 words. Plain text, no markdown headers.`;

async function _interpret(rawData, queryType, model) {
  const prompt = `Analytics query type: ${queryType}\n\nRaw data:\n${JSON.stringify(rawData, null, 2)}\n\nProvide a concise interpretation.`;

  if (model === 'claude-sonnet-4-6') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for Lens escalation');
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: prompt }],
    });
    return res.content[0]?.text || '';
  }

  // qwen3-coder via Ollama
  const { result, escalate, reason } = await ollama.tryChat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: prompt },
  ]);

  if (escalate) {
    // Fallback to Claude Sonnet
    appendLog('WARN', 'interpret', 'system', 'ollama-failed', `escalating — ${reason}`);
    return _interpret(rawData, queryType, 'claude-sonnet-4-6');
  }
  return result?.message?.content || '';
}

// ── System alert checker ──────────────────────────────────────────────────────

/**
 * Check local system metrics against defined thresholds.
 * No PostHog required — reads from warden and run_log.md.
 *
 * Alert thresholds (from spec):
 *   - Approval queue backlog  > 10
 *   - Escalation rate         > 15% of all agent calls today
 *   - Error rate              > 5% of all events today
 *
 * @returns {Array<{ metric, value, threshold, message, level }>}
 */
function systemAlerts() {
  const alerts = [];

  // Approval queue backlog
  const pending = warden.getPending();
  if (pending.length > 10) {
    alerts.push({
      metric:    'approval_queue_backlog',
      value:     pending.length,
      threshold: 10,
      message:   `Approval queue has ${pending.length} pending items (threshold: 10)`,
      level:     'WARN',
    });
  }

  // Escalation rate + error rate from today's log
  const today   = new Date().toISOString().slice(0, 10);
  const entries = scribe.readLogEntries({ fromDate: today });
  const stats   = scribe.statsFromEntries(entries);

  if (stats.total > 0) {
    const escalationRate = stats.escalations / stats.total;
    if (escalationRate > 0.15) {
      alerts.push({
        metric:    'escalation_rate',
        value:     `${(escalationRate * 100).toFixed(1)}%`,
        threshold: '15%',
        message:   `Escalation rate is ${(escalationRate * 100).toFixed(1)}% today (threshold: 15%)`,
        level:     'WARN',
      });
    }

    const errorRate = stats.errors / stats.total;
    if (errorRate > 0.05) {
      alerts.push({
        metric:    'error_rate',
        value:     `${(errorRate * 100).toFixed(1)}%`,
        threshold: '5%',
        message:   `Error rate is ${(errorRate * 100).toFixed(1)}% today (threshold: 5%)`,
        level:     'ERROR',
      });
    }
  }

  return alerts;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run an analytics query.
 *
 * @param {object} input
 *   - query_type   {string}  'event_count' | 'trend' | 'funnel' | 'retention' | 'session' | 'custom'
 *   - event        {string}  event name to filter on
 *   - date_range   {object}  { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *   - filters      {object}  PostHog property filters
 *   - output_format {string} 'summary' | 'chart_data' | 'raw'
 *   - custom_sql   {string}  HogQL query string (only for query_type='custom')
 *
 * @returns {object} { metric, period, result, summary, alert, model_used, logged }
 */
async function run({
  query_type    = 'event_count',
  event         = null,
  date_range    = null,
  filters       = {},
  output_format = 'summary',
  custom_sql    = null,
} = {}) {
  const validTypes   = ['event_count', 'trend', 'funnel', 'retention', 'session', 'custom'];
  const validFormats = ['summary', 'chart_data', 'raw'];

  if (!validTypes.includes(query_type))   throw new Error(`Unknown query_type: ${query_type}`);
  if (!validFormats.includes(output_format)) throw new Error(`Unknown output_format: ${output_format}`);
  if (query_type === 'custom' && !custom_sql) throw new Error('custom_sql is required for query_type=custom');

  const { model, interpret, reason } = detectModel(query_type, output_format);
  const from = date_range?.from || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to   = date_range?.to   || new Date().toISOString().slice(0, 10);

  // Build and execute PostHog query
  let rawResult;
  if (query_type === 'custom') {
    rawResult = await _hogql(custom_sql);
  } else {
    const sql = await _buildSql(query_type, event, date_range, filters);
    rawResult = await _hogql(sql);
  }

  // For raw/chart_data — skip LLM, return structured data
  if (!interpret) {
    appendLog('INFO', 'query', 'system', 'success',
      `type=${query_type} format=${output_format} rows=${rawResult.results?.length ?? '?'}`);
    return {
      metric:    event || query_type,
      period:    `${from} to ${to}`,
      result:    rawResult,
      summary:   null,
      alert:     false,
      model_used: 'none',
      logged:    true,
    };
  }

  // Interpret with LLM
  const summary = await _interpret(rawResult, query_type, model);

  // Check for anomalies in the alerts system
  const alerts     = systemAlerts();
  const hasAlert   = alerts.length > 0;

  appendLog('INFO', 'query', 'system', 'success',
    `type=${query_type} format=${output_format} model=${model} alert=${hasAlert}`);

  return {
    metric:    event || query_type,
    period:    `${from} to ${to}`,
    result:    rawResult,
    summary,
    alert:     hasAlert,
    alerts:    hasAlert ? alerts : [],
    model_used: model,
    escalated:  model === 'claude-sonnet-4-6',
    escalation_reason: model === 'claude-sonnet-4-6' ? reason : null,
    logged:    true,
  };
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Lens',
    `| action=${action}`,
    `| user_role=${userRole}`,
    '| model=qwen3-coder',
    `| outcome=${outcome}`,
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = { run, detectModel, systemAlerts };
