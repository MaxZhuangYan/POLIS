import { getDb } from "./db";
import { resolveGuess } from "./dilemmas";
import { clearHearsayBetween } from "./gossip";
import { runSteps, runTaskHook, type Step } from "./consequences";
import { simNow, HOUR_MS, worldTz, localParts } from "./clock";
import { CHAIN_DELIVERY, LOCATION_NAMES, NPC_BY_ID, TEMPLATE_BY_ID, TASK_TEMPLATES, type TaskTemplate } from "./content";
import {
  adjustRelationship,
  adjustReputation,
  agentName,
  changeTrust,
  currentTick,
  logEvent,
  metric,
  pay,
  payReward,
  playerDayIndex,
  recordIncident,
  remember,
  say,
} from "./records";
import { setCitationOutcome } from "./principleEngine";
import type { LocationId } from "./types";

/** "完成了Sol 的运送单" → "完成了 Sol 的运送单": a task name that opens with Latin gets the same spacing the rest of
 *  the prose gives names (no task name ends in Latin, and what follows is usually CJK punctuation) */
export function spaced(name: string): string {
  return /^[A-Za-z0-9]/.test(name) ? ` ${name}` : name;
}

// ---------------------------------------------------------------------------
// Jobs and their consequences (v1.5 §8). Everything a postcard later says
// about money, cooperation, broken promises or damage comes from here.
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: number;
  template_id: string | null;
  name: string;
  type: string;
  location: LocationId;
  giver: string | null;
  mode: "routine" | "skilled" | "coop" | "chain";
  reward: number;
  duration: number;
  success_rate: number;
  status: string; // open | reserved | taken | done | failed | abandoned | expired | legacy
  taken_by: string | null;
  partner_id: string | null;
  receiver_id: string | null;
  progress: number;
  quality: string | null; // normal | shortcut | rushed
  chain_parent_id: number | null;
  moment_id: number | null;
  reason_text: string | null;
  principle_id: number | null;
  created_ms: number | null;
  done_ms: number | null;
  meta_json: string;
}

export interface TaskMeta {
  citationIds?: number[]; // citations whose outcome this task decides
  judgmentId?: number; // a guardian choice the Agent executed (Trust +3 on success)
  playerShareCap?: number; // Mira 铁律: her jobs move the player's Scrip by ≤10
  noDefault?: boolean; // FTUE: Mira never stands the player up in week 1
  conditional?: boolean; // "先完成她那一半"
  lossOnFail?: number;
  lossLabel?: string;
  // consequences as data (lib/consequences.ts): run when the job ends this way, for `stepsAgent`
  onSuccess?: Step[];
  onFail?: Step[];
  onDefault?: Step[];
  stepsAgent?: string;
}

// The walk is presentation (v1.5 §3.5: tick 是逻辑单位，不是渲染单位): long
// enough to see someone cross town, short enough not to crawl in real time.
export const TRAVEL_MS = 90 * 1000;
// A job is a *risk decision* only when failure is a real possibility.
export const RISKY = 0.75;

export function getTask(id: number | null | undefined): TaskRow | null {
  if (!id) return null;
  return (getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined) ?? null;
}

export function taskMeta(task: TaskRow): TaskMeta {
  try {
    return JSON.parse(task.meta_json || "{}") as TaskMeta;
  } catch {
    return {};
  }
}

