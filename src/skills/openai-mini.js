'use strict';

/**
 * OpenAI gpt-4o-mini skill — fast, cheap replacement for Ollama.
 * Drop-in compatible with ollama.tryChat() interface.
 *
 * Typical latency: 1-3 seconds (vs 2+ minutes for Ollama on CPU).
 * Cost: ~$0.15 / 1M input tokens — negligible for chat.
 *
 * Usage:
 *   const mini = require('./skills/openai-mini');
 *
 *   // Drop-in for ollama.tryChat():
 *   const { result, escalate, reason } = await mini.tryChat(messages);
 *   if (!escalate) reply = result.message.content;
 *
 *   // Simple chat:
 *   const reply = await mini.chat(systemPrompt, userMessage);
 */

const { OpenAI } = require('openai');
const { trackUsage } = require('./usage-tracker');

const MODEL  = 'gpt-4o-mini';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Simple chat — returns reply string.
 */
async function chat(systemPrompt, userMessage, maxTokens = 512) {
  const res = await client.chat.completions.create({
    model:      MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage  },
    ],
  });
  return res.choices[0]?.message?.content ?? '(no response)';
}

/**
 * Multi-turn chat with full message history — returns reply string.
 * Expects messages in OpenAI format: [{ role, content }]
 * System prompt is prepended automatically.
 */
async function chatWithHistory(systemPrompt, messages, maxTokens = 1024) {
  const res = await client.chat.completions.create({
    model:      MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  });
  return res.choices[0]?.message?.content ?? '(no response)';
}

/**
 * Drop-in replacement for ollama.tryChat().
 * Returns { result: { message: { content }, model }, escalate, reason }
 */
async function tryChat(messages, options = {}) {
  const start = Date.now();
  try {
    const usedModel = options.model || MODEL;
    const res = await client.chat.completions.create({
      model:      usedModel,
      max_tokens: options.maxTokens || 1024,
      temperature: options.params?.temperature ?? 0.7,
      messages,
    });
    const content = res.choices[0]?.message?.content ?? '';
    trackUsage({ provider: 'openai', model: usedModel, agent: 'ghost', action: 'chat', input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0, latency_ms: Date.now() - start });
    return {
      result:  { message: { content }, model: usedModel },
      escalate: false,
      reason:   null,
    };
  } catch (err) {
    return { result: null, escalate: true, reason: err.message };
  }
}

module.exports = { chat, chatWithHistory, tryChat, MODEL };
