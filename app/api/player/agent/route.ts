import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const agent = db.prepare("SELECT * FROM agents WHERE is_player = 1").get();

  if (!agent) {
    return NextResponse.json({ agent: null });
  }

  return NextResponse.json({ agent });
}
