import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createFirstSessionMoments } from "@/lib/decisionMoments";
import { PLAYER_SPRITES, START_SCRIP } from "@/lib/content";
import { isValidTz, simNow } from "@/lib/clock";
import { logEvent, metric } from "@/lib/records";
import { jsonError, readJson } from "@/lib/http";
import { startWorld } from "@/lib/sim";

function generateAgentId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, "-").replace(/^-+|-+$/g, "") || "player";
  return `${slug}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function POST(request: Request) {
  const body = await readJson<{ name?: string; sprite?: string; mbti?: string; tz?: string }>(request);
  const name = (body?.name ?? "").trim();
  if (!name || Array.from(name).length > 12) return jsonError("名字需要 1-12 个字", 400);
  const sprite = (PLAYER_SPRITES as readonly string[]).includes(body?.sprite ?? "") ? body!.sprite! : "rookie";
  const db = getDb();
  if (db.prepare("SELECT id FROM agents WHERE is_player = 1").get()) return jsonError("player agent already exists", 409);

  const id = generateAgentId(name);
  const now = simNow();
  db.transaction(() => {
    if (body?.tz && isValidTz(body.tz)) db.prepare("UPDATE world_state SET tz = COALESCE(tz, ?) WHERE id = 1").run(body.tz);
    db.prepare(
      `INSERT INTO agents (id, name, personality, reputation, scrip, current_location, state, mbti, is_player, created_at,
                           role, sprite, home_slot, traits_json, activity, activity_text, onboarding, trust)
       VALUES (?, ?, '', 20, ?, 'gate', 'idle', ?, 1, ?, '新来的居民', ?, 0, '{}', 'waiting', '刚到城门，正在向你请教', 'forks', 100)`,
    ).run(id, name, START_SCRIP, body?.mbti ?? null, now, sprite);
    db.prepare("INSERT INTO ledger (agent_id, amount, reason, tick) VALUES (?, ?, 'start_grant', (SELECT current_tick FROM world_state WHERE id = 1))").run(id, START_SCRIP);
    createFirstSessionMoments(id);
  })();
  logEvent({ kind: "system", text: `${name} 从城门走进了 Polis`, actors: [id], importance: 3 });
  logEvent({ kind: "moment", text: `${name} 在城门口遇到了三件拿不定主意的事，在等你回答`, actors: [id], importance: 3 });
  metric("agent_created", { id, sprite });
  startWorld();
  return NextResponse.json({ agent: db.prepare("SELECT * FROM agents WHERE id = ?").get(id) });
}
