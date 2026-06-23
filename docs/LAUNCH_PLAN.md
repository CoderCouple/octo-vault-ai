# OctoVault launch plan

Target: **Tue 2026-06-30, 07:30 PT** (Show HN). Pushed back by one
week from the previously scheduled Jun 23. PH submission + Typefully
X-thread need to be re-scheduled in their respective tools.

Last updated: 2026-06-22 (T-8) — Phase 0 fully done. The extra week
gives more room for soft-launch derisking + notarization. Watch out
for the Jul 4 US holiday window: anything posted Thu Jul 2 - Mon Jul 6
hits checked-out audiences. Reddit cadence below is shaped around it.

Companion: `docs/LAUNCH_COPY.md` — every public-facing post in
posting order, ready to ctrl-V on launch day.

---

## Phase 0 — Pre-flight (complete as of 2026-06-15)

**Goal: every asset is real before you talk to anyone.**

### Product

- [x] Hero prerender (vite-prerender-plugin) — shipped
- [x] First-run flow on a clean Mac — QA'd by user (time-to-first-answer < 90s)
- [x] Ollama not installed flow with eager probe + Install CTA — shipped
- [x] In-app `ollama pull` with progress bar — shipped
- [x] DMG download tracking → PostHog (`download_mac_clicked`) — already wired
- [x] Telemetry reassurance panel in Settings — shipped (`3dfc187`). No toggle: verified nothing in product runtime sends telemetry. Panel is the privacy-story receipt
- [x] Chat history moved to SQLCipher (was plaintext in localStorage — launch blocker) — shipped
- [x] Ollama URL false-positive — re-tested by user, wrong port now reports "Not reachable"

### Assets (user-side)

- [x] 60-sec hero video — captured (cold cursor → drop 3 docs → passport-expiry query → cited answer → graph). 1080p MP4 + WEBM, first 8s loop as OG video
- [x] 20-sec form-fill teaser — Canada visitor visa demo
- [x] Network-tab "0 outbound calls" screenshot — the privacy-claim receipt
- [x] OG image — shipped
- [x] 3 retina screenshots — graph view, chat with citations, conflict resolution (2880×1800 PNG)
- [x] Chrome Web Store — submitted

### Copy (in `docs/LAUNCH_COPY.md`)

- [x] Show HN title + body + canned replies
- [x] Product Hunt tagline + maker comment
- [x] X launch thread (8 tweets)
- [x] LinkedIn post
- [x] Reddit drafts × 5 (macapps, LocalLLaMA, selfhosted, Obsidian, immigration)
- [x] Day-of reply templates
- [x] Newsletter outreach template

### Inbound infra

- [x] Bug-report endpoint — `bug_reports` table + `bug-screenshots` bucket both live on prod via migrations `20260615180000_create_bug_reports.sql` and `20260615200000_create_bug_screenshots_bucket.sql`. Anon GET + anon upload + public read all verified 200
- [x] support@octovault.ai forwarding — Namecheap rule live, phone-test email confirmed delivery
- [x] PostHog funnel events audited — landing-side only by design (no desktop telemetry, per the privacy panel). Measurable funnel: landing visit → `download_mac_clicked` → GitHub release counter → `pricing_cta_clicked` → `waitlist_signup_completed` → `bug_report_submitted`. Nav + footer GitHub clicks now named events
- [x] Pro waitlist CTAs — `cta-pricing-reserve-{pro,lifetime}` tracked + tier intent carried via sessionStorage into `waitlist_signup_completed` event and the Supabase `source` column. Day-one query: `select source, count(*) from waitlist group by source`

---

## Pre-launch prerequisites (Mon Jun 22 → Mon Jun 29)

Launch is Tue Jun 30 07:30 PT. Items below are the remaining gate.
Order is by cost-of-miss, not by date:

- [ ] **Notarize the DMG from the non-MDM Mac.** The eBay-managed dev
      Mac will intercept Apple's stapler — must be done from a
      non-managed machine. Allow ~30-60 min including Apple's notary
      queue. **Do this first; everything else can fail and the day
      survives, but a non-notarized DMG = Gatekeeper warnings = the
      privacy story dies in the comments.**
- [ ] **Final QA on a clean Mac.** Fresh user account or VM. DMG opens
      without Gatekeeper drama; Ollama install flow works end-to-end;
      sample passport + I-797 produce correct facts; the 5 demo
      questions in `LAUNCH_COPY.md` return cited answers.
