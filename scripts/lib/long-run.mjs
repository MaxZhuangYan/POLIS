// Long-run health report for a finished sim save (scripts/sim-playthrough.mjs prints it).
//
// What a month of play can go wrong in, measured from the save itself (nothing here is sampled or estimated):
//   * interruptions — forks / judgments / 默契 guesses / waverings asking for the guardian, per day
//   * stagnation   — days where nothing of weight (importance >= 2) happened to the Agent
//   * repetition   — share of the Agent's memories that repeat an earlier one word-for-word (numbers masked)
//   * economy      — the Agent's balance by day, residents who are broke or hoarding
//   * convergence  — whether one job template eats the Agent's working weeks
//   * imprints     — how many, how many asleep, duplicates by text
//   * the social web — gossip told, hearsay held / cleared, refusals that cite a story
//
// Usage (from a script): import { longRunReport } from "./lib/long-run.mjs"; const r = longRunReport(db, pid);
// r.lines is printable, r.checks is [{label, ok, detail}] the caller turns into PASS / FAIL.

const DAY_MS = 24 * 3600_000;

export function longRunReport(db, pid) {
  const lines = [];
  const checks = [];
  const created = db.prepare("SELECT created_at FROM agents WHERE id = ?").get(pid)?.created_at;
  if (!created) return { lines: ["(no player agent)"], checks };
  const last = db.prepare("SELECT MAX(at_ms) t FROM events").get().t ?? created;
  const days = Math.max(1, Math.ceil((last - created) / DAY_MS));
  const dayOf = (ms) => Math.floor((ms - created) / DAY_MS);
  const perDay = () => Array.from({ length: days }, () => 0);

  // interruptions
  const asks = { fork: perDay(), judgment: perDay(), guess: perDay(), wavering: perDay() };
  const bump = (arr, ms) => {
    const d = dayOf(ms);
    if (d >= 0 && d < days) arr[d]++;
  };
  for (const r of db.prepare("SELECT created_at FROM decision_moments WHERE agent_id = ?").all(pid)) bump(asks.fork, r.created_at);
  for (const r of db.prepare("SELECT created_ms FROM judgments WHERE agent_id = ?").all(pid)) bump(asks.judgment, r.created_ms);
  for (const r of db.prepare("SELECT created_ms FROM guesses WHERE agent_id = ?").all(pid)) bump(asks.guess, r.created_ms);
  for (const r of db.prepare("SELECT created_at FROM wavering_events WHERE agent_id = ?").all(pid)) bump(asks.wavering, r.created_at);
  const total = perDay().map((_, d) => asks.fork[d] + asks.judgment[d] + asks.guess[d] + asks.wavering[d]);
  const expired = db.prepare("SELECT COUNT(*) n FROM decision_moments WHERE agent_id = ? AND status = 'expired_autonomous'").get(pid).n;
  lines.push(`asks per day (fork+judgment+guess+wavering): ${total.join(" ")}  · forks that ran out and the Agent decided: ${expired}`);
  const busiest = Math.max(...total.slice(1));
  checks.push({ label: "no day after D1 asks the guardian more than 5 times", ok: busiest <= 5, detail: `max ${busiest}` });
  const quietWeeks = [];
  // whole weeks only: the run's last, partial week (often just the final evening) says nothing
  for (let w = 1; w * 7 + 7 <= days; w++) {
    const s = total.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0);
    if (s === 0) quietWeeks.push(w + 1);
  }
  checks.push({ label: "every week after the first asks the guardian something", ok: quietWeeks.length === 0, detail: `silent weeks: ${quietWeeks.join(",")}` });

  // stagnation
  const weighty = perDay();
  for (const r of db.prepare("SELECT at_ms, actors_json FROM events WHERE importance >= 2").all()) if (r.actors_json.includes(`"${pid}"`)) bump(weighty, r.at_ms);
  let streak = 0;
  let worst = 0;
  for (const n of weighty.slice(1)) {
    streak = n === 0 ? streak + 1 : 0;
    worst = Math.max(worst, streak);
  }
  lines.push(`events of weight involving the Agent per day: ${weighty.join(" ")}`);
  checks.push({ label: "no 3-day stretch where nothing of weight happens to the Agent", ok: worst < 3, detail: `longest quiet stretch ${worst} days` });

  // repetition, by week
  const mems = db.prepare("SELECT at_ms, text FROM memories WHERE agent_id = ? ORDER BY at_ms").all(pid);
  const seen = new Set();
  const rep = [];
  for (let w = 0; w * 7 + 7 <= days; w++) {
    const wk = mems.filter((m) => dayOf(m.at_ms) >= w * 7 && dayOf(m.at_ms) < w * 7 + 7);
    let again = 0;
    for (const m of wk) {
      const k = m.text.replace(/\d+/g, "#");
      if (seen.has(k)) again++;
      seen.add(k);
    }
    rep.push(wk.length ? Math.round((100 * again) / wk.length) : 0);
  }
  lines.push(`memories repeating an earlier one, % per week: ${rep.join(" ")}`);

  // economy
  const bal = perDay();
  let run = 0;
  const ledger = db.prepare("SELECT amount, at_ms FROM ledger WHERE agent_id = ? AND reason != 'task_fee_burn' ORDER BY id").all(pid);
  let i = 0;
  for (let d = 0; d < days; d++) {
    while (i < ledger.length && (ledger[i].at_ms == null || dayOf(ledger[i].at_ms) <= d)) run += ledger[i++].amount;
    bal[d] = run;
  }
  lines.push(`Agent balance at the end of each day: ${bal.join(" ")}`);
  const npcs = db.prepare("SELECT id, scrip, reputation FROM agents WHERE is_player = 0 ORDER BY id").all();
  lines.push(`residents now: ${npcs.map((n) => `${n.id} ${n.scrip}S/rep${n.reputation}`).join(" · ")}`);
  checks.push({ label: "no resident's balance went negative", ok: npcs.every((n) => n.scrip >= 0), detail: npcs.map((n) => n.scrip).join(",") });

  // convergence of the Agent's work
  const jobs = db
    .prepare("SELECT template_id, done_ms FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND status = 'done' AND done_ms IS NOT NULL AND mode != 'routine'")
    .all(pid, pid);
  const conv = [];
  for (let w = 0; w * 7 + 7 <= days; w++) {
    const wk = jobs.filter((j) => dayOf(j.done_ms) >= w * 7 && dayOf(j.done_ms) < w * 7 + 7);
    const by = new Map();
    for (const j of wk) by.set(j.template_id, (by.get(j.template_id) ?? 0) + 1);
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    conv.push(top ? `${top[0]} ${Math.round((100 * top[1]) / wk.length)}% of ${wk.length}` : "—");
  }
  lines.push(`most-done job per week: ${conv.join(" | ")}`);

  // imprints
  // asleep = weight under the dormancy threshold (lib/imprints.ts DORMANT_THRESHOLD = 0.3); merged twins are not separate imprints
  const pr = db.prepare("SELECT text, weight, source FROM principles WHERE agent_id = ?").all(pid);
  const dupes = pr.length - new Set(pr.map((p) => p.text)).size;
  lines.push(`imprints: ${pr.length} (${pr.filter((p) => p.weight < 0.3).length} asleep) · sources ${[...new Set(pr.map((p) => p.source))].join("/")} · same-text duplicates ${dupes}`);
  checks.push({ label: "no two imprints with the same text", ok: dupes === 0, detail: `${dupes}` });

  // the social web
  const gossip = db.prepare("SELECT payload_json FROM metric_events WHERE name = 'gossip'").all().map((r) => JSON.parse(r.payload_json));
  const hearsay = db.prepare("SELECT resolved FROM incidents WHERE kind = 'hearsay'").all();
  const heardByAgent = gossip.filter((g) => g.listener === pid).length;
  const aboutAgent = gossip.filter((g) => g.subject === pid).length;
  const refusedOnStory = db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'refuse' AND text LIKE '%我听%说了你的事%'").get().n;
  lines.push(
    `gossip told ${gossip.length} (about the Agent ${aboutAgent}, to the Agent ${heardByAgent}) · hearsay held ${hearsay.filter((h) => !h.resolved).length}, faded or cleared ${hearsay.filter((h) => h.resolved).length} · refusals over a story ${refusedOnStory}`,
  );
  // money that moves between people: loans (and how they ended) and what residents bought (lib/goals.ts)
  const weekOf = (ms) => Math.floor(dayOf(ms) / 7);
  const loans = db.prepare("SELECT at_ms FROM events WHERE text LIKE '%借给%Scrip（两天后到期）%'").all();
  const repaid = db.prepare("SELECT COUNT(*) n FROM events WHERE text LIKE '%按时还给%'").get().n;
  const unpaid = db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'default' AND text LIKE '%到期没还%'").get().n;
  const buys = db.prepare("SELECT at_ms FROM metric_events WHERE name = 'purchase'").all();
  const perWeek = (rows) => {
    const out = Array.from({ length: Math.ceil(days / 7) }, () => 0);
    for (const r of rows) if (weekOf(r.at_ms) >= 0 && weekOf(r.at_ms) < out.length) out[weekOf(r.at_ms)]++;
    return out;
  };
  const loanWeeks = perWeek(loans);
  lines.push(`loans per week ${loanWeeks.join(" ")} (repaid ${repaid}, unpaid ${unpaid}) · residents' purchases per week ${perWeek(buys).join(" ")}`);
  const fullWeeks = Math.floor(days / 7);
  if (fullWeeks >= 2) {
    const deadWeeks = loanWeeks.slice(1, fullWeeks).map((n, i) => (n === 0 ? i + 2 : 0)).filter(Boolean);
    checks.push({ label: "people still lend each other money after the first week", ok: deadWeeks.length < fullWeeks - 1, detail: `weeks without a loan: ${deadWeeks.join(",")}` });
  }
  const fam = db.prepare("SELECT familiarity FROM relationships WHERE agent_id = ?").all(pid).map((r) => r.familiarity);
  lines.push(`Agent's familiarity with each resident: ${fam.join(" ")} (at 100: ${fam.filter((f) => f >= 100).length})`);
  return { lines, checks };
}
