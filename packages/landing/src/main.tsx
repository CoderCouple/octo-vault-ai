import React from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./Landing";
import { BugReportPage } from "./BugReport";
import { initAnalytics } from "./analytics";
import "@octovault/ui/styles.css";

initAnalytics();

const root = document.getElementById("root");
if (!root) throw new Error("root not found");

const page = window.location.pathname === "/bug-report" ? <BugReportPage /> : <Landing />;

createRoot(root).render(<React.StrictMode>{page}</React.StrictMode>);
