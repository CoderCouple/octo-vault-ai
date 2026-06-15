# OctoVault launch plan

Target: **Tue 2026-06-30, 07:30 PT** (Show HN). Tuesday/Wednesday have
the best HN+PH attention; avoids US July 4 chop.

Last updated: 2026-06-15 (T-15) — after the Phase 0 product sweep
(telemetry panel, waitlist tier intent, PostHog funnel audit, bug-report
schema fix).

Companion: `docs/LAUNCH_COPY.md` — every public-facing post in
posting order, ready to ctrl-V on launch day.

---

## Phase 0 — Pre-flight (now → Mon Jun 22)

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

- [ ] **60-sec hero video** (single highest-leverage asset). Cold cursor → drop 3 docs → "When does my passport expire?" → cited answer → click into the graph. No voiceover; on-screen captions. 1080p MP4 + WEBM. Loop first 8s as the OG video
- [ ] 20-sec form-fill teaser (Canada visitor visa is the cleanest demo)
- [ ] **Network-tab screenshot** — DevTools open, hero loaded, 0 outbound calls after launch. *The proof for the privacy claim*
- [x] OG image — shipped
- [ ] 3 still screenshots: graph view, chat with citations, conflict resolution. PNG, 2880×1800 retina
- [x] Chrome Web Store — submitted (assets: marquee, 2 screenshots, small promo)

### Copy (in `docs/LAUNCH_COPY.md`)

- [x] Show HN title + body + canned replies
- [x] Product Hunt tagline + maker comment
- [x] X launch thread (8 tweets)
- [x] LinkedIn post
- [x] Reddit drafts × 5 (macapps, LocalLLaMA, selfhosted, Obsidian, immigration)
- [x] Day-of reply templates
- [x] Newsletter outreach template

### Inbound infra

- [ ] **Bug-report endpoint — LAUNCH BLOCKER.** Verification on 2026-06-15 showed `public.bug_reports` does not exist on the live Supabase (`HTTP 404 PGRST205`). Every submission since `/bug-report` shipped has 4xx'd into the form's error state. Migration `supabase/migrations/20260615180000_create_bug_reports.sql` is staged locally; `supabase db push --linked --dry-run` confirms it's the only pending change. **Action: run `supabase db push --linked` (or paste the SQL into the Supabase dashboard), then re-run the smoke curl:**
  ```sh
  curl -sS -o /dev/null -w "%{http_code}\n" \
    "$VITE_SUPABASE_URL/rest/v1/bug_reports?select=id&limit=0" \
    -H "apikey: $VITE_SUPABASE_ANON_KEY" \
    -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
  # expect: 200
  ```
  Also verify `bug-screenshots` storage bucket exists in the Supabase dashboard (Storage → buckets); `uploadScreenshots()` writes there.
- [ ] support@octovault.ai forwarding — user DNS
- [x] PostHog funnel events audited — landing-side only by design (no desktop telemetry, per the privacy panel). Measurable funnel: landing visit → `download_mac_clicked` → GitHub release counter → `pricing_cta_clicked` → `waitlist_signup_completed` → `bug_report_submitted`. Nav + footer GitHub clicks now named events
- [x] Pro waitlist CTAs — `cta-pricing-reserve-{pro,lifetime}` tracked + tier intent carried via sessionStorage into `waitlist_signup_completed` event and the Supabase `source` column. Day-one query: `select source, count(*) from waitlist group by source`

---

## Phase 1 — Soft launch (Tue Jun 23 → Mon Jun 29)

**Goal: catch the embarrassing bug before strangers do.**

