// OctoVault AI — marketing site. Single page, hairline-bordered, mono+serif.
// Every section uses a custom Visual component (not just an icon + copy) so
// the page itself demonstrates the product. The hero demo runs an animated
// browser+side-panel mock that cycles through the four real product phases:
//   0. empty side panel, empty form
//   1. drop a passport — extraction progress
//   2. facts populate in the panel + conflict surfaces
//   3. click ⬛ Fill — web-form fields populate from the graph

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle, ArrowRight, AtSign, Check, Download, FileText, Github, Loader2, Lock,
  Network, PanelRight, Pin, RotateCcw, ScanLine,
  ShieldCheck, Sparkles, Terminal, Trash2, Users, WifiOff,
} from "lucide-react";
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { OctoMark } from "./components/octo-mark";
import { track, identify } from "./analytics";

// ──────────────────────────────────────────────────────────────────────────────
// Top-level structure
// ──────────────────────────────────────────────────────────────────────────────

export function Landing() {
  return (
    <main className="min-h-screen bg-background text-foreground antialiased">
      <Nav />
      <Hero />
      <TrustLine />
      <HowItWorks />
      {/* Five fully-interactive deep-dive sections — one per primary feature.
          Each is a stand-alone whole-page section. No overview grid above,
          no duplicates — every feature appears exactly once. */}
      <FactsGraphPreview />     {/* #1 Knowledge graph (React Flow) */}
      <ConflictsSpotlight />    {/* #2 Conflicts + 3 views */}
      <ChatSpotlight />         {/* #3 Chat with citations */}
      <ChromeExtensionSection />{/* #4 Chrome extension — dedicated section */}
      <SecuritySpotlight />     {/* #5 Local · private · secure */}
      <Comparison />
      <Faq />
      <Cta />
      <Footer />
    </main>
  );
}

const NAV = [
  { label: "How it works", href: "#how" },
  { label: "Features",     href: "#features" },
  { label: "Verify",       href: "#verify" },
  { label: "FAQ",          href: "#faq" },
];

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-6">
        <a href="#" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <OctoMark className="h-5 w-5" /> OctoVault AI
        </a>
        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}
              className="text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              {n.label}
            </a>
          ))}
        </nav>
        <a href="#waitlist"
          data-attr="cta-nav-waitlist"
          className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-1.5 text-[13px] font-semibold text-background hover:bg-foreground/90">
          Join waitlist <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Hero — big confident type + animated browser/side-panel mock
// ──────────────────────────────────────────────────────────────────────────────

// Detects Apple Silicon vs Intel via the WebGL renderer string. Safari's
// fingerprinting defences blank this out, in which case we default to
// arm64 (the majority of new Macs since 2020).
function detectMacArch(): "arm64" | "x64" {
  if (typeof window === "undefined" || typeof document === "undefined") return "arm64";
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "arm64";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    if (typeof renderer === "string") {
      if (/Apple\s*(M[1-9]|VC|GPU)/i.test(renderer)) return "arm64";
      if (/(Intel|AMD|NVIDIA|Radeon)/i.test(renderer)) return "x64";
    }
  } catch { /* ignored — fall through to default */ }
  return "arm64";
}

const MAC_DOWNLOADS = {
  arm64: {
    url:    "https://github.com/CoderCouple/octo-vault-ai/releases/latest/download/OctoVault-0.0.1-arm64.dmg",
    label:  "Apple Silicon",
    size:   "115 MB",
    altUrl: "https://github.com/CoderCouple/octo-vault-ai/releases/latest/download/OctoVault-0.0.1.dmg",
    altLabel: "Intel Mac DMG",
  },
  x64: {
    url:    "https://github.com/CoderCouple/octo-vault-ai/releases/latest/download/OctoVault-0.0.1.dmg",
    label:  "Intel Mac",
    size:   "120 MB",
    altUrl: "https://github.com/CoderCouple/octo-vault-ai/releases/latest/download/OctoVault-0.0.1-arm64.dmg",
    altLabel: "Apple Silicon DMG",
  },
} as const;

function Hero() {
  const [arch, setArch] = useState<"arm64" | "x64">("arm64");
  const [downloading, setDownloading] = useState(false);
  useEffect(() => { setArch(detectMacArch()); }, []);
  const dl = MAC_DOWNLOADS[arch];

  // Spinner-only handler — does NOT preventDefault. Lets the browser
  // do its normal <a href download> thing (navigate to URL → see
  // Content-Disposition: attachment → download). Earlier attempts to
  // intercept with window.open / iframe / window.location.href all
  // broke the download for various subtle reasons; the default link
  // behaviour just works.
  function handleDownloadClick() {
    setDownloading(true);
    track("download_mac_clicked", { arch });
    window.setTimeout(() => setDownloading(false), 4000);
  }

  return (
    <section className="relative overflow-hidden bg-background">
      {/* Subtle grid backdrop, masked to fade at the edges. Pure border-color
          lines so it disappears in both light and dark themes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] [background-size:56px_56px] opacity-60 [mask-image:radial-gradient(ellipse_70%_55%_at_50%_30%,black_30%,transparent_75%)]"
      />
      <div className="relative mx-auto max-w-[1200px] px-6 pt-20 pb-10 text-center md:pt-28">
        <a
          href="https://github.com/CoderCouple/octo-vault-ai"
          target="_blank"
          rel="noreferrer"
          data-attr="cta-hero-pill-github"
          className="group mb-7 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-[11.5px] font-medium tracking-wide backdrop-blur transition-colors hover:border-foreground/50"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
          <span>Open source</span>
          <span className="opacity-40">·</span>
          <span className="font-mono text-[10.5px]">github.com/CoderCouple/octo-vault-ai</span>
          <ArrowRight className="h-3 w-3 opacity-50 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
        </a>
        <h1 className="mx-auto max-w-[820px] font-serif text-[34px] leading-[1.02] tracking-[-0.02em] md:text-[60px]">
          Your documents.
          <br />
          Your <span className="italic">knowledge graph</span>.
        </h1>
        <p className="mx-auto mt-7 max-w-[620px] text-[15.5px] leading-relaxed text-muted-foreground md:text-[17.5px]">
          OctoVault AI reads every PDF, image, and email on your device, links
          every fact to its source, and turns it all into a queryable graph
          that never leaves your laptop.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={dl.url}
            download
            onClick={handleDownloadClick}
            data-attr={`cta-hero-download-mac-${arch}`}
            aria-busy={downloading}
            className="inline-flex h-11 min-w-[230px] items-center justify-center gap-2 rounded-md bg-foreground px-6 text-[14px] font-semibold text-background shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_10px_30px_-12px_rgba(0,0,0,0.45)] transition-colors hover:bg-foreground/90"
          >
            {downloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting download…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" /> Download for Mac
                <span className="ml-0.5 rounded-sm border border-background/30 px-1 py-px text-[9.5px] font-bold uppercase tracking-wider opacity-80">Beta</span>
              </>
            )}
          </a>
          <a
            href="#waitlist"
            data-attr="cta-hero-waitlist"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-card/70 px-6 text-[14px] font-medium backdrop-blur transition-colors hover:bg-accent"
          >
            Join the waitlist <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        {/* Arch detection note + alt download link. The primary button
            tracks the visitor's Mac architecture; the alt link gives the
            other build for anyone whose detection failed or mismatched. */}
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          {dl.label} · {dl.size} ·{" "}
          <a
            href={dl.altUrl}
            download
            onClick={() => track("download_mac_clicked", { arch: arch === "arm64" ? "x64" : "arm64", source: "alt" })}
            data-attr={`cta-hero-download-mac-alt-${arch === "arm64" ? "x64" : "arm64"}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {dl.altLabel}
          </a>
        </p>
        {/* First-launch expectations — sets the user up so the Gatekeeper
            prompt feels expected, not alarming. */}
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          Unsigned beta — first open: <strong>right-click OctoVault → Open</strong>. macOS asks once, then launches normally.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11.5px] text-muted-foreground">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5">
            <span className="size-1.5 rounded-full bg-muted-foreground/40" /> Windows · coming soon
          </span>
          <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5">
            <span className="size-1.5 rounded-full bg-muted-foreground/40" /> Linux · coming soon
          </span>
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-3 w-3" /> 100% on-device
          </span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="h-3 w-3" /> Works offline
          </span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Terminal className="h-3 w-3" /> macOS Apple Silicon
          </span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-1.5">
            <PanelRight className="h-3 w-3" /> Chrome side panel
          </span>
        </div>
      </div>
      <div className="relative mx-auto max-w-[1200px] px-6 pb-24 md:pb-32">
        <HeroDemo />
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// HeroDemo — animated browser + side panel + web form, cycles through phases:
//   0: empty   1: import   2: extract   3: fill
// ──────────────────────────────────────────────────────────────────────────────

const HERO_PHASE_DURATIONS = [2800, 3200, 3600, 4200];

const HERO_PHASES = [
  { label: "Empty vault",   detail: "No documents yet" },
  { label: "Drop docs",     detail: "Drag in passport, license, utility bill" },
  { label: "Extract facts", detail: "Facts populate with source counts and conflict markers" },
  { label: "Fill the form", detail: "Click ⬛ Fill — every field maps from the graph" },
];

function HeroDemo() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase((p) => (p + 1) % HERO_PHASES.length), HERO_PHASE_DURATIONS[phase]);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_28px_70px_-22px_rgba(0,0,0,0.22)]">
        {/* Title bar */}
        <div className="flex h-9 items-center gap-3 border-b border-border bg-muted px-4">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-muted-foreground/40" />
            <span className="size-2.5 rounded-full bg-muted-foreground/40" />
            <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          </div>
          <div className="flex flex-1 justify-center">
            <div className="font-mono text-[10.5px] tracking-wider text-muted-foreground">
              visa-application.gov · with OctoVault AI panel
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-foreground" />
            {`0${phase + 1}/0${HERO_PHASES.length}`}
          </div>
        </div>
        {/* Body: form on the left, side panel on the right */}
        <div className="grid min-h-[440px] grid-cols-[1.4fr,1fr]">
          <BrowserPane phase={phase} />
          <SidePanelPane phase={phase} />
        </div>
      </div>
      {/* Phase stepper — click to jump; auto-advances forever. */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
        {HERO_PHASES.map((p, i) => {
          const isActive = i === phase;
          return (
            <button
              key={p.label}
              onClick={() => {
                setPhase(i);
                track("hero_demo_phase_clicked", { phase: i, label: p.label });
              }}
              title={p.detail}
              data-attr={`hero-phase-${i}`}
              className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11.5px] font-medium transition-colors ${
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border font-mono text-[9px] ${
                  isActive ? "border-background/60 text-background" : "border-border text-muted-foreground"
                }`}
              >
                {i + 1}
              </span>
              {p.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-center text-[10.5px] text-muted-foreground">
        Click a step to jump · auto-advances every few seconds
      </p>
    </div>
  );
}

const DEMO_FIELDS: Array<{ label: string; key: string; value: string; fillsAt: number }> = [
  { label: "First name",   key: "first",    value: "Sunil",                  fillsAt: 0 },
  { label: "Last name",    key: "last",     value: "Tiwari",                 fillsAt: 1 },
  { label: "Date of birth",key: "dob",      value: "1987-08-28",             fillsAt: 2 },
  { label: "Passport #",   key: "pp",       value: "X1234567",               fillsAt: 3 },
  { label: "Address",      key: "addr",     value: "221B Baker St, London",  fillsAt: 4 },
];

function BrowserPane({ phase }: { phase: number }) {
  // Phase 3: fill fields one by one.
  const [filledCount, setFilledCount] = useState(0);
  useEffect(() => {
    if (phase !== 3) { setFilledCount(0); return; }
    const id = setInterval(() => {
      setFilledCount((n) => (n >= DEMO_FIELDS.length ? n : n + 1));
    }, 480);
    return () => clearInterval(id);
  }, [phase]);

  return (
    <div className="border-r border-border bg-background p-5">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Visa application
        </span>
        {phase === 3 && filledCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-foreground/5 px-2 py-0.5 text-[10px] font-medium text-foreground">
            <Sparkles className="h-2.5 w-2.5" /> {filledCount}/{DEMO_FIELDS.length} filled
          </span>
        )}
      </div>
      <div className="space-y-2.5">
        {DEMO_FIELDS.map((f, i) => {
          const filled = phase === 3 && i < filledCount;
          return (
            <div key={f.key}>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {f.label}
              </label>
              <div className={`mt-0.5 flex h-8 items-center rounded-md border px-2.5 font-mono text-[12px] transition-all ${
                filled ? "border-foreground/60 bg-foreground/5 text-foreground" : "border-border bg-card text-muted-foreground"
              }`}>
                {filled ? f.value : ""}
                {filled && <Check className="ml-auto h-3 w-3" />}
              </div>
            </div>
          );
        })}
      </div>
      <button
        disabled={phase !== 3 || filledCount < DEMO_FIELDS.length}
        className={`mt-5 inline-flex h-9 w-full items-center justify-center rounded-md text-[13px] font-semibold transition-colors ${
          phase === 3 && filledCount === DEMO_FIELDS.length
            ? "bg-foreground text-background"
            : "border border-border bg-card text-muted-foreground"
        }`}
      >
        Submit
      </button>
    </div>
  );
}

