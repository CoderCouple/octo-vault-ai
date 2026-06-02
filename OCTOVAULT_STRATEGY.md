# OctoVault — Product Strategy Document

*A local-only personal AI vault for documents, identity, and life-admin.*

---

## 1. Brand Positioning

### One-sentence definition
OctoVault is a local-only personal AI vault that scans, understands, and securely stores your documents on your device — so you can ask questions, fill forms, and manage life-admin without sending a single page to the cloud.

### Tagline
**OctoVault — your private AI paperwork vault. No cloud. No servers. No nonsense.**

Supporting taglines for variants:
- "Your documents. Your device. Your AI."
- "Personal AI that never leaves your machine."
- "The vault that thinks."

### Emotional promise
Calm, in control, and unsurveilled. OctoVault replaces the dread of "where is that document?" and the unease of "who else has my data?" with the quiet confidence of a private safe that can also answer questions. It is the digital equivalent of a locked filing cabinet that knows what's inside — and tells only you.

### Why the name works
- **Octo** evokes intelligence (octopuses are famously smart, with distributed neural processing — a fitting metaphor for on-device AI) and many arms reaching across all of your scattered paperwork.
- **Vault** signals security, privacy, and permanence. It is not a "drive" or "cloud" — it is a vault, which connotes physical, defensible storage.
- Together: a smart, many-handed, locked container. The name implies both capability and protection — exactly the dual promise of a local AI for sensitive documents.
- The compound is short, ownable, brandable, and memorable. It avoids the AI-naming trap of "-GPT" or "-AI" suffixes, which date instantly and signal "wrapper app."

### Ideal customer profile
**Primary persona — The Private Professional (28–55)**
- Knowledge worker, freelancer, consultant, immigrant, parent, or small-business owner.
- Manages 50–500 personal documents per year: tax forms, IDs, insurance, medical records, immigration paperwork, school forms, vehicle paperwork.
- Has read at least one privacy-related news story that genuinely worried them.
- Owns a modern Mac, Windows PC, or recent iPhone/Android.
- Willing to pay $40–$200 once for software that solves a real pain — not interested in another subscription.

**Secondary personas**
- **Immigrants and global citizens** with multi-country documents and frequent form-filling.
- **Parents and caregivers** managing dependents' paperwork (school, medical, dental, legal).
- **Small business owners** keeping personal and business identity documents separate.
- **Privacy-conscious technologists** who already use Signal, Bitwarden, Obsidian, and 1Password.

### Main user pain points
1. Documents scattered across email, drives, scans, physical folders, and screenshots — never findable when needed.
2. Re-typing the same identity data into every form for the rest of their lives.
3. Cloud-storage anxiety: "Is Google reading my passport?"
4. Missed renewals (passport, license, insurance) because nothing reminded them.
5. Sharing sensitive PDFs over email or chat because there's no better option.
6. "Where's the latest version?" — duplicate, outdated, or conflicting documents.
7. Existing AI assistants are powerful but require sending personal documents to a cloud LLM.

### Strongest competitive advantage
**OctoVault is the only product that combines intelligent document AI with a hard guarantee that nothing leaves the device.** Competitors either offer dumb storage with privacy (Cryptomator, encrypted folders) or smart AI without privacy (ChatGPT, Notion AI, Google Drive AI). OctoVault is the first product to credibly offer both — and the first to make "local-only" a *feature*, not a limitation.

### Why "local-only" is a major trust advantage
- **Verifiable, not promised.** Users can confirm in their OS firewall that the app makes no network calls. Trust shifts from policy to physics.
- **Regulatory safety.** No HIPAA, GDPR, or jurisdictional risk for the user — their data never crosses a border or enters a processor.
- **Breach immunity.** No backend means no backend to hack. The user's threat surface is their device, which they already secure.
- **No model training drift.** User data cannot be silently added to any training corpus.
- **Permanent ownership.** No vendor can deplatform, raise prices on, or shut off access to the user's own documents.
- **Marketing simplicity.** "We can't see your data" is the most powerful single sentence in privacy marketing.

---

## 2. Core Product Principles

These are non-negotiable. They define what OctoVault *is*, and they are the only reason a user would choose it over a cloud alternative.

1. **No cloud document storage.** Documents live only on user-controlled devices and user-controlled backups.
2. **No server-side AI processing.** All inference runs on the user's CPU, GPU, or NPU.
3. **No user documents sent to third-party APIs.** No OpenAI, Anthropic, Google, or any external LLM call for personal content.
4. **No cloud embeddings.** Vectors are generated and stored locally.
5. **No remote vector database.** No Pinecone, Weaviate, or hosted vector service.
6. **No background data sharing.** No silent sync, telemetry, or "anonymous usage" pings containing user content.
7. **No training on user data.** Ever. Not opt-in, not opt-out — never.
8. **No telemetry containing personal content.** Crash logs are scrubbed; document text never leaves the device.
9. **User owns all files, keys, indexes, and extracted data.** Open formats where possible (SQLite, standard PDF, JSON-LD for graphs).
10. **Explicit consent required before export, sync, or sharing.** No defaults that leak data.
11. **The app must work fully offline.** Airplane mode is the default test.

Companion principles:
- **Transparency over polish.** Show the user what is happening, where data lives, and what the AI is reading.
- **Cite or stay silent.** The AI never asserts a personal fact without a document reference.
- **User-correctable.** Every extracted field can be edited; corrections are preserved.
- **Reversible by design.** Every action — import, edit, delete — has an undoable audit entry.

---

## 3. Core Product Features

### 3.1 Local secure document vault
An encrypted folder structure backed by SQLCipher and per-file encryption. Documents stored as originals (PDF/JPG/PNG/HEIC/DOCX) plus a derived OCR/text layer. Mounted in-app only when unlocked.

