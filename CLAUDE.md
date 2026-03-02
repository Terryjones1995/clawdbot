# Ghost — Claude Code Instructions

This file is read automatically at the start of every Claude Code session.

## Autonomous Mode

**Proceed without asking for approval.** Make changes, restart services, and fix issues independently. The user will intervene if something is wrong. Only stop to ask when a decision is genuinely irreversible or destructive (force-push to main, dropping DB tables, billing changes).

Never auto-commit. Never auto-push to remote.

---

## Project Overview

**Ghost** is a Discord-first AI agent system running on Node.js/Express (port 18789) with a Next.js portal on port 3001. The bot account is **Ghost#6982**. PM2 app names: `ghost` (backend) and `ghost-portal` (Next.js).

**Mission Control** (public portal): **https://2kdiscord.com** — nginx reverse proxy → port 3001. SSL via Let's Encrypt (acme.sh, auto-renews). WebSocket path `/ws` proxies to port 18789. Nginx vhost: `/www/server/panel/vhost/nginx/2kdiscord.com.conf`.

## Tech Stack

- **Runtime**: Node.js, Express, PM2 (AlmaLinux 9 / systemd)
- **Discord**: discord.js, multi-guild aware (primary guild = DISCORD_GUILD_ID)
- **Default AI**: Ollama + qwen2.5:14b (free, local — always try first)
- **Real-time / web queries**: OpenAI gpt-4o-mini-search-preview
- **Web / trend research**: Grok grok-4-1-fast-reasoning
- **Deep synthesis / escalation**: Claude claude-sonnet-4-6
- **Code repair (Forge)**: OpenAI gpt-5.3-codex via Responses API, fallback o4-mini
- **Vision (images in reception)**: OpenAI gpt-4o
- **Embed model**: nomic-embed-text via Ollama (768-dim)
- **Database**: Neon PostgreSQL (pgvector enabled)
- **Cache / queues**: Redis via ioredis (graceful degradation — never crashes if Redis down)
- **Portal**: Next.js 14 App Router, Tailwind, Zustand

## Agent Names (locked in — do not rename)

| Name        | File                          | Role                          |
|-------------|-------------------------------|-------------------------------|
| Switchboard | `src/switchboard.js`          | Router / classifier           |
| Warden      | `src/warden.js`               | Command & control / approvals |
| Scribe      | `src/scribe.js`               | Ops / summaries / reminders   |
| Scout       | `src/scout.js`                | Research (multi-model)        |
| Sentinel    | `src/sentinel.js`             | Discord connector             |
| Crow        | —                             | X / social media              |
| Forge       | `src/forge.js`                | Dev / auto-fix                |
| Lens        | `src/lens.js`                 | Analytics (PostHog)           |
| Courier     | `src/courier.js`              | Email (Resend)                |
| Archivist   | `src/archivist.js`            | Long-term memory (Pinecone)   |
| Helm        | `src/helm.js`                 | SRE / deploy                  |
| Keeper      | `src/keeper.js`               | Persistent conversation + memory |

## Key Files

```
server.js                        — Express gateway, route registration, auto-fix event listener
src/sentinel.js                  — Discord bot (onMessage, rate limiting, multi-guild)
src/switchboard.js               — Intent classifier
src/keeper.js                    — Thread persistence (Redis cache → Neon), system prompt builder
src/warden.js                    — Approval queue (Redis hash warden:approvals)
src/scout.js                     — Research agent (Grok/OpenAI/Claude routing + fact storage)
src/forge.js                     — Auto-fix: error → gpt-5.3-codex → write file → pm2 restart
src/db.js                        — All Neon DB helpers + schema init + EventEmitter (error-logged)
src/redis.js                     — ioredis singleton with no-op fallbacks when Redis is down
src/botAdmins.js                 — Portal admin IDs (Redis Set + local Set cache + Neon)
src/agentRegistry.js             — In-process agent status (WebSocket broadcast to portal)
src/heartbeat.js                 — Idle auto-shutdown tracker
src/skills/memory.js             — Fact extraction, pgvector semantic search, user profile updates
src/skills/openai-codex.js       — gpt-5.3-codex via Responses API (instructions/input params)
src/skills/openai-mini.js        — gpt-4o-mini-search-preview wrapper
src/skills/instant.js            — Fast canned replies (greetings, etc.)
openclaw/skills/discord.js       — Low-level discord.js wrapper
openclaw/agents/                 — Agent soul/personality files (*.md)
memory/run_log.md                — Append-only action audit log
logs/out.log, logs/error.log     — PM2 output logs
ecosystem.config.js              — PM2 process config
portal/                          — Next.js management portal
```

## Model Routing Rules (free-first, non-negotiable)

1. **Default**: qwen2.5:14b via Ollama (free, local)
2. **Real-time data** (weather, prices, news, scores): gpt-4o-mini-search-preview + today's date
3. **Web / trend queries**: Grok grok-4-1-fast-reasoning
4. **Deep synthesis / competitive analysis**: Claude claude-sonnet-4-6
5. **ESCALATE flag**: Claude claude-sonnet-4-6
6. **Code repair** (Forge only): gpt-5.3-codex → o4-mini fallback
7. **Ollama unavailable**: fall back up the chain

Never route to a paid model if Ollama can handle it.

## Permissions Model

- **OWNER** — Taylor (DISCORD_OWNER_USER_ID)
- **ADMIN** — Discord role "admin" OR portal_admins table (botAdmins.isAdmin())
- **AGENT** — Discord role "agent"
- **MEMBER** — everyone else

