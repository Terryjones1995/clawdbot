#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for Lens (no PostHog calls, no LLM calls).
 * Run: node scripts/test-lens.js
 */

require('dotenv').config();
const { detectModel, systemAlerts } = require('../src/lens');

let passed = 0;
let total  = 0;

function check(label, actual, expected) {
  total++;
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    console.log(`❌ ${label}`);
    console.log(`   Expected: ${JSON.stringify(expected)}`);
    console.log(`   Actual:   ${JSON.stringify(actual)}`);
  }
}

// ── detectModel tests ─────────────────────────────────────────────────────────

console.log('Lens Model Detection Test\n');

// raw / chart_data → no LLM regardless of query type
const r1 = detectModel('event_count', 'raw');
check('event_count + raw → no LLM',        r1.interpret, false);
check('event_count + raw → model=none',     r1.model,     'none');

const r2 = detectModel('funnel', 'chart_data');
check('funnel + chart_data → no LLM',       r2.interpret, false);
check('funnel + chart_data → model=none',    r2.model,     'none');

const r3 = detectModel('custom', 'raw');
check('custom + raw → no LLM (raw beats)',  r3.interpret, false);

// Simple types + summary → qwen3-coder
const r4 = detectModel('event_count', 'summary');
check('event_count + summary → qwen3-coder', r4.model,    'qwen3-coder');
check('event_count + summary → interpret',   r4.interpret, true);

const r5 = detectModel('trend', 'summary');
check('trend + summary → qwen3-coder',       r5.model,    'qwen3-coder');

const r6 = detectModel('session', 'summary');
check('session + summary → qwen3-coder',     r6.model,    'qwen3-coder');

// Complex types + summary → Claude Sonnet
const r7 = detectModel('funnel', 'summary');
check('funnel + summary → claude-sonnet-4-6',    r7.model,    'claude-sonnet-4-6');
check('funnel + summary → interpret',            r7.interpret, true);

const r8 = detectModel('retention', 'summary');
check('retention + summary → claude-sonnet-4-6', r8.model,    'claude-sonnet-4-6');

const r9 = detectModel('custom', 'summary');
check('custom + summary → claude-sonnet-4-6',    r9.model,    'claude-sonnet-4-6');

// ESCALATE flags
const r10 = detectModel('event_count', 'summary', 'ESCALATE this metric now');
check('ESCALATE flag → claude-sonnet-4-6',       r10.model,   'claude-sonnet-4-6');

const r11 = detectModel('trend', 'summary', 'ESCALATE:HARD deep analysis needed');
check('ESCALATE:HARD → claude-sonnet-4-6',       r11.model,   'claude-sonnet-4-6');

// ── systemAlerts tests ────────────────────────────────────────────────────────

console.log('\nLens System Alerts Test\n');

const alerts = systemAlerts();
check('systemAlerts returns array', Array.isArray(alerts), true);

// With no real data, all thresholds should be clear
const hasBogusAlert = alerts.some(a => !a.metric || !a.message || !a.level);
check('all alert objects are well-formed', hasBogusAlert, false);

// Each alert must have required fields
for (const a of alerts) {
  check(`alert ${a.metric} has level`,   typeof a.level   === 'string', true);
  check(`alert ${a.metric} has message`, typeof a.message === 'string', true);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed}/${total} passed.`);
process.exit(passed === total ? 0 : 1);
