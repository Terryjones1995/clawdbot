# Social Playbook (X / Twitter)

**Used by:** Crow (05-social-x.md)
**Purpose:** Step-by-step workflows for X/Twitter activity, compliance rules, and anti-spam guardrails.

---

## Post Workflow

```
OWNER requests tweet
    ↓
Crow drafts content
    ↓
Crow submits to Warden (requires_approval: true)
    ↓
Sentinel DMs OWNER: "Review tweet draft: [text]. Reply approve/deny."
    ↓
OWNER approves
    ↓
Warden releases to Crow
    ↓
Crow posts to X via API
    ↓
Crow logs result + notifies OWNER of post URL
```

---

## Workflow 1: Single Tweet

1. OWNER: "draft a tweet about [topic]"
2. Crow drafts (qwen3-coder unless escalation trigger met).
3. Crow submits draft to Warden with `action: post-tweet`.
4. Sentinel notifies OWNER of pending approval.
5. On approval: Crow posts. On denial: Crow archives draft.
6. Log: `[APPROVE/INFO] agent=Crow | action=post-tweet`

---

## Workflow 2: Thread

1. OWNER: "write a thread about [topic], [n] tweets"
2. Crow drafts full thread as an array.
3. Entire thread submitted as one approval request.
4. On approval: Crow posts sequentially with 2-second delay between tweets.
5. Log each tweet as a separate entry.

---

## Workflow 3: Scheduled Post

1. OWNER: "schedule a tweet for [date/time]: [content]"
2. Same draft → Warden → approval workflow.
3. On approval: Crow stores to schedule queue with `schedule_at` timestamp.
4. Crow fires at scheduled time.

---

## Workflow 4: Reply

1. OWNER: "reply to @handle's tweet with [text]"
2. Crow drafts reply.
3. Submit to Warden.
4. On approval: Crow replies via API using `in_reply_to_tweet_id`.

---

## Workflow 5: DM

1. OWNER: "DM @handle about [topic]"
2. Crow drafts DM.
3. Submit to Warden — DMs are always gated.
4. On approval: Crow sends DM.
5. **NEVER** send unsolicited DMs to users who have not interacted first.

---

## Daily Limits

| Action | Max per day | Override |
|---|---|---|
| Tweets | 10 | OWNER explicit instruction |
| Replies | 20 | OWNER explicit instruction |
| DMs | 5 | OWNER explicit instruction |
| Follows | 10 | OWNER explicit instruction |
| Retweets | 5 | OWNER explicit instruction |

If limit is hit: queue remainder for next day, notify OWNER.

---

## Compliance Rules

1. No follow/unfollow churn (ban risk).
2. No duplicate tweet content within 7 days.
3. No posting during an active public controversy involving the account — hold all posts and alert OWNER.
4. No scraping or mass-interacting with user lists.
5. All content must comply with X Terms of Service and applicable laws.
6. Political content: OWNER must explicitly approve each post individually.

---

## Content Quality Standards

- Tweets must be under 280 characters (or threaded if longer).
- No all-caps shouting.
- No emoji spam (max 2 per tweet unless OWNER requests otherwise).
- Hashtags: max 2 per tweet.
- Always proofread for typos before submitting to Warden.
