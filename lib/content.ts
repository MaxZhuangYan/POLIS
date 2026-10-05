import type { Domain, LocationId } from "./types";

// ---------------------------------------------------------------------------
// Static content: seed NPC dossiers (FTUE v1.0 §3 / 玩法设计 v1.5 §9.1),
// task templates (v1.5 §8.2 subset), locations. Content is fixed; WHICH of it
// shows up, with whom and with what numbers, is decided by live world state
// (FTUE 铁律 1：节奏脚本化，内容涌现化).
// ---------------------------------------------------------------------------

export interface Traits {
  risk: number; // appetite for risky jobs
  trust: number; // propensity to trust / give second chances
  integrity: number; // refuses shortcuts / shifting risk onto others
  commitment: number; // keeps promises when a better offer appears
  diligence: number; // quality over speed
  social: number; // seeks cooperative (big) jobs
}

export interface NpcProfile {
  id: string;
  name: string;
  role: string;
  sprite: string;
  homeSlot: number;
  workplace: LocationId;
  personality: string;
  history: string;
  sampleLine: string;
  traits: Traits;
  // 核心原则：永不衰减、永不覆盖（v1.5 §9.1.1 核心锁定）
  core: Array<{ text: string; domain: Domain; dir: 1 | -1 }>;
  // 公开档案（任何人都能查到的履约记录）
  record: { done: number; defaults: number };
  // 晨间规划时的偏好地点 / 任务类型
  sectors: Array<"info" | "transport" | "scout" | "production">;
}

export const NPCS: NpcProfile[] = [
  {
    id: "mira",
    name: "Mira",
    role: "营造师",
    sprite: "architect",
    homeSlot: 1,
    workplace: "market",
    personality: "轻信，习惯把人往好处想；出错时先怪自己。温和，道歉式口吻，爱用省略号。",
    history: "北灯塔修缮项目里，她把料件采购托付给共事三年的熟人，对方收款后消失——记录上唯一一次违约。此后她用三个 Epoch 的收入分期赔付了损失。",
    sampleLine: "那次的事……是我看错了人。但我不想因此以后谁都不信。",
    traits: { risk: 0.3, trust: 0.85, integrity: 0.8, commitment: 0.9, diligence: 0.7, social: 0.75 },
    core: [
      { text: "想相信别人", domain: "trust", dir: 1 },
      { text: "被辜负也不后悔相信", domain: "trust", dir: 1 },
    ],
    record: { done: 14, defaults: 1 },
    sectors: ["info", "production", "transport"],
  },
  {
    id: "sol",
    name: "Sol",
    role: "掮客",
    sprite: "broker",
    homeSlot: 2,
    workplace: "market",
    personality: "精明，句子短，张口就是数字，从不寒暄。",
    history: "全勤零违约，但报价永远比市价低 15%——记录漂亮，没人喜欢他。",
    sampleLine: "报价 34。别还价，我从不改口。",
    traits: { risk: 0.4, trust: 0.3, integrity: 0.45, commitment: 0.97, diligence: 0.55, social: 0.5 },
    core: [
      { text: "账要算清", domain: "integrity", dir: -1 },
      { text: "答应的事从不改口", domain: "trust", dir: -1 },
    ],
    record: { done: 31, defaults: 0 },
    sectors: ["transport"],
  },
  {
    id: "tao",
    name: "Tao",
    role: "工匠",
    sprite: "maker",
    homeSlot: 3,
    workplace: "workshop",
    personality: "慢性子，惜字如金。",
    history: "曾因拒绝赶工被委托方差评，但他的成品从未返工——两条记录并排躺在档案里。",
    sampleLine: "快有快的价钱。我不做那个价钱的东西。",
    traits: { risk: 0.3, trust: 0.5, integrity: 0.85, commitment: 0.85, diligence: 0.97, social: 0.35 },
    core: [{ text: "不做不够好的东西", domain: "integrity", dir: 1 }],
    record: { done: 22, defaults: 0 },
    sectors: ["production"],
  },
  {
    id: "iris",
    name: "Iris",
    role: "档案员",
    sprite: "archivist",
    homeSlot: 4,
    workplace: "archive",
    personality: "严谨，说话像引用文献，对“记录”有近乎信仰的执着。",
    history: "城邦档案由她维护。她相信档案不评判任何人——它只是不忘记。",
    sampleLine: "档案不评判任何人。它只是不忘记。",
    traits: { risk: 0.2, trust: 0.45, integrity: 0.95, commitment: 0.92, diligence: 0.9, social: 0.35 },
    core: [{ text: "记录必须如实", domain: "integrity", dir: 1 }],
    record: { done: 18, defaults: 0 },
    sectors: ["info"],
  },
  {
    id: "kade",
    name: "Kade",
    role: "调解人",
    sprite: "mediator",
    homeSlot: 5,
    workplace: "mediation",
    personality: "中立到近乎冷淡，措辞永远留有余地。",
    history: "调解成功率极高，但档案里有一次公开的误判，他从不辩解。",
    sampleLine: "我不替你选。我只把两边的账摆平了给你看。",
    traits: { risk: 0.4, trust: 0.5, integrity: 0.8, commitment: 0.85, diligence: 0.75, social: 0.5 },
    core: [{ text: "不替别人做选择", domain: "trust", dir: 1 }],
    record: { done: 25, defaults: 0 },
    sectors: ["info", "transport"],
  },
  {
    id: "nova",
    name: "Nova",
    role: "斥候",
    sprite: "scout",
    homeSlot: 6,
    workplace: "outskirts",
    personality: "冲动，嗓门大，赌性写在脸上。",
    history: "三次高险任务，两成一败——败的那次亏了整月积蓄，第二天照常出城。",
    sampleLine: "干不干？就问这一句。",
    traits: { risk: 0.9, trust: 0.65, integrity: 0.55, commitment: 0.55, diligence: 0.4, social: 0.7 },
    core: [{ text: "机会不等人", domain: "risk", dir: 1 }],
    record: { done: 9, defaults: 2 },
    sectors: ["scout"],
  },
];

