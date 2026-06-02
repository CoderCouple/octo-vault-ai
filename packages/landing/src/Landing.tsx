import { useState } from "react";
import {
  ArrowRight, Brain, Check, FileText, FormInput, Lock, Network,
  ScanLine, ShieldCheck, Sparkles, WifiOff,
} from "lucide-react";

const FEATURES = [
  { icon: FormInput, title: "Fill any web form, instantly",
    body: "Visa applications, job applications, school enrollments, tax intake — fill 20-field forms in three seconds. From your own documents. Reviewed before anything submits." },
  { icon: ScanLine, title: "Reads scans, photos, and PDFs",
    body: "On-device OCR pulls text from passports, IDs, utility bills — whether you uploaded a PDF, a scan, or a phone photo." },
  { icon: Brain, title: "Resolves conflicts intelligently",
    body: "Two documents disagree on your address? OctoVault scores by document authority, recency, and confidence — and surfaces red flags like differing DOBs." },
  { icon: Lock, title: "Sensitive fields stay sealed",
    body: "SSNs, passport numbers, and account numbers are masked by default. Re-auth required to reveal." },
  { icon: WifiOff, title: "Works offline. Always.",
    body: "Airplane mode is a supported configuration. The Security Center shows live outbound connections — target: zero." },
];

const FAQ = [
  { q: "Does OctoVault upload my documents?",
    a: "No. They never leave your device. The AI runs locally via Ollama." },
  { q: "Does it use ChatGPT or Claude?",
    a: "No. Open-weight models (Llama, Phi, Qwen) run on your computer." },
  { q: "What if I lose my master password?",
    a: "Your data is gone — by design. We cannot recover it; neither can anyone else." },
  { q: "Will it work on my old laptop?",
    a: "Anything from the last 5 years with 8GB RAM. Better hardware means faster answers." },
  { q: "Can I see what it extracted?",
    a: "Yes — the Facts view shows every document and every fact it pulled, with confidence and source." },
];

export function Landing() {
  return (
    <main className="min-h-screen bg-background text-foreground antialiased">
      <Nav />
      <Hero />
      <TrustLine />
      <Features />
      <HowItWorks />
      <FactsGraphPreview />
      <Comparison />
      <Faq />
      <Cta />
      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border/60 bg-background/80 px-6 py-3 backdrop-blur">
      <a href="#" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <span>⬛</span> OctoVault
      </a>
      <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
        <a href="#features" className="hover:text-foreground">Features</a>
        <a href="#how" className="hover:text-foreground">How it works</a>
        <a href="#faq" className="hover:text-foreground">FAQ</a>
        <a href="#download" className="rounded-md border px-3 py-1.5 text-foreground hover:bg-foreground hover:text-background">
          Download
        </a>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-6 pt-24 pb-16 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
        <Sparkles className="h-3 w-3" /> Private. On-device. Beta.
      </div>
      <h1 className="mt-6 font-serif text-5xl leading-[1.1] tracking-tight md:text-7xl">
        Your private AI for personal paperwork.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground md:text-lg">
        OctoVault reads your documents, fills any web form, and resolves conflicts —
        all on your device. No cloud. No servers. No data harvesting.
      </p>
      <div className="mt-8 flex items-center justify-center gap-3">
        <a href="#download" className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:bg-foreground/90">
          Get the beta <ArrowRight className="h-4 w-4" />
        </a>
        <a href="#how" className="rounded-md border px-5 py-2.5 text-sm font-medium hover:bg-accent">
          See how it works
        </a>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        macOS · Windows · Chrome extension · Free during beta
      </p>
    </section>
  );
}

function TrustLine() {
  return (
    <section className="border-y border-border/60 bg-card/40">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-6 py-5 text-xs text-muted-foreground">
        <Chip icon={WifiOff}>Offline by default</Chip>
        <Chip icon={Lock}>Encrypted vault</Chip>
        <Chip icon={Network}>0 outbound connections</Chip>
        <Chip icon={ShieldCheck}>Open SBOM at launch</Chip>
      </div>
    </section>
  );
}

