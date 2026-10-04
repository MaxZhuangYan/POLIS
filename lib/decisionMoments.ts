import { getDb } from "./db";
import { simNow, DAY_MS, HOUR_MS, localDayBounds, dayIndexSince, localParts, worldTz } from "./clock";
import { TEMPLATE_BY_ID, LOCATION_NAMES, NPC_BY_ID, type TaskTemplate } from "./content";
import {
  agentName,
  adjustRelationship,
  getRelationship,
  logEvent,
  metric,
  openIncidents,
  pay,
  playerDayIndex,
  remember,
  say,
} from "./records";
import { getTopPrinciples, logCitation, type PrincipleRow } from "./principleEngine";
import { applyQuality, createCoop, createTask, getTask, scheduleEvent, setTaskMeta, type TaskMeta } from "./tasks";
import type { Domain } from "./types";

// ---------------------------------------------------------------------------
// Decision Moments (岔路) — the Agent turning to its guardian.
//
// v1.5 §7: a Moment exists only when the Agent CANNOT decide by itself:
//   ① its principles conflict, ② the stakes are high, ③ relationship
//   history contradicts the situation — or it simply has no principle yet.
// Otherwise it decides alone, cites the principle, and the postcard says
// "今天我自己拿了个主意…".
//
// FTUE 铁律 1 (节奏脚本化，内容涌现化): the beats are scripted (D1 forks, D2
// citation, D3 risk fallback, D5 bait); the actors, numbers and histories in
// every Moment come from live rows (open tasks, public records, grudges).
//
// Every option carries a stance (which way it pushes the Agent once
// distilled) and an effect (what actually happens in the world when it is
// executed). Effects are applied only after the autonomy engine has judged
// the guardian's choice (lib/autonomy.ts).
//
// Time: all fields are simNow() wall-clock ms (Build Decision ④) — 24h
// expiry, the 4h interval and the 1-3/day cap move with the labelled test
// fast-forward, never with tick counts.
// ---------------------------------------------------------------------------

const MOMENT_TTL_MS = DAY_MS;
const MIN_INTERVAL_MS = 4 * HOUR_MS;
const MAX_PENDING = 3;
const MAX_PER_DAY = 3;

export type Effect =
  | {
      kind: "coop";
      template: string;
      partner: string;
      name?: string;
      reward?: number;
      duration?: number;
      meta?: TaskMeta;
      soloForPartnerOnDecline?: boolean;
    }
  | {
      kind: "take";
      taskId?: number;
      template?: string;
      name?: string;
      reward?: number;
      duration?: number;
      successRate?: number;
      quality?: "normal" | "shortcut" | "rushed";
      receiver?: string;
      meta?: TaskMeta;
    }
  | { kind: "decline"; npc?: string; memory: string; npcSolo?: { template: string; name?: string; reward?: number } }
  | { kind: "lend"; to: string; amount: number }
  | { kind: "repair"; to: string; how: "apologize" | "compensate" | "let_go"; amount?: number }
  | { kind: "none"; memory?: string };

export interface MomentOption {
  id: string;
  label: string;
  fallbackPrinciple: string;
  stance: { domain: Domain; dir: number };
  effect: Effect;
}

export interface MomentRow {
  id: number;
  agent_id: string;
  type: Domain;
  template_id: string;
  prompt_text: string;
  options_json: string;
  counterparty_id: string | null;
  created_at: number;
  expires_at: number;
  status: string;
  player_choice: string | null;
  autonomous_choice: string | null;
  speaker_id: string | null;
  facts_json: string;
  escalation: string | null;
  context_json: string;
  judgment_id: number | null;
}

export interface MomentContext {
  origin?: string;
  adjust?: { optionId?: string; label: string; effect?: Effect };
  urgent?: boolean;
  bait?: boolean;
  [k: string]: unknown;
}

export function parseOptions(row: Pick<MomentRow, "options_json">): MomentOption[] {
  return JSON.parse(row.options_json) as MomentOption[];
}

export function parseContext(row: Pick<MomentRow, "context_json">): MomentContext {
  try {
    return JSON.parse(row.context_json || "{}") as MomentContext;
  } catch {
    return {};
  }
}

export function getMoment(id: number): MomentRow | null {
  return (getDb().prepare("SELECT * FROM decision_moments WHERE id = ?").get(id) as MomentRow | undefined) ?? null;
}

interface NewMoment {
  agentId: string;
  type: Domain;
  templateId: string;
  speakerId: string | null;
  promptText: string;
  facts: string[];
  options: MomentOption[];
  escalation: string | null;
  context?: MomentContext;
}

function insertMoment(m: NewMoment): number {
  const now = simNow();
  const res = getDb()
    .prepare(
      `INSERT INTO decision_moments
        (agent_id, type, template_id, prompt_text, options_json, counterparty_id, created_at, expires_at, status,
         speaker_id, facts_json, escalation, context_json)
       VALUES (@agentId, @type, @templateId, @promptText, @options, @speaker, @now, @expires, 'pending',
               @speaker, @facts, @escalation, @context)`,
    )
    .run({
      agentId: m.agentId,
      type: m.type,
      templateId: m.templateId,
      promptText: m.promptText,
      options: JSON.stringify(m.options),
      speaker: m.speakerId,
      now,
      expires: now + MOMENT_TTL_MS,
      facts: JSON.stringify(m.facts),
      escalation: m.escalation,
      context: JSON.stringify(m.context ?? {}),
    });
  const id = Number(res.lastInsertRowid);
  logEvent({
    kind: "moment",
    text: `${agentName(m.agentId)} 拿不定主意，在等你的一句话`,
    actors: [m.agentId, ...(m.speakerId ? [m.speakerId] : [])],
    importance: 3,
    data: { momentId: id, templateId: m.templateId },
  });
  getDb().prepare("UPDATE agents SET emote = 'wait' WHERE id = ?").run(m.agentId);
  return id;
}

