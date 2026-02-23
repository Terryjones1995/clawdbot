#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for Scout escalation detection (no LLM calls).
 * Run: node scripts/test-scout.js
 */

require('dotenv').config();
const { detectModel } = require('../src/scout');

const TESTS = [
  // Free (qwen3-coder via Ollama)
  { type: 'factual',     depth: 'quick', query: 'what is a JWT token',                expectModel: 'qwen3-coder',      expectGrok: false, label: 'factual quick' },
  { type: 'factual',     depth: 'deep',  query: 'explain OAuth 2.0 flows in detail',  expectModel: 'qwen3-coder',      expectGrok: false, label: 'factual deep (still local)' },
  { type: 'competitive', depth: 'quick', query: 'compare Pinecone vs Weaviate',        expectModel: 'qwen3-coder',      expectGrok: false, label: 'competitive quick' },

  // Grok (web/trend)
  { type: 'web',         depth: 'quick', query: 'latest AI news this week',            expectModel: 'grok-3-mini',      expectGrok: true,  label: 'web quick → Grok' },
  { type: 'web',         depth: 'deep',  query: 'deep dive on crypto regulations',     expectModel: 'grok-3-mini',      expectGrok: true,  label: 'web deep → Grok' },
  { type: 'trend',       depth: 'quick', query: 'trending topics on X today',          expectModel: 'grok-3-mini',      expectGrok: true,  label: 'trend quick → Grok' },

  // Claude Sonnet (synthesis)
  { type: 'trend',       depth: 'deep',  query: 'deep trend analysis AI startup space', expectModel: 'claude-sonnet-4-6', expectGrok: false, label: 'trend deep → Sonnet' },
  { type: 'competitive', depth: 'deep',  query: 'full competitor analysis for Ghost',   expectModel: 'claude-sonnet-4-6', expectGrok: false, label: 'competitive deep → Sonnet' },

  // Escalation flags
  { type: 'factual',     depth: 'quick', query: 'ESCALATE this research query',        expectModel: 'claude-sonnet-4-6', expectGrok: false, label: 'ESCALATE keyword → Sonnet' },
  { type: 'web',         depth: 'quick', query: 'ESCALATE:HARD deep analysis',         expectModel: 'claude-sonnet-4-6', expectGrok: false, label: 'ESCALATE:HARD → Sonnet' },
];

console.log('Scout Escalation Detection Test\n');

let passed = 0;
for (const t of TESTS) {
  const { model, grok, reason } = detectModel(t.type, t.depth, t.query);
  const modelOk = model === t.expectModel;
  const grokOk  = grok  === t.expectGrok;
  const ok      = modelOk && grokOk;

  if (ok) passed++;

  const icon  = ok ? '✅' : '❌';
  const label = t.label.padEnd(32);
  const m     = model.padEnd(20);
  console.log(`${icon} [${m}] ${label} ${reason ? `— ${reason}` : ''}`);
  if (!ok) {
    if (!modelOk) console.log(`   Model    expected: ${t.expectModel}, got: ${model}`);
    if (!grokOk)  console.log(`   Grok     expected: ${t.expectGrok},  got: ${grok}`);
  }
}

console.log(`\n${passed}/${TESTS.length} passed.`);
process.exit(passed === TESTS.length ? 0 : 1);
