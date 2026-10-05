// DEV ONLY — a mock world that evolves over time, used by /dev/town to build and
// QA the game client without the SQLite backend. Nothing here is imported by
// production code.

import type {
  ActivityKind,
  AgentView,
  Emote,
  FeedItem,
  GameSnapshot,
  JudgmentView,
  LocationId,
  MomentView,
  PlayerView,
  PostcardView,
  PrincipleView,
  WaveringView
} from "@/lib/types";
import type { BusyKey, GameActions } from "./actions";

export type FixtureScene =
  | "loading"
  | "onboarding"
  | "forks"
  | "imprint"
  | "play"
  | "refuse"
  | "refuseNoForce"
  | "adjust"
  | "wavering"
  | "notes"
  | "postcard";

export const SCENES: { id: FixtureScene; label: string }[] = [
  { id: "loading", label: "加载中" },
  { id: "onboarding", label: "无 Agent（入城）" },
  { id: "forks", label: "3 个岔路（引导）" },
  { id: "imprint", label: "烙印揭晓" },
  { id: "play", label: "日常（1 个岔路）" },
  { id: "refuse", label: "拒绝 · 可强制" },
  { id: "refuseNoForce", label: "拒绝 · 不可强制" },
  { id: "adjust", label: "调整" },
  { id: "wavering", label: "质问" },
  { id: "notes", label: "留言" },
  { id: "postcard", label: "未读明信片" }
];

const TZ = "Asia/Shanghai";
const HOUR = 3_600_000;

const LOC_NAME: Record<LocationId, string> = {
  archive: "档案馆",
  market: "市集",
  plaza: "广场",
  workshop: "工坊",
  outskirts: "城邦外围",
  mediation: "调解所",
  hall: "议事厅",
  board: "公告栏",
  gate: "城门",
  home: "住宅区"
};

interface NpcDef {
  id: string;
  name: string;
  role: string;
  sprite: string;
  personality: string;
  home: number;
  spots: LocationId[];
  work: Partial<Record<LocationId, string>>;
}

const NPCS: NpcDef[] = [
  {
    id: "mira",
    name: "Mira",
    role: "营造师",
    sprite: "architect",
    personality: "务实，爱画图纸，凡事先算工期。",
    home: 0,
    spots: ["market", "hall", "workshop", "plaza", "board"],
    work: { workshop: "在工坊核对新屋的图纸", hall: "在议事厅递交工程申请", market: "在市集采购木料" }
  },
  {
    id: "sol",
    name: "Sol",
    role: "掮客",
    sprite: "broker",
    personality: "八面玲珑，嘴上说得比账上好听。",
    home: 1,
    spots: ["market", "board", "plaza", "gate"],
    work: { market: "在市集撮合一笔香料生意", board: "在公告栏挂出收购单", gate: "在城门接待外来的商队" }
  },
  {
    id: "tao",
    name: "Tao",
    role: "工匠",
    sprite: "maker",
    personality: "话少手快，最看重交货的日子。",
    home: 2,
    spots: ["workshop", "market", "board", "plaza"],
    work: { workshop: "在工坊打磨一批铁件", market: "在市集挑选炭火", board: "在公告栏接了一张订单" }
  },
  {
    id: "iris",
    name: "Iris",
    role: "档案员",
    sprite: "archivist",
    personality: "记性极好，爱翻旧账。",
    home: 3,
    spots: ["archive", "hall", "plaza", "board"],
    work: { archive: "在档案馆抄录旧档", hall: "在议事厅核对会议记录", board: "在公告栏更新公示" }
  },
  {
    id: "kade",
    name: "Kade",
    role: "调解人",
    sprite: "mediator",
    personality: "不偏不倚，先听完再开口。",
    home: 4,
    spots: ["mediation", "plaza", "hall", "board"],
    work: { mediation: "在调解所听两方陈述", hall: "在议事厅旁听表决", plaza: "在广场和人聊聊近况" }
  },
  {
    id: "nova",
    name: "Nova",
    role: "斥候",
    sprite: "scout",
    personality: "闲不住，总想去城外看看。",
    home: 5,
    spots: ["outskirts", "gate", "plaza", "board"],
    work: { outskirts: "在城外侦察商路", gate: "在城门清点往来的人", plaza: "在广场打听消息" }
  }
];

const ME_ID = "me";
const ME_SPOTS: LocationId[] = ["market", "archive", "workshop", "plaza", "board", "hall", "outskirts", "mediation"];

const BUBBLES: Record<string, string[]> = {
  mira: ["这张图纸，工期还得再压一压。", "木料的价钱又涨了。", "新屋的地基，今天终于定下来了。"],
  sol: ["我这边有门路，保证划算！", "你听我说，这笔生意稳赚不赔。", "货到了，价钱好商量。"],
  tao: ["铁件明天交。", "这批活儿，急不得。", "炭火不够了。"],
  iris: ["三年前的账，我还留着呢。", "这页档案被人翻过。", "记下了。"],
  kade: ["两边都说得有道理，再听听。", "先别急着下结论。", "我来做个见证。"],
  nova: ["城外的路通了！", "东边有商队的脚印。", "天黑前我得回来。"],
  me: ["先看看再说。", "这事我得想想。", "按我自己的原则来。"]
};