- [x] **support@octovault.ai forwarding rule** in Namecheap — added
      + verified with a phone test email. Inbox confirmed delivery.
- [x] **`bug-screenshots` storage bucket** created via migration
      `20260615200000_create_bug_screenshots_bucket.sql` and verified
      end-to-end: anon upload → 200, public read → 200. Cleanup: a
      `smoke-*.png` test file is sitting in the bucket — delete from
      the Supabase dashboard if you want it gone.

**Risk acknowledged (T-1 compression):** soft launch is skipped *and*
the launch window moved forward 14 days. The first strangers to
install are launch-day visitors with no prior QA on the public DMG.
Mitigations:
1. The clean-Mac QA pass must be *thorough*, not fast. Burn an hour
   on it tonight; don't rationalize "it worked on the dev Mac".
2. PostHog is the early-warning system. Watch
   `download_mac_clicked` → GitHub release counter hourly. If
   install rate is <10% of clicks during the first hour, something
   is wrong with the DMG — pause the r/macapps post.
3. Have a kill-switch ready: if the bug-report inbox lights up with
   the same crash signature in the first 2 hours, pull the Show HN
   link from social and let the HN thread die naturally rather than
   amplifying. A failed launch you can re-do; a humiliated one is
   harder.

---

## Phase 2 — Launch day (Tue Jun 30)

Order matters. HN first, everything else feeds it.

| Time (PT) | Surface | Notes |
|---|---|---|
| 07:30 | Show HN | Title fixed; body is from docs/LAUNCH_COPY.md |
| 07:45 | Product Hunt | Maker comment goes live (scheduled in night-before batch) |
| 08:00 | X thread | 8 tweets, video in T1 |
| 09:00 | LinkedIn | Different audience, personal tone |
| 10:00 | r/macapps | Mac craft angle · your account |
| 16:00 | X | End-of-day recap with day-one numbers |

**Reddit cadence (staggered, not blasted):** 5 promo posts in one day
from a single account is Reddit's textbook spam signature. Spreading
over 7+ days, splitting across accounts, and starting with the lowest-
risk subs keeps the launch out of the shadowban tarpit.

| Date | Sub | Posted from | Why this slot |
|---|---|---|---|
| Tue Jun 30 (launch day) | r/macapps | your account | Lowest risk, highest Mac-audience relevance |
| Wed Jul 1 | r/LocalLLaMA | your account | Technical-build framing; LocalLLaMA tolerates self-promo if substance is there |
| Mon Jul 6 | r/selfhosted | Payal's account | Skip Jul 4 weekend — tech audience is checked out Thu Jul 2 - Mon Jul 6 morning |
| Wed Jul 8 | r/Obsidian | Payal's account | New-account filter is harsh; ask-a-question framing helps |
| Fri Jul 10 | r/immigration | aged account; ModMail first | Strictest of the five; mod-DM before posting (template below) |

**ModMail template for r/immigration (send Mon Jul 6, post Fri Jul 10):**
> Hi mods — I built a free Mac tool that helps immigrants keep visa /
> I-797 / DS-160 docs queryable offline. Would a post about it be a
> fit for the sub, or against rules? Happy to follow whatever
> guidelines you set; would rather ask first than have it removed.

Reply window:
- HN: every comment within 15 min for first 4h
- PH: every comment within 30 min
- Reddit: reply within 30 min on the first 5 comments of each post —
  early-engagement drives algorithmic visibility hard
- PostHog dashboard hourly. Tweet/DM something to address the drop-off step
- **Shadowban check:** open each Reddit post in incognito 30 min after
  posting; if you see it = fine, if you see "deleted" = shadowbanned

---

## Phase 3 — Sustain (Wed Jul 1 → Tue Jul 14)

- **Wed Jul 1** — Email everyone on the Pro waitlist. One question: *"What did you try to ask first?"* Their answers are the roadmap
- **Mon Jul 6** — Newsletter outreach: Ben's Bites, TLDR AI, Console.dev, Indie Hackers, Recommendo. Personal email each. Skipped Thu Jul 2 - Fri Jul 3 because everyone's checked out for Jul 4 weekend
- **Mon Jul 6** — Second-wave Reddit (Obsidian, privacy, digitalnomad). Write the "How OctoVault works under the hood" technical blog post (long-tail SEO for "local AI personal documents")
- **Wed Jul 8** — Repeat-Show-HN: *"OctoVault one week later: 2,000 downloads"* — only if numbers support it. Data, not promo
- **Fri Jul 10** — Ship the first user-requested feature visibly. Show the loop is tight
- **Tue Jul 14** — Internal retro: conversion funnel, top friction, top requested feature, top objection. Decide whether form-fill ships in 2 weeks or 4

