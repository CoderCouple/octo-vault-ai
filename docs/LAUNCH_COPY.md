# OctoVault — launch copy

Single source of truth for every public-facing post on launch day.
Target: **Tue 2026-06-30, 07:30 PT (Show HN first)**. Edit in place,
ship from here. Order in this doc = posting order on launch day.

---

## 1. Show HN (07:30 PT)

**Title** (60 chars max, can't edit after posting):

> Show HN: OctoVault – a local AI vault for personal documents

**Body** (paste into the URL field as a "show" post, link below):

```
OctoVault is a Mac app that turns your personal documents — passports,
leases, paystubs, I-797s, marriage certs — into a local knowledge graph
you can chat with. The model and the data both stay on disk.

I built it because I had a folder called important_docs/ with 84 PDFs
and could never find the I-94 expiry on my wife's record. NotebookLM
solves that by uploading everything to Google. ChatGPT solves it by
uploading to OpenAI. Obsidian doesn't act on documents at all. The
third option felt missing, so OctoVault keeps everything on disk and
runs Ollama (qwen3:8b for chat, nomic-embed-text for retrieval) locally.

Three things I'd love feedback on:

  1. The knowledge graph is the actual product — every fact is a node
     linked to the source page. Chat is just a query surface on top.
     Is the graph worth the complexity vs. a plain Q&A list?

  2. Retrieval is hybrid BM25 + vector with RRF fusion and a small LLM
     query-rewrite budget (~500ms). Civil-status edges are derived
     automatically (marriage → in-laws, birth → co-parents). Smoke
     evals live in core/scripts/eval-qa.ts. Open to better retrieval
     ideas — especially around cross-document conflict resolution.

  3. A Chrome side-panel that auto-fills visa / USCIS / school forms
     from the graph is in private beta. Useful, or creepy?

Free for personal use. Mac DMG, signed + notarized:
https://octovault.ai
```

**HN reply templates** — keep these in a notes app, paste as needed:

> *"Why not just <X>?"* — NotebookLM is great if you're fine uploading
> to Google; the whole reason this exists is that I wasn't. Obsidian
> + Smart Connections runs locally but doesn't extract structured
> facts, doesn't build a graph across documents, and doesn't act on
> forms. The closest comparable is Mem.ai but it's cloud-only.

> *"Doesn't Ollama need a GPU?"* — qwen3:8b runs on Apple Silicon
> CPU+ANE comfortably; M1/M2 base machines hit ~5s TTFT after a warm
> load. We pre-warm on vault unlock and use keep_alive=30m on the
> Ollama side, plus think:false to suppress qwen3 chain-of-thought.

> *"Is the side-panel reading the page?"* — Yes, content-script
> reads the form schema, asks the local vault for matches, and
> previews drafts in a HUD before anything is filled. Nothing leaves
> the device. The extension is read-only against the desktop vault
> over a localhost bridge; falls back to a WebCrypto + IndexedDB
> vault when desktop isn't running.

> *"Source available?"* — Not yet. Plan is to open-source the
> extraction + retrieval core once the schema stabilises.

---

## 2. Product Hunt (00:01 PT — day-of scheduler)

**Name:** OctoVault
**Tagline** (60 chars max):

> Your private AI paperwork vault. Locally.

**Description** (260 chars):

> Drop in your passports, leases, paystubs, I-797s. OctoVault extracts
> the facts, builds a knowledge graph, and answers questions with
> cited sources — entirely on-device. Ollama under the hood. Coming:
> a Chrome side panel that fills visa and USCIS forms from the graph.

**Maker comment (first comment, post at 00:05 PT):**

```
Hi PH — Sunil here, solo maker.

OctoVault is the local-first answer to "I have a folder full of important
PDFs and can never find anything." It extracts facts from your documents,
builds a knowledge graph with source citations, and lets you chat with it.

The thing that makes it different: nothing leaves your machine. The AI
runs locally via Ollama (qwen3:8b + nomic-embed-text). The vault is
SQLCipher-encrypted with a key derived from your master password. The
landing page shows a network-tab screenshot proving 0 outbound calls —
that's the spec.

What I'd love feedback on:
  • Onboarding — first-run has to install Ollama if it's not there.
    Is the current flow tolerable?
  • The graph view — is it the killer feature, or is plain chat enough?
  • The Chrome side panel that fills forms — useful, or scary?

Free for personal use. Pro is $9/mo (reserved, ships later this summer).
Lifetime $499 — capped at 200 founding members.

Mac DMG, signed + notarised: https://octovault.ai
```

---

## 3. X / Twitter thread (08:00 PT)

Post as a single thread. Tweet 1 has the 60s video; tweets 3 + 4 have
GIFs (15s each). Keep replies open for 4h.

**T1 — hook + video**

> NotebookLM uploads your documents to Google.
> ChatGPT uploads them to OpenAI.
> Obsidian doesn't act on them at all.
>
> I built the third option. OctoVault — a local AI vault for your
> personal paperwork. Mac, free, signed.
>
> [video — 60s hero]

**T2 — proof**

> The whole point is that nothing leaves your disk. Here's the
> DevTools network tab after I drop in 12 documents and ask three
> questions: zero outbound calls.
>
> [screenshot — DevTools network tab, empty]

**T3 — what it does (1)**

> Drop in a passport, a lease, a paystub, an I-797. OctoVault
> extracts the facts and builds a knowledge graph where every node
> is linked back to the source page.
>
> [gif — 3 docs dropped → graph builds]

**T4 — what it does (2)**

> Then ask the graph anything.
>
> "When does my passport expire?"
> "What's my current address per my lease?"
> "Which docs say Aria was born in Bengaluru?"
>
> Cited answers, qwen3:8b running locally via Ollama.
>
> [gif — chat with citations]

**T5 — the threat model**

> The privacy story in one line:
>
> NotebookLM → Google
> ChatGPT → OpenAI
> OctoVault → on your disk
>
> Same primitive (chat with your docs). Different threat model.

**T6 — coming soon**

> A Chrome side panel reads the form on your screen, matches each
> field to your vault, and previews drafts before it fills anything.
>
> Visa applications, USCIS forms, school enrolments. Going into
> beta next month.
>
> [gif — form-fill teaser]

**T7 — pricing**

> Free forever for personal use.
> Pro at $9/mo when it ships — locked in for everyone who reserves
> before launch.
> Lifetime $499, capped at 200 seats.
>
> Reserve at the link below.

**T8 — CTA**

> Mac DMG, signed + notarised, 47 MB.
> Open-source extraction + retrieval coming after the schema stabilises.
>
> octovault.ai
>
> Show HN: [link]

---

## 4. LinkedIn (09:00 PT)

Different audience, different tone — personal, not technical.

```
I built a Mac app to solve a problem that's been bugging me for years.

I have a folder called "important_docs/" with 84 PDFs in it. Passports,
my wife's I-797, our lease, paystubs, school letters, marriage
certificate, kids' birth certificates. Every time someone asks me
"when does that visa expire?" I dig through it for ten minutes.

NotebookLM and ChatGPT solve this — by uploading everything to
Google or OpenAI. That felt wrong for documents like these.

So I built OctoVault. It runs the AI locally (Ollama under the hood),
extracts the facts from each document, and links them in a knowledge
graph so I can ask "when does Aria's I-94 expire?" and get a cited
answer without anything leaving my laptop.

A Chrome side panel that fills visa forms from the same graph is in
private beta. That part is the use case I really care about — I've
filled the same DS-160 information across four different family
applications and it makes me angry every time.

Mac DMG signed + notarised. Free for personal use. Pro for everything
else when it ships.

Link in comments.
```

(First comment: `https://octovault.ai` — LinkedIn buries posts with
outbound links in the body.)

---

## 5. Reddit (10:00 PT onwards, staggered)

Each sub gets its own post. Never the same body. Mods will hammer
you for cross-posting verbatim.

### r/macapps (10:00 PT)

**Title:** I built a Mac-native local AI vault for personal documents (signed + notarised)

```
TL;DR: Drop in passports, leases, paystubs, I-797s. OctoVault extracts
the facts, builds a knowledge graph, and lets you chat with it —
all locally via Ollama. No cloud, no telemetry on document content.

Mac-craft notes that this sub might care about:

  • Signed + notarised + stapled (Developer ID 6RF9THVXBJ). Opens
    on Sonoma+ without "unidentified developer" friction.
  • Native global hotkey + floating left-edge shortcut + Spotlight-
    style overlay. All toggleable from Settings.
  • SQLCipher for the vault, key derived from your master password.
  • Apple Silicon native; Intel works but ANE acceleration only
    kicks in on M-series.
  • 47 MB DMG. No web view for the chat surface — actual native
    React + Electron renderer.

Stack: Electron + React + Tailwind on the front, Ollama (qwen3:8b
+ nomic-embed-text) underneath. Free for personal use.

octovault.ai — feedback welcome, especially on the first-run flow
if you don't have Ollama installed yet.
```

### r/LocalLLaMA (11:00 PT)

**Title:** Built a consumer Mac app on qwen3:8b — retrieval notes, TTFT, what worked

```
Shipped a local AI personal-document vault on Mac that uses qwen3:8b
for chat + nomic-embed-text for retrieval, both via Ollama. A few
notes from the build for anyone shipping on local models:

Retrieval
  • Hybrid BM25 + vector with RRF fusion. Vector alone misses
    short fact-lookup questions ("passport number?"), BM25 alone
    misses paraphrased questions. RRF with k=60 is the sweet spot.
  • Tiny LLM query rewrite (~500ms budget, capped) to expand
    questions before retrieval. Improves recall ~12% on my golden
    set; anything over 500ms hurts perceived latency more than it
    helps.
  • Civil-status edges (marriage → in-laws, birth → co-parents)
    are derived at read time, not stored. Closure rules > assertions.

Chat speed
  • TTFT 4–5s warm, 12–15s cold on M1 base.
  • think:false on qwen3 — kills the chain-of-thought that the
    user doesn't want to see.
  • keep_alive=30m on chat, 1m on vision OCR.
  • Pre-warm on vault unlock — by the time you've typed a question,
    the model is loaded.

Extraction
  • ~50 high-value fields are typed in a Profile schema; long-tail
    fields go into an "extras" channel that's indexed for retrieval
    but doesn't pollute the canonical Profile. Hybrid schema beats
    pure typed or pure JSON-blob.
  • Per-type extraction hints — passport prompt is different from
    paystub prompt is different from lease prompt.

App is octovault.ai if anyone wants to poke at it. Free, Mac only
right now. Happy to answer retrieval / prompt-eng questions in the
thread.
```

### r/selfhosted (12:00 PT)

**Title:** Local-first alternative to NotebookLM — runs entirely on your machine

```
NotebookLM is great until you realise everything you upload is on
Google's servers. I wanted the same primitive — chat with my own
documents — without giving them up. So I built OctoVault.

What's self-hosted about it:
  • Ollama runs the model on your machine (qwen3:8b default, swap
    any other Ollama tag from settings).
  • Vault is SQLCipher with a key from your master password.
  • Embeddings are local (nomic-embed-text).
  • Zero outbound calls in product runtime. The landing page uses
    PostHog for anonymous click events — that's it, and it's
    separated from the app.
  • Chrome side panel for form-fill talks to the desktop over a
    localhost HTTP bridge. Read-only. Falls back to a WebCrypto +
    IndexedDB vault when desktop isn't running.

Catch: Mac only for now (Electron + signed DMG). Linux and Windows
are on the roadmap once the macOS build is steady.

Free for personal use. octovault.ai — would love feedback from
people who've used Paperless-ngx or similar for the comparison angle.
```

### r/Obsidian (Tue 14:00 PT)

**Title:** Built a local AI app for personal documents — how would Obsidian users want this to integrate?

```
Long-time Obsidian user. I built a Mac app that turns personal
documents (passports, leases, paystubs, immigration papers) into a
local knowledge graph you can chat with. Ollama under the hood,
everything stays on disk.

Posting here because I think there's an Obsidian-shaped question I
don't yet know the answer to: how would you want this to talk to
your vault?

  (a) Sync extracted facts as markdown notes with frontmatter into
      a folder you point at?
  (b) An Obsidian plugin that queries OctoVault and returns cited
      snippets?
  (c) Just leave them separate — Obsidian for notes, OctoVault for
      documents?

I lean (c) for v1 because the threat models are different — Obsidian
trusts your vault folder, OctoVault encrypts it. But (a) is the most
asked-for thing I've heard from people who've seen it.

App is octovault.ai if curious. Free for personal use, Mac only.
Genuinely asking — what would the integration look like for you?
```

### r/immigration (Wed 10:00 PT)

**Title:** Free Mac tool that keeps your I-797 / visa documents queryable and (soon) auto-fills the forms

```
I've filled the same DS-160 / I-130 / school-enrolment information
across four different family applications and got tired of it. Built
a Mac app that:

  • Stores all your immigration documents encrypted on your machine
    (no cloud upload — important for these specifically).
  • Extracts the facts: passport numbers, visa expiries, I-94
    dates, USCIS receipt numbers, marriage / birth certificate
    details.
  • Lets you ask things like "when does my I-94 expire?" or "what
    was the consulate on my last visa stamp?" with cited answers
    from the actual document page.
  • Coming next month: a Chrome side panel that auto-fills DS-160,
    I-130, school applications, etc., from the same vault. Drafts
    preview in a HUD before anything is filled.

It's free for personal use. Mac only right now. The encryption is
SQLCipher with a key from your password — meaning if you lose your
password the vault is gone. That's by design.

Not legal advice, just paperwork ergonomics. octovault.ai.

(Mods — happy to take this down if it's too promotional; I'm a
single-person shop and this is the use case I built it for.)
```

---

## 6. Day-of replies — canned answers

Keep in a notes app, paste-and-personalise.

**"How is this different from <X>?"**

> Three things: (1) nothing leaves your machine — the model and the
> data are both on disk; (2) the output is a knowledge graph with
> source citations, not a chat transcript you can't audit; (3) the
> side panel that fills web forms from the graph is the actual
> payoff, chat is just the query surface.

**"Will you support Windows / Linux?"**

> Yes, after the macOS build is steady. The Electron shell + Ollama
> dependency port fine; the SQLCipher native module needs a build
> per platform. ETA: end of summer.

**"Open source?"**

> Extraction + retrieval core will be open after the schema
> stabilises. The Electron shell + signing + notarisation
> infrastructure is unlikely to be useful to anyone else, so probably
> not that part.

**"What's the catch?"**

> Honest one: the first-run experience needs Ollama installed.
> If you don't have it, the app walks you through installing it and
> pulling the two models (~5GB total). After that it's fully offline.

**"What about <sensitive question — divorce, immigration status, etc>?"**

> The whole point is that you can ask anything you want without it
> being on someone else's server. The app doesn't see what you
> search; Ollama doesn't log; the vault is encrypted. Your move.

---

## 7. End-of-day X recap (16:00 PT)

Only post if the numbers are good. Adapt:

```
Launch-day numbers, 8h in:
  • {N} DMG downloads
  • {N} first-answer events
  • {N} Pro reservations
  • {N} HN comments
  • The most-asked question was: "{paste it}"

Tomorrow I'm shipping {the thing you decided to fix based on
feedback}. Thanks to everyone who tried it.
```

---

## 8. Newsletter outreach (Thu Jul 3)

Targets: Ben's Bites, TLDR AI, Console.dev, Indie Hackers, Recommendo,
Sidebar (design), Hacker Newsletter (HN top-of-week curator).

Personal note template:

```
Subject: Local-first AI vault for personal documents — would
{NEWSLETTER} readers care?

Hi {NAME},

I shipped OctoVault on Tuesday — a Mac app that turns personal
documents (passports, visas, leases) into a local knowledge graph
you can chat with. The whole thing runs on Ollama, nothing leaves
your machine. {NUMBER} downloads on day one, HN was on the front
page for {TIME}.

It might land for your audience because {SPECIFIC REASON for this
newsletter — e.g. "Ben's Bites readers have been asking about
private alternatives to NotebookLM" or "Console.dev readers ship
local-first apps"}.

60-sec demo: {video link}
Show HN thread: {link}
Landing: octovault.ai

If it's useful, no pressure — and I owe you a beer if you cover it.

Sunil
```

---

## 9. Things NOT to do

- Don't post the same body across Reddit subs. Each sub has a different
  culture; mods notice.
- Don't pitch the form-fill as a done thing. It's "coming soon" — the
  vault is the launch product.
- Don't claim "100% private" without immediately backing it with the
  network-tab screenshot.
- Don't reply to HN flames at length. Acknowledge, address one specific
  point, move on. The mob will rate-limit itself.
- Don't ship code on launch day unless something is broken. The cost
  of a regression at peak attention is enormous.
