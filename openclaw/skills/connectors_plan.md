# Connectors Plan

**Purpose:** Specifies how each external service connects to Ghost, what credentials are needed, and the MVP API surface for each connector.

---

## 1. Discord (Sentinel)

**Library:** `discord.js` v14
**Auth:** Bot token via `DISCORD_BOT_TOKEN` env var

**MVP API Surface:**
- `sendMessage(channel_id, content)` — send message to channel
- `sendDM(user_id, content)` — send DM to user
- `onMessage(callback)` — listen for inbound messages
- `deleteMessage(channel_id, message_id)` — delete message (Warden-gated)
- `kickUser(guild_id, user_id, reason)` — kick user (Warden-gated)
- `banUser(guild_id, user_id, reason)` — ban user (Warden-gated)

**Env vars needed:**
```
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_COMMANDS_CHANNEL_ID=
DISCORD_ALERTS_CHANNEL_ID=
DISCORD_OWNER_USER_ID=
```

---

## 2. X / Twitter (Crow)

**Library:** `twitter-api-v2`
**Auth:** OAuth 2.0 / Bearer token

**MVP API Surface:**
- `postTweet(text)` — post a tweet
- `postThread(tweets[])` — post a thread
- `replyToTweet(tweet_id, text)` — reply
- `sendDM(user_id, text)` — DM (Warden-gated)
- `getMentions()` — fetch recent @mentions

**Env vars needed:**
```
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=
X_BEARER_TOKEN=
```

---

## 3. PostHog (Lens)

**Library:** `posthog-node`
**Auth:** Project API key

**MVP API Surface:**
- `capture(event, properties)` — capture an event
- `query(query_string)` — HogQL query
- `getInsight(insight_id)` — fetch saved insight

**Env vars needed:**
```
POSTHOG_API_KEY=
POSTHOG_HOST=https://app.posthog.com
POSTHOG_PROJECT_ID=
```

---

## 4. Resend (Courier)

**Library:** `resend`
**Auth:** API key

**MVP API Surface:**
- `send({ from, to, subject, html })` — send transactional email
- `sendBatch(emails[])` — send bulk (Warden-gated)
- `createTemplate(name, html)` — create email template
- `listAudiences()` — list contact lists

**Env vars needed:**
```
RESEND_API_KEY=
RESEND_FROM_EMAIL=
```

---

## 5. Pinecone (Archivist)

**Library:** `@pinecone-database/pinecone`
**Auth:** API key

**MVP API Surface:**
- `upsert(vectors[])` — store embeddings
- `query(vector, top_k, filter)` — semantic search
- `delete(ids[])` — delete by ID
- `describeIndexStats()` — index health

**Env vars needed:**
```
PINECONE_API_KEY=
PINECONE_INDEX_NAME=ghost-memory
PINECONE_ENVIRONMENT=
```

**Embedding model:** Use Ollama `nomic-embed-text` (free) or OpenAI `text-embedding-3-small` (paid).

---

## 6. Neon — Postgres (Forge / Helm)

**Library:** `@neondatabase/serverless` or `pg` + `drizzle-orm`
**Auth:** Connection string

**MVP API Surface:**
- Standard SQL via Drizzle ORM
- Tables: `users`, `agents`, `approvals`, `run_log`, `sessions`

**Env vars needed:**
```
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
```

---

## 7. Redis (Archivist / Helm)

**Library:** `ioredis`
**Auth:** Connection URL

**MVP API Surface:**
- `set(key, value, ttl)` — store with expiry
- `get(key)` — retrieve
- `del(key)` — delete
- `lpush / lrange` — queue operations
- `publish / subscribe` — event bus

**Env vars needed:**
```
REDIS_URL=redis://localhost:6379
```

---

## 8. Ollama (All agents — default model)

**Library:** `ollama` (npm) or direct HTTP to local server
**Auth:** None (local)

**MVP API Surface:**
- `POST /api/chat` — chat completion
- `POST /api/generate` — text generation
- `POST /api/embeddings` — embeddings (nomic-embed-text)

**Env vars needed:**
```
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3-coder
```

---

## 9. Grok (Scout)

**Library:** Direct HTTP or official SDK when available
**Auth:** API key

**MVP API Surface:**
- `search(query)` — web/trend search
- `chat(messages[])` — reasoning/synthesis

**Env vars needed:**
```
GROK_API_KEY=
```

---

## .env.example additions

Add all of the above to `.env.example` as empty placeholders. Fill in `.env` locally. Never commit `.env`.
