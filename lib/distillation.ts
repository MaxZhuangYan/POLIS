import Database from "better-sqlite3";
import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Distillation pipeline (Phase 2).
//
// Turns a player's decided Decision Moment into a "principle" row via a local
// LLM call (LM Studio, OpenAI-compatible endpoint), with strict validation
// and a guaranteed non-blocking fallback.
//
// Core defense line (per POLIS_BUILD_DECISIONS.md ⑥ — degrade paths are the
// hard part of Phase 2): every LLM call is wrapped so network errors,
// timeouts, and malformed/invalid JSON are all treated the same way — retry
// once, and if the retry also fails, fall back to the decision's own
// `fallbackPrinciple` text with `source = 'fallback'`. distillDecidedMoments()
// must never throw and must never leave a hung request blocking the batch
// (hence AbortSignal.timeout on every fetch).
//
// Time fields: created_at / last_decayed_at are wall-clock ms (Date.now()),
// per Build Decision ④ — this file does not touch tick counters at all.
// ---------------------------------------------------------------------------

type MomentType = "trust" | "risk" | "integrity";
type PrincipleDomain = "trust" | "risk" | "integrity";
type PrincipleSource = "llm" | "fallback";

interface MomentOption {
  id: string;
  label: string;
  fallbackPrinciple: string;
}

interface DecidedMomentRow {
  id: number;
  agent_id: string;
  type: string;
  prompt_text: string;
  options_json: string;
  player_choice: string | null;
}

interface LlmDistillationResult {
  principle: string;
  domain: PrincipleDomain;
}

const DEFAULT_LMSTUDIO_URL = "http://127.0.0.1:1234/v1/chat/completions";
const DEFAULT_LMSTUDIO_MODEL = "google/gemma-4-e4b";
const LMSTUDIO_TIMEOUT_MS = 45000; // this model's chain-of-thought reasoning
// alone can take ~24s before it ever starts writing the JSON content, so a
// short timeout would abort every real call before completion and always
// fall through to fallback (measured empirically during Phase 2 integration).

// Matches Polis_蒸馏测试集_v1.md's fixed System Prompt exactly (not the
// earlier version in the dev doc's 4.3) — the test set's version has two
// lines the dev-doc version lacks: "不是对这次事件的复述" (don't just
// restate the event) and "若选择涉及对他人的影响，原则应体现这一点" (if the
// choice affects others, the principle should reflect that). Both were
// specifically added to fix a documented C-group moral-core deviation
// (model defaulting to "follow the rules" phrasing instead of capturing the
// actual other-regarding reasoning behind a choice) — using the older,
// unfixed prompt in production would reintroduce that bug.
const SYSTEM_PROMPT =
  '你是一个 AI Agent 的记忆系统。你的任务是把玩家的一次决策，\n' +
  '蒸馏成一条简短的行为原则，供 Agent 未来决策时参考。\n\n' +
  '要求：\n' +
  '- 中文，不超过 20 字\n' +
  '- 是一条可指导未来行为的原则，不是对这次事件的复述\n' +
  '- 若选择涉及对他人的影响，原则应体现这一点\n' +
  '- 只输出 JSON，格式：{"principle": "...", "domain": "trust|risk|integrity"}\n' +
  '- 不要输出任何其他文字';

function buildUserPrompt(type: string, promptText: string, optionLabel: string): string {
  return (
    `情境类型：${type}\n` +
    `情境：${promptText}\n` +
    `玩家选择：${optionLabel}\n` +
    `结果：已按此选择行事，尚无进一步后果记录。`
  );
}

// --- Response parsing / validation -----------------------------------------

// Scans for the first '{' and returns the substring up to its matching '}'
// (brace-depth tracked, so a well-formed single JSON object embedded in
// surrounding prose/fences is still found correctly). Returns null if no
// balanced object is found.
function extractFirstJsonObject(input: string): string | null {
  const start = input.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < input.length; i++) {
    if (input[i] === "{") depth++;
    else if (input[i] === "}") {
      depth--;
      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }
  return null; // unbalanced, e.g. truncated by max_tokens
}

