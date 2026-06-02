// Open a stored document. Two source modes:
//   - fileDataUrl: base64 embedded in the doc record (permanent, costs
//     ~1.33x storage). Used by the extension and as a "make permanent"
//     option on desktop.
//   - filePath:    absolute path on disk (desktop only, zero storage
//     cost). The viewer reads the bytes on demand via IPC.
// Falls back to a friendly attach-prompt for legacy imports that have
// neither.

import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, Pin, ScanLine } from "lucide-react";
import type { StoredDocument } from "@octovault/core";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { useAppContext } from "../context";
import { tx } from "../lib/brand";
import { cn } from "../lib/utils";

// Detect Electron — only there can we read arbitrary file paths.
// The desktop host declares the full window.octovault shape; we just
// pull the doc bridge off it here without redeclaring (which would
// collide with the host's type).
interface DocBridge {
  readBytes(id: string): Promise<{ bytes: Uint8Array; mimeType?: string } | null>;
}
function desktopDoc(): DocBridge | undefined {
  return (window as unknown as { octovault?: { doc?: DocBridge } }).octovault?.doc;
}

export function DocumentViewer({
  doc, open, onOpenChange,
}: {
  doc: StoredDocument | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { storage, refreshDocuments, readOnly } = useAppContext();
  const fileInput = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingFromDisk, setLoadingFromDisk] = useState(false);
  const [diskError, setDiskError] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);

  const isPdf = !!doc && (doc.mimeType === "application/pdf" || doc.name.toLowerCase().endsWith(".pdf"));
  const isImage = !!doc && (doc.mimeType?.startsWith("image/") ?? /\.(jpe?g|png|webp|gif|heic)$/i.test(doc.name));

  // Resolve the preview source whenever the doc changes:
  //   1. fileDataUrl wins (already permanent in the vault)
  //   2. Otherwise, if filePath, ask main to read it on demand
  //   3. Otherwise show the attach-prompt
  useEffect(() => {
    setPreviewUrl(null);
    setDiskError(null);
    if (!doc || !open) return;

    if (doc.fileDataUrl) {
      setPreviewUrl(doc.fileDataUrl);
      return;
    }
    if (doc.filePath && desktopDoc()) {
      let cancelled = false;
      let blobUrl: string | null = null;
      setLoadingFromDisk(true);
      void (async () => {
        try {
          const res = await desktopDoc()!.readBytes(doc.id);
          if (cancelled) return;
          if (!res) {
            setDiskError("Original file is missing at " + doc.filePath);
            return;
          }
          const blob = new Blob([res.bytes as BlobPart], { type: res.mimeType ?? doc.mimeType ?? "application/octet-stream" });
          blobUrl = URL.createObjectURL(blob);
          setPreviewUrl(blobUrl);
        } catch (e) {
          setDiskError(e instanceof Error ? e.message : String(e));
        } finally {
          if (!cancelled) setLoadingFromDisk(false);
        }
      })();
      return () => {
        cancelled = true;
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      };
    }
  }, [doc, open]);

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

  // Read from filePath, embed permanently into fileDataUrl. After this
  // the doc survives even if the original file is moved or deleted.
  async function makePermanent() {
    if (!doc || !doc.filePath || !desktopDoc()) return;
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
      <DialogContent className="h-[90vh] max-w-[1100px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {doc.ocrUsed ? <ScanLine className="h-4 w-4 shrink-0" />
             : isImage ? <ImageIcon className="h-4 w-4 shrink-0" />
             : <FileText className="h-4 w-4 shrink-0" />}
            <DialogTitle className="truncate text-base">{doc.name}</DialogTitle>
            {hasPermanent && (
              <Badge variant="outline" className="ml-1 gap-1">
                <Pin className="h-2.5 w-2.5" /> embedded
              </Badge>
            )}
            {!hasPermanent && hasPath && (
              <Badge variant="muted" className="ml-1">linked from disk</Badge>
            )}
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
          {/* Original file preview (left) */}
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
                <div className="flex h-full items-center justify-center p-6 text-center">
                  <div className="max-w-xs text-sm text-muted-foreground">
                    Preview not supported for this file type. Extracted text is on the right.
                  </div>
                </div>
              )
            ) : (
              // No preview available — show why + offer to attach.
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <div className="max-w-xs text-sm text-muted-foreground">
                  {diskError ?? "Original file isn't available — it was imported before file referencing was added, or the file has moved."}
                </div>
                {!readOnly && (
                  <>
                    <Button onClick={() => fileInput.current?.click()} size="sm">
                      <Paperclip className="h-3.5 w-3.5" /> Attach original file
                    </Button>
                    <input
                      ref={fileInput} type="file" hidden
                      accept=".pdf,image/png,image/jpeg,image/webp"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachOriginal(f); }}
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Pick the file from disk. Bytes get embedded in the vault — extraction isn't re-run.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Make-permanent action — when we have a disk path but no
                embedded copy yet. */}
            {!hasPermanent && hasPath && previewUrl && !readOnly && (
              <div className="absolute bottom-2 right-2">
                <Button size="sm" variant="outline" disabled={pinning} onClick={() => void makePermanent()}>
                  {pinning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
                  Embed in vault
                </Button>
              </div>
            )}
          </div>

          {/* Extracted text (right) */}
          <div className="flex min-h-0 flex-col">
            <div className={cn("border-b px-3 py-2", tx.microcap)}>Extracted text</div>
            <ScrollArea className="flex-1">
              {doc.text.trim().length > 0 ? (
                <pre className="whitespace-pre-wrap px-3 py-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {doc.text}
                </pre>
              ) : (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No text was extracted. This may be a scanned file where OCR returned nothing useful.
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
