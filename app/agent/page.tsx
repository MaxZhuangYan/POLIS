"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type AgentRow = {
  id: string;
  name: string;
  personality: string;
  reputation: number;
  scrip: number;
  current_location: string;
  state: string;
  mbti: string;
  is_player: boolean;
};

type DecisionOption = {
  id: string;
  label: string;
  fallbackPrinciple: string;
};

type DecisionMoment = {
  id: string;
  agent_id: string;
  type: "trust" | "risk" | "integrity";
  template_id: string;
  prompt_text: string;
  options: DecisionOption[];
  counterparty_id: string | null;
  created_at: string;
  expires_at: string;
  status: "pending" | "expired_autonomous" | "decided";
  player_choice: string | null;
  autonomous_choice: string | null;
};

type PrincipleRow = {
  id: string;
  agent_id: string;
  text: string;
  domain: "trust" | "risk" | "integrity";
  weight: number;
  source_decision_id: string | null;
  source: "llm" | "fallback";
  last_cited_at: string | null;
  last_decayed_at: string | null;
  created_at: string;
};

type WaveringEventRow = {
  id: string;
  agent_id: string;
  principle_id: string;
  prompt_text: string;
  created_at: string;
  status: "pending" | "resolved";
  resolution: "reaffirm" | "revise" | null;
  revised_text: string | null;
  resolved_at: string | null;
};

const MBTI_TYPES = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP",
];

const DOMAIN_COLORS: Record<string, string> = {
  trust: "#2a6",
  risk: "#c63",
  integrity: "#36c",
};

function optionLabel(options: DecisionOption[], optionId: string | null): string {
  if (!optionId) return "(none)";
  const match = options.find((o) => o.id === optionId);
  return match ? match.label : optionId;
}

