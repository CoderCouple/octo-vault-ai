import React from "react";
import { createRoot } from "react-dom/client";
import { App, AppProvider, SpotlightOverlay } from "@octovault/ui";
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

// The same renderer bundle drives multiple BrowserWindows. The main
// process picks which one by loading the URL with a `?mode=` query
// param ("main" — default; "overlay" — Spotlight-style ask bar).
const mode = new URLSearchParams(window.location.search).get("mode") ?? "main";

const root = document.getElementById("root");
if (!root) throw new Error("root not found");

if (mode === "overlay") {
  // Overlay window: transparent body, no snapshot pump (the main window
  // owns that work), no main app shell — just the search bar.
  document.documentElement.classList.add("overlay-mode");
  document.body.style.background = "transparent";
  createRoot(root).render(
    <React.StrictMode>
      <AppProvider host={desktopHost}>
        <SpotlightOverlay />
      </AppProvider>
    </React.StrictMode>,
  );
} else {
  void startSnapshotPump();
  createRoot(root).render(
    <React.StrictMode>
      <AppProvider host={desktopHost}>
        <App layout="full" />
      </AppProvider>
    </React.StrictMode>,
  );
}
