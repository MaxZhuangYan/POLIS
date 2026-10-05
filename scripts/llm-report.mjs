// What the model actually did in one save: calls per kind (ok / failed / why / latency), how often the
// explanation gates threw a model answer away, and how much of the player-visible output came from the model
// versus the declared rule/template floor. The doc's signal: fallback above 50% means "change the model".
//
// Usage: node scripts/llm-report.mjs [path/to/polis.db]   (default: $POLIS_DB_PATH or ./polis.db)
//        import { llmReport } from "./llm-report.mjs"     (the sim prints it after a run)

import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pct = (a, b) => (b > 0 ? `${Math.round((100 * a) / b)}%` : "—");

export function llmReport(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const out = [];
  const has = (t) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

  out.push("── model calls (metric_events 'llm_call') ──");
  const calls = has("metric_events") ? db.prepare("SELECT payload_json FROM metric_events WHERE name = 'llm_call'").all().map((r) => JSON.parse(r.payload_json)) : [];
  if (calls.length === 0) out.push("  none recorded (offline run, or the endpoint was never reachable)");
  const kinds = [...new Set(calls.map((c) => c.kind))];
  for (const k of kinds) {
    const cs = calls.filter((c) => c.kind === k);
    const ok = cs.filter((c) => c.ok);
    const ms = ok.map((c) => c.ms).sort((a, b) => a - b);
    const why = {};
    for (const c of cs.filter((c) => !c.ok)) why[c.error] = (why[c.error] ?? 0) + 1;
    out.push(
      `  ${k.padEnd(9)} ${String(cs.length).padStart(4)} calls · ok ${pct(ok.length, cs.length).padStart(4)}` +
        (ms.length ? ` · p50 ${ms[Math.floor(ms.length / 2)]} ms · max ${ms[ms.length - 1]} ms` : "") +
        (Object.keys(why).length ? ` · failed: ${Object.entries(why).map(([e, n]) => `${e}×${n}`).join(" ")}` : ""),
    );
  }

  out.push("── judgments (the Agent's answer to a fork) ──");
  const js = has("judgments") ? db.prepare("SELECT decision, source, gate FROM judgments").all() : [];
  const byGate = {};
  for (const j of js) byGate[`${j.source}/${j.gate ?? "-"}`] = (byGate[`${j.source}/${j.gate ?? "-"}`] ?? 0) + 1;
  const llmJ = js.filter((j) => j.source === "llm");
  out.push(`  ${js.length} total · by the model ${pct(llmJ.length, js.length)} · ${Object.entries(byGate).map(([k, n]) => `${k}×${n}`).join(" ")}`);
  const dec = {};
  for (const j of js) dec[`${j.source}:${j.decision}`] = (dec[`${j.source}:${j.decision}`] ?? 0) + 1;
  out.push(`  decisions: ${Object.entries(dec).map(([k, n]) => `${k}×${n}`).join(" ") || "—"}`);
  out.push(`  gate_fail = the model's deviation had no valid principle id / no words / an invented number → it complied instead`);

  out.push("── imprints ──");
  const ps = has("principles") ? db.prepare("SELECT source FROM principles WHERE agent_id IN (SELECT id FROM agents WHERE is_player = 1)").all() : [];
  const bySrc = {};
  for (const p of ps) bySrc[p.source] = (bySrc[p.source] ?? 0) + 1;
  const distilled = (bySrc.llm ?? 0) + (bySrc.fallback ?? 0);
  out.push(`  ${ps.length} · ${Object.entries(bySrc).map(([k, n]) => `${k}×${n}`).join(" ")} · model share of distilled ${pct(bySrc.llm ?? 0, distilled)}`);

  out.push("── postcards ──");
  const pcs = has("postcards") ? db.prepare("SELECT source FROM postcards").all() : [];
  const llmPc = pcs.filter((p) => p.source === "llm").length;
  out.push(`  ${pcs.length} · polished by the model ${pct(llmPc, pcs.length)} (a polish that adds a number, a name or drops the quoted principle is rejected → template)`);
  const pol = has("metric_events") ? db.prepare("SELECT payload_json FROM metric_events WHERE name = 'postcard_polish'").all().map((r) => JSON.parse(r.payload_json)) : [];
  if (pol.length) {
    const why = {};
    for (const p of pol) why[p.reason] = (why[p.reason] ?? 0) + 1;
    out.push(`  polish outcomes: ${Object.entries(why).map(([k, n]) => `${k}×${n}`).join(" ")}  (already_read = the player opened it before the model answered)`);
  }

  const fallbackShare = (js.length - llmJ.length + (bySrc.fallback ?? 0) + (pcs.length - llmPc)) / Math.max(1, js.length + distilled + pcs.length);
  out.push(`── floor share: ${Math.round(fallbackShare * 100)}% of judged/distilled/postcard outputs came from rules or templates ${fallbackShare > 0.5 ? "(> 50%: the model is not carrying the game)" : ""}`);
  db.close();
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = process.argv[2] || process.env.POLIS_DB_PATH || "./polis.db";
  if (!existsSync(dbPath)) {
    console.error(`no database at ${dbPath}`);
    process.exit(1);
  }
  console.log(llmReport(dbPath));
}
