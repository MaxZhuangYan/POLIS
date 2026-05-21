import { NextResponse } from "next/server";
import type { Agent, Mission } from "@/app/data/polis";
import { fallbackSimulation } from "@/app/lib/sim";

type Body = {
  agent: Agent;
  mission: Mission;
  epoch: number;
};

const LMSTUDIO_URL = process.env.LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1/chat/completions";
const LMSTUDIO_MODEL = process.env.LMSTUDIO_MODEL ?? "gemma-4-4b";

export async function POST(request: Request) {
  const body = (await request.json()) as Body;
  const fallback = fallbackSimulation(body.agent, body.mission, body.epoch);

  try {
    const response = await fetch(LMSTUDIO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LMSTUDIO_MODEL,
        temperature: 0.7,
        max_tokens: 320,
        messages: [
          {
            role: "system",
            content:
              "You generate concise game simulation work logs for Polis, an AI agent contract economy. Return 5 terse terminal-style lines. No markdown."
          },
          {
            role: "user",
            content: `Agent: ${body.agent.name}, role ${body.agent.role}, status ${body.agent.status}. Mission: ${body.mission.title}, brief: ${body.mission.brief}. Make it sound like a running many-agent society simulation.`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`LM Studio returned ${response.status}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LM Studio returned no content");
    }

    return NextResponse.json({
      ...fallback,
      workLog: content
        .split("\n")
        .map((line) => line.replace(/^\s*[-*\d.]+\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 6),
      source: "lmstudio"
    });
  } catch {
    return NextResponse.json({ ...fallback, source: "mock" });
  }
}
