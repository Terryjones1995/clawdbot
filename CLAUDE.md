# Ghost — Claude Code Instructions

This file is read automatically at the start of every Claude Code session.

## Project Overview

**Ghost** is a Discord-first AI agent system running on Node.js/Express (port 18789).
The bot account is **Ghost#6982**. PM2 app name is `ghost`.

## Tech Stack

- **Runtime**: Node.js, Express, PM2 (Windows service via pm2-windows-startup)
- **Discord**: discord.js, bot runs in one guild only (DISCORD_GUILD_ID)
- **Default AI**: Ollama + qwen2.5-coder:7b (local, free, always try first)
- **Real-time / web queries**: OpenAI gpt-4o-mini-search-preview (cheapest with date awareness)
- **Web / trend research**: Grok grok-4-1-fast-reasoning (via xai API)
- **Deep synthesis / escalation**: Claude Sonnet (claude-sonnet-4-6)
- **Vision (images in reception)**: OpenAI gpt-4o
- **Embed model**: nomic-embed-text (Ollama)

## Agent Names (locked in — do not rename)

| Name        | Role                          |
|-------------|-------------------------------|
| Switchboard | Router / classifier           |
| Warden      | Command & control / approvals |
| Scribe      | Ops / summaries / reminders   |
| Scout       | Research                      |
| Sentinel    | Discord connector             |
| Crow        | X / social media              |
| Forge       | Dev / architect               |
| Lens        | Analytics (PostHog)           |
| Courier     | Email (Resend)                |
| Archivist   | Memory (Pinecone)             |
| Helm        | SRE / deploy                  |

## Key Files

```
server.js                        — Express gateway entry point
src/sentinel.js                  — Discord bot (command handler + reception)
src/switchboard.js               — Intent classifier
src/scout.js                     — Research agent (multi-model routing)
src/scribe.js                    — Ops / scheduled summaries
src/heartbeat.js                 — Idle auto-shutdown tracker
openclaw/skills/discord.js       — Low-level discord.js wrapper
openclaw/skills/ollama.js        — Ollama wrapper (free-first)
ecosystem.config.js              — PM2 config
memory/run_log.md                — Append-only action audit log
logs/out.log, logs/error.log     — PM2 output logs
```

## Model Routing Rules (free-first, non-negotiable)

1. **Default**: qwen2.5-coder:7b via Ollama (free, local)
2. **Real-time data** (weather, temp, prices, news, scores): gpt-4o-mini-search-preview + inject today's date
3. **Web / trend queries**: Grok grok-4-1-fast-reasoning
4. **Deep competitive / trend synthesis**: Claude Sonnet
5. **ESCALATE flag in query**: Claude Sonnet
6. **Ollama unavailable or signals escalation**: fall back up the chain

Never route to a paid model if Ollama can handle it.

## Permissions Model

- **OWNER** — Taylor (DISCORD_OWNER_USER_ID)
- **ADMIN** — Discord role "admin"
- **AGENT** — Discord role "agent"
- **MEMBER** — everyone else

Dangerous actions (mass DM, deletes, bans, payments) require OWNER/ADMIN approval via Warden.

## Reception Channel (#🎙️・reception)

- Any message → Switchboard classifies → routes to correct agent
- Images → handled by gpt-4o vision before text routing
- Greetings → friendly reply, no agent routing
- Immediate "⏳ Please wait…" embed sent before classification begins

## Non-Negotiables

- **Never auto-commit** without explicit user request
- **Never push** to remote without explicit user request
- **Free-first**: paid API calls only when Ollama can't handle it
- **Audit log everything**: append to `memory/run_log.md`
- **Guild isolation**: bot only responds in DISCORD_GUILD_ID, ignores all other servers
- **PM2 manages the process**: use `npm run pm2:restart` to apply code changes, not direct `node` invocations

## Environment Variables (all in .env, never commit)

```
DISCORD_BOT_TOKEN
DISCORD_GUILD_ID
DISCORD_OWNER_USER_ID
DISCORD_COMMANDS_CHANNEL_ID
DISCORD_ALERTS_CHANNEL_ID
DISCORD_CH_RECEPTION
ANTHROPIC_API_KEY
OPENAI_API_KEY
GROK_API_KEY
OLLAMA_MODEL=qwen2.5-coder:7b
OLLAMA_HOST=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
IDLE_SHUTDOWN_MINUTES=120
```

## Common Commands

```bash
npm run pm2:status      # check if ghost is running
npm run pm2:restart     # apply code changes
npm run pm2:logs        # tail live logs
npm run pm2:stop        # stop the bot
```

## Notes

- Ollama runs at localhost:11434; models: qwen2.5-coder:7b, nomic-embed-text
- PM2 auto-restarts on crash; daily cron restart at 4am UTC; max 450MB RAM
- Heartbeat idle-shutdown after 120min inactivity → PM2 restarts immediately
- Windows platform — use PowerShell for process kills: `powershell -Command "Stop-Process -Id X -Force"`

---

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake from recurring
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant context

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Fix failing tests without being told how

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
