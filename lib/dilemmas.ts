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
//  * from day 4; at most one a day; each resident at most twice a week.
// ---------------------------------------------------------------------------

import { getDb } from "./db";
import { simNow, DAY_MS, localDayBounds } from "./clock";
import { agentName, getRelationship, logEvent, metric, openIncidents, playerDayIndex, remember, say } from "./records";
import { canAsk, canDecideAlone, insertMoment, optionForDir, applyEffect, type MomentOption, type MomentRow } from "./decisionMoments";
import { logCitation } from "./principleEngine";
import { createTask } from "./tasks";
import { TEMPLATE_BY_ID } from "./content";
import type { Step } from "./consequences";
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

// ── Kade: 程序 vs 同情 ──────────────────────────────────────────────────────
function kadeMediate(agentId: string): Dilemma | null {
  const db = getDb();
  const inc = db
    .prepare(
      `SELECT holder_id, offender_id, text FROM incidents WHERE resolved = 0 AND holder_id != ? AND offender_id != ?
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

const BUILDERS: Record<string, (agentId: string) => Dilemma | null> = {
  mira: miraVouch,
  sol: solSqueeze,
  tao: taoRush,
  iris: irisRecord,
  kade: kadeMediate,
  nova: novaSearch,
};

function recentCount(sql: string, ...args: unknown[]): number {
  return (getDb().prepare(sql).get(...args) as { n: number }).n;
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
    const d = BUILDERS[c.npc](agentId);
    if (d && fire(agentId, d)) return;
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

  // It knows what it thinks: decides by its imprint, and tells you tonight.
  d.setup?.();
  const p = sd.principle!;
  const choice = optionForDir(d.options, sd.dir);
  const pseudo = { id: 0, template_id: d.templateId, context_json: "{}" } as unknown as MomentRow;
  applyEffect(agentId, pseudo, choice.effect, { reason: `你说过『${p.text}』`, principleId: p.id });
  logCitation(p.id, `${d.origin}：${choice.label}`, "neutral");
  remember(agentId, "self_decided", `${d.origin}。这回我没等你——你说过『${p.text}』，我就「${choice.label}」了。`, { dilemma: d.templateId }, p.id);
  say(agentId, `${choice.label}。`, "think");
  logEvent({ kind: "moment", text: `${agentName(agentId)} 自己拿了主意：${d.origin}——「${choice.label}」`, actors: [agentId, d.npc], importance: 2 });
  metric("dilemma", { npc: d.npc, templateId: d.templateId, asked: false, choice: choice.id, principleId: p.id });
  return true;
}

export const DILEMMA_TEMPLATES = Object.keys(BUILDERS).map((npc) => `DLM_${npc.toUpperCase()}`);