### 3.2 Local OCR
Platform-native first: Apple Vision on macOS/iOS, Windows OCR on Windows, ML Kit on Android. Tesseract or PaddleOCR as a fallback for low-end Linux. Output: full text, per-page bounding boxes, layout structure.

### 3.3 Local AI document classification
A small on-device classifier (distilled transformer, ~50–200MB) tags each document: passport, driver's license, tax form, utility bill, insurance policy, medical record, employment letter, etc. Confidence scored and user-correctable.

### 3.4 Local structured data extraction
Hybrid pipeline: regex/template matchers for common government documents + small local LLM for free-form extraction. Outputs typed fields (name, DOB, ID number, expiration date) with provenance.

### 3.5 Local personal knowledge graph
A typed graph of entities (Person, Document, Address, Account, Policy, Vehicle, Property) and relationships (issued_by, expires_on, belongs_to, supersedes). Enables "show me everything related to my mortgage" or "what documents mention my old address?"

### 3.6 Local semantic search
Hybrid: SQLite FTS5 for keyword + sqlite-vec or LanceDB for vector. Sub-second results on a 10,000-document vault. Filter by type, date, sensitivity, tag, profile.

### 3.7 Local question-answering
Retrieval-augmented generation entirely on-device. The local LLM receives only the user's question + retrieved snippets from their own vault. Answers always include source citations.

### 3.8 Local form auto-fill
Detects fillable PDF AcroForms and image-based forms. Matches fields to verified profile data. Generates a filled PDF locally. Never auto-submits.

### 3.9 Local reply drafting
Drafts cover letters, appeal letters, insurance claim responses, school forms — using verified personal facts as grounding. Output is a draft the user reviews and copies.

### 3.10 Local document summarization
TL;DR of long documents (insurance policies, leases, contracts), with key terms, dates, and obligations extracted.

### 3.11 Local reminders
Scheduled notifications for: passport/license/visa expirations, insurance renewals, bill due dates, claim follow-ups, appointments, tax deadlines, and "missing document" flags (e.g., "you have a new vehicle but no insurance document on file").

### 3.12 Local identity profile management
Multiple profiles per vault: self, spouse, child, parent, dependent, business entity. Each with its own document set and extracted facts.

### 3.13 Local audit history
Every read, write, edit, export, and AI query is logged locally with timestamp and which document was touched. Tamper-evident via hash chain.

### 3.14 Local backup and encrypted export
One-click encrypted backup to user-chosen location (external drive, NAS, USB, optional iCloud/Dropbox as encrypted blob). Restore on a new device with master password.

### 3.15 Optional manual import
From local folders, ZIP archives, email exports (.mbox, .eml), cloud-drive downloads (user manually downloads, then imports). Watched-folder mode for power users.

### 3.16 Optional offline model download and management
Model Manager lets users download, switch, and delete on-device LLMs, OCR models, and classifiers. Downloads use the network only at the user's explicit click.

---

## 4. User Flows

### 4.1 First-time onboarding
1. Welcome screen: **"Everything you do here stays on this device."**
2. Three-card primer: *What OctoVault is*, *How privacy works*, *What it can't do*.
3. Network indicator shown live: "Network connections from this app: 0."
4. "Create your vault" CTA.

### 4.2 Creating a local encrypted vault
1. Choose vault location (default: app sandbox; advanced: any local folder).
2. Set master password (entropy meter, no minimum-strength bypass).
3. Optional biometric unlock (Touch ID / Face ID / Windows Hello).
4. Generate and display 24-word recovery phrase. User must confirm physical write-down before continuing.
5. Vault initialized; encryption keys derived via Argon2id from password.

### 4.3 Importing documents
1. Drag-and-drop folder or files into vault.
2. Live indexing progress: "Reading… OCR… Classifying… Indexing…" with per-file status.
3. Estimated time and "you can keep using the app" reassurance.
4. On completion: summary card ("Imported 134 documents, identified 12 types, extracted 287 fields, 4 need review").

### 4.4 Scanning physical documents
1. Mobile: native camera with edge detection and auto-capture.
2. Multi-page batching, perspective correction, contrast normalization, all on-device.
3. Save directly to vault, with same indexing pipeline as imports.

### 4.5 Asking a personal question
1. Assistant screen with single input: "Ask anything about your documents."
2. Example chips: "When does my passport expire?", "What's my policy number?", "Show me all tax forms from 2024."
3. Response includes inline citations: "Your passport expires **March 14, 2028**. *Source: Passport_2018.pdf, page 1. Confidence: High.*"
4. Click citation → opens document at the exact page and field.

### 4.6 Filling a PDF form
1. User opens a PDF form inside OctoVault.
2. AI scans fields and proposes values from the active profile.
3. Each field shows: proposed value, source document, confidence.
4. User clicks ✓ to accept, ✎ to edit, ✗ to skip.
5. Low-confidence fields highlighted yellow; user-required fields red.
6. "Generate filled PDF" produces a local file. No upload.

### 4.7 Managing identity profiles
1. Profiles screen: cards for Self, Spouse, Child, etc.
2. Each profile shows extracted facts grouped by category.
3. Tap a fact to see its source, history of corrections, and confidence.
4. Switch active profile via global selector — all subsequent AI answers scope to that profile.

### 4.8 Field-level privacy settings
1. Default sensitivity tiers: Public, Personal, Sensitive, Highly Sensitive (e.g., SSN, passport number).
2. Highly Sensitive fields require re-auth (password or biometric) to view or copy.
3. Per-document override available.

### 4.9 Getting a reminder
1. Local notification: "Your driver's license expires in 30 days. Tap to see renewal checklist."
2. In-app, the document opens with a draft checklist of required supporting documents (pulled from vault).

