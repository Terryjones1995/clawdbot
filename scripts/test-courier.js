#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for Courier escalation detection (no Resend or LLM calls).
 * Run: node scripts/test-courier.js
 */

require('dotenv').config();
const { detectModel } = require('../src/courier');

const TESTS = [
  // list_manage — no LLM ever
  { action: 'list_manage',        to: [],          subject: '',                   body: '',
    expectModel: 'none',             expectDraft: false, label: 'list_manage → no LLM' },

  // draft_campaign / send_campaign — always Claude Sonnet (quality copy)
  { action: 'draft_campaign',     to: [],          subject: 'Monthly newsletter', body: 'Highlight new features',
    expectModel: 'claude-sonnet-4-6', expectDraft: true,  label: 'draft_campaign → Sonnet' },
  { action: 'send_campaign',      to: ['a@b.com'], subject: 'Product launch',    body: '',
    expectModel: 'claude-sonnet-4-6', expectDraft: true,  label: 'send_campaign → Sonnet' },

  // send_transactional, plain → qwen3-coder
  { action: 'send_transactional', to: ['a@b.com'], subject: 'Server alert',      body: 'CPU spike detected',
    expectModel: 'qwen3-coder',      expectDraft: true,  label: 'transactional plain → qwen3-coder' },
  { action: 'send_transactional', to: ['a@b.com'], subject: 'Daily report',      body: 'Here is your report',
    expectModel: 'qwen3-coder',      expectDraft: true,  label: 'transactional report → qwen3-coder' },

  // send_transactional, sensitive keywords → Claude Sonnet
  { action: 'send_transactional', to: ['a@b.com'], subject: 'Legal notice',      body: '',
    expectModel: 'claude-sonnet-4-6', expectDraft: true,  label: 'transactional legal → Sonnet' },
  { action: 'send_transactional', to: ['a@b.com'], subject: 'We owe you an apology', body: '',
    expectModel: 'claude-sonnet-4-6', expectDraft: true,  label: 'transactional apology → Sonnet' },
  { action: 'send_transactional', to: ['a@b.com'], subject: 'Your refund status', body: '',
    expectModel: 'claude-sonnet-4-6', expectDraft: true,  label: 'transactional refund → Sonnet' },
  { action: 'send_transactional', to: ['a@b.com'], subject: 'GDPR data request', body: '',
    expectModel: 'claude-sonnet-4-6', expectDraft: true,  label: 'transactional GDPR → Sonnet' },

  // ESCALATE flags
  { action: 'send_transactional', to: ['a@b.com'], subject: 'Status update',     body: 'ESCALATE this message',
    expectModel: 'claude-sonnet-4-6', expectDraft: true,  label: 'ESCALATE flag → Sonnet' },
  { action: 'send_transactional', to: ['a@b.com'], subject: 'ESCALATE:HARD',     body: '',
    expectModel: 'claude-sonnet-4-6', expectDraft: true,  label: 'ESCALATE:HARD → Sonnet' },
];

console.log('Courier Model Detection Test\n');

let passed = 0;
for (const t of TESTS) {
  const { model, draft, reason } = detectModel(t.action, t.to, t.subject, t.body);
  const modelOk = model === t.expectModel;
  const draftOk = draft === t.expectDraft;
  const ok      = modelOk && draftOk;

  if (ok) passed++;

  const icon  = ok ? '✅' : '❌';
  const label = t.label.padEnd(36);
  const m     = model.padEnd(20);
  console.log(`${icon} [${m}] ${label} — ${reason}`);
  if (!modelOk) console.log(`   Model  expected: ${t.expectModel}, got: ${model}`);
  if (!draftOk) console.log(`   Draft  expected: ${t.expectDraft},  got: ${draft}`);
}

console.log(`\n${passed}/${TESTS.length} passed.`);
process.exit(passed === TESTS.length ? 0 : 1);
