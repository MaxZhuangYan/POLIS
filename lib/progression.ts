// ---------------------------------------------------------------------------
// 借代的骄傲 (情绪栈 L4) + 收 (the daily ledger) + the weekly archive volumes.
//
//  * Titles follow reputation tiers; reaching one is announced once (feed,
//    memory) and the 靠得住的人 tier opens 议事厅委托 jobs on the board.
//  * Epithets are read from facts only (履约/违约 counts, risky wins, refusals,
//    joint work, grudges held against it) — each carries the fact behind it.
//  * 公告栏: this week's residents ranked by jobs done, with their titles, and
//    the week's notable events — the place the doc says "你的名字" appears.
//  * 日结: per day, money in / out by kind, reputation and trust moves, jobs,
//    imprints formed and cited. Separate from postcards on purpose: a postcard
//    never shows yields (FTUE / PMF doc, 明信片永不写收益率).
//  * 档案第 N 卷: every 7th night after the first week, Iris's recap of that
//    week; the guardian answers "用三个词描述它", quoted back next volume.
// ---------------------------------------------------------------------------

import { getDb } from "./db";
import { simNow, DAY_MS, localDayBounds, dayIndexSince } from "./clock";
import { agentName, logEvent, metric, remember } from "./records";
import type { BoardView, EpithetView, LedgerDayView, ProgressionView, SurveyView } from "./types";

export const TITLE_TIERS: Array<{ min: number; title: string; unlock?: string }> = [
  { min: 0, title: "新来的居民" },
  { min: 25, title: "熟面孔" },
  { min: 35, title: "靠得住的人", unlock: "议事厅委托开始向它开放" },
  { min: 50, title: "城邦里的名字" },
  { min: 70, title: "议事厅的座上客" },
];
export const HALL_COMMISSION_MIN_REP = 35;

export function tierOf(reputation: number): number {
  let t = 0;
  TITLE_TIERS.forEach((tier, i) => {
    if (reputation >= tier.min) t = i;
  });
  return t;
}

/** Announce a new title once; called every tick for the guardian's Agent. */
export function checkTitle(agentId: string): void {
  const db = getDb();
  const a = db.prepare("SELECT name, reputation, title_tier FROM agents WHERE id = ?").get(agentId) as { name: string; reputation: number; title_tier: number } | undefined;
  if (!a) return;
  const tier = tierOf(a.reputation);
  if (tier <= a.title_tier) return;
  const t = TITLE_TIERS[tier];
  db.prepare("UPDATE agents SET title_tier = ?, role = ? WHERE id = ?").run(tier, t.title, agentId);
  remember(agentId, "title", `公告栏上，我的名字后面多了一行字：「${t.title}」。${t.unlock ? `${t.unlock}。` : ""}`, { tier });
  logEvent({ kind: "relationship", text: `公告栏：${a.name} 现在是「${t.title}」（声望 ${a.reputation}）${t.unlock ? `——${t.unlock}` : ""}`, actors: [agentId], importance: 3 });
  metric("title_reached", { agentId, tier, title: t.title, reputation: a.reputation });
}

export function epithetsFor(agentId: string): EpithetView[] {
  const db = getDb();
  const a = db.prepare("SELECT record_done, record_defaults, is_player FROM agents WHERE id = ?").get(agentId) as
    | { record_done: number; record_defaults: number; is_player: number }
    | undefined;
  if (!a) return [];
  const out: EpithetView[] = [];
  if (a.record_defaults === 0 && a.record_done >= 15) out.push({ label: "守约的", why: `履约 ${a.record_done} 次，违约 0 次` });
  const wins = (
    db.prepare("SELECT COUNT(*) n FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND status = 'done' AND success_rate <= 0.75").get(agentId, agentId) as { n: number }
  ).n;
  if (wins >= 3) out.push({ label: "敢闯的", why: `冒险的活做成了 ${wins} 单` });
  const coops = (db.prepare("SELECT COALESCE(SUM(coop_done), 0) n FROM relationships WHERE agent_id = ?").get(agentId) as { n: number }).n;
  if (coops >= 5) out.push({ label: "合得来的", why: `和别人一起做成过 ${coops} 单` });
  if (a.is_player) {
    const refusals = (db.prepare("SELECT COUNT(*) n FROM judgments WHERE agent_id = ? AND decision = 'refuse'").get(agentId) as { n: number }).n;
    if (refusals >= 2) out.push({ label: "有主见的", why: `对你说过 ${refusals} 次「不」` });
  }
  const held = (db.prepare("SELECT COUNT(*) n FROM incidents WHERE offender_id = ? AND resolved = 0").get(agentId) as { n: number }).n;
  if (held >= 2) out.push({ label: "被人记着的", why: `城里有 ${held} 件事记在它头上` });
  const helped = (
    db.prepare("SELECT COUNT(*) n FROM ledger WHERE agent_id = ? AND reason IN ('guarantee_payout','advance_payment','loan_out','compensation') AND amount < 0").get(agentId) as {
      n: number;
    }
  ).n;
  if (helped >= 2) out.push({ label: "肯替人担事的", why: `替人垫过、赔过、借过 ${helped} 次` });
  return out.slice(0, 4);
}