---

## Numbers to watch

| Metric | Day 1 | Week 1 | Week 2 |
|---|---|---|---|
| Landing visits | 5k | 15k | 25k |
| DMG downloads | 400 | 1.2k | 2k |
| First-answer events | 120 | 400 | 700 |
| Pro waitlist | 50 | 200 | 350 |
| HN comments | 80+ | — | — |

If HN comments < 30 by 2pm PT, the title is wrong and can't be edited — focus the rest of the day on PH + X.

---

## Risks + mitigations

1. **Notarization breaks on a fresh Mac** → catch in tonight's clean-Mac QA pass
2. **Ollama install friction kills first-run** → ✅ in-app installer flow shipped. Re-test on clean Mac tonight
3. **HN flames the form-fill as creepy** → "coming soon, opt-in, the graph is the product" canned response in `docs/LAUNCH_COPY.md`
4. **Someone finds an outbound call** → ✅ chat-history fix removed the biggest one. Re-run Little Snitch + ingest 10 docs tonight
5. **Dev Mac is MDM'd** → notarize from non-managed Mac TODAY (the eBay-managed Mac blocks Apple's stapler)
6. **T-1 compression — no soft-launch derisking** → see "Pre-launch prerequisites" mitigations. Kill-switch on the Show HN post if same-signature bug reports stack up in first 2h

---

## Day-of checklist (Mon Jun 29 evening + Tue Jun 30 morning)

**Mon Jun 29 evening:**
- [ ] DMG signed + notarized + stapled, downloadable, SHA in the release notes
- [ ] Clean-Mac QA pass complete; 5 demo questions return cited answers
- [x] Landing prerendered, OG unfurl verified against 7 scrapers (Twitter / Slack / Facebook / LinkedIn / Discord / WhatsApp / Safari) — all see identical og:image, og:title, og:description; og-image.png returns 200, real pixels 1200×630 match declared
- [ ] PostHog firing on `download_mac_clicked`, `pricing_cta_clicked`, `waitlist_signup_completed`, `bug_report_submitted` — verify in PostHog Live Events after the cold-incognito test
- [x] Bug-report endpoint smoke-curl returns 200 (re-verified T-1 evening)
- [x] `bug-screenshots` storage bucket exists in Supabase (anon upload + public read both 200)
- [ ] 60s video on landing page, on YouTube (for embeds), as MP4 attached to PH
- [ ] HN draft pasted into a notes app, ready to ctrl-V
- [x] PH submission scheduled for Tue Jun 16 00:01 PT
- [ ] X thread drafted in TweetDeck / Typefully, scheduled
- [ ] LinkedIn drafted
- [ ] 5 Reddit drafts ready, mod rules re-read for each sub
- [ ] Calendar blocked 07:00–17:00 PT Tue — no meetings, just replies
- [x] support@octovault.ai forwarder verified (no DNS change needed; MX already live)

**Tue Jun 30 morning, before 07:30 PT:**
- [ ] Open the HN draft, PH page, X scheduler, LinkedIn, 4 Reddit tabs
- [ ] Open Supabase → waitlist + bug_reports tables
- [ ] Open PostHog → realtime events dashboard
- [ ] Open the landing site in incognito; do one cold download yourself to verify the funnel fires

---

## Next engineering blockers

All shipped — Phase 0 engineering items are done. Remaining work is
operational: notarize, clean-Mac QA, scheduling, dashboard checks.

Post-launch backlog (don't start before Jun 16):
- **Phase E2 vision fallback** for form detection — non-blocking; queue for the Fri Jul 10 "first user-requested feature" slot if it matches feedback

User-side items still pending (T-1 evening):
- [ ] Notarize DMG from non-MDM Mac
- [ ] Clean-Mac QA pass
- [ ] X thread scheduled in Typefully
- [ ] LinkedIn drafted + scheduled
- [ ] 5 Reddit tabs bookmarked with drafts pasted
