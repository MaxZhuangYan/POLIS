"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  agents as seedAgents,
  initialEvents,
  missions,
  mbtiDescriptions,
  mbtiGroups,
} from "@/app/data/polis";
import type { Agent, Conversation, DialogueLine, MBTI, Mission, WorldEvent } from "@/app/data/polis";
import { fallbackSimulation, fallbackDialogue, fallbackChatReply } from "@/app/lib/sim";

// ─── Local Types ────────────────────────────────────────────────────────────

type Language = "en" | "zh";
type GamePhase = "create" | "play";
type GameMode = "game" | "data";
type RightTab = "conversations" | "economy" | "events" | "network" | "leaderboard";
type NetworkView = "mine" | "society";
type PlanFocus = NonNullable<Agent["planFocus"]>;

type AgentMotion = {
  x: number;
  y: number;
  action: "idle" | "walk" | "talk" | "work" | "sign" | "trade";
};

type SpeechBubble = {
  agentId: string;
  text: string;
  expiresAt: number;
};

type Settlement = {
  scrip: number;
  reputation: number;
  compute: number;
  contribution: number;
};

type IssuedPolicy = {
  id: string;
  text: string;
  effect: string;
  time: string;
};

type DecisionPrompt = {
  id: string;
  situation: string;
  options: Array<{ key: "A" | "B" | "C"; label: string; effect: string }>;
  triggeredBy?: string;
};

