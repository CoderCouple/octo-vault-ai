# PH "Connect with Investors" — answers

For the optional investor-connect form on the PH submission page.
Each answer is well under the 5000 char limit — investor reads reward
tight. Fill in the `<FILL>` brackets with real facts before submitting.

---

## 1. Why are you the right founder/team to work on this?

We're a two-person team — Sunil and Payal — building OctoVault because
we're the user.

**Sunil** has spent <FILL: N> years shipping production software at
<FILL: eBay / prior roles>. The desktop app stack here — Electron +
SQLCipher native modules + Apple notarisation + IPC architecture —
is the kind of thing that goes wrong in fifteen places at once, and
he's done enough of it to know which fifteen. He's also the one with
the actual paperwork pain: a family I-797 / I-94 / DS-160 stack that
made the "no cloud" requirement non-negotiable.

**Payal** brings <FILL: design / product / engineering — pick what's
true>. She owns <FILL: e.g., the extraction prompts + the knowledge-
graph schema + the form-fill UX>. The split lets us ship at a pace
that's hard to match — we've gone from concept to signed, notarised
DMG with hybrid BM25+vector retrieval and a working Chrome side panel
in <FILL: N> months.

Two-person teams with a clean product/eng split and lived experience
of the problem ship faster than a five-person team that's pattern-
matching from the outside. We've already shipped phases 1-6 of the
extraction/retrieval roadmap; the local-first knowledge graph isn't
a hypothesis, it's a thing in our pockets that we use daily.

---

## 2. Why did you pick this idea to work on?

Personal pain: I (Sunil) have a folder called `important_docs/` with
84 PDFs in it — passports, my wife's I-797, our lease, paystubs, the
kids' birth certificates. Every time someone asked me "when does that
visa expire?" I lost ten minutes digging through it.

NotebookLM solves this — by uploading everything to Google. ChatGPT
solves it by uploading to OpenAI. For these specific documents, that
felt wrong in a way I couldn't override. Most people don't yet realise
they've casually handed Google their passport scans + their wife's
immigration paperwork; the moment they do, the category shifts.

Karpathy has been writing about "LLM personal-knowledge OS" — a local
AI you trust with the things you trust no one else with. Until 18
months ago this was a thought experiment; qwen3:8b on Apple Silicon
M1 made it consumer-feasible. The window for local-first personal-
document AI just opened. We're early on purpose.

The graph + form-fill is the second compounding insight: once you
have structured facts on disk, you can *act* on them. The Chrome
side panel that fills DS-160 / I-130 / school forms is the same data,
re-projected onto a $XXB legal-services / paperwork-automation
adjacent market. Chat is a feature; the graph is the moat.

---

## 3. Who are your competitors, and what do you understand about this idea that they don't?

**Cloud-LLM document chat** (NotebookLM, ChatGPT files, Claude
Projects): closest in promise, opposite in threat model. They literally
cannot serve users who won't upload sensitive paperwork — and that
segment is bigger than they think. NotebookLM's actual UX is also
bag-of-chunks; it can't reason across documents the way a structured
graph can ("what's the I-94 expiry for the person whose passport is
on page 12 of this other PDF?").

**Local note-taking + AI plugins** (Obsidian + Smart Connections):
local, but built for free-form notes, not structured personal
documents. No extraction, no graph across docs, no action layer.

**Local document managers** (Paperless-ngx, DEVONthink): great at
filing, no AI inference, no entity graph.

**What we understand that they don't:**

1. **The killer feature is the graph, not the chat.** Cross-document
   inference (marriage → in-laws, birth → co-parents, passport →
   visa history) needs a typed schema with closure rules. Bag-of-
   chunks can't do this. Most AI-on-documents products skipped the
   graph because it's harder to build than RAG.

2. **Local-first AI is now consumer-feasible — most teams haven't
   noticed.** qwen3:8b on an M1 base machine gives 4-5s TTFT after
   warmup, which is good enough. Eighteen months ago it wasn't.

3. **Form-fill is where the graph becomes a product, not a demo.**
   The same vault that answers "when does my I-94 expire?" can
   auto-fill the next DS-160. Nobody has shipped this because they
   don't have the underlying graph.

---

## 4. What's your revenue and/or growth rate?

Pre-revenue — we launch on Product Hunt and Show HN on **Tue 2026-06-16**
(this is our launch day).

**Pre-launch traction (as of <FILL: today's date>):**
- Waitlist signups: <FILL: N>
- Pro tier reservations (founding $9/mo): <FILL: N>
- Lifetime tier reservations ($499, cap of 200): <FILL: N>
- Private-beta users on the Chrome form-fill side panel: <FILL: N>

**Pricing**
- Free forever for personal use (200 docs, 50 Q&A/day)
- Pro: $9/mo founding-member price (locked for waitlist signups; ships
  in <FILL: weeks>)
- Lifetime: $499, capped at 200 founding members
- Future: Org / team plans for legal / immigration professionals (the
  graph + form-fill compounds in regulated-paperwork workflows)

We're capital-efficient by design — the entire stack runs on the
user's machine, so we have zero per-user infra cost. Pro revenue is
near-100% margin from day one.

---

## 5. Anything else you would like investors to know?

**We're funded by the wrong asymmetry.** Most VC dollars flow to
cloud / SaaS because it's familiar to value. Local-first is
structurally underfunded but it's where Brave, Perplexity Comet,
Raycast, Arc, Linear-desktop, and ollama itself have been winning
quietly. The category is real; the capital hasn't caught up.

**Roadmap compounds in one direction:** graph → chat → form-fill →
team / org plans for paperwork-heavy professions (immigration
lawyers, school enrollment offices, family-office staff). Each ring
out is the same data, repackaged. The moat is the schema, not the
UI.

**What we'd want from an investor:**
- <FILL: e.g. "$500k-$1M angel/pre-seed at $XM cap" — pick what's
  honest for your stage>
- Distribution help into <FILL: immigration / legal-services /
  privacy-aware-consumer channels>
- Comfort with local-first / on-device AI specifically — investors
  who only understand cloud SaaS will mis-price what we're building

We're not raising to survive — we're already shipping. We'd raise to
accelerate distribution + hire one specific engineer to build the
form-fill into a proper product. If the model isn't a fit, no offence
taken; we'd rather know.

Reach: sunil@<FILL>.com / payal@<FILL>.com / support@octovault.ai
