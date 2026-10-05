import { NextResponse } from "next/server";
import { ImprintError, slotUsage, wakeImprint } from "@/lib/imprints";
import { playerId } from "@/lib/records";
import { jsonError, readJson } from "@/lib/http";

// 唤醒一条沉睡的烙印；记忆已满时，sleepId 指定让哪一条沉睡。
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const pid = playerId();
  if (!pid) return jsonError("no player agent", 404);
  const { id } = await params;
  const body = await readJson<{ sleepId?: number | null }>(request);
  try {
    wakeImprint(pid, Number(id), body?.sleepId ?? null);
    return NextResponse.json({ ok: true, slots: slotUsage(pid) });
  } catch (err) {
    if (err instanceof ImprintError) return jsonError(err.message, err.status);
    return jsonError("没能唤醒这条烙印，请重试", 500);
  }
}
