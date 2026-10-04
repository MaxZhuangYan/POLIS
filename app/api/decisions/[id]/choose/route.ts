import { NextResponse } from "next/server";
import { expirePendingMoments } from "@/lib/decisionMoments";
import { chooseOption, ChoiceError } from "@/lib/autonomy";
import { jsonError, readJson } from "@/lib/http";

// Choose an option on a pending Decision Moment, then let the autonomy engine
// judge it (execute / adjust / refuse). Validation kept from the original
// route: unknown option → 400 without touching the row; an expired-but-not-
// yet-swept moment is self-healed to 'expired_autonomous' first → 409.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const momentId = Number(id);
  if (!Number.isInteger(momentId)) return jsonError("invalid decision moment id", 400);
  const body = await readJson<{ optionId?: string }>(request);
  if (!body?.optionId) return jsonError("optionId is required", 400);
  expirePendingMoments();
  try {
    const { moment, judgment } = await chooseOption(momentId, body.optionId);
    const { options_json, ...rest } = moment;
    return NextResponse.json({ moment: { ...rest, options: JSON.parse(options_json) }, judgment });
  } catch (err) {
    if (err instanceof ChoiceError) return jsonError(err.message, err.status);
    console.error("[choose] failed", err);
    return jsonError("选择没有被记录，请重试", 500);
  }
}
