import { getDb } from "./db";
import { atSimTime, simNow, hourStart, HOUR_MS, localParts, worldTz, addOffsetMs, nextLocalHour, isTestMode } from "./clock";
import { LOCATION_NAMES, NPC_BY_ID, TEMPLATE_BY_ID, type Traits, type TaskTemplate } from "./content";
import {
  adjustRelationship,
  agentName,
  getRelationship,
  logEvent,
  metric,
  openIncidents,
  playerDayIndex,
  playerId,
  remember,
  say,
} from "./records";
import { effectiveTraits, logCitation, strongestPrinciple, decayPrinciples, type PrincipleRow } from "./principleEngine";
import {
  RISKY,
  TRAVEL_MS,
  applyQuality,
  clearTask,
  defaultOnCoop,
  getTask,
  openTasks,
  processScheduled,
  progressTasks,
  restockBoard,
  setTaskMeta,
  startTask,
  taskMeta,
  type TaskRow,
} from "./tasks";
import {
  applyEffect,
  canAsk,
  canDecideAlone,
  enqueuePlan,
  ensureD2Citation,
  ensureD3Risk,
  ensureD5Bait,
  expirePendingMoments,
  loanMoment,
  proposalMoment,
  repairMoment,
  riskMoment,
  shortcutMoment,
  type PlanItem,
} from "./decisionMoments";
import { maybeRunDistillationBatch } from "./distillation";
import { activeDirective } from "./notes";
import { writeNightlyPostcard } from "./postcards";
import type { LocationId } from "./types";

// ---------------------------------------------------------------------------
// The world engine. tick = 1 real hour (v1.5 §3.5). Each tick every resident
// runs the same loop — the guardian slot is the only difference between the
// player's Agent and an NPC (v1.5 §9.1.1):
//
//   23-05 sleep · 06 plan · 07-18 work (take / propose / accept / refuse /
//   fulfil / default) · 19-21 evening at the plaza · 22 head home
//
// 92% of decisions are rules (no LLM). Rules read dispositions that the
// player's imprint actually shifts (principleEngine.effectiveTraits), and
// every principle-driven choice is cited, so "它记得" is never decoration.
// ---------------------------------------------------------------------------

interface AgentRow {
  id: string;
  name: string;
  is_player: number;
  scrip: number;
  reputation: number;
  current_location: string;
  activity: string;
  current_task_id: number | null;
  partner_id: string | null;
  traits_json: string;
  plan_json: string;
  onboarding: string;
  home_slot: number;
}

interface Plan {
  dateKey?: string;
  intent?: string;
  reason?: string | null;
  queue?: PlanItem[];
  riskCitedOn?: string;
}

const PLAYER_BASE: Traits = { risk: 0.5, trust: 0.5, integrity: 0.5, commitment: 0.6, diligence: 0.6, social: 0.55 };

function agents(): AgentRow[] {
  return getDb().prepare("SELECT * FROM agents ORDER BY is_player DESC, id").all() as AgentRow[];
}

function getAgent(id: string): AgentRow {
  return getDb().prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow;
}

export function traitsOf(agentId: string): Traits {
  const a = getAgent(agentId);
  const base = a.is_player ? PLAYER_BASE : ((JSON.parse(a.traits_json || "{}") as Traits) ?? PLAYER_BASE);
  const t = effectiveTraits(agentId, { ...PLAYER_BASE, ...base });
  if (a.is_player) {
    const d = activeDirective(agentId);
    if (d) {
      const key = d.domain === "risk" ? "risk" : d.domain === "trust" ? "trust" : "integrity";
      const principle = strongestPrinciple(agentId, d.domain);
      const resists = principle && Math.sign(principle.stance_dir) !== Math.sign(d.dir) && principle.weight >= 0.8;
      t[key] = Math.max(0.05, Math.min(0.95, t[key] + d.dir * (resists ? 0.08 : 0.22)));
    }
  }
  return t;
}

function readPlan(a: AgentRow): Plan {
  try {
    return JSON.parse(a.plan_json || "{}") as Plan;
  } catch {
    return {};
  }
}

function writePlan(agentId: string, plan: Plan): void {
  getDb().prepare("UPDATE agents SET plan_json = ? WHERE id = ?").run(JSON.stringify(plan), agentId);
}

function moveTo(agentId: string, to: LocationId, activity: string, text: string, reason: string | null = null): void {
  const db = getDb();
  const a = getAgent(agentId);
  const now = simNow();
  const moving = a.current_location !== to;
  db.prepare(
    `UPDATE agents SET current_location = ?, activity = ?, activity_text = ?, reason_text = ?,
       travel_from = ?, travel_to = ?, travel_start_ms = ?, travel_end_ms = ? WHERE id = ?`,
  ).run(to, activity, text, reason, moving ? a.current_location : null, moving ? to : null, moving ? now : null, moving ? now + TRAVEL_MS : null, agentId);
}

function homeOf(a: AgentRow): LocationId {
  void a;
  return "home";
}

function workplaceOf(a: AgentRow): LocationId {
  return a.is_player ? "plaza" : NPC_BY_ID[a.id]?.workplace ?? "plaza";
}

// ---------------------------------------------------------------------------
// One tick.
// ---------------------------------------------------------------------------

