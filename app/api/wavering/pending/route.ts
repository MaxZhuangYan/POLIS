import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type WaveringEventRow = {
  id: number;
  agent_id: string;
  principle_id: number;
  prompt_text: string;
  created_at: number;
  status: string;
  resolution: string | null;
  revised_text: string | null;
  resolved_at: number | null;
};

export async function GET() {
  const db = getDb();

  const player = db.prepare("SELECT id FROM agents WHERE is_player = 1").get() as
    | { id: string }
    | undefined;

  if (!player) {
    return NextResponse.json({ events: [] });
  }

  const events = db
    .prepare(
      `SELECT * FROM wavering_events
       WHERE agent_id = ? AND status = 'pending'
       ORDER BY id DESC`,
    )
    .all(player.id) as WaveringEventRow[];

  return NextResponse.json({ events });
}
