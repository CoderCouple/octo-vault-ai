import React from "react";
import { createRoot } from "react-dom/client";
import { App, AppProvider } from "@octovault/ui";
import "@octovault/ui/styles.css";
import { configureOcr, setPdfWorkerSrc } from "@octovault/core";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { desktopHost, startSnapshotPump } from "./host";

setPdfWorkerSrc(pdfWorkerUrl);

// Bundled tesseract assets live in /tesseract/ (see public/tesseract/).
// The worker.min.js is spawned in a Blob context, so it can't resolve
// root-relative URLs — we must give fully-qualified ones.
const tessBase = `${window.location.origin}/tesseract`;
configureOcr({
  workerPath: `${tessBase}/worker.min.js`,
  corePath: `${tessBase}/tesseract-core-simd.wasm.js`,
  langPath: `${tessBase}/`,
});

void startSnapshotPump();

const root = document.getElementById("root");
if (!root) throw new Error("root not found");

createRoot(root).render(
  <React.StrictMode>
    <AppProvider host={desktopHost}>
      <App layout="full" />
    </AppProvider>
  </React.StrictMode>
);
