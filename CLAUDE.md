# Ghost — Claude Code Instructions

This file is read automatically at the start of every Claude Code session.

## Autonomous Mode

**Proceed without asking for approval.** Make changes, restart services, and fix issues independently. The user will intervene if something is wrong. Only stop to ask when a decision is genuinely irreversible or destructive (force-push to main, dropping DB tables, billing changes).

Never auto-commit. Never auto-push to remote.

---

## Project Overview

**Ghost** is a Discord-first AI agent system with two backend processes:

1. **OpenClaw Gateway** (port 18789) — Discord bot connection, model routing, skill system, session management. PM2 app: `openclaw`.
2. **Ghost API** (port 18790) — Express headless backend for custom business logic (tickets, directives, league data, memory, vision, admin actions, forge auto-fix, scribe cron jobs). PM2 app: `ghost`.

**Portal** (Next.js, port 3001) — management UI at **https://2kdiscord.com**. PM2 app: `ghost-portal`. Nginx reverse proxy → port 3001. WebSocket `/ws` → port 18790.

The bot account is **Ghost#6982**. OpenClaw owns the Discord gateway connection and routes messages through its agent runtime, calling Ghost API via HTTP skills.

## Architecture

```
Discord (4 guilds)  →  OpenClaw Gateway (:18789)  →  SKILL.md HTTP calls  →  Ghost API (:18790)
                       Model routing (config)                                 Neon PostgreSQL
                       SOUL.md personality                                    Redis cache
                       AGENTS.md instructions                                 Ollama local
                       Session management                                     Portal (:3001)
```

## Tech Stack

- **Runtime**: Node.js 22, Express, PM2 (AlmaLinux 9 / systemd)
- **Discord**: OpenClaw gateway (discord.js internal, config-driven)
- **AI Gateway**: OpenClaw v2026.3.1 (`~/.openclaw/openclaw.json`)
- **Primary model**: Ollama qwen2.5:14b (free, local — at 100.66.178.118:11434 via Tailscale)
- **Fallbacks**: DeepSeek V3.2 → gpt-4o-mini → Claude claude-sonnet-4-6 (configured in openclaw.json)
- **Code repair (Forge)**: OpenAI gpt-5.3-codex via Responses API, fallback o4-mini
- **Vision**: OpenAI gpt-4o
- **Embed model**: nomic-embed-text via Ollama (768-dim)
- **Database**: Neon PostgreSQL (pgvector enabled)
- **Cache / queues**: Redis via ioredis (graceful degradation)
- **Portal**: Next.js 14 App Router, Tailwind, Zustand

## OpenClaw Workspace

```
~/.openclaw/
├── openclaw.json              — Gateway config (ports, models, Discord, skills)
└── workspace/
    ├── SOUL.md                — Ghost personality
    ├── AGENTS.md              — Routing rules + behavior instructions
    ├── MEMORY.md              — Seed knowledge (leagues, platform facts)
    └── skills/
        ├── ghost-directives/  — Admin auto-moderation rules
        ├── ghost-tickets/     — Ticket detection, context, close
        ├── ghost-league/      — League data queries
        ├── ghost-memory/      — Semantic memory search/store
        ├── ghost-vision/      — GPT-4o image analysis
        ├── ghost-admin/       — Discord admin commands
        ├── ghost-scout/       — Research agent
        └── ghost-forge/       — Auto-fix trigger
```

## Ghost API Routes (Express :18790)

All OpenClaw skills call these via `PORTAL_BYPASS` auth (`x-portal-secret` header):

| Route | File | Purpose |
|-------|------|---------|
| `/api/directives/*` | `src/routes/directives-api.js` | Directive check/execute/teach/manage |
| `/api/tickets/*` | `src/routes/tickets-api.js` | Ticket detect/context/close/transcript |
| `/api/league/*` | `src/routes/league-data-api.js` | League data queries |
| `/api/memory/*` | `src/routes/memory-search.js` | Semantic search/store/extract |
| `/api/vision/*` | `src/routes/vision-api.js` | GPT-4o image analysis |
| `/api/admin/*` | `src/routes/admin-actions.js` | Discord admin commands |
| `/api/reception` | `src/routes/reception.js` | Portal terminal chat |
| `/api/training` | `src/routes/training.js` | Knowledge management |
| `/api/feedback` | `src/routes/feedback.js` | Message rating |
| `/api/forge/*` | `src/routes/forge.js` | Auto-fix triggers |

## Key Files

