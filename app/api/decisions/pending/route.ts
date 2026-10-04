import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { expirePendingMoments } from "@/lib/decisionMoments";

type DecisionMomentRow = {
  id: number;
  agent_id: string;
  type: string;
  template_id: string;
  prompt_text: string;
  options_json: string;
  counterparty_id: string | null;
  created_at: number;
  expires_at: number;
  status: string;
  player_choice: string | null;
  autonomous_choice: string | null;
};

export async function GET() {
  const db = getDb();

  const player = db.prepare("SELECT id FROM agents WHERE is_player = 1").get() as
    | { id: string }
    | undefined;

  if (!player) {
    return NextResponse.json({ moments: [] });
  }

  // Self-heal: flip any overdue pending moments before reading, same pattern
  // as ensureClockMatchesState() in app/api/world/state/route.ts.
  expirePendingMoments();

  const rows = db
    .prepare(
      `SELECT * FROM decision_moments
       WHERE agent_id = ? AND status IN ('pending', 'expired_autonomous')
       ORDER BY id DESC`,
    )
    .all(player.id) as DecisionMomentRow[];

  const moments = rows.map(({ options_json, ...row }) => ({
    ...row,
    options: JSON.parse(options_json),
  }));

  return NextResponse.json({ moments });
}
