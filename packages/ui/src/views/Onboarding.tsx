// First-run onboarding as a 5-step carousel.
//   1. Welcome — brand intro, local-only promise
//   2. Ollama — verify the server is running
//   3. Models — verify LLM + embedding model are installed
//   4. You — mandatory name + email (populates Self entity)
//   5. Done — quick start
//
// The modal cannot be dismissed (overlay click, Escape) until Self has
// a real name and a valid email. Other steps can be skipped forward
// even if their checks haven't passed yet — users can fix Ollama later
// from Settings.

import { useEffect, useState } from "react";
import {
  Check, ChevronLeft, ChevronRight, Download, FileText, Loader2, Lock,
  MessageSquare, ShieldCheck, Sparkles, WifiOff,
} from "lucide-react";
import {
  addUserCandidate, hasModel, initialsFor, listModels, normalizeValue, SELF_ENTITY_ID,
  type Entity, type OllamaConfig,
} from "@octovault/core";
import { useAppContext } from "../context";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { OctoMark } from "../components/octo-mark";
import { BRAND, tx } from "../lib/brand";
import { cn } from "../lib/utils";

type StepId = "welcome" | "ollama" | "models" | "password" | "you" | "done";
const STEPS: StepId[] = ["welcome", "ollama", "models", "password", "you", "done"];

