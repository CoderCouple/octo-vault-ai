import React from "react";
import { createRoot } from "react-dom/client";
import { App, AppProvider } from "@octovault/ui";
import "@octovault/ui/styles.css";
import { configureOcr, setPdfWorkerSrc } from "@octovault/core";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extensionHost } from "../host";

setPdfWorkerSrc(pdfWorkerUrl);

// Bundled tesseract assets live in dist/tesseract/. Use chrome.runtime.getURL
// so the URL is fully qualified (chrome-extension://<id>/tesseract/...) which
// Web Workers and the extension sandbox can resolve.
configureOcr({
  workerPath: chrome.runtime.getURL("tesseract/worker.min.js"),
  corePath: chrome.runtime.getURL("tesseract/tesseract-core-simd.wasm.js"),
  langPath: chrome.runtime.getURL("tesseract/"),
});

const root = document.getElementById("root");
if (!root) throw new Error("root not found");

createRoot(root).render(
  <React.StrictMode>
    <AppProvider host={extensionHost}>
      <App layout="popup" />
    </AppProvider>
  </React.StrictMode>
);