export function runTick(tickMs: number): void {
  atSimTime(tickMs, () => {
    const db = getDb();
    db.prepare("UPDATE world_state SET current_tick = current_tick + 1, last_tick_ms = ? WHERE id = 1").run(tickMs);
    const hour = localParts(tickMs, worldTz()).hour;

    expirePendingMoments();
    processScheduled();
    if (hour >= 6 && hour <= 18) restockBoard();
    if (hour >= 7 && hour <= 22) progressTasks();

    for (const a of agents()) {
      try {
        stepAgent(a.id, hour);
      } catch (err) {
        console.error(`[sim] step failed for ${a.id}`, err);
      }
    }
    if (hour >= 19 && hour <= 21) eveningEncounters();
    if (hour === 12) loanRequests();

    const pid = playerId();
    if (pid) {
      ensureD2Citation(pid);
      ensureD3Risk(pid);
      ensureD5Bait(pid);
      miraRevisit(pid, hour);
      if (hour === 23) writeNightlyPostcard(pid);
    }
    if (hour === 4) decayPrinciples();
    // Clear stale emotes/bubbles so the town does not keep yesterday's faces.
    db.prepare("UPDATE agents SET emote = NULL WHERE activity NOT IN ('sleeping','waiting') AND emote IN ('happy','upset','alert','think')").run();
  });
  maybeRunDistillationBatch();
}

function stepAgent(agentId: string, hour: number): void {
  const a = getAgent(agentId);
  if (a.is_player && a.onboarding !== "done") {
    // Still at the gate answering its first three questions.
    getDb().prepare("UPDATE agents SET activity = 'waiting', activity_text = '刚到城门，正在向你请教' WHERE id = ?").run(agentId);
    return;
  }

  if (hour >= 23 || hour < 6) {
    if (a.activity !== "sleeping") {
      moveTo(agentId, homeOf(a), "sleeping", "在家睡觉（06:00 醒来）");
      getDb().prepare("UPDATE agents SET emote = 'sleep', partner_id = NULL WHERE id = ?").run(agentId);
    }
    return;
  }

  if (hour === 6 || a.activity === "sleeping") {
    planDay(agentId);
    if (hour === 6) return;
  }

  const fresh = getAgent(agentId);
  if (fresh.current_task_id) {
    const task = getTask(fresh.current_task_id);
    if (task && task.status === "taken") {
      if (fresh.current_location !== task.location || fresh.activity === "sleeping") startTask(agentId, task.id, {});
      if (task.mode === "coop" && hour <= 18) maybeDefault(agentId, task);
      return;
    }
    clearTask(agentId);
  }

  if (hour <= 18) {
    if (startNextQueued(agentId)) return;
    if (chooseWork(agentId)) return;
    const wp = workplaceOf(fresh);
    moveTo(agentId, wp, "idle", `在${LOCATION_NAMES[wp]}转转，看看有没有合适的活`);
    return;
  }
  if (hour <= 21) {
    const spot: LocationId = fresh.is_player ? "plaza" : (["plaza", "market", "board"] as LocationId[])[fresh.home_slot % 3];
    moveTo(agentId, spot, "socializing", `傍晚在${LOCATION_NAMES[spot]}歇脚`);
    return;
  }
  moveTo(agentId, homeOf(fresh), "idle", "往家走");
}

// --- 06:00 planning (rule version of v1.5 §3.1) ---------------------------------

function planDay(agentId: string): void {
  const a = getAgent(agentId);
  const plan = readPlan(a);
  const dateKey = localParts(simNow()).dateKey;
  let intent: string;
  let reason: string | null = null;
  const queued = (plan.queue ?? []).map((q) => getTask(q.taskId)).find((t) => t && ["reserved", "taken", "open"].includes(t.status));
  if (queued) {
    intent = `去做「${queued.name}」`;
    reason = (plan.queue ?? []).find((q) => q.taskId === queued.id)?.reason ?? null;
  } else if (a.scrip < 30) {
    intent = "手头紧，得找活干";
  } else {
    const t = traitsOf(agentId);
    intent = t.risk > 0.6 ? "想去外围碰碰运气" : t.social > 0.6 ? "想找人合作一单大的" : "接几单稳当的活";
    if (a.is_player) {
      const p = strongestPrinciple(agentId, "risk");
      if (p) reason = `你说过『${p.text}』`;
      const d = activeDirective(agentId);
      if (d) reason = `你留言说「${d.text}」${reason ? `；${reason}` : ""}`;
    }
  }
  const grudge = getDb()
    .prepare("SELECT offender_id, text FROM incidents WHERE holder_id = ? AND resolved = 0 AND at_ms > ? ORDER BY at_ms DESC LIMIT 1")
    .get(agentId, simNow() - 2 * 24 * HOUR_MS) as { offender_id: string; text: string } | undefined;
  if (grudge && !queued) intent += `；离 ${agentName(grudge.offender_id)} 远一点`;
  writePlan(agentId, { ...plan, dateKey, intent, reason });
  moveTo(agentId, "home", "planning", `在盘算今天：${intent}`, reason);
  getDb().prepare("UPDATE agents SET emote = 'think' WHERE id = ?").run(agentId);
}

// --- queued work (from Decision Moments / accepted proposals) --------------------

