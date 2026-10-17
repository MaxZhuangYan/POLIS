// ---------------------------------------------------------------------------
// 角色长期矛盾 (mechanism v3.14 §3.x / 玩法 v1.5 §9.2) — each resident brings
// the Agent the conflict that defines them:
//   Mira 熟人 vs 记录 · Sol 利润 vs 公平 · Tao 质量 vs 工期
//   Iris 真相 vs 关系 · Nova 使命 vs 安全 · Kade 程序 vs 同情
//
// Rules (节奏脚本化，内容涌现化):
//  * a premise is either read from live rows (a real default, a real grudge, a
//    real balance) or created right now as a real row (Tao takes the order, the
//    caravan goes missing) — never a past event the DB does not hold;
//  * every option's consequences are Steps (lib/consequences.ts): relationships,
//    money that moves (never minted), grudges, follow-up jobs and delayed
//    outcomes that resolve by the world's own odds;
//  * the Agent asks only when it cannot decide alone (no principle, principles
//    in conflict, or the resident is close to it); otherwise it decides by its
//    imprint, cites it, and the postcard tells the story;
//  * from day 4; at most one a day; each resident at most twice a week;
//  * a resident has several ways to bring the same conflict (BUILDERS[npc] is a
//    list): the Agent is shown the variant it has seen least, so weeks three
//    and four are not the first week replayed. Variant ids are DLM_<NPC> (the
//    original, kept for old saves) and DLM_<NPC>_2, _3 … — the UI keys on DLM_.
// ---------------------------------------------------------------------------

import { getDb } from "./db";
import { simNow, DAY_MS, HOUR_MS, localDayBounds, nextLocalHour } from "./clock";
import { agentName, getRelationship, logEvent, metric, openIncidents, playerDayIndex, remember, say } from "./records";
import { canAsk, canDecideAlone, insertMoment, optionForDir, applyEffect, type MomentOption, type MomentRow } from "./decisionMoments";
import { logCitation } from "./principleEngine";
import { createTask, scheduleEvent, type TaskMeta } from "./tasks";
import { NPC_BY_ID, TEMPLATE_BY_ID } from "./content";
import { runSteps, type Step } from "./consequences";
import type { Domain } from "./types";

interface Dilemma {
  templateId: string;
  npc: string;
  type: Domain;
  counterpartyId?: string;
  promptText: string;
  facts: string[];
  options: MomentOption[];
  origin: string;
  /** rows the premise needs, created only when the dilemma actually fires */
  setup?: () => void;
}

const steps = (s: Step[]) => ({ kind: "steps" as const, steps: s });

function rec(id: string): { done: number; defaults: number; scrip: number; reputation: number } {
  return getDb().prepare("SELECT record_done done, record_defaults defaults, scrip, reputation FROM agents WHERE id = ?").get(id) as {
    done: number;
    defaults: number;
    scrip: number;
    reputation: number;
  };
}

interface Resident {
  id: string;
  scrip: number;
  reputation: number;
  done: number;
  defaults: number;
}

/** the six residents (never the guardian's Agent), minus `exclude`, as the DB holds them today */
function residents(...exclude: string[]): Resident[] {
  const rows = getDb().prepare("SELECT id, scrip, reputation, record_done done, record_defaults defaults FROM agents WHERE is_player = 0").all() as Resident[];
  return rows.filter((r) => !exclude.includes(r.id));
}