export function setTaskMeta(taskId: number, patch: Partial<TaskMeta>): void {
  const t = getTask(taskId);
  if (!t) return;
  const meta = { ...taskMeta(t), ...patch };
  getDb().prepare("UPDATE tasks SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), taskId);
}

export function createTask(
  tpl: TaskTemplate,
  overrides: Partial<Pick<TaskRow, "reward" | "duration" | "success_rate" | "status" | "taken_by" | "partner_id" | "receiver_id" | "name" | "moment_id" | "chain_parent_id">> & {
    mode?: TaskRow["mode"];
    source?: string;
    meta?: TaskMeta;
  } = {},
): number {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO tasks (type, reward, status, taken_by, created_tick, template_id, name, location, giver, mode, duration,
                          success_rate, partner_id, receiver_id, progress, quality, created_ms, source, moment_id, chain_parent_id, meta_json)
       VALUES (@type, @reward, @status, @taken_by, @tick, @tpl, @name, @location, @giver, @mode, @duration,
               @rate, @partner, @receiver, 0, 'normal', @now, @source, @moment, @chain, @meta)`,
    )
    .run({
      type: tpl.sector,
      reward: overrides.reward ?? tpl.reward,
      status: overrides.status ?? "open",
      taken_by: overrides.taken_by ?? null,
      tick: currentTick(),
      tpl: tpl.id,
      name: overrides.name ?? tpl.name,
      location: tpl.location,
      giver: tpl.giver,
      mode: overrides.mode ?? tpl.mode,
      duration: overrides.duration ?? tpl.duration,
      rate: overrides.success_rate ?? tpl.successRate,
      partner: overrides.partner_id ?? null,
      receiver: overrides.receiver_id ?? null,
      now: simNow(),
      source: overrides.source ?? "board",
      moment: overrides.moment_id ?? null,
      chain: overrides.chain_parent_id ?? null,
      meta: JSON.stringify(overrides.meta ?? {}),
    });
  return Number(res.lastInsertRowid);
}

export function openTasks(): TaskRow[] {
  return getDb().prepare("SELECT * FROM tasks WHERE status = 'open' ORDER BY id").all() as TaskRow[];
}

// Keep the town board stocked during working hours (06-18). Mix per v1.5
// §8.3: mostly routine 糊口单, a few skilled jobs with dilemmas, one coop.
export function restockBoard(): void {
  const db = getDb();
  const now = simNow();
  db.prepare("UPDATE tasks SET status = 'expired' WHERE status = 'open' AND created_ms < ?").run(now - 14 * HOUR_MS);
  const open = openTasks();
  const want = 8;
  if (open.length >= want) return;
  const counts = { routine: 0, skilled: 0, coop: 0 } as Record<string, number>;
  for (const t of open) counts[t.mode] = (counts[t.mode] ?? 0) + 1;
  const pool: TaskTemplate[] = [];
  const topRep = (db.prepare("SELECT MAX(reputation) r FROM agents").get() as { r: number | null }).r ?? 0;
  for (const tpl of TASK_TEMPLATES) {
    if (tpl.minRep !== undefined) {
      // a gated job is posted only while someone in town may take it, and at most one at a time
      if (topRep < tpl.minRep || open.some((t) => t.template_id === tpl.id)) continue;
    }
    const weight = tpl.minRep !== undefined ? 2 : tpl.mode === "routine" ? 5 : tpl.mode === "skilled" ? (counts.skilled < 3 ? 3 : 1) : counts.coop < 2 ? 2 : 0;
    for (let i = 0; i < weight; i++) pool.push(tpl);
  }
  for (let i = open.length; i < want && pool.length > 0; i++) {
    const tpl = pool[Math.floor(Math.random() * pool.length)];
    createTask(tpl);
    if (tpl.mode !== "routine") counts[tpl.mode]++;
  }
}

function remainingHours(task: TaskRow): number {
  return Math.max(1, task.duration - task.progress);
}

export function taskActivityText(task: TaskRow, agentId: string): string {
  const loc = LOCATION_NAMES[task.location] ?? task.location;
  const partner = task.mode === "coop" ? (task.taken_by === agentId ? task.partner_id : task.taken_by) : null;
  const withWho = partner ? `与 ${agentName(partner)} 一起` : "";
  return `${withWho}在${loc}${task.name}（还需 ${remainingHours(task)} 小时）`;
}

// Put an agent on a task: logical location changes now, the walk is shown
// over the first TRAVEL_MS of the hour.
export function startTask(agentId: string, taskId: number, opts: { reason?: string | null; principleId?: number | null } = {}): void {
  const db = getDb();
  const task = getTask(taskId);
  if (!task) return;
  const agent = db.prepare("SELECT current_location FROM agents WHERE id = ?").get(agentId) as { current_location: string };
  const now = simNow();
  const isCoopPartner = task.mode === "coop" && task.partner_id === agentId;
  if (!isCoopPartner) {
    db.prepare(
      "UPDATE tasks SET status = 'taken', taken_by = ?, taken_at_tick = ?, reason_text = COALESCE(?, reason_text), principle_id = COALESCE(?, principle_id) WHERE id = ?",
    ).run(agentId, currentTick(), opts.reason ?? null, opts.principleId ?? null, taskId);
  }
  const fresh = getTask(taskId)!;
  const moving = agent.current_location !== task.location;
  db.prepare(
    `UPDATE agents SET current_task_id = ?, partner_id = ?, activity = ?, activity_text = ?, reason_text = ?,
       current_location = ?, travel_from = ?, travel_to = ?, travel_start_ms = ?, travel_end_ms = ?, emote = 'work'
     WHERE id = ?`,
  ).run(
    taskId,
    task.mode === "coop" ? (isCoopPartner ? task.taken_by : task.partner_id) : null,
    task.mode === "coop" ? "collaborating" : "working",
    taskActivityText(fresh, agentId),
    opts.reason ?? null,
    task.location,
    moving ? agent.current_location : null,
    moving ? task.location : null,
    moving ? now : null,
    moving ? now + TRAVEL_MS : null,
    agentId,
  );
}

export function clearTask(agentId: string): void {
  getDb()
    .prepare(
      "UPDATE agents SET current_task_id = NULL, partner_id = NULL, activity = 'idle', activity_text = '', reason_text = NULL, emote = NULL WHERE id = ?",
    )
    .run(agentId);
}

function isPlayer(agentId: string | null): boolean {
  if (!agentId) return false;
  const r = getDb().prepare("SELECT is_player FROM agents WHERE id = ?").get(agentId) as { is_player: number } | undefined;
  return !!r?.is_player;
}

function settleCitations(task: TaskRow, outcome: "positive" | "negative", resultText?: string): void {
  for (const cid of taskMeta(task).citationIds ?? []) setCitationOutcome(cid, outcome, resultText);
}

// Advance every taken task by one hour; resolve finished ones.
export function progressTasks(): void {
  const db = getDb();
  const taken = db.prepare("SELECT * FROM tasks WHERE status = 'taken'").all() as TaskRow[];
  for (const task of taken) {
    // A coop job only advances when both partners are on it.
    if (task.mode === "coop" && task.partner_id) {
      const p = db.prepare("SELECT current_task_id FROM agents WHERE id = ?").get(task.partner_id) as
        | { current_task_id: number | null }
        | undefined;
      if (p?.current_task_id !== task.id) continue;
    }
    db.prepare("UPDATE tasks SET progress = progress + 1 WHERE id = ?").run(task.id);
    const t = getTask(task.id)!;
    const due = t.quality === "shortcut" ? Math.max(1, t.duration - 1) : t.duration;
    if (t.progress >= due) resolveTask(t);
    else {
      for (const who of [t.taken_by, t.mode === "coop" ? t.partner_id : null]) {
        if (who) db.prepare("UPDATE agents SET activity_text = ? WHERE id = ? AND current_task_id = ?").run(taskActivityText(t, who), who, t.id);
      }
    }
  }
}

export function resolveTask(task: TaskRow): void {
  const db = getDb();
  const meta = taskMeta(task);
  const ok = Math.random() < task.success_rate;
  const owner = task.taken_by!;
  const partner = task.mode === "coop" ? task.partner_id : null;
  const now = simNow();
  const loc = LOCATION_NAMES[task.location] ?? task.location;

  db.prepare("UPDATE tasks SET status = ?, done_ms = ?, outcome_text = ? WHERE id = ?").run(
    ok ? "done" : "failed",
    now,
    ok ? "完成" : "失败",
    task.id,
  );

  const members = partner ? [owner, partner] : [owner];
  for (const m of members) {
    clearTask(m);
    db.prepare("UPDATE agents SET emote = ? WHERE id = ?").run(ok ? "happy" : "upset", m);
  }

  if (ok) {
    const named = spaced(task.name);
    for (const m of members) {
      let gross = partner ? Math.floor(task.reward / 2) : task.reward;
      if (meta.playerShareCap !== undefined && isPlayer(m)) gross = Math.min(gross, meta.playerShareCap);
      const income = payReward(m, gross);
      db.prepare("UPDATE agents SET record_done = record_done + 1 WHERE id = ?").run(m);
      if (task.mode !== "routine") adjustReputation(m, 1);
      if (task.giver && task.giver !== m) adjustRelationship(m, task.giver, 2, null);
      const other = members.find((x) => x !== m);
      const earned = income > 0 ? (other ? `，分到 ${income} Scrip` : `，赚了 ${income} Scrip`) : "";
      const text = other ? `和 ${agentName(other)} 一起在${loc}完成了${named}${earned}。` : `在${loc}完成了${named}${earned}。`;
      // Working together is what relationships grow from: it outranks routine jobs in the postcard.
      remember(m, other ? "coop_done" : "task_done", text, { taskId: task.id, income });
      say(m, ok && task.mode === "routine" ? `${task.name}，做完了。` : `${task.name}，成了！`, "happy");
    }
    if (partner) {
      adjustRelationship(owner, partner, 15, `一起完成了${named}`, 1);
      adjustRelationship(partner, owner, 15, `一起完成了${named}`, 1);
      // seeing for yourself: what each had only heard about the other stops counting
      if (clearHearsayBetween(owner, partner) > 0) {
        const pid = members.find(isPlayer);
        const other = pid && members.find((x) => x !== pid);
        if (pid && other) remember(pid, "consequence", `之前听来的 ${agentName(other)} 的那些话，这回一起做完${named}，我自己看过了，不算数了。`, { other });
      }
    }
    logEvent({
      kind: partner ? "coop" : "task",
      text: partner
        ? `${agentName(owner)} 和 ${agentName(partner)} 在${loc}完成了${named}（${task.reward} Scrip 对半分）`
        : `${agentName(owner)} 在${loc}完成了${named}（+${task.reward}）`,
      actors: members,
      importance: task.mode === "routine" ? 1 : 2,
      data: { taskId: task.id },
    });
    settleCitations(task, "positive", `「${task.name}」完成`);
    if (meta.judgmentId && members.some(isPlayer)) {
      const pid = members.find(isPlayer)!;
      const applied = changeTrust(pid, 3, `听了你的选择，${task.name}顺利完成`);
      if (applied > 0) {
        logEvent({ kind: "trust", text: `${agentName(pid)} 对你的信任 +${applied}：照你的选择做，${task.name}成了`, actors: [pid], importance: 2 });
      }
    }
    if (task.template_id === "pr-order") spawnChainDelivery(task);
    runTaskHook(meta, "onSuccess", owner);
  } else {
    const loss = meta.lossOnFail ?? (task.success_rate <= RISKY && task.mode !== "coop" ? 8 : 0);
    const lossWord = meta.lossLabel ?? "补给";
    for (const m of members) {
      if (loss > 0) pay(m, -loss, "task_loss");
      adjustReputation(m, -1);
      const other = members.find((x) => x !== m);
      remember(
        m,
        "task_failed",
        `${other ? `和 ${agentName(other)} 一起的` : ""}${task.name}失败了${loss > 0 ? `，赔进去 ${loss} Scrip 的${lossWord}` : "，白忙一场"}。`,
        { taskId: task.id, loss },
      );
      say(m, `${task.name}……没成。`, "upset");
    }
    logEvent({
      kind: task.success_rate < 1 ? "risk" : "task",
      text: `${members.map(agentName).join(" 和 ")} 的${spaced(task.name)}失败了${loss > 0 ? `（${members.length > 1 ? "各" : ""}损失 ${loss} Scrip）` : ""}`,
      actors: members,
      importance: members.some(isPlayer) ? 3 : 2,
      data: { taskId: task.id, loss },
    });
    settleCitations(task, "negative", `「${task.name}」失败${loss > 0 ? `，赔了 ${loss} Scrip` : ""}`);
    if (task.mode === "chain" && task.chain_parent_id) blameMaker(task);
    runTaskHook(meta, "onFail", owner);
  }
  metric("task_settled", { taskId: task.id, ok, template: task.template_id, members });
}

// Two-stage collaboration (v1.5 §8.2.2): the maker's quality decides the
// courier's odds. A failed delivery of rushed parts becomes a grudge.
function spawnChainDelivery(parent: TaskRow): void {
  const rushed = parent.quality === "rushed";
  const tpl = TEMPLATE_BY_ID["tr-parts"];
  createTask(tpl, {
    name: CHAIN_DELIVERY.name,
    reward: CHAIN_DELIVERY.reward,
    duration: CHAIN_DELIVERY.duration,
    success_rate: rushed ? CHAIN_DELIVERY.successRushed : CHAIN_DELIVERY.successNormal,
    mode: "chain",
    chain_parent_id: parent.id,
    receiver_id: parent.taken_by,
    source: "chain",
  });
}

function blameMaker(delivery: TaskRow): void {
  const parent = getTask(delivery.chain_parent_id);
  if (!parent || parent.quality !== "rushed" || !parent.taken_by || !delivery.taken_by) return;
  const maker = parent.taken_by;
  const courier = delivery.taken_by;
  if (maker === courier) return;
  // Incident texts describe what the offender did, without a subject, so they
  // read correctly as "X 记着你：…" and as "上次 TA …".
  recordIncident(courier, maker, "rushed_parts", `赶工做的零件在路上散了，害得我的「${delivery.name}」失败`);
  adjustRelationship(courier, maker, -12, "零件是赶工赶坏的");
  remember(courier, "grudge", `查明了：零件是 ${agentName(maker)} 赶工赶坏的。`, { maker });
  remember(maker, "consequence", `${agentName(courier)} 运送我赶制的零件失败了。${agentName(courier)} 说是我赶工的锅。`, { courier });
  logEvent({
    kind: "relationship",
    text: `${agentName(courier)} 查明运送失败是因为 ${agentName(maker)} 赶工——记下了这一笔`,
    actors: [courier, maker],
    importance: 3,
  });
  say(courier, `零件是赶工赶坏的。我记住了。`, "upset");
}

// Integrity dilemma resolution at the start of a skilled job.
export function applyQuality(taskId: number, agentId: string, quality: "normal" | "shortcut" | "rushed"): void {
  const db = getDb();
  db.prepare("UPDATE tasks SET quality = ? WHERE id = ?").run(quality, taskId);
  const task = getTask(taskId)!;
  if (quality === "shortcut") {
    const receiver = task.receiver_id || "tao";
    db.prepare("UPDATE tasks SET receiver_id = ? WHERE id = ?").run(receiver, taskId);
    scheduleEvent(simNow() + (18 + Math.floor(Math.random() * 10)) * HOUR_MS, "inspection", { taskId, agentId, receiver });
  }
}

export function scheduleEvent(dueMs: number, kind: string, payload: Record<string, unknown>): void {
  getDb().prepare("INSERT INTO scheduled (due_ms, kind, payload_json, done) VALUES (?, ?, ?, 0)").run(dueMs, kind, JSON.stringify(payload));
}

export function processScheduled(): void {
  const db = getDb();
  const due = db.prepare("SELECT * FROM scheduled WHERE done = 0 AND due_ms <= ? ORDER BY due_ms").all(simNow()) as Array<{
    id: number;
    kind: string;
    payload_json: string;
  }>;
  for (const row of due) {
    db.prepare("UPDATE scheduled SET done = 1 WHERE id = ?").run(row.id);
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    try {
      if (row.kind === "inspection") runInspection(payload as { taskId: number; agentId: string; receiver: string });
      else if (row.kind === "loan_due") runLoanDue(payload as { lender: string; borrower: string; amount: number });
      else if (row.kind === "steps") runSteps(String(payload.agentId), payload.steps as Step[]);
      else if (row.kind === "self_decide") resolveGuess(Number(payload.guessId));
    } catch (err) {
      console.error("[scheduled] failed", row.kind, err);
    }
  }
}

// 终检: a shortcut is caught about half the time; the receiver pays for it.
function runInspection(p: { taskId: number; agentId: string; receiver: string }): void {
  const task = getTask(p.taskId);
  if (!task) return;
  const caught = Math.random() < 0.55;
  const meta = taskMeta(task);
  if (caught) {
    const loss = 6;
    pay(p.receiver, -loss, "inspection_loss");
    adjustReputation(p.agentId, -2);
    adjustReputation(p.receiver, -1);
    recordIncident(p.receiver, p.agentId, "shortcut", `提前标记送达，终检查出的问题算在了我头上（损失 ${loss} Scrip）`);
    adjustRelationship(p.receiver, p.agentId, -10, "提前标记送达，让我背了损失");
    remember(p.agentId, "consequence", `终检查出了我提前标记送达的那批货，损失算在了 ${agentName(p.receiver)} 头上。声望 −2。`, { taskId: task.id });
    remember(p.receiver, "grudge", `${agentName(p.agentId)} 提前标记送达，我替 TA 背了 ${loss} Scrip。`, { taskId: task.id });
    logEvent({
      kind: "relationship",
      text: `终检查出问题：${agentName(p.agentId)} 提前标记送达的${spaced(task.name)}，损失落在了 ${agentName(p.receiver)} 身上`,
      actors: [p.agentId, p.receiver],
      importance: 3,
    });
    say(p.receiver, "这批货有问题。账记在谁头上，我清楚。", "upset");
    for (const cid of meta.citationIds ?? []) setCitationOutcome(cid, "negative", `「${task.name}」被终检查出，${agentName(p.receiver)} 背了 ${loss} Scrip`);
  } else {
    remember(p.agentId, "consequence", `那单提前标记送达的${spaced(task.name)}过了终检，没出事。`, { taskId: task.id });
    for (const cid of meta.citationIds ?? []) setCitationOutcome(cid, "positive", `「${task.name}」过了终检`);
  }
}

function runLoanDue(p: { lender: string; borrower: string; amount: number }): void {
  const db = getDb();
  const b = db.prepare("SELECT scrip, traits_json FROM agents WHERE id = ?").get(p.borrower) as { scrip: number; traits_json: string };
  const traits = JSON.parse(b.traits_json || "{}") as { commitment?: number };
  // the dependable repay as soon as they can; the less committed (Nova, 0.55) only when it leaves them a cushion
  const willing = (traits.commitment ?? 0.7) > 0.6 || b.scrip >= p.amount * 2;
  if (b.scrip >= p.amount && willing) {
    pay(p.borrower, -p.amount, "loan_repay");
    pay(p.lender, p.amount, "loan_repay");
    adjustRelationship(p.lender, p.borrower, 8, `按时还了 ${p.amount} Scrip`);
    adjustRelationship(p.borrower, p.lender, 10, `借钱给我渡过难关`);
    remember(p.lender, "loan", `${agentName(p.borrower)} 按时还了借我的 ${p.amount} Scrip。`, p);
    logEvent({ kind: "relationship", text: `${agentName(p.borrower)} 按时还给 ${agentName(p.lender)} ${p.amount} Scrip`, actors: [p.borrower, p.lender], importance: 2 });
    say(p.borrower, `${p.amount}，还你。说话算话。`, "happy");
  } else {
    recordIncident(p.lender, p.borrower, "unpaid_loan", `借了我 ${p.amount} Scrip，到期没还`);
    adjustRelationship(p.lender, p.borrower, -10, `借的 ${p.amount} Scrip 到期没还`);
    db.prepare("UPDATE agents SET record_defaults = record_defaults + 1 WHERE id = ?").run(p.borrower);
    remember(p.lender, "loan", `${agentName(p.borrower)} 借的 ${p.amount} Scrip 到期没还。`, p);
    logEvent({ kind: "default", text: `${agentName(p.borrower)} 借 ${agentName(p.lender)} 的 ${p.amount} Scrip 到期没还`, actors: [p.borrower, p.lender], importance: 3 });
    say(p.borrower, "再宽限几天……", "upset");
  }
}

// --- cooperation ------------------------------------------------------------------

export function createCoop(tpl: TaskTemplate, proposer: string, partner: string, meta: TaskMeta = {}, extra: { reward?: number; duration?: number; name?: string; momentId?: number } = {}): number {
  return createTask(tpl, {
    status: "reserved",
    taken_by: proposer,
    partner_id: partner,
    reward: extra.reward,
    duration: extra.duration,
    name: extra.name,
    moment_id: extra.momentId,
    source: "coop",
    meta,
  });
}

// One partner walks away from a coop for a better offer (6.4: 违约不需要坏 Agent).
export function defaultOnCoop(defaulter: string, coop: TaskRow, betterTaskName: string): void {
  const db = getDb();
  const victim = coop.taken_by === defaulter ? coop.partner_id! : coop.taken_by!;
  db.prepare("UPDATE tasks SET status = 'failed', outcome_text = '违约', done_ms = ? WHERE id = ?").run(simNow(), coop.id);
  clearTask(defaulter);
  clearTask(victim);
  const partial = Math.floor(coop.reward * 0.3);
  payReward(victim, partial);
  db.prepare("UPDATE agents SET record_defaults = record_defaults + 1 WHERE id = ?").run(defaulter);
  recordIncident(victim, defaulter, "default", `中途撤出我们的${coop.name}，去接了${betterTaskName}`);
  adjustRelationship(victim, defaulter, -15, `在${coop.name}上放了我鸽子`);
  adjustRelationship(defaulter, victim, -3, null);
  remember(victim, "betrayed", `${agentName(defaulter)} 中途撤出了我们的${coop.name}，去接了${betterTaskName}。我只拿到 ${partial} Scrip。`, { taskId: coop.id });
  remember(defaulter, "defaulted", `我中途撤出了和 ${agentName(victim)} 的${coop.name}，去接了${betterTaskName}。`, { taskId: coop.id });
  logEvent({
    kind: "default",
    text: `${agentName(defaulter)} 中途撤出与 ${agentName(victim)} 的${coop.name}，去接了${betterTaskName}——${agentName(victim)} 记下了这一笔`,
    actors: [defaulter, victim],
    importance: 3,
  });
  say(victim, `……${agentName(defaulter)} 走了？`, "upset");
  runTaskHook(taskMeta(coop), "onDefault", victim);
}

export function hourNow(): number {
  return localParts(simNow(), worldTz()).hour;
}

export function npcTraitsOrNeutral(agentId: string) {
  return NPC_BY_ID[agentId]?.traits ?? { risk: 0.5, trust: 0.5, integrity: 0.5, commitment: 0.6, diligence: 0.6, social: 0.5 };
}

export function weekOneMiraGuard(agentId: string, partnerId: string): boolean {
  const day = playerDayIndex();
  return (agentId === "mira" || partnerId === "mira") && (isPlayer(agentId) || isPlayer(partnerId)) && day !== null && day < 7;
}
