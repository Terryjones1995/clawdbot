# Approval Queue

**Managed by:** Warden (01-control.md) + Archivist (09-memory.md)
**Format:** Append-only. Resolved items are marked but never deleted.

---

## Format

```
## [ID] YYYY-MM-DDTHH:MM:SSZ

- **Status:** PENDING | APPROVED | DENIED
- **Requesting Agent:** [agent name]
- **Action:** [what the agent wants to do]
- **Requestor Role:** OWNER | ADMIN | AGENT
- **Payload:** [brief description of the payload/content]
- **Reason:** [why the agent is requesting this]
- **Resolved At:** [ISO8601 or null]
- **Resolved By:** [OWNER | ADMIN or null]
- **Resolution Note:** [optional context]
```

---

## Example Entries

## [APR-0001] 2026-02-23T09:30:00Z

- **Status:** APPROVED
- **Requesting Agent:** Crow
- **Action:** post-tweet
- **Requestor Role:** ADMIN
- **Payload:** "Excited to announce our new feature dropping this week. Stay tuned. 🚀"
- **Reason:** Scheduled launch announcement
- **Resolved At:** 2026-02-23T09:35:00Z
- **Resolved By:** OWNER
- **Resolution Note:** Approved as-is.

---

## [APR-0002] 2026-02-23T11:00:00Z

- **Status:** DENIED
- **Requesting Agent:** Courier
- **Action:** send-campaign
- **Requestor Role:** ADMIN
- **Payload:** Email campaign to 500 subscribers, subject "Weekly Update"
- **Reason:** Weekly newsletter send
- **Resolved At:** 2026-02-23T11:10:00Z
- **Resolved By:** OWNER
- **Resolution Note:** Denied — content needs revision, resubmit with updated copy.

---

## [APR-0003] 2026-02-23T14:00:00Z

- **Status:** PENDING
- **Requesting Agent:** Helm
- **Action:** deploy
- **Requestor Role:** ADMIN
- **Payload:** Deploy openclaw-gateway v1.2.0 to production
- **Reason:** Bug fix release with auth improvements
- **Resolved At:** null
- **Resolved By:** null
- **Resolution Note:** null
