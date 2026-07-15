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

type ResolveBody = {
  resolution?: "reaffirm" | "revise";
  revisedText?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const eventId = Number(id);

  if (!Number.isInteger(eventId)) {
    return NextResponse.json({ error: "invalid wavering event id" }, { status: 400 });
  }

  const body = (await request.json()) as ResolveBody;
  const { resolution } = body;

  if (resolution !== "reaffirm" && resolution !== "revise") {
    return NextResponse.json(
      { error: "resolution must be 'reaffirm' or 'revise'" },
      { status: 400 },
    );
  }

  let trimmedRevisedText: string | null = null;

  if (resolution === "revise") {
    const rawRevisedText = body.revisedText ?? "";
    trimmedRevisedText = rawRevisedText.trim();

    if (trimmedRevisedText === "") {
      return NextResponse.json(
        { error: "revisedText is required when resolution is 'revise'" },
        { status: 400 },
      );
    }

    if (Array.from(trimmedRevisedText).length > 20) {
      return NextResponse.json(
        { error: "revisedText must be ≤20 characters" },
        { status: 400 },
      );
    }
  }

  const db = getDb();

  const event = db
    .prepare("SELECT * FROM wavering_events WHERE id = ?")
    .get(eventId) as WaveringEventRow | undefined;

  if (!event) {
    return NextResponse.json({ error: "wavering event not found" }, { status: 404 });
  }

  if (event.status !== "pending") {
    return NextResponse.json(
      { error: `wavering event is not pending (status: ${event.status})` },
      { status: 409 },
    );
  }

  const revisedText = trimmedRevisedText;
  const now = Date.now();

  // The wavering_events resolution and the principles update must land
  // together: a partial write would leave an event marked resolved whose
  // principle never got its weight/text update, or vice versa.
  const resolveWavering = db.transaction(() => {
    db.prepare(
      `UPDATE wavering_events
       SET status = 'resolved', resolution = ?, revised_text = ?, resolved_at = ?
       WHERE id = ?`,
    ).run(resolution, revisedText, now, eventId);

    if (resolution === "revise") {
      db.prepare(
        `UPDATE principles
         SET weight = 1.0, last_cited_at = ?, text = ?
         WHERE id = ?`,
      ).run(now, revisedText, event.principle_id);
    } else {
      db.prepare(
        `UPDATE principles
         SET weight = 1.0, last_cited_at = ?
         WHERE id = ?`,
      ).run(now, event.principle_id);
    }
  });
  resolveWavering();

  const updated = db
    .prepare("SELECT * FROM wavering_events WHERE id = ?")
    .get(eventId) as WaveringEventRow;

  return NextResponse.json({ event: updated });
}
