// ---------------------------------------------------------------------------
// One OpenAI-compatible client for every LLM seam (distillation, judge,
// postcard polish). LLM = stateless language organ; identity lives in the DB.
//
// Availability is probed (cached) so that a missing/offline endpoint never
// stalls a player-facing request: callers check llmAvailable() first and use
// the declared rule/template floor when it is false (公理 5: every output
// carries its `source`).
//
// Hosted endpoints have limits the local LM Studio box never had:
//  * a concurrency cap (POLIS_LLM_CONCURRENCY, default 3): calls queue here
//    instead of being rejected upstream;
//  * a cold start (30-60 s after idle): the first successful probe fires one
//    tiny warm-up request in the background, and player-facing calls keep
//    short timeouts so a cold model means "rules this time", never a frozen UI;
//  * thinking models (Qwen3 family): `<think>` blocks and `reasoning_content`
//    are stripped, and the Qwen soft switch `/no_think` is appended.
// Every call is counted (kind, ok, latency, failure reason) in memory for the
// HUD and in metric_events ('llm_call') for scripts/llm-report.mjs.
// ---------------------------------------------------------------------------

import { metric } from "./records";

const DEFAULT_URL = "http://127.0.0.1:1234/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.6-35b-a3b";
const PROBE_TTL_MS = 60_000;
const WARMUP_TIMEOUT_MS = 90_000;

export type LlmKind = "judge" | "distill" | "postcard" | "warmup" | "other";

export function llmConfig() {
  const url = process.env.POLIS_LLM_URL || process.env.LMSTUDIO_URL || DEFAULT_URL;
  const model = process.env.POLIS_LLM_MODEL || process.env.LMSTUDIO_MODEL || DEFAULT_MODEL;
  const apiKey = process.env.POLIS_LLM_API_KEY || "";
  const disabled = process.env.POLIS_LLM === "off";
  const concurrency = Math.max(1, Number(process.env.POLIS_LLM_CONCURRENCY) || 3);
  return { url, model, apiKey, disabled, concurrency };
}

interface KindStats {
  calls: number;
  ok: number;
  fail: number;
  totalMs: number;
}

interface LlmState {
  probe?: { ok: boolean; at: number; inflight?: Promise<boolean> };
  warm: "cold" | "warming" | "warm";
  active: number;
  queue: Array<() => void>;
  stats: Record<string, KindStats>;
  lastError: string | null;
  lastOkAt: number | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __polisLlm: LlmState | undefined;
}

function state(): LlmState {
  if (!globalThis.__polisLlm) globalThis.__polisLlm = { warm: "cold", active: 0, queue: [], stats: {}, lastError: null, lastOkAt: null };
  return globalThis.__polisLlm;
}

function authHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function probe(): Promise<boolean> {
  const { url, apiKey, disabled } = llmConfig();
  if (disabled) return false;
  const modelsUrl = url.replace(/\/chat\/completions\/?$/, "/models");
  try {
    const res = await fetch(modelsUrl, { headers: authHeaders(apiKey), signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** true when the endpoint answers AND the model is loaded; while it warms up, callers use their rule floor */
export async function llmAvailable(): Promise<boolean> {
  const s = state();
  const ready = (ok: boolean) => ok && s.warm === "warm";
  const cached = s.probe;
  const now = Date.now();
  if (cached && !cached.inflight && now - cached.at < PROBE_TTL_MS) {
    if (cached.ok && s.warm === "cold") warmUp();
    return ready(cached.ok);
  }
  if (cached?.inflight) return cached.inflight.then(ready);
  const inflight = probe().then((ok) => {
    s.probe = { ok, at: Date.now() };
    if (ok && s.warm === "cold") warmUp();
    if (!ok) s.warm = "cold";
    return ok;
  });
  s.probe = { ok: cached?.ok ?? false, at: cached?.at ?? 0, inflight };
  return inflight.then(ready);
}

/** one throw-away request so the endpoint loads the model before a player needs it */
function warmUp(): void {
  const s = state();
  s.warm = "warming";
  void chat("只回答 OK。", "OK", { kind: "warmup", maxTokens: 8, timeoutMs: WARMUP_TIMEOUT_MS }).then((out) => {
    s.warm = out !== null ? "warm" : "cold";
  });
}

export function llmStatusLabel(): { mode: "llm" | "offline"; label: string } {
  const { model, disabled } = llmConfig();
  const s = state();
  const ok = s.probe?.ok ?? false;
  if (disabled) return { mode: "offline", label: "离线模式 · 规则引擎（POLIS_LLM=off）" };
  if (!ok) return { mode: "offline", label: "离线模式 · 规则引擎" };
  if (s.warm !== "warm") return { mode: "offline", label: `模型加载中 · ${model}（暂用规则引擎）` };
  return { mode: "llm", label: `模型在线 · ${model}` };
}

/** counters since the server started, per call kind (for the HUD and the QA scripts) */
export function llmStats(): { warm: LlmState["warm"]; active: number; queued: number; lastError: string | null; byKind: Record<string, KindStats> } {
  const s = state();
  return { warm: s.warm, active: s.active, queued: s.queue.length, lastError: s.lastError, byKind: s.stats };
}

// ── concurrency gate ─────────────────────────────────────────────────────────

async function acquire(timeoutMs: number): Promise<boolean> {
  const s = state();
  const { concurrency } = llmConfig();
  if (s.active < concurrency) {
    s.active++;
    return true;
  }
  return new Promise<boolean>((resolve) => {
    let done = false;
    const grant = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.active++;
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      s.queue = s.queue.filter((g) => g !== grant);
      resolve(false);
    }, timeoutMs);
    s.queue.push(grant);
  });
}

function release(): void {
  const s = state();
  s.active = Math.max(0, s.active - 1);
  const next = s.queue.shift();
  if (next) next();
}

// ── one request ──────────────────────────────────────────────────────────────

/** remove a thinking model's chain of thought; returns the answer part */
export function stripThinking(content: string): string {
  let out = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // an unterminated block (the budget ran out mid-thought) leaves no answer at all
  if (/<think>/i.test(out)) out = out.replace(/<think>[\s\S]*$/i, "");
  return out.trim();
}

function record(kind: LlmKind, ok: boolean, ms: number, error: string | null): void {
  const s = state();
  const k = (s.stats[kind] ??= { calls: 0, ok: 0, fail: 0, totalMs: 0 });
  k.calls++;
  k.totalMs += ms;
  if (ok) {
    k.ok++;
    s.lastOkAt = Date.now();
  } else {
    k.fail++;
    s.lastError = `${kind}: ${error}`;
  }
  try {
    metric("llm_call", { kind, ok, ms, error });
  } catch {
    /* the DB may not be open in a bare script; the counters above still hold */
  }
}

export async function chat(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number; kind?: LlmKind } = {},
): Promise<string | null> {
  const { url, model, apiKey, disabled } = llmConfig();
  if (disabled) return null;
  const kind = opts.kind ?? "other";
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const t0 = Date.now();
  // waiting for a slot counts against the caller's budget
  if (!(await acquire(timeoutMs))) {
    record(kind, false, Date.now() - t0, "queue_timeout");
    return null;
  }
  const qwen = /qwen3/i.test(model);
  try {
    const left = Math.max(1_000, timeoutMs - (Date.now() - t0));
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
      body: JSON.stringify({
        model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 600,
        // LM Studio reads this; other servers ignore it. Qwen3 also honours the /no_think soft switch.
        reasoning_effort: "none",
        messages: [
          { role: "system", content: qwen ? `${system}\n/no_think` : system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(left),
    });
    if (!res.ok) {
      record(kind, false, Date.now() - t0, `http_${res.status}`);
      return null;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const raw = data.choices?.[0]?.message?.content;
    const content = typeof raw === "string" ? stripThinking(raw) : "";
    if (!content) {
      record(kind, false, Date.now() - t0, "empty");
      return null;
    }
    record(kind, true, Date.now() - t0, null);
    return content;
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    record(kind, false, Date.now() - t0, name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    return null;
  } finally {
    release();
  }
}

export function extractJson(content: string): unknown | null {
  const cleaned = stripThinking(content).replace(/```json/gi, "").replace(/```/g, "").trim();
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