function stripCodeFences(content: string): string {
  // Strip ``` / ```json fences wherever they appear; leaves the JSON body.
  return content.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function isPrincipleDomain(value: unknown): value is PrincipleDomain {
  return value === "trust" || value === "risk" || value === "integrity";
}

// Exported so the distillation regression script (scripts/) can validate
// against the exact same production logic rather than a reimplementation.
export function parseAndValidateLlmContent(content: string): LlmDistillationResult | null {
  const cleaned = stripCodeFences(content);
  const jsonSubstring = extractFirstJsonObject(cleaned);
  if (!jsonSubstring) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSubstring);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const rawPrinciple = obj.principle;
  if (typeof rawPrinciple !== "string") return null;
  const principle = rawPrinciple.trim();
  if (principle.length === 0) return null;
  if (Array.from(principle).length > 20) return null; // Unicode/CJK-correct count

  const domain = obj.domain;
  if (!isPrincipleDomain(domain)) return null;

  return { principle, domain };
}

// --- LLM call ----------------------------------------------------------------

// Raw single call to LM Studio with the production SYSTEM_PROMPT and an
// arbitrary user message — returns the raw `content` string, or null on any
// failure (network error, timeout, non-OK response, missing content). No
// retry, no validation, no fallback. Exported so the distillation regression
// script (scripts/) can feed it the 24 documented test scenarios' literal
// "情境：...\n玩家选择：..." text and separately apply
// parseAndValidateLlmContent() to grade the raw model behavior — this is
// deliberately NOT the same as requestDistillation() below (which is
// decision_moments-shaped and includes production's retry policy), since
// the regression test's purpose is measuring the raw model's compliance
// rate against the test set's fixed prompt, not the pipeline's resilience.
export async function callDistillationLlmRaw(userPrompt: string): Promise<string | null> {
  const url = process.env.LMSTUDIO_URL ?? DEFAULT_LMSTUDIO_URL;
  const model = process.env.LMSTUDIO_MODEL ?? DEFAULT_LMSTUDIO_MODEL;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 900,
        // Both models on the LAN LM Studio box are "thinking" models that
        // otherwise burn most/all of max_tokens on hidden chain-of-thought
        // before ever writing `content` (measured during Phase 2/3 prep:
        // google/gemma-4-e4b took ~24-45s and ~400-500 reasoning tokens per
        // call). This param reliably suppresses it on Qwen (reasoning_tokens
        // consistently 0, ~1.5s per call once warm); on Gemma it only
        // suppresses it *some* of the time — harmless to send either way
        // since an unsupported param is just ignored by the server.
        reasoning_effort: "none",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(LMSTUDIO_TIMEOUT_MS),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

// A single attempt: POST to LM Studio, parse + validate. Returns null on ANY
// failure (network error, timeout, non-OK response, malformed JSON, failed
// validation) — the caller is responsible for retry/fallback. Never throws.
async function requestDistillation(
  type: string,
  promptText: string,
  optionLabel: string
): Promise<LlmDistillationResult | null> {
  const content = await callDistillationLlmRaw(buildUserPrompt(type, promptText, optionLabel));
  if (content === null) return null;
  return parseAndValidateLlmContent(content);
}

// Two identical attempts total (one call + one retry), per spec. Returns null
// only if both attempts fail — the caller then falls back.
async function distillViaLlmWithRetry(
  type: string,
  promptText: string,
  optionLabel: string
): Promise<LlmDistillationResult | null> {
  const first = await requestDistillation(type, promptText, optionLabel);
  if (first) return first;

  const retry = await requestDistillation(type, promptText, optionLabel);
  if (retry) return retry;

  return null;
}

// --- Per-decision distillation -----------------------------------------------

async function distillOne(db: Database.Database, row: DecidedMomentRow): Promise<void> {
  let options: MomentOption[];
  try {
    options = JSON.parse(row.options_json) as MomentOption[];
  } catch (err) {
    console.error(`[distillation] decision ${row.id} has unparseable options_json; skipping`, err);
    return;
  }

  const option = options.find((o) => o.id === row.player_choice);
  if (!option) {
    console.error(
      `[distillation] decision ${row.id} has no option matching player_choice=${String(
        row.player_choice
      )}; skipping`
    );
    return;
  }

  const type = row.type as MomentType;

  const llmResult = await distillViaLlmWithRetry(type, row.prompt_text, option.label);

  let text: string;
  let domain: PrincipleDomain;
  let source: PrincipleSource;

  if (llmResult) {
    text = llmResult.principle;
    domain = llmResult.domain;
    source = "llm";
  } else {
    text = option.fallbackPrinciple;
    domain = type; // decision's own type doubles as the fallback domain
    source = "fallback";
  }

  const now = Date.now();
  try {
    db.prepare(
      `
      INSERT INTO principles
        (agent_id, text, domain, weight, source_decision_id, source, last_cited_at, last_decayed_at, created_at)
      VALUES
        (@agentId, @text, @domain, 1.0, @sourceDecisionId, @source, NULL, @createdAt, @createdAt)
      `
    ).run({
      agentId: row.agent_id,
      text,
      domain,
      sourceDecisionId: row.id,
      source,
      createdAt: now,
    });
  } catch (err) {
    // The idx_principles_source_decision_id UNIQUE index (lib/db.ts) is the
    // DB-level backstop for cross-process/container duplicate distillation:
    // __polisDistillationInFlight (below) only prevents overlap *within one
    // Node process*, so if two separate processes both see decision `row.id`
    // as "decided but not yet distilled" and race to insert, one of them will
    // lose here. That's expected and handled, not a bug -- log informationally
    // and return normally so the batch continues. Any other error (disk full,
    // schema mismatch, etc.) is NOT this specific case and must still
    // propagate to distillDecidedMoments()'s per-row catch.
    if (err instanceof Database.SqliteError && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      console.log(
        `[distillation] decision ${row.id} was already distilled (likely by a concurrent process); skipping duplicate insert`
      );
      return;
    }
    throw err;
  }
}

// --- Batch entry point --------------------------------------------------------

// Distills every decided-but-not-yet-distilled Decision Moment. A decision is
// "not yet distilled" iff its id doesn't appear as a principles.source_decision_id
// (there's no separate boolean flag column — this NOT IN check is the marker).
//
// Never throws: a query failure aborts the batch (logged), and a per-row
// failure is caught and logged so it can't take down the rest of the batch.
export async function distillDecidedMoments(): Promise<void> {
  const db = getDb();

  let rows: DecidedMomentRow[];
  try {
    rows = db
      .prepare(
        `
        SELECT id, agent_id, type, prompt_text, options_json, player_choice
        FROM decision_moments
        WHERE status = 'decided'
          AND id NOT IN (SELECT source_decision_id FROM principles)
        `
      )
      .all() as DecidedMomentRow[];
  } catch (err) {
    console.error("[distillation] failed to query decided moments:", err);
    return;
  }

  for (const row of rows) {
    try {
      await distillOne(db, row);
    } catch (err) {
      // distillOne shouldn't throw (its own fetch/parse paths already catch),
      // but this is the last line of defense so one bad row can never sink
      // the batch.
      console.error(`[distillation] failed to distill decision ${row.id}:`, err);
    }
  }
}

// --- Throttled trigger ---------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __polisLastDistillationRun: number | undefined;
  // eslint-disable-next-line no-var
  var __polisDistillationInFlight: boolean | undefined;
}

