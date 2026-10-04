import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureClockMatchesState } from "@/lib/worldClock";

export async function GET() {
  ensureClockMatchesState();
  const db = getDb();

  const world = db.prepare("SELECT current_tick, is_running FROM world_state WHERE id = 1").get() as {
    current_tick: number;
    is_running: number;
  };
  const agents = db.prepare("SELECT * FROM agents ORDER BY name").all();
  const tasks = db.prepare("SELECT * FROM tasks ORDER BY id").all();
  const totalBurn = db
    .prepare("SELECT COALESCE(SUM(-amount), 0) as total FROM ledger WHERE reason = 'burn'")
    .get() as { total: number };

  return NextResponse.json({
    tick: world.current_tick,
    isRunning: Boolean(world.is_running),
    agents,
    tasks,
    totalBurn: totalBurn.total,
  });
}
