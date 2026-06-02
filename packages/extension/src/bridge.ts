// Thin client for the Desktop app's localhost bridge (:53117). If the
// desktop app is running, its IndexedDB is the source of truth and the
// extension uses its snapshot. If not, callers fall back to the local
// IDB adapter.

import type { VaultProfile } from "@octovault/core";

const BRIDGE_URL = "http://127.0.0.1:53117";

export async function bridgeReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/health`, { method: "GET" });
    return r.ok;
  } catch { return false; }
}

export async function fetchProfileFromBridge(): Promise<VaultProfile | null> {
  try {
    const r = await fetch(`${BRIDGE_URL}/profile`);
    if (!r.ok) return null;
    return (await r.json()) as VaultProfile;
  } catch { return null; }
}
