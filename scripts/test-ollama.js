#!/usr/bin/env node
'use strict';

/**
 * Smoke-test for the Ollama connector.
 * Run: node scripts/test-ollama.js
 */

require('dotenv').config();
const ollama = require('../openclaw/skills/ollama');

async function main() {
  console.log(`Host:        ${ollama.host}`);
  console.log(`Chat model:  ${ollama.model}`);
  console.log(`Embed model: ${ollama.embedModel}\n`);

  // 1. Health check
  process.stdout.write('1. Health check ... ');
  const ok = await ollama.isAvailable();
  console.log(ok ? '✅ Ollama reachable' : '❌ Ollama not reachable');

  if (!ok) {
    console.log('\nOllama is not running. Start it with: ollama serve');
    process.exit(1);
  }

  // 2. List models
  process.stdout.write('2. List models    ... ');
  const models = await ollama.listModels();
  console.log(models.length ? `✅ ${models.join(', ')}` : '⚠️  No models installed');

  // 3. tryChat (free-first pattern)
  process.stdout.write('3. tryChat        ... ');
  const { result, escalate, reason } = await ollama.tryChat([
    { role: 'user', content: 'Reply with exactly: "Ghost online."' },
  ]);
  if (escalate) {
    console.log(`⚠️  escalate=true — reason: ${reason}`);
  } else {
    const text = result?.message?.content?.trim();
    console.log(`✅ ${text}`);
  }

  // 4. generate
  process.stdout.write('4. generate       ... ');
  const gen = await ollama.generate('Say "pong" and nothing else.');
  console.log(`✅ ${gen.response?.trim()}`);

  // 5. embed
  process.stdout.write('5. embed          ... ');
  const vec = await ollama.embed('hello world');
  console.log(vec?.length ? `✅ vector dim=${vec.length}` : '❌ no embedding returned');

  console.log('\nAll tests passed.');
}

main().catch(err => { console.error('\n❌', err.message); process.exit(1); });
