// Side-panel renderer. Same React app as the (former) popup; the only
// difference is the surface it mounts on. Chrome's side panel is a
// persistent strip docked to the side of the browser window so the
// user can keep OctoVault open while interacting with web pages and
// form-fill targets.

import React from "react";
import { createRoot } from "react-dom/client";
import { App, AppProvider } from "@octovault/ui";
import "@octovault/ui/styles.css";
import { configureOcr, setPdfWorkerSrc } from "@octovault/core";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extensionHost } from "../host";

setPdfWorkerSrc(pdfWorkerUrl);

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
