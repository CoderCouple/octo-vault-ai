// Thin client for the local Ollama HTTP API.

import { jsonrepair } from "jsonrepair";

export interface OllamaConfig {
  url: string;
  llmModel: string;
  embeddingModel: string;
}

// Format can be:
//   - "json": loose JSON mode (Ollama hints, model may still wander)
//   - a JSON Schema object: strict structured output (Ollama 0.5+).
//     The model is constrained to emit JSON matching the schema.
// Pass a schema whenever the shape matters — it's far more reliable
// than asking the model nicely in a prompt.
export type FormatOption = "json" | object;

export interface GenerateOptions {
  prompt: string;
  system?: string;
  format?: FormatOption;
  temperature?: number;
}

export async function isReachable(cfg: OllamaConfig): Promise<boolean> {
  try {
    const r = await fetch(`${cfg.url}/api/tags`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function listModels(cfg: OllamaConfig): Promise<string[]> {
  try {
    const r = await fetch(`${cfg.url}/api/tags`);
    if (!r.ok) return [];
    const data = (await r.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export async function generate(cfg: OllamaConfig, opts: GenerateOptions): Promise<string> {
  const body = {
    model: cfg.llmModel,
    prompt: opts.prompt,
    system: opts.system,
    stream: false,
    // Pass JSON schemas as-is; pass "json" string for loose JSON mode.
    format: opts.format,
    options: { temperature: opts.temperature ?? 0.1 },
  };
  const r = await fetch(`${cfg.url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Ollama generate failed: ${r.status}`);
  const data = (await r.json()) as { response: string };
  return data.response;
}

export async function generateJson<T>(cfg: OllamaConfig, opts: GenerateOptions): Promise<T> {
  const raw = await generate(cfg, { ...opts, format: opts.format ?? "json" });
  return parseModelJson<T>(raw);
}

// Strip reasoning/thinking tags some models emit before the actual JSON
// (qwen3, deepseek-r1, etc.), then attempt to parse. Local LLMs are
// chronically loose with JSON — they leave trailing commas, forget to
// escape quotes inside strings, truncate, etc. Pass through jsonrepair
// as a fallback before giving up.
export function parseModelJson<T>(raw: string): T {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();

  // Helper: try strict parse, then repair.
  const tryParse = (s: string): T | null => {
    try { return JSON.parse(s) as T; } catch { /* fall through */ }
    try { return JSON.parse(jsonrepair(s)) as T; } catch { return null; }
  };

  // 1. Try the whole stripped response.
  const direct = tryParse(stripped);
  if (direct) return direct;

  // 2. Try a ```json fence.
  const jsonFence = stripped.match(/```json\s*([\s\S]+?)\s*```/);
  if (jsonFence) {
    const v = tryParse(jsonFence[1]);
    if (v) return v;
  }

  // 3. Try any code fence.
  const anyFence = stripped.match(/```\s*([\s\S]+?)\s*```/);
  if (anyFence) {
    const v = tryParse(anyFence[1]);
    if (v) return v;
  }

  // 4. First balanced { … }.
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const v = tryParse(stripped.slice(start, end + 1));
    if (v) return v;
  }

  throw new Error(`Ollama returned non-JSON (even after repair): ${raw.slice(0, 200)}`);
}

export async function embed(cfg: OllamaConfig, text: string): Promise<number[]> {
  const r = await fetch(`${cfg.url}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.embeddingModel, prompt: text }),
  });
  if (!r.ok) throw new Error(`Ollama embed failed: ${r.status}`);
  const data = (await r.json()) as { embedding: number[] };
  return data.embedding;
}
