import React from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./Landing";
import { BugReportPage } from "./BugReport";
import { PrivacyPage } from "./Privacy";
import { TermsPage } from "./Terms";
import { initAnalytics } from "./analytics";
import "@octovault/ui/styles.css";

function pageFor(pathname: string) {
  if (pathname === "/privacy") return <PrivacyPage />;
  if (pathname === "/terms-and-conditions") return <TermsPage />;
  return pathname === "/bug-report" ? <BugReportPage /> : <Landing />;
}

// Client bootstrap. Guarded by a runtime DOM check so the module can also
// be imported during prerender (vite-prerender-plugin) without triggering
// the side effect.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  initAnalytics();
  const root = document.getElementById("root");
  if (!root) throw new Error("root not found");
  createRoot(root).render(<React.StrictMode>{pageFor(window.location.pathname)}</React.StrictMode>);
}

// Prerender entrypoint for vite-prerender-plugin. Called once per route at
// build time inside a sandboxed jsdom; the plugin injects the returned
// HTML into dist/index.html and dist/bug-report/index.html so crawlers see
// the hero copy without executing the SPA.
export async function prerender(data: { url: string }) {
  const { renderToString } = await import("react-dom/server");
  const url = new URL(data.url ?? "/", "https://octovault.ai");
  const html = renderToString(<React.StrictMode>{pageFor(url.pathname)}</React.StrictMode>);
  return { html };
}
