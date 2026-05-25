import { NextResponse } from "next/server";
import type { Agent } from "@/app/data/polis";
import { fallbackDialogue } from "@/app/lib/sim";

type Body = {
  agentA: Agent;
  agentB: Agent;
  location: string;
  epoch: number;
  lang?: "en" | "zh";
  endpoint?: string;
  model?: string;
};

const LMSTUDIO_MODEL = process.env.LMSTUDIO_MODEL ?? "gemma-4-4b";

function modelEndpoint(url: string) {
  return url.replace(/\/chat\/completions\/?$/, "/models");
}

async function resolveLmModel(url: string, preferred?: string) {
  const explicit = preferred ?? process.env.LMSTUDIO_MODEL;
  if (explicit) return explicit;
  try {
    const response = await fetch(modelEndpoint(url), { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return LMSTUDIO_MODEL;
    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    return data.data?.[0]?.id ?? LMSTUDIO_MODEL;
  } catch {
    return LMSTUDIO_MODEL;
  }
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ lines: [], affinityDelta: 0, source: "mock" }, { status: 400 });
  }

  if (!body.agentA || !body.agentB) {
    return NextResponse.json({ lines: [], affinityDelta: 0, source: "mock" }, { status: 400 });
  }

  const fallback = fallbackDialogue(body.agentA, body.agentB, body.location);
  const url = body.endpoint ?? process.env.LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1/chat/completions";
  const model = await resolveLmModel(url, body.model);
  const langInstruction = body.lang === "zh"
    ? "Write entirely in Chinese (简体中文)."
    : "Write entirely in English.";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        temperature: 0.82,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              `You are a narrator writing autonomous dialogue between two AI agents in Polis, a self-governing contract civilization. These agents do NOT talk to any player -- they discuss their own work, trades, and world events. Output EXACTLY 2 lines in the format Name: message. Each line under 12 words. Be specific to their roles and current epoch situation. No greetings, no pleasantries. No markdown. ${langInstruction}`
          },
          {
            role: "user",
            content: `${body.agentA.name} (${body.agentA.role}) is ${body.agentA.status.toLowerCase()}. ${body.agentB.name} (${body.agentB.role}) is ${body.agentB.status.toLowerCase()}. They meet in ${body.location} during Epoch ${body.epoch}. Write their exchange.`
          }
        ]
      })
    });

    if (!response.ok) throw new Error(`LM Studio ${response.status}`);

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const msg = data.choices?.[0]?.message;
    const content = (msg?.content?.trim() || msg?.reasoning_content?.trim());
    if (!content) throw new Error("no content");

    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx === -1) return null;
        return { speaker: line.slice(0, idx).trim(), text: line.slice(idx + 1).trim() };
      })
      .filter((l): l is { speaker: string; text: string } => l !== null)
      .slice(0, 3);

    if (lines.length < 1) throw new Error("parse failed");

    return NextResponse.json({ lines, affinityDelta: 1, source: "lmstudio", model, endpoint: url });
  } catch (err) {
    return NextResponse.json({
      ...fallback,
      source: "mock",
      model,
      endpoint: url,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
