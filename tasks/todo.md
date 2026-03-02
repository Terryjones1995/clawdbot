# Ghost — Linux Migration Plan
**Date:** 2026-02-26
**Platform:** AlmaLinux 9.7 (systemd 252, Node.js v22.22.0)
**Status:** COMPLETE

---

## Current State Analysis

### What exists
- `server.js` — Express gateway on port 18789 (OPENCLAW_PORT)
- `portal-start.js` — Next.js portal launcher (port 3001)
- `ecosystem.config.js` — PM2 config for `ghost` + `ghost-portal` apps
- `.env.example` — template for secrets (already committed, no secrets inside)
- `package.json` — npm scripts for PM2 management
- `logs/` dir — PM2 writes here; gitignored
- `memory/run_log.md` — append-only audit log

### Windows-specific issues found
| File | Issue |
|------|-------|
| `CLAUDE.md` | Line 12: "Windows service via pm2-windows-startup"; Line 121: PowerShell kill command |
| `portal-start.js` | Header comment says "Windows safe / PM2 cannot run bash shebang on Windows" |
| `CLAUDE.md` Notes | "Windows platform — use PowerShell for process kills" |

### What is NOT Windows-specific
- `ecosystem.config.js` — pure PM2 config, works on Linux as-is
- `package.json` scripts — all standard PM2 commands, work on Linux
- All `src/` agent code — no OS-specific calls
- All `openclaw/` skills — no OS-specific calls

### Environment
- PM2 is **not currently installed** (not in PATH, not in node_modules)
- Node.js v22.22.0 ✓
- systemd 252 ✓ (supports `pm2 startup systemd`)
- AlmaLinux 9.7 — SELinux may be active (check before deploying)

---

## Migration Plan

### Phase 1 — Update documentation (CLAUDE.md)
- [ ] Remove "Windows service via pm2-windows-startup" from Tech Stack section
- [ ] Replace with "Linux service via PM2 + systemd"
- [ ] Remove PowerShell kill command from Notes section
- [ ] Add Linux equivalent: `kill -9 <PID>` or `pm2 delete ghost && pm2 start ecosystem.config.js`
- [ ] Add `pm2:startup` note explaining systemd integration
- [ ] Update Ollama model reference (CLAUDE.md says qwen2.5-coder:7b but .env.example says qwen2.5:14b — align to qwen2.5:14b)

### Phase 2 — Update portal-start.js comment only
- [ ] Remove Windows-specific comment from header (the actual code is fine on Linux)
- [ ] Verify the Next.js startup logic works on Linux (no code changes needed, just comment cleanup)

### Phase 3 — Verify/update .env.example
- [ ] Confirm all required variables are present
- [ ] Add any missing vars: `DISCORD_CH_RECEPTION`, `GROK_API_KEY`, `PORTAL_SECRET`
- [ ] Note: `.env.example` already committed, good practice maintained

### Phase 4 — Linux deployment instructions
Add a new section to CLAUDE.md: **Linux Deployment (AlmaLinux 9)**

```bash
# 1. Install PM2 globally
npm install -g pm2

# 2. Install dependencies
npm install

# 3. Copy and fill .env
cp .env.example .env
# edit .env with real secrets

# 4. Start Ghost under PM2
npm run pm2:start        # starts both ghost and ghost-portal

# 5. Configure PM2 to survive reboots via systemd
pm2 startup systemd      # generates systemd unit command — run it as shown
pm2 save                 # persist current process list

# 6. Verify
npm run pm2:status
npm run pm2:logs
curl http://localhost:18789/api/heartbeat
```

### Phase 5 — Safe restart workflow (add to CLAUDE.md)
```bash
# After any code change:
npm run pm2:restart      # restarts ghost process only
# For portal changes:
npm run portal:restart   # restarts ghost-portal only
# Full restart:
pm2 restart all
# Hard reset (wipes PM2 state):
pm2 delete all && npm run pm2:start
```

### Phase 6 — Linux process kill (replace PowerShell note)
```bash
# Kill a specific PID (Linux):
kill -9 <PID>
# Or use PM2 (preferred):
pm2 stop ghost && pm2 start ecosystem.config.js
```

---

## Docker Assessment

**Verdict: PM2 is the right choice. Docker would add complexity without benefit here.**

Reasons PM2 wins:
- Ollama runs on localhost (Docker would need `--network=host` or complex networking)
- Discord bot doesn't need container isolation
- PM2 + systemd is already the target architecture
- Fewer moving parts = easier debugging

Docker would only make sense if:
- Multiple instances needed
- CI/CD pipeline deploys containers
- Full environment isolation is required

---

## Files to Change (summary)

| File | Change Type | Scope |
|------|-------------|-------|
| `CLAUDE.md` | Edit | Remove Windows refs, add Linux deployment section |
| `portal-start.js` | Edit | Comment-only — remove "Windows safe" header note |
| `.env.example` | Edit | Add missing vars (`DISCORD_CH_RECEPTION`, `GROK_API_KEY`, `PORTAL_SECRET`) |

**No changes to:**
- `ecosystem.config.js` — already Linux-compatible
- `package.json` — PM2 scripts work on Linux as-is
- Any `src/` or `openclaw/` code
- Any agent logic

---

## Verification Checklist (post-implementation)

- [ ] `CLAUDE.md` — zero Windows/PowerShell references remain
- [ ] `portal-start.js` — comment reflects Linux reality
- [ ] `.env.example` — all vars from CLAUDE.md env section are present
- [ ] `ecosystem.config.js` — no Windows paths or OS-specific options
- [ ] `package.json` pm2 scripts — confirmed correct for Linux PM2
- [ ] Deployment section in CLAUDE.md covers: install → configure → start → systemd persist → verify

---

## Review

- [x] `CLAUDE.md` — no Windows/PowerShell references remain
- [x] `CLAUDE.md` — model name aligned to `qwen2.5:14b` (matches `.env.example`)
- [x] `CLAUDE.md` — Linux Deployment section added (PM2 + systemd)
- [x] `CLAUDE.md` — Safe Restart Workflow section added
- [x] `portal-start.js` — Windows-specific header comment removed; code untouched
- [x] `.env.example` — recreated with all required vars including `DISCORD_CH_RECEPTION`, `GROK_API_KEY`, `PORTAL_SECRET`
- [x] `ecosystem.config.js` — no changes needed, already Linux-compatible
- [x] `package.json` — no changes needed, PM2 scripts work on Linux as-is
