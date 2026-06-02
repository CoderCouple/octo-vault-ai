// Typed message contract used by the extension (popup ↔ background ↔
// content) and by the desktop renderer (renderer ↔ main via IPC).

import type { DetectedField, FieldMatch } from "./match";
import type { Profile } from "./schema";

export type Msg =
  | { type: "ping" }
  | { type: "ollama.health" }
  | { type: "ollama.generate"; prompt: string; system?: string; json?: boolean }
  | { type: "form.match"; fields: DetectedField[] }
  | { type: "form.detected"; url: string; fieldCount: number };

export type MsgResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type FormMatchResponse = { matches: FieldMatch[]; profile: Profile };
