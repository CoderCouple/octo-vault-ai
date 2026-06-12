import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { vitePrerenderPlugin } from "vite-prerender-plugin";

export default defineConfig({
  plugins: [
    react(),
    // Renders the React tree to HTML at build time and injects it into
    // dist/index.html. Crawlers (HN preview, Slack/Discord/iMessage
    // unfurls, search engines) see the hero copy without JS execution.
    // The client still hydrates / re-mounts on top — animations and
    // interactivity are unchanged at runtime.
    vitePrerenderPlugin({
      renderTarget: "#root",
      additionalPrerenderRoutes: ["/bug-report", "/privacy", "/terms-and-conditions"],
    }),
  ],
  server: { port: 5175, strictPort: true },
  build: { target: "esnext" },
});
