# User reporting — overview for product & business

This document explains **how user reporting works** on the platform, in plain language. Technical API details for engineers live in [for-frontend/FRONTEND_INTEGRATION.md](for-frontend/FRONTEND_INTEGRATION.md) (Report User section).

---

## What “reporting” means here

When someone taps **Report**, they choose **exactly one** reason:

| Reason | Effect |
|--------|--------|
| **Basic** | Adds weighted points to the user’s **report score** (with consecutive-call stacking). |
| **Violence or Self-Harm** | Enters **critical review** (disguised-moderator pool). **No score change.** |
| **Child Abuse** | Same as critical review. **No score change.** |

Reporting is always about the **user account**. Critical and scored pipelines are separate; critical does not add points.

---

## Basic reports: weights + exponential streak

Role/context still sets a **base weight** (`REPORT_WEIGHT_*`), e.g. participant 5, host 10.

**Consecutive streak** (per reported user, any reporters):

- If the previous match ended with **any** report (basic or critical), the next **basic** report applies **2 × last applied basic points** (e.g. 5 → 10 → 20).
- If a match completes **without** a report, the streak resets and scoring returns to base weight.
- Critical reports add **0** points but **do** keep the streak alive.

---

## Critical review (disguised moderators)

When reported for Violence/Self-Harm or Child Abuse:

1. User is flagged `criticalReviewActive`.
2. Matching becomes **100% moderators marked “show as user”** (personal-looking cards, no mod branding).
3. The product app still looks like a normal call — **no in-app mod tools**.
4. Moderators act from **beam-dashboard**: adjust score, ban/unban, release from critical pool, raincheck (pass) leaves them in the pool for another mod.
5. On **release**, score is unchanged unless staff also set it; user returns to normal discovery at their existing score tier.
6. If no disguised mods are online → empty / keep searching (“no one left”).

“Show as user” mods **only** match critically flagged users (not the normal pool).

---

## Score tiers → moderator mix → auto-ban

Below the ban line, discovery uses **report layers** (`DISCOVERY_REPORT_LAYER_*`) and **mod mix ratios**:

| Tier | Default mix (env) | Who appears as “mods” |
|------|-------------------|------------------------|
| T1 | 30% mods / 70% users (`DISCOVERY_REPORT_MIX_L1`) | Show-as-moderator face cards |
| T2 | 60% / 40% (`DISCOVERY_REPORT_MIX_L2`) | Same |
| T3 | 95% / 5% (`DISCOVERY_REPORT_MIX_L3`) | Same |

- Red circle UI stays as today (`reportLayer >= 2`).
- If the rolled mod/user bucket cannot be filled → **empty search** (no backfill).
- At **`REPORT_THRESHOLD`** (ban line): auto **temp ban** + force logout; after lockout (`REPORT_BAN_LOGIN_BLOCK_DAYS`, default 7) user may log in but stays in **100% show-as-moderator** pool until dashboard **unban** (optional new score).

Critical pool **overrides** score mix while active.

---

## Bans

| Kind | Login | After lockout | Unban |
|------|-------|---------------|-------|
| **Temp** (auto or dashboard) | Blocked for X days | Show-as-moderator pool until staff unban | Dashboard |
| **Perma** | Always blocked | N/A | Dashboard only |

Login copy: **“You are banned currently. Contact mods@antiscroll.in for support.”**  
Ban immediately deletes sessions and emits realtime `account-banned` (discovery + streaming).

---

## Moderator visibility (dashboard)

| Toggle | Meaning |
|--------|---------|
| **Show as moderator** (`moderatorFaceCardActive` on) | Shared mod persona; used in score-tier mix + post-ban pool |
| **Show as user** (off) | Normal appearance; critical/disguised pool only |

Both keep full mod powers via **beam-dashboard** (ban, unban, score, critical release).

---

## Admin surface (beam-dashboard)

- Temp / perma ban
- Unban (+ optional set report score)
- Set / add report score
- Release from critical review
- Toggle isModerator + show-as-moderator vs show-as-user
- Status fields: critical flag, post-ban pool, lockout until, permanent ban

---

## Config knobs (high level)

| Env | Role |
|-----|------|
| `REPORT_WEIGHT_*` | Base points by context |
| `REPORT_THRESHOLD` | Auto-ban line |
| `DISCOVERY_REPORT_LAYER_1/2/3` | UI / mix tier cutoffs |
| `DISCOVERY_REPORT_MIX_L1/L2/L3` | Mod ratios (default 0.3 / 0.6 / 0.95) |
| `REPORT_BAN_LOGIN_BLOCK_DAYS` | Temp ban lockout (default 7) |
| `BAN_SUPPORT_EMAIL` | Banned login support email (default `mods@antiscroll.in`) |

---

## What this is *not*

- Not an in-app moderator control panel during calls (calls stay normal-looking).
- Not a case/ticket system with evidence upload in this path.
- Not “N unique reporters required” — no quorum rule today.
