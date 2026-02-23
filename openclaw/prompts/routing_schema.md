# Routing Schema

**Used by:** Switchboard (00-router.md)
**Purpose:** Maps incoming message intent to the correct agent.

---

## Intent Label Format

`{domain}/{action}`

Examples: `dev/bug-fix`, `discord/moderate`, `social/draft-tweet`

---

## Full Intent Table

### Control & Approvals → Warden
| Intent | Example Trigger |
|---|---|
| `control/approve` | "approve the pending tweet" |
| `control/deny` | "deny that request" |
| `control/permissions` | "give @user admin role" |
| `control/queue-review` | "show me pending approvals" |

### Ops → Scribe
| Intent | Example Trigger |
|---|---|
| `ops/daily-summary` | "give me today's summary" |
| `ops/reminder-set` | "remind me at 3pm to check logs" |
| `ops/status-report` | "what's the system status?" |
| `ops/archive` | "archive last week's logs" |

### Research → Scout
| Intent | Example Trigger |
|---|---|
| `research/web` | "search for best Discord bot libraries" |
| `research/trend` | "what's trending in AI today?" |
| `research/competitive` | "research our competitors" |
| `research/factual` | "what is the Pinecone rate limit?" |

### Discord → Sentinel
| Intent | Example Trigger |
|---|---|
| `discord/send-message` | "post in #announcements: ..." |
| `discord/moderate` | "mute @user for 1 hour" |
| `discord/support` | "respond to the support ticket" |
| `discord/alert` | "alert me when server goes down" |

### Social / X → Crow (Warden gate)
| Intent | Example Trigger |
|---|---|
| `social/draft-tweet` | "draft a tweet about our launch" |
| `social/post-tweet` | "post the approved tweet" |
| `social/retweet` | "retweet @handle's post" |
| `social/dm` | "DM @user about the collab" |
| `social/schedule` | "schedule a tweet for tomorrow 10am" |

### Dev → Forge
| Intent | Example Trigger |
|---|---|
| `dev/bug-fix` | "fix the login error in server.js" |
| `dev/feature` | "add a /prompts route" |
| `dev/review` | "review this PR" |
| `dev/architecture` | "design the agent memory system" |
| `dev/refactor` | "refactor the auth middleware" |

### Analytics → Lens
| Intent | Example Trigger |
|---|---|
| `analytics/query` | "how many commands yesterday?" |
| `analytics/report` | "weekly analytics report" |
| `analytics/alert-setup` | "alert me if DAU drops 20%" |

### Email → Courier (Warden gate for bulk)
| Intent | Example Trigger |
|---|---|
| `email/transactional` | "send me the error report email" |
| `email/campaign-draft` | "draft a launch email campaign" |
| `email/campaign-send` | "send the approved campaign" |

### Memory → Archivist
| Intent | Example Trigger |
|---|---|
| `memory/store` | "remember that we use Neon for DB" |
| `memory/retrieve` | "recall what we decided about auth" |
| `memory/purge` | "delete old research from memory" |

### SRE → Helm (Warden gate for prod)
| Intent | Example Trigger |
|---|---|
| `sre/health-check` | "is the server up?" |
| `sre/deploy` | "deploy the latest build to production" |
| `sre/restart` | "restart the gateway container" |
| `sre/logs` | "show me the last 100 server logs" |

---

## Classification Rules

1. If the message matches multiple intents, pick the most specific one.
2. If confidence < 80%, route to Warden with `requires_review: true`.
3. Any intent involving a Dangerous Action → Warden gate regardless of domain.
4. Unknown intents → ask OWNER for clarification; do not guess.