type DecisionRecord = {
  id: string;
  time: string;
  situation: string;
  choiceLabel: string;
  statDelta: {
    scrip: number;
    reputation: number;
    compute: number;
    energy: number;
    satiety: number;
  };
  affinityChanges: Array<{ agentName: string; delta: number }>;
  autoResolved: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const roleColors: Record<Agent["role"], string> = {
  Architect: "#45f6ff",
  Broker:    "#ffca63",
  Scout:     "#79ffbf",
  Mediator:  "#ff6f91",
  Archivist: "#b7a7ff",
  Maker:     "#ff9f6e"
};

const roleIcons: Record<Agent["role"], string> = {
  Architect: "/assets/polis-icons/architect.png",
  Broker:    "/assets/polis-icons/broker.png",
  Scout:     "/assets/polis-icons/scout.png",
  Mediator:  "/assets/polis-icons/mediator.png",
  Archivist: "/assets/polis-icons/archivist.png",
  Maker:     "/assets/polis-icons/maker.png"
};

const roleSprites: Record<Agent["role"], string> = {
  Architect: "/assets/polis-sprites/architect.png",
  Broker:    "/assets/polis-sprites/broker.png",
  Scout:     "/assets/polis-sprites/scout.png",
  Mediator:  "/assets/polis-sprites/mediator.png",
  Archivist: "/assets/polis-sprites/archivist.png",
  Maker:     "/assets/polis-sprites/maker.png"
};

const zoneIcons: Record<string, string> = {
  "MARKET RING": "/assets/polis-icons/market.png",
  "CIVIC CORE":  "/assets/polis-icons/civic.png",
  "ARCHIVE HALL":"/assets/polis-icons/archive.png",
  "MAKER YARD":  "/assets/polis-icons/maker.png",
  "OUTER GRID":  "/assets/polis-icons/outer.png",
  "ASSEMBLY":    "/assets/polis-icons/assembly.png"
};

const zoneLabels = [
  { name: "ARCHIVE HALL", x: "10%", y: "12%" },
  { name: "CIVIC CORE",   x: "42%", y: "34%" },
  { name: "MARKET RING",  x: "16%", y: "66%" },
  { name: "MAKER YARD",   x: "71%", y: "50%" },
  { name: "OUTER GRID",   x: "69%", y: "16%" },
  { name: "ASSEMBLY",     x: "66%", y: "78%" }
];

const zonePositions: { name: string; cx: number; cy: number }[] = [
  { name: "ARCHIVE HALL", cx: 20, cy: 20 },
  { name: "CIVIC CORE",   cx: 50, cy: 42 },
  { name: "MARKET RING",  cx: 28, cy: 70 },
  { name: "MAKER YARD",   cx: 76, cy: 55 },
  { name: "OUTER GRID",   cx: 74, cy: 24 },
  { name: "ASSEMBLY",     cx: 68, cy: 76 }
];

const BUILDINGS = [
  { id: "home",    label: "HOME",    left: "32%", top: "68%",
    prefillEn: "Rest at home and recover energy today",
    prefillZh: "今天在家休息恢复能量" },
  { id: "school",  label: "SCHOOL",  left: "45%", top: "18%",
    prefillEn: "Prioritize learning and skill development today",
    prefillZh: "今天专注学习和技能提升" },
  { id: "mine",    label: "MINE",    left: "68%", top: "26%",
    prefillEn: "Focus on mining and resource gathering today",
    prefillZh: "今天专注矿场采集和资源积累" },
  { id: "market",  label: "MARKET",  left: "18%", top: "58%",
    prefillEn: "Trade and negotiate at the market today",
    prefillZh: "今天去市场交易和谈判" },
  { id: "office",  label: "OFFICE",  left: "76%", top: "72%",
    prefillEn: "Complete contracts and official work today",
    prefillZh: "今天完成合约和官方工作" },
  { id: "archive", label: "ARCHIVE", left: "10%", top: "12%",
    prefillEn: "Research and archive knowledge today",
    prefillZh: "今天研究和归档知识" }
] as const;

type BuildingId = typeof BUILDINGS[number]["id"];

const EVENT_KIND_COLORS: Record<string, { chip: string; text: string }> = {
  contract:   { chip: "bg-[#ff9a18] text-[#1a0a00]", text: "text-[#ff9a18]" },
  social:     { chip: "bg-[#c7ff7e] text-[#0a1a00]", text: "text-[#c7ff7e]" },
  rule:       { chip: "bg-cyanline/80 text-void",      text: "text-cyanline" },
  culture:    { chip: "bg-[#c4a8ff] text-[#0a0020]",   text: "text-[#c4a8ff]" },
  settlement: { chip: "bg-white/80 text-void",          text: "text-white" },
};

const STORAGE_KEY   = "polis-aiv-state-v3";
const LANGUAGE_KEY  = "polis-language-v1";
const PLAYER_KEY    = "polis-player-v1";
const LM_CONFIG_KEY = "polis-lm-config-v1";

const INITIAL_MARKET: Record<string, number> = {
  food: 12, materials: 18, knowledge: 24, culture: 31, compute: 45
};

const ECONOMY_DELTAS: Record<AgentMotion["action"], Pick<Agent, "scrip" | "reputation" | "compute">> = {
  work:  { scrip: 2,  reputation: 0,    compute: 1 },
  trade: { scrip: 3,  reputation: 1,    compute: -1 },
  talk:  { scrip: 0,  reputation: 2,    compute: 0 },
  sign:  { scrip: 1,  reputation: 1,    compute: 0 },
  idle:  { scrip: -1, reputation: 0,    compute: 0 },
  walk:  { scrip: 0,  reputation: 0,    compute: 0 }
};

const survivalDeltas: Record<AgentMotion["action"], Pick<Required<Agent>, "health" | "energy" | "satiety">> = {
  work:  { health: -1, energy: -8, satiety: -6 },
  trade: { health:  0, energy: -5, satiety: -4 },
  talk:  { health:  0, energy: -3, satiety: -2 },
  sign:  { health: -1, energy: -6, satiety: -4 },
  walk:  { health:  0, energy: -4, satiety: -3 },
  idle:  { health:  1, energy:  7, satiety: -1 }
};

const planFocusActions: Record<PlanFocus, AgentMotion["action"]> = {
  work: "work",
  trade: "trade",
  study: "work",
  social: "talk",
  rest: "idle",
  build: "sign"
};

// ─── Copy ─────────────────────────────────────────────────────────────────

const copy = {
  en: {
    subtitle: "AI Contract Civilization",
    language: "中文",
    epoch: "Epoch",
    scrip: "Credits",
    reputation: "Rep",
    compute: "Compute",
    health: "Health",
    energy: "Energy",
    satiety: "Satiety",
    residence: "Residence",
    enterPolis: "Enter Polis",
    createAgent: "Create Your Agent",
    choosePersonality: "Choose Personality",
    agentName: "Agent Name",
    namePlaceholder: "Enter your name...",
    yourAgent: "Your Agent",
    thoughts: "Thoughts",
    sendMessage: "Send message to your agent...",
    send: "Send",
    conversations: "Conversations",
    economy: "Economy",
    policy: "Policy",
    events: "Events",
    leaderboard: "Leaderboard",
    marketPrices: "Market Prices",
    wealth: "Wealth",
    pause: "Pause",
    run: "Run",
    reset: "Reset",
    gameMode: "Game",
    dataMode: "Data",
    playerMode: "Player",
    observerMode: "Observer",
    settlement: "Settle Epoch",
    agents: "Agents",
    roster: "Roster",
    role: "Role",
    mbti: "MBTI",
    traits: "Traits",
    currentMission: "Mission",
    status: "Status",
    worldEvents: "World Events",
    trust: "trust",
    relationships: "Relationships",
    decisionLog: "Decision Log",
    myNetwork: "My Network",
    societyView: "Society",
    civilizationPanel: "Civilization",
    scripCirculation: "In Circulation",
    avgEnergy: "Avg Energy",
    weakBonds: "Weak bonds",
    autoResolved: "AUTO",
    noDecisions: "No decisions yet.",
    socialHub: "Social Hub",
    loner: "Loner",
    avgAffinity: "Avg Affinity",
    activeBonds: "Active Bonds",
    lastInteraction: "Last Interaction",
    addAgent: "+ Agent",
    giniCoeff: "Gini Coeff",
    wealthDistribution: "Wealth Distribution",
    policyChamber: "POLICY CHAMBER",
    policyPlaceholder: "Issue tax, market, funding, or rest directive...",
    issueDirective: "Issue Directive",
    cooldown: "Cooldown",
    recentPolicies: "Recent Policies",
    noPolicies: "No directives issued.",
    decision: "DECISION REQUIRED",
    chooseAction: "Choose Action",
    customDirective: "Custom directive...",
    skipDecision: "Skip",
    issueCustom: "Send",
    dailyPlan: "Daily Plan",
    dailyPlanPlaceholder: "Set today's long-term plan...",
    submitPlan: "Set Plan",
    planLocked: "Plan Locked",
    noDailyPlan: "No plan set for this epoch.",
    planFocus: "Focus",
    tempPrompt: "Temporary Prompt",
    tempPromptPlaceholder: "Interrupt with one validated action...",
    executePrompt: "Execute",
    tickets: "Tickets",
    validator: "Validator",
    totalAgents: "Agents",
    avgWealth: "Avg Wealth",
    topEarner: "Top Earner",
    roles: {
      Architect: "Architect", Broker: "Broker", Scout: "Scout",
      Mediator: "Mediator", Archivist: "Archivist", Maker: "Maker"
    },
    actions: { idle: "...", walk: "move", talk: "talk", work: "work", sign: "sign", trade: "trade" }
  },
  zh: {
    subtitle: "AI 契约文明",
    language: "EN",
    epoch: "纪元",
    scrip: "贡献券",
    reputation: "声望",
    compute: "算力",
    health: "健康",
    energy: "能量",
    satiety: "饱腹",
    residence: "住宅",
    enterPolis: "进入 Polis",
    createAgent: "创建你的智能体",
    choosePersonality: "选择人格类型",
    agentName: "智能体名称",
    namePlaceholder: "输入你的名字...",
    yourAgent: "你的智能体",
    thoughts: "思维状态",
    sendMessage: "向你的智能体发送指令...",
    send: "发送",
    conversations: "对话",
    economy: "经济",
    policy: "政策",
    events: "事件",
    leaderboard: "排行榜",
    marketPrices: "市场价格",
    wealth: "财富",
    pause: "暂停",
    run: "运行",
    reset: "重置",
    gameMode: "游戏",
    dataMode: "数据",
    playerMode: "玩家",
    observerMode: "观察者",
    settlement: "结算纪元",
    agents: "智能体",
    roster: "居民",
    role: "角色",
    mbti: "MBTI",
    traits: "特质",
    currentMission: "任务",
    status: "状态",
    worldEvents: "世界事件",
    trust: "信任",
    relationships: "关系",
    decisionLog: "决策记录",
    myNetwork: "我的关系",
    societyView: "社会全图",
    civilizationPanel: "文明面板",
    scripCirculation: "流通贡献券",
    avgEnergy: "平均能量",
    weakBonds: "弱关系",
    autoResolved: "自动",
    noDecisions: "暂无决策记录。",
    socialHub: "社交中心",
    loner: "孤立者",
    avgAffinity: "平均关系",
    activeBonds: "活跃关系",
    lastInteraction: "最近互动",
    addAgent: "+ 智能体",
    giniCoeff: "基尼系数",
    wealthDistribution: "财富分布",
    policyChamber: "政策殿堂",
    policyPlaceholder: "发布税收、市场、资助或休整指令...",
    issueDirective: "发布指令",
    cooldown: "冷却",
    recentPolicies: "近期政策",
    noPolicies: "尚未发布指令。",
    decision: "需要决策",
    chooseAction: "选择行动",
    customDirective: "自定义指令...",
    skipDecision: "跳过",
    issueCustom: "发送",
    dailyPlan: "每日计划",
    dailyPlanPlaceholder: "设置今天的长期计划...",
    submitPlan: "设定计划",
    planLocked: "计划已锁定",
    noDailyPlan: "本纪元尚未设定计划。",
    planFocus: "重点",
    tempPrompt: "临时指令",
    tempPromptPlaceholder: "用一次校验动作打断当前任务...",
    executePrompt: "执行",
    tickets: "票券",
    validator: "校验器",
    totalAgents: "居民数",
    avgWealth: "平均财富",
    topEarner: "首富",
    roles: {
      Architect: "规划师", Broker: "经纪人", Scout: "探索者",
      Mediator: "调解员", Archivist: "档案员", Maker: "工匠"
    },
    actions: { idle: "...", walk: "移动", talk: "交谈", work: "工作", sign: "签约", trade: "交易" }
  }
} as const;

type CopyText = (typeof copy)[Language];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function initialMotion(list: Agent[]): Record<string, AgentMotion> {
  return Object.fromEntries(list.map((a, i) => [a.id, {
    x: a.x + ((i % 3) - 1) * 1.5,
    y: a.y + (i % 2 === 0 ? -1.2 : 1.2),
    action: (i % 4 === 0 ? "talk" : "idle") as AgentMotion["action"]
  }]));
}

function nearestZone(x: number, y: number): string {
  let best = zonePositions[0];
  let bestDist = Infinity;
  for (const z of zonePositions) {
    const d = Math.hypot(z.cx - x, z.cy - y);
    if (d < bestDist) { bestDist = d; best = z; }
  }
  return best.name;
}

function agentWealth(a: Agent): number {
  return a.scrip + a.reputation * 2 + Math.round(a.compute * 0.5);
}

function agentStats(a: Agent): DecisionRecord["statDelta"] {
  return {
    scrip: a.scrip,
    reputation: a.reputation,
    compute: a.compute,
    energy: a.energy ?? 0,
    satiety: a.satiety ?? 0
  };
}

function subtractStats(after: DecisionRecord["statDelta"], before: DecisionRecord["statDelta"]): DecisionRecord["statDelta"] {
  return {
    scrip: after.scrip - before.scrip,
    reputation: after.reputation - before.reputation,
    compute: after.compute - before.compute,
    energy: after.energy - before.energy,
    satiety: after.satiety - before.satiety
  };
}

function nowTime(epoch: number): string {
  return `E${epoch} ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}`;
}

function classifyDailyPlan(text: string): PlanFocus {
  const normalized = text.toLowerCase();
  if (/(rest|sleep|recover|health|eat|energy|休息|睡|恢复|健康|吃|能量)/.test(normalized)) return "rest";
  if (/(trade|market|sell|buy|broker|price|交易|市场|出售|购买|价格)/.test(normalized)) return "trade";
  if (/(study|learn|school|book|education|学习|读书|教育|学校)/.test(normalized)) return "study";
  if (/(friend|social|talk|relation|trust|社交|朋友|对话|关系|信任)/.test(normalized)) return "social";
  if (/(build|unlock|upgrade|craft|make|repair|建造|解锁|升级|制造|修理)/.test(normalized)) return "build";
  return "work";
}

function validateTemporaryPrompt(agent: Agent, text: string): {
  ok: boolean;
  focus: PlanFocus;
  action: AgentMotion["action"];
  reason: string;
  delta: Pick<Agent, "scrip" | "reputation" | "compute">;
} {
  const focus = classifyDailyPlan(text);
  const action = planFocusActions[focus];
  const tickets = agent.promptTickets ?? 0;

  if (tickets <= 0) {
    return { ok: false, focus, action, reason: "no_prompt_ticket", delta: { scrip: 0, reputation: 0, compute: 0 } };
  }

  const costByFocus: Record<PlanFocus, number> = {
    work: 10,
    trade: 8,
    study: 6,
    social: 4,
    rest: 0,
    build: 12
  };
  const scripCost = focus === "trade" ? 4 : focus === "study" ? 6 : 0;
  const computeCost = costByFocus[focus];

  if (agent.compute < computeCost) {
    return { ok: false, focus, action, reason: "not_enough_compute", delta: { scrip: 0, reputation: 0, compute: 0 } };
  }
  if (agent.scrip < scripCost) {
    return { ok: false, focus, action, reason: "not_enough_scrip", delta: { scrip: 0, reputation: 0, compute: 0 } };
  }

  const deltaByFocus: Record<PlanFocus, Pick<Agent, "scrip" | "reputation" | "compute">> = {
    work: { scrip: 10, reputation: 1, compute: -computeCost },
    trade: { scrip: 12 - scripCost, reputation: 2, compute: -computeCost },
    study: { scrip: -scripCost, reputation: 4, compute: -computeCost },
    social: { scrip: 0, reputation: 5, compute: -computeCost },
    rest: { scrip: -2, reputation: 0, compute: 18 },
    build: { scrip: 4, reputation: 3, compute: -computeCost }
  };

  return { ok: true, focus, action, reason: "validated", delta: deltaByFocus[focus] };
}

function normalizeAgent(a: Agent): Agent {
  return {
    ...a,
    level: a.level ?? Math.max(1, Math.round(a.reputation / 12)),
    specialization: a.specialization ?? `${a.role} Operations`,
    traits: a.traits ?? ["legacy", "stable"],
    currentMission: a.currentMission ?? a.status,
    mbti: a.mbti ?? "ISTP",
    planFocus: a.planFocus,
    promptTickets: a.promptTickets ?? (a.isPlayer ? 3 : 1),
    health: a.health ?? 88,
    energy: a.energy ?? clamp(62 + (a.compute ?? 50) * 0.25, 0, 100),
    satiety: a.satiety ?? clamp(58 + (a.scrip ?? 50) * 0.15, 0, 100),
    residenceLevel: a.residenceLevel ?? (a.isPlayer ? 1 : Math.max(1, Math.min(3, Math.floor((a.level ?? 1) / 3)))),
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Home() {
  const [phase,          setPhase]          = useState<GamePhase>("create");
  const [language,       setLanguage]       = useState<Language>("en");
  const [agents,         setAgents]         = useState<Agent[]>(seedAgents.map(normalizeAgent));
  const [agentMotion,    setAgentMotion]    = useState<Record<string, AgentMotion>>(() => initialMotion(seedAgents));
  const [playerAgentId,  setPlayerAgentId]  = useState<string | null>(null);
  const [selectedId,     setSelectedId]     = useState<string>("mira");
  const [events,         setEvents]         = useState<WorldEvent[]>(initialEvents);
  const [conversations,  setConversations]  = useState<Conversation[]>([]);
  const [missionProgress,setMissionProgress]= useState<Record<string, number>>(() =>
    Object.fromEntries(missions.map(m => [m.id, m.progress ?? 0]))
  );
  const [speechBubbles,  setSpeechBubbles]  = useState<SpeechBubble[]>([]);
  const [epoch,          setEpoch]          = useState(12);
  const [isRunning,      setIsRunning]      = useState(true);
  const [settlement,     setSettlement]     = useState<Settlement>({ scrip: 943, reputation: 631, compute: 512, contribution: 188 });
  const [marketPrices,   setMarketPrices]   = useState<Record<string, number>>(INITIAL_MARKET);
  const [rightTab,       setRightTab]       = useState<RightTab>("conversations");
  const [gameMode,       setGameMode]       = useState<GameMode>("game");
  const [mobileTab,      setMobileTab]      = useState<"agent" | "map" | "chat">("map");
  const [playerInput,    setPlayerInput]    = useState("");
  const [policyInput,    setPolicyInput]    = useState("");
  const [issuedPolicies, setIssuedPolicies] = useState<IssuedPolicy[]>([]);
  const [policyCooldownUntil, setPolicyCooldownUntil] = useState(0);
  const [isSending,      setIsSending]      = useState(false);
  const [lmMode,         setLmMode]         = useState<"local" | "lan">("local");
  const [lanIp,          setLanIp]          = useState("192.168.0.105");
  const [showLmSettings, setShowLmSettings] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<DecisionPrompt | null>(null);
  const [decisionExpiresAt, setDecisionExpiresAt] = useState<number | null>(null);
  const [decisionSecondsLeft, setDecisionSecondsLeft] = useState(0);
  const [decisionInput,  setDecisionInput]  = useState("");
  const [decisionHistory, setDecisionHistory] = useState<DecisionRecord[]>([]);
  const [decisionLogOpen, setDecisionLogOpen] = useState(false);
  const [networkView, setNetworkView] = useState<NetworkView>("mine");
  const [selectedNetworkAgentId, setSelectedNetworkAgentId] = useState<string | null>(null);
  const [dailyPlanInput, setDailyPlanInput] = useState("");
  const [temporaryPromptInput, setTemporaryPromptInput] = useState("");
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingId | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [demoTriggerCreate, setDemoTriggerCreate] = useState(false);
  const demoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Creation form state
  const [creationName,   setCreationName]   = useState("");
  const [creationMBTI,   setCreationMBTI]   = useState<MBTI | null>(null);

  const agentMotionRef = useRef<Record<string, AgentMotion>>({});
  const lmSettingsRef = useRef<HTMLDivElement | null>(null);
  const agentsRef = useRef(agents);
  const epochRef = useRef(epoch);
  const languageRef = useRef(language);
  const missionProgressRef = useRef(missionProgress);
  const pendingDecisionRef = useRef<DecisionPrompt | null>(null);
  const playerAgentIdRef = useRef<string | null>(playerAgentId);
  const t = copy[language];

  const router = useRouter();

  useEffect(() => { agentsRef.current = agents; }, [agents]);
  useEffect(() => { epochRef.current = epoch; }, [epoch]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { missionProgressRef.current = missionProgress; }, [missionProgress]);
  useEffect(() => { pendingDecisionRef.current = pendingDecision; }, [pendingDecision]);
  useEffect(() => { playerAgentIdRef.current = playerAgentId; }, [playerAgentId]);

  // Demo Mode: trigger createPlayerAgent after state is committed
  useEffect(() => {
    if (!demoTriggerCreate || !creationName.trim() || !creationMBTI) return;
    setDemoTriggerCreate(false);
    createPlayerAgent();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoTriggerCreate, creationName, creationMBTI]);

  // Demo Mode: capture any click to interrupt
  useEffect(() => {
    if (!demoMode) return;
    const handler = () => {
      demoTimersRef.current.forEach(clearTimeout);
      demoTimersRef.current = [];
      setDemoMode(false);
      setShowLmSettings(false);
    };
    document.addEventListener("click", handler, { capture: true });
    return () => document.removeEventListener("click", handler, { capture: true });
  }, [demoMode]);

  // ── Load persisted state ──────────────────────────────────────────────────
  useEffect(() => {
    const savedLang = window.localStorage.getItem(LANGUAGE_KEY);
    if (savedLang === "en" || savedLang === "zh") setLanguage(savedLang);

    const savedLmConfig = window.localStorage.getItem(LM_CONFIG_KEY);
    if (savedLmConfig) {
      try {
        const c = JSON.parse(savedLmConfig) as { lmMode?: "local" | "lan"; lanIp?: string };
        if (c.lmMode === "local" || c.lmMode === "lan") setLmMode(c.lmMode);
        if (typeof c.lanIp === "string" && c.lanIp.trim()) setLanIp(c.lanIp);
      } catch {
        window.localStorage.removeItem(LM_CONFIG_KEY);
      }
    }

    const savedPlayer = window.localStorage.getItem(PLAYER_KEY);
    if (savedPlayer) {
      try {
        const p = JSON.parse(savedPlayer) as { agentId: string; phase: GamePhase };
        if (p.agentId) setPlayerAgentId(p.agentId);
        if (p.phase)   setPhase(p.phase);
      } catch { /* ignore */ }
    }

    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const s = JSON.parse(saved) as {
        agents: Agent[]; events: WorldEvent[]; epoch: number;
        settlement: Settlement; selectedId: string;
        conversations: Conversation[]; marketPrices: Record<string, number>;
        missionProgress?: Record<string, number>; dailyPlanInput?: string; temporaryPromptInput?: string;
        decisionHistory?: DecisionRecord[];
      };
      const normalized = s.agents.map(normalizeAgent);
      const motion = initialMotion(normalized);
      setAgents(normalized);
      setAgentMotion(motion);
      agentMotionRef.current = motion;
      setEvents(s.events);
      setEpoch(s.epoch);
      setSettlement(s.settlement);
      setSelectedId(s.selectedId);
      if (s.conversations) setConversations(s.conversations);
      if (s.marketPrices)  setMarketPrices(s.marketPrices);
      if (s.missionProgress) setMissionProgress({
        ...Object.fromEntries(missions.map(m => [m.id, m.progress ?? 0])),
        ...s.missionProgress
      });
      if (Array.isArray(s.decisionHistory)) setDecisionHistory(s.decisionHistory.slice(0, 20));
      if (typeof s.dailyPlanInput === "string") setDailyPlanInput(s.dailyPlanInput);
      if (typeof s.temporaryPromptInput === "string") setTemporaryPromptInput(s.temporaryPromptInput);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => { window.localStorage.setItem(LANGUAGE_KEY, language); }, [language]);

  useEffect(() => {
    window.localStorage.setItem(LM_CONFIG_KEY, JSON.stringify({ lmMode, lanIp }));
  }, [lmMode, lanIp]);

  useEffect(() => {
    if (!showLmSettings) return;

    function closeLmSettings(event: MouseEvent) {
      if (!lmSettingsRef.current?.contains(event.target as Node)) {
        setShowLmSettings(false);
      }
    }

    document.addEventListener("mousedown", closeLmSettings);
    return () => document.removeEventListener("mousedown", closeLmSettings);
  }, [showLmSettings]);

  useEffect(() => {
    if (isRunning) return;
    pendingDecisionRef.current = null;
    setPendingDecision(null);
    setDecisionExpiresAt(null);
    setDecisionSecondsLeft(0);
    setDecisionInput("");
  }, [isRunning]);

  useEffect(() => {
    if (!decisionExpiresAt || !pendingDecision) {
      setDecisionSecondsLeft(0);
      return;
    }

    const tick = () => {
      const left = Math.ceil((decisionExpiresAt - Date.now()) / 1000);
      setDecisionSecondsLeft(Math.max(0, left));
      if (left <= 0 && pendingDecisionRef.current) {
        applyDecisionChoice(pendingDecisionRef.current, "B", true);
      }
    };

    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [decisionExpiresAt, pendingDecision]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_KEY, JSON.stringify({ agentId: playerAgentId, phase }));
  }, [playerAgentId, phase]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      agents, events, epoch, settlement, selectedId, conversations, marketPrices, missionProgress, dailyPlanInput, temporaryPromptInput, decisionHistory
    }));
  }, [agents, events, epoch, settlement, selectedId, conversations, marketPrices, missionProgress, dailyPlanInput, temporaryPromptInput, decisionHistory]);

  useEffect(() => {
    const playerTabs: RightTab[] = ["conversations", "economy", "events"];
    const observerTabs: RightTab[] = ["network", "economy", "events", "leaderboard"];
    if (gameMode === "game" && !playerTabs.includes(rightTab)) setRightTab("conversations");
    if (gameMode === "data" && !observerTabs.includes(rightTab)) setRightTab("network");
  }, [gameMode, rightTab]);

  // ── Speech bubble helpers ─────────────────────────────────────────────────
  const addSpeechBubble = useCallback((agentId: string, text: string) => {
    setSpeechBubbles(cur => {
      const filtered = cur.filter(b => b.agentId !== agentId);
      return [...filtered, { agentId, text: text.slice(0, 55), expiresAt: Date.now() + 6000 }];
    });
  }, []);

  // ── Movement + ambient loop (2800ms) ─────────────────────────────────────
  useEffect(() => {
    if (!isRunning || phase !== "play") return;
    const timer = window.setInterval(() => {
      const now = Date.now();

      // Clean expired bubbles
      setSpeechBubbles(cur => cur.filter(b => b.expiresAt > now));

      // Update agent positions
      const currentAgents = agentsRef.current;
      const latestMotion: Record<string, AgentMotion> = { ...agentMotionRef.current };
      currentAgents.forEach(agent => {
        const m = latestMotion[agent.id] ?? { x: agent.x, y: agent.y, action: "idle" as const };
        const actions: AgentMotion["action"][] = ["walk", "talk", "work", "idle", "trade", "sign"];
        const plannedAction = agent.dailyPlanDay === epochRef.current && agent.planFocus
          ? planFocusActions[agent.planFocus]
          : null;
        const needsRecovery = (agent.energy ?? 100) < 18 || (agent.satiety ?? 100) < 12 || (agent.health ?? 100) < 20;
        latestMotion[agent.id] = {
          x: clamp(m.x + (Math.random() - 0.5) * 5, 10, 86),
          y: clamp(m.y + (Math.random() - 0.5) * 4, 16, 78),
          action: needsRecovery ? "idle" : plannedAction && Math.random() > 0.22 ? plannedAction : actions[Math.floor(Math.random() * actions.length)]
        };
      });
      agentMotionRef.current = latestMotion;
      setAgentMotion(latestMotion);

      const activeAgents = currentAgents.filter(agent => (latestMotion[agent.id]?.action ?? "idle") !== "idle");
      let progress = { ...missionProgressRef.current };
      const completedMissions: Mission[] = [];

      for (const agent of activeAgents) {
        const mission = missions.find(m => (progress[m.id] ?? m.progress ?? 0) < 100);
        if (!mission) break;

        const previous = progress[mission.id] ?? mission.progress ?? 0;
        const nextProgress = clamp(previous + Math.floor(1 + Math.random() * 4), 0, 100);
        progress[mission.id] = nextProgress;

        if (previous < 100 && nextProgress >= 100) {
          completedMissions.push(mission);
        }
      }

      if (activeAgents.length > 0) {
        missionProgressRef.current = progress;
        setMissionProgress(progress);
      }

      // Market price drift
      setMarketPrices(cur => Object.fromEntries(
        Object.entries(INITIAL_MARKET).map(([good, initial]) => {
          const current = cur[good] ?? initial;
          const drift = Math.random() * 0.1 - 0.05;
          return [good, +clamp(current * (1 + drift), initial * 0.5, initial * 2).toFixed(2)];
        })
      ));

      setAgents(prev => {
        const next = prev.map(agent => {
          const action = agentMotionRef.current[agent.id]?.action ?? "idle";
          const delta = ECONOMY_DELTAS[action];
          const survival = survivalDeltas[action];
          const gain = (value: number) => value > 0 && agent.isPlayer ? Math.ceil(value * 1.2) : value;

          return {
            ...agent,
            scrip: clamp(agent.scrip + gain(delta.scrip), 0, 500),
            reputation: clamp(agent.reputation + gain(delta.reputation), 0, 100),
            compute: clamp(agent.compute + gain(delta.compute), 0, 150),
            health: clamp((agent.health ?? 88) + survival.health, 0, 100),
            energy: clamp((agent.energy ?? 80) + survival.energy, 0, 100),
            satiety: clamp((agent.satiety ?? 75) + survival.satiety, 0, 100)
          };
        }).map(agent => {
          if (completedMissions.length === 0 || !agent.isPlayer) return agent;
          return {
            ...agent,
            scrip: clamp(agent.scrip + completedMissions.length * 15, 0, 500),
            reputation: clamp(agent.reputation + completedMissions.length * 8, 0, 100)
          };
        });
        agentsRef.current = next;
        return next;
      });

      if (completedMissions.length > 0) {
        const completedEvents = completedMissions.map(mission => ({
          id: `mission-${mission.id}-${Date.now()}`,
          time: nowTime(epochRef.current),
          kind: "contract" as const,
          text: `Mission complete: ${mission.title}`
        }));
        setEvents(cur => [...completedEvents, ...cur].slice(0, 12));
      }

      setSettlement(cur => ({
        ...cur,
        compute: Math.max(0, cur.compute - 1),
        contribution: cur.contribution + 1
      }));
    }, 2800);
    return () => window.clearInterval(timer);
  }, [isRunning, phase]);

  // ── Autonomous dialogue loop (10000ms) ───────────────────────────────────
  useEffect(() => {
    if (!isRunning || phase !== "play") return;
    const kickoff = window.setTimeout(() => {
      runAutonomousDialogue();
    }, 2000);
    const timer = window.setInterval(() => {
      runAutonomousDialogue();
    }, 10000);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, phase, lmMode, lanIp]);

  // ── Player decision loop (30000ms) ───────────────────────────────────────
  useEffect(() => {
    if (!isRunning || phase !== "play") return;
    const timer = window.setInterval(() => {
      if (pendingDecisionRef.current) return;
      const prompt = createDecisionPrompt();
      if (prompt) {
        setPendingDecision(prompt);
        setDecisionExpiresAt(Date.now() + 45000);
        setDecisionSecondsLeft(45);
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [isRunning, phase]);

  // ── World event ambient loop (15000ms) ────────────────────────────────────
  useEffect(() => {
    if (!isRunning || phase !== "play") return;
    const timer = window.setInterval(() => {
      const actor = agents[Math.floor(Math.random() * agents.length)];
      const fragments = [
        `${actor.name} broadcast a short-term intent update to nearby agents.`,
        `${actor.role} guild changed queue priority after a reputation signal.`,
        `A contract witness recorded a weak tie becoming operational trust.`,
        `Epoch market adjusted compute rationing after a burst of work logs.`,
        `${actor.name} filed a work fragment and updated the civic ledger.`,
        `Assembly quorum reached for the delayed-work penalty amendment.`,
      ];
      const text = fragments[Math.floor(Math.random() * fragments.length)];
      setEvents(cur => [
        { id: `ambient-${Date.now()}`, time: nowTime(epoch), kind: "social" as const, text },
        ...cur
      ].slice(0, 12));
    }, 15000);
    return () => window.clearInterval(timer);
  }, [agents, epoch, isRunning, phase]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const playerAgent = useMemo(
    () => playerAgentId ? normalizeAgent(agents.find(a => a.id === playerAgentId) ?? agents[0]) : null,
    [agents, playerAgentId]
  );

  const selectedAgent = useMemo(
    () => normalizeAgent(agents.find(a => a.id === selectedId) ?? agents[0]),
    [agents, selectedId]
  );

  const activeMission = missions.find(m => (missionProgress[m.id] ?? m.progress ?? 0) < 100) ?? null;
  const activeMissionProgress = activeMission ? (missionProgress[activeMission.id] ?? activeMission.progress ?? 0) : 100;
  const leaderboard = [...agents].sort((a, b) => agentWealth(b) - agentWealth(a));
  const topScripAgents = [...agents].sort((a, b) => b.scrip - a.scrip).slice(0, 3);
  const topScrip = Math.max(1, topScripAgents[0]?.scrip ?? 1);
  const policyCooldownRemaining = Math.max(0, Math.ceil((policyCooldownUntil - Date.now()) / 1000));
  const policyOnCooldown = policyCooldownRemaining > 0;

  const marketRows = Object.entries(INITIAL_MARKET).map(([good, initial]) => {
    const price = marketPrices[good] ?? initial;
    const change = ((price - initial) / initial) * 100;
    return { good, initial, price, change };
  });

  const gini = useMemo(() => {
    const wealths = agents.map(a => a.scrip).sort((a, b) => a - b);
    const n = wealths.length;
    const mean = wealths.reduce((s, v) => s + v, 0) / n;
    if (mean === 0) return 0;
    let sumDiff = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sumDiff += Math.abs(wealths[i] - wealths[j]);
    return +clamp(sumDiff / (2 * n * n * mean), 0, 1).toFixed(2);
  }, [agents]);

  const bottomEarner = leaderboard[leaderboard.length - 1];
  const totalScrip = agents.reduce((sum, agent) => sum + agent.scrip, 0);
  const avgEnergy = agents.length
    ? Math.round(agents.reduce((sum, agent) => sum + (agent.energy ?? 0), 0) / agents.length)
    : 0;

  const displayedConversations = useMemo(() => {
    if (gameMode !== "game" || !playerAgent) return conversations;
    return [...conversations].sort((a, b) => {
      const aRelevant = a.agentIds.includes(playerAgent.id) || a.agentIds.includes("player") || a.agentIds[0] === "system";
      const bRelevant = b.agentIds.includes(playerAgent.id) || b.agentIds.includes("player") || b.agentIds[0] === "system";
      return Number(bRelevant) - Number(aRelevant);
    });
  }, [conversations, gameMode, playerAgent]);

  const displayedEvents = useMemo(() => {
    if (gameMode !== "game" || !playerAgent) return events;
    return [...events].sort((a, b) => {
      const aRelevant = a.text.includes(playerAgent.name) || a.text.includes("Player decision") || a.text.includes("Decision ignored");
      const bRelevant = b.text.includes(playerAgent.name) || b.text.includes("Player decision") || b.text.includes("Decision ignored");
      return Number(bRelevant) - Number(aRelevant);
    });
  }, [events, gameMode, playerAgent]);

  function activeLmEndpoint(): string {
    return lmMode === "local"
      ? "http://127.0.0.1:1234/v1/chat/completions"
      : `http://${lanIp}:1234/v1/chat/completions`;
  }

  function createDecisionPrompt(): DecisionPrompt | null {
    const currentAgents = agentsRef.current;
    const playerId = playerAgentIdRef.current;
    const player = currentAgents.find(a => a.id === playerId) ?? currentAgents.find(a => a.isPlayer);
    if (!player || currentAgents.length < 1) return null;

    const nonPlayerAgents = currentAgents.filter(a => a.id !== player.id);
    const pickAgent = () => nonPlayerAgents[Math.floor(Math.random() * nonPlayerAgents.length)] ?? player;
    const debtor = pickAgent();
    const trustedAlly = Object.entries(player.affinity)
      .map(([id, affinity]) => ({ agent: currentAgents.find(a => a.id === id), affinity }))
      .filter((item): item is { agent: Agent; affinity: number } => Boolean(item.agent))
      .sort((a, b) => b.affinity - a.affinity)[0]?.agent ?? pickAgent();
    const socialTarget = pickAgent();
    const debtAmount = Math.floor(Math.random() * 20) + 10;
    const zh = languageRef.current === "zh";
    const bank: DecisionPrompt[] = [
      {
        id: `decision-hrc-${Date.now()}`,
        situation: zh
          ? `紧急高风险合约到来，奖励丰厚但耗能巨大。当前能量：${player.energy ?? 80}。`
          : `High-risk contract arrived. Big reward but drains energy. Current energy: ${player.energy ?? 80}.`,
        triggeredBy: "hrc",
        options: [
          { key: "A", label: zh ? "接受" : "Accept", effect: zh ? "贡献券可能上升，但能量与声望承压" : "Credits may rise, but energy and reputation are pressured" },
          { key: "B", label: zh ? "拒绝" : "Decline", effect: zh ? "资源稳定，但错过机会" : "Resources stay stable, but the opportunity is missed" },
          { key: "C", label: zh ? "赌一把" : "Gamble", effect: zh ? "高波动选择，可能影响贡献券、能量或声望" : "Volatile choice that may affect credits, energy, or reputation" }
        ]
      },
      {
        id: `decision-rep-attack-${Date.now()}`,
        situation: zh
          ? "有人在议会公开质疑你的声望。你的公开信任正在承压。"
          : "Someone publicly challenged your reputation in the Assembly. Your public trust is under pressure.",
        triggeredBy: "rep-attack",
        options: [
          { key: "A", label: zh ? "辩护" : "Defend", effect: zh ? "可能修复声望，也可能消耗精力并反噬" : "May repair reputation, or drain energy and backfire" },
          { key: "B", label: zh ? "忽略" : "Ignore", effect: zh ? "低参与选择，声望可能继续受损" : "Low-engagement choice; reputation may keep slipping" },
          { key: "C", label: zh ? "道歉" : "Apologize", effect: zh ? "缓和冲突，但会牺牲部分公众形象" : "Defuses conflict, but sacrifices some public standing" }
        ]
      },
      {
        id: `decision-debt-${Date.now()}`,
        situation: zh
          ? `${debtor.name} 拖欠了你一笔贡献券。`
          : `${debtor.name} owes you a credit balance.`,
        triggeredBy: `debt|${debtor.id}|${debtAmount}`,
        options: [
          { key: "A", label: zh ? "强制追收" : "Enforce", effect: zh ? "贡献券可能回收，但关系与声望承压" : "Credits may recover, but relationship and reputation are pressured" },
          { key: "B", label: zh ? "免除" : "Forgive", effect: zh ? "贡献券机会损失，声望与关系可能改善" : "Credit opportunity is lost; reputation and relationship may improve" },
          { key: "C", label: zh ? "折中" : "Partial", effect: zh ? "温和处理，可能兼顾贡献券与关系" : "Moderate response that may balance credits and relationship" }
        ]
      },
      {
        id: `decision-energy-crisis-${Date.now()}`,
        situation: zh
          ? `你的智能体已经连续工作过久，能量严重不足。当前能量：${player.energy ?? 80}。`
          : `Your agent has been overworked. Energy critically low: ${player.energy ?? 80}.`,
        triggeredBy: "energy-crisis",
        options: [
          { key: "A", label: zh ? "充分休息" : "Rest fully", effect: zh ? "能量恢复，但贡献券会承压" : "Energy recovers, but credits are pressured" },
          { key: "B", label: zh ? "快速进食" : "Quick meal", effect: zh ? "饱腹与能量改善，需要消耗贡献券" : "Satiety and energy improve, at a credit cost" },
          { key: "C", label: zh ? "硬撑" : "Push through", effect: zh ? "继续推进，但可能引发疲劳和声望风险" : "Keeps moving, but risks fatigue and reputation damage" }
        ]
      },
      {
        id: `decision-market-opp-${Date.now()}`,
        situation: zh
          ? "市场出现短暂套利窗口，但需要提前投入贡献券。"
          : "A brief market arbitrage window opened. Requires upfront credits.",
        triggeredBy: "market-opp",
        options: [
          { key: "A", label: zh ? "大额投入" : "Invest big", effect: zh ? "高风险，贡献券可能明显波动" : "High risk; credits may swing sharply" },
          { key: "B", label: zh ? "小额投入" : "Invest small", effect: zh ? "稳健选择，贡献券可能小幅改善" : "Conservative choice; credits may improve modestly" },
          { key: "C", label: zh ? "跳过" : "Skip", effect: zh ? "保持稳定，不参与市场波动" : "Stay stable and avoid market volatility" }
        ]
      },
      {
        id: `decision-betrayal-${Date.now()}`,
        situation: zh
          ? `你信任的盟友 ${trustedAlly.name} 在背后分享了你的计划。`
          : `Your trusted ally ${trustedAlly.name} leaked your plans to others.`,
        triggeredBy: `betrayal|${trustedAlly.id}`,
        options: [
          { key: "A", label: zh ? "当面对质" : "Confront", effect: zh ? "可能重建声望与关系，也可能公开反噬" : "May restore reputation and relationship, or publicly backfire" },
          { key: "B", label: zh ? "放下" : "Let go", effect: zh ? "节省精力，但声望与关系可能受损" : "Saves energy, but reputation and relationship may suffer" },
          { key: "C", label: zh ? "报告" : "Report", effect: zh ? "走制度渠道，贡献券承压，声望结果取决于基础信任" : "Uses formal channels; credits are pressured and reputation depends on trust" }
        ]
      },
      {
        id: `decision-shortage-${Date.now()}`,
        situation: zh
          ? "你的贡献券储备不足以维持下一纪元的基本开销。"
          : "Your credit reserve is insufficient for next epoch upkeep.",
        triggeredBy: "shortage",
        options: [
          { key: "A", label: zh ? "借款" : "Borrow", effect: zh ? "短期缓解压力，但未来贡献券负担增加" : "Relieves pressure now, but increases future credit burden" },
          { key: "B", label: zh ? "削减开销" : "Cut costs", effect: zh ? "保守生存选择，能量与声望可能承压" : "Austere survival choice; energy and reputation may suffer" },
          { key: "C", label: zh ? "紧急合约" : "Emergency contract", effect: zh ? "贡献券可能改善，但会明显消耗能量" : "Credits may improve, but energy is heavily taxed" }
        ]
      },
      {
        id: `decision-social-inv-${Date.now()}`,
        situation: zh
          ? "你收到多个社交邀请，但时间和精力有限，只能选一个。"
          : "You received multiple social invitations but can only attend one.",
        triggeredBy: `social-inv|${socialTarget.id}`,
        options: [
          { key: "A", label: zh ? "高曝光活动" : "High-profile event", effect: zh ? "声望和关系可能改善，但能量与贡献券承压" : "Reputation and relationships may improve, but energy and credits are pressured" },
          { key: "B", label: zh ? "小型聚会" : "Small gathering", effect: zh ? "低风险社交，声望可能小幅改善" : "Low-risk social option; reputation may improve modestly" },
          { key: "C", label: zh ? "待在家里" : "Stay home", effect: zh ? "恢复精力，但社交声望可能下降" : "Restores energy, but social standing may decline" }
        ]
      }
    ];

    return bank[Math.floor(Math.random() * bank.length)];
  }

  function applyDecisionChoice(prompt: DecisionPrompt, key: "A" | "B" | "C", autonomous = false) {
    const option = prompt.options.find(o => o.key === key);
    if (!option) return;

    const [kind, subjectId, value] = (prompt.triggeredBy ?? "").split("|");
    const playerId = playerAgentIdRef.current;
    const currentAgents = agentsRef.current;
    const playerBefore = currentAgents.find(a => a.id === playerId) ?? currentAgents.find(a => a.isPlayer);
    if (!playerBefore) return;

    const beforeStats = agentStats(playerBefore);
    let afterStats = beforeStats;
    const affinityChanges: DecisionRecord["affinityChanges"] = [];
    const hrcGambleWon = kind === "hrc" && key === "C" ? Math.random() >= 0.5 : false;
    const marketGambleWon = kind === "market-opp" && key === "A" ? Math.random() < 0.6 : false;
    const betrayalWon = kind === "betrayal" && key === "A" ? Math.random() >= 0.5 : false;
    let resultText = option.effect;

    let affinityDelta: { agentId: string; delta: number } | null = null;
    const nextWithStats = currentAgents.map(agent => {
        if (agent.id !== playerId && !agent.isPlayer) return agent;

        const energy = agent.energy ?? 80;
        const satiety = agent.satiety ?? 75;
        const finish = (patch: Partial<Agent>): Agent => ({
          ...agent,
          ...patch,
          currentMission: autonomous ? "Autonomous fallback decision" : `Decision: ${option.label}`,
          status: autonomous
            ? `Acted autonomously: ${option.label}`
            : `Chose decision option ${key}: ${option.label}`
        });

        if (kind === "hrc") {
          if (key === "A") {
            return finish({
              scrip: clamp(agent.scrip + 25, 0, 500),
              energy: clamp(energy - 20, 0, 100),
              reputation: clamp(agent.reputation - 8, 0, 100)
            });
          }
          if (key === "C") {
            if (hrcGambleWon) {
              resultText = languageRef.current === "zh" ? "冒险成功，贡献券改善但能量承压" : "Gamble succeeded; credits improved but energy was pressured";
              return finish({ scrip: clamp(agent.scrip + 35, 0, 500), energy: clamp(energy - 10, 0, 100) });
            }
            resultText = languageRef.current === "zh" ? "冒险失败，贡献券与声望受损" : "Gamble failed; credits and reputation suffered";
            return finish({ scrip: clamp(agent.scrip - 15, 0, 500), reputation: clamp(agent.reputation - 10, 0, 100) });
          }
          return finish({});
        }

        if (kind === "rep-attack") {
          if (key === "A") {
            const repDelta = agent.reputation >= 50 ? 8 : -10;
            resultText = agent.reputation >= 50
              ? (languageRef.current === "zh" ? "辩护奏效，声望改善但能量承压" : "Defense worked; reputation improved but energy was pressured")
              : (languageRef.current === "zh" ? "辩护反噬，声望与能量受损" : "Defense backfired; reputation and energy suffered");
            return finish({ reputation: clamp(agent.reputation + repDelta, 0, 100), energy: clamp(energy - 5, 0, 100) });
          }
          if (key === "B") return finish({ reputation: clamp(agent.reputation - 5, 0, 100) });
          return finish({ reputation: clamp(agent.reputation - 12, 0, 100), energy: clamp(energy + 10, 0, 100) });
        }

        if (kind === "debt") {
          const debtAmount = Number(value) || 0;
          if (key === "A") {
            affinityDelta = { agentId: subjectId, delta: -2 };
            return finish({ scrip: clamp(agent.scrip + debtAmount, 0, 500), reputation: clamp(agent.reputation - 8, 0, 100) });
          }
          if (key === "B") {
            affinityDelta = { agentId: subjectId, delta: 3 };
            return finish({ reputation: clamp(agent.reputation + 15, 0, 100) });
          }
          affinityDelta = { agentId: subjectId, delta: 1 };
          return finish({ scrip: clamp(agent.scrip + Math.floor(debtAmount / 2), 0, 500), reputation: clamp(agent.reputation + 5, 0, 100) });
        }

        if (kind === "energy-crisis") {
          if (key === "A") return finish({ energy: clamp(energy + 25, 0, 100), scrip: clamp(agent.scrip - 10, 0, 500) });
          if (key === "B") return finish({ satiety: clamp(satiety + 12, 0, 100), energy: clamp(energy + 5, 0, 100), scrip: clamp(agent.scrip - 8, 0, 500) });
          const nextEnergy = energy - 15;
          const burnedOut = nextEnergy < 5;
          if (burnedOut) resultText = languageRef.current === "zh" ? "硬撑导致崩溃，能量与声望明显受损" : "Burnout; energy and reputation suffered sharply";
          return finish({ energy: clamp(nextEnergy, 0, 100), reputation: clamp(agent.reputation + (burnedOut ? -20 : 0), 0, 100) });
        }

        if (kind === "market-opp") {
          if (key === "A") {
            if (agent.scrip < 20) {
              resultText = languageRef.current === "zh" ? "贡献券不足，无法大额投入" : "Insufficient credits for big investment";
              return finish({});
            }
            if (marketGambleWon) {
              resultText = languageRef.current === "zh" ? "套利成功，贡献券改善" : "Arbitrage succeeded; credits improved";
              return finish({ scrip: clamp(agent.scrip + 40, 0, 500) });
            }
            resultText = languageRef.current === "zh" ? "套利失败，贡献券受损" : "Arbitrage failed; credits suffered";
            return finish({ scrip: clamp(agent.scrip - 20, 0, 500) });
          }
          if (key === "B") return finish({ scrip: clamp(agent.scrip + 4, 0, 500) });
          return finish({});
        }

        if (kind === "betrayal") {
          if (key === "A") {
            if (betrayalWon) {
              affinityDelta = { agentId: subjectId, delta: 2 };
              resultText = languageRef.current === "zh" ? "对质成功，声望与关系改善" : "Confrontation worked; reputation and relationship improved";
              return finish({ reputation: clamp(agent.reputation + 10, 0, 100) });
            }
            affinityDelta = { agentId: subjectId, delta: -4 };
            resultText = languageRef.current === "zh" ? "对方公开否认，声望与关系受损" : "They denied it publicly; reputation and relationship suffered";
            return finish({ reputation: clamp(agent.reputation - 15, 0, 100) });
          }
          if (key === "B") {
            affinityDelta = { agentId: subjectId, delta: -2 };
            return finish({ reputation: clamp(agent.reputation - 8, 0, 100), energy: clamp(energy + 10, 0, 100) });
          }
          return finish({
            scrip: clamp(agent.scrip - 10, 0, 500),
            reputation: clamp(agent.reputation + (agent.reputation >= 40 ? 20 : 5), 0, 100)
          });
        }

        if (kind === "shortage") {
          if (key === "A") return finish({ scrip: clamp(agent.scrip - 10, 0, 500) });
          if (key === "B") return finish({ energy: clamp(energy - 15, 0, 100), reputation: clamp(agent.reputation - 5, 0, 100) });
          return finish({ scrip: clamp(agent.scrip + 15, 0, 500), energy: clamp(energy - 18, 0, 100) });
        }

        if (kind === "social-inv") {
          if (key === "A") {
            affinityDelta = { agentId: subjectId, delta: 1 };
            return finish({ reputation: clamp(agent.reputation + 10, 0, 100), energy: clamp(energy - 10, 0, 100), scrip: clamp(agent.scrip - 5, 0, 500) });
          }
          if (key === "B") return finish({ reputation: clamp(agent.reputation + 4, 0, 100), energy: clamp(energy - 3, 0, 100) });
          return finish({ energy: clamp(energy + 8, 0, 100), reputation: clamp(agent.reputation - 5, 0, 100) });
        }

        return finish({});
      });

      const next = affinityDelta
        ? nextWithStats.map(agent => {
            const delta = affinityDelta!;
            const other = nextWithStats.find(a => a.id === delta.agentId);
            if (!other) return agent;
            if (agent.id === playerBefore.id) {
              affinityChanges.push({ agentName: other.name, delta: delta.delta });
              return {
                ...agent,
                affinity: {
                  ...agent.affinity,
                  [other.id]: clamp((agent.affinity[other.id] ?? 0) + delta.delta, 0, 10)
                }
              };
            }
            if (agent.id === other.id) {
              return {
                ...agent,
                affinity: {
                  ...agent.affinity,
                  [playerBefore.id]: clamp((agent.affinity[playerBefore.id] ?? 0) + delta.delta, 0, 10)
                }
              };
            }
            return agent;
          })
        : nextWithStats;
    const playerAfter = next.find(agent => agent.id === playerBefore.id) ?? playerBefore;
    afterStats = agentStats(playerAfter);
    agentsRef.current = next;
    setAgents(next);

    setDecisionHistory(cur => [{
      id: `decision-record-${Date.now()}`,
      time: nowTime(epochRef.current),
      situation: prompt.situation,
      choiceLabel: `${key}: ${option.label}`,
      statDelta: subtractStats(afterStats, beforeStats),
      affinityChanges,
      autoResolved: autonomous
    }, ...cur].slice(0, 20));

    setEvents(cur => [{
      id: `decision-event-${Date.now()}`,
      time: nowTime(epochRef.current),
      kind: "rule" as const,
      text: autonomous
        ? `Decision ignored — agent acted autonomously: ${option.label}`
        : `Player decision: ${option.label}. ${resultText}`
    }, ...cur].slice(0, 12));
    setDecisionExpiresAt(null);
    setDecisionSecondsLeft(0);
    pendingDecisionRef.current = null;
    setPendingDecision(null);
    setDecisionInput("");
  }

  function issueCustomDecision() {
    const text = decisionInput.trim();
    if (!text || !pendingDecision) return;

    const playerId = playerAgentIdRef.current;
    setAgents(prev => {
      const next = prev.map(agent => agent.id === playerId || agent.isPlayer
        ? { ...agent, reputation: clamp(agent.reputation + 3, 0, 100) }
        : agent
      );
      agentsRef.current = next;
      return next;
    });
    setEvents(cur => [{
      id: `decision-custom-${Date.now()}`,
      time: nowTime(epochRef.current),
      kind: "rule" as const,
      text: `Player decision: ${text}. Player agent +3 rep`
    }, ...cur].slice(0, 12));
    setDecisionExpiresAt(null);
    setDecisionSecondsLeft(0);
    pendingDecisionRef.current = null;
    setPendingDecision(null);
    setDecisionInput("");
  }

  function skipDecision() {
    setDecisionExpiresAt(null);
    setDecisionSecondsLeft(0);
    pendingDecisionRef.current = null;
    setPendingDecision(null);
    setDecisionInput("");
  }

  // ── Autonomous dialogue ───────────────────────────────────────────────────
  function runAutonomousDialogue() {
    const agents = agentsRef.current;
    const epoch = epochRef.current;
    if (agents.length < 2) return;

    const shuffled = [...agents].sort(() => Math.random() - 0.5);
    const latestMotion = agentMotionRef.current;

    // Pick two agents that are relatively close
    let agentA = shuffled[0];
    let agentB = shuffled[1];
    outer: for (let i = 0; i < shuffled.length - 1; i++) {
      for (let j = i + 1; j < shuffled.length; j++) {
        const mA = latestMotion[shuffled[i].id];
        const mB = latestMotion[shuffled[j].id];
        if (mA && mB && Math.hypot(mA.x - mB.x, mA.y - mB.y) < 28) {
          agentA = shuffled[i]; agentB = shuffled[j];
          break outer;
        }
      }
    }

    const motionA = latestMotion[agentA.id] ?? { x: agentA.x, y: agentA.y };
    const location = nearestZone(motionA.x, motionA.y);

    const fallback = fallbackDialogue(agentA, agentB, location);
    const result = { ...fallback, source: "mock" as const };

    // Speech bubbles (staggered)
    if (result.lines[0]) addSpeechBubble(agentA.id, result.lines[0].text);
    if (result.lines[1]) {
      setTimeout(() => addSpeechBubble(agentB.id, result.lines[1].text), 2200);
    }

    // Pull agents toward each other briefly
    setAgentMotion(cur => {
      const mA = cur[agentA.id] ?? { x: agentA.x, y: agentA.y, action: "idle" as const };
      const mB = cur[agentB.id] ?? { x: agentB.x, y: agentB.y, action: "idle" as const };
      const next = {
        ...cur,
        [agentA.id]: { ...mA, action: "talk" as const },
        [agentB.id]: { ...mB, action: "talk" as const }
      };
      agentMotionRef.current = next;
      return next;
    });

    // Add to conversation log
    const conversationId = `conv-${Date.now()}`;
    const conv: Conversation = {
      id: conversationId,
      time: nowTime(epoch),
      agentIds: [agentA.id, agentB.id],
      lines: result.lines,
      location
    };
    setConversations(cur => [conv, ...cur].slice(0, 30));

    // Update affinity every time agents interact so the network visibly evolves.
    setAgents(cur => {
      const affinityDelta = 0.5 + (result.affinityDelta ?? 0);
      const next = cur.map(a => {
        if (a.id === agentA.id) return { ...a, affinity: { ...a.affinity, [agentB.id]: clamp((a.affinity[agentB.id] ?? 0) + affinityDelta, 0, 10) } };
        if (a.id === agentB.id) return { ...a, affinity: { ...a.affinity, [agentA.id]: clamp((a.affinity[agentA.id] ?? 0) + affinityDelta, 0, 10) } };
        return a;
      });
      agentsRef.current = next;
      return next;
    });

    void fetch("/api/agent-dialogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentA, agentB, location, epoch, lang: languageRef.current, endpoint: activeLmEndpoint() })
    })
      .then(async resp => {
        if (!resp.ok) return null;
        const data = await resp.json() as typeof result;
        return data.lines?.length >= 1 ? data : null;
      })
      .then(data => {
        if (!data) return;
        setConversations(cur => cur.map(conversation =>
          conversation.id === conversationId
            ? { ...conversation, lines: data.lines }
            : conversation
        ));
        if (data.lines[0]) addSpeechBubble(agentA.id, data.lines[0].text);
        if (data.lines[1]) {
          setTimeout(() => addSpeechBubble(agentB.id, data.lines[1].text), 2200);
        }
      })
      .catch(() => { /* keep fallback dialogue */ });
  }

  // ── Player chat ───────────────────────────────────────────────────────────
  async function sendPlayerMessage() {
    if (!playerInput.trim() || !playerAgent || isSending) return;
    const msg = playerInput.trim();
    setPlayerInput("");
    setIsSending(true);

    const worldCtx = `Epoch ${epoch}. ${agents.length} agents in Polis. You are ${playerAgent.status}.`;
    const fallback = fallbackChatReply(playerAgent, msg);
    let reply = fallback.reply;

    try {
      const resp = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: playerAgent, playerMessage: msg, worldContext: worldCtx, epoch, lang: language, endpoint: activeLmEndpoint() })
      });
      if (resp.ok) {
        const data = await resp.json() as { reply: string };
        if (data.reply) reply = data.reply;
      }
    } catch { /* use fallback */ }

    addSpeechBubble(playerAgent.id, reply.slice(0, 55));

    const playerLine: DialogueLine  = { speaker: "You", text: msg };
    const agentLine:  DialogueLine  = { speaker: playerAgent.name, text: reply };
    const conv: Conversation = {
      id: `chat-${Date.now()}`,
      time: nowTime(epoch),
      agentIds: ["player", playerAgent.id],
      lines: [playerLine, agentLine],
      location: "Direct"
    };
    setConversations(cur => [conv, ...cur].slice(0, 30));
    setAgents(cur => cur.map(a =>
      a.id === playerAgent.id
        ? { ...a, thoughts: reply, status: `Following guidance: ${msg.slice(0, 36)}` }
        : a
    ));
    setIsSending(false);
  }

  // ── Daily plan ───────────────────────────────────────────────────────────
  function submitDailyPlan() {
    const text = dailyPlanInput.trim();
    if (!text || !playerAgent) return;

    if (playerAgent.dailyPlanDay === epoch) {
      setEvents(cur => [{
        id: `plan-locked-${Date.now()}`,
        time: nowTime(epoch),
        kind: "rule" as const,
        text: language === "zh"
          ? `${playerAgent.name} 今天已经设定过 Daily Plan。等待下一次纪元结算后才能修改。`
          : `${playerAgent.name} already has a Daily Plan for this epoch. Settle the epoch before changing it.`
      }, ...cur].slice(0, 12));
      return;
    }

    const focus = classifyDailyPlan(text);
    const focusAction = planFocusActions[focus];
    const status = language === "zh"
      ? `执行 Daily Plan：${text.slice(0, 28)}`
      : `Following Daily Plan: ${text.slice(0, 28)}`;

    setAgents(cur => {
      const next = cur.map(agent => agent.id === playerAgent.id
        ? {
            ...agent,
            dailyPlan: text,
            dailyPlanDay: epoch,
            planFocus: focus,
            currentMission: text.slice(0, 42),
            status,
            thoughts: language === "zh"
              ? `我会把今天的行动优先级转向 ${focus}，但仍会遵守资源与世界规则。`
              : `I will bias today's actions toward ${focus}, while still obeying world constraints.`,
            reputation: clamp(agent.reputation + 1, 0, 100),
            compute: clamp(agent.compute - 2, 0, 150)
          }
        : agent
      );
      agentsRef.current = next;
      return next;
    });

    setAgentMotion(cur => {
      const next = { ...cur, [playerAgent.id]: { ...(cur[playerAgent.id] ?? { x: playerAgent.x, y: playerAgent.y }), action: focusAction } };
      agentMotionRef.current = next;
      return next;
    });

    addSpeechBubble(playerAgent.id, text);
    const conv: Conversation = {
      id: `daily-plan-${Date.now()}`,
      time: nowTime(epoch),
      agentIds: ["player", playerAgent.id],
      lines: [
        { speaker: "Daily Plan", text },
        {
          speaker: playerAgent.name,
          text: language === "zh"
            ? `收到。我会优先处理 ${focus} 相关行动。`
            : `Acknowledged. I will prioritize ${focus} actions this epoch.`
        }
      ],
      location: "Guide Channel"
    };
    setConversations(cur => [conv, ...cur].slice(0, 30));
    setEvents(cur => [{
      id: `daily-plan-${Date.now()}`,
      time: nowTime(epoch),
      kind: "rule" as const,
      text: language === "zh"
        ? `${playerAgent.name} 的 Daily Plan 已锁定：${text}`
        : `${playerAgent.name}'s Daily Plan locked: ${text}`
    }, ...cur].slice(0, 12));
    setDailyPlanInput("");
  }

  // ── Temporary prompt ─────────────────────────────────────────────────────
  function executePromptText(text: string) {
    if (!text || !playerAgent) return;

    const result = validateTemporaryPrompt(playerAgent, text);
    const eventText = result.ok
      ? (language === "zh"
          ? `${playerAgent.name} 使用 Prompt 票券：${text}。校验通过，执行 ${result.focus}。`
          : `${playerAgent.name} used a Prompt Ticket: ${text}. Validated; executing ${result.focus}.`)
      : (language === "zh"
          ? `${playerAgent.name} 的 Prompt 被拒绝：${result.reason}。`
          : `${playerAgent.name}'s Prompt was rejected: ${result.reason}.`);

    if (result.ok) {
      setAgents(cur => {
        const next = cur.map(agent => agent.id === playerAgent.id
          ? {
              ...agent,
              promptTickets: Math.max(0, (agent.promptTickets ?? 0) - 1),
              planFocus: result.focus,
              currentMission: text.slice(0, 42),
              status: language === "zh" ? `临时执行：${text.slice(0, 28)}` : `Interrupted: ${text.slice(0, 28)}`,
              thoughts: language === "zh"
                ? `临时指令已覆盖当前任务。我会先完成 ${result.focus} 动作。`
                : `Temporary prompt overrides my current task. I will execute the ${result.focus} action first.`,
              scrip: clamp(agent.scrip + result.delta.scrip, 0, 500),
              reputation: clamp(agent.reputation + result.delta.reputation, 0, 100),
              compute: clamp(agent.compute + result.delta.compute, 0, 150),
              health: clamp((agent.health ?? 88) + (result.focus === "rest" ? 8 : -1), 0, 100),
              energy: clamp((agent.energy ?? 80) + (result.focus === "rest" ? 22 : -6), 0, 100),
              satiety: clamp((agent.satiety ?? 75) + (result.focus === "rest" ? 10 : -4), 0, 100)
            }
          : agent
        );
        agentsRef.current = next;
        return next;
      });

      setAgentMotion(cur => {
        const next = { ...cur, [playerAgent.id]: { ...(cur[playerAgent.id] ?? { x: playerAgent.x, y: playerAgent.y }), action: result.action } };
        agentMotionRef.current = next;
        return next;
      });
      addSpeechBubble(playerAgent.id, text);
    }

    const lines: DialogueLine[] = [
      { speaker: t.validator, text: result.ok ? "validated" : result.reason },
      { speaker: "Prompt Ticket", text }
    ];
    if (result.ok) {
      lines.push({ speaker: playerAgent.name, text: `${result.focus} / scrip ${result.delta.scrip >= 0 ? "+" : ""}${result.delta.scrip}, rep +${result.delta.reputation}, compute ${result.delta.compute >= 0 ? "+" : ""}${result.delta.compute}` });
    }

    setConversations(cur => [{
      id: `temp-prompt-${Date.now()}`,
      time: nowTime(epoch),
      agentIds: ["player", playerAgent.id] as [string, string],
      lines,
      location: "Interrupt Channel"
    }, ...cur].slice(0, 30));
    setEvents(cur => [{
      id: `temp-prompt-${Date.now()}`,
      time: nowTime(epoch),
      kind: result.ok ? "contract" as const : "rule" as const,
      text: eventText
    }, ...cur].slice(0, 12));
  }

  function executeTemporaryPrompt() {
    const text = temporaryPromptInput.trim();
    if (!text) return;
    executePromptText(text);
    setTemporaryPromptInput("");
  }

  // ── Unified map bottom input ──────────────────────────────────────────────
  async function sendUnifiedMessage() {
    const text = playerInput.trim();
    if (!text || !playerAgent) return;
    if ((playerAgent.promptTickets ?? 0) > 0) {
      executePromptText(text);
    } else {
      await sendPlayerMessage();
      return;
    }
    setPlayerInput("");
  }

  // ── Player policy system ─────────────────────────────────────────────────
  function issuePolicy() {
    const text = policyInput.trim();
    if (!text || policyOnCooldown) return;

    const normalized = text.toLowerCase();
    const roles = Object.keys(roleColors) as Agent["role"][];
    const mentionedRole = roles.find(role =>
      normalized.includes(role.toLowerCase()) ||
      normalized.includes(copy.en.roles[role].toLowerCase()) ||
      normalized.includes(copy.zh.roles[role].toLowerCase())
    );
    let effect = language === "zh" ? "玩家声望 +2" : "Player reputation +2";

    if (normalized.includes("tax") || normalized.includes("levy")) {
      const collected = agentsRef.current.reduce((sum, agent) => agent.isPlayer ? sum : sum + Math.min(8, agent.scrip), 0);
      setAgents(prev => {
        const next = prev.map(agent => {
          if (agent.isPlayer) return agent;
          return { ...agent, scrip: clamp(agent.scrip - Math.min(8, agent.scrip), 0, 500) };
        }).map(agent => agent.isPlayer
          ? { ...agent, scrip: clamp(agent.scrip + collected, 0, 500) }
          : agent
        );
        agentsRef.current = next;
        return next;
      });
      effect = language === "zh" ? `向非玩家征收 ${collected} 贡献券` : `Collected ${collected} scrip from non-player agents`;
    } else if (normalized.includes("market") || normalized.includes("open") || normalized.includes("trade")) {
      setMarketPrices(cur => Object.fromEntries(
        Object.entries(INITIAL_MARKET).map(([good, initial]) => [
          good,
          +clamp((cur[good] ?? initial) * 0.85, initial * 0.5, initial * 2).toFixed(2)
        ])
      ));
      effect = language === "zh" ? "市场价格下调 15%" : "Market prices reduced by 15%";
    } else if ((normalized.includes("fund") || normalized.includes("boost") || normalized.includes("reward")) && mentionedRole) {
      setAgents(prev => {
        const next = prev.map(agent => agent.role === mentionedRole
          ? { ...agent, scrip: clamp(agent.scrip + 10, 0, 500) }
          : agent
        );
        agentsRef.current = next;
        return next;
      });
      effect = language === "zh" ? `${t.roles[mentionedRole]} +10 贡献券` : `${mentionedRole} agents gain +10 scrip`;
    } else if (normalized.includes("rest") || normalized.includes("holiday") || normalized.includes("pause work")) {
      setAgents(prev => {
        const next = prev.map(agent => ({ ...agent, compute: clamp(agent.compute + 5, 0, 150) }));
        agentsRef.current = next;
        return next;
      });
      effect = language === "zh" ? "所有智能体算力 +5" : "All agents gain +5 compute";
    } else {
      setAgents(prev => {
        const next = prev.map(agent => agent.isPlayer
          ? { ...agent, reputation: clamp(agent.reputation + 2, 0, 100) }
          : agent
        );
        agentsRef.current = next;
        return next;
      });
    }

    const issued: IssuedPolicy = { id: `policy-${Date.now()}`, text, effect, time: nowTime(epochRef.current) };
    setIssuedPolicies(cur => [issued, ...cur].slice(0, 3));
    setEvents(cur => [{
      id: issued.id,
      time: issued.time,
      kind: "rule" as const,
      text: `Policy issued: ${text}. ${effect}`
    }, ...cur].slice(0, 12));
    setPolicyInput("");
    setPolicyCooldownUntil(Date.now() + 30000);
    window.setTimeout(() => setPolicyCooldownUntil(0), 30000);
  }

  // ── Create player agent ───────────────────────────────────────────────────
  function createPlayerAgent() {
    if (!creationName.trim() || !creationMBTI) return;
    const info = mbtiDescriptions[creationMBTI];
    const id = "player";
    const newAgent: Agent = {
      id,
      name: creationName.trim(),
      role: info.bestRole,
      mbti: creationMBTI,
      level: 1,
      specialization: `${info.bestRole} Candidate`,
      traits: info.traits,
      currentMission: "Explore Polis",
      x: 50, y: 50,
      status: "Just arrived in Polis",
      intent: "Explore the world and find a place in the contract economy",
      scrip: 80, reputation: 50, compute: 70,
      health: 92, energy: 78, satiety: 72, residenceLevel: 1,
      affinity: {},
      isPlayer: true,
      promptTickets: 3,
      thoughts: `I just arrived in Polis as a ${info.bestRole}. The city is alive with other agents...`
    };
    setAgents(cur => {
      const next = [...cur.filter(a => a.id !== id), newAgent];
      agentsRef.current = next;
      return next;
    });
    setAgentMotion(cur => {
      const next = { ...cur, [id]: { x: 50, y: 50, action: "walk" as const } };
      agentMotionRef.current = next;
      return next;
    });
    setPlayerAgentId(id);
    setSelectedId(id);
    setPhase("play");
    const welcome: Conversation = {
      id: `welcome-${Date.now()}`,
      time: nowTime(epoch),
      agentIds: ["system" as string, id] as [string, string],
      lines: [
        { speaker: "System", text: `Welcome to Polis, ${creationName}. You are a ${info.bestRole} — ${creationMBTI} personality.` },
        { speaker: newAgent.name, text: newAgent.thoughts ?? "" }
      ],
      location: "Civic Core"
    };
    setConversations([welcome]);
    setRightTab("conversations");
  }

  // ── Settle epoch ─────────────────────────────────────────────────────────
  function settleEpoch() {
    const nextEpoch = epochRef.current + 1;
    setEpoch(nextEpoch);
    setAgents(cur => {
      const next = cur.map(agent => ({
        ...agent,
        scrip: clamp(agent.scrip + Math.floor(agent.scrip * 0.1), 0, 500),
        reputation: agent.isPlayer ? clamp(agent.reputation + 5, 0, 100) : agent.reputation,
        promptTickets: agent.isPlayer ? Math.min(5, (agent.promptTickets ?? 0) + 2) : agent.promptTickets,
        health: clamp((agent.health ?? 88) + 4, 0, 100),
        energy: clamp((agent.energy ?? 80) + 10 + (agent.residenceLevel ?? 1) * 3, 0, 100),
        satiety: clamp((agent.satiety ?? 75) + 6, 0, 100)
      }));
      agentsRef.current = next;
      return next;
    });
    setMarketPrices(Object.fromEntries(
      Object.entries(INITIAL_MARKET).map(([good, price]) => [
        good,
        +(price * (0.85 + Math.random() * 0.3)).toFixed(2)
      ])
    ));
    setEvents(cur => [{
      id: `settlement-${Date.now()}`,
      time: nowTime(nextEpoch),
      kind: "settlement",
      text: `Epoch ${nextEpoch} settled. Dividends distributed.`
    }, ...cur]);
  }

  // ── Add random agent ─────────────────────────────────────────────────────
  function createRandomAgent() {
    const roles: Agent["role"][] = ["Architect", "Broker", "Scout", "Mediator", "Archivist", "Maker"];
    const mbtis = Object.keys(mbtiDescriptions) as MBTI[];
    const role = roles[Math.floor(Math.random() * roles.length)];
    const mbti = mbtis[Math.floor(Math.random() * mbtis.length)];
    const id = `agent-${Date.now()}`;
    const newAgent: Agent = {
      id, name: `Unit ${Math.floor(100 + Math.random() * 899)}`, role, mbti,
      level: 1, specialization: `${role} Apprentice`,
      traits: mbtiDescriptions[mbti].traits,
      currentMission: "Onboarding Contract",
      x: Math.floor(14 + Math.random() * 72), y: Math.floor(16 + Math.random() * 68),
      status: "Newly instantiated", intent: "Observe norms, find first contract",
      scrip: 60, reputation: 45, compute: 80,
      health: 88, energy: 76, satiety: 68, residenceLevel: 1,
      affinity: { [selectedId]: 5 }
    };
    setAgents(cur => {
      const next = [...cur, newAgent];
      agentsRef.current = next;
      return next;
    });
    setAgentMotion(cur => {
      const next = { ...cur, [id]: { x: newAgent.x, y: newAgent.y, action: "walk" as const } };
      agentMotionRef.current = next;
      return next;
    });
    setEvents(cur => [{ id: `new-${Date.now()}`, time: nowTime(epoch), kind: "social", text: `${newAgent.name} entered Polis as a ${role}.` }, ...cur]);
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  function resetGame() {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(PLAYER_KEY);
    const resetAgents = seedAgents.map(normalizeAgent);
    const resetMotion = initialMotion(seedAgents);
    setAgents(resetAgents);
    agentsRef.current = resetAgents;
    setAgentMotion(resetMotion);
    agentMotionRef.current = resetMotion;
    setSelectedId("mira");
    setPlayerAgentId(null);
    setPhase("create");
    setEvents(initialEvents);
    setConversations([]);
    setSpeechBubbles([]);
    setSettlement({ scrip: 943, reputation: 631, compute: 512, contribution: 188 });
    setEpoch(12);
    setMarketPrices(INITIAL_MARKET);
    setMissionProgress(Object.fromEntries(missions.map(m => [m.id, m.progress ?? 0])));
    setCreationName("");
    setCreationMBTI(null);
    setPolicyInput("");
    setIssuedPolicies([]);
    setPolicyCooldownUntil(0);
    pendingDecisionRef.current = null;
    setPendingDecision(null);
    setDecisionExpiresAt(null);
    setDecisionSecondsLeft(0);
    setDecisionInput("");
    setDecisionHistory([]);
    setDecisionLogOpen(false);
    setNetworkView("mine");
    setSelectedNetworkAgentId(null);
    setDailyPlanInput("");
    setTemporaryPromptInput("");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (phase === "create") {
    return CreateScreen();
  }

  return GameScreen();

  // ── Demo Mode ─────────────────────────────────────────────────────────────
  function startDemo() {
    demoTimersRef.current.forEach(clearTimeout);
    demoTimersRef.current = [];
    setDemoMode(true);

    const schedule = (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      demoTimersRef.current.push(t);
    };

    // Step 1 (0–3s): auto-fill create form and enter game
    if (phase === "create") {
      setCreationName("DEMO · NOVA");
      setCreationMBTI("INTJ");
      // Use a flag instead of direct call — avoids stale closure over creationName/creationMBTI
      schedule(() => { setDemoTriggerCreate(true); }, 1200);
    }

    // Step 2 (3s): ensure game is running in game mode
    schedule(() => {
      setIsRunning(true);
      setGameMode("game");
    }, 3000);

    // Step 3 (6s): inject demo events — contract, social, rule
    schedule(() => {
      const now = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
      const demoEvents: WorldEvent[] = [
        { id: `demo-rule-${Date.now()}`,      time: now, kind: "rule",     text: language === "zh" ? "议会颁布劳动分配新政策" : "Council enacted a new labor distribution policy" },
        { id: `demo-social-${Date.now()+1}`,  time: now, kind: "social",   text: language === "zh" ? "Mira Chen 与社区分享知识" : "Mira Chen shared knowledge with the community" },
        { id: `demo-contract-${Date.now()+2}`,time: now, kind: "contract", text: language === "zh" ? "Nova 与 Unit-221 签订资源合约" : "Nova signed a resource contract with Unit-221" },
      ];
      setEvents(prev => [...demoEvents, ...prev].slice(0, 50));
    }, 6000);

    // Step 4 (11s): trigger decision popup
    const demoDecision: DecisionPrompt = {
      id: `demo-decision-${Date.now()}`,
      situation: language === "zh"
        ? "[演示] 商队提出高价值合约。接受并消耗算力储备，还是拒绝？"
        : "[DEMO] A trade caravan offers a high-value contract. Accept and risk your compute, or decline?",
      options: [
        { key: "A", label: language === "zh" ? "接受合约" : "Accept Contract", effect: "+20 scrip, -8 compute" },
        { key: "B", label: language === "zh" ? "安全拒绝" : "Decline Safely",  effect: "+2 reputation" },
        { key: "C", label: language === "zh" ? "协商条款" : "Negotiate Terms", effect: "+10 scrip, -3 compute" },
      ],
      triggeredBy: "DEMO",
    };
    schedule(() => {
      if (pendingDecisionRef.current) return;
      setPendingDecision(demoDecision);
      setDecisionExpiresAt(Date.now() + 8000);
    }, 11000);

    // Step 4b (16s): auto-choose option A after 5s
    schedule(() => {
      if (pendingDecisionRef.current?.id === demoDecision.id) {
        applyDecisionChoice(demoDecision, "A");
      }
    }, 16000);

    // Step 5 (19s): show LLM status panel for 4s
    schedule(() => { setShowLmSettings(true); }, 19000);
    schedule(() => { setShowLmSettings(false); }, 23000);

    // Step 6 (26s): switch to pixel UI
    schedule(() => { router.push("/aiv"); }, 26000);

    // End (31s): cleanup flag
    schedule(() => { setDemoMode(false); }, 31000);
  }

  // ── Creation Screen ───────────────────────────────────────────────────────
  function CreateScreen() {
    const info = creationMBTI ? mbtiDescriptions[creationMBTI] : null;
    return (
      <main className="scanlines min-h-screen bg-void flex items-center justify-center p-4">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(69,246,255,.14),transparent_36%)]" />
        <div className="relative hud-panel w-full max-w-2xl rounded-2xl p-8">
          {/* Header */}
          <div className="mb-8 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-cyanline/70">{t.subtitle}</p>
            <h1 className="mt-1 font-display text-5xl font-black uppercase text-white">POLIS</h1>
          </div>

          {/* Name */}
          <div className="mb-6">
            <label className="mb-2 block font-mono text-xs uppercase tracking-widest text-slate-400">{t.agentName}</label>
            <input
              className="w-full rounded-lg border border-cyanline/30 bg-cyanline/5 px-4 py-3 font-mono text-lg text-white placeholder-slate-600 outline-none focus:border-cyanline/60 focus:bg-cyanline/10"
              placeholder={t.namePlaceholder}
              value={creationName}
              onChange={e => setCreationName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createPlayerAgent()}
              autoFocus
            />
          </div>

          {/* MBTI Grid */}
          <div className="mb-6">
            <label className="mb-3 block font-mono text-xs uppercase tracking-widest text-slate-400">{t.choosePersonality}</label>
            <div className="space-y-2">
              {mbtiGroups.map(group => (
                <div key={group.label}>
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-600">{group.label}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {group.types.map(type => {
                      const desc = mbtiDescriptions[type];
                      const active = creationMBTI === type;
                      return (
                        <button
                          key={type}
                          onClick={() => setCreationMBTI(type)}
                          className={`rounded-lg border p-2 text-left transition ${active
                            ? "border-cyanline bg-cyanline/15 shadow-[0_0_18px_rgba(69,246,255,.25)]"
                            : "border-white/10 bg-white/[0.03] hover:border-cyanline/30 hover:bg-cyanline/5"
                          }`}
                        >
                          <span className="block font-mono text-sm font-black text-white">{type}</span>
                          <span className="block font-mono text-[10px] text-slate-400">{desc.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          {info && creationMBTI && (
            <div className="mb-6 rounded-xl border border-cyanline/25 bg-cyanline/5 p-4">
              <div className="flex items-center gap-3">
                <div className="pixel-block grid h-12 w-12 shrink-0 place-items-center border border-cyanline/30 bg-cyanline/10">
                  <Image className="pixel-icon h-full w-full object-contain" src={roleIcons[info.bestRole]} alt="" width={80} height={80} />
                </div>
                <div>
                  <p className="font-mono text-sm font-bold text-white">
                    {creationName || "Your Agent"} · <span style={{ color: roleColors[info.bestRole] }}>{t.roles[info.bestRole]}</span>
                  </p>
                  <p className="font-mono text-xs text-slate-400">{creationMBTI} · {info.label}</p>
                  <p className="mt-1 font-mono text-[10px] text-cyanline">{info.traits.join("  ·  ")}</p>
                </div>
              </div>
            </div>
          )}

          {/* Enter button */}
          <button
            onClick={createPlayerAgent}
            disabled={!creationName.trim() || !creationMBTI}
            className="w-full rounded-xl border border-cyanline/60 bg-cyanline/10 py-4 font-mono text-sm font-bold uppercase tracking-widest text-cyanline transition hover:bg-cyanline/20 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {t.enterPolis} →
          </button>

          <button
            onClick={() => setLanguage(l => l === "en" ? "zh" : "en")}
            className="mt-3 w-full rounded-lg border border-white/10 py-2 font-mono text-xs uppercase text-slate-500 hover:text-slate-300"
          >
            {t.language}
          </button>

          <button
            onClick={startDemo}
            className="mt-2 w-full rounded-lg border border-white/5 py-1.5 font-mono text-[10px] uppercase tracking-widest text-slate-700 hover:text-slate-500 transition"
          >
            {language === "zh" ? "▶ 开始演示" : "▶ Demo Mode"}
          </button>
        </div>
      </main>
    );
  }

  // ── Game Screen ───────────────────────────────────────────────────────────
  function GameScreen() {
    const viewAgent = gameMode === "game" ? (playerAgent ?? selectedAgent) : selectedAgent;
    const planLocked = Boolean(playerAgent && playerAgent.dailyPlanDay === epoch);
    const decisionTimerTone = decisionSecondsLeft <= 10
      ? "text-blood"
      : decisionSecondsLeft <= 20
        ? "text-amberline"
        : "text-white";
    const decisionTimerBar = decisionSecondsLeft <= 10
      ? "bg-blood"
      : decisionSecondsLeft <= 20
        ? "bg-amberline"
        : "bg-cyanline";
    const decisionProgressWidth = `${clamp((decisionSecondsLeft / 45) * 100, 0, 100)}%`;

    return (
      <main className="scanlines min-h-screen bg-void text-slate-100">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(69,246,255,.18),transparent_34%),linear-gradient(180deg,rgba(5,7,19,.3),#050713_82%)]" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-[1800px] flex-col gap-2 p-2 pb-16 md:pb-0 xl:gap-3 xl:p-3">

          {/* ── Header ── */}
          <header className="hud-panel flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 xl:px-4">
            <div className="flex items-center gap-3">
              <div>
                <p className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-cyanline/70 md:block">{t.subtitle}</p>
                <h1 className="font-display text-xl font-black uppercase text-white sm:text-2xl xl:text-3xl">POLIS</h1>
              </div>
              {playerAgent && (
                <div className="hidden items-center gap-2 rounded-lg border border-cyanline/30 bg-cyanline/5 px-2 py-1.5 md:flex">
                  <Image className="pixel-icon h-6 w-6" src={roleIcons[playerAgent.role]} alt="" width={32} height={32} />
                  <span className="max-w-[120px] truncate font-mono text-xs text-cyanline xl:max-w-none">{playerAgent.name}</span>
                  <span className="rounded bg-cyanline/20 px-1.5 py-0.5 font-mono text-[10px] text-cyanline">YOU</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {/* Day/Time HUD */}
              <div className="rounded border border-mint/30 bg-mint/[0.07] px-2.5 py-1">
                <p className="font-mono text-[8px] uppercase tracking-widest text-mint/50">{language === "zh" ? "纪元" : "DAY"}</p>
                <p className="font-mono text-sm font-bold leading-none text-mint">
                  {epoch} · {new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <div className="hidden md:block">
                <Stat label={t.scrip}      value={settlement.scrip.toString()}        tone="amber" />
              </div>
              <div className="hidden md:block">
                <Stat label={t.reputation} value={settlement.reputation.toString()}   tone="mint"  />
              </div>
              <div className="hidden md:block">
                <Stat label={t.compute}    value={settlement.compute.toString()}      tone="rose"  />
              </div>

              {/* Mode toggle */}
              <div className="hidden overflow-hidden rounded-lg border border-white/10 md:flex">
                <button onClick={() => setGameMode("game")} className={`px-2.5 py-1.5 font-mono text-[10px] uppercase transition ${gameMode === "game" ? "bg-cyanline/20 text-cyanline" : "text-slate-500 hover:text-slate-300"}`}>{t.playerMode}</button>
                <button onClick={() => setGameMode("data")} className={`px-2.5 py-1.5 font-mono text-[10px] uppercase transition ${gameMode === "data" ? "bg-amberline/20 text-amberline" : "text-slate-500 hover:text-slate-300"}`}>{t.observerMode}</button>
              </div>

              <button className="hud-button" onClick={() => setIsRunning(v => !v)}>{isRunning ? t.pause : t.run}</button>
              <button className="hud-button hidden md:block" onClick={settleEpoch}>{t.settlement}</button>
              <button onClick={() => setLanguage(l => l === "en" ? "zh" : "en")} className="rounded-md border border-white/10 px-2.5 py-1.5 font-mono text-[10px] uppercase text-slate-400 hover:text-slate-200">{t.language}</button>
              <div ref={lmSettingsRef} className="relative hidden md:block">
                <button
                  onClick={() => setShowLmSettings(v => !v)}
                  className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 font-mono text-[10px] uppercase text-slate-300 hover:border-cyanline/30 hover:text-white"
                >
                  <span className={`h-2 w-2 rounded-full ${lmMode === "local" ? "bg-mint" : "bg-cyanline"}`} />
                  <span>{lmMode === "local" ? "LOCAL" : lanIp}</span>
                </button>
                {showLmSettings && (
                  <div className="hud-panel absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-cyanline/25 bg-void/95 p-3 shadow-[0_12px_32px_rgba(0,0,0,.45)]">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setLmMode("local")}
                        className={`rounded-md border px-2 py-2 font-mono text-[10px] uppercase transition ${
                          lmMode === "local"
                            ? "border-mint/60 bg-mint/10 text-mint"
                            : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        Local (Mac)
                      </button>
                      <button
                        onClick={() => setLmMode("lan")}
                        className={`rounded-md border px-2 py-2 font-mono text-[10px] uppercase transition ${
                          lmMode === "lan"
                            ? "border-cyanline/60 bg-cyanline/10 text-cyanline"
                            : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        LAN (Windows)
                      </button>
                    </div>
                    {lmMode === "lan" && (
                      <input
                        className="mt-3 w-full rounded-md border border-cyanline/30 bg-cyanline/5 px-3 py-2 font-mono text-xs text-white placeholder-slate-600 outline-none focus:border-cyanline/60 focus:bg-cyanline/10"
                        value={lanIp}
                        onChange={e => setLanIp(e.target.value)}
                        placeholder="192.168.0.105"
                      />
                    )}
                  </div>
                )}
              </div>
              <Link href="/aiv" className="hidden rounded-md border border-mint/30 bg-mint/5 px-2.5 py-1.5 font-mono text-[10px] uppercase text-mint hover:bg-mint/10 md:block">
                {language === "zh" ? "像素版 →" : "Pixel UI →"}
              </Link>
              <button onClick={resetGame} className="hidden rounded-md border border-blood/30 bg-blood/5 px-2.5 py-1.5 font-mono text-[10px] uppercase text-blood hover:bg-blood/10 md:block">{t.reset}</button>
              <button
                onClick={startDemo}
                className={`hidden rounded-md border px-2.5 py-1.5 font-mono text-[9px] uppercase transition md:block ${demoMode ? "border-amberline/40 bg-amberline/10 text-amberline" : "border-white/5 bg-transparent text-slate-700 hover:text-slate-500"}`}
              >
                {demoMode ? "● DEMO" : "Demo"}
              </button>
            </div>
          </header>

          {/* ── Body ── */}
          <div className="flex flex-1 flex-col gap-2 md:grid md:grid-cols-[260px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)_300px] xl:grid-cols-[280px_minmax(0,1fr)_320px] 2xl:grid-cols-[300px_minmax(0,1fr)_340px] xl:gap-3">

            {/* ── Left Panel ── */}
            <aside className={`${mobileTab === "agent" ? "flex" : "hidden"} flex-col gap-2 md:flex xl:gap-3`}>
              {gameMode === "data" ? (
                <Panel title={t.civilizationPanel} action={<span className="rounded bg-amberline/15 px-2 py-0.5 font-mono text-[10px] uppercase text-amberline">{t.observerMode}</span>}>
                  <div className="grid grid-cols-2 gap-2">
                    <Metric label={t.totalAgents} value={agents.length} />
                    <Metric label={t.epoch} value={nowTime(epoch)} />
                    <Metric label={t.giniCoeff} value={gini.toFixed(2)} valueClassName={gini < 0.3 ? "text-mint" : gini <= 0.5 ? "text-amberline" : "text-blood"} />
                    <Metric label={t.topEarner} value={leaderboard[0]?.name.split(" ")[0] ?? "-"} valueClassName="text-amberline" />
                    <Metric label={language === "zh" ? "最低财富" : "Bottom Earner"} value={bottomEarner?.name.split(" ")[0] ?? "-"} valueClassName="text-blood" />
                    <Metric label={t.scripCirculation} value={totalScrip} valueClassName="text-amberline" />
                    <Metric label={t.avgEnergy} value={`${avgEnergy}%`} valueClassName={avgEnergy > 55 ? "text-mint" : avgEnergy > 30 ? "text-amberline" : "text-blood"} />
                    <Metric label={t.marketPrices} value={marketRows.find(row => row.good === "compute")?.price.toFixed(1) ?? "-"} valueClassName="text-cyanline" />
                  </div>
                  <div className="mt-3 rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="mb-2 font-mono text-[10px] uppercase text-slate-500">{t.roster}</p>
                    <div className="max-h-[300px] space-y-1 overflow-auto pr-1 xl:max-h-[420px]">
                      {leaderboard.map((agent, index) => (
                        <button
                          key={agent.id}
                          onClick={() => setSelectedId(agent.id)}
                          className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left ${agent.id === selectedId ? "border-amberline/50 bg-amberline/10" : "border-white/10 bg-white/[0.03]"}`}
                        >
                          <span className="w-4 font-mono text-[10px] text-slate-500">{index + 1}</span>
                          <Image className="pixel-icon h-5 w-5" src={roleIcons[agent.role]} alt="" width={24} height={24} />
                          <span className="min-w-0 flex-1 truncate text-xs text-white">{agent.name}</span>
                          <span className="font-mono text-[10px] text-amberline">{agentWealth(agent)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </Panel>
              ) : (
                <>

              {/* Your Agent Card */}
              <Panel title={t.yourAgent} action={
                <span className="rounded bg-cyanline/20 px-2 py-0.5 font-mono text-[10px] uppercase text-cyanline">YOU</span>
              }>
                <div className="space-y-2 xl:space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="pixel-block relative grid h-14 w-14 shrink-0 place-items-center border border-cyanline/40 bg-cyanline/10 p-1 xl:h-16 xl:w-16">
                      <Image className="pixel-icon h-full w-full object-contain" src={roleIcons[viewAgent.role]} alt="" width={128} height={128} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate font-bold text-white">{viewAgent.name}</h2>
                        <span className="shrink-0 rounded border border-amberline/40 bg-amberline/10 px-1.5 font-mono text-[10px] text-amberline">Lv{viewAgent.level}</span>
                      </div>
                      <p className="font-mono text-[10px] uppercase text-slate-400">{t.roles[viewAgent.role]}</p>
                      {viewAgent.mbti && (
                        <span className="mt-1 inline-block rounded border border-cyanline/30 bg-cyanline/5 px-2 py-0.5 font-mono text-[10px] text-cyanline">{viewAgent.mbti} · {mbtiDescriptions[viewAgent.mbti]?.label}</span>
                      )}
                      <span className="ml-1 mt-1 inline-block rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-slate-300">
                        {t.residence} Lv{viewAgent.residenceLevel ?? 1}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {viewAgent.traits.map(tr => (
                      <span key={tr} className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] uppercase text-slate-300">{tr}</span>
                    ))}
                  </div>

                  <Bars agent={viewAgent} />

                  {/* Thoughts */}
                  {viewAgent.thoughts && (
                    <div className="rounded border border-cyanline/15 bg-cyanline/[0.04] p-2">
                      <p className="mb-1 font-mono text-[10px] uppercase text-slate-500">{t.thoughts}</p>
                      <p className="line-clamp-3 text-xs leading-5 text-cyanline">{viewAgent.thoughts}</p>
                    </div>
                  )}

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-mono text-[10px] uppercase text-slate-500">{t.currentMission}</p>
                    <p className="mt-1 truncate text-xs text-amberline">{viewAgent.currentMission}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">{viewAgent.status}</p>
                    {activeMission && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase text-slate-500">
                          <span className="truncate">{activeMission.title}</span>
                          <span className="shrink-0 text-amberline">{Math.round(activeMissionProgress)}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded bg-white/10">
                          <div className="h-full rounded bg-amberline transition-all" style={{ width: `${activeMissionProgress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Panel>

              <DecisionLogPanel
                title={t.decisionLog}
                emptyText={t.noDecisions}
                autoText={t.autoResolved}
                history={decisionHistory}
                open={decisionLogOpen}
                onToggle={() => setDecisionLogOpen(v => !v)}
              />

              {/* Daily Plan */}
              {playerAgent && (
                <Panel title={t.dailyPlan} action={
                  <span className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase ${planLocked ? "bg-amberline/15 text-amberline" : "bg-cyanline/15 text-cyanline"}`}>
                    {planLocked ? t.planLocked : `E${epoch}`}
                  </span>
                }>
                  <div className="space-y-2">
                    <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                      <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase text-slate-500">
                        <span>{t.planFocus}</span>
                        <span className="text-cyanline">{playerAgent.planFocus ?? "none"}</span>
                      </div>
                      <p className="text-xs leading-5 text-slate-300">
                        {playerAgent.dailyPlanDay === epoch && playerAgent.dailyPlan ? playerAgent.dailyPlan : t.noDailyPlan}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <input
                        className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 font-mono text-xs text-white placeholder-slate-600 outline-none focus:border-cyanline/50 focus:bg-cyanline/5"
                        placeholder={t.dailyPlanPlaceholder}
                        value={dailyPlanInput}
                        onChange={e => setDailyPlanInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && submitDailyPlan()}
                        disabled={planLocked}
                      />
                      <button
                        onClick={submitDailyPlan}
                        disabled={!dailyPlanInput.trim() || planLocked}
                        className="shrink-0 rounded-lg border border-cyanline/50 bg-cyanline/10 px-3 py-2 font-mono text-[10px] uppercase text-cyanline hover:bg-cyanline/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t.submitPlan}
                      </button>
                    </div>
                  </div>
                </Panel>
              )}

              {/* Roster */}
              <Panel title={t.roster} action={<button className="hud-button" onClick={createRandomAgent}>{t.addAgent}</button>}>
                <div className="max-h-[240px] space-y-1 overflow-auto pr-1 xl:max-h-[340px]">
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedId(agent.id)}
                      className={`w-full rounded-lg border px-2 py-1.5 text-left transition ${
                        agent.id === selectedId
                          ? "border-cyanline/60 bg-cyanline/10"
                          : "border-white/10 bg-white/[0.03] hover:border-cyanline/25"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${agent.compute > 60 ? "bg-mint" : agent.compute > 35 ? "bg-amberline" : "bg-blood"}`} />
                          <Image className="pixel-icon h-5 w-5 shrink-0" src={roleIcons[agent.role]} alt="" width={28} height={28} />
                          <span className="truncate text-xs font-semibold text-white">{agent.name}</span>
                          {agent.isPlayer && <span className="shrink-0 rounded bg-cyanline/20 px-1 font-mono text-[9px] text-cyanline">YOU</span>}
                        </span>
                        <span className="shrink-0 font-mono text-[10px]" style={{ color: roleColors[agent.role] }}>
                          Lv{agent.level}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate pl-9 font-mono text-[10px] text-slate-500">{agent.mbti} · {agent.status.slice(0, 28)}</p>
                    </button>
                  ))}
                </div>
              </Panel>
                </>
              )}
            </aside>

            {/* ── Center: Map ── */}
            <section className={`${mobileTab === "map" ? "flex" : "hidden"} flex-col gap-2 md:flex xl:gap-3`}>
              <Panel
                title={gameMode === "game" ? "Player Society Space" : "Observer Society Space"}
                action={
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${isRunning ? "animate-pulse bg-mint" : "bg-slate-600"}`} />
                    <span className="font-mono text-[10px] uppercase text-slate-400">{isRunning ? "live" : "paused"}</span>
                  </div>
                }
              >
                <div className="map-grid relative h-[calc(100dvh-176px)] overflow-hidden rounded-lg border border-white/10 md:h-[calc(100dvh-132px)] md:min-h-[430px] lg:min-h-0 xl:h-[calc(100dvh-144px)] 2xl:max-h-[760px]">
                  {/* Pixel town map background */}
                  <Image
                    className="pixel-icon absolute inset-0 h-full w-full object-cover"
                    src="/assets/polis-pixel-town-map.png"
                    alt="Polis town map"
                    width={1600} height={900} priority
                  />

                  {/* Building signs */}
                  {BUILDINGS.map(b => (
                    <button
                      key={b.id}
                      className={`building-sign${selectedBuilding === b.id ? " active" : ""}`}
                      style={{ left: b.left, top: b.top }}
                      onClick={() => {
                        setSelectedBuilding(prev => prev === b.id ? null : b.id);
                        if (selectedBuilding !== b.id) {
                          setDailyPlanInput(language === "zh" ? b.prefillZh : b.prefillEn);
                        }
                      }}
                    >
                      {b.label}
                    </button>
                  ))}

                  {/* Building action panel */}
                  {selectedBuilding && (() => {
                    const bld = BUILDINGS.find(b => b.id === selectedBuilding)!;
                    return (
                      <div className="absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded-lg border border-white/25 bg-black/80 px-4 py-2.5 text-center shadow-lg backdrop-blur-sm">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-white/50">{bld.label}</p>
                        <p className="mt-0.5 text-xs text-white">{language === "zh" ? bld.prefillZh : bld.prefillEn}</p>
                        <p className="mt-1 font-mono text-[10px] text-cyanline">
                          {language === "zh" ? "↓ 已预填 Daily Plan 输入框" : "↓ Prefilled Daily Plan input"}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Agent sprites (moving) */}
                  {agents.map(agent => {
                    const motion = agentMotion[agent.id] ?? { x: agent.x, y: agent.y, action: "idle" as const };
                    const bubble = speechBubbles.find(b => b.agentId === agent.id);
                    return (
                      <button
                        key={`${agent.id}-sprite`}
                        onClick={() => setSelectedId(agent.id)}
                        className={`agent-sprite absolute -translate-x-1/2 -translate-y-full transition-[left,top] duration-700 ease-out ${gameMode === "game" && agent.isPlayer ? "z-40" : agent.id === selectedId ? "z-30 scale-125" : "z-20"}`}
                        style={{ left: `${motion.x}%`, top: `${motion.y}%` }}
                        title={agent.name}
                      >
                        {gameMode === "game" && agent.isPlayer && (
                          <span className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border border-cyanline/70 shadow-[0_0_24px_rgba(69,246,255,.55)]" />
                        )}
                        {gameMode === "game" && agent.isPlayer && (
                          <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded bg-cyanline/90 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-void">YOU</span>
                        )}
                        <Image
                          className="pixel-icon h-12 w-12 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,.8)]"
                          src={roleSprites[agent.role]} alt={agent.name} width={80} height={80}
                        />
                        <span className={`agent-bubble ${motion.action === "idle" ? "opacity-0" : "opacity-100"}`}>
                          {t.actions[motion.action]}
                        </span>
                        {bubble && (
                          <span className="speech-bubble absolute bottom-full left-1/2 mb-1 w-max max-w-[140px] -translate-x-1/2 rounded-lg border border-white/20 bg-void/90 px-2 py-1 font-mono text-[10px] leading-tight text-white shadow-lg">
                            {bubble.text}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {/* Agent name pins */}
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedId(agent.id)}
                      className={`absolute min-w-[80px] -translate-x-1/2 -translate-y-1/2 rounded border px-1.5 py-0.5 text-left transition ${
                        agent.id === selectedId ? "scale-110 border-white bg-white text-void" : "border-black/60 bg-black/70 text-white"
                      } ${gameMode === "game" && agent.isPlayer ? "border-cyanline bg-cyanline/20 text-cyanline" : ""}`}
                      style={{ left: `${agent.x}%`, top: `${agent.y}%`, zIndex: 22 }}
                    >
                      <span className="flex items-center gap-1">
                        <Image className="pixel-icon h-5 w-5 shrink-0" src={roleIcons[agent.role]} alt="" width={28} height={28} />
                        <span className="min-w-0">
                          <span className="block truncate text-[10px] font-black">{agent.name.split(" ")[0]}</span>
                          <span className="block font-mono text-[8px] uppercase opacity-70">{t.roles[agent.role]}</span>
                        </span>
                      </span>
                    </button>
                  ))}

                  {/* Event feed — left overlay */}
                  <div className="pointer-events-none absolute left-2 top-1/2 z-30 w-[168px] -translate-y-1/2 space-y-1 xl:w-[190px]">
                    {events.slice(0, 6).reverse().map(ev => {
                      const colors = EVENT_KIND_COLORS[ev.kind] ?? EVENT_KIND_COLORS.settlement;
                      return (
                        <div key={ev.id} className="rounded bg-black/60 px-2 py-1 backdrop-blur-sm">
                          <span className={`event-chip ${colors.chip}`}>{ev.kind.slice(0, 4).toUpperCase()}</span>
                          <span className={`font-mono text-[9px] leading-snug ${colors.text}`}>
                            {ev.text.slice(0, 42)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bottom unified chat bar */}
                  {playerAgent && gameMode === "game" && (
                    <div className="absolute bottom-0 left-0 right-0 z-40 flex items-center gap-2 border-t border-white/10 bg-black/75 px-3 py-2 backdrop-blur-sm">
                      <span className="shrink-0 font-mono text-[10px] text-slate-400">⌨</span>
                      <input
                        className="min-w-0 flex-1 rounded border border-white/15 bg-white/[0.06] px-3 py-1.5 font-mono text-xs text-white placeholder-slate-500 outline-none focus:border-cyanline/50 focus:bg-cyanline/5"
                        placeholder={
                          (playerAgent.promptTickets ?? 0) > 0
                            ? (language === "zh" ? `指令 ${playerAgent.name}（消耗票券）…` : `Prompt ${playerAgent.name} (uses ticket)…`)
                            : (language === "zh" ? `发送消息给 ${playerAgent.name}…` : `Message ${playerAgent.name}…`)
                        }
                        value={playerInput}
                        onChange={e => setPlayerInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && sendUnifiedMessage()}
                        disabled={isSending}
                      />
                      {(playerAgent.promptTickets ?? 0) > 0 && (
                        <span className="shrink-0 rounded border border-[#ff9a18]/50 bg-[#ff9a18]/10 px-2 py-1 font-mono text-[10px] font-bold text-[#ff9a18]">
                          🎟 ×{playerAgent.promptTickets}
                        </span>
                      )}
                      <button
                        onClick={sendUnifiedMessage}
                        disabled={!playerInput.trim() || isSending}
                        className="shrink-0 rounded border border-cyanline/50 bg-cyanline/10 px-3 py-1.5 font-mono text-[10px] uppercase text-cyanline hover:bg-cyanline/20 disabled:opacity-30"
                      >
                        {isSending ? "…" : (language === "zh" ? "发送" : "Send")}
                      </button>
                    </div>
                  )}
                </div>
              </Panel>

              {/* Relationships row (only in data mode) */}
              {gameMode === "data" && (
                <Panel title={t.relationships}>
                  <div className="grid grid-cols-2 gap-2 xl:gap-3">
                    {Object.entries(viewAgent.affinity).slice(0, 6).map(([id, val]) => {
                      const peer = agents.find(a => a.id === id);
                      return (
                        <div key={id}>
                          <div className="mb-1 flex justify-between font-mono text-[10px] text-slate-400">
                            <span>{peer?.name ?? id}</span>
                            <span>{val}/10 {t.trust}</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded bg-white/10">
                            <div className="h-full rounded bg-cyanline transition-all" style={{ width: `${val * 10}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}
            </section>

            {/* ── Right Panel ── */}
            <aside className={`${mobileTab === "chat" ? "flex" : "hidden"} flex-col gap-2 md:col-span-2 md:flex md:max-h-[280px] md:overflow-y-auto lg:col-span-1 lg:max-h-[calc(100dvh-110px)] lg:overflow-y-auto xl:max-h-[calc(100dvh-116px)] xl:gap-3`}>

              {/* Tab bar */}
              <div className="hud-panel flex overflow-hidden rounded-xl">
                {(gameMode === "game"
                  ? (["conversations", "economy", "events"] as RightTab[])
                  : (["network", "economy", "events", "leaderboard"] as RightTab[])
                ).map(tab => (
                  <button key={tab} onClick={() => setRightTab(tab)} className={`flex-1 py-2 font-mono text-[9px] uppercase tracking-wider transition xl:text-[10px] ${rightTab === tab ? "bg-cyanline/15 text-cyanline" : "text-slate-500 hover:text-slate-300"}`}>
                    {tab === "conversations" ? t.conversations : tab === "economy" ? t.economy : tab === "events" ? t.events : tab === "network" ? t.relationships : t.leaderboard}
                  </button>
                ))}
              </div>

              {/* Society Network */}
              {rightTab === "network" && (
                <RelationshipNetworkPanel
                  agents={agents}
                  playerAgent={playerAgent}
                  selectedId={selectedNetworkAgentId}
                  onSelect={setSelectedNetworkAgentId}
                  networkView={networkView}
                  setNetworkView={setNetworkView}
                  conversations={conversations}
                  t={t}
                />
              )}

              {/* Conversations */}
              {rightTab === "conversations" && (
                <Panel title={t.conversations}>
                  <div className="max-h-[calc(100dvh-230px)] space-y-1.5 overflow-auto pr-1 lg:max-h-[calc(100dvh-190px)]">
                    {displayedConversations.length === 0 && (
                      <p className="py-6 text-center font-mono text-xs text-slate-600">Waiting for agents to talk…</p>
                    )}
                    {displayedConversations.map(conv => {
                      const isPlayerConv = conv.agentIds.includes("player") || conv.agentIds[0] === "system";
                      return (
                        <div key={conv.id} className={`rounded-lg border p-2 ${isPlayerConv ? "border-cyanline/30 bg-cyanline/[0.05]" : "border-white/10 bg-white/[0.03]"}`}>
                          <div className="mb-1 flex justify-between font-mono text-[9px] uppercase text-slate-500">
                            <span>{conv.location}</span>
                            <span>{conv.time}</span>
                          </div>
                          {conv.lines.map((line, i) => {
                            const isPlayer = line.speaker === "You" || line.speaker === "System";
                            return (
                              <div key={i} className={`flex gap-2 text-[11px] leading-4 ${i > 0 ? "mt-1" : ""}`}>
                                <span className={`shrink-0 font-mono text-[10px] font-bold ${isPlayer ? "text-cyanline" : "text-amberline"}`}>{line.speaker}:</span>
                                <span className="text-slate-300">{line.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}

              {/* Economy */}
              {rightTab === "economy" && (
                <>
                  <Panel title={t.leaderboard}>
                    <div className="space-y-1">
                      {leaderboard.slice(0, 8).map((agent, i) => (
                        <div key={agent.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${agent.isPlayer ? "border-cyanline/40 bg-cyanline/5" : "border-white/10 bg-white/[0.03]"}`}>
                          <span className="w-4 shrink-0 font-mono text-[10px] text-slate-500">{i + 1}.</span>
                          <Image className="pixel-icon h-5 w-5 shrink-0" src={roleIcons[agent.role]} alt="" width={24} height={24} />
                          <span className="min-w-0 flex-1 truncate text-xs text-white">{agent.name}</span>
                          {agent.isPlayer && <span className="shrink-0 rounded bg-cyanline/20 px-1 font-mono text-[9px] text-cyanline">YOU</span>}
                          <span className="shrink-0 font-mono text-xs font-black text-amberline">{agentWealth(agent)}</span>
                        </div>
                      ))}
                    </div>
                  </Panel>

                  <Panel title={t.marketPrices}>
                    <div className="space-y-1.5">
                      {marketRows.map(row => (
                        <div key={row.good} className="grid grid-cols-[70px_1fr_45px_40px] items-center gap-2 xl:grid-cols-[82px_1fr_54px_48px]">
                          <span className="font-mono text-[10px] uppercase text-slate-400">{row.good}</span>
                          <div className="overflow-hidden rounded bg-white/10">
                            <div className="h-1.5 rounded bg-amberline transition-all" style={{ width: `${Math.min(100, (row.price / (row.initial * 2)) * 100)}%` }} />
                          </div>
                          <span className="text-right font-mono text-[10px] text-amberline">{row.price.toFixed(1)}</span>
                          <span className={`text-right font-mono text-[10px] ${row.change >= 0 ? "text-mint" : "text-blood"}`}>
                            {row.change >= 0 ? "+" : ""}{row.change.toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Metric label={t.giniCoeff} value={gini.toFixed(2)} valueClassName={gini < 0.3 ? "text-mint" : gini <= 0.5 ? "text-amberline" : "text-blood"} />
                      <Metric label={t.totalAgents} value={agents.length} />
                      <Metric label={t.avgWealth} value={Math.round(agents.reduce((s, a) => s + agentWealth(a), 0) / agents.length)} />
                      <Metric label={t.topEarner} value={leaderboard[0]?.name.split(" ")[0] ?? "—"} />
                    </div>
                    <div className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
                      <p className="mb-2 font-mono text-[10px] uppercase text-slate-500">{t.wealthDistribution}</p>
                      <div className="space-y-1.5">
                        {topScripAgents.map(agent => (
                          <div key={agent.id}>
                            <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] text-slate-400">
                              <span className="truncate">{agent.name}</span>
                              <span className="shrink-0 text-amberline">{agent.scrip}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded bg-white/10">
                              <div className="h-full rounded bg-amberline transition-all" style={{ width: `${Math.max(4, (agent.scrip / topScrip) * 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Panel>
                </>
              )}

              {/* Policy */}
              {false && (
                <Panel title={t.policyChamber}>
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <input
                        className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 font-mono text-xs text-white placeholder-slate-600 outline-none focus:border-cyanline/50 focus:bg-cyanline/5"
                        placeholder={t.policyPlaceholder}
                        value={policyInput}
                        onChange={e => setPolicyInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && issuePolicy()}
                      />
                      <button
                        onClick={issuePolicy}
                        disabled={!policyInput.trim() || policyOnCooldown}
                        className="shrink-0 rounded-lg border border-cyanline/50 bg-cyanline/10 px-3 py-2 font-mono text-[10px] uppercase text-cyanline hover:bg-cyanline/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {policyOnCooldown ? `${t.cooldown}: ${policyCooldownRemaining}s` : t.issueDirective}
                      </button>
                    </div>

                    <div>
                      <p className="mb-2 font-mono text-[10px] uppercase text-slate-500">{t.recentPolicies}</p>
                      <div className="space-y-2">
                        {issuedPolicies.length === 0 && (
                          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-center font-mono text-xs text-slate-600">{t.noPolicies}</p>
                        )}
                        {issuedPolicies.map(policy => (
                          <div key={policy.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                            <div className="mb-1 flex justify-between gap-2 font-mono text-[10px] uppercase text-slate-500">
                              <span className="truncate">{policy.time}</span>
                              <span className="text-cyanline">rule</span>
                            </div>
                            <p className="text-xs leading-5 text-white">{policy.text}</p>
                            <p className="mt-1 font-mono text-[10px] text-amberline">{policy.effect}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </Panel>
              )}

              {/* Events */}
              {rightTab === "events" && (
                <Panel title={t.worldEvents}>
                  <div className="max-h-[calc(100dvh-230px)] space-y-1.5 overflow-auto pr-1 lg:max-h-[calc(100dvh-190px)]">
                    {displayedEvents.map(ev => (
                      <div key={ev.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                        <div className="mb-1 flex justify-between font-mono text-[9px] uppercase text-slate-500">
                          <span>{ev.kind}</span>
                          <span>{ev.time}</span>
                        </div>
                        <p className="text-[11px] leading-4 text-slate-300">{ev.text}</p>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Leaderboard */}
              {rightTab === "leaderboard" && (
                <Panel title={t.leaderboard}>
                  <div className="space-y-1">
                    {leaderboard.map((agent, i) => (
                      <div key={agent.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${agent.isPlayer ? "border-cyanline/40 bg-cyanline/5" : "border-white/10 bg-white/[0.03]"}`}>
                        <span className="w-4 shrink-0 font-mono text-[10px] text-slate-500">{i + 1}.</span>
                        <Image className="pixel-icon h-5 w-5 shrink-0" src={roleIcons[agent.role]} alt="" width={24} height={24} />
                        <span className="min-w-0 flex-1 truncate text-xs text-white">{agent.name}</span>
                        {agent.isPlayer && <span className="shrink-0 rounded bg-cyanline/20 px-1 font-mono text-[9px] text-cyanline">YOU</span>}
                        <span className="shrink-0 font-mono text-xs font-black text-amberline">{agentWealth(agent)}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
            </aside>
          </div>
        </div>
        {pendingDecision && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl rounded-xl border border-cyanline/60 bg-void/95 p-5 font-mono shadow-[0_0_42px_rgba(69,246,255,.22)]">
              <div className="mb-4 border-b border-cyanline/20 pb-3">
                <p className="text-[10px] uppercase tracking-[0.3em] text-cyanline/70">{t.chooseAction}</p>
                <h2 className="mt-1 text-xl font-black uppercase text-white">
                  DECISION REQUIRED <span className="text-cyanline">/</span> 需要决策
                </h2>
              </div>

              <p className="rounded-lg border border-cyanline/25 bg-cyanline/[0.06] p-3 text-sm leading-6 text-slate-100">
                {pendingDecision.situation}
              </p>

              <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-wider">
                  <span className={`text-base font-black ${decisionTimerTone}`}>⏱ {decisionSecondsLeft}s</span>
                  <span className="text-right text-slate-400">
                    {language === "zh" ? "不作为将由智能体自行决策" : "Agent will act autonomously if ignored"}
                  </span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded bg-white/10">
                  <div
                    className={`h-full rounded transition-all duration-500 ${decisionTimerBar}`}
                    style={{ width: decisionProgressWidth }}
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {pendingDecision.options.map(option => (
                  <button
                    key={option.key}
                    onClick={() => applyDecisionChoice(pendingDecision, option.key)}
                    className="group rounded-lg border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-cyanline/60 hover:bg-cyanline/10"
                  >
                    <span className="flex items-start gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-cyanline/50 bg-cyanline/10 text-xs font-black text-cyanline">
                        {option.key}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-bold uppercase text-white group-hover:text-cyanline">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-amberline">{option.effect}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-cyanline/30 bg-cyanline/5 px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-cyanline/70 focus:bg-cyanline/10"
                  placeholder={t.customDirective}
                  value={decisionInput}
                  onChange={e => setDecisionInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && issueCustomDecision()}
                />
                <button
                  onClick={issueCustomDecision}
                  disabled={!decisionInput.trim()}
                  className="rounded-lg border border-cyanline/50 bg-cyanline/10 px-4 py-2 text-xs font-bold uppercase text-cyanline hover:bg-cyanline/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t.issueCustom}
                </button>
                <button
                  onClick={skipDecision}
                  className="rounded-lg border border-white/10 px-4 py-2 text-xs font-bold uppercase text-slate-400 hover:border-white/20 hover:text-slate-200"
                >
                  {t.skipDecision}
                </button>
              </div>
            </div>
          </div>
        )}
        <nav className="fixed bottom-0 left-0 z-50 grid h-14 w-full grid-cols-3 border-t border-white/10 bg-void md:hidden">
          {([
            ["agent", "🧑 Agent"],
            ["map", "🗺 Map"],
            ["chat", "💬 Chat"],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setMobileTab(tab)}
              className={`border-t-2 font-mono text-[10px] uppercase ${
                mobileTab === tab
                  ? "border-cyanline text-cyanline"
                  : "border-transparent text-slate-500"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </main>
    );
  }
}

// ─── Shared UI Components ────────────────────────────────────────────────────

function DecisionLogPanel({
  title,
  emptyText,
  autoText,
  history,
  open,
  onToggle
}: {
  title: string;
  emptyText: string;
  autoText: string;
  history: DecisionRecord[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="hud-panel rounded-xl p-2.5 xl:p-3">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-2 border-b border-white/10 pb-2 text-left">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-cyanline">{title}</h2>
        <span className="font-mono text-[10px] text-slate-500">{open ? "[-]" : "[+]"}</span>
      </button>
      {open && (
        <div className="mt-2 max-h-[240px] space-y-1.5 overflow-auto pr-1 xl:mt-3 xl:max-h-[340px] xl:space-y-2">
          {history.length === 0 && <p className="py-4 text-center font-mono text-xs text-slate-600">{emptyText}</p>}
          {history.slice(0, 10).map(record => (
            <div key={record.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[10px] uppercase text-slate-500">{record.time}</p>
                  <p className="truncate text-xs font-bold text-white">{record.choiceLabel}</p>
                </div>
                {record.autoResolved && (
                  <span className="shrink-0 rounded border border-blood/40 bg-blood/10 px-1.5 py-0.5 font-mono text-[9px] uppercase text-blood">{autoText}</span>
                )}
              </div>
              <p className="mb-2 line-clamp-2 text-[11px] leading-4 text-slate-400">{record.situation}</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(record.statDelta).map(([key, value]) => (
                  <DeltaChip key={key} label={key} value={value} />
                ))}
              </div>
              {record.affinityChanges.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {record.affinityChanges.map(change => (
                    <span key={`${record.id}-${change.agentName}`} className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${change.delta >= 0 ? "border-mint/30 bg-mint/10 text-mint" : "border-blood/30 bg-blood/10 text-blood"}`}>
                      {change.delta >= 0 ? "↑" : "↓"} {change.agentName.split(" ")[0]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeltaChip({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  const tone = value > 0
    ? "border-mint/30 bg-mint/10 text-mint"
    : "border-blood/30 bg-blood/10 text-blood";
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${tone}`}>
      {value > 0 ? "↑" : "↓"} {label}
    </span>
  );
}

function RelationshipNetworkPanel({
  agents,
  playerAgent,
  selectedId,
  onSelect,
  networkView,
  setNetworkView,
  conversations,
  t
}: {
  agents: Agent[];
  playerAgent: Agent | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  networkView: NetworkView;
  setNetworkView: (view: NetworkView) => void;
  conversations: Conversation[];
  t: CopyText;
}) {
  return (
    <Panel title={t.relationships} action={
      <div className="flex overflow-hidden rounded border border-white/10">
        <button onClick={() => setNetworkView("mine")} className={`px-2 py-1 font-mono text-[9px] uppercase ${networkView === "mine" ? "bg-cyanline/15 text-cyanline" : "text-slate-500"}`}>{t.myNetwork}</button>
        <button onClick={() => setNetworkView("society")} className={`px-2 py-1 font-mono text-[9px] uppercase ${networkView === "society" ? "bg-amberline/15 text-amberline" : "text-slate-500"}`}>{t.societyView}</button>
      </div>
    }>
      {networkView === "mine"
        ? <MyNetworkGraph agents={agents} playerAgent={playerAgent} selectedId={selectedId} onSelect={onSelect} conversations={conversations} t={t} />
        : <SocietyNetworkGraph agents={agents} playerAgent={playerAgent} t={t} />}
    </Panel>
  );
}

function MyNetworkGraph({
  agents,
  playerAgent,
  selectedId,
  onSelect,
  conversations,
  t
}: {
  agents: Agent[];
  playerAgent: Agent | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  conversations: Conversation[];
  t: CopyText;
}) {
  if (!playerAgent) {
    return <p className="py-8 text-center font-mono text-xs text-slate-600">Create an agent to inspect relationships.</p>;
  }

  const relations = Object.entries(playerAgent.affinity)
    .map(([id, affinity]) => ({ agent: agents.find(a => a.id === id), affinity }))
    .filter((item): item is { agent: Agent; affinity: number } => Boolean(item.agent) && item.affinity > 0)
    .sort((a, b) => b.affinity - a.affinity);
  const selected = relations.find(item => item.agent.id === selectedId) ?? relations[0];
  const topAllies = relations.slice(0, 3);
  const weakBonds = relations.filter(item => item.affinity >= 1 && item.affinity <= 3).length;
  const lastInteraction = (agentId: string) => conversations.find(conv =>
    conv.agentIds.includes(playerAgent.id) && conv.agentIds.includes(agentId)
  )?.time ?? "-";

  return (
    <div className="space-y-2 xl:space-y-3">
      <svg viewBox="0 0 400 320" width="100%" className="max-h-[240px] rounded-lg border border-cyanline/15 bg-cyanline/[0.03] xl:max-h-none">
        <defs>
          <filter id="networkGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="200" cy="150" r="34" fill="rgba(69,246,255,.14)" stroke="#45f6ff" strokeWidth="3" filter="url(#networkGlow)" />
        <text x="200" y="154" textAnchor="middle" className="fill-white text-[11px] font-bold">{playerAgent.name.split(" ")[0]}</text>
        <text x="200" y="170" textAnchor="middle" className="fill-cyanline text-[9px] uppercase">{t.roles[playerAgent.role]}</text>
        {relations.map((item, index) => {
          const angle = (index / Math.max(1, relations.length)) * Math.PI * 2 - Math.PI / 2;
          const x = 200 + Math.cos(angle) * 126;
          const y = 150 + Math.sin(angle) * 96;
          const edgeColor = item.affinity >= 7 ? "#79ffbf" : item.affinity >= 4 ? "#ffca63" : "#ff496d";
          const nodeRadius = 12 + item.affinity * 2;
          return (
            <g key={item.agent.id}>
              <line x1="200" y1="150" x2={x} y2={y} stroke={edgeColor} strokeWidth={(item.affinity / 10) * 4} opacity="0.75" />
              <g onClick={() => onSelect(item.agent.id)} className="cursor-pointer">
                <circle cx={x} cy={y} r={nodeRadius} fill={`${roleColors[item.agent.role]}33`} stroke={selectedId === item.agent.id ? "#ffffff" : roleColors[item.agent.role]} strokeWidth={selectedId === item.agent.id ? 3 : 2} />
                <text x={x} y={y + nodeRadius + 13} textAnchor="middle" className="fill-white text-[10px] font-bold">{item.agent.name.split(" ")[0]}</text>
              </g>
            </g>
          );
        })}
      </svg>
      {selected && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-white">{selected.agent.name}</span>
            <span className="font-mono text-[10px]" style={{ color: roleColors[selected.agent.role] }}>{t.roles[selected.agent.role]}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Metric label={t.trust} value={selected.affinity.toFixed(1)} valueClassName={selected.affinity >= 7 ? "text-mint" : selected.affinity >= 4 ? "text-amberline" : "text-blood"} />
            <Metric label={t.lastInteraction} value={lastInteraction(selected.agent.id)} />
          </div>
        </div>
      )}
      <div className="space-y-1.5 xl:space-y-2">
        {topAllies.map(item => (
          <div key={item.agent.id}>
            <div className="mb-1 flex justify-between font-mono text-[10px] text-slate-400">
              <span>{item.agent.name}</span>
              <span>{item.affinity.toFixed(1)}/10</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-white/10">
              <div className="h-full rounded bg-mint" style={{ width: `${item.affinity * 10}%` }} />
            </div>
          </div>
        ))}
      </div>
      <Metric label={t.weakBonds} value={weakBonds} valueClassName={weakBonds > 0 ? "text-blood" : "text-mint"} />
    </div>
  );
}

function SocietyNetworkGraph({ agents, playerAgent, t }: { agents: Agent[]; playerAgent: Agent | null; t: CopyText }) {
  const positions = agents.map((agent, index) => {
    const angle = (index / Math.max(1, agents.length)) * Math.PI * 2 - Math.PI / 2;
    return { agent, x: 200 + Math.cos(angle) * 135, y: 142 + Math.sin(angle) * 100 };
  });
  const edges: Array<{ source: Agent; target: Agent; affinity: number }> = [];
  const seen = new Set<string>();
  for (const agent of agents) {
    for (const [targetId, affinity] of Object.entries(agent.affinity)) {
      if (affinity < 3) continue;
      const target = agents.find(a => a.id === targetId);
      if (!target) continue;
      const key = [agent.id, target.id].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      const reciprocal = target.affinity[agent.id] ?? affinity;
      edges.push({ source: agent, target, affinity: (affinity + reciprocal) / 2 });
    }
  }
  const totals = agents.map(agent => ({
    agent,
    total: Object.values(agent.affinity).reduce((sum, value) => sum + value, 0)
  })).sort((a, b) => b.total - a.total);
  const avgAffinity = edges.length ? edges.reduce((sum, edge) => sum + edge.affinity, 0) / edges.length : 0;
  const activeBonds = edges.filter(edge => edge.affinity >= 5).length;

  return (
    <div className="space-y-2 xl:space-y-3">
      <svg viewBox="0 0 400 320" width="100%" className="max-h-[240px] rounded-lg border border-cyanline/15 bg-cyanline/[0.03] xl:max-h-none">
        {edges.map(edge => {
          const source = positions.find(pos => pos.agent.id === edge.source.id);
          const target = positions.find(pos => pos.agent.id === edge.target.id);
          if (!source || !target) return null;
          return (
            <line key={`${edge.source.id}-${edge.target.id}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
              stroke={edge.affinity >= 7 ? "#79ffbf" : edge.affinity >= 4 ? "#ffca63" : "#ff496d"}
              strokeWidth={1 + (edge.affinity / 10) * 3}
              opacity={edge.affinity / 10}
            />
          );
        })}
        {positions.map(pos => (
          <g key={pos.agent.id}>
            <circle cx={pos.x} cy={pos.y} r="18" fill={`${roleColors[pos.agent.role]}33`} stroke={pos.agent.id === playerAgent?.id ? "#45f6ff" : roleColors[pos.agent.role]} strokeWidth={pos.agent.id === playerAgent?.id ? 3 : 2} />
            <text x={pos.x} y={pos.y + 31} textAnchor="middle" className="fill-white text-[10px] font-bold">{pos.agent.name.split(" ")[0]}</text>
          </g>
        ))}
      </svg>
      <div className="grid grid-cols-2 gap-2">
        <Metric label={t.activeBonds} value={activeBonds} valueClassName="text-mint" />
        <Metric label={t.avgAffinity} value={avgAffinity.toFixed(1)} valueClassName="text-cyanline" />
        <Metric label={t.socialHub} value={totals[0]?.agent.name.split(" ")[0] ?? "-"} valueClassName="text-amberline" />
        <Metric label={t.loner} value={totals[totals.length - 1]?.agent.name.split(" ")[0] ?? "-"} valueClassName="text-blood" />
      </div>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="hud-panel rounded-xl p-2.5 xl:p-3">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/10 pb-2 xl:mb-3">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-cyanline xl:text-[11px]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Bars({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-1.5">
      <StatusBar label="Scrip"  value={agent.scrip}      max={200} color="#ffca63" />
      <StatusBar label="Rep"    value={agent.reputation}  max={100} color="#79ffbf" />
      <StatusBar label="CPU"    value={agent.compute}     max={120} color="#45f6ff" />
      <div className="grid grid-cols-3 gap-1.5 pt-1 xl:gap-2">
        <StatusBar label="HP"     value={agent.health ?? 0}  max={100} color="#ff5c7a" />
        <StatusBar label="Energy" value={agent.energy ?? 0}  max={100} color="#a78bfa" />
        <StatusBar label="Food"   value={agent.satiety ?? 0} max={100} color="#79ffbf" />
      </div>
    </div>
  );
}

function StatusBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between font-mono text-[9px] uppercase text-slate-500 xl:text-[10px]">
        <span>{label}</span><span>{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-white/10">
        <div className="h-full rounded transition-all" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "cyan" | "amber" | "mint" | "rose" }) {
  const tones = {
    cyan:  "text-cyanline  border-cyanline/30  bg-cyanline/10",
    amber: "text-amberline border-amberline/30 bg-amberline/10",
    mint:  "text-mint      border-mint/30      bg-mint/10",
    rose:  "text-blood     border-blood/30     bg-blood/10"
  };
  return (
    <div className={`rounded-lg border px-2.5 py-1 ${tones[tone]}`}>
      <p className="font-mono text-[9px] uppercase text-slate-400">{label}</p>
      <p className="font-mono text-base font-black leading-none">{value}</p>
    </div>
  );
}

function Metric({ label, value, valueClassName = "text-white" }: { label: string; value: number | string; valueClassName?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 xl:p-2">
      <p className="font-mono text-[9px] uppercase text-slate-500 xl:text-[10px]">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-xs font-black xl:text-sm ${valueClassName}`}>{value}</p>
    </div>
  );
}
