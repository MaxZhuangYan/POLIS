import { NextResponse } from "next/server";
import { submitSurvey, SurveyError } from "@/lib/progression";
import { playerId } from "@/lib/records";
import { jsonError, readJson } from "@/lib/http";

// 每卷档案之后：用三个词描述你的 Agent（下一卷会引用）。
export async function POST(request: Request) {
  const pid = playerId();
  if (!pid) return jsonError("no player agent", 404);
  const body = await readJson<{ volume?: number; words?: string[] }>(request);
  if (!body || typeof body.volume !== "number" || !Array.isArray(body.words)) return jsonError("需要 volume 和三个词", 400);
  try {
    submitSurvey(pid, body.volume, body.words);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SurveyError) return jsonError(err.message, 400);
    return jsonError("没有记下，请重试", 500);
  }
}
