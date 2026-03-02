'use strict';

/**
 * Warden — Approval Gate, Permissions, Queue Manager
 *
 * All requests flagged requires_approval: true by Switchboard pass through here.
 * Enforces the permissions model, queues items for OWNER review, and
 * manages the approve/deny lifecycle.
 *
 * Permissions:
 *   OWNER → always auto-approved, never queued
 *   ADMIN → auto-approved for non-dangerous; queued for dangerous
 *   AGENT → all external actions queued
 *
 * Usage:
 *   const warden = require('./warden');
 *   const result = await warden.gate({ requesting_agent, action, user_role, payload, reason });
 *   // result: { decision, reason, release_to, approval_id, logged }
 */

const fs        = require('fs');
const path      = require('path');
const archivist = require('./archivist');
const redis     = require('./redis');

const APPROVALS    = path.join(__dirname, '../memory/approvals.md');
const LOG_FILE     = path.join(__dirname, '../memory/run_log.md');
const REDIS_QUEUE  = 'warden:approvals';

// Dangerous action keywords — always queue for non-OWNER
const DANGEROUS_ACTIONS = [
  /mass.?dm/i, /bulk.?(?:dm|message|email)/i,
  /\bdelete\b/i, /\bpurge\b/i, /\bdrop\b/i,
  /\bpayment\b/i, /\bbilling\b/i,
  /credential/i, /password/i, /api.?key/i,
  /deploy.*prod/i, /prod.*deploy/i,
  /(?:send|launch).*campaign/i,
  /post.?tweet/i, /retweet/i, /send.?dm/i,
  /kick.?user/i, /ban.?user/i,
  /call.*(?:people|user|them)/i,
];

function isDangerous(action, payload = '') {
  const text = `${action} ${JSON.stringify(payload)}`;
  return DANGEROUS_ACTIONS.some(p => p.test(text));
}

// ── Approval ID ───────────────────────────────────────────────────────────────

