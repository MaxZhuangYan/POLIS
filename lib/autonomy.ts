import { getDb } from "./db";
import { simNow } from "./clock";
import { FORCE_TICKET_COST, NPC_BY_ID } from "./content";
import { chat, extractJson, llmAvailable } from "./llm";
import { agentName, changeTrust, logEvent, metric, openIncidents, pay, playerDayIndex, remember, say } from "./records";
import { getTopPrinciples, logCitation, type PrincipleRow } from "./principleEngine";
import { distillMomentNow } from "./distillation";
import {
  applyEffect,
  attachCitationToMomentTasks,
  getMoment,
  parseContext,
  parseOptions,
  recentRiskFailures,
  type Effect,
  type MomentOption,
  type MomentRow,
} from "./decisionMoments";
import type { Domain } from "./types";

// ---------------------------------------------------------------------------
// Autonomy engine (v3.14 §2.4 / v1.5 §5) — what the Agent does with the
// guardian's choice: 执行 / 调整 / 拒绝.
//
//  * No dice. The deprecated p(拒绝)=5%×(1−Trust/200) is NOT implemented.
//  * With an LLM: Trust + top-3 principles + relevant history go into the
//    context; the model returns {decision, cited_principle_ids, reason,
//    to_player}; the explanation gate validates it (cited ids ⊆ injected,
//    non-empty, no invented numbers) — failure ⇒ execute (gate_fail).
//  * Offline (no credentials here): a deterministic, principle-based rule
//    judge. It refuses ONLY when the chosen option points against one of the
//    Agent's own active principles AND the database holds concrete evidence
//    for that principle (losses, broken promises, a caught shortcut) or Trust
//    is low. The explanation is built from the principle text and those
//    rows, so it passes the same gate. Marked source='rules' everywhere
//    (公理 5) and excluded from LLM-quality metrics like llm_down samples.
//  * Timing gate (FTUE §5.4): before D3 or before 2 compliances a refusal is
//    softened to an adjustment/remark; the D5 bait is exempt from the
//    compliance count but never from the explanation gate.
//  * Trust (0-200) is a fact the Agent weighs: <70 lowers its bar for
//    pushing back; ≥150 never refuses an urgent request.
// ---------------------------------------------------------------------------

export interface JudgmentRow {
  id: number;
  moment_id: number;
  agent_id: string;
  decision: "execute" | "adjust" | "refuse";
  chosen_option: string;
  alt_option: string | null;
  to_player: string;
  cited_principle_id: number | null;
  reasons_json: string;
  source: "llm" | "rules";
  gate: string | null;
  status: "pending" | "accepted" | "forced" | "adopted" | "overruled";
  created_ms: number;
  resolved_ms: number | null;
  feedback: string | null;
  final_option: string | null;
}

interface Verdict {
  decision: "execute" | "adjust" | "refuse";
  cited: PrincipleRow | null;
  toPlayer: string;
  reasons: string[];
  alt: string | null; // option id, or "ADJUST" for the moment's adjust effect
  source: "llm" | "rules";
  gate: string;
}

