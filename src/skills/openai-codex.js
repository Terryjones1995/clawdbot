'use strict';

/**
 * OpenAI o4-mini — code reasoning / bug-fix model.
 *
 * o4-mini is OpenAI's reasoning model optimized for code tasks.
 * Significantly more capable than gpt-4o-mini for debugging and fixes.
 * Uses standard Chat Completions API.
 *
 * Usage:
 *   const codex = require('./openai-codex');
 *   const { text, escalate } = await codex.fixCode(systemPrompt, userPrompt);
 */

const { OpenAI } = require('openai');

const MODEL  = 'o4-mini';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Fix code — returns { text, model, escalate, reason }.
 * Uses reasoning mode (no temperature, no system role with o4-mini).
 */
async function fixCode(systemPrompt, userPrompt, maxTokens = 8192) {
  try {
    const res = await client.chat.completions.create({
      model:               MODEL,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
    });
    const text = res.choices[0]?.message?.content ?? '';
    return { text, model: MODEL, escalate: false, reason: null };
  } catch (err) {
    return { text: '', model: MODEL, escalate: true, reason: err.message };
  }
}

/**
 * Drop-in for mini.tryChat() interface.
 */
async function tryChat(messages, options = {}) {
  try {
    const res = await client.chat.completions.create({
      model:               options.model || MODEL,
      max_completion_tokens: options.maxTokens || 4096,
      messages,
    });
    const content = res.choices[0]?.message?.content ?? '';
    return {
      result:  { message: { content }, model: MODEL },
      escalate: false,
      reason:   null,
    };
  } catch (err) {
    return { result: null, escalate: true, reason: err.message };
  }
}

module.exports = { fixCode, tryChat, MODEL };