### 4.10 Drafting a reply
1. User pastes or imports an email/letter they received.
2. AI summarizes and proposes a reply, grounded in vault data.
3. Output is a draft text block the user copies or exports as a PDF letter.

### 4.11 Exporting an encrypted backup
1. Security Center → "Create encrypted backup."
2. Choose destination (external drive, folder).
3. Backup is a single `.octovault` file encrypted with the master password.
4. Show estimated size, hash, and restore instructions.

### 4.12 Moving the vault to another device
1. Install OctoVault on new device.
2. Choose "Restore from backup."
3. Select `.octovault` file (transferred via USB, AirDrop, or user's own cloud — OctoVault doesn't move it).
4. Enter master password + recovery phrase if needed.
5. Vault restored, indexes rebuilt locally.

---

## 5. UX/UI Direction

### 5.1 Screens

**Home Dashboard.** Three zones: *Vault Health* (document count, last index, last backup), *Attention* (expirations within 60 days, low-confidence fields needing review, missing-document flags), *Quick Actions* (Ask, Import, Scan, Fill a Form).

**Local Vault Screen.** Library view with filters (type, profile, date, sensitivity). Grid and list modes. Inline thumbnails.

**Document Detail Screen.** Left: rendered document with highlighted extracted fields. Right: extracted data, source confidence, related documents, audit history. Bottom: actions (re-extract, redact, export, delete, mark verified).

**AI Assistant Screen.** Single input, persistent chat history (stored locally and encrypted), each answer carries citations as tappable chips. A small "Reading: 3 documents" indicator shows retrieval scope.

**Form-Fill Screen.** Two-pane: form preview on left, field-by-field review on right. Color-coded confidence. "Approve all high-confidence" shortcut. Final "Generate filled PDF" button is the only path to a completed file.

**Profile Screen.** Identity facts grouped (Personal, Contact, Government IDs, Financial, Medical, Family). Each fact shows value, source pill, verified date, edit history.

**Security Center.** Master password rotation, biometric toggles, app lock timeout, secure-wipe button, backup/restore, audit log viewer, network monitor ("0 outbound connections in the last 24 hours").

**Local Model Manager.** Installed models with size, version, last used. "Download" / "Remove" / "Set as default." Disk usage chart.

**Reminder Center.** Calendar + list view of upcoming expirations, deadlines, renewals.

**Search Experience.** Cmd+K global search. Results unified across documents, facts, profiles, reminders. Type-ahead with category badges.

**Import / Indexing Progress Screen.** Per-file pipeline stages (Read → OCR → Classify → Extract → Index), with retry on failure and a "view errors" link.

### 5.2 Platform principles

**Mobile-first design** for capture and quick answers. Bottom tab nav: Vault, Ask, Scan, Profile, Settings. Large tap targets. One-thumb operation for common reads.

**Desktop layout** for heavy use: management, form-filling, bulk import. Three-column structure (nav rail, list, detail) — Mail-app pattern. Keyboard shortcuts throughout.

### 5.3 Visual style

- **Palette.** Deep ink (`#0E1116`) primary surface; warm parchment (`#F5EFE3`) for document canvases; brass accent (`#C2A661`) for the "vault" feel; signal colors muted (success `#3A8C5C`, warn `#C28D2E`, danger `#B8503C`). The palette deliberately avoids the bright-teal/electric-blue look of consumer cloud apps.
- **Typography.** Inter or Söhne for UI; a serif (Source Serif, Tiempos) for document content and AI answers — to give responses the gravity of a written document, not a chat bubble.
- **Iconography.** Custom line set with a slight engraved feel. Vault, key, eye-off, shield, citation, badge.
- **Interaction.** Calm motion (200–300ms eases), no springy bounces. Subtle haptics on mobile for state changes. No celebratory confetti — this is a serious tool.
- **Tone of voice.** Direct, quiet, factual. "Your passport expires March 14, 2028." Not "Hey! 🎉 Found it!"

### 5.4 Trust reinforcement

Persistent UI elements that constantly remind the user of the local-only promise:

- Top-bar pill: **● Offline · Stored locally** (turns to **○ Online** only if user enables an explicit network feature).
- AI answer footer: **Processed on this device · No cloud connection**.
- Citation chip: **Source: Passport.pdf · p.1 · Confidence: High**.
- Field state badges: **Verified · Needs review · Outdated · Conflict**.
- Network monitor in Security Center showing the count of outbound connections (target: zero).

---

## 6. AI Behavior

### Operating rules
1. **Answer only from verified local documents** when the user asks a personal-fact question. If no document supports the answer, say so explicitly.
2. **Always cite.** Every personal claim includes document name, page, and field reference.
3. **Confirm before acting.** Filling, exporting, generating a PDF, drafting a reply — all require an explicit user action. The AI proposes; the user disposes.
4. **Never invent personal information.** Hallucinated names, numbers, or dates are the cardinal sin. Refusal is preferred to fabrication.
5. **Flag problems.** Missing documents, conflicting values (two addresses, two phone numbers), outdated records (expired passport), and low-confidence extractions are surfaced — not hidden.
6. **Distinguish fact types.**
   - *Verified*: extracted from a document, confirmed by user or high-confidence OCR.
   - *Inferred*: derived (e.g., age from DOB).
   - *User-entered*: typed by the user without document support.
   - *Conflicting*: multiple sources disagree.
7. **Show confidence.** Numeric or High/Medium/Low, with the underlying signals available on tap.
8. **Sensitive by default.** SSN, passport numbers, financial account numbers redacted in previews; revealed only on explicit reveal action.
9. **Refuse unsafe requests.** Generating fraudulent documents, impersonating another person's identity, filling forms with another's data without their profile, helping evade legal process — all declined with a clear explanation.
10. **Be honest about limits.** "I don't have a document that shows your current bank balance" is better than guessing.
11. **Accept corrections.** When the user fixes an extracted value, save the correction, propagate it to dependent answers, and increase confidence on the new value.