function startNextQueued(agentId: string): boolean {
  const a = getAgent(agentId);
  if (a.current_task_id && getTask(a.current_task_id)?.status === "taken") return false;
  if (a.activity === "sleeping") return false;
  const plan = readPlan(a);
  const queue = plan.queue ?? [];
  while (queue.length > 0) {
    const item = queue[0];
    const task = getTask(item.taskId);
    if (!task || !["reserved", "open", "taken"].includes(task.status) || (task.status === "taken" && task.taken_by !== agentId && task.partner_id !== agentId)) {
      queue.shift();
      continue;
    }
    if (task.mode === "coop") {
      const otherId = task.taken_by === agentId ? task.partner_id : task.taken_by;
      if (!otherId) {
        queue.shift();
        continue;
      }
      const other = getAgent(otherId);
      const meta = taskMeta(task);
      const otherFree = !other.current_task_id && other.activity !== "sleeping" && !(other.is_player && other.onboarding !== "done");
      if (task.status === "reserved") {
        if (!otherFree) {
          moveTo(agentId, task.location, "waiting", `在${LOCATION_NAMES[task.location]}等 ${other.name} 一起做「${task.name}」`);
          getDb().prepare("UPDATE agents SET emote = 'wait' WHERE id = ?").run(agentId);
          return true;
        }
        // Both free: the job starts for both.
        getDb().prepare("UPDATE tasks SET status = 'taken', taken_at_tick = (SELECT current_tick FROM world_state WHERE id = 1) WHERE id = ?").run(task.id);
        const owner = task.taken_by!;
        const partner = task.partner_id!;
        startTask(owner, task.id, { reason: owner === agentId ? item.reason ?? null : null, principleId: item.principleId ?? null });
        startTask(partner, task.id, { reason: partner === agentId ? item.reason ?? null : null });
        dropFromQueue(owner, task.id);
        dropFromQueue(partner, task.id);
        if (meta.conditional) {
          const firstMover = getAgent(owner).is_player ? partner : owner;
          remember(owner, "coop", `${agentName(firstMover)} 先把自己那一半交了出来，我们才开工。`, { taskId: task.id });
          say(firstMover, "我那一半……做好了。你看看？", "work");
        }
        logEvent({
          kind: "coop",
          text: `${agentName(owner)} 和 ${agentName(partner)} 开始一起做「${task.name}」`,
          actors: [owner, partner],
          importance: 2,
        });
        return true;
      }
      queue.shift();
      continue;
    }
    // Solo job.
    getDb().prepare("UPDATE tasks SET status = 'reserved', taken_by = ? WHERE id = ? AND status = 'open'").run(agentId, task.id);
    startTask(agentId, task.id, { reason: item.reason ?? null, principleId: item.principleId ?? null });
    if (item.quality && item.quality !== "normal") applyQuality(task.id, agentId, item.quality);
    else getDb().prepare("UPDATE tasks SET quality = 'normal' WHERE id = ?").run(task.id);
    if (item.quality === "shortcut") {
      say(agentId, "提前标记送达……省一小时。", "work");
      remember(agentId, "shortcut", `「${task.name}」我提前标记了送达，收货人是 ${agentName(task.receiver_id || "tao")}。`, { taskId: task.id });
    }
    queue.shift();
    writePlan(agentId, { ...plan, queue });
    return true;
  }
  writePlan(agentId, { ...plan, queue });
  return false;
}

function dropFromQueue(agentId: string, taskId: number): void {
  const plan = readPlan(getAgent(agentId));
  plan.queue = (plan.queue ?? []).filter((q) => q.taskId !== taskId);
  writePlan(agentId, plan);
}

// --- choosing work by disposition ------------------------------------------------

function scoreTask(a: AgentRow, t: Traits, task: TaskRow): number {
  const tpl = TEMPLATE_BY_ID[task.template_id ?? ""];
  const loss = taskMeta(task).lossOnFail ?? (task.success_rate <= RISKY ? 8 : 0);
  const expected = task.reward * task.success_rate - loss * (1 - task.success_rate);
  let u = expected / Math.max(1, task.duration);
  if (task.success_rate <= RISKY) u += (t.risk - 0.5) * (task.reward / task.duration) * 1.6;
  if (task.mode === "coop") u = u / 2 + (t.social - 0.5) * 8;
  const prof = NPC_BY_ID[a.id];
  if (prof && tpl && prof.sectors.includes(tpl.sector)) u += 3;
  if (a.scrip < 30 && task.success_rate <= RISKY) u -= 6;
  return u + Math.random() * 1.5;
}

function chooseWork(agentId: string): boolean {
  const a = getAgent(agentId);
  const t = traitsOf(agentId);
  const tasks = openTasks().filter((x) => x.mode !== "chain" || x.receiver_id !== agentId);
  if (tasks.length === 0) return false;
  const ranked = tasks.map((task) => ({ task, s: scoreTask(a, t, task) })).sort((x, y) => y.s - x.s);

  for (const { task } of ranked.slice(0, 4)) {
    if (task.mode === "coop") {
      if (proposeCoop(agentId, task)) return true;
      continue;
    }
    if (a.is_player) {
      const r = playerConsiders(agentId, task, ranked.map((x) => x.task));
      if (r === "skip") continue;
      if (r === "handled") return true;
    }
    takeSolo(agentId, task, t);
    return true;
  }
  return false;
}

function takeSolo(agentId: string, task: TaskRow, t: Traits, reason: string | null = null, principle: PrincipleRow | null = null): void {
  getDb().prepare("UPDATE tasks SET status = 'reserved', taken_by = ? WHERE id = ? AND status = 'open'").run(agentId, task.id);
  startTask(agentId, task.id, { reason, principleId: principle?.id ?? null });
  const tpl = TEMPLATE_BY_ID[task.template_id ?? ""];
  if (tpl?.dilemma === "shortcut") {
    const a = getAgent(agentId);
    const shortcut = a.is_player ? false : t.integrity < 0.5;
    applyQuality(task.id, agentId, shortcut ? "shortcut" : "normal");
    if (shortcut) {
      remember(agentId, "shortcut", `「${task.name}」提前标记了送达。`, { taskId: task.id });
      logEvent({ kind: "task", text: `${agentName(agentId)} 的「${task.name}」提前标记了送达`, actors: [agentId], importance: 1 });
    }
  } else if (tpl?.dilemma === "rush") {
    const rushed = t.diligence < 0.5;
    applyQuality(task.id, agentId, rushed ? "rushed" : "normal");
    if (rushed) {
      remember(agentId, "rush", `「${task.name}」赶了工，按期交了。`, { taskId: task.id });
      if (principle) say(agentId, "赶一赶，按期交。", "work");
    }
  }
  if (principle) {
    const cid = logCitation(principle.id, `${task.name}：${reason ?? ""}`, "neutral");
    setTaskMeta(task.id, { citationIds: [...(taskMeta(getTask(task.id)!).citationIds ?? []), cid] });
  }
}

