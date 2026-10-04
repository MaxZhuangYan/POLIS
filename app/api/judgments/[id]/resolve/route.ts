import { NextResponse } from "next/server";
import { resolveJudgment, ChoiceError } from "@/lib/autonomy";
import { jsonError, readJson } from "@/lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ action?: "accept" | "force" | "adopt" | "overrule" }>(request);
  if (!body?.action || !["accept", "force", "adopt", "overrule"].includes(body.action)) return jsonError("invalid action", 400);
  try {
    return NextResponse.json({ judgment: resolveJudgment(Number(id), body.action) });
  } catch (err) {
    if (err instanceof ChoiceError) return jsonError(err.message, err.status);
    console.error("[judgment] failed", err);
    return jsonError("操作失败，请重试", 500);
  }
}
