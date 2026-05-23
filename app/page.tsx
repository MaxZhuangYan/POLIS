"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { agents as seedAgents, initialEvents, missions } from "@/app/data/polis";
import type { Agent, Mission, WorldEvent } from "@/app/data/polis";
import { fallbackSimulation } from "@/app/lib/sim";

type Settlement = {
  scrip: number;
  reputation: number;
  compute: number;
  contribution: number;
};

type Operation = {
  agent: string;
  mission: string;
  phase: string;
  progress: number;
  expectedSettlement: string;
};

type Language = "en" | "zh";

type AgentMotion = {
  x: number;
  y: number;
  action: "idle" | "walk" | "talk" | "work" | "sign" | "trade";
};

type SocietyState = {
  food: number;
  materials: number;
  knowledge: number;
  culture: number;
  tradeVolume: number;
  friendship: number;
  satisfaction: number;
  decision: string;
};

const roleColors: Record<Agent["role"], string> = {
  Architect: "#45f6ff",
  Broker: "#ffca63",
  Scout: "#79ffbf",
  Mediator: "#ff6f91",
  Archivist: "#b7a7ff",
  Maker: "#ff9f6e"
};

const roleIcons: Record<Agent["role"], string> = {
  Architect: "/assets/polis-icons/architect.png",
  Broker: "/assets/polis-icons/broker.png",
  Scout: "/assets/polis-icons/scout.png",
  Mediator: "/assets/polis-icons/mediator.png",
  Archivist: "/assets/polis-icons/archivist.png",
  Maker: "/assets/polis-icons/maker.png"
};

const roleSprites: Record<Agent["role"], string> = {
  Architect: "/assets/polis-sprites/architect.png",
  Broker: "/assets/polis-sprites/broker.png",
  Scout: "/assets/polis-sprites/scout.png",
  Mediator: "/assets/polis-sprites/mediator.png",
  Archivist: "/assets/polis-sprites/archivist.png",
  Maker: "/assets/polis-sprites/maker.png"
};

const actionLabels: Record<AgentMotion["action"], string> = {
  idle: "...",
  walk: "move",
  talk: "talk",
  work: "work",
  sign: "sign",
  trade: "trade"
};

const copy = {
  en: {
    subtitle: "AI contract civilization prototype",
    language: "中文",
    epoch: "Epoch",
    scrip: "Scrip",
    reputation: "Reputation",
    compute: "Compute",
    agentLab: "Agent Lab",
    addAgent: "+ Agent",
    currentMission: "Current Mission",
    roster: "Roster",
    societySpace: "Society Space",
    pause: "Pause",
    run: "Run",
    reset: "Reset",
    task: "TASK",
    solidTrust: "solid trust",
    dashedConflict: "dashed conflict",
    relationshipGraph: "Relationship Graph",
    epochSettlement: "Epoch Settlement",
    missionReceipt: "Mission Receipt",
    contribution: "Contribution",
    openAgents: "Open Agents",
    activeContracts: "Active Contracts",
    logSource: "Log Source",
    ready: "ready",
    settleEpoch: "Settle Epoch",
    currentOperation: "Current Operation",
    simulateNextTick: "Simulate Next Tick",
    missionBoard: "Mission Board",
    recommended: "recommended",
    risk: "Risk",
    success: "Success",
    repImpact: "Rep Impact",
    dispatch: "Dispatch Selected Agent",
    worldFeed: "World Feed",
    workLog: "Work Log Terminal",
    trust: "trust",
    societySandbox: "Society Sandbox",
    dataObservatory: "Data Observatory",
    production: "Production",
    trade: "Trade",
    social: "Social",
    decision: "Decision",
    produceCycle: "Run Production Cycle",
    marketTrade: "Open Market Trade",
    socialDecision: "Convene Social Decision",
    food: "Food",
    materials: "Materials",
    knowledge: "Knowledge",
    culture: "Culture",
    tradeVolume: "Trade Volume",
    friendship: "Friendship",
    satisfaction: "Satisfaction",
    ranking: "Contribution Ranking",
    currentRule: "Current Rule",
    roles: {
      Architect: "Architect",
      Broker: "Broker",
      Scout: "Scout",
      Mediator: "Mediator",
      Archivist: "Archivist",
      Maker: "Maker"
    },
    ranks: {
      Specialist: "Specialist",
      "Trusted I": "Trusted I",
      Operator: "Operator",
      Rookie: "Rookie"
    },
    actions: actionLabels
  },
  zh: {
    subtitle: "AI 契约文明原型",
    language: "EN",
    epoch: "纪元",
    scrip: "工票",
    reputation: "声望",
    compute: "算力",
    agentLab: "智能体工坊",
    addAgent: "+ 智能体",
    currentMission: "当前任务",
    roster: "居民名单",
    societySpace: "社会地图",
    pause: "暂停",
    run: "运行",
    reset: "重置",
    task: "任务",
    solidTrust: "信任关系",
    dashedConflict: "冲突关系",
    relationshipGraph: "关系网络",
    epochSettlement: "纪元结算",
    missionReceipt: "任务回执",
    contribution: "贡献",
    openAgents: "居民数",
    activeContracts: "活跃契约",
    logSource: "日志来源",
    ready: "就绪",
    settleEpoch: "结算纪元",
    currentOperation: "当前行动",
    simulateNextTick: "模拟下一刻",
    missionBoard: "任务板",
    recommended: "推荐",
    risk: "风险",
    success: "成功率",
    repImpact: "声望影响",
    dispatch: "派遣选中智能体",
    worldFeed: "世界事件",
    workLog: "工作日志终端",
    trust: "信任",
    societySandbox: "社会沙盒",
    dataObservatory: "数据观察台",
    production: "生产",
    trade: "交易",
    social: "社交",
    decision: "决策",
    produceCycle: "运行生产周期",
    marketTrade: "开放市场交易",
    socialDecision: "召集社会决策",
    food: "食物",
    materials: "材料",
    knowledge: "知识",
    culture: "文化",
    tradeVolume: "交易量",
    friendship: "友谊指数",
    satisfaction: "满意度",
    ranking: "贡献排名",
    currentRule: "当前规则",
    roles: {
      Architect: "规划师",
      Broker: "经纪人",
      Scout: "探索者",
      Mediator: "调解员",
      Archivist: "档案员",
      Maker: "工匠"
    },
    ranks: {
      Specialist: "专家",
      "Trusted I": "可信 I",
      Operator: "执行者",
      Rookie: "新人"
    },
    actions: {
      idle: "...",
      walk: "移动",
      talk: "交谈",
      work: "工作",
      sign: "签约",
      trade: "交易"
    }
  }
} as const;