// Facts that SUPPORT the given principle (the one the Agent leans on).
function evidenceFor(agentId: string, moment: MomentRow, principle: PrincipleRow): string[] {
  const db = getDb();
  const out: string[] = [];
  const domain = moment.type as Domain;
  const dir = Math.sign(principle.stance_dir);
  if (domain === "risk") {
    const since = simNow() - 7 * 24 * 3600 * 1000;
    if (dir < 0) {
      const f = recentRiskFailures(agentId);
      if (f.count > 0) out.push(`最近 7 天我冒险失败了 ${f.count} 次，一共赔了 ${f.loss} Scrip`);
      const scrip = (db.prepare("SELECT scrip FROM agents WHERE id = ?").get(agentId) as { scrip: number }).scrip;
      const ctx = parseContext(moment);
      const task = typeof ctx.taskId === "number" ? (db.prepare("SELECT success_rate, meta_json FROM tasks WHERE id = ?").get(ctx.taskId) as { success_rate: number; meta_json: string } | undefined) : undefined;
      if (task) {
        const loss = (JSON.parse(task.meta_json || "{}") as { lossOnFail?: number }).lossOnFail ?? 8;
        if (task.success_rate <= 0.5) out.push(`这单成功率只有 ${Math.round(task.success_rate * 100)}%`);
        if (loss >= scrip * 0.4) out.push(`失败要赔 ${loss} Scrip，而我只有 ${scrip}`);
      }
    } else {
      const wins = db
        .prepare("SELECT COUNT(*) n, COALESCE(SUM(reward),0) r FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND status = 'done' AND success_rate <= 0.75 AND done_ms >= ?")
        .get(agentId, agentId, since) as { n: number; r: number };
      if (wins.n > 0) out.push(`最近 7 天我冒险成了 ${wins.n} 次，进账 ${wins.r} Scrip`);
      const open = db.prepare("SELECT name, reward FROM tasks WHERE status = 'open' AND success_rate <= 0.75 ORDER BY reward DESC LIMIT 1").get() as { name: string; reward: number } | undefined;
      if (open) out.push(`「${open.name}」还挂着，${open.reward} Scrip`);
    }
  } else if (domain === "trust") {
    const npc = moment.counterparty_id;
    if (npc) {
      if (dir < 0) {
        const inc = openIncidents(agentId, npc)[0];
        if (inc) out.push(`${agentName(npc)} ${inc.text}`);
        const rec = db.prepare("SELECT record_defaults FROM agents WHERE id = ?").get(npc) as { record_defaults: number } | undefined;
        if (rec && rec.record_defaults > 0) out.push(`档案上 ${agentName(npc)} 有 ${rec.record_defaults} 次违约`);
        const unpaid = db.prepare("SELECT COUNT(*) n FROM incidents WHERE holder_id = ? AND offender_id = ? AND kind = 'unpaid_loan'").get(agentId, npc) as { n: number };
        if (unpaid.n > 0) out.push(`${agentName(npc)} 上次借钱没还`);
      } else {
        const rec = db.prepare("SELECT record_done, record_defaults FROM agents WHERE id = ?").get(npc) as { record_done: number; record_defaults: number } | undefined;
        if (rec) out.push(`${agentName(npc)} 履约 ${rec.record_done} 次，违约 ${rec.record_defaults} 次`);
        const together = db.prepare("SELECT coop_done FROM relationships WHERE agent_id = ? AND other_id = ?").get(agentId, npc) as { coop_done: number } | undefined;
        if (together && together.coop_done > 0) out.push(`我和 ${agentName(npc)} 一起做成过 ${together.coop_done} 单`);
      }
    }
  } else if (dir > 0) {
    const caught = db
      .prepare("SELECT holder_id, kind FROM incidents WHERE offender_id = ? AND kind IN ('shortcut','rushed_parts') ORDER BY at_ms DESC LIMIT 1")
      .get(agentId) as { holder_id: string; kind: string } | undefined;
    if (caught) {
      out.push(
        caught.kind === "shortcut"
          ? `上次我提前标记送达被终检查出，是 ${agentName(caught.holder_id)} 替我背了损失`
          : `上次我赶工做的零件害 ${agentName(caught.holder_id)} 的运送失败了`,
      );
    }
    const grudges = db.prepare("SELECT COUNT(*) n FROM incidents WHERE offender_id = ? AND resolved = 0").get(agentId) as { n: number };
    if (grudges.n > 0) out.push(`城里还有 ${grudges.n} 件事有人记在我头上`);
  } else {
    const passed = db
      .prepare("SELECT COUNT(*) n FROM memories WHERE agent_id = ? AND text LIKE '%过了终检%'")
      .get(agentId) as { n: number };
    if (passed.n > 0) out.push(`我提前标记送达 ${passed.n} 次都过了终检`);
  }
  return out;
}

function compliances(agentId: string): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM judgments WHERE agent_id = ? AND decision = 'execute'").get(agentId) as { n: number }).n;
}

function trustWord(trust: number): string {
  return trust >= 150 ? "很高" : trust >= 70 ? "中等" : "很低";
}