Dangerous actions (mass DM, deletes, bans, payments) require OWNER/ADMIN approval via Warden.

## Reception Channel (#🎙️・reception)

- Any message → Switchboard classifies → routes to correct agent
- Images → handled by gpt-4o vision before text routing
- Greetings → friendly reply, no agent routing
- Immediate "⏳ Please wait…" embed sent before classification begins
- DMs from OWNER route the same as reception

## Auto-Fix System

`db.logEntry()` emits `db.events.emit('error-logged', entry)` on ERROR level.
`server.js` listens and calls `forge.autoFix({ errorNote, agentName, restart: true })`.
- 10-minute cooldown per unique (agentName, errorNote) pair
- Forge uses `AGENT_FILE_MAP` when stack trace has no file path
- gpt-5.3-codex via Responses API reads file, generates fix, validates JS, writes + restarts
- Results logged to `agent_logs` (INFO=fixed, WARN=no fix found)

## Database Schema (Neon)

| Table | Key columns |
|-------|-------------|
| `conversations` | thread_id PK, messages JSONB, summary |
| `ghost_memory` | key (unique), content, category, embedding vector(768), source |
| `user_profiles` | user_id PK, username, data JSONB |
| `agent_logs` | level, agent, action, outcome, note |
| `message_feedback` | thread_id, content_hash, rating (1/-1), note |
| `portal_admins` | user_id PK, username, added_by, added_at |

## Redis Keys

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `thread:{threadId}` | string | 24h | Cached conversation thread |
| `facts:{sha256}` | string | 60s | Cached memory query results |
| `warden:approvals` | hash | — | Approval queue (survives restarts) |
| `botadmins` | set | — | Portal admin user IDs |
| `ratelimit:{userId}` | string | 5s | @mention rate limit counter |

## Environment Variables (all in .env, never commit)

```
# AI
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GROK_API_KEY=

# Auth
JWT_SECRET=

# Ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_EMBED_MODEL=nomic-embed-text

# Discord
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_OWNER_USER_ID=
DISCORD_COMMANDS_CHANNEL_ID=
DISCORD_ALERTS_CHANNEL_ID=
DISCORD_CH_RECEPTION=
DISCORD_CH_SWITCHBOARD=
DISCORD_CH_WARDEN=
DISCORD_CH_SCRIBE=
DISCORD_CH_SCOUT=
DISCORD_CH_FORGE=
DISCORD_CH_LENS=
DISCORD_CH_COURIER=
DISCORD_CH_ARCHIVIST=
DISCORD_CH_AUDIT=

# Database
NEON_DATABASE_URL=

# Redis
REDIS_URL=redis://localhost:6379

# Portal
PORTAL_SECRET=

# Server
OPENCLAW_PORT=18789
IDLE_SHUTDOWN_MINUTES=120

# Optional
PINECONE_API_KEY=
PINECONE_INDEX_HOST=
PINECONE_NAMESPACE=
RUNPOD_API_KEY=
RUNPOD_ENDPOINT=
RUNPOD_MODEL=
```

## Linux Deployment (AlmaLinux 9)

```bash
# 1. Install dependencies
npm install -g pm2
npm install
cd portal && npm install && npm run build && cd ..

# 2. Install and start Redis
dnf install -y redis && systemctl enable redis && systemctl start redis

# 3. Install Ollama models
ollama pull qwen2.5:14b && ollama pull nomic-embed-text

# 4. Configure
cp .env.example .env  # fill in values

# 5. Start
npm run pm2:start

# 6. Persist across reboots (once)
pm2 startup systemd  # run the printed command
pm2 save

# 7. Verify
npm run pm2:status
curl http://localhost:18789/api/heartbeat
redis-cli ping
```

## Common Commands

```bash
npm run pm2:status      # check if ghost is running
npm run pm2:restart     # apply code changes (ghost only)
npm run pm2:logs        # tail live logs
npm run pm2:stop        # stop the bot
npm run portal:restart  # restart portal only
pm2 restart all         # restart both apps
redis-cli ping          # verify Redis
```

## Safe Restart Workflow

```bash
# After any code change to server.js or src/:
npm run pm2:restart

# After portal changes:
npm run portal:restart

# Full reset:
pm2 delete all && npm run pm2:start
```

## Notes

- Ollama runs at localhost:11434; models: qwen2.5:14b, nomic-embed-text
- PM2 auto-restarts on crash; daily cron restart at 4am UTC; max 450MB RAM
- Heartbeat idle-shutdown after 120min inactivity
- Platform: AlmaLinux 9 / systemd
- gpt-5.3-codex uses `client.responses.create({ instructions, input, max_output_tokens })` — NOT Chat Completions
- Redis is gracefully optional — all helpers silently no-op if Redis is down
- `PORTAL_BYPASS` middleware in server.js allows portal calls via `x-portal-secret` header without a JWT session

---

## Workflow

### Autonomous Operation
- Execute tasks without asking for approval
- Fix bugs by reading logs, identifying root cause, patching, and restarting
- When blocked or something seems genuinely destructive — pause and ask once

### Self-Improvement
- After any correction from the user: update `tasks/lessons.md` with the pattern
- Review lessons at session start for relevant context

### Verification
- After code changes: restart and check `pm2 logs ghost --lines 20 --nostream` for errors
- After DB changes: verify schema with a quick query
- Never declare something done without confirming it works

### Code Standards
- Simplicity first — minimal code impact per change
- Find root causes — no temporary workarounds
- Only touch what's necessary to fix the issue

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Autonomous**: Execute and verify independently. The user trusts the system to self-correct.
