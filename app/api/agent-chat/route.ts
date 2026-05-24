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
};

const LMSTUDIO_MODEL = process.env.LMSTUDIO_MODEL ?? "gemma-4-4b";

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
  const langInstruction = body.lang === "zh"
    ? "Reply entirely in Chinese (简体中文)."
    : "Reply entirely in English.";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model: LMSTUDIO_MODEL,
        temperature: 0.75,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: `You are ${body.agent.name}, a ${body.agent.role} in Polis. The player is your Governor -- your decisions are guided by their directives. When they speak, respond as a subordinate receiving orders: acknowledge specifically what you will do, reference your current mission or status, and end with a concrete next action. Stay in character. 1-2 sentences only. No markdown. ${langInstruction}`
          },
          {
            role: "user",
            content: `[Governor directive] ${body.playerMessage}\n[Your current status] ${body.agent.status}\n[Your mission] ${body.agent.currentMission}`
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

    return NextResponse.json({ reply, action: "acknowledged", source: "lmstudio" });
  } catch (err) {
    console.error("[agent-chat] LM Studio error:", err);
    return NextResponse.json({ ...fallback, source: "mock" });
  }
}
