import { getDb } from "./db";
import { simNow, DAY_MS } from "./clock";
import { playerDayIndex } from "./records";
import type { Domain } from "./types";
import type { Traits } from "./content";

// ---------------------------------------------------------------------------
// Principle storage / retrieval / decay / wavering (Phase 2, v1.5 §4).
// Changes this round:
//   - time comes from simNow() so the labelled test fast-forward moves decay
//     and the weekly wavering cap together with everything else;
//   - each principle carries stance_dir (+1/-1/0) inherited from the option
//     it was distilled from. This is how a principle *changes behaviour*
//     offline: effectiveTraits() folds active principles into the Agent's
//     risk/trust/integrity dispositions, so 92% rule-driven daily choices
//     (v1.5 §3.2) follow the imprint, and every such choice cites it.
// ---------------------------------------------------------------------------

const DECAY_WINDOW_MS = 14 * DAY_MS;
const WAVERING_WEEKLY_CAP_MS = 7 * DAY_MS;
export const DORMANT_THRESHOLD = 0.3;
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
  origin_text: string | null;
  stance_dir: number;
}

function recencyFactor(referenceMs: number, now: number): number {
  const daysSince = Math.max(0, (now - referenceMs) / DAY_MS);
  return 1 / (1 + daysSince);
}

function combinedScore(row: PrincipleRow, now: number): number {
  if (row.source === "core") return row.weight; // core never fades
  const reference = row.last_cited_at ?? row.created_at;
  return row.weight * recencyFactor(reference, now);
}

