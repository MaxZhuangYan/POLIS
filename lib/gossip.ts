// ---------------------------------------------------------------------------
// 传闻 (v3.14 模因系统, the smallest honest version): in the evening residents
// talk — about the guardian's Agent, and about each other. Every story is a row
// that really exists (an event from the last three days, or a grudge the
// speaker holds), and it is passed on WITH ITS SOURCE ("听 Mira 说：…").
//
// What a listener does with it:
//  * a bad story becomes a `hearsay` incident the listener holds against the
//    subject, text prefixed with the source. Hearsay counts as evidence, but
//    less than first-hand experience: residents weigh it when choosing whom to
//    ask (sim.ts proposeCoop) and whether to say yes (npcAnswersProposal), and
//    the guardian's Agent can cite it in a judgment ("听 Mira 说：…");
//  * a good story warms the listener a little;
//  * hearsay fades after a week, and seeing for yourself (finishing a joint job
//    with the subject) clears it (tasks.ts).
// The same story is told to the same listener once.
// ---------------------------------------------------------------------------

import { getDb } from "./db";
import { simNow, HOUR_MS, DAY_MS } from "./clock";
import { adjustRelationship, agentName, logEvent, metric, recordIncident, remember, say } from "./records";

const WINDOW_MS = 72 * HOUR_MS;
export const HEARSAY_TTL_MS = 7 * DAY_MS;

interface Fact {
  subject: string;
  text: string; // as the speaker says it
  relay: string; // as the listener will remember it, without the source
  tone: 1 | -1;
  key: string;
}

/**
 * A true, recent story about `subject` that `speaker` would tell `listener`. Only two kinds of story travel:
 *  * a wrong the subject did — told first-hand by the one it was done to (a grudge they hold), or, if the whole
 *    town saw it (an importance-3 default / an inspection catching the subject's shortcut / a loan not repaid,
 *    with the subject as the one at fault), by anyone;
 *  * good work — told by someone who did a joint job with the subject.
 * Being refused, or failing a risky job, is not a wrong and is not passed on as one.
 */
function factAbout(subject: string, speaker: string, listener: string): Fact | null {
  const db = getDb();
  const since = simNow() - WINDOW_MS;
  const name = agentName(subject);
  const me = agentName(speaker);
  const grudge = db
    .prepare("SELECT id, text FROM incidents WHERE holder_id = ? AND offender_id = ? AND resolved = 0 AND kind != 'hearsay' ORDER BY at_ms DESC LIMIT 1")
    .get(speaker, subject) as { id: number; text: string } | undefined;
  if (grudge) {
    const t = grudge.text.replace(/^我/, "");
    return { subject, text: `${name}？上次${t}。`, relay: `${name} 对 ${me}：${t}`, tone: -1, key: `inc${grudge.id}` };
  }
  const rows = db
    .prepare(
      `SELECT id, kind, text, actors_json, importance FROM events WHERE at_ms >= ? AND actors_json LIKE ?
         AND ((importance >= 3 AND kind IN ('default','relationship')) OR (kind = 'coop' AND text LIKE '%完成了%'))
       ORDER BY importance DESC, at_ms DESC LIMIT 12`,
    )
    .all(since, `%"${subject}"%`) as Array<{ id: number; kind: string; text: string; actors_json: string; importance: number }>;
  for (const r of rows) {
    const actors = JSON.parse(r.actors_json) as string[];
    if (actors.includes(listener)) continue; // the listener was there
    if (r.kind === "coop") {
      if (!actors.includes(speaker)) continue; // only someone who worked with them vouches for them
      const job = /完成了(.+?)（/.exec(r.text)?.[1] ?? "那单活";
      return { subject, text: `跟 ${name} 一起做过${job}，靠得住。`, relay: `跟 ${name} 一起做过${job}，靠得住`, tone: 1, key: `ev${r.id}` };
    }
    // a public wrong, the subject the one at fault (listed first)
    if (actors[0] !== subject || !WRONG.test(r.text)) continue;
    const said = r.text.replace(/——.*$/, "");
    return { subject, text: `听说${said}。`, relay: said, tone: -1, key: `ev${r.id}` };
  }
  return null;
}

const WRONG = /中途撤出|终检查出问题|到期没还/;