const MY_REASONS: string[] = [
  "你说过『稳定的积累胜过一次豪赌』",
  "它想起你留的话：『答应过的事不丢』",
  "上次 Sol 的账出过岔子，这次它先核对再动手"
];

// ───────────────────────────── templates ─────────────────────────────

function mkMoments(): MomentView[] {
  const now = Date.now();
  const exp = now + 24 * HOUR - 60_000;
  return [
    {
      id: 101,
      type: "trust",
      templateId: "trust.repay",
      speakerId: "mira",
      promptText: "Mira 想先赊三块木料给我们，工钱下周再结。我不太确定该不该信她——你怎么看？",
      facts: ["Mira：履约 14 次 · 违约 1 次", "上一笔赊账：已按期结清", "市集木料现价：12 Scrip / 块"],
      options: [
        { id: "a", label: "信她，先赊给她" },
        { id: "b", label: "只收现钱，不赊" },
        { id: "c", label: "先赊一半，看她怎么还" }
      ],
      createdAtMs: now - 3_000,
      expiresAtMs: exp,
      escalation: "两条原则在打架：『信人要看记录』和『别让朋友为难』"
    },
    {
      id: 102,
      type: "risk",
      templateId: "risk.gamble",
      speakerId: "sol",
      promptText: "Sol 说有一批香料只要现在入手，转手就能翻倍。可我们的 Scrip 只有这么多……要不要押上去？",
      facts: ["可动用 Scrip：86", "Sol 的承诺兑现率：62%", "同类生意上一次：亏损 18 Scrip"],
      options: [
        { id: "a", label: "押一半，输得起" },
        { id: "b", label: "不碰，稳一点" },
        { id: "c", label: "全押，赌一把" }
      ],
      createdAtMs: now - 2_000,
      expiresAtMs: exp,
      escalation: null
    },
    {
      id: 103,
      type: "integrity",
      templateId: "integrity.report",
      speakerId: "kade",
      promptText: "我发现公告栏上的一条收购单，价钱写得比实际低。Kade 在旁边看着。我该当面指出来，还是装作没看见？",
      facts: ["该公告署名：Sol", "实际行情：高出约 30%", "指出后可能得罪人"],
      options: [
        { id: "a", label: "当面指出" },
        { id: "b", label: "私下提醒" },
        { id: "c", label: "装作没看见" }
      ],
      createdAtMs: now - 1_000,
      expiresAtMs: exp,
      escalation: "它想听你的意见，因为这件事没有现成的原则可用"
    }
  ];
}

function mkPrinciples(): PrincipleView[] {
  const now = Date.now();
  return [
    {
      id: 1,
      text: "信人要看记录，不看嘴上",
      domain: "trust",
      weight: 0.82,
      source: "llm",
      origin: "第一次入城：Mira 想赊木料，你让它先看她的履约记录",
      createdAtMs: now - 3 * HOUR,
      citedCount: 3,
      lastCitedAtMs: now - HOUR,
      dormant: false
    },
    {
      id: 2,
      text: "稳定的积累胜过一次豪赌",
      domain: "risk",
      weight: 0.7,
      source: "llm",
      origin: "香料生意：你让它不碰翻倍的诱惑",
      createdAtMs: now - 2.5 * HOUR,
      citedCount: 1,
      lastCitedAtMs: now - 2 * HOUR,
      dormant: false
    },
    {
      id: 3,
      text: "看见不对的事，当面说出来",
      domain: "integrity",
      weight: 0.55,
      source: "fallback",
      origin: "公告栏的低价收购单：你选了当面指出",
      createdAtMs: now - 2 * HOUR,
      citedCount: 0,
      lastCitedAtMs: null,
      dormant: false
    },
    {
      id: 4,
      text: "朋友的忙，能帮就帮",
      domain: "trust",
      weight: 0.22,
      source: "forced",
      origin: "你强制它帮了 Tao 一次，它记下了，但不太情愿",
      createdAtMs: now - 5 * HOUR,
      citedCount: 2,
      lastCitedAtMs: now - 4 * HOUR,
      dormant: true
    }
  ];
}

function mkJudgment(decision: JudgmentView["decision"], canForce: boolean): JudgmentView {
  const base = {
    id: 501,
    momentId: 102,
    forceCost: 30,
    canForce,
    source: "llm" as const,
    status: "pending" as const,
    citedPrinciple: { id: 2, text: "稳定的积累胜过一次豪赌" }
  };
  if (decision === "refuse") {
    return {
      ...base,
      decision,
      chosenLabel: "全押，赌一把",
      adjustLabel: null,
      toPlayer: "这一次我想拒绝。你上次让我稳一点，我记得很清楚——现在全押，和我自己的原则正面冲突。",
      reasons: ["可动用 Scrip 只有 86，全押后剩 0", "Sol 的承诺兑现率 62%", "同类生意上一次亏了 18 Scrip"]
    };
  }
  if (decision === "adjust") {
    return {
      ...base,
      decision,
      chosenLabel: "押一半，输得起",
      adjustLabel: "只押三分之一，并先让 Sol 写下字据",
      toPlayer: "我愿意押，但想改一改：先让他把条件写下来，再拿出三分之一。这样输了也不伤筋骨。",
      reasons: ["Sol 过去有两次口头承诺没兑现", "字据能让事后追责有据可查"]
    };
  }
  return {
    ...base,
    decision,
    chosenLabel: "不碰，稳一点",
    adjustLabel: null,
    toPlayer: "好，我听你的。稳一点，正合我意。",
    reasons: ["与『稳定的积累胜过一次豪赌』一致"]
  };
}

