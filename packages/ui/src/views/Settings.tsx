import { useEffect, useState } from "react";
import { Lock, Monitor, Moon, ShieldCheck, Sun, WifiOff } from "lucide-react";
import { listModels, type OllamaConfig } from "@octovault/core";
import { useAppContext } from "../context";
import { useTheme } from "../components/theme";
import { resetFirstSteps } from "../components/FirstSteps";
import { cn } from "../lib/utils";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";

export function SettingsView() {
  const { storage, settings, setSettings, readOnly, activeEntityId, entities, refreshEntities, refreshDocuments } = useAppContext();
  const { theme, setTheme } = useTheme();
  const [models, setModels] = useState<string[]>([]);
  const [showClearProfile, setShowClearProfile] = useState(false);
  const [showResetAll, setShowResetAll] = useState(false);

  async function rerunOnboarding() {
    // Resetting Self's name/email re-triggers the mandatory modal in App.tsx.
    // Also clear the dev skip flag — once it's set, App.tsx short-circuits
    // the modal regardless of Self state, which silently breaks this button.
    try { localStorage.removeItem("octovault.skipOnboarding"); } catch { /* ignore */ }
    await storage.saveEntity({
      id: "self", name: "Self", email: "",
      relationship: "self", initials: "ME",
      createdAt: entities.find((e) => e.id === "self")?.createdAt ?? Date.now(),
    });
    await refreshEntities();
  }

  useEffect(() => {
    const cfg: OllamaConfig = {
      url: settings.ollamaUrl,
      llmModel: settings.llmModel,
      embeddingModel: settings.embeddingModel,
      visionModel: settings.visionModel,
    };
    void listModels(cfg).then(setModels);
  }, [settings.ollamaUrl, settings.llmModel, settings.embeddingModel, settings.visionModel]);

  return (
    <div className="space-y-5 p-3 text-sm">
      <Section title="Appearance">
        <Field label="Theme">
          <div className="grid grid-cols-3 gap-1.5">
            <ThemeOption icon={Monitor} label="System" active={theme === "system"} onClick={() => setTheme("system")} />
            <ThemeOption icon={Sun}     label="Light"  active={theme === "light"}  onClick={() => setTheme("light")} />
            <ThemeOption icon={Moon}    label="Dark"   active={theme === "dark"}   onClick={() => setTheme("dark")} />
          </div>
        </Field>
      </Section>

      <Separator />

      <Section title="Ollama">
        <Field label="URL">
          <Input value={settings.ollamaUrl} onChange={(e) => void setSettings({ ollamaUrl: e.target.value })} />
        </Field>
        <Field label="LLM model" hint={models.length ? `Detected: ${models.join(", ")}` : "Pull a model with `ollama pull llama3.1:8b`"}>
          <Picker
            value={settings.llmModel}
            options={models}
            onChange={(v) => void setSettings({ llmModel: v })}
          />
        </Field>
        <Field label="Embedding model">
          <Picker
            value={settings.embeddingModel}
            options={models.filter((m) => m.includes("embed"))}
            onChange={(v) => void setSettings({ embeddingModel: v })}
          />
        </Field>
        <Field
          label="Vision OCR model"
          hint="Off by default — Tesseract handles printed documents in ~1-3s per page. Switch to a vision model only for decorative scans or non-English forms where Tesseract output is garbled. Vision OCR takes 30-90s per page; you'll need to re-upload affected documents to re-extract with it."
        >
          <Picker
            value={settings.visionModel}
            options={["", ...models.filter((m) => /\b(vl|vision|llava|minicpm)\b/i.test(m))]}
            emptyLabel="Disabled — use Tesseract"
            onChange={(v) => void setSettings({ visionModel: v })}
          />
        </Field>
        <Field
          label="PDF parser"
          hint="LiteParse is desktop-only and native. Keep PDF.js if you want the most conservative path."
        >
          <select
            value={settings.pdfParser}
            onChange={(e) => void setSettings({ pdfParser: e.target.value as "pdfjs" | "liteparse" })}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="pdfjs">PDF.js + bundled OCR</option>
            <option value="liteparse">LiteParse native parser</option>
          </select>
        </Field>
      </Section>

      <Separator />

      <Section title="Privacy">
        <Toggle
          label="Require master password for sensitive fields"
          desc="Highly-sensitive values stay masked until re-auth."
          checked={settings.requireUnlockForSensitive}
          onChange={(v) => void setSettings({ requireUnlockForSensitive: v })}
        />
        <Toggle
          label="Confirm before auto-fill"
          desc="Always show a preview before filling forms."
          checked={settings.autoFillPrompt}
          onChange={(v) => void setSettings({ autoFillPrompt: v })}
        />
        <Field label="App lock timeout (minutes)">
          <Input
            type="number" min={0}
            value={settings.appLockMinutes}
            onChange={(e) => void setSettings({ appLockMinutes: Number(e.target.value) })}
          />
        </Field>
        <Field label="Global hotkey for the search overlay">
          <Input
            value={settings.globalShortcut}
            onChange={async (e) => {
              const accel = e.target.value;
              await setSettings({ globalShortcut: accel });
              // Push to desktop main process so it can re-register
              // immediately — no app restart needed. Safe no-op on
              // surfaces that don't expose the bridge (extension).
              (window as unknown as { octovault?: { shortcut?: { set: (a: string) => void } } })
                .octovault?.shortcut?.set(accel);
            }}
            placeholder="CommandOrControl+Alt+O"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Electron Accelerator format. Examples: <span className="font-mono">CommandOrControl+Alt+O</span> · <span className="font-mono">CommandOrControl+Shift+Space</span> · <span className="font-mono">Alt+Space</span>. On macOS, <span className="font-mono">CommandOrControl</span> is ⌘ and <span className="font-mono">Alt</span> is ⌥.
          </p>
        </Field>

        <Toggle
          label="Show floating shortcut"
          desc="The dark capsule on the edge of your screen that opens the search overlay. Right-click it for 'Hide for now'."
          checked={settings.showFloatingShortcut}
          onChange={async (v) => {
            await setSettings({ showFloatingShortcut: v });
            const w = window as unknown as { octovault?: { shortcut?: { hide: () => void; show: () => void } } };
            if (v) w.octovault?.shortcut?.show();
            else   w.octovault?.shortcut?.hide();
          }}
        />

        <Field label="Floating shortcut edge">
          <select
            value={settings.shortcutEdge}
            onChange={async (e) => {
              const edge = e.target.value as "left" | "right";
              await setSettings({ shortcutEdge: edge });
              (window as unknown as { octovault?: { shortcut?: { setEdge: (e: "left" | "right") => void } } })
                .octovault?.shortcut?.setEdge(edge);
            }}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="left">Left edge (vertically centered)</option>
            <option value="right">Right edge (vertically centered)</option>
          </select>
        </Field>

        <Toggle
          label="Launch at login"
          desc="Start OctoVault automatically when you log in to your Mac so the floating shortcut and global hotkey are always ready."
          checked={settings.launchAtLogin}
          onChange={async (v) => {
            await setSettings({ launchAtLogin: v });
            (window as unknown as { octovault?: { launch?: { setOpenAtLogin: (on: boolean) => void } } })
              .octovault?.launch?.setOpenAtLogin(v);
          }}
        />
      </Section>

      <Separator />

      <Section title="Onboarding">
        <Button variant="outline" size="sm" disabled={readOnly} onClick={() => void rerunOnboarding()}>
          Re-run setup wizard
        </Button>
        <p className="text-xs text-muted-foreground">
          Re-opens the welcome dialog with Ollama / model checks and lets you update your name + email.
          Documents and facts are kept.
        </p>
        <Button variant="outline" size="sm" onClick={() => resetFirstSteps()}>
          Show first-steps tour again
        </Button>
        <p className="text-xs text-muted-foreground">
          Brings back the "First steps" checklist on the Documents view.
        </p>
      </Section>

      <Separator />

      <Section title="Data">
        <Button variant="destructive" size="sm" disabled={readOnly} onClick={() => setShowClearProfile(true)}>
          Clear all extracted fields
        </Button>
        <p className="text-xs text-muted-foreground">
          {readOnly
            ? "Read-only mode. Switch to the local vault to clear fields."
            : "Documents stay. All extracted candidates and pinned values are removed."}
        </p>
        <Button variant="destructive" size="sm" disabled={readOnly} onClick={() => setShowResetAll(true)}>
          Reset vault (full wipe)
        </Button>
        <p className="text-xs text-muted-foreground">
          Removes every document, entity, fact, embedding, and education / experience record.
          Keeps your Ollama URL, model choice, theme, and master password. Useful after schema upgrades.
        </p>
      </Section>

      <Separator />

      <Section title="Privacy">
        <Card className="space-y-3 p-3.5">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-0.5">
              <div className="text-[13px] font-medium">Crash reports &amp; telemetry: never collected</div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                There is no opt-in toggle because there's no opt-in. The
                desktop app and Chrome extension ship with zero analytics,
                zero crash reporters, zero "phone-home" of any kind. Nothing
                to enable later.
              </p>
            </div>
          </div>

          <ul className="space-y-1.5 pl-1 text-[11.5px] leading-relaxed text-muted-foreground">
            <li className="flex items-start gap-2">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Documents, extracted facts, and chat history are encrypted with
                your master password (SQLCipher on desktop, WebCrypto +
                IndexedDB in the extension).
              </span>
            </li>
            <li className="flex items-start gap-2">
              <WifiOff className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                The only outbound connection in normal operation is to your
                local Ollama server at <code className="font-mono">{settings.ollamaUrl}</code>.
                Verify with Little Snitch, Activity Monitor, or
                <code className="ml-1 font-mono">lsof -i -P -n | grep OctoVault</code>.
              </span>
            </li>
          </ul>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The landing page (octovault.ai) uses PostHog for anonymous click
            events &mdash; that's a separate site from this app and never
            sees document content.
          </p>
        </Card>
      </Section>

      <AlertDialog open={showClearProfile} onOpenChange={setShowClearProfile}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear extracted fields?</AlertDialogTitle>
            <AlertDialogDescription>
              Every fact extracted from your documents, including any values you've pinned,
              will be removed. Documents are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { await storage.clearProfile(activeEntityId); setShowClearProfile(false); }}>
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResetAll} onOpenChange={setShowResetAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset vault?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes every document, entity, fact, embedding, and record. Settings, theme,
              and master password are kept. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              const docs = await storage.listDocuments();
              for (const d of docs) {
                await storage.deleteDocument(d.id);
                await storage.deleteCandidatesFromDoc(d.id);
                await storage.deleteEmbeddingsForDoc(d.id);
                await storage.deleteRecordsFromDoc(d.id);
              }
              for (const e of entities.filter((e) => e.id !== "self")) {
                await storage.deleteEntity(e.id);
              }
              await storage.clearProfile("self");
              await refreshEntities();
              await refreshDocuments();
              setShowResetAll(false);
            }}>
              Reset everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <Label className="text-sm">{label}</Label>
        {desc && <div className="text-[10px] text-muted-foreground">{desc}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ThemeOption({
  icon: Icon, label, active, onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-md border p-2 text-xs transition-colors",
        active ? "border-foreground bg-accent" : "border-border hover:bg-accent/50"
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function Picker({ value, options, emptyLabel, onChange }: {
  value: string; options: string[]; emptyLabel?: string; onChange: (v: string) => void;
}) {
  if (options.length === 0) {
    return <Input value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {!options.includes(value) && <option value={value}>{value} (not installed)</option>}
      {options.map((m) => <option key={m || "__empty"} value={m}>{m || emptyLabel || "Disabled"}</option>)}
    </select>
  );
}
