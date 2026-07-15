import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createFirstSessionMoments } from "@/lib/decisionMoments";

// Slugify supports Latin + CJK characters since player-chosen names may be Chinese.
function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "player";
}

function generateAgentId(name: string): string {
  const base = slugify(name);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `${base}-${suffix}`;
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: string; mbti?: string };
  const name = (body.name ?? "").trim();
  const mbti = (body.mbti ?? "").trim();

  if (!name || !mbti) {
    return NextResponse.json({ error: "name and mbti are required" }, { status: 400 });
  }

  const db = getDb();

  // No await between this check and the insert below, so on Node's single
  // threaded event loop with synchronous better-sqlite3 calls there is no
  // race window where two requests could both pass this check.
  const existing = db.prepare("SELECT id FROM agents WHERE is_player = 1").get();
  if (existing) {
    return NextResponse.json({ error: "player agent already exists" }, { status: 409 });
  }

  const id = generateAgentId(name);

  // Agent insert + first-session moments must succeed or fail together: a
  // partial write (agent row with no moments) would leave a broken row that
  // permanently blocks retries via the is_player=1 check above.
  const createPlayer = db.transaction(() => {
    // created_at must be stamped here, not left NULL — lib/decisionMoments.ts's
    // maybeGenerateMoment() (daily cap) and ensureD2Citation() both anchor a
    // real-day window to this value; if it's NULL and only gets self-healed
    // later (opportunistically, by whichever of those runs first), the day
    // window keeps sliding to "now" on every check instead of staying fixed,
    // silently defeating the daily cap (found during Phase 3 prep integration
    // testing — a fresh agent kept generating past its day-1 quota).
    db.prepare(
      `INSERT INTO agents (id, name, personality, reputation, scrip, current_location, state, mbti, is_player, created_at)
       VALUES (?, ?, '', 20, 100, 'town-center', 'idle', ?, 1, ?)`,
    ).run(id, name, mbti, Date.now());

    createFirstSessionMoments(id);
  });
  createPlayer();

  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);

  return NextResponse.json({ agent });
}
