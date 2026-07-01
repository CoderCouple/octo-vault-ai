// Documents view. Drag-and-drop import with a proper job queue:
// every dropped file becomes an ImportJob that progresses through
// queued → reading → ocr → extracting → indexing → done (or error).
// Jobs render in a panel above the document list with per-file
// progress bars. Done jobs auto-dismiss; errors stay until cleared.

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Check, FileText, RotateCw, ScanLine, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import {
  addCandidates, chunkText, fieldByKey,
  extractImageText,
  extractPdfText,
  type EmbeddingRecord, type Entity, type FieldCandidate, type StoredDocument,
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

const EMBED_CONCURRENCY = 4;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

interface EmbeddingTask {
  text: string;
  kind: EmbeddingRecord["kind"];
  entityId: string;
  documentId: string;
  fieldKey?: FieldCandidate["fieldKey"];
  page?: number;
}

async function embedTasks(
  tasks: EmbeddingTask[],
  embed: (text: string) => Promise<number[]>,
  onProgress?: (done: number, total: number) => void,
): Promise<EmbeddingRecord[]> {
  let done = 0;
  return mapLimit(tasks, EMBED_CONCURRENCY, async (task) => {
    const vector = await embed(task.text);
    done++;
    onProgress?.(done, tasks.length);
    return {
      id: crypto.randomUUID(),
      kind: task.kind,
      entityId: task.entityId,
      documentId: task.documentId,
      fieldKey: task.fieldKey,
      page: task.page,
      text: task.text,
      vector,
    };
  });
}

// FILE_ENTITY_STOP_WORDS and titleCaseName were the fallback name-
// synthesis used to invent entity names from filename tokens when no
// known entity matched. That path is gone (see inferEntityNameFromFileName
// below) — synthesising entities from filenames produced garbage names
// like "Tcsservicecertificate" and split the user's real docs across
// dozens of synthetic entities.

function inferEntityNameFromFileName(fileName: string, knownEntities: Entity[]): string | null {
  // Only match against entities that ALREADY EXIST in the vault (including
  // SELF). The previous version skipped SELF and, when no non-self match
  // was found, aggressively synthesised bogus entity names from dash/
  // underscore-separated filename tokens — producing entities like
  // "Tcsservicecertificate" (from TCS_Service_Certificate.pdf), "Vesit
  // Transcript", "Hb Filing", etc. Every unmatched doc ended up on its
  // own synthetic entity, so Profile + Facts + Graph appeared empty for
  // the actual user even though the docs were saved.
  //
  // Fix: match against every known entity (SELF included). If none matches,
  // return null and let the caller fall back to activeEntityId (typically
  // SELF). Filename parsing NEVER creates new entities — only the LLM
  // extractor, or an explicit user action, does that.
  const base = fileName.replace(/\.[^.]+$/, "");
  const lower = base.toLowerCase();
  for (const entity of knownEntities) {
    const tokens = entity.name.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length && tokens.every((t) => lower.includes(t))) return entity.name;
  }
  return null;
}

