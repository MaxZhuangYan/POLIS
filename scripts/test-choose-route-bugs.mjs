#!/usr/bin/env node
// Regression test for two code-review findings on
// app/api/decisions/[id]/choose/route.ts:
//
//   P1-1: an optionId that doesn't exist on the moment used to be accepted
//         and written as 'decided', silently breaking that decision forever
//         (distillation can never find a matching option).
//   P1-2: a moment past its wall-clock expiry (expires_at) used to still be
//         choosable if the tick-driven expiry sweep hadn't run recently
//         (e.g. clock paused), because the route only checked
//         status === 'pending', not expires_at.
//
// Self-contained: starts its own `next dev` against a scratch DB, runs both
// cases, tears everything down, and exits non-zero on any failure so it can
// be wired into CI later.
//
// Run: node scripts/test-choose-route-bugs.mjs

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3057; // dedicated port so this never collides with a dev server you already have running
const BASE_URL = `http://localhost:${PORT}`;
const DB_PATH = path.join(ROOT, "polis.db");

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function cleanupDbFiles() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = DB_PATH + suffix;
    if (existsSync(p)) rmSync(p);
  }
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/api/world/state`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server did not become ready in time");
}

async function main() {
  cleanupDbFiles();

  console.log(`Starting dev server on port ${PORT} against a scratch DB...`);
  // detached + killing the whole process group below — `next dev` forks a
  // `next-server` grandchild that survives killing just the `npx` wrapper
  // process, leaking an orphaned server otherwise (found while building the
  // sibling distillation-regression.mjs script, fixed here too).
  const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
    detached: true,
  });

  let serverOutput = "";
  server.stdout.on("data", (d) => (serverOutput += d));
  server.stderr.on("data", (d) => (serverOutput += d));

  try {
    await waitForServer();
    console.log("Server ready.\n");

    // --- Setup: one player agent with its 3 first-session moments ---
    const createRes = await fetch(`${BASE_URL}/api/player/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "TestAgent", mbti: "INTJ" }),
    });
    const { agent } = await createRes.json();
    check("setup: player agent created", !!agent?.id);

    const pendingRes = await fetch(`${BASE_URL}/api/decisions/pending`);
    const { moments } = await pendingRes.json();
    check("setup: 3 first-session moments exist", moments.length === 3, `got ${moments.length}`);

    const [momentA, momentB] = moments;

    // --- Case 1: invalid optionId must be rejected, not silently accepted ---
    console.log("\nCase 1: invalid optionId");
    const badChoiceRes = await fetch(`${BASE_URL}/api/decisions/${momentA.id}/choose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId: "NOT_A_REAL_OPTION" }),
    });
    check("invalid optionId is rejected (not HTTP 200)", badChoiceRes.status !== 200, `got ${badChoiceRes.status}`);
    check("invalid optionId gets a 4xx status", badChoiceRes.status >= 400 && badChoiceRes.status < 500);

    const db = new Database(DB_PATH);
    const afterBadChoice = db.prepare("SELECT status, player_choice FROM decision_moments WHERE id = ?").get(momentA.id);
    check(
      "moment status is still 'pending' after rejected choice (not corrupted to 'decided')",
      afterBadChoice.status === "pending" && afterBadChoice.player_choice === null,
      `got status=${afterBadChoice.status} player_choice=${afterBadChoice.player_choice}`,
    );

    // A subsequent VALID choice on the same moment must still work — proves
    // the rejection didn't leave the row in some half-broken state.
    const goodChoiceRes = await fetch(`${BASE_URL}/api/decisions/${momentA.id}/choose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId: momentA.options[0].id }),
    });
    check("valid optionId on the same moment succeeds afterward", goodChoiceRes.status === 200, `got ${goodChoiceRes.status}`);

    // --- Case 2: an expired-but-not-yet-swept moment must not be choosable ---
    console.log("\nCase 2: expiry bypass");
    db.prepare("UPDATE decision_moments SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, momentB.id);
    const expiredChoiceRes = await fetch(`${BASE_URL}/api/decisions/${momentB.id}/choose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId: momentB.options[0].id }),
    });
    check(
      "choosing an expired moment is rejected (not HTTP 200)",
      expiredChoiceRes.status !== 200,
      `got ${expiredChoiceRes.status}`,
    );

    const afterExpiredChoice = db
      .prepare("SELECT status, player_choice, autonomous_choice FROM decision_moments WHERE id = ?")
      .get(momentB.id);
    check(
      "moment was self-healed to 'expired_autonomous', not written as 'decided'",
      afterExpiredChoice.status === "expired_autonomous" && afterExpiredChoice.player_choice === null,
      `got status=${afterExpiredChoice.status} player_choice=${afterExpiredChoice.player_choice}`,
    );
    check(
      "autonomous_choice was set (not silently discarded)",
      afterExpiredChoice.autonomous_choice !== null,
    );

    db.close();
  } catch (err) {
    console.error("\nTest run threw an error:", err);
    failures++;
  } finally {
    process.kill(-server.pid, "SIGKILL");
    cleanupDbFiles();
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
  if (failures > 0) {
    console.log("\n--- last server output (for debugging) ---");
    console.log(serverOutput.split("\n").slice(-40).join("\n"));
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