async function nextId() {
  // Try Redis: scan hash keys for highest APR-NNNN, fall back to markdown scan
  const all = await redis.hgetall(REDIS_QUEUE);
  if (all && Object.keys(all).length > 0) {
    const max = Object.keys(all).reduce((m, k) => {
      const n = parseInt(k.replace('APR-', ''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return `APR-${String(max + 1).padStart(4, '0')}`;
  }
  // Fallback: scan markdown file for existing IDs
  const content = _readApprovalsFile();
  const matches = [...content.matchAll(/## \[APR-(\d+)\]/g)];
  const max = matches.reduce((m, r) => Math.max(m, parseInt(r[1], 10)), 0);
  return `APR-${String(max + 1).padStart(4, '0')}`;
}

// ── Markdown file (append-only audit log — never read for queue state) ────────

function _readApprovalsFile() {
  if (!fs.existsSync(APPROVALS)) return '';
  return fs.readFileSync(APPROVALS, 'utf8');
}

function _appendAuditLog(entry) {
  try { fs.appendFileSync(APPROVALS, `\n---\n\n${entry}\n`); } catch { /* non-fatal */ }
}

// ── Redis-backed queue ────────────────────────────────────────────────────────

async function _storeApproval(id, obj) {
  await redis.hset(REDIS_QUEUE, id, JSON.stringify(obj));
}

async function _getApproval(id) {
  const raw = await redis.hget(REDIS_QUEUE, id);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function _getAllApprovals() {
  const all = await redis.hgetall(REDIS_QUEUE);
  if (!all) return [];
  return Object.values(all).map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
}

// ── Public queue API ──────────────────────────────────────────────────────────

async function getPending() {
  // Redis path
  const all = await _getAllApprovals();
  if (all.length > 0 || await redis.ping()) {
    return all.filter(e => e.status === 'PENDING');
  }

  // Fallback: parse markdown file
  const content = _readApprovalsFile();
  const blocks  = [...content.matchAll(
    /## \[([A-Z0-9-]+)\] (\S+)\n\n([\s\S]*?)(?=\n---|\n## \[|$)/g
  )];
  return blocks
    .map(m => _parseBlock(m[1], m[2], m[3]))
    .filter(b => b && b.status === 'PENDING');
}

async function getById(id) {
  // Redis path
  const entry = await _getApproval(id);
  if (entry) return entry;

  // Fallback: parse markdown file
  const content = _readApprovalsFile();
  const re = new RegExp(
    `## \\[${id}\\] (\\S+)\\n\\n([\\s\\S]*?)(?=\\n---|\\n## \\[|$)`
  );
  const m = content.match(re);
  if (!m) return null;
  return _parseBlock(id, m[1], m[2]);
}

function _parseBlock(id, timestamp, body) {
  const field = (name) => {
    const m = body.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`));
    return m ? m[1].trim() : null;
  };
  return {
    id,
    timestamp,
    status:           field('Status'),
    requesting_agent: field('Requesting Agent'),
    action:           field('Action'),
    requestor_role:   field('Requestor Role'),
    payload:          field('Payload'),
    reason:           field('Reason'),
    resolved_at:      field('Resolved At'),
    resolved_by:      field('Resolved By'),
    resolution_note:  field('Resolution Note'),
  };
}

async function resolveEntry(id, decision, resolvedBy, note = '') {
  const status = decision === 'approve' ? 'APPROVED' : 'DENIED';
  const ts     = new Date().toISOString();

  // Redis path
  const entry = await _getApproval(id);
  if (entry) {
    if (entry.status !== 'PENDING') return false;
    entry.status          = status;
    entry.resolved_at     = ts;
    entry.resolved_by     = resolvedBy;
    entry.resolution_note = note || 'none';
    await _storeApproval(id, entry);
    return true;
  }

  // Fallback: update markdown file in-place
  let content = _readApprovalsFile();
  const blockRe = new RegExp(
    `(## \\[${id}\\][\\s\\S]*?- \\*\\*Status:\\*\\*) PENDING` +
    `([\\s\\S]*?- \\*\\*Resolved At:\\*\\*) null` +
    `([\\s\\S]*?- \\*\\*Resolved By:\\*\\*) null` +
    `([\\s\\S]*?- \\*\\*Resolution Note:\\*\\*) null`
  );
  if (!blockRe.test(content)) return false;
  content = content.replace(
    blockRe,
    `$1 ${status}$2 ${ts}$3 ${resolvedBy}$4 ${note || 'none'}`
  );
  fs.writeFileSync(APPROVALS, content);
  return true;
}

// ── Logging ───────────────────────────────────────────────────────────────────

function log(level, action, userRole, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Warden',
    `| action=${action}`,
    `| user_role=${userRole}`,
    '| model=qwen2.5:14b',
    `| outcome=${outcome}`,
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

// ── Discord notify (non-blocking, best-effort) ────────────────────────────────

async function notifyOwner(approvalId, action, requestingAgent, payloadSummary) {
  try {
    const discord = require('../openclaw/skills/discord');
    if (!discord.ready) return;
    await discord.dmOwner(
      `⚠️ **Approval needed** \`${approvalId}\`\n` +
      `**Agent:** ${requestingAgent} → **Action:** \`${action}\`\n` +
      `**Payload:** ${payloadSummary}\n\n` +
      `Reply \`!approve ${approvalId}\` or \`!deny ${approvalId}\` in \`#commands\`.`
    );
  } catch { /* Discord may not be connected */ }
}

// ── Core: gate ────────────────────────────────────────────────────────────────

/**
 * Gate an incoming request.
 *
 * @param {object} req
 *   - requesting_agent {string}
 *   - action           {string}
 *   - user_role        {string}  OWNER | ADMIN | AGENT
 *   - payload          {any}     description of the action payload
 *   - reason           {string}  why the action is being requested
 *
 * @returns {{ decision, reason, release_to, approval_id, logged }}
 */
async function gate(req) {
  const {
    requesting_agent = 'unknown',
    action           = 'unknown',
    user_role        = 'AGENT',
    payload          = {},
    reason           = '',
  } = req;

  const dangerous = isDangerous(action, payload);

  // ── OWNER: always auto-approve ──
  if (user_role === 'OWNER') {
    log('APPROVE', 'gate', user_role, 'auto-approved', `agent=${requesting_agent} action=${action}`);
    return {
      decision:    'approved',
      reason:      'OWNER — auto-approved',
      release_to:  requesting_agent,
      approval_id: null,
      logged:      true,
    };
  }

  // ── ADMIN: auto-approve non-dangerous ──
  if (user_role === 'ADMIN' && !dangerous) {
    log('APPROVE', 'gate', user_role, 'auto-approved', `agent=${requesting_agent} action=${action} dangerous=false`);
    return {
      decision:    'approved',
      reason:      'ADMIN — non-dangerous action auto-approved',
      release_to:  requesting_agent,
      approval_id: null,
      logged:      true,
    };
  }

  // ── AGENT: deny all external actions outright ──
  if (user_role === 'AGENT') {
    log('DENY', 'gate', user_role, 'denied', `agent=${requesting_agent} action=${action} reason="AGENT role cannot execute external actions"`);
    return {
      decision:    'denied',
      reason:      'AGENT role cannot execute external actions without OWNER elevation',
      release_to:  null,
      approval_id: null,
      logged:      true,
    };
  }

  // ── ADMIN + dangerous (or any other role): queue for OWNER review ──
  const approvalId     = await nextId();
  const ts             = new Date().toISOString();
  const payloadSummary = typeof payload === 'string'
    ? payload.slice(0, 120)
    : JSON.stringify(payload).slice(0, 120);

  // Store structured entry in Redis hash
  const approvalObj = {
    id:               approvalId,
    timestamp:        ts,
    status:           'PENDING',
    requesting_agent,
    action,
    requestor_role:   user_role,
    payload:          payloadSummary,
    reason,
    resolved_at:      null,
    resolved_by:      null,
    resolution_note:  null,
  };
  await _storeApproval(approvalId, approvalObj);

  // Append to markdown file as append-only audit log
  const mdEntry = [
    `## [${approvalId}] ${ts}`,
    '',
    `- **Status:** PENDING`,
    `- **Requesting Agent:** ${requesting_agent}`,
    `- **Action:** ${action}`,
    `- **Requestor Role:** ${user_role}`,
    `- **Payload:** ${payloadSummary}`,
    `- **Reason:** ${reason}`,
    `- **Resolved At:** null`,
    `- **Resolved By:** null`,
    `- **Resolution Note:** null`,
  ].join('\n');
  _appendAuditLog(mdEntry);

  log('BLOCK', 'gate', user_role, 'queued',
    `id=${approvalId} agent=${requesting_agent} action=${action} dangerous=${dangerous}`);

  // Notify OWNER via Discord (best-effort, non-blocking)
  notifyOwner(approvalId, action, requesting_agent, payloadSummary).catch(() => {});

  // Store to Archivist — non-blocking, non-fatal
  archivist.store({
    type:         'approval',
    content:      `Approval Request ${approvalId}\nAgent: ${requesting_agent}\nAction: ${action}\nRole: ${user_role}\nPayload: ${payloadSummary}\nReason: ${reason}`,
    tags:         ['approval', 'pending', requesting_agent],
    source_agent: 'Warden',
    ttl_days:     365,
  }).catch(() => {});

  return {
    decision:    'queued',
    reason:      `Queued for OWNER review — dangerous=${dangerous}`,
    release_to:  null,
    approval_id: approvalId,
    logged:      true,
  };
}

// ── Resolve ───────────────────────────────────────────────────────────────────

/**
 * Resolve a queued approval (approve or deny).
 * Called by Sentinel's !approve / !deny commands.
 *
 * @returns {{ ok, decision, id, error }}
 */
async function resolve(id, decision, resolvedBy = 'OWNER', note = '') {
  const item = await getById(id);
  if (!item) return { ok: false, error: `No approval found with ID ${id}` };
  if (item.status !== 'PENDING') return { ok: false, error: `${id} is already ${item.status}` };

  const ok = await resolveEntry(id, decision, resolvedBy, note);
  if (!ok) return { ok: false, error: `Could not update ${id} — check approvals.md format` };

  const level = decision === 'approve' ? 'APPROVE' : 'DENY';
  log(level, `warden-${decision}`, resolvedBy, 'success',
    `id=${id} agent=${item.requesting_agent} action=${item.action}`);

  archivist.store({
    type:         'decision',
    content:      `Approval Decision ${id}\nOutcome: ${decision.toUpperCase()}\nAgent: ${item.requesting_agent}\nAction: ${item.action}\nResolved by: ${resolvedBy}\nNote: ${note || 'none'}`,
    tags:         ['decision', decision, item.requesting_agent],
    source_agent: 'Warden',
    ttl_days:     365,
  }).catch(() => {});

  return { ok: true, decision, id };
}

module.exports = { gate, resolve, getPending, getById };
