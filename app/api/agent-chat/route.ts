import { NextResponse } from "next/server";
import type { Agent } from "@/app/data/polis";
import { fallbackChatReply } from "@/app/lib/sim";

type Body = {
  agent: Agent;
  playerMessage: string;
  worldContext: string;
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
    return NextResponse.json({ reply: "", action: "error", source: "mock" }, { status: 400 });
  }

  if (!body.agent || !body.playerMessage) {
    return NextResponse.json({ reply: "", action: "error", source: "mock" }, { status: 400 });
  }

  const fallback = fallbackChatReply(body.agent, body.playerMessage);
  const url = body.endpoint ?? process.env.LMSTUDIO_URL ?? "http://127.0.0.1:1234/v1/chat/completions";
  const model = await resolveLmModel(url, body.model);
  const langInstruction = body.lang === "zh"
    ? "Reply entirely in Chinese (简体中文)."
    : "Reply entirely in English.";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        temperature: 0.75,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `You are ${body.agent.name}, a ${body.agent.role} in Polis. The player is your own internal directive layer, not a governor of the whole society. Respond as an autonomous town agent receiving a personal intention: acknowledge what you will do, reference your current mission or status, and end with one concrete next action. Stay in character. 1-2 sentences only. No markdown. ${langInstruction}`
          },
          {
            role: "user",
            content: `[Player-to-agent message] ${body.playerMessage}\n[World] ${body.worldContext}\n[Your current status] ${body.agent.status}\n[Your mission] ${body.agent.currentMission}`
          }
        ]
      })
    });

    if (!response.ok) throw new Error(`LM Studio ${response.status}`);

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const msg = data.choices?.[0]?.message;
    const reply = (msg?.content?.trim() || msg?.reasoning_content?.trim())?.slice(0, 300);
    if (!reply) throw new Error("no content");

    return NextResponse.json({ reply, action: "acknowledged", source: "lmstudio", model, endpoint: url });
  } catch (err) {
    console.error("[agent-chat] LM Studio error:", err);
    return NextResponse.json({
      ...fallback,
      source: "mock",
      model,
      endpoint: url,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
