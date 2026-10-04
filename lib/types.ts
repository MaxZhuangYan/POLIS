// Shared contract between the simulation (lib/*, app/api/*) and the client
// (Phaser town + React HUD). Everything the client renders comes from
// GET /api/game/state as a GameSnapshot — the client never invents facts.
//
// Time: all *Ms fields are SIMULATED wall-clock ms (real Date.now() plus the
// world's test fast-forward offset). In normal play offsetMs === 0 and sim
// time == real time (tick = 1 real hour, per 玩法设计 v1.5 §3.5 / §10.2).

export type Domain = "trust" | "risk" | "integrity";

export type LocationId =
  | "archive" // 档案馆 · Iris
  | "market" // 市集 · Sol / Mira
  | "plaza" // 广场（喷泉）
  | "workshop" // 工坊 · Tao
  | "outskirts" // 城邦外围 · Nova
  | "mediation" // 调解所 · Kade
  | "hall" // 议事厅
  | "board" // 公告栏
  | "gate" // 城门（新 Agent 入城处）
  | "home"; // 住宅区（每个 Agent 在住宅区有自己的门牌，见 AgentView.homeSlot）

export type ActivityKind =
  | "sleeping"
  | "planning"
  | "traveling"
  | "working"
  | "collaborating"
  | "idle"
  | "socializing"
  | "waiting"; // 等守护灵回应（有待决岔路）

export type Emote = "think" | "trade" | "wait" | "happy" | "upset" | "sleep" | "work" | "alert";

export interface TravelView {
  from: LocationId;
  to: LocationId;
  startMs: number;
  endMs: number;
}

export interface AgentView {
  id: string;
  name: string;
  role: string; // 中文职业，例如 "营造师"
  sprite: string; // 素材 key：architect|broker|maker|archivist|mediator|scout|rookie|courier|guide
  isPlayer: boolean;
  personality: string;
  location: LocationId;
  homeSlot: number; // 0..8，住宅区里的门牌号
  activity: ActivityKind;
  activityText: string; // 例如 "在档案馆抄录旧档（还剩 2 小时）"
  // 为什么这么做（可追溯到原则/记忆），例如 "你说过『稳定的积累胜过一次豪赌』"；无则 null
  reason: string | null;
  // 当前任务进度 0..1（无任务为 null），用于顶部"当前行动"进度条
  progress: number | null;
  travel: TravelView | null;
  partnerId: string | null;
  taskName: string | null;
  emote: Emote | null;
  bubble: { text: string; atMs: number } | null; // 最近一条真实发生的台词/事件
  scrip: number;
  reputation: number;
}

export interface FeedItem {
  id: number;
  atMs: number;
  dayIndex: number | null; // 相对玩家 Agent 入城的第几天（0 = 入城当天）
  clock: string; // "09:00"
  kind:
    | "task"
    | "coop"
    | "default"
    | "refuse"
    | "moment"
    | "principle"
    | "judgment"
    | "note"
    | "postcard"
    | "trust"
    | "risk"
    | "relationship"
    | "system";
  text: string;
  actors: string[]; // agent ids，点击可聚焦镜头
  involvesPlayer: boolean;
  importance: 1 | 2 | 3;
}

export interface PrincipleView {
  id: number;
  text: string;
  domain: Domain;
  weight: number;
  source: "llm" | "fallback" | "forced" | "revised" | "core" | "note";
  origin: string; // 诞生场景一句话
  createdAtMs: number;
  citedCount: number;
  lastCitedAtMs: number | null;
  dormant: boolean;
}

export interface MomentOptionView {
  id: string;
  label: string;
}

export interface MomentView {
  id: number;
  type: Domain;
  templateId: string;
  speakerId: string | null; // 情境中的 NPC（用于头像）
  promptText: string; // Agent 第一人称向守护灵求意见
  facts: string[]; // 可核查的背景事实，例如 "Mira：履约 14 次 · 违约 1 次"
  options: MomentOptionView[];
  createdAtMs: number;
  expiresAtMs: number;
  escalation: string | null; // 为什么推给你："两条原则在打架" 等
}

export interface JudgmentView {
  id: number;
  momentId: number;
  decision: "execute" | "adjust" | "refuse";
  chosenLabel: string; // 守护灵的选择
  adjustLabel: string | null; // 调整后的做法
  toPlayer: string; // Agent 对你说的话（第一人称）
  citedPrinciple: { id: number; text: string } | null;
  reasons: string[]; // 依据（来自数据库的事实）
  forceCost: number; // 30 Scrip
  canForce: boolean;
  source: "llm" | "rules";
  status: "pending" | "accepted" | "forced" | "adopted" | "overruled";
}

export interface WaveringView {
  id: number;
  principleId: number;
  principleText: string;
  promptText: string;
}

export interface NoteView {
  id: number;
  text: string;
  createdAtMs: number;
  kind: "value" | "preference" | "words";
  status: "pending" | "answered";
  reply: string | null;
}

export interface PostcardView {
  id: number;
  dayIndex: number;
  kind: "nightly" | "recap7";
  title: string;
  lines: string[];
  citedPrinciples: string[];
  source: "llm" | "template";
  createdAtMs: number;
  read: boolean;
}

export interface RelationshipView {
  otherId: string;
  familiarity: number; // 0..100
  incidents: { text: string; atMs: number }[]; // 最多 5 条，新事顶旧事
  coopDone: number;
  lastEvent: string | null;
}

export interface MemoryView {
  id: number;
  atMs: number;
  clock: string;
  text: string;
  kind: string;
}

export interface PlayerView {
  agent: AgentView;
  trust: number; // 0..200
  createdAtMs: number;
  dayIndex: number; // 入城第几天（0 起）
  principles: PrincipleView[];
  pendingMoments: MomentView[];
  pendingJudgment: JudgmentView | null;
  recentJudgment: JudgmentView | null; // 最近一次已结束的判定（用于反馈）
  pendingWavering: WaveringView | null;
  notes: { leftToday: number; items: NoteView[] };
  postcards: { unread: number; items: PostcardView[] };
  relationships: RelationshipView[];
  memories: MemoryView[];
  distilling: number; // 正在形成的记忆数
  onboarding: "forks" | "imprint" | "done";
  stats: { tasksDone: number; scripDelta: number; reputationDelta: number };
  nextPostcardAtMs: number;
}

export interface WorldView {
  simNowMs: number;
  realNowMs: number;
  offsetMs: number; // >0 表示测试快进过
  testMode: boolean;
  tz: string;
  hour: number;
  minute: number;
  tick: number;
  nextTickAtMs: number;
  isNight: boolean;
  llm: { mode: "llm" | "offline"; label: string };
}

export interface GameSnapshot {
  world: WorldView;
  agents: AgentView[];
  feed: FeedItem[];
  player: PlayerView | null;
}
