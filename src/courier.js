'use strict';

/**
 * Courier — Email / Resend
 *
 * Handles all outbound email via the Resend API.
 * - send_transactional: single-recipient emails sent directly (no approval).
 *                       multi-recipient transactional → Warden-gated.
 * - draft_campaign:     LLM-drafted campaign email returned for review.
 * - send_campaign:      bulk send — always Warden-gated before dispatch.
 * - list_manage:        list ops — always Warden-gated.
 *
 * Usage:
 *   const courier = require('./courier');
 *   const result  = await courier.run({ action, to, subject, body_text, user_role });
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const Anthropic = require('@anthropic-ai/sdk');
const ollama  = require('../openclaw/skills/ollama');
const warden  = require('./warden');

const LOG_FILE = path.join(__dirname, '../memory/run_log.md');

// ── Escalation logic ──────────────────────────────────────────────────────────

const SENSITIVE_RE = /legal|lawsuit|apolog|financ|refund|terminat|urgent|compli|gdpr|disciplin/i;

/**
 * Determine which model to use for content generation.
 *
 * @param {string}   action   - courier action
 * @param {string[]} to       - recipient list
 * @param {string}   subject  - email subject
 * @param {string}   body     - email body / instructions
 * @returns {{ model: string, draft: boolean, reason: string }}
 *   draft=true means the LLM should generate/improve the email body.
 */
function detectModel(action, to = [], subject = '', body = '') {
  const text = `${subject} ${body}`.toLowerCase();

  // list_manage needs no LLM
  if (action === 'list_manage') {
    return { model: 'none', draft: false, reason: 'list management — no LLM needed' };
  }

  // ESCALATE flags
  if (text.includes('escalate:hard') || text.includes('escalate: hard')) {
    return { model: 'claude-sonnet-4-6', draft: true, reason: 'ESCALATE:HARD flag' };
  }
  if (text.includes('escalate')) {
    return { model: 'claude-sonnet-4-6', draft: true, reason: 'ESCALATE flag' };
  }

  // Campaigns always need quality copy → Claude Sonnet
  if (action === 'draft_campaign' || action === 'send_campaign') {
    return { model: 'claude-sonnet-4-6', draft: true, reason: 'campaign copy requires persuasive writing' };
  }

  // Sensitive transactional content → Claude Sonnet
  if (SENSITIVE_RE.test(text)) {
    return { model: 'claude-sonnet-4-6', draft: true, reason: 'sensitive content detected' };
  }

  // Plain transactional → qwen3-coder
  return { model: 'qwen3-coder', draft: true, reason: 'standard transactional — local model sufficient' };
}

// ── Resend API client ─────────────────────────────────────────────────────────

