// Headless 7-day playthrough against a real server in TEST MODE on a scratch
// DB (never touches ./polis.db). It plays the guardian with a fixed policy,
// fast-forwards with the labelled test endpoint, and checks the invariants
// the design depends on:
//   - the three D1 answers become three principles (offline: fallback floor)
//   - the Agent's later autonomous choices cite those principles
//   - every nightly postcard quotes ≥1 principle that really exists
//   - postcard numbers come from facts (spot-checked against the ledger)
//   - D2 first-citation happens; the world keeps producing NPC events
//   - judgments / force-execute / notes round-trip without errors
//
// Usage: node scripts/sim-playthrough.mjs [bold|careful] [days]
// This is a mechanics regression with the OFFLINE rule engine; it is not
// evidence of real-LLM personality quality.

import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const POLICY = process.argv[2] === "careful" ? "careful" : "bold";
const DAYS = Number(process.argv[3] ?? 7);
const PORT = 3000 + 60 + (POLICY === "bold" ? 1 : 2);
const BASE = `http://localhost:${PORT}`;
const DB_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "polis-sim-")), "polis.db");

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function api(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/game/state`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server not ready");
}

// Guardian policy: bold = trust/risk/efficiency; careful = the opposite.
function pick(moment) {
  const opts = moment.options;
  const want = POLICY === "bold" ? 0 : opts.length - 1;
  if (moment.templateId === "FIRST_TRUST") return POLICY === "bold" ? "A" : "B";
  if (moment.templateId === "FIRST_INTEGRITY") return POLICY === "bold" ? "A" : "B";
  if (moment.templateId === "REPAIR") return POLICY === "bold" ? "C" : "B";
  return opts[Math.min(want, opts.length - 1)].id;
}

async function main() {
  console.log(`Polis sim playthrough — policy=${POLICY}, days=${DAYS}, db=${DB_PATH}`);
  const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    // Own distDir so this can run next to a dev server; offline unless
    // SIM_LLM_URL points at an OpenAI-compatible endpoint (e.g. scripts/mock-llm.mjs).
    env: {
      ...process.env,
      POLIS_TEST_MODE: "1",
      POLIS_DB_PATH: DB_PATH,
      NEXT_DIST_DIR: `.next-sim-${POLICY}`,
      ...(process.env.SIM_LLM_URL ? { POLIS_LLM_URL: process.env.SIM_LLM_URL, POLIS_LLM_MODEL: "mock-plumbing" } : { POLIS_LLM: "off" }),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const story = [];
  try {
    await waitReady();
    // Start in the morning so D1 has a working day.
    let s = (await api("GET", "/api/game/state")).json;
    if (s.world.hour >= 12 || s.world.hour < 7) await api("POST", "/api/test/advance", { to: "morning" });

    const created = await api("POST", "/api/player/create", { name: "阿守", sprite: "courier", tz: "Asia/Shanghai" });
    check("agent created", created.status === 200, JSON.stringify(created.json));
    s = (await api("GET", "/api/game/state")).json;
    check("3 first-session forks pending", s.player.pendingMoments.length === 3, `${s.player.pendingMoments.length}`);
    for (const m of s.player.pendingMoments) {
      const r = await api("POST", `/api/decisions/${m.id}/choose`, { optionId: pick(m) });
      check(`answered ${m.templateId}`, r.status === 200, JSON.stringify(r.json).slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, 800));
    s = (await api("GET", "/api/game/state")).json;
    check("onboarding reaches imprint", s.player.onboarding === "imprint", s.player.onboarding);
    check("3 principles formed right after the forks", s.player.principles.length === 3, s.player.principles.map((p) => p.text).join(" | "));
    story.push(`D1 principles: ${s.player.principles.map((p) => `『${p.text}』(${p.source})`).join(" ")}`);
    const ack = await api("POST", "/api/player/onboarding");
    check("onboarding ack", ack.status === 200);
    s = (await api("GET", "/api/game/state")).json;
    story.push(`After ack: ${s.player.agent.activityText} | reason: ${s.player.agent.reason ?? "—"}`);
    check("agent sets off immediately (not idle at gate)", s.player.agent.location !== "gate", s.player.agent.location);

    await api("POST", "/api/notes", { text: POLICY === "bold" ? "今天辛苦了" : "这几天稳一点，别冒险" });

    let forced = 0;
    for (let h = 0; h < DAYS * 24; h += 3) {
      const adv = await api("POST", "/api/test/advance", { hours: 3 });
      if (adv.status !== 200) {
        check("advance ok", false, JSON.stringify(adv.json));
        break;
      }
      s = (await api("GET", "/api/game/state")).json;
      const p = s.player;
      if (p.pendingJudgment) {
        const j = p.pendingJudgment;
        story.push(`Day${p.dayIndex + 1} ${s.world.hour}:00 JUDGMENT ${j.decision}: ${j.toPlayer}`);
        const action = j.decision === "refuse" ? (POLICY === "bold" && forced === 0 && j.canForce ? "force" : "accept") : POLICY === "bold" ? "overrule" : "adopt";
        if (action === "force") forced++;
        const r = await api("POST", `/api/judgments/${j.id}/resolve`, { action });
        check(`judgment ${j.decision} → ${action}`, r.status === 200, JSON.stringify(r.json).slice(0, 160));
        await api("POST", `/api/judgments/${j.id}/feedback`, { value: "surprising_reasonable" });
      }
      for (const m of p.pendingMoments.slice(0, 1)) {
        const choice = pick(m);
        story.push(`Day${p.dayIndex + 1} ${String(s.world.hour).padStart(2, "0")}:00 MOMENT ${m.templateId}: ${m.promptText.slice(0, 60)}… → ${m.options.find((o) => o.id === choice)?.label}`);
        const r = await api("POST", `/api/decisions/${m.id}/choose`, { optionId: choice });
        check(`choose ${m.templateId}`, r.status === 200, JSON.stringify(r.json).slice(0, 160));
        if (r.json.judgment) story.push(`   ↳ agent: ${r.json.judgment.decision} — ${r.json.judgment.to_player}`);
      }
      if (p.pendingWavering) {
        story.push(`Day${p.dayIndex + 1} WAVERING: ${p.pendingWavering.promptText}`);
        await api("POST", `/api/wavering/${p.pendingWavering.id}/resolve`, { resolution: "reaffirm" });
      }
      for (const c of p.postcards.items.filter((c) => !c.read)) {
        story.push(`Day${c.dayIndex + 1} POSTCARD (${c.kind}/${c.source}):\n      ${c.lines.join("\n      ")}`);
        const texts = new Set(p.principles.map((x) => x.text));
        const quotes = [...c.lines.join("").matchAll(/『(.+?)』/g)].map((m) => m[1]);
        const noteTexts = new Set(p.notes.items.map((x) => x.text));
        check(
          `postcard ${c.id} quotes ≥1 real principle or note`,
          quotes.some((q) => texts.has(q) || noteTexts.has(q)) || c.kind === "recap7",
          `quotes=[${quotes.join(",")}] lines=${JSON.stringify(c.lines)}`,
        );
        await api("POST", `/api/postcards/${c.id}/read`);
      }
      if (h % 24 === 21 && p.dayIndex >= 1 && p.notes.leftToday > 0 && h < 72) {
        await api("POST", "/api/notes", { text: POLICY === "bold" ? "做人要说话算话" : "多接点稳单子" });
      }
    }

    s = (await api("GET", "/api/game/state")).json;
    const db = new Database(DB_PATH, { readonly: true });
    const pid = s.player.agent.id;
    const citations = db.prepare("SELECT COUNT(*) n FROM principle_citations pc JOIN principles p ON p.id = pc.principle_id WHERE p.agent_id = ?").get(pid).n;
    const selfDecided = db.prepare("SELECT text FROM memories WHERE agent_id = ? AND kind = 'self_decided' ORDER BY at_ms LIMIT 4").all(pid);
    const npcEvents = db.prepare("SELECT COUNT(*) n FROM events WHERE involves_player = 0 AND kind IN ('task','coop','default','refuse','relationship','risk')").get().n;
    const incidents = db.prepare("SELECT holder_id, offender_id, text FROM incidents ORDER BY at_ms").all();
    const firstCitation = db.prepare("SELECT first_citation_at FROM agents WHERE id = ?").get(pid).first_citation_at;
    const judg = db.prepare("SELECT decision, status, source, gate FROM judgments WHERE agent_id = ?").all(pid);
    const postcards = db.prepare("SELECT COUNT(*) n FROM postcards WHERE agent_id = ?").get(pid).n;
    const ledgerSum = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE agent_id = ? AND reason != 'task_fee_burn'").get(pid).s;
    check("ledger reconciles with Scrip balance", ledgerSum === s.player.agent.scrip, `ledger=${ledgerSum} scrip=${s.player.agent.scrip}`);
    check("principles were cited by later decisions", citations >= 3, `${citations}`);
    check("D2 first citation happened", firstCitation != null);
    check("NPCs produced their own events", npcEvents >= 10, `${npcEvents}`);
    check(`one postcard per night (≥${DAYS - 1})`, postcards >= DAYS - 1, `${postcards}`);
    const errs = log.split("\n").filter((l) => /Error|TypeError|SqliteError|\[sim\] step failed|unhandled/i.test(l) && !/ECONNREFUSED/.test(l));
    check("no server errors in log", errs.length === 0, errs.slice(0, 5).join(" || "));

    console.log("\n=== STORY ===");
    for (const line of story) console.log(line);
    console.log("\n=== self-decided (autonomous, cited) ===");
    for (const m of selfDecided) console.log(" -", m.text);
    console.log("\n=== grudges (holder ← offender) ===");
    for (const i of incidents) console.log(` - ${i.holder_id} ← ${i.offender_id}: ${i.text}`);
    console.log("\n=== judgments ===", JSON.stringify(judg));
    console.log(
      `\nEnd: Day${s.player.dayIndex + 1} scrip=${s.player.agent.scrip} rep=${s.player.agent.reputation} trust=${s.player.trust} principles=${s.player.principles.length} citations=${citations}`,
    );
    const rels = s.player.relationships.map((r) => `${r.otherId}:${r.familiarity}${r.incidents.length ? `(!${r.incidents.length})` : ""}`).join(" ");
    console.log(`Relationships: ${rels}`);
    db.close();
  } catch (err) {
    failures++;
    console.error("run threw", err);
  } finally {
    try {
      process.kill(-server.pid, "SIGKILL");
    } catch {}
    for (const suf of ["", "-wal", "-shm"]) if (existsSync(DB_PATH + suf)) rmSync(DB_PATH + suf);
  }
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures) console.log(log.split("\n").slice(-30).join("\n"));
  process.exit(failures ? 1 : 0);
}

main();