export function Onboarding({ onClose }: { onClose: () => void }) {
  const { host, settings, entities, refreshEntities, setActiveEntityId } = useAppContext();
  const self = entities.find((e) => e.id === SELF_ENTITY_ID);

  const [stepIndex, setStepIndex] = useState(0);
  const [open, setOpen] = useState(true);

  // --- Detection state shared across Ollama + Models steps ---
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  useEffect(() => {
    const check = async () => {
      const reachable = await host.isOllamaReachable();
      setOllamaOk(reachable);
      if (reachable) {
        const cfg: OllamaConfig = {
          url: settings.ollamaUrl,
          llmModel: settings.llmModel,
          embeddingModel: settings.embeddingModel,
        };
        setInstalledModels(await listModels(cfg));
      } else setInstalledModels([]);
    };
    void check();
    const id = setInterval(check, 4000);
    return () => clearInterval(id);
  }, [host, settings.ollamaUrl, settings.llmModel, settings.embeddingModel]);

  // Ollama tags an untagged pull as `:latest`, so a strict `===`
  // check marks freshly-pulled models as "missing". hasModel
  // normalizes both sides before comparing.
  const llmInstalled = hasModel(installedModels, settings.llmModel);
  const embedInstalled = hasModel(installedModels, settings.embeddingModel);

  // --- "You" step state ---
  const [name, setName] = useState(self?.name === "Self" ? "" : (self?.name ?? ""));
  const [email, setEmail] = useState(self?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- "Password" step state ---
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  function validEmail(v: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  }
  const youValid = name.trim().length > 0 && validEmail(email);
  const pwValid = pw1.length >= 8 && pw1 === pw2;

  async function saveSelf() {
    setSaving(true);
    setError(null);
    try {
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      const updated: Entity = {
        id: SELF_ENTITY_ID,
        name: trimmedName,
        email: trimmedEmail,
        relationship: "self",
        initials: initialsFor(trimmedName),
        createdAt: self?.createdAt ?? Date.now(),
      };
      await host.storage.saveEntity(updated);

      // Also seed the Self profile with these basics as user-pinned
      // FieldRecords. Best-effort: a seeding failure must not block
      // onboarding — we'll surface the error in console for diagnostics.
      const parts = trimmedName.split(/\s+/).filter(Boolean);
      const first = parts[0] ?? "";
      const last = parts.length > 1 ? parts[parts.length - 1] : "";
      const middle = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
      const seed = async (key: string, value: string) => {
        if (!value) return;
        try {
          await addUserCandidate(host.storage, SELF_ENTITY_ID, key as never, value, normalizeValue);
        } catch (e) {
          console.warn(`[onboarding] failed to seed ${key}:`, e);
        }
      };
      await seed("fullName", trimmedName);
      await seed("firstName", first);
      await seed("middleName", middle);
      await seed("lastName", last);
      await seed("email", trimmedEmail);

      await refreshEntities();
      setActiveEntityId(SELF_ENTITY_ID);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function setupEncryption() {
    setSaving(true);
    setError(null);
    try {
      await host.vaultInit(pw1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSaving(false);
    }
  }

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const isFirst = stepIndex === 0;

  async function next() {
    if (step === "you") {
      if (!youValid) { setError("Name and a valid email are required."); return; }
      try { await saveSelf(); } catch { return; }
    }
    if (step === "password") {
      if (!pwValid) { setError("Passwords must match and be at least 8 characters."); return; }
      try { await setupEncryption(); } catch { return; }
    }
    if (isLast) { close(); return; }
    setStepIndex((i) => i + 1);
  }
  function prev() { if (!isFirst) setStepIndex((i) => i - 1); }
  function close() { setOpen(false); onClose(); }

  // Mandatory wizard — must be completed to use the app. No dismiss.
  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) setOpen(true); }}>
      <DialogContent
        className="max-w-lg p-0 [&>button.absolute]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <Header step={step} />

        {/* Carousel viewport */}
        <div className="relative min-h-[300px] overflow-hidden px-6">
          {step === "welcome"   && <WelcomeStep />}
          {step === "ollama"    && <OllamaStep ok={ollamaOk} url={settings.ollamaUrl} />}
          {step === "models"    && <ModelsStep ok={ollamaOk} llm={settings.llmModel} embed={settings.embeddingModel} llmInstalled={llmInstalled} embedInstalled={embedInstalled} />}
          {step === "you"       && <YouStep name={name} email={email} setName={setName} setEmail={setEmail} error={error} />}
          {step === "password"  && <PasswordStep pw1={pw1} pw2={pw2} setPw1={setPw1} setPw2={setPw2} error={error} />}
          {step === "done"      && <DoneStep />}
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pt-2 pb-1">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => {
                if (i <= stepIndex) setStepIndex(i);
              }}
              className={cn(
                "h-1.5 w-6 rounded-full transition-colors",
                i === stepIndex ? "bg-foreground" : i < stepIndex ? "bg-foreground/40" : "bg-muted"
              )}
              aria-label={`Step ${i + 1}`}
            />
          ))}
        </div>

        <DialogFooter className="border-t bg-muted/30 px-6 py-3">
          {!isFirst && (
            <Button variant="outline" size="sm" onClick={prev} disabled={saving}>
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </Button>
          )}
          <div className="flex-1" />
          {step === "you" ? (
            <Button onClick={() => void next()} disabled={!youValid || saving} size="sm">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Save and continue
            </Button>
          ) : step === "password" ? (
            <Button onClick={() => void next()} disabled={!pwValid || saving} size="sm">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
              Set password
            </Button>
          ) : isLast ? (
            <Button onClick={close} size="sm">Get started</Button>
          ) : (
            <Button onClick={() => void next()} size="sm">
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Header({ step }: { step: StepId }) {
  const labels: Record<StepId, { title: string; sub?: string }> = {
    welcome:  { title: `Welcome to ${BRAND.name}`, sub: BRAND.slogan },
    ollama:   { title: "Check Ollama" },
    models:   { title: "Check models" },
    you:      { title: "About you" },
    password: { title: "Set a master password" },
    done:     { title: "You're ready" },
  };
  return (
    <DialogHeader className="space-y-3 px-6 pt-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <OctoMark className="h-5 w-5" />
        </div>
        <div>
          <DialogTitle className="text-base">{labels[step].title}</DialogTitle>
          {labels[step].sub && <p className={tx.muted}>{labels[step].sub}</p>}
        </div>
      </div>
    </DialogHeader>
  );
}

function WelcomeStep() {
  return (
    <div className="space-y-4 py-2">
      <p className={tx.body}>
        OctoVault AI scans, understands, and stores your personal documents — entirely
        on this device. It can fill any web form from your own data and answer questions
        about your paperwork. Nothing leaves your machine.
      </p>
      <ul className="space-y-2">
        <Feature icon={ShieldCheck} title="Local-only by design">
          No cloud calls. No telemetry. No third-party APIs.
        </Feature>
        <Feature icon={FileText} title="Reads anything">
          Text PDFs, scanned PDFs, photos — OCR runs on your CPU.
        </Feature>
        <Feature icon={MessageSquare} title="Chat with your data">
          Ask anything; answers cite the source document and excerpt.
        </Feature>
        <Feature icon={WifiOff} title="Works offline">
          Airplane-mode-friendly once your models are downloaded.
        </Feature>
      </ul>
    </div>
  );
}

function OllamaStep({ ok, url }: { ok: boolean | null; url: string }) {
  return (
    <div className="space-y-4 py-2">
      <p className={tx.body}>
        OctoVault uses <strong>Ollama</strong> running on your device to power
        extraction, form-matching, and chat. The app talks to it at <code>{url}</code>.
      </p>
      <div className={cn(
        "flex items-center gap-3 rounded-md border px-3 py-2.5",
        ok === true && "border-foreground"
      )}>
        {ok === true ? <Check className="h-4 w-4" />
          : ok === false ? <WifiOff className="h-4 w-4" />
          : <Loader2 className="h-4 w-4 animate-spin" />}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {ok === true ? "Ollama is running" : ok === false ? "Ollama not reachable" : "Checking…"}
          </div>
          <div className={tx.muted}>
            {ok === true ? "All good. Move on to models." : `Expected at ${url}.`}
          </div>
        </div>
      </div>
      {ok !== true && (
        <div className="space-y-2">
          <div className={tx.microcap}>To install and start</div>
          <code className="block whitespace-pre rounded bg-muted px-3 py-2 text-[11px]">
{`# macOS
brew install ollama
brew services start ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &`}
          </code>
          <p className={tx.muted}>
            Or grab the installer from <span className="underline">ollama.com/download</span>.
          </p>
        </div>
      )}
    </div>
  );
}

function ModelsStep({
  ok, llm, embed, llmInstalled, embedInstalled,
}: {
  ok: boolean | null; llm: string; embed: string;
  llmInstalled: boolean; embedInstalled: boolean;
}) {
  return (
    <div className="space-y-4 py-2">
      <p className={tx.body}>
        Two on-device models. <strong>{llm}</strong> handles extraction and chat;{" "}
        <strong>{embed}</strong> handles search embeddings. One-time downloads.
      </p>
      <ModelRow name={llm} role="LLM" installed={ok === true && llmInstalled} reachable={ok === true} />
      <ModelRow name={embed} role="Embedding" installed={ok === true && embedInstalled} reachable={ok === true} />
      {ok === false && (
        <p className={tx.muted}>Start Ollama on the previous step first.</p>
      )}
    </div>
  );
}

function ModelRow({ name, role, installed, reachable }: { name: string; role: string; installed: boolean; reachable: boolean }) {
  return (
    <div className={cn("space-y-1.5 rounded-md border px-3 py-2.5", installed && "border-foreground")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {installed ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4 text-muted-foreground" />}
          <span className="text-sm font-medium">{name}</span>
          <Badge variant="muted">{role}</Badge>
        </div>
        <Badge variant={installed ? "outline" : "muted"}>{installed ? "installed" : "missing"}</Badge>
      </div>
      {!installed && reachable && (
        <code className="block rounded bg-muted px-2 py-1 text-[11px]">
          ollama pull {name}
        </code>
      )}
    </div>
  );
}

function YouStep({
  name, email, setName, setEmail, error,
}: {
  name: string; email: string;
  setName: (v: string) => void; setEmail: (v: string) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-4 py-2">
      <p className={tx.body}>
        Tell us who you are. This becomes your <strong>Self</strong> profile —
        the primary user of this vault. When the extractor sees this name in any
        document, the facts get attached to your profile automatically. Stays on
        this device.
      </p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="user-name">Full legal name</Label>
          <Input
            id="user-name" autoFocus value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Sunil Tiwari"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="user-email">Email</Label>
          <Input
            id="user-email" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
      </div>
      {error && <div className="text-xs text-foreground">{error}</div>}
    </div>
  );
}

function PasswordStep({
  pw1, pw2, setPw1, setPw2, error,
}: {
  pw1: string; pw2: string;
  setPw1: (v: string) => void; setPw2: (v: string) => void;
  error: string | null;
}) {
  const match = pw1.length > 0 && pw1 === pw2;
  const tooShort = pw1.length > 0 && pw1.length < 8;
  return (
    <div className="space-y-4 py-2">
      <p className={tx.body}>
        Pick a master password. It encrypts every document, fact, and embedding
        on this device. We can't recover it — write it down somewhere safe.
      </p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pw1">Master password</Label>
          <Input id="pw1" type="password" autoFocus value={pw1} onChange={(e) => setPw1(e.target.value)} />
          {tooShort && <p className="text-xs text-foreground">At least 8 characters.</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw2">Confirm password</Label>
          <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {pw2.length > 0 && !match && <p className="text-xs text-foreground">Doesn't match.</p>}
        </div>
      </div>
      <div className="rounded-md border bg-muted/40 px-3 py-2">
        <div className={tx.microcap}>What this does</div>
        <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
          <li>• AES-GCM encrypts every value before it's written to storage.</li>
          <li>• The key is derived from your password (PBKDF2, 600k iterations).</li>
          <li>• Lock the vault from Settings or after idle to evict the key from memory.</li>
        </ul>
      </div>
      {error && <div className="text-xs text-foreground">{error}</div>}
    </div>
  );
}

function DoneStep() {
  return (
    <div className="space-y-4 py-2">
      <div className="flex flex-col items-center gap-2 py-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border">
          <Sparkles className="h-5 w-5" />
        </div>
        <h3 className={tx.h2}>You're set</h3>
        <p className={cn("text-center", tx.muted)}>Drop your first document and watch OctoVault pull it apart.</p>
      </div>
      <div className="space-y-2">
        <Feature icon={FileText} title="Documents tab">
          Drag in PDFs or images. Each one gets a progress bar.
        </Feature>
        <Feature icon={MessageSquare} title="Chat tab">
          Once you have data, ask anything about it.
        </Feature>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string; children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className={tx.muted}>{children}</div>
      </div>
    </li>
  );
}

