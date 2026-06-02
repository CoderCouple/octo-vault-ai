// Documents view. Drag-and-drop import with a proper job queue:
// every dropped file becomes an ImportJob that progresses through
// queued → reading → ocr → extracting → indexing → done (or error).
// Jobs render in a panel above the document list with per-file
// progress bars. Done jobs auto-dismiss; errors stay until cleared.

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Check, FileText, RotateCw, ScanLine, Trash2, Upload, X,
} from "lucide-react";
import {
  addCandidates, chunkText, fieldByKey,
  extractImageText,
  extractPdfText,
  type EmbeddingRecord, type FieldCandidate, type StoredDocument,
} from "@octovault/core";
import { useAppContext } from "../context";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { cn } from "../lib/utils";
import { tx } from "../lib/brand";
import { FirstSteps } from "../components/FirstSteps";
import { DocumentViewer } from "./DocumentViewer";

const ACCEPT = ".pdf,image/png,image/jpeg,image/webp";

type JobState = "queued" | "reading" | "ocr" | "extracting" | "indexing" | "done" | "error";

interface ImportJob {
  id: string;
  file: File;
  fileName: string;
  size: number;
  state: JobState;
  progress: number;        // 0..1
  message?: string;
  error?: string;
}

const STATE_LABELS: Record<JobState, string> = {
  queued: "Queued",
  reading: "Reading",
  ocr: "OCR",
  extracting: "Extracting",
  indexing: "Indexing",
  done: "Done",
  error: "Error",
};