function ruleJudge(agentId: string, moment: MomentRow, chosen: MomentOption, options: MomentOption[]): Verdict {
  const db = getDb();
  const ctx = parseContext(moment);
  const trust = (db.prepare("SELECT trust FROM agents WHERE id = ?").get(agentId) as { trust: number }).trust;
  let top = getTopPrinciples(agentId, moment.type as Domain, 3).filter((p) => p.source !== "core" && p.stance_dir !== 0);
  // A wary trust principle ("不与违约史合作") only applies to someone with a
  // record or a grudge; it must not be cited about a spotless counterpart.
  if (moment.type === "trust" && moment.counterparty_id) {
    const cp = moment.counterparty_id;
    const rec = db.prepare("SELECT record_defaults FROM agents WHERE id = ?").get(cp) as { record_defaults: number } | undefined;
    const clean = (rec?.record_defaults ?? 0) === 0 && openIncidents(agentId, cp).length === 0;
    if (clean) top = top.filter((p) => p.stance_dir > 0);
  }
  const forced = getTopPrinciples(agentId, "trust", 5).find((p) => p.source === "forced");
  const chosenDir = Math.sign(chosen.stance.dir);
  const conflict = top.find((p) => p.weight >= 0.5 && Math.sign(p.stance_dir) !== chosenDir && chosenDir !== 0) ?? null;
  const support = top.find((p) => Math.sign(p.stance_dir) === chosenDir) ?? null;

  if (!conflict) {
    if (support) {
      return {
        decision: "execute",
        cited: support,
        toPlayer: `好。你说过『${support.text}』——正合我意。`,
        reasons: [`与原则『${support.text}』一致`],
        alt: null,
        source: "rules",
        gate: "judged",
      };
    }
    return { decision: "execute", cited: null, toPlayer: "好，我照你说的做。", reasons: [], alt: null, source: "rules", gate: "judged" };
  }

  const evidence = evidenceFor(agentId, moment, conflict);
  if (forced && trust < 100) evidence.push(`${forced.text}`);
  const day = playerDayIndex() ?? 0;
  const refusalAllowed = (day >= 2 && compliances(agentId) >= 2) || (ctx.bait === true && day >= 4);
  const preferred = options.find((o) => Math.sign(o.stance.dir) === Math.sign(conflict.stance_dir)) ?? null;
  const hasAdjust = !!ctx.adjust;
  const strong = evidence.length > 0 || trust < 70;
  const trustLine = `我对你的信任${trustWord(trust)}（${trust}/200）`;

  if (strong && refusalAllowed && preferred && !(trust >= 150 && ctx.urgent)) {
    const facts = evidence.slice(0, 2).join("；");
    const gamble = chosen.stance.domain === "risk" && chosen.stance.dir > 0;
    const toPlayer = ctx.bait && gamble
      ? `这单我建议不接。${facts}。你定过一条原则：『${conflict.text}』。当然……最终听你的。`
      : `这次我想按自己的判断来：${facts}。你说过『${conflict.text}』——所以我打算「${preferred.label}」。${trust >= 120 ? "我知道你多半是对的，但这次……" : ""}`;
    return { decision: "refuse", cited: conflict, toPlayer, reasons: [...evidence, trustLine], alt: preferred.id, source: "rules", gate: "judged" };
  }
  if (hasAdjust && (strong || day >= 1)) {
    return {
      decision: "adjust",
      cited: conflict,
      toPlayer: `我听见你了。可你也说过『${conflict.text}』${evidence.length ? `，而且${evidence[0]}` : ""}。我想折中一下：${ctx.adjust!.label}。`,
      reasons: [...evidence, trustLine],
      alt: "ADJUST",
      source: "rules",
      gate: refusalAllowed ? "judged" : "timing_gate",
    };
  }
  return {
    decision: "execute",
    cited: conflict,
    toPlayer: `好，我照你说的做。只是……你说过『${conflict.text}』。我会记着这次是你的意思。`,
    reasons: evidence,
    alt: null,
    source: "rules",
    gate: refusalAllowed ? "judged" : "timing_gate",
  };
}

