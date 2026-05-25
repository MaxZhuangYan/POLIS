"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { agents as seedAgents, initialEvents, mbtiDescriptions } from "@/app/data/polis";
import type { Agent, Conversation, DialogueLine, WorldEvent, MBTI } from "@/app/data/polis";
import { fallbackDialogue, fallbackChatReply } from "@/app/lib/sim";
import styles from "./styles.module.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type Action = "idle" | "walk" | "talk" | "work" | "sign" | "trade";
type Motion = { x: number; y: number; action: Action };
type Bubble = { agentId: string; text: string; expiresAt: number };

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY   = "polis-aiv-state-v3";
const PLAYER_KEY    = "polis-player-v1";
const LANGUAGE_KEY  = "polis-language-v1";
const LM_CONFIG_KEY = "polis-lm-config-v1";

const ACTIONS: Action[] = ["work", "trade", "talk", "walk", "sign", "idle"];
const ACTION_WEIGHTS   = [0.22, 0.18, 0.20, 0.22, 0.08, 0.10];

const BUILDINGS = [
  { id: "school",  label: "SCHOOL",  left: "47%", top: "23%", prefillEn: "Prioritize learning and skill development today", prefillZh: "今天专注学习和技能提升" },
  { id: "mine",    label: "MINE",    left: "70%", top: "31%", prefillEn: "Focus on mining and resource gathering today",     prefillZh: "今天专注矿场采集和资源积累" },
  { id: "office",  label: "OFFICE",  left: "79%", top: "79%", prefillEn: "Complete contracts and official work today",       prefillZh: "今天完成合约和官方工作" },
  { id: "home",    label: "HOME",    left: "37%", top: "75%", prefillEn: "Rest at home and recover energy today",           prefillZh: "今天在家休息恢复能量" },
  { id: "market",  label: "MARKET",  left: "20%", top: "58%", prefillEn: "Trade and negotiate at the market today",         prefillZh: "今天去市场交易和谈判" },
  { id: "archive", label: "ARCHIVE", left: "10%", top: "14%", prefillEn: "Research and archive knowledge today",            prefillZh: "今天研究和归档知识" },
] as const;

const TREES: [number, number, boolean][] = [
  [17, 25, true],  [25, 31, true],  [32, 20, true],
  [12, 65, false], [16, 78, false], [83, 26, true],
  [91, 20, false], [89, 58, true],  [62, 12, false], [8, 44, true],
];

const TOOLS = ["⌂", "📋", "👥", "🧠", "?"];

