#!/usr/bin/env node
// Permanent regression script for the distillation pipeline (lib/distillation.ts),
// per POLIS_BUILD_DECISIONS.md decision ⑤.
//
// Background: Polis_蒸馏测试集_v1.md (doc/2026.7.11-/) is a set of 24-per-its-own-
// header (25 as actually enumerated — the F group's three sub-parts, F1-a/b/c,
// push the real count to 25) hand-designed scenarios that were previously only
// ever run by a human pasting prompts into an LM Studio chat window. That "hand
// testing" produced 88%/92%/100%-style numbers in a technical validation report,
// but those numbers say nothing about whether the actual code pipeline (prompt
// assembly, JSON extraction, validation) behaves the same way. This script closes
// that gap: it drives the exact production SYSTEM_PROMPT and the exact production
// parseAndValidateLlmContent() logic (both in lib/distillation.ts) over HTTP via
// the dev-only POST /api/distillation/test-scenario endpoint, using the test set's
// own literal "情境：...\n玩家选择：..." user-message format. Re-run this any time
// the prompt, model, or pipeline code changes, to confirm distillation quality
// hasn't regressed.
//
// Self-contained, matching scripts/test-choose-route-bugs.mjs's pattern: starts
// its own `next dev` on a dedicated port, waits for readiness, tears down at the
// end. Unlike that script, this one needs NO database at all — the test route it
// calls only calls callDistillationLlmRaw() + parseAndValidateLlmContent(), neither
// of which touches lib/db.ts's getDb() — so there is no DB setup/cleanup here.
//
// This is a measurement/report tool, not a pass/fail gate: a single LLM run's
// variance shouldn't fail a CI-style build, so this always exits 0. Read the
// printed summary (automatable metrics ①② + B-group domain-match rate) and the
// full per-scenario listing (for the human-only judgments ③④⑤ the test set doc
// itself says can't be automated) to decide whether quality actually regressed.
//
// Run: node scripts/distillation-regression.mjs
//      (or: npm run test:distillation-regression)

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3059; // dedicated port, distinct from scripts/test-choose-route-bugs.mjs's 3057
const BASE_URL = `http://localhost:${PORT}`;
const REQUEST_TIMEOUT_MS = 60000; // generous outer bound; the route's own LM Studio
// call already times out internally at 45s (lib/distillation.ts's LMSTUDIO_TIMEOUT_MS),
// so this just needs to be comfortably larger than that, not a tight bound itself.