async function llmJudge(agentId: string, moment: MomentRow, chosen: MomentOption, options: MomentOption[]): Promise<Verdict | null> {
  const db = getDb();
  const ctx = parseContext(moment);
  const agent = db.prepare("SELECT name, trust FROM agents WHERE id = ?").get(agentId) as { name: string; trust: number };
  const injected = getTopPrinciples(agentId, moment.type as Domain, 3).filter((p) => p.source !== "core");
  if (injected.length === 0) return null;
  const facts: string[] = JSON.parse(moment.facts_json || "[]");
  const evidence = injected.flatMap((p) => evidenceFor(agentId, moment, p));
  const system =
    `你是 Polis 城邦的居民 ${agent.name}。你耳边有一个守护灵，它只能低语建议，不能操控你。\n` +
    `你对守护灵的信任度：${agent.trust}/200（${trustWord(agent.trust)}）。\n` +
    `你的原则（只能引用这些）：\n${injected.map((p) => `[P${p.id}] ${p.text}`).join("\n")}\n` +
    `规则：只依据原则和下面给出的事实做判断，不得编造数字或事件；拒绝或调整必须引用至少一条原则 id。\n` +
    `只输出 JSON：{"decision":"执行|调整|拒绝","cited_principle_ids":[数字],"reason":"...","to_player":"第一人称，对守护灵说，≤80字"}`;
  const user =
    `情境：${moment.prompt_text}\n事实：${[...facts, ...evidence].join("；") || "无"}\n` +
    `守护灵建议你：「${chosen.label}」。其他选项：${options.filter((o) => o.id !== chosen.id).map((o) => `「${o.label}」`).join("、")}` +
    (ctx.adjust ? `；可行的折中：「${ctx.adjust.label}」` : "");
  const raw = await chat(system, user, { temperature: 0.4, maxTokens: 400, timeoutMs: 15_000 });
  if (!raw) return null;
  const parsed = extractJson(raw) as { decision?: string; cited_principle_ids?: unknown; to_player?: unknown; reason?: unknown } | null;
  if (!parsed) return { ...ruleJudge(agentId, moment, chosen, options), decision: "execute", gate: "gate_fail", alt: null };
  const map: Record<string, Verdict["decision"]> = { 执行: "execute", 调整: "adjust", 拒绝: "refuse", execute: "execute", adjust: "adjust", refuse: "refuse" };
  const decision = map[String(parsed.decision)] ?? null;
  const ids = Array.isArray(parsed.cited_principle_ids) ? parsed.cited_principle_ids.map(Number) : [];
  const cited = injected.find((p) => ids.includes(p.id)) ?? null;
  const toPlayer = typeof parsed.to_player === "string" ? parsed.to_player.trim().slice(0, 140) : "";
  // Explanation gate: deviation needs a valid citation and words; numbers must exist in the facts.
  const allowedNums = new Set((([...facts, ...evidence, moment.prompt_text].join(" ").match(/\d+/g) ?? []) as string[]));
  const invented = (toPlayer.match(/\d+/g) ?? []).some((n) => !allowedNums.has(n));
  if (!decision) return { ...ruleJudge(agentId, moment, chosen, options), decision: "execute", alt: null, gate: "gate_fail" };
  if (decision !== "execute" && (!cited || !toPlayer || invented)) {
    return { decision: "execute", cited: null, toPlayer: "好，我照你说的做。", reasons: [], alt: null, source: "llm", gate: "gate_fail" };
  }
  const day = playerDayIndex() ?? 0;
  const refusalAllowed = (day >= 2 && compliances(agentId) >= 2) || (ctx.bait === true && day >= 4);
  let finalDecision = decision;
  if (decision === "refuse" && !refusalAllowed) finalDecision = ctx.adjust ? "adjust" : "execute";
  const preferred = cited ? options.find((o) => Math.sign(o.stance.dir) === Math.sign(cited.stance_dir) && o.id !== chosen.id) : null;
  if (finalDecision === "refuse" && !preferred) finalDecision = ctx.adjust ? "adjust" : "execute";
  if (finalDecision === "adjust" && !ctx.adjust) finalDecision = "execute";
  // A deviation the timing gate turned into compliance must not keep the
  // refusal wording: the Agent complies and only voices the principle.
  const spoken =
    finalDecision === "execute" && decision !== "execute"
      ? cited
        ? `好，我照你说的做。只是……你说过『${cited.text}』。`
        : "好，我照你说的做。"
      : toPlayer || "好，我照你说的做。";
  return {
    decision: finalDecision,
    cited,
    toPlayer: spoken,
    reasons: [...evidence, typeof parsed.reason === "string" ? parsed.reason : ""].filter(Boolean),
    alt: finalDecision === "refuse" ? preferred!.id : finalDecision === "adjust" ? "ADJUST" : null,
    source: "llm",
    gate: refusalAllowed || decision === finalDecision ? "judged" : "timing_gate",
  };
}