- **Tue Jun 23** — DM 10 people personally. Half privacy-leaning devs, half immigration-context users. Goal: 5 actually install. Watch PostHog sessions, fix top friction
- **Wed Jun 25** — Post in 2 Slack/Discord communities the user already belongs to. "Beta for $1 in feedback, here's the DMG." NO public channels
- **Thu Jun 25** — **Notarize the DMG from the non-MDM Mac.** Block out the morning. (MDM/Jamf on the dev Mac will intercept Apple's stapler — must be done from a non-managed machine.)
- **Fri Jun 27** — Final QA on a clean Mac (Task #12). DMG opens without Gatekeeper drama. Ollama install flow works end-to-end. Sample passport + I-797 produce correct facts. The 5 demo questions return cited answers.
- **Sat–Sun Jun 28–29** — NO code pushes. Lock the launch posts in their final form. Sleep.

---

## Phase 2 — Launch day (Tue Jun 30)

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
| **Wed 10:00** | r/immigration | Day 2 — visa form-fill use case |

Reply window:
- HN: every comment within 15 min for first 4h
- PH: every comment within 30 min
- PostHog dashboard hourly. Tweet/DM something to address the drop-off step

---

## Phase 3 — Sustain (Wed Jul 1 → Tue Jul 14)

- **Wed Jul 1** — Email everyone on the Pro waitlist. One question: *"What did you try to ask first?"* Their answers are the roadmap
- **Thu Jul 3** (skip July 4) — Newsletter outreach: Ben's Bites, TLDR AI, Console.dev, Indie Hackers, Recommendo. Personal email each
- **Mon Jul 7** — Second-wave Reddit (Obsidian, privacy, digitalnomad). Write the "How OctoVault works under the hood" technical blog post (long-tail SEO for "local AI personal documents")
- **Wed Jul 9** — Repeat-Show-HN: *"OctoVault one week later: 2,000 downloads"* — only if numbers support it. Data, not promo
- **Fri Jul 11** — Ship the first user-requested feature visibly. Show the loop is tight
- **Mon Jul 14** — Internal retro: conversion funnel, top friction, top requested feature, top objection. Decide whether form-fill ships in 2 weeks or 4

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

1. **Notarization breaks on a fresh Mac** → catch in Phase 0 clean-VM QA (Task #12)
2. **Ollama install friction kills first-run** → ✅ in-app installer flow shipped. Re-test on clean Mac
3. **HN flames the form-fill as creepy** → "coming soon, opt-in, the graph is the product" canned response in `docs/LAUNCH_COPY.md`
4. **Someone finds an outbound call** → ✅ chat-history fix removed the biggest one. Re-run Little Snitch + ingest 10 docs before launch
5. **Dev Mac is MDM'd** → notarize from non-managed Mac on Jun 25 (the eBay-managed Mac blocks Apple's stapler)

---

## Day-of checklist (print this)

- [ ] DMG signed + notarized + stapled, downloadable, SHA in the release notes
- [ ] Landing prerendered, OG unfurl tested on X + Slack + iMessage + WhatsApp
- [ ] PostHog firing on `download_mac_clicked`, `app_unlocked`, `first_doc_ingested`, `first_answer`
- [ ] Bug-report endpoint receiving
- [ ] 60s video on landing page, on YouTube (for embeds), as MP4 attached to PH
- [ ] HN draft pasted into a notes app, ready to ctrl-V
- [ ] PH scheduled in the night-before batch
- [ ] X thread drafted in TweetDeck / Typefully, scheduled
- [ ] LinkedIn drafted
- [ ] 5 Reddit drafts ready, mod rules re-read for each sub
- [ ] Calendar blocked 07:00–17:00 PT — no meetings, just replies

---

## Next engineering blockers (in order)

Open tasks I can ship without user intervention:

1. **#11 Pro waitlist verification + wire** — drives the launch funnel; dead buttons here = day-1 reservation target dies
2. **#13 PostHog funnel audit** — so day-1 you can actually see where users drop off
3. **#10 Bug-report endpoint verify** — so day-1 bug reports reach the user instead of vanishing
4. **#14 Telemetry reassurance panel** — privacy-story polish
5. **#6 Phase E2 vision fallback** for form detection — non-blocking; defer to post-launch unless time permits

User-side items I can't do but need before launch:
- 60-sec hero video (film + edit)
- 20-sec form-fill teaser
- Network-tab "0 outbound calls" screenshot
- 3 retina screenshots
- DNS for `support@octovault.ai`
- Chrome Web Store submission
- Notarize from non-MDM Mac on Jun 25
- Clean-Mac QA pass on Jun 27