// Citing the same principle for the same kind of job every day reads like a
// template (PMF §4.2 识破风险). The citation is still logged (it feeds D2 and
// wavering), but only the first time in 48h becomes a narrated memory.
function narrateChoice(agentId: string, principleId: number | null, key: string, firstText: string, plainText: string, refs: Record<string, unknown>): void {
  if (principleId) {
    const recent = getDb()
      .prepare("SELECT COUNT(*) n FROM memories WHERE agent_id = ? AND principle_id = ? AND refs_json LIKE ? AND at_ms >= ?")
      .get(agentId, principleId, `%"key":"${key}"%`, simNow() - 48 * HOUR_MS) as { n: number };
    if (recent.n > 0) {
      remember(agentId, "routine_choice", plainText, { ...refs, key });
      return;
    }
  }
  remember(agentId, "self_decided", firstText, { ...refs, key }, principleId);
}

// The player's Agent decides alone when its principles settle the matter and
// asks the guardian when they don't (v1.5 §7.2). Returns "skip" to look at
// the next job, "handled" if it already acted, "take" to just take it.
function playerConsiders(agentId: string, task: TaskRow, ranked: TaskRow[]): "skip" | "handled" | "take" {
  const a = getAgent(agentId);
  const t = traitsOf(agentId);
  const tpl = TEMPLATE_BY_ID[task.template_id ?? ""];
  if (task.success_rate <= RISKY) {
    const loss = taskMeta(task).lossOnFail ?? 8;
    let stakes = task.reward >= 60 || loss >= a.scrip * 0.4 ? `这单赌注不小（${task.reward} Scrip，失败赔 ${loss}），我想先问问你。` : null;
    const lean = strongestPrinciple(agentId, "risk");
    // ③-style contradiction: the principle says "stay steady" but the purse says otherwise.
    if (!stakes && lean && lean.stance_dir < 0 && a.scrip < 40 && task.reward >= 40) {
      stakes = `你说过『${lean.text}』，可我手头只剩 ${a.scrip} Scrip 了。`;
    }
    const sd = canDecideAlone(agentId, "risk", stakes);
    if (sd.escalate && canAsk(agentId, { template: "R-1" })) {
      riskMoment(agentId, task.id, sd.why);
      return "skip";
    }
    if (sd.dir < 0 && sd.principle) {
      // It turns the risky job down by principle — and takes a steady one.
      const steady = ranked.find((x) => x.success_rate > RISKY && x.mode !== "coop" && x.id !== task.id);
      if (steady) {
        const reason = `「${task.name}」报酬 ${task.reward}，但你说过『${sd.principle.text}』`;
        takeSolo(agentId, steady, t, reason, sd.principle);
        narrateChoice(agentId, sd.principle.id, `decline-${task.template_id}`, `没接「${task.name}」（${task.reward} Scrip，成功率 ${Math.round(task.success_rate * 100)}%）。我想起你说过『${sd.principle.text}』，接了「${steady.name}」。`, `又没接「${task.name}」，接了「${steady.name}」。`, { taskId: steady.id });
        say(agentId, "稳一点。", "think");
        return "handled";
      }
      return "skip";
    }
    if (sd.principle && sd.dir > 0) {
      takeSolo(agentId, task, t, `你说过『${sd.principle.text}』`, sd.principle);
      narrateChoice(agentId, sd.principle.id, `take-${task.template_id}`, `接了「${task.name}」（成功率 ${Math.round(task.success_rate * 100)}%）。你说过『${sd.principle.text}』。`, `又去做了「${task.name}」。`, { taskId: task.id });
      say(agentId, "富贵险中求。", "work");
      return "handled";
    }
    return t.risk >= 0.5 ? "take" : "skip";
  }
  if (tpl?.dilemma === "shortcut") {
    const sd = canDecideAlone(agentId, "integrity", null);
    if (sd.escalate && canAsk(agentId, { template: "I-1" })) {
      shortcutMoment(agentId, task.id, sd.why);
      return "handled";
    }
    const shortcut = sd.dir < 0;
    getDb().prepare("UPDATE tasks SET status = 'reserved', taken_by = ?, receiver_id = COALESCE(receiver_id, 'tao') WHERE id = ?").run(agentId, task.id);
    const reason = sd.principle ? `你说过『${sd.principle.text}』` : null;
    startTask(agentId, task.id, { reason, principleId: sd.principle?.id ?? null });
    applyQuality(task.id, agentId, shortcut ? "shortcut" : "normal");
    if (sd.principle) {
      const cid = logCitation(sd.principle.id, `「${task.name}」${shortcut ? "提前标记送达" : "走完了流程"}`, "neutral");
      setTaskMeta(task.id, { citationIds: [cid] });
    }
    narrateChoice(
      agentId,
      sd.principle?.id ?? null,
      `${shortcut ? "shortcut" : "proper"}-${task.template_id}`,
      shortcut
        ? `「${task.name}」我提前标记了送达${sd.principle ? `——你说过『${sd.principle.text}』` : ""}。`
        : `「${task.name}」我老老实实走完了流程${sd.principle ? `——你说过『${sd.principle.text}』` : ""}。`,
      shortcut ? `「${task.name}」又提前标记了送达。` : `「${task.name}」照旧走完流程。`,
      { taskId: task.id },
    );
    return "handled";
  }
  return "take";
}

