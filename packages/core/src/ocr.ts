// On-device OCR via Tesseract.js (WASM). Works in browser, extension,
// and Electron renderer. Slower than native engines but free and cross-
// platform.

import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

// Surfaces must set these before first OCR call. Avoids tesseract.js's
// default CDN fetches which Electron's CSP and the extension sandbox block.
interface OcrPaths {
  workerPath?: string;     // URL to tesseract.js/dist/worker.min.js
  corePath?: string;       // URL to tesseract-core-simd.wasm.js (or directory)
  langPath?: string;       // URL to directory containing eng.traineddata.gz
}
let paths: OcrPaths = {};

export function configureOcr(opts: OcrPaths): void {
  paths = { ...paths, ...opts };
  // Drop any cached worker so the new paths take effect next call.
  workerPromise = null;
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      workerPath: paths.workerPath,
      corePath: paths.corePath,
      langPath: paths.langPath,
    });
  }
  return workerPromise;
}

export interface OcrProgress {
  page: number;
  totalPages: number;
  status: string;          // "loading" | "recognizing" | "done"
  fraction: number;        // 0..1 across whole job
}

export interface OcrOptions {
  onProgress?: (p: OcrProgress) => void;
}

export async function ocrImage(
  source: HTMLCanvasElement | HTMLImageElement | Blob,
  opts: OcrOptions = {}
): Promise<string> {
  opts.onProgress?.({ page: 1, totalPages: 1, status: "loading", fraction: 0 });
  const worker = await getWorker();
  opts.onProgress?.({ page: 1, totalPages: 1, status: "recognizing", fraction: 0.2 });
  const { data } = await worker.recognize(source);
  opts.onProgress?.({ page: 1, totalPages: 1, status: "done", fraction: 1 });
  return data.text.trim();
}

export async function ocrCanvases(
  canvases: HTMLCanvasElement[],
  opts: OcrOptions = {}
): Promise<string[]> {
  const worker = await getWorker();
  const out: string[] = [];
  for (let i = 0; i < canvases.length; i++) {
    opts.onProgress?.({
      page: i + 1,
      totalPages: canvases.length,
      status: "recognizing",
      fraction: i / canvases.length,
    });
    const { data } = await worker.recognize(canvases[i]);
    out.push(data.text.trim());
  }
  opts.onProgress?.({
    page: canvases.length,
    totalPages: canvases.length,
    status: "done",
    fraction: 1,
  });
  return out;
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise;
  await w.terminate();
  workerPromise = null;
}

// --- Vision-model OCR ----------------------------------------------------
//
// Qwen2.5-VL / MiniCPM-V / LLaVA via Ollama produce far better OCR than
// tesseract on decorative scanned certificates and non-English layouts.
// This module stays bundler-agnostic — callers inject a `visionEngine`
// that knows how to reach the model (IPC in Electron, direct fetch
// elsewhere).

export interface VisionEngine {
  /** Returns the model's text output for the given image (base64, no prefix). */
  recognize: (imageBase64: string) => Promise<string>;
}

const VISION_OCR_PROMPT = `Transcribe every visible piece of text from this document image.
Output rules:
- Preserve the reading order (top-to-bottom, left-to-right).
- Preserve line breaks between distinct lines.
- Do NOT add markdown, headings, code fences, commentary, or explanations.
- Do NOT translate; keep the original script (Latin, Devanagari, etc.).
- If a region is unreadable, output [unreadable] in its place.
Begin transcription:`;

async function canvasToBase64(canvas: HTMLCanvasElement): Promise<string> {
  // toDataURL returns "data:image/png;base64,...." — strip the prefix.
  const url = canvas.toDataURL("image/png");
  const comma = url.indexOf(",");
  return comma >= 0 ? url.slice(comma + 1) : url;
}

export async function ocrCanvasesWithVision(
  canvases: HTMLCanvasElement[],
  engine: VisionEngine,
  opts: OcrOptions = {},
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < canvases.length; i++) {
    opts.onProgress?.({
      page: i + 1,
      totalPages: canvases.length,
      status: "recognizing",
      fraction: i / canvases.length,
    });
    const b64 = await canvasToBase64(canvases[i]);
    const text = await engine.recognize(b64);
    out.push(text.trim());
  }
  opts.onProgress?.({
    page: canvases.length,
    totalPages: canvases.length,
    status: "done",
    fraction: 1,
  });
  return out;
}

export { VISION_OCR_PROMPT };
