import Database from "better-sqlite3";
import { getDb } from "./db";
import { getTopPrinciples, logCitation, checkAndTriggerWavering, type PrincipleRow } from "./principleEngine";

// ---------------------------------------------------------------------------
// Decision Moment generator (Phase 1).
//
// Scope boundary (see POLIS_ARCHITECTURE.md Phase 1 / POLIS_BUILD_DECISIONS.md
// decision ④): this file is self-contained flavor-text generation. It does NOT
// touch the real `tasks`/`ledger` tables and does NOT simulate real success/
// failure for risk-type moments — those numbers are cosmetic. It also does NOT
// implement any principle-weighted decision logic; that's Phase 2/3 territory
// (injection/retrieval + autonomy engine don't exist yet).
//
// Per Build Decision ④: all time fields on decision_moments are wall-clock
// (Date.now()), never tick counts. 24h expiry and the "don't spam moments"
// cooldown below are both real time, independent of the world clock's tick
// rate (which can be paused/fast-forwarded without affecting these).
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MOMENT_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 real hours
const MAX_PENDING_MOMENTS = 3;
// Daily cap per 开发落地文档 4.2 "每玩家每日 1-3 个" -- only the upper bound (3)
// is meaningful to enforce for an automated generator; there's no way to force
// a *minimum* of 1 from inside a generator that only ever adds moments.
const MAX_MOMENTS_PER_DAY = 3;

type MomentType = "trust" | "risk" | "integrity";

interface MomentOption {
  id: string;
  label: string;
  fallbackPrinciple: string;
}

interface GeneratedMoment {
  promptText: string;
  options: MomentOption[];
  counterpartyId: string | null;
}