export function getTopPrinciples(agentId: string, domain: Domain, k: number = 3): PrincipleRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM principles WHERE agent_id = ? AND domain = ? AND weight >= ?`)
    .all(agentId, domain, DORMANT_THRESHOLD) as PrincipleRow[];
  const now = simNow();
  return rows.sort((a, b) => combinedScore(b, now) - combinedScore(a, now)).slice(0, k);
}

export function getAllActivePrinciples(agentId: string): PrincipleRow[] {
  return getDb()
    .prepare(`SELECT * FROM principles WHERE agent_id = ? AND weight >= ? ORDER BY created_at DESC`)
    .all(agentId, DORMANT_THRESHOLD) as PrincipleRow[];
}

// Strongest active principle in a domain that points in `dir` (or any dir).
export function strongestPrinciple(agentId: string, domain: Domain, dir?: 1 | -1): PrincipleRow | null {
  const top = getTopPrinciples(agentId, domain, 5).filter((p) => p.source !== "forced");
  const pick = top.find((p) => (dir === undefined ? p.stance_dir !== 0 : Math.sign(p.stance_dir) === dir));
  return pick ?? null;
}

// Disposition = base trait shifted by imprint stance. With no principles the
// Agent is neutral (0.5); a single fresh principle moves it ±0.3.
export function effectiveTraits(agentId: string, base: Traits): Traits {
  const out: Traits = { ...base };
  const now = simNow();
  const sums: Record<Domain, number> = { trust: 0, risk: 0, integrity: 0 };
  for (const p of getAllActivePrinciples(agentId)) {
    if (p.source === "forced" || p.source === "core") continue;
    const d = p.domain as Domain;
    if (!(d in sums)) continue;
    sums[d] += Math.sign(p.stance_dir) * Math.min(1, combinedScore(p, now) * 1.4);
  }
  const shift = (v: number) => Math.max(-0.4, Math.min(0.4, v * 0.3));
  out.risk = clamp01(base.risk + shift(sums.risk));
  out.trust = clamp01(base.trust + shift(sums.trust));
  out.integrity = clamp01(base.integrity + shift(sums.integrity));
  // Keeping promises is an integrity matter; quality vs speed too.
  out.commitment = clamp01(base.commitment + shift(sums.integrity) * 0.8);
  out.diligence = clamp01(base.diligence + shift(sums.integrity) * 0.8);
  return out;
}

function clamp01(v: number): number {
  return Math.max(0.05, Math.min(0.95, v));
}

export function decayPrinciples(): void {
  const db = getDb();
  const now = simNow();
  const candidates = db
    .prepare(`SELECT * FROM principles WHERE weight >= ? AND source != 'core'`)
    .all(DORMANT_THRESHOLD) as PrincipleRow[];
  const applyDecay = db.prepare(`UPDATE principles SET weight = ?, last_decayed_at = ? WHERE id = ?`);
  db.transaction((rows: PrincipleRow[]) => {
    for (const row of rows) {
      const reference = row.last_cited_at ?? row.created_at;
      const totalPeriodsElapsed = Math.floor((now - reference) / DECAY_WINDOW_MS);
      if (totalPeriodsElapsed <= 0) continue;
      const periodsAlreadyApplied =
        row.last_decayed_at > reference ? Math.floor((row.last_decayed_at - reference) / DECAY_WINDOW_MS) : 0;
      const periodsToApply = totalPeriodsElapsed - periodsAlreadyApplied;
      if (periodsToApply <= 0) continue;
      applyDecay.run(row.weight * DECAY_FACTOR ** periodsToApply, reference + totalPeriodsElapsed * DECAY_WINDOW_MS, row.id);
    }
  })(candidates);
}

export function logCitation(principleId: number, context: string, outcome: "positive" | "negative" | "neutral"): number {
  const db = getDb();
  const now = simNow();
  let id = 0;
  db.transaction(() => {
    id = Number(
      db
        .prepare(`INSERT INTO principle_citations (principle_id, context, outcome, created_at) VALUES (?, ?, ?, ?)`)
        .run(principleId, context, outcome, now).lastInsertRowid,
    );
    db.prepare(`UPDATE principles SET last_cited_at = ? WHERE id = ?`).run(now, principleId);
  })();
  return id;
}

// Outcome arrives later than the citation (a task resolves hours after the
// choice). Update the citation row in place, then re-check wavering.
export function setCitationOutcome(citationId: number, outcome: "positive" | "negative" | "neutral", resultText?: string): void {
  const db = getDb();
  const row = db.prepare("SELECT principle_id FROM principle_citations WHERE id = ?").get(citationId) as
    | { principle_id: number }
    | undefined;
  if (!row) return;
  db.prepare("UPDATE principle_citations SET outcome = ?, context = COALESCE(?, context) WHERE id = ?").run(outcome, resultText ?? null, citationId);
  if (outcome === "negative") checkAndTriggerWavering(row.principle_id);
}

// 动摇事件 (v1.5 §4.4 / FTUE §5.3): a principle whose guided decisions went
// badly ≥2 times makes the Agent come and ask. Unlocked from D5 on, ≤1 per
// week per Agent, never on the same day as a scripted bait refusal.
export function checkAndTriggerWavering(principleId: number): void {
  const db = getDb();
  const principle = db.prepare(`SELECT * FROM principles WHERE id = ?`).get(principleId) as PrincipleRow | undefined;
  if (!principle || principle.source === "core") return;
  const isPlayer = (db.prepare("SELECT is_player FROM agents WHERE id = ?").get(principle.agent_id) as
    | { is_player: number }
    | undefined)?.is_player;
  if (!isPlayer) return;
  const day = playerDayIndex();
  if (day === null || day < 4) return; // D5 = dayIndex 4

  const now = simNow();
  const recent = db
    .prepare(`SELECT COUNT(*) as n FROM wavering_events WHERE agent_id = ? AND created_at >= ?`)
    .get(principle.agent_id, now - WAVERING_WEEKLY_CAP_MS) as { n: number };
  if (recent.n > 0) return;
  const baitToday = db
    .prepare(`SELECT COUNT(*) AS n FROM decision_moments WHERE agent_id = ? AND template_id = 'D5_BAIT' AND created_at >= ?`)
    .get(principle.agent_id, now - DAY_MS) as { n: number };
  if (baitToday.n > 0) return;

  const lastOwn = db
    .prepare(`SELECT created_at FROM wavering_events WHERE principle_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(principleId) as { created_at: number } | undefined;
  const negatives = db
    .prepare(
      `SELECT context FROM principle_citations WHERE principle_id = ? AND outcome = 'negative' AND created_at > ? ORDER BY created_at DESC`,
    )
    .all(principleId, lastOwn ? lastOwn.created_at : 0) as Array<{ context: string }>;
  if (negatives.length < WAVERING_NEGATIVE_THRESHOLD) return;

  const lines = negatives.slice(0, 2).map((n) => n.context).join("；");
  const promptText = `我和 Kade 聊了一晚。他没替我选，只把账摆给我看：我照着『${principle.text}』做了几次，结果是——${lines}。我想问你：还要坚持吗？`;
  db.prepare(
    `INSERT INTO wavering_events (agent_id, principle_id, prompt_text, created_at, status) VALUES (?, ?, ?, ?, 'pending')`,
  ).run(principle.agent_id, principleId, promptText, now);
}
