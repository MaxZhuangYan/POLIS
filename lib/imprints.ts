// ---------------------------------------------------------------------------
// 记忆槽位 (mechanism v3.14 §2.4): the Agent holds at most N live imprints.
//
//  * N = agents.memory_slots, 5 for free; the 6th / 7th / 8th slot cost
//    200 / 400 / 800 Scrip (burned — the only big Scrip sink besides tickets).
//  * Only imprints the guardian shaped take a slot: distilled (llm / fallback),
//    from a note, or revised. A forced imprint is a scar, not a slot; core
//    values belong to NPCs.
//  * When a new imprint arrives (or an old one is reinforced) and there is no
//    room, the one it has leaned on least (weight × recency) goes dormant
//    (weight < DORMANT_THRESHOLD): it stops steering decisions but stays in the
//    archive, and the guardian can wake it by letting another one sleep.
// ---------------------------------------------------------------------------

import { getDb } from "./db";
import { simNow, DAY_MS } from "./clock";
import { DORMANT_THRESHOLD } from "./principleEngine";
import { agentName, logEvent, metric, pay, remember } from "./records";

export const FREE_SLOTS = 5;
export const MAX_SLOTS = 8;
const SLOT_COST: Record<number, number> = { 5: 200, 6: 400, 7: 800 };
export const SHAPED_SOURCES = ["llm", "fallback", "note", "revised"] as const;
const SHAPED_SQL = `source IN (${SHAPED_SOURCES.map((s) => `'${s}'`).join(",")})`;
const SLEEP_WEIGHT = DORMANT_THRESHOLD - 0.01;
const WAKE_WEIGHT = 0.7;

interface Row {
  id: number;
  text: string;
  weight: number;
  last_cited_at: number | null;
  created_at: number;
}

export function slotsOf(agentId: string): number {
  const r = getDb().prepare("SELECT memory_slots FROM agents WHERE id = ?").get(agentId) as { memory_slots: number | null } | undefined;
  return Math.max(FREE_SLOTS, Math.min(MAX_SLOTS, r?.memory_slots ?? FREE_SLOTS));
}

export function nextSlotCost(agentId: string): number | null {
  const n = slotsOf(agentId);
  return n >= MAX_SLOTS ? null : SLOT_COST[n] ?? null;
}

function active(agentId: string): Row[] {
  return getDb()
    .prepare(`SELECT id, text, weight, last_cited_at, created_at FROM principles WHERE agent_id = ? AND ${SHAPED_SQL} AND weight >= ?`)
    .all(agentId, DORMANT_THRESHOLD) as Row[];
}

export function slotUsage(agentId: string): { used: number; total: number; nextCost: number | null } {
  return { used: active(agentId).length, total: slotsOf(agentId), nextCost: nextSlotCost(agentId) };
}

/** how much the Agent still leans on an imprint: weight, fading with days since it was last used */
function lean(r: Row, now: number): number {
  const ref = r.last_cited_at ?? r.created_at;
  return r.weight / (1 + Math.max(0, (now - ref) / DAY_MS));
}

function sleep(agentId: string, r: Row, why: string): void {
  const db = getDb();
  db.prepare("UPDATE principles SET weight = ?, last_decayed_at = ? WHERE id = ?").run(SLEEP_WEIGHT, simNow(), r.id);
  remember(agentId, "principle_dormant", `『${r.text}』……${why}`, { principleId: r.id }, r.id);
  logEvent({ kind: "principle", text: `${agentName(agentId)} 的烙印『${r.text}』沉睡了`, actors: [agentId], importance: 2, data: { principleId: r.id } });
  metric("imprint_dormant", { principleId: r.id, why });
}

/** Make room after an imprint arrived or was reinforced; `keepId` is never the one put to sleep. */
export function enforceSlots(agentId: string, keepId?: number | null): void {
  const total = slotsOf(agentId);
  const now = simNow();
  let rows = active(agentId);
  while (rows.length > total) {
    const victim = rows.filter((r) => r.id !== keepId).sort((a, b) => lean(a, now) - lean(b, now))[0];
    if (!victim) return;
    sleep(agentId, victim, `记忆只放得下 ${total} 条，这一条我最久没用上，慢慢记不清了。`);
    rows = rows.filter((r) => r.id !== victim.id);
  }
}

export class ImprintError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** The guardian wakes a dormant imprint; if every slot is taken, `sleepId` names the one that goes to sleep instead. */
export function wakeImprint(agentId: string, id: number, sleepId?: number | null): void {
  const db = getDb();
  const target = db.prepare(`SELECT id, text, weight, last_cited_at, created_at FROM principles WHERE id = ? AND agent_id = ? AND ${SHAPED_SQL}`).get(id, agentId) as
    | Row
    | undefined;
  if (!target) throw new ImprintError("这条烙印不存在，或者不能被唤醒", 404);
  if (target.weight >= DORMANT_THRESHOLD) throw new ImprintError("这条烙印本来就醒着", 409);
  const rows = active(agentId);
  if (rows.length >= slotsOf(agentId)) {
    const other = rows.find((r) => r.id === sleepId);
    if (!other) throw new ImprintError("记忆已满：要唤醒它，得选一条让它沉睡", 409);
    sleep(agentId, other, "你让我先放下它，去记起另一条。");
  }
  const now = simNow();
  db.prepare("UPDATE principles SET weight = ?, last_cited_at = ?, last_decayed_at = ? WHERE id = ?").run(WAKE_WEIGHT, now, now, id);
  remember(agentId, "principle_woken", `你让我重新想起了『${target.text}』。`, { principleId: id }, id);
  logEvent({ kind: "principle", text: `你唤醒了沉睡的烙印『${target.text}』`, actors: [agentId], importance: 2, data: { principleId: id } });
  metric("imprint_woken", { principleId: id, slept: sleepId ?? null });
}

/** One more slot, paid in Scrip (burned). */
export function buySlot(agentId: string): { total: number; cost: number } {
  const db = getDb();
  const cost = nextSlotCost(agentId);
  if (cost === null) throw new ImprintError(`记忆最多 ${MAX_SLOTS} 格`, 409);
  const scrip = (db.prepare("SELECT scrip FROM agents WHERE id = ?").get(agentId) as { scrip: number }).scrip;
  if (scrip < cost) throw new ImprintError(`需要 ${cost} Scrip（现有 ${scrip}）`, 402);
  pay(agentId, -cost, "memory_slot");
  const total = slotsOf(agentId) + 1;
  db.prepare("UPDATE agents SET memory_slots = ? WHERE id = ?").run(total, agentId);
  remember(agentId, "memory_slot", `你花了 ${cost} Scrip，让我能多记住一条原则（现在 ${total} 条）。`, {});
  logEvent({ kind: "principle", text: `${agentName(agentId)} 的记忆多了一格（${total} 条）`, actors: [agentId], importance: 2 });
  metric("memory_slot_bought", { cost, total });
  return { total, cost };
}