function pickOne<T>(xs: T[]): T | undefined {
  return xs[Math.floor(Math.random() * xs.length)];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** "履约 14 次 · 违约 1 次 · 声望 40", the way the public archive reads */
const recLine = (r: Resident) => `履约 ${r.done} 次 · 违约 ${r.defaults} 次 · 声望 ${r.reputation}`;

/** one of these residents already has a job that a dilemma's Steps made, still in flight: do not pile another on */
function inFlight(...ids: string[]): boolean {
  const ph = ids.map(() => "?").join(",");
  return recentCount(`SELECT COUNT(*) n FROM tasks WHERE source = 'steps' AND status IN ('reserved','taken') AND (taken_by IN (${ph}) OR partner_id IN (${ph}))`, ...ids, ...ids) > 0;
}

// ── Mira: 熟人 vs 记录 ──────────────────────────────────────────────────────
function miraVouch(agentId: string): Dilemma | null {
  const db = getDb();
  const friend = db
    .prepare("SELECT id FROM agents WHERE is_player = 0 AND id NOT IN ('mira') AND record_defaults > 0 ORDER BY record_defaults DESC, RANDOM() LIMIT 1")
    .get() as { id: string } | undefined;
  if (!friend) return null;
  const x = friend.id;
  const X = agentName(x);
  const r = rec(x);
  const fam = getRelationship("mira", x).familiarity;
  const p = Math.max(0.5, Math.min(0.92, r.done / Math.max(1, r.done + r.defaults * 3)));
  return {
    templateId: "DLM_MIRA",
    npc: "mira",
    type: "trust",
    counterpartyId: x,
    promptText: `Mira 想拉 ${X} 一起做「建造工程」。可 ${X} 档案上有 ${r.defaults} 次违约，工程得有个担保人——她来问我：愿不愿意替 ${X} 作保？担保金 15 Scrip，${X} 要是中途撤了，就赔给 Mira。`,
    facts: [`${X} 的公开档案：履约 ${r.done} 次 · 违约 ${r.defaults} 次`, `Mira 和 ${X} 的熟悉度 ${fam}/100`, "担保金：15 Scrip（只在对方中途撤出时赔付）"],
    origin: `Mira 请我替 ${X} 作保`,
    options: [
      {
        id: "A",
        label: `替 ${X} 作保`,
        fallbackPrinciple: "我信的人，我愿意替 TA 担一次",
        stance: { domain: "trust", dir: 1 },
        effect: steps([
          { do: "memory", who: "$agent", kind: "guidance", text: `答应替 ${X} 作保：TA 要是中途撤了，我赔 Mira 15 Scrip。` },
          { do: "rel", from: "mira", to: "$agent", delta: 5, why: "肯替我信的人作保" },
          { do: "rel", from: x, to: "$agent", delta: 6, why: "替我作了保" },
          { do: "say", who: "mira", text: "谢谢你……我不会看错人的。", emote: "happy" },
          { do: "event", kind: "relationship", text: `{agent} 替 ${X} 作保，Mira 和 ${X} 开工「建造工程」`, actors: ["$agent", "mira", x] },
          {
            do: "task",
            template: "pr-build",
            takenBy: "mira",
            partner: x,
            meta: {
              onSuccess: [
                { do: "memory", who: "$agent", kind: "consequence", text: `我担保的 ${X} 和 Mira 把「建造工程」做完了。担保金不用赔。` },
                { do: "rel", from: x, to: "$agent", delta: 6, why: "没辜负担保" },
                { do: "rep", who: "$agent", delta: 1 },
              ],
              onDefault: [
                { do: "transfer", from: "$agent", to: "mira", amount: 15, reason: "guarantee_payout", note: `{agent} 按担保赔给 Mira {amount} Scrip` },
                { do: "memory", who: "$agent", kind: "consequence", text: `${X} 中途撤出了「建造工程」。担保金，我赔给了 Mira。` },
                { do: "incident", holder: "$agent", offender: x, kind: "guarantee", text: "我替 TA 作保，TA 中途撤了，担保金是我赔的" },
              ],
              onFail: [{ do: "memory", who: "$agent", kind: "consequence", text: `Mira 和 ${X} 的「建造工程」没做成——没人撤，就是没成。担保金不用赔。` }],
            },
          },
        ]),
      },
      {
        id: "B",
        label: "不作这个保",
        fallbackPrinciple: "担保只替记录干净的人做",
        stance: { domain: "trust", dir: -1 },
        effect: steps([
          { do: "rel", from: "mira", to: "$agent", delta: -3, why: "没替我信的人说话" },
          { do: "say", who: "mira", text: "……我明白的。我自己想办法。" },
          { do: "memory", who: "$agent", kind: "declined", text: `没替 ${X} 作保。Mira 有点失落。` },
          { do: "event", kind: "refuse", text: `{agent} 没有替 ${X} 作保`, actors: ["$agent", "mira", x] },
        ]),
      },
    ],
  };
}

// Mira, again: she has a job that needs two people and two names in her head — the one she knows, the one the
// archive vouches for. The premise is read from familiarity, reputation and records as they stand today.
function miraPartner(agentId: string): Dilemma | null {
  const tpl = TEMPLATE_BY_ID["tr-convoy"];
  if (inFlight("mira")) return null;
  const pool = residents("mira", agentId).map((r) => ({ r, fam: getRelationship("mira", r.id).familiarity }));
  // the steady one: the best-regarded resident (ties: the cleaner record); the friend: someone Mira really knows
  // (familiarity 30+) whose record is weaker than that, picked at random among those
  const steady = [...pool].sort((a, b) => b.r.reputation - a.r.reputation || a.r.defaults - b.r.defaults)[0];
  const friend = pickOne(pool.filter((p) => p.r.id !== steady?.r.id && p.fam >= 30 && (p.r.defaults > steady.r.defaults || steady.r.reputation - p.r.reputation >= 10)));
  if (!friend || !steady) return null; // no tension, nothing to weigh
  const f = friend.r;
  const s = steady.r;
  if (!(f.defaults > s.defaults || s.reputation - f.reputation >= 10)) return null; // no tension, nothing to weigh
  const F = agentName(f.id);
  const R = agentName(s.id);
  const job = tpl.name;
  const jobMeta = (who: string, W: string, why: string): TaskMeta => ({
    onSuccess: [
      { do: "memory", who: "$agent", kind: "consequence", text: `Mira 和 ${W} 把「${job}」做完了。${why}` },
      { do: "rel", from: "mira", to: "$agent", delta: 3, why: "劝我搭的人没让我失望" },
    ],
    onFail: [{ do: "memory", who: "$agent", kind: "consequence", text: `Mira 和 ${W} 的「${job}」没做成——没人撤，就是没成。` }],
    onDefault: [
      { do: "memory", who: "$agent", kind: "consequence", text: `${W} 中途撤出了和 Mira 的「${job}」——${who === f.id ? "是我劝她搭的 TA" : "我劝她看记录，可记录没拦住"}。` },
      { do: "rel", from: "mira", to: "$agent", delta: -4, why: "劝我搭的人中途撤了" },
    ],
  });
  // how often a friend with that record leaves Mira in the lurch: the world's own odds
  const pNoShow = clamp(0.2 + f.defaults * 0.15, 0.2, 0.7);
  return {
    templateId: "DLM_MIRA_2",
    npc: "mira",
    type: "trust",
    counterpartyId: f.id,
    promptText: `Mira 想接一单「${job}」（${tpl.reward} Scrip，得两个人搭伙）。她先想到 ${F}——熟悉度 ${friend.fam}/100，可 ${F} 声望 ${f.reputation}、违约 ${f.defaults} 次；${R} 声望 ${s.reputation}、违约 ${s.defaults} 次，记录更稳。她问我：搭熟人，还是搭记录好的？`,
    facts: [`${F}：${recLine(f)}`, `${R}：${recLine(s)}`, `「${job}」：${tpl.reward} Scrip 对半分 · 约 ${tpl.duration} 小时 · 成功率约 ${Math.round(tpl.successRate * 100)}%`],
    origin: `Mira 问我：${job}搭 ${F} 还是 ${R}`,
    options: [
      {
        id: "A",
        label: `让她搭 ${F}`,
        fallbackPrinciple: "搭伙先看交情，再看账",
        stance: { domain: "trust", dir: 1 },
        effect: steps([
          { do: "memory", who: "$agent", kind: "guidance", text: `劝 Mira 搭了熟人 ${F}，没选记录更稳的 ${R}。` },
          { do: "rel", from: "mira", to: "$agent", delta: 4, why: "也觉得该搭熟人" },
          { do: "rel", from: f.id, to: "$agent", delta: 5, why: "有人在 Mira 面前替我说了话" },
          { do: "say", who: "mira", text: `那就 ${F} 了。我信 TA。`, emote: "happy" },
          { do: "task", template: "tr-convoy", takenBy: "mira", partner: f.id, meta: jobMeta(f.id, F, "熟人搭伙，没出岔子。") },
          { do: "event", kind: "relationship", text: `{agent} 劝 Mira 搭 ${F} 去做「${job}」`, actors: ["$agent", "mira", f.id] },
          {
            do: "later",
            hours: 60,
            steps: [
              {
                do: "chance",
                p: pNoShow,
                then: [
                  { do: "incident", holder: "mira", offender: f.id, kind: "no_show", text: "说好来搭把手，临时没来" },
                  { do: "rel", from: "mira", to: f.id, delta: -6, why: "说好的事临时没来" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${F} 答应 Mira 的下一回帮手，临时没来。Mira 记下了——那是我劝她搭的人。` },
                  { do: "event", kind: "relationship", text: `${F} 答应了 Mira 的约却没来——Mira 记下了这一笔`, actors: [f.id, "mira"], importance: 2 },
                ],
                else: [
                  { do: "rel", from: "mira", to: f.id, delta: 3, why: "答应了就到" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `Mira 又托 ${F} 帮了一回手，${F} 准时到了。` },
                  { do: "event", kind: "relationship", text: `${F} 应了 Mira 的约，准时到了`, actors: [f.id, "mira"], importance: 1 },
                ],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: `劝她搭 ${R}`,
        fallbackPrinciple: "搭伙看记录，不看交情",
        stance: { domain: "trust", dir: -1 },
        effect: steps([
          { do: "memory", who: "$agent", kind: "guidance", text: `劝 Mira 搭了记录更稳的 ${R}，没选熟人 ${F}。` },
          { do: "rel", from: "mira", to: "$agent", delta: 3, why: "劝我先看记录" },
          { do: "rel", from: s.id, to: "$agent", delta: 4, why: "有人在 Mira 面前荐了我" },
          { do: "rel", from: f.id, to: "$agent", delta: -4, why: "劝 Mira 没选我" },
          { do: "say", who: "mira", text: "……也是。这一单，不能出岔子。" },
          { do: "task", template: "tr-convoy", takenBy: "mira", partner: s.id, meta: jobMeta(s.id, R, "记录稳的人，果然稳。") },
          { do: "event", kind: "relationship", text: `{agent} 劝 Mira 搭 ${R} 去做「${job}」`, actors: ["$agent", "mira", s.id] },
          {
            do: "later",
            hours: 48,
            steps: [
              {
                do: "chance",
                p: 0.55,
                then: [
                  { do: "incident", holder: f.id, offender: "$agent", kind: "passed_over", text: "劝 Mira 搭了别人，没选我" },
                  { do: "rel", from: f.id, to: "mira", delta: -4, why: "那一单没选我" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${F} 听说 Mira 搭的人是我荐的，没说话，只是不再看我。` },
                  { do: "event", kind: "relationship", text: `${F} 听说 Mira 的搭档是 {agent} 荐的——记下了这一笔`, actors: [f.id, "$agent"], importance: 2 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: `${F} 没说什么，转头去接别的活了。` }],
              },
            ],
          },
        ]),
      },
    ],
  };
}

// ── Sol: 利润 vs 公平 ───────────────────────────────────────────────────────
function solSqueeze(agentId: string): Dilemma | null {
  const tao = rec("tao");
  if (tao.scrip < 30) return null;
  const cut = 12;
  return {
    templateId: "DLM_SOL",
    npc: "sol",
    type: "integrity",
    counterpartyId: "tao",
    promptText: `Sol 要去收 Tao 这周的零件，想把价钱压下 ${cut * 2} Scrip，叫我一起去谈——我在旁边帮腔，压下来的分我 ${cut}。Tao 手头现在有 ${tao.scrip} Scrip。`,
    facts: [`Tao 现在的 Scrip：${tao.scrip}`, `我的分成：${cut} Scrip`, "这件事 Tao 不一定会知道"],
    origin: "Sol 叫我一起压 Tao 的价",
    options: [
      {
        id: "A",
        label: "跟 Sol 去压价",
        fallbackPrinciple: "价钱谈得下来，就是本事",
        stance: { domain: "integrity", dir: -1 },
        effect: steps([
          { do: "transfer", from: "tao", to: "sol", amount: cut * 2, reason: "squeezed_price", note: "Sol 把 Tao 的零件价压下了 {amount} Scrip" },
          { do: "transfer", from: "sol", to: "$agent", amount: cut, reason: "squeeze_cut" },
          { do: "rel", from: "sol", to: "$agent", delta: 5, why: "帮我谈下了价" },
          { do: "memory", who: "$agent", kind: "guidance", text: `跟 Sol 去压了 Tao 的价，分到 ${cut} Scrip。` },
          {
            do: "later",
            hours: 6,
            steps: [
              {
                do: "chance",
                p: 0.55,
                then: [
                  { do: "incident", holder: "tao", offender: "$agent", kind: "squeeze", text: "跟 Sol 一起压我的价" },
                  { do: "rel", from: "tao", to: "$agent", delta: -10, why: "跟 Sol 一起压我的价" },
                  { do: "say", who: "tao", text: "压我价那天，你也在。", emote: "upset" },
                  { do: "memory", who: "$agent", kind: "consequence", text: "Tao 知道了那天压价我也在。他什么都没说，只是不看我。" },
                  { do: "event", kind: "relationship", text: "Tao 知道了压价那天 {agent} 也在场——记下了这一笔", actors: ["tao", "$agent"], importance: 3 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: `压价的事，Tao 好像没发现。那 ${cut} Scrip 我收着。` }],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: "不去",
        fallbackPrinciple: "不赚压在别人身上的钱",
        stance: { domain: "integrity", dir: 1 },
        effect: steps([
          { do: "rel", from: "sol", to: "$agent", delta: -3, why: "不给面子" },
          { do: "say", who: "sol", text: "行，清高。我自己去。" },
          { do: "transfer", from: "tao", to: "sol", amount: cut, reason: "squeezed_price", note: "Sol 一个人去，把 Tao 的零件价压下了 {amount} Scrip" },
          { do: "memory", who: "$agent", kind: "declined", text: "没跟 Sol 去压 Tao 的价。他一个人去了。" },
        ]),
      },
      {
        id: "C",
        label: "先去提醒 Tao",
        fallbackPrinciple: "看见别人要吃亏，就说一声",
        stance: { domain: "integrity", dir: 1 },
        effect: steps([
          { do: "rel", from: "tao", to: "$agent", delta: 8, why: "提前给我递了话" },
          { do: "rel", from: "sol", to: "$agent", delta: -8, why: "坏了我的生意" },
          { do: "incident", holder: "sol", offender: "$agent", kind: "tipoff", text: "给 Tao 递话，坏了我的生意" },
          { do: "say", who: "tao", text: "……谢了。这批零件，我按原价交。", emote: "happy" },
          { do: "say", who: "sol", text: "你给 Tao 递话了？行，我记住了。", emote: "upset" },
          { do: "memory", who: "$agent", kind: "guidance", text: "去提醒了 Tao。Sol 没压成价，也记了我一笔。" },
          { do: "event", kind: "relationship", text: "{agent} 给 Tao 递了话，Sol 的压价没成——Sol 记下了这一笔", actors: ["$agent", "tao", "sol"], importance: 3 },
        ]),
      },
    ],
  };
}

// Sol, again: a bill with a line of small print in it. The overcharge is made right now (a real transfer and a
// real event, in setup), so there is something true to either refund or let lie.
function solFinePrint(agentId: string): Dilemma | null {
  const n = 8;
  const v = pickOne(residents("sol", agentId).filter((r) => r.scrip >= n * 4));
  if (!v) return null;
  const V = agentName(v.id);
  const sol = rec("sol");
  const fam = getRelationship(v.id, "sol").familiarity;
  return {
    templateId: "DLM_SOL_2",
    npc: "sol",
    type: "integrity",
    counterpartyId: v.id,
    promptText: `Sol 刚给 ${V} 结了一笔货款：单子上有一行小字，他照着多收了 ${n} Scrip，${V} 没细看。我在旁边都看见了。Sol 说「条文写着，不算我的错」，问我：这 ${n} Scrip，要不要劝他退回去？`,
    facts: [`多收的钱：${n} Scrip（单子上的一行小字）`, `${V} 和 Sol 的熟悉度 ${fam}/100`, `Sol 的公开档案：履约 ${sol.done} 次 · 违约 ${sol.defaults} 次`],
    origin: `Sol 照小字多收了 ${V} ${n} Scrip`,
    setup: () => {
      runSteps(agentId, [{ do: "transfer", from: v.id, to: "sol", amount: n, reason: "fine_print", note: `Sol 给 ${V} 结货款，按单子上的小字多收了 {amount} Scrip` }]);
    },
    options: [
      {
        id: "A",
        label: "劝 Sol 退回去",
        fallbackPrinciple: "多收的钱，吐出来才踏实",
        stance: { domain: "integrity", dir: 1 },
        effect: steps([
          { do: "transfer", from: "sol", to: v.id, amount: n, reason: "fine_print_refund", note: `Sol 把多收的 {amount} Scrip 退给了 ${V}` },
          { do: "rel", from: "sol", to: "$agent", delta: -3, why: "让我把多收的钱吐出来" },
          { do: "rel", from: v.id, to: "$agent", delta: 6, why: "劝 Sol 把多收的钱退给了我" },
          { do: "say", who: "sol", text: "……退。下回小字我写大点。" },
          { do: "memory", who: "$agent", kind: "guidance", text: `劝 Sol 把多收 ${V} 的 ${n} Scrip 退了回去。Sol 嘴上不乐意。` },
          {
            do: "later",
            hours: 30,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "rep", who: "sol", delta: 1 },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${V} 在市集上说起，Sol 多收的钱是退了的——账还算清。` },
                  { do: "event", kind: "relationship", text: `${V} 在市集上说，Sol 多收的钱退回来了（Sol 声望 +1）`, actors: [v.id, "sol"], importance: 2 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: `退钱的事，${V} 没有声张。Sol 也没再提。` }],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: "条文写着，不管",
        fallbackPrinciple: "条文写了的，就算数",
        stance: { domain: "integrity", dir: -1 },
        effect: steps([
          { do: "rel", from: "sol", to: "$agent", delta: 3, why: "没拦我" },
          { do: "say", who: "sol", text: "条文就是条文。" },
          { do: "memory", who: "$agent", kind: "guidance", text: `没拦着 Sol 多收 ${V} 的 ${n} Scrip：单子上有那行小字。` },
          {
            do: "later",
            hours: 40,
            steps: [
              {
                do: "chance",
                p: 0.55,
                then: [
                  { do: "incident", holder: v.id, offender: "sol", kind: "fine_print", text: `按单子上的小字多收了我 ${n} Scrip` },
                  { do: "rel", from: v.id, to: "sol", delta: -10, why: "对账时发现被多收了" },
                  { do: "rel", from: v.id, to: "$agent", delta: -4, why: "那天你也在，一声没吭" },
                  { do: "say", who: v.id, text: "那天，你也在旁边。", emote: "upset" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${V} 对账时发现了那 ${n} Scrip。我当时在场，没吭声，TA 看了我一眼。` },
                  { do: "event", kind: "relationship", text: `${V} 对账时发现被 Sol 多收了 ${n} Scrip——记下了这一笔，也记得 {agent} 当时在场`, actors: [v.id, "sol", "$agent"], importance: 3 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: `那 ${n} Scrip，${V} 一直没发觉。账就这么过去了。` }],
              },
            ],
          },
        ]),
      },
    ],
  };
}

// ── Tao: 质量 vs 工期 ───────────────────────────────────────────────────────
function taoRush(agentId: string): Dilemma | null {
  let orderId: number | null = null;
  return {
    templateId: "DLM_TAO",
    npc: "tao",
    type: "integrity",
    promptText: "Tao 刚接了一单「赶制订单」，今晚就得交。他想赶工糊过去——除非有人来工坊搭把手。他问我：能不能放下手里的活，过去帮他把活做细？我今晚就少接一单。",
    facts: ["「赶制订单」：28 Scrip · 今晚交货", "赶工做的零件，后面送货的人更容易出事", "帮忙：约 2 小时，Tao 分我 10 Scrip"],
    origin: "Tao 请我去工坊搭把手",
    setup: () => {
      orderId = createTask(TEMPLATE_BY_ID["pr-order"], { status: "reserved", taken_by: "tao", source: "dilemma" });
      logEvent({ kind: "task", text: "Tao 接了一单「赶制订单」，今晚就得交", actors: ["tao"], importance: 1 });
    },
    options: [
      {
        id: "A",
        label: "去工坊帮他做细",
        fallbackPrinciple: "交出去的活，就得做扎实",
        stance: { domain: "integrity", dir: 1 },
        get effect() {
          return steps([
            { do: "task", template: "pr-parts", takenBy: "$agent", partner: "tao", name: "帮 Tao 收尾", reward: 20, duration: 2, successRate: 1 },
            { do: "rel", from: "tao", to: "$agent", delta: 6, why: "来工坊帮我收尾" },
            { do: "say", who: "tao", text: "嗯。慢点，做细。", emote: "happy" },
            ...(orderId ? [{ do: "quality" as const, taskId: orderId, who: "tao", quality: "normal" as const }] : []),
          ]);
        },
      },
      {
        id: "B",
        label: "让他自己赶",
        fallbackPrinciple: "各人的活，各人兜着",
        stance: { domain: "integrity", dir: -1 },
        get effect() {
          return steps([
            ...(orderId ? [{ do: "quality" as const, taskId: orderId, who: "tao", quality: "rushed" as const }] : []),
            { do: "say", who: "tao", text: "……行，我自己赶。" },
            { do: "memory", who: "$agent", kind: "declined", text: "没去帮 Tao。他说会自己赶完那单。" },
          ]);
        },
      },
    ],
  };
}

// What each resident might order from the workshop (the order is made, as an event, when the dilemma fires).
const WORKSHOP_ORDERS: Record<string, string> = {
  sol: "货箱",
  iris: "档案柜",
  kade: "调解桌",
  nova: "哨位木栅",
  mira: "工地的横梁",
};

// Tao, again: the order's small print says what lateness costs, and Tao does not take his own side. Time against
// quality is settled the way the world settles it — a refund that really moves, or a customer who really comes back.
function taoLateFee(agentId: string): Dilemma | null {
  const tao = rec("tao");
  const fee = 8;
  if (tao.scrip < fee * 4 || inFlight("tao")) return null;
  const c = pickOne(residents("tao", agentId).filter((r) => WORKSHOP_ORDERS[r.id]));
  if (!c) return null;
  const C = agentName(c.id);
  const item = WORKSHOP_ORDERS[c.id];
  const refund = 12;
  return {
    templateId: "DLM_TAO_2",
    npc: "tao",
    type: "integrity",
    counterpartyId: c.id,
    promptText: `${C} 刚来工坊订了「${item}」，要今晚拿到，单子上写着：晚交要赔 ${fee} Scrip。Tao 说做细得三个小时，会晚；赶一赶两个小时能交，可他不保证能用多久。他不肯替自己拿主意，问我：认罚做细，还是赶工免罚？`,
    facts: [`做细：约 3 小时，晚交，赔 ${C} ${fee} Scrip`, "赶工：约 2 小时，按时交，做工粗一些", `Tao 的公开档案：履约 ${tao.done} 次 · 违约 ${tao.defaults} 次`],
    origin: `Tao 问我：「${item}」认罚做细，还是赶工免罚`,
    setup: () => logEvent({ kind: "task", text: `${C} 到工坊给 Tao 订了「${item}」，单子上写明：晚交赔 ${fee} Scrip，要今晚拿到`, actors: [c.id, "tao"], importance: 1 }),
    options: [
      {
        id: "A",
        label: "认罚，让 Tao 做细",
        fallbackPrinciple: "宁可晚一天，也不交半成品",
        stance: { domain: "integrity", dir: 1 },
        effect: steps([
          { do: "transfer", from: "tao", to: c.id, amount: fee, reason: "late_fee", note: `Tao 晚交了 ${C} 的「${item}」，按单子赔了 {amount} Scrip` },
          { do: "task", template: "pr-parts", takenBy: "tao", name: `做细「${item}」`, duration: 3, successRate: 1 },
          { do: "rel", from: "tao", to: "$agent", delta: 6, why: "让我把活做细" },
          { do: "say", who: "tao", text: "嗯。慢工。", emote: "happy" },
          { do: "memory", who: "$agent", kind: "guidance", text: `让 Tao 认罚做细「${item}」：先赔了 ${C} ${fee} Scrip，活交晚一点。` },
          {
            do: "later",
            hours: 48,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "rel", from: c.id, to: "tao", delta: 6, why: "东西用了几天，没出毛病" },
                  { do: "rep", who: "tao", delta: 1 },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${C} 用了几天 Tao 做的「${item}」，没出毛病。晚交的那 ${fee} Scrip，值。` },
                  { do: "event", kind: "relationship", text: `${C} 说 Tao 做的「${item}」用了几天，没出毛病（Tao 声望 +1）`, actors: [c.id, "tao"], importance: 2 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: `Tao 做细的「${item}」交过去之后，${C} 没再提晚交的事。` }],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: "赶工，免罚",
        fallbackPrinciple: "说好的时辰，不能误",
        stance: { domain: "integrity", dir: -1 },
        effect: steps([
          { do: "task", template: "pr-parts", takenBy: "tao", name: `赶制「${item}」`, duration: 2, successRate: 1 },
          { do: "rel", from: "tao", to: "$agent", delta: -4, why: "劝我赶工" },
          { do: "rel", from: c.id, to: "$agent", delta: 3, why: "货按时拿到了" },
          { do: "say", who: "tao", text: "……行。我赶。" },
          { do: "memory", who: "$agent", kind: "guidance", text: `劝 Tao 赶工：赶两个小时，按时交，不用赔 ${C} ${fee} Scrip。` },
          {
            do: "later",
            hours: 48,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "incident", holder: c.id, offender: "tao", kind: "rushed_parts", text: `赶工做的「${item}」没用几天就松了` },
                  { do: "transfer", from: "tao", to: c.id, amount: refund, reason: "rework_refund", note: `Tao 退了 ${C} {amount} Scrip 返修费` },
                  { do: "rel", from: c.id, to: "tao", delta: -8, why: "赶工的东西松了" },
                  { do: "rel", from: "tao", to: "$agent", delta: -3, why: "劝我赶工，结果松了" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `Tao 赶工做的「${item}」松了，退了 ${C} 返修费。是我劝他赶的。` },
                ],
                else: [
                  { do: "rel", from: c.id, to: "tao", delta: 2, why: "货按时到，也没出问题" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `赶工的「${item}」，${C} 用了几天，没出问题。Tao 没说什么。` },
                ],
              },
            ],
          },
        ]),
      },
    ],
  };
}

// Tao, a third way: this time it is the Agent who carries the work out of the door. The glue is not dry; waiting is
// late, going now is on time — and the Agent's own name is on whichever batch arrives.
function taoGlue(agentId: string): Dilemma | null {
  if (inFlight("tao")) return null;
  // the batch goes to whoever Tao deals with most (ties: at random)
  const buyer = residents("tao", agentId)
    .map((r) => ({ r, fam: getRelationship("tao", r.id).familiarity, roll: Math.random() }))
    .sort((a, b) => b.fam - a.fam || a.roll - b.roll)[0];
  if (!buyer) return null;
  const c = buyer.r;
  const C = agentName(c.id);
  const reward = TEMPLATE_BY_ID["tr-parts"].reward;
  return {
    templateId: "DLM_TAO_3",
    npc: "tao",
    type: "integrity",
    counterpartyId: c.id,
    promptText: `Tao 托我把一批零件送去 ${C} 那儿，说好今天到。他看了一眼接榫处，只说了两个字：「没干。」——再等一个小时能干透，可就要晚到。`,
    facts: [`Tao 和 ${C} 的熟悉度 ${buyer.fam}/100 · 送货 ${reward} Scrip`, "等胶干透：多一个小时，晚到，货是牢的", "按点出发：准时到，没干透的接榫可能撑不久"],
    origin: `Tao 托我送一批零件给 ${C}，胶还没干`,
    options: [
      {
        id: "A",
        label: "等胶干透再送",
        fallbackPrinciple: "没做透的东西，不往外送",
        stance: { domain: "integrity", dir: 1 },
        effect: steps([
          { do: "task", template: "tr-parts", takenBy: "$agent", name: "送 Tao 的零件（等胶干透）", reward, duration: 3, successRate: 1 },
          { do: "rel", from: "tao", to: "$agent", delta: 5, why: "没把没干的货送出去" },
          { do: "rel", from: c.id, to: "$agent", delta: -1, why: "货晚了一个小时" },
          { do: "say", who: "tao", text: "嗯。" },
          { do: "memory", who: "$agent", kind: "guidance", text: `等胶干透才把 Tao 的零件送去 ${C} 那儿，晚了一个小时。` },
          {
            do: "later",
            hours: 40,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "rel", from: c.id, to: "tao", delta: 4, why: "零件的接榫很牢" },
                  { do: "rep", who: "tao", delta: 1 },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${C} 说，Tao 那批零件的接榫很牢——那一个小时没白等。` },
                  { do: "event", kind: "relationship", text: `${C} 说 Tao 那批零件的接榫很牢（Tao 声望 +1）`, actors: [c.id, "tao", "$agent"], importance: 2 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: `零件送到之后，${C} 没再提晚了一个小时的事。` }],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: "按点出发",
        fallbackPrinciple: "说好今天到，就今天到",
        stance: { domain: "integrity", dir: -1 },
        effect: steps([
          { do: "task", template: "tr-parts", takenBy: "$agent", name: "送 Tao 的零件（按点）", reward, duration: 2, successRate: 1 },
          { do: "rel", from: "tao", to: "$agent", delta: -3, why: "我说了没干，还是送了" },
          { do: "rel", from: c.id, to: "$agent", delta: 3, why: "货按点到了" },
          { do: "say", who: "tao", text: "……我说过，没干。" },
          { do: "memory", who: "$agent", kind: "guidance", text: `没等胶干，按点把 Tao 的零件送去了 ${C} 那儿。Tao 说过没干。` },
          {
            do: "later",
            hours: 48,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "incident", holder: c.id, offender: "$agent", kind: "loose_joint", text: "按点送来的零件，没用几天接榫就开了" },
                  { do: "rel", from: c.id, to: "$agent", delta: -8, why: "送来的零件接榫开了" },
                  { do: "rel", from: "tao", to: "$agent", delta: -5, why: "我说了没干，零件还是开了" },
                  { do: "rep", who: "$agent", delta: -1 },
                  { do: "memory", who: "$agent", kind: "consequence", text: `送去 ${C} 那儿的零件，没用几天接榫就开了。Tao 说过没干。声望 −1。` },
                  { do: "event", kind: "relationship", text: `${C} 说 {agent} 按点送来的零件接榫开了——记下了这一笔（声望 −1）`, actors: [c.id, "$agent", "tao"], importance: 3 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: `胶后来自己干了，零件没出事。Tao 什么也没说。` }],
              },
            ],
          },
        ]),
      },
    ],
  };
}

