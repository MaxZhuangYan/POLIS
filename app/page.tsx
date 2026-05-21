"use client";

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

const roleColors: Record<Agent["role"], string> = {
  Architect: "#45f6ff",
  Broker: "#ffca63",
  Scout: "#79ffbf",
  Mediator: "#ff6f91",
  Archivist: "#b7a7ff",
  Maker: "#ff9f6e"
};

const STORAGE_KEY = "polis-demo-state-v1";

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>(seedAgents);
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

  useEffect(() => {
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
      setAgents(state.agents);
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
    }, 4600);
    return () => window.clearInterval(timer);
  }, [agents, epoch, isRunning]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? agents[0],
    [agents, selectedId]
  );
  const mission = missions.find((item) => item.id === selectedMission) ?? missions[0];

  async function runMission(targetMission: Mission = mission) {
    const fallback = fallbackSimulation(selectedAgent, targetMission, epoch);
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
    setAgents((current) =>
      current.map((agent) =>
        agent.id === selectedAgent.id
          ? {
              ...agent,
              scrip: agent.scrip + result.delta.scrip,
              reputation: Math.min(100, agent.reputation + result.delta.reputation),
              compute: Math.max(0, agent.compute + result.delta.compute),
              status: `Completed ${targetMission.title}`,
              intent: "Awaiting next contract after ledger settlement"
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
      scrip: 60,
      reputation: 45,
      compute: 80,
      affinity: { [selectedAgent.id]: 5 }
    };
    setAgents((current) => [...current, newAgent]);
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
    setSelectedId("mira");
    setEvents(initialEvents);
    setWorkLog(["[reset] Polis restored to initial civic state.", "[world] Epoch 12 restarted."]);
    setSettlement({ scrip: 943, reputation: 631, compute: 512, contribution: 188 });
    setEpoch(12);
    setSource("idle");
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
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyanline/75">AI contract civilization prototype</p>
            <h1 className="mt-1 font-display text-3xl font-black uppercase text-white sm:text-5xl">POLIS</h1>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[620px]">
            <Resource label="Epoch" value={epoch.toString()} tone="cyan" />
            <Resource label="Scrip" value={settlement.scrip.toString()} tone="amber" />
            <Resource label="Reputation" value={settlement.reputation.toString()} tone="mint" />
            <Resource label="Compute" value={settlement.compute.toString()} tone="rose" />
          </div>
        </header>

        <section className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(560px,1fr)_390px]">
          <aside className="flex flex-col gap-4">
            <Panel title="Agent Lab" action={<button className="hud-button" onClick={createAgent}>+ Agent</button>}>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="pixel-block grid h-14 w-14 place-items-center border border-cyanline/40 bg-cyanline/10 font-mono text-lg font-bold text-cyanline">
                    {selectedAgent.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{selectedAgent.name}</h2>
                    <p className="font-mono text-xs uppercase text-slate-400">{selectedAgent.role}</p>
                  </div>
                </div>
                <p className="text-sm leading-6 text-slate-300">{selectedAgent.intent}</p>
                <Bars agent={selectedAgent} />
              </div>
            </Panel>

            <Panel title="Roster">
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
                      <span className="font-semibold">{agent.name}</span>
                      <span className="font-mono text-[10px] uppercase" style={{ color: roleColors[agent.role] }}>
                        {agent.role}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">{agent.status}</p>
                  </button>
                ))}
              </div>
            </Panel>
          </aside>

          <section className="flex flex-col gap-4">
            <Panel
              title="Society Space"
              action={
                <div className="flex gap-2">
                  <button className="hud-button" onClick={() => setIsRunning((value) => !value)}>
                    {isRunning ? "Pause" : "Run"}
                  </button>
                  <button className="hud-button" onClick={resetDemo}>Reset</button>
                </div>
              }
            >
              <div className="map-grid relative h-[530px] overflow-hidden rounded-md border border-cyanline/15">
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {agents.flatMap((agent) =>
                    Object.keys(agent.affinity).map((targetId) => {
                      const target = agents.find((item) => item.id === targetId);
                      if (!target) return null;
                      return (
                        <line
                          key={`${agent.id}-${targetId}`}
                          x1={agent.x}
                          y1={agent.y}
                          x2={target.x}
                          y2={target.y}
                          stroke="rgba(69,246,255,.18)"
                          strokeWidth="0.25"
                        />
                      );
                    })
                  )}
                </svg>
                <div className="absolute left-[8%] top-[10%] h-[26%] w-[31%] border border-cyanline/20 bg-cyanline/[0.04]" />
                <div className="absolute bottom-[11%] left-[15%] h-[21%] w-[28%] border border-amberline/20 bg-amberline/[0.05]" />
                <div className="absolute right-[9%] top-[18%] h-[55%] w-[25%] border border-mint/20 bg-mint/[0.04]" />
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedId(agent.id)}
                    className={`absolute grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-sm border font-mono text-[10px] font-black shadow-glow transition ${
                      agent.id === selectedId ? "scale-125 border-white bg-white text-void" : "border-white/30 bg-void/80 text-white"
                    }`}
                    style={{ left: `${agent.x}%`, top: `${agent.y}%`, boxShadow: `0 0 22px ${roleColors[agent.role]}55` }}
                    title={`${agent.name} - ${agent.role}`}
                  >
                    {agent.name.slice(0, 2).toUpperCase()}
                  </button>
                ))}
                <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-2">
                  {Object.entries(roleColors).map(([role, color]) => (
                    <span key={role} className="rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] uppercase text-slate-300">
                      <span className="mr-1 inline-block h-2 w-2" style={{ background: color }} />
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <Panel title="Relationship Graph">
                <div className="space-y-3">
                  {Object.entries(selectedAgent.affinity).map(([id, value]) => {
                    const peer = agents.find((item) => item.id === id);
                    return (
                      <div key={id}>
                        <div className="mb-1 flex justify-between text-xs text-slate-300">
                          <span>{peer?.name ?? id}</span>
                          <span>{value}/10 trust</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded bg-white/10">
                          <div className="h-full bg-cyanline" style={{ width: `${value * 10}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Panel>
              <Panel title="Epoch Settlement">
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Contribution" value={settlement.contribution} />
                  <Metric label="Open Agents" value={agents.length} />
                  <Metric label="Active Contracts" value={missions.length + 2} />
                  <Metric label="Log Source" value={source === "idle" ? "ready" : source} />
                </div>
                <button className="mt-4 w-full rounded-md border border-amberline/50 bg-amberline/10 px-3 py-2 font-mono text-xs uppercase text-amberline hover:bg-amberline/20" onClick={settleEpoch}>
                  Settle Epoch
                </button>
              </Panel>
            </div>
          </section>

          <aside className="flex flex-col gap-4">
            <Panel title="Mission Board">
              <div className="space-y-3">
                {missions.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedMission(item.id)}
                    className={`w-full rounded-md border p-3 text-left ${
                      selectedMission === item.id ? "border-amberline/70 bg-amberline/10" : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-bold">{item.title}</h3>
                      <span className="font-mono text-xs text-amberline">+{item.reward}</span>
                    </div>
                    <p className="mt-1 text-xs uppercase text-slate-500">{item.sector} / risk {item.difficulty}</p>
                    <p className="mt-2 text-sm leading-5 text-slate-300">{item.brief}</p>
                  </button>
                ))}
                <button className="w-full rounded-md border border-cyanline/60 bg-cyanline/10 px-4 py-3 font-mono text-xs uppercase text-cyanline hover:bg-cyanline/20" onClick={() => runMission()}>
                  Dispatch Selected Agent
                </button>
              </div>
            </Panel>

            <Panel title="World Feed">
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

            <Panel title="Work Log Terminal">
              <div className="terminal h-[260px] overflow-auto rounded-md p-3 font-mono text-xs leading-5 text-mint">
                {workLog.map((line, index) => (
                  <p key={`${line}-${index}`} className="border-b border-mint/5 py-1">
                    {line}
                  </p>
                ))}
              </div>
            </Panel>
          </aside>
        </section>
      </div>
    </main>
  );
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