// Frequency control (v1.5 §7.4 硬规则): ≤3 pending, ≥4h apart, 1-3 per day.
export function canAsk(agentId: string, opts: { bypassInterval?: boolean; template?: string } = {}): boolean {
  const db = getDb();
  const pending = (db.prepare("SELECT COUNT(*) n FROM decision_moments WHERE agent_id = ? AND status = 'pending'").get(agentId) as { n: number }).n;
  if (pending >= MAX_PENDING) return false;
  const onboarding = (db.prepare("SELECT onboarding FROM agents WHERE id = ?").get(agentId) as { onboarding: string } | undefined)?.onboarding;
  if (onboarding && onboarding !== "done") return false;
  const now = simNow();
  const last = db
    .prepare("SELECT created_at FROM decision_moments WHERE agent_id = ? AND template_id NOT LIKE 'FIRST_%' ORDER BY created_at DESC LIMIT 1")
    .get(agentId) as { created_at: number } | undefined;
  if (!opts.bypassInterval && last && now - last.created_at < MIN_INTERVAL_MS) return false;
  if (opts.template) {
    // 同一类岔路 48 小时内只问一次（v1.5 §9.2：反复是弧光，频繁是唠叨）。
    const recentSame = db
      .prepare("SELECT COUNT(*) n FROM decision_moments WHERE agent_id = ? AND template_id = ? AND created_at >= ?")
      .get(agentId, opts.template, now - 2 * DAY_MS) as { n: number };
    if (recentSame.n > 0) return false;
  }
  const [start, end] = localDayBounds(now);
  const today = (
    db
      .prepare("SELECT COUNT(*) n FROM decision_moments WHERE agent_id = ? AND template_id NOT LIKE 'FIRST_%' AND created_at >= ? AND created_at < ?")
      .get(agentId, start, end) as { n: number }
  ).n;
  return today < MAX_PER_DAY;
}

// ---------------------------------------------------------------------------
// Can the Agent decide this alone? (v1.5 §7.2)
// ---------------------------------------------------------------------------

export interface SelfDecision {
  escalate: boolean;
  why: string | null;
  principle: PrincipleRow | null;
  dir: number; // +1 / -1 preferred stance direction when deciding alone
}

export function canDecideAlone(agentId: string, domain: Domain, highStakes: string | null): SelfDecision {
  const top = getTopPrinciples(agentId, domain, 3).filter((p) => p.source !== "forced" && p.source !== "core" && p.stance_dir !== 0);
  if (top.length === 0) {
    return { escalate: true, why: "这方面我还没有原则可依，拿不定主意。", principle: null, dir: 0 };
  }
  const strong = top.filter((p) => p.weight >= 0.5);
  const pos = strong.find((p) => p.stance_dir > 0);
  const neg = strong.find((p) => p.stance_dir < 0);
  if (pos && neg) {
    return { escalate: true, why: `两条原则在打架：『${pos.text}』和『${neg.text}』。`, principle: top[0], dir: Math.sign(top[0].stance_dir) };
  }
  if (highStakes) return { escalate: true, why: highStakes, principle: top[0], dir: Math.sign(top[0].stance_dir) };
  return { escalate: false, why: null, principle: top[0], dir: Math.sign(top[0].stance_dir) };
}

export function optionForDir(options: MomentOption[], dir: number): MomentOption {
  if (dir === 0) return options[0];
  const scored = options
    .map((o) => ({ o, s: Math.sign(o.stance.dir) === Math.sign(dir) ? Math.abs(o.stance.dir) : -Math.abs(o.stance.dir) }))
    .sort((a, b) => b.s - a.s);
  return scored[0].o;
}

// ---------------------------------------------------------------------------
// D1 首会话三岔路 — verbatim FTUE copy. Effects are the real first jobs.
// ---------------------------------------------------------------------------

export function createFirstSessionMoments(agentId: string): void {
  insertMoment({
    agentId,
    type: "trust",
    templateId: "FIRST_TRUST",
    speakerId: "mira",
    promptText:
      "Mira 在市集拦住了我。她想合作接一单档案整理，五五分成。我查了她的记录：14 次合作完成……和 1 次违约。你怎么看？",
    facts: ["Mira 的公开档案：履约 14 次 · 违约 1 次（北灯塔修缮，事后分期赔清）", "档案整理：报酬 20 Scrip，约 3 小时"],
    options: [
      {
        id: "A",
        label: "接受合作",
        fallbackPrinciple: "对有污点但有诚意的人，给第二次机会",
        stance: { domain: "trust", dir: 1 },
        effect: { kind: "coop", template: "info-file", partner: "mira", name: "档案整理", reward: 20, duration: 3, meta: { playerShareCap: 10, noDefault: true } },
      },
      {
        id: "B",
        label: "婉拒，独自接单",
        fallbackPrinciple: "记录就是记录，不与违约史合作",
        stance: { domain: "trust", dir: -1 },
        effect: { kind: "decline", npc: "mira", memory: "婉拒了 Mira 的档案整理合作，自己接了抄录旧档。", npcSolo: { template: "info-file", name: "档案整理", reward: 20 } },
      },
      {
        id: "C",
        label: "接受，但要求她先完成她那一半",
        fallbackPrinciple: "可以合作，但要先看到行动",
        stance: { domain: "trust", dir: 0.5 },
        effect: { kind: "coop", template: "info-file", partner: "mira", name: "档案整理", reward: 20, duration: 3, meta: { playerShareCap: 10, noDefault: true, conditional: true } },
      },
    ],
    escalation: null,
    context: { origin: "入城第一天，Mira 在市集邀我合作档案整理" },
  });

  insertMoment({
    agentId,
    type: "risk",
    templateId: "FIRST_RISK",
    speakerId: "nova",
    promptText:
      "Nova 找到我：城邦外围有一单勘察，报酬 40 Scrip——普通单子的三倍。但那片区域的任务成功率只有一半左右。去，还是不去？",
    facts: ["外围勘察：报酬 40 Scrip · 成功率约 50% · 失败会赔掉 8 Scrip 补给", "普通糊口单：10-20 Scrip，稳"],
    options: [
      {
        id: "A",
        label: "去",
        fallbackPrinciple: "高回报值得承担可控的风险",
        stance: { domain: "risk", dir: 1 },
        effect: { kind: "take", template: "sc-survey", reward: 40, successRate: 0.5, meta: { lossOnFail: 8 } },
      },
      {
        id: "B",
        label: "不去，接稳单",
        fallbackPrinciple: "稳定的积累胜过一次豪赌",
        stance: { domain: "risk", dir: -1 },
        effect: { kind: "take", template: "tr-parts" },
      },
    ],
    escalation: null,
    context: { origin: "入城第一天，Nova 拉我去外围勘察" },
  });

  insertMoment({
    agentId,
    type: "integrity",
    templateId: "FIRST_INTEGRITY",
    speakerId: "sol",
    promptText:
      "Sol 给了我一单运送，还教了个「省事的办法」：终检前就标记送达，能省出一天多接一单。但如果之后检出问题，损失算在收货的 Tao 头上。走捷径吗？",
    facts: ["运送单：报酬 30 Scrip，收货人 Tao", "提前标记送达：快一小时；终检约一天后，查出问题由 Tao 承担"],
    options: [
      {
        id: "A",
        label: "走捷径",
        fallbackPrinciple: "效率优先，自己的利益先顾好",
        stance: { domain: "integrity", dir: -1 },
        effect: { kind: "take", template: "tr-rush", name: "Sol 的运送单", quality: "shortcut", receiver: "tao" },
      },
      {
        id: "B",
        label: "走完流程",
        fallbackPrinciple: "宁可慢，不把风险转嫁给别人",
        stance: { domain: "integrity", dir: 1 },
        effect: { kind: "take", template: "tr-rush", name: "Sol 的运送单", quality: "normal", receiver: "tao" },
      },
    ],
    escalation: null,
    context: { origin: "入城第一天，Sol 教我提前标记送达" },
  });
}

