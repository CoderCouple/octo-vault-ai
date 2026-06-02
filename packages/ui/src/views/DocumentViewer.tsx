// Open a stored document. Two source modes for the preview:
//   - fileDataUrl: base64 embedded in the doc record (permanent)
//   - filePath:    absolute path on disk (desktop only, zero storage,
//     read on demand via IPC)
//
// Layout: 3-pane.
//   1. Header — title, entity assignment, metadata, badges
//   2. Left  — original file preview
//   3. Right — scrollable detail: extracted facts, records, raw text

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, FileText, Image as ImageIcon, Loader2,
  Paperclip, Pin, ScanLine, UserCircle2,
} from "lucide-react";
import {
  canonicalValue, fieldByKey,
  type EducationRecord, type ExperienceRecord, type Profile, type StoredDocument,
} from "@octovault/core";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import { ScrollArea } from "../components/ui/scroll-area";
import { Separator } from "../components/ui/separator";
import { useAppContext } from "../context";
import { tx } from "../lib/brand";

interface DocBridge {
  readBytes(id: string): Promise<{ bytes: Uint8Array; mimeType?: string } | null>;
}
function desktopDoc(): DocBridge | undefined {
  return (window as unknown as { octovault?: { doc?: DocBridge } }).octovault?.doc;
}

interface DocFact {
  fieldKey: string;
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  excerpt?: string;
  page?: number;
  conflicted: boolean;
}