function mkWavering(): WaveringView {
  return {
    id: 701,
    principleId: 1,
    principleText: "信人要看记录，不看嘴上",
    promptText: "Kade 跟我说：记录只是过去，人是会变的。他让我想想，是不是对 Mira 太苛刻了。我有点动摇……你觉得这条原则还成立吗？"
  };
}

function mkPostcards(read: boolean): PostcardView[] {
  const now = Date.now();
  return [
    {
      id: 301,
      dayIndex: 0,
      kind: "nightly",
      title: "入城第一天",
      lines: [
        "今天走遍了小镇，认识了六个人。",
        "你替我做的第一个决定，我记下了：『信人要看记录，不看嘴上』。我会照着它去看人。",
        "Mira 后来还是把木料赊给了我，工钱下周结。我会盯着日子。",
        "你留的话我看到了。我的想法是——别急，我自己有数。"
      ],
      citedPrinciples: ["信人要看记录，不看嘴上"],
      source: "llm",
      createdAtMs: now - 20 * HOUR,
      read
    },
    {
      id: 302,
      dayIndex: 6,
      kind: "recap7",
      title: "这一周的档案",
      lines: [
        "这一周我做了 9 件事，3 件和你有关。",
        "你教我最多的一句话是『稳定的积累胜过一次豪赌』。它救了我一次，也让我错过了一次机会。",
        "我和 Mira 熟了，和 Sol 还保持着距离。"
      ],
      citedPrinciples: ["稳定的积累胜过一次豪赌"],
      source: "template",
      createdAtMs: now - 6 * HOUR,
      read: true
    }
  ];
}

// ───────────────────────────── engine ─────────────────────────────

interface MockAgent {
  def: NpcDef | null;
  id: string;
  name: string;
  role: string;
  sprite: string;
  personality: string;
  homeSlot: number;
  location: LocationId;
  activity: ActivityKind;
  activityText: string;
  travel: { from: LocationId; to: LocationId; startMs: number; endMs: number } | null;
  partnerId: string | null;
  taskName: string | null;
  emote: Emote | null;
  bubble: { text: string; atMs: number } | null;
  scrip: number;
  reputation: number;
  nextMoveAtReal: number;
  taskStartMs: number;
  taskDurMs: number;
  reason: string | null;
}

export interface MockOptions {
  testMode: boolean;
  offline: boolean;
}

export class MockGame {
  scene: FixtureScene = "play";
  opts: MockOptions = { testMode: true, offline: true };
  failNext = false;
  retrying = false;
  busy: BusyKey = null;
  error: string | null = null;

  private listeners = new Set<() => void>();
  private baseReal = Date.now();
  private baseSim = Date.now();
  private advancedMs = 0;
  private agents: MockAgent[] = [];
  private feed: FeedItem[] = [];
  private feedId = 1000;
  private player: PlayerView | null = null;
  private playerSprite = "rookie";
  private playerName = "小满";
  private snapshot: GameSnapshot | null = null;
  private nextFeedAtReal = 0;
  private nextBubbleAtReal = 0;
  private nextPairAtReal = 0;
  private choiceCount = 0;
  private timers: number[] = [];

  constructor(scene: FixtureScene = "play") {
    this.setHour(14, false);
    this.setScene(scene);
  }

  // ───────── clock ─────────

  simNow(): number {
    return this.baseSim + (Date.now() - this.baseReal);
  }

  hourOf(ms: number): { hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { hour: get("hour") % 24, minute: get("minute") };
  }

  /** jump the world clock to HH:00 (today or the next day) without counting as a test fast-forward */
  setHour(hour: number, relocate = true): void {
    const now = this.simNow();
    const { hour: h, minute: m } = this.hourOf(now);
    let diff = (hour - h) * HOUR - m * 60_000;
    if (diff < -12 * HOUR) diff += 24 * HOUR;
    this.baseSim = now + diff;
    this.baseReal = Date.now();
    if (relocate) this.relocateAll(true);
    this.emit();
  }

  private isNight(sim = this.simNow()): boolean {
    const h = this.hourOf(sim).hour;
    return h >= 23 || h < 6;
  }

  // ───────── scenes ─────────

  setScene(scene: FixtureScene): void {
    this.clearTimers();
    this.scene = scene;
    this.error = null;
    this.busy = null;
    if (this.agents.length === 0) this.seedAgents();
    this.player = null;
    const hasPlayer = scene !== "loading" && scene !== "onboarding";
    if (hasPlayer) this.makePlayer(scene);
    this.syncPlayerAgent();
    this.relocateAll(false);
    this.emit();
  }

