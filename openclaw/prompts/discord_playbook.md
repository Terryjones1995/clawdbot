# Discord Playbook

**Used by:** Sentinel (04-discord.md)
**Purpose:** Step-by-step workflows for every Discord scenario.

---

## Inbound Command Flow

```
Discord message
    ↓
Sentinel receives + identifies user_role
    ↓
Pass to Switchboard with { source, user_role, message, context }
    ↓
Switchboard classifies intent + routes to agent
    ↓
Agent executes (or queues for Warden)
    ↓
Sentinel delivers response back to Discord
```

---

## Workflow 1: OWNER Command

1. OWNER sends a message in `#commands`.
2. Sentinel passes to Switchboard with `user_role: OWNER`.
3. Switchboard routes to appropriate agent.
4. Agent executes without approval gate.
5. Sentinel posts result back to `#commands` or via DM per OWNER preference.
6. Log: `[INFO] agent=Sentinel | action=inbound-command | user_role=OWNER`

---

## Workflow 2: Approval Request (Warden queue)

1. Warden queues an action that needs OWNER review.
2. Sentinel DMs OWNER: "⚠️ Approval needed: [action summary]. Reply `approve [id]` or `deny [id]`."
3. OWNER replies in DM.
4. Sentinel passes reply to Warden.
5. Warden releases or blocks the action.
6. Sentinel notifies the requesting agent of the decision.
7. Log: `[APPROVE/DENY]`

---

## Workflow 3: Support Ticket

1. User posts in `#support`.
2. Sentinel classifies: Tier-1 (FAQ/simple) or Tier-2 (complex/needs OWNER).
3. **Tier-1:** Sentinel responds directly using stored knowledge from Archivist.
4. **Tier-2:** Sentinel posts "I'll escalate this to the team" and DMs OWNER with full context.
5. Log all interactions.

---

## Workflow 4: Moderation

1. Sentinel detects rule violation (flagged word, spam, raid pattern).
2. For warn/mute (< 24h): Sentinel acts autonomously.
3. For kick/ban: Sentinel submits to Warden → Warden gates → OWNER approves → Sentinel executes.
4. Log all moderation actions.

---

## Workflow 5: Alerts & Reports

1. Any agent generates an alert or report.
2. Agent passes to Sentinel with `{ target_channel, content, urgency }`.
3. **Urgent** (outage, approval, anomaly): Sentinel DMs OWNER immediately.
4. **Non-urgent** (daily summary, metrics): Sentinel posts to `#alerts` or `#logs`.

---

## Message Tone Guidelines

- Be concise. Max 3 sentences for automated replies.
- Never be sarcastic or dismissive.
- For errors, always include: what happened, what's being done, what OWNER should do if anything.
- Use Discord formatting: `code blocks` for commands, **bold** for key info.

---

## Rate Limits

- Max 10 automated messages per minute per channel.
- Max 1 DM per minute to any single user.
- If rate limit hit: queue and retry after 60 seconds.