### Prompt scaffolding (engineering note)
The system prompt for the local LLM enforces:
- "You are a private assistant. The user's data is local. Never claim to send or receive anything externally."
- "Cite every personal claim. If you cannot cite, say so."
- "When asked to fill or export, return a structured proposal — never finalize without user confirmation."

---

## 7. Privacy and Security Model

### 7.1 Cryptography
- **At rest.** SQLCipher (AES-256) for the metadata DB and embeddings index. Per-file AES-GCM encryption for document originals.
- **Key derivation.** Argon2id from master password (cost calibrated to ~500ms on target hardware).
- **Secure enclave integration.** Master key wrapped by Secure Enclave (macOS/iOS), TPM (Windows), or StrongBox/Keystore (Android). Biometric unlock unwraps the wrapping key without exposing the master.
- **Field-level encryption.** Sensitive fields (SSN, passport number, account numbers) encrypted with a per-field key derived from a secondary unlock factor.

### 7.2 Authentication
- Master password (mandatory).
- Biometric unlock (optional, layered on master).
- Optional second factor for app open: hardware key (YubiKey via WebAuthn) or TOTP.
- Configurable app-lock timeout (default 5 minutes idle).
- Re-auth required for: viewing Highly Sensitive fields, exporting, changing security settings, secure wipe.

### 7.3 Indexes and embeddings
- **Local only.** Vector index (sqlite-vec or LanceDB) lives inside the encrypted vault.
- **No external embedding APIs.** Embeddings generated by a bundled local model.
- **Index is encrypted at rest** along with the rest of the vault.

### 7.4 Logging
- Audit log is local, encrypted, hash-chained for tamper evidence.
- No remote logging of document contents, queries, or user identifiers.
- Crash reports are opt-in, contain only stack traces with paths and content stripped.

### 7.5 OS-level protections
- Secure clipboard: copied sensitive values auto-clear after 30 seconds; flagged as non-syncable where the OS supports it (e.g., `NSPasteboardTypeTransient` on macOS, `EXTRA_IS_SENSITIVE` on Android).
- Screenshot protection on screens showing sensitive fields where the OS permits (`FLAG_SECURE` on Android, screen recording detection on iOS, blur-on-lose-focus on macOS).
- Redaction mode: a single toggle replaces all sensitive values with `••••` for screen sharing.

### 7.6 Backups
- Backups are encrypted single-file blobs (`.octovault`).
- Restore requires the master password; recovery phrase covers password loss.
- User chooses destination — OctoVault never uploads.

### 7.7 Delete and wipe
- Soft delete with 30-day local trash.
- Hard delete: overwrites file regions and removes index entries.
- Secure wipe: destroys the entire vault, including derived keys, after triple confirmation.

### 7.8 Threat model

| Threat | Mitigation |
|---|---|
| **Lost or stolen device** | Full-vault encryption; biometric/password unlock; remote wipe via OS (Find My, etc.) — OctoVault adds no override path. |
| **Malware on device** | Memory-protected key handling; no plaintext export without re-auth; OS-level sandboxing (App Sandbox, Android scoped storage). |
| **Shoulder surfing** | Redaction mode; sensitive fields masked by default; screenshot/recording protection. |
| **Malicious documents** | Sandboxed PDF/image parsers; no script execution; OCR runs in isolated process where possible. |
| **Accidental sharing** | Every export requires explicit confirmation with a preview; sensitive fields shown as redacted unless the user unmasks them. |
| **Supply-chain attack** | Signed releases; reproducible builds (goal); SBOM published; auto-update is opt-in and signature-verified. |
| **Coerced unlock** | Optional duress password that opens a decoy vault and triggers a silent wipe of the real one (advanced setting). |

---

## 8. Data Structure

### 8.1 Entity types (extracted and stored locally)

**Personal identity:** full legal name, preferred name, prior names, DOB, place of birth, gender, nationality, marital status.

**Contact:** address history (with date ranges), phone numbers, email addresses.

**Government IDs:** passport (number, issuing country, issue/expiry), national ID, driver's license, residence permit, visa, tax IDs (SSN, ITIN, TIN, equivalents).

**Employment:** employer, role, start/end dates, salary, employment letters.

**Financial:** bank accounts, credit cards (masked), investment accounts, loans, mortgages.

**Insurance:** health, dental, vision, auto, home, life, disability — policies with insurer, policy number, coverage, premium, renewal date.

**Medical:** conditions, medications, allergies, immunizations, providers, insurance card details.

**Education:** institutions, degrees, dates, transcripts, certifications.

**Vehicles:** make/model/year, VIN, registration, insurance link.

**Property/rental:** address, ownership/rental status, lease dates, mortgage link.

**Family:** dependents and relatives as separate profiles or linked entities; emergency contacts.

**Document-derived events:** expirations, renewal deadlines, claim numbers, case numbers, appointment dates.

### 8.2 Per-field metadata

Every extracted value carries:
```
{
  value,
  type,
  source_document_id,
  page_number,
  bbox,                    // pixel coordinates on the page
  extraction_method,       // "regex" | "template" | "llm" | "user_entered"
  confidence,              // 0.0–1.0
  last_verified_at,
  expires_at,              // nullable
  sensitivity,             // "public" | "personal" | "sensitive" | "highly_sensitive"
  correction_history       // [{prev_value, new_value, by, at}]
}
```

### 8.3 Handling tricky cases

