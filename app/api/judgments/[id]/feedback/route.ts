import { NextResponse } from "next/server";
import { recordFeedback, ChoiceError } from "@/lib/autonomy";
import { jsonError, readJson } from "@/lib/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<{ value?: string }>(request);
  try {
    recordFeedback(Number(id), body?.value ?? "");
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ChoiceError) return jsonError(err.message, err.status);
    return jsonError("反馈没有保存", 500);
  }
}
