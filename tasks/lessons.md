# Agent Lessons

Patterns and corrections learned from live interactions and auto-fixes.
This file is referenced by Claude Code for self-improvement.

## Error Patterns

- Redis operations should always be wrapped in try/catch — Redis is optional and may be down
- Ollama embed() can fail when Ollama is offline — always catch and fallback gracefully
- pgvector `<=>` operator requires non-null embeddings — guard with `WHERE embedding IS NOT NULL`
- Scout's `_miniChat()` returns `{ text, escalate, reason }` NOT `{ result, escalate }`
- Warden `getPending()`, `getById()`, `resolve()` are async — all callers must await

## Correction Patterns

- Ghost should not assume timezone — always use UTC unless user specifies
- Ghost should check ghost_memory before calling external APIs for factual queries
- Embeddings must be `number[]` formatted as `[x1,x2,...]` string for pgvector

## Best Practices

- Never auto-patch protected files (forge.js, server.js, usage-tracker.js, learning.js)
- 10-minute cooldown per unique (agentName, errorNote) pair for auto-fix
- Free-first routing: always try Ollama before paid models
- Non-blocking memory/learning operations: always use `.catch(() => {})`
