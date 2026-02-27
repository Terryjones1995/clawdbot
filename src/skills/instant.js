'use strict';

/**
 * Instant reply — zero-latency responses for greetings and simple acks.
 * No LLM, no network. Call this FIRST before any model routing.
 *
 * Returns a reply string if the message is a simple greeting/ack,
 * or null if it should be routed to an LLM.
 */

const RULES = [
  {
    pattern: /^(hi|hello|hey|howdy|hiya|heya|yo|sup|what'?s up|whats up|greetings|good morning|good afternoon|good evening|morning|evening|afternoon)[!?.\s]*$/i,
    replies: [
      "Hey! What do you need?",
      "Hello! What can I help with?",
      "Hey there. What's on the agenda?",
      "Hi! Ready when you are.",
    ],
  },
  {
    pattern: /^(thanks|thank you|thx|ty|cheers|appreciated|much appreciated)[!?.\s]*$/i,
    replies: ["Anytime.", "You got it.", "Of course.", "Happy to help."],
  },
  {
    pattern: /^(ok|okay|k|got it|understood|sounds good|perfect|great|nice|cool|awesome|noted)[!?.\s]*$/i,
    replies: ["Got it.", "👍", "Noted.", "Sounds good."],
  },
  {
    pattern: /^(ping|you there\??|are you there\??|you alive\??|you awake\??|test)[!?.\s]*$/i,
    replies: ["Pong. I'm here."],
  },
  {
    pattern: /^(who are you|what are you|what'?s your name|what is your name)[?!.\s]*$/i,
    replies: ["I'm Ghost — your AI ops system. Give me a task or ask me anything."],
  },
  {
    pattern: /^(what can you do|how does this work|what do you do|help)[?!.\s]*$/i,
    replies: ["I can research, draft emails, manage Discord, analyze data, and more. Just tell me what you need."],
  },
  {
    pattern: /^(good job|good work|well done|nice work|nice one|great job)[!?.\s]*$/i,
    replies: ["Thanks!", "Appreciate it.", "Glad that helped."],
  },
  {
    pattern: /^(bye|goodbye|see you|later|ttyl|peace)[!?.\s]*$/i,
    replies: ["Later.", "See you.", "Catch you later."],
  },
];

function instantReply(text) {
  if (!text) return null;
  const t = text.trim();
  // Only run on short, simple messages
  if (t.length === 0 || t.length > 100) return null;

  for (const rule of RULES) {
    if (rule.pattern.test(t)) {
      return rule.replies[Math.floor(Math.random() * rule.replies.length)];
    }
  }
  return null;
}

module.exports = { instantReply };