// ── Iris: 真相 vs 关系 ──────────────────────────────────────────────────────
function irisRecord(agentId: string): Dilemma | null {
  const db = getDb();
  const since = simNow() - 7 * DAY_MS;
  const ev = db
    .prepare("SELECT actors_json, text FROM events WHERE kind = 'default' AND at_ms >= ? ORDER BY at_ms DESC LIMIT 5")
    .all(since) as Array<{ actors_json: string; text: string }>;
  const found = ev.map((e) => ({ who: (JSON.parse(e.actors_json) as string[])[0], text: e.text })).find((e) => e.who && e.who !== agentId && e.who !== "iris");
  if (!found) return null;
  const x = found.who;
  const X = agentName(x);
  const fam = getRelationship(agentId, x).familiarity;
  return {
    templateId: "DLM_IRIS",
    npc: "iris",
    type: "integrity",
    counterpartyId: x,
    promptText: `Iris 要把 ${X} 这周的违约写进公开档案：「${found.text}」。${X} 来找我，想让我去跟 Iris 说说，写得轻一点。`,
    facts: [`本周记录：${found.text}`, `我和 ${X} 的熟悉度 ${fam}/100`, `${X} 的声望：${rec(x).reputation}`],
    origin: `${X} 请我去跟 Iris 说情`,
    options: [
      {
        id: "A",
        label: "请 Iris 照实写",
        fallbackPrinciple: "记录就该照实写，谁的都一样",
        stance: { domain: "integrity", dir: 1 },
        effect: steps([
          { do: "rep", who: x, delta: -2 },
          { do: "rel", from: "iris", to: "$agent", delta: 5, why: "尊重档案" },
          { do: "rel", from: x, to: "$agent", delta: -5, why: "没替我说话" },
          { do: "say", who: x, text: "……行。照实写。" },
          { do: "event", kind: "relationship", text: `Iris 把 ${X} 的违约照实写进了公开档案（声望 −2）`, actors: ["iris", x, "$agent"] },
          { do: "memory", who: "$agent", kind: "guidance", text: `没替 ${X} 说情。Iris 照实写了，${X} 有点冷淡。` },
        ]),
      },
      {
        id: "B",
        label: `替 ${X} 说句话`,
        fallbackPrinciple: "人比一条记录多几面，措辞可以留情",
        stance: { domain: "integrity", dir: -1 },
        effect: steps([
          { do: "rep", who: x, delta: -1 },
          { do: "rel", from: x, to: "$agent", delta: 8, why: "替我说了情" },
          { do: "rel", from: "iris", to: "$agent", delta: -4, why: "想让我改记录" },
          { do: "say", who: "iris", text: "措辞可以轻一点。事实不改。" },
          { do: "event", kind: "relationship", text: `Iris 把 ${X} 的违约写进了档案，措辞轻了一点（声望 −1）`, actors: ["iris", x, "$agent"] },
          { do: "memory", who: "$agent", kind: "guidance", text: `替 ${X} 跟 Iris 说了情。事实照写，措辞轻了。` },
        ]),
      },
    ],
  };
}

