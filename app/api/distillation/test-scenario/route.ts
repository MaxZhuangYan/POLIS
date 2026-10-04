import { NextResponse } from "next/server";
import { callDistillationLlmRaw, parseAndValidateLlmContent } from "@/lib/distillation";

// Dev/test-only utility endpoint. NOT part of the production game loop —
// this exists purely so scripts/distillation-regression.mjs (a plain .mjs
// script that can't import a .ts module directly) can exercise the exact
// production system prompt (lib/distillation.ts's SYSTEM_PROMPT) and the
// exact production JSON validation logic over HTTP, using the test set's
// own literal "情境：...\n玩家选择：..." prompt format rather than
// production's buildUserPrompt() shape. Do not call this from any real
// gameplay path.

export async function POST(request: Request) {
  const body = (await request.json()) as { userPrompt?: string };
  const userPrompt = body.userPrompt;

  if (typeof userPrompt !== "string" || userPrompt.length === 0) {
    return NextResponse.json({ error: "userPrompt is required" }, { status: 400 });
  }

  const raw = await callDistillationLlmRaw(userPrompt);
  const validated = raw !== null ? parseAndValidateLlmContent(raw) : null;

  return NextResponse.json({ raw, validated });
}
