import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { playerId } from "@/lib/records";
import { kickPlayer } from "@/lib/sim";
import { jsonError } from "@/lib/http";

// "看它出发": closes the imprint reveal and lets the Agent start its day now.
export async function POST() {
  const pid = playerId();
  if (!pid) return jsonError("no player agent", 404);
  const db = getDb();
  const pending = db.prepare("SELECT COUNT(*) n FROM decision_moments WHERE agent_id = ? AND template_id LIKE 'FIRST_%' AND status = 'pending'").get(pid) as { n: number };
  if (pending.n > 0) return jsonError("还有没回答的岔路", 409);
  const res = db.prepare("UPDATE agents SET onboarding = 'done' WHERE id = ? AND onboarding != 'done'").run(pid);
  if (res.changes > 0) kickPlayer(pid);
  return NextResponse.json({ ok: true });
}
