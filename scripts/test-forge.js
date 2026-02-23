#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for Forge escalation detection (no LLM calls).
 * Run: node scripts/test-forge.js
 */

require('dotenv').config();
const { detectModel } = require('../src/forge');

const TESTS = [
  // Free (qwen3-coder)
  { task: 'bug-fix',      description: 'fix the typo in dashboard.html',            files: [],          expectModel: 'qwen3-coder',      label: 'simple bug fix' },
  { task: 'feature',      description: 'add a /health endpoint to server.js',       files: ['server.js'], expectModel: 'qwen3-coder',    label: 'single-file feature' },
  { task: 'review',       description: 'review this function for logic errors',      files: [],          expectModel: 'qwen3-coder',      label: 'code review' },

  // Sonnet escalations
  { task: 'feature',      description: 'implement JWT refresh token rotation',       files: [],          expectModel: 'claude-sonnet-4-6', label: 'security: JWT' },
  { task: 'feature',      description: 'add bcrypt password hashing to login',       files: [],          expectModel: 'claude-sonnet-4-6', label: 'security: bcrypt' },
  { task: 'feature',      description: 'integrate Stripe payment API',               files: [],          expectModel: 'claude-sonnet-4-6', label: 'payments' },
  { task: 'refactor',     description: 'refactor the auth system architecture',      files: [],          expectModel: 'claude-sonnet-4-6', label: 'architecture keyword' },
  { task: 'bug-fix',      description: 'fix the login bug',                          files: ['a.js','b.js','c.js'], expectModel: 'claude-sonnet-4-6', label: '3-file change' },

  // Opus escalations
  { task: 'architecture', description: 'full system design from scratch for Ghost',  files: [],          expectModel: 'claude-opus-4-6',   label: 'full system design' },
  { task: 'bug-fix',      description: 'ESCALATE:HARD debug this complex issue',     files: [],          expectModel: 'claude-opus-4-6',   label: 'ESCALATE:HARD flag' },
  { task: 'bug-fix',      description: 'root cause analysis across all modules',     files: ['a.js','b.js','c.js','d.js','e.js'], expectModel: 'claude-opus-4-6', label: '5-file debug' },
];

async function main() {
  console.log('Forge Escalation Detection Test\n');

  let passed = 0;
  for (const t of TESTS) {
    const { model, reason } = detectModel(t.task, t.description, t.files, '');
    const ok = model === t.expectModel;
    if (ok) passed++;
    const icon  = ok ? '✅' : '❌';
    const label = t.label.padEnd(30);
    const m     = model.padEnd(20);
    console.log(`${icon} [${m}] ${label} ${reason ? `— ${reason}` : ''}`);
    if (!ok) console.log(`   Expected: ${t.expectModel}`);
  }

  console.log(`\n${passed}/${TESTS.length} passed.`);
  process.exit(passed === TESTS.length ? 0 : 1);
}

main().catch(err => { console.error(err.message); process.exit(1); });
