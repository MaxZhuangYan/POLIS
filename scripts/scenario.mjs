#!/usr/bin/env node
// Build a save at a story beat, so you can open the game exactly where you want to work.
//
//   npm run scenario -- <name> [--db path] [--force] [--policy careful|bold] [--name 阿守]
//   npm run scenario -- --list
//
//   names: fresh | d1-forks | d2-morning | d5-bait | week2 | pitch   (what each one produces: --list)
//
//   pitch — the investor-demo save: a bold guardian's days 1-9, stopped in the daytime of day 9-10 with something
//   still waiting for the presenter (a fork or a 默契 guess, an unread postcard). Because the world has chance it
//   retries (--tries, --extra-hours) and prints a "what to show" list read from the save's real rows.
//   npm run scenario -- pitch --force          then  npm run dev:test
//   npm run scenario -- pitch --rewind         right before presenting: put the sim clock back to the moment the save
//                                              was built (otherwise every real hour since the build is a game hour)
//
// It starts its own test-mode server on a free port against the target save (default ./polis-test.db), drives the
// game's HTTP API like a guardian would (scripts/lib/scenarios.mjs), prints what it produced, and stops the server.
// It refuses to overwrite a save that already exists unless you pass --force. The model is always OFF here (rules
// engine), so the run is deterministic enough to be a fixture.
//
// Open the result:  npm run dev:test        (it reads ./polis-test.db)
//        any other path:  POLIS_TEST_MODE=1 POLIS_DB_PATH=<path> npx next dev

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { findChains } from "./causal-chains.mjs";
import { ROOT, apiClient, removeDbFiles, startDevServer } from "./lib/dev-server.mjs";
import { SCENARIO_HELP, SCENARIO_NAMES, buildScenario, describeState, pickOption } from "./lib/scenarios.mjs";

const PITCH = "pitch";
const PITCH_HELP = "the investor-demo save: a bold guardian's days 1-9, daytime on day 9-10, a fork / 默契 guess and an unread postcard waiting";
const ALL_NAMES = [...SCENARIO_NAMES, PITCH];

function parseArgs(argv) {
  const out = { _: [], force: false, list: false, db: "./polis-test.db", policy: "careful", name: undefined, tries: 4, extraHours: 30, rewind: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") out.force = true;
    else if (a === "--list" || a === "-l") out.list = true;
    else if (a === "--db") out.db = argv[++i];
    else if (a.startsWith("--db=")) out.db = a.slice(5);
    else if (a === "--policy") out.policy = argv[++i];
    else if (a.startsWith("--policy=")) out.policy = a.slice(9);
    else if (a === "--name") out.name = argv[++i];
    else if (a.startsWith("--name=")) out.name = a.slice(7);
    else if (a === "--rewind") out.rewind = true;
    else if (a === "--tries") out.tries = Number(argv[++i]);
    else if (a.startsWith("--tries=")) out.tries = Number(a.slice(8));
    else if (a === "--extra-hours") out.extraHours = Number(argv[++i]);
    else if (a.startsWith("--extra-hours=")) out.extraHours = Number(a.slice(14));
    else if (a === "-h" || a === "--help") out.help = true;
    else out._.push(a);
  }
  return out;
}

