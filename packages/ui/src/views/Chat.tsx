// Chat with your data. Multiple conversations, each with its own
// thread. RAG over local embeddings + facts. Every answer shows
// numbered citations linked to source documents and fields.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, AtSign, FileText, Loader2, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { Entity, QaCitation, QaResult, QaTurn, StoredDocument } from "@octovault/core";
import { useAppContext } from "../context";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { tx } from "../lib/brand";
import { cn } from "../lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: QaCitation[];
  scopedEntities?: { id: string; name: string }[];   // for assistant: which entities the question was scoped to
  at: number;
  // True while tokens are still streaming in. Used by the UI to show
  // a blinking cursor and skip "no results" empty-state rendering.
  streaming?: boolean;
}

// Resolve "@name" tokens in the user's input to entity IDs.
// Returns the matched entities (in order) and the cleaned text with
// the @tokens stripped, so the LLM prompt isn't polluted.
function parseMentions(input: string, entities: Entity[]): { matched: Entity[]; cleaned: string } {
  const matched: Entity[] = [];
  // Match @ followed by letters/digits (and dots/dashes/spaces until end).
  // We keep matching greedy from longest entity name.
  const sortedByLen = [...entities].sort((a, b) => b.name.length - a.name.length);
  let cleaned = input;
  for (const ent of sortedByLen) {
    const pattern = new RegExp(`@${ent.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "gi");
    if (pattern.test(cleaned)) {
      matched.push(ent);
      cleaned = cleaned.replace(pattern, "").trim();
    } else {
      // Also accept just the first name as @Sunil etc.
      const first = ent.name.split(/\s+/)[0];
      if (first) {
        const firstPattern = new RegExp(`@${first.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "gi");
        if (firstPattern.test(cleaned)) {
          if (!matched.includes(ent)) matched.push(ent);
          cleaned = cleaned.replace(firstPattern, "").trim();
        }
      }
    }
  }
  return { matched, cleaned: cleaned.replace(/\s+/g, " ").trim() || input };
}

