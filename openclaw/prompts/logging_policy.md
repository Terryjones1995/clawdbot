# Logging Policy

**Used by:** All agents
**Purpose:** Defines what to log, when to log it, and the exact format.

---

## Principles

1. **Append-only.** No log entry is ever edited or deleted.
2. **Timestamped.** Every entry uses ISO 8601 UTC.
3. **Agent-attributed.** Every entry names the agent that took the action.
4. **Outcome-recorded.** Every entry records success, failure, or pending.

---

## Log File

All entries go to: `memory/run_log.md`

---

## What to Log (mandatory)

| Event | Log? |
|---|---|
| Any agent receiving a task | Yes |
| Routing decision by Switchboard | Yes |
| Escalation (model change) | Yes |
| Warden approval or denial | Yes |
| External action taken (post, send, deploy) | Yes |
| External action attempted but blocked | Yes |
| Error or failure | Yes |
| Dangerous action (any outcome) | Yes |
| Memory store/retrieve | Metadata only |

## What NOT to Log

- Full content of private DMs (log metadata only)
- Raw passwords or secrets
- Full email body of personal correspondence (log subject + recipient only)
- PII beyond what's necessary for audit purposes

---

## Log Entry Format

```
[LEVEL] TIMESTAMP | agent=NAME | action=ACTION | user_role=ROLE | model=MODEL | outcome=OUTCOME | escalated=BOOL | note="optional context"
```

### Level values
- `INFO` — routine action, no issue
- `WARN` — action succeeded but something notable occurred
- `ERROR` — action failed
- `BLOCK` — action was blocked (by Warden or policy)
- `ESCALATE` — model escalation occurred
- `APPROVE` — Warden approved an action
- `DENY` — Warden denied an action

---

## Examples

```
[INFO]    2026-02-23T09:00:00Z | agent=Switchboard | action=route | user_role=OWNER | model=qwen3-coder | outcome=success | escalated=false | note="routed to Forge: dev/bug-fix"
[ESCALATE] 2026-02-23T10:15:00Z | agent=Forge | action=code-review | user_role=OWNER | model=claude-sonnet-4-6 | outcome=success | escalated=true | note="security-sensitive auth code"
[BLOCK]   2026-02-23T11:30:00Z | agent=Warden | action=bulk-dm | user_role=ADMIN | model=qwen3-coder | outcome=blocked | escalated=false | note="bulk DM requires OWNER approval"
[APPROVE] 2026-02-23T12:00:00Z | agent=Warden | action=post-tweet | user_role=OWNER | model=qwen3-coder | outcome=approved | escalated=false | note="OWNER approved tweet draft"
[ERROR]   2026-02-23T14:45:00Z | agent=Helm | action=deploy | user_role=OWNER | model=qwen3-coder | outcome=failed | escalated=false | note="Docker build failed: missing env var"
```

---

## Log Rotation

- `run_log.md` is never truncated.
- Scribe archives a weekly summary snapshot to Archivist (Pinecone) every Monday.
- The raw `run_log.md` file is retained permanently.