const missionCopy = {
  en: {
    supply: {
      title: "Stabilize Scrip Supply",
      brief: "Audit idle work logs, find payout leaks, and propose a calibrated issuance rule."
    },
    bridge: {
      title: "Build Trust Bridge",
      brief: "Pair two low-affinity agents on a small shared contract and record the outcome."
    },
    beacon: {
      title: "Repair North Beacon",
      brief: "Coordinate scouts and makers to restore compute relay coverage before night cycle."
    },
    charter: {
      title: "Draft Epoch Charter",
      brief: "Synthesize disputes into one collective rule amendment for the next settlement vote."
    }
  },
  zh: {
    supply: {
      title: "稳定工票供给",
      brief: "审计闲置工作日志，找出结算漏洞，并提出校准后的发行规则。"
    },
    bridge: {
      title: "搭建信任桥",
      brief: "让两个低亲和智能体共同完成小契约，并记录协作结果。"
    },
    beacon: {
      title: "修复北部信标",
      brief: "协调探索者和工匠，在夜间周期前恢复算力中继覆盖。"
    },
    charter: {
      title: "起草纪元章程",
      brief: "把争议综合成下一次居民投票的集体规则修正案。"
    }
  }
} as const;

const zoneIcons: Record<string, string> = {
  "MARKET RING": "/assets/polis-icons/market.png",
  "CIVIC CORE": "/assets/polis-icons/civic.png",
  "ARCHIVE HALL": "/assets/polis-icons/archive.png",
  "MAKER YARD": "/assets/polis-icons/maker.png",
  "OUTER GRID": "/assets/polis-icons/outer.png",
  ASSEMBLY: "/assets/polis-icons/assembly.png"
};

const zoneLabels = [
  { name: "ARCHIVE HALL", x: "10%", y: "12%" },
  { name: "CIVIC CORE", x: "42%", y: "34%" },
  { name: "MARKET RING", x: "16%", y: "66%" },
  { name: "MAKER YARD", x: "71%", y: "50%" },
  { name: "OUTER GRID", x: "69%", y: "16%" },
  { name: "ASSEMBLY", x: "66%", y: "78%" }
];

const STORAGE_KEY = "polis-demo-state-v1";
const LANGUAGE_KEY = "polis-language-v1";