// --- cooperation -------------------------------------------------------------------

// NPCs must be idle to be asked; the player's Agent can be asked while it
// works (it plans ahead: an accepted proposal is queued after the current job).
function isFree(id: string): boolean {
  const a = getAgent(id);
  if (a.activity === "sleeping" || (a.is_player && a.onboarding !== "done")) return false;
  if ((readPlan(a).queue ?? []).length > 0) return false;
  return a.is_player ? true : !a.current_task_id;
}

function proposeCoop(proposer: string, task: TaskRow): boolean {
  const tpl = TEMPLATE_BY_ID[task.template_id ?? ""];
  if (!tpl) return false;
  const candidates = agents()
    .filter((x) => x.id !== proposer && isFree(x.id))
    .map((x) => {
      const rel = getRelationship(proposer, x.id);
      const grudge = openIncidents(proposer, x.id).length;
      return { x, s: rel.familiarity - grudge * 40 + Math.random() * 10 };
    })
    .sort((p, q) => q.s - p.s);
  const pick = candidates[0]?.x;
  if (!pick) return false;

  getDb().prepare("UPDATE tasks SET status = 'expired' WHERE id = ? AND status = 'open'").run(task.id);
  const answer = pick.is_player ? playerAnswersProposal(pick.id, proposer, tpl) : npcAnswersProposal(pick.id, proposer, tpl);
  if (answer.accept) {
    applyEffectDirect(proposer, pick.id, tpl, answer.reason, answer.principle);
    return true;
  }
  if (answer.escalated) return false;
  // Refused.
  remember(proposer, "refused", `${pick.name} 拒绝了和我一起做「${tpl.name}」。${answer.why ? `TA 说：“${answer.why}”` : ""}`, { other: pick.id });
  remember(pick.id, "refused_other", `没答应 ${agentName(proposer)} 的「${tpl.name}」。${answer.reason ?? ""}`, { other: proposer }, answer.principle?.id ?? null);
  adjustRelationship(proposer, pick.id, -2, `拒绝了我的「${tpl.name}」`);
  say(pick.id, answer.why ?? "这单我不做。", null);
  logEvent({
    kind: "refuse",
    text: `${pick.name} 拒绝了 ${agentName(proposer)} 的合作提议「${tpl.name}」${answer.why ? `：“${answer.why}”` : ""}`,
    actors: [pick.id, proposer],
    importance: pick.is_player || getAgent(proposer).is_player ? 3 : 2,
  });
  // ③ the player's Agent is refused because of something it did → ask the guardian.
  if (getAgent(proposer).is_player && answer.grudge) repairMoment(proposer, pick.id);
  return false;
}

function applyEffectDirect(proposer: string, partner: string, tpl: TaskTemplate, reason: string | null, principle: PrincipleRow | null): void {
  const db = getDb();
  const id = Number(
    db
      .prepare(
        `INSERT INTO tasks (type, reward, status, taken_by, created_tick, template_id, name, location, giver, mode, duration, success_rate, partner_id, progress, quality, created_ms, source, meta_json)
         VALUES (?, ?, 'reserved', ?, (SELECT current_tick FROM world_state WHERE id = 1), ?, ?, ?, ?, 'coop', ?, ?, ?, 0, 'normal', ?, 'coop', ?)`,
      )
      .run(tpl.sector, tpl.reward, proposer, tpl.id, tpl.name, tpl.location, tpl.giver, tpl.duration, tpl.successRate, partner, simNow(), JSON.stringify(principle ? { citationIds: [] } : {}))
      .lastInsertRowid,
  );
  if (principle) {
    const cid = logCitation(principle.id, `答应了「${tpl.name}」合作：${reason ?? ""}`, "neutral");
    setTaskMeta(id, { citationIds: [cid] });
  }
  enqueuePlan(proposer, { taskId: id });
  enqueuePlan(partner, { taskId: id, reason, principleId: principle?.id ?? null });
  logEvent({
    kind: "coop",
    text: `${agentName(proposer)} 提议合作「${tpl.name}」，${agentName(partner)} 答应了${reason ? `（${reason}）` : ""}`,
    actors: [proposer, partner],
    importance: getAgent(proposer).is_player || getAgent(partner).is_player ? 2 : 1,
  });
  say(partner, "行，一起。", "happy");
  startNextQueued(proposer);
  startNextQueued(partner);
}

interface Answer {
  accept: boolean;
  escalated?: boolean;
  why?: string;
  reason: string | null;
  principle: PrincipleRow | null;
  grudge?: boolean;
}

