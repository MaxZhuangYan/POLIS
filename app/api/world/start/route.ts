import { NextResponse } from "next/server";
import { startClock } from "@/lib/worldClock";

export async function POST() {
  startClock();
  return NextResponse.json({ ok: true });
}