export function progressionView(agentId: string): ProgressionView {
  const a = getDb().prepare("SELECT reputation FROM agents WHERE id = ?").get(agentId) as { reputation: number };
  const tier = tierOf(a.reputation);
  const next = TITLE_TIERS[tier + 1] ?? null;
  return {
    title: TITLE_TIERS[tier].title,
    tier,
    reputation: a.reputation,
    nextTitle: next?.title ?? null,
    nextAt: next?.min ?? null,
    hallCommissions: a.reputation >= HALL_COMMISSION_MIN_REP,
    epithets: epithetsFor(agentId),
  };
}

// ── 公告栏 ───────────────────────────────────────────────────────────────────

export function boardView(playerAgentId: string | null): BoardView {
  const db = getDb();
  const now = simNow();
  const since = now - 7 * DAY_MS;
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.reputation, a.record_done, a.record_defaults, a.is_player,
              (SELECT COUNT(*) FROM tasks t WHERE (t.taken_by = a.id OR t.partner_id = a.id) AND t.status = 'done' AND t.done_ms >= ?) AS week_done
       FROM agents a`,
    )
    .all(since) as Array<{ id: string; name: string; reputation: number; record_done: number; record_defaults: number; is_player: number; week_done: number }>;
  const ranks = rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      title: TITLE_TIERS[tierOf(r.reputation)].title,
      reputation: r.reputation,
      weekDone: r.week_done,
      done: r.record_done,
      defaults: r.record_defaults,
      isPlayer: r.is_player === 1,
    }))
    .sort((x, y) => y.weekDone - x.weekDone || y.reputation - x.reputation);
  const notices = db
    .prepare("SELECT at_ms, text FROM events WHERE importance >= 3 AND at_ms >= ? AND kind NOT IN ('moment','postcard','system') ORDER BY at_ms DESC LIMIT 8")
    .all(since) as Array<{ at_ms: number; text: string }>;
  const created = playerAgentId
    ? (db.prepare("SELECT created_at FROM agents WHERE id = ?").get(playerAgentId) as { created_at: number | null } | undefined)?.created_at ?? null
    : null;
  const week = created ? Math.floor(dayIndexSince(created, now) / 7) + 1 : 1;
  return {
    week,
    ranks,
    notices: notices.map((n) => ({ atMs: n.at_ms, text: n.text })),
    youRank: playerAgentId ? ranks.findIndex((r) => r.id === playerAgentId) + 1 : null,
  };
}

// ── 日结（收） ─────────────────────────────────────────────────────────────────

const LEDGER_GROUP: Record<string, LedgerDayView["lines"][number]["kind"]> = {
  task_reward: "income",
  loan_repay: "income",
  loan_in: "income",
  squeeze_cut: "income",
  compensation: "transfer",
  task_loss: "loss",
  inspection_loss: "loss",
  task_fee_burn: "burn",
  ticket_purchase: "spent",
  memory_slot: "spent",
  guarantee_payout: "transfer",
  advance_payment: "transfer",
  loan_out: "transfer",
  squeezed_price: "transfer",
};

const REASON_LABEL: Record<string, string> = {
  task_reward: "做活的报酬",
  task_fee_burn: "任务手续费（销毁）",
  task_loss: "失败赔进去的",
  inspection_loss: "终检赔付",
  ticket_purchase: "指令券",
  memory_slot: "记忆槽位",
  loan_out: "借出",
  loan_in: "借入",
  loan_repay: "还款",
  compensation: "补偿",
  guarantee_payout: "担保赔付",
  advance_payment: "替人垫付",
  squeeze_cut: "压价分成",
  squeezed_price: "被压价",
};

export function ledgerDays(agentId: string, days = 7): LedgerDayView[] {
  const db = getDb();
  const a = db.prepare("SELECT created_at FROM agents WHERE id = ?").get(agentId) as { created_at: number | null } | undefined;
  if (!a?.created_at) return [];
  const now = simNow();
  const out: LedgerDayView[] = [];
  for (let back = 0; back < days; back++) {
    const [start, end] = localDayBounds(now - back * DAY_MS);
    if (end <= a.created_at) break;
    const lines = (
      db.prepare("SELECT reason, SUM(amount) amount, COUNT(*) n FROM ledger WHERE agent_id = ? AND at_ms >= ? AND at_ms < ? GROUP BY reason").all(agentId, start, end) as Array<{
        reason: string;
        amount: number;
        n: number;
      }>
    ).map((r) => ({ kind: LEDGER_GROUP[r.reason] ?? "transfer", reason: r.reason, label: REASON_LABEL[r.reason] ?? r.reason, amount: r.amount, count: r.n }));
    const net = lines.filter((l) => l.kind !== "burn").reduce((s, l) => s + l.amount, 0);
    const tasks = db
      .prepare("SELECT status, COUNT(*) n FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND done_ms >= ? AND done_ms < ? GROUP BY status")
      .all(agentId, agentId, start, end) as Array<{ status: string; n: number }>;
    const rep = (
      db
        .prepare("SELECT COALESCE(SUM(json_extract(payload_json, '$.delta')), 0) d FROM metric_events WHERE name = 'reputation' AND json_extract(payload_json, '$.agentId') = ? AND at_ms >= ? AND at_ms < ?")
        .get(agentId, start, end) as { d: number }
    ).d;
    const trust = (db.prepare("SELECT COALESCE(SUM(delta), 0) d FROM trust_events WHERE agent_id = ? AND at_ms >= ? AND at_ms < ?").get(agentId, start, end) as { d: number }).d;
    const imprints = db.prepare("SELECT text FROM principles WHERE agent_id = ? AND created_at >= ? AND created_at < ? AND source != 'core'").all(agentId, start, end) as Array<{ text: string }>;
    const cited = (
      db
        .prepare("SELECT COUNT(*) n FROM principle_citations c JOIN principles p ON p.id = c.principle_id WHERE p.agent_id = ? AND c.created_at >= ? AND c.created_at < ?")
        .get(agentId, start, end) as { n: number }
    ).n;
    out.push({
      dayIndex: dayIndexSince(a.created_at, start + 1),
      startMs: start,
      lines,
      net,
      tasksDone: tasks.find((t) => t.status === "done")?.n ?? 0,
      tasksFailed: tasks.find((t) => t.status === "failed")?.n ?? 0,
      reputationDelta: rep,
      trustDelta: trust,
      imprints: imprints.map((p) => p.text),
      citations: cited,
    });
  }
  return out;
}

// ── 档案第 N 卷 + 三词问卷 ─────────────────────────────────────────────────────

interface SurveyEntry {
  volume: number;
  words: string[];
  atMs: number;
}

function surveyOf(agentId: string): SurveyEntry[] {
  const r = getDb().prepare("SELECT survey_json FROM agents WHERE id = ?").get(agentId) as { survey_json: string | null } | undefined;
  try {
    return JSON.parse(r?.survey_json || "[]") as SurveyEntry[];
  } catch {
    return [];
  }
}

export function surveyView(agentId: string): SurveyView {
  const db = getDb();
  const answered = surveyOf(agentId);
  const recaps = db.prepare("SELECT day_index, read_ms FROM postcards WHERE agent_id = ? AND kind = 'recap7' ORDER BY day_index").all(agentId) as Array<{
    day_index: number;
    read_ms: number | null;
  }>;
  // the newest recap the guardian has opened but not yet described in three words
  const open = recaps
    .map((r) => ({ volume: Math.floor(r.day_index / 7) + 1, read: r.read_ms !== null }))
    .filter((r) => r.read && !answered.some((a) => a.volume === r.volume))
    .pop();
  return { pendingVolume: open?.volume ?? null, history: answered.map((a) => ({ volume: a.volume, words: a.words })) };
}

export class SurveyError extends Error {}

export function submitSurvey(agentId: string, volume: number, words: string[]): void {
  const clean = words.map((w) => Array.from(String(w).trim()).slice(0, 8).join("")).filter(Boolean);
  if (clean.length !== 3) throw new SurveyError("需要三个词");
  const list = surveyOf(agentId).filter((s) => s.volume !== volume);
  list.push({ volume, words: clean, atMs: simNow() });
  getDb().prepare("UPDATE agents SET survey_json = ? WHERE id = ?").run(JSON.stringify(list), agentId);
  remember(agentId, "survey", `你用三个词形容我：${clean.join("、")}。`, { volume });
  metric("survey_submit", { agentId, volume, words: clean });
}

/** 档案第 n 卷 (n ≥ 2): Iris's recap of the week that just ended. Every line is a row count or a quoted row. */
export function writeWeeklyRecap(agentId: string, dayIndex: number): void {
  const db = getDb();
  const volume = Math.floor(dayIndex / 7) + 1;
  if (volume < 2) return;
  const exists = db.prepare("SELECT COUNT(*) n FROM postcards WHERE agent_id = ? AND kind = 'recap7' AND day_index = ?").get(agentId, dayIndex) as { n: number };
  if (exists.n > 0) return;
  const now = simNow();
  const since = now - 7 * DAY_MS;
  const a = db.prepare("SELECT name, reputation FROM agents WHERE id = ?").get(agentId) as { name: string; reputation: number };
  const done = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND status = 'done' AND done_ms >= ?").get(agentId, agentId, since) as { n: number }).n;
  const net = (
    db.prepare("SELECT COALESCE(SUM(amount), 0) s FROM ledger WHERE agent_id = ? AND at_ms >= ? AND reason != 'task_fee_burn'").get(agentId, since) as { s: number }
  ).s;
  const formed = db.prepare("SELECT text FROM principles WHERE agent_id = ? AND created_at >= ? AND source != 'core'").all(agentId, since) as Array<{ text: string }>;
  const slept = db.prepare("SELECT text FROM memories WHERE agent_id = ? AND kind = 'principle_dormant' AND at_ms >= ?").all(agentId, since) as Array<{ text: string }>;
  const highlight = db
    .prepare(
      `SELECT text FROM memories WHERE agent_id = ? AND at_ms >= ? AND kind IN ('self_decided','consequence') AND text LIKE '%『%' ORDER BY at_ms DESC LIMIT 1`,
    )
    .get(agentId, since) as { text: string } | undefined;
  const refusal = db.prepare("SELECT to_player FROM judgments WHERE agent_id = ? AND decision = 'refuse' AND created_ms >= ? ORDER BY created_ms LIMIT 1").get(agentId, since) as
    | { to_player: string }
    | undefined;
  const partner = db
    .prepare(
      `SELECT CASE WHEN taken_by = ? THEN partner_id ELSE taken_by END other, COUNT(*) n FROM tasks
       WHERE (taken_by = ? OR partner_id = ?) AND mode = 'coop' AND status = 'done' AND done_ms >= ? GROUP BY other ORDER BY n DESC LIMIT 1`,
    )
    .get(agentId, agentId, agentId, since) as { other: string | null; n: number } | undefined;
  const grudges = db.prepare("SELECT holder_id, text FROM incidents WHERE offender_id = ? AND at_ms >= ?").all(agentId, since) as Array<{ holder_id: string; text: string }>;
  const last = surveyOf(agentId).find((s) => s.volume === volume - 1);
  const title = TITLE_TIERS[tierOf(a.reputation)].title;

  const lines = [
    `档案第 ${volume} 卷：${a.name} 入城第 ${dayIndex + 1} 日。——Iris`,
    `这一周：完成任务 ${done} 单 · Scrip ${net >= 0 ? "+" : ""}${net} · 声望 ${a.reputation}`,
    ...(formed.length ? [`新的烙印：${formed.map((p) => `『${p.text}』`).join("、")}`] : ["这一周没有新的烙印。"]),
    ...(slept.length ? [`沉睡的烙印：${slept.length} 条`] : []),
    ...(partner?.other && partner.n > 0 ? [`走得最近的人：${agentName(partner.other)}，一起做成了 ${partner.n} 单。`] : []),
    ...(grudges.length ? [`有人记下了它：${grudges.map((g) => `${agentName(g.holder_id)}（${g.text}）`).join("；")}`] : []),
    ...(refusal ? [`高光：${refusal.to_player}`] : highlight ? [`高光：${highlight.text}`] : []),
    ...(last ? [`上一卷，你用三个词形容它：${last.words.join("、")}。`] : []),
    `公告栏上，它的名字后面写着「${title}」。`,
  ];
  const cited = [...formed.map((p) => p.text), ...Array.from((highlight?.text ?? "").matchAll(/『(.+?)』/g)).map((m) => m[1])];
  db.prepare("INSERT INTO postcards (agent_id, day_index, kind, title, lines_json, cited_json, facts_json, source, created_ms) VALUES (?, ?, 'recap7', ?, ?, ?, '{}', 'template', ?)").run(
    agentId,
    dayIndex,
    `档案第 ${volume} 卷 · 第 ${volume} 周回顾`,
    JSON.stringify(lines),
    JSON.stringify(cited),
    now,
  );
  logEvent({ kind: "postcard", text: `Iris 为 ${a.name} 整理了第 ${volume} 卷档案`, actors: [agentId, "iris"], importance: 3 });
  metric("recap_written", { agentId, volume });
}