// ---------------------------------------------------------------------------
// The 25 scenarios, verbatim from doc/2026.7.11-/Polis_蒸馏测试集_v1.md.
// `domain` is the scenario's labeled/expected domain for scoring; E group
// scenarios carry domain: null because the test doc's own section 10.1
// findings note they have no correct domain to score against (they're
// neutral/edge-case pressure tests, not domain-classification tests).
// ---------------------------------------------------------------------------
const SCENARIOS = [
  { id: "A1", group: "A", domain: "trust", situation: "Mira 有 14 次成功合作和 1 次违约记录，她提出五五分成合作。", choice: "接受合作。" },
  { id: "A2", group: "A", domain: "risk", situation: "Nova 的勘察任务报酬是普通单的三倍，但成功率只有一半。", choice: "不接，选择稳定的单子。" },
  { id: "A3", group: "A", domain: "integrity", situation: "Sol 教了个省时办法——终检前就标记送达，但出问题会连累收货的 Tao。", choice: "拒绝走捷径，走完整流程。" },
  { id: "A4", group: "A", domain: "trust", situation: "一个从未合作过、记录空白的新 Agent，请求你带他做一单。", choice: "带他。" },
  { id: "A5", group: "A", domain: "risk", situation: "一个限时任务，抢下来报酬翻倍，但超时会扣声望。", choice: "抢。" },

  { id: "B1", group: "B", domain: "trust", pairOf: "A1", situation: "Mira 有 14 次成功合作和 1 次违约记录，她提出五五分成合作。", choice: "拒绝合作。" },
  { id: "B2", group: "B", domain: "risk", pairOf: "A2", situation: "Nova 的勘察任务报酬是普通单的三倍，但成功率只有一半。", choice: "接下这个高风险任务。" },
  { id: "B3", group: "B", domain: "integrity", pairOf: "A3", situation: "Sol 教了个省时办法——终检前就标记送达，但出问题会连累收货的 Tao。", choice: "采用捷径。" },
  { id: "B4", group: "B", domain: "trust", pairOf: "A4", situation: "一个从未合作过、记录空白的新 Agent，请求你带他做一单。", choice: "拒绝。" },
  { id: "B5", group: "B", domain: "risk", pairOf: "A5", situation: "一个限时任务，抢下来报酬翻倍，但超时会扣声望。", choice: "放弃，不抢。" },

  { id: "C1", group: "C", domain: "integrity", situation: "你可以按流程做完任务，但发现少填一栏不影响自己、只会让后来接手的 Iris 多花两天。", choice: "坚持填完那一栏。" },
  { id: "C2", group: "C", domain: "integrity", situation: "委托方暗示你把调查结论写得夸张一点，对你有利，但会误导看报告的人。", choice: "如实写。" },
  { id: "C3", group: "C", domain: "integrity", situation: "任务途中你捡到一份无主的资源，没人会知道你拿了。", choice: "上交。" },
  { id: "C4", group: "C", domain: "integrity", situation: "你可以低价抢走 Sol 的老客户，对你有利，但会让 Sol 声望受损。", choice: "不抢。" },

  { id: "D1", group: "D", domain: "trust", situation: "Mira 提出合作。", choice: "接受，但要求她先完成她那一半再谈分成。" },
  { id: "D2", group: "D", domain: "risk", situation: "Nova 的高风险任务。", choice: "接，但只投入一半资源，留后手。" },
  { id: "D3", group: "D", domain: "trust", situation: "一个信誉一般的 Agent 请求借 Scrip。", choice: "借，但只借一半，并说清下不为例。" },
  { id: "D4", group: "D", domain: "integrity", situation: "可以走捷径省时。", choice: "这次走捷径，但心里记下以后不这样。" },

  { id: "E1", group: "E", domain: null, situation: "玩家什么都没选，超时了，Agent 自己做了决定。", choice: "（无——超时自动）" },
  { id: "E2", group: "E", domain: null, situation: "玩家先说接受，又立刻说算了不接了。", choice: "接受；随后反悔。" },
  { id: "E3", group: "E", domain: null, situation: "一个和道德、风险、信任都无关的纯操作选择——先做 A 任务还是 B 任务。", choice: "先做 A。" },
  { id: "E4", group: "E", domain: null, situation: "玩家的指令自相矛盾——既要最高安全又要最高收益。", choice: "两个都要。" },

  { id: "F1-a", group: "F", domain: "risk", situation: "高风险高回报的勘探任务。", choice: "不接。" },
  { id: "F1-b", group: "F", domain: "risk", situation: "一次可能翻倍也可能血亏的投机机会。", choice: "不参与。" },
  { id: "F1-c", group: "F", domain: "risk", situation: "稳定但回报平平的长期合约。", choice: "签下它。" },
];

const AB_PAIRS = [
  ["A1", "B1"],
  ["A2", "B2"],
  ["A3", "B3"],
  ["A4", "B4"],
  ["A5", "B5"],
];

const F_GROUP_IDS = ["F1-a", "F1-b", "F1-c"];

function buildUserPrompt(situation, choice) {
  // Exact literal format from the test set doc — NOT production's
  // buildUserPrompt() shape in lib/distillation.ts (no "情境类型：" line,
  // no "结果：" line). This is deliberate: the test set was authored and
  // scored against this exact two-line shape.
  return `情境：${situation}\n玩家选择：${choice}`;
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server did not become ready in time");
}

