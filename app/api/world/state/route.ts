import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { startWorld } from "@/lib/sim";

// Legacy Phase-0 read model, kept for scripts/test-choose-route-bugs.mjs and
// quick curl checks. The game client uses /api/game/state.
export async function GET() {
  startWorld();
  const db = getDb();
  const world = db.prepare("SELECT current_tick, is_running FROM world_state WHERE id = 1").get() as { current_tick: number; is_running: number };
  const agents = db.prepare("SELECT id, name, reputation, scrip, current_location, state, activity, trust, is_player FROM agents").all();
  const tasks = db.prepare("SELECT id, name, type, reward, status, taken_by FROM tasks WHERE status IN ('open','reserved','taken') ORDER BY id DESC LIMIT 50").all();
  const burn = db.prepare("SELECT COALESCE(SUM(-amount), 0) AS total FROM ledger WHERE reason IN ('burn','task_fee_burn')").get() as { total: number };
  return NextResponse.json({ tick: world.current_tick, isRunning: !!world.is_running, agents, tasks, totalBurn: burn.total });
}