interface Conversation {
  id: string;
  title: string;             // derived from first user message; "New chat" if empty
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "octovault.chat.conversations.v1";
const ACTIVE_KEY = "octovault.chat.activeId.v1";

function loadConversations(): Conversation[] {
  try { return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Conversation[]); }
  catch { return []; }
}
function saveConversations(c: Conversation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

export function Chat() {
  const { host, documents, entities } = useAppContext();
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // Ensure there's always one active conversation.
  useEffect(() => {
    if (!activeId || !conversations.some((c) => c.id === activeId)) {
      if (conversations.length === 0) {
        newConversation();
      } else {
        setActiveId(conversations[0].id);
      }
    }
  }, [activeId, conversations]);

  useEffect(() => { saveConversations(conversations); }, [conversations]);
  useEffect(() => { if (activeId) localStorage.setItem(ACTIVE_KEY, activeId); }, [activeId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
    });
  }, [activeId, conversations]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  function newConversation() {
    const c: Conversation = {
      id: crypto.randomUUID(),
      title: "New chat",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setConversations((cs) => [c, ...cs]);
    setActiveId(c.id);
  }

  function deleteConversation(id: string) {
    setConversations((cs) => cs.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function send() {
    const q = input.trim();
    if (!q || busy || !active) return;
    setInput("");

    // Pull out @mentions → scope the retrieval to those entities.
    const { matched, cleaned } = parseMentions(q, entities);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text: q, at: Date.now() };
    const scopedEntities = matched.map((e) => ({ id: e.id, name: e.name }));

    setConversations((cs) => cs.map((c) => c.id !== active.id ? c : {
      ...c,
      title: c.messages.length === 0 ? q.slice(0, 60) : c.title,
      messages: [...c.messages, userMsg],
      updatedAt: Date.now(),
    }));
    setBusy(true);
    // Insert an empty assistant placeholder up-front and stream tokens
    // into it. This is what makes the chat *feel* fast — the user sees
    // text appear immediately instead of staring at a spinner.
    const replyId = crypto.randomUUID();
    const placeholder: ChatMessage = {
      id: replyId, role: "assistant", text: "",
      scopedEntities: scopedEntities.length > 0 ? scopedEntities : undefined,
      at: Date.now(), streaming: true,
    };
    setConversations((cs) => cs.map((c) => c.id !== active.id ? c : {
      ...c, messages: [...c.messages, placeholder], updatedAt: Date.now(),
    }));
    try {
      // Build chat history from prior turns for query rewriting.
      const history: QaTurn[] = active.messages.map((m) => ({
        role: m.role, text: m.text,
      }));
      const res: QaResult = await host.ask(cleaned, {
        scope: matched.length > 0 ? { entityIds: matched.map((e) => e.id) } : undefined,
        history,
        onAnswerToken: (chunk) => {
          setConversations((cs) => cs.map((c) => c.id !== active.id ? c : {
            ...c,
            messages: c.messages.map((m) => m.id === replyId ? { ...m, text: m.text + chunk } : m),
          }));
        },
      });
      // Final pass: overwrite with the sanitized text (thinking tags
      // stripped) and attach citations + clear streaming flag.
      setConversations((cs) => cs.map((c) => c.id !== active.id ? c : {
        ...c,
        messages: c.messages.map((m) => m.id === replyId
          ? { ...m, text: res.answer, citations: res.citations, streaming: false }
          : m),
        updatedAt: Date.now(),
      }));
    } catch (err) {
      // Replace the streaming placeholder with the error.
      setConversations((cs) => cs.map((c) => c.id !== active.id ? c : {
        ...c,
        messages: c.messages.map((m) => m.id === replyId
          ? { ...m, text: `Error: ${err instanceof Error ? err.message : String(err)}`, streaming: false }
          : m),
        updatedAt: Date.now(),
      }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* History rail */}
      <aside className="flex w-60 shrink-0 flex-col border-r">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className={tx.microcap}>History</span>
          <Button size="sm" variant="ghost" onClick={newConversation} title="New chat">
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="px-2 py-1 text-xs text-muted-foreground">No chats yet.</div>
          ) : (
            <ul className="space-y-0.5">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={cn(
                      "group flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent",
                      activeId === c.id && "bg-accent"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{c.title || "New chat"}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {c.messages.length} message{c.messages.length === 1 ? "" : "s"} · {new Date(c.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                      className="invisible mt-0.5 group-hover:visible"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Conversation pane */}
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className={tx.h2}>{active?.title ?? "Chat with your data"}</h2>
            <p className={tx.muted}>
              Answers come only from your local documents and extracted facts. Every claim cites its source.
            </p>
          </div>
        </div>

        <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4">
          {!active || active.messages.length === 0 ? <EmptyState /> : (
            <div className="mx-auto max-w-3xl space-y-4">
              {active.messages.map((m) => (
                <MessageRow key={m.id} message={m} documents={documents} />
              ))}
              {busy && (
                <div className={cn("flex items-center gap-2", tx.muted)}>
                  <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t bg-background p-3">
          <div className="mx-auto max-w-3xl space-y-1.5">
            {entities.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={tx.microcap}>Scope with</span>
                {entities.slice(0, 6).map((e) => {
                  const first = e.name.split(/\s+/)[0];
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setInput((s) => `${s.trim()} @${first} `.trimStart())}
                      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium hover:bg-accent"
                      title={`Insert @${first}`}
                    >
                      <AtSign className="h-2.5 w-2.5" /> {first}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Ask anything about your documents… (try @Sunil to scope)"
                className="flex max-h-32 min-h-9 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button onClick={() => void send()} disabled={busy || !input.trim()} size="icon">
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-10 max-w-xl space-y-4 text-center">
      <Sparkles className="mx-auto h-6 w-6 text-muted-foreground" />
      <h3 className={tx.h1}>Ask about your documents</h3>
      <p className={tx.muted}>
        Everything you ask runs on your device. Try one of these:
      </p>
      <div className="grid gap-2">
        {[
          "When does my passport expire?",
          "What is my home address?",
          "When did I graduate from my master's?",
          "Show me Katha's birth date.",
        ].map((q) => (
          <Card key={q} className="cursor-text px-3 py-2 text-left text-sm">
            "{q}"
          </Card>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message, documents }: { message: ChatMessage; documents: StoredDocument[] }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <Card className={cn("max-w-[80%] bg-accent px-3 py-2", tx.body)}>{message.text}</Card>
      </div>
    );
  }
  const messageId = message.id;
  const citationId = (n: number) => `cite-${messageId}-${n}`;

  return (
    <div className="space-y-2">
      {message.scopedEntities && message.scopedEntities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className={tx.microcap}>scope:</span>
          {message.scopedEntities.map((e) => (
            <Badge key={e.id} variant="outline" className="gap-1">
              <AtSign className="h-2.5 w-2.5" /> {e.name}
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <MarkdownAnswer text={message.text} citationCount={message.citations?.length ?? 0} jumpTo={citationId} />
        {message.streaming && (
          <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-foreground align-text-bottom" aria-hidden />
        )}
      </div>
      {message.citations && message.citations.length > 0 && (
        <div className="space-y-1.5">
          <div className={tx.microcap}>Sources</div>
          <div className="flex flex-wrap gap-1.5">
            {message.citations.map((c, i) => {
              const doc = documents.find((d) => d.id === c.documentId);
              return (
                <Card id={citationId(i + 1)} key={i} className="flex max-w-md items-start gap-2 px-2 py-1.5 text-xs">
                  <Badge variant="outline">{i + 1}</Badge>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate font-medium">{doc?.name ?? c.documentName ?? "user-entered"}</span>
                      {c.page && <span className="text-muted-foreground">p.{c.page}</span>}
                    </div>
                    {c.fieldLabel && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{c.fieldLabel}</div>
                    )}
                    <div className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                      "{c.excerpt}"
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Renders the assistant's answer as Markdown, with all [N] citation
// references turned into small clickable pills that scroll to the
// matching source card below.
function MarkdownAnswer({
  text, citationCount, jumpTo,
}: { text: string; citationCount: number; jumpTo: (n: number) => string }) {
  const handleCite = (n: number) => {
    const el = document.getElementById(jumpTo(n));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-foreground");
    setTimeout(() => el.classList.remove("ring-2", "ring-foreground"), 1500);
  };

  // Wrap the text in plain markdown, but replace [N] and [N,M] spans
  // inside children using a custom text renderer.
  return (
    <div className={cn(tx.prose, "[&>*+*]:mt-3 [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p:      ({ children }) => <p className="my-2 leading-relaxed">{withCitations(children, citationCount, handleCite)}</p>,
          li:     ({ children }) => <li className="ml-4 list-disc leading-relaxed">{withCitations(children, citationCount, handleCite)}</li>,
          h1:     ({ children }) => <h3 className={cn("mt-3", tx.h3)}>{children}</h3>,
          h2:     ({ children }) => <h3 className={cn("mt-3", tx.h3)}>{children}</h3>,
          h3:     ({ children }) => <h4 className="mt-3 font-medium">{children}</h4>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em:     ({ children }) => <em className="italic">{children}</em>,
          code:   ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{children}</code>,
          pre:    ({ children }) => <pre className="rounded-md bg-muted p-3 font-mono text-xs">{children}</pre>,
          ul:     ({ children }) => <ul className="my-2 space-y-1">{children}</ul>,
          ol:     ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-4">{children}</ol>,
          a:      ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// Scans a React children tree's text nodes, replaces "[1]" / "[1,3]"
// patterns with clickable Badge components.
function withCitations(children: React.ReactNode, max: number, onClick: (n: number) => void): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child !== "string") return child;
    const parts: React.ReactNode[] = [];
    const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(child)) !== null) {
      if (m.index > lastIdx) parts.push(child.slice(lastIdx, m.index));
      const nums = m[1].split(",").map((n) => parseInt(n.trim(), 10)).filter((n) => n >= 1 && n <= max);
      if (nums.length === 0) {
        parts.push(m[0]);
      } else {
        nums.forEach((n, i) => {
          parts.push(
            <button
              key={`${m!.index}-${n}`}
              onClick={() => onClick(n)}
              className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border bg-card px-1 align-baseline text-[10px] font-medium hover:bg-accent"
              title="Jump to source"
            >
              {n}
            </button>
          );
          if (i < nums.length - 1) parts.push(" ");
        });
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < child.length) parts.push(child.slice(lastIdx));
    return parts.length > 0 ? <>{parts}</> : child;
  });
}
