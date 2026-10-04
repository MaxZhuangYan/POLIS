import { NextResponse } from "next/server";
import { addNote, NoteError } from "@/lib/notes";
import { playerId } from "@/lib/records";
import { jsonError, readJson } from "@/lib/http";

export async function POST(request: Request) {
  const pid = playerId();
  if (!pid) return jsonError("no player agent", 404);
  const body = await readJson<{ text?: string }>(request);
  try {
    return NextResponse.json({ note: addNote(pid, body?.text ?? "") });
  } catch (err) {
    if (err instanceof NoteError) return jsonError(err.message, err.status);
    return jsonError("留言没有送达，请重试", 500);
  }
}