- **Sensitive fields** are encrypted with a separate key and masked in all UI by default.
- **Conflicting values** are stored side-by-side with sources; the user chooses canonical, or the system picks most-recent + highest-confidence and flags it.
- **Outdated records** (e.g., expired passport) remain in the vault for historical reference but are marked Outdated and excluded from autofill unless the user opts in.
- **Missing fields** trigger a profile-completeness checklist with suggestions ("Add a utility bill to verify your current address").
- **Duplicate documents** detected by content hash + perceptual hash for images; user prompted to keep, merge, or delete.
- **Multiple identities** are first-class profiles with isolated extracted-fact sets; users can scope queries to a profile or query across profiles explicitly.

---

## 9. Local Form-Filling Engine

### Pipeline
1. **Detect.** Parse PDF AcroForm fields directly; for flat PDFs and images, run layout detection (LayoutLM-style small model) + OCR to recover field labels and input regions.
2. **Classify fields.** Map each detected field to a canonical schema entry ("First Name", "DOB", "Passport Number", "Address Line 1").
3. **Resolve values.** Look up canonical entries in the active profile's verified facts. Fall back to user prompt for missing data.
4. **Score.** Each field gets a confidence score combining detection confidence × match confidence × source confidence.
5. **Propose.** UI presents proposed values with source and confidence; user reviews.
6. **Generate.** On user approval, render a filled PDF locally (pdf-lib / PDFBox / PyMuPDF). Save to vault as a draft.
7. **Export.** User decides where the completed PDF goes — email, print, manual upload. OctoVault never submits.

