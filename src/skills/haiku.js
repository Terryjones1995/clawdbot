'use strict';
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Fast chat using Claude Haiku. Returns reply string.
 * Typical latency: 1-3 seconds.
 */
async function chat(systemPrompt, userMessage, maxTokens = 512) {
  const msg = await client.messages.create({
    model:      HAIKU_MODEL,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  });
  return msg.content[0]?.text ?? '(no response)';
}

/**
 * Multi-turn chat with message history.
 */
async function chatWithHistory(systemPrompt, messages, maxTokens = 1024) {
  const msg = await client.messages.create({
    model:      HAIKU_MODEL,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages,
  });
  return msg.content[0]?.text ?? '(no response)';
}

module.exports = { chat, chatWithHistory, MODEL: HAIKU_MODEL };