// NPC accept/refuse (v1.5 §3.4 ★应答): reads its RelationshipRecord.
function npcAnswersProposal(npcId: string, proposer: string, tpl: TaskTemplate): Answer {
  const t = traitsOf(npcId);
  const grudges = openIncidents(npcId, proposer);
  if (grudges.length > 0 && t.trust < 0.7) {
    return { accept: false, why: `上次${grudges[0].text.replace(/^.*?[，,]/, "")}`.slice(0, 40), reason: `记着：${grudges[0].text}`, principle: null, grudge: true };
  }
  if (tpl.successRate < 0.8 && t.risk < 0.35) return { accept: false, why: "太险，我不去。", reason: "嫌风险太大", principle: null };
  const rec = getDb().prepare("SELECT record_defaults FROM agents WHERE id = ?").get(proposer) as { record_defaults: number };
  if (rec.record_defaults >= 2 && t.trust < 0.4) return { accept: false, why: `你档案上违约 ${rec.record_defaults} 次。`, reason: "看了档案", principle: null };
  return { accept: true, reason: null, principle: null };
}

// The player's Agent answers an NPC's proposal: by principle when it can,
// otherwise it asks the guardian (T-1 / T-5).
function playerAnswersProposal(agentId: string, proposer: string, tpl: TaskTemplate): Answer {
  const grudge = openIncidents(agentId, proposer)[0];
  let stakes = tpl.reward >= 70 ? `「${tpl.name}」要跨 ${tpl.duration} 个小时，中途谁跑了都白干。` : null;
  const lean = strongestPrinciple(agentId, "trust");
  const rel = getRelationship(agentId, proposer);
  const defaults = (getDb().prepare("SELECT record_defaults FROM agents WHERE id = ?").get(proposer) as { record_defaults: number }).record_defaults;
  // ③ relationship history vs principle: "don't work with defaulters" — but we've done it together before.
  if (!stakes && lean && lean.stance_dir < 0 && defaults > 0 && rel.coop_done >= 1) {
    stakes = `你说过『${lean.text}』，可我和 ${agentName(proposer)} 一起做成过 ${rel.coop_done} 单。`;
  }
  const sd = canDecideAlone(agentId, "trust", grudge ? `${agentName(proposer)} 上次${grudge.text}——我拿不准。` : stakes);
  if (sd.escalate) {
    if (canAsk(agentId, { template: grudge ? "T-5" : "T-1" })) {
      proposalMoment(agentId, proposer, tpl, sd.why);
      remember(proposer, "proposed", `向 ${agentName(agentId)} 提议合作「${tpl.name}」，TA 说要想想。`, { tpl: tpl.id });
      return { accept: false, escalated: true, reason: null, principle: null };
    }
    // Cannot ask today: decides itself by disposition.
    const t = traitsOf(agentId);
    const ok = t.trust >= 0.5 && !grudge;
    remember(agentId, "self_decided", `${agentName(proposer)} 提议合作「${tpl.name}」。今天没法问你，我自己${ok ? "答应了" : "婉拒了"}。`, { proposer });
    return { accept: ok, why: ok ? undefined : "今天不了。", reason: "今天我自己拿了个主意", principle: null };
  }
  const p = sd.principle!;
  const rec = getDb().prepare("SELECT record_defaults FROM agents WHERE id = ?").get(proposer) as { record_defaults: number };
  if (sd.dir < 0 && (rec.record_defaults > 0 || grudge)) {
    remember(agentId, "self_decided", `${agentName(proposer)} 提议合作「${tpl.name}」。TA 档案上有 ${rec.record_defaults} 次违约——我想起你说过『${p.text}』，婉拒了。`, { proposer }, p.id);
    logCitation(p.id, `婉拒 ${agentName(proposer)} 的合作（档案违约 ${rec.record_defaults} 次）`, "neutral");
    return { accept: false, why: "我有我的原则。", reason: `你说过『${p.text}』`, principle: p };
  }
  remember(
    agentId,
    "self_decided",
    `${agentName(proposer)} 提议合作「${tpl.name}」，我答应了${sd.dir > 0 && rec.record_defaults > 0 ? `——TA 有违约记录，可你说过『${p.text}』` : ""}。`,
    { proposer },
    sd.dir > 0 ? p.id : null,
  );
  return { accept: true, reason: sd.dir > 0 ? `你说过『${p.text}』` : null, principle: sd.dir > 0 ? p : null };
}

// 违约 (v1.5 §6.4): a better offer appears mid-coop; disposition decides.
function maybeDefault(agentId: string, coop: TaskRow): void {
  const meta = taskMeta(coop);
  if (meta.noDefault || coop.progress >= coop.duration - 1) return;
  if (Math.random() > 0.12) return; // whether a tempting offer shows up at all is the world's chance
  const offer = openTasks().filter((t) => t.mode === "skilled" && t.reward >= 25).sort((x, y) => y.reward - x.reward)[0];
  if (!offer) return;
  const t = traitsOf(agentId);
  const share = Math.max(1, Math.floor(coop.reward / 2));
  const pull = (offer.reward / share) * (1 - t.commitment);
  const a = getAgent(agentId);
  const principle = a.is_player ? strongestPrinciple(agentId, "integrity") : null;
  const partner = coop.taken_by === agentId ? coop.partner_id! : coop.taken_by!;
  if (pull > 0.6) {
    defaultOnCoop(agentId, coop, offer.name);
    takeSolo(agentId, offer, t, principle && principle.stance_dir < 0 ? `你说过『${principle.text}』` : "有更好的单子", principle && principle.stance_dir < 0 ? principle : null);
  } else if (a.is_player && principle && principle.stance_dir > 0) {
    remember(agentId, "kept_promise", `有人拉我去接「${offer.name}」（${offer.reward} Scrip），可我答应了 ${agentName(partner)}。你说过『${principle.text}』——我留下了。`, { offer: offer.id }, principle.id);
    const cid = logCitation(principle.id, `为守约放弃「${offer.name}」`, "neutral");
    setTaskMeta(coop.id, { citationIds: [...(meta.citationIds ?? []), cid] });
    say(agentId, "答应了的事，做完。", "work");
  }
}

