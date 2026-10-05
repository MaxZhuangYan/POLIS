import { getDb } from "./db";
import { simNow, getOffsetMs, isTestMode, worldTz, localParts, clockLabel, dayIndexSince, HOUR_MS, hourStart, nextLocalHour } from "./clock";
import { NPC_BY_ID, NPCS } from "./content";
import { getRelationship, playerId } from "./records";
import { DORMANT_THRESHOLD } from "./principleEngine";
import { notesLeftToday, recentNotes } from "./notes";
import { distillingCount } from "./distillation";
import { llmStatusLabel } from "./llm";
import { parseOptions, type MomentRow } from "./decisionMoments";
import type { JudgmentRow } from "./autonomy";
import type {
  ActivityKind,
  AgentView,
  Emote,
  FeedItem,
  GameSnapshot,
  JudgmentView,
  LocationId,
  MemoryView,
  MomentView,
  PostcardView,
  PrincipleView,
  RelationshipView,
} from "./types";

// Builds the one read model the client renders. Pure reads.

interface AgentDbRow {
  id: string;
  name: string;
  role: string;
  sprite: string;
  is_player: number;
  personality: string;
  current_location: string;
  home_slot: number;
  activity: string;
  activity_text: string;
  reason_text: string | null;
  travel_from: string | null;
  travel_to: string | null;
  travel_start_ms: number | null;
  travel_end_ms: number | null;
  partner_id: string | null;
  current_task_id: number | null;
  emote: string | null;
  bubble_text: string | null;
  bubble_at_ms: number | null;
  scrip: number;
  reputation: number;
  trust: number;
  created_at: number | null;
  onboarding: string;
}

const VALID_LOC = new Set<LocationId>(["archive", "market", "plaza", "workshop", "outskirts", "mediation", "hall", "board", "gate", "home"]);

function toAgentView(r: AgentDbRow, now: number): AgentView {
  const loc = (VALID_LOC.has(r.current_location as LocationId) ? r.current_location : "plaza") as LocationId;
  const traveling = r.travel_end_ms != null && r.travel_end_ms > now && r.travel_from && r.travel_to;
  let progress: number | null = null;
  let taskName: string | null = null;
  if (r.current_task_id) {
    const t = getDb().prepare("SELECT name, progress, duration, quality FROM tasks WHERE id = ?").get(r.current_task_id) as
      | { name: string; progress: number; duration: number; quality: string | null }
      | undefined;
    if (t) {
      taskName = t.name;
      const due = t.quality === "shortcut" ? Math.max(1, t.duration - 1) : t.duration;
      const intoHour = Math.max(0, Math.min(1, (now - hourStart(now)) / HOUR_MS));
      progress = Math.max(0, Math.min(1, (t.progress + intoHour) / due));
    }
  }
  const prof = NPC_BY_ID[r.id];
  return {
    id: r.id,
    name: r.name,
    role: r.is_player ? (r.role && r.role !== "你守护的 Agent" ? r.role : "新来的居民") : r.role || prof?.role || "",
    sprite: r.sprite || prof?.sprite || "rookie",
    isPlayer: !!r.is_player,
    personality: r.personality,
    location: r.is_player && r.onboarding !== "done" ? "gate" : loc,
    homeSlot: r.home_slot ?? 0,
    activity: (r.activity as ActivityKind) || "idle",
    activityText: r.activity_text || "",
    reason: r.reason_text,
    progress,
    travel: traveling ? { from: r.travel_from as LocationId, to: r.travel_to as LocationId, startMs: r.travel_start_ms!, endMs: r.travel_end_ms! } : null,
    partnerId: r.partner_id,
    taskName,
    emote: (r.emote as Emote) ?? null,
    bubble: r.bubble_text && r.bubble_at_ms ? { text: r.bubble_text, atMs: r.bubble_at_ms } : null,
    scrip: r.scrip,
    reputation: r.reputation,
  };
}

function momentView(m: MomentRow): MomentView {
  return {
    id: m.id,
    type: m.type,
    templateId: m.template_id,
    speakerId: m.speaker_id ?? m.counterparty_id,
    promptText: m.prompt_text,
    facts: JSON.parse(m.facts_json || "[]"),
    options: parseOptions(m).map((o) => ({ id: o.id, label: o.label })),
    createdAtMs: m.created_at,
    expiresAtMs: m.expires_at,
    escalation: m.escalation,
  };
}

