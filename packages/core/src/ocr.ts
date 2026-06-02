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
