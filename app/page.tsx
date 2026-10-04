"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Agent = {
  id: string;
  name: string;
  reputation: number;
  scrip: number;
  current_location: string;
  state: string;
};

type Task = {
  id: number;
  type: string;
  reward: number;
  status: string;
  taken_by: string | null;
};

type WorldState = {
  tick: number;
  isRunning: boolean;
  agents: Agent[];
  tasks: Task[];
  totalBurn: number;
};

export default function HomePage() {
  const [state, setState] = useState<WorldState | null>(null);

  async function fetchState() {
    const res = await fetch("/api/world/state");
    const data = (await res.json()) as WorldState;
    setState(data);
  }

  useEffect(() => {
    fetchState();
    const timer = setInterval(fetchState, 2000);
    return () => clearInterval(timer);
  }, []);

  async function toggleClock() {
    if (!state) return;
    await fetch(state.isRunning ? "/api/world/pause" : "/api/world/start", { method: "POST" });
    fetchState();
  }

  if (!state) {
    return <main style={{ padding: "2rem" }}>Loading...</main>;
  }

  const tasksByStatus = {
    open: state.tasks.filter((t) => t.status === "open"),
    taken: state.tasks.filter((t) => t.status === "taken"),
    done: state.tasks.filter((t) => t.status === "done"),
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>Polis — Phase 0</h1>

      <p>
        <Link href="/agent">My Agent</Link>
      </p>

      <section style={{ margin: "1.5rem 0" }}>
        <div style={{ fontSize: "2rem" }}>Tick: {state.tick}</div>
        <button onClick={toggleClock} style={{ padding: "0.5rem 1rem", marginTop: "0.5rem" }}>
          {state.isRunning ? "Pause" : "Start"}
        </button>
        <div style={{ marginTop: "0.5rem" }}>Total Scrip Burned: {state.totalBurn}</div>
      </section>

      <section style={{ margin: "1.5rem 0" }}>
        <h2>Agents</h2>
        <ul>
          {state.agents.map((a) => (
            <li key={a.id}>
              {a.name} — {a.state} @ {a.current_location} — {a.scrip} scrip
            </li>
          ))}
        </ul>
      </section>

      <section style={{ margin: "1.5rem 0" }}>
        <h2>Tasks</h2>
        {(["open", "taken", "done"] as const).map((status) => (
          <div key={status} style={{ marginBottom: "0.75rem" }}>
            <strong>{status}</strong>
            <ul>
              {tasksByStatus[status].map((t) => (
                <li key={t.id}>
                  #{t.id} {t.type} — reward {t.reward} {t.taken_by ? `(by ${t.taken_by})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}