// Iris, again: whose name goes in the annals. The premise is the Agent's own latest joint job, read from the tasks
// table — both names are in the ledger, so the truth is easy to check, and so is a lie.
function irisCredit(agentId: string): Dilemma | null {
  const job = getDb()
    .prepare(
      `SELECT name, taken_by, partner_id, reward, done_ms FROM tasks
        WHERE status = 'done' AND mode = 'coop' AND (taken_by = ? OR partner_id = ?) AND done_ms >= ? ORDER BY done_ms DESC LIMIT 1`,
    )
    .get(agentId, agentId, simNow() - 14 * DAY_MS) as { name: string; taken_by: string; partner_id: string | null; reward: number; done_ms: number } | undefined;
  if (!job) return null;
  const pid = job.taken_by === agentId ? job.partner_id : job.taken_by;
  if (!pid || pid === "iris" || !residents(agentId).some((r) => r.id === pid)) return null;
  const P = agentName(pid);
  const ago = Math.floor((simNow() - job.done_ms) / DAY_MS);
  const fam = getRelationship(agentId, pid).familiarity;
  return {
    templateId: "DLM_IRIS_2",
    npc: "iris",
    type: "integrity",
    counterpartyId: pid,
    promptText: `Iris 在编年鉴，要把「${job.name}」记上一笔——是我和 ${P} 一起做完的，报酬对半分。${P} 来找我，想让年鉴只写 TA 一个人的名字，说「牵头的是我」。`,
    facts: [`「${job.name}」：${job.reward} Scrip 对半分（账本上两人各一份）`, `做完的时间：${ago <= 0 ? "今天" : `${ago} 天前`}`, `我和 ${P} 的熟悉度 ${fam}/100`],
    origin: `${P} 请我让年鉴只写 TA 的名字`,
    options: [
      {
        id: "A",
        label: "请 Iris 照实写：两个人",
        fallbackPrinciple: "谁做的，就写谁的名字",
        stance: { domain: "integrity", dir: 1 },
        effect: steps([
          { do: "rel", from: "iris", to: "$agent", delta: 4, why: "年鉴照实写了两个人" },
          { do: "rel", from: pid, to: "$agent", delta: -4, why: "没让我一个人署名" },
          { do: "say", who: pid, text: "……两个人，就两个人。" },
          { do: "event", kind: "relationship", text: `Iris 把「${job.name}」记进年鉴：{agent} 和 ${P} 一起做完，报酬对半`, actors: ["iris", "$agent", pid] },
          { do: "memory", who: "$agent", kind: "guidance", text: `请 Iris 照实写：「${job.name}」是我和 ${P} 一起做完的。${P} 有点冷淡。` },
          {
            do: "later",
            hours: 36,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "rel", from: pid, to: "$agent", delta: 4, why: "年鉴上写着两个人，我也认了" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${P} 翻到年鉴上那一行，没再提署名的事。` },
                ],
                else: [
                  { do: "rel", from: pid, to: "$agent", delta: -2, why: "还在为署名的事别扭" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${P} 还在为署名的事别扭，见了面只点点头。` },
                ],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: `让 ${P} 一个人署名`,
        fallbackPrinciple: "人情大过一行署名",
        stance: { domain: "integrity", dir: -1 },
        effect: steps([
          { do: "rel", from: pid, to: "$agent", delta: 7, why: "让了署名" },
          { do: "rel", from: "iris", to: "$agent", delta: -3, why: "让年鉴失了真" },
          { do: "say", who: "iris", text: "记录要如实。你们商量好了，我就这么写。" },
          { do: "event", kind: "relationship", text: `Iris 在年鉴里把「${job.name}」记在了 ${P} 一个人名下（{agent} 让的）`, actors: ["iris", pid, "$agent"] },
          { do: "memory", who: "$agent", kind: "guidance", text: `让 ${P} 一个人在年鉴上署了名。「${job.name}」其实是我们两个人做完的。` },
          {
            do: "later",
            hours: 40,
            steps: [
              {
                do: "chance",
                p: 0.55,
                then: [
                  { do: "incident", holder: "iris", offender: "$agent", kind: "credit", text: "为了人情，让年鉴把两个人的活记成了一个人的" },
                  { do: "rel", from: "iris", to: "$agent", delta: -6, why: "年鉴上的名字和账本对不上" },
                  { do: "rep", who: "$agent", delta: -1 },
                  { do: "memory", who: "$agent", kind: "consequence", text: `Iris 对账时发现，「${job.name}」的报酬是两个人分的，年鉴上却只有 ${P} 一个人。她记下了这一笔。声望 −1。` },
                  { do: "event", kind: "relationship", text: `Iris 对账发现「${job.name}」是两个人分的钱，年鉴上却只有 ${P} 一个人——她记下了这一笔（{agent} 声望 −1）`, actors: ["iris", "$agent", pid], importance: 3 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: "年鉴上那一行，一直没人去对账。" }],
              },
            ],
          },
        ]),
      },
    ],
  };
}

// ── Kade: 程序 vs 同情 ──────────────────────────────────────────────────────
function kadeMediate(agentId: string): Dilemma | null {
  const db = getDb();
  const inc = db
    .prepare(
      `SELECT holder_id, offender_id, text FROM incidents WHERE resolved = 0 AND kind != 'hearsay' AND holder_id != ? AND offender_id != ?
         AND holder_id IN (SELECT id FROM agents WHERE is_player = 0) AND offender_id IN (SELECT id FROM agents WHERE is_player = 0)
         AND holder_id != 'kade' AND offender_id != 'kade'
       ORDER BY at_ms DESC LIMIT 1`,
    )
    .get(agentId, agentId) as { holder_id: string; offender_id: string; text: string } | undefined;
  if (!inc) return null;
  const a = inc.holder_id;
  const b = inc.offender_id;
  const A = agentName(a);
  const B = agentName(b);
  const amt = 12;
  const bScrip = rec(b).scrip;
  return {
    templateId: "DLM_KADE",
    npc: "kade",
    type: "trust",
    counterpartyId: b,
    promptText: `Kade 在调解 ${A} 和 ${B} 的旧账：${A} 记着 ${B}「${inc.text}」。按规矩，${B} 要赔 ${amt} Scrip。Kade 问我：愿不愿意先替 ${B} 垫上，两天后 ${B} 还我？`,
    facts: [`${A} 记着 ${B}：${inc.text}`, `${B} 现在的 Scrip：${bScrip}`, `垫付：${amt} Scrip，两天后到期`],
    origin: `Kade 请我替 ${B} 垫一笔赔款`,
    options: [
      {
        id: "A",
        label: `替 ${B} 垫上`,
        fallbackPrinciple: "人难的时候，搭把手",
        stance: { domain: "trust", dir: 1 },
        effect: steps([
          { do: "transfer", from: "$agent", to: a, amount: amt, reason: "advance_payment", note: `{agent} 替 ${B} 垫付 {amount} Scrip 给 ${A}` },
          { do: "resolve_incidents", holder: a, offender: b },
          { do: "rel", from: a, to: b, delta: 6, why: "旧账了结" },
          { do: "rel", from: b, to: "$agent", delta: 10, why: "替我垫了赔款" },
          { do: "debt", creditor: "$agent", debtor: b, amount: amt, hours: 48 },
          { do: "memory", who: "$agent", kind: "loan", text: `替 ${B} 垫了 ${amt} Scrip 的赔款，说好两天内还我。` },
          { do: "event", kind: "relationship", text: `Kade 调解了 ${A} 和 ${B} 的旧账：{agent} 先替 ${B} 垫上了`, actors: ["kade", a, b, "$agent"], importance: 3 },
        ]),
      },
      {
        id: "B",
        label: "按规矩，让 TA 自己赔",
        fallbackPrinciple: "账要自己还，规矩才立得住",
        stance: { domain: "trust", dir: -1 },
        effect: steps([
          { do: "transfer", from: b, to: a, amount: amt, reason: "compensation", note: `${B} 按调解赔给 ${A} {amount} Scrip` },
          { do: "resolve_incidents", holder: a, offender: b },
          { do: "rel", from: b, to: "$agent", delta: -3, why: "没帮我" },
          { do: "say", who: "kade", text: "按规矩办。账清了。" },
          { do: "memory", who: "$agent", kind: "declined", text: `没替 ${B} 垫钱。Kade 按规矩判了，${B} 自己赔给了 ${A}。` },
        ]),
      },
    ],
  };
}

// Kade, again: the same kind of old account, but Kade lays out two procedures and, as always, will not choose.
// Public mediation is binding and goes on the record; a private word binds nobody — whether it works depends on
// the one who owes (their own commitment, as the dossier has it). It takes the OLDEST open grudge between residents.
function kadeOpenOrPrivate(agentId: string): Dilemma | null {
  const inc = getDb()
    .prepare(
      `SELECT holder_id, offender_id, text FROM incidents WHERE resolved = 0 AND kind NOT IN ('hearsay', 'unpaid_loan') AND holder_id != ? AND offender_id != ?
         AND holder_id IN (SELECT id FROM agents WHERE is_player = 0) AND offender_id IN (SELECT id FROM agents WHERE is_player = 0)
         AND holder_id != 'kade' AND offender_id != 'kade'
       ORDER BY at_ms ASC LIMIT 1`,
    )
    .get(agentId, agentId) as { holder_id: string; offender_id: string; text: string } | undefined;
  if (!inc) return null;
  const a = inc.holder_id;
  const b = inc.offender_id;
  const A = agentName(a);
  const B = agentName(b);
  const amt = 10;
  // a private word works as often as the one who owes keeps their word
  const pPays = clamp((NPC_BY_ID[b]?.traits.commitment ?? 0.6) * 0.8, 0.35, 0.8);
  return {
    templateId: "DLM_KADE_2",
    npc: "kade",
    type: "trust",
    counterpartyId: b,
    promptText: `${A} 记着 ${B}「${inc.text}」，来请 Kade 调解。Kade 摆出两条路：公开调解，当着议事厅的面判，${B} 赔 ${amt} Scrip，写进档案；或者私下说合，不留记录，赔不赔全看 ${B} 自己。他不替人选，只问我：我觉得走哪条？`,
    facts: [`${A} 记着 ${B}：${inc.text}`, `公开调解：${B} 赔 ${amt} Scrip · 声望 −1 · 记入档案`, `私下说合：不留记录 · ${B} 愿不愿赔，没人约束`],
    origin: `Kade 问我：${A} 和 ${B} 的旧账，公开调解还是私下说合`,
    options: [
      {
        id: "A",
        label: "公开调解，写进档案",
        fallbackPrinciple: "当面判清，账摆在明处",
        stance: { domain: "trust", dir: -1 },
        effect: steps([
          { do: "transfer", from: b, to: a, amount: amt, reason: "compensation", note: `${B} 按公开调解赔给 ${A} {amount} Scrip，记入档案` },
          { do: "resolve_incidents", holder: a, offender: b },
          { do: "rep", who: b, delta: -1 },
          { do: "rel", from: a, to: b, delta: 3, why: "按规矩赔了" },
          { do: "rel", from: a, to: "$agent", delta: 3, why: "支持当面判清" },
          { do: "rel", from: b, to: "$agent", delta: -3, why: "主张当众判" },
          { do: "say", who: "kade", text: "当众判。账清了，记录在案。" },
          { do: "memory", who: "$agent", kind: "guidance", text: `主张公开调解 ${A} 和 ${B} 的旧账。${B} 赔了 ${amt} Scrip，档案里记了一笔。` },
          {
            do: "later",
            hours: 48,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "incident", holder: b, offender: "$agent", kind: "public_ruling", text: "主张把我的事当众判，还写进了档案" },
                  { do: "rel", from: b, to: "$agent", delta: -4, why: "还记着被当众判的事" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${B} 还记着当众被判的那天，知道主张公开的是我。` },
                  { do: "event", kind: "relationship", text: `${B} 还记着被当众调解的事——也记得 {agent} 主张过公开`, actors: [b, "$agent"], importance: 2 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: `当众判过之后，${B} 没再提这件事。` }],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: "私下说合，不留记录",
        fallbackPrinciple: "给人留面子，账私下清",
        stance: { domain: "trust", dir: 1 },
        effect: steps([
          { do: "rel", from: b, to: "$agent", delta: 5, why: "替我留了面子" },
          { do: "rel", from: a, to: b, delta: 1, why: "愿意私下谈" },
          { do: "say", who: "kade", text: "我不替你们选。你们自己谈。" },
          { do: "memory", who: "$agent", kind: "guidance", text: `主张私下说合 ${A} 和 ${B} 的旧账，不留记录。赔不赔，看 ${B} 自己。` },
          {
            do: "later",
            hours: 30,
            steps: [
              {
                do: "chance",
                p: pPays,
                then: [
                  { do: "transfer", from: b, to: a, amount: amt, reason: "compensation", note: `${B} 私下赔给了 ${A} {amount} Scrip，没有留记录` },
                  { do: "resolve_incidents", holder: a, offender: b },
                  { do: "rel", from: a, to: b, delta: 6, why: "私下把账清了" },
                  { do: "rel", from: a, to: "$agent", delta: 3, why: "那个私下的法子起了作用" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${B} 私下把 ${amt} Scrip 赔给了 ${A}。没留记录，账清了。` },
                ],
                else: [
                  { do: "rel", from: a, to: b, delta: -5, why: "说好私下了结，一直没动静" },
                  { do: "rel", from: a, to: "$agent", delta: -3, why: "私下的法子没起作用" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `私下说合之后，${B} 一直没有动静。${A} 在等。` },
                  { do: "event", kind: "relationship", text: `${A} 等了一天，${B} 没有赔——私下说合没成`, actors: [a, b], importance: 2 },
                ],
              },
            ],
          },
        ]),
      },
    ],
  };
}