export default function AgentPage() {
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(true);
  const [moments, setMoments] = useState<DecisionMoment[]>([]);
  const [principles, setPrinciples] = useState<PrincipleRow[]>([]);
  const [waveringEvents, setWaveringEvents] = useState<WaveringEventRow[]>([]);

  const [name, setName] = useState("");
  const [mbti, setMbti] = useState(MBTI_TYPES[0]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function fetchAgent() {
    const res = await fetch("/api/player/agent");
    const data = (await res.json()) as { agent: AgentRow | null };
    setAgent(data.agent);
    setLoadingAgent(false);
  }

  async function fetchMoments() {
    const res = await fetch("/api/decisions/pending");
    const data = (await res.json()) as { moments: DecisionMoment[] };
    setMoments(data.moments);
  }

  async function fetchPrinciples() {
    const res = await fetch("/api/principles");
    const data = (await res.json()) as { principles: PrincipleRow[] };
    setPrinciples(data.principles);
  }

  async function fetchWavering() {
    const res = await fetch("/api/wavering/pending");
    const data = (await res.json()) as { events: WaveringEventRow[] };
    setWaveringEvents(data.events);
  }

  useEffect(() => {
    fetchAgent();
  }, []);

  useEffect(() => {
    if (!agent) return;
    fetchMoments();
    const timer = setInterval(fetchMoments, 2000);
    return () => clearInterval(timer);
  }, [agent]);

  useEffect(() => {
    if (!agent) return;
    fetchPrinciples();
    const timer = setInterval(fetchPrinciples, 5000);
    return () => clearInterval(timer);
  }, [agent]);

  useEffect(() => {
    if (!agent) return;
    fetchWavering();
    const timer = setInterval(fetchWavering, 2000);
    return () => clearInterval(timer);
  }, [agent]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/player/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), mbti }),
      });
      if (!res.ok) {
        setCreateError("Could not create agent (one may already exist).");
        setCreating(false);
        return;
      }
      await fetchAgent();
    } finally {
      setCreating(false);
    }
  }

  async function handleChoose(momentId: string, optionId: string) {
    await fetch(`/api/decisions/${momentId}/choose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId }),
    });
    fetchMoments();
  }

  async function handleReaffirm(eventId: string) {
    await fetch(`/api/wavering/${eventId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: "reaffirm" }),
    });
    fetchWavering();
  }

  async function handleRevise(eventId: string) {
    const revisedText = window.prompt("新的原则表述：");
    if (!revisedText || !revisedText.trim()) return;
    await fetch(`/api/wavering/${eventId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: "revise", revisedText: revisedText.trim() }),
    });
    fetchWavering();
  }

  if (loadingAgent) {
    return <main style={{ padding: "2rem", fontFamily: "monospace" }}>Loading...</main>;
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "monospace" }}>
      <h1>Polis — My Agent</h1>
      <p>
        <Link href="/">World</Link>
      </p>

      {!agent && (
        <section style={{ margin: "1.5rem 0" }}>
          <h2>Create your agent</h2>
          <form onSubmit={handleCreate}>
            <div style={{ marginBottom: "0.75rem" }}>
              <label>
                Name:{" "}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ marginLeft: "0.5rem" }}
                />
              </label>
            </div>
            <div style={{ marginBottom: "0.75rem" }}>
              <label>
                MBTI:{" "}
                <select
                  value={mbti}
                  onChange={(e) => setMbti(e.target.value)}
                  style={{ marginLeft: "0.5rem" }}
                >
                  {MBTI_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="submit" disabled={creating} style={{ padding: "0.5rem 1rem" }}>
              {creating ? "Creating..." : "Create Agent"}
            </button>
            {createError && (
              <div style={{ color: "red", marginTop: "0.5rem" }}>{createError}</div>
            )}
          </form>
        </section>
      )}

      {agent && (
        <>
          <section style={{ margin: "1.5rem 0", border: "1px solid #888", padding: "1rem" }}>
            <h2>{agent.name}</h2>
            <div>MBTI: {agent.mbti}</div>
            <div>Scrip: {agent.scrip}</div>
            <div>Reputation: {agent.reputation}</div>
            <div>Location: {agent.current_location}</div>
            <div>State: {agent.state}</div>
          </section>

          <section style={{ margin: "1.5rem 0" }}>
            <h2>My Principles</h2>
            {principles.length === 0 && <div>No principles formed yet.</div>}
            {principles.map((p) => (
              <div
                key={p.id}
                style={{ border: "1px solid #ccc", padding: "0.75rem", marginBottom: "0.75rem" }}
              >
                <div style={{ fontSize: "0.8rem", color: DOMAIN_COLORS[p.domain] ?? "#666" }}>
                  [{p.domain}] weight: {p.weight.toFixed(2)} · source: {p.source}
                </div>
                <p style={{ margin: "0.4rem 0 0" }}>{p.text}</p>
              </div>
            ))}
          </section>

          <section style={{ margin: "1.5rem 0" }}>
            <h2>Decision Moments</h2>
            {moments.length === 0 && <div>No decision moments right now.</div>}
            {moments.map((m) => (
              <div
                key={m.id}
                style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}
              >
                <div style={{ fontSize: "0.8rem", color: "#666" }}>
                  [{m.type}] {m.template_id}
                </div>
                <p>{m.prompt_text}</p>

                {m.status === "pending" && (
                  <div>
                    {m.options.map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => handleChoose(m.id, opt.id)}
                        style={{ padding: "0.4rem 0.8rem", marginRight: "0.5rem" }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}

                {m.status === "decided" && (
                  <div>Decided: {optionLabel(m.options, m.player_choice)}</div>
                )}

                {m.status === "expired_autonomous" && (
                  <div>
                    (the agent decided on its own: {optionLabel(m.options, m.autonomous_choice)})
                  </div>
                )}
              </div>
            ))}
          </section>

          {waveringEvents.length > 0 && (
            <section style={{ margin: "1.5rem 0" }}>
              <h2>Wavering Events</h2>
              {waveringEvents.map((w) => (
                <div
                  key={w.id}
                  style={{ border: "1px solid #ccc", padding: "1rem", marginBottom: "1rem" }}
                >
                  <p>{w.prompt_text}</p>
                  <div>
                    <button
                      onClick={() => handleReaffirm(w.id)}
                      style={{ padding: "0.4rem 0.8rem", marginRight: "0.5rem" }}
                    >
                      重申
                    </button>
                    <button
                      onClick={() => handleRevise(w.id)}
                      style={{ padding: "0.4rem 0.8rem" }}
                    >
                      修订
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}
