// ---------------------------------------------------------------------------
// 传闻: in the evening, residents talk about the guardian's Agent — always
// about something that really happened in the last three days (an event row
// it took part in, or a grudge someone holds against it). What is said moves
// the listener's opinion of the Agent a little: good deeds and bad ones travel
// along the relationship graph (v3.14 模因系统, the smallest honest version).
// ---------------------------------------------------------------------------

import { getDb } from "./db";
import { simNow, HOUR_MS } from "./clock";
import { adjustRelationship, agentName, logEvent, metric, say } from "./records";

const WINDOW_MS = 72 * HOUR_MS;

interface Fact {
  text: string;
  tone: 1 | -1;
  key: string;
}

/** Something true and recent about the Agent that a resident would repeat. */
function factAbout(agentId: string, speaker: string): Fact | null {
  const db = getDb();
  const since = simNow() - WINDOW_MS;
  // a grudge the speaker holds is the first thing they bring up
  const grudge = db
    .prepare("SELECT id, text FROM incidents WHERE holder_id = ? AND offender_id = ? AND resolved = 0 ORDER BY at_ms DESC LIMIT 1")
    .get(speaker, agentId) as { id: number; text: string } | undefined;
  if (grudge) return { text: `${agentName(agentId)}？上次${grudge.text.replace(/^我/, "")}。`, tone: -1, key: `inc${grudge.id}` };
  const name = agentName(agentId);
  const rows = db
    .prepare(
      `SELECT id, kind, text FROM events WHERE at_ms >= ? AND importance >= 2 AND kind IN ('coop','default','risk','relationship','refuse')
         AND actors_json LIKE ? ORDER BY importance DESC, at_ms DESC LIMIT 6`,
    )
    .all(since, `%"${agentId}"%`) as Array<{ id: number; kind: string; text: string }>;
  for (const r of rows) {
    if (!r.text.includes(name)) continue;
    const negative = r.kind === "default" || /撤出|记下了|查出|失败|压了/.test(r.text);
    const said = r.text.replace(/（[^）]*）/g, "").replace(/——.*$/, "");
    return { text: `听说${said}。`, tone: negative ? -1 : 1, key: `ev${r.id}` };
  }
  return null;
}

/** One exchange per evening gathering where the Agent is not present; returns true when someone gossiped. */
export function gossipAbout(agentId: string, speaker: string, listener: string): boolean {
  if (speaker === agentId || listener === agentId) return false;
  const fact = factAbout(agentId, speaker);
  if (!fact) return false;
  const db = getDb();
  // the same story is told to the same listener once
  const told = db
    .prepare("SELECT COUNT(*) n FROM metric_events WHERE name = 'gossip' AND json_extract(payload_json, '$.key') = ? AND json_extract(payload_json, '$.listener') = ?")
    .get(fact.key, listener) as { n: number };
  if (told.n > 0) return false;
  say(speaker, Array.from(fact.text).slice(0, 36).join(""), fact.tone < 0 ? "upset" : "think");
  adjustRelationship(listener, agentId, fact.tone, fact.tone < 0 ? `听 ${agentName(speaker)} 说起了它的事` : null);
  logEvent({
    kind: "relationship",
    text: `${agentName(speaker)} 跟 ${agentName(listener)} 聊起了 ${agentName(agentId)}：“${fact.text}”`,
    actors: [speaker, listener, agentId],
    importance: 1,
  });
  metric("gossip", { speaker, listener, key: fact.key, tone: fact.tone });
  return true;
}
