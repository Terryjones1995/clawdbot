'use strict';

/**
 * DeepSeek skill — cheap, capable mid-tier for agent tasks + hard reasoning.
 * Drop-in compatible with ollama.tryChat() interface.
 *
 * Models:
 *   deepseek-chat      — V3.2 (agent-optimized, fast, tool-use trained)
 *   deepseek-reasoner  — R1 (chain-of-thought reasoning, math, analysis)
 *
 * Pricing (same for both):
 *   Input:  $0.28 / 1M tokens (cache hit: $0.028)
 *   Output: $0.42 / 1M tokens
 *
 * Usage:
 *   const deepseek = require('./skills/deepseek');
 *   const { result, escalate, reason } = await deepseek.tryChat(messages);
 *   if (!escalate) reply = result.message.content;
 */

const { OpenAI } = require('openai');
const { trackUsage } = require('./usage-tracker');

const MODEL          = 'deepseek-chat';      // V3.2 — fast, agent-optimized
const REASONER_MODEL = 'deepseek-reasoner';  // R1 — hard reasoning

// Lazy client — avoid crashing at module load if env var isn't set yet
let _client;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey:  process.env.DEEPSEEK_API_KEY || 'missing',
      baseURL: 'https://api.deepseek.com',
    });
  }
  return _client;
}

/**
 * Simple chat — returns reply string.
 */
async function chat(systemPrompt, userMessage, maxTokens = 4096) {
  const res = await getClient().chat.completions.create({
    model:      MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userMessage },
    ],
  });
  return res.choices[0]?.message?.content ?? '(no response)';
}

/**
 * Drop-in replacement for ollama.tryChat().
 * Returns { result: { message: { content }, model }, escalate, reason }
 *
 * Use options.model = 'deepseek-reasoner' for hard reasoning tasks.
 */
async function tryChat(messages, options = {}) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { result: null, escalate: true, reason: 'DEEPSEEK_API_KEY not set' };
  }

  const start     = Date.now();
  const usedModel = options.model || MODEL;
  const isReasoner = usedModel === REASONER_MODEL;

  try {
    // R1 (reasoner) doesn't support system role — merge into user message
    const finalMessages = isReasoner ? _mergeSystemRole(messages) : messages;
    const res = await getClient().chat.completions.create({
      model:      usedModel,
      max_tokens: options.maxTokens || 4096,
      messages:   finalMessages,
    });
    const content = res.choices[0]?.message?.content ?? '';
    trackUsage({
      provider:      'deepseek',
      model:         usedModel,
      agent:         options.agent || 'ghost',
      action:        options.action || 'chat',
      input_tokens:  res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
      latency_ms:    Date.now() - start,
    });
    return {
      result:   { message: { content }, model: usedModel },
      escalate: false,
      reason:   null,
    };
  } catch (err) {
    return { result: null, escalate: true, reason: err.message };
  }
}

/**
 * DeepSeek R1 (reasoner) doesn't support the 'system' role.
 * Merge system messages into the first user message.
 */
function _mergeSystemRole(messages) {
  const systemParts = [];
  const rest = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      rest.push(msg);
    }
  }
  if (!systemParts.length) return rest;
  if (rest.length && rest[0].role === 'user') {
    return [
      { role: 'user', content: systemParts.join('\n') + '\n\n' + rest[0].content },
      ...rest.slice(1),
    ];
  }
  return [{ role: 'user', content: systemParts.join('\n') }, ...rest];
}

module.exports = { chat, tryChat, MODEL, REASONER_MODEL };