/** The listener already heard this story — or told it themselves; a good word about the same person from the
 *  same speaker is not repeated within five days. */
function alreadyTold(fact: Fact, speaker: string, listener: string): boolean {
  const db = getDb();
  const told = db
    .prepare(
      `SELECT COUNT(*) n FROM metric_events WHERE name = 'gossip' AND json_extract(payload_json, '$.key') = ?
         AND (json_extract(payload_json, '$.listener') = ? OR json_extract(payload_json, '$.speaker') = ?)`,
    )
    .get(fact.key, listener, listener) as { n: number };
  if (told.n > 0) return true;
  if (fact.tone > 0) {
    const recent = db
      .prepare(
        `SELECT COUNT(*) n FROM metric_events WHERE name = 'gossip' AND at_ms >= ? AND json_extract(payload_json, '$.speaker') = ?
           AND json_extract(payload_json, '$.listener') = ? AND json_extract(payload_json, '$.subject') = ?`,
      )
      .get(simNow() - 5 * DAY_MS, speaker, listener, fact.subject) as { n: number };
    if (recent.n > 0) return true;
  }
  return false;
}

/** Pass a story on: the listener's opinion of the subject moves, and a bad story is kept as sourced hearsay. */
function tell(speaker: string, listener: string, fact: Fact, listenerIsAgent: boolean): void {
  const src = agentName(speaker);
  say(speaker, Array.from(fact.text).slice(0, 36).join(""), fact.tone < 0 ? "upset" : "think");
  if (fact.tone < 0) {
    recordIncident(listener, fact.subject, "hearsay", `听 ${src} 说：${fact.relay}`);
    adjustRelationship(listener, fact.subject, -2, `听 ${src} 说了 TA 的事`);
  } else {
    adjustRelationship(listener, fact.subject, 2, null);
  }
  if (listenerIsAgent) remember(listener, "hearsay", `听 ${src} 说：${fact.relay}。`, { speaker, subject: fact.subject });
  logEvent({
    kind: "relationship",
    text: `${src} 跟 ${agentName(listener)} 聊起了 ${agentName(fact.subject)}：“${fact.text}”`,
    actors: [speaker, listener, fact.subject],
    importance: listenerIsAgent ? 2 : 1,
  });
  metric("gossip", { speaker, listener, subject: fact.subject, key: fact.key, tone: fact.tone });
}

/** A resident tells another about the guardian's Agent (the Agent is not in the group). */
export function gossipAbout(agentId: string, speaker: string, listener: string): boolean {
  if (speaker === agentId || listener === agentId) return false;
  const fact = factAbout(agentId, speaker, listener);
  if (!fact || alreadyTold(fact, speaker, listener)) return false;
  tell(speaker, listener, fact, false);
  return true;
}

/** `speaker` tells `listener` about somebody else in town (`listenerIsAgent`: the guardian's Agent is the one listening). */
export function gossipBetween(speaker: string, listener: string, candidates: string[], listenerIsAgent: boolean): boolean {
  const pool = candidates.filter((c) => c !== speaker && c !== listener).sort(() => Math.random() - 0.5);
  for (const subject of pool) {
    const fact = factAbout(subject, speaker, listener);
    if (!fact || alreadyTold(fact, speaker, listener)) continue;
    tell(speaker, listener, fact, listenerIsAgent);
    return true;
  }
  return false;
}

/** Who a hearsay incident came from ("听 Mira 说：…" → "Mira"). */
export function hearsaySource(text: string): string {
  return /^听 (\S+) 说/.exec(text)?.[1] ?? "别人";
}

/** Seeing for yourself: a joint job done together clears what each had only heard about the other. */
export function clearHearsayBetween(a: string, b: string): number {
  return getDb()
    .prepare("UPDATE incidents SET resolved = 1 WHERE kind = 'hearsay' AND resolved = 0 AND ((holder_id = ? AND offender_id = ?) OR (holder_id = ? AND offender_id = ?))")
    .run(a, b, b, a).changes;
}

/** Old hearsay fades (called once a day). */
export function fadeHearsay(): void {
  getDb().prepare("UPDATE incidents SET resolved = 1 WHERE kind = 'hearsay' AND resolved = 0 AND at_ms < ?").run(simNow() - HEARSAY_TTL_MS);
}