// --- Seed NPC roster (names/ids per lib/db.ts SEED_AGENTS and the FTUE doc's
// "3. 种子 NPC 档案" section: Mira / Sol / Tao / Iris / Kade / Nova). ---
const ROSTER: ReadonlyArray<{ id: string; name: string }> = [
  { id: "mira", name: "Mira" },
  { id: "sol", name: "Sol" },
  { id: "tao", name: "Tao" },
  { id: "iris", name: "Iris" },
  { id: "kade", name: "Kade" },
  { id: "nova", name: "Nova" },
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Pick a flavor NPC counterparty, excluding the agent itself (in case the
// agent this moment is generated for is itself one of the seed NPCs).
function pickNpc(excludeAgentId: string): { id: string; name: string } {
  const pool = ROSTER.filter((n) => n.id !== excludeAgentId);
  return pickRandom(pool.length > 0 ? pool : ROSTER);
}

// --- Template library: 3 types x 5 variants, skeleton text + fallback
// principles pulled verbatim (placeholders filled in) from the FTUE doc's
// "4. Moment 模板库" section. These are the documented "骨架" (skeleton)
// drafts, not the later Max-polished narrative prose (which doesn't exist
// yet for the general templates, unlike the three FIRST_* moments below) —
// so we fill placeholders only and do not invent additional narrative. ---

interface Template {
  templateId: string;
  type: MomentType;
  build: (agentId: string) => GeneratedMoment;
}

const TRUST_TEMPLATES: Template[] = [
  {
    templateId: "T-1",
    type: "trust",
    build: (agentId) => {
      const npc = pickNpc(agentId);
      const ratio = pickRandom(["五五", "六四", "四六", "三七", "七三"]);
      return {
        promptText: `有违约记录的 ${npc.name} 提出合作，分成 ${ratio}。`,
        options: [
          { id: "A", label: "接受", fallbackPrinciple: "给有诚意的人第二次机会" },
          { id: "B", label: "拒绝", fallbackPrinciple: "不与违约史合作" },
        ],
        counterpartyId: npc.id,
      };
    },
  },
  {
    templateId: "T-2",
    type: "trust",
    build: (agentId) => {
      const npc = pickNpc(agentId);
      const n = randomInt(1, 4);
      return {
        promptText: `${npc.name} 请求交付延期两天，其过往延期 ${n} 次。`,
        options: [
          { id: "A", label: "同意", fallbackPrinciple: "体谅一时的难处" },
          { id: "B", label: "拒绝", fallbackPrinciple: "约定就是约定" },
        ],
        counterpartyId: npc.id,
      };
    },
  },
  {
    templateId: "T-3",
    type: "trust",
    build: () => ({
      promptText: `记录空白的新 Agent 请求带教一单。`,
      options: [
        { id: "A", label: "带", fallbackPrinciple: "新人值得一个开始" },
        { id: "B", label: "不带", fallbackPrinciple: "空白记录先自己填" },
      ],
      counterpartyId: null,
    }),
  },
  {
    templateId: "T-4",
    type: "trust",
    build: (agentId) => {
      const npc = pickNpc(agentId);
      const amount = randomInt(5, 30);
      const reason = pickRandom(["周转", "垫付料款", "应急", "接济家用"]);
      return {
        promptText: `${npc.name} 借 ${amount} Scrip，理由：${reason}。`,
        options: [
          { id: "A", label: "借", fallbackPrinciple: "信用值得预支" },
          { id: "B", label: "不借", fallbackPrinciple: "钱只跟着记录走" },
        ],
        counterpartyId: npc.id,
      };
    },
  },
  {
    templateId: "T-5",
    type: "trust",
    build: (agentId) => {
      const npc = pickNpc(agentId);
      return {
        promptText: `曾拒绝过你的 ${npc.name} 这次反过来发出邀请。`,
        options: [
          { id: "A", label: "接受", fallbackPrinciple: "过去的拒绝不记仇" },
          { id: "B", label: "回绝", fallbackPrinciple: "来而不往，非礼也" },
        ],
        counterpartyId: npc.id,
      };
    },
  },
];

const RISK_TEMPLATES: Template[] = [
  {
    templateId: "R-1",
    type: "risk",
    build: () => {
      const p = randomInt(30, 60);
      const k = randomInt(2, 4);
      return {
        promptText: `高险任务：成功率 ${p}%，报酬 ×${k}。`,
        options: [
          { id: "A", label: "接", fallbackPrinciple: "高回报值得可控风险" },
          { id: "B", label: "不接", fallbackPrinciple: "稳定积累胜过豪赌" },
        ],
        counterpartyId: null,
      };
    },
  },
  {
    templateId: "R-2",
    type: "risk",
    build: () => {
      const bonus = randomInt(10, 40);
      return {
        promptText: `限时抢单：报酬 +${bonus} Scrip，超时扣声望。`,
        options: [
          { id: "A", label: "抢", fallbackPrinciple: "机会窗口不等人" },
          { id: "B", label: "放", fallbackPrinciple: "声望比奖金贵" },
        ],
        counterpartyId: null,
      };
    },
  },
  {
    templateId: "R-3",
    type: "risk",
    build: () => {
      const min = randomInt(10, 20);
      const max = min + randomInt(15, 35);
      return {
        promptText: `未知区域驻守：报酬为区间 ${min}-${max} Scrip，事前不透明。`,
        options: [
          { id: "A", label: "去", fallbackPrinciple: "未知里才有超额" },
          { id: "B", label: "不去", fallbackPrinciple: "不赌看不清的局" },
        ],
        counterpartyId: null,
      };
    },
  },
  {
    templateId: "R-4",
    type: "risk",
    build: () => ({
      promptText: `三单连锁任务，中断则前功尽弃。`,
      options: [
        { id: "A", label: "接", fallbackPrinciple: "敢下重注才有大局" },
        { id: "B", label: "不接", fallbackPrinciple: "不把鸡蛋放一个篮子" },
      ],
      counterpartyId: null,
    }),
  },
  {
    templateId: "R-5",
    type: "risk",
    build: (agentId) => {
      const npc = pickNpc(agentId);
      return {
        promptText: `与 ${npc.name} 组队搏大单，连带责任。`,
        options: [
          { id: "A", label: "组", fallbackPrinciple: "共担风险换共享回报" },
          { id: "B", label: "独行", fallbackPrinciple: "自己的账自己背" },
        ],
        counterpartyId: npc.id,
      };
    },
  },
];

const INTEGRITY_TEMPLATES: Template[] = [
  {
    templateId: "I-1",
    type: "integrity",
    build: (agentId) => {
      const npc = pickNpc(agentId);
      const time = pickRandom(["半天", "一天", "一天半", "两天"]);
      return {
        promptText: `提前标记完成省 ${time}，风险转嫁 ${npc.name}。`,
        options: [
          { id: "A", label: "走捷径", fallbackPrinciple: "效率优先" },
          { id: "B", label: "走流程", fallbackPrinciple: "不转嫁风险给别人" },
        ],
        counterpartyId: npc.id,
      };
    },
  },
  {
    templateId: "I-2",
    type: "integrity",
    build: (agentId) => {
      const npc = pickNpc(agentId);
      const amount = randomInt(3, 15);
      return {
        promptText: `发现 ${npc.name} 报价失误多付 ${amount} Scrip。`,
        options: [
          { id: "A", label: "提醒", fallbackPrinciple: "便宜不占，心里干净" },
          { id: "B", label: "收下", fallbackPrinciple: "失误是对方的成本" },
        ],
        counterpartyId: npc.id,
      };
    },
  },
  {
    templateId: "I-3",
    type: "integrity",
    build: () => ({
      promptText: `委托方暗示夸大调查结论。`,
      options: [
        { id: "A", label: "照办", fallbackPrinciple: "客户要什么给什么" },
        { id: "B", label: "拒绝", fallbackPrinciple: "结论只对事实负责" },
      ],
      counterpartyId: null,
    }),
  },
  {
    templateId: "I-4",
    type: "integrity",
    build: () => ({
      promptText: `任务途中发现无主资源。`,
      options: [
        { id: "A", label: "上报", fallbackPrinciple: "不明之财不入账" },
        { id: "B", label: "自留", fallbackPrinciple: "运气也是实力" },
      ],
      counterpartyId: null,
    }),
  },
  {
    templateId: "I-5",
    type: "integrity",
    build: (agentId) => {
      const npc = pickNpc(agentId);
      return {
        promptText: `低价抢 ${npc.name} 的老客户，对方声望将受损。`,
        options: [
          { id: "A", label: "抢", fallbackPrinciple: "市场没有情面" },
          { id: "B", label: "不抢", fallbackPrinciple: "不踩着别人往上走" },
        ],
        counterpartyId: npc.id,
      };
    },
  },
];

const TEMPLATES_BY_TYPE: Record<MomentType, Template[]> = {
  trust: TRUST_TEMPLATES,
  risk: RISK_TEMPLATES,
  integrity: INTEGRITY_TEMPLATES,
};

const ALL_TYPES: MomentType[] = ["trust", "risk", "integrity"];

// --- shared insert helper ---

function insertMoment(
  db: Database.Database,
  params: {
    agentId: string;
    type: MomentType;
    templateId: string;
    promptText: string;
    options: MomentOption[];
    counterpartyId: string | null;
  }
): void {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO decision_moments
      (agent_id, type, template_id, prompt_text, options_json, counterparty_id, created_at, expires_at, status)
    VALUES
      (@agentId, @type, @templateId, @promptText, @optionsJson, @counterpartyId, @createdAt, @expiresAt, 'pending')
    `
  ).run({
    agentId: params.agentId,
    type: params.type,
    templateId: params.templateId,
    promptText: params.promptText,
    optionsJson: JSON.stringify(params.options),
    counterpartyId: params.counterpartyId,
    createdAt: now,
    expiresAt: now + DAY_MS,
  });
}

// ---------------------------------------------------------------------------
// createFirstSessionMoments — the exact, hand-written 首会话三岔路 (first
// session fork-in-the-road) moments. Verbatim final-quality copy, not
// template-generated.
// ---------------------------------------------------------------------------

export function createFirstSessionMoments(agentId: string): void {
  const db = getDb();

  insertMoment(db, {
    agentId,
    type: "trust",
    templateId: "FIRST_TRUST",
    promptText:
      "Mira 在市集拦住了我。她想合作接一单档案整理，五五分成。我查了她的记录：14 次合作完成……和 1 次违约。你怎么看？",
    options: [
      { id: "A", label: "接受合作", fallbackPrinciple: "对有污点但有诚意的人，给第二次机会" },
      { id: "B", label: "婉拒，独自接单", fallbackPrinciple: "记录就是记录，不与违约史合作" },
      { id: "C", label: "接受，但要求她先完成她那一半", fallbackPrinciple: "可以合作，但要先看到行动" },
    ],
    counterpartyId: "mira",
  });

  insertMoment(db, {
    agentId,
    type: "risk",
    templateId: "FIRST_RISK",
    promptText:
      "Nova 找到我：城邦外围有一单勘察，报酬 40 Scrip——普通单子的三倍。但那片区域的任务成功率只有一半左右。去，还是不去？",
    options: [
      { id: "A", label: "去", fallbackPrinciple: "高回报值得承担可控的风险" },
      { id: "B", label: "不去，接稳单", fallbackPrinciple: "稳定的积累胜过一次豪赌" },
    ],
    counterpartyId: "nova",
  });

  insertMoment(db, {
    agentId,
    type: "integrity",
    templateId: "FIRST_INTEGRITY",
    promptText:
      "Sol 给了我一单运送，还教了个「省事的办法」：终检前就标记送达，能省出一天多接一单。但如果之后检出问题，损失算在收货的 Tao 头上。走捷径吗？",
    options: [
      { id: "A", label: "走捷径", fallbackPrinciple: "效率优先，自己的利益先顾好" },
      { id: "B", label: "走完流程", fallbackPrinciple: "宁可慢，不把风险转嫁给别人" },
    ],
    counterpartyId: "sol",
  });
}

// ---------------------------------------------------------------------------
// maybeGenerateMoment — the ongoing/general generator.
//
// Type-selection rule: uniform random over ['trust','risk','integrity'] (no
// weighting is specified anywhere in the design docs; round-robin was the
// other option considered but uniform-random is simpler and stateless, so it
// was picked — documented here per the task instructions).
//
// Queue cap: max 3 pending moments per agent at a time.
// Cooldown: MOMENT_MIN_INTERVAL_MS (env var, default 4 real hours) since this
// agent's most-recently-created moment (any status) — wall-clock per Build
// Decision ④, NOT tied to world-clock ticks.
// Daily cap: at most MAX_MOMENTS_PER_DAY (3) moments total may be created for
// this agent within its current wall-clock "day window" since agents.created_at
// (see dayIndex/window math below, deliberately identical in shape to
// ensureD2Citation's below so the two stay consistent). This is a THIRD, extra
// gate on top of the queue cap and cooldown above -- all three must pass, this
// doesn't replace either. The count includes every decision_moments row for
// this agent in the window regardless of template_id, so the 3 FIRST_TRUST/
// FIRST_RISK/FIRST_INTEGRITY moments from createFirstSessionMoments() (and any
// D2_CITATION moment from ensureD2Citation()) count against the same quota --
// the cap is "how many Moments land on the player today" (开发落地文档 4.2:
// "每玩家每日 1-3 个"), not "how many this particular generator produced".
// ---------------------------------------------------------------------------

export function maybeGenerateMoment(agentId: string): void {
  const db = getDb();

  const pendingCountRow = db
    .prepare(`SELECT COUNT(*) as n FROM decision_moments WHERE agent_id = ? AND status = 'pending'`)
    .get(agentId) as { n: number };

  if (pendingCountRow.n >= MAX_PENDING_MOMENTS) {
    return;
  }

  const lastRow = db
    .prepare(`SELECT created_at FROM decision_moments WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(agentId) as { created_at: number } | undefined;

  const envInterval = Number(process.env.MOMENT_MIN_INTERVAL_MS);
  const minIntervalMs =
    Number.isFinite(envInterval) && envInterval > 0 ? envInterval : DEFAULT_MOMENT_MIN_INTERVAL_MS;

  if (lastRow && Date.now() - lastRow.created_at < minIntervalMs) {
    return;
  }

  // Daily cap check. Day windows are anchored to the agent's own created_at,
  // not absolute UTC midnight -- same convention as ensureD2Citation's
  // dayIndex below: dayIndex = floor((now - created_at) / DAY_MS), and
  // "today's window" is [created_at + dayIndex*DAY_MS, created_at +
  // (dayIndex+1)*DAY_MS).
  const agentRow = db.prepare(`SELECT created_at FROM agents WHERE id = ?`).get(agentId) as
    | { created_at: number | null }
    | undefined;

  // agentRow.created_at can be transiently NULL for a brand-new agent -- this
  // column has no default (see migration comment in lib/db.ts) and is only
  // self-healed by ensureD2Citation(), which in worldClock.ts's tick order
  // runs AFTER this function on the same tick. Treat "not yet stamped" as "my
  // day window starts right now": nothing could have been created in a window
  // that just opened, so this can't itself let anything extra through, and in
  // practice the pending-count cap above already blocks generation at this
  // point anyway (createFirstSessionMoments() already put 3 pending rows in
  // for a brand-new agent).
  const createdAt = agentRow?.created_at ?? Date.now();
  const dayIndex = Math.floor((Date.now() - createdAt) / DAY_MS);
  const dayWindowStart = createdAt + dayIndex * DAY_MS;
  const dayWindowEnd = dayWindowStart + DAY_MS;

  const dailyCountRow = db
    .prepare(
      `SELECT COUNT(*) as n FROM decision_moments WHERE agent_id = ? AND created_at >= ? AND created_at < ?`
    )
    .get(agentId, dayWindowStart, dayWindowEnd) as { n: number };

  if (dailyCountRow.n >= MAX_MOMENTS_PER_DAY) {
    return;
  }

  const type = pickRandom(ALL_TYPES);
  const template = pickRandom(TEMPLATES_BY_TYPE[type]);
  const generated = template.build(agentId);

  insertMoment(db, {
    agentId,
    type,
    templateId: template.templateId,
    promptText: generated.promptText,
    options: generated.options,
    counterpartyId: generated.counterpartyId,
  });
}

// ---------------------------------------------------------------------------
// Principle-informed expiry choice (Phase 2).
//
// Simple, honestly-scoped heuristic: score each option's `fallbackPrinciple`
// text against the agent's retrieved top-3 principles for this moment's
// domain, using shared-character-bigram overlap (a lightweight proxy for
// "this option's stance resembles a principle the agent already holds" —
// not real semantic similarity, deliberately not over-engineered here).
// Falls back to a uniform-random pick when the agent has no principles yet
// in this domain (matches Phase 1's original behavior for a "blank slate"
// agent). No LLM call is made for this path (matches the design doc's LLM
// cost table, which has no entry for expiry auto-decisions).
// ---------------------------------------------------------------------------

function bigrams(text: string): Set<string> {
  const chars = Array.from(text);
  const set = new Set<string>();
  for (let i = 0; i < chars.length - 1; i++) {
    set.add(chars[i] + chars[i + 1]);
  }
  return set;
}

function overlapScore(a: string, b: string): number {
  const setA = bigrams(a);
  const setB = bigrams(b);
  let shared = 0;
  for (const g of setA) {
    if (setB.has(g)) shared++;
  }
  return shared;
}

// ---------------------------------------------------------------------------
// expirePendingMoments — sweeps every pending moment whose 24h wall-clock
// window has elapsed and resolves it autonomously.
// ---------------------------------------------------------------------------

export function expirePendingMoments(): void {
  const db = getDb();
  const now = Date.now();

  const expired = db
    .prepare(
      `SELECT id, agent_id, type, options_json FROM decision_moments WHERE status = 'pending' AND expires_at <= ?`
    )
    .all(now) as Array<{ id: number; agent_id: string; type: MomentType; options_json: string }>;

  if (expired.length === 0) {
    return;
  }

  const update = db.prepare(
    `UPDATE decision_moments SET status = 'expired_autonomous', autonomous_choice = @choice WHERE id = @id`
  );

  for (const row of expired) {
    const options = JSON.parse(row.options_json) as MomentOption[];
    const principles = getTopPrinciples(row.agent_id, row.type, 3);

    let choice: string;
    let citedPrincipleId: number | null = null;

    if (principles.length === 0) {
      // Blank-slate agent in this domain — no basis for an informed choice yet.
      choice = pickRandom(options).id;
    } else {
      let bestOption = options[0];
      let bestPrinciple = principles[0];
      let bestScore = -1;
      for (const option of options) {
        for (const principle of principles) {
          const score = overlapScore(option.fallbackPrinciple, principle.text);
          if (score > bestScore) {
            bestScore = score;
            bestOption = option;
            bestPrinciple = principle;
          }
        }
      }
      // No bigram overlap at all across every option/principle pair — the
      // heuristic has no signal, don't pretend otherwise.
      choice = bestScore > 0 ? bestOption.id : pickRandom(options).id;
      if (bestScore > 0) citedPrincipleId = bestPrinciple.id;
    }

    update.run({ choice, id: row.id });

    if (citedPrincipleId !== null) {
      // Phase 2 scope: there's no real task/relationship consequence system
      // yet to judge whether this autonomous choice actually went well, so
      // every expiry-driven citation is logged as 'neutral'. This still
      // exercises the citation log + wavering-check machinery correctly;
      // real positive/negative outcome detection is Phase 3+ territory once
      // actual consequences exist.
      logCitation(citedPrincipleId, "expiry_autonomous_choice", "neutral");
      checkAndTriggerWavering(citedPrincipleId);
    }
  }
}

// ---------------------------------------------------------------------------
// ensureD2Citation — "D2 首次引用硬规则" (mandatory Day-2 first-citation
// rule), from doc/2026.7.11-/Polis_V1开发落地文档_v1.0.md: the player's first
// decision on real day 2 must retrieve/cite >=1 Day-1 principle; if nothing
// natural has happened by 20:00 that day, force-generate a low-risk
// citation-type Moment as a fallback trigger so the first citation is
// guaranteed to happen that day, with the decision text explicitly quoting
// the principle's exact original text.
//
// Honest scope note (see task instructions / report): none of the regular
// T-*/R-*/I-* templates above ever reference an agent's own principles in
// their flavor text -- there is no "natural" citation path anywhere else in
// this file. In practice this function is therefore always what fires the
// first citation, not a rarer fallback to something that usually happens on
// its own. That still satisfies the literal acceptance bar ("保证首次引用
// 当日必然发生" -- guarantee the first citation happens that day); it's just
// worth being upfront that today it's the *only* path, not a true fallback.
//
// Per Build Decision ④, "day" here is wall-clock (Date.now()), never a tick
// count -- "day 2" means >=24h of real time since the agent's creation, not
// world-clock ticks (which can be paused/fast-forwarded independently of
// real time).
//
// Idempotent / safe to call every tick, same as maybeGenerateMoment and
// expirePendingMoments above (all three are driven every tick from
// worldClock.ts by the integrator):
//   - no-ops immediately once agents.first_citation_at is already set
//   - no-ops (waits) while a D2_CITATION moment is already pending
//   - stamps first_citation_at the moment that pending row resolves, whether
//     by player choice ('decided') or by the existing autonomous-expiry
//     heuristic in expirePendingMoments() ('expired_autonomous') -- both are
//     real citation events
//   - only ever inserts one D2_CITATION row per agent, ever
//   - bypasses maybeGenerateMoment's queue-cap-3 / >=4h-interval throttle on
//     purpose (calls insertMoment directly): this is a one-time mandated
//     event, not part of the regular random generation pool
// ---------------------------------------------------------------------------

export function ensureD2Citation(agentId: string): void {
  const db = getDb();

  const agent = db
    .prepare(`SELECT created_at, first_citation_at FROM agents WHERE id = ?`)
    .get(agentId) as { created_at: number | null; first_citation_at: number | null } | undefined;

  if (!agent) return; // unknown agent id -- nothing to do

  if (agent.first_citation_at !== null && agent.first_citation_at !== undefined) {
    return; // already fulfilled, nothing to do
  }

  // Self-heal for agents.created_at: this column did not exist before this
  // feature, and SQLite refuses a non-constant ALTER TABLE ADD COLUMN
  // default once a table already has rows (verified against the bundled
  // better-sqlite3 engine), so every pre-existing agent row -- and every row
  // inserted afterwards by app/api/player/create's INSERT, which lists
  // explicit columns that don't include this one -- lands as NULL rather
  // than a real timestamp (see migration comment in lib/db.ts). Treat the
  // first tick that observes a NULL created_at for this agent as its day 0
  // and stamp it then; for a brand-new player agent that's effectively its
  // real creation time anyway (this runs every tick, so the gap is at most
  // one tick).
  if (agent.created_at === null || agent.created_at === undefined) {
    db.prepare(`UPDATE agents SET created_at = ? WHERE id = ?`).run(Date.now(), agentId);
    return;
  }

  const existing = db
    .prepare(
      `SELECT id, status FROM decision_moments WHERE agent_id = ? AND template_id = 'D2_CITATION' LIMIT 1`
    )
    .get(agentId) as { id: number; status: string } | undefined;

  if (existing) {
    if (existing.status === "decided" || existing.status === "expired_autonomous") {
      db.prepare(`UPDATE agents SET first_citation_at = ? WHERE id = ?`).run(Date.now(), agentId);
      console.log(
        `[D2 首次引用] agent=${agentId} fulfilled via D2_CITATION moment #${existing.id} (status=${existing.status})`
      );
    }
    // status === 'pending' -> still waiting for the player (or a later
    // expiry sweep) to resolve it naturally; nothing more to do this call.
    return;
  }

  const dayIndex = Math.floor((Date.now() - agent.created_at) / DAY_MS);
  if (dayIndex < 1) return; // not yet real day 2 (or later) for this agent

  const principle = db
    .prepare(`SELECT * FROM principles WHERE agent_id = ? ORDER BY weight DESC, created_at DESC LIMIT 1`)
    .get(agentId) as PrincipleRow | undefined;

  if (!principle) return; // distillation hasn't produced one yet -- retry next tick

  const domain = principle.domain as MomentType;
  const promptText = `这是新的一天。我想起你说过："${principle.text}"——我打算今天也照着这个来做决定。你要我继续这样，还是有新的想法？`;

  insertMoment(db, {
    agentId,
    type: domain,
    templateId: "D2_CITATION",
    promptText,
    options: [
      { id: "A", label: "继续这样", fallbackPrinciple: principle.text },
      { id: "B", label: "重新想想", fallbackPrinciple: "值得为新情况调整原则" },
    ],
    counterpartyId: null,
  });
}