function Chip({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5" /> {children}
    </span>
  );
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="font-serif text-3xl tracking-tight md:text-4xl">What it does</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Five things, done well, with the local-only guarantee baked in.
      </p>
      <div className="mt-10 grid gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="space-y-3 bg-background p-6">
            <f.icon className="h-5 w-5" />
            <h3 className="text-base font-semibold">{f.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: 1, t: "Install Ollama and OctoVault", d: "Two one-time installs. Both free, both local." },
    { n: 2, t: "Drag in your documents", d: "Passport, license, tax forms, utility bills. Text or scanned." },
    { n: 3, t: "Review the extracted facts", d: "OctoVault flags conflicts and lets you pin the right value." },
    { n: 4, t: "Fill any web form in one click", d: "Click the OctoVault button — review the proposal — submit yourself." },
  ];
  return (
    <section id="how" className="border-t border-border/60 bg-card/40 py-20">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="font-serif text-3xl tracking-tight md:text-4xl">How it works</h2>
        <ol className="mt-8 space-y-4">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-4 rounded-md border bg-background p-5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs">
                {s.n}
              </div>
              <div>
                <div className="text-base font-medium">{s.t}</div>
                <div className="text-sm text-muted-foreground">{s.d}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FactsGraphPreview() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <div className="flex flex-col gap-3">
        <h2 className="font-serif text-3xl tracking-tight md:text-4xl">See every fact, every source.</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          OctoVault doesn't just extract — it shows you which document supports which fact,
          how confident it is, and where two documents disagree.
        </p>
      </div>
      <div className="mt-10 grid grid-cols-2 gap-2 rounded-lg border p-4 md:grid-cols-[1fr,2fr,1fr]">
        <div className="space-y-1.5">
          <DocCard icon={FileText} label="Passport.pdf" type="passport" />
          <DocCard icon={FileText} label="License.pdf" type="drivers_license" />
          <DocCard icon={ScanLine} label="Utility_bill.jpg" type="utility_bill" />
        </div>
        <svg className="hidden h-full w-full md:block" viewBox="0 0 100 200" preserveAspectRatio="none">
          {[20, 60, 100, 140, 180].map((y, i) => (
            <path key={i} d={`M0 ${20 + i * 28} C 50 ${20 + i * 28} 50 ${y} 100 ${y}`}
                  fill="none" stroke="currentColor" strokeOpacity={i === 2 ? 0.8 : 0.35}
                  strokeWidth={i === 2 ? 1.2 : 0.8} strokeDasharray={i === 4 ? "3 3" : undefined} />
          ))}
        </svg>
        <div className="space-y-1.5">
          <FactCard label="Full Name" v="Sunil Tiwari" count={3} />
          <FactCard label="Date of Birth" v="1987-08-28" count={2} />
          <FactCard label="Address" v="221B Baker St" count={3} conflict="stale" />
          <FactCard label="Passport #" v="●●●●●●1234" count={1} />
          <FactCard label="License #" v="●●●●●●K23" count={1} />
        </div>
      </div>
    </section>
  );
}

function DocCard({ icon: Icon, label, type }: { icon: React.ComponentType<{ className?: string }>; label: string; type: string }) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3" />
        <span className="truncate text-xs font-medium">{label}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{type}</div>
    </div>
  );
}

function FactCard({ label, v, count, conflict }: { label: string; v: string; count: number; conflict?: "stale" | "conflict" | "red_flag" }) {
  const cls =
    conflict === "stale" ? "border-dashed border-muted-foreground"
    : conflict === "conflict" ? "border-double border-2"
    : conflict === "red_flag" ? "border-2 border-foreground"
    : "border-border";
  return (
    <div className={`rounded-md border ${cls} bg-card px-2 py-1.5`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs">{v}</span>
        <span className="text-[10px] text-muted-foreground">{count}×</span>
      </div>
    </div>
  );
}

function Comparison() {
  const rows = [
    ["Documents stay on device",     true,  false, true],
    ["AI Q&A on your documents",     true,  true,  false],
    ["Form auto-fill from documents", true,  "partial", false],
    ["Encrypted local vault",        true,  false, true],
    ["Works offline",                true,  false, true],
    ["One-time purchase",            true,  false, false],
  ] as const;
  return (
    <section className="border-y border-border/60 bg-card/40 py-20">
      <div className="mx-auto max-w-4xl px-6">
        <h2 className="font-serif text-3xl tracking-tight md:text-4xl">Versus the alternatives</h2>
        <div className="mt-8 overflow-hidden rounded-lg border bg-background">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                <th className="p-3 text-left"></th>
                <th className="p-3 text-left">OctoVault</th>
                <th className="p-3 text-left">Cloud doc AI</th>
                <th className="p-3 text-left">Password manager</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, a, b, c]) => (
                <tr key={label} className="border-b last:border-0">
                  <td className="p-3">{label}</td>
                  <Cell v={a} />
                  <Cell v={b} />
                  <Cell v={c} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Cell({ v }: { v: boolean | "partial" }) {
  return (
    <td className="p-3">
      {v === true ? <Check className="h-4 w-4" />
       : v === false ? <span className="text-muted-foreground">—</span>
       : <span className="text-xs text-muted-foreground">partial</span>}
    </td>
  );
}

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
      <h2 className="font-serif text-3xl tracking-tight md:text-4xl">FAQ</h2>
      <dl className="mt-8 space-y-6">
        {FAQ.map((q) => (
          <div key={q.q} className="space-y-1.5 border-b pb-6 last:border-0">
            <dt className="text-base font-medium">{q.q}</dt>
            <dd className="text-sm text-muted-foreground">{q.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Cta() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  return (
    <section id="download" className="border-t border-border/60 bg-card/40 py-24 text-center">
      <div className="mx-auto max-w-2xl px-6">
        <h2 className="font-serif text-3xl tracking-tight md:text-4xl">Be in the beta.</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          We're letting in a small batch each week. Drop your email — no marketing list, no spam.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
          className="mx-auto mt-8 flex max-w-md gap-2"
        >
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex h-10 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <button type="submit" className="rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90">
            Request access
          </button>
        </form>
        {submitted && (
          <p className="mt-4 text-xs text-muted-foreground">
            Thanks — we'll be in touch. (Wire this form to a real endpoint before launch.)
          </p>
        )}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 px-6 py-8 text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 md:flex-row">
        <div className="flex items-center gap-2"><span>⬛</span> OctoVault</div>
        <div>© {new Date().getFullYear()} OctoVault. Your documents stay yours.</div>
      </div>
    </footer>
  );
}
