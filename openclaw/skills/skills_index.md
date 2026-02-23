# Skills Index

**Managed by:** Forge (dev) + OWNER
**Purpose:** Tracks what skills/tools exist now vs. planned for later.

---

## Status Key

| Status | Meaning |
|---|---|
| ✅ Active | Built and operational |
| 🔧 In Progress | Being built |
| 📋 Planned | Designed, not yet built |
| ❌ Blocked | Waiting on dependency |

---

## Current Skills

| Skill | Agent | Status | Description |
|---|---|---|---|
| Web login / auth | All (gateway) | ✅ Active | Express JWT login system |
| Agent management UI | Forge / All | ✅ Active | CRUD UI for agent config at /agents |
| Routing (intent classification) | Switchboard | 📋 Planned | LLM-based intent classifier |
| Approval queue | Warden | 📋 Planned | Queue + Discord notify for approvals |
| Discord connector | Sentinel | 📋 Planned | discord.js bot integration |
| X/Twitter connector | Crow | 📋 Planned | X API v2 post/DM/read |
| PostHog connector | Lens | 📋 Planned | PostHog query + alert integration |
| Resend connector | Courier | 📋 Planned | Resend email send + templates |
| Pinecone connector | Archivist | 📋 Planned | Vector store/retrieve |
| Neon (Postgres) connector | Forge / Helm | 📋 Planned | Postgres via pg or Drizzle |
| Redis connector | Archivist / Helm | 📋 Planned | Cache + queue + session |
| Ollama connector | All | 📋 Planned | Local qwen3-coder inference |
| Grok connector | Scout | 📋 Planned | Grok web/trend search API |
| Replicate connector | Forge | 📋 Planned | Open-source model execution |

---

## Skill Build Priority (MVP Order)

1. Ollama connector (unlocks free-first)
2. Discord connector (primary interface)
3. Routing/intent classification
4. Approval queue + Warden gate
5. Pinecone connector (memory)
6. Neon connector (persistence)
7. Redis connector (session/queue)
8. X/Twitter connector
9. PostHog connector
10. Resend connector

---

## Skill File Convention

Each skill lives in `openclaw/skills/` as a `.md` spec or `.js` implementation:
- `skill-name.md` — design spec, inputs, outputs, dependencies
- `skill-name.js` — runnable implementation (when built)