const EVENT_COLORS: Record<string, string> = {
  contract: "#ff9a18", social: "#c7ff7e", rule: "#45f6ff",
  culture: "#c4a8ff",  settlement: "white",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function nowTime(epoch: number) {
  return `E${epoch} ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}`;
}

function weightedAction(): Action {
  let r = Math.random();
  for (let i = 0; i < ACTIONS.length; i++) {
    r -= ACTION_WEIGHTS[i];
    if (r <= 0) return ACTIONS[i];
  }
  return "idle";
}

function normalizeAgent(a: Agent): Agent {
  return {
    ...a,
    level: a.level ?? 1,
    health:  a.health  ?? 88,
    energy:  a.energy  ?? 76,
    satiety: a.satiety ?? 68,
    promptTickets: a.promptTickets ?? (a.isPlayer ? 3 : 1),
  };
}

function agentWealth(a: Agent) { return a.scrip + a.reputation * 2 + Math.round(a.compute * 0.5); }

// ─── Component ────────────────────────────────────────────────────────────────

export default function AivPage() {
  const [agents,       setAgents]       = useState<Agent[]>(seedAgents.map(normalizeAgent));
  const [agentMotion,  setAgentMotion]  = useState<Record<string, Motion>>(() =>
    Object.fromEntries(seedAgents.map(a => [a.id, { x: a.x, y: a.y, action: "idle" as Action }]))
  );
  const [events,       setEvents]       = useState<WorldEvent[]>(initialEvents);
  const [conversations,setConversations]= useState<Conversation[]>([]);
  const [bubbles,      setBubbles]      = useState<Bubble[]>([]);
  const [epoch,        setEpoch]        = useState(12);
  const [isRunning,    setIsRunning]    = useState(true);
  const [gameMode,     setGameMode]     = useState<"game" | "data">("game");
  const [playerAgentId,setPlayerAgentId]= useState<string | null>(null);
  const [selectedId,   setSelectedId]   = useState<string>("mira");
  const [chatInput,    setChatInput]    = useState("");
  const [isSending,    setIsSending]    = useState(false);
  const [language,     setLanguage]     = useState<"en" | "zh">("en");
  const [currentTime,  setCurrentTime]  = useState("");
  const [lmMode,       setLmMode]       = useState<"local" | "lan">("local");
  const [lanIp,        setLanIp]        = useState("192.168.0.105");
  const [activeBldg,   setActiveBldg]   = useState<string | null>(null);
  const [activeTool,   setActiveTool]   = useState<number | null>(null);
  const [dataTab,      setDataTab]      = useState<"rank" | "agent">("rank");

  const agentsRef       = useRef(agents);
  const epochRef        = useRef(epoch);
  const playerIdRef     = useRef(playerAgentId);
  const motionRef       = useRef(agentMotion);
  const languageRef     = useRef(language);
  const isRunningRef    = useRef(isRunning);
  const lmModeRef       = useRef(lmMode);
  const lanIpRef        = useRef(lanIp);

  useEffect(() => { agentsRef.current    = agents;       }, [agents]);
  useEffect(() => { epochRef.current     = epoch;        }, [epoch]);
  useEffect(() => { playerIdRef.current  = playerAgentId;}, [playerAgentId]);
  useEffect(() => { motionRef.current    = agentMotion;  }, [agentMotion]);
  useEffect(() => { languageRef.current  = language;     }, [language]);
  useEffect(() => { isRunningRef.current = isRunning;    }, [isRunning]);
  useEffect(() => { lmModeRef.current    = lmMode;       }, [lmMode]);
  useEffect(() => { lanIpRef.current     = lanIp;        }, [lanIp]);

  // ── Load from localStorage ────────────────────────────────────────────────
  useEffect(() => {
    const savedLang = localStorage.getItem(LANGUAGE_KEY);
    if (savedLang === "en" || savedLang === "zh") setLanguage(savedLang);

    const savedLm = localStorage.getItem(LM_CONFIG_KEY);
    if (savedLm) {
      try {
        const c = JSON.parse(savedLm) as { lmMode?: "local" | "lan"; lanIp?: string };
        if (c.lmMode) setLmMode(c.lmMode);
        if (c.lanIp)  setLanIp(c.lanIp);
      } catch {}
    }

    const savedPlayer = localStorage.getItem(PLAYER_KEY);
    if (savedPlayer) {
      try {
        const p = JSON.parse(savedPlayer) as { agentId?: string };
        if (p.agentId) setPlayerAgentId(p.agentId);
      } catch {}
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const data = JSON.parse(saved) as {
        agents?: Agent[]; events?: WorldEvent[];
        epoch?: number; conversations?: Conversation[];
      };
      if (Array.isArray(data.agents) && data.agents.length > 0) {
        const normalized = data.agents.map(normalizeAgent);
        setAgents(normalized);
        agentsRef.current = normalized;
        const m = Object.fromEntries(
          normalized.map(a => [a.id, { x: a.x, y: a.y, action: "idle" as Action }])
        );
        setAgentMotion(m);
        motionRef.current = m;
        if (normalized[0]) setSelectedId(normalized[0].id);
      }
      if (Array.isArray(data.events))       setEvents(data.events.slice(0, 24));
      if (typeof data.epoch === "number") { setEpoch(data.epoch); epochRef.current = data.epoch; }
      if (Array.isArray(data.conversations)) setConversations(data.conversations.slice(0, 30));
    } catch {}
  }, []);

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = () => setCurrentTime(new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  // ── Speech bubble helper ──────────────────────────────────────────────────
  function addBubble(agentId: string, text: string) {
    const exp = Date.now() + 5200;
    setBubbles(cur => [
      ...cur.filter(b => b.agentId !== agentId && b.expiresAt > Date.now()),
      { agentId, text, expiresAt: exp }
    ].slice(-8));
    setTimeout(() => setBubbles(cur => cur.filter(b => !(b.agentId === agentId && b.expiresAt === exp))), 5300);
  }

  // ── Game loop: movement + economy ─────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!isRunningRef.current) return;
      const agts = agentsRef.current;
      const ep   = epochRef.current;
      const pid  = playerIdRef.current;

      const newMotion = { ...motionRef.current };
      const newAgents = agts.map(agent => {
        const action = agent.isPlayer || agent.id === pid
          ? (motionRef.current[agent.id]?.action ?? "walk")
          : weightedAction();

        const shouldMove = Math.random() < 0.65;
        const curX = motionRef.current[agent.id]?.x ?? agent.x;
        const curY = motionRef.current[agent.id]?.y ?? agent.y;
        const nx = shouldMove ? clamp(curX + (Math.random() - 0.5) * 9, 8, 92) : curX;
        const ny = shouldMove ? clamp(curY + (Math.random() - 0.5) * 9, 8, 92) : curY;

        newMotion[agent.id] = { x: nx, y: ny, action };

        const econDelta = action === "trade" ? 3 : action === "work" ? 2 : action === "sign" ? 1 : action === "idle" ? -1 : 0;
        const energyDelta = action === "idle" ? 6 : action === "walk" ? -2 : -3;

        return {
          ...agent,
          scrip:      clamp(agent.scrip + econDelta, 0, 500),
          compute:    clamp(agent.compute + (action === "work" ? 1 : -1), 0, 150),
          energy:     clamp((agent.energy  ?? 80) + energyDelta, 0, 100),
          satiety:    clamp((agent.satiety ?? 75) - 1, 0, 100),
          reputation: clamp(agent.reputation + (action === "talk" ? 1 : 0), 0, 100),
        };
      });

      setAgents(newAgents);
      agentsRef.current = newAgents;
      setAgentMotion({ ...newMotion });
      motionRef.current = { ...newMotion };
    }, 2800);
    return () => clearInterval(id);
  }, []);

  // ── Dialogue loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (!isRunningRef.current) return;
      const agts = agentsRef.current;
      if (agts.length < 2) return;
      const ep  = epochRef.current;
      const i   = Math.floor(Math.random() * agts.length);
      const agentA = agts[i];
      const agentB = agts[(i + 1) % agts.length];

      const fallback = fallbackDialogue(agentA, agentB, "Town");
      fallback.lines.forEach((line, li) => {
        const target = line.speaker === agentA.name ? agentA : agentB;
        setTimeout(() => addBubble(target.id, line.text), li * 2200);
      });

      const conv: Conversation = {
        id: `aiv-${Date.now()}`,
        time: nowTime(ep),
        agentIds: [agentA.id, agentB.id],
        lines: fallback.lines,
        location: "Town",
      };
      setConversations(cur => [conv, ...cur].slice(0, 30));

      // Also try LLM
      const endpoint = lmModeRef.current === "local"
        ? "http://127.0.0.1:1234/v1/chat/completions"
        : `http://${lanIpRef.current}/v1/chat/completions`;

      void fetch("/api/agent-dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentA, agentB, location: "Town", epoch: ep, lang: languageRef.current, endpoint }),
      }).then(async r => {
        if (!r.ok) return;
        const data = await r.json() as { lines?: Array<{ speaker: string; text: string }> };
        if (data.lines?.length) {
          data.lines.forEach((line, li) => {
            const target = line.speaker === agentA.name ? agentA : agentB;
            setTimeout(() => addBubble(target.id, line.text), li * 2200);
          });
        }
      }).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const playerAgent  = agents.find(a => a.isPlayer || a.id === playerAgentId);
  const selectedAgent = agents.find(a => a.id === selectedId) ?? agents[0] ?? seedAgents[0];
  const displayAgent  = gameMode === "game" ? (playerAgent ?? selectedAgent) : selectedAgent;
  const leaderboard   = [...agents].sort((a, b) => agentWealth(b) - agentWealth(a));

  const marketPrices = [
    { emoji: "🍎", price: +(12  + epoch * 0.28).toFixed(2) },
    { emoji: "🪵", price: +(18  + epoch * 0.52).toFixed(2) },
    { emoji: "🧱", price: +(24  + epoch * 0.68).toFixed(2) },
    { emoji: "📦", price: +(31  + epoch * 0.44).toFixed(2) },
    { emoji: "⚡", price: +(45  + epoch * 1.18).toFixed(2) },
  ];

  // ── Player chat ───────────────────────────────────────────────────────────
  async function sendChat() {
    if (!chatInput.trim() || !playerAgent || isSending) return;
    const msg = chatInput.trim();
    setChatInput("");
    setIsSending(true);

    const fallback = fallbackChatReply(playerAgent, msg);
    let reply = fallback.reply;
    try {
      const endpoint = lmMode === "local"
        ? "http://127.0.0.1:1234/v1/chat/completions"
        : `http://${lanIp}/v1/chat/completions`;
      const resp = await fetch("/api/agent-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: playerAgent, playerMessage: msg, worldContext: `Epoch ${epoch}`, epoch, lang: language, endpoint }),
      });
      if (resp.ok) {
        const data = await resp.json() as { reply: string };
        if (data.reply) reply = data.reply;
      }
    } catch {}

    addBubble(playerAgent.id, reply.slice(0, 60));
    setConversations(cur => [{
      id: `chat-${Date.now()}`,
      time: nowTime(epoch),
      agentIds: ["player", playerAgent.id] as [string, string],
      lines: [{ speaker: "You", text: msg }, { speaker: playerAgent.name, text: reply }],
      location: "Direct",
    }, ...cur].slice(0, 30));
    setAgents(cur => cur.map(a =>
      a.id === playerAgent.id ? { ...a, thoughts: reply, status: `Following: ${msg.slice(0, 32)}` } : a
    ));
    setIsSending(false);
  }

  // ── Settle epoch ──────────────────────────────────────────────────────────
  function settleEpoch() {
    const next = epochRef.current + 1;
    setEpoch(next);
    epochRef.current = next;
    setAgents(cur => {
      const updated = cur.map(a => ({
        ...a,
        scrip:      clamp(a.scrip + Math.floor(a.scrip * 0.08), 0, 500),
        energy:     clamp((a.energy  ?? 80) + 12, 0, 100),
        satiety:    clamp((a.satiety ?? 75) + 8,  0, 100),
        promptTickets: a.isPlayer ? Math.min(5, (a.promptTickets ?? 0) + 2) : a.promptTickets,
      }));
      agentsRef.current = updated;
      return updated;
    });
    setEvents(cur => [{
      id: `settle-${Date.now()}`, time: nowTime(next),
      kind: "settlement" as const, text: `Epoch ${next} settled. Dividends distributed.`,
    }, ...cur].slice(0, 24));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={styles.screen}>

      {/* ── World ── */}
      <div className={styles.world}>

        {/* Roads */}
        <div className={`${styles.road} ${styles.roadH1}`} />
        <div className={`${styles.road} ${styles.roadH2}`} />
        <div className={`${styles.road} ${styles.roadV1}`} />
        <div className={`${styles.road} ${styles.roadV2}`} />

        {/* Fields */}
        <div className={`${styles.field} ${styles.fieldF1}`} />
        <div className={`${styles.field} ${styles.fieldF2}`} />
        <div className={`${styles.field} ${styles.fieldF3}`} />

        {/* Trees */}
        {TREES.map(([lft, tp, isApple], i) => (
          <div
            key={i}
            className={styles.treeWrap}
            style={{ left: `${lft}%`, top: `${tp}%`, position: "absolute", transform: "translate(-50%,-50%)", zIndex: 3 }}
          >
            <Image
              src={`/assets/aiv/${isApple ? "tree-apple" : "tree-regular"}.png`}
              alt="tree"
              width={44}
              height={58}
              style={{ imageRendering: "pixelated" }}
              unoptimized
            />
          </div>
        ))}

        {/* Buildings */}
        {BUILDINGS.map(b => (
          <div key={b.id} className={styles.building} style={{ left: b.left, top: b.top }}>
            <Image
              src={`/assets/aiv/building-${b.id}.png`}
              alt={b.label}
              width={90}
              height={90}
              style={{ imageRendering: "pixelated", display: "block" }}
              unoptimized
            />
            <span
              className={`${styles.sign}${activeBldg === b.id ? ` ${styles.signActive}` : ""}`}
              onClick={() => {
                setActiveBldg(prev => prev === b.id ? null : b.id);
                setChatInput(language === "zh" ? b.prefillZh : b.prefillEn);
              }}
            >
              {b.label}
            </span>
          </div>
        ))}

        {/* NPCs (agents) */}
        {agents.map(agent => {
          const motion = agentMotion[agent.id] ?? { x: agent.x, y: agent.y, action: "idle" };
          const bubble = bubbles.find(b => b.agentId === agent.id);
          const isPlayer = agent.isPlayer || agent.id === playerAgentId;

          return (
            <div
              key={agent.id}
              className={`${styles.npc} ${agent.id === selectedId ? styles.npcSelected : ""}`}
              style={{ left: `${motion.x}%`, top: `${motion.y}%`, cursor: "pointer" }}
              onClick={() => setSelectedId(agent.id)}
            >
              <Image
                src={`/assets/aiv/npc-${isPlayer ? "player" : agent.role.toLowerCase()}.png`}
                alt={agent.name}
                width={30}
                height={48}
                style={{ imageRendering: "pixelated", display: "block" }}
                unoptimized
              />
              {isPlayer && <div className={styles.youBadge}>YOU</div>}
              {bubble && (
                <div className={styles.speech} style={{ left: "110%", top: "-52px" }}>
                  <span className={styles.speechName}>{agent.name.split(" ")[0]}</span>
                  {bubble.text.slice(0, 62)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Top-left: Avatar + Stats ── */}
      <div className={styles.topLeft}>
        <div className={styles.avatarCard}>
          <div className={styles.avatarFace} />
        </div>
        <div className={styles.statsPanel}>
          <div className={styles.nameLine}>
            <span>{displayAgent.name.split(" ")[0]}</span>
            <span className={styles.nameLevel}>Lv{displayAgent.level}</span>
          </div>
          {([
            { icon: "♥", val: displayAgent.health  ?? 88, max: 100, color: "#7cff5d" },
            { icon: "⚡", val: displayAgent.energy  ?? 80, max: 100, color: "#ffb13a" },
            { icon: "●", val: displayAgent.satiety ?? 75, max: 100, color: "#8bd6ff" },
          ] as const).map(stat => (
            <div key={stat.icon} className={styles.statLine}>
              <span className={styles.statIcon}>{stat.icon}</span>
              <div className={styles.statBar}>
                <div
                  className={styles.statFill}
                  style={{ width: `${stat.val}%`, background: stat.color, color: stat.color }}
                />
              </div>
              <span className={styles.statValue}>{stat.val}</span>
            </div>
          ))}
          <div className={styles.wallet}>
            <span>◎ {displayAgent.scrip}</span>
            <span>▰ {displayAgent.compute}</span>
          </div>
        </div>
      </div>

      {/* ── Mode HUD (center top) ── */}
      <div className={styles.modeHud}>
        <div
          className={`${styles.modePill}${gameMode === "data" ? ` ${styles.modePillData}` : ""}`}
          onClick={() => setGameMode(m => m === "game" ? "data" : "game")}
        >
          <div className={styles.modeIcon}>{gameMode === "game" ? "🎮" : "📊"}</div>
          <div>{gameMode === "game" ? "GAME" : "DATA"}</div>
        </div>
        <div className={styles.modeControls}>
          <button className={styles.ctrlBtn} title="Settle epoch" onClick={settleEpoch}>⟳</button>
          <button className={styles.ctrlBtn} title="Pause / Run" onClick={() => setIsRunning(r => !r)}>
            {isRunning ? "⏸" : "▶"}
          </button>
          <button className={styles.ctrlBtn} title="Toggle language" onClick={() => {
            setLanguage(l => l === "en" ? "zh" : "en");
            localStorage.setItem(LANGUAGE_KEY, language === "en" ? "zh" : "en");
          }}>
            {language === "en" ? "中" : "EN"}
          </button>
        </div>
      </div>

      {/* ── Action HUD ── */}
      {playerAgent && (
        <div className={styles.actionHud}>
          <div className={styles.actionTitle}>
            <span>{(agentMotion[playerAgent.id]?.action ?? "idle").toUpperCase()}</span>
            <span>🎟 ×{playerAgent.promptTickets ?? 0}</span>
          </div>
          <div className={styles.progressBar}>
            <span className={styles.progressFill} style={{ width: `${playerAgent.energy ?? 80}%` }} />
          </div>
          <div className={styles.actionTime}>{playerAgent.status.slice(0, 28)}</div>
        </div>
      )}

      {/* ── Day HUD (top-right) ── */}
      <div className={styles.dayHud}>
        <div className={styles.dayLabel}>{language === "zh" ? "纪元" : "DAY"}</div>
        <div className={styles.dayNum}>{epoch}</div>
        <div className={styles.dayTime}>{currentTime || "00:00"}</div>
      </div>

      {/* ── Right toolbar ── */}
      <div className={styles.rightToolbar}>
        <div className={styles.lvBadge}>Lv{displayAgent.level}</div>
        {TOOLS.map((icon, i) => (
          <div key={i} className={styles.toolRow}>
            <div className={styles.toolDots} />
            <button
              className={`${styles.tool}${activeTool === i ? ` ${styles.toolActive}` : ""}`}
              onClick={() => setActiveTool(prev => prev === i ? null : i)}
              title={["Home", "Diary", "Relations", "Thoughts", "Help"][i]}
            >
              {icon}
            </button>
          </div>
        ))}
      </div>

      {/* ── Tool panel (floats left of toolbar) ── */}
      {activeTool !== null && (
        <div className={styles.toolPanel}>
          {/* ⌂ Home / Stats */}
          {activeTool === 0 && (
            <>
              <div className={styles.toolPanelTitle}>
                {language === "zh" ? "⌂ 我的状态" : "⌂ Home Stats"}
              </div>
              {([
                { label: language === "zh" ? "贡献券" : "Scrip",    val: displayAgent.scrip,         max: 200,  color: "#ffca63" },
                { label: language === "zh" ? "声望"   : "Rep",      val: displayAgent.reputation,    max: 100,  color: "#79ffbf" },
                { label: language === "zh" ? "算力"   : "Compute",  val: displayAgent.compute,       max: 120,  color: "#45f6ff" },
                { label: language === "zh" ? "健康"   : "Health",   val: displayAgent.health  ?? 88, max: 100,  color: "#ff5c7a" },
                { label: language === "zh" ? "能量"   : "Energy",   val: displayAgent.energy  ?? 80, max: 100,  color: "#ffb13a" },
                { label: language === "zh" ? "饱食"   : "Satiety",  val: displayAgent.satiety ?? 75, max: 100,  color: "#8bd6ff" },
              ] as const).map(row => (
                <div key={row.label}>
                  <div className={styles.toolPanelRow}>
                    <span>{row.label}</span><b>{row.val}</b>
                  </div>
                  <div className={styles.toolPanelBar}>
                    <div className={styles.toolPanelFill} style={{ width: `${Math.min(100,(row.val/row.max)*100)}%`, background: row.color }} />
                  </div>
                </div>
              ))}
              <div className={styles.toolPanelRow} style={{ marginTop: 6 }}>
                <span>{language === "zh" ? "等级" : "Level"}</span>
                <b>Lv{displayAgent.level}</b>
              </div>
              <div className={styles.toolPanelRow}>
                <span>MBTI</span>
                <b>{displayAgent.mbti}</b>
              </div>
              <div className={styles.toolPanelRow}>
                <span>{language === "zh" ? "专长" : "Role"}</span>
                <b>{displayAgent.role}</b>
              </div>
            </>
          )}

          {/* 📋 Diary / Conversations */}
          {activeTool === 1 && (
            <>
              <div className={styles.toolPanelTitle}>
                {language === "zh" ? "📋 最近对话" : "📋 Diary"}
              </div>
              {conversations.length === 0 && (
                <p style={{ color: "#888", fontSize: 11 }}>
                  {language === "zh" ? "暂无对话记录。" : "No conversations yet."}
                </p>
              )}
              {conversations.slice(0, 6).map(conv => (
                <div key={conv.id} className={styles.toolPanelConv}>
                  <div className={styles.toolPanelConvName}>{conv.time} · {conv.location}</div>
                  {conv.lines[0] && <div>{conv.lines[0].speaker}: {conv.lines[0].text.slice(0, 48)}</div>}
                  {conv.lines[1] && <div style={{ color: "#aaa" }}>{conv.lines[1].speaker}: {conv.lines[1].text.slice(0, 48)}</div>}
                </div>
              ))}
            </>
          )}

          {/* 👥 Relations */}
          {activeTool === 2 && (
            <>
              <div className={styles.toolPanelTitle}>
                {language === "zh" ? "👥 关系网络" : "👥 Relations"}
              </div>
              {Object.entries(displayAgent.affinity).length === 0 && (
                <p style={{ color: "#888", fontSize: 11 }}>
                  {language === "zh" ? "暂无关系数据。" : "No relationships yet."}
                </p>
              )}
              {Object.entries(displayAgent.affinity)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([id, val]) => {
                  const peer = agents.find(a => a.id === id);
                  return (
                    <div key={id} className={styles.toolPanelRelRow}>
                      <span style={{ minWidth: 60, color: val >= 7 ? "#79ffbf" : val <= 3 ? "#ff5c7a" : "white" }}>
                        {peer?.name.split(" ")[0] ?? id}
                      </span>
                      <div className={styles.toolPanelRelBar}>
                        <div className={styles.toolPanelRelFill} style={{
                          width: `${val * 10}%`,
                          background: val >= 7 ? "#79ffbf" : val <= 3 ? "#ff5c7a" : "#45f6ff"
                        }} />
                      </div>
                      <span style={{ minWidth: 22, textAlign: "right", color: "#888" }}>{val}/10</span>
                    </div>
                  );
                })}
            </>
          )}

          {/* 🧠 Thoughts */}
          {activeTool === 3 && (
            <>
              <div className={styles.toolPanelTitle}>
                {language === "zh" ? "🧠 当前想法" : "🧠 Thoughts"}
              </div>
              <div className={styles.toolPanelConv}>
                <div className={styles.toolPanelConvName}>{language === "zh" ? "任务" : "Mission"}</div>
                <div>{displayAgent.currentMission}</div>
              </div>
              <div className={styles.toolPanelConv}>
                <div className={styles.toolPanelConvName}>{language === "zh" ? "状态" : "Status"}</div>
                <div>{displayAgent.status}</div>
              </div>
              {displayAgent.thoughts && (
                <div className={styles.toolPanelConv}>
                  <div className={styles.toolPanelConvName}>{language === "zh" ? "内心独白" : "Inner Voice"}</div>
                  <div>{displayAgent.thoughts}</div>
                </div>
              )}
              {displayAgent.dailyPlan && (
                <div className={styles.toolPanelConv}>
                  <div className={styles.toolPanelConvName}>{language === "zh" ? "今日计划" : "Daily Plan"}</div>
                  <div>{displayAgent.dailyPlan}</div>
                </div>
              )}
            </>
          )}

          {/* ? Help */}
          {activeTool === 4 && (
            <>
              <div className={styles.toolPanelTitle}>
                {language === "zh" ? "? 操作说明" : "? Help"}
              </div>
              <div className={styles.toolPanelHelp}>
                {language === "zh" ? (
                  <>
                    <b>⌂ 点击建筑</b>预填今日计划输入框，发送给你的角色。
                    <b>🎟 Prompt 票券</b>有票时发送消息会优先消耗票券，产生更强效果。
                    <b>⟳ 纪元结算</b>触发经济结算，回复能量，增加票券。
                    <b>📊 Data Mode</b>切换观察模式，查看排名、价格和关系。
                    <b>点击 NPC</b>选中角色，查看其详细状态。
                    <b>← POLIS</b>返回原版赛博朋克 UI。
                  </>
                ) : (
                  <>
                    <b>⌂ Click a building</b> to prefill the chat with a daily plan prompt.
                    <b>🎟 Prompt Tickets</b> are consumed when you send with tickets, giving stronger effects.
                    <b>⟳ Settle Epoch</b> triggers economic settlement, restores energy, adds tickets.
                    <b>📊 Data Mode</b> shows rankings, prices, and agent relationships.
                    <b>Click an NPC</b> to select and inspect that agent.
                    <b>← POLIS</b> returns to the cyberpunk UI.
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Left event feed ── */}
      <div className={styles.leftFeed}>
        {events.slice(0, 7).map(ev => (
          <div key={ev.id} className={styles.feedLine}>
            <b style={{ color: EVENT_COLORS[ev.kind] ?? "white" }}>
              {ev.kind.charAt(0).toUpperCase() + ev.kind.slice(1)}:
            </b>{" "}
            {ev.text.slice(0, 54)}
          </div>
        ))}
      </div>

      {/* ── Bottom chat ── */}
      <div className={styles.bottomChat}>
        <div className={styles.chatMenu}>⌨</div>
        <input
          className={styles.chatInputEl}
          placeholder={
            playerAgent
              ? (language === "zh"
                  ? `输入消息给 ${playerAgent.name.split(" ")[0]}…`
                  : `Message ${playerAgent.name.split(" ")[0]}…`)
              : (language === "zh" ? "返回主页创建角色…" : "Go to / to create your agent…")
          }
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendChat()}
          disabled={!playerAgent || isSending}
        />
        {playerAgent && (playerAgent.promptTickets ?? 0) > 0 && (
          <div className={styles.ticketWrap}>
            🎟️
            <span className={styles.ticketNum}>{playerAgent.promptTickets}</span>
          </div>
        )}
        <button
          className={styles.sendBtn}
          onClick={sendChat}
          disabled={!chatInput.trim() || !playerAgent || isSending}
        >
          {isSending ? "…" : (language === "zh" ? "发送" : "Send")}
        </button>
      </div>

      {/* ── Mini-map ── */}
      <div className={styles.minimap}>
        <div className={styles.mapPaper} />
        <div className={styles.mapPin}>📍</div>
      </div>

      {/* ── Back to Polis link ── */}
      <Link href="/" className={styles.backLink}>
        ←<br />POLIS
      </Link>

      {/* ── Data mode overlay ── */}
      {gameMode === "data" && (
        <div className={styles.dataOverlay}>

          {/* Rank panel */}
          <div className={styles.rankPanel}>
            <div className={styles.tabs}>
              <div
                className={`${styles.tab}${dataTab === "rank" ? ` ${styles.tabActive}` : ""}`}
                onClick={() => setDataTab("rank")}
              >
                {language === "zh" ? "排名" : "RANK"}
              </div>
              <div
                className={`${styles.tab}${dataTab === "agent" ? ` ${styles.tabActive}` : ""}`}
                onClick={() => setDataTab("agent")}
              >
                {language === "zh" ? "智能体" : "AGENT"}
              </div>
            </div>

            {/* RANK tab */}
            {dataTab === "rank" && leaderboard.slice(0, 6).map((agent, i) => (
              <div
                key={agent.id}
                className={styles.rankItem}
                onClick={() => { setSelectedId(agent.id); setGameMode("game"); }}
              >
                <div className={styles.rankIndex}>{i + 1}</div>
                <div className={styles.rankAvatar} />
                <div>
                  <span className={styles.rankName}>{agent.name.split(" ")[0]}</span>
                  <span className={styles.rankSub}>{agentWealth(agent)} pts</span>
                </div>
              </div>
            ))}

            {/* AGENT tab */}
            {dataTab === "agent" && agents.map(agent => (
              <div
                key={agent.id}
                className={styles.rankItem}
                style={agent.id === selectedId ? { background: "#b8ff19" } : {}}
                onClick={() => setSelectedId(agent.id)}
              >
                <div className={styles.rankAvatar} />
                <div style={{ gridColumn: "2 / 4" }}>
                  <span className={styles.rankName}>{agent.name.split(" ")[0]}</span>
                  <span className={styles.rankSub}>
                    {agent.role} · {(agentMotion[agent.id]?.action ?? "idle").toUpperCase()}
                  </span>
                  <span className={styles.rankSub}>
                    ◎{agent.scrip} ▰{agent.compute} ♥{agent.health ?? 88}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Price panel */}
          <div className={styles.pricePanel}>
            <div style={{ fontSize: 10, fontWeight: 900, marginBottom: 8, color: "#69ff2d" }}>
              {language === "zh" ? "市场价格" : "MARKET PRICES"}
            </div>
            {marketPrices.map((p, i) => (
              <div key={i} className={styles.priceRow}>
                <span>{p.emoji}</span>
                <span className={styles.priceVal}>{p.price} ◎</span>
              </div>
            ))}
          </div>

          {/* Center banner */}
          <div className={styles.centerBanner}>
            {language === "zh" ? "DATA MODE · 关系 · 价格 · 排名" : "DATA MODE · RELATIONS · PRICES · RANKS"}
          </div>

          {/* Conversation bubbles */}
          <div className={styles.dialogues}>
            {conversations.slice(0, 3).map((conv, i) => (
              <div
                key={conv.id}
                className={`${styles.dBubble}${i % 2 === 1 ? ` ${styles.dBubbleMine}` : ""}`}
              >
                {conv.lines[0] ? `${conv.lines[0].speaker}: ${conv.lines[0].text.slice(0, 55)}` : ""}
              </div>
            ))}
          </div>

          {/* Agent carousel */}
          <div className={styles.agentCarousel}>
            {agents.map(agent => (
              <div
                key={agent.id}
                className={`${styles.agentCard}${agent.id === selectedId ? ` ${styles.agentCardSelected}` : ""}`}
                onClick={() => setSelectedId(agent.id)}
              >
                <div className={styles.miniFace} />
                {agent.name.split(" ")[0]}
              </div>
            ))}
          </div>

          {/* Think panel */}
          <div className={styles.thinkPanel}>
            <div className={styles.thinkTitle}>{selectedAgent.name}</div>
            <p>
              <span className={styles.thinkHighlight}>
                {language === "zh" ? "状态：" : "Status:"}
              </span>{" "}
              {selectedAgent.status.slice(0, 65)}
            </p>
            <p>
              <span className={styles.thinkHighlight}>
                {language === "zh" ? "任务：" : "Mission:"}
              </span>{" "}
              {selectedAgent.currentMission.slice(0, 65)}
            </p>
            {selectedAgent.thoughts && (
              <p>
                <span className={styles.thinkHighlight}>
                  {language === "zh" ? "想法：" : "Thoughts:"}
                </span>{" "}
                {selectedAgent.thoughts.slice(0, 85)}
              </p>
            )}
            <p style={{ marginTop: 12, color: "#888", fontSize: 10 }}>
              {language === "zh"
                ? `贡献券 ${selectedAgent.scrip} · 声望 ${selectedAgent.reputation} · 算力 ${selectedAgent.compute}`
                : `Scrip ${selectedAgent.scrip} · Rep ${selectedAgent.reputation} · CPU ${selectedAgent.compute}`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