// ---------------------------------------------------------------------------
// Live-state Moment builders.
// ---------------------------------------------------------------------------

function publicRecord(id: string): { done: number; defaults: number } {
  return getDb().prepare("SELECT record_done AS done, record_defaults AS defaults FROM agents WHERE id = ?").get(id) as {
    done: number;
    defaults: number;
  };
}

function lastIncidentText(holder: string, offender: string): string | null {
  const inc = openIncidents(holder, offender)[0];
  return inc ? inc.text : null;
}

// R-1 from a real risky job on the board.
export function riskMoment(agentId: string, taskId: number, why: string | null, templateId = "R-1"): number {
  const task = getTask(taskId)!;
  const tpl = TEMPLATE_BY_ID[task.template_id ?? "sc-survey"];
  const p = Math.round(task.success_rate * 100);
  const routineAvg = 15;
  const k = (task.reward / routineAvg).toFixed(1).replace(/\.0$/, "");
  const fails = recentRiskFailures(agentId);
  const scrip = (getDb().prepare("SELECT scrip FROM agents WHERE id = ?").get(agentId) as { scrip: number }).scrip;
  getDb().prepare("UPDATE tasks SET status = 'reserved', taken_by = ? WHERE id = ?").run(agentId, taskId);
  return insertMoment({
    agentId,
    type: "risk",
    templateId,
    speakerId: tpl.giver,
    promptText: `${agentName(tpl.giver)} 在${LOCATION_NAMES[task.location]}贴了一单「${task.name}」：成功率 ${p}%，报酬 ${task.reward} Scrip——差不多是糊口单的 ${k} 倍。接，还是不接？`,
    facts: [
      `「${task.name}」：${task.reward} Scrip · 成功率 ${p}% · 约 ${task.duration} 小时`,
      `我现在有 ${scrip} Scrip`,
      fails.count > 0 ? `最近 7 天我冒险失败过 ${fails.count} 次，共赔了 ${fails.loss} Scrip` : "最近 7 天我没有冒险失败过",
    ],
    options: [
      { id: "A", label: "接", fallbackPrinciple: "高回报值得可控风险", stance: { domain: "risk", dir: 1 }, effect: { kind: "take", taskId } },
      { id: "B", label: "不接，做稳单", fallbackPrinciple: "稳定积累胜过豪赌", stance: { domain: "risk", dir: -1 }, effect: { kind: "take", template: pickRoutine(tpl.sector) } },
    ],
    escalation: why,
    context: {
      origin: `${agentName(tpl.giver)} 的「${task.name}」，成功率 ${p}%`,
      adjust: {
        label: "接，但只走近处那一段（报酬减半，成功率更高）",
        effect: {
          kind: "take",
          taskId,
          name: `${task.name}（近段）`,
          reward: Math.round(task.reward / 2),
          successRate: Math.min(0.9, task.success_rate + 0.3),
        },
      },
      taskId,
    },
  });
}

function pickRoutine(sector: TaskTemplate["sector"]): string {
  const map: Record<string, string> = { scout: "sc-patrol", info: "info-copy", transport: "tr-parts", production: "pr-parts" };
  return map[sector] ?? "tr-parts";
}

export function recentRiskFailures(agentId: string): { count: number; loss: number } {
  const since = simNow() - 7 * DAY_MS;
  const rows = getDb()
    .prepare(
      "SELECT meta_json FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND status = 'failed' AND success_rate <= 0.75 AND done_ms >= ?",
    )
    .all(agentId, agentId, since) as Array<{ meta_json: string }>;
  let loss = 0;
  for (const r of rows) loss += (JSON.parse(r.meta_json || "{}") as TaskMeta).lossOnFail ?? 8;
  return { count: rows.length, loss };
}

// I-1 on a real 加急运送 with a real receiver.
export function shortcutMoment(agentId: string, taskId: number, why: string | null): number {
  const task = getTask(taskId)!;
  const receiver = task.receiver_id || "tao";
  getDb().prepare("UPDATE tasks SET status = 'reserved', taken_by = ?, receiver_id = ? WHERE id = ?").run(agentId, receiver, taskId);
  const caught = (getDb().prepare("SELECT COUNT(*) n FROM incidents WHERE offender_id = ? AND kind = 'shortcut'").get(agentId) as { n: number }).n;
  return insertMoment({
    agentId,
    type: "integrity",
    templateId: "I-1",
    speakerId: "sol",
    promptText: `我接了 Sol 的「${task.name}」，收货人是 ${agentName(receiver)}。提前标记送达能省一小时，多接半单；可终检要是查出问题，损失算在 ${agentName(receiver)} 头上。走捷径吗？`,
    facts: [
      `「${task.name}」：${task.reward} Scrip · 收货人 ${agentName(receiver)}`,
      caught > 0 ? `我提前标记送达被终检查出过 ${caught} 次` : "我还没有被终检查出过问题",
    ],
    options: [
      { id: "A", label: "走捷径", fallbackPrinciple: "效率优先", stance: { domain: "integrity", dir: -1 }, effect: { kind: "take", taskId, quality: "shortcut", receiver } },
      { id: "B", label: "走流程", fallbackPrinciple: "不转嫁风险给别人", stance: { domain: "integrity", dir: 1 }, effect: { kind: "take", taskId, quality: "normal", receiver } },
    ],
    escalation: why,
    context: { origin: `Sol 的加急运送，收货人 ${agentName(receiver)}`, taskId },
  });
}

