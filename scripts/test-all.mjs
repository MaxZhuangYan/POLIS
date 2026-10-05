#!/usr/bin/env node
// npm test: the fast-to-slow ladder, stopping at the first failure.
//   typecheck → lint → choose-route regressions → path finding → map check → a 3-day headless sim (offline)
// Browser playtests are separate (npm run playtest:new / playtest:week) because they take minutes.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const steps = [
  ["typecheck", "npx", ["tsc", "--noEmit"]],
  ["lint", "npx", ["eslint", "."]],
  ["choose-route regressions", "node", ["scripts/test-choose-route-bugs.mjs"]],
  ["path finding", "node", ["scripts/test-pathfinding.mjs"]],
  ["map check", "node", ["scripts/map-check.mjs"]],
  ["3-day sim (careful, offline)", "node", ["scripts/sim-playthrough.mjs", "careful", "3"]],
];
const t0 = Date.now();
for (const [label, cmd, args] of steps) {
  const s = Date.now();
  process.stdout.write(`\n▶ ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, POLIS_LLM: "off" } });
  if (r.status !== 0) {
    console.log(`\n✗ ${label} failed (${Math.round((Date.now() - s) / 1000)} s). Fix it before the slower steps.`);
    process.exit(1);
  }
  console.log(`✓ ${label} (${Math.round((Date.now() - s) / 1000)} s)`);
}
console.log(`\nALL GREEN in ${Math.round((Date.now() - t0) / 1000)} s`);
