import { NextResponse } from "next/server";
import { GuessError, submitGuess } from "@/lib/dilemmas";
import { playerId } from "@/lib/records";
import { jsonError, readJson } from "@/lib/http";

// 默契：在它自己拿主意之前，猜它会怎么选。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const pid = playerId();
  if (!pid) return jsonError("no player agent", 404);
  const { id } = await params;
  const body = await readJson<{ optionId?: string }>(request);
  if (!body?.optionId) return jsonError("需要 optionId", 400);
  try {
    submitGuess(pid, Number(id), body.optionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GuessError) return jsonError(err.message, err.status);
    return jsonError("没有记下，请重试", 500);
  }
}