const DEFAULT_DISTILLATION_INTERVAL_MS = 2 * 60 * 1000; // 2 real minutes (local dev/testing only;
// Phase 4 replaces this ad-hoc throttle with a real 04:00-local-time nightly schedule).

// Fire-and-forget wrapper meant to be called periodically (e.g. from the
// world clock tick) by another module. Only actually runs the batch if at
// least DISTILLATION_INTERVAL_MS has passed since the last run; otherwise a
// no-op. Never awaited by the caller — this function itself never rejects.
//
// Concurrency note (found during integration testing): the time-since-last
// -run check alone is NOT enough. distillDecidedMoments() is async (each
// decision can take up to ~30s across two LLM attempts with retries/
// timeouts), so if a batch is still awaiting an LLM response when the next
// tick fires, a time-only throttle would start a SECOND overlapping batch.
// Both batches' "decided but not yet distilled" queries (a plain `NOT IN`
// check, not a locking read) would then both see the same undistilled rows
// before either has inserted its principle, producing duplicate principles
// per decision. The `__polisDistillationInFlight` guard below closes this:
// it's set synchronously before the async work starts and cleared in a
// `finally`, so a still-running batch always blocks the next tick's attempt
// regardless of how much wall-clock time has passed.
export function maybeRunDistillationBatch(): void {
  if (globalThis.__polisDistillationInFlight) {
    return;
  }

  const envInterval = Number(process.env.DISTILLATION_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(envInterval) && envInterval > 0 ? envInterval : DEFAULT_DISTILLATION_INTERVAL_MS;

  const now = Date.now();
  const last = globalThis.__polisLastDistillationRun;

  if (last !== undefined && now - last < intervalMs) {
    return;
  }

  globalThis.__polisLastDistillationRun = now;
  globalThis.__polisDistillationInFlight = true;

  distillDecidedMoments()
    .catch((err) => {
      console.error("[distillation] batch run failed:", err);
    })
    .finally(() => {
      globalThis.__polisDistillationInFlight = false;
    });
}
