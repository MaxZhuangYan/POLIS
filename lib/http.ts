import { NextResponse } from "next/server";

// Uniform JSON error helper: player-facing messages are Chinese and short;
// status codes stay meaningful for the client's retry logic.
export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
