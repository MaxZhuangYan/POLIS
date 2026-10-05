// Shared helper for every script that needs its own throw-away game server: the browser playtests
// (scripts/playtest/*.mjs) and the scenario builder (scripts/scenario.mjs).
//
//   const server = await startDevServer({ dbPath });   // `next dev` on a free port, test mode, offline model
//   ... server.base is "http://localhost:<port>" ...
//   await server.stop();                                // kills the whole process group, restores tsconfig.json
//
// Why it looks the way it does (each line is a bug someone already hit):
//  * `next dev` forks a `next-server` child, so the server is started detached and stopped by killing the PROCESS
//    GROUP (-pid). Never `pkill -f next` from a shell whose own command line contains the pattern.
//  * Setting NEXT_DIST_DIR makes Next rewrite tsconfig.json / next-env.d.ts; we snapshot both and put them back.
//  * The model is OFF (POLIS_LLM=off) unless llm: "env" is passed, because `.env.local` is auto-loaded by Next and
//    would otherwise point the run at the owner's real model endpoint.
//  * The port is picked by the OS (listen on 0), so nothing here can collide with a dev server you already run.
//
// No dependencies beyond node itself.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const NEXT_BIN = createRequire(path.join(ROOT, "package.json")).resolve("next/dist/bin/next");

/** files Next rewrites when NEXT_DIST_DIR is set */
const NEXT_TOUCHED = ["tsconfig.json", "next-env.d.ts"];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** a TCP port the OS says is free right now */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** a fresh scratch dir in the OS temp dir (never inside the repo, never next to a real save) */
export function tempDir(prefix = "polis-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDbFiles(dbPath) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix);
    } catch {
      /* best effort */
    }
  }
}

function snapshotNextTouched() {
  const saved = new Map();
  for (const f of NEXT_TOUCHED) {
    try {
      saved.set(f, readFileSync(path.join(ROOT, f), "utf8"));
    } catch {
      /* file missing: nothing to restore */
    }
  }
  return () => {
    for (const [f, content] of saved) {
      try {
        if (readFileSync(path.join(ROOT, f), "utf8") !== content) writeFileSync(path.join(ROOT, f), content);
      } catch {
        /* best effort */
      }
    }
  };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/** Two `next dev` processes must not share one distDir. A tiny lock file says who is using it. */
function lockDistDir(distDir) {
  const lockFile = path.join(ROOT, `${distDir}.lock`);
  if (existsSync(lockFile)) {
    const other = Number(readFileSync(lockFile, "utf8").trim());
    if (other && other !== process.pid && pidAlive(other)) {
      throw new Error(
        `${distDir} is in use by another run (pid ${other}). Wait for it to finish, or pick another build dir with PLAYTEST_DIST_DIR=.next-playtest-2`,
      );
    }
  }
  writeFileSync(lockFile, String(process.pid));
  return () => {
    try {
      if (readFileSync(lockFile, "utf8").trim() === String(process.pid)) rmSync(lockFile);
    } catch {
      /* gone already */
    }
  };
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start `next dev` against a scratch save.
 *
 * @param {object} o
 * @param {string} o.dbPath             save file (created by the server on first request)
 * @param {"off"|"env"} [o.llm]         "off" (default): POLIS_LLM=off. "env": use whatever the environment / .env.local configures.
 * @param {string} [o.distDir]          Next build dir (default PLAYTEST_DIST_DIR or ".next-playtest")
 * @param {number} [o.port]             default: a free port
 * @param {boolean} [o.testMode]        POLIS_TEST_MODE=1 (default true)
 * @param {Record<string,string>} [o.env] extra env
 * @param {number} [o.timeoutMs]        how long to wait for /api/game/state (default 180 s: the first compile is slow)
 */
export async function startDevServer(o) {
  const distDir = o.distDir || process.env.PLAYTEST_DIST_DIR || ".next-playtest";
  const port = o.port || (await freePort());
  const unlock = lockDistDir(distDir);
  const restoreNext = snapshotNextTouched();
  const env = {
    ...process.env,
    POLIS_DB_PATH: o.dbPath,
    NEXT_DIST_DIR: distDir,
    NEXT_TELEMETRY_DISABLED: "1",
    ...(o.testMode === false ? {} : { POLIS_TEST_MODE: "1" }),
    ...(o.llm === "env" ? {} : { POLIS_LLM: "off" }),
    ...o.env,
  };
  if (o.testMode === false) delete env.POLIS_TEST_MODE;

  const child = spawn(process.execPath, [NEXT_BIN, "dev", "-p", String(port)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let log = "";
  const onData = (d) => {
    log += d;
    if (log.length > 400_000) log = log.slice(-200_000);
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    process.off("exit", onProcessExit);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (!exited) {
      killGroup(child.pid, "SIGTERM");
      for (let i = 0; i < 30 && !exited; i++) await sleep(100);
      killGroup(child.pid, "SIGKILL"); // next-server may outlive the wrapper; the group kill is harmless when it is gone
    }
    restoreNext();
    unlock();
  };
  // last resort if the script dies without reaching its finally block
  const onProcessExit = () => {
    killGroup(child.pid, "SIGKILL");
    restoreNext();
    unlock();
  };
  const onSignal = () => {
    onProcessExit();
    process.exit(130);
  };
  process.on("exit", onProcessExit);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const base = `http://localhost:${port}`;
  const server = { base, port, pid: child.pid, distDir, log: () => log, stop, dbPath: o.dbPath };
  try {
    await waitForGameState(base, { timeoutMs: o.timeoutMs ?? 180_000, hasExited: () => exited, log: () => log });
  } catch (err) {
    await stop();
    throw err;
  }
  return server;
}

/** poll /api/game/state until it answers 200; fail fast if the server process died */
export async function waitForGameState(base, { timeoutMs = 180_000, hasExited = () => false, log = () => "" } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (hasExited()) throw new Error(`the dev server exited before it was ready:\n${log().split("\n").slice(-25).join("\n")}`);
    try {
      const res = await fetch(`${base}/api/game/state`, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`/api/game/state did not answer within ${Math.round(timeoutMs / 1000)} s:\n${log().split("\n").slice(-25).join("\n")}`);
}

/** tiny JSON client for the game's HTTP API: api("POST", "/api/player/create", {...}) -> { status, json } */
export function apiClient(base) {
  return async function api(method, p, body) {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
}
