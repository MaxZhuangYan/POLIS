import { NextResponse } from "next/server";
import { buildSnapshot } from "@/lib/snapshot";
import { startWorld } from "@/lib/sim";

export const dynamic = "force-dynamic";

export async function GET() {
  startWorld(); // idempotent; instrumentation normally already started it
  return NextResponse.json(buildSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