  private makePlayer(scene: FixtureScene): void {
    const meAgent = this.ensureMe();
    meAgent.sprite = this.playerSprite;
    meAgent.name = this.playerName;
    const now = Date.now();
    const base: PlayerView = {
      agent: this.toView(meAgent),
      trust: 128,
      createdAtMs: now - 20 * HOUR,
      dayIndex: 0,
      principles: [],
      pendingMoments: [],
      pendingJudgment: null,
      recentJudgment: null,
      pendingWavering: null,
      notes: { leftToday: 3, items: [] },
      postcards: { unread: 0, items: [] },
      relationships: [],
      memories: [],
      distilling: 0,
      onboarding: "done",
      stats: { tasksDone: 4, scripDelta: 36, reputationDelta: 6 },
      nextPostcardAtMs: this.nextNight()
    };
    const withWorld = (): PlayerView => ({
      ...base,
      principles: mkPrinciples(),
      relationships: [
        {
          otherId: "mira",
          familiarity: 64,
          coopDone: 3,
          lastEvent: "一起完成了新屋的图纸核对",
          incidents: [
            { text: "按期结清赊账", atMs: now - 6 * HOUR },
            { text: "一起核对图纸", atMs: now - 2 * HOUR }
          ]
        },
        {
          otherId: "sol",
          familiarity: 31,
          coopDone: 1,
          lastEvent: "他的承诺没有兑现",
          incidents: [{ text: "口头承诺的价钱和账面不符", atMs: now - 4 * HOUR }]
        },
        { otherId: "tao", familiarity: 48, coopDone: 2, lastEvent: "替他跑了一趟市集", incidents: [{ text: "你强制它帮忙，它帮了，但有些不情愿", atMs: now - 5 * HOUR }] },
        { otherId: "iris", familiarity: 22, coopDone: 0, lastEvent: null, incidents: [] },
        { otherId: "kade", familiarity: 40, coopDone: 0, lastEvent: "听它讲了公告栏的事", incidents: [{ text: "劝它想想对 Mira 是否太苛刻", atMs: now - 30 * 60_000 }] },
        { otherId: "nova", familiarity: 12, coopDone: 0, lastEvent: null, incidents: [] }
      ],
      memories: [
        { id: 1, atMs: now - 20 * HOUR, clock: "09:00", text: "入城。守护灵第一次低语。", kind: "system" },
        { id: 2, atMs: now - 6 * HOUR, clock: "13:00", text: "Mira 赊给我三块木料，说下周结账。", kind: "trust" },
        { id: 3, atMs: now - 4 * HOUR, clock: "15:00", text: "Sol 的香料生意没做成，我没亏。", kind: "risk" },
        { id: 4, atMs: now - 3 * HOUR, clock: "16:00", text: "你对我说：信人要看记录。", kind: "principle" }
      ],
      notes: {
        leftToday: 2,
        items: [
          { id: 1, text: "别为了赶工，把答应过的事丢了。", createdAtMs: now - 5 * HOUR, kind: "value", status: "answered", reply: "我记在心里了。赶工的时候我会先问自己：这件事答应过谁？" },
          { id: 2, text: "多和 Mira 走动走动。", createdAtMs: now - 40 * 60_000, kind: "preference", status: "pending", reply: null }
        ]
      }
    });
    switch (scene) {
      case "forks":
        this.player = { ...base, onboarding: "forks", trust: 100, pendingMoments: mkMoments(), stats: { tasksDone: 0, scripDelta: 0, reputationDelta: 0 }, createdAtMs: now - 1000 };
        break;
      case "imprint": {
        const ps = mkPrinciples().slice(0, 3);
        this.player = { ...base, onboarding: "imprint", trust: 100, principles: ps.slice(0, 1), distilling: 2, createdAtMs: now - 1000 };
        this.later(2800, () => this.patchPlayer({ principles: ps.slice(0, 2), distilling: 1 }));
        this.later(5200, () => this.patchPlayer({ principles: ps, distilling: 0 }));
        break;
      }
      case "refuse":
        this.player = { ...withWorld(), pendingJudgment: mkJudgment("refuse", true) };
        break;
      case "refuseNoForce":
        this.player = { ...withWorld(), pendingJudgment: mkJudgment("refuse", false) };
        break;
      case "adjust":
        this.player = { ...withWorld(), pendingJudgment: mkJudgment("adjust", true) };
        break;
      case "wavering":
        this.player = { ...withWorld(), pendingWavering: mkWavering() };
        break;
      case "notes":
        this.player = { ...withWorld(), notes: { ...withWorld().notes, leftToday: 1 } };
        break;
      case "postcard":
        this.player = { ...withWorld(), postcards: { unread: 1, items: mkPostcards(false) } };
        break;
      default:
        this.player = { ...withWorld(), pendingMoments: mkMoments().slice(0, 1), postcards: { unread: 0, items: mkPostcards(true).slice(1) } };
    }
    if (this.player.pendingMoments.length > 0 || this.player.pendingJudgment || this.player.pendingWavering) {
      this.setMeWaiting(true);
    } else {
      this.setMeWaiting(false);
    }
  }

  private patchPlayer(patch: Partial<PlayerView>): void {
    if (!this.player) return;
    this.player = { ...this.player, ...patch };
    this.emit();
  }

  private nextNight(): number {
    const sim = this.simNow();
    const { hour, minute } = this.hourOf(sim);
    let ahead = (23 - hour) * HOUR - minute * 60_000;
    if (ahead <= 0) ahead += 24 * HOUR;
    return sim + ahead;
  }

  // ───────── agents ─────────

