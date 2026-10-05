import { NextResponse } from "next/server";
import { buySlot, ImprintError, slotUsage } from "@/lib/imprints";
import { playerId } from "@/lib/records";
import { jsonError } from "@/lib/http";

// 记忆槽位 +1（200 / 400 / 800 Scrip，销毁）。
export async function POST() {
  const pid = playerId();
  if (!pid) return jsonError("no player agent", 404);
  try {
    const r = buySlot(pid);
    return NextResponse.json({ ok: true, ...r, slots: slotUsage(pid) });
  } catch (err) {
    if (err instanceof ImprintError) return jsonError(err.message, err.status);
    return jsonError("没能扩展记忆，请重试", 500);
  }
}