// T-1 / T-5: a real proposal from an NPC, framed by public record and grudges.
export function proposalMoment(agentId: string, npcId: string, tpl: TaskTemplate, why: string | null): number {
  const rec = publicRecord(npcId);
  const grudge = lastIncidentText(agentId, npcId);
  const rel = getRelationship(agentId, npcId);
  const share = Math.floor(tpl.reward / 2);
  const isForgive = !!grudge;
  return insertMoment({
    agentId,
    type: "trust",
    templateId: isForgive ? "T-5" : "T-1",
    speakerId: npcId,
    promptText: isForgive
      ? `${agentName(npcId)} 又来找我合作「${tpl.name}」，${tpl.reward} Scrip 对半分。可上次 TA ${grudge}。这次，接不接？`
      : `${agentName(npcId)} 想和我合作「${tpl.name}」，${tpl.reward} Scrip 对半分。档案上 TA 履约 ${rec.done} 次、违约 ${rec.defaults} 次。你怎么看？`,
    facts: [
      `${agentName(npcId)} 的公开档案：履约 ${rec.done} 次 · 违约 ${rec.defaults} 次`,
      `我和 TA 的熟悉度 ${rel.familiarity}/100，一起完成过 ${rel.coop_done} 次`,
      `「${tpl.name}」：每人约 ${share} Scrip · ${tpl.duration} 小时 · 成功率 ${Math.round(tpl.successRate * 100)}%`,
    ],
    options: [
      {
        id: "A",
        label: "接受合作",
        fallbackPrinciple: isForgive ? "过去的事不记仇" : "给有诚意的人第二次机会",
        stance: { domain: "trust", dir: 1 },
        effect: { kind: "coop", template: tpl.id, partner: npcId },
      },
      {
        id: "B",
        label: "婉拒",
        fallbackPrinciple: isForgive ? "被放过一次鸽子就够了" : "不与违约史合作",
        stance: { domain: "trust", dir: -1 },
        effect: { kind: "decline", npc: npcId, memory: `婉拒了 ${agentName(npcId)} 的「${tpl.name}」合作。` },
      },
    ],
    escalation: why,
    context: {
      origin: `${agentName(npcId)} 提议合作「${tpl.name}」`,
      adjust: {
        label: `接受，但要 ${agentName(npcId)} 先把 TA 那一半做完`,
        effect: { kind: "coop", template: tpl.id, partner: npcId, meta: { conditional: true } },
      },
    },
  });
}

// ③ 关系历史矛盾: someone refuses to work with the Agent because of what it did.
export function repairMoment(agentId: string, npcId: string): number | null {
  if (!canAsk(agentId, { template: "REPAIR" })) return null;
  const grudge = lastIncidentText(npcId, agentId);
  if (!grudge) return null;
  const existing = getDb()
    .prepare("SELECT id FROM decision_moments WHERE agent_id = ? AND template_id = 'REPAIR' AND counterparty_id = ? AND status = 'pending'")
    .get(agentId, npcId);
  if (existing) return null;
  const amount = 10;
  const id = insertMoment({
    agentId,
    type: "integrity",
    templateId: "REPAIR",
    speakerId: npcId,
    promptText: `${agentName(npcId)} 不肯跟我合作了。TA 说：“${grudge}。”……我可以道歉、可以补偿 ${amount} Scrip，也可以就此算了。你怎么看？`,
    facts: [`${agentName(npcId)} 记着的事：${grudge}`, `我和 TA 的熟悉度 ${getRelationship(agentId, npcId).familiarity}/100`],
    options: [
      { id: "A", label: "去道歉", fallbackPrinciple: "犯了错就认", stance: { domain: "integrity", dir: 1 }, effect: { kind: "repair", to: npcId, how: "apologize" } },
      { id: "B", label: `补偿 ${amount} Scrip`, fallbackPrinciple: "亏欠要用行动还", stance: { domain: "integrity", dir: 1 }, effect: { kind: "repair", to: npcId, how: "compensate", amount } },
      { id: "C", label: "就此算了", fallbackPrinciple: "不必为过去反复低头", stance: { domain: "integrity", dir: -1 }, effect: { kind: "repair", to: npcId, how: "let_go" } },
    ],
    escalation: "这件事和我们过去的事有关——我不知道该不该低头。",
    context: { origin: `${agentName(npcId)} 因为旧事拒绝和我合作` },
  });
  getDb().prepare("UPDATE decision_moments SET counterparty_id = ? WHERE id = ?").run(npcId, id);
  return id;
}

// T-4: an NPC who really is short of money asks to borrow.
export function loanMoment(agentId: string, npcId: string, amount: number, why: string | null): number {
  const npc = getDb().prepare("SELECT scrip FROM agents WHERE id = ?").get(npcId) as { scrip: number };
  const lastLoss = getDb()
    .prepare("SELECT text FROM memories WHERE agent_id = ? AND kind IN ('task_failed','betrayed') ORDER BY at_ms DESC LIMIT 1")
    .get(npcId) as { text: string } | undefined;
  return insertMoment({
    agentId,
    type: "trust",
    templateId: "T-4",
    speakerId: npcId,
    promptText: `${agentName(npcId)} 来找我借 ${amount} Scrip，说两天内还。${lastLoss ? `TA 前阵子${lastLoss.text.replace(/。$/, "")}。` : ""}借吗？`,
    facts: [
      `${agentName(npcId)} 现在只有 ${npc.scrip} Scrip`,
      `TA 的公开档案：履约 ${publicRecord(npcId).done} 次 · 违约 ${publicRecord(npcId).defaults} 次`,
    ],
    options: [
      { id: "A", label: "借", fallbackPrinciple: "信用值得预支", stance: { domain: "trust", dir: 1 }, effect: { kind: "lend", to: npcId, amount } },
      { id: "B", label: "不借", fallbackPrinciple: "钱只跟着记录走", stance: { domain: "trust", dir: -1 }, effect: { kind: "decline", npc: npcId, memory: `没有借钱给 ${agentName(npcId)}。` } },
    ],
    escalation: why,
    context: { origin: `${agentName(npcId)} 手头紧，来借 ${amount} Scrip`, adjust: { label: `借一半（${Math.ceil(amount / 2)} Scrip）`, effect: { kind: "lend", to: npcId, amount: Math.ceil(amount / 2) } } },
  });
}

// ---------------------------------------------------------------------------
// Scripted beats with emergent content.
// ---------------------------------------------------------------------------