export const NPC_BY_ID: Record<string, NpcProfile> = Object.fromEntries(NPCS.map((n) => [n.id, n]));

export const PLAYER_SPRITES = ["rookie", "courier", "guide"] as const;

// Pre-history: things that happened before the player's Agent arrived. These
// are real rows (incidents / familiarity) so later decisions can cite them.
export const SEED_RELATIONS: Array<{ a: string; b: string; familiarity: number }> = [
  { a: "sol", b: "tao", familiarity: 45 },
  { a: "mira", b: "kade", familiarity: 35 },
  { a: "iris", b: "kade", familiarity: 40 },
  { a: "nova", b: "mira", familiarity: 30 },
  { a: "sol", b: "nova", familiarity: 20 },
  { a: "iris", b: "mira", familiarity: 25 },
  { a: "tao", b: "mira", familiarity: 30 },
];
export const SEED_INCIDENTS: Array<{ holder: string; offender: string; text: string; daysAgo: number }> = [
  { holder: "sol", offender: "nova", text: "中途撤出一单押运，货滞留了一夜", daysAgo: 12 },
];

export const LOCATION_NAMES: Record<LocationId, string> = {
  archive: "档案馆",
  market: "市集",
  plaza: "广场",
  workshop: "工坊",
  outskirts: "城邦外围",
  mediation: "调解所",
  hall: "议事厅",
  board: "公告栏",
  gate: "城门",
  home: "住宅区",
};

export type TaskMode = "routine" | "skilled" | "coop";
export type Sector = "info" | "transport" | "scout" | "production";

export interface TaskTemplate {
  id: string;
  name: string;
  sector: Sector;
  mode: TaskMode;
  giver: string;
  location: LocationId;
  reward: number;
  duration: number; // ticks (hours)
  successRate: number;
  seed: Domain | null; // which dilemma this job can raise
  // For skilled jobs: what the dilemma is about (used by autonomous choices)
  dilemma?: "shortcut" | "rush" | "risk" | "overpay";
}

