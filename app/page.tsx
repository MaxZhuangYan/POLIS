"use client";

import Image from "next/image";
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
type RightTab = "conversations" | "economy" | "policy" | "events";
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
    scrip: "Scrip",
    reputation: "Rep",
    compute: "Compute",
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
    scrip: "工票",
    reputation: "声望",
    compute: "算力",
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

function normalizeAgent(a: Agent): Agent {
  return {
    ...a,
    level: a.level ?? Math.max(1, Math.round(a.reputation / 12)),
    specialization: a.specialization ?? `${a.role} Operations`,
    traits: a.traits ?? ["legacy", "stable"],
    currentMission: a.currentMission ?? a.status,
    mbti: a.mbti ?? "ISTP",
    planFocus: a.planFocus,
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
  const [decisionInput,  setDecisionInput]  = useState("");
  const [dailyPlanInput, setDailyPlanInput] = useState("");

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

  useEffect(() => { agentsRef.current = agents; }, [agents]);
  useEffect(() => { epochRef.current = epoch; }, [epoch]);
  useEffect(() => { languageRef.current = language; }, [language]);
  useEffect(() => { missionProgressRef.current = missionProgress; }, [missionProgress]);
  useEffect(() => { pendingDecisionRef.current = pendingDecision; }, [pendingDecision]);
  useEffect(() => { playerAgentIdRef.current = playerAgentId; }, [playerAgentId]);

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
        missionProgress?: Record<string, number>; dailyPlanInput?: string;
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
      if (typeof s.dailyPlanInput === "string") setDailyPlanInput(s.dailyPlanInput);
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
    setPendingDecision(null);
    setDecisionInput("");
  }, [isRunning]);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_KEY, JSON.stringify({ agentId: playerAgentId, phase }));
  }, [playerAgentId, phase]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      agents, events, epoch, settlement, selectedId, conversations, marketPrices, missionProgress, dailyPlanInput
    }));
  }, [agents, events, epoch, settlement, selectedId, conversations, marketPrices, missionProgress, dailyPlanInput]);

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
        latestMotion[agent.id] = {
          x: clamp(m.x + (Math.random() - 0.5) * 5, 10, 86),
          y: clamp(m.y + (Math.random() - 0.5) * 4, 16, 78),
          action: plannedAction && Math.random() > 0.22 ? plannedAction : actions[Math.floor(Math.random() * actions.length)]
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
          const gain = (value: number) => value > 0 && agent.isPlayer ? Math.ceil(value * 1.2) : value;

          return {
            ...agent,
            scrip: clamp(agent.scrip + gain(delta.scrip), 0, 500),
            reputation: clamp(agent.reputation + gain(delta.reputation), 0, 100),
            compute: clamp(agent.compute + gain(delta.compute), 0, 150)
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
      if (prompt) setPendingDecision(prompt);
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
    const pickTwoAgents = () => {
      const first = pickAgent();
      const candidates = nonPlayerAgents.filter(a => a.id !== first.id);
      const second = candidates[Math.floor(Math.random() * candidates.length)] ?? player;
      return [first, second] as const;
    };

    const agent = pickAgent();
    const [allyA, allyB] = pickTwoAgents();
    const highRiskReward = 10 + Math.floor(Math.random() * 11);
    const scripAsk = 12 + Math.floor(Math.random() * 29);
    const zh = languageRef.current === "zh";
    const bank: DecisionPrompt[] = [
      {
        id: `decision-contract-${Date.now()}`,
        situation: zh
          ? `${agent.name} 申请重新谈判合约。工票：${scripAsk}。`
          : `${agent.name} requests to renegotiate contract. Scrip: ${scripAsk}.`,
        triggeredBy: `contract|${agent.id}|${scripAsk}`,
        options: [
          { key: "A", label: zh ? "批准" : "Approve",      effect: zh ? `${agent.name} 声望+10，${player.name} 工票-5` : `${agent.name} +10 rep, ${player.name} -5 scrip` },
          { key: "B", label: zh ? "拒绝" : "Reject",       effect: zh ? `${player.name} 声望+2` : `${player.name} +2 rep` },
          { key: "C", label: zh ? "还价" : "CounterOffer", effect: zh ? `${agent.name} 工票+5，${player.name} 声望+3` : `${agent.name} +5 scrip, ${player.name} +3 rep` }
        ]
      },
      {
        id: `decision-market-${Date.now()}`,
        situation: zh
          ? "市场环算力供过于求，价格下跌。"
          : "MARKET RING oversupplied with compute. Prices falling.",
        triggeredBy: "market",
        options: [
          { key: "A", label: zh ? "稳定价格" : "Stabilize",  effect: zh ? "重置算力价格" : "Reset compute price" },
          { key: "B", label: zh ? "顺势而为" : "LetFall",    effect: zh ? "全体算力 -20%" : "All compute -20%" },
          { key: "C", label: zh ? "收购剩余" : "BuySurplus", effect: zh ? `${player.name} 工票-10，算力+15` : `${player.name} -10 scrip, +15 compute` }
        ]
      },
      {
        id: `decision-alliance-${Date.now()}`,
        situation: zh
          ? `${allyA.name} 希望与 ${allyB.name} 结盟。`
          : `${allyA.name} wants alliance with ${allyB.name}.`,
        triggeredBy: `alliance|${allyA.id}|${allyB.id}`,
        options: [
          { key: "A", label: zh ? "背书" : "Endorse", effect: zh ? "双方声望+3" : "Both +3 rep" },
          { key: "B", label: zh ? "阻止" : "Block",   effect: zh ? "无变化" : "No change" },
          { key: "C", label: zh ? "调解" : "Mediate", effect: zh ? `双方声望+1，${player.name} 声望+5` : `Both +1 rep, ${player.name} +5 rep` }
        ]
      },
      {
        id: `decision-dividends-${Date.now()}`,
        situation: zh ? "纪元结束，如何分配红利？" : "Epoch close. Distribute dividends?",
        triggeredBy: "dividends",
        options: [
          { key: "A", label: zh ? "平均分配" : "EqualSplit",  effect: zh ? "全体工票+8" : "All +8 scrip" },
          { key: "B", label: zh ? "绩效优先" : "MeritBased",  effect: zh ? "前3名工票+20" : "Top 3 +20 scrip" },
          { key: "C", label: zh ? "再投资" : "Reinvest",      effect: zh ? "全体算力+5" : "All +5 compute" }
        ]
      },
      {
        id: `decision-risk-${Date.now()}`,
        situation: zh ? "高风险合约到来，指派给哪个角色？" : "High-risk contract arrived. Assign role?",
        triggeredBy: `risk|${highRiskReward}`,
        options: [
          { key: "A", label: zh ? "建筑师" : "Architect",    effect: zh ? `${player.name} 工票+20` : `${player.name} +20 scrip` },
          { key: "B", label: zh ? "中间商" : "Broker",       effect: zh ? `${player.name} 工票+15` : `${player.name} +15 scrip` },
          { key: "C", label: zh ? "公开招标" : "OpenTender", effect: zh ? `随机智能体工票+10~${highRiskReward}` : `Random agent +10-${highRiskReward} scrip` }
        ]
      },
      {
        id: `decision-morale-${Date.now()}`,
        situation: zh
          ? `${agent.name} 报告士气低落。状态：${agent.status}。`
          : `${agent.name} reports low morale. Status: ${agent.status}.`,
        triggeredBy: `morale|${agent.id}`,
        options: [
          { key: "A", label: zh ? "准许休息" : "GrantRest", effect: zh ? `${agent.name} 算力+10，进入休闲状态` : `${agent.name} +10 compute, set idle 2 ticks` },
          { key: "B", label: zh ? "重新分配" : "Reassign",  effect: zh ? `${agent.name} 声望+5` : `${agent.name} +5 rep` },
          { key: "C", label: zh ? "忽略" : "Ignore",        effect: zh ? "无变化" : "No change" }
        ]
      },
      {
        id: `decision-cap-${Date.now()}`,
        situation: zh ? "议会提议：将个人工票上限设为 300。" : "Assembly proposes scrip cap at 300.",
        triggeredBy: "cap",
        options: [
          { key: "A", label: zh ? "批准" : "Approve", effect: zh ? "所有人工票上限 300" : "Cap all scrip at 300" },
          { key: "B", label: zh ? "否决" : "Reject",  effect: zh ? "无变化" : "No change" },
          { key: "C", label: zh ? "修正" : "Amend",   effect: zh ? "所有人工票上限 400" : "Cap all scrip at 400" }
        ]
      },
      {
        id: `decision-cache-${Date.now()}`,
        situation: zh
          ? `${agent.name} 在外围网格发现资源缓存。`
          : `${agent.name} found resource cache in OUTER GRID.`,
        triggeredBy: `cache|${agent.id}`,
        options: [
          { key: "A", label: zh ? "占有" : "Claim",   effect: zh ? `${player.name} 工票+20` : `${player.name} +20 scrip` },
          { key: "B", label: zh ? "共享" : "Share",   effect: zh ? "全体工票+8" : "All +8 scrip" },
          { key: "C", label: zh ? "存档" : "Archive", effect: zh ? `${player.name} 声望+10` : `${player.name} +10 rep` }
        ]
      }
    ];

    return bank[Math.floor(Math.random() * bank.length)];
  }

  function applyDecisionChoice(prompt: DecisionPrompt, key: "A" | "B" | "C") {
    const option = prompt.options.find(o => o.key === key);
    if (!option) return;

    const [kind, firstId, secondId] = (prompt.triggeredBy ?? "").split("|");
    const playerId = playerAgentIdRef.current;

    setAgents(prev => {
      let next = [...prev];
      const player = next.find(a => a.id === playerId) ?? next.find(a => a.isPlayer);
      const playerAgentId = player?.id;

      const updateAgent = (id: string | undefined, patch: (agent: Agent) => Agent) => {
        if (!id) return;
        next = next.map(agent => agent.id === id ? patch(agent) : agent);
      };
      const updatePlayer = (patch: (agent: Agent) => Agent) => {
        if (playerAgentId) updateAgent(playerAgentId, patch);
      };

      if (kind === "contract") {
        if (key === "A") {
          updateAgent(firstId, agent => ({ ...agent, reputation: clamp(agent.reputation + 10, 0, 100) }));
          updatePlayer(agent => ({ ...agent, scrip: clamp(agent.scrip - 5, 0, 500) }));
        } else if (key === "B") {
          updatePlayer(agent => ({ ...agent, reputation: clamp(agent.reputation + 2, 0, 100) }));
        } else {
          updateAgent(firstId, agent => ({ ...agent, scrip: clamp(agent.scrip + 5, 0, 500) }));
          updatePlayer(agent => ({ ...agent, reputation: clamp(agent.reputation + 3, 0, 100) }));
        }
      } else if (kind === "market") {
        if (key === "A") {
          setMarketPrices(cur => ({ ...cur, compute: INITIAL_MARKET.compute }));
        } else if (key === "B") {
          next = next.map(agent => ({ ...agent, compute: clamp(Math.floor(agent.compute * 0.8), 0, 150) }));
        } else {
          updatePlayer(agent => ({
            ...agent,
            scrip: clamp(agent.scrip - 10, 0, 500),
            compute: clamp(agent.compute + 15, 0, 150)
          }));
        }
      } else if (kind === "alliance") {
        if (key === "A") {
          updateAgent(firstId, agent => ({ ...agent, reputation: clamp(agent.reputation + 3, 0, 100) }));
          updateAgent(secondId, agent => ({ ...agent, reputation: clamp(agent.reputation + 3, 0, 100) }));
        } else if (key === "C") {
          updateAgent(firstId, agent => ({ ...agent, reputation: clamp(agent.reputation + 1, 0, 100) }));
          updateAgent(secondId, agent => ({ ...agent, reputation: clamp(agent.reputation + 1, 0, 100) }));
          updatePlayer(agent => ({ ...agent, reputation: clamp(agent.reputation + 5, 0, 100) }));
        }
      } else if (kind === "dividends") {
        if (key === "A") {
          next = next.map(agent => ({ ...agent, scrip: clamp(agent.scrip + 8, 0, 500) }));
        } else if (key === "B") {
          const topIds = [...next].sort((a, b) => b.scrip - a.scrip).slice(0, 3).map(agent => agent.id);
          next = next.map(agent => topIds.includes(agent.id) ? { ...agent, scrip: clamp(agent.scrip + 20, 0, 500) } : agent);
        } else {
          next = next.map(agent => ({ ...agent, compute: clamp(agent.compute + 5, 0, 150) }));
        }
      } else if (kind === "risk") {
        if (key === "A") {
          updatePlayer(agent => ({ ...agent, scrip: clamp(agent.scrip + 20, 0, 500) }));
        } else if (key === "B") {
          updatePlayer(agent => ({ ...agent, scrip: clamp(agent.scrip + 15, 0, 500) }));
        } else {
          const candidates = next.filter(agent => !agent.isPlayer);
          const target = candidates[Math.floor(Math.random() * candidates.length)] ?? next[0];
          const reward = 10 + Math.floor(Math.random() * 11);
          updateAgent(target?.id, agent => ({ ...agent, scrip: clamp(agent.scrip + reward, 0, 500) }));
        }
      } else if (kind === "morale") {
        if (key === "A") {
          updateAgent(firstId, agent => ({
            ...agent,
            compute: clamp(agent.compute + 10, 0, 150),
            status: "Resting by Governor order",
            currentMission: "Idle recovery cycle"
          }));
          setAgentMotion(cur => {
            const existing = cur[firstId] ?? next.find(agent => agent.id === firstId);
            if (!firstId || !existing) return cur;
            const nextMotion = { ...cur, [firstId]: { x: existing.x, y: existing.y, action: "idle" as const } };
            agentMotionRef.current = nextMotion;
            return nextMotion;
          });
        } else if (key === "B") {
          updateAgent(firstId, agent => ({ ...agent, reputation: clamp(agent.reputation + 5, 0, 100) }));
        }
      } else if (kind === "cap") {
        if (key === "A") {
          next = next.map(agent => ({ ...agent, scrip: Math.min(agent.scrip, 300) }));
        } else if (key === "C") {
          next = next.map(agent => ({ ...agent, scrip: Math.min(agent.scrip, 400) }));
        }
      } else if (kind === "cache") {
        if (key === "A") {
          updatePlayer(agent => ({ ...agent, scrip: clamp(agent.scrip + 20, 0, 500) }));
        } else if (key === "B") {
          next = next.map(agent => ({ ...agent, scrip: clamp(agent.scrip + 8, 0, 500) }));
        } else {
          updatePlayer(agent => ({ ...agent, reputation: clamp(agent.reputation + 10, 0, 100) }));
        }
      }

      agentsRef.current = next;
      return next;
    });

    setEvents(cur => [{
      id: `decision-event-${Date.now()}`,
      time: nowTime(epochRef.current),
      kind: "rule" as const,
      text: `Player decision: ${option.label}. ${option.effect}`
    }, ...cur].slice(0, 12));
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
    setPendingDecision(null);
    setDecisionInput("");
  }

  function skipDecision() {
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

    // Update affinity
    if (result.affinityDelta) {
      setAgents(cur => cur.map(a => {
        if (a.id === agentA.id) return { ...a, affinity: { ...a.affinity, [agentB.id]: clamp((a.affinity[agentB.id] ?? 4) + result.affinityDelta, 1, 10) } };
        if (a.id === agentB.id) return { ...a, affinity: { ...a.affinity, [agentA.id]: clamp((a.affinity[agentA.id] ?? 4) + result.affinityDelta, 1, 10) } };
        return a;
      }));
    }

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
      effect = language === "zh" ? `向非玩家征收 ${collected} 工票` : `Collected ${collected} scrip from non-player agents`;
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
      effect = language === "zh" ? `${t.roles[mentionedRole]} +10 工票` : `${mentionedRole} agents gain +10 scrip`;
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
      affinity: {},
      isPlayer: true,
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
        reputation: agent.isPlayer ? clamp(agent.reputation + 5, 0, 100) : agent.reputation
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
    setPendingDecision(null);
    setDecisionInput("");
    setDailyPlanInput("");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (phase === "create") {
    return CreateScreen();
  }

  return GameScreen();

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
        </div>
      </main>
    );
  }

  // ── Game Screen ───────────────────────────────────────────────────────────
  function GameScreen() {
    const viewAgent = gameMode === "game" ? (playerAgent ?? selectedAgent) : selectedAgent;
    const planLocked = Boolean(playerAgent && playerAgent.dailyPlanDay === epoch);

    return (
      <main className="scanlines min-h-screen bg-void text-slate-100">
        <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(69,246,255,.18),transparent_34%),linear-gradient(180deg,rgba(5,7,19,.3),#050713_82%)]" />
        <div className="relative mx-auto flex min-h-screen w-full max-w-[1900px] flex-col gap-3 p-3 pb-16 md:pb-0">

          {/* ── Header ── */}
          <header className="hud-panel flex flex-wrap items-center justify-between gap-3 rounded-xl px-5 py-3">
            <div className="flex items-center gap-4">
              <div>
                <p className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-cyanline/70 md:block">{t.subtitle}</p>
                <h1 className="font-display text-2xl font-black uppercase text-white sm:text-3xl">POLIS</h1>
              </div>
              {playerAgent && (
                <div className="hidden items-center gap-2 rounded-lg border border-cyanline/30 bg-cyanline/5 px-3 py-2 md:flex">
                  <Image className="pixel-icon h-6 w-6" src={roleIcons[playerAgent.role]} alt="" width={32} height={32} />
                  <span className="font-mono text-xs text-cyanline">{playerAgent.name}</span>
                  <span className="rounded bg-cyanline/20 px-1.5 py-0.5 font-mono text-[10px] text-cyanline">YOU</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Stat label={t.epoch}      value={epoch.toString()}                  tone="cyan"  />
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
                <button onClick={() => setGameMode("game")} className={`px-3 py-2 font-mono text-[10px] uppercase transition ${gameMode === "game" ? "bg-cyanline/20 text-cyanline" : "text-slate-500 hover:text-slate-300"}`}>{t.gameMode}</button>
                <button onClick={() => setGameMode("data")} className={`px-3 py-2 font-mono text-[10px] uppercase transition ${gameMode === "data" ? "bg-amberline/20 text-amberline" : "text-slate-500 hover:text-slate-300"}`}>{t.dataMode}</button>
              </div>

              <button className="hud-button" onClick={() => setIsRunning(v => !v)}>{isRunning ? t.pause : t.run}</button>
              <button className="hud-button hidden md:block" onClick={settleEpoch}>{t.settlement}</button>
              <button onClick={() => setLanguage(l => l === "en" ? "zh" : "en")} className="rounded-md border border-white/10 px-3 py-2 font-mono text-[10px] uppercase text-slate-400 hover:text-slate-200">{t.language}</button>
              <div ref={lmSettingsRef} className="relative hidden md:block">
                <button
                  onClick={() => setShowLmSettings(v => !v)}
                  className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-[10px] uppercase text-slate-300 hover:border-cyanline/30 hover:text-white"
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
              <button onClick={resetGame} className="hidden rounded-md border border-blood/30 bg-blood/5 px-3 py-2 font-mono text-[10px] uppercase text-blood hover:bg-blood/10 md:block">{t.reset}</button>
            </div>
          </header>

          {/* ── Body ── */}
          <div className="flex flex-1 flex-col gap-3 md:grid md:grid-cols-[280px_1fr] xl:grid xl:grid-cols-[300px_1fr_340px]">

            {/* ── Left Panel ── */}
            <aside className={`${mobileTab === "agent" ? "flex" : "hidden"} flex-col gap-3 md:flex`}>

              {/* Your Agent Card */}
              <Panel title={t.yourAgent} action={
                <span className="rounded bg-cyanline/20 px-2 py-0.5 font-mono text-[10px] uppercase text-cyanline">YOU</span>
              }>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="pixel-block relative grid h-16 w-16 shrink-0 place-items-center border border-cyanline/40 bg-cyanline/10 p-1">
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
                      <p className="text-xs leading-5 text-cyanline">{viewAgent.thoughts}</p>
                    </div>
                  )}

                  <div className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <p className="font-mono text-[10px] uppercase text-slate-500">{t.currentMission}</p>
                    <p className="mt-1 text-xs text-amberline">{viewAgent.currentMission}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{viewAgent.status}</p>
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

              {/* Player Chat */}
              {playerAgent && (
                <Panel title={`→ ${playerAgent.name}`}>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2 font-mono text-xs text-white placeholder-slate-600 outline-none focus:border-cyanline/50 focus:bg-cyanline/5"
                      placeholder={t.sendMessage}
                      value={playerInput}
                      onChange={e => setPlayerInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && sendPlayerMessage()}
                      disabled={isSending}
                    />
                    <button
                      onClick={sendPlayerMessage}
                      disabled={!playerInput.trim() || isSending}
                      className="shrink-0 rounded-lg border border-cyanline/50 bg-cyanline/10 px-3 py-2 font-mono text-xs text-cyanline hover:bg-cyanline/20 disabled:opacity-30"
                    >
                      {isSending ? "..." : t.send}
                    </button>
                  </div>
                </Panel>
              )}

              {/* Roster */}
              <Panel title={t.roster} action={<button className="hud-button" onClick={createRandomAgent}>{t.addAgent}</button>}>
                <div className="max-h-[340px] space-y-1.5 overflow-auto pr-1">
                  {agents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => setSelectedId(agent.id)}
                      className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
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
            </aside>

            {/* ── Center: Map ── */}
            <section className={`${mobileTab === "map" ? "flex" : "hidden"} flex-col gap-3 md:flex`}>
              <Panel
                title={gameMode === "game" ? "Society Space" : "Data Observatory"}
                action={
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${isRunning ? "animate-pulse bg-mint" : "bg-slate-600"}`} />
                    <span className="font-mono text-[10px] uppercase text-slate-400">{isRunning ? "live" : "paused"}</span>
                  </div>
                }
              >
                <div className="map-grid relative h-[calc(100dvh-180px)] overflow-hidden rounded-lg border border-cyanline/15 md:h-[420px] xl:h-[580px]">
                  <Image
                    className="pixel-icon absolute inset-0 h-full w-full object-cover opacity-80 saturate-[.92]"
                    src="/assets/polis-pixel-town-map.png"
                    alt="Polis town map"
                    width={1600} height={900} priority
                  />
                  <div className="absolute inset-0 bg-void/20" />

                  {/* Relationship lines */}
                  <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {agents.flatMap(agent =>
                      Object.entries(agent.affinity).map(([tid, val]) => {
                        const target = agents.find(a => a.id === tid);
                        if (!target) return null;
                        const color = val >= 7 ? "rgba(121,255,191,.34)" : val <= 4 ? "rgba(255,73,109,.32)" : "rgba(69,246,255,.22)";
                        return (
                          <line key={`${agent.id}-${tid}`}
                            x1={agent.x} y1={agent.y} x2={target.x} y2={target.y}
                            stroke={color} strokeWidth={val >= 7 ? "0.36" : "0.25"}
                            strokeDasharray={val <= 4 ? "1.4 1.2" : val >= 7 ? "0" : "2 1.4"} />
                        );
                      })
                    )}
                    {/* Player agent mission line */}
                    {playerAgent && activeMission && (
                      <line x1={agentMotion[playerAgent.id]?.x ?? playerAgent.x} y1={agentMotion[playerAgent.id]?.y ?? playerAgent.y}
                        x2={activeMission.x} y2={activeMission.y}
                        stroke="rgba(255,202,99,.6)" strokeWidth="0.4" strokeDasharray="2 1.4" />
                    )}
                  </svg>

                  {/* Zone overlays */}
                  <div className="absolute left-[8%] top-[10%] h-[26%] w-[31%] border border-cyanline/20 bg-cyanline/[0.04]" />
                  <div className="absolute bottom-[11%] left-[15%] h-[21%] w-[28%] border border-amberline/20 bg-amberline/[0.05]" />
                  <div className="absolute right-[9%] top-[18%] h-[55%] w-[25%] border border-mint/20 bg-mint/[0.04]" />
                  <div className="absolute right-[17%] bottom-[11%] h-[18%] w-[25%] border border-blood/20 bg-blood/[0.04]" />

                  {/* Zone labels */}
                  {zoneLabels.map(z => (
                    <span key={z.name} className="absolute flex items-center gap-1 rounded border border-white/10 bg-black/45 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-300" style={{ left: z.x, top: z.y }}>
                      <Image className="pixel-icon h-4 w-4" src={zoneIcons[z.name]} alt="" width={24} height={24} />
                      {z.name}
                    </span>
                  ))}

                  {/* Mission markers */}
                  {missions.map(m => (
                    <div key={m.id}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded border border-amberline/50 bg-black/70 px-2 py-1 font-mono text-[10px] uppercase text-amberline/80"
                      style={{ left: `${m.x}%`, top: `${m.y}%` }}
                    >
                      <Image className="pixel-icon mr-1 inline-block h-4 w-4 align-middle" src="/assets/polis-icons/mission.png" alt="" width={24} height={24} />
                      {m.sector}
                    </div>
                  ))}

                  {/* Agent sprites (moving) */}
                  {agents.map(agent => {
                    const motion = agentMotion[agent.id] ?? { x: agent.x, y: agent.y, action: "idle" as const };
                    const bubble = speechBubbles.find(b => b.agentId === agent.id);
                    return (
                      <button
                        key={`${agent.id}-sprite`}
                        onClick={() => setSelectedId(agent.id)}
                        className={`agent-sprite absolute -translate-x-1/2 -translate-y-full transition-[left,top] duration-700 ease-out ${agent.isPlayer ? "z-40" : agent.id === selectedId ? "z-30 scale-125" : "z-20"}`}
                        style={{ left: `${motion.x}%`, top: `${motion.y}%` }}
                        title={agent.name}
                      >
                        {agent.isPlayer && (
                          <span className="absolute -top-4 left-1/2 -translate-x-1/2 rounded bg-cyanline/90 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-void">YOU</span>
                        )}
                        <Image
                          className="pixel-icon h-12 w-12 object-contain drop-shadow-[0_6px_5px_rgba(0,0,0,.55)]"
                          src={roleSprites[agent.role]} alt={agent.name} width={80} height={80}
                        />
                        {/* Action label */}
                        <span className={`agent-bubble ${motion.action === "idle" ? "opacity-0" : "opacity-100"}`}>
                          {t.actions[motion.action]}
                        </span>
                        {/* Speech bubble */}
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
                      className={`absolute min-w-[88px] -translate-x-1/2 -translate-y-1/2 rounded border px-2 py-1 text-left transition ${
                        agent.id === selectedId ? "scale-110 border-white bg-white text-void" : "border-white/30 bg-void/80 text-white"
                      } ${agent.isPlayer ? "border-cyanline bg-cyanline/20 text-cyanline" : ""}`}
                      style={{ left: `${agent.x}%`, top: `${agent.y}%`, boxShadow: `0 0 18px ${roleColors[agent.role]}44` }}
                    >
                      <span className="flex items-center gap-1">
                        <Image className="pixel-icon h-6 w-6 shrink-0" src={roleIcons[agent.role]} alt="" width={32} height={32} />
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-black">{agent.name.split(" ")[0]}</span>
                          <span className="block font-mono text-[9px] uppercase opacity-70">{t.roles[agent.role]}</span>
                        </span>
                      </span>
                    </button>
                  ))}

                  {/* Legend */}
                  <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1.5">
                    {Object.entries(roleColors).map(([role, color]) => (
                      <span key={role} className="flex items-center gap-1 rounded border border-white/10 bg-black/50 px-1.5 py-0.5 font-mono text-[9px] uppercase text-slate-300">
                        <Image className="pixel-icon h-3.5 w-3.5" src={roleIcons[role as Agent["role"]]} alt="" width={20} height={20} />
                        {t.roles[role as Agent["role"]]}
                      </span>
                    ))}
                  </div>
                </div>
              </Panel>

              {/* Relationships row (only in data mode) */}
              {gameMode === "data" && (
                <Panel title={t.relationships}>
                  <div className="grid grid-cols-2 gap-3">
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
            <aside className={`${mobileTab === "chat" ? "flex" : "hidden"} flex-col gap-3 md:col-span-2 md:flex md:max-h-[280px] md:overflow-y-auto xl:col-span-1 xl:max-h-none xl:overflow-visible`}>

              {/* Tab bar */}
              <div className="hud-panel flex overflow-hidden rounded-xl">
                {(["conversations", "economy", "policy", "events"] as RightTab[]).map(tab => (
                  <button key={tab} onClick={() => setRightTab(tab)} className={`flex-1 py-2.5 font-mono text-[10px] uppercase tracking-wider transition ${rightTab === tab ? "bg-cyanline/15 text-cyanline" : "text-slate-500 hover:text-slate-300"}`}>
                    {tab === "conversations" ? t.conversations : tab === "economy" ? t.economy : tab === "policy" ? t.policy : t.events}
                  </button>
                ))}
              </div>

              {/* Conversations */}
              {rightTab === "conversations" && (
                <Panel title={t.conversations}>
                  <div className="max-h-[calc(100vh-280px)] space-y-2 overflow-auto pr-1">
                    {conversations.length === 0 && (
                      <p className="py-6 text-center font-mono text-xs text-slate-600">Waiting for agents to talk…</p>
                    )}
                    {conversations.map(conv => {
                      const isPlayerConv = conv.agentIds.includes("player") || conv.agentIds[0] === "system";
                      return (
                        <div key={conv.id} className={`rounded-lg border p-2.5 ${isPlayerConv ? "border-cyanline/30 bg-cyanline/[0.05]" : "border-white/10 bg-white/[0.03]"}`}>
                          <div className="mb-1.5 flex justify-between font-mono text-[10px] uppercase text-slate-500">
                            <span>{conv.location}</span>
                            <span>{conv.time}</span>
                          </div>
                          {conv.lines.map((line, i) => {
                            const isPlayer = line.speaker === "You" || line.speaker === "System";
                            return (
                              <div key={i} className={`flex gap-2 text-xs ${i > 0 ? "mt-1.5" : ""}`}>
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
                    <div className="space-y-1.5">
                      {leaderboard.slice(0, 8).map((agent, i) => (
                        <div key={agent.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${agent.isPlayer ? "border-cyanline/40 bg-cyanline/5" : "border-white/10 bg-white/[0.03]"}`}>
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
                    <div className="space-y-2">
                      {marketRows.map(row => (
                        <div key={row.good} className="grid grid-cols-[82px_1fr_54px_48px] items-center gap-2">
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
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Metric label={t.giniCoeff} value={gini.toFixed(2)} valueClassName={gini < 0.3 ? "text-mint" : gini <= 0.5 ? "text-amberline" : "text-blood"} />
                      <Metric label={t.totalAgents} value={agents.length} />
                      <Metric label={t.avgWealth} value={Math.round(agents.reduce((s, a) => s + agentWealth(a), 0) / agents.length)} />
                      <Metric label={t.topEarner} value={leaderboard[0]?.name.split(" ")[0] ?? "—"} />
                    </div>
                    <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-2">
                      <p className="mb-2 font-mono text-[10px] uppercase text-slate-500">{t.wealthDistribution}</p>
                      <div className="space-y-2">
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
              {rightTab === "policy" && (
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
                  <div className="max-h-[calc(100vh-280px)] space-y-2 overflow-auto pr-1">
                    {events.map(ev => (
                      <div key={ev.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                        <div className="mb-1 flex justify-between font-mono text-[10px] uppercase text-slate-500">
                          <span>{ev.kind}</span>
                          <span>{ev.time}</span>
                        </div>
                        <p className="text-xs leading-5 text-slate-300">{ev.text}</p>
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

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="hud-panel rounded-xl p-3">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-cyanline">{title}</h2>
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
    </div>
  );
}

function StatusBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between font-mono text-[10px] uppercase text-slate-500">
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
    <div className={`rounded-lg border px-3 py-1.5 ${tones[tone]}`}>
      <p className="font-mono text-[9px] uppercase text-slate-400">{label}</p>
      <p className="font-mono text-lg font-black leading-none">{value}</p>
    </div>
  );
}

function Metric({ label, value, valueClassName = "text-white" }: { label: string; value: number | string; valueClassName?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
      <p className="font-mono text-[10px] uppercase text-slate-500">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-sm font-black ${valueClassName}`}>{value}</p>
    </div>
  );
}
