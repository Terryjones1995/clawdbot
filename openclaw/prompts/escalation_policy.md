# Escalation Policy

**Used by:** All agents
**Purpose:** Defines when and how to escalate from free (qwen3-coder) to paid models.

---

## Escalation Ladder

```
qwen3-coder (Ollama)  →  Claude Sonnet 4.6  →  Claude Opus 4.6
     FREE                   PAID (low)             PAID (high)
```

OpenAI is a lateral alternative, not a ladder step. Use only for specific tasks (see below).

---

## When to Escalate to Claude Sonnet

Escalate from qwen3-coder to Sonnet when ANY of the following apply:

| # | Trigger | Notes |
|---|---|---|
| 1 | Security-sensitive code | Auth, encryption, secrets, API key handling |
| 2 | Multi-file architectural change | 3+ files with interdependencies |
| 3 | Ambiguous requirements | Cannot clarify with < 2 follow-up questions |
| 4 | High-impact communications | Public posts, legal-adjacent, apologies |
| 5 | Production-affecting actions | Deployments, infra changes |
| 6 | Output quality matters critically | Customer-facing copy, strategic docs |
| 7 | qwen3-coder failed twice | Same task, two failed attempts |

---

## When to Escalate to Claude Opus

Escalate from Sonnet to Opus when ANY of the following apply:

| # | Trigger | Notes |
|---|---|---|
| 1 | Full system design from scratch | Novel architecture, no prior context |
| 2 | Hard debugging (5+ files, unclear root cause) | Sonnet already attempted and failed |
| 3 | Complex financial/legal reasoning | High-stakes decisions |
| 4 | OWNER flags `ESCALATE:HARD` | Explicit override |

---

## When to Use OpenAI (lateral)

- Specific automation tasks where OpenAI tooling is pre-built and faster
- OWNER explicitly requests OpenAI for a task
- Comparing outputs between models for quality assurance

---

## Escalation Process

1. Agent identifies escalation trigger.
2. Agent logs escalation reason to `memory/run_log.md` with field `escalated: true`.
3. Agent re-runs the task with the escalated model.
4. If Opus also fails or is insufficient, surface to OWNER.

---

## Cost Enforcement

- Escalation is not automatic — the trigger must be logged and justified.
- Never escalate "just to be safe" — this wastes budget.
- OWNER can override escalation policy with `ESCALATE` or `NO-ESCALATE` flags.
- When paid budget is exhausted, alert OWNER and fall back to the cheaper tier.

---

## Escalation Log Format

```
[ESCALATE] 2026-02-23T14:22:00Z | agent=Forge | from=qwen3-coder | to=claude-sonnet-4-6 | trigger="security-sensitive auth code" | task="implement JWT refresh token"
```