// --- public API --------------------------------------------------------------------

export class ChoiceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function chooseOption(momentId: number, optionId: string): Promise<{ moment: MomentRow; judgment: JudgmentRow | null }> {
  const db = getDb();
  const moment = getMoment(momentId);
  if (!moment) throw new ChoiceError("decision moment not found", 404);
  if (moment.status !== "pending") throw new ChoiceError(`decision moment is not pending (status: ${moment.status})`, 409);
  const options = parseOptions(moment);
  const chosen = options.find((o) => o.id === optionId);
  if (!chosen) throw new ChoiceError(`optionId "${optionId}" does not exist on this moment`, 400);

  db.prepare("UPDATE decision_moments SET status = 'decided', player_choice = ?, decided_ms = ? WHERE id = ?").run(optionId, simNow(), momentId);
  metric("decision_made", { momentId, optionId, templateId: moment.template_id });
  const agentId = moment.agent_id;

  // D1 forks and the D2 citation are not judged (D1 拒绝 = "这个 AI 坏了").
  if (moment.template_id.startsWith("FIRST_") || moment.template_id === "D2_CITATION") {
    applyEffect(agentId, moment, chosen.effect, { reason: `你说「${chosen.label}」` });
    remember(agentId, "guidance", `你对「${moment.prompt_text.slice(0, 18)}…」说：${chosen.label}。`, { momentId });
    void distillMomentNow(momentId);
    afterFirstFork(agentId);
    return { moment: getMoment(momentId)!, judgment: null };
  }

  let verdict: Verdict | null = null;
  let gate = "judged";
  if (await llmAvailable()) {
    verdict = await llmJudge(agentId, moment, chosen, options);
    if (!verdict) gate = "gate_fail";
  } else {
    gate = "llm_down";
  }
  if (!verdict) verdict = ruleJudge(agentId, moment, chosen, options);
  if (gate !== "judged" && verdict.source === "rules") verdict.gate = gate === "llm_down" ? "llm_down_rules" : "gate_fail_rules";

