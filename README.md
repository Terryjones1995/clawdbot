# Ghost — AI Agent System

Ghost is a Discord-first AI agent system with a Next.js management portal. It runs as a Node.js/Express backend managed by PM2, with Ollama as the default (free) AI brain and escalation paths to OpenAI, Grok, and Claude.

## Architecture

```
Discord ──► Sentinel ──► Switchboard (classifier)
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
           Keeper          Scout           Warden
        (persistent      (research)     (approvals)
          memory)
              │
         Neon (DB) + Redis (cache)
```

**Two processes under PM2:**
- `ghost` — Express gateway on port 18789 (backend + Discord bot)
- `ghost-portal` — Next.js portal on port 3000

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js, Express, PM2, AlmaLinux 9 |
| Discord | discord.js (multi-guild aware) |
| Default AI | Ollama + qwen3-coder (free, local) |
| Real-time queries | OpenAI gpt-4o-mini-search-preview |
| Web/trend research | Grok grok-4-1-fast-reasoning |
| Deep synthesis / escalation | Claude claude-sonnet-4-6 |
| Code repair | OpenAI gpt-5.3-codex (Responses API), fallback o4-mini |
| Vision | OpenAI gpt-4o |
| Embeddings | nomic-embed-text via Ollama (768-dim) |
| Database | Neon PostgreSQL (pgvector enabled) |
| Cache / queues | Redis (ioredis, graceful degradation) |
| Portal UI | Next.js 14 (App Router), Tailwind, Zustand |

## Agents

| Agent | File | Role |
|-------|------|------|
| Sentinel | `src/sentinel.js` | Discord connector, message router |
| Switchboard | `src/switchboard.js` | Intent classifier / router |
| Keeper | `src/keeper.js` | Persistent conversation + memory |
| Warden | `src/warden.js` | Approval queue + command control |
| Scribe | `src/scribe.js` | Ops, daily summaries, reminders |
| Scout | `src/scout.js` | Web/competitive research |
| Forge | `src/forge.js` | Dev + auto-fix (reads/writes src files) |
| Helm | `src/helm.js` | SRE / deploy operations |
| Lens | `src/lens.js` | Analytics (PostHog) |
| Courier | `src/courier.js` | Email (Resend) |
| Archivist | `src/archivist.js` | Long-term memory (Pinecone) |
| Crow | — | X / social media |

Agent personalities live in `openclaw/agents/*.md`.

## Key Source Files

```
server.js                        — Express gateway, route registration, auto-fix listener
src/sentinel.js                  — Discord bot (onMessage handler, rate limiting)
src/switchboard.js               — Intent classification
src/keeper.js                    — Persistent threads (Redis cache → Neon), system prompt builder
src/warden.js                    — Approval queue (Redis hash warden:approvals)
src/scout.js                     — Research routing (Grok/OpenAI/Claude)
src/forge.js                     — Auto-fix: reads error → gpt-5.3-codex → writes file → restart
src/db.js                        — All Neon helpers + schema init + EventEmitter (error-logged)
src/redis.js                     — ioredis singleton with graceful degradation
src/botAdmins.js                 — Portal-managed admin IDs (Redis Set + local cache + Neon)
src/agentRegistry.js             — In-process agent status registry (WebSocket broadcast)
src/heartbeat.js                 — Idle auto-shutdown tracker
src/skills/memory.js             — Semantic fact extraction, pgvector retrieval, profile updates
src/skills/openai-codex.js       — gpt-5.3-codex via Responses API (instructions/input)
src/skills/openai-mini.js        — gpt-4o-mini-search-preview wrapper
openclaw/skills/discord.js       — Low-level discord.js wrapper (multi-guild)
openclaw/agents/                 — Agent personality/system prompt files
memory/run_log.md                — Append-only action audit log
logs/out.log, logs/error.log     — PM2 output logs
ecosystem.config.js              — PM2 process config
portal/                          — Next.js management portal
```

## Database Schema (Neon)

| Table | Purpose |
|-------|---------|
| `conversations` | Thread messages + summaries (thread_id PK) |
| `ghost_memory` | Persistent facts (key unique, embedding vector(768)) |
| `user_profiles` | Per-user profile JSONB (user_id PK) |
| `agent_logs` | Structured log entries (level, agent, action, outcome) |
| `message_feedback` | Thumbs up/down on Ghost replies (rating 1/-1) |
| `portal_admins` | Discord user IDs granted bot-admin via portal |

## Redis Keys

