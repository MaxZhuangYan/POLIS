import { NextResponse } from "next/server";
import type { Agent } from "@/app/data/polis";

type Action = "idle" | "walk" | "talk" | "work" | "sign" | "trade";

type Body = {
  agent: Agent;
  worldContext: string;
  epoch: number;
  lang?: "en" | "zh";
  endpoint?: string;
  model?: string;
};

const ACTIONS: Action[] = ["idle", "walk", "talk", "work", "sign", "trade"];
const DEFAULT_MODEL = process.env.LMSTUDIO_MODEL ?? "gemma-4-4b";

function modelEndpoint(url: string) {
  return url.replace(/\/chat\/completions\/?$/, "/models");
}

async function resolveLmModel(url: string, preferred?: string) {
  const explicit = preferred ?? process.env.LMSTUDIO_MODEL;
  if (explicit) return explicit;
  try {
    const response = await fetch(modelEndpoint(url), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return DEFAULT_MODEL;
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    return data.data?.[0]?.id ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function fallbackDecision(agent: Agent): { action: Action; reason: string; thought: string; status: string } {
  const energy = agent.energy ?? 80;
  const satiety = agent.satiety ?? 75;
  if (energy < 15) {
    return { action: "idle", reason: "Energy low; resting before more work.", thought: "I need recovery before taking contracts.", status: "Resting to recover energy" };
  }
  if (satiety < 20) {
    return { action: "walk", reason: "Satiety low; seeking food or market access.", thought: "Food comes before ambitious work.", status: "Looking for food" };
  }
  if (agent.currentMission.toLowerCase().includes("market") || agent.role === "Broker") {
    return { action: "trade", reason: "Role and mission favor trade coordination.", thought: "The market queue has useful signals.", status: "Negotiating market routes" };
  }
  if (agent.role === "Mediator") {
    return { action: "talk", reason: "Mediator role favors relationship repair.", thought: "Trust is the fastest way to stabilize work.", status: "Seeking a dispute partner" };
  }
  if (agent.role === "Maker" || agent.role === "Architect" || agent.role === "Archivist") {
    return { action: "work", reason: "Role and mission favor focused production.", thought: "I can convert this mission into visible progress.", status: "Working on mission fragment" };
  }
  return { action: "walk", reason: "Autonomous exploration is useful right now.", thought: "I should scan the town before committing.", status: "Surveying town signals" };
}

function parseJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Partial<{ action: Action; reason: string; thought: string; status: string }>;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({
      action: "idle",
      reason: "Invalid request body.",
      thought: "Cannot decide without a valid request.",
      status: "Idle",
      source: "mock",
      error: "invalid json"
    }, { status: 400 });
  }

  if (!body.agent) {
    return NextResponse.json({ action: "idle", reason: "Missing agent.", thought: "Cannot decide.", status: "Idle", source: "mock", error: "missing agent" }, { status: 400 });
  }

  const fallback = fallbackDecision(body.agent);
  const endpoint = body.endpoint ?? process.env.LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1/chat/completions";
  const model = await resolveLmModel(endpoint, body.model);
  const langInstruction = body.lang === "zh" ? "Use concise Simplified Chinese." : "Use concise English.";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        temperature: 0.45,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content: `You are deciding one autonomous tick for a game agent in Polis. Pick exactly one action from: ${ACTIONS.join(", ")}. Respond only as compact JSON: {"action":"work","reason":"...","thought":"...","status":"..."}. reason must be one sentence. status under 42 chars. ${langInstruction}`
          },
          {
            role: "user",
            content: `Agent: ${body.agent.name}, role ${body.agent.role}, MBTI ${body.agent.mbti}. Mission: ${body.agent.currentMission}. Status: ${body.agent.status}. Energy ${body.agent.energy ?? 80}, satiety ${body.agent.satiety ?? 75}, reputation ${body.agent.reputation}, scrip ${body.agent.scrip}, compute ${body.agent.compute}. World: ${body.worldContext}.`
          }
        ]
      })
    });

    if (!response.ok) throw new Error(`LM Studio ${response.status}`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string; reasoning_content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() || data.choices?.[0]?.message?.reasoning_content?.trim();
    if (!content) throw new Error("no content");
    const parsed = parseJsonObject(content);
    const action = parsed?.action && ACTIONS.includes(parsed.action) ? parsed.action : fallback.action;

    return NextResponse.json({
      action,
      reason: parsed?.reason?.slice(0, 140) || fallback.reason,
      thought: parsed?.thought?.slice(0, 180) || fallback.thought,
      status: parsed?.status?.slice(0, 60) || fallback.status,
      source: "lmstudio",
      model,
      endpoint
    });
  } catch (err) {
    return NextResponse.json({
      ...fallback,
      source: "mock",
      model,
      endpoint,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