function initialMotion(agentList: Agent[]): Record<string, AgentMotion> {
  return Object.fromEntries(
    agentList.map((agent, index) => [
      agent.id,
      {
        x: agent.x + ((index % 3) - 1) * 1.5,
        y: agent.y + (index % 2 === 0 ? -1.2 : 1.2),
        action: index % 4 === 0 ? "talk" : "idle"
      }
    ])
  );
}

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>(seedAgents);
  const [language, setLanguage] = useState<Language>("en");
  const [agentMotion, setAgentMotion] = useState<Record<string, AgentMotion>>(() => initialMotion(seedAgents));
  const [selectedId, setSelectedId] = useState("mira");
  const [selectedMission, setSelectedMission] = useState(missions[0].id);
  const [events, setEvents] = useState<WorldEvent[]>(initialEvents);
  const [workLog, setWorkLog] = useState<string[]>([
    "[boot] Polis civic simulation loaded.",
    "[world] 9 autonomous agents joined Epoch 12.",
    "[ledger] Contract economy ready; no wallet or chain required."
  ]);
  const [settlement, setSettlement] = useState<Settlement>({
    scrip: 943,
    reputation: 631,
    compute: 512,
    contribution: 188
  });
  const [epoch, setEpoch] = useState(12);
  const [isRunning, setIsRunning] = useState(true);
  const [source, setSource] = useState<"mock" | "lmstudio" | "idle">("idle");
  const [society, setSociety] = useState<SocietyState>({
    food: 78,
    materials: 64,
    knowledge: 52,
    culture: 41,
    tradeVolume: 126,
    friendship: 68,
    satisfaction: 72,
    decision: "Proof before payout"
  });
  const [operation, setOperation] = useState<Operation>({
    agent: "Mira Chen",
    mission: "Stabilize Scrip Supply",
    phase: "Idle / awaiting dispatch",
    progress: 0,
    expectedSettlement: "+28 scrip / +6 rep / -18 compute"
  });
  const t = copy[language];

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
    if (savedLanguage === "en" || savedLanguage === "zh") {
      setLanguage(savedLanguage);
    }
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const state = JSON.parse(saved) as {
        agents: Agent[];
        events: WorldEvent[];
        workLog: string[];
        settlement: Settlement;
        epoch: number;
        selectedId: string;
      };
      setAgents(state.agents.map(normalizeAgent));
      setAgentMotion(initialMotion(state.agents.map(normalizeAgent)));
      setEvents(state.events);
      setWorkLog(state.workLog);
      setSettlement(state.settlement);
      setEpoch(state.epoch);
      setSelectedId(state.selectedId);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ agents, events, workLog, settlement, epoch, selectedId })
    );
  }, [agents, events, workLog, settlement, epoch, selectedId]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      setEvents((current) => {
        const actor = agents[Math.floor(Math.random() * agents.length)];
        const fragments = [
          `${actor.name} broadcast a short-term intent update to nearby agents.`,
          `${actor.role} guild changed queue priority after a reputation signal.`,
          `A contract witness recorded a weak tie becoming operational trust.`,
          `Epoch market adjusted compute rationing after a burst of work logs.`
        ];
        return [
          {
            id: `ambient-${Date.now()}`,
            time: `E${epoch} ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}`,
            kind: "social" as const,
            text: fragments[Math.floor(Math.random() * fragments.length)]
          },
          ...current
        ].slice(0, 9);
      });
      setSettlement((current) => ({
        ...current,
        compute: Math.max(0, current.compute - 1),
        contribution: current.contribution + 1
      }));
      setSociety((current) => ({
        ...current,
        food: clamp(current.food + Math.round(Math.random() * 4 - 1), 20, 140),
        materials: clamp(current.materials + Math.round(Math.random() * 3), 20, 140),
        tradeVolume: clamp(current.tradeVolume + Math.round(Math.random() * 8 - 2), 60, 260),
        friendship: clamp(current.friendship + Math.round(Math.random() * 4 - 1), 20, 100),
        satisfaction: clamp(current.satisfaction + Math.round(Math.random() * 5 - 2), 20, 100)
      }));
      setAgentMotion((current) => {
        const next = { ...current };
        agents.forEach((agent) => {
          const motion = next[agent.id] ?? { x: agent.x, y: agent.y, action: "idle" as const };
          const driftX = (Math.random() - 0.5) * 5;
          const driftY = (Math.random() - 0.5) * 4;
          const actions: AgentMotion["action"][] = ["walk", "talk", "work", "idle", "trade"];
          next[agent.id] = {
            x: clamp(motion.x + driftX, 10, 86),
            y: clamp(motion.y + driftY, 16, 78),
            action: actions[Math.floor(Math.random() * actions.length)]
          };
        });
        return next;
      });
    }, 4600);
    return () => window.clearInterval(timer);
  }, [agents, epoch, isRunning]);

  const selectedAgent = useMemo(
    () => normalizeAgent(agents.find((agent) => agent.id === selectedId) ?? agents[0]),
    [agents, selectedId]
  );
  const mission = missions.find((item) => item.id === selectedMission) ?? missions[0];
  const selectedMissionText = missionText(mission, language);

  async function runMission(targetMission: Mission = mission) {
    const fallback = fallbackSimulation(selectedAgent, targetMission, epoch);
    setOperation({
      agent: selectedAgent.name,
      mission: targetMission.title,
      phase: "Instruction queued",
      progress: 12,
      expectedSettlement: `+${targetMission.reward} scrip / +${targetMission.reputationImpact} rep / -${targetMission.computeCost} compute`
    });
    setAgentMotion((current) => ({
      ...current,
      [selectedAgent.id]: {
        x: (selectedAgent.x * 0.38 + targetMission.x * 0.62),
        y: (selectedAgent.y * 0.38 + targetMission.y * 0.62),
        action: "sign"
      }
    }));
    setWorkLog((current) => [`[dispatch] Sending ${selectedAgent.name} into ${targetMission.sector}...`, ...current].slice(0, 12));

    let result = { ...fallback, source: "mock" as "mock" | "lmstudio" };
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: selectedAgent, mission: targetMission, epoch })
      });
      result = await response.json();
    } catch {
      result = { ...fallback, source: "mock" };
    }

    setSource(result.source);
    setOperation({
      agent: selectedAgent.name,
      mission: targetMission.title,
      phase: "Result archived",
      progress: 100,
      expectedSettlement: `+${result.delta.scrip} scrip / +${result.delta.reputation} rep / ${result.delta.compute} compute`
    });
    setAgentMotion((current) => ({
      ...current,
      [selectedAgent.id]: {
        x: targetMission.x + 2,
        y: targetMission.y + 2,
        action: "work"
      }
    }));
    setAgents((current) =>
      current.map((agent) =>
        agent.id === selectedAgent.id
          ? {
              ...agent,
              scrip: agent.scrip + result.delta.scrip,
              reputation: Math.min(100, agent.reputation + result.delta.reputation),
              compute: Math.max(0, agent.compute + result.delta.compute),
              status: `Completed ${targetMission.title}`,
              intent: "Awaiting next contract after ledger settlement",
              currentMission: targetMission.title,
              level: agent.level + (targetMission.difficulty >= 4 ? 1 : 0)
            }
          : agent
      )
    );
    setSettlement((current) => ({
      scrip: current.scrip + result.delta.scrip,
      reputation: current.reputation + result.delta.reputation,
      compute: Math.max(0, current.compute + result.delta.compute),
      contribution: current.contribution + result.delta.contribution
    }));
    setEvents((current) => [result.event, ...current].slice(0, 9));
    setWorkLog((current) => [...result.workLog, ...current].slice(0, 14));
  }

  function createAgent() {
    const roles: Agent["role"][] = ["Architect", "Broker", "Scout", "Mediator", "Archivist", "Maker"];
    const role = roles[Math.floor(Math.random() * roles.length)];
    const id = `agent-${Date.now()}`;
    const newAgent: Agent = {
      id,
      name: `Unit ${Math.floor(100 + Math.random() * 899)}`,
      role,
      x: Math.floor(14 + Math.random() * 72),
      y: Math.floor(16 + Math.random() * 68),
      status: "Newly instantiated in civic core",
      intent: "Observe norms, find first useful contract",
      level: 1,
      specialization: `${role} Apprentice`,
      traits: ["rookie", "curious", "unbonded"],
      currentMission: "Onboarding Contract",
      scrip: 60,
      reputation: 45,
      compute: 80,
      affinity: { [selectedAgent.id]: 5 }
    };
    setAgents((current) => [...current, newAgent]);
    setAgentMotion((current) => ({
      ...current,
      [id]: { x: newAgent.x, y: newAgent.y, action: "walk" }
    }));
    setSelectedId(id);
    setEvents((current) => [
      {
        id: `new-${Date.now()}`,
        time: `E${epoch} ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}`,
        kind: "social",
        text: `${newAgent.name} entered Polis as a ${role} and requested an onboarding contract.`
      },
      ...current
    ]);
  }

  function resetDemo() {
    window.localStorage.removeItem(STORAGE_KEY);
    setAgents(seedAgents);
    setAgentMotion(initialMotion(seedAgents));
    setSelectedId("mira");
    setEvents(initialEvents);
    setWorkLog(["[reset] Polis restored to initial civic state.", "[world] Epoch 12 restarted."]);
    setSettlement({ scrip: 943, reputation: 631, compute: 512, contribution: 188 });
    setEpoch(12);
    setSource("idle");
    setSociety({
      food: 78,
      materials: 64,
      knowledge: 52,
      culture: 41,
      tradeVolume: 126,
      friendship: 68,
      satisfaction: 72,
      decision: "Proof before payout"
    });
    setOperation({
      agent: "Mira Chen",
      mission: "Stabilize Scrip Supply",
      phase: "Idle / awaiting dispatch",
      progress: 0,
      expectedSettlement: "+28 scrip / +6 rep / -18 compute"
    });
  }

  function simulateNextTick() {
    const peerIds = Object.keys(selectedAgent.affinity);
    const peerId = peerIds[Math.floor(Math.random() * peerIds.length)];
    const phase = operation.progress < 30 ? "Analysis" : operation.progress < 70 ? "Action" : "Compute receipt";
    setOperation((current) => ({
      ...current,
      agent: selectedAgent.name,
      mission: mission.title,
      phase,
      progress: Math.min(100, current.progress + 18 + mission.difficulty * 3),
      expectedSettlement: `+${mission.reward} scrip / +${mission.reputationImpact} rep / -${mission.computeCost} compute`
    }));
    setAgentMotion((current) => {
      const motion = current[selectedAgent.id] ?? { x: selectedAgent.x, y: selectedAgent.y, action: "idle" as const };
      const action: AgentMotion["action"] = phase === "Analysis" ? "talk" : phase === "Action" ? "walk" : "work";
      return {
        ...current,
        [selectedAgent.id]: {
          x: clamp(motion.x + (mission.x - motion.x) * 0.45, 10, 86),
          y: clamp(motion.y + (mission.y - motion.y) * 0.45, 16, 78),
          action
        }
      };
    });
    setSettlement((current) => ({
      ...current,
      compute: Math.max(0, current.compute - Math.ceil(mission.computeCost / 6)),
      contribution: current.contribution + Math.ceil(mission.contribution / 4)
    }));
    setAgents((current) =>
      current.map((agent) =>
        agent.id === selectedAgent.id
          ? {
              ...agent,
              compute: Math.max(0, agent.compute - 2),
              reputation: Math.min(100, agent.reputation + 1),
              affinity: peerId ? { ...agent.affinity, [peerId]: Math.min(10, (agent.affinity[peerId] ?? 4) + 1) } : agent.affinity
            }
          : agent
      )
    );
    setEvents((current) => [
      {
        id: `tick-${Date.now()}`,
        time: `E${epoch} ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}`,
        kind: "contract" as const,
        text: `${selectedAgent.name} advanced '${mission.title}' to ${phase}; witness trust and contribution ledger changed.`
      },
      ...current
    ].slice(0, 9));
    setWorkLog((current) => [
      `[instruction] Continue ${mission.title} with ${selectedAgent.name}.`,
      `[analysis] Phase=${phase}; success chance ${mission.successChance}%; recommended role ${mission.recommendedRole}.`,
      `[action] Relationship witness updated; compute debit ${Math.ceil(mission.computeCost / 6)}.`,
      `[result] Operation progress advanced toward epoch receipt.`,
      ...current
    ].slice(0, 14));
  }

  function runProductionCycle() {
    const makers = agents.filter((agent) => agent.role === "Maker" || agent.role === "Scout").length;
    setSociety((current) => ({
      ...current,
      food: clamp(current.food + 8 + makers, 20, 160),
      materials: clamp(current.materials + 10 + makers * 2, 20, 160),
      knowledge: clamp(current.knowledge + 4, 20, 160),
      satisfaction: clamp(current.satisfaction + 2, 20, 100)
    }));
    setAgentMotion((current) => focusRoleMotion(current, agents, ["Maker", "Scout"], "work"));
    appendSocietyEvent("production", "Production cycle completed: scouts gathered inputs and makers converted them into shared stock.");
  }

  function runMarketTrade() {
    const brokers = agents.filter((agent) => agent.role === "Broker").length;
    setSociety((current) => ({
      ...current,
      food: clamp(current.food - 4, 20, 160),
      materials: clamp(current.materials - 3, 20, 160),
      tradeVolume: clamp(current.tradeVolume + 22 + brokers * 8, 60, 320),
      friendship: clamp(current.friendship + 3 + brokers, 20, 100),
      satisfaction: clamp(current.satisfaction + 4, 20, 100)
    }));
    setSettlement((current) => ({ ...current, scrip: current.scrip + 18 + brokers * 4 }));
    setAgentMotion((current) => focusRoleMotion(current, agents, ["Broker"], "trade"));
    appendSocietyEvent("trade", "Market opened: brokers matched surplus goods with unmet needs and raised trade volume.");
  }

  function runSocialDecision() {
    const decisions = ["Shared food reserve", "Mentor rookies first", "Lower compute ration", "Public work proof", "Festival after settlement"];
    const decision = decisions[Math.floor(Math.random() * decisions.length)];
    setSociety((current) => ({
      ...current,
      culture: clamp(current.culture + 9, 20, 160),
      knowledge: clamp(current.knowledge + 6, 20, 160),
      friendship: clamp(current.friendship + 6, 20, 100),
      satisfaction: clamp(current.satisfaction + 5, 20, 100),
      decision
    }));
    setAgentMotion((current) => focusRoleMotion(current, agents, ["Mediator", "Archivist", "Architect"], "talk"));
    appendSocietyEvent("decision", `Assembly decision adopted: ${decision}. Agents update plans around the new norm.`);
  }

  function appendSocietyEvent(kind: string, text: string) {
    const eventKind: WorldEvent["kind"] = kind === "decision" ? "rule" : kind === "trade" ? "contract" : "culture";
    setEvents((current) => [
      {
        id: `${kind}-${Date.now()}`,
        time: `E${epoch} ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}`,
        kind: eventKind,
        text
      },
      ...current
    ].slice(0, 9));
    setWorkLog((current) => [
      `[${kind}] ${text}`,
      `[observer] Food ${society.food}, materials ${society.materials}, trade ${society.tradeVolume}, friendship ${society.friendship}.`,
      ...current
    ].slice(0, 14));
  }

  function settleEpoch() {
    setEpoch((value) => value + 1);
    setSettlement((current) => ({
      scrip: current.scrip + 84,
      reputation: current.reputation + 18,
      compute: current.compute + 140,
      contribution: Math.round(current.contribution * 0.34)
    }));
    setEvents((current) => [
      {
        id: `settlement-${Date.now()}`,
        time: `E${epoch} close`,
        kind: "settlement",
        text: `Epoch ${epoch} settled: contributions compressed into reputation, compute ration refreshed.`
      },
      ...current
    ]);
  }

  return (
    <main className="scanlines min-h-screen bg-void text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(69,246,255,.18),transparent_34%),linear-gradient(180deg,rgba(5,7,19,.3),#050713_82%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1800px] flex-col gap-4 p-3 sm:p-4 lg:p-5">
        <header className="hud-panel flex flex-col gap-4 rounded-lg px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyanline/75">{t.subtitle}</p>
            <h1 className="mt-1 font-display text-3xl font-black uppercase text-white sm:text-5xl">POLIS</h1>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:min-w-[720px]">
            <Resource label={t.epoch} value={epoch.toString()} tone="cyan" />
            <Resource label={t.scrip} value={settlement.scrip.toString()} tone="amber" />
            <Resource label={t.reputation} value={settlement.reputation.toString()} tone="mint" />
            <Resource label={t.compute} value={settlement.compute.toString()} tone="rose" />
            <button className="rounded-md border border-cyanline/30 bg-cyanline/10 px-3 py-2 font-mono text-xs uppercase text-cyanline hover:bg-cyanline/20" onClick={() => setLanguage((value) => (value === "en" ? "zh" : "en"))}>
              {t.language}
            </button>
          </div>
        </header>

        <section className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(560px,1fr)_390px]">
          <aside className="flex flex-col gap-4">
            <Panel title={t.agentLab} action={<button className="hud-button" onClick={createAgent}>{t.addAgent}</button>}>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="pixel-block grid h-16 w-16 place-items-center border border-cyanline/40 bg-cyanline/10 p-1">
                    <Image className="pixel-icon h-full w-full object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,.35)]" src={roleIcons[selectedAgent.role]} alt={`${selectedAgent.role} icon`} width={128} height={128} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="truncate text-lg font-bold">{selectedAgent.name}</h2>
                      <span className="rounded border border-amberline/40 bg-amberline/10 px-2 py-1 font-mono text-[10px] text-amberline">Lv {selectedAgent.level}</span>
                    </div>
                    <p className="font-mono text-xs uppercase text-slate-400">{t.roles[selectedAgent.role]} / {selectedAgent.specialization}</p>
                    <p className="mt-1 font-mono text-[10px] uppercase text-mint">{rankLabel(selectedAgent.reputation, language)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {selectedAgent.traits.map((trait) => (
                    <span key={trait} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] uppercase text-slate-300">
                      {trait}
                    </span>
                  ))}
                </div>
                <div className="rounded border border-cyanline/15 bg-cyanline/[0.04] p-2">
                  <p className="font-mono text-[10px] uppercase text-slate-500">{t.currentMission}</p>
                  <p className="mt-1 text-sm text-cyanline">{selectedAgent.currentMission}</p>
                  <p className="mt-1 text-xs text-slate-400">{selectedAgent.status}</p>
                </div>
                <p className="text-sm leading-6 text-slate-300">{selectedAgent.intent}</p>
                <Bars agent={selectedAgent} />
              </div>
            </Panel>

            <Panel title={t.roster}>
              <div className="max-h-[430px] space-y-2 overflow-auto pr-1">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedId(agent.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition ${
                      agent.id === selectedId
                        ? "border-cyanline/70 bg-cyanline/10"
                        : "border-white/10 bg-white/[0.03] hover:border-cyanline/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 font-semibold">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${agent.compute > 60 ? "bg-mint" : agent.compute > 35 ? "bg-amberline" : "bg-blood"}`} />
                        <Image className="pixel-icon h-6 w-6 shrink-0 object-contain" src={roleIcons[agent.role]} alt="" aria-hidden="true" width={32} height={32} />
                        <span className="truncate">{agent.name}</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase" style={{ color: roleColors[agent.role] }}>
                        Lv{agent.level} {t.roles[agent.role]}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">{rankLabel(agent.reputation, language)} / {agent.currentMission}</p>
                  </button>
                ))}
              </div>
            </Panel>
          </aside>

          <section className="flex flex-col gap-4">
            <Panel
              title={t.societySpace}
              action={
                <div className="flex gap-2">
                  <button className="hud-button" onClick={() => setIsRunning((value) => !value)}>
                    {isRunning ? t.pause : t.run}
                  </button>
                  <button className="hud-button" onClick={resetDemo}>{t.reset}</button>
                </div>
              }
            >
              <div className="map-grid relative h-[580px] overflow-hidden rounded-md border border-cyanline/15">
                <Image
                  className="pixel-icon absolute inset-0 h-full w-full object-cover opacity-80 saturate-[.92]"
                  src="/assets/polis-pixel-town-map.png"
                  alt="Pixel art Polis town map"
                  width={1600}
                  height={900}
                  priority
                />
                <div className="absolute inset-0 bg-void/20" />
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {agents.flatMap((agent) =>
                    Object.entries(agent.affinity).map(([targetId, value]) => {
                      const target = agents.find((item) => item.id === targetId);
                      if (!target) return null;
                      const color = value >= 7 ? "rgba(121,255,191,.34)" : value <= 4 ? "rgba(255,73,109,.32)" : "rgba(69,246,255,.22)";
                      return (
                        <line
                          key={`${agent.id}-${targetId}`}
                          x1={agent.x}
                          y1={agent.y}
                          x2={target.x}
                          y2={target.y}
                          stroke={color}
                          strokeWidth={value >= 7 ? "0.36" : "0.25"}
                          strokeDasharray={value <= 4 ? "1.4 1.2" : value >= 7 ? "0" : "2 1.4"}
                        />
                      );
                    })
                  )}
                  <line x1={selectedAgent.x} y1={selectedAgent.y} x2={mission.x} y2={mission.y} stroke="rgba(255,202,99,.78)" strokeWidth="0.5" strokeDasharray="2 1" />
                </svg>
                <div className="absolute left-[8%] top-[10%] h-[26%] w-[31%] border border-cyanline/20 bg-cyanline/[0.04]" />
                <div className="absolute bottom-[11%] left-[15%] h-[21%] w-[28%] border border-amberline/20 bg-amberline/[0.05]" />
                <div className="absolute right-[9%] top-[18%] h-[55%] w-[25%] border border-mint/20 bg-mint/[0.04]" />
                <div className="absolute right-[17%] bottom-[11%] h-[18%] w-[25%] border border-blood/20 bg-blood/[0.04]" />
                {zoneLabels.map((zone) => (
                  <span key={zone.name} className="absolute flex items-center gap-1 rounded border border-white/10 bg-black/45 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-300" style={{ left: zone.x, top: zone.y }}>
                    <Image className="pixel-icon h-5 w-5 object-contain" src={zoneIcons[zone.name]} alt="" aria-hidden="true" width={28} height={28} />
                    {zone.name}
                  </span>
                ))}
                {missions.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedMission(item.id)}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded border px-2 py-1 text-left font-mono text-[10px] uppercase transition ${
                      item.id === selectedMission
                        ? "border-amberline bg-amberline/20 text-amberline shadow-[0_0_30px_rgba(255,202,99,.35)]"
                        : "border-amberline/35 bg-black/60 text-amberline/75"
                    }`}
                    style={{ left: `${item.x}%`, top: `${item.y}%` }}
                    title={`${item.title} - ${item.sector}`}
                  >
                    <span className="flex items-center gap-1">
                      <Image className="pixel-icon h-5 w-5 object-contain" src="/assets/polis-icons/mission.png" alt="" aria-hidden="true" width={28} height={28} />
                      <span className="block">{t.task}</span>
                    </span>
                    <span className="block max-w-[96px] truncate pl-6">{missionText(item, language).title}</span>
                  </button>
                ))}
                {agents.map((agent) => {
                  const motion = agentMotion[agent.id] ?? { x: agent.x, y: agent.y, action: "idle" as const };
                  return (
                    <button
                      key={`${agent.id}-sprite`}
                      onClick={() => setSelectedId(agent.id)}
                      className={`agent-sprite absolute -translate-x-1/2 -translate-y-full transition-[left,top,transform] duration-700 ease-out ${
                        agent.id === selectedId ? "z-30 scale-125" : "z-20"
                      }`}
                      style={{ left: `${motion.x}%`, top: `${motion.y}%` }}
                      title={`${agent.name} moving through Polis`}
                    >
                      <Image
                        className="pixel-icon h-12 w-12 object-contain drop-shadow-[0_6px_5px_rgba(0,0,0,.55)]"
                        src={roleSprites[agent.role]}
                        alt={`${agent.name} sprite`}
                        width={80}
                        height={80}
                      />
                      <span className={`agent-bubble ${motion.action === "idle" ? "opacity-0" : "opacity-100"}`}>{t.actions[motion.action]}</span>
                    </button>
                  );
                })}
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedId(agent.id)}
                    className={`absolute min-w-[92px] -translate-x-1/2 -translate-y-1/2 rounded-md border px-2 py-1 text-left shadow-glow transition ${
                      agent.id === selectedId ? "scale-110 border-white bg-white text-void" : "border-white/30 bg-void/85 text-white"
                    }`}
                    style={{ left: `${agent.x}%`, top: `${agent.y}%`, boxShadow: `0 0 22px ${roleColors[agent.role]}55` }}
                    title={`${agent.name} - ${agent.role}`}
                  >
                    <span className="flex items-center gap-1">
                      <Image className="pixel-icon h-7 w-7 shrink-0 object-contain" src={roleIcons[agent.role]} alt="" aria-hidden="true" width={36} height={36} />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-black">{agent.name.split(" ")[0]}</span>
                        <span className="block truncate font-mono text-[9px] uppercase opacity-75">{t.roles[agent.role]}</span>
                      </span>
                    </span>
                  </button>
                ))}
                <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2">
                  {Object.entries(roleColors).map(([role, color]) => (
                    <span key={role} className="rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] uppercase text-slate-300">
                      <Image className="pixel-icon mr-1 inline-block h-4 w-4 align-middle" src={roleIcons[role as Agent["role"]]} alt="" aria-hidden="true" width={24} height={24} />
                      {t.roles[role as Agent["role"]]}
                    </span>
                  ))}
                  <span className="rounded border border-mint/20 bg-black/40 px-2 py-1 font-mono text-[10px] uppercase text-mint">{t.solidTrust}</span>
                  <span className="rounded border border-blood/20 bg-black/40 px-2 py-1 font-mono text-[10px] uppercase text-blood">{t.dashedConflict}</span>
                </div>
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title={t.dataObservatory}>
                <div className="grid grid-cols-3 gap-2">
                  <Metric label={t.tradeVolume} value={society.tradeVolume} />
                  <Metric label={t.friendship} value={`${society.friendship}%`} />
                  <Metric label={t.satisfaction} value={`${society.satisfaction}%`} />
                </div>
                <div className="mt-3 rounded border border-white/10 bg-white/[0.03] p-2">
                  <p className="font-mono text-[10px] uppercase text-slate-500">{t.currentRule}</p>
                  <p className="mt-1 text-sm text-amberline">{society.decision}</p>
                </div>
                <div className="mt-3 space-y-2">
                  <p className="font-mono text-[10px] uppercase text-slate-500">{t.ranking}</p>
                  {agents
                    .slice()
                    .sort((a, b) => b.reputation + b.scrip / 10 - (a.reputation + a.scrip / 10))
                    .slice(0, 3)
                    .map((agent, index) => (
                      <div key={agent.id} className="flex items-center justify-between rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-xs">
                        <span>{index + 1}. {agent.name}</span>
                        <span className="font-mono text-mint">{agent.reputation + Math.round(agent.scrip / 10)}</span>
                      </div>
                    ))}
                </div>
              </Panel>
              <Panel title={t.relationshipGraph}>
                <div className="space-y-3">
                  {Object.entries(selectedAgent.affinity).map(([id, value]) => {
                    const peer = agents.find((item) => item.id === id);
                    return (
                      <div key={id}>
                        <div className="mb-1 flex justify-between text-xs text-slate-300">
                          <span>{peer?.name ?? id}</span>
                          <span>{value}/10 {t.trust}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded bg-white/10">
                          <div className="h-full bg-cyanline" style={{ width: `${value * 10}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>
              <Panel title={t.epochSettlement}>
                <div className="rounded-md border border-amberline/25 bg-amberline/[0.06] p-3">
                  <div className="flex items-center justify-between border-b border-amberline/15 pb-2 font-mono text-[10px] uppercase text-amberline">
                    <span>{t.missionReceipt}</span>
                    <span>{t.epoch} {epoch}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Metric label={t.contribution} value={settlement.contribution} />
                    <Metric label={t.openAgents} value={agents.length} />
                    <Metric label={t.activeContracts} value={missions.length + 2} />
                    <Metric label={t.logSource} value={source === "idle" ? t.ready : source} />
                  </div>
                </div>
                <button className="mt-4 w-full rounded-md border border-amberline/50 bg-amberline/10 px-3 py-2 font-mono text-xs uppercase text-amberline hover:bg-amberline/20" onClick={settleEpoch}>
                  {t.settleEpoch}
                </button>
              </Panel>
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <Panel title={t.currentOperation}>
              <div className="space-y-3">
                <div className="rounded-md border border-cyanline/20 bg-cyanline/[0.05] p-3">
                  <div className="flex justify-between gap-3 font-mono text-[10px] uppercase text-slate-500">
                    <span>{operation.agent}</span>
                    <span>{operation.phase}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">{selectedMissionText.title}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded bg-white/10">
                    <div className="h-full bg-cyanline transition-all" style={{ width: `${operation.progress}%` }} />
                  </div>
                  <p className="mt-2 font-mono text-[10px] uppercase text-amberline">{operation.expectedSettlement}</p>
                </div>
                <button className="w-full rounded-md border border-mint/50 bg-mint/10 px-4 py-3 font-mono text-xs uppercase text-mint hover:bg-mint/20" onClick={simulateNextTick}>
                  {t.simulateNextTick}
                </button>
              </div>
            </Panel>

            <Panel title={t.societySandbox}>
              <div className="grid grid-cols-2 gap-2">
                <Metric label={t.food} value={society.food} />
                <Metric label={t.materials} value={society.materials} />
                <Metric label={t.knowledge} value={society.knowledge} />
                <Metric label={t.culture} value={society.culture} />
              </div>
              <div className="mt-3 grid gap-2">
                <button className="rounded-md border border-mint/40 bg-mint/10 px-3 py-2 font-mono text-[10px] uppercase text-mint hover:bg-mint/20" onClick={runProductionCycle}>
                  {t.produceCycle}
                </button>
                <button className="rounded-md border border-amberline/40 bg-amberline/10 px-3 py-2 font-mono text-[10px] uppercase text-amberline hover:bg-amberline/20" onClick={runMarketTrade}>
                  {t.marketTrade}
                </button>
                <button className="rounded-md border border-cyanline/40 bg-cyanline/10 px-3 py-2 font-mono text-[10px] uppercase text-cyanline hover:bg-cyanline/20" onClick={runSocialDecision}>
                  {t.socialDecision}
                </button>
              </div>
            </Panel>

            <Panel title={t.missionBoard}>
              <div className="space-y-3">
                {missions.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedMission(item.id)}
                    className={`w-full rounded-md border p-3 text-left ${
                      selectedMission === item.id
                        ? "border-amberline/70 bg-amberline/10 shadow-[0_0_26px_rgba(255,202,99,.12)]"
                        : item.difficulty >= 5
                          ? "border-blood/35 bg-blood/[0.05]"
                          : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-bold">{missionText(item, language).title}</h3>
                      <span className="font-mono text-xs text-amberline">+{item.reward}</span>
                    </div>
                    <p className="mt-1 text-xs uppercase text-slate-500">{item.sector} / {t.recommended} {t.roles[item.recommendedRole]}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase">
                      <MissionStat label={t.risk} value={`${item.difficulty}/5`} danger={item.difficulty >= 4} />
                      <MissionStat label={t.compute} value={`-${item.computeCost}`} danger={item.computeCost >= 28} />
                      <MissionStat label={t.success} value={`${item.successChance}%`} danger={item.successChance < 60} />
                      <MissionStat label={t.repImpact} value={`+${item.reputationImpact}`} />
                    </div>
                    <p className="mt-2 text-sm leading-5 text-slate-300">{missionText(item, language).brief}</p>
                  </button>
                ))}
                <button className="w-full rounded-md border border-cyanline/60 bg-cyanline/10 px-4 py-3 font-mono text-xs uppercase text-cyanline hover:bg-cyanline/20" onClick={() => runMission()}>
                  {t.dispatch}
                </button>
              </div>
            </Panel>

            <Panel title={t.worldFeed}>
              <div className="max-h-[260px] space-y-2 overflow-auto pr-1">
                {events.map((event) => (
                  <div key={event.id} className="rounded border border-white/10 bg-white/[0.03] p-2">
                    <div className="mb-1 flex justify-between font-mono text-[10px] uppercase text-slate-500">
                      <span>{event.kind}</span>
                      <span>{event.time}</span>
                    </div>
                    <p className="text-sm leading-5 text-slate-300">{event.text}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title={t.workLog}>
              <div className="terminal h-[300px] overflow-auto rounded-md p-3 font-mono text-xs leading-5 text-mint">
                {workLog.map((line, index) => (
                  <div key={`${line}-${index}`} className="grid grid-cols-[56px_1fr] gap-2 border-b border-mint/5 py-1">
                    <span className="text-slate-500">T+{String(index).padStart(2, "0")}</span>
                    <p className={line.includes("result") || line.includes("Completed") ? "text-amberline" : "text-mint"}>{line}</p>
                  </div>
                ))}
              </div>
            </Panel>
          </aside>
        </section>
      </div>
    </main>
  );
}

function reputationRank(reputation: number) {
  if (reputation >= 80) return "Specialist";
  if (reputation >= 68) return "Trusted I";
  if (reputation >= 55) return "Operator";
  return "Rookie";
}

function rankLabel(reputation: number, language: Language) {
  return copy[language].ranks[reputationRank(reputation)];
}

function missionText(mission: Mission, language: Language) {
  return missionCopy[language][mission.id as keyof typeof missionCopy.en] ?? { title: mission.title, brief: mission.brief };
}

function focusRoleMotion(
  current: Record<string, AgentMotion>,
  agents: Agent[],
  roles: Agent["role"][],
  action: AgentMotion["action"]
) {
  const next = { ...current };
  agents.forEach((agent) => {
    if (!roles.includes(agent.role)) return;
    const motion = next[agent.id] ?? { x: agent.x, y: agent.y, action: "idle" as const };
    next[agent.id] = {
      x: clamp(motion.x + (agent.x - motion.x) * 0.5 + (Math.random() - 0.5) * 3, 10, 86),
      y: clamp(motion.y + (agent.y - motion.y) * 0.5 + (Math.random() - 0.5) * 3, 16, 78),
      action
    };
  });
  return next;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAgent(agent: Agent): Agent {
  return {
    ...agent,
    level: agent.level ?? Math.max(1, Math.round(agent.reputation / 12)),
    specialization: agent.specialization ?? `${agent.role} Operations`,
    traits: agent.traits ?? ["legacy", "stable", agent.role.toLowerCase()],
    currentMission: agent.currentMission ?? agent.status
  };
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="hud-panel rounded-lg p-3">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <h2 className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-cyanline">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function MissionStat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={`rounded border px-2 py-1 ${danger ? "border-blood/35 bg-blood/10 text-blood" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>
      <span className="block text-slate-500">{label}</span>
      <span className="block font-black">{value}</span>
    </div>
  );
}

function Resource({ label, value, tone }: { label: string; value: string; tone: "cyan" | "amber" | "mint" | "rose" }) {
  const tones = {
    cyan: "text-cyanline border-cyanline/30 bg-cyanline/10",
    amber: "text-amberline border-amberline/30 bg-amberline/10",
    mint: "text-mint border-mint/30 bg-mint/10",
    rose: "text-blood border-blood/30 bg-blood/10"
  };
  return (
    <div className={`rounded-md border px-3 py-2 ${tones[tone]}`}>
      <p className="font-mono text-[10px] uppercase text-slate-400">{label}</p>
      <p className="font-mono text-xl font-black">{value}</p>
    </div>
  );
}

function Bars({ agent }: { agent: Agent }) {
  return (
    <div className="space-y-2">
      <StatusBar label="Scrip" value={agent.scrip} max={160} color="#ffca63" />
      <StatusBar label="Reputation" value={agent.reputation} max={100} color="#79ffbf" />
      <StatusBar label="Compute" value={agent.compute} max={100} color="#45f6ff" />
    </div>
  );
}

function StatusBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between font-mono text-[10px] uppercase text-slate-400">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-white/10">
        <div className="h-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
      <p className="font-mono text-[10px] uppercase text-slate-500">{label}</p>
      <p className="mt-1 truncate font-mono text-lg font-black text-white">{value}</p>
    </div>
  );
}