| Key pattern | Type | Purpose |
|------------|------|---------|
| `thread:{threadId}` | string | Cached conversation thread (24h TTL) |
| `facts:{sha256}` | string | Cached memory query results (60s TTL) |
| `warden:approvals` | hash | Warden approval queue (survives restarts) |
| `botadmins` | set | Portal admin user IDs (synced at startup) |
| `ratelimit:{userId}` | string | @mention rate limit counter (5s TTL) |

## Portal Pages

| Page | Path | Description |
|------|------|-------------|
| Overview | `/org/[orgId]/overview` | Agent status, system health |
| Agents | `/org/[orgId]/agents` | Live agent registry |
| Logs | `/org/[orgId]/logs` | PM2 out/error log viewer |
| Error Console | `/org/[orgId]/errors` | Current / Fixed / Warnings tabs + auto-fix |
| Jobs | `/org/[orgId]/jobs` | Background job queue |
| Servers | `/org/[orgId]/servers` | Discord server list + Bot Admins panel |
| Settings | `/org/[orgId]/settings` | Configuration |
| Social | `/org/[orgId]/social` | X / social media |

## Setup

**Prerequisites:** Node.js 18+, Redis, Ollama, PM2

```bash
# 1. Clone and install
git clone https://github.com/Terryjones1995/clawdbot
cd clawdbot
npm install

# 2. Install Redis (AlmaLinux 9)
dnf install -y redis && systemctl enable redis && systemctl start redis

# 3. Install Ollama models
ollama pull qwen3-coder
ollama pull nomic-embed-text

# 4. Configure environment
cp .env.example .env
# fill in all values — never commit .env

# 5. Install portal dependencies
cd portal && npm install && cd ..

# 6. Build portal
npm run portal:build

# 7. Start under PM2
npm run pm2:start

# 8. Persist across reboots (run once as root)
pm2 startup systemd   # run the printed command
pm2 save
```

## Environment Variables

```env
# AI
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GROK_API_KEY=

# Auth
JWT_SECRET=                    # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Ollama (local, free-first)
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen3-coder
OLLAMA_EMBED_MODEL=nomic-embed-text

# Discord
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=              # primary guild
DISCORD_OWNER_USER_ID=         # Taylor's Discord snowflake
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
NEON_DATABASE_URL=             # Neon PostgreSQL connection string

# Redis
REDIS_URL=redis://localhost:6379

# Portal
PORTAL_SECRET=                 # shared secret for portal→ghost API calls

# Server
OPENCLAW_PORT=18789

# Optional
PINECONE_API_KEY=
PINECONE_INDEX_HOST=
PINECONE_NAMESPACE=
RUNPOD_API_KEY=
RUNPOD_ENDPOINT=
RUNPOD_MODEL=
```

## Common Commands

```bash
npm run pm2:status      # check process status
npm run pm2:restart     # apply changes to ghost
npm run pm2:logs        # tail live logs
npm run pm2:stop        # stop ghost
npm run portal:restart  # restart portal only
pm2 restart all         # restart both ghost + ghost-portal

# Verify Redis
redis-cli ping

# Check agent status
curl http://localhost:18789/api/heartbeat
```

## Model Routing (free-first)

1. **qwen3-coder** (Ollama) — default for all chat/classification
2. **gpt-4o-mini-search-preview** — real-time data (weather, prices, news)
3. **grok-4-1-fast-reasoning** — web/trend research queries
4. **claude-sonnet-4-6** — deep synthesis, ESCALATE flag, complex analysis
5. **gpt-5.3-codex** (Responses API) — code repair (Forge auto-fix only)
6. **gpt-4o** — vision/image processing in reception

Never route to a paid model if Ollama can handle it.

## Auto-Fix System (Forge)

Ghost monitors its own error logs. When an ERROR is logged to `agent_logs`:
1. `server.js` fires a `db.events` listener (10-min cooldown per unique error)
2. `forge.autoFix()` extracts the file from the stack trace (or uses `AGENT_FILE_MAP`)
3. gpt-5.3-codex reads the file, generates a fix, validates JS syntax
4. Fix is written to disk and `pm2 restart ghost` runs automatically

The Error Console in the portal shows Current Errors / Fixed Errors / Warnings tabs with a manual auto-fix button for any unresolved error.

## Permissions

| Role | Who | Capabilities |
|------|-----|-------------|
| OWNER | Taylor (DISCORD_OWNER_USER_ID) | Everything |
| ADMIN | Discord "admin" role OR portal_admins | Most commands |
| AGENT | Discord "agent" role | Standard ops |
| MEMBER | Everyone else | Reception chat only |

Dangerous actions (mass DM, ban, payments) require OWNER/ADMIN Warden approval.
