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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const momentId = Number(id);

  if (!Number.isInteger(momentId)) {
    return NextResponse.json({ error: "invalid decision moment id" }, { status: 400 });
  }

  const body = (await request.json()) as { optionId?: string };
  const optionId = body.optionId;

  if (!optionId) {
    return NextResponse.json({ error: "optionId is required" }, { status: 400 });
  }

  const db = getDb();

  // Self-heal: a moment past its wall-clock expiry may still show status
  // 'pending' in the DB if the tick-driven sweep hasn't run recently (e.g.
  // the world clock is paused). Resolve any overdue moments — including this
  // one, if it qualifies — before evaluating the request below, the same
  // pattern already used in GET /api/decisions/pending.
  expirePendingMoments();

  const moment = db
    .prepare("SELECT * FROM decision_moments WHERE id = ?")
    .get(momentId) as DecisionMomentRow | undefined;

  if (!moment) {
    return NextResponse.json({ error: "decision moment not found" }, { status: 404 });
  }

  if (moment.status !== "pending") {
    return NextResponse.json(
      { error: `decision moment is not pending (status: ${moment.status})` },
      { status: 409 },
    );
  }

  const options = JSON.parse(moment.options_json) as Array<{ id: string }>;
  if (!options.some((o) => o.id === optionId)) {
    return NextResponse.json({ error: `optionId "${optionId}" does not exist on this moment` }, { status: 400 });
  }

  db.prepare("UPDATE decision_moments SET status = 'decided', player_choice = ? WHERE id = ?").run(
    optionId,
    momentId,
  );

  const updated = db
    .prepare("SELECT * FROM decision_moments WHERE id = ?")
    .get(momentId) as DecisionMomentRow;

  const { options_json, ...rest } = updated;
  return NextResponse.json({
    moment: {
      ...rest,
      options: JSON.parse(options_json),
    },
  });
}
