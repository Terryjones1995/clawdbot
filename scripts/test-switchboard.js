#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for Switchboard (keyword pass only — no Ollama needed).
 * Run: node scripts/test-switchboard.js
 */

require('dotenv').config();
const { classify } = require('../src/switchboard');

const TESTS = [
  { message: 'fix the login bug in server.js',       expect: 'Forge'     },
  { message: 'deploy the latest build to production', expect: 'Helm'      },
  { message: "what's trending in AI today?",          expect: 'Scout'     },
  { message: 'draft a tweet about our new feature',   expect: 'Crow'      },
  { message: 'remind me at 3pm to check the logs',    expect: 'Scribe'    },
  { message: 'how many users signed up yesterday?',   expect: 'Lens'      },
  { message: 'remember that we use Neon for Postgres',expect: 'Archivist' },
  { message: 'approve the pending tweet APR-0001',    expect: 'Warden'    },
  { message: 'send an email campaign to all users',   expect: 'Courier'   },
  { message: 'post in #announcements: we are live',   expect: 'Sentinel'  },
];

async function main() {
  console.log('Switchboard Smoke Test\n');

  let passed = 0;
  for (const t of TESTS) {
    const result = await classify({ source: 'cli', user_role: 'OWNER', message: t.message });
    const ok = result.agent === t.expect;
    if (ok) passed++;
    const icon  = ok ? '✅' : '❌';
    const agent = result.agent.padEnd(10);
    const intent = (result.intent || '').padEnd(28);
    console.log(`${icon} [${agent}] ${intent} "${t.message.slice(0, 50)}"`);
    if (!ok) console.log(`   Expected: ${t.expect}, got: ${result.agent} — ${result.reason}`);
  }

  console.log(`\n${passed}/${TESTS.length} passed.`);
  process.exit(passed === TESTS.length ? 0 : 1);
}

main().catch(err => { console.error(err.message); process.exit(1); });