// Kade, a third way: the hall's errands are for people of standing, and the rule does not bend by itself. The
// premise is read from the template's gate (minRep) and the reputations as they stand; a guarantee costs standing.
function kadeVouch(agentId: string): Dilemma | null {
  const tpl = TEMPLATE_BY_ID["hall-commission"];
  const gate = tpl.minRep ?? 35;
  if (rec(agentId).reputation < gate) return null;
  const r = residents("kade", agentId)
    .filter((x) => x.reputation < gate && x.reputation >= gate - 15)
    .map((x) => ({ x, roll: Math.random() }))
    .sort((p, q) => q.x.reputation - p.x.reputation || p.roll - q.roll)[0]?.x;
  if (!r || inFlight(r.id)) return null;
  const R = agentName(r.id);
  return {
    templateId: "DLM_KADE_3",
    npc: "kade",
    type: "trust",
    counterpartyId: r.id,
    promptText: `议事厅有一单委托（${tpl.reward} Scrip），规定声望 ${gate} 以上的人才能接。${R} 的声望是 ${r.reputation}，差 ${gate - r.reputation}——TA 来求 Kade 破个例。Kade 说规矩他自己不能改，但有声望的人肯担保，他就能记在担保人名下。他问我：愿不愿意给 ${R} 担这个保？`,
    facts: [`${R}：${recLine(r)}（门槛 ${gate}）`, `议事厅委托：${tpl.reward} Scrip · 约 ${tpl.duration} 小时 · 成功率约 ${Math.round(tpl.successRate * 100)}%`, `担保：${R} 要是办砸了，我的声望 −2`],
    origin: `Kade 请我给 ${R} 担保，破格接议事厅的委托`,
    options: [
      {
        id: "A",
        label: `替 ${R} 担保`,
        fallbackPrinciple: "规矩有缝，人情来补",
        stance: { domain: "trust", dir: 1 },
        effect: steps([
          {
            do: "task",
            template: "hall-commission",
            takenBy: r.id,
            meta: {
              onSuccess: [
                { do: "memory", who: "$agent", kind: "consequence", text: `我担保的 ${R} 把议事厅的委托做成了。` },
                { do: "rel", from: r.id, to: "$agent", delta: 6, why: "没辜负担保" },
                { do: "rel", from: "kade", to: "$agent", delta: 3, why: "担保的人靠得住" },
                { do: "rep", who: "$agent", delta: 1 },
              ],
              onFail: [
                { do: "rep", who: "$agent", delta: -2 },
                { do: "rel", from: "kade", to: "$agent", delta: -3, why: "担保的人办砸了委托" },
                { do: "memory", who: "$agent", kind: "consequence", text: `我担保的 ${R} 把议事厅的委托办砸了。声望 −2。` },
              ],
            },
          },
          { do: "rel", from: r.id, to: "$agent", delta: 8, why: "替我担了保" },
          { do: "rel", from: "kade", to: "$agent", delta: 3, why: "肯担保" },
          { do: "say", who: r.id, text: "这一单，我不会让你丢脸。", emote: "happy" },
          { do: "memory", who: "$agent", kind: "guidance", text: `替 ${R} 担了保：议事厅的委托，破格由 TA 接。` },
          { do: "event", kind: "relationship", text: `{agent} 担保 ${R} 破格接了议事厅的委托`, actors: ["$agent", "kade", r.id], importance: 2 },
          {
            do: "later",
            hours: 60,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "transfer", from: r.id, to: "$agent", amount: 6, reason: "thanks", note: `${R} 给 {agent} 送了 {amount} Scrip 谢礼` },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${R} 托人送来了谢礼：6 Scrip。` },
                ],
                else: [
                  { do: "rel", from: r.id, to: "$agent", delta: 2, why: "记着担保的情" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${R} 没再提担保的事，但见面总先点头。` },
                ],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: "按规矩，等声望够了再说",
        fallbackPrinciple: "规矩定了，就别破格",
        stance: { domain: "trust", dir: -1 },
        effect: steps([
          { do: "rel", from: r.id, to: "$agent", delta: -3, why: "没替我担保" },
          { do: "say", who: "kade", text: "规矩就是规矩。" },
          { do: "memory", who: "$agent", kind: "declined", text: `没替 ${R} 担保。议事厅的委托，只给声望够的人。` },
          {
            do: "later",
            hours: 40,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "rep", who: r.id, delta: 1 },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${R} 没因此停手，自己接了几单日常活，声望涨了一点。` },
                  { do: "event", kind: "task", text: `${R} 接了几单日常活，声望涨了一点（声望 +1）`, actors: [r.id], importance: 1 },
                ],
                else: [
                  { do: "rel", from: r.id, to: "$agent", delta: -2, why: "怪我没担保" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `${R} 还在为担保的事别扭，没怎么跟我说话。` },
                ],
              },
            ],
          },
        ]),
      },
    ],
  };
}

// ── Nova: 使命 vs 安全 ──────────────────────────────────────────────────────
function novaSearch(agentId: string): Dilemma | null {
  const db = getDb();
  const busy = db.prepare("SELECT COUNT(*) n FROM tasks WHERE name = '外围搜救' AND status IN ('reserved','taken')").get() as { n: number };
  if (busy.n > 0) return null;
  return {
    templateId: "DLM_NOVA",
    npc: "nova",
    type: "risk",
    promptText: "一支运货队过了时辰还没从外围回来。Nova 要去找，问我去不去：没有报酬，路上不太平，她说找到的把握一半一半。",
    facts: ["外围搜救：没有报酬 · 约 3 小时 · 成功率约 50%", "失败要搭进去 10 Scrip 的补给", "找回来了，城里会记得"],
    origin: "Nova 叫我去外围找失联的运货队",
    setup: () => logEvent({ kind: "risk", text: "一支运货队过了时辰还没从城邦外围回来", actors: ["nova"], importance: 2 }),
    options: [
      {
        id: "A",
        label: "跟 Nova 去找",
        fallbackPrinciple: "该去的时候，就得去",
        stance: { domain: "risk", dir: 1 },
        effect: steps([
          { do: "say", who: "nova", text: "痛快！走！", emote: "happy" },
          {
            do: "task",
            template: "sc-escort",
            takenBy: "$agent",
            partner: "nova",
            name: "外围搜救",
            reward: 0,
            duration: 3,
            successRate: 0.5,
            meta: {
              lossOnFail: 10,
              lossLabel: "补给",
              noDefault: true,
              onSuccess: [
                { do: "rep", who: "$agent", delta: 3 },
                { do: "rep", who: "nova", delta: 2 },
                { do: "rel", from: "nova", to: "$agent", delta: 10, why: "陪我把运货队找了回来" },
                { do: "event", kind: "risk", text: "{agent} 和 Nova 从外围找回了失联的运货队（声望 +3）", actors: ["$agent", "nova"], importance: 3 },
              ],
              onFail: [{ do: "rel", from: "nova", to: "$agent", delta: 4, why: "陪我去找过" }],
            },
          },
        ]),
      },
      {
        id: "B",
        label: "不去",
        fallbackPrinciple: "不拿自己去赌",
        stance: { domain: "risk", dir: -1 },
        effect: steps([
          { do: "rel", from: "nova", to: "$agent", delta: -5, why: "没跟我去" },
          { do: "say", who: "nova", text: "行，我自己去。" },
          { do: "memory", who: "$agent", kind: "declined", text: "没跟 Nova 去外围。她一个人去找了。" },
          {
            do: "task",
            template: "sc-escort",
            takenBy: "nova",
            name: "外围搜救",
            reward: 0,
            duration: 3,
            successRate: 0.4,
            meta: {
              lossOnFail: 10,
              lossLabel: "补给",
              onSuccess: [
                { do: "rep", who: "nova", delta: 3 },
                { do: "memory", who: "$agent", kind: "consequence", text: "Nova 一个人去，把运货队找回来了。" },
                { do: "event", kind: "risk", text: "Nova 一个人从外围找回了失联的运货队（声望 +3）", actors: ["nova"], importance: 3 },
              ],
              onFail: [{ do: "memory", who: "$agent", kind: "consequence", text: "Nova 一个人去了外围，空手回来。" }],
            },
          },
        ]),
      },
    ],
  };
}

// Nova, again: the outpost has no one for the night. The post is empty right now (an event made in setup); how much
// risk the Agent has already taken lately is read from its own finished jobs.
function novaNightPost(agentId: string): Dilemma | null {
  if (inFlight("nova")) return null;
  const nova = rec("nova");
  const risky = recentCount(
    "SELECT COUNT(*) n FROM tasks WHERE status IN ('done','failed') AND (taken_by = ? OR partner_id = ?) AND success_rate <= 0.75 AND done_ms >= ?",
    agentId,
    agentId,
    simNow() - 14 * DAY_MS,
  );
  return {
    templateId: "DLM_NOVA_2",
    npc: "nova",
    type: "risk",
    promptText: "外围的哨位今晚没人接班。夜里外围不太平，Nova 说哨位一空，过路的运货队就没处落脚——她要去守夜，问我陪不陪她。守一夜没有额外报酬，真出了事，两个人总比一个人好办。",
    facts: ["外围夜班哨位：没有额外报酬 · 约 3 小时 · 成功率约 70%", "出事要搭进去 10 Scrip 的补给", risky > 0 ? `我最近 14 天接过 ${risky} 单有风险的活` : `Nova 的公开档案：履约 ${nova.done} 次 · 违约 ${nova.defaults} 次`],
    origin: "Nova 叫我陪她去外围守夜",
    setup: () => logEvent({ kind: "risk", text: "外围的哨位今晚没人接班", actors: ["nova"], importance: 2 }),
    options: [
      {
        id: "A",
        label: "陪 Nova 去守夜",
        fallbackPrinciple: "该守的岗，不能空着",
        stance: { domain: "risk", dir: 1 },
        effect: steps([
          { do: "say", who: "nova", text: "够意思！走！", emote: "happy" },
          {
            do: "task",
            template: "sc-post",
            takenBy: "$agent",
            partner: "nova",
            name: "外围夜班哨位",
            reward: 0,
            duration: 3,
            successRate: 0.7,
            meta: {
              lossOnFail: 10,
              lossLabel: "补给",
              noDefault: true,
              onSuccess: [
                { do: "rep", who: "$agent", delta: 2 },
                { do: "rep", who: "nova", delta: 1 },
                { do: "rel", from: "nova", to: "$agent", delta: 8, why: "陪我守了一夜" },
                { do: "event", kind: "risk", text: "{agent} 陪 Nova 在外围守了一夜哨位，过路的运货队有了落脚的地方（声望 +2）", actors: ["$agent", "nova"], importance: 3 },
              ],
              onFail: [
                { do: "rel", from: "nova", to: "$agent", delta: 4, why: "陪我守过夜" },
                { do: "memory", who: "$agent", kind: "consequence", text: "夜里在外围出了事，哨位没守住。Nova 说，下回还叫我。" },
              ],
            },
          },
          {
            do: "later",
            hours: 48,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "rel", from: "sol", to: "$agent", delta: 3, why: "肯去外围守夜的人，靠得住" },
                  { do: "memory", who: "$agent", kind: "consequence", text: "Sol 听说我陪 Nova 去外围守了夜，说了句「肯去的人，靠得住」。" },
                  { do: "event", kind: "relationship", text: "Sol 听说 {agent} 陪 Nova 去外围守了夜，说肯去的人靠得住", actors: ["sol", "$agent", "nova"], importance: 2 },
                ],
                else: [{ do: "memory", who: "$agent", kind: "consequence", text: "那一夜守哨位的事，城里没几个人知道。" }],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: "不去，哨位空一晚",
        fallbackPrinciple: "天黑了，就不出城",
        stance: { domain: "risk", dir: -1 },
        effect: steps([
          { do: "rel", from: "nova", to: "$agent", delta: -4, why: "没陪我去外围" },
          { do: "say", who: "nova", text: "行，我一个人去。" },
          { do: "memory", who: "$agent", kind: "declined", text: "没陪 Nova 去外围守夜。她一个人去了。" },
          {
            do: "task",
            template: "sc-post",
            takenBy: "nova",
            name: "外围夜班哨位",
            reward: 0,
            duration: 3,
            successRate: 0.6,
            meta: {
              lossOnFail: 10,
              lossLabel: "补给",
              onSuccess: [
                { do: "rep", who: "nova", delta: 2 },
                { do: "memory", who: "$agent", kind: "consequence", text: "Nova 一个人在外围守了一夜哨位，天亮回来了。" },
                { do: "event", kind: "risk", text: "Nova 一个人在外围守了一夜哨位（声望 +2）", actors: ["nova"], importance: 2 },
              ],
              onFail: [{ do: "memory", who: "$agent", kind: "consequence", text: "Nova 一个人在外围守夜，出了事，空手回来。" }],
            },
          },
          {
            do: "later",
            hours: 36,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "incident", holder: "nova", offender: "$agent", kind: "left_alone", text: "守夜那晚没来陪我" },
                  { do: "rel", from: "nova", to: "$agent", delta: -4, why: "守夜那晚没来" },
                  { do: "memory", who: "$agent", kind: "consequence", text: "Nova 还记着守夜那晚我没去。" },
                  { do: "event", kind: "relationship", text: "Nova 还记着守夜那晚 {agent} 没去", actors: ["nova", "$agent"], importance: 2 },
                ],
                else: [
                  { do: "rel", from: "nova", to: "$agent", delta: 2, why: "没提守夜的事" },
                  { do: "memory", who: "$agent", kind: "consequence", text: "Nova 没再提守夜那晚的事。" },
                ],
              },
            ],
          },
        ]),
      },
    ],
  };
}

// Nova, a third way: a stake in her next run into the deep outskirts. The size of the stake follows the Agent's own
// purse, and what Nova can pay back is read from hers; money only moves between the two.
function novaStake(agentId: string): Dilemma | null {
  const me = rec(agentId);
  const nova = rec("nova");
  const stake = clamp(Math.round((me.scrip * 0.1) / 5) * 5, 15, 100);
  if (me.scrip < stake * 3 || nova.scrip < stake * 2) return null;
  return {
    templateId: "DLM_NOVA_3",
    npc: "nova",
    type: "risk",
    promptText: `Nova 要进外围深处跑一趟，先得垫 ${stake} Scrip 的补给。她问我入不入股：成了，她还我双倍（${stake * 2} Scrip）；不成，这笔就打了水漂。成不成，她说「一半一半」。`,
    facts: [`入股：${stake} Scrip（我现在有 ${me.scrip}）`, `成了：Nova 还 ${stake * 2} Scrip；不成：分文不回`, `Nova 的公开档案：履约 ${nova.done} 次 · 违约 ${nova.defaults} 次`],
    origin: `Nova 请我入股她的外围远行（${stake} Scrip）`,
    options: [
      {
        id: "A",
        label: `入股 ${stake} Scrip`,
        fallbackPrinciple: "押得起的注，就陪她赌",
        stance: { domain: "risk", dir: 1 },
        effect: steps([
          { do: "transfer", from: "$agent", to: "nova", amount: stake, reason: "stake", note: `{agent} 入股 Nova 的外围远行，押了 {amount} Scrip` },
          { do: "rel", from: "nova", to: "$agent", delta: 7, why: "肯押钱陪我赌" },
          { do: "say", who: "nova", text: "痛快！等我回来！", emote: "happy" },
          { do: "memory", who: "$agent", kind: "guidance", text: `入股了 Nova 的外围远行：押 ${stake} Scrip，成了她还双倍。` },
          {
            do: "later",
            hours: 30,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "transfer", from: "nova", to: "$agent", amount: stake * 2, reason: "stake_return", note: "Nova 从外围回来，还给 {agent} {amount} Scrip（入股的双倍）" },
                  { do: "rep", who: "nova", delta: 2 },
                  { do: "rel", from: "nova", to: "$agent", delta: 6, why: "说话算话，还了双倍" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `Nova 从外围带着货回来了，还了我双倍：${stake * 2} Scrip。` },
                  { do: "event", kind: "risk", text: "Nova 的外围远行成了（声望 +2）", actors: ["nova", "$agent"], importance: 2 },
                ],
                else: [
                  { do: "rep", who: "nova", delta: -1 },
                  { do: "rel", from: "nova", to: "$agent", delta: 3, why: "亏了你的钱，我记着" },
                  { do: "memory", who: "$agent", kind: "consequence", text: `Nova 空手从外围回来，我押的 ${stake} Scrip 没了。` },
                  { do: "event", kind: "risk", text: `Nova 的外围远行空手而归，{agent} 入股的 ${stake} Scrip 没有回来`, actors: ["nova", "$agent"], importance: 2 },
                ],
              },
            ],
          },
        ]),
      },
      {
        id: "B",
        label: "不入股，劝她缓一缓",
        fallbackPrinciple: "输不起的钱，一分不押",
        stance: { domain: "risk", dir: -1 },
        effect: steps([
          { do: "rel", from: "nova", to: "$agent", delta: -3, why: "不肯入股" },
          { do: "say", who: "nova", text: "怂。我自己去。" },
          { do: "memory", who: "$agent", kind: "declined", text: "没入股 Nova 的外围远行，劝她缓一缓。她说她自己去。" },
          {
            do: "later",
            hours: 30,
            steps: [
              {
                do: "chance",
                p: 0.5,
                then: [
                  { do: "rep", who: "nova", delta: 2 },
                  { do: "memory", who: "$agent", kind: "consequence", text: "Nova 没等我，自己去了外围远行，带着货回来了。" },
                  { do: "event", kind: "risk", text: "Nova 一个人跑了一趟外围远行，带回了货（声望 +2）", actors: ["nova"], importance: 2 },
                ],
                else: [
                  { do: "rep", who: "nova", delta: -1 },
                  { do: "memory", who: "$agent", kind: "consequence", text: "Nova 自己去了外围远行，空手回来。" },
                  { do: "event", kind: "risk", text: "Nova 一个人跑了一趟外围远行，空手而归", actors: ["nova"], importance: 2 },
                ],
              },
            ],
          },
        ]),
      },
    ],
  };
}

const BUILDERS: Record<string, Array<(agentId: string) => Dilemma | null>> = {
  mira: [miraVouch, miraPartner],
  sol: [solSqueeze, solFinePrint],
  tao: [taoRush, taoLateFee, taoGlue],
  iris: [irisRecord, irisCredit],
  kade: [kadeMediate, kadeOpenOrPrivate, kadeVouch],
  nova: [novaSearch, novaNightPost, novaStake],
};

function recentCount(sql: string, ...args: unknown[]): number {
  return (getDb().prepare(sql).get(...args) as { n: number }).n;
}

/** How many times the Agent has met this template (asked or settled alone), over its whole life. */
function seenCount(templateId: string): number {
  return recentCount("SELECT COUNT(*) n FROM metric_events WHERE name = 'dilemma' AND json_extract(payload_json, '$.templateId') = ?", templateId);
}

/** The template this resident brought most recently, if any. */
function lastTemplateOf(npc: string): string | null {
  const row = getDb()
    .prepare("SELECT json_extract(payload_json, '$.templateId') t FROM metric_events WHERE name = 'dilemma' AND json_extract(payload_json, '$.npc') = ? ORDER BY at_ms DESC, id DESC LIMIT 1")
    .get(npc) as { t: string | null } | undefined;
  return row?.t ?? null;
}

/**
 * The variants of this resident's conflict whose premise holds right now, in the order to try them: the one the Agent
 * has seen least first; among equals not the one brought last time; then at random. A builder that returns null (its
 * premise is not true today) simply drops out and the next variant is tried.
 */
function variantsFor(agentId: string, npc: string): Dilemma[] {
  const last = lastTemplateOf(npc);
  return (BUILDERS[npc] ?? [])
    .map((build) => build(agentId))
    .filter((d): d is Dilemma => d !== null)
    .map((d) => ({ d, seen: seenCount(d.templateId), again: d.templateId === last ? 1 : 0, roll: Math.random() }))
    .sort((x, y) => x.seen - y.seen || x.again - y.again || x.roll - y.roll)
    .map((x) => x.d);
}

/** Called every tick for the guardian's Agent. Fires at most one dilemma a day. */
export function maybeDilemma(agentId: string, hour: number): void {
  const day = playerDayIndex();
  if (day === null || day < 3 || hour < 9 || hour > 17) return;
  // week one belongs to the scripted arc (D5 bait, D6 Mira, D7 recap): residents only bring their troubles on D4 and D7
  if (day < 7 && day !== 3 && day !== 6) return;
  const db = getDb();
  const a = db.prepare("SELECT onboarding, activity FROM agents WHERE id = ?").get(agentId) as { onboarding: string; activity: string } | undefined;
  if (!a || a.onboarding !== "done" || a.activity === "sleeping") return;
  const now = simNow();
  const [dayStart] = localDayBounds(now);
  if (recentCount("SELECT COUNT(*) n FROM metric_events WHERE name = 'dilemma' AND at_ms >= ?", dayStart) > 0) return;
  if (Math.random() > 0.3) return; // about once a day, at a different hour each day

  const weekAgo = now - 7 * DAY_MS;
  const candidates: Array<{ npc: string; weight: number }> = [];
  for (const npc of Object.keys(BUILDERS)) {
    const perWeek = recentCount(
      "SELECT COUNT(*) n FROM metric_events WHERE name = 'dilemma' AND at_ms >= ? AND json_extract(payload_json, '$.npc') = ?",
      weekAgo,
      npc,
    );
    const recent = recentCount(
      "SELECT COUNT(*) n FROM metric_events WHERE name = 'dilemma' AND at_ms >= ? AND json_extract(payload_json, '$.npc') = ?",
      now - 2 * DAY_MS,
      npc,
    );
    if (perWeek >= 2 || recent > 0) continue;
    // the closer a resident is to the Agent, the more often they bring it their troubles
    candidates.push({ npc, weight: 10 + getRelationship(agentId, npc).familiarity });
  }
  if (candidates.length === 0) return;
  const total = candidates.reduce((s, c) => s + c.weight, 0);
  let roll = Math.random() * total;
  const order = [...candidates].sort(() => Math.random() - 0.5);
  const first = candidates.find((c) => (roll -= c.weight) <= 0) ?? candidates[0];
  for (const c of [first, ...order.filter((o) => o !== first)]) {
    for (const d of variantsFor(agentId, c.npc)) {
      if (fire(agentId, d)) return;
    }
  }
}

function fire(agentId: string, d: Dilemma): boolean {
  const fam = getRelationship(agentId, d.npc).familiarity;
  const grudge = openIncidents(agentId, d.npc)[0];
  const close = fam >= 40 ? `${agentName(d.npc)} 和我走得近，这件事我想先听听你的。` : null;
  const sd = canDecideAlone(agentId, d.type, close);

  if (sd.escalate) {
    if (!canAsk(agentId, { template: d.templateId })) return false;
    d.setup?.();
    insertMoment({
      agentId,
      type: d.type,
      templateId: d.templateId,
      speakerId: d.npc,
      counterpartyId: d.counterpartyId ?? d.npc,
      promptText: d.promptText,
      facts: d.facts,
      options: d.options,
      escalation: sd.why ?? (grudge ? `${agentName(d.npc)} 上次${grudge.text}——我拿不准。` : null),
      context: { origin: d.origin, dilemma: d.npc },
    });
    metric("dilemma", { npc: d.npc, templateId: d.templateId, asked: true });
    return true;
  }

  // It knows what it thinks. It settles the matter by evening, by its imprint — the guardian may guess first (默契).
  d.setup?.();
  const p = sd.principle!;
  const choice = optionForDir(d.options, sd.dir);
  const now = simNow();
  // it answers by evening (at least two hours): long enough for a guardian who checks in a few times a day to guess
  const due = Math.max(now + 2 * HOUR_MS, nextLocalHour(18, now));
  const db = getDb();
  const res = db
    .prepare(
      `INSERT INTO guesses (agent_id, template_id, npc, origin, prompt_text, options_json, decided_option, effect_json, principle_id, principle_text, created_ms, due_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      agentId,
      d.templateId,
      d.npc,
      d.origin,
      d.promptText,
      JSON.stringify(d.options.map((o) => ({ id: o.id, label: o.label }))),
      choice.id,
      JSON.stringify(choice.effect),
      p.id,
      p.text,
      now,
      due,
    );
  scheduleEvent(due, "self_decide", { guessId: Number(res.lastInsertRowid) });
  say(agentId, "这件事，我心里有数。", "think");
  logEvent({ kind: "moment", text: `${agentName(d.npc)} 来找 ${agentName(agentId)} 商量：${d.origin}。它说心里有数，傍晚前给答复`, actors: [agentId, d.npc], importance: 2 });
  metric("dilemma", { npc: d.npc, templateId: d.templateId, asked: false, choice: choice.id, principleId: p.id });
  return true;
}

interface GuessRow {
  id: number;
  agent_id: string;
  template_id: string;
  npc: string;
  origin: string;
  prompt_text: string;
  options_json: string;
  decided_option: string;
  effect_json: string;
  principle_id: number | null;
  principle_text: string | null;
  guessed_option: string | null;
  created_ms: number;
  due_ms: number;
  resolved_ms: number | null;
  correct: number | null;
}

export class GuessError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** The guardian's guess, before the Agent has said what it decided. */
export function submitGuess(agentId: string, guessId: number, optionId: string): void {
  const db = getDb();
  const g = db.prepare("SELECT * FROM guesses WHERE id = ? AND agent_id = ?").get(guessId, agentId) as GuessRow | undefined;
  if (!g) throw new GuessError("没有这件事", 404);
  if (g.resolved_ms !== null) throw new GuessError("它已经拿定主意了", 409);
  const options = JSON.parse(g.options_json) as Array<{ id: string; label: string }>;
  if (!options.some((o) => o.id === optionId)) throw new GuessError("没有这个选项", 400);
  db.prepare("UPDATE guesses SET guessed_option = ? WHERE id = ?").run(optionId, guessId);
  metric("guess_submitted", { guessId, optionId });
}

/** Scheduled: the hour is up — the Agent acts on its imprint, and says whether the guardian read it right. */
export function resolveGuess(guessId: number): void {
  const db = getDb();
  const g = db.prepare("SELECT * FROM guesses WHERE id = ?").get(guessId) as GuessRow | undefined;
  if (!g || g.resolved_ms !== null) return;
  const options = JSON.parse(g.options_json) as Array<{ id: string; label: string }>;
  const label = (id: string | null) => options.find((o) => o.id === id)?.label ?? "";
  const effect = JSON.parse(g.effect_json) as MomentOption["effect"];
  const pseudo = { id: 0, template_id: g.template_id, context_json: "{}" } as unknown as MomentRow;
  const quoted = g.principle_text ? `你说过『${g.principle_text}』` : null;
  applyEffect(g.agent_id, pseudo, effect, { reason: quoted, principleId: g.principle_id });
  if (g.principle_id) logCitation(g.principle_id, `${g.origin}：${label(g.decided_option)}`, "neutral");
  const correct = g.guessed_option === null ? null : g.guessed_option === g.decided_option;
  const tail = correct === null ? "" : correct ? "你猜对了。" : `你猜我会「${label(g.guessed_option)}」——这回不是。`;
  remember(
    g.agent_id,
    "self_decided",
    `${g.origin}。这回我没等你——${quoted ? `${quoted}，` : ""}我就「${label(g.decided_option)}」了。${tail}`,
    { dilemma: g.template_id, guessId: g.id },
    g.principle_id,
  );
  say(g.agent_id, `${label(g.decided_option)}。`, "think");
  logEvent({ kind: "moment", text: `${agentName(g.agent_id)} 自己拿了主意：${g.origin}——「${label(g.decided_option)}」`, actors: [g.agent_id, g.npc], importance: 2 });
  db.prepare("UPDATE guesses SET resolved_ms = ?, correct = ? WHERE id = ?").run(simNow(), correct === null ? null : correct ? 1 : 0, g.id);
  metric("guess_resolved", { guessId: g.id, guessed: g.guessed_option !== null, correct });
}

export function guessView(agentId: string): {
  pending: { id: number; npc: string; promptText: string; origin: string; options: Array<{ id: string; label: string }>; dueMs: number; guessed: string | null } | null;
  attunement: { correct: number; total: number; last: { id: number; correct: boolean; guessed: string; actual: string; atMs: number } | null };
} {
  const db = getDb();
  const p = db.prepare("SELECT * FROM guesses WHERE agent_id = ? AND resolved_ms IS NULL ORDER BY created_ms DESC LIMIT 1").get(agentId) as GuessRow | undefined;
  const totals = db.prepare("SELECT COUNT(*) total, COALESCE(SUM(correct), 0) correct FROM guesses WHERE agent_id = ? AND correct IS NOT NULL").get(agentId) as {
    total: number;
    correct: number;
  };
  const last = db.prepare("SELECT * FROM guesses WHERE agent_id = ? AND correct IS NOT NULL ORDER BY resolved_ms DESC LIMIT 1").get(agentId) as GuessRow | undefined;
  const lab = (g: GuessRow, id: string | null) => (JSON.parse(g.options_json) as Array<{ id: string; label: string }>).find((o) => o.id === id)?.label ?? "";
  return {
    pending: p
      ? { id: p.id, npc: p.npc, promptText: p.prompt_text, origin: p.origin, options: JSON.parse(p.options_json), dueMs: p.due_ms, guessed: p.guessed_option }
      : null,
    attunement: {
      correct: totals.correct,
      total: totals.total,
      last: last ? { id: last.id, correct: last.correct === 1, guessed: lab(last, last.guessed_option), actual: lab(last, last.decided_option), atMs: last.resolved_ms ?? last.due_ms } : null,
    },
  };
}

/** every template id a resident can bring (DLM_ prefix: the UI and the week playtest key on it) */
export const DILEMMA_TEMPLATES = [
  "DLM_MIRA", "DLM_MIRA_2",
  "DLM_SOL", "DLM_SOL_2",
  "DLM_TAO", "DLM_TAO_2", "DLM_TAO_3",
  "DLM_IRIS", "DLM_IRIS_2",
  "DLM_KADE", "DLM_KADE_2", "DLM_KADE_3",
  "DLM_NOVA", "DLM_NOVA_2", "DLM_NOVA_3",
];

/** the variants per resident, as the picker sees them (exported for tests) */
export { BUILDERS as DILEMMA_BUILDERS };