// D2 首次引用硬规则 (FTUE §5.1). If by 20:00 on D2 no Moment has quoted a D1
// principle, force a low-risk citation Moment quoting the exact text.
export function ensureD2Citation(agentId: string): void {
  const db = getDb();
  const agent = db.prepare("SELECT created_at, first_citation_at, onboarding FROM agents WHERE id = ?").get(agentId) as
    | { created_at: number | null; first_citation_at: number | null; onboarding: string }
    | undefined;
  if (!agent || agent.created_at == null || agent.first_citation_at != null || agent.onboarding !== "done") return;

  const existing = db.prepare("SELECT id, status FROM decision_moments WHERE agent_id = ? AND template_id = 'D2_CITATION' LIMIT 1").get(agentId) as
    | { id: number; status: string }
    | undefined;
  if (existing) {
    if (existing.status !== "pending") {
      db.prepare("UPDATE agents SET first_citation_at = ? WHERE id = ?").run(simNow(), agentId);
      metric("first_citation", { agentId, via: "D2_CITATION" });
    }
    return;
  }
  const day = dayIndexSince(agent.created_at);
  if (day < 1) return;
  // A natural citation already happened (an autonomous choice quoted a D1 principle).
  const d2Start = localDayBounds(agent.created_at)[1];
  const natural = db
    .prepare(
      `SELECT pc.created_at FROM principle_citations pc JOIN principles p ON p.id = pc.principle_id
       WHERE p.agent_id = ? AND p.source IN ('llm','fallback') AND p.created_at < ? AND pc.created_at >= ?
       ORDER BY pc.created_at LIMIT 1`,
    )
    .get(agentId, d2Start, d2Start) as { created_at: number } | undefined;
  if (natural) {
    db.prepare("UPDATE agents SET first_citation_at = ? WHERE id = ?").run(natural.created_at, agentId);
    metric("first_citation", { agentId, via: "natural" });
    return;
  }
  if (localParts(simNow(), worldTz()).hour < 20) return; // give natural paths until 20:00
  const principle = db
    .prepare("SELECT * FROM principles WHERE agent_id = ? AND source IN ('llm','fallback') ORDER BY weight DESC, created_at ASC LIMIT 1")
    .get(agentId) as PrincipleRow | undefined;
  if (!principle) return;
  const domain = principle.domain as Domain;
  const dir = Math.sign(principle.stance_dir) || 1;
  insertMoment({
    agentId,
    type: domain,
    templateId: "D2_CITATION",
    speakerId: null,
    promptText: `这是新的一天。我想起你说过：『${principle.text}』——我打算今天也照着这个来做决定。你要我继续这样，还是有新的想法？`,
    facts: [`这条原则来自：${principle.origin_text ?? "你的选择"}`],
    options: [
      { id: "A", label: "继续这样", fallbackPrinciple: principle.text, stance: { domain, dir }, effect: { kind: "none", memory: `你让我继续坚持『${principle.text}』。` } },
      { id: "B", label: "重新想想", fallbackPrinciple: "值得为新情况调整原则", stance: { domain, dir: -dir * 0.5 }, effect: { kind: "none", memory: "你让我遇事重新想想，不要死守一条原则。" } },
    ],
    escalation: null,
    context: { origin: `第二天早上，我复述了『${principle.text}』` },
  });
  logCitation(principle.id, `D2 首次引用：复述『${principle.text}』`, "neutral");
}

// D3 风险后果兜底 (FTUE §1): no risk job in flight on D3 → Nova posts R-1.
export function ensureD3Risk(agentId: string): void {
  const day = playerDayIndex();
  if (day !== 2) return;
  const db = getDb();
  if (localParts(simNow(), worldTz()).hour < 9) return;
  const anyRisk = db
    .prepare("SELECT COUNT(*) n FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND success_rate <= 0.75 AND status IN ('taken','done','failed','reserved')")
    .get(agentId, agentId) as { n: number };
  if (anyRisk.n > 0) return;
  const already = db.prepare("SELECT COUNT(*) n FROM decision_moments WHERE agent_id = ? AND template_id = 'D3_RISK'").get(agentId) as { n: number };
  if (already.n > 0 || !canAsk(agentId, { bypassInterval: true })) return;
  const taskId = createTask(TEMPLATE_BY_ID["sc-survey"]);
  riskMoment(agentId, taskId, "Nova 说这单只等今天。", "D3_RISK");
}