function usage() {
  console.log(`usage: npm run scenario -- <name> [--db path] [--force] [--policy careful|bold] [--name 阿守]\n`);
  for (const n of SCENARIO_NAMES) console.log(`  ${n.padEnd(11)} ${SCENARIO_HELP[n]}`);
  console.log(`  ${PITCH.padEnd(11)} ${PITCH_HELP}`);
  console.log(`\n  --db      save to create (default ./polis-test.db, the one \`npm run dev:test\` opens)`);
  console.log(`  --force   overwrite an existing save (without it the script refuses)`);
  console.log(`  pitch only:  --tries N (full rebuilds if the world did not give a good demo, default 4)`);
  console.log(`               --extra-hours N (hours to keep looking for a daytime with something pending, default 30)`);
  console.log(`               --rewind (re-align the sim clock of an existing pitch save; run it with the dev server stopped)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list || args.help || args._.length === 0) {
    usage();
    process.exit(args._.length === 0 && !args.list && !args.help ? 1 : 0);
  }
  const name = args._[0];
  if (!ALL_NAMES.includes(name)) {
    console.error(`unknown scenario "${name}"\n`);
    usage();
    process.exit(1);
  }
  if (!["careful", "bold"].includes(args.policy)) {
    console.error(`--policy must be careful or bold (got "${args.policy}")`);
    process.exit(1);
  }
  const dbPath = path.resolve(process.cwd(), args.db);
  if (name === PITCH && args.rewind) return pitchRewind(dbPath);
  if (name === PITCH) return pitchMain(args, dbPath);
  const exists = ["", "-wal", "-shm"].some((suf) => existsSync(dbPath + suf));
  if (exists && !args.force) {
    console.error(`${dbPath} already exists. Refusing to overwrite a save; pass --force to replace it, or choose another --db path.`);
    process.exit(2);
  }
  if (exists) removeDbFiles(dbPath);

  console.log(`scenario "${name}" -> ${dbPath}  (policy ${args.policy}, model off)`);
  console.log("starting a throw-away test-mode server (the first compile takes a little while)...");
  const server = await startDevServer({ dbPath, llm: "off", distDir: process.env.PLAYTEST_DIST_DIR || ".next-scenario" });
  let result;
  try {
    result = await buildScenario(name, {
      api: apiClient(server.base),
      log: (line) => console.log(line),
      policy: args.policy,
      name: args.name,
    });
  } catch (err) {
    console.error(`\nscenario failed: ${err.message}`);
    const tail = server.log().split("\n").slice(-20).join("\n");
    console.error(`--- server log (tail) ---\n${tail}`);
    await server.stop();
    removeDbFiles(dbPath); // do not leave a half-built save behind
    process.exit(1);
  }
  const serverErrors = server.log().split("\n").filter((l) => /\bError\b|TypeError|SqliteError|\[sim\] step failed|unhandled/i.test(l) && !/ECONNREFUSED/.test(l));
  await server.stop();
  // let SQLite fold the WAL back into the main file so the save is one tidy file
  try {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath);
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
  } catch {
    /* the -wal/-shm files are still valid, just left beside it */
  }

  console.log(`\n=== "${name}" ready ===`);
  for (const l of result.summary) console.log(`  ${l}`);
  for (const n of result.notes) console.log(`\n  NOTE: ${n}`);
  if (serverErrors.length) console.log(`\n  WARNING: the server logged errors while building this save:\n    ${serverErrors.slice(0, 5).join("\n    ")}`);

  const rel = path.relative(ROOT, dbPath);
  console.log("\nopen it:");
  if (rel === "polis-test.db") console.log("  npm run dev:test        then http://localhost:3000");
  else console.log(`  POLIS_TEST_MODE=1 POLIS_DB_PATH=${dbPath} npx next dev`);
  console.log(
    "\nthe clock keeps going from the moment you open the save: the world lives (real time elapsed) more hours, and\n" +
      "the test panel (bottom-left) fast-forwards from there. Open it soon after building.",
  );
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// pitch: the demo save. Everything goes through the game's HTTP API (player/create, decisions/choose,
// judgments/resolve, guesses, notes, postcards/read, survey) and the labelled test fast-forward. The only thing this
// script writes into the DB by itself is the clock offset in --rewind, and that never touches a story row.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, "0");
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const PITCH_DAY = 8; // dayIndex 8 = "day 9": the stop-and-look phase starts here, at 07:00
const DAYTIME = (h) => h >= 9 && h <= 16;

/** Play the bold guardian until day 9 07:00, then look hour by hour for a good place to stop. */
async function playPitch(api, { log, extraHours, playerName = "阿守" }) {
  const policy = "bold";
  let forced = 0;
  const get = async () => {
    const r = await api("GET", "/api/game/state");
    if (r.status !== 200) throw new Error(`GET /api/game/state -> ${r.status}`);
    return r.json;
  };
  const must = async (label, promise) => {
    const r = await promise;
    if (r.status !== 200) throw new Error(`${label} failed: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    return r.json;
  };
  const advance = (hours) => must(`advance ${hours}h`, api("POST", "/api/test/advance", { hours }));
  const stamp = (s) => `day ${s.player.dayIndex + 1} ${pad2(s.world.hour)}:00`;

  // a judgment is always answered, even in the look-around phase (it can only come from a fork we already chose)
  async function judgment(s) {
    const j = s.player.pendingJudgment;
    if (!j) return false;
    const action = j.decision === "refuse" ? (forced === 0 && j.canForce ? "force" : "accept") : "overrule";
    if (action === "force") forced++;
    await must(`judgment ${j.decision} -> ${action}`, api("POST", `/api/judgments/${j.id}/resolve`, { action }));
    await api("POST", `/api/judgments/${j.id}/feedback`, { value: "surprising_reasonable" });
    log(`  ${stamp(s)} the Agent said ${j.decision}; guardian: ${action}`);
    return true;
  }

  /** answer everything a bold guardian would (forks, 默契, wavering). Not used in the look-around phase. */
  async function answerAll() {
    for (let guard = 0; guard < 10; guard++) {
      const s = await get();
      const p = s.player;
      if (await judgment(s)) continue;
      if (p.pendingWavering) {
        await must("wavering", api("POST", `/api/wavering/${p.pendingWavering.id}/resolve`, { resolution: "reaffirm" }));
        log(`  ${stamp(s)} the Agent questioned a principle; guardian: reaffirm`);
        continue;
      }
      const m = p.pendingMoments[0];
      if (m) {
        const choice = pickOption(policy, m);
        await must(`choose ${m.templateId}`, api("POST", `/api/decisions/${m.id}/choose`, { optionId: choice }));
        log(`  ${stamp(s)} fork ${m.templateId} -> ${m.options.find((x) => x.id === choice)?.label}`);
        continue;
      }
      if (p.guess && !p.guess.guessed) {
        const g = p.guess.options[0];
        await must("guess", api("POST", `/api/guesses/${p.guess.id}`, { optionId: g.id }));
        log(`  ${stamp(s)} 默契 guess (${p.guess.origin}) -> ${g.label}`);
        continue;
      }
      return;
    }
  }

  async function readCards() {
    const cur = await get();
    for (const c of cur.player.postcards.items.filter((x) => !x.read)) await api("POST", `/api/postcards/${c.id}/read`);
    const v = (await get()).player.survey.pendingVolume;
    if (v != null) {
      await api("POST", "/api/survey", { volume: v, words: ["敢闯", "讲义气", "有主见"] });
      log(`  volume ${v}: the guardian described the Agent in three words`);
    }
  }

  // ── day 1 ──
  let s = await get();
  if (s.world.hour >= 12 || s.world.hour < 7) {
    await must("advance to morning", api("POST", "/api/test/advance", { to: "morning" }));
    log("  fast-forwarded to the next 07:00 so day 1 has a working day");
  }
  await must("create player", api("POST", "/api/player/create", { name: playerName, sprite: "courier", tz: "Asia/Shanghai" }));
  s = await get();
  if (s.player.pendingMoments.length !== 3) throw new Error(`expected 3 first forks, got ${s.player.pendingMoments.length}`);
  for (const m of s.player.pendingMoments) {
    const choice = pickOption(policy, m);
    await must(`choose ${m.templateId}`, api("POST", `/api/decisions/${m.id}/choose`, { optionId: choice }));
    log(`  first fork ${m.templateId}: ${m.options.find((x) => x.id === choice)?.label}`);
  }
  for (let i = 0; ; i++) {
    s = await get();
    if (s.player.onboarding === "imprint" && s.player.principles.length >= 3) break;
    if (i > 50) throw new Error("the first three principles did not form");
    await sleepMs(200);
  }
  await must("onboarding ack", api("POST", "/api/player/onboarding"));
  await api("POST", "/api/notes", { text: "今天辛苦了" });

  // ── days 1-8, three hours at a time ──
  for (let h = 0; h < 24 * 14; h += 3) {
    await advance(3);
    s = await get();
    if (s.player.dayIndex >= PITCH_DAY && s.world.hour >= 7) break; // stop BEFORE answering: what arrived overnight stays
    await answerAll();
    await readCards();
    if (s.world.hour >= 21 && s.player.dayIndex >= 1 && s.player.dayIndex <= 2 && s.player.notes.leftToday > 0) {
      await api("POST", "/api/notes", { text: "做人要说话算话" });
    }
  }

  // ── the look-around phase: from day 9 07:00 on, one hour at a time ──
  // good = a fork (≥3 h left) or an unguessed 默契 (≥1.5 h left) in front of the guardian + an unread postcard + the town in daytime
  const good = (st) => {
    const p = st.player;
    const now = st.world.simNowMs;
    // forks expire (the Agent then decides alone) 24 h after they appear, a 默契 is settled by its due time:
    // do not stop on one that is about to run out while the presenter is still talking
    const forksFresh = p.pendingMoments.length > 0 && p.pendingMoments.every((m) => m.expiresAtMs - now >= 3 * 3_600_000);
    const guessFresh = p.guess != null && !p.guess.guessed && p.guess.dueMs - now >= 90 * 60_000;
    return (forksFresh || guessFresh) && p.postcards.unread > 0 && DAYTIME(st.world.hour) && !st.world.isNight;
  };
  let extra = 0;
  for (;;) {
    s = await get();
    if (s.player.pendingJudgment) {
      await judgment(s);
      continue;
    }
    if (good(s) || extra >= extraHours) break;
    await advance(1);
    extra++;
  }
  s = await get();
  log(`  look-around phase: ${extra} extra hour(s) after day 9 07:00 -> ${good(s) ? "stopped at a good moment" : "no good moment found"}`);
  return { state: s, good: good(s), extraHours: extra };
}

