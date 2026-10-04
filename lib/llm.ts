// ---------------------------------------------------------------------------
// One OpenAI-compatible client for every LLM seam (distillation, judge,
// postcard polish). LLM = stateless language organ; identity lives in the DB.
//
// Availability is probed (cached) so that a missing/offline LM Studio never
// stalls a player-facing request: callers check llmAvailable() first and use
// the declared rule/template floor when it is false (公理 5: every output
// carries its `source`).
// ---------------------------------------------------------------------------

const DEFAULT_URL = "http://127.0.0.1:1234/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.6-35b-a3b";
const PROBE_TTL_MS = 60_000;

export function llmConfig() {
  const url = process.env.POLIS_LLM_URL || process.env.LMSTUDIO_URL || DEFAULT_URL;
  const model = process.env.POLIS_LLM_MODEL || process.env.LMSTUDIO_MODEL || DEFAULT_MODEL;
  const apiKey = process.env.POLIS_LLM_API_KEY || "";
  const disabled = process.env.POLIS_LLM === "off";
  return { url, model, apiKey, disabled };
}

declare global {
  // eslint-disable-next-line no-var
  var __polisLlmProbe: { ok: boolean; at: number; inflight?: Promise<boolean> } | undefined;
}

async function probe(): Promise<boolean> {
  const { url, apiKey, disabled } = llmConfig();
  if (disabled) return false;
  const modelsUrl = url.replace(/\/chat\/completions\/?$/, "/models");
  try {
    const res = await fetch(modelsUrl, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function llmAvailable(): Promise<boolean> {
  const cached = globalThis.__polisLlmProbe;
  const now = Date.now();
  if (cached && now - cached.at < PROBE_TTL_MS) return cached.ok;
  if (cached?.inflight) return cached.inflight;
  const inflight = probe().then((ok) => {
    globalThis.__polisLlmProbe = { ok, at: Date.now() };
    return ok;
  });
  globalThis.__polisLlmProbe = { ok: cached?.ok ?? false, at: cached?.at ?? 0, inflight };
  return inflight;
}

export function llmStatusLabel(): { mode: "llm" | "offline"; label: string } {
  const { model, disabled } = llmConfig();
  const ok = globalThis.__polisLlmProbe?.ok ?? false;
  if (disabled) return { mode: "offline", label: "离线模式 · 规则引擎（POLIS_LLM=off）" };
  return ok ? { mode: "llm", label: `模型在线 · ${model}` } : { mode: "offline", label: "离线模式 · 规则引擎" };
}

export async function chat(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const { url, model, apiKey, disabled } = llmConfig();
  if (disabled) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 600,
        reasoning_effort: "none",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

export function extractJson(content: string): unknown | null {
  const cleaned = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
