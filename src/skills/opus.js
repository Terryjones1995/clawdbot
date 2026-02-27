'use strict';

/**
 * Claude Opus 4.6 skill — highest capability, drop-in for openai-mini.js.
 *
 * Usage:
 *   const opus = require('./skills/opus');
 *   const { result, escalate, reason } = await opus.tryChat(messages);
 *   if (!escalate) reply = result.message.content;
 *
 *   const reply = await opus.chat(systemPrompt, userMessage);
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL  = 'claude-opus-4-6';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Simple chat — returns reply string.
 */
async function chat(systemPrompt, userMessage, maxTokens = 512) {
  const res = await client.messages.create({
    model:      MODEL,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userMessage }],
  });
  return res.content[0]?.text ?? '(no response)';
}

/**
 * Multi-turn chat with full message history — returns reply string.
 * Expects messages in OpenAI format: [{ role, content }] (no system role)
 */
async function chatWithHistory(systemPrompt, messages, maxTokens = 1024) {
  const res = await client.messages.create({
    model:      MODEL,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages,
  });
  return res.content[0]?.text ?? '(no response)';
}

/**
 * Drop-in replacement for mini.tryChat().
 * Returns { result: { message: { content }, model }, escalate, reason }
 * Handles messages array with optional leading system role.
 */
async function tryChat(messages, options = {}) {
  try {
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMsgs  = messages.filter(m => m.role !== 'system');

    const res = await client.messages.create({
      model:      options.model || MODEL,
      max_tokens: options.maxTokens || 1024,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: chatMsgs,
    });

    const content = res.content[0]?.text ?? '';
    return {
      result:   { message: { content }, model: MODEL },
      escalate: false,
      reason:   null,
    };
  } catch (err) {
    return { result: null, escalate: true, reason: err.message };
  }
}

module.exports = { chat, chatWithHistory, tryChat, MODEL };