const DEMO_DOCS = [
  { name: "passport.pdf",    type: "passport",       importAt: 0,    extractAt: 600 },
  { name: "license.jpg",     type: "drivers_license", importAt: 600, extractAt: 1200 },
  { name: "utility_bill.pdf",type: "utility_bill",   importAt: 1200, extractAt: 1800 },
];

const DEMO_FACTS = [
  { label: "Full Name",   v: "Sunil Tiwari",       src: 3, t: 200 },
  { label: "Date of Birth",v: "1987-08-28",        src: 2, t: 600 },
  { label: "Passport #",  v: "X1234567",           src: 1, t: 1000 },
  { label: "License #",   v: "ABC-1234",           src: 1, t: 1400 },
  { label: "Address",     v: "221B Baker St",      src: 3, t: 1800, conflict: true },
];

function SidePanelPane({ phase }: { phase: number }) {
  // Phase-1 progress
  const [imported, setImported] = useState(0);
  useEffect(() => {
    if (phase !== 1) { setImported(0); return; }
    const id = setInterval(() => setImported((n) => Math.min(n + 1, DEMO_DOCS.length)), 700);
    return () => clearInterval(id);
  }, [phase]);

  // Phase-2 fact reveal
  const [factCount, setFactCount] = useState(0);
  useEffect(() => {
    if (phase < 2) { setFactCount(0); return; }
    if (phase === 2) {
      const id = setInterval(() => setFactCount((n) => Math.min(n + 1, DEMO_FACTS.length)), 420);
      return () => clearInterval(id);
    }
    setFactCount(DEMO_FACTS.length);
  }, [phase]);

  const docsToShow = phase === 0 ? 0 : phase === 1 ? imported : DEMO_DOCS.length;
  const factsToShow = phase < 2 ? 0 : factCount;

  return (
    <div className="flex flex-col bg-card">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <OctoMark className="h-3.5 w-3.5" />
          <span className="text-[12px] font-semibold tracking-tight">OctoVault AI</span>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
          <WifiOff className="h-2.5 w-2.5" /> Local
        </span>
      </div>
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        {["Docs", "Facts", "Conflicts"].map((t) => (
          <div key={t} className="rounded-md px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground first:bg-foreground first:text-background">
            {t}
          </div>
        ))}
      </div>
      {/* Body */}
      <div className="flex-1 space-y-3 overflow-hidden p-3">
        {phase === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-md border border-dashed border-border p-6 text-center">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <p className="mt-2 text-[12px] font-medium">No documents yet</p>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              Drag a passport, license, or bill to start.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Documents
              </div>
              {DEMO_DOCS.slice(0, docsToShow).map((d, i) => (
                <DocPill key={d.name} doc={d} importing={phase === 1 && i === docsToShow - 1} />
              ))}
            </div>
            {phase >= 2 && (
              <div className="space-y-1.5">
                <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Extracted facts
                </div>
                {DEMO_FACTS.slice(0, factsToShow).map((f) => (
                  <FactPill key={f.label} fact={f} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {/* Fill button */}
      <div className="border-t border-border p-3">
        <button
          className={`inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold transition-all ${
            phase === 3 ? "bg-foreground text-background" : "border border-border bg-background text-muted-foreground"
          }`}
        >
          {phase === 3 ? <Sparkles className="h-3 w-3" /> : <OctoMark className="h-3 w-3" />}
          {phase === 3 ? "Filling form…" : "Fill this page"}
        </button>
      </div>
    </div>
  );
}

function DocPill({ doc, importing }: { doc: typeof DEMO_DOCS[number]; importing: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
      <FileText className="h-3 w-3 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{doc.name}</div>
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{doc.type}</div>
      </div>
      {importing && (
        <span className="size-2 animate-pulse rounded-full bg-foreground/60" />
      )}
    </div>
  );
}

function FactPill({ fact }: { fact: typeof DEMO_FACTS[number] }) {
  return (
    <div className={`rounded-md px-2 py-1 ${
      fact.conflict ? "border border-dashed border-muted-foreground bg-background" : "border border-border bg-background"
    }`}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{fact.label}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px]">{fact.v}</span>
        <span className="text-[9px] text-muted-foreground">{fact.src}×</span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Trust line — four chips
// ──────────────────────────────────────────────────────────────────────────────

function TrustLine() {
  return (
    <section className="border-y border-border bg-card/40">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-x-10 gap-y-3 px-6 py-5 text-[12px] text-muted-foreground">
        <Chip icon={WifiOff}>Offline by default</Chip>
        <Chip icon={Lock}>SQLCipher-encrypted vault</Chip>
        <Chip icon={Network}>0 outbound connections</Chip>
        <Chip icon={ShieldCheck}>Open-weight model only</Chip>
      </div>
    </section>
  );
}

function Chip({ icon: Icon, children }: { icon: React.ComponentType<React.SVGProps<SVGSVGElement>>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" /> {children}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// How it works — three steps, each with its own custom visual
// ──────────────────────────────────────────────────────────────────────────────

const STEPS = [
  { n: "01", title: "Drop your documents",
    body: "Passports, IDs, tax forms, utility bills, school letters. PDF or photo, text or scanned — on-device OCR handles every variant.",
    Visual: StepDropVisual },
  { n: "02", title: "Review the graph",
    body: "Every extracted fact is a node, linked to the document that produced it. Conflicts (differing addresses, red-flag DOBs) get flagged before anything else can use them.",
    Visual: StepGraphVisual },
  { n: "03", title: "Chat or fill",
    body: "Ask anything (\"when does Payal's passport expire?\") with cited answers. Or open the Chrome side panel on any web form and click ⬛ Fill.",
    Visual: StepFillVisual },
];

function HowItWorks() {
  return (
    <section id="how" className="border-t border-border bg-background">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <SectionEyebrow>How it works</SectionEyebrow>
        <SectionTitle>Three steps from drop to filled form.</SectionTitle>
        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-background p-6 md:p-7">
              <s.Visual />
              <div className="mt-6 flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-widest text-muted-foreground">{s.n}</span>
              </div>
              <h3 className="mt-2 text-[19px] font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Each visual loops its own CSS keyframes — no JS, no deps, no global CSS.
// Animation durations are coordinated so all three feel "alive" at the same
// rhythm (~6s cycle).

function StepDropVisual() {
  return (
    <div className="relative h-[140px] overflow-hidden rounded-lg border border-border bg-card p-3">
      <style>{`
        @keyframes step1-drop-passport {
          0%        { transform: translate(70px, -45px) rotate(22deg); opacity: 0; }
          12%, 68%  { transform: translate(0, 0) rotate(6deg); opacity: 1; }
          82%       { transform: translate(-8px, 18px) rotate(-2deg); opacity: 0.5; }
          95%, 100% { transform: translate(-20px, 50px) rotate(-12deg); opacity: 0; }
        }
        @keyframes step1-drop-license {
          0%, 25%   { transform: translate(-55px, 35px) rotate(-18deg); opacity: 0; }
          38%, 78%  { transform: translate(0, 0) rotate(-4deg); opacity: 1; }
          90%       { transform: translate(12px, -12px) rotate(4deg); opacity: 0.5; }
          100%      { transform: translate(28px, -32px) rotate(14deg); opacity: 0; }
        }
        @keyframes step1-zone-pulse {
          0%, 100% { border-color: hsl(var(--muted-foreground) / 0.4); }
          20%, 60% { border-color: hsl(var(--foreground) / 0.55); }
        }
      `}</style>
      <div
        className="absolute inset-3 flex flex-col items-center justify-center rounded-md border border-dashed text-center"
        style={{ animation: "step1-zone-pulse 6s ease-in-out infinite" }}
      >
        <FileText className="h-5 w-5 text-muted-foreground" />
        <p className="mt-1 text-[10px] text-muted-foreground">Drop PDFs or images</p>
      </div>
      <div
        className="absolute right-4 top-3 rounded border border-border bg-background px-2 py-1 font-mono text-[9px] shadow-sm"
        style={{ animation: "step1-drop-passport 6s ease-in-out infinite" }}
      >
        passport.pdf
      </div>
      <div
        className="absolute bottom-3 left-4 rounded border border-border bg-background px-2 py-1 font-mono text-[9px] shadow-sm"
        style={{ animation: "step1-drop-license 6s ease-in-out infinite" }}
      >
        license.jpg
      </div>
    </div>
  );
}

function StepGraphVisual() {
  // Mini SVG knowledge graph: 2 docs + 4 facts + edges.
  // Edges draw via stroke-dashoffset; nodes pop in with staggered delays.
  return (
    <div className="relative h-[140px] overflow-hidden rounded-lg border border-border bg-card">
      <style>{`
        @keyframes step2-edge-draw {
          0%        { stroke-dashoffset: 200; opacity: 0; }
          15%       { opacity: 1; }
          50%, 80%  { stroke-dashoffset: 0; opacity: 1; }
          100%      { stroke-dashoffset: 0; opacity: 0; }
        }
        @keyframes step2-node-pop {
          0%        { opacity: 0; transform: scale(0.85); }
          15%, 85%  { opacity: 1; transform: scale(1); }
          100%      { opacity: 0; transform: scale(0.95); }
        }
        @keyframes step2-flag-pulse {
          0%, 100%  { box-shadow: 0 0 0 0 hsl(var(--foreground) / 0); opacity: 0; transform: scale(0.85); }
          25%, 85%  { opacity: 1; transform: scale(1); }
          50%       { box-shadow: 0 0 0 4px hsl(var(--foreground) / 0.15); }
        }
        .step2-edge { stroke-dasharray: 200; animation: step2-edge-draw 6s ease-in-out infinite; }
        .step2-node { animation: step2-node-pop 6s ease-in-out infinite; opacity: 0; }
      `}</style>
      <svg viewBox="0 0 240 140" className="absolute inset-0 h-full w-full">
        <path className="step2-edge" style={{ animationDelay: "0.4s" }}
              d="M40 35 C 100 35, 100 35, 160 30" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
        <path className="step2-edge" style={{ animationDelay: "0.9s" }}
              d="M40 35 C 100 50, 100 65, 160 65" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" />
        <path className="step2-edge" style={{ animationDelay: "1.4s" }}
              d="M40 100 C 100 95, 100 100, 160 100" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
        <path className="step2-edge" style={{ animationDelay: "1.9s" }}
              d="M40 100 C 100 110, 100 130, 160 130" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
      <div className="step2-node absolute left-3 top-[18px] rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[8.5px]" style={{ animationDelay: "0s" }}>
        passport
      </div>
      <div className="step2-node absolute left-3 top-[84px] rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[8.5px]" style={{ animationDelay: "0.6s" }}>
        utility
      </div>
      <div className="step2-node absolute right-3 top-[14px] rounded border border-border bg-background px-1.5 py-0.5 text-[8.5px]" style={{ animationDelay: "0.4s" }}>
        Full Name
      </div>
      <div className="step2-node absolute right-3 top-[49px] rounded border border-border bg-background px-1.5 py-0.5 text-[8.5px]" style={{ animationDelay: "0.9s" }}>
        DOB
      </div>
      <div className="step2-node absolute right-3 top-[84px] rounded border border-border bg-background px-1.5 py-0.5 text-[8.5px]" style={{ animationDelay: "1.4s" }}>
        Address
      </div>
      <div className="absolute right-3 top-[114px] rounded border-2 border-foreground bg-background px-1.5 py-0.5 text-[8.5px]"
           style={{ animation: "step2-flag-pulse 6s ease-in-out infinite", animationDelay: "1.9s", opacity: 0 }}>
        DOB (red flag)
      </div>
    </div>
  );
}

function StepFillVisual() {
  // Each field's bar grows from 0 → its target width, staggered.
  const fields = [
    { label: "First name", target: 80, delay: "0.2s" },
    { label: "Last name",  target: 80, delay: "1.0s" },
    { label: "DOB",        target: 50, delay: "1.8s" },
  ];
  return (
    <div className="relative h-[140px] overflow-hidden rounded-lg border border-border bg-card p-2.5">
      <style>{`
        @keyframes step3-fill-80 {
          0%, 10%  { width: 0%; }
          35%, 80% { width: 80%; }
          95%, 100%{ width: 0%; }
        }
        @keyframes step3-fill-50 {
          0%, 10%  { width: 0%; }
          35%, 80% { width: 50%; }
          95%, 100%{ width: 0%; }
        }
        @keyframes step3-badge-pulse {
          0%, 100% { transform: scale(0.95); opacity: 0.85; }
          50%      { transform: scale(1); opacity: 1; }
        }
      `}</style>
      <div className="space-y-1.5">
        {fields.map((f) => (
          <div key={f.label} className="rounded border border-border bg-background px-2 py-1">
            <div className="text-[8.5px] uppercase tracking-wider text-muted-foreground">{f.label}</div>
            <div
              className="mt-0.5 h-2 rounded bg-foreground/70"
              style={{
                width: 0,
                animation: `${f.target === 80 ? "step3-fill-80" : "step3-fill-50"} 6s ease-in-out infinite`,
                animationDelay: f.delay,
              }}
            />
          </div>
        ))}
      </div>
      <div
        className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[9px] font-semibold text-background"
        style={{ animation: "step3-badge-pulse 1.4s ease-in-out infinite" }}
      >
        <Sparkles className="h-2.5 w-2.5" /> Filling
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────────
// FactsGraphPreview — real React Flow render of the doc → entity → fact
// graph with dummy data. Same library and node shape as the in-app Facts
// view, so the marketing page shows the actual thing.
// ──────────────────────────────────────────────────────────────────────────────

const PREVIEW_NODE_TYPES = {
  doc: DocFlowNode,
  entity: EntityFlowNode,
  fact: FactFlowNode,
};

// Node data (id + payload) is constant; only positions change between
// "by source" and "by entity" layouts. Each builder returns positioned
// nodes + the edges it wants to render. Card markup, sizes, and styling
// all mirror the in-app FactsGraph (packages/ui/src/views/FactsGraph.tsx).
const N = {
  docPassport:  { id: "doc-passport",  type: "doc", data: { name: "passport.pdf",       kind: "passport" } },
  docLicense:   { id: "doc-license",   type: "doc", data: { name: "license.pdf",        kind: "drivers_license" } },
  docUtility:   { id: "doc-utility",   type: "doc", data: { name: "utility_bill.jpg",   kind: "utility_bill", ocr: true } },
  docPayalPp:   { id: "doc-payal-pp",  type: "doc", data: { name: "payal_passport.pdf", kind: "passport" } },
  entSelf:      { id: "ent-self",   type: "entity", data: { initials: "ME", name: "Self",  rel: "self",   factCount: 4 } },
  entPayal:     { id: "ent-payal",  type: "entity", data: { initials: "PT", name: "Payal", rel: "spouse", factCount: 2 } },
  // Fact nodes carry the entity initials inline — same as the in-app
  // FactNode, which shows a small avatar bubble inside the card.
  factName:     { id: "fact-name",      type: "fact", data: { entityInitials: "ME", label: "Full Name",   value: "Sunil Tiwari",  sources: 2 } },
  factDob:      { id: "fact-dob",       type: "fact", data: { entityInitials: "ME", label: "DOB",         value: "1987-08-28",    sources: 2 } },
  factAddr:     { id: "fact-addr",      type: "fact", data: { entityInitials: "ME", label: "Address",     value: "221B Baker St", sources: 2, conflict: "stale" } },
  factPassport: { id: "fact-passport",  type: "fact", data: { entityInitials: "ME", label: "Passport #",  value: "●●●●●●1234",    sources: 1 } },
  factPayalName:{ id: "fact-payal-name",type: "fact", data: { entityInitials: "PT", label: "Full Name",   value: "Payal Tiwari",  sources: 1 } },
  factPayalPp:  { id: "fact-payal-pp",  type: "fact", data: { entityInitials: "PT", label: "Passport #",  value: "●●●●●●7788",    sources: 1 } },
} as const;

function place(node: { id: string; type: string; data: Record<string, unknown> }, x: number, y: number): Node {
  return { ...node, position: { x, y } } as Node;
}

const EDGE_STROKE = "hsl(var(--foreground))";

function fEdge(id: string, source: string, target: string, opts: { weight?: "high" | "low"; dashed?: boolean } = {}): Edge {
  return {
    id, source, target,
    type: "smoothstep",
    style: {
      stroke: EDGE_STROKE,
      strokeOpacity: opts.weight === "high" ? 0.75 : 0.45,
      strokeWidth: opts.weight === "high" ? 1.5 : 1,
      strokeDasharray: opts.dashed ? "4 4" : undefined,
    },
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_STROKE, width: 12, height: 12 },
  };
}

function spouseEdge(): Edge {
  return {
    id: "e-self-payal", source: "ent-self", target: "ent-payal",
    type: "smoothstep", label: "spouse · derived",
    labelStyle: { fontSize: 9, fontStyle: "italic", fill: "hsl(var(--muted-foreground))" },
    labelBgStyle: { fill: "hsl(var(--card))" },
    labelBgPadding: [4, 2],
    style: { stroke: EDGE_STROKE, strokeOpacity: 0.45, strokeWidth: 1, strokeDasharray: "2 3" },
  };
}

// "By source" layout — mirrors the in-app `buildGraph`:
// docs left (x=40, y=40+i*96), facts right (x=700, y=40+i*72), edges
// go doc → fact directly. Entity context lives on the fact card as a
// small initials badge.
function buildSourceGraph(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    place(N.docPassport, 40, 40),
    place(N.docLicense,  40, 136),
    place(N.docUtility,  40, 232),
    place(N.docPayalPp,  40, 328),
    place(N.factName,        700, 40),
    place(N.factDob,         700, 112),
    place(N.factAddr,        700, 184),
    place(N.factPassport,    700, 256),
    place(N.factPayalName,   700, 328),
    place(N.factPayalPp,     700, 400),
  ];
  const edges: Edge[] = [
    // passport.pdf is the authoritative source for full name, DOB, passport #
    fEdge("e-pp-name",     "doc-passport", "fact-name",     { weight: "high" }),
    fEdge("e-pp-dob",      "doc-passport", "fact-dob",      { weight: "high" }),
    fEdge("e-pp-passport", "doc-passport", "fact-passport", { weight: "high" }),
    // license also asserts name + dob (lower confidence) + address (older)
    fEdge("e-lic-name",    "doc-license",  "fact-name"),
    fEdge("e-lic-dob",     "doc-license",  "fact-dob"),
    fEdge("e-lic-addr",    "doc-license",  "fact-addr",     { dashed: true }),
    // utility bill asserts address (canonical)
    fEdge("e-util-addr",   "doc-utility",  "fact-addr",     { weight: "high" }),
    // payal passport asserts both her facts
    fEdge("e-payalpp-name","doc-payal-pp", "fact-payal-name", { weight: "high" }),
    fEdge("e-payalpp-pp",  "doc-payal-pp", "fact-payal-pp",   { weight: "high" }),
  ];
  return { nodes, edges };
}

// "By entity" layout — mirrors the in-app `buildGraphByEntity`:
// one column per entity (COL_WIDTH=320), entity node at the top
// (ENTITY_TOP=20), facts stacked below (FACTS_TOP=160, ROW=72),
// family edges between entity columns.
function buildEntityGraph(): { nodes: Node[]; edges: Edge[] } {
  const COL_WIDTH = 320;
  const ENTITY_TOP = 20;
  const FACTS_TOP  = 160;
  const ROW_H      = 72;

  const xSelf  = 60;
  const xPayal = xSelf + COL_WIDTH;

  const nodes: Node[] = [
    place(N.entSelf,  xSelf,  ENTITY_TOP),
    place(N.entPayal, xPayal, ENTITY_TOP),
    place(N.factName,     xSelf,  FACTS_TOP + ROW_H * 0),
    place(N.factDob,      xSelf,  FACTS_TOP + ROW_H * 1),
    place(N.factAddr,     xSelf,  FACTS_TOP + ROW_H * 2),
    place(N.factPassport, xSelf,  FACTS_TOP + ROW_H * 3),
    place(N.factPayalName,xPayal, FACTS_TOP + ROW_H * 0),
    place(N.factPayalPp,  xPayal, FACTS_TOP + ROW_H * 1),
  ];
  const edges: Edge[] = [
    fEdge("e-self-name",     "ent-self",  "fact-name",     { weight: "high" }),
    fEdge("e-self-dob",      "ent-self",  "fact-dob",      { weight: "high" }),
    fEdge("e-self-addr",     "ent-self",  "fact-addr",     { dashed: true }),
    fEdge("e-self-passport", "ent-self",  "fact-passport", { weight: "high" }),
    fEdge("e-payal-name",    "ent-payal", "fact-payal-name", { weight: "high" }),
    fEdge("e-payal-pp",      "ent-payal", "fact-payal-pp",   { weight: "high" }),
    spouseEdge(),
  ];
  return { nodes, edges };
}

function FactsGraphPreview() {
  const [view, setView] = useState<"source" | "entity">("source");
  const { nodes, edges } = useMemo(
    () => view === "source" ? buildSourceGraph() : buildEntityGraph(),
    [view],
  );
  return (
    <section id="features" className="border-t border-border bg-background">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <SectionEyebrow>Inside the vault</SectionEyebrow>
        <SectionTitle>Every fact carries its source.</SectionTitle>
        <p className="mt-3 max-w-[640px] text-[15px] leading-relaxed text-muted-foreground">
          Documents on the left, entities in the middle, facts on the right. Edge
          opacity encodes confidence; a dashed edge means the candidate is stale.
          Derived edges (spouse, in-law, co-parent) come from the closure of the
          asserted facts — not from the documents themselves.
        </p>
        {/* View toggle — same control as the in-app FactsGraph view */}
        <div className="mt-8 inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
          <button
            onClick={() => setView("source")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${
              view === "source" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <FileText className="h-3 w-3" /> By source
          </button>
          <button
            onClick={() => setView("entity")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${
              view === "entity" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <Users className="h-3 w-3" /> By entity
          </button>
        </div>
        <div className="mt-4 h-[520px] overflow-hidden rounded-2xl border border-border bg-card">
          {/* key={view} forces a remount on toggle so defaultNodes pick up
              the new layout and fitView re-runs. Cheaper than wiring the
              fully-controlled hooks here. */}
          <ReactFlow
            key={view}
            defaultNodes={nodes}
            defaultEdges={edges}
            nodeTypes={PREVIEW_NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.12, duration: 400 }}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            panOnDrag
            zoomOnScroll={false}
            zoomOnPinch
            zoomOnDoubleClick
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
            className="bg-card"
          >
            <Background gap={18} size={1} color="hsl(var(--border))" />
            <Controls
              showInteractive={false}
              className="!border-border !bg-card [&>button]:!border-border [&>button]:!bg-card [&>button]:!text-foreground hover:[&>button]:!bg-accent"
            />
          </ReactFlow>
        </div>
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Drag nodes, pan the canvas, pinch to zoom, toggle the view — this is the real Facts graph component from the app.
        </p>
      </div>
    </section>
  );
}

// Document node — mirrors `DocumentNode` in the in-app FactsGraph.
function DocFlowNode({ data }: NodeProps) {
  const d = data as { name: string; kind: string; ocr?: boolean };
  const Icon = d.ocr ? ScanLine : FileText;
  return (
    <div className="w-[220px] rounded-md border border-border bg-card px-3 py-2 text-card-foreground shadow-sm">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-xs font-medium">{d.name}</span>
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {d.kind}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-foreground !bg-foreground" />
    </div>
  );
}

// Entity node — mirrors `EntityNode` in the in-app FactsGraph: circular
// avatar with initials, name, relationship + fact count, double-bordered
// rounded card.
function EntityFlowNode({ data }: NodeProps) {
  const d = data as { initials: string; name: string; rel: string; factCount?: number };
  return (
    <div className="w-[260px] rounded-lg border-2 border-border bg-card px-3 py-2.5 text-card-foreground shadow-sm">
      <Handle id="fam-l" type="target" position={Position.Left}  className="!h-2 !w-2 !border-foreground !bg-foreground" />
      <Handle id="fam-r" type="source" position={Position.Right} className="!h-2 !w-2 !border-foreground !bg-foreground" />
      <Handle id="facts" type="source" position={Position.Bottom} className="!h-2 !w-2 !border-foreground !bg-foreground" />
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-foreground bg-card text-xs font-semibold">
          {d.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{d.name}</div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{d.rel}</span>
            {typeof d.factCount === "number" && (
              <>
                <span>·</span>
                <span>{d.factCount} fact{d.factCount === 1 ? "" : "s"}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Fact node — mirrors `FactNode` in the in-app FactsGraph: entity initials
// avatar inside the card, uppercase microcopy label, source-count badge,
// monospaced value. Conflict state encoded via border style.
function FactFlowNode({ data }: NodeProps) {
  const d = data as {
    entityInitials: string; label: string; value: string;
    sources: number; conflict?: "stale" | "conflict" | "red_flag";
  };
  const stateClass =
    d.conflict === "red_flag" ? "border-2 border-foreground"
    : d.conflict === "conflict" ? "border-2 border-double border-foreground/70"
    : d.conflict === "stale" ? "border border-dashed border-muted-foreground"
    : "border border-border";
  return (
    <div className={`w-[240px] rounded-md bg-card px-3 py-2 text-card-foreground shadow-sm ${stateClass}`}>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-foreground !bg-foreground" />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-[8px] font-medium">
            {d.entityInitials}
          </span>
          <span className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{d.label}</span>
        </div>
        {d.sources > 1 && (
          <span className="rounded border border-border bg-background px-1 text-[9px] font-medium text-muted-foreground">{d.sources}×</span>
        )}
      </div>
      <div className="mt-0.5 truncate font-mono text-xs">{d.value || "—"}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// FeatureSpotlight — shared layout for feature deep-dive sections.
// Eyebrow + title + body + optional bullets, with the interactive widget
// on the opposite side (alternating per section).
// ──────────────────────────────────────────────────────────────────────────────

function FeatureSpotlight({
  id, eyebrow, title, body, bullets, side = "right", children,
}: {
  id?: string;
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  bullets?: string[];
  side?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-t border-border bg-background">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className={`grid items-center gap-12 lg:gap-16 ${side === "right" ? "lg:grid-cols-[1fr,1.2fr]" : "lg:grid-cols-[1.2fr,1fr]"}`}>
          <div className={side === "left" ? "lg:order-2" : ""}>
            <SectionEyebrow>{eyebrow}</SectionEyebrow>
            <SectionTitle>{title}</SectionTitle>
            <p className="mt-5 max-w-[460px] text-[15px] leading-relaxed text-muted-foreground">{body}</p>
            {bullets && (
              <ul className="mt-7 space-y-3 text-[14px]">
                {bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={side === "left" ? "lg:order-1" : ""}>
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Spotlight #2 — Conflicts + 3 views (interactive)
// Real clickable tabs, real Pin/Trash buttons that re-resolve the canonical.
// ──────────────────────────────────────────────────────────────────────────────

type ConflictTab = "documents" | "conflicts" | "facts";

interface DemoCandidate { id: string; value: string; source: string; docKind: string; confidence: "high" | "medium" | "low"; }

function ConflictsSpotlight() {
  return (
    <FeatureSpotlight
      id="conflicts"
      eyebrow="Feature 02 · Conflicts + 3 views"
      title={<>The same vault, <span className="italic">three lenses</span>.</>}
      body="Documents, Conflicts, and Facts are three views over one knowledge graph. Red flags surface when two passports disagree on your DOB; stale values surface when a newer utility bill supersedes an older address. Pin the right candidate, dismiss the wrong one — the canonical re-resolves immediately."
      bullets={[
        "Red flag · stale · conflict · none — per-field-type rules",
        "Pin sticks across re-imports — robust to future authoritative docs",
        "Dismiss just one candidate; the field stays alive",
      ]}
      side="right"
    >
      <ConflictsWidget />
    </FeatureSpotlight>
  );
}

function ConflictsWidget() {
  const [tab, setTab] = useState<ConflictTab>("conflicts");
  const [pinnedId, setPinnedId] = useState<string>("c1");
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const candidates: DemoCandidate[] = [
    { id: "c1", value: "1987-08-28", source: "passport.pdf",  docKind: "passport",       confidence: "high" },
    { id: "c2", value: "1989-08-28", source: "insurance.pdf", docKind: "insurance_card", confidence: "medium" },
  ];
  const live = candidates.filter((c) => !dismissedIds.has(c.id));
  const canonical = live.find((c) => c.id === pinnedId) ?? live[0];

  function togglePin(id: string) {
    setPinnedId(id);
    setDismissedIds((s) => { const n = new Set(s); n.delete(id); return n; });
  }
  function toggleDismiss(id: string) {
    setDismissedIds((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    if (id === pinnedId) {
      const next = candidates.find((c) => c.id !== id && !dismissedIds.has(c.id));
      if (next) setPinnedId(next.id);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-20px_rgba(0,0,0,0.12)]">
      {/* Title bar */}
      <div className="flex h-9 items-center justify-between border-b border-border bg-muted px-3">
        <div className="flex items-center gap-2">
          <OctoMark className="h-3.5 w-3.5" />
          <span className="text-[12px] font-semibold tracking-tight">OctoVault AI</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">conflicts view</span>
      </div>
      {/* Tabs */}
      <div className="flex border-b border-border bg-card">
        {(["documents", "conflicts", "facts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-2 text-[11.5px] font-medium uppercase tracking-wider transition-colors ${
              tab === t ? "bg-background text-foreground" : "text-muted-foreground hover:bg-accent/40"
            }`}
          >
            {t === "documents" && <FileText className="mr-1 inline h-3 w-3" />}
            {t === "conflicts" && <AlertTriangle className="mr-1 inline h-3 w-3" />}
            {t === "facts" && <Network className="mr-1 inline h-3 w-3" />}
            {t}
          </button>
        ))}
      </div>
      {/* Panel */}
      <div className="min-h-[360px] p-4">
        {tab === "documents" && (
          <div className="space-y-1.5">
            {[
              { name: "passport.pdf",       kind: "passport",       icon: FileText },
              { name: "license.pdf",        kind: "drivers_license",icon: FileText },
              { name: "utility_bill.jpg",   kind: "utility_bill",   icon: ScanLine },
              { name: "insurance.pdf",      kind: "insurance_card", icon: FileText },
            ].map((d) => (
              <div key={d.name} className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <d.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <div className="text-[12px] font-medium">{d.name}</div>
                    <div className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{d.kind}</div>
                  </div>
                </div>
                <span className="text-[9.5px] font-mono text-muted-foreground">just now</span>
              </div>
            ))}
          </div>
        )}
        {tab === "conflicts" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-medium">
              <AlertTriangle className="h-3.5 w-3.5" /> Red flags (1)
            </div>
            <p className="text-[10.5px] leading-relaxed text-muted-foreground">
              Two documents disagree on Date of Birth. Verify against the source — DOB should never differ.
            </p>
            <div className="space-y-2 rounded-md border-2 border-foreground bg-card p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium">Date of Birth</span>
                <span className="rounded border border-border bg-background px-1.5 py-0 text-[9.5px] uppercase tracking-wider text-muted-foreground">red flag</span>
              </div>
              {live.map((c) => {
                const isCanonical = c.id === canonical?.id;
                return (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px]">{c.value}</span>
                        {isCanonical && (
                          <span className="rounded border border-border bg-card px-1 text-[9px] uppercase tracking-wider">canonical</span>
                        )}
                        {c.id === pinnedId && <Pin className="h-3 w-3" />}
                      </div>
                      <div className="mt-0.5 text-[9.5px] text-muted-foreground">
                        {c.source} · {c.docKind} · {c.confidence}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {c.id !== pinnedId && (
                        <button
                          onClick={() => togglePin(c.id)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                          title="Pin as canonical"
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => toggleDismiss(c.id)}
                        className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="Dismiss"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {dismissedIds.size > 0 && (
                <button
                  onClick={() => setDismissedIds(new Set())}
                  className="w-full rounded border border-dashed border-muted-foreground px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Restore {dismissedIds.size} dismissed
                </button>
              )}
            </div>
            <div className="rounded-md border border-dashed border-muted-foreground bg-card p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium">Address</span>
                <span className="rounded border border-border bg-background px-1.5 py-0 text-[9.5px] uppercase tracking-wider text-muted-foreground">stale</span>
              </div>
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                license.pdf (older) superseded by utility_bill.jpg (newer)
              </div>
            </div>
          </div>
        )}
        {tab === "facts" && (
          <div className="relative h-[280px] overflow-hidden rounded-md border border-border bg-background">
            <svg viewBox="0 0 320 280" className="absolute inset-0 h-full w-full">
              <path d="M40 60 C 140 60, 140 100, 240 100" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
              <path d="M40 130 C 140 130, 140 100, 240 100" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
              <path d="M40 200 C 140 200, 140 180, 240 180" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" strokeDasharray="3 3" />
            </svg>
            <div className="absolute left-3 top-[48px] rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9.5px]">passport.pdf</div>
            <div className="absolute left-3 top-[118px] rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9.5px]">insurance.pdf</div>
            <div className="absolute left-3 top-[188px] rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9.5px]">license.pdf</div>
            <div className="absolute right-3 top-[88px] rounded border-2 border-foreground bg-background px-2 py-1 text-[10px]">
              <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Date of Birth</div>
              <div className="font-mono text-[11px]">{canonical?.value ?? "—"}</div>
            </div>
            <div className="absolute right-3 top-[168px] rounded border border-dashed border-muted-foreground bg-background px-2 py-1 text-[10px]">
              <div className="text-[8px] uppercase tracking-wider text-muted-foreground">Address · stale</div>
              <div className="font-mono text-[11px]">221B Baker St</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Spotlight #3 — Chat with your data (interactive)
// Click a preset question → typed-out answer with [N] citations + source cards.
// ──────────────────────────────────────────────────────────────────────────────

interface DemoQA {
  scope?: string;
  q: string;
  a: string; // contains [1], [2] markers
  sources: Array<{ n: number; doc: string; field: string; excerpt: string }>;
}

const QA_DEMO: DemoQA[] = [
  {
    scope: "Payal",
    q: "when does her passport expire?",
    a: "Payal's passport expires on 2029-03-14 [1], issued 2019-03-14 [2].",
    sources: [
      { n: 1, doc: "payal_passport.pdf", field: "Passport Expiry Date", excerpt: "Date of Expiry: 14 MAR 2029" },
      { n: 2, doc: "payal_passport.pdf", field: "Passport Issue Date",  excerpt: "Date of Issue: 14 MAR 2019" },
    ],
  },
  {
    q: "where do I live?",
    a: "Your current address is 221B Baker St, London [1]. An older address on file (license.pdf) was superseded.",
    sources: [
      { n: 1, doc: "utility_bill.jpg", field: "Address Line 1", excerpt: "221B Baker St, London NW1" },
    ],
  },
  {
    q: "who is in my family?",
    a: "Your vault has 4 entities: Self [1], Payal [2] (spouse), Katha and Aarav (children). Spouse-of-spouse closure adds Payal's parents as your in-laws [3].",
    sources: [
      { n: 1, doc: "passport.pdf",       field: "Entity",    excerpt: "TIWARI, SUNIL" },
      { n: 2, doc: "payal_passport.pdf", field: "Entity",    excerpt: "TIWARI, PAYAL" },
      { n: 3, doc: "(derived edge)",     field: "Closure",   excerpt: "Spouse → parent → parent-in-law" },
    ],
  },
];

function ChatSpotlight() {
  return (
    <FeatureSpotlight
      id="chat"
      eyebrow="Feature 03 · Chat"
      title={<>Ask anything. <span className="italic">Cite everything</span>.</>}
      body="Every answer points back to the exact document, field, and excerpt that produced it. @mention a family member to scope the retrieval; query rewriting resolves pronouns ('she', 'their'); MMR rerank diversifies the source set so you don't get the same passage back five times."
      bullets={[
        "Local embeddings via nomic-embed-text — no cloud retrieval",
        "[N] pills scroll to the matching source card",
        "Query rewriting handles follow-ups across turns",
      ]}
      side="left"
    >
      <ChatWidget />
    </FeatureSpotlight>
  );
}

function ChatWidget() {
  const [activeIdx, setActiveIdx] = useState(0);
  const active = QA_DEMO[activeIdx];
  const [typed, setTyped] = useState(active.a.length);

  useEffect(() => {
    setTyped(0);
    const id = setInterval(() => {
      setTyped((n) => {
        if (n >= active.a.length) { clearInterval(id); return n; }
        return n + 2;
      });
    }, 25);
    return () => clearInterval(id);
  }, [active]);

  const answerSoFar = active.a.slice(0, typed);
  const isTyping = typed < active.a.length;

  function renderAnswer(text: string) {
    // Replace [N] with a pill that scrolls to the matching source card.
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
      const n = parseInt(m[1], 10);
      parts.push(
        <button
          key={`${m.index}-${n}`}
          onClick={() => {
            const el = document.getElementById(`chat-src-${activeIdx}-${n}`);
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            el?.animate(
              [{ outline: "2px solid hsl(var(--foreground))" }, { outline: "0px solid transparent" }],
              { duration: 1200 },
            );
          }}
          className="mx-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-border bg-card px-1 align-baseline text-[9px] font-medium hover:bg-accent"
          title="Jump to source"
        >
          {n}
        </button>,
      );
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) parts.push(text.slice(lastIdx));
    return parts;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-20px_rgba(0,0,0,0.12)]">
      {/* Title bar */}
      <div className="flex h-9 items-center justify-between border-b border-border bg-muted px-3">
        <div className="flex items-center gap-2">
          <OctoMark className="h-3.5 w-3.5" />
          <span className="text-[12px] font-semibold tracking-tight">OctoVault AI · Chat</span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">qwen3:8b · local</span>
      </div>
      {/* Preset questions */}
      <div className="flex flex-wrap gap-1.5 border-b border-border bg-card px-3 py-2">
        <span className="mr-1 self-center text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Try</span>
        {QA_DEMO.map((qa, i) => (
          <button
            key={qa.q}
            onClick={() => setActiveIdx(i)}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              i === activeIdx ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            }`}
          >
            {qa.scope && <AtSign className="-mt-0.5 mr-0.5 inline h-2.5 w-2.5" />}
            {qa.scope ? `${qa.scope} — ${qa.q}` : qa.q}
          </button>
        ))}
      </div>
      {/* Conversation */}
      <div className="space-y-3 p-4">
        {/* User message */}
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-md border border-border bg-accent/40 px-3 py-2 text-[12.5px]">
            {active.scope && (
              <span className="mb-0.5 inline-flex items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-[1px] text-[9px] font-medium">
                <AtSign className="h-2 w-2" /> {active.scope}
              </span>
            )}
            <div className="mt-1">{active.q}</div>
          </div>
        </div>
        {/* Assistant message */}
        <div>
          <div className="rounded-md bg-foreground/5 px-3 py-2 text-[12.5px] leading-relaxed">
            {renderAnswer(answerSoFar)}
            {isTyping && <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-foreground align-middle" />}
          </div>
        </div>
        {/* Sources */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sources</div>
          {active.sources.map((s) => (
            <div
              key={s.n}
              id={`chat-src-${activeIdx}-${s.n}`}
              className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5 transition-shadow"
            >
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-card px-1 text-[9px] font-medium">{s.n}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-medium">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{s.doc}</span>
                </div>
                <div className="mt-0.5 text-[9.5px] text-muted-foreground">{s.field}</div>
                <div className="mt-0.5 line-clamp-2 text-[9.5px] italic text-muted-foreground">"{s.excerpt}"</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Section #4 — Chrome extension (dedicated full-width section)
// Mocks the look of a real US Department of State DS-160 nonimmigrant visa
// application form. Side panel docks on the right; click "Fill this page"
// to watch real-looking visa fields populate one by one. Below the demo:
// install steps · browser support · how the matcher works.
// ──────────────────────────────────────────────────────────────────────────────

// DS-160-style form sections. Labels and section headings track the
// real form so the mock reads as government paperwork, not a toy form.
const DS160_SECTIONS: Array<{
  title: string;
  fields: Array<{ label: string; required?: boolean; v: string }>;
}> = [
  {
    title: "Personal Information",
    fields: [
      { label: "Surnames",                              required: true, v: "TIWARI" },
      { label: "Given Names",                           required: true, v: "SUNIL" },
      { label: "Sex",                                   required: true, v: "MALE" },
      { label: "Marital Status",                        required: true, v: "MARRIED" },
      { label: "Date of Birth",                         required: true, v: "28-AUG-1987" },
      { label: "City of Birth",                         required: true, v: "MUMBAI" },
    ],
  },
  {
    title: "Passport / Travel Document",
    fields: [
      { label: "Passport Number",                       required: true, v: "X1234567" },
      { label: "Country of Issue",                      required: true, v: "INDIA" },
      { label: "Issuance Date",                         required: true, v: "14-MAR-2019" },
      { label: "Expiration Date",                       required: true, v: "14-MAR-2029" },
    ],
  },
  {
    title: "Address and Phone",
    fields: [
      { label: "Street Address",                        required: true, v: "221B Baker St" },
      { label: "City",                                  required: true, v: "London" },
      { label: "Primary Phone Number",                  required: true, v: "+44 20 7224 3688" },
      { label: "Email Address",                         required: true, v: "sunil@example.com" },
    ],
  },
];

const DS160_FIELD_COUNT = DS160_SECTIONS.reduce((n, s) => n + s.fields.length, 0);

function ChromeExtensionSection() {
  return (
    <section id="chrome-extension" className="border-t border-border bg-card/40">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <SectionEyebrow>Feature 04 · Chrome extension</SectionEyebrow>
        <SectionTitle>
          Fill a real visa application. <span className="italic">In three seconds.</span>
        </SectionTitle>
        <p className="mt-4 max-w-[720px] text-[15px] leading-relaxed text-muted-foreground">
          The OctoVault AI side panel docks beside any web page — visa
          applications, tax intake forms, school enrollments, USCIS forms.
          Click <span className="font-mono">⬛ Fill this page</span> and every field
          gets matched from your knowledge graph. Below is a real-feeling mock
          of the US Department of State's DS-160 visa form. Try it.
        </p>
        {/* Interactive demo */}
        <div className="mt-10">
          <DS160FormDemo />
        </div>
        {/* Below the demo: install / support / matcher explainer */}
        <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-3">
          <ExtensionBlock title="Install in 60 seconds" icon={PanelRight}>
            <ol className="space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
              <li><span className="font-semibold text-foreground">1.</span> Open <span className="font-mono">chrome://extensions</span></li>
              <li><span className="font-semibold text-foreground">2.</span> Toggle <span className="font-mono">Developer mode</span></li>
              <li><span className="font-semibold text-foreground">3.</span> Load unpacked → <span className="font-mono">packages/extension/dist</span></li>
              <li><span className="font-semibold text-foreground">4.</span> Pin the OctoVault AI icon · the panel opens on click</li>
            </ol>
          </ExtensionBlock>
          <ExtensionBlock title="Works in" icon={Check}>
            <ul className="space-y-2 text-[12.5px]">
              {[
                ["Google Chrome", "≥ 114"],
                ["Microsoft Edge", "≥ 114"],
                ["Brave", "≥ 1.55"],
                ["Arc", "≥ 1.20"],
              ].map(([name, v]) => (
                <li key={name} className="flex items-center justify-between">
                  <span>{name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{v}</span>
                </li>
              ))}
              <li className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                Firefox: side panel API not yet supported.
              </li>
            </ul>
          </ExtensionBlock>
          <ExtensionBlock title="How the matcher works" icon={Sparkles}>
            <ol className="space-y-2 text-[12.5px] leading-relaxed text-muted-foreground">
              <li><span className="font-mono text-[11px] text-foreground">1.</span> HTML <span className="font-mono">autocomplete</span> attributes — instant</li>
              <li><span className="font-mono text-[11px] text-foreground">2.</span> Label / name / placeholder keyword match against the schema</li>
              <li><span className="font-mono text-[11px] text-foreground">3.</span> LLM tiebreaker for the unresolved fields only</li>
              <li><span className="font-mono text-[11px] text-foreground">4.</span> You review every proposal · no auto-submit</li>
            </ol>
          </ExtensionBlock>
        </div>
      </div>
    </section>
  );
}

function ExtensionBlock({ title, icon: Icon, children }: {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background p-6">
      <div className="mb-3 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
        <h4 className="text-[13px] font-semibold tracking-tight">{title}</h4>
      </div>
      {children}
    </div>
  );
}

function DS160FormDemo() {
  const [phase, setPhase] = useState<"idle" | "filling" | "done">("idle");
  const [filledCount, setFilledCount] = useState(0);

  useEffect(() => {
    if (phase !== "filling") return;
    if (filledCount >= DS160_FIELD_COUNT) { setPhase("done"); return; }
    const t = setTimeout(() => setFilledCount((n) => n + 1), 140);
    return () => clearTimeout(t);
  }, [phase, filledCount]);

  function start() { setFilledCount(0); setPhase("filling"); }
  function reset() { setFilledCount(0); setPhase("idle"); }

  // Flatten fields with absolute index so we know whether each one is filled.
  const allFields = DS160_SECTIONS.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.title })));

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-20px_rgba(0,0,0,0.12)]">
      {/* Browser chrome */}
      <div className="flex h-10 items-center gap-3 border-b border-border bg-muted px-3">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
          <Lock className="h-3 w-3 text-muted-foreground" />
          <span className="truncate font-mono text-[11.5px] text-foreground">
            ceac.state.gov/genniv/
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{phase}</span>
      </div>
      <div className="grid min-h-[440px] grid-cols-1 lg:grid-cols-[1.5fr,1fr]">
        {/* === Government form pane (left) === */}
        <div className="overflow-y-auto border-r border-border bg-background">
          {/* Faux DoS / consular banner */}
          <div className="flex items-center gap-3 border-b border-border bg-foreground px-4 py-2 text-background">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-background/15">
              <Sparkles className="h-3 w-3" />
            </div>
            <div className="min-w-0">
              <div className="text-[9.5px] uppercase tracking-[0.2em] opacity-80">
                U.S. Department of State · Bureau of Consular Affairs
              </div>
              <div className="text-[12.5px] font-semibold">
                DS-160 — Online Nonimmigrant Visa Application
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between border-b border-border bg-card px-4 py-1.5 text-[10.5px] text-muted-foreground">
            <span>Application ID: <span className="font-mono">AA00FEXAMPLE</span></span>
            <span>Step 1 of 12 · Personal Information</span>
          </div>

          {/* Sections */}
          <div className="space-y-3.5 p-4">
            {DS160_SECTIONS.map((section) => {
              const startIdx = allFields.findIndex((f) => f.section === section.title);
              return (
                <div key={section.title} className="space-y-2">
                  <h4 className="border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
                    {section.title}
                  </h4>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {section.fields.map((f, i) => {
                      const idx = startIdx + i;
                      const filled = idx < filledCount;
                      return (
                        <div key={f.label}>
                          <label className="block text-[10px] font-medium leading-tight text-foreground">
                            {f.label}
                            {f.required && <span className="ml-1 text-foreground/60">*</span>}
                          </label>
                          <div
                            className={`mt-0.5 flex h-7 items-center rounded-sm border px-2 text-[11.5px] transition-all duration-200 ${
                              filled
                                ? "border-foreground/70 bg-foreground/5 text-foreground"
                                : "border-border bg-card text-muted-foreground/60"
                            }`}
                          >
                            <span className="truncate font-mono">{filled ? f.v : ""}</span>
                            {filled && <Check className="ml-auto h-3 w-3 shrink-0" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {/* Navigation footer (gov form style) */}
            <div className="mt-1 flex items-center justify-between border-t border-border pt-3">
              <button className="rounded-sm border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
                Back
              </button>
              <div className="flex gap-2">
                <button className="rounded-sm border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  Save
                </button>
                <button
                  disabled={phase !== "done"}
                  className={`rounded-sm px-3 py-1 text-[11px] font-semibold transition-all ${
                    phase === "done"
                      ? "bg-foreground text-background"
                      : "border border-border bg-card text-muted-foreground"
                  }`}
                >
                  Next: Travel ›
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* === Side panel (right) === */}
        <div className="flex flex-col bg-card">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
            <div className="flex items-center gap-1.5">
              <OctoMark className="h-3.5 w-3.5" />
              <span className="text-[12px] font-semibold tracking-tight">OctoVault AI</span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
              <WifiOff className="h-2.5 w-2.5" /> Local
            </span>
          </div>
          {/* Detected form */}
          <div className="border-b border-border bg-card px-3 py-2">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Detected form
            </div>
            <div className="mt-0.5 truncate text-[11px] font-medium">DS-160 · Nonimmigrant Visa Application</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[9.5px] text-muted-foreground">
              <FileText className="h-2.5 w-2.5" />
              {DS160_FIELD_COUNT} fields · {DS160_FIELD_COUNT - 2} matched in graph
            </div>
          </div>
          {/* Matched fields (live count) */}
          <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              From your graph
            </div>
            {DS160_SECTIONS.map((section) => {
              const sectionStart = allFields.findIndex((f) => f.section === section.title);
              return (
                <div key={section.title} className="space-y-0.5">
                  <div className="pt-1.5 text-[8.5px] uppercase tracking-wider text-muted-foreground">{section.title}</div>
                  {section.fields.map((f, i) => {
                    const idx = sectionStart + i;
                    const filled = idx < filledCount;
                    return (
                      <div
                        key={f.label}
                        className={`flex items-center justify-between gap-2 rounded-sm border px-1.5 py-1 text-[10px] transition-colors ${
                          filled ? "border-foreground/60 bg-foreground/5" : "border-border bg-background"
                        }`}
                      >
                        <span className="truncate text-muted-foreground">{f.label}</span>
                        <span className="shrink-0 font-mono text-[10px]">
                          {filled ? (f.v.length > 12 ? `${f.v.slice(0, 12)}…` : f.v) : "…"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {/* Fill button + reset */}
          <div className="space-y-1.5 border-t border-border p-3">
            {phase === "idle" || phase === "done" ? (
              <button
                onClick={start}
                className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-foreground text-[13px] font-semibold text-background"
              >
                <Sparkles className="h-4 w-4" /> Fill this page
              </button>
            ) : (
              <button
                disabled
                className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background text-[13px] font-semibold text-muted-foreground"
              >
                <span className="size-2 animate-pulse rounded-full bg-foreground" />
                Filling {filledCount}/{DS160_FIELD_COUNT}
              </button>
            )}
            {phase === "done" && (
              <button
                onClick={reset}
                className="inline-flex h-8 w-full items-center justify-center rounded-md border border-border bg-card text-[11.5px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="mr-1 h-3 w-3" /> Run again
              </button>
            )}
            <div className="text-center text-[9.5px] text-muted-foreground">
              You review every value · nothing submits without your click
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Spotlight #5 — Completely secure · local · private (interactive)
// Tabs over verification commands: lsof / Little Snitch / Airplane mode.
// ──────────────────────────────────────────────────────────────────────────────

const VERIFICATIONS = [
  {
    id: "lsof",
    label: "lsof (macOS)",
    cmd: "$ sudo lsof -i -P | grep -i octovault",
    out: `OctoVault   1234  you  20u  IPv4  TCP 127.0.0.1:53117 (LISTEN)
OctoVault   1234  you  21u  IPv4  TCP 127.0.0.1:64812->127.0.0.1:11434 (ESTABLISHED)

# Two connections, both 127.0.0.1. No remote endpoints.`,
  },
  {
    id: "netstat",
    label: "netstat",
    cmd: "$ netstat -an | grep -E '(11434|53117)' | grep -v 127.0.0.1",
    out: `# No output — nothing leaves the device.
# (Lines from the same query that DO match 127.0.0.1 are the
#  desktop bridge and Ollama, both localhost-only.)`,
  },
  {
    id: "airplane",
    label: "Airplane mode",
    cmd: "$ # Flip your Wi-Fi off. Re-open OctoVault AI.",
    out: `✓ Vault unlocks normally.
✓ Documents import normally.
✓ Chat answers normally.
✓ Form fill works normally.

# Airplane mode is a supported configuration.`,
  },
  {
    id: "snitch",
    label: "Little Snitch",
    cmd: "$ # Watch Little Snitch's connection log",
    out: `OctoVault → 127.0.0.1:11434  ALLOWED  (Ollama, local)
OctoVault → 127.0.0.1:53117  ALLOWED  (bridge, local)
OctoVault → *.*              0 attempts`,
  },
];

function SecuritySpotlight() {
  return (
    <FeatureSpotlight
      id="verify"
      eyebrow="Feature 05 · Local · private · secure"
      title={<>Don't take our word. <span className="italic">Watch the network</span>.</>}
      body="OctoVault AI's only network calls go to localhost — your own Ollama at port 11434 and the desktop bridge at 53117. Pick a verification method below and run it yourself. We give you the commands; your terminal gives you the proof."
      bullets={[
        "SQLCipher AES-256 on the desktop vault",
        "WebCrypto AES-GCM per-value on the extension",
        "Master password gates the highly-sensitive reveal",
      ]}
      side="left"
    >
      <SecurityWidget />
    </FeatureSpotlight>
  );
}

function SecurityWidget() {
  const [active, setActive] = useState(VERIFICATIONS[0].id);
  const current = VERIFICATIONS.find((v) => v.id === active)!;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-20px_rgba(0,0,0,0.12)]">
      {/* Outbound counter strip */}
      <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Network className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Outbound (non-localhost)</span>
        </div>
        <span className="font-mono text-[26px] font-bold leading-none tabular-nums">0</span>
      </div>
      {/* Verification tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border bg-card px-2 py-2">
        {VERIFICATIONS.map((v) => (
          <button
            key={v.id}
            onClick={() => setActive(v.id)}
            className={`rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
              active === v.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent/40"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      {/* Terminal */}
      <div className="bg-foreground/[0.03]">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-mono text-[11px] text-muted-foreground">terminal · {current.label}</span>
        </div>
        <pre className="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-relaxed text-foreground">
{current.cmd}
{"\n\n"}
{current.out}
        </pre>
      </div>
      {/* Encryption chips */}
      <div className="grid grid-cols-2 gap-px border-t border-border bg-border md:grid-cols-4">
        {[
          { icon: Lock,        label: "SQLCipher vault" },
          { icon: ShieldCheck, label: "WebCrypto AES-GCM" },
          { icon: WifiOff,     label: "Airplane safe" },
          { icon: Lock,        label: "Master-password" },
        ].map((c) => (
          <div key={c.label} className="flex items-center justify-center gap-1.5 bg-card px-2 py-2 text-[10.5px] text-muted-foreground">
            <c.icon className="h-3 w-3" /> {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Comparison table — adds multi-entity, citations, side panel rows
// ──────────────────────────────────────────────────────────────────────────────

type Cell = boolean | "partial";
const COMPARISON_ROWS: ReadonlyArray<readonly [string, Cell, Cell, Cell]> = [
  ["Documents stay on device",          true,  false,     true],
  ["Multi-entity (you + family)",       true,  false,     "partial"],
  ["AI chat with source citations",     true,  true,      false],
  ["Knowledge-graph view",              true,  false,     false],
  ["One-click web form-fill",           true,  "partial", false],
  ["Chrome side panel",                 true,  true,      false],
  ["Encrypted local vault",             true,  false,     true],
  ["Works fully offline",               true,  false,     true],
];

function Comparison() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <SectionEyebrow>Versus the alternatives</SectionEyebrow>
        <SectionTitle>What you get, what you don't have to give up.</SectionTitle>
        <div className="mt-12 overflow-hidden rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-card text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="p-4 text-left"></th>
                <th className="p-4 text-left">OctoVault AI</th>
                <th className="p-4 text-left">Cloud doc AI</th>
                <th className="p-4 text-left">Password manager</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map(([label, a, b, c]) => (
                <tr key={label} className="border-b border-border last:border-0">
                  <td className="p-4 text-[13.5px]">{label}</td>
                  <CompCell v={a} />
                  <CompCell v={b} />
                  <CompCell v={c} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function CompCell({ v }: { v: Cell }) {
  return (
    <td className="p-4">
      {v === true ? <Check className="h-4 w-4" />
       : v === false ? <span className="text-muted-foreground">—</span>
       : <span className="text-[11px] uppercase tracking-wider text-muted-foreground">partial</span>}
    </td>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// FAQ
// ──────────────────────────────────────────────────────────────────────────────

const FAQ = [
  { q: "Does OctoVault AI upload my documents?",
    a: "No. Documents and extracted facts never leave your device. The AI runs locally via Ollama; the desktop app talks to it over localhost." },
  { q: "Does it use ChatGPT or Claude?",
    a: "No. The default model is qwen3:8b (an open-weight 8-billion-parameter Qwen model) for extraction, matching, and chat, plus nomic-embed-text for retrieval embeddings. Both run on your machine via Ollama. You can swap in any other Ollama-compatible model in Settings." },
  { q: "Which browsers does the side panel support?",
    a: "Any Chromium-based browser at version 114 or newer: Chrome, Edge, Brave, Arc. Firefox doesn't ship the side panel API yet." },
  { q: "What if I lose my master password?",
    a: "Your vault is gone — by design. SQLCipher encrypts the whole database with a key derived from the password; without it, even we cannot recover the contents." },
  { q: "What documents does it understand?",
    a: "Passports, driver's licenses, national IDs, SSN cards, tax forms, paystubs, utility bills, bank statements, insurance cards, leases, vehicle registration, school and employment letters, medical records — and an \"unknown\" fallback for everything else." },
  { q: "Will it work on my old laptop?",
    a: "Anything from the last 5 years with 8GB RAM. The 8B model is the sweet spot; a smaller model (qwen2.5:3b) runs comfortably on 4GB." },
  { q: "Can I see what it extracted?",
    a: "Yes — the Facts graph shows every document, every fact, every edge. Conflicts (differing values) get their own view. Each candidate shows its source excerpt." },
];

function Faq() {
  return (
    <section id="faq" className="border-t border-border bg-card/40">
      <div className="mx-auto max-w-[820px] px-6 py-24 md:py-32">
        <SectionEyebrow>FAQ</SectionEyebrow>
        <SectionTitle>Questions worth asking.</SectionTitle>
        <dl className="mt-12 space-y-6">
          {FAQ.map((q) => (
            <div key={q.q} className="space-y-1.5 border-b border-border pb-6 last:border-0">
              <dt className="text-[16px] font-semibold">{q.q}</dt>
              <dd className="text-[14px] leading-relaxed text-muted-foreground">{q.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Waitlist CTA
// ──────────────────────────────────────────────────────────────────────────────

// Supabase project. Both VITE_* vars are intentionally public — the anon key
// is meant to be exposed in browsers. Security is enforced by Row-Level
// Security on the `waitlist` table (see analytics.ts header for SQL).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const WAITLIST_STORAGE = "octovault.waitlist.v1";

function Cta() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");
  const [pending, setPending] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!clean.includes("@")) return;
    setPending(true);

    // Always stash locally as belt-and-suspenders backup.
    try {
      const list = JSON.parse(localStorage.getItem(WAITLIST_STORAGE) ?? "[]") as Array<{ email: string; at: number }>;
      if (!list.some((x) => x.email === clean)) list.push({ email: clean, at: Date.now() });
      localStorage.setItem(WAITLIST_STORAGE, JSON.stringify(list));
    } catch { /* ignore */ }

    // Send to Supabase. Treat 2xx and the 409 duplicate-email case as success
    // (they're already on the list); any other failure still shows "ok" to
    // the user because we have the local backup.
    const delivered = SUPABASE_URL && SUPABASE_KEY
      ? fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ email: clean, source: "landing" }),
        }).then((r) => r.ok || r.status === 409).catch(() => false)
      : Promise.resolve(false);

    void delivered.then((ok) => {
      setStatus("ok");
      setPending(false);
      // Stitch this anonymous session to the email so we can see what they
      // looked at before signing up — the only signal we have for which
      // section converted them. PostHog uses the email as distinct_id.
      identify(clean, { source: "landing_waitlist" });
      track("waitlist_signup_completed", { delivered: ok, destination: ok ? "supabase" : "fallback" });
    });
  }

  return (
    <section id="waitlist" className="border-t border-border bg-background">
      <div className="mx-auto max-w-[1200px] px-6 py-24 text-center md:py-32">
        <h2 className="mx-auto max-w-[820px] font-serif text-[40px] leading-[1.02] tracking-tight md:text-[64px]">
          Be in the <span className="italic">first batch</span>.
        </h2>
        <p className="mx-auto mt-5 max-w-[520px] text-[15px] text-muted-foreground">
          We're letting in a small batch each week. Drop your email — no marketing list, no spam, no resale.
        </p>
        <form onSubmit={submit} className="mx-auto mt-10 flex max-w-md gap-2">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" disabled={pending || status === "ok"}
            data-private
            className="flex h-11 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
          />
          <button type="submit" disabled={pending || status === "ok"}
            data-attr="cta-waitlist-submit"
            className="rounded-md bg-foreground px-4 text-sm font-semibold text-background hover:bg-foreground/90 disabled:opacity-60">
            {status === "ok" ? "On the list" : pending ? "…" : "Request access"}
          </button>
        </form>
        {status === "ok" && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Thanks — we'll be in touch as soon as a beta slot opens.
          </p>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          By joining, you'll receive at most one email per month while we're in beta.
        </p>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Footer
// ──────────────────────────────────────────────────────────────────────────────

const FOOTER_LINKS = {
  Product: [
    ["How it works", "#how"],
    ["Features", "#features"],
    ["Side panel", "#chrome-extension"],
    ["Verify it yourself", "#verify"],
  ],
  Learn: [
    ["FAQ", "#faq"],
    ["Strategy doc", "https://github.com/CoderCouple/octo-vault-ai/blob/main/OCTOVAULT_STRATEGY.md"],
    ["GitHub", "https://github.com/CoderCouple/octo-vault-ai"],
  ],
  Trust: [
    ["100% on-device", "#verify"],
    ["Open-weight models only", "#faq"],
    ["SQLCipher encrypted", "#verify"],
  ],
} as const;

function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 gap-10 px-6 py-14 md:grid-cols-5">
        <div className="col-span-2">
          <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <OctoMark className="h-5 w-5" /> OctoVault AI
          </div>
          <p className="mt-4 max-w-[300px] text-[13px] leading-relaxed text-muted-foreground">
            A private knowledge graph for your personal paperwork. Local-only.
            On-device. Your documents stay yours.
          </p>
          <div className="mt-5 flex gap-2.5">
            <a href="https://github.com/CoderCouple/octo-vault-ai" aria-label="GitHub"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border hover:border-foreground/40">
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
        {Object.entries(FOOTER_LINKS).map(([col, links]) => (
          <FooterCol key={col} title={col} links={links as ReadonlyArray<readonly [string, string]>} />
        ))}
      </div>
      <div className="mx-auto flex max-w-[1200px] items-center justify-between border-t border-border px-6 py-6 text-[12px] text-muted-foreground">
        <span>© {new Date().getFullYear()} OctoVault AI · Your documents stay yours.</span>
        <span className="font-mono">v0.0.1 · private beta</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div>
      <div className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <ul className="mt-4 space-y-2.5 text-[13.5px]">
        {links.map(([label, href]) => (
          <li key={label}>
            <a href={href} className="text-foreground/80 hover:text-foreground">{label}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared
// ──────────────────────────────────────────────────────────────────────────────

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="max-w-[820px] font-serif text-[34px] leading-[1.05] tracking-tight md:text-[44px]">
      {children}
    </h2>
  );
}

