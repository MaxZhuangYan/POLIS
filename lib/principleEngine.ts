import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Principle engine (Phase 2 "烙印" storage/retrieval/decay layer).
//
// Scope: this file owns all read/write access to the `principles`,
// `principle_citations`, and `wavering_events` tables (schema lives in
// lib/db.ts, owned by another agent in this parallel build). It does NOT do
// LLM-based distillation itself (that's lib/distillation.ts's job) -- this
// file only stores/retrieves/decays already-distilled principles, logs
// citations against them, and runs the (template-based, non-LLM) "wavering
// event" trigger check described in the design doc's 4.3 section.
//
// Per POLIS_BUILD_DECISIONS.md decision ④ (time-scale separation): every
// timestamp here is a real wall-clock Date.now() epoch ms, never a tick
// count. The 14-day decay window and the "≤1 wavering event per agent per
// week" cap are both real time, deliberately decoupled from the world
// clock's tick rate so pausing/fast-forwarding the world doesn't distort
// them.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DECAY_WINDOW_MS = 14 * DAY_MS;
const WAVERING_WEEKLY_CAP_MS = 7 * DAY_MS;
const DORMANT_THRESHOLD = 0.3; // weight below this = dormant; not retrieved, no flag needed
const DECAY_FACTOR = 0.8;
const WAVERING_NEGATIVE_THRESHOLD = 2;

export interface PrincipleRow {
  id: number;
  agent_id: string;
  text: string;
  domain: string;
  weight: number;
  source_decision_id: number;
  source: string;
  last_cited_at: number | null;
  last_decayed_at: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Recency scoring, used by getTopPrinciples().
//
// Design doc 4.3 asks for "domain 匹配 + weight × 时近加权的 top-3 原则" without
// specifying an exact recency curve. Chosen shape: recencyFactor(t) =
// 1 / (1 + daysSince), where daysSince is measured from whichever is more
// recent of last_cited_at / created_at. This is a smooth, monotonically
// decreasing multiplier in (0, 1]: score is halved after 1 day idle, cut to
// ~1/3 after 2 days, ~1/8 after a week, etc., but never hits exactly zero (a
// very old but very high-weight principle can still edge out a low-weight
// one that was cited yesterday). This is a *ranking* heuristic among already
// -retrievable principles -- distinct from the hard 14-day dormancy cutoff in
// decayPrinciples()/the weight >= 0.3 filter, which governs whether a
// principle is retrievable at all.
// ---------------------------------------------------------------------------
function recencyFactor(referenceMs: number, now: number): number {
  const daysSince = Math.max(0, (now - referenceMs) / DAY_MS);
  return 1 / (1 + daysSince);
}

function combinedScore(row: PrincipleRow, now: number): number {
  const reference = row.last_cited_at ?? row.created_at;
  return row.weight * recencyFactor(reference, now);
}

export function getTopPrinciples(
  agentId: string,
  domain: "trust" | "risk" | "integrity",
  k: number = 3
): PrincipleRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM principles WHERE agent_id = ? AND domain = ? AND weight >= ?`
    )
    .all(agentId, domain, DORMANT_THRESHOLD) as PrincipleRow[];

  const now = Date.now();
  return rows
    .slice()
    .sort((a, b) => combinedScore(b, now) - combinedScore(a, now))
    .slice(0, k);
}

export function getAllActivePrinciples(agentId: string): PrincipleRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM principles WHERE agent_id = ? AND weight >= ? ORDER BY created_at DESC`
    )
    .all(agentId, DORMANT_THRESHOLD) as PrincipleRow[];
}

