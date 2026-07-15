import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAllActivePrinciples } from "@/lib/principleEngine";

export async function GET() {
  const db = getDb();

  const player = db.prepare("SELECT id FROM agents WHERE is_player = 1").get() as
    | { id: string }
    | undefined;

  if (!player) {
    return NextResponse.json({ principles: [] });
  }

  const principles = getAllActivePrinciples(player.id);

  return NextResponse.json({ principles });
}
