import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "../package.json";

export default defineManifest({
  manifest_version: 3,
  name: "OctoVault AI",
  description: "Fill any web form from your own documents. Locally.",
  version: pkg.version,
  // chrome.sidePanel arrived in Chrome 114 — Edge, Brave, and Arc all
  // shipped support shortly after. Stamping this here makes the API
  // requirement explicit and keeps older Chrome from silently failing
  // when the user clicks the action button.
  minimum_chrome_version: "114",
  icons: {
    16:  "icons/icon-16.png",
    32:  "icons/icon-32.png",
    48:  "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  action: {
    // No default_popup: clicking the toolbar icon opens the side panel
    // instead. The service worker registers that behaviour at install.
    default_title: "OctoVault AI",
    default_icon: {
      16:  "icons/icon-16.png",
      32:  "icons/icon-32.png",
      48:  "icons/icon-48.png",
    },
  },
  side_panel: { default_path: "src/sidepanel/index.html" },
  background: { service_worker: "src/background/index.ts", type: "module" },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: true,
      match_about_blank: true,
    },
  ],
  permissions: ["storage", "activeTab", "scripting", "sidePanel"],
  host_permissions: [
    "http://localhost:11434/*", "http://127.0.0.1:11434/*",
    "http://localhost:53117/*", "http://127.0.0.1:53117/*",
  ],
  web_accessible_resources: [
    {
      resources: ["tesseract/*"],
      matches: ["<all_urls>"],
    },
  ],
});
