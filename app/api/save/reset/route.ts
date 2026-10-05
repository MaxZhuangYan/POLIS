import { NextResponse } from "next/server";
import { resetSave } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";

// 新的存档：旧存档保留一份 .bak，世界从空白重新开始。需要确认词，防止误触。
export async function POST(request: Request) {
  const body = await readJson<{ confirm?: string }>(request);
  if (body?.confirm !== "重新开始") return jsonError("需要确认：confirm = 重新开始", 400);
  try {
    resetSave();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[save] reset failed", err);
    return jsonError("没能开始新的存档，请重试", 500);
  }
}
