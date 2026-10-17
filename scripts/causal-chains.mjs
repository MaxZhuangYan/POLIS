#!/usr/bin/env node
// Causal chains in a save, every link a row you can look up (table#id), nothing inferred from wording alone
// beyond the exact substrings named below.
//
//   node scripts/causal-chains.mjs <polis.db> [--all]
//
// Two kinds of chain are traced:
//   A. a wrong → who heard about it → what it changed
//      incident (first-hand, offender = someone) → gossip rows that carried it (metric_events 'gossip', key
//      inc<id> or the public event's ev<id>) → hearsay incidents it left → later judgments / refusals / repairs
//      that quote the incident's own text.
//   B. a loan → what the money was for → how it ended → who heard
//      the loan event → the purchase it covered (metric_events 'purchase' with that lender, same hour) → the
//      repayment or the default → gossip about the default.
// A chain is printed when it spans at least two days and involves at least three people (--all prints every chain).

import Database from "better-sqlite3";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/causal-chains.mjs <polis.db> [--all]");
  process.exit(2);
}
const ALL = process.argv.includes("--all");
const db = new Database(file, { readonly: true });
const HOUR = 3600_000;
const player = db.prepare("SELECT id, name, created_at FROM agents WHERE is_player = 1").get();
const names = new Map(db.prepare("SELECT id, name FROM agents").all().map((a) => [a.id, a.name]));
const name = (id) => names.get(id) ?? id;
const t0 = player?.created_at ?? db.prepare("SELECT MIN(at_ms) t FROM events").get().t;
const tz = db.prepare("SELECT * FROM world_state WHERE id = 1").get()?.tz || process.env.POLIS_TZ || "Asia/Shanghai";
const hourOf = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false });
// D<n> = days since the Agent arrived (sim time), hour in the world's zone
const when = (ms) => `D${Math.floor((ms - t0) / (24 * HOUR)) + 1} ${hourOf.format(new Date(ms))}h`;
const gossip = db.prepare("SELECT id, at_ms, payload_json FROM metric_events WHERE name = 'gossip' ORDER BY at_ms").all().map((r) => ({ ...JSON.parse(r.payload_json), id: r.id, at: r.at_ms }));

const chains = [];

// ── A. wrongs ────────────────────────────────────────────────────────────
const wrongs = db.prepare("SELECT * FROM incidents WHERE kind != 'hearsay' ORDER BY at_ms").all();
for (const w of wrongs) {
  const links = [{ at: w.at_ms, row: `incidents#${w.id}`, text: `${name(w.holder_id)} 记下 ${name(w.offender_id)}：${w.text}` }];
  const people = new Set([w.holder_id, w.offender_id]);
  // the public event logged with it (same minute, both named)
  const ev = db
    .prepare("SELECT id, text FROM events WHERE at_ms BETWEEN ? AND ? AND importance >= 3 AND actors_json LIKE ? AND actors_json LIKE ? ORDER BY ABS(at_ms - ?) LIMIT 1")
    .get(w.at_ms - 60_000, w.at_ms + 60_000, `%"${w.holder_id}"%`, `%"${w.offender_id}"%`, w.at_ms);
  const keys = new Set([`inc${w.id}`, ...(ev ? [`ev${ev.id}`] : [])]);
  for (const g of gossip.filter((g) => keys.has(g.key))) {
    links.push({ at: g.at, row: `metric_events#${g.id}`, text: `${name(g.speaker)} 告诉 ${name(g.listener)}` });
    people.add(g.speaker).add(g.listener);
  }
  // what quoted it later: judgments and refusals carrying the incident's own words
  const frag = w.text.slice(0, 12);
  for (const j of db.prepare("SELECT id, created_ms, decision, status, to_player FROM judgments WHERE created_ms > ? AND instr(to_player, ?) > 0 ORDER BY created_ms").all(w.at_ms, frag)) {
    links.push({ at: j.created_ms, row: `judgments#${j.id}`, text: `它对守护灵的建议说「${j.decision}」（${j.status}）：${j.to_player.slice(0, 60)}…` });
  }
  // the same words can belong to two different wrongs (Tao holds the same complaint against two people): the event
  // must name both the one who holds it and the one it is held against
  for (const e of db
    .prepare("SELECT id, at_ms, kind, text FROM events WHERE at_ms > ? AND kind IN ('refuse','relationship') AND instr(text, ?) > 0 AND actors_json LIKE ? AND actors_json LIKE ? ORDER BY at_ms")
    .all(w.at_ms, frag, `%"${w.holder_id}"%`, `%"${w.offender_id}"%`)) {
    links.push({ at: e.at_ms, row: `events#${e.id}`, text: e.text });
  }
  // repairs between the two afterwards: an apology or compensation whose sentence names both of them
  for (const e of db
    .prepare(
      "SELECT id, at_ms, text FROM events WHERE at_ms > ? AND (text LIKE '%道歉%' OR text LIKE '%补偿%') AND actors_json LIKE ? AND actors_json LIKE ? AND instr(text, ?) > 0 AND instr(text, ?) > 0 ORDER BY at_ms",
    )
    .all(w.at_ms, `%"${w.holder_id}"%`, `%"${w.offender_id}"%`, name(w.holder_id), name(w.offender_id))) {
    links.push({ at: e.at_ms, row: `events#${e.id}`, text: e.text });
  }
  links.sort((a, b) => a.at - b.at);
  chains.push({ kind: "A", title: `${name(w.offender_id)} 对 ${name(w.holder_id)} 的一笔账`, links, people, span: links[links.length - 1].at - links[0].at });
}

