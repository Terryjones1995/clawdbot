#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for Archivist (no Pinecone or LLM calls).
 * Run: node scripts/test-archivist.js
 */

require('dotenv').config();
const { detectModel } = require('../src/archivist');

const TESTS = [
  // store / purge — never need LLM
  { action: 'store',    query: '',             topK: 0,  fmt: 'raw',
    expectModel: 'none', expectSynth: false, label: 'store → no LLM' },
  { action: 'purge',    query: '',             topK: 0,  fmt: 'raw',
    expectModel: 'none', expectSynth: false, label: 'purge → no LLM' },

  // retrieve + raw — no LLM regardless of top_k
  { action: 'retrieve', query: 'JWT auth',     topK: 5,  fmt: 'raw',
    expectModel: 'none', expectSynth: false, label: 'retrieve + raw → no LLM' },
  { action: 'retrieve', query: 'system state', topK: 20, fmt: 'raw',
    expectModel: 'none', expectSynth: false, label: 'retrieve + raw + large k → no LLM' },

  // retrieve + summary, small k → qwen3-coder
  { action: 'retrieve', query: 'recent decisions', topK: 5,  fmt: 'summary',
    expectModel: 'qwen3-coder',      expectSynth: true, label: 'retrieve + summary + k=5 → qwen3' },
  { action: 'retrieve', query: 'research notes',   topK: 10, fmt: 'summary',
    expectModel: 'qwen3-coder',      expectSynth: true, label: 'retrieve + summary + k=10 → qwen3' },

  // retrieve + summary, large k → Claude Sonnet
  { action: 'retrieve', query: 'full context dump', topK: 11, fmt: 'summary',
    expectModel: 'claude-sonnet-4-6', expectSynth: true, label: 'retrieve + k=11 → Sonnet' },
  { action: 'retrieve', query: 'everything',        topK: 20, fmt: 'summary',
    expectModel: 'claude-sonnet-4-6', expectSynth: true, label: 'retrieve + k=20 → Sonnet' },

  // ESCALATE flags
  { action: 'retrieve', query: 'ESCALATE this query', topK: 5, fmt: 'summary',
    expectModel: 'claude-sonnet-4-6', expectSynth: true, label: 'ESCALATE → Sonnet' },
  { action: 'retrieve', query: 'ESCALATE:HARD synthesize', topK: 5, fmt: 'summary',
    expectModel: 'claude-sonnet-4-6', expectSynth: true, label: 'ESCALATE:HARD → Sonnet' },
];

console.log('Archivist Model Detection Test\n');

let passed = 0;
for (const t of TESTS) {
  const { model, synthesize, reason } = detectModel(t.action, t.query, t.topK, t.fmt);
  const modelOk = model     === t.expectModel;
  const synthOk = synthesize === t.expectSynth;
  const ok      = modelOk && synthOk;

  if (ok) passed++;

  const icon  = ok ? '✅' : '❌';
  const label = t.label.padEnd(38);
  const m     = model.padEnd(20);
  console.log(`${icon} [${m}] ${label} — ${reason}`);
  if (!modelOk) console.log(`   Model  expected: ${t.expectModel}, got: ${model}`);
  if (!synthOk) console.log(`   Synth  expected: ${t.expectSynth},  got: ${synthesize}`);
}

console.log(`\n${passed}/${TESTS.length} passed.`);
process.exit(passed === TESTS.length ? 0 : 1);
