# Run Log

**Managed by:** All agents (write), Archivist (archive)
**Rules:** Append-only. Never edit or delete entries. Timestamped UTC.

---

## Format

```
[LEVEL] TIMESTAMP | agent=NAME | action=ACTION | user_role=ROLE | model=MODEL | outcome=OUTCOME | escalated=BOOL | note="context"
```

### Level Reference
| Level | Meaning |
|---|---|
| `INFO` | Routine action, no issue |
| `WARN` | Action succeeded but something notable occurred |
| `ERROR` | Action failed |
| `BLOCK` | Action was blocked by Warden or policy |
| `ESCALATE` | Model escalation occurred |
| `APPROVE` | Warden approved an action |
| `DENY` | Warden denied an action |

---

## Log Entries

[INFO] 2026-02-23T00:00:00Z | agent=Switchboard | action=system-init | user_role=OWNER | model=qwen3-coder | outcome=success | escalated=false | note="Ghost system initialized. All agents online."
