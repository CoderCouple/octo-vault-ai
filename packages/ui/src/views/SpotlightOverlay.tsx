// Spotlight-style overlay. Single input → streamed answer + citations via
// host.ask(). Lives in its own BrowserWindow (transparent, frameless,
// alwaysOnTop) on the desktop, invoked by Cmd+Option+O or the floating
// shortcut. Dismisses on Escape, on blur (window loses focus), or after
// the user clicks a citation that opens the main app.
//
// Three modes depending on vault state, decided on mount:
//   no-vault → "Open OctoVault to set up your vault first" CTA
//   locked   → mini unlock prompt (password → host.vaultUnlock)
//   ready    → search bar + ask flow

import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, FileText, Loader2, Lock, Search, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { useAppContext } from "../context";
import { OctoMark } from "../components/octo-mark";
import type { QaCitation } from "@octovault/core";

interface OverlayBridge { hide: () => void; show: () => void; toggle: () => void }
function overlayBridge(): OverlayBridge | undefined {
  const w = window as unknown as { octovault?: { overlay?: OverlayBridge } };
  return w.octovault?.overlay;
}

// Cross-window vault-open check. The renderer's host.isVaultUnlocked()
// reads a per-renderer flag that's never set in the overlay window
// (which boots independently of the main window). The desktop preload
// exposes vault.isOpen() which queries the main process where the
// SQLCipher connection actually lives — the truth for "is the vault
// usable right now".
async function vaultIsOpenGlobally(): Promise<boolean> {
  const w = window as unknown as { octovault?: { vault?: { isOpen: () => Promise<boolean> } } };
  try { return (await w.octovault?.vault?.isOpen()) === true; } catch { return false; }
}

type Mode = "checking" | "no-vault" | "locked" | "ready";