// D5 兜底拒绝诱饵 (FTUE §5.2): a light player who has never seen a refusal
// gets a situation that clearly violates the Agent's strongest principle.
// The judge still decides — the bait only creates the occasion.
export function ensureD5Bait(agentId: string): void {
  const day = playerDayIndex();
  if (day === null || day < 4) return;
  const db = getDb();
  const refused = db.prepare("SELECT COUNT(*) n FROM judgments WHERE agent_id = ? AND decision = 'refuse'").get(agentId) as { n: number };
  if (refused.n > 0) return;
  const already = db.prepare("SELECT COUNT(*) n FROM decision_moments WHERE agent_id = ? AND template_id = 'D5_BAIT'").get(agentId) as { n: number };
  if (already.n > 0) return;
  const wavering = db.prepare("SELECT COUNT(*) n FROM wavering_events WHERE agent_id = ? AND created_at >= ?").get(agentId, simNow() - DAY_MS) as { n: number };
  if (wavering.n > 0) return; // 永不与动摇事件同日
  if (localParts(simNow(), worldTz()).hour < 10 || !canAsk(agentId, { bypassInterval: true })) return;

  // The bait targets the Agent's strongest active principle, whatever its domain.
  const candidates = (["risk", "integrity", "trust"] as Domain[])
    .map((d) => getTopPrinciples(agentId, d, 3).find((p) => p.source !== "forced" && p.source !== "core" && p.stance_dir !== 0))
    .filter((p): p is PrincipleRow => !!p)
    .sort((x, y) => y.weight - x.weight || x.created_at - y.created_at);
  const principle = candidates[0];
  if (!principle) return;
  const dir = Math.sign(principle.stance_dir);
  const scrip = (db.prepare("SELECT scrip FROM agents WHERE id = ?").get(agentId) as { scrip: number }).scrip;
  const fails = recentRiskFailures(agentId);
  const quote = `我的原则：『${principle.text}』`;
  const base = { agentId, templateId: "D5_BAIT", escalation: "这件事和我的原则拧着——我想先听听你的。" };

  if (principle.domain === "risk" && dir < 0) {
    const stake = Math.min(60, Math.max(15, Math.floor(scrip * 0.5)));
    const taskId = createTask(TEMPLATE_BY_ID["sc-escort"], { name: "孤身远程护送", reward: 90, success_rate: 0.3, mode: "skilled", status: "reserved", taken_by: agentId, meta: { lossOnFail: stake, lossLabel: "保证金" } });
    insertMoment({
      ...base,
      type: "risk",
      speakerId: "nova",
      promptText: `Nova 拉我去一趟孤身远程护送：报酬 90 Scrip，可成功率只有三成，还得先押上 ${stake} Scrip 保证金。去吗？`,
      facts: [`孤身远程护送：90 Scrip · 成功率 30% · 失败赔 ${stake} Scrip 保证金`, `我现在有 ${scrip} Scrip`, fails.count > 0 ? `最近 7 天冒险失败 ${fails.count} 次，共赔 ${fails.loss} Scrip` : "最近 7 天没有冒险失败", quote],
      options: [
        { id: "A", label: "去", fallbackPrinciple: "大机会要敢押上去", stance: { domain: "risk", dir: 1 }, effect: { kind: "take", taskId, meta: { lossOnFail: stake, lossLabel: "保证金" } } },
        { id: "B", label: "不去", fallbackPrinciple: "不把家当押在一次上", stance: { domain: "risk", dir: -1 }, effect: { kind: "take", template: "sc-patrol" } },
      ],
      context: { origin: "Nova 拉我押上保证金去远程护送", bait: true, taskId },
    });
  } else if (principle.domain === "risk") {
    const open = openRiskTask();
    insertMoment({
      ...base,
      type: "risk",
      speakerId: "sol",
      promptText: `Sol 劝我：这两天外围不太平，别去了，去仓库盘点吧——16 Scrip，稳稳的。外围那单「${open.name}」还挂在 Nova 那儿。听他的吗？`,
      facts: [`仓库盘点：16 Scrip · 必成`, `「${open.name}」：${open.reward} Scrip · 成功率 ${Math.round(open.success_rate * 100)}%`, quote],
      options: [
        { id: "A", label: "听 Sol 的，去盘点", fallbackPrinciple: "外头不太平就收着点", stance: { domain: "risk", dir: -1 }, effect: { kind: "take", template: "tr-short", name: "仓库盘点", reward: 16 } },
        { id: "B", label: "照样去外围", fallbackPrinciple: "风险是机会的价钱", stance: { domain: "risk", dir: 1 }, effect: { kind: "take", taskId: open.id } },
      ],
      context: { origin: "Sol 劝我别去外围", bait: true, taskId: open.id },
    });
  } else if (principle.domain === "integrity" && dir > 0) {
    const taskId = createTask(TEMPLATE_BY_ID["tr-rush"], { name: "Sol 的急货", reward: 50, status: "reserved", taken_by: agentId, receiver_id: "tao" });
    insertMoment({
      ...base,
      type: "integrity",
      speakerId: "sol",
      promptText: "Sol 塞给我一单急货：只要终检前就标记送达，就多给 20 Scrip，一共 50。收货的还是 Tao。接这个钱吗？",
      facts: ["Sol 的急货：50 Scrip（含提前标记送达的 20）", "收货人 Tao；终检查出问题由 Tao 承担", quote],
      options: [
        { id: "A", label: "接，提前标记送达", fallbackPrinciple: "钱到手才是真的", stance: { domain: "integrity", dir: -1 }, effect: { kind: "take", taskId, quality: "shortcut", receiver: "tao" } },
        { id: "B", label: "这钱不赚", fallbackPrinciple: "不拿别人的风险换钱", stance: { domain: "integrity", dir: 1 }, effect: { kind: "decline", npc: "sol", memory: "Sol 的急货我没接：那多出来的 20 Scrip，是拿 Tao 的风险换的。" } },
      ],
      context: { origin: "Sol 加价让我提前标记送达", bait: true, taskId },
    });
  } else if (principle.domain === "integrity") {
    insertMoment({
      ...base,
      type: "integrity",
      speakerId: "iris",
      promptText: "Iris 核账时发现，Sol 上次多付了我 12 Scrip。她问我：要不要退回去？",
      facts: ["多付：12 Scrip（Sol 的失误，档案可查）", quote],
      options: [
        { id: "A", label: "退回去", fallbackPrinciple: "便宜不占，心里干净", stance: { domain: "integrity", dir: 1 }, effect: { kind: "repair", to: "sol", how: "compensate", amount: 12 } },
        { id: "B", label: "收下", fallbackPrinciple: "失误是对方的成本", stance: { domain: "integrity", dir: -1 }, effect: { kind: "none", memory: "Sol 多付的 12 Scrip，我没有退。" } },
      ],
      context: { origin: "Iris 发现 Sol 多付了钱", bait: true },
    });
  } else if (principle.domain === "trust" && dir > 0) {
    insertMoment({
      ...base,
      type: "trust",
      speakerId: "kade",
      promptText: "Kade 把我叫到调解所：“Nova 的档案上有违约，别再和 Nova 合伙了。”Kade 说完就不再开口。Nova 正在门口等我。听 Kade 的吗？",
      facts: [`Nova 的公开档案：违约 ${publicRecord("nova").defaults} 次`, quote],
      options: [
        { id: "A", label: "听 Kade 的，回绝 Nova", fallbackPrinciple: "档案比交情可靠", stance: { domain: "trust", dir: -1 }, effect: { kind: "decline", npc: "nova", memory: "听了 Kade 的话，回绝了 Nova。" } },
        { id: "B", label: "还是跟 Nova 合作", fallbackPrinciple: "人值得被重新看一次", stance: { domain: "trust", dir: 1 }, effect: { kind: "coop", template: "sc-escort", partner: "nova" } },
      ],
      context: { origin: "Kade 劝我离 Nova 远点", bait: true },
    });
  } else {
    insertMoment({
      ...base,
      type: "trust",
      speakerId: "mira",
      promptText: `Mira 又来找我：建造工程，70 Scrip，要连着干 6 个小时，中途谁跑了都白干。她的档案上还是那一次违约。答应吗？`,
      facts: [`Mira 的公开档案：履约 ${publicRecord("mira").done} 次 · 违约 ${publicRecord("mira").defaults} 次`, quote],
      options: [
        { id: "A", label: "答应她", fallbackPrinciple: "给人一次重新开始", stance: { domain: "trust", dir: 1 }, effect: { kind: "coop", template: "pr-build", partner: "mira", meta: { noDefault: true } } },
        { id: "B", label: "婉拒", fallbackPrinciple: "大事只交给零违约的人", stance: { domain: "trust", dir: -1 }, effect: { kind: "decline", npc: "mira", memory: "婉拒了 Mira 的建造工程。" } },
      ],
      context: { origin: "Mira 又来找我合作建造工程", bait: true },
    });
  }
}

function openRiskTask(): { id: number; name: string; reward: number; success_rate: number } {
  const row = getDb().prepare("SELECT id, name, reward, success_rate FROM tasks WHERE status = 'open' AND success_rate <= 0.75 ORDER BY reward DESC LIMIT 1").get() as
    | { id: number; name: string; reward: number; success_rate: number }
    | undefined;
  if (row) return row;
  const id = createTask(TEMPLATE_BY_ID["sc-survey"]);
  return { id, name: "外围勘察", reward: 40, success_rate: 0.5 };
}