// --- evenings & needs --------------------------------------------------------------

function eveningEncounters(): void {
  const db = getDb();
  const present = agents().filter((x) => x.activity === "socializing");
  const byLoc = new Map<string, AgentRow[]>();
  for (const x of present) byLoc.set(x.current_location, [...(byLoc.get(x.current_location) ?? []), x]);
  for (const [, group] of byLoc) {
    if (group.length < 2) continue;
    const [p, q] = group.sort(() => Math.random() - 0.5);
    const grudge = openIncidents(p.id, q.id)[0];
    const latest = db
      .prepare("SELECT text FROM memories WHERE agent_id = ? AND at_ms > ? ORDER BY at_ms DESC LIMIT 1")
      .get(p.id, simNow() - 14 * HOUR_MS) as { text: string } | undefined;
    if (grudge) {
      say(p.id, `……${q.name}。`, "upset");
      adjustRelationship(p.id, q.id, -1, null);
    } else if (latest) {
      say(p.id, latest.text.slice(0, 34), null);
      adjustRelationship(p.id, q.id, 1, null);
      adjustRelationship(q.id, p.id, 1, null);
    }
  }
}

function loanRequests(): void {
  for (const n of agents().filter((x) => !x.is_player && x.scrip < 20)) {
    const already = getDb().prepare("SELECT COUNT(*) n FROM scheduled WHERE kind = 'loan_due' AND done = 0 AND payload_json LIKE ?").get(`%"borrower":"${n.id}"%`) as { n: number };
    if (already.n > 0) continue;
    const lender = agents()
      .filter((x) => x.id !== n.id && x.scrip >= 40 && x.activity !== "sleeping")
      .map((x) => ({ x, f: getRelationship(n.id, x.id).familiarity }))
      .filter((r) => r.f >= 8)
      .sort((r, s) => s.f - r.f || s.x.scrip - r.x.scrip)[0]?.x;
    if (!lender) continue;
    const amount = 15;
    if (lender.is_player) {
      if (lender.onboarding !== "done") continue;
      const grudge = openIncidents(lender.id, n.id)[0];
      const sd = canDecideAlone(lender.id, "trust", grudge ? `${n.name} ${grudge.text}` : null);
      if (sd.escalate && canAsk(lender.id, { template: "T-4" })) {
        loanMoment(lender.id, n.id, amount, sd.why);
        continue;
      }
      const lend = sd.dir > 0 && !grudge;
      if (lend) {
        applyLoan(lender.id, n.id, amount, sd.principle);
      } else {
        remember(lender.id, "self_decided", `${n.name} 来借 ${amount} Scrip。${sd.principle ? `你说过『${sd.principle.text}』，` : ""}我没借。`, { npc: n.id }, sd.principle?.id ?? null);
        if (sd.principle) logCitation(sd.principle.id, `没借钱给 ${n.name}`, "neutral");
        say(n.id, "……好吧。", null);
      }
      continue;
    }
    const t = traitsOf(lender.id);
    if (t.trust >= 0.5 && openIncidents(lender.id, n.id).length === 0) applyLoan(lender.id, n.id, amount, null);
  }
}

function applyLoan(lender: string, borrower: string, amount: number, principle: PrincipleRow | null): void {
  const db = getDb();
  db.prepare("UPDATE agents SET scrip = scrip - ? WHERE id = ?").run(amount, lender);
  db.prepare("UPDATE agents SET scrip = scrip + ? WHERE id = ?").run(amount, borrower);
  db.prepare("INSERT INTO ledger (agent_id, amount, reason, tick) VALUES (?, ?, 'loan_out', (SELECT current_tick FROM world_state WHERE id = 1)), (?, ?, 'loan_in', (SELECT current_tick FROM world_state WHERE id = 1))").run(lender, -amount, borrower, amount);
  db.prepare("INSERT INTO scheduled (due_ms, kind, payload_json, done) VALUES (?, 'loan_due', ?, 0)").run(simNow() + 48 * HOUR_MS, JSON.stringify({ lender, borrower, amount }));
  adjustRelationship(borrower, lender, 10, `借了我 ${amount} Scrip`);
  remember(lender, "loan", `借给 ${agentName(borrower)} ${amount} Scrip，两天后到期${principle ? `——你说过『${principle.text}』` : ""}。`, { borrower }, principle?.id ?? null);
  if (principle) logCitation(principle.id, `借钱给 ${agentName(borrower)}`, "neutral");
  remember(borrower, "loan", `${agentName(lender)} 借了我 ${amount} Scrip。`, { lender });
  logEvent({ kind: "relationship", text: `${agentName(lender)} 借给 ${agentName(borrower)} ${amount} Scrip（两天后到期）`, actors: [lender, borrower], importance: 2 });
  say(borrower, "谢了，两天内还。", "happy");
}