export function SpotlightOverlay() {
  const { host } = useAppContext();
  const [mode, setMode] = useState<Mode>("checking");
  const [query, setQuery] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<QaCitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-check vault state every time the window regains focus (i.e.,
  // every time the user reopens the overlay). The vault might have
  // been unlocked or locked between opens.
  useEffect(() => {
    async function check() {
      const exists = await host.vaultExists();
      if (!exists) { setMode("no-vault"); return; }
      const open = await vaultIsOpenGlobally();
      setMode(open ? "ready" : "locked");
      setError(null);
    }
    void check();
    window.addEventListener("focus", () => void check());
    return () => window.removeEventListener("focus", () => void check());
  }, [host]);

  // Auto-focus the right input for the current mode.
  useEffect(() => { inputRef.current?.focus(); }, [mode]);

  // Escape always dismisses the overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") overlayBridge()?.hide();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await host.vaultUnlock(password);
      if (!ok) { setError("Wrong password. Try again."); return; }
      setPassword("");
      setMode("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setAnswer("");
    setSources([]);
    try {
      const r = await host.ask(q);
      setAnswer(r.answer);
      setSources(r.citations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the vault.");
    } finally {
      setBusy(false);
    }
  }

  // Markdown-aware answer renderer. Mirrors Chat.tsx so the overlay
  // doesn't display raw "**bold**" / bullet syntax. Citations like
  // [1] / [1,3] inside text nodes become inline pill badges (read-only
  // here — the overlay doesn't support click-to-scroll like Chat does).
  function renderAnswer(text: string): React.ReactNode {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p:      ({ children }) => <p className="my-1.5 leading-relaxed">{withCitations(children)}</p>,
          li:     ({ children }) => <li className="ml-4 list-disc leading-relaxed">{withCitations(children)}</li>,
          h1:     ({ children }) => <h3 className="mt-2 text-[14px] font-semibold">{children}</h3>,
          h2:     ({ children }) => <h3 className="mt-2 text-[14px] font-semibold">{children}</h3>,
          h3:     ({ children }) => <h4 className="mt-2 text-[13.5px] font-medium">{children}</h4>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em:     ({ children }) => <em className="italic">{children}</em>,
          code:   ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
          pre:    ({ children }) => <pre className="rounded-md bg-muted p-2 font-mono text-xs">{children}</pre>,
          ul:     ({ children }) => <ul className="my-1.5 space-y-0.5">{children}</ul>,
          ol:     ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-4">{children}</ol>,
          a:      ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>,
        }}
      >
        {text}
      </ReactMarkdown>
    );
  }

  return (
    <div className="flex items-start justify-center bg-transparent p-0">
      <div className="w-full max-w-[640px] overflow-hidden rounded-2xl border border-border/60 bg-card/95 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.5)] backdrop-blur-2xl">

        {/* Branded header — makes it clear which app this overlay belongs
            to, and gives a one-click dismiss. */}
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2">
          <div className="flex items-center gap-2">
            <OctoMark className="h-4 w-4" />
            <span className="text-[12px] font-semibold tracking-tight">OctoVault AI</span>
            <span className="text-[10.5px] uppercase tracking-[0.15em] text-muted-foreground">· quick ask</span>
          </div>
          <button
            type="button"
            onClick={() => overlayBridge()?.hide()}
            title="Close (esc)"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {mode === "ready" && (
          <form onSubmit={submit} className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            {busy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask your vault anything…"
              className="flex-1 border-0 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">⏎</kbd>
          </form>
        )}

        {mode === "locked" && (
          <form onSubmit={unlock} className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            {busy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : (
              <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Master password to unlock the vault…"
              className="flex-1 border-0 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            <kbd className="hidden rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">⏎</kbd>
          </form>
        )}

        {mode === "no-vault" && (
          <div className="flex items-center gap-3 border-b border-border/60 px-4 py-4">
            <Lock className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-[13.5px] font-medium">Set up your vault first</div>
              <div className="text-[11.5px] text-muted-foreground">Open OctoVault to create a master password — the overlay needs an existing vault to query.</div>
            </div>
          </div>
        )}

        {mode === "checking" && (
          <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking vault…
          </div>
        )}

        {(answer || error || busy && mode === "ready") && mode === "ready" && (
          <div className="max-h-[60vh] overflow-y-auto p-4">
            {error && (
              <div className="rounded-md border border-border bg-background px-3 py-2 text-[13px] text-muted-foreground">
                {error}
              </div>
            )}
            {answer && (
              <div className="space-y-3">
                <div className="text-[13.5px] leading-relaxed text-foreground">
                  {renderAnswer(answer)}
                </div>
                {sources.length > 0 && (
                  <div className="space-y-1.5 border-t border-border/60 pt-3">
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Sources
                    </div>
                    {sources.map((s, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-background px-2 py-1.5">
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-card px-1 text-[9px] font-medium">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-[11px] font-medium">
                            <FileText className="h-3 w-3 shrink-0" />
                            <span className="truncate">{s.documentName ?? s.documentId ?? "—"}</span>
                          </div>
                          {s.excerpt && (
                            <div className="mt-0.5 line-clamp-2 text-[10px] italic text-muted-foreground">
                              "{s.excerpt}"
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mode === "locked" && error && (
          <div className="px-4 py-2 text-[12px] text-foreground">
            {error}
          </div>
        )}

        {(mode === "ready" || mode === "locked") && !answer && !error && !busy && (
          <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-muted-foreground">
            <span>Press <kbd className="mx-1 rounded border border-border bg-background px-1 text-[10px]">↵</kbd> to {mode === "ready" ? "ask" : "unlock"} · <kbd className="mx-1 rounded border border-border bg-background px-1 text-[10px]">esc</kbd> to close</span>
            <span className="inline-flex items-center gap-1">
              <ArrowRight className="h-2.5 w-2.5" /> Local · on-device
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Wraps every text-node child, replacing [1] / [1,3] inline citation
// markers with small pill badges. Non-interactive (the overlay has
// no scroll-to-source target like Chat does).
function withCitations(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const parts: React.ReactNode[] = [];
    const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(child)) !== null) {
      if (m.index > lastIdx) parts.push(child.slice(lastIdx, m.index));
      const nums = m[1].split(",").map((n) => parseInt(n.trim(), 10));
      nums.forEach((n, i) => {
        parts.push(
          <span
            key={`${m!.index}-${n}-${i}`}
            className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-card px-1 align-baseline text-[9px] font-medium"
          >
            {n}
          </span>,
        );
        if (i < nums.length - 1) parts.push(" ");
      });
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < child.length) parts.push(child.slice(lastIdx));
    return parts.length > 0 ? <>{parts}</> : child;
  });
}
