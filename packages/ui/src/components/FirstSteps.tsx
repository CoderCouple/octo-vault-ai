// First-use guided tour. A compact dismissable checklist that follows
// the user across views. Steps auto-tick as the user actually does
// each thing — no manual confirm.
//
//   1. Import your first document
//   2. Add a relative or family member (optional — auto-ticks if any
//      entity beyond Self exists)
//   3. Ask a question in chat
//   4. Install the browser extension to fill web forms
//
// Dismissable; re-runnable from Settings via the same flag.

import { useEffect, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import { useAppContext } from "../context";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { cn } from "../lib/utils";
import { tx } from "../lib/brand";

const STORAGE_KEY = "octovault.firstSteps.dismissed";

interface Step {
  id: string;
  label: string;
  hint: string;
  done: boolean;
}

export function FirstSteps() {
  const { documents, entities } = useAppContext();
  const [dismissed, setDismissed] = useState<boolean>(() => localStorage.getItem(STORAGE_KEY) === "1");
  const [chatStarted, setChatStarted] = useState<boolean>(() => {
    try {
      const cs = JSON.parse(localStorage.getItem("octovault.chat.conversations.v1") ?? "[]") as Array<{ messages?: unknown[] }>;
      return cs.some((c) => (c.messages?.length ?? 0) > 0);
    } catch { return false; }
  });

  // Cheap polling: chat persists to localStorage, so just re-check on focus.
  useEffect(() => {
    const onFocus = () => {
      try {
        const cs = JSON.parse(localStorage.getItem("octovault.chat.conversations.v1") ?? "[]") as Array<{ messages?: unknown[] }>;
        setChatStarted(cs.some((c) => (c.messages?.length ?? 0) > 0));
      } catch { /* ignore */ }
    };
    window.addEventListener("focus", onFocus);
    const id = setInterval(onFocus, 4000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(id); };
  }, []);

  const steps: Step[] = [
    { id: "doc", label: "Import your first document", hint: "Drop a PDF or image in the Documents panel below.", done: documents.length > 0 },
    { id: "entity", label: "Add a family member", hint: "Manage who lives in your vault under Entities. Optional — extractor will create them too.", done: entities.length > 1 },
    { id: "chat", label: "Ask a question in Chat", hint: "Try \"What is my passport expiry?\" — answers come from your local data.", done: chatStarted },
    { id: "ext", label: "Install the browser extension", hint: "Build it with npm run build:extension, load it in chrome://extensions, and pin it.", done: false },
  ];
  const completed = steps.filter((s) => s.done).length;
  const allDone = completed === steps.length;

  if (dismissed || allDone) return null;

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={tx.microcap}>First steps</span>
          <span className={tx.muted}>{completed}/{steps.length}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { localStorage.setItem(STORAGE_KEY, "1"); setDismissed(true); }} title="Dismiss">
          <X className="h-3 w-3" />
        </Button>
      </div>
      <ul className="space-y-1">
        {steps.map((s) => (
          <li key={s.id} className="flex items-start gap-2 rounded px-1 py-1">
            <span className={cn(
              "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
              s.done && "border-foreground bg-foreground text-background"
            )}>
              {s.done ? <Check className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
            </span>
            <div className="min-w-0">
              <div className={cn("text-sm", s.done && "text-muted-foreground line-through")}>{s.label}</div>
              {!s.done && <div className={tx.muted}>{s.hint}</div>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Allow Settings to reset the dismissal so the user can re-run the tour.
export function resetFirstSteps() {
  localStorage.removeItem(STORAGE_KEY);
}
