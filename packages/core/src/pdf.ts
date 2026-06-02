// Extract text from a PDF. Tries the text layer first; if the page has
// no extractable text (typical for scanned PDFs), renders the page to a
// canvas and falls back to OCR.

import * as pdfjs from "pdfjs-dist";
import { ocrCanvases, type OcrProgress } from "./ocr";

// Surfaces must call setPdfWorkerSrc with a bundler-resolved URL before
// using extractPdfText. This keeps the core package bundler-agnostic.
export function setPdfWorkerSrc(url: string): void {
  pdfjs.GlobalWorkerOptions.workerSrc = url;
}

export interface ExtractedPdf {
  text: string;
  pageCount: number;
  pageTexts: string[];
  ocrUsed: boolean;
}

export interface PdfExtractOptions {
  ocrThresholdChars?: number;                              // per-page text-length threshold to trigger OCR
  onProgress?: (status: string, fraction: number) => void; // 0..1
  onOcrProgress?: (p: OcrProgress) => void;
}

export async function extractPdfText(
  file: File | ArrayBuffer | Uint8Array,
  opts: PdfExtractOptions = {}
): Promise<ExtractedPdf> {
  const threshold = opts.ocrThresholdChars ?? 80;
  const data =
    file instanceof File ? await file.arrayBuffer()
    : file instanceof Uint8Array ? file
    : file;

  opts.onProgress?.("Reading PDF", 0.05);
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageTexts: string[] = [];
  const ocrPages: { index: number; canvas: HTMLCanvasElement }[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    opts.onProgress?.(`Extracting page ${i}/${doc.numPages}`, 0.05 + (0.5 * (i / doc.numPages)));
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pageTexts.push(text);

    if (text.length < threshold) {
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      ocrPages.push({ index: i - 1, canvas });
    }
  }

  let ocrUsed = false;
  if (ocrPages.length > 0) {
    opts.onProgress?.(`Running OCR on ${ocrPages.length} page${ocrPages.length === 1 ? "" : "s"}`, 0.6);
    const ocrTexts = await ocrCanvases(
      ocrPages.map((p) => p.canvas),
      { onProgress: opts.onOcrProgress }
    );
    for (let i = 0; i < ocrPages.length; i++) {
      pageTexts[ocrPages[i].index] = ocrTexts[i];
    }
    ocrUsed = true;
  }

  opts.onProgress?.("Done", 1);
  return {
    text: pageTexts.join("\n\n"),
    pageCount: doc.numPages,
    pageTexts,
    ocrUsed,
  };
}

// For image files (JPG/PNG): load → draw to canvas → OCR.
export async function extractImageText(
  file: File,
  opts: { onOcrProgress?: (p: OcrProgress) => void } = {}
): Promise<{ text: string; ocrUsed: true }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const [text] = await ocrCanvases([canvas], { onProgress: opts.onOcrProgress });
  return { text, ocrUsed: true };
}