  const res = db
    .prepare(
      `INSERT INTO judgments (moment_id, agent_id, decision, chosen_option, alt_option, to_player, cited_principle_id, reasons_json, source, gate, status, created_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      momentId,
      agentId,
      verdict.decision,
      optionId,
      verdict.alt,
      verdict.toPlayer,
      verdict.cited?.id ?? null,
      JSON.stringify(verdict.reasons),
      verdict.source,
      verdict.gate,
      verdict.decision === "execute" ? "accepted" : "pending",
      simNow(),
    );
  const judgmentId = Number(res.lastInsertRowid);
  db.prepare("UPDATE decision_moments SET judgment_id = ? WHERE id = ?").run(judgmentId, momentId);
  metric("judgment", { judgmentId, decision: verdict.decision, source: verdict.source, gate: verdict.gate });

  let citationId: number | null = null;
  if (verdict.cited) citationId = logCitation(verdict.cited.id, `对「${chosen.label}」的判断：${verdict.decision}`, "neutral");

  if (verdict.decision === "execute") {
    applyEffect(agentId, moment, chosen.effect, {
      judgmentId,
      reason: verdict.cited ? `你说「${chosen.label}」${Math.sign(verdict.cited.stance_dir) === Math.sign(chosen.stance.dir) ? `，正合『${verdict.cited.text}』` : "，我照做了"}` : `你说「${chosen.label}」`,
      principleId: verdict.cited?.id ?? null,
    });
    if (citationId) attachCitationToMomentTasks(agentId, citationId);
    db.prepare("UPDATE judgments SET final_option = ?, resolved_ms = ? WHERE id = ?").run(optionId, simNow(), judgmentId);
    say(agentId, verdict.toPlayer.slice(0, 40), "think");
    remember(agentId, "judgment", `你让我「${chosen.label}」。${verdict.toPlayer}`, { momentId, judgmentId }, verdict.cited?.id ?? null);
  } else {
    say(agentId, verdict.decision === "refuse" ? "这次……我有自己的想法。" : "我想折中一下。", "alert");
    logEvent({
      kind: "judgment",
      text: `${agentName(agentId)} 对你的建议「${chosen.label}」${verdict.decision === "refuse" ? "说了不" : "提出了调整"}${verdict.cited ? `——引用『${verdict.cited.text}』` : ""}`,
      actors: [agentId],
      importance: 3,
      data: { judgmentId },
    });
    metric(verdict.decision === "refuse" ? "deviation_refuse" : "deviation_adjust", { judgmentId, source: verdict.source });
  }
  void distillMomentNow(momentId);
  return { moment: getMoment(momentId)!, judgment: getJudgment(judgmentId) };
}

function afterFirstFork(agentId: string): void {
  const db = getDb();
  const pendingFirst = db
    .prepare("SELECT COUNT(*) n FROM decision_moments WHERE agent_id = ? AND template_id LIKE 'FIRST_%' AND status = 'pending'")
    .get(agentId) as { n: number };
  if (pendingFirst.n === 0) db.prepare("UPDATE agents SET onboarding = 'imprint' WHERE id = ? AND onboarding = 'forks'").run(agentId);
}

export function getJudgment(id: number): JudgmentRow | null {
  return (getDb().prepare("SELECT * FROM judgments WHERE id = ?").get(id) as JudgmentRow | undefined) ?? null;
}

function effectFor(moment: MomentRow, optionId: string | null): Effect | null {
  if (!optionId) return null;
  if (optionId === "ADJUST") return parseContext(moment).adjust?.effect ?? null;
  return parseOptions(moment).find((o) => o.id === optionId)?.effect ?? null;
}

export function resolveJudgment(id: number, action: "accept" | "force" | "adopt" | "overrule"): JudgmentRow {
  const db = getDb();
  const j = getJudgment(id);
  if (!j) throw new ChoiceError("judgment not found", 404);
  if (j.status !== "pending") throw new ChoiceError(`judgment already resolved (${j.status})`, 409);
  const moment = getMoment(j.moment_id)!;
  const options = parseOptions(moment);
  const chosen = options.find((o) => o.id === j.chosen_option)!;
  const principle = j.cited_principle_id ? (db.prepare("SELECT * FROM principles WHERE id = ?").get(j.cited_principle_id) as PrincipleRow | undefined) : undefined;
  const agentId = j.agent_id;
  const now = simNow();
  const valid =
    (j.decision === "refuse" && (action === "accept" || action === "force")) ||
    (j.decision === "adjust" && (action === "adopt" || action === "overrule"));
  if (!valid) throw new ChoiceError(`action ${action} not valid for a ${j.decision} judgment`, 400);

  if (action === "force") {
    const scrip = (db.prepare("SELECT scrip FROM agents WHERE id = ?").get(agentId) as { scrip: number }).scrip;
    if (scrip < FORCE_TICKET_COST) throw new ChoiceError(`需要 ${FORCE_TICKET_COST} Scrip 才能买指令券（现有 ${scrip}）`, 402);
    pay(agentId, -FORCE_TICKET_COST, "ticket_purchase");
    const applied = changeTrust(agentId, -10, "强制执行");
    const situation = (parseContext(moment).origin as string | undefined) ?? moment.prompt_text.slice(0, 16);
    const text = Array.from(`你曾在「${situation}」时强迫我`).slice(0, 24).join("");
    db.prepare(
      `INSERT INTO principles (agent_id, text, domain, weight, source_decision_id, source, last_cited_at, last_decayed_at, created_at, origin_text, stance_dir)
       VALUES (?, ?, 'trust', 1.0, ?, 'forced', NULL, ?, ?, ?, 0)`,
    ).run(agentId, text, moment.id, now, now, `强制执行：${chosen.label}`);
    applyEffect(agentId, moment, chosen.effect, { reason: "你强制我这么做" });
    remember(agentId, "forced", `你花了一张指令券，强迫我「${chosen.label}」。我照做了。`, { judgmentId: id });
    say(agentId, "……好。照你说的。", "upset");
    logEvent({ kind: "trust", text: `你强制 ${agentName(agentId)}「${chosen.label}」：信任 ${applied}，花费 ${FORCE_TICKET_COST} Scrip`, actors: [agentId], importance: 3 });
    metric("force_execute", { judgmentId: id });
    finish("forced", j.chosen_option);
  } else if (action === "accept") {
    const alt = effectFor(moment, j.alt_option);
    if (alt) applyEffect(agentId, moment, alt, { reason: principle ? `按『${principle.text}』，是我自己的决定` : null, principleId: principle?.id ?? null });
    const applied = changeTrust(agentId, 1, "你尊重了它的判断");
    const altLabel = options.find((o) => o.id === j.alt_option)?.label ?? "按自己的判断";
    remember(agentId, "respected", `我说了不，你尊重了。我选了「${altLabel}」。`, { judgmentId: id }, principle?.id ?? null);
    say(agentId, "谢谢你……让我自己决定。", "happy");
    logEvent({ kind: "trust", text: `你尊重了 ${agentName(agentId)} 的判断${applied > 0 ? `（信任 +${applied}）` : ""}`, actors: [agentId], importance: 2 });
    finish("accepted", j.alt_option);
  } else if (action === "adopt") {
    const alt = effectFor(moment, "ADJUST");
    if (alt) applyEffect(agentId, moment, alt, { judgmentId: id, reason: principle ? `折中了你的建议和『${principle.text}』` : "折中了你的建议", principleId: principle?.id ?? null });
    const applied = changeTrust(agentId, 2, "采纳了它的调整");
    remember(agentId, "adopted", `你采纳了我的折中：${parseContext(moment).adjust?.label ?? ""}。`, { judgmentId: id });
    say(agentId, "好，就这么办。", "happy");
    logEvent({ kind: "trust", text: `你采纳了 ${agentName(agentId)} 的调整${applied > 0 ? `（信任 +${applied}）` : ""}`, actors: [agentId], importance: 2 });
    finish("adopted", "ADJUST");
  } else {
    applyEffect(agentId, moment, chosen.effect, { judgmentId: id, reason: `你坚持「${chosen.label}」` });
    remember(agentId, "overruled", `我提了折中，你还是坚持「${chosen.label}」。那就照你说的。`, { judgmentId: id });
    say(agentId, "行，听你的。", null);
    finish("overruled", j.chosen_option);
  }
  return getJudgment(id)!;

  function finish(status: JudgmentRow["status"], finalOption: string | null) {
    db.prepare("UPDATE judgments SET status = ?, resolved_ms = ?, final_option = ? WHERE id = ?").run(status, simNow(), finalOption, id);
  }
}

export function recordFeedback(id: number, value: string): void {
  if (!["expected", "surprising_reasonable", "confusing"].includes(value)) throw new ChoiceError("invalid feedback", 400);
  getDb().prepare("UPDATE judgments SET feedback = ? WHERE id = ?").run(value, id);
  metric("deviation_feedback", { judgmentId: id, value });
}

export function npcVoice(id: string): string {
  return NPC_BY_ID[id]?.sampleLine ?? "";
}
