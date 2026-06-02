import React from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./Landing";
import "@octovault/ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root not found");
createRoot(root).render(
  <React.StrictMode>
    <Landing />
  </React.StrictMode>
);