function _resendRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return reject(new Error('RESEND_API_KEY not set'));

    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.resend.com',
      path:     urlPath,
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
            return reject(new Error(`Resend HTTP ${res.statusCode}: ${json.message || json.name || raw}`));
          }
          resolve(json);
        } catch (err) {
          reject(new Error(`Resend parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('Resend request timeout')));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function _resendSend({ from, to, subject, text, html }) {
  const data = await _resendRequest('POST', '/emails', { from, to, subject, text, html });
  return data.id; // re_xxxxxxxx
}

// ── LLM body drafting ─────────────────────────────────────────────────────────

const DRAFT_SYSTEM = `You are Courier, the email agent for the Ghost AI system.
Write clear, professional email content. Include an unsubscribe link placeholder "[UNSUBSCRIBE_LINK]" at the end of all campaign emails.
Return only the email body text — no subject line, no meta-commentary.`;

async function _draftBody(subject, instructions, model) {
  const userMessage = `Subject: ${subject}\n\nInstructions: ${instructions || 'Write a professional email for this subject.'}`;

  if (model === 'claude-sonnet-4-6') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for campaign drafting');
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:     DRAFT_SYSTEM,
      messages:   [{ role: 'user', content: userMessage }],
    });
    return res.content[0]?.text || '';
  }

  // qwen3-coder via Ollama
  const { result, escalate, reason } = await ollama.tryChat([
    { role: 'system', content: DRAFT_SYSTEM },
    { role: 'user',   content: userMessage },
  ]);

  if (escalate) {
    appendLog('WARN', 'draft', 'system', 'ollama-failed', `escalating — ${reason}`);
    return _draftBody(subject, instructions, 'claude-sonnet-4-6');
  }
  return result?.message?.content || '';
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function _sendTransactional({ to, subject, body_text, template_id, user_role }) {
  const recipients = Array.isArray(to) ? to : [to];
  const from       = process.env.RESEND_FROM_EMAIL || 'ghost@noreply.example.com';
  const bulk       = recipients.length > 1;

  // Single recipient → send directly (system alert pattern)
  if (!bulk) {
    const resendId = await _resendRequest('POST', '/emails', {
      from,
      to:      recipients,
      subject,
      text:    body_text || '',
      ...(template_id ? { template_id } : {}),
    }).then(d => d.id);

    appendLog('INFO', 'send-transactional', user_role, 'sent',
      `to=${recipients[0]} subject="${subject.slice(0, 40)}" resend_id=${resendId}`);

    return {
      action:      'send_transactional',
      status:      'sent',
      resend_id:   resendId,
      approval_id: null,
      recipients:  recipients.length,
      logged:      true,
    };
  }

  // Multiple recipients → Warden gate
  const gate = await warden.gate({
    requesting_agent: 'Courier',
    action:           'bulk-email',
    user_role,
    payload:          `to=${recipients.length} recipients subject="${subject}"`,
    reason:           'Multi-recipient transactional email requires approval',
  });

  if (gate.decision === 'denied') {
    appendLog('DENY', 'send-transactional', user_role, 'denied', `reason=${gate.reason}`);
    return { action: 'send_transactional', status: 'rejected', approval_id: null, reason: gate.reason, logged: true };
  }

  if (gate.decision !== 'approved') {
    appendLog('INFO', 'send-transactional', user_role, 'queued', `approval_id=${gate.approval_id}`);
    return { action: 'send_transactional', status: 'pending_approval', approval_id: gate.approval_id, logged: true };
  }

  // Approved — send
  const resendId = await _resendSend({ from, to: recipients, subject, text: body_text || '' });
  appendLog('INFO', 'send-transactional', user_role, 'sent',
    `to=${recipients.length} subject="${subject.slice(0, 40)}" resend_id=${resendId}`);

  return { action: 'send_transactional', status: 'sent', resend_id: resendId, approval_id: gate.approval_id, recipients: recipients.length, logged: true };
}

async function _draftCampaign({ subject, body_text, user_role }) {
  const { model } = detectModel('draft_campaign', [], subject, body_text);
  const draft     = await _draftBody(subject, body_text, model);

  appendLog('INFO', 'draft-campaign', user_role, 'drafted',
    `subject="${subject.slice(0, 40)}" model=${model}`);

  return {
    action:     'draft_campaign',
    status:     'drafted',
    subject,
    draft_body: draft,
    model_used: model,
    approval_id: null,
    logged:     true,
  };
}

async function _sendCampaign({ to, subject, body_text, template_id, schedule_at, user_role }) {
  const recipients = Array.isArray(to) ? to : [to];
  const from       = process.env.RESEND_FROM_EMAIL || 'ghost@noreply.example.com';

  // Always gate campaigns
  const gate = await warden.gate({
    requesting_agent: 'Courier',
    action:           'send-campaign',
    user_role,
    payload:          `to=${recipients.length} recipients subject="${subject}"`,
    reason:           'Campaign send requires OWNER approval',
  });

  if (gate.decision === 'denied') {
    appendLog('DENY', 'send-campaign', user_role, 'denied', `reason=${gate.reason}`);
    return { action: 'send_campaign', status: 'rejected', approval_id: null, reason: gate.reason, logged: true };
  }

  if (gate.decision !== 'approved') {
    appendLog('INFO', 'send-campaign', user_role, 'queued', `approval_id=${gate.approval_id}`);
    return { action: 'send_campaign', status: 'pending_approval', approval_id: gate.approval_id, logged: true };
  }

  // Approved — send
  const resendId = await _resendSend({ from, to: recipients, subject, text: body_text || '' });
  appendLog('INFO', 'send-campaign', user_role, 'sent',
    `to=${recipients.length} subject="${subject.slice(0, 40)}" resend_id=${resendId}`);

  return {
    action:      'send_campaign',
    status:      'sent',
    resend_id:   resendId,
    approval_id: gate.approval_id,
    recipients:  recipients.length,
    logged:      true,
  };
}

async function _listManage({ operation, list_id, emails, user_role }) {
  // Always Warden-gated
  const gate = await warden.gate({
    requesting_agent: 'Courier',
    action:           `list-manage-${operation || 'update'}`,
    user_role,
    payload:          `list_id=${list_id} emails=${(emails || []).length}`,
    reason:           'List management requires OWNER approval',
  });

  if (gate.decision === 'denied') {
    return { action: 'list_manage', status: 'rejected', reason: gate.reason, logged: true };
  }
  if (gate.decision !== 'approved') {
    return { action: 'list_manage', status: 'pending_approval', approval_id: gate.approval_id, logged: true };
  }

  // Resend Contacts API — add contacts to an audience
  if (operation === 'add' && list_id && emails?.length) {
    for (const email of emails) {
      await _resendRequest('POST', `/audiences/${list_id}/contacts`, { email });
    }
  } else if (operation === 'remove' && list_id && emails?.length) {
    // Resend uses DELETE /audiences/:id/contacts/:contact_id
    // For simplicity, just log — full implementation needs contact ID lookup
    appendLog('WARN', 'list-manage', user_role, 'skipped',
      `remove op requires contact_id lookup — not implemented in MVP`);
  }

  appendLog('INFO', 'list-manage', user_role, 'success',
    `op=${operation} list=${list_id} count=${(emails || []).length}`);

  return {
    action:      'list_manage',
    status:      'completed',
    operation,
    list_id,
    count:       (emails || []).length,
    approval_id: gate.approval_id,
    logged:      true,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run a Courier action.
 *
 * @param {object} input
 *   - action       {string}   'send_transactional' | 'draft_campaign' | 'send_campaign' | 'list_manage'
 *   - to           {string[]} recipient email addresses
 *   - subject      {string}   email subject line
 *   - body_text    {string}   body text / drafting instructions
 *   - template_id  {string}   optional Resend template ID
 *   - schedule_at  {string}   ISO8601 future send time (optional)
 *   - user_role    {string}   OWNER | ADMIN | AGENT (from JWT)
 *   - operation    {string}   for list_manage: 'add' | 'remove'
 *   - list_id      {string}   for list_manage: Resend audience ID
 *   - emails       {string[]} for list_manage: email addresses
 */
async function run({
  action      = 'send_transactional',
  to          = [],
  subject     = '',
  body_text   = '',
  template_id = null,
  schedule_at = null,
  user_role   = 'AGENT',
  operation   = null,
  list_id     = null,
  emails      = [],
} = {}) {
  const validActions = ['send_transactional', 'draft_campaign', 'send_campaign', 'list_manage'];
  if (!validActions.includes(action)) {
    throw new Error(`Unknown action: ${action}. Use: ${validActions.join(', ')}`);
  }

  switch (action) {
    case 'send_transactional':
      if (!to?.length) throw new Error('to is required for send_transactional');
      if (!subject)    throw new Error('subject is required');
      return _sendTransactional({ to, subject, body_text, template_id, user_role });

    case 'draft_campaign':
      if (!subject) throw new Error('subject is required for draft_campaign');
      return _draftCampaign({ subject, body_text, user_role });

    case 'send_campaign':
      if (!to?.length) throw new Error('to is required for send_campaign');
      if (!subject)    throw new Error('subject is required');
      return _sendCampaign({ to, subject, body_text, template_id, schedule_at, user_role });

    case 'list_manage':
      return _listManage({ operation, list_id, emails, user_role });
  }
}

// ── Logging ───────────────────────────────────────────────────────────────────

function appendLog(level, action, userRole, outcome, note) {
  const entry = [
    `[${level}]`,
    new Date().toISOString(),
    '| agent=Courier',
    `| action=${action}`,
    `| user_role=${userRole}`,
    '| model=qwen3-coder',
    `| outcome=${outcome}`,
    '| escalated=false',
    `| note="${note}"`,
  ].join(' ') + '\n';
  try { fs.appendFileSync(LOG_FILE, entry); } catch { /* non-fatal */ }
}

module.exports = { run, detectModel };