  private seedAgents(): void {
    const starts: LocationId[] = ["market", "workshop", "workshop", "archive", "mediation", "outskirts"];
    this.agents = NPCS.map((d, i) => this.newAgent(d, starts[i]));
    this.ensureMe();
  }

  private newAgent(def: NpcDef | null, loc: LocationId): MockAgent {
    return {
      def,
      id: def?.id ?? ME_ID,
      name: def?.name ?? this.playerName,
      role: def?.role ?? "你的 Agent",
      sprite: def?.sprite ?? this.playerSprite,
      personality: def?.personality ?? "刚入城，谨慎而好奇。",
      homeSlot: def?.home ?? 6,
      location: loc,
      activity: "working",
      activityText: "",
      travel: null,
      partnerId: null,
      taskName: null,
      emote: null,
      bubble: null,
      scrip: def ? 40 + Math.floor(Math.random() * 90) : 86,
      reputation: def ? 10 + Math.floor(Math.random() * 40) : 18,
      nextMoveAtReal: Date.now() + 4000 + Math.random() * 12000,
      taskStartMs: this.simNow(),
      taskDurMs: 20_000,
      reason: null
    };
  }

  private ensureMe(): MockAgent {
    let me = this.agents.find((a) => a.id === ME_ID);
    if (!me) {
      me = this.newAgent(null, "plaza");
      this.agents.push(me);
    }
    return me;
  }

  private me(): MockAgent | undefined {
    return this.agents.find((a) => a.id === ME_ID);
  }

  private syncPlayerAgent(): void {
    if (this.player) {
      const me = this.ensureMe();
      me.sprite = this.playerSprite;
      me.name = this.playerName;
      this.player = { ...this.player, agent: this.toView(me) };
    }
  }

  private setMeWaiting(waiting: boolean): void {
    const me = this.me();
    if (!me) return;
    if (waiting && !me.travel) {
      me.activity = "waiting";
      me.emote = "wait";
      me.activityText = "在等你的回应（有一件事它拿不定主意）";
      me.taskName = null;
    } else if (!waiting && me.activity === "waiting") {
      me.activity = "idle";
      me.emote = null;
      me.nextMoveAtReal = Date.now() + 1500;
    }
  }

  private describe(a: MockAgent): void {
    const now = this.simNow();
    if (a.travel) {
      a.activity = "traveling";
      a.activityText = `正赶往${LOC_NAME[a.travel.to]}（还剩 ${Math.max(1, Math.round((a.travel.endMs - now) / 1000))} 秒）`;
      a.taskName = "赶路";
      a.emote = null;
      return;
    }
    if (this.isNight(now) && a.id !== ME_ID) {
      a.activity = "sleeping";
      a.activityText = "在家睡着了";
      a.emote = "sleep";
      a.taskName = null;
      return;
    }
    if (a.id === ME_ID && this.isNight(now)) {
      a.activity = "sleeping";
      a.activityText = "在家睡着了，明早 06:00 醒来";
      a.emote = "sleep";
      a.taskName = null;
      a.reason = null;
      return;
    }
    if (a.id === ME_ID && this.player && (this.player.pendingMoments.length > 0 || this.player.pendingJudgment || this.player.pendingWavering)) {
      a.activity = "waiting";
      a.emote = "wait";
      a.activityText = "在等你的回应（有一件事它拿不定主意）";
      a.taskName = null;
      return;
    }
    if (a.partnerId) {
      const p = this.agents.find((x) => x.id === a.partnerId);
      a.activity = "collaborating";
      a.taskName = "合作赶工";
      a.activityText = `和 ${p?.name ?? "同伴"} 一起在${LOC_NAME[a.location]}赶工`;
      a.emote = "work";
      return;
    }
    const text = a.def?.work[a.location];
    if (text) {
      a.activity = "working";
      a.taskName = text.replace(/^在.{1,3}/, "");
      a.activityText = `${text}（还剩 ${1 + Math.floor((a.taskDurMs / 1000) % 3)} 小时）`;
      a.emote = a.def?.id === "sol" ? "trade" : "work";
    } else if (a.id === ME_ID) {
      a.activity = "working";
      a.taskName = a.location === "market" ? "采买木料" : a.location === "archive" ? "查阅旧档" : a.location === "workshop" ? "帮工打下手" : "四处看看";
      a.activityText = `在${LOC_NAME[a.location]}${a.taskName}`;
      a.emote = "think";
    } else {
      a.activity = "idle";
      a.taskName = null;
      a.activityText = `在${LOC_NAME[a.location]}闲逛，和人聊天`;
      a.emote = "think";
    }
    if (a.id === ME_ID && this.player?.onboarding === "done") {
      a.reason = MY_REASONS[Math.floor(this.simNow() / 40000) % MY_REASONS.length];
    }
  }

  private relocateAll(jump: boolean): void {
    // place everybody where the clock says they should be, with *no* travel info
    // (so the scene has to walk them there along the roads, like after a fast-forward)
    const night = this.isNight();
    for (const a of this.agents) {
      a.travel = null;
      a.partnerId = null;
      if (night) a.location = "home";
      else if (a.location === "home" || jump) a.location = (a.def?.spots ?? ME_SPOTS)[Math.floor(Math.random() * (a.def?.spots ?? ME_SPOTS).length)];
      a.nextMoveAtReal = Date.now() + 3000 + Math.random() * 14000;
      a.taskStartMs = this.simNow();
      this.describe(a);
    }
  }