/** What to show, read from the save's real rows (read-only). Returns { lines, core, score } */
function pitchReport(dbPath, state) {
  const db = new Database(dbPath, { readonly: true });
  const p = state.player;
  const pid = p.agent.id;
  const names = new Map(db.prepare("SELECT id, name FROM agents").all().map((a) => [a.id, a.name]));
  const nm = (id) => names.get(id) ?? id;
  const t0 = p.createdAtMs;
  const D = (ms) => `D${Math.floor((ms - t0) / 86_400_000) + 1}`;
  const cut = (t, n = 70) => (t.length > n ? `${t.slice(0, n)}…` : t);
  const lines = [];
  const core = {};

  // refusals and the forced imprint
  const refusals = db.prepare("SELECT j.*, p.text principle FROM judgments j LEFT JOIN principles p ON p.id = j.cited_principle_id WHERE j.agent_id = ? AND j.decision = 'refuse' ORDER BY j.created_ms").all(pid);
  core.refusal = refusals.length > 0;
  lines.push(`refusals     ${refusals.length}${refusals.length ? "  (the Agent said no; judgments#id)" : ""}`);
  for (const r of refusals.slice(0, 3)) {
    lines.push(`  ${D(r.created_ms)} judgments#${r.id} [${r.status}, ${r.source}] 「${cut(r.to_player, 90)}」${r.principle ? ` — cites 『${cut(r.principle, 30)}』` : ""}`);
  }
  const forcedPr = db.prepare("SELECT id, text, created_at FROM principles WHERE agent_id = ? AND source = 'forced' ORDER BY created_at").all(pid);
  const forcedMem = db.prepare("SELECT id, text FROM memories WHERE agent_id = ? AND kind = 'forced' ORDER BY at_ms").all(pid);
  core.forced = forcedPr.length > 0;
  lines.push(`forced       ${forcedPr.length} imprint(s) from 强制执行 (tag 被迫)`);
  for (const f of forcedPr.slice(0, 2)) lines.push(`  ${D(f.created_at)} principles#${f.id} 『${cut(f.text, 60)}』`);
  if (forcedMem[0]) lines.push(`  memories#${forcedMem[0].id} 「${cut(forcedMem[0].text, 80)}」`);

  // memory tags (whose idea): one example each, from the snapshot the UI gets
  const byTag = new Map();
  for (const m of p.memories) if (m.tag && !byTag.has(m.tag)) byTag.set(m.tag, m);
  lines.push(`memory tags  ${[...byTag.keys()].join(" · ") || "—"}  (记忆 tab)`);
  for (const [tag, m] of byTag) lines.push(`  [${tag}] ${cut(m.text, 70)}`);

  // dilemmas
  const dil = db.prepare("SELECT at_ms, payload_json FROM metric_events WHERE name = 'dilemma' ORDER BY at_ms").all().map((r) => ({ at: r.at_ms, ...JSON.parse(r.payload_json) }));
  core.dilemma = dil.length > 0;
  lines.push(`dilemmas     ${dil.length}: ${dil.map((d) => `${D(d.at)} ${nm(d.npc)} ${d.templateId} ${d.asked ? "asked the guardian" : "decided alone"}`).join(" | ") || "—"}`);

  // hearsay + loans
  const hearsay = db.prepare("SELECT * FROM incidents WHERE kind = 'hearsay' ORDER BY at_ms").all();
  // what the 关系 tab of the Agent can show right now: unresolved hearsay naming its source ("听 X 说：…")
  const seen = p.relationships.flatMap((r) => r.incidents.filter((i) => /听 .+ 说：/.test(i.text)).map((i) => ({ who: nm(r.otherId), text: i.text })));
  core.hearsay = hearsay.length > 0;
  core.hearsayOnScreen = seen.length > 0;
  lines.push(`hearsay      ${hearsay.length} rows (incidents.kind='hearsay'), ${seen.length} still on the 关系 tab`);
  for (const h of seen.slice(0, 3)) lines.push(`  on screen: [${h.who}] ${cut(h.text, 80)}`);
  for (const h of hearsay.slice(0, 3)) lines.push(`  ${D(h.at_ms)} incidents#${h.id} ${nm(h.holder_id)} about ${nm(h.offender_id)}: ${cut(h.text, 70)}`);
  const purchases = db.prepare("SELECT id, at_ms, payload_json FROM metric_events WHERE name = 'purchase' ORDER BY at_ms").all().map((r) => ({ id: r.id, at: r.at_ms, ...JSON.parse(r.payload_json) }));
  const lent = purchases.filter((x) => x.lender);
  core.loan = lent.length > 0;
  lines.push(`loans        ${lent.length} purchase(s) a loan paid the gap for; ${purchases.length} purchases in all`);
  for (const x of lent.slice(0, 2)) lines.push(`  ${D(x.at)} metric_events#${x.id} ${nm(x.npc)} bought ${x.what} (${x.price} Scrip), ${nm(x.lender)} lent the rest`);
  try {
    // same rows, same code as `node scripts/causal-chains.mjs <db>`
    const { shown, chains, when } = findChains(db);
    const pool = shown.length ? shown : chains.filter((c) => c.links.length >= 2);
    // the longest chain of each kind (a wrong that travelled, a loan that was paid back or not)
    const pick = ["A", "B"].map((k) => pool.find((c) => c.kind === k)).filter(Boolean);
    lines.push(`chains       ${shown.length} full chain(s) of ${chains.length} traced  (node scripts/causal-chains.mjs <db>; chains of one kind can overlap)`);
    for (const c of pick) {
      lines.push(`  [${c.kind}] ${c.title} — ${c.people.size} people`);
      for (const l of c.links.slice(0, 5)) lines.push(`    ${when(l.at).padEnd(8)} ${l.row.padEnd(18)} ${cut(l.text, 80)}`);
    }
  } catch (e) {
    lines.push(`chains       (could not trace: ${e.message})`);
  }

  // postcards / weekly volume
  const recaps = db.prepare("SELECT id, day_index, title, lines_json FROM postcards WHERE agent_id = ? AND kind = 'recap7' ORDER BY day_index").all(pid);
  core.recap = recaps.length > 0;
  lines.push(`weekly vol.  ${recaps.length}: ${recaps.map((r) => `postcards#${r.id} ${r.title}`).join(" | ") || "—"}`);
  for (const r of recaps.slice(0, 1)) {
    const ls = JSON.parse(r.lines_json);
    const watch = ls.find((l) => l.startsWith("下周看点"));
    lines.push(`  下周看点: ${watch ? cut(watch, 100) : "none in volume 1 — it first appears in volume 2 (night of day 14)"}`);
  }
  lines.push(`progression  ${p.progression.title} · rep ${p.progression.reputation} · epithets ${p.progression.epithets.map((e) => e.label).join("/") || "—"} · 默契 ${p.attunement.correct}/${p.attunement.total} · imprint slots ${p.imprintSlots.used}/${p.imprintSlots.total}`);
  db.close();
  const score = Object.values(core).filter(Boolean).length * 10;
  return { lines, core, score };
}

function pendingLines(s) {
  const p = s.player;
  const out = [];
  const now = s.world.simNowMs;
  const hrs = (ms) => `${Math.round(((ms - now) / 3_600_000) * 10) / 10} h`;
  out.push(`forks        ${p.pendingMoments.length}: ${p.pendingMoments.map((m) => `${m.templateId} (${m.speakerId ?? "?"}, ${hrs(m.expiresAtMs)} left) "${m.promptText.slice(0, 40)}…" [${m.options.map((o) => o.label).join(" / ")}]`).join(" | ") || "—"}`);
  out.push(`默契 guess    ${p.guess ? `${p.guess.guessed ? "already guessed" : `PENDING (settled in ${hrs(p.guess.dueMs)})`}: ${p.guess.origin} [${p.guess.options.map((o) => o.label).join(" / ")}]` : "—"}`);
  out.push(`wavering     ${p.pendingWavering ? "pending: " + p.pendingWavering.promptText.slice(0, 60) : "—"}`);
  out.push(`postcards    ${p.postcards.unread} unread: ${p.postcards.items.filter((c) => !c.read).map((c) => c.title).join(" | ") || "—"}`);
  out.push(`scrip        ${p.agent.scrip} (强制执行 costs 30 Scrip; ${p.agent.scrip >= 30 ? "affordable" : "NOT enough for a live force"})`);
  return out;
}

/**
 * Which answer to the first pending fork makes the Agent push back? Asked of THROW-AWAY COPIES of the save (one server
 * per option, through POST /api/decisions/:id/choose, the same call the UI makes); the real save is not touched.
 * The rules engine is deterministic for a given state, so the real save answers the same way.
 */
async function probeFirstFork(dbPath, state) {
  const m = state.player.pendingMoments[0];
  if (!m) return null;
  const rows = [];
  for (const [i, o] of m.options.entries()) {
    const copy = dbPath.replace(/\.db$/, "") + `.probe${i}.db`;
    removeDbFiles(copy);
    copyFileSync(dbPath, copy);
    const server = await startDevServer({ dbPath: copy, llm: "off", distDir: process.env.PLAYTEST_DIST_DIR || ".next-scenario" });
    try {
      const r = await apiClient(server.base)("POST", `/api/decisions/${m.id}/choose`, { optionId: o.id });
      const j = r.json?.judgment;
      rows.push({ label: o.label, status: r.status, decision: j?.decision ?? null, text: j?.to_player ?? null });
    } catch (e) {
      rows.push({ label: o.label, status: 0, decision: null, text: `probe failed: ${e.message}` });
    } finally {
      await server.stop();
      removeDbFiles(copy);
    }
  }
  return { fork: `${m.templateId} (${m.speakerId ?? "?"})`, rows };
}

async function pitchMain(args, dbPath) {
  const exists = ["", "-wal", "-shm"].some((suf) => existsSync(dbPath + suf));
  if (exists && !args.force) {
    console.error(`${dbPath} already exists. Refusing to overwrite a save; pass --force to replace it, or choose another --db path.`);
    process.exit(2);
  }
  const tries = Math.max(1, args.tries || 1);
  const tryPath = (n) => dbPath.replace(/\.db$/, "") + `.try${n}.db`;
  console.log(`scenario "pitch" -> ${dbPath}  (bold guardian, model off, up to ${tries} build(s), up to ${args.extraHours} extra hours each)`);
  console.log("starting throw-away test-mode servers (the first compile takes a little while)...");

  let best = null;
  const errors = [];
  for (let n = 1; n <= tries; n++) {
    const tp = tryPath(n);
    removeDbFiles(tp);
    console.log(`\n--- build ${n}/${tries} -> ${path.basename(tp)} ---`);
    const server = await startDevServer({ dbPath: tp, llm: "off", distDir: process.env.PLAYTEST_DIST_DIR || ".next-scenario" });
    let res;
    try {
      res = await playPitch(apiClient(server.base), { log: (l) => console.log(l), extraHours: args.extraHours, playerName: args.name });
    } catch (err) {
      console.error(`build ${n} failed: ${err.message}`);
      console.error(server.log().split("\n").slice(-15).join("\n"));
      await server.stop();
      removeDbFiles(tp);
      continue;
    }
    errors.push(...server.log().split("\n").filter((l) => /\bError\b|TypeError|SqliteError|\[sim\] step failed|unhandled/i.test(l) && !/ECONNREFUSED/.test(l)));
    await server.stop();
    try {
      const d = new Database(tp);
      d.pragma("wal_checkpoint(TRUNCATE)");
      d.close();
    } catch {
      /* the -wal/-shm files are still valid */
    }
    const report = pitchReport(tp, res.state);
    const score = report.score + (res.good ? 40 : 0);
    const missing = Object.entries({ ...report.core, pending: res.good })
      .filter(([k, v]) => !v && k !== "loan")
      .map(([k]) => k);
    console.log(`  build ${n}: score ${score}${missing.length ? ` — missing: ${missing.join(", ")}` : " — has everything that matters"}`);
    if (!best || score > best.score) {
      if (best) removeDbFiles(best.path);
      best = { score, path: tp, res, report, missing };
    } else removeDbFiles(tp);
    if (!missing.length) break;
  }
  if (!best) {
    console.error("\nevery build failed; nothing saved");
    process.exit(1);
  }
  removeDbFiles(dbPath);
  renameSync(best.path, dbPath);
  for (const suf of ["-wal", "-shm"]) if (existsSync(best.path + suf)) renameSync(best.path + suf, dbPath + suf);
  const s = best.res.state;
  console.log("\nprobing the first pending fork on throw-away copies (which answer makes the Agent push back)...");
  const probe = await probeFirstFork(dbPath, s).catch((e) => ({ fork: "?", rows: [{ label: "-", text: `probe failed: ${e.message}` }] }));
  writeFileSync(
    dbPath + ".pitch.json",
    JSON.stringify({ simNowMs: s.world.simNowMs, offsetMs: s.world.offsetMs, builtAtRealMs: Date.now(), hour: s.world.hour, dayIndex: s.player.dayIndex }, null, 2),
  );

  console.log(`\n=== "pitch" ready: ${dbPath} ===`);
  for (const l of describeState(s)) console.log(`  ${l}`);
  console.log(`\nPENDING for the presenter (daytime + something to do: ${best.res.good ? "yes" : "NO"})`);
  for (const l of pendingLines(s)) console.log(`  ${l}`);
  if (!best.res.good) console.log("  NOTE: no hour in the search window had a fork / 默契 guess + an unread postcard in daytime. Use the fallback in doc/DEMO.md, or rebuild with --tries 5 --extra-hours 48.");
  if (probe) {
    console.log(`\nIF THE PRESENTER ANSWERS ${probe.fork} FIRST (probe on copies, offline rules engine)`);
    for (const r of probe.rows) console.log(`  「${r.label}」 -> ${r.decision ?? "no judgment"}${r.text ? `: ${r.text.slice(0, 110)}` : ""}`);
  }
  console.log("\nWHAT TO SHOW (read from this save's rows)");
  for (const l of best.report.lines) console.log(`  ${l}`);
  if (best.missing.length) console.log(`\n  NOTE: this build lacks: ${best.missing.join(", ")}. Run it again with --force for another roll of the world.`);
  if (errors.length) console.log(`\n  WARNING: the server logged errors while building:\n    ${errors.slice(0, 5).join("\n    ")}`);
  const rel = path.relative(ROOT, dbPath);
  console.log("\nopen it:");
  if (rel === "polis-test.db") console.log("  npm run scenario -- pitch --rewind     (right before the demo; dev server stopped)\n  npm run dev:test                       then http://localhost:3000 -> 继续");
  else console.log(`  npm run scenario -- pitch --rewind --db ${rel.startsWith("..") ? dbPath : rel}\n  POLIS_TEST_MODE=1 POLIS_DB_PATH=${dbPath} npx next dev      then http://localhost:3000 -> 继续`);
  console.log(
    "\nthe sim clock is real time + a saved offset: every real hour between building and opening is a game hour.\n" +
      "--rewind puts the clock back to the moment this save was built (details in doc/DEMO.md).",
  );
  process.exit(0);
}

/** Put the sim clock back to where the pitch save was built. Only world_state.time_offset_ms changes. */
function pitchRewind(dbPath) {
  const side = dbPath + ".pitch.json";
  if (!existsSync(dbPath) || !existsSync(side)) {
    console.error(`no pitch save at ${dbPath} (expected ${path.basename(side)} next to it). Build one: npm run scenario -- pitch --force`);
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(side, "utf8"));
  const db = new Database(dbPath);
  try {
    const before = db.prepare("SELECT time_offset_ms FROM world_state WHERE id = 1").get().time_offset_ms;
    const next = meta.simNowMs - Date.now();
    if (next <= 0) {
      console.error(`cannot rewind: the save was built ${Math.round((Date.now() - meta.builtAtRealMs) / 3_600_000)} h ago and its fast-forward (${Math.round(meta.offsetMs / 3_600_000)} h) is smaller than that. Build a new one.`);
      process.exit(1);
    }
    db.prepare("UPDATE world_state SET time_offset_ms = ? WHERE id = 1").run(next);
    console.log(`clock offset ${Math.round(before / 3_600_000)} h -> ${Math.round(next / 3_600_000)} h; the world is at day ${meta.dayIndex + 1} ${pad2(meta.hour)}:xx again (as built).`);
    console.log("start the game now:  npm run dev:test   (the clock runs from here)");
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
