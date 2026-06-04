// Spotlight-style overlay. Single input → streamed answer + citations via
// host.ask(). Lives in its own BrowserWindow (transparent, frameless,
// alwaysOnTop) on the desktop, invoked by Cmd+Option+O or the floating
// shortcut. Dismisses on Escape, on blur (window loses focus), or after
// the user clicks a citation that opens the main app.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, FileText, Loader2, Search } from "lucide-react";
import { useAppContext } from "../context";
import type { QaCitation } from "@octovault/core";

// Desktop preload bridge exposes window.octovault.overlay; UI package
// doesn't import the desktop types so we declare the minimal shape here.
interface OverlayBridge { hide: () => void; show: () => void; toggle: () => void }
function overlayBridge(): OverlayBridge | undefined {
  const w = window as unknown as { octovault?: { overlay?: OverlayBridge } };
  return w.octovault?.overlay;
}

export function SpotlightOverlay() {
  const { host } = useAppContext();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<QaCitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount and any time the window regains focus.
  useEffect(() => {
    inputRef.current?.focus();
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Escape dismisses the overlay. The main process is listening on the
  // "overlay.hide" IPC channel and hides the window when fired.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") overlayBridge()?.hide();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      setError(e instanceof Error ? e.message : "Couldn't reach the vault. Open OctoVault and unlock first.");
    } finally {
      setBusy(false);
    }
  }

  // Replace [N] markers with a tiny citation pill that scrolls into view.
  function renderAnswer(text: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let last = 0;
    const re = /\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const n = parseInt(m[1]!, 10);
      out.push(
        <span key={`${m.index}-${n}`} className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-card px-1 align-baseline text-[9px] font-medium">
          {n}
        </span>,
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  return (
    <div className="flex h-svh items-start justify-center bg-transparent p-0">
      <div className="mt-0 w-full max-w-[640px] overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
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

        {(answer || error || busy) && (
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

        {!answer && !error && !busy && (
          <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-muted-foreground">
            <span>Press <kbd className="mx-1 rounded border border-border bg-background px-1 text-[10px]">↵</kbd> to ask · <kbd className="mx-1 rounded border border-border bg-background px-1 text-[10px]">esc</kbd> to close</span>
            <span className="inline-flex items-center gap-1">
              <ArrowRight className="h-2.5 w-2.5" /> Local · on-device
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
