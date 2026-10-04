import { NextResponse } from "next/server";
import { advanceForTest } from "@/lib/sim";
import { isTestMode } from "@/lib/clock";
import { jsonError, readJson } from "@/lib/http";

// 🧪 Test fast-forward — only exists when the server runs with
// POLIS_TEST_MODE=1 (npm run dev:test / start:test). It moves the world's
// simulated clock forward and runs the missed hourly ticks; it does not
// shorten any rule (tick = 1h, Moment expiry = 24h, D1-D7 are calendar days).
export async function POST(request: Request) {
  if (!isTestMode()) return jsonError("测试快进只在 POLIS_TEST_MODE=1 时可用", 403);
  const body = await readJson<{ hours?: number; to?: "night" | "morning" }>(request);
  try {
    return NextResponse.json(await advanceForTest({ hours: body?.hours, to: body?.to }));
  } catch (err) {
    console.error("[test/advance] failed", err);
    return jsonError("快进失败", 500);
  }
}