### Multi-profile support
A single form may need data from multiple profiles (e.g., a school form needs parent + child). The form-fill UI lets users assign each field to a profile, with smart defaults (the form's likely "applicant" profile is detected from context).

### Local web forms
Where technically feasible (a desktop browser companion extension communicating only over localhost to the OctoVault app), suggest autofill on detected forms. The extension carries no data itself; the local app provides values on demand. Initially out of MVP scope.

---

## 10. Local Technical Architecture

### Stack recommendation

| Layer | Choice (MVP) | Rationale |
|---|---|---|
| **Desktop shell** | Tauri (Rust + system webview) | Small binary, native performance, strong security model, good for shipping fast across macOS/Windows/Linux. |
| **UI framework** | React + TypeScript in Tauri's webview | Familiar; reusable for mobile via React Native or as a PWA companion. |
| **Mobile** | Swift (iOS) + Kotlin (Android), native | OS integrations (Vision, ML Kit, Secure Enclave, StrongBox) are first-class; performance and battery matter. Defer mobile to post-MVP. |
| **Local DB** | SQLite + SQLCipher | Battle-tested, portable, encrypted, easy to back up as a single file. |
| **Full-text search** | SQLite FTS5 | In-process, fast, no extra dependency. |
| **Vector index** | sqlite-vec (preferred) or LanceDB | sqlite-vec keeps everything in one DB file. LanceDB if vector counts grow large. |
| **OCR** | Apple Vision (macOS/iOS), Windows.Media.Ocr (Windows), ML Kit (Android); Tesseract fallback for Linux | Native engines are fast, accurate, and zero-shipping-cost. |
| **Embedding model** | bge-small-en or multilingual-e5-small (ONNX) | ~100–200MB, runs on CPU under 100ms per chunk. |
| **Local LLM** | Llama 3.x 8B (Q4_K_M), Phi-3.5-mini, Qwen2.5 7B — user-selectable | Cover both quality (8B+) and low-end (3–4B) tiers. |
| **Inference runtime** | llama.cpp (cross-platform), MLX (Apple Silicon), ONNX Runtime (Windows DirectML), Core ML (iOS) | Pick best runtime per platform; abstract behind a shared interface. |
| **Structured extraction** | Hybrid: regex/template library + local LLM constrained decoding (grammar/JSON schema) | Templates are deterministic for known docs (passports, common tax forms); LLM handles the long tail. |
| **Knowledge graph** | SQLite tables + a thin graph query layer | Avoid Neo4j-style overhead for personal-scale data. |
| **Form parser** | pdf.js / pdf-lib for AcroForms; LayoutLM-small for image forms | Mature for PDFs; image forms are the harder case and the differentiator. |
| **Scheduler/reminders** | OS-native (launchd, Windows Task Scheduler, AlarmManager, BGTaskScheduler) | Survives app restarts; minimal battery cost. |
| **Notifications** | OS-native | Same reasons. |
| **Model manager** | Custom; signed manifests, resumable downloads, SHA-256 verification | Models are the largest assets; manage them well. |
| **Encryption** | SQLCipher for DB; libsodium (secretstream) for file streams; OS keychain for wrapping keys | Standard, audited primitives. |

### Hardware targets

| Tier | Spec | Experience |
|---|---|---|
| **Minimum** | 8GB RAM, 256GB SSD, modern CPU (last 5 years) | OCR + retrieval + small LLM (3–4B Q4). Q&A in 3–8s. |
| **Recommended** | 16GB RAM, Apple Silicon or modern x86, 512GB SSD | 8B LLM at usable speed; sub-second search. |
| **Best** | 32GB+ RAM, dedicated GPU or Apple Silicon Pro/Max | 8B+ LLM at chat speed; fast batch indexing. |

### Performance targets (recommended hardware)
- Import + OCR + index: ~2–5 sec/page.
- Semantic search: <300ms for top-20 over 10k documents.
- LLM first token: <1.5s; ~20 tokens/sec sustained on Apple Silicon M-series.
- Form fill proposal: <3s for a 20-field form.

### Offline installation
- Installer bundles the app + a default small model (≤500MB).
- Additional models downloaded on user click from a signed manifest; downloads are resumable and verifiable.
- Fully airgapped install path: a signed ZIP a user can sideload from USB.

### Quantization strategy
- Default to Q4_K_M for LLMs (good quality/size balance).
- Offer Q5/Q6 for high-end hardware; Q3 for low-end fallback.
- Embedding models in FP16 or INT8 ONNX.

### Secure update mechanism
- Sparkle (macOS), MSIX (Windows), Play Store (Android), App Store (iOS).
- All updates code-signed and notarized; update channels (stable, beta) opt-in.
- Update process never reads vault contents.
- Models updated separately from app code, also signed.

---

## 11. MVP Scope

### Must-have (90-day MVP)
1. Encrypted local vault on **macOS and Windows desktop**.
2. Import from local folders; manual file add.
3. Local OCR for PDFs and images.
4. Local document classification (top 15 document types).
5. Local structured extraction for: passport, driver's license, US SSN card, common utility bill, simple insurance card, W-2 / paystub.
6. Local semantic search + keyword search.
7. Local Q&A with citations using a bundled 7–8B LLM.
8. Local PDF form fill (AcroForms only).
9. Single profile (self).
10. Expiration reminders.
11. Encrypted backup + restore.
12. Security Center with network monitor.

### Deliberately deferred
- Mobile apps (post-MVP; iOS first, six months out).
- Image-form fill (layout detection is hard; AcroForms first).
- Browser extension for web forms.
- Multi-profile / family / business.
- Knowledge graph visualization.
- Email mailbox import (.mbox parsing).
- LAN sync between devices.
- Drafting / summarization (release as v1.1 once Q&A is solid).
- Linux support.

### First platforms
- macOS 13+ (Apple Silicon and Intel).
- Windows 11 (x64, with DirectML for GPU acceleration where available).

### Minimum hardware for MVP
- 8GB RAM, modern CPU. Default to a 3–4B LLM on minimum hardware; auto-suggest 8B on 16GB+.

### First document types
Passport, driver's license, national ID, US SSN card, utility bill, lease, mortgage statement, paystub, W-2, 1099, health insurance card, auto insurance card, vehicle registration, school enrollment letter, employment verification letter.

### First forms
US I-9, US W-4, US W-9, common school enrollment forms, common DMV forms, common rental applications, generic medical intake forms, US passport renewal (DS-82).

### First AI workflows
Q&A, expiration reminders, form fill.

### First security features
Master password, biometric unlock, encrypted backup, redaction mode, secure clipboard, audit log.

### Launch strategy
1. **Closed beta (months 1–2).** 50–100 users from privacy-conscious communities (Hacker News, r/privacy, Lobsters, Mastodon). Free in exchange for structured feedback.
2. **Public beta (month 3).** Paid early-access at a discount ($49 lifetime for first 1,000 buyers). Build the trust narrative publicly: open SBOM, signed binaries, third-party security review committed.
3. **GA (month 4).** Full price; macOS App Store + direct download; Windows direct download + Microsoft Store.

### 90-day roadmap

| Days | Milestone |
|---|---|
| 0–15 | Vault skeleton, encryption, import pipeline, OCR integration on macOS. |
| 16–30 | Classification + extraction for top 5 document types; embeddings + search. |
| 31–45 | Local LLM Q&A with citations; Windows build; basic UI. |
| 46–60 | AcroForm fill; reminder engine; Security Center; encrypted backup. |
| 61–75 | Closed beta; iterate on feedback; performance pass. |
| 76–90 | Public beta; pricing live; launch content (landing page, demo video, security overview). |

### Key metrics
- **Activation.** % of new users who import ≥10 documents in week 1.
- **Q&A success.** % of asked questions answered with a citation.
- **Extraction accuracy.** Per-field precision/recall on a held-out test set.
- **Form-fill acceptance.** % of proposed fields accepted without edit.
- **Retention.** Week-4 active use; reminders fired and acted on.
- **Trust signals.** Network monitor stays at zero; no support tickets about "did you upload my data?"
- **Revenue.** Conversions, refund rate, LTV.

### Biggest risks
1. **Model quality on consumer hardware.** A 3–4B LLM may answer poorly enough to undermine trust. *Mitigation:* hybrid template + LLM extraction; ship 7–8B as the default on capable hardware; clear UI when the AI is uncertain.
2. **Form-fill accuracy on image PDFs.** Layout detection is the hardest model. *Mitigation:* AcroForms only at MVP; treat image-form fill as a v2 differentiator.
3. **Indexing time on large libraries.** First-time import of 1,000+ documents could take an hour. *Mitigation:* background indexing, clear progress, "you can keep using it" UX.
4. **User loses master password.** Recovery phrase is the only path. *Mitigation:* mandatory recovery-phrase confirmation at onboarding; optional Shamir-style split for advanced users.

### How to test demand quickly
- Landing page with the tagline and a 60-sec demo video; capture emails for closed beta.
- Post a working demo on Hacker News / Show HN focused on the privacy guarantee. Measure: signups per visitor, willingness to pay at $49/$99/$149 price points (A/B in waitlist form).
- Run 20 user interviews with the ICP segments; ship the single feature most consistently asked for first.

---

## 12. Business Model

### Pricing structure

| Tier | Price | Includes |
|---|---|---|
| **OctoVault Personal** | **$99 one-time** | Full app, single profile, all core features, 1 year of updates. |
| **OctoVault Pro** | **$149 one-time** | Personal + multi-profile (up to 5), advanced extraction, priority email support, 2 years of updates. |
| **OctoVault Family** | **$199 one-time** | Up to 6 profiles, family-shared reminder calendar, on 5 devices. |
| **OctoVault Small Business** | **$299/year** per seat | Multi-entity profiles, business-document templates, audit-log export, business-grade support. |
| **Optional model packs** | **$29 each** | Curated, larger, or specialty models (legal, medical, multilingual) — one-time. |
| **Optional self-hosted sync server** | **$79 one-time** | A small app a user runs on their own Mac/PC/NAS to sync encrypted vaults across their devices on their LAN. |
| **Optional enterprise deployment** | Contact sales | MDM-friendly install, central policy, no SaaS dependency. |
| **Support plan** | **$49/year** | Priority email/video support; not required to use the product. |

### Why these defaults
- **One-time over subscription** is the trust signal. A subscription quietly implies "we need to keep being valuable enough" — fine for SaaS, wrong for a vault. The user's expectation should be: I own it.
- **Paid updates** (year 1 free, year 2 discounted upgrade) are how the business stays alive without subscription.
- **Sync as a separate paid add-on** keeps the base product honest about its local-only promise.

### Retention strategy
- Quality of extraction and Q&A drives daily usefulness.
- Reminders bring the user back without push-notification spam.
- Family/Small Business plans create switching cost via shared profile data.
- Annual paid major updates create a natural revenue cadence.

### Trust building without cloud lock-in
- **Open SBOM** published per release.
- **Signed binaries** + verifiable reproducible builds (goal by v1.0).
- **Third-party security audit** within 12 months of GA, with the report published.
- **Open-source the local-only audit tooling** (the network monitor logic, the audit-log verifier) so users can verify claims themselves.
- **No analytics by default**; if enabled, fully documented, content-free.
- **Clear data-portability story**: vault is SQLite, documents are originals, extracted data exports to JSON.

---

## 13. Competitive Analysis

| Category | Examples | Their gap |
|---|---|---|
| **Cloud storage** | Google Drive, iCloud, Dropbox | No structured understanding of documents; users still hunt for files; vendor reads the data. |
| **Password managers** | 1Password, Bitwarden | Excellent for credentials; weak for documents, identity fields, forms, and reasoning. |
| **Document scanner apps** | Adobe Scan, Scanner Pro, Microsoft Lens | Good capture; weak organization, no AI Q&A, often cloud-backed. |
| **Local note apps** | Obsidian, Apple Notes (local), Bear | General notes, not document-aware; no extraction, no forms, no expirations. |
| **Personal finance apps** | Monarch, Copilot, Mint successors | Narrow to transactions; not designed for ID, paperwork, or forms. |
| **AI chatbots** | ChatGPT, Claude, Gemini | Powerful, but cloud — exactly what OctoVault rules out for personal data. |
| **Form-filling browser extensions** | 1Password autofill, Chrome autofill | Trivial fields only; can't fill PDFs from arbitrary documents. |
| **Enterprise document AI** | Docusign Insight, Hyperscience, AWS Textract | Built for businesses; complex, cloud-first, expensive. |
| **Local LLM tools** | Ollama, LM Studio, GPT4All, Jan | Generic chat UIs; no document pipeline, OCR, extraction, or forms. |
| **Encrypted personal vaults** | Cryptomator, Standard Notes | Storage and notes; no AI, no extraction, no form-fill. |

### Where OctoVault is defensible
1. **The only product combining: (a) on-device LLM + RAG, (b) document understanding pipeline, (c) hard local-only stance, (d) life-admin features (forms, reminders, profiles).** Competitors do 1–2; OctoVault does all four.
2. **Brand permission.** "No cloud, no servers" is a one-sentence moat against any cloud-AI incumbent that would have to dismantle their business model to match it.
3. **Distribution alignment.** Privacy-conscious users are already collected in identifiable communities; OctoVault is built for them, not against them.
4. **Hardware tailwind.** On-device AI quality is improving every quarter (Apple Intelligence, Copilot+ PCs, Qualcomm NPUs). OctoVault rides that wave without depending on any one vendor.

---

## 14. Landing Page Copy

### Hero
> # Your private AI for personal paperwork.
> ### Scan, understand, and answer questions about your documents — entirely on your device. No cloud. No servers. No data harvesting.
>
> **[ Download for Mac and Windows ]**   **[ See how it works ]**

### Five benefit sections

**1. Ask anything about your own documents.**
"When does my passport expire?" "What's my policy number?" "Show me every tax form from 2024." OctoVault reads your documents on your device and answers with citations.

**2. Auto-fill forms without re-typing.**
OctoVault recognizes form fields and fills them from your verified documents. You review every field before anything is generated. Nothing is submitted automatically.

**3. Never miss a renewal again.**
Passports, licenses, insurance, visas, bills. OctoVault watches the expirations buried in your paperwork and reminds you locally — no calendar invites in someone else's cloud.

**4. One safe place for everyone's paperwork.**
Profiles for yourself, your partner, your kids, your parents, or your business. Switch contexts in a click. Each profile is its own organized library.

**5. Encrypted. On your device. Always.**
SQLCipher-backed vault. Master password + biometric unlock. Optional hardware key. Encrypted backups you control. We literally cannot read your data — because we never receive it.

### Trust / security section
> ### Built like a vault. Not like an app.
> - End-to-end encrypted storage with SQLCipher (AES-256).
> - Keys derived from your master password (Argon2id) and protected by your device's Secure Enclave / TPM.
> - Biometric unlock optional, layered on your password.
> - Encrypted vector index — your AI memory is encrypted too.
> - Tamper-evident local audit log.
> - Independent security review committed within 12 months of launch. SBOM published every release.

### Local-only explanation
> ### What "local-only" actually means.
> - Your documents are never uploaded.
> - The AI runs on your CPU, GPU, or NPU. Not ours.
> - No cloud embeddings. No remote vector database. No third-party API calls with your content.
> - The Security Center shows you in real time: outbound network connections from OctoVault — *zero*.
> - Verify it yourself with Little Snitch, Windows Defender Firewall, or Wireshark.

### Comparison
| | OctoVault | Cloud document AI | Local password manager |
|---|---|---|---|
| Documents stay on device | ✓ | ✗ | ✓ |
| AI Q&A on your documents | ✓ | ✓ | ✗ |
| Form auto-fill from documents | ✓ | partial | ✗ |
| Encrypted local vault | ✓ | ✗ | ✓ |
| Works offline | ✓ | ✗ | ✓ |
| One-time purchase | ✓ | ✗ | ✗ |

### FAQ

**Can OctoVault see my documents?**
No. They never leave your device.

**Does the AI use ChatGPT or Claude?**
No. OctoVault uses open-weight models that run locally on your computer.

**What if I lose my master password?**
You'll need the 24-word recovery phrase you saved at setup. Without either, the vault cannot be opened — by us or anyone else.

**Can I sync across my devices?**
Yes, optionally — with our self-hosted sync app you run on your own Mac, PC, or NAS over your local network. No cloud step.

**What happens if your company shuts down?**
Your vault is a SQLite file you own. Your documents are standard PDFs. You can read them with or without OctoVault.

**Does it work without internet?**
Yes. Permanently. Airplane mode is a supported configuration.

### Short App Store description
> Your private AI for personal paperwork. OctoVault scans, organizes, and answers questions about your documents — all on your device. No cloud, no servers, no data harvesting. Fill forms, get expiration reminders, and find anything instantly across your IDs, taxes, insurance, medical records, and more.

### Longer website description
> OctoVault is a local-only personal AI vault for your most important paperwork. It scans and understands your documents on your device, lets you ask natural-language questions and get cited answers, fills out PDF forms from your verified personal data, and reminds you about expirations and deadlines — all without sending a single page to the cloud. Built on encrypted local storage, on-device AI models, and a strict no-server architecture, OctoVault is the first AI assistant designed for the documents you would never put in Google Drive.

---

## 15. Investor / Founder Pitch (10 slides)

1. **Problem.** Everyone has hundreds of personal documents scattered across folders, email, drives, and shoeboxes. They're impossible to search, painful to file forms from, and expire without warning.
2. **The trust gap in personal AI.** The most useful AI features require sending your data to a cloud. The most sensitive documents are the ones you'd least want to send. The market has shipped AI *or* privacy — never both.
3. **Solution.** OctoVault: a local-only personal AI vault that scans, understands, and answers questions about your documents on your device.
4. **Product.** Live demo: import a folder of IDs and bills, ask "when does my passport expire?", fill a US W-9 in one click — all offline.
5. **Why local-only wins.** On-device AI quality crossed the usefulness line in 2024–2025. Hardware is getting better quarterly (Apple Silicon, Copilot+ PCs, NPUs). Local-only is now a *feature*, not a compromise — and it's the one feature cloud incumbents cannot copy without dismantling their business model.
6. **Market.** 1B+ knowledge workers globally manage personal paperwork. Adjacent markets: password managers (~$3B), document scanner apps (~$1B), enterprise document AI (~$15B). Beachhead: 50–100M privacy-conscious early adopters in NA + EU.
7. **Business model.** One-time purchase ($99–$199), paid annual major updates, optional self-hosted sync ($79), optional model packs ($29). High-margin software with no per-user infra cost.
8. **Competitive landscape.** Cloud storage = dumb. Password managers = narrow. Cloud AI = unsafe for this data. Local LLM tools = no document pipeline. OctoVault sits in an empty quadrant.
9. **Go-to-market.** Founder-led launch into privacy communities → paid early access → content + demo + security audit → App Store + direct → expansion to family, then small business → mobile (iOS) → optional self-hosted sync.
10. **Vision.** OctoVault becomes the default private operating layer for personal identity, paperwork, and life admin — the way Bitwarden became default for credentials. Long term: open ecosystem of local-only personal AI tools, with OctoVault as the trusted vault at the center.

---

## 16. Final Recommendation

### Strongest positioning
**The first personal AI built like a vault, not like an app.** Lean entirely on the local-only promise. Every piece of copy, every screen, every status indicator reinforces it. Trust is the moat — protect it ferociously.

### Best MVP wedge
**Q&A with citations + AcroForm autofill on macOS and Windows desktop.** This is the smallest scope that demonstrates the full magic ("ask anything, fill anything, all offline") in a 60-second demo. Multi-profile, image-form fill, mobile, and sync are all next.

### Biggest technical risk
**On-device LLM quality on minimum-spec hardware.** A 3–4B model on a 5-year-old laptop may answer well enough to delight or poorly enough to embarrass. Mitigations: (1) hybrid template + LLM extraction for high-value document types so the *extraction* layer doesn't depend on the LLM; (2) auto-detect hardware and recommend the right model; (3) UI that surfaces uncertainty rather than hiding it.

### Biggest trust risk
**One verifiable leak ends the brand.** A library that phones home, an analytics SDK that captures content, a crash log that includes a snippet — any of these is fatal. Mitigations: (1) network-egress allowlist enforced in build; (2) automated test that fails CI if any non-allowlisted host is contacted during a full E2E run; (3) the in-app network monitor is also a public commitment device.

### Clearest go-to-market
**Founder-led launch into self-identifying privacy communities, anchored by a published security posture (SBOM, signed builds, audit commitment), with a single-price one-time purchase and a 60-second demo video that shows the entire local-only loop end-to-end.** Avoid paid acquisition until organic CAC is understood; this audience is reachable.

### Most important feature to get right first
**Citations.** Every personal-fact answer must reference a document, page, and field — and clicking the citation must open the exact source. This single feature is what converts "another chatbot" into "the trustworthy vault." Without it, OctoVault is indistinguishable from a local ChatGPT wrapper. With it, OctoVault is something the market has never seen before.

---

*End of document.*