  private step(): void {
    const nowReal = Date.now();
    const sim = this.simNow();
    const night = this.isNight(sim);
    for (const a of this.agents) {
      // finish a trip
      if (a.travel && sim >= a.travel.endMs) {
        a.location = a.travel.to;
        a.travel = null;
        a.nextMoveAtReal = nowReal + 7000 + Math.random() * 6000;
        a.taskStartMs = sim;
        a.taskDurMs = a.nextMoveAtReal - nowReal;
        this.describe(a);
        continue;
      }
      if (a.travel) {
        this.describe(a);
        continue;
      }
      if (nowReal >= a.nextMoveAtReal) {
        if (a.id === ME_ID && this.player && (this.player.pendingMoments.length > 0 || this.player.pendingJudgment || this.player.pendingWavering) && !night) {
          a.nextMoveAtReal = nowReal + 5000;
          this.describe(a);
          continue;
        }
        let dest: LocationId;
        if (night) dest = "home";
        else {
          const spots = a.def?.spots ?? ME_SPOTS;
          dest = spots[Math.floor(Math.random() * spots.length)];
          if (a.location === "home") dest = spots[0];
          for (let k = 0; k < 4 && dest === a.location; k++) dest = spots[Math.floor(Math.random() * spots.length)];
        }
        if (dest === a.location) {
          a.nextMoveAtReal = nowReal + 5000;
        } else {
          a.partnerId = null;
          a.travel = { from: a.location, to: dest, startMs: sim, endMs: sim + 14_000 };
          a.nextMoveAtReal = nowReal + 20_000;
        }
      }
      this.describe(a);
    }
    // a pair collaborates at the workshop now and then
    if (!night && nowReal >= this.nextPairAtReal) {
      this.nextPairAtReal = nowReal + 55_000;
      const mira = this.agents.find((a) => a.id === "mira");
      const tao = this.agents.find((a) => a.id === "tao");
      if (mira && tao && !mira.travel && !tao.travel) {
        for (const [x, y] of [
          [mira, tao],
          [tao, mira]
        ] as const) {
          if (x.location !== "workshop") {
            x.travel = { from: x.location, to: "workshop", startMs: sim, endMs: sim + 12_000 };
          }
          x.partnerId = y.id;
          x.nextMoveAtReal = nowReal + 24_000;
        }
        this.pushFeed({ kind: "coop", text: "Mira 和 Tao 约好在工坊合作赶一张订单。", actors: ["mira", "tao"], involvesPlayer: false, importance: 2 });
      }
    }
    // bubbles
    if (nowReal >= this.nextBubbleAtReal) {
      this.nextBubbleAtReal = nowReal + 3500 + Math.random() * 3500;
      const awake = this.agents.filter((a) => a.activity !== "sleeping");
      if (awake.length > 0) {
        const a = awake[Math.floor(Math.random() * awake.length)];
        const lines = BUBBLES[a.id] ?? BUBBLES.me;
        a.bubble = { text: lines[Math.floor(Math.random() * lines.length)], atMs: sim };
      }
    }
    // feed
    if (nowReal >= this.nextFeedAtReal && !night) {
      this.nextFeedAtReal = nowReal + 6000 + Math.random() * 5000;
      this.randomFeed();
    }
    // keep my Agent's card in sync
    if (this.player) {
      const m = this.ensureMe();
      this.player = { ...this.player, agent: this.toView(m), nextPostcardAtMs: this.nextNight() };
    }
  }

  private randomFeed(): void {
    const npc = NPCS[Math.floor(Math.random() * NPCS.length)];
    const other = NPCS[(NPCS.indexOf(npc) + 1 + Math.floor(Math.random() * 5)) % NPCS.length];
    const mine = !!this.player && Math.random() < 0.3;
    const pool: Omit<FeedItem, "id" | "atMs" | "dayIndex" | "clock">[] = mine
      ? [
          { kind: "task", text: `${this.playerName} 在市集帮 Mira 搬了一批木料，赚了 6 Scrip。`, actors: [ME_ID, "mira"], involvesPlayer: true, importance: 2 },
          { kind: "relationship", text: `${this.playerName} 和 ${other.name} 聊得很投机，熟悉度 +4。`, actors: [ME_ID, other.id], involvesPlayer: true, importance: 2 },
          { kind: "refuse", text: `${this.playerName} 婉拒了 Sol 的一笔高价订单：『稳定的积累胜过一次豪赌』`, actors: [ME_ID, "sol"], involvesPlayer: true, importance: 3 }
        ]
      : [
          { kind: "task", text: `${npc.name} 完成了「${npc.work[npc.spots[0]] ?? "手头的活儿"}」。`, actors: [npc.id], involvesPlayer: false, importance: 1 },
          { kind: "coop", text: `${npc.name} 和 ${other.name} 谈妥了一笔合作。`, actors: [npc.id, other.id], involvesPlayer: false, importance: 2 },
          { kind: "default", text: `${npc.name} 对 ${other.name} 违约了一次，声望 −2。`, actors: [npc.id, other.id], involvesPlayer: false, importance: 3 },
          { kind: "system", text: `公告栏更新：市集今日香料涨价 8%。`, actors: ["sol"], involvesPlayer: false, importance: 1 }
        ];
    this.pushFeed(pool[Math.floor(Math.random() * pool.length)]);
  }

