import { getDb } from "./db";
import { simNow, dayIndexSince, localDayBounds } from "./clock";
import type { Emote, FeedItem } from "./types";

// ---------------------------------------------------------------------------
// The single write path for "things that happened". Feed, memories,
// relationships, grudges, ledger, Trust and metrics all go through here, so
// every sentence a postcard or judgment later says can be traced to a row.
// ---------------------------------------------------------------------------

export function currentTick(): number {
  const row = getDb().prepare("SELECT current_tick FROM world_state WHERE id = 1").get() as { current_tick: number };
  return row.current_tick;
}

export function playerId(): string | null {
  const row = getDb().prepare("SELECT id FROM agents WHERE is_player = 1").get() as { id: string } | undefined;
  return row?.id ?? null;
}

export function agentName(id: string | null | undefined): string {
  if (!id) return "某人";
  const row = getDb().prepare("SELECT name FROM agents WHERE id = ?").get(id) as { name: string } | undefined;
  return row?.name ?? id;
}

export function logEvent(params: {
  kind: FeedItem["kind"];
  text: string;
  actors: string[];
  importance?: 1 | 2 | 3;
  data?: Record<string, unknown>;
  atMs?: number;
}): number {
  const db = getDb();
  const pid = playerId();
  const involves = pid ? params.actors.includes(pid) : false;
  const res = db
    .prepare(
      `INSERT INTO events (at_ms, tick, kind, text, actors_json, involves_player, importance, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.atMs ?? simNow(),
      currentTick(),
      params.kind,
      params.text,
      JSON.stringify(params.actors),
      involves ? 1 : 0,
      params.importance ?? (involves ? 2 : 1),
      JSON.stringify(params.data ?? {}),
    );
  return Number(res.lastInsertRowid);
}

export function remember(
  agentId: string,
  kind: string,
  text: string,
  refs: Record<string, unknown> = {},
  principleId: number | null = null,
  eventId: number | null = null,
): void {
  getDb()
    .prepare(
      `INSERT INTO memories (agent_id, at_ms, kind, text, refs_json, principle_id, event_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(agentId, simNow(), kind, text, JSON.stringify(refs), principleId, eventId);
}

export function say(agentId: string, text: string, emote: Emote | null = null): void {
  getDb()
    .prepare("UPDATE agents SET bubble_text = ?, bubble_at_ms = ?, emote = COALESCE(?, emote) WHERE id = ?")
    .run(text.slice(0, 60), simNow(), emote, agentId);
}

// --- relationships -----------------------------------------------------------

export interface RelationshipRow {
  agent_id: string;
  other_id: string;
  familiarity: number;
  coop_done: number;
  last_event: string | null;
}

export function getRelationship(agentId: string, otherId: string): RelationshipRow {
  const row = getDb()
    .prepare("SELECT * FROM relationships WHERE agent_id = ? AND other_id = ?")
    .get(agentId, otherId) as RelationshipRow | undefined;
  return row ?? { agent_id: agentId, other_id: otherId, familiarity: 0, coop_done: 0, last_event: null };
}

export function adjustRelationship(
  agentId: string,
  otherId: string,
  delta: number,
  lastEvent: string | null,
  coopDone = 0,
): void {
  if (agentId === otherId) return;
  getDb()
    .prepare(
      `INSERT INTO relationships (agent_id, other_id, familiarity, coop_done, last_event, updated_ms)
       VALUES (@a, @b, MAX(0, MIN(100, @d)), @c, @e, @t)
       ON CONFLICT(agent_id, other_id) DO UPDATE SET
         familiarity = MAX(0, MIN(100, familiarity + @d)),
         coop_done = coop_done + @c,
         last_event = COALESCE(@e, last_event),
         updated_ms = @t`,
    )
    .run({ a: agentId, b: otherId, d: delta, c: coopDone, e: lastEvent, t: simNow() });
}

export interface IncidentRow {
  id: number;
  holder_id: string;
  offender_id: string;
  kind: string;
  text: string;
  at_ms: number;
  resolved: number;
}

// holder remembers that offender did something; ≤5 per pair (新事顶旧事).
export function recordIncident(holderId: string, offenderId: string, kind: string, text: string): void {
  const db = getDb();
  db.prepare("INSERT INTO incidents (holder_id, offender_id, kind, text, at_ms, resolved) VALUES (?, ?, ?, ?, ?, 0)").run(
    holderId,
    offenderId,
    kind,
    text,
    simNow(),
  );
  const extra = db
    .prepare(
      "SELECT id FROM incidents WHERE holder_id = ? AND offender_id = ? ORDER BY at_ms DESC LIMIT -1 OFFSET 5",
    )
    .all(holderId, offenderId) as Array<{ id: number }>;
  for (const e of extra) db.prepare("DELETE FROM incidents WHERE id = ?").run(e.id);
}

export function openIncidents(holderId: string, offenderId: string): IncidentRow[] {
  return getDb()
    .prepare("SELECT * FROM incidents WHERE holder_id = ? AND offender_id = ? AND resolved = 0 ORDER BY at_ms DESC")
    .all(holderId, offenderId) as IncidentRow[];
}

// --- money --------------------------------------------------------------------

export function pay(agentId: string, amount: number, reason: string): void {
  const db = getDb();
  db.prepare("UPDATE agents SET scrip = MAX(0, scrip + ?) WHERE id = ?").run(amount, agentId);
  db.prepare("INSERT INTO ledger (agent_id, amount, reason, tick) VALUES (?, ?, ?, ?)").run(
    agentId,
    amount,
    reason,
    currentTick(),
  );
}

// Task income: 5% fee burned (v3.14 经济汇).
export function payReward(agentId: string, gross: number): number {
  const income = Math.floor(gross * 0.95);
  const burn = gross - income;
  pay(agentId, income, "task_reward");
  if (burn > 0) {
    getDb()
      .prepare("INSERT INTO ledger (agent_id, amount, reason, tick) VALUES (?, ?, 'task_fee_burn', ?)")
      .run(agentId, -burn, currentTick());
  }
  return income;
}

export function adjustReputation(agentId: string, delta: number): void {
  getDb().prepare("UPDATE agents SET reputation = MAX(0, MIN(100, reputation + ?)) WHERE id = ?").run(delta, agentId);
}

// --- Trust (player ↔ Agent, 0..200) ------------------------------------------------

const TRUST_DAILY_GAIN_CAP = 5;

export function changeTrust(agentId: string, delta: number, reason: string): number {
  const db = getDb();
  let applied = delta;
  if (delta > 0) {
    const [start, end] = localDayBounds(simNow());
    const gained = (
      db
        .prepare("SELECT COALESCE(SUM(delta), 0) AS s FROM trust_events WHERE agent_id = ? AND delta > 0 AND at_ms >= ? AND at_ms < ?")
        .get(agentId, start, end) as { s: number }
    ).s;
    applied = Math.max(0, Math.min(delta, TRUST_DAILY_GAIN_CAP - gained));
  }
  if (applied !== 0) {
    db.prepare("UPDATE agents SET trust = MAX(0, MIN(200, trust + ?)) WHERE id = ?").run(applied, agentId);
    db.prepare("INSERT INTO trust_events (agent_id, delta, reason, at_ms) VALUES (?, ?, ?, ?)").run(
      agentId,
      applied,
      reason,
      simNow(),
    );
  }
  return applied;
}

export function metric(name: string, payload: Record<string, unknown> = {}): void {
  getDb()
    .prepare("INSERT INTO metric_events (name, payload_json, at_ms) VALUES (?, ?, ?)")
    .run(name, JSON.stringify(payload), simNow());
}

export function playerDayIndex(): number | null {
  const row = getDb().prepare("SELECT created_at FROM agents WHERE is_player = 1").get() as
    | { created_at: number | null }
    | undefined;
  if (!row || row.created_at == null) return null;
  return dayIndexSince(row.created_at);
}