export function DocumentViewer({
  doc, open, onOpenChange,
}: {
  doc: StoredDocument | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { storage, refreshDocuments, entities, setActiveEntityId, readOnly } = useAppContext();
  const fileInput = useRef<HTMLInputElement>(null);

  // Preview source
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingFromDisk, setLoadingFromDisk] = useState(false);
  const [diskError, setDiskError] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);

  // Right-pane data derived from this doc
  const [facts, setFacts] = useState<DocFact[]>([]);
  const [education, setEducation] = useState<EducationRecord[]>([]);
  const [experience, setExperience] = useState<ExperienceRecord[]>([]);

  const isPdf = !!doc && (doc.mimeType === "application/pdf" || doc.name.toLowerCase().endsWith(".pdf"));
  const isImage = !!doc && (doc.mimeType?.startsWith("image/") ?? /\.(jpe?g|png|webp|gif|heic)$/i.test(doc.name));
  const entity = doc ? entities.find((e) => e.id === doc.entityId) : null;

  // Load preview when doc opens.
  useEffect(() => {
    setPreviewUrl(null); setDiskError(null);
    if (!doc || !open) return;

    if (doc.fileDataUrl) { setPreviewUrl(doc.fileDataUrl); return; }
    if (doc.filePath && desktopDoc()) {
      let cancelled = false;
      let blobUrl: string | null = null;
      setLoadingFromDisk(true);
      void (async () => {
        try {
          const res = await desktopDoc()!.readBytes(doc.id);
          if (cancelled) return;
          if (!res) { setDiskError("Original file is missing at " + doc.filePath); return; }
          const blob = new Blob([res.bytes as BlobPart], { type: res.mimeType ?? doc.mimeType ?? "application/octet-stream" });
          blobUrl = URL.createObjectURL(blob);
          setPreviewUrl(blobUrl);
        } catch (e) {
          setDiskError(e instanceof Error ? e.message : String(e));
        } finally {
          if (!cancelled) setLoadingFromDisk(false);
        }
      })();
      return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
    }
  }, [doc, open]);

  // Load facts + records derived from this document.
  useEffect(() => {
    if (!doc || !open) { setFacts([]); setEducation([]); setExperience([]); return; }
    void (async () => {
      const [profile, edu, exp] = await Promise.all([
        storage.getProfile(doc.entityId),
        storage.listEducation(doc.entityId),
        storage.listExperience(doc.entityId),
      ]);
      setFacts(buildDocFacts(profile, doc.id));
      setEducation(edu.filter((r) => r.source.documentId === doc.id));
      setExperience(exp.filter((r) => r.source.documentId === doc.id));
    })();
  }, [doc, open, storage]);

  async function attachOriginal(file: File) {
    if (!doc) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    await storage.saveDocument({
      ...doc,
      mimeType: file.type || doc.mimeType
        || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : undefined),
      fileDataUrl: dataUrl,
    });
    await refreshDocuments();
    onOpenChange(false);
  }

  async function makePermanent() {
    if (!doc?.filePath || !desktopDoc()) return;
    setPinning(true);
    try {
      const res = await desktopDoc()!.readBytes(doc.id);
      if (!res) throw new Error("Could not read file");
      const blob = new Blob([res.bytes as BlobPart], { type: res.mimeType ?? doc.mimeType ?? "application/octet-stream" });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      await storage.saveDocument({ ...doc, fileDataUrl: dataUrl });
      await refreshDocuments();
    } catch (e) {
      setDiskError(e instanceof Error ? e.message : String(e));
    } finally {
      setPinning(false);
    }
  }

  if (!doc) return null;
  const hasPermanent = !!doc.fileDataUrl;
  const hasPath = !!doc.filePath;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] max-w-[1200px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {doc.ocrUsed ? <ScanLine className="h-4 w-4 shrink-0" />
             : isImage ? <ImageIcon className="h-4 w-4 shrink-0" />
             : <FileText className="h-4 w-4 shrink-0" />}
            <DialogTitle className="truncate text-base">{doc.name}</DialogTitle>
            {hasPermanent && <Badge variant="outline" className="ml-1 gap-1"><Pin className="h-2.5 w-2.5" /> embedded</Badge>}
            {!hasPermanent && hasPath && <Badge variant="muted" className="ml-1">linked from disk</Badge>}
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide">
            <Badge variant="outline">{doc.docType}</Badge>
            {doc.ocrUsed && <Badge variant="muted">OCR</Badge>}
            <span className="text-muted-foreground">
              {doc.pageCount} pg · {(doc.bytes / 1024).toFixed(0)} KB · {new Date(doc.importedAt).toLocaleDateString()}
            </span>
            {hasPath && !hasPermanent && (
              <span className="ml-auto truncate text-muted-foreground normal-case">{doc.filePath}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[3fr_2fr]">
          {/* Left: original preview */}
          <div className="relative min-h-0 overflow-hidden border-r bg-muted/30">
            {loadingFromDisk ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading from disk…
              </div>
            ) : previewUrl ? (
              isPdf ? (
                <iframe src={previewUrl} title={doc.name} className="h-full w-full" />
              ) : isImage ? (
                <div className="flex h-full items-center justify-center overflow-auto p-4">
                  <img src={previewUrl} alt={doc.name} className="max-h-full max-w-full object-contain" />
                </div>
              ) : (
                <NoPreview text="Preview not supported for this file type." />
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <div className="max-w-xs text-sm text-muted-foreground">
                  {diskError ?? "Original file isn't available — it was imported before file referencing was added, or the file has moved."}
                </div>
                {!readOnly && (
                  <>
                    <Button onClick={() => fileInput.current?.click()} size="sm">
                      <Paperclip className="h-3.5 w-3.5" /> Attach original
                    </Button>
                    <input
                      ref={fileInput} type="file" hidden
                      accept=".pdf,image/png,image/jpeg,image/webp"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachOriginal(f); }}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Pick the file from disk. Extraction isn't re-run.
                    </p>
                  </>
                )}
              </div>
            )}

            {!hasPermanent && hasPath && previewUrl && !readOnly && (
              <div className="absolute bottom-2 right-2">
                <Button size="sm" variant="outline" disabled={pinning} onClick={() => void makePermanent()}>
                  {pinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
                  Embed in vault
                </Button>
              </div>
            )}
          </div>

          {/* Right: detail pane (entity / facts / records / text) */}
          <ScrollArea className="min-h-0">
            <div className="space-y-4 p-4">

              {/* 1. Entity */}
              <section className="space-y-1.5">
                <div className={tx.microcap}>Belongs to</div>
                {entity ? (
                  <Card
                    onClick={() => { setActiveEntityId(entity.id); onOpenChange(false); }}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-accent/30"
                    title="Switch to this entity's profile"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-card text-xs font-medium">
                      {entity.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{entity.name}</div>
                      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <span>{entity.relationship}</span>
                        {entity.email && <><span>·</span><span className="normal-case truncate">{entity.email}</span></>}
                      </div>
                    </div>
                    <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Card>
                ) : (
                  <div className="text-xs text-muted-foreground">Not assigned to any entity.</div>
                )}
              </section>

              <Separator />

              {/* 2. Extracted facts (FieldRecord candidates sourced from this doc) */}
              <section className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className={tx.microcap}>Extracted facts</span>
                  <span className={tx.muted}>{facts.length}</span>
                </div>
                {facts.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No fields were extracted from this document.</div>
                ) : (
                  <div className="space-y-1.5">
                    {facts.map((f) => (
                      <Card key={f.fieldKey} className="space-y-0.5 px-2.5 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{f.label}</span>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline">{f.confidence}</Badge>
                            {f.conflicted && (
                              <Badge variant="muted" className="gap-1">
                                <AlertTriangle className="h-2.5 w-2.5" /> conflict
                              </Badge>
                            )}
                            {f.page && <Badge variant="muted">p.{f.page}</Badge>}
                          </div>
                        </div>
                        <div className="font-mono text-xs">{f.value}</div>
                        {f.excerpt && (
                          <div className="line-clamp-2 text-[10px] italic text-muted-foreground">
                            "{f.excerpt}"
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              {/* 3. Repeating records — education + experience from this doc */}
              {education.length > 0 && (
                <>
                  <Separator />
                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className={tx.microcap}>Education from this document</span>
                      <span className={tx.muted}>{education.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {education.map((e) => (
                        <Card key={e.id} className="px-2.5 py-1.5 text-xs">
                          <div className="font-medium">
                            {e.degree ?? "Degree"}{e.field ? ` in ${e.field}` : ""}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {e.institution}
                            {e.endDate ? ` · ${e.endDate}` : e.startDate ? ` · since ${e.startDate}` : ""}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {experience.length > 0 && (
                <>
                  <Separator />
                  <section className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className={tx.microcap}>Experience from this document</span>
                      <span className={tx.muted}>{experience.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {experience.map((e) => (
                        <Card key={e.id} className="px-2.5 py-1.5 text-xs">
                          <div className="font-medium">{e.role}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {e.company}
                            {e.endDate ? ` · until ${e.endDate}` : e.startDate ? ` · since ${e.startDate}` : ""}
                            {e.location ? ` · ${e.location}` : ""}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </section>
                </>
              )}

              <Separator />

              {/* 4. Raw extracted text */}
              <section className="space-y-1.5">
                <span className={tx.microcap}>Raw extracted text</span>
                {doc.text.trim().length > 0 ? (
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border bg-muted/40 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {doc.text}
                  </pre>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    No text was extracted. May be a scanned file where OCR returned nothing.
                  </div>
                )}
              </section>

            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildDocFacts(profile: Profile, docId: string): DocFact[] {
  const out: DocFact[] = [];
  for (const record of Object.values(profile)) {
    if (!record) continue;
    const cand = record.candidates.find((c) => c.source.documentId === docId && !c.dismissedAt);
    if (!cand) continue;
    const canonical = canonicalValue(record);
    out.push({
      fieldKey: record.key,
      label: fieldByKey(record.key).label,
      value: cand.value,
      confidence: cand.confidence,
      excerpt: cand.source.excerpt,
      page: cand.source.page,
      conflicted: record.conflictState !== "none" && cand.id !== canonical?.id,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function NoPreview({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-xs text-sm text-muted-foreground">{text}</div>
    </div>
  );
}
