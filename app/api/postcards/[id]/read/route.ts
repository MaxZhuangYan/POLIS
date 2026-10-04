import { NextResponse } from "next/server";
import { markPostcardRead } from "@/lib/postcards";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  markPostcardRead(Number(id));
  return NextResponse.json({ ok: true });
}
