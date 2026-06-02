// Open a stored document. PDF and image originals render directly
// from the saved base64 data URL; the right pane shows the extracted
// text and metadata so the user can see what OctoVault parsed.

import { FileText, Image as ImageIcon, ScanLine } from "lucide-react";
import type { StoredDocument } from "@octovault/core";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import { Badge } from "../components/ui/badge";
import { ScrollArea } from "../components/ui/scroll-area";
import { tx } from "../lib/brand";
import { cn } from "../lib/utils";

export function DocumentViewer({
  doc, open, onOpenChange,
}: {
  doc: StoredDocument | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  if (!doc) return null;
  const isPdf = doc.mimeType === "application/pdf" || doc.name.toLowerCase().endsWith(".pdf");
  const isImage = doc.mimeType?.startsWith("image/") ?? /\.(jpe?g|png|webp|gif|heic)$/i.test(doc.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[90vh] max-w-[1100px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {doc.ocrUsed ? <ScanLine className="h-4 w-4 shrink-0" />
             : isImage ? <ImageIcon className="h-4 w-4 shrink-0" />
             : <FileText className="h-4 w-4 shrink-0" />}
            <DialogTitle className="truncate text-base">{doc.name}</DialogTitle>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wide">
            <Badge variant="outline">{doc.docType}</Badge>
            {doc.ocrUsed && <Badge variant="muted">OCR</Badge>}
            <span className="text-muted-foreground">
              {doc.pageCount} pg · {(doc.bytes / 1024).toFixed(0)} KB · {new Date(doc.importedAt).toLocaleDateString()}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[3fr_2fr]">
          {/* Original file preview (left) */}
          <div className="relative min-h-0 overflow-hidden border-r bg-muted/30">
            {doc.fileDataUrl ? (
              isPdf ? (
                <iframe
                  src={doc.fileDataUrl}
                  title={doc.name}
                  className="h-full w-full"
                />
              ) : isImage ? (
                <div className="flex h-full items-center justify-center overflow-auto p-4">
                  <img
                    src={doc.fileDataUrl}
                    alt={doc.name}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              ) : (
                <NoPreview message="Preview not supported for this file type. Extracted text is on the right." />
              )
            ) : (
              <NoPreview message="Original file isn't stored for this document — it was imported before file-preserving was added. Re-import to see the original." />
            )}
          </div>

          {/* Extracted text + metadata (right) */}
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

function NoPreview({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <div className="max-w-xs text-sm text-muted-foreground">{message}</div>
    </div>
  );
}