// ── B. loans ─────────────────────────────────────────────────────────────
const loans = db.prepare("SELECT id, at_ms, text, actors_json FROM events WHERE text LIKE '%借给%Scrip（两天后到期）%' ORDER BY at_ms").all();
for (const l of loans) {
  const [lender, borrower] = JSON.parse(l.actors_json);
  const links = [{ at: l.at_ms, row: `events#${l.id}`, text: l.text }];
  const people = new Set([lender, borrower]);
  const buy = db
    .prepare("SELECT id, at_ms, payload_json FROM metric_events WHERE name = 'purchase' AND at_ms BETWEEN ? AND ? AND json_extract(payload_json, '$.npc') = ? AND json_extract(payload_json, '$.lender') = ?")
    .get(l.at_ms - 60_000, l.at_ms + HOUR, borrower, lender);
  if (buy) {
    const p = JSON.parse(buy.payload_json);
    links.push({ at: buy.at_ms, row: `metric_events#${buy.id}`, text: `${name(borrower)} 用这笔钱补上差额：${p.what}（${p.price} Scrip）` });
  }
  const end = db
    .prepare(
      "SELECT id, at_ms, kind, text FROM events WHERE at_ms > ? AND at_ms < ? AND actors_json LIKE ? AND actors_json LIKE ? AND (text LIKE '%按时还给%' OR text LIKE '%到期没还%') ORDER BY at_ms LIMIT 1",
    )
    .get(l.at_ms, l.at_ms + 3 * 24 * HOUR, `%"${borrower}"%`, `%"${lender}"%`);
  if (end) {
    links.push({ at: end.at_ms, row: `events#${end.id}`, text: end.text });
    if (end.kind === "default") {
      for (const g of gossip.filter((g) => g.key === `ev${end.id}`)) {
        links.push({ at: g.at, row: `metric_events#${g.id}`, text: `${name(g.speaker)} 告诉 ${name(g.listener)}：${name(borrower)} 欠钱没还` });
        people.add(g.speaker).add(g.listener);
      }
    }
  }
  chains.push({ kind: "B", title: `${name(lender)} 借给 ${name(borrower)}`, links, people, span: links[links.length - 1].at - links[0].at });
}

const shown = chains.filter((c) => ALL || (c.span >= 24 * HOUR && c.people.size >= 3 && c.links.length >= 3));
shown.sort((a, b) => b.links.length - a.links.length);
console.log(`causal chains in ${file}${player ? ` (the guardian's Agent: ${player.name})` : ""}: ${shown.length} shown of ${chains.length}`);
for (const c of shown) {
  console.log(`\n[${c.kind}] ${c.title} — ${c.people.size} people, ${Math.round(c.span / HOUR)} h`);
  for (const l of c.links) console.log(`  ${when(l.at).padEnd(8)} ${l.row.padEnd(20)} ${l.text}`);
}
