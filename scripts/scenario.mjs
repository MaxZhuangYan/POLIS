#!/usr/bin/env node
// Build a save at a story beat, so you can open the game exactly where you want to work.
//
//   npm run scenario -- <name> [--db path] [--force] [--policy careful|bold] [--name 阿守]
//   npm run scenario -- --list
//
//   names: fresh | d1-forks | d2-morning | d5-bait | week2      (what each one produces: --list)
//
// It starts its own test-mode server on a free port against the target save (default ./polis-test.db), drives the
// game's HTTP API like a guardian would (scripts/lib/scenarios.mjs), prints what it produced, and stops the server.
// It refuses to overwrite a save that already exists unless you pass --force. The model is always OFF here (rules
// engine), so the run is deterministic enough to be a fixture.
//
// Open the result:  npm run dev:test        (it reads ./polis-test.db)
//        any other path:  POLIS_TEST_MODE=1 POLIS_DB_PATH=<path> npx next dev

import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT, apiClient, removeDbFiles, startDevServer } from "./lib/dev-server.mjs";
import { SCENARIO_HELP, SCENARIO_NAMES, buildScenario } from "./lib/scenarios.mjs";

function parseArgs(argv) {
  const out = { _: [], force: false, list: false, db: "./polis-test.db", policy: "careful", name: undefined };
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
    else if (a === "-h" || a === "--help") out.help = true;
    else out._.push(a);
  }
  return out;
}

function usage() {
  console.log(`usage: npm run scenario -- <name> [--db path] [--force] [--policy careful|bold] [--name 阿守]\n`);
  for (const n of SCENARIO_NAMES) console.log(`  ${n.padEnd(11)} ${SCENARIO_HELP[n]}`);
  console.log(`\n  --db      save to create (default ./polis-test.db, the one \`npm run dev:test\` opens)`);
  console.log(`  --force   overwrite an existing save (without it the script refuses)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.list || args.help || args._.length === 0) {
    usage();
    process.exit(args._.length === 0 && !args.list && !args.help ? 1 : 0);
  }
  const name = args._[0];
  if (!SCENARIO_NAMES.includes(name)) {
    console.error(`unknown scenario "${name}"\n`);
    usage();
    process.exit(1);
  }
  if (!["careful", "bold"].includes(args.policy)) {
    console.error(`--policy must be careful or bold (got "${args.policy}")`);
    process.exit(1);
  }
  const dbPath = path.resolve(process.cwd(), args.db);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