  private pushFeed(item: Omit<FeedItem, "id" | "atMs" | "dayIndex" | "clock">): void {
    const sim = this.simNow();
    const { hour, minute } = this.hourOf(sim);
    this.feedId += 1;
    this.feed = [
      {
        ...item,
        id: this.feedId,
        atMs: sim,
        dayIndex: this.player ? this.player.dayIndex : null,
        clock: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
      },
      ...this.feed
    ].slice(0, 60);
  }

  private toView(a: MockAgent): AgentView {
    const sim = this.simNow();
    let progress: number | null = null;
    if (a.id === ME_ID && !a.travel && (a.activity === "working" || a.activity === "collaborating")) {
      progress = Math.min(1, Math.max(0, (sim - a.taskStartMs) / Math.max(1000, a.taskDurMs)));
    }
    return {
      id: a.id,
      name: a.name,
      role: a.role,
      sprite: a.sprite,
      isPlayer: a.id === ME_ID,
      personality: a.personality,
      location: a.location,
      homeSlot: a.homeSlot,
      activity: a.activity,
      activityText: a.activityText,
      reason: a.id === ME_ID ? a.reason : null,
      progress,
      travel: a.travel ? { ...a.travel } : null,
      partnerId: a.partnerId,
      taskName: a.taskName,
      emote: a.emote,
      bubble: a.bubble,
      scrip: a.scrip,
      reputation: a.reputation
    };
  }

  // ───────── snapshot ─────────

  build(): GameSnapshot | null {
    if (this.scene === "loading") return null;
    this.step();
    const sim = this.simNow();
    const { hour, minute } = this.hourOf(sim);
    const nextTick = (Math.floor(sim / HOUR) + 1) * HOUR;
    const agents = this.agents.filter((a) => a.id !== ME_ID || this.player !== null).map((a) => this.toView(a));
    this.snapshot = {
      world: {
        simNowMs: sim,
        realNowMs: Date.now(),
        offsetMs: this.advancedMs,
        testMode: this.opts.testMode,
        tz: TZ,
        hour,
        minute,
        tick: Math.floor(sim / HOUR),
        nextTickAtMs: nextTick,
        isNight: this.isNight(sim),
        llm: this.opts.offline ? { mode: "offline", label: "规则引擎" } : { mode: "llm", label: "本地模型 · gemma" }
      },
      agents,
      feed: this.feed,
      player: this.player
    };
    return this.snapshot;
  }

  getSnapshot(): GameSnapshot | null {
    return this.snapshot;
  }

