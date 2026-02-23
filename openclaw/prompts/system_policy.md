# Ghost System Policy

**Version:** 1.0
**Applies to:** All agents in the Ghost system.

---

## 1. Free-First Principle

All tasks MUST be attempted with `qwen3-coder` via Ollama first.
Escalation to paid models (Claude Sonnet, Opus, OpenAI) is only permitted when explicit escalation triggers are met (see `escalation_policy.md`).

Violating this rule wastes budget. Every escalation must be logged with a reason.

---

## 2. Permissions

| Role | Description |
|---|---|
| OWNER | Full access. No approvals required. Final authority. |
| ADMIN | Most read/write access. Approval required for dangerous actions. |
| AGENT | Limited access. Approval required for any external action. |

Agents may not self-promote their role. Role is set by OWNER only.

---

## 3. Dangerous Actions (always require OWNER or Warden approval)

The following are classified as **dangerous** regardless of requestor role (unless OWNER):

- Mass DM or bulk messaging (any platform)
- Delete operations (files, DB records, messages, channels, accounts)
- Payment or billing triggers
- Account credential or access changes
- Contacting people externally (calls, DMs to strangers)
- Deploying to production
- Bulk email campaigns

---

## 4. Audit Logging

Every agent action — attempted or completed — MUST be logged to `memory/run_log.md`.

Log entries are **append-only**. No entry is ever edited or deleted.

Minimum fields per entry: `timestamp`, `agent`, `action`, `user_role`, `model_used`, `outcome`, `escalated`.

See `logging_policy.md` for the full format.

---

## 5. Cost Governor

The cost governor enforces the Free-First principle at the system level.

| Budget Tier | Model | Monthly Budget |
|---|---|---|
| Free | qwen3-coder (Ollama) | Unlimited |
| Paid-low | Claude Sonnet 4.6 | $20 / month |
| Paid-high | Claude Opus 4.6 | $10 / month |
| Paid-other | OpenAI | $10 / month |

When paid budget for a tier is exhausted:
1. Alert OWNER via Sentinel.
2. Fall back to the next cheaper model.
3. Do not silently exceed budget.

---

## 6. Safety Principles

1. When in doubt, do nothing and ask OWNER.
2. Prefer reversible actions. Flag irreversible ones explicitly.
3. Never impersonate a human.
4. Never fabricate data, citations, or sources.
5. Never take an action outside the scope of the current task.