export function Documents() {
  const {
    host, storage, documents, refreshDocuments, readOnly, source,
    activeEntityId, resolveEntityFromName, entities, setActiveEntityId, settings,
  } = useAppContext();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [pendingDelete, setPendingDelete] = useState<StoredDocument | null>(null);
  const [docCascade, setDocCascade] = useState<{ fieldRefs: number; education: number; experience: number; relationships: number } | null>(null);
  const [viewing, setViewing] = useState<StoredDocument | null>(null);

  useEffect(() => {
    if (!pendingDelete) { setDocCascade(null); return; }
    const docId = pendingDelete.id;
    let cancelled = false;
    void (async () => {
      const [profile, edu, exp, rels] = await Promise.all([
        storage.getAllProfiles(),
        storage.listEducation(pendingDelete.entityId),
        storage.listExperience(pendingDelete.entityId),
        storage.listRelationships(),
      ]);
      if (cancelled) return;
      let fieldRefs = 0;
      for (const e of Object.values(profile)) {
        for (const r of Object.values(e)) {
          if (r.candidates.some((c) => c.source.documentId === docId)) fieldRefs++;
        }
      }
      setDocCascade({
        fieldRefs,
        education: edu.filter((r) => r.source?.documentId === docId).length,
        experience: exp.filter((r) => r.source?.documentId === docId).length,
        relationships: rels.filter((r) => r.source?.documentId === docId).length,
      });
    })();
    return () => { cancelled = true; };
  }, [pendingDelete, storage]);
  const inputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  // Mirror jobs into a ref for synchronous reads inside the queue loop.
  const jobsRef = useRef<ImportJob[]>([]);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  // Sync the ref BEFORE the state. The processNext loop reads
  // jobsRef between awaits and React only flushes setJobs updaters
  // at its own pace; if the ref lags, a "done" job can re-appear as
  // "queued" and get processed again — creating a duplicate row.
  function mutateJobs(fn: (js: ImportJob[]) => ImportJob[]) {
    jobsRef.current = fn(jobsRef.current);
    setJobs(jobsRef.current);
  }
  function updateJob(id: string, patch: Partial<ImportJob>) {
    mutateJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }
  function removeJob(id: string) {
    mutateJobs((js) => js.filter((j) => j.id !== id));
  }
  function addJob(job: ImportJob) {
    mutateJobs((js) => [...js, job]);
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

  async function runJob(
    job: ImportJob,
    opts: { existingDocId?: string; forceVisionEngine?: import("@octovault/core").VisionEngine } = {}
  ) {
    const id = job.id;
    try {
      const docId = opts.existingDocId ?? crypto.randomUUID();
      const lower = job.fileName.toLowerCase();
      let text = "";
      let pageCount = 1;
      let ocrUsed = false;

      // When the caller forced a vision engine (per-doc Re-OCR action
      // bypassing the global setting), use it. Otherwise consult the
      // global Settings → visionModel via host.visionEngine() which
      // returns null when the default "" is set — so pdf.ts takes
      // the fast Tesseract path.
      const visionEngine = opts.forceVisionEngine ?? (await host.visionEngine?.()) ?? undefined;

      if (lower.endsWith(".pdf")) {
        updateJob(id, { state: "reading", progress: 0.05, message: "Reading PDF" });
        const useLiteParse = settings.pdfParser === "liteparse" && !!host.parsePdfText;
        const parseOpts = {
          visionEngine,
          onProgress: (s: string, f: number) => updateJob(id, {
            state: s.toLowerCase().includes("ocr") ? "ocr" : "reading",
            progress: 0.05 + f * 0.4, message: s,
          }),
          onOcrProgress: (p: { page: number; totalPages: number }) => updateJob(id, {
            state: "ocr",
            progress: 0.05 + 0.4 * (p.page / p.totalPages),
            message: `OCR page ${p.page}/${p.totalPages}`,
          }),
        };
        let out;
        if (useLiteParse) {
          try {
            updateJob(id, { state: "reading", progress: 0.08, message: "Parsing with LiteParse" });
            out = await host.parsePdfText!(job.file, parseOpts);
          } catch (e) {
            console.warn("[ingest] LiteParse failed; falling back to PDF.js:", e);
            updateJob(id, { state: "reading", progress: 0.08, message: "LiteParse failed — falling back" });
          }
        }
        out ??= await extractPdfText(job.file, parseOpts);
        text = out.text; pageCount = out.pageCount; ocrUsed = out.ocrUsed;
      } else if (job.file.type.startsWith("image/")) {
        updateJob(id, { state: "ocr", progress: 0.1, message: "OCR image" });
        const out = await extractImageText(job.file, {
          visionEngine,
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
      const { docType, candidates, extras, inferredRelationships, inferredEvents, education, experience, entityName, relationshipHint, sanitization, review } =
        await host.extractFromText(docId, text);
      const cleanups: string[] = [];
      if (sanitization?.dropped) cleanups.push(`${sanitization.dropped} dropped`);
      if (sanitization?.downgraded) cleanups.push(`${sanitization.downgraded} flagged`);
      if (review?.rejected) cleanups.push(`${review.rejected} rejected by review`);
      if (review?.corrected) cleanups.push(`${review.corrected} corrected by review`);
      if (review?.entityNameChanged) cleanups.push(`re-tagged to ${entityName}`);
      if (cleanups.length) updateJob(id, { message: `Sanitization: ${cleanups.join(", ")}` });

      const fileEntityName = inferEntityNameFromFileName(job.fileName, entities);
      const entity = fileEntityName
        ? await resolveEntityFromName(fileEntityName, relationshipHint)
        : entityName
          ? await resolveEntityFromName(entityName, relationshipHint)
          : { id: activeEntityId };

      // Prefer a path reference over a copied data URL — zero storage
      // cost and the viewer reads from disk on demand. Electron 32+
      // removed File.path; the preload exposes webUtils.getPathForFile
      // as octovault.doc.pathFor. In a regular browser neither is
      // available and we fall back to a base64 data URL.
      const desktopDocApi = (window as unknown as { octovault?: { doc?: { pathFor?: (f: File) => string } } }).octovault?.doc;
      let filePath: string | undefined;
      try {
        const legacy = (job.file as File & { path?: string }).path;
        const resolved = desktopDocApi?.pathFor?.(job.file);
        filePath = legacy || (resolved && resolved.length > 0 ? resolved : undefined);
      } catch {
        filePath = undefined;
      }
      let fileDataUrl: string | undefined;
      if (!filePath) {
        try { fileDataUrl = await fileToDataUrl(job.file); }
        catch (e) { console.warn(`[ingest] could not encode original ${job.fileName}:`, e); }
      }

      const mimeType = job.file.type
        || (lower.endsWith(".pdf") ? "application/pdf" : undefined);

      const doc: StoredDocument = {
        id: docId, entityId: entity.id, name: job.fileName, importedAt: Date.now(),
        bytes: job.size, text, pageCount, docType, ocrUsed,
        mimeType, filePath, fileDataUrl,
      };
      // Final write-time guard: refuse to save when a doc with the
      // same (entityId, name, bytes) already exists. This is the last
      // line of defense against any concurrent / racing import. Note
      // entityId is only known here — the upstream dedup uses
      // (name, bytes), which can let through a re-tag, so we re-check.
      // Skipped when re-OCRing in place (existingDocId set), because
      // the "duplicate" IS the document we're explicitly replacing.
      if (!opts.existingDocId) {
        const existing = await storage.listDocuments();
        const dupe = existing.find((d) =>
          d.entityId === entity.id && d.name === job.fileName && d.bytes === job.size,
        );
        if (dupe) {
          updateJob(id, { state: "done", progress: 1, message: "Duplicate — skipped" });
          setTimeout(() => removeJob(id), 2500);
          return;
        }
      }
      await storage.saveDocument(doc);
      const withEntity: FieldCandidate[] = candidates.map((c) => ({ ...c, entityId: entity.id }));
      if (withEntity.length) await addCandidates(storage, withEntity);
      for (const e of education) await storage.saveEducation({ ...e, entityId: entity.id });
      for (const e of experience) await storage.saveExperience({ ...e, entityId: entity.id });

      // Auto-emit relationships from civil-status docs (Phase 4a).
      // Marriage cert / divorce decree → spouse edge; birth cert /
      // adoption record → parent edge. The extractor returned name
      // strings; we resolve each to an entity (creating if needed)
      // and save a RelationshipEdge whose source is the doc.
      for (const ir of inferredRelationships) {
        try {
          const otherEntity = await resolveEntityFromName(
            ir.otherName,
            ir.kind === "spouse" ? "spouse" : "parent",
          );
          if (otherEntity.id === entity.id) continue; // self-edge guard
          const now = Date.now();
          await storage.saveRelationship({
            id: crypto.randomUUID(),
            fromEntityId: entity.id,
            toEntityId: otherEntity.id,
            kind: ir.kind,
            derivedFrom: `extract:${docType}`,
            source: { documentId: doc.id, excerpt: ir.excerpt },
            bidirectional: ir.kind === "spouse",
            createdAt: now,
            updatedAt: now,
          });
        } catch (e) {
          console.warn(`[ingest] failed to auto-emit ${ir.kind} relationship for "${ir.otherName}":`, e);
        }
      }

      // Phase 4b — first-class Event rows. Resolve each participant
      // name to an entity (creating if needed) and save one Event per
      // inference. Closure rules in derive.ts read these to expand the
      // graph (e.g., shared marriage → in-laws).
      for (const ie of inferredEvents) {
        try {
          const resolved = [];
          for (const p of ie.participants) {
            const ent = p.role === "subject"
              ? entity
              : await resolveEntityFromName(p.name, p.role === "spouse" ? "spouse" : p.role === "parent" ? "parent" : undefined);
            resolved.push({ entityId: ent.id, role: p.role });
          }
          // Skip if we don't have at least one resolved participant.
          if (!resolved.length) continue;
          const now = Date.now();
          await storage.saveEvent({
            id: crypto.randomUUID(),
            type: ie.type,
            participants: resolved,
            date: ie.date,
            endDate: ie.endDate,
            place: ie.place,
            attributes: ie.attributes ?? {},
            source: { documentId: doc.id, excerpt: ie.excerpt },
            createdAt: now,
            updatedAt: now,
          });
        } catch (e) {
          console.warn(`[ingest] failed to emit ${ie.type} event:`, e);
        }
      }

      // Best-effort embedding for chat.
      updateJob(id, { state: "indexing", progress: 0.7, message: "Indexing for chat" });
      try {
        const tasks: EmbeddingTask[] = [];
        for (const c of withEntity) {
          const label = fieldByKey(c.fieldKey).label;
          const t = `${label}: ${c.value}`;
          tasks.push({
            kind: "fact",
            entityId: c.entityId,
            documentId: doc.id,
            fieldKey: c.fieldKey,
            page: c.source.page,
            text: t,
          });
        }
        // Embed long-tail "extras" the same way as typed facts so they
        // surface in chat / Spotlight retrieval. fieldKey is omitted
        // (they're not in the PROFILE_FIELDS list); the LLM-given
        // label drives both the embedding and the citation display.
        for (const ex of extras) {
          const t = `${ex.label}: ${ex.value}`;
          tasks.push({
            kind: "fact",
            entityId: entity.id,
            documentId: doc.id,
            page: ex.source.page,
            text: t,
          });
        }
        const chunks = chunkText(doc.text);
        for (const chunk of chunks) {
          tasks.push({
            kind: "chunk",
            entityId: entity.id,
            documentId: doc.id,
            text: chunk,
          });
        }
        for (const e of education) {
          const t = [e.degree, e.field, "at", e.institution, e.startDate, "to", e.endDate].filter(Boolean).join(" ");
          if (!t) continue;
          tasks.push({
            kind: "chunk",
            entityId: entity.id,
            documentId: doc.id,
            text: `Education: ${t}`,
          });
        }
        for (const e of experience) {
          const t = [e.role, "at", e.company, e.startDate, "to", e.endDate || "present", e.location].filter(Boolean).join(" ");
          if (!t) continue;
          tasks.push({
            kind: "chunk",
            entityId: entity.id,
            documentId: doc.id,
            text: `Experience: ${t}`,
          });
        }
        const embeddings = await embedTasks(tasks, host.embed, (done, total) => {
          updateJob(id, {
            progress: 0.7 + 0.25 * (done / Math.max(total, 1)),
            message: `Indexing ${done}/${total}`,
          });
        });
        if (embeddings.length) await storage.saveEmbeddings(embeddings);
      } catch (e) {
        console.warn("[indexing] embeddings failed:", e);
      }

      updateJob(id, { state: "done", progress: 1, message: "Done" });
      await refreshDocuments();
      setTimeout(() => removeJob(id), 2500);
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
    // Two layers of dedup at enqueue time:
    //   1. Within this batch: a single drop / picker session that
    //      lists the same file twice only enqueues it once.
    //   2. In-flight: skip files already queued or processing — that
    //      catches double-fired events.
    // Files that match an already-saved document are NOT filtered
    // here — they go through runJob, and the write-time guard there
    // shows them as "Duplicate — skipped" so the user can see what
    // happened. Silent filtering at this layer was hiding real
    // imports the user expected to see.
    const inflight = new Set(
      jobsRef.current
        .filter((j) => j.state !== "error")
        .map((j) => `${j.fileName}|${j.size}`),
    );
    const newJobs: ImportJob[] = Array.from(files)
      .filter((file) => {
        const key = `${file.name}|${file.size}`;
        if (inflight.has(key)) return false;
        inflight.add(key);
        return true;
      })
      .map((file) => ({
        id: crypto.randomUUID(),
        file,
        fileName: file.name,
        size: file.size,
        state: "queued",
        progress: 0,
      }));
    if (newJobs.length === 0) return;
    mutateJobs((js) => [...js, ...newJobs]);
    void processNext();
  }

  // Walk the doc list and collapse rows that share (entityId, name,
  // bytes), keeping the most-recently-imported. Used to clean up after
  // the duplicate-import bug.
  async function removeDuplicates() {
    if (readOnly) return;
    const byKey = new Map<string, StoredDocument[]>();
    for (const d of documents) {
      const key = `${d.entityId}|${d.name}|${d.bytes}`;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(d);
    }
    let removed = 0;
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const keep = group.slice().sort((a, b) => b.importedAt - a.importedAt)[0];
      for (const d of group) {
        if (d.id === keep.id) continue;
        await storage.deleteDocument(d.id);
        await storage.deleteCandidatesFromDoc(d.id);
        await storage.deleteEmbeddingsForDoc(d.id);
        await storage.deleteRecordsFromDoc(d.id);
        removed++;
      }
    }
    if (removed > 0) await refreshDocuments();
  }

  function dismissJob(id: string) {
    removeJob(id);
  }

  async function confirmDelete(d: StoredDocument) {
    setPendingDelete(null);
    try {
      await storage.deleteDocument(d.id);
      await storage.deleteCandidatesFromDoc(d.id);
      await storage.deleteEmbeddingsForDoc(d.id);
      await storage.deleteRecordsFromDoc(d.id);
    } catch (e) {
      console.error("[doc] delete failed:", e);
    }
    await refreshDocuments();
  }

  // Re-extract: enqueue this doc as a synthetic job that skips the
  // PDF/OCR pass (text is already stored) and re-runs extraction
  // + indexing with the current code path.
  // Per-document escape hatch for when Tesseract garbled a scan and
  // the user wants to re-try with the slow-but-better vision model.
  // Skips the global Settings → visionModel flip + manual re-upload —
  // reads the original file bytes from disk (Electron) or the stored
  // data URL, picks an installed vision-capable model (preferring
  // qwen3-vl, then qwen2.5-vl, then llava / minicpm), and re-runs
  // the full pipeline (PDF parse → vision OCR → extraction) with the
  // chosen engine.
  async function reOcrWithVision(d: StoredDocument) {
    if (readOnly) return;

    // 1. Pick a vision model that's actually installed.
    if (!host.listOllamaModels || !host.visionEngineForModel) {
      alert("Vision re-OCR is only available in the desktop app.");
      return;
    }
    const installed = await host.listOllamaModels();
    const visionCandidates = installed.filter((m) => /\b(vl|vision|llava|minicpm)\b/i.test(m));
    if (visionCandidates.length === 0) {
      alert("No vision-capable model is installed. Open Settings → Models and pull qwen3-vl:8b (or similar), then try again.");
      return;
    }
    const chosenModel =
      visionCandidates.find((m) => m.startsWith("qwen3-vl")) ??
      visionCandidates.find((m) => m.includes("qwen")) ??
      visionCandidates[0];

    // 2. Recover the original file bytes. Prefer disk (filePath) via
    //    the desktop preload; fall back to the stored data URL.
    let file: File | null = null;
    if (host.readDocumentBytes) {
      try {
        const recovered = await host.readDocumentBytes(d.id);
        if (recovered) {
          // Blob wrapping sidesteps Uint8Array's ArrayBufferLike vs
          // strict ArrayBuffer typing mismatch (the IPC unmarshaler
          // can return a Uint8Array backed by SharedArrayBuffer).
          const mime = recovered.mimeType ?? d.mimeType ?? "application/octet-stream";
          const blob = new Blob([recovered.bytes as unknown as BlobPart], { type: mime });
          file = new File([blob], d.name, { type: mime });
        }
      } catch (e) {
        console.warn("[re-ocr] readDocumentBytes failed:", e);
      }
    }
    if (!file && d.fileDataUrl) {
      try {
        const res = await fetch(d.fileDataUrl);
        const blob = await res.blob();
        file = new File([blob], d.name, { type: d.mimeType ?? blob.type });
      } catch (e) {
        console.warn("[re-ocr] fileDataUrl recovery failed:", e);
      }
    }
    if (!file) {
      alert(`Couldn't find the original file for "${d.name}". Remove it and re-upload with vision OCR enabled in Settings → Models.`);
      return;
    }

    // 3. Build a vision engine for the chosen model (bypasses the
    //    global setting being empty).
    const visionEngine = await host.visionEngineForModel(chosenModel);
    if (!visionEngine) {
      alert(`Vision model "${chosenModel}" is not reachable. Make sure Ollama is running.`);
      return;
    }

    // 4. Clear existing extracted data, then re-run the full pipeline
    //    against the same docId so the row updates in place.
    await storage.deleteCandidatesFromDoc(d.id);
    await storage.deleteEmbeddingsForDoc(d.id);
    await storage.deleteRecordsFromDoc(d.id);
    const job: ImportJob = {
      id: crypto.randomUUID(),
      file,
      fileName: d.name,
      size: d.bytes,
      state: "reading",
      progress: 0,
      message: `Re-OCRing with ${chosenModel}…`,
    };
    addJob(job);
    await runJob(job, { existingDocId: d.id, forceVisionEngine: visionEngine });
  }

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
    addJob(job);
    try {
      const { docType, candidates, education, experience, entityName, relationshipHint } =
        await host.extractFromText(d.id, d.text);
      const fileEntityName = inferEntityNameFromFileName(d.name, entities);
      const entity = fileEntityName
        ? await resolveEntityFromName(fileEntityName, relationshipHint)
        : entityName
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
        const tasks: EmbeddingTask[] = [];
        for (const c of withEntity) {
          const label = fieldByKey(c.fieldKey).label;
          const t = `${label}: ${c.value}`;
          tasks.push({
            kind: "fact",
            entityId: c.entityId,
            documentId: d.id,
            fieldKey: c.fieldKey,
            text: t,
          });
        }
        for (const chunk of chunkText(d.text)) {
          tasks.push({
            kind: "chunk",
            entityId: entity.id,
            documentId: d.id,
            text: chunk,
          });
        }
        const embeddings = await embedTasks(tasks, host.embed, (done, total) => {
          updateJob(job.id, {
            progress: 0.7 + 0.25 * (done / Math.max(total, 1)),
            message: `Indexing ${done}/${total}`,
          });
        });
        if (embeddings.length) await storage.saveEmbeddings(embeddings);
      } catch (e) { console.warn("[reextract] embed:", e); }
      updateJob(job.id, { state: "done", progress: 1, message: `Re-extracted ${candidates.length} fields` });
      await refreshDocuments();
      setTimeout(() => removeJob(job.id), 2500);
    } catch (err) {
      updateJob(job.id, { state: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }


  const duplicateCount = (() => {
    const seen = new Map<string, number>();
    for (const d of documents) {
      const key = `${d.entityId}|${d.name}|${d.bytes}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    let dup = 0;
    for (const n of seen.values()) if (n > 1) dup += n - 1;
    return dup;
  })();

  return (
    <div className="space-y-3 p-3">
      <FirstSteps />
      {duplicateCount > 0 && !readOnly && (
        <Card className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Found {duplicateCount} duplicate document{duplicateCount === 1 ? "" : "s"} (same name + size, same entity).
          </span>
          <Button size="sm" variant="outline" onClick={() => void removeDuplicates()}>
            Remove duplicates
          </Button>
        </Card>
      )}
      {readOnly ? (
        <Card className="border-dashed p-4 text-center text-xs text-muted-foreground">
          You're viewing the <span className="font-medium">{source?.label}</span>. To add documents, switch to the local vault from the pill in the top-right.
        </Card>
      ) : (
        <>
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
          </Card>
          {/* Input lives OUTSIDE the Card. Otherwise programmatic
              inputRef.click() bubbles back to the Card and re-triggers
              the picker, producing duplicate imports. */}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
        </>
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
                  <Button variant="ghost" size="icon" onClick={() => void reExtract(d)} title="Re-extract (uses stored text)">
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void reOcrWithVision(d)}
                    title="Re-OCR with vision model (slower, better on scanned docs)"
                  >
                    <Sparkles className="h-4 w-4" />
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
              Removes the document and every fact extracted from it. Other documents are untouched.
            </AlertDialogDescription>
            {docCascade ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
                <li>{docCascade.fieldRefs} field record{docCascade.fieldRefs === 1 ? "" : "s"} sourced by this doc</li>
                <li>{docCascade.education} education record{docCascade.education === 1 ? "" : "s"}</li>
                <li>{docCascade.experience} experience record{docCascade.experience === 1 ? "" : "s"}</li>
                <li>{docCascade.relationships} relationship edge{docCascade.relationships === 1 ? "" : "s"}</li>
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Computing impact…</p>
            )}
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