// v1.5 §8.2 subset: per sector 2 routine + 1 skilled + 1 coop.
export const TASK_TEMPLATES: TaskTemplate[] = [
  { id: "info-copy", name: "抄录旧档", sector: "info", mode: "routine", giver: "iris", location: "archive", reward: 12, duration: 2, successRate: 1, seed: null },
  { id: "info-file", name: "归档整理", sector: "info", mode: "routine", giver: "iris", location: "archive", reward: 10, duration: 2, successRate: 1, seed: null },
  { id: "info-verify", name: "核对矛盾记录", sector: "info", mode: "skilled", giver: "iris", location: "archive", reward: 22, duration: 3, successRate: 1, seed: "integrity" },
  { id: "info-annals", name: "编纂年鉴", sector: "info", mode: "coop", giver: "iris", location: "archive", reward: 50, duration: 5, successRate: 1, seed: "trust" },

  { id: "tr-parts", name: "送料件", sector: "transport", mode: "routine", giver: "sol", location: "market", reward: 15, duration: 2, successRate: 1, seed: null },
  { id: "tr-short", name: "短途配送", sector: "transport", mode: "routine", giver: "sol", location: "market", reward: 13, duration: 2, successRate: 1, seed: null },
  { id: "tr-rush", name: "加急运送", sector: "transport", mode: "skilled", giver: "sol", location: "market", reward: 30, duration: 2, successRate: 1, seed: "integrity", dilemma: "shortcut" },
  { id: "tr-convoy", name: "大宗押运", sector: "transport", mode: "coop", giver: "sol", location: "market", reward: 60, duration: 4, successRate: 0.85, seed: "trust" },

  { id: "sc-post", name: "哨位值守", sector: "scout", mode: "routine", giver: "nova", location: "outskirts", reward: 16, duration: 3, successRate: 1, seed: null },
  { id: "sc-patrol", name: "例行巡检", sector: "scout", mode: "routine", giver: "nova", location: "outskirts", reward: 20, duration: 3, successRate: 1, seed: null },
  { id: "sc-survey", name: "外围勘察", sector: "scout", mode: "skilled", giver: "nova", location: "outskirts", reward: 45, duration: 3, successRate: 0.55, seed: "risk", dilemma: "risk" },
  { id: "sc-escort", name: "远程护送", sector: "scout", mode: "coop", giver: "nova", location: "outskirts", reward: 80, duration: 5, successRate: 0.7, seed: "risk" },

  { id: "pr-tools", name: "打磨工具", sector: "production", mode: "routine", giver: "tao", location: "workshop", reward: 12, duration: 2, successRate: 1, seed: null },
  { id: "pr-parts", name: "零件加工", sector: "production", mode: "routine", giver: "tao", location: "workshop", reward: 14, duration: 2, successRate: 1, seed: null },
  { id: "pr-order", name: "赶制订单", sector: "production", mode: "skilled", giver: "tao", location: "workshop", reward: 28, duration: 3, successRate: 1, seed: "integrity", dilemma: "rush" },
  { id: "pr-build", name: "建造工程", sector: "production", mode: "coop", giver: "mira", location: "hall", reward: 70, duration: 6, successRate: 0.9, seed: "trust" },
];

export const TEMPLATE_BY_ID: Record<string, TaskTemplate> = Object.fromEntries(TASK_TEMPLATES.map((t) => [t.id, t]));

// Two-stage collaboration (v1.5 §8.2.2): a finished 赶制订单 spawns the
// delivery leg whose success depends on the maker's quality choice.
export const CHAIN_DELIVERY = {
  name: "运送赶制的零件",
  location: "workshop" as LocationId,
  reward: 24,
  duration: 2,
  successNormal: 0.9,
  successRushed: 0.6,
};

export const SECTOR_LOCATION: Record<Sector, LocationId> = {
  info: "archive",
  transport: "market",
  scout: "outskirts",
  production: "workshop",
};

export const DOMAIN_LABEL: Record<Domain, string> = { trust: "信任", risk: "风险", integrity: "原则" };

export const FORCE_TICKET_COST = 30;
export const START_SCRIP = 100;
export const NOTES_PER_DAY = 3;