export function Documents() {
  const {
    host, storage, documents, refreshDocuments, readOnly, source,
    activeEntityId, resolveEntityFromName, entities, setActiveEntityId,
  } = useAppContext();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [pendingDelete, setPendingDelete] = useState<StoredDocument | null>(null);
  const [viewing, setViewing] = useState<StoredDocument | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  // Mirror jobs into a ref for synchronous reads inside the queue loop.
  const jobsRef = useRef<ImportJob[]>([]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  function updateJob(id: string, patch: Partial<ImportJob>) {
    setJobs((js) => {
      const next = js.map((j) => (j.id === id ? { ...j, ...patch } : j));
      jobsRef.current = next;
      return next;
    });
  }

  async function processNext() {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (true) {
        const job = jobsRef.current.find((j) => j.state === "queued");
        if (!job) break;
        await runJob(job);
      }
    } finally {
      processingRef.current = false;
    }
  }

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function runJob(job: ImportJob) {
    const id = job.id;
    try {
      const docId = crypto.randomUUID();
      const lower = job.fileName.toLowerCase();
      let text = "";
      let pageCount = 1;
      let ocrUsed = false;

      if (lower.endsWith(".pdf")) {
        updateJob(id, { state: "reading", progress: 0.05, message: "Reading PDF" });
        const out = await extractPdfText(job.file, {
          onProgress: (s, f) => updateJob(id, {
            state: s.toLowerCase().includes("ocr") ? "ocr" : "reading",
            progress: 0.05 + f * 0.4, message: s,
          }),
          onOcrProgress: (p) => updateJob(id, {
            state: "ocr",
            progress: 0.05 + 0.4 * (p.page / p.totalPages),
            message: `OCR page ${p.page}/${p.totalPages}`,
          }),
        });
        text = out.text; pageCount = out.pageCount; ocrUsed = out.ocrUsed;
      } else if (job.file.type.startsWith("image/")) {
        updateJob(id, { state: "ocr", progress: 0.1, message: "OCR image" });
        const out = await extractImageText(job.file, {
          onOcrProgress: (p) => updateJob(id, {
            state: "ocr", progress: 0.1 + p.fraction * 0.35,
            message: `OCR ${Math.round(p.fraction * 100)}%`,
          }),
        });
        text = out.text; ocrUsed = true;
      } else {
        throw new Error(`Unsupported file type: ${job.fileName}`);
      }

      updateJob(id, { state: "extracting", progress: 0.5, message: "Extracting fields" });
      const { docType, candidates, education, experience, entityName, relationshipHint } =
        await host.extractFromText(docId, text);

      const entity = entityName
        ? await resolveEntityFromName(entityName, relationshipHint)
        : { id: activeEntityId };

      // Stash the original bytes as a base64 data URL so the in-app
      // viewer can render the actual PDF / image. Best-effort: don't
      // block import if encoding fails (large files, OOM).
      let fileDataUrl: string | undefined;
      try { fileDataUrl = await fileToDataUrl(job.file); }
      catch (e) { console.warn(`[ingest] could not encode original ${job.fileName}:`, e); }

      const mimeType = job.file.type
        || (lower.endsWith(".pdf") ? "application/pdf" : undefined);

      const doc: StoredDocument = {
        id: docId, entityId: entity.id, name: job.fileName, importedAt: Date.now(),
        bytes: job.size, text, pageCount, docType, ocrUsed,
        mimeType, fileDataUrl,
      };
      await storage.saveDocument(doc);
      const withEntity: FieldCandidate[] = candidates.map((c) => ({ ...c, entityId: entity.id }));
      if (withEntity.length) await addCandidates(storage, withEntity);
      for (const e of education) await storage.saveEducation({ ...e, entityId: entity.id });
      for (const e of experience) await storage.saveExperience({ ...e, entityId: entity.id });

      // Best-effort embedding for chat.
      updateJob(id, { state: "indexing", progress: 0.7, message: "Indexing for chat" });
      try {
        const embeddings: EmbeddingRecord[] = [];
        for (const c of withEntity) {
          const label = fieldByKey(c.fieldKey).label;
          const t = `${label}: ${c.value}`;
          embeddings.push({
            id: crypto.randomUUID(), kind: "fact",
            entityId: c.entityId, documentId: doc.id, fieldKey: c.fieldKey, page: c.source.page,
            text: t, vector: await host.embed(t),
          });
        }
        const chunks = chunkText(doc.text);
        for (let i = 0; i < chunks.length; i++) {
          updateJob(id, {
            progress: 0.7 + 0.25 * ((i + 1) / Math.max(chunks.length, 1)),
            message: `Indexing chunk ${i + 1}/${chunks.length}`,
          });
          embeddings.push({
            id: crypto.randomUUID(), kind: "chunk",
            entityId: entity.id, documentId: doc.id,
            text: chunks[i], vector: await host.embed(chunks[i]),
          });
        }
        for (const e of education) {
          const t = [e.degree, e.field, "at", e.institution, e.startDate, "to", e.endDate].filter(Boolean).join(" ");
          if (!t) continue;
          embeddings.push({
            id: crypto.randomUUID(), kind: "chunk",
            entityId: entity.id, documentId: doc.id,
            text: `Education: ${t}`, vector: await host.embed(`Education: ${t}`),
          });
        }
        for (const e of experience) {
          const t = [e.role, "at", e.company, e.startDate, "to", e.endDate || "present", e.location].filter(Boolean).join(" ");
          if (!t) continue;
          embeddings.push({
            id: crypto.randomUUID(), kind: "chunk",
            entityId: entity.id, documentId: doc.id,
            text: `Experience: ${t}`, vector: await host.embed(`Experience: ${t}`),
          });
        }
        if (embeddings.length) await storage.saveEmbeddings(embeddings);
      } catch (e) {
        console.warn("[indexing] embeddings failed:", e);
      }

      updateJob(id, { state: "done", progress: 1, message: "Done" });
      await refreshDocuments();

      // Auto-dismiss successful jobs after 2.5s.
      setTimeout(() => setJobs((js) => {
        const next = js.filter((j) => j.id !== id);
        jobsRef.current = next;
        return next;
      }), 2500);
    } catch (err) {
      updateJob(id, {
        state: "error",
        progress: 1,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const newJobs: ImportJob[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      fileName: file.name,
      size: file.size,
      state: "queued",
      progress: 0,
    }));
    setJobs((js) => {
      const next = [...js, ...newJobs];
      jobsRef.current = next;
      return next;
    });
    void processNext();
  }

  function dismissJob(id: string) {
    setJobs((js) => {
      const next = js.filter((j) => j.id !== id);
      jobsRef.current = next;
      return next;
    });
  }

  async function confirmDelete(d: StoredDocument) {
    await storage.deleteDocument(d.id);
    await storage.deleteCandidatesFromDoc(d.id);
    await storage.deleteEmbeddingsForDoc(d.id);
    await storage.deleteRecordsFromDoc(d.id);
    setPendingDelete(null);
    await refreshDocuments();
  }

  // Re-extract: enqueue this doc as a synthetic job that skips the
  // PDF/OCR pass (text is already stored) and re-runs extraction
  // + indexing with the current code path.
  async function reExtract(d: StoredDocument) {
    if (readOnly) return;
    // First clear the existing extracted data so the new pass starts clean.
    await storage.deleteCandidatesFromDoc(d.id);
    await storage.deleteEmbeddingsForDoc(d.id);
    await storage.deleteRecordsFromDoc(d.id);
    const job: ImportJob = {
      id: crypto.randomUUID(),
      file: new File([d.text], d.name, { type: "text/plain" }),
      fileName: d.name,
      size: d.bytes,
      state: "extracting",
      progress: 0.5,
      message: "Re-extracting…",
    };
    setJobs((js) => {
      const next = [...js, job];
      jobsRef.current = next;
      return next;
    });
    try {
      const { docType, candidates, education, experience, entityName, relationshipHint } =
        await host.extractFromText(d.id, d.text);
      const entity = entityName
        ? await resolveEntityFromName(entityName, relationshipHint)
        : { id: d.entityId };
      // Update the doc's classification and entity (in case extractor improved).
      await storage.saveDocument({ ...d, docType, entityId: entity.id });
      const withEntity: FieldCandidate[] = candidates.map((c) => ({ ...c, entityId: entity.id }));
      if (withEntity.length) await addCandidates(storage, withEntity);
      for (const e of education) await storage.saveEducation({ ...e, entityId: entity.id });
      for (const e of experience) await storage.saveExperience({ ...e, entityId: entity.id });
      updateJob(job.id, { state: "indexing", progress: 0.7, message: "Indexing" });
      try {
        const embeddings: EmbeddingRecord[] = [];
        for (const c of withEntity) {
          const label = fieldByKey(c.fieldKey).label;
          const t = `${label}: ${c.value}`;
          embeddings.push({
            id: crypto.randomUUID(), kind: "fact",
            entityId: c.entityId, documentId: d.id, fieldKey: c.fieldKey,
            text: t, vector: await host.embed(t),
          });
        }
        for (const chunk of chunkText(d.text)) {
          embeddings.push({
            id: crypto.randomUUID(), kind: "chunk",
            entityId: entity.id, documentId: d.id,
            text: chunk, vector: await host.embed(chunk),
          });
        }
        if (embeddings.length) await storage.saveEmbeddings(embeddings);
      } catch (e) { console.warn("[reextract] embed:", e); }
      updateJob(job.id, { state: "done", progress: 1, message: `Re-extracted ${candidates.length} fields` });
      await refreshDocuments();
      setTimeout(() => setJobs((js) => {
        const next = js.filter((j) => j.id !== job.id);
        jobsRef.current = next;
        return next;
      }), 2500);
    } catch (err) {
      updateJob(job.id, { state: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }


  return (
    <div className="space-y-3 p-3">
      <FirstSteps />
      {readOnly ? (
        <Card className="border-dashed p-4 text-center text-xs text-muted-foreground">
          You're viewing the <span className="font-medium">{source?.label}</span>. To add documents, switch to the local vault from the pill in the top-right.
        </Card>
      ) : (
        <Card
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
          className="cursor-pointer border-dashed p-6 text-center transition-colors hover:border-foreground/50"
        >
          <Upload className="mx-auto h-5 w-5 text-muted-foreground" />
          <div className="mt-2 text-sm">Drag PDFs or images here, or click to choose.</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Drop many at once — each gets its own progress bar. Scanned files use on-device OCR.
          </div>
          <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => handleFiles(e.target.files)} />
        </Card>
      )}

      {jobs.length > 0 && (
        <div className="space-y-1.5">
          <div className={tx.microcap}>Imports ({jobs.length})</div>
          {jobs.map((j) => <JobRow key={j.id} job={j} onDismiss={() => dismissJob(j.id)} />)}
        </div>
      )}

      {documents.length === 0 && jobs.length === 0 && (
        <Card className="p-6 text-center">
          <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
          <div className="mt-2 text-sm font-medium">No documents yet</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Import a passport, license, or utility bill to populate your profile.
          </div>
        </Card>
      )}

      <div className="space-y-1.5">
        {documents.map((d) => {
          const ent = entities.find((e) => e.id === d.entityId);
          return (
            <Card
              key={d.id}
              onClick={() => setViewing(d)}
              className="flex cursor-pointer items-center justify-between px-3 py-2 transition-colors hover:bg-accent/30"
            >
              <div className="flex min-w-0 items-center gap-2">
                {d.ocrUsed ? <ScanLine className="h-4 w-4 text-muted-foreground" /> : <FileText className="h-4 w-4 text-muted-foreground" />}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{d.name}</span>
                    {ent && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveEntityId(d.entityId); }}
                        title={`View ${ent.name}'s profile`}
                      >
                        <Badge variant={d.entityId === activeEntityId ? "outline" : "muted"}>{ent.name}</Badge>
                      </button>
                    )}
                    <Badge variant="outline">{d.docType}</Badge>
                    {d.ocrUsed && <Badge variant="muted">OCR</Badge>}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {d.pageCount} pg · {(d.bytes / 1024).toFixed(0)} KB · {new Date(d.importedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              {!readOnly && (
                <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" onClick={() => void reExtract(d)} title="Re-extract">
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setPendingDelete(d)} title="Remove">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <DocumentViewer doc={viewing} open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The document and every fact extracted from it will be removed from this device. Other documents are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && void confirmDelete(pendingDelete)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function JobRow({ job, onDismiss }: { job: ImportJob; onDismiss: () => void }) {
  const isError = job.state === "error";
  const isDone = job.state === "done";
  return (
    <Card className={cn("space-y-1.5 px-3 py-2", isError && "status-redflag")}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isDone ? <Check className="h-4 w-4 shrink-0" />
           : isError ? <AlertCircle className="h-4 w-4 shrink-0" />
           : <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-foreground/50" />}
          <span className="truncate text-sm font-medium">{job.fileName}</span>
          <Badge variant={isError ? "outline" : "muted"}>{STATE_LABELS[job.state]}</Badge>
        </div>
        {(isDone || isError) && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDismiss}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full bg-foreground transition-[width] duration-300", isError && "bg-foreground/50")}
          style={{ width: `${Math.round(job.progress * 100)}%` }}
        />
      </div>
      {(job.message || job.error) && (
        <div className={cn("truncate text-[10px]", isError ? "text-foreground" : "text-muted-foreground")}>
          {job.error ?? job.message}
        </div>
      )}
    </Card>
  );
}