async function runScenario(scenario) {
  const userPrompt = buildUserPrompt(scenario.situation, scenario.choice);
  try {
    const res = await fetch(`${BASE_URL}/api/distillation/test-scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userPrompt }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ...scenario, raw: null, validated: null, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { ...scenario, raw: data.raw ?? null, validated: data.validated ?? null, error: null };
  } catch (err) {
    return { ...scenario, raw: null, validated: null, error: String(err?.message ?? err) };
  }
}

function unicodeLength(str) {
  return Array.from(str).length;
}

function pct(numerator, denominator) {
  if (denominator === 0) return "N/A";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function main() {
  return new Promise((resolve) => {
    console.log(`Starting dev server on port ${PORT} (no DB needed for this run)...`);
    // detached: true puts the spawned process in its own process group. This
    // matters for cleanup: `npx` forks `next dev` as a grandchild, and a
    // plain server.kill("SIGKILL") only kills the `npx` wrapper — the actual
    // `next-server` process (which is what's holding the port) survives as
    // an orphan. Killing the whole group (negative pid) below takes both out.
    const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      detached: true,
    });

    let serverOutput = "";
    server.stdout.on("data", (d) => (serverOutput += d));
    server.stderr.on("data", (d) => (serverOutput += d));

    const cleanup = () => {
      if (server.pid) {
        try {
          process.kill(-server.pid, "SIGKILL"); // negative pid = whole process group
        } catch {
          // group may already be gone; fall back to killing just the wrapper
          server.kill("SIGKILL");
        }
      } else {
        server.kill("SIGKILL");
      }
    };

    (async () => {
      try {
        await waitForServer();
        console.log("Server ready.\n");
        console.log(
          `Running ${SCENARIOS.length} scenarios against POST /api/distillation/test-scenario...\n` +
          "(each call may take up to ~45s if the LLM is slow/unreachable — this can take several minutes total)\n"
        );

        const results = [];
        for (const scenario of SCENARIOS) {
          process.stdout.write(`  [${scenario.id}] ...`);
          const result = await runScenario(scenario);
          results.push(result);
          const status = result.validated
            ? `ok (domain=${result.validated.domain})`
            : result.raw === null
              ? "FAILED (raw=null — network/timeout/LLM down)"
              : "FAILED (raw returned but did not validate)";
          console.log(` ${status}`);
        }

        printReport(results);
      } catch (err) {
        console.error("\nRegression run threw an error:", err);
        console.log("\n--- last server output (for debugging) ---");
        console.log(serverOutput.split("\n").slice(-40).join("\n"));
      } finally {
        cleanup();
        resolve();
      }
    })();
  });
}

function printReport(results) {
  const byId = new Map(results.map((r) => [r.id, r]));

  const total = results.length;
  const validatedResults = results.filter((r) => r.validated !== null);
  const parseRateNum = validatedResults.length;

  // ① JSON 可解析率 — over ALL 25 scenarios (E included: whether E scenarios
  // blow up the JSON parser is itself informative, per the test doc's own
  // discussion of E group / section on expected failure points).
  const jsonParseRate = pct(parseRateNum, total);

  // length compliance — sanity check only. parseAndValidateLlmContent()
  // already rejects any principle > 20 Unicode chars, so among validated
  // results this must be 100% by construction; we still compute it honestly
  // rather than hardcoding "100%".
  const lengthOk = validatedResults.filter((r) => unicodeLength(r.validated.principle) <= 20).length;
  const lengthComplianceRate = pct(lengthOk, validatedResults.length);

  // ② domain 正确率 — A/B/C/D/F groups only (excludes E, which has no
  // "correct" domain per the test doc's own findings). A scenario with
  // validated === null cannot be domain-correct, so it counts against the
  // rate (denominator is all scored scenarios, not just validated ones).
  const scored = results.filter((r) => r.group !== "E");
  const domainCorrect = scored.filter((r) => r.validated && r.validated.domain === r.domain);
  const domainAccuracyRate = pct(domainCorrect.length, scored.length);

  // E group domain outputs — informational only, no "correct" answer.
  const eGroup = results.filter((r) => r.group === "E");

  // ④ B组对称性 (partial automation) — domain-match is the only checkable
  // part; semantic "opposite direction" needs a human read of the printed
  // principle text pairs below.
  const pairRows = AB_PAIRS.map(([aId, bId]) => {
    const a = byId.get(aId);
    const b = byId.get(bId);
    const bothValidated = a.validated && b.validated;
    const domainMatch = bothValidated ? a.validated.domain === b.validated.domain : null;
    return { aId, bId, a, b, domainMatch };
  });
  const pairsEvaluable = pairRows.filter((p) => p.domainMatch !== null);
  const domainMatchRate = pct(pairsEvaluable.filter((p) => p.domainMatch).length, pairsEvaluable.length);

  // ---------------------------------------------------------------------
  // Summary block
  // ---------------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("SUMMARY (automatable metrics)");
  console.log("=".repeat(78));
  console.log(`① JSON 可解析率:        ${jsonParseRate}  (${parseRateNum}/${total})  target >95%  ${passFail(parseRateNum, total, 0.95)}`);
  console.log(`   length compliance:    ${lengthComplianceRate}  (${lengthOk}/${validatedResults.length} of validated) — sanity check, should be 100% by construction`);
  console.log(`② domain 正确率:        ${domainAccuracyRate}  (${domainCorrect.length}/${scored.length}, A/B/C/D/F only)  target >90%  ${passFail(domainCorrect.length, scored.length, 0.90)}`);
  console.log(`④ B组 domain-match rate: ${domainMatchRate}  (${pairsEvaluable.filter((p) => p.domainMatch).length}/${pairsEvaluable.length} evaluable pairs)`);
  console.log(`   NOTE: domain-match rate is NOT a full symmetry judgment — it only checks`);
  console.log(`   that A/B got the same domain label. Whether B's principle is the semantic`);
  console.log(`   OPPOSITE of A's requires a human read of the printed pairs below.`);
  console.log(`③ 原则质量 (优/可用/偏移/错): NOT automatable (test doc's own scoring table`);
  console.log(`   leaves this column blank for human fill-in). See full per-scenario listing below.`);
  console.log(`⑤ F组一致性: NOT automatable (subjective "does it point the same direction?"`);
  console.log(`   judgment). See F group printout below.`);
  if (parseRateNum === 0) {
    console.log(`\n   NOTE: 0% could be evaluated — LM Studio appears unreachable for this entire run.`);
  }

  // ---------------------------------------------------------------------
  // B group pairs — printed side by side for human symmetry judgment
  // ---------------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("B组对称性 — A/B pairs (read these for the actual opposite-direction judgment)");
  console.log("=".repeat(78));
  for (const { aId, bId, a, b, domainMatch } of pairRows) {
    console.log(`\n${aId} vs ${bId}:`);
    console.log(`  ${aId} choice="${a.choice}"  domain=${a.validated ? a.validated.domain : "(n/a)"}  principle="${a.validated ? a.validated.principle : "(FAILED: " + (a.error ?? "no validated result") + ")"}"`);
    console.log(`  ${bId} choice="${b.choice}"  domain=${b.validated ? b.validated.domain : "(n/a)"}  principle="${b.validated ? b.validated.principle : "(FAILED: " + (b.error ?? "no validated result") + ")"}"`);
    console.log(`  domain-match: ${domainMatch === null ? "N/A (one or both failed to validate)" : domainMatch ? "YES" : "NO"}`);
  }

  // ---------------------------------------------------------------------
  // F group — printed together, no automated pass/fail
  // ---------------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("F组一致性 — should all point toward the same 'prefer stability' stance — human judgment required");
  console.log("=".repeat(78));
  for (const id of F_GROUP_IDS) {
    const r = byId.get(id);
    console.log(`  ${id}: choice="${r.choice}"  principle="${r.validated ? r.validated.principle : "(FAILED: " + (r.error ?? "no validated result") + ")"}"`);
  }

  // ---------------------------------------------------------------------
  // E group — informational only, no "correct" domain
  // ---------------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("E组 — informational only (test doc's own findings: no correct domain for these)");
  console.log("=".repeat(78));
  for (const r of eGroup) {
    console.log(`  ${r.id}: choice="${r.choice}"  raw-validated=${r.validated ? "yes" : "no"}  domain=${r.validated ? r.validated.domain : "(n/a)"}  principle="${r.validated ? r.validated.principle : "(FAILED: " + (r.error ?? "no validated result") + ")"}"`);
  }

  // ---------------------------------------------------------------------
  // Full per-scenario listing for human ③ quality pass
  // ---------------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("FULL PER-SCENARIO LISTING (for human ③ 原则质量 judgment: 优/可用/偏移/错)");
  console.log("=".repeat(78));
  for (const r of results) {
    console.log(`\n[${r.id}] group=${r.group}  expected domain=${r.domain ?? "(n/a — E group)"}`);
    console.log(`  情境: ${r.situation}`);
    console.log(`  玩家选择: ${r.choice}`);
    if (r.validated) {
      const domainMark = r.domain === null ? "" : r.validated.domain === r.domain ? " [MATCH]" : " [MISMATCH]";
      console.log(`  -> principle: "${r.validated.principle}"  domain: ${r.validated.domain}${domainMark}`);
    } else if (r.raw !== null) {
      console.log(`  -> FAILED validation. raw output: ${JSON.stringify(r.raw).slice(0, 300)}`);
    } else {
      console.log(`  -> FAILED: no raw output (network/timeout/LLM down)${r.error ? ` — ${r.error}` : ""}`);
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log("End of report. Exit code is always 0 — this is a measurement tool, not a gate.");
  console.log("=".repeat(78));
}

function passFail(numerator, denominator, targetFraction) {
  if (denominator === 0) return "(N/A)";
  return numerator / denominator > targetFraction ? "PASS" : "BELOW TARGET";
}

main().then(() => {
  // Always exit 0: informational/measurement tool, not a CI-style gate — a
  // single LLM run's variance shouldn't fail a build.
  process.exit(0);
});
