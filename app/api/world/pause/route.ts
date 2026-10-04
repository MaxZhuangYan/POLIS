import { NextResponse } from "next/server";
import { pauseClock } from "@/lib/worldClock";

export async function POST() {
  pauseClock();
  return NextResponse.json({ ok: true });
}