// D6 Mira 复访 (FTUE §5.4): quotes the player's real D1 choice + her real week.
function miraRevisit(agentId: string, hour: number): void {
  const day = playerDayIndex();
  if (day !== 5 || hour < 18 || hour > 21) return;
  const db = getDb();
  const done = db.prepare("SELECT COUNT(*) n FROM metric_events WHERE name = 'beat_mira_d6'").get() as { n: number };
  if (done.n > 0) return;
  const first = db.prepare("SELECT player_choice, autonomous_choice FROM decision_moments WHERE agent_id = ? AND template_id = 'FIRST_TRUST'").get(agentId) as
    | { player_choice: string | null; autonomous_choice: string | null }
    | undefined;
  if (!first) return;
  const choice = first.player_choice ?? first.autonomous_choice;
  const created = (db.prepare("SELECT created_at FROM agents WHERE id = ?").get(agentId) as { created_at: number }).created_at;
  const miraDone = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE (taken_by = 'mira' OR partner_id = 'mira') AND status = 'done' AND done_ms >= ?").get(created) as { n: number }).n;
  const together = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE ((taken_by = 'mira' AND partner_id = ?) OR (taken_by = ? AND partner_id = 'mira')) AND status = 'done'").get(agentId, agentId) as { n: number }).n;
  const name = agentName(agentId);
  const line =
    choice === "B"
      ? `${name}……第一天你没跟我合作，我自己把档案整理完了。这一周我接了 ${miraDone} 单。我理解的——记录就是记录。只是想告诉你，我没有让人失望。`
      : `${name}！第一天你${choice === "C" ? "让我先交出我那一半" : "愿意跟我合作"}，我一直记着。这一周我们一起做成了 ${together} 单，我自己也接了 ${miraDone} 单……谢谢你没有因为那一次就不信我。`;
  moveTo("mira", getAgent(agentId).current_location as LocationId, "socializing", `来找 ${name} 说说话`);
  say("mira", line.slice(0, 58), "happy");
  remember(agentId, "visit", `Mira 来找我。她说：“${line}”`, { npc: "mira" });
  remember("mira", "visit", `去找了 ${name}，提起了第一天的事。`, { agentId });
  adjustRelationship("mira", agentId, 5, "第六天来道谢");
  logEvent({ kind: "relationship", text: `Mira 来找 ${name}，提起了第一天的事`, actors: ["mira", agentId], importance: 3, data: { line } });
  metric("beat_mira_d6", { agentId, choice });
}

// ---------------------------------------------------------------------------
// The clock loop: hourly ticks aligned to real hours, with bounded catch-up
// after downtime ("Agent 离线也在跑"), and the labelled test fast-forward.
// ---------------------------------------------------------------------------

const MAX_CATCHUP_TICKS = 96;

export function runDueTicks(): number {
  const db = getDb();
  const row = db.prepare("SELECT last_tick_ms FROM world_state WHERE id = 1").get() as { last_tick_ms: number | null };
  const target = hourStart(simNow());
  let last = row.last_tick_ms;
  if (last == null) {
    db.prepare("UPDATE world_state SET last_tick_ms = ? WHERE id = 1").run(target - HOUR_MS);
    last = target - HOUR_MS;
  }
  let ran = 0;
  if (target - last > MAX_CATCHUP_TICKS * HOUR_MS) {
    const skipped = Math.round((target - last) / HOUR_MS) - MAX_CATCHUP_TICKS;
    last = target - MAX_CATCHUP_TICKS * HOUR_MS;
    db.prepare("UPDATE world_state SET last_tick_ms = ? WHERE id = 1").run(last);
    metric("catchup_truncated", { skippedHours: skipped });
  }
  while (last + HOUR_MS <= target) {
    last += HOUR_MS;
    runTick(last);
    ran++;
  }
  if (ran > 1) metric("catchup", { ticks: ran });
  return ran;
}

declare global {
  // eslint-disable-next-line no-var
  var __polisWorldLoop: ReturnType<typeof setInterval> | undefined;
}

export function startWorld(): void {
  if (globalThis.__polisWorldLoop) return;
  const loop = () => {
    try {
      runDueTicks();
      expirePendingMoments();
      const pid = playerId();
      if (pid) ensureD2Citation(pid);
      maybeRunDistillationBatch();
    } catch (err) {
      console.error("[world] loop error", err);
    }
  };
  loop();
  globalThis.__polisWorldLoop = setInterval(loop, 10_000);
}

export async function advanceForTest(opts: { hours?: number; to?: "night" | "morning" }): Promise<{ hours: number; ticks: number }> {
  if (!isTestMode()) throw new Error("test fast-forward is disabled (set POLIS_TEST_MODE=1)");
  const now = simNow();
  let target: number;
  if (opts.to === "night") target = nextLocalHour(23, now) + 60_000;
  else if (opts.to === "morning") target = nextLocalHour(7, now) + 60_000;
  else target = now + Math.max(1, Math.min(72, opts.hours ?? 1)) * HOUR_MS;
  const delta = target - now;
  addOffsetMs(delta);
  const ticks = runDueTicks();
  metric("test_fast_forward", { hours: delta / HOUR_MS, ticks });
  logEvent({ kind: "system", text: `🧪 测试快进 ${Math.round((delta / HOUR_MS) * 10) / 10} 小时（正式玩法为现实时间 1:1）`, actors: [], importance: 1 });
  // Let immediate distillations settle (offline: <1 s).
  for (let i = 0; i < 40; i++) {
    const { distillingCount } = await import("./distillation");
    if (distillingCount() === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { hours: delta / HOUR_MS, ticks };
}

// Right after onboarding the Agent should visibly set off, not wait for the
// next hour boundary.
export function kickPlayer(agentId: string): void {
  const hour = localParts(simNow()).hour;
  if (hour >= 23 || hour < 6) {
    moveTo(agentId, "home", "sleeping", "天黑了，先回家睡下（06:00 醒来出发）");
    getDb().prepare("UPDATE agents SET emote = 'sleep' WHERE id = ?").run(agentId);
    return;
  }
  planDay(agentId);
  if (hour <= 18) {
    startNextQueued(agentId) || chooseWork(agentId);
  }
}