// ---------------------------------------------------------------------------
// decayPrinciples -- compounding decay pass, catching up on however many
// full 14-day periods have elapsed since the principle was last cited.
//
// P2 fix (found in code review): the original version applied at most one
// ×0.8 step per call regardless of how long a principle had gone unchecked
// (e.g. after a long server downtime, 40 days idle should compound to
// ×0.8² ≈ ×0.64 for the two full periods that elapsed, not just ×0.8 for
// one). Still idempotent and safe to call as often or as rarely as the
// caller likes -- `last_decayed_at` tracks how many periods (relative to
// the current citation reference) have already been "consumed", so calling
// this twice in a row with no time passing is a no-op, and a citation that
// updates `last_cited_at` naturally resets the reference point (any prior
// last_decayed_at at or before the new reference counts as zero periods
// already applied against it).
// ---------------------------------------------------------------------------
export function decayPrinciples(): void {
  const db = getDb();
  const now = Date.now();

  const candidates = db
    .prepare(`SELECT * FROM principles WHERE weight >= ?`)
    .all(DORMANT_THRESHOLD) as PrincipleRow[];

  const applyDecay = db.prepare(
    `UPDATE principles SET weight = ?, last_decayed_at = ? WHERE id = ?`
  );

  const runDecay = db.transaction((rows: PrincipleRow[]) => {
    for (const row of rows) {
      const reference = row.last_cited_at ?? row.created_at;
      const totalPeriodsElapsed = Math.floor((now - reference) / DECAY_WINDOW_MS);
      if (totalPeriodsElapsed <= 0) continue; // not stale yet

      const periodsAlreadyApplied =
        row.last_decayed_at > reference
          ? Math.floor((row.last_decayed_at - reference) / DECAY_WINDOW_MS)
          : 0;

      const periodsToApply = totalPeriodsElapsed - periodsAlreadyApplied;
      if (periodsToApply <= 0) continue; // already caught up for this reference

      const newWeight = row.weight * DECAY_FACTOR ** periodsToApply;
      const newLastDecayedAt = reference + totalPeriodsElapsed * DECAY_WINDOW_MS;
      applyDecay.run(newWeight, newLastDecayedAt, row.id);
    }
  });

  runDecay(candidates);
}

export function logCitation(
  principleId: number,
  context: string,
  outcome: "positive" | "negative" | "neutral"
): void {
  const db = getDb();
  const now = Date.now();

  const insertCitation = db.prepare(
    `INSERT INTO principle_citations (principle_id, context, outcome, created_at) VALUES (?, ?, ?, ?)`
  );
  const touchPrinciple = db.prepare(
    `UPDATE principles SET last_cited_at = ? WHERE id = ?`
  );

  const run = db.transaction(() => {
    insertCitation.run(principleId, context, outcome, now);
    touchPrinciple.run(now, principleId);
  });
  run();
}

// ---------------------------------------------------------------------------
// checkAndTriggerWavering -- design doc 4.3: a principle whose guided
// decisions produced negative outcomes >= 2 times triggers a "wavering"
// event (agent asks the player to reaffirm or revise), capped at 1 per agent
// per real week (across ALL of that agent's principles, not per-principle --
// this is a "don't spam the player" cap, not a per-principle cooldown).
// ---------------------------------------------------------------------------
export function checkAndTriggerWavering(principleId: number): void {
  const db = getDb();

  const principle = db
    .prepare(`SELECT * FROM principles WHERE id = ?`)
    .get(principleId) as PrincipleRow | undefined;
  if (!principle) return; // nothing to evaluate

  const now = Date.now();

  // Weekly cap is per agent: if this agent triggered a wavering event
  // (for any principle) in the last 7 real days, do nothing.
  const recentAgentWavering = db
    .prepare(
      `SELECT COUNT(*) as n FROM wavering_events WHERE agent_id = ? AND created_at >= ?`
    )
    .get(principle.agent_id, now - WAVERING_WEEKLY_CAP_MS) as { n: number };
  if (recentAgentWavering.n > 0) return;

  // Only count negative citations logged since this principle's own most
  // recent wavering event (if any exists) -- otherwise the same pair of
  // negative citations that already produced one event would immediately
  // re-trigger another as soon as the weekly cap window rolls past.
  const lastOwnEvent = db
    .prepare(
      `SELECT created_at FROM wavering_events WHERE principle_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(principleId) as { created_at: number } | undefined;
  const cutoff = lastOwnEvent ? lastOwnEvent.created_at : 0;

  const negativeCount = db
    .prepare(
      `SELECT COUNT(*) as n FROM principle_citations WHERE principle_id = ? AND outcome = 'negative' AND created_at > ?`
    )
    .get(principleId, cutoff) as { n: number };

  if (negativeCount.n >= WAVERING_NEGATIVE_THRESHOLD) {
    const promptText = `我最近开始怀疑一件事——我一直坚持"${principle.text}"，但最近这么做好像没有带来好结果。要继续坚持，还是我该重新想想？`;
    db.prepare(
      `INSERT INTO wavering_events (agent_id, principle_id, prompt_text, created_at, status) VALUES (?, ?, ?, ?, 'pending')`
    ).run(principle.agent_id, principleId, promptText, now);
  }
}
