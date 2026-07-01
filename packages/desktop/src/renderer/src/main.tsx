import React from "react";
import { createRoot } from "react-dom/client";
import { App, AppProvider, FloatingShortcut, SpotlightOverlay } from "@octovault/ui";
import "@octovault/ui/styles.css";
import { configureOcr, setPdfWorkerSrc } from "@octovault/core";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { desktopHost, startSnapshotPump } from "./host";

setPdfWorkerSrc(pdfWorkerUrl);

// Bundled tesseract assets live in /tesseract/ (see public/tesseract/).
// The worker.min.js is spawned in a Blob context, so it can't resolve
// root-relative URLs — we must give fully-qualified ones.
//
// In dev, window.location.origin is http://localhost:5174 → clean.
// In packaged builds, Electron loads the renderer from file:// which
// makes window.location.origin the literal string "null" — that
// breaks worker/WASM fetches silently. Resolve against document.baseURI
// so the URLs come out as file:///path/to/renderer/tesseract/... in
// prod and http://localhost:5174/tesseract/... in dev.
const tessBase = new URL("tesseract/", document.baseURI).toString().replace(/\/$/, "");
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
  // owns that work), no main app shell — just the search bar. The
  // !important rules override styles.css's @apply bg-background on body
  // which otherwise paints a cream rectangle behind the rounded card.
  document.documentElement.classList.add("overlay-mode");
  const s = document.createElement("style");
  s.textContent = `
    html, body, #root {
      background: transparent !important;
      background-color: transparent !important;
      margin: 0 !important;
      padding: 0 !important;
    }
  `;
  document.head.appendChild(s);
  createRoot(root).render(
    <React.StrictMode>
      <AppProvider host={desktopHost}>
        <SpotlightOverlay />
      </AppProvider>
    </React.StrictMode>,
  );
} else if (mode === "shortcut") {
  // Floating shortcut window: tiny capsule, transparent body. No
  // AppProvider needed — the shortcut just toggles the overlay via
  // window.octovault.overlay.toggle(). The !important rules are
  // needed because @octovault/ui/styles.css applies `bg-background`
  // to body which would otherwise paint a cream rectangle behind
  // the rounded badge.
  document.documentElement.classList.add("shortcut-mode");
  const s = document.createElement("style");
  s.textContent = `
    html, body, #root {
      background: transparent !important;
      background-color: transparent !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
    }
  `;
  document.head.appendChild(s);
  createRoot(root).render(
    <React.StrictMode>
      <FloatingShortcut />
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