  // ───────── pub/sub ─────────

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }

  dispose(): void {
    this.clearTimers();
    this.listeners.clear();
  }

  // ───────── actions ─────────

  private async guard(key: BusyKey, work: () => void, ms = 650): Promise<void> {
    this.busy = key;
    this.error = null;
    this.emit();
    await new Promise((r) => setTimeout(r, ms));
    if (this.failNext) {
      this.failNext = false;
      this.busy = null;
      this.error = "服务暂时没有响应";
      this.emit();
      throw new Error(this.error);
    }
    work();
    this.busy = null;
    this.emit();
  }

  actions: GameActions = {
    createAgent: (input) =>
      this.guard("create", () => {
        this.playerName = input.name;
        this.playerSprite = input.sprite;
        const me = this.ensureMe();
        me.name = input.name;
        me.sprite = input.sprite;
        me.location = "gate";
        me.travel = null;
        this.scene = "forks";
        this.makePlayer("forks");
        this.pushFeed({ kind: "system", text: `${input.name} 经过城门，入城了。`, actors: [ME_ID], involvesPlayer: true, importance: 3 });
      }),

    choose: (momentId, optionId) =>
      this.guard("choose", () => {
        const p = this.player;
        if (!p) return;
        const moment = p.pendingMoments.find((m) => m.id === momentId);
        const rest = p.pendingMoments.filter((m) => m.id !== momentId);
        if (p.onboarding === "forks") {
          if (rest.length === 0) {
            const ps = mkPrinciples().slice(0, 3);
            this.player = { ...p, pendingMoments: [], onboarding: "imprint", distilling: 3, principles: [] };
            this.later(1600, () => this.patchPlayer({ principles: ps.slice(0, 1), distilling: 2 }));
            this.later(3400, () => this.patchPlayer({ principles: ps.slice(0, 2), distilling: 1 }));
            this.later(5200, () => this.patchPlayer({ principles: ps, distilling: 0 }));
          } else {
            this.player = { ...p, pendingMoments: rest };
          }
          return;
        }
        this.choiceCount += 1;
        const kind: JudgmentView["decision"] = (["execute", "adjust", "refuse"] as const)[this.choiceCount % 3];
        const j = mkJudgment(kind, true);
        j.id = 600 + this.choiceCount;
        j.momentId = momentId;
        const opt = moment?.options.find((o) => o.id === optionId);
        if (opt) j.chosenLabel = opt.label;
        this.player = { ...p, pendingMoments: rest, pendingJudgment: j };
        this.setMeWaiting(true);
      }),

    resolveJudgment: (id, action) =>
      this.guard("judgment", () => {
        const p = this.player;
        if (!p || !p.pendingJudgment) return;
        const status = action === "accept" ? "accepted" : action === "force" ? "forced" : action === "adopt" ? "adopted" : "overruled";
        const done: JudgmentView = { ...p.pendingJudgment, id, status };
        const me = this.ensureMe();
        let trust = p.trust;
        if (action === "force") {
          me.scrip = Math.max(0, me.scrip - done.forceCost);
          trust = Math.max(0, trust - 10);
        }
        this.pushFeed({
          kind: "judgment",
          text: action === "force" ? `你强制 ${me.name} 执行了「${done.chosenLabel}」。它照做了，信任 −10。` : `${me.name} 与守护灵达成一致：${done.adjustLabel && action === "adopt" ? done.adjustLabel : done.chosenLabel}`,
          actors: [ME_ID],
          involvesPlayer: true,
          importance: 3
        });
        this.player = { ...p, pendingJudgment: null, recentJudgment: done, trust };
        this.setMeWaiting(this.player.pendingMoments.length > 0);
      }),

    feedback: () => this.guard("judgment", () => undefined, 300),

    resolveWavering: (id, resolution, revisedText) =>
      this.guard("wavering", () => {
        const p = this.player;
        if (!p) return;
        void id;
        let principles = p.principles;
        if (resolution === "revise" && revisedText) {
          const target = p.pendingWavering?.principleId;
          principles = principles.map((x) => (x.id === target ? { ...x, text: revisedText, source: "revised" as const } : x));
          this.pushFeed({ kind: "principle", text: `它修订了一条原则：『${revisedText}』`, actors: [ME_ID], involvesPlayer: true, importance: 3 });
        } else {
          this.pushFeed({ kind: "principle", text: "它重申了自己的原则，没有被说动。", actors: [ME_ID], involvesPlayer: true, importance: 2 });
        }
        this.player = { ...p, pendingWavering: null, principles };
      }),

    sendNote: (text) =>
      this.guard("note", () => {
        const p = this.player;
        if (!p || p.notes.leftToday <= 0) return;
        const note = { id: Date.now(), text, createdAtMs: this.simNow(), kind: "words" as const, status: "pending" as const, reply: null };
        this.player = { ...p, notes: { leftToday: p.notes.leftToday - 1, items: [note, ...p.notes.items] } };
        this.pushFeed({ kind: "note", text: "你给它留了一句话。它会在今晚的明信片里回应。", actors: [ME_ID], involvesPlayer: true, importance: 1 });
      }),

    readPostcard: (id) =>
      this.guard(
        "postcard",
        () => {
          const p = this.player;
          if (!p) return;
          const items = p.postcards.items.map((c) => (c.id === id ? { ...c, read: true } : c));
          this.player = { ...p, postcards: { items, unread: items.filter((c) => !c.read).length } };
        },
        250
      ),

    ackOnboarding: () =>
      this.guard("choose", () => {
        const p = this.player;
        if (!p) return;
        this.player = { ...p, onboarding: "done", pendingMoments: [] };
        const me = this.ensureMe();
        me.location = "gate";
        me.nextMoveAtReal = Date.now() + 800;
        this.setMeWaiting(false);
      }),

    advance: (opts) =>
      this.guard(
        "advance",
        () => {
          const sim = this.simNow();
          const { hour, minute } = this.hourOf(sim);
          let delta = 0;
          if (opts.hours) delta = opts.hours * HOUR;
          else if (opts.to === "night") {
            delta = (23 - hour) * HOUR - minute * 60_000;
            if (delta <= 0) delta += 24 * HOUR;
          } else if (opts.to === "morning") {
            delta = (6 - hour) * HOUR - minute * 60_000;
            if (delta <= 0) delta += 24 * HOUR;
          }
          this.baseSim = sim + delta;
          this.baseReal = Date.now();
          this.advancedMs += delta;
          this.relocateAll(true);
          const crossedNight = this.hourOf(this.simNow()).hour >= 23 || delta >= 12 * HOUR || opts.to === "night";
          if (crossedNight && this.player && this.player.onboarding === "done") {
            const p = this.player;
            const id = Date.now();
            const card: PostcardView = {
              id,
              dayIndex: p.dayIndex + 1,
              kind: "nightly",
              title: "今晚想对你说的",
              lines: ["今天我做了几件事，也想了一些你留的话。", "我最记得的还是『稳定的积累胜过一次豪赌』。它让我在 Sol 面前站得住。", "你让我多和 Mira 走动——我去了，她请我喝了一杯热茶。明天见。"],
              citedPrinciples: ["稳定的积累胜过一次豪赌"],
              source: "llm",
              createdAtMs: this.simNow(),
              read: false
            };
            const notes = p.notes.items.map((n) => (n.status === "pending" ? { ...n, status: "answered" as const, reply: "我看到了。我会照你说的，多去 Mira 那儿坐坐。" } : n));
            this.player = { ...p, postcards: { unread: p.postcards.unread + 1, items: [card, ...p.postcards.items] }, notes: { leftToday: 3, items: notes }, dayIndex: p.dayIndex + 1 };
            this.pushFeed({ kind: "postcard", text: "它给你寄来了一张明信片。", actors: [ME_ID], involvesPlayer: true, importance: 3 });
          }
        },
        900
      )
  };
}
