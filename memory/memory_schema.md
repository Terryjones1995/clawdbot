# Memory Schema

**Managed by:** Archivist (09-memory.md)
**Purpose:** Defines what gets stored, how it's tagged, where it lives, and how long it's kept.

---

## Storage Tiers

| Tier | System | Use Case | Retention |
|---|---|---|---|
| Hot | Redis | Active session state, last 24h context | 24 hours (auto-expire) |
| Warm | Pinecone | Agent outputs, research, decisions, conversations | 90 days (default) |
| Cold | `memory/` flat files | Audit logs, schemas, approval records | Permanent |

---

## Record Types

### `research`
Findings from Scout (web search, trend analysis, competitive intel).
```json
{
  "type": "research",
  "query": "original search query",
  "summary": "synthesized findings",
  "sources": ["url1", "url2"],
  "tags": ["discord", "bot-frameworks"],
  "ttl_days": 30
}
```

### `decision`
Architectural, product, or operational decisions made by OWNER or agents.
```json
{
  "type": "decision",
  "title": "Use Neon for primary database",
  "rationale": "...",
  "decided_by": "OWNER",
  "tags": ["architecture", "database"],
  "ttl_days": 365
}
```

### `agent_output`
Notable outputs from any agent (reports, drafts, plans).
```json
{
  "type": "agent_output",
  "agent": "Forge",
  "task": "design auth system",
  "summary": "...",
  "tags": ["auth", "dev"],
  "ttl_days": 90
}
```

### `conversation`
Key conversation context between OWNER and the system.
```json
{
  "type": "conversation",
  "source": "discord",
  "summary": "OWNER requested weekly analytics reports every Monday",
  "tags": ["preference", "schedule"],
  "ttl_days": 365
}
```

### `approval`
Records of approval queue items (see `approvals.md`).
- Stored permanently in `memory/approvals.md`.
- Metadata also stored in Pinecone for search.

---

## Required Tags

Every record must include at least one tag from each category:

| Category | Options |
|---|---|
| Agent | `switchboard`, `warden`, `scribe`, `scout`, `sentinel`, `crow`, `forge`, `lens`, `courier`, `archivist`, `helm` |
| Domain | `discord`, `social`, `dev`, `analytics`, `email`, `sre`, `research`, `ops`, `memory` |
| Sensitivity | `public`, `internal`, `sensitive` |

---

## Retention Rules

| TTL | Applied to |
|---|---|
| 24 hours | Hot/Redis session data |
| 30 days | Research results (default) |
| 90 days | Agent outputs, conversation context |
| 365 days | Decisions, preferences |
| Permanent | Approval records, audit logs |

Archivist runs a daily purge of expired Pinecone entries at 03:00 UTC.

---

## PII Policy

- Never store full names, email addresses, phone numbers, or account credentials in Pinecone.
- Anonymize or hash PII before warm/cold storage unless OWNER explicitly permits.
- Redis hot cache may hold session-scoped PII but auto-expires in 24h.
