# OctoVault launch plan

Target: **Tue 2026-06-16, 07:30 PT** (Show HN). Tuesday is the right
HN-attention slot, and the user moved the date forward 14 days after
finishing the Phase 0 sweep early.

Last updated: 2026-06-15 (T-1) — Phase 0 product/assets/copy all done.
Launch is tomorrow. Everything in "Pre-launch prerequisites" below
must land **today**.

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

- [x] Bug-report endpoint — migration `20260615180000_create_bug_reports.sql` applied to prod on 2026-06-15 (`supabase db push --linked`); anon-key GET returns 200, table is live. Still TODO: verify the `bug-screenshots` storage bucket exists in the Supabase dashboard (Storage → buckets), since `uploadScreenshots()` writes there — without it, reports submit fine but screenshots are dropped.
- [ ] support@octovault.ai forwarding — user DNS
- [x] PostHog funnel events audited — landing-side only by design (no desktop telemetry, per the privacy panel). Measurable funnel: landing visit → `download_mac_clicked` → GitHub release counter → `pricing_cta_clicked` → `waitlist_signup_completed` → `bug_report_submitted`. Nav + footer GitHub clicks now named events
- [x] Pro waitlist CTAs — `cta-pricing-reserve-{pro,lifetime}` tracked + tier intent carried via sessionStorage into `waitlist_signup_completed` event and the Supabase `source` column. Day-one query: `select source, count(*) from waitlist group by source`

---

## Pre-launch prerequisites (must land TODAY — 2026-06-15)

Launch is tomorrow morning, 07:30 PT. These four items are the
remaining gate between "Phase 0 done" and "Show HN goes live":

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
- [ ] **support@octovault.ai DNS forwarding** wired. DNS can take 1-4h
      to propagate — do it now. If it can't land before 07:30 PT,
      strip the `support@` line from launch copy and use a personal
      email instead; don't ship a dead address.
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

## Phase 2 — Launch day (Tue Jun 16)

Order matters. HN first, everything else feeds it.

| Time (PT) | Surface | Notes |
|---|---|---|
| 07:30 | Show HN | Title fixed; body is from docs/LAUNCH_COPY.md |
| 07:45 | Product Hunt | Maker comment goes live (scheduled in night-before batch) |
| 08:00 | X thread | 8 tweets, video in T1 |
| 09:00 | LinkedIn | Different audience, personal tone |
| 10:00 | r/macapps | Mac craft angle |
| 11:00 | r/LocalLLaMA | Technical / retrieval / qwen3 angle |
| 12:00 | r/selfhosted | Privacy / no-cloud angle |
| 14:00 | r/Obsidian | Integration-shaped question |
| 16:00 | X | End-of-day recap with day-one numbers |
| **Wed Jun 17, 10:00** | r/immigration | Day 2 — visa form-fill use case |

Reply window:
- HN: every comment within 15 min for first 4h
- PH: every comment within 30 min
- PostHog dashboard hourly. Tweet/DM something to address the drop-off step

---

## Phase 3 — Sustain (Wed Jun 17 → Tue Jun 30)

- **Wed Jun 17** — Email everyone on the Pro waitlist. One question: *"What did you try to ask first?"* Their answers are the roadmap
- **Thu Jun 18** — Newsletter outreach: Ben's Bites, TLDR AI, Console.dev, Indie Hackers, Recommendo. Personal email each
- **Mon Jun 22** — Second-wave Reddit (Obsidian, privacy, digitalnomad). Write the "How OctoVault works under the hood" technical blog post (long-tail SEO for "local AI personal documents")
- **Wed Jun 24** — Repeat-Show-HN: *"OctoVault one week later: 2,000 downloads"* — only if numbers support it. Data, not promo
- **Fri Jun 26** — Ship the first user-requested feature visibly. Show the loop is tight
- **Tue Jun 30** — Internal retro: conversion funnel, top friction, top requested feature, top objection. Decide whether form-fill ships in 2 weeks or 4

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

## Day-of checklist (Mon Jun 15 evening + Tue Jun 16 morning)

**Tonight (Mon Jun 15):**
- [ ] DMG signed + notarized + stapled, downloadable, SHA in the release notes
- [ ] Clean-Mac QA pass complete; 5 demo questions return cited answers
- [ ] Landing prerendered, OG unfurl tested on X + Slack + iMessage + WhatsApp
- [ ] PostHog firing on `download_mac_clicked`, `pricing_cta_clicked`, `waitlist_signup_completed`, `bug_report_submitted` (the four landing-side events that actually exist)
- [ ] Bug-report endpoint smoke-curl returns 200 (✅ done — verify still good)
- [ ] `bug-screenshots` storage bucket exists in Supabase
- [ ] 60s video on landing page, on YouTube (for embeds), as MP4 attached to PH
- [ ] HN draft pasted into a notes app, ready to ctrl-V
- [ ] PH scheduled in the night-before batch (deadline: tonight)
- [ ] X thread drafted in TweetDeck / Typefully, scheduled
- [ ] LinkedIn drafted
- [ ] 5 Reddit drafts ready, mod rules re-read for each sub
- [ ] Calendar blocked 07:00–17:00 PT Tue — no meetings, just replies
- [ ] support@octovault.ai DNS propagated (or copy edited to remove the address)

**Tomorrow morning (Tue Jun 16), before 07:30 PT:**
- [ ] Open the HN draft, PH page, X scheduler, LinkedIn, 4 Reddit tabs
- [ ] Open Supabase → waitlist + bug_reports tables
- [ ] Open PostHog → realtime events dashboard
- [ ] Open the landing site in incognito; do one cold download yourself to verify the funnel fires

---

## Next engineering blockers

All shipped — Phase 0 engineering items are done. Remaining work is
operational: notarize, clean-Mac QA, DNS, dashboard checks.

Post-launch backlog (don't start before Jun 16):
- **Phase E2 vision fallback** for form detection — non-blocking; queue for the Fri Jun 26 "first user-requested feature" slot if it matches feedback

User-side items I can't do but need before launch:
- 60-sec hero video (film + edit)
- 20-sec form-fill teaser
- Network-tab "0 outbound calls" screenshot
- 3 retina screenshots
- DNS for `support@octovault.ai`
- Chrome Web Store submission
- Notarize from non-MDM Mac on Jun 25
- Clean-Mac QA pass on Jun 27