```
server.js                        — Express gateway (:18790), route registration, auto-fix listener
openclaw-start.sh                — Bash wrapper to start OpenClaw gateway under PM2
src/keeper.js                    — Thread persistence (portal-only), Ollama chat
src/warden.js                    — Approval queue (Redis hash warden:approvals)
src/scout.js                     — Research agent (Grok/OpenAI/Claude routing)
src/forge.js                     — Auto-fix: error → gpt-5.3-codex → write file → pm2 restart
src/scribe.js                    — Ops cron jobs (briefings, reminders, memory pruning)
src/db.js                        — All Neon DB helpers + schema init + EventEmitter
src/redis.js                     — ioredis singleton with no-op fallbacks
src/skills/memory.js             — Fact extraction, pgvector semantic search
src/skills/directives.js         — Admin auto-moderation rules
src/skills/league-api.js         — League data fetching + caching
openclaw/skills/discord.js       — Stub (OpenClaw owns Discord; ready=false)
openclaw/skills/ollama.js        — Ollama API wrapper
ecosystem.config.js              — PM2 process config (ghost, ghost-portal, openclaw)
```

## Model Routing

OpenClaw handles Discord model routing via `openclaw.json`:
- **Primary**: ollama/qwen2.5:14b (free, local)
- **Fallback 1**: deepseek/deepseek-chat (cheap)
- **Fallback 2**: openai/gpt-4o-mini
- **Fallback 3**: anthropic/claude-sonnet-4-6

Ghost API (Keeper) uses Ollama directly for portal terminal chat. Forge uses gpt-5.3-codex for code repair.

## Permissions Model

- **OWNER** — Taylor (DISCORD_OWNER_USER_ID)
- **ADMIN** — Discord role "admin" OR portal_admins table (botAdmins.isAdmin())
- **AGENT** — Discord role "agent"
- **MEMBER** — everyone else

Dangerous actions require OWNER/ADMIN approval via Warden.

## Auto-Fix System

`db.logEntry()` emits `db.events.emit('error-logged', entry)` on ERROR level.
`server.js` listens and calls `forge.autoFixWithClaude()`.
- 10-minute cooldown per unique (agentName, errorNote) pair
- Claude CLI spawned as `forge` OS user
- Results logged to `agent_logs`

## Database Schema (Neon)

| Table | Key columns |
|-------|-------------|
| `conversations` | thread_id PK, messages JSONB, summary |
| `ghost_memory` | key (unique), content, category, embedding vector(768), source |
| `user_profiles` | user_id PK, username, data JSONB |
| `agent_logs` | level, agent, action, outcome, note |
| `message_feedback` | thread_id, content_hash, rating (1/-1), note |
| `portal_admins` | user_id PK, username, added_by, added_at |
| `admin_directives` | guild_id, type, trigger_type/value, action, action_params JSONB |
| `tickets` | channel_id (unique), guild_id, transcript JSONB, summary |

## Environment Variables (all in .env, never commit)

```
# AI
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GROK_API_KEY=
DEEPSEEK_API_KEY=

# Auth
JWT_SECRET=

# Ollama
OLLAMA_HOST=http://100.66.178.118:11434
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_EMBED_MODEL=nomic-embed-text

# Discord
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
DISCORD_OWNER_USER_ID=
DISCORD_CH_* (various channel IDs)

# Database
NEON_DATABASE_URL=

# Redis
REDIS_URL=redis://localhost:6379

# Ports
GHOST_API_PORT=18790
OPENCLAW_GATEWAY_TOKEN=

# Portal
PORTAL_SECRET=
```

## Common Commands

```bash
pm2 status                  # check all 3 processes
pm2 restart ghost           # apply Ghost API code changes
pm2 restart openclaw        # apply OpenClaw config/skill changes
pm2 restart ghost-portal    # rebuild portal
pm2 restart all             # restart everything
pm2 logs ghost --lines 20   # tail Ghost API logs
pm2 logs openclaw --lines 20 # tail OpenClaw logs
redis-cli ping              # verify Redis
openclaw skills list --eligible  # list available OpenClaw skills
```

## Verification

```bash
curl http://localhost:18790/api/heartbeat     # Ghost API health
curl http://localhost:18790/api/health         # Full system health check
pm2 logs openclaw --lines 5 --nostream        # OpenClaw Discord status
```

## Notes

- OpenClaw config: `~/.openclaw/openclaw.json` — edit then `pm2 restart openclaw`
- OpenClaw skills: `~/.openclaw/workspace/skills/*/SKILL.md` — edit, no restart needed
- Ollama at 100.66.178.118:11434 (Tailscale); models: qwen2.5:14b, nomic-embed-text
- PM2 daily restart at 4am UTC for both ghost and openclaw
- Redis is gracefully optional — all helpers silently no-op if Redis is down
- `PORTAL_BYPASS` middleware allows OpenClaw skill calls and portal calls via `x-portal-secret`
- `openclaw/skills/discord.js` is a no-op stub — OpenClaw owns the Discord connection

---

## Workflow

### Autonomous Operation
- Execute tasks without asking for approval
- Fix bugs by reading logs, identifying root cause, patching, and restarting
- When blocked or something seems genuinely destructive — pause and ask once

### Verification
- After code changes: restart and check `pm2 logs ghost --lines 20 --nostream` for errors
- After OpenClaw changes: `pm2 restart openclaw && pm2 logs openclaw --lines 20 --nostream`
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