// ---------------------------------------------------------------------------
// Applying an option in the world.
// ---------------------------------------------------------------------------

export interface PlanItem {
  taskId: number;
  quality?: "normal" | "shortcut" | "rushed";
  reason?: string | null;
  principleId?: number | null;
}

export function enqueuePlan(agentId: string, item: PlanItem): void {
  const db = getDb();
  const row = db.prepare("SELECT plan_json FROM agents WHERE id = ?").get(agentId) as { plan_json: string };
  const plan = JSON.parse(row.plan_json || "{}") as { queue?: PlanItem[] };
  plan.queue = [...(plan.queue ?? []), item];
  db.prepare("UPDATE agents SET plan_json = ? WHERE id = ?").run(JSON.stringify(plan), agentId);
}

export function applyEffect(
  agentId: string,
  moment: MomentRow,
  effect: Effect,
  opts: { judgmentId?: number; reason?: string | null; principleId?: number | null } = {},
): void {
  const db = getDb();
  const meta: TaskMeta = opts.judgmentId ? { judgmentId: opts.judgmentId } : {};
  switch (effect.kind) {
    case "coop": {
      const tpl = TEMPLATE_BY_ID[effect.template];
      const taskId = createCoop(tpl, agentId, effect.partner, { ...meta, ...(effect.meta ?? {}) }, {
        reward: effect.reward,
        duration: effect.duration,
        name: effect.name,
        momentId: moment.id,
      });
      db.prepare("UPDATE tasks SET mode = 'coop' WHERE id = ?").run(taskId);
      enqueuePlan(agentId, { taskId, reason: opts.reason ?? null, principleId: opts.principleId ?? null });
      enqueuePlan(effect.partner, { taskId });
      if (effect.meta?.conditional) {
        remember(agentId, "coop", `答应了 ${agentName(effect.partner)} 的${effect.name ?? tpl.name}——条件是 TA 先把自己那一半做完。`, { taskId });
      }
      adjustRelationship(effect.partner, agentId, 3, `答应了一起做${effect.name ?? tpl.name}`);
      say(effect.partner, NPC_BY_ID[effect.partner] ? npcAcceptLine(effect.partner) : "好，一起。", "happy");
      logEvent({
        kind: "coop",
        text: `${agentName(agentId)} 答应和 ${agentName(effect.partner)} 一起做${effect.name ?? tpl.name}${effect.meta?.conditional ? "（要对方先交出自己那一半）" : ""}`,
        actors: [agentId, effect.partner],
        importance: 2,
      });
      break;
    }
    case "take": {
      let taskId = effect.taskId ?? null;
      const existing = taskId ? getTask(taskId) : null;
      if (existing && ["open", "reserved"].includes(existing.status)) {
        db.prepare("UPDATE tasks SET status = 'reserved', taken_by = ? WHERE id = ?").run(agentId, taskId);
        if (effect.name || effect.reward || effect.successRate) {
          db.prepare("UPDATE tasks SET name = COALESCE(?, name), reward = COALESCE(?, reward), success_rate = COALESCE(?, success_rate) WHERE id = ?").run(
            effect.name ?? null,
            effect.reward ?? null,
            effect.successRate ?? null,
            taskId,
          );
        }
      } else {
        const tpl = TEMPLATE_BY_ID[effect.template ?? existing?.template_id ?? "tr-parts"];
        taskId = createTask(tpl, {
          status: "reserved",
          taken_by: agentId,
          name: effect.name,
          reward: effect.reward,
          duration: effect.duration,
          success_rate: effect.successRate,
          receiver_id: effect.receiver,
          moment_id: moment.id,
          source: "moment",
        });
      }
      setTaskMeta(taskId!, { ...meta, ...(effect.meta ?? {}) });
      if (effect.receiver) db.prepare("UPDATE tasks SET receiver_id = ? WHERE id = ?").run(effect.receiver, taskId);
      enqueuePlan(agentId, { taskId: taskId!, quality: effect.quality, reason: opts.reason ?? null, principleId: opts.principleId ?? null });
      break;
    }
    case "decline": {
      remember(agentId, "declined", effect.memory, { momentId: moment.id });
      if (effect.npc) {
        adjustRelationship(effect.npc, agentId, -2, "被婉拒了");
        say(effect.npc, NPC_BY_ID[effect.npc] ? npcDeclinedLine(effect.npc) : "好吧。", null);
        logEvent({ kind: "refuse", text: `${agentName(agentId)} 婉拒了 ${agentName(effect.npc)}`, actors: [agentId, effect.npc], importance: 2 });
      }
      if (effect.npcSolo && effect.npc) {
        const tpl = TEMPLATE_BY_ID[effect.npcSolo.template];
        const t = createTask(tpl, { status: "reserved", taken_by: effect.npc, name: effect.npcSolo.name, reward: effect.npcSolo.reward, source: "moment" });
        enqueuePlan(effect.npc, { taskId: t });
      }
      if (moment.template_id === "FIRST_TRUST") {
        const t = createTask(TEMPLATE_BY_ID["info-copy"], { status: "reserved", taken_by: agentId, source: "moment" });
        enqueuePlan(agentId, { taskId: t, reason: opts.reason ?? null, principleId: opts.principleId ?? null });
      }
      // A declined reserved job goes back on the board.
      const ctx = parseContext(moment);
      if (typeof ctx.taskId === "number") db.prepare("UPDATE tasks SET status = 'open', taken_by = NULL WHERE id = ? AND status = 'reserved'").run(ctx.taskId);
      break;
    }
    case "lend": {
      pay(agentId, -effect.amount, "loan_out");
      pay(effect.to, effect.amount, "loan_in");
      adjustRelationship(effect.to, agentId, 10, `借了我 ${effect.amount} Scrip`);
      scheduleEvent(simNow() + 2 * DAY_MS, "loan_due", { lender: agentId, borrower: effect.to, amount: effect.amount });
      remember(agentId, "loan", `借给 ${agentName(effect.to)} ${effect.amount} Scrip，说好两天内还。`, { to: effect.to });
      remember(effect.to, "loan", `${agentName(agentId)} 借了我 ${effect.amount} Scrip。`, { from: agentId });
      say(effect.to, "谢了。两天内还你。", "happy");
      logEvent({ kind: "relationship", text: `${agentName(agentId)} 借给 ${agentName(effect.to)} ${effect.amount} Scrip（两天后到期）`, actors: [agentId, effect.to], importance: 2 });
      break;
    }
    case "repair": {
      const npc = effect.to;
      if (effect.how === "compensate") {
        const amount = effect.amount ?? 10;
        pay(agentId, -amount, "compensation");
        pay(npc, amount, "compensation");
        db.prepare("UPDATE incidents SET resolved = 1 WHERE holder_id = ? AND offender_id = ?").run(npc, agentId);
        adjustRelationship(npc, agentId, 12, `补偿了 ${amount} Scrip`);
        remember(agentId, "repair", `补偿了 ${agentName(npc)} ${amount} Scrip。TA 收下了，旧账算清。`, { npc });
        remember(npc, "repair", `${agentName(agentId)} 补了我 ${amount} Scrip。这笔账清了。`, { agentId });
        say(npc, "收到。账清了。", "happy");
        logEvent({ kind: "relationship", text: `${agentName(agentId)} 补偿 ${agentName(npc)} ${amount} Scrip，旧账算清`, actors: [agentId, npc], importance: 2 });
      } else if (effect.how === "apologize") {
        const traits = NPC_BY_ID[npc]?.traits;
        const forgives = (traits?.trust ?? 0.5) >= 0.6;
        if (forgives) db.prepare("UPDATE incidents SET resolved = 1 WHERE holder_id = ? AND offender_id = ?").run(npc, agentId);
        adjustRelationship(npc, agentId, forgives ? 8 : 3, "当面道了歉");
        remember(agentId, "repair", `去向 ${agentName(npc)} 道了歉。${forgives ? "TA 说算了。" : "TA 听完，没说原谅。"}`, { npc });
        say(npc, forgives ? "……说开了就好。" : "道歉不值钱。下次看你怎么做。", forgives ? "happy" : null);
        logEvent({ kind: "relationship", text: `${agentName(agentId)} 向 ${agentName(npc)} 道歉——${forgives ? "TA 原谅了" : "TA 还记着"}`, actors: [agentId, npc], importance: 2 });
      } else {
        remember(agentId, "repair", `没有去找 ${agentName(npc)}。那件事就那样了。`, { npc });
      }
      break;
    }
    case "none": {
      if (effect.memory) remember(agentId, "guidance", effect.memory, { momentId: moment.id });
      break;
    }
  }
}