function judgmentView(j: JudgmentRow, scrip: number): JudgmentView {
  const db = getDb();
  const m = db.prepare("SELECT * FROM decision_moments WHERE id = ?").get(j.moment_id) as MomentRow;
  const options = parseOptions(m);
  const ctx = JSON.parse(m.context_json || "{}") as { adjust?: { label: string } };
  const p = j.cited_principle_id ? (db.prepare("SELECT id, text FROM principles WHERE id = ?").get(j.cited_principle_id) as { id: number; text: string } | undefined) : undefined;
  return {
    id: j.id,
    momentId: j.moment_id,
    decision: j.decision,
    chosenLabel: options.find((o) => o.id === j.chosen_option)?.label ?? j.chosen_option,
    adjustLabel: j.decision === "adjust" ? ctx.adjust?.label ?? null : j.decision === "refuse" ? options.find((o) => o.id === j.alt_option)?.label ?? null : null,
    toPlayer: j.to_player,
    citedPrinciple: p ? { id: p.id, text: p.text } : null,
    reasons: JSON.parse(j.reasons_json || "[]"),
    forceCost: 30,
    canForce: j.decision === "refuse" && scrip >= 30,
    source: j.source,
    status: j.status,
  };
}

export function buildSnapshot(): GameSnapshot {
  const db = getDb();
  const now = simNow();
  const tz = worldTz();
  const parts = localParts(now, tz);
  const ws = db.prepare("SELECT current_tick, last_tick_ms FROM world_state WHERE id = 1").get() as { current_tick: number; last_tick_ms: number | null };
  const rows = db.prepare("SELECT * FROM agents ORDER BY is_player DESC, id").all() as AgentDbRow[];
  const npcOrder = new Map(NPCS.map((n, i) => [n.id, i]));
  rows.sort((a, b) => b.is_player - a.is_player || (npcOrder.get(a.id) ?? 99) - (npcOrder.get(b.id) ?? 99));
  const agents = rows.map((r) => toAgentView(r, now));
  const pid = playerId();
  const player = pid ? rows.find((r) => r.id === pid)! : null;
  const created = player?.created_at ?? null;

  const feedRows = db
    .prepare("SELECT * FROM events WHERE at_ms <= ? ORDER BY at_ms DESC, id DESC LIMIT 40")
    .all(now) as Array<{ id: number; at_ms: number; kind: FeedItem["kind"]; text: string; actors_json: string; involves_player: number; importance: number }>;
  const feed: FeedItem[] = feedRows.map((e) => ({
    id: e.id,
    atMs: e.at_ms,
    dayIndex: created != null ? dayIndexSince(created, e.at_ms, tz) : null,
    clock: clockLabel(e.at_ms, tz),
    kind: e.kind,
    text: e.text,
    actors: JSON.parse(e.actors_json),
    involvesPlayer: !!e.involves_player,
    importance: Math.max(1, Math.min(3, e.importance)) as 1 | 2 | 3,
  }));

  const nextTick = (ws.last_tick_ms ?? hourStart(now)) + HOUR_MS;
  const snapshot: GameSnapshot = {
    world: {
      simNowMs: now,
      realNowMs: Date.now(),
      offsetMs: getOffsetMs(),
      testMode: isTestMode(),
      tz,
      hour: parts.hour,
      minute: parts.minute,
      tick: ws.current_tick,
      nextTickAtMs: Math.max(nextTick, now),
      isNight: parts.hour >= 22 || parts.hour < 6,
      llm: llmStatusLabel(),
    },
    agents,
    feed,
    player: null,
  };
  if (!player || !pid) return snapshot;

  const principles: PrincipleView[] = (
    db.prepare("SELECT * FROM principles WHERE agent_id = ? AND source != 'core' ORDER BY created_at").all(pid) as Array<{
      id: number;
      text: string;
      domain: PrincipleView["domain"];
      weight: number;
      source: PrincipleView["source"];
      origin_text: string | null;
      created_at: number;
      last_cited_at: number | null;
    }>
  ).map((p) => ({
    id: p.id,
    text: p.text,
    domain: p.domain,
    weight: p.weight,
    source: p.source,
    origin: p.origin_text ?? "",
    createdAtMs: p.created_at,
    citedCount: (db.prepare("SELECT COUNT(*) n FROM principle_citations WHERE principle_id = ?").get(p.id) as { n: number }).n,
    lastCitedAtMs: p.last_cited_at,
    dormant: p.weight < DORMANT_THRESHOLD,
  }));

  const pending = db.prepare("SELECT * FROM decision_moments WHERE agent_id = ? AND status = 'pending' ORDER BY created_at, id").all(pid) as MomentRow[];
  const pj = db.prepare("SELECT * FROM judgments WHERE agent_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(pid) as JudgmentRow | undefined;
  const rj = db
    .prepare("SELECT * FROM judgments WHERE agent_id = ? AND status != 'pending' AND decision != 'execute' AND feedback IS NULL ORDER BY id DESC LIMIT 1")
    .get(pid) as JudgmentRow | undefined;
  const wav = db.prepare("SELECT w.id, w.principle_id, w.prompt_text, p.text FROM wavering_events w JOIN principles p ON p.id = w.principle_id WHERE w.agent_id = ? AND w.status = 'pending' ORDER BY w.id LIMIT 1").get(pid) as
    | { id: number; principle_id: number; prompt_text: string; text: string }
    | undefined;

  const postcards: PostcardView[] = (
    db.prepare("SELECT * FROM postcards WHERE agent_id = ? ORDER BY created_ms DESC LIMIT 20").all(pid) as Array<{
      id: number;
      day_index: number;
      kind: PostcardView["kind"];
      title: string;
      lines_json: string;
      cited_json: string;
      source: PostcardView["source"];
      created_ms: number;
      read_ms: number | null;
    }>
  ).map((c) => ({
    id: c.id,
    dayIndex: c.day_index,
    kind: c.kind,
    title: c.title,
    lines: JSON.parse(c.lines_json),
    citedPrinciples: JSON.parse(c.cited_json),
    source: c.source,
    createdAtMs: c.created_ms,
    read: c.read_ms != null,
  }));

  const relationships: RelationshipView[] = NPCS.map((n) => {
    const rel = getRelationship(pid, n.id);
    const theirs = getRelationship(n.id, pid);
    const incidents = (
      db
        .prepare("SELECT text, at_ms, holder_id FROM incidents WHERE ((holder_id = ? AND offender_id = ?) OR (holder_id = ? AND offender_id = ?)) AND resolved = 0 ORDER BY at_ms DESC LIMIT 5")
        .all(pid, n.id, n.id, pid) as Array<{ text: string; at_ms: number; holder_id: string }>
    ).map((i) => ({ text: i.holder_id === pid ? `我记着：${n.name} ${i.text}` : `${n.name} 记着你：${i.text}`, atMs: i.at_ms }));
    return {
      otherId: n.id,
      familiarity: Math.round((rel.familiarity + theirs.familiarity) / 2),
      incidents,
      coopDone: rel.coop_done,
      lastEvent: theirs.last_event ?? rel.last_event,
    };
  });

  const memories: MemoryView[] = (
    db.prepare("SELECT id, at_ms, kind, text FROM memories WHERE agent_id = ? AND at_ms <= ? ORDER BY at_ms DESC, id DESC LIMIT 40").all(pid, now) as Array<{
      id: number;
      at_ms: number;
      kind: string;
      text: string;
    }>
  ).map((m) => ({ id: m.id, atMs: m.at_ms, clock: clockLabel(m.at_ms, tz), text: m.text, kind: m.kind }));

  const doneCount = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND status = 'done'").get(pid, pid) as { n: number }).n;

  snapshot.player = {
    agent: agents.find((a) => a.id === pid)!,
    trust: player.trust,
    createdAtMs: created ?? now,
    dayIndex: created != null ? dayIndexSince(created, now, tz) : 0,
    principles,
    pendingMoments: pending.map(momentView),
    pendingJudgment: pj ? judgmentView(pj, player.scrip) : null,
    recentJudgment: rj ? judgmentView(rj, player.scrip) : null,
    pendingWavering: wav ? { id: wav.id, principleId: wav.principle_id, principleText: wav.text, promptText: wav.prompt_text } : null,
    notes: {
      leftToday: notesLeftToday(pid),
      items: recentNotes(pid).map((n) => ({ id: n.id, text: n.text, createdAtMs: n.created_ms, kind: n.kind, status: n.status, reply: n.reply })),
    },
    postcards: { unread: postcards.filter((c) => !c.read).length, items: postcards },
    relationships,
    memories,
    distilling: distillingCount(),
    onboarding: (player.onboarding as "forks" | "imprint" | "done") ?? "done",
    stats: { tasksDone: doneCount, scripDelta: player.scrip - 100, reputationDelta: player.reputation - 20 },
    nextPostcardAtMs: nextLocalHour(23, now - 1, tz),
  };
  return snapshot;
}
