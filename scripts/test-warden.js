#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for the Warden.
 * Run: node scripts/test-warden.js
 */

require('dotenv').config();
const warden = require('../src/warden');

const TESTS = [
  {
    label: 'OWNER action → auto-approved',
    input: { requesting_agent: 'Crow', action: 'post-tweet', user_role: 'OWNER', payload: 'Hello world', reason: 'test' },
    expect: 'approved',
  },
  {
    label: 'ADMIN non-dangerous → auto-approved',
    input: { requesting_agent: 'Scribe', action: 'generate-summary', user_role: 'ADMIN', payload: {}, reason: 'daily ops' },
    expect: 'approved',
  },
  {
    label: 'ADMIN dangerous (tweet) → queued',
    input: { requesting_agent: 'Crow', action: 'post-tweet', user_role: 'ADMIN', payload: 'Launch announcement', reason: 'social' },
    expect: 'queued',
  },
  {
    label: 'ADMIN dangerous (deploy prod) → queued',
    input: { requesting_agent: 'Helm', action: 'deploy prod', user_role: 'ADMIN', payload: 'v1.2.0', reason: 'release' },
    expect: 'queued',
  },
  {
    label: 'AGENT action → denied',
    input: { requesting_agent: 'Scout', action: 'send-message', user_role: 'AGENT', payload: {}, reason: 'alert' },
    expect: 'denied',
  },
];

async function main() {
  console.log('Warden Smoke Test\n');

  let passed = 0;
  const ids = [];

  for (const t of TESTS) {
    const result = await warden.gate(t.input);
    const ok = result.decision === t.expect;
    if (ok) passed++;
    if (result.approval_id) ids.push(result.approval_id);
    const icon = ok ? '✅' : '❌';
    console.log(`${icon} [${result.decision.padEnd(8)}] ${t.label}`);
    if (!ok) console.log(`   Expected: ${t.expect}, got: ${result.decision} — ${result.reason}`);
  }

  // Test resolve
  if (ids.length > 0) {
    const id = ids[0];
    console.log(`\nResolving ${id} → approve`);
    const r = warden.resolve(id, 'approve', 'OWNER', 'smoke test');
    console.log(r.ok ? `✅ Resolved ${id} as APPROVED` : `❌ ${r.error}`);
    if (r.ok) passed++;

    console.log(`Resolving ${id} again (should fail)`);
    const r2 = warden.resolve(id, 'deny', 'OWNER');
    console.log(!r2.ok ? `✅ Correctly rejected double-resolve: ${r2.error}` : `❌ Should have failed`);
    if (!r2.ok) passed++;
  }

  console.log(`\n${passed}/${TESTS.length + 2} passed.`);
  process.exit(passed >= TESTS.length ? 0 : 1);
}

main().catch(err => { console.error(err.message); process.exit(1); });