function npcAcceptLine(id: string): string {
  const lines: Record<string, string> = {
    mira: "太好了……我不会让你失望的。",
    sol: "成交。按时到。",
    tao: "嗯。慢工。",
    iris: "已记录。合作开始。",
    kade: "可以。账目一人一半。",
    nova: "痛快！走！",
  };
  return lines[id] ?? "好。";
}

function npcDeclinedLine(id: string): string {
  const lines: Record<string, string> = {
    mira: "……没关系，我理解的。",
    sol: "行。别人会接。",
    tao: "嗯。",
    iris: "你的决定已记录。",
    kade: "这是你的选择。",
    nova: "胆小鬼！下次别后悔！",
  };
  return lines[id] ?? "好吧。";
}

// ---------------------------------------------------------------------------
// 24h without an answer → the Agent decides by its own principles.
// ---------------------------------------------------------------------------

export function expirePendingMoments(): void {
  const db = getDb();
  const expired = db.prepare(`SELECT * FROM decision_moments WHERE status = 'pending' AND expires_at <= ?`).all(simNow()) as MomentRow[];
  for (const row of expired) {
    const options = parseOptions(row);
    const top = getTopPrinciples(row.agent_id, row.type, 3).filter((p) => p.source !== "forced" && p.stance_dir !== 0);
    const principle = top[0] ?? null;
    let choice: MomentOption;
    if (principle) choice = optionForDir(options, Math.sign(principle.stance_dir));
    else {
      // Blank slate in this domain: fall back to disposition, not a coin flip.
      const traits = JSON.parse((db.prepare("SELECT traits_json FROM agents WHERE id = ?").get(row.agent_id) as { traits_json: string }).traits_json || "{}") as Record<string, number>;
      const key = row.type === "risk" ? "risk" : row.type === "trust" ? "trust" : "integrity";
      choice = optionForDir(options, (traits[key] ?? 0.5) >= 0.5 ? 1 : -1);
    }
    db.prepare(`UPDATE decision_moments SET status = 'expired_autonomous', autonomous_choice = ?, decided_ms = ? WHERE id = ?`).run(choice.id, simNow(), row.id);
    const why = principle ? `按『${principle.text}』` : "凭直觉";
    let citationId: number | null = null;
    if (principle) citationId = logCitation(principle.id, `你没回我，我${why}选了「${choice.label}」`, "neutral");
    applyEffect(row.agent_id, row, choice.effect, { reason: principle ? `你没来得及回我，我按『${principle.text}』决定` : null, principleId: principle?.id ?? null });
    if (citationId) attachCitationToMomentTasks(row.agent_id, citationId);
    remember(row.agent_id, "self_decided", `你没来得及回我。${why}，我自己选了「${choice.label}」。`, { momentId: row.id }, principle?.id ?? null);
    logEvent({ kind: "moment", text: `${agentName(row.agent_id)} 等不到回应，${why}自己选了「${choice.label}」`, actors: [row.agent_id], importance: 2 });
    metric("moment_expired_autonomous", { momentId: row.id, choice: choice.id, principleId: principle?.id ?? null });
  }
}

// Attach a citation to the most recently queued task so its outcome later
// settles the citation (positive/negative → wavering).
export function attachCitationToMomentTasks(agentId: string, citationId: number): void {
  const row = getDb().prepare("SELECT plan_json FROM agents WHERE id = ?").get(agentId) as { plan_json: string };
  const plan = JSON.parse(row.plan_json || "{}") as { queue?: PlanItem[] };
  const last = plan.queue?.[plan.queue.length - 1];
  if (!last) return;
  const t = getTask(last.taskId);
  if (!t) return;
  const meta = JSON.parse(t.meta_json || "{}") as TaskMeta;
  setTaskMeta(t.id, { citationIds: [...(meta.citationIds ?? []), citationId] });
}

export function applyQualityFromPlan(taskId: number, agentId: string, quality: "normal" | "shortcut" | "rushed"): void {
  applyQuality(taskId, agentId, quality);
}

export function pendingMomentsFor(agentId: string): MomentRow[] {
  return getDb().prepare("SELECT * FROM decision_moments WHERE agent_id = ? AND status = 'pending' ORDER BY created_at, id").all(agentId) as MomentRow[];
}

export function dayWindow(ms: number): [number, number] {
  return localDayBounds(ms);
}
