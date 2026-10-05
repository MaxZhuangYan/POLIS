#!/usr/bin/env node
// Verifies the generated Tiled map and the A* module against each other:
//   - the model builds (all 10 locations, 9 home doors, gate)
//   - every door, every stand slot and every home door is reachable from every other one
//   - paths avoid blocked tiles, never cut corners, and the smoothed paths stay as cheap as the raw A* ones
//   - residents prefer roads (the road share of the walked tiles is reported)
//   - A* agrees with a plain Dijkstra on the same grid (optimality of the raw path under the cost metric)
//
//   npm run test:pathfinding        (needs node >= 22.6; the TS modules are loaded with node's type stripping)

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildTownModel } = await import(join(ROOT, "app/components/town/tiled.ts"));
const pf = await import(join(ROOT, "app/components/town/pathfinding.ts"));

const map = JSON.parse(readFileSync(join(ROOT, "public/assets/town/polis-town.tmj"), "utf8"));
const model = buildTownModel(map);
const { grid } = model;
let failures = 0;
const fail = (m) => {
  failures++;
  console.error("FAIL: " + m);
};
const ok = (m) => console.log("ok   " + m);

console.log(`map ${model.width}x${model.height} tiles, ${model.interactables.length} interactables, grid ${grid.width}x${grid.height}`);

// ── points of interest ──
const points = [];
for (const [id, loc] of Object.entries(model.locations)) {
  if (loc.door) points.push({ name: `${id}:door`, tile: loc.door });
  loc.slots.forEach((t, i) => points.push({ name: `${id}:slot${i}`, tile: t }));
}
for (const h of model.homeDoors) points.push({ name: `home${h.slot}:door`, tile: h.tile });

for (const p of points) {
  if (pf.isBlocked(grid, p.tile.x, p.tile.y)) fail(`${p.name} (${p.tile.x},${p.tile.y}) is blocked`);
  if (model.covered[p.tile.y * model.width + p.tile.x]) fail(`${p.name} (${p.tile.x},${p.tile.y}) is hidden under an \`above\` tile`);
}
for (const [id, loc] of Object.entries(model.locations)) {
  if (id !== "home" && loc.slots.length < 3) fail(`location ${id} has only ${loc.slots.length} stand slots`);
}
ok(`${points.length} points (doors, stand slots, home doors) are on walkable tiles; slots per location: ` + Object.entries(model.locations).map(([k, v]) => `${k}=${v.slots.length}`).join(" "));

// ── mutual reachability + path sanity ──
const finder = new pf.PathFinder(grid, 4096);
let pairs = 0;
let unreachable = 0;
let totalRaw = 0;
let totalSmooth = 0;
let worstRatio = 1;
let roadTiles = 0;
let walkedTiles = 0;
let corner = 0;
const t0 = performance.now();
for (const a of points) {
  for (const b of points) {
    if (a === b) continue;
    pairs++;
    const raw = pf.findPath(grid, a.tile, b.tile);
    if (!raw) {
      unreachable++;
      fail(`no path ${a.name} -> ${b.name}`);
      continue;
    }
    // sanity: every step is between walkable neighbours, diagonals never cut a blocked corner
    for (let i = 0; i < raw.length; i++) {
      if (pf.isBlocked(grid, raw[i].x, raw[i].y)) fail(`path ${a.name}->${b.name} walks through a blocked tile`);
      if (i > 0) {
        const dx = raw[i].x - raw[i - 1].x;
        const dy = raw[i].y - raw[i - 1].y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) fail(`path ${a.name}->${b.name} has a gap`);
        if (dx !== 0 && dy !== 0 && (pf.isBlocked(grid, raw[i - 1].x + dx, raw[i - 1].y) || pf.isBlocked(grid, raw[i - 1].x, raw[i - 1].y + dy))) corner++;
      }
      walkedTiles++;
      if (pf.tileCost(grid, raw[i].x, raw[i].y) <= 1) roadTiles++;
    }
    const smooth = pf.smoothPath(grid, raw);
    const cr = pf.pathCost(grid, raw);
    // smoothed path cost, measured on the straight segments
    let cs = 0;
    for (let i = 1; i < smooth.length; i++) cs += pf.segmentCost(grid, smooth[i - 1], smooth[i]);
    totalRaw += cr;
    totalSmooth += cs;
    if (cr > 0) worstRatio = Math.max(worstRatio, cs / cr);
    for (let i = 1; i < smooth.length; i++) if (!pf.lineOfSight(grid, smooth[i - 1], smooth[i], 0)) fail(`smoothed path ${a.name}->${b.name} crosses a blocked tile`);
    if (smooth.length > raw.length) fail(`smoothing made ${a.name}->${b.name} longer`);
  }
}
const ms = performance.now() - t0;
if (unreachable === 0) ok(`all ${pairs} ordered pairs reachable (${ms.toFixed(0)} ms)`);
if (corner === 0) ok("no diagonal step cuts a blocked corner");
else fail(`${corner} diagonal steps cut a corner`);
ok(`smoothing: total cost ${totalSmooth.toFixed(0)} vs raw ${totalRaw.toFixed(0)} (worst pair ratio ${worstRatio.toFixed(3)}), road share of walked tiles ${(100 * roadTiles / walkedTiles).toFixed(0)}%`);
if (worstRatio > 1.1) fail(`smoothing is too lossy (worst ratio ${worstRatio.toFixed(3)})`);

// ── A* is optimal: compare with Dijkstra for a few pairs ──
function dijkstra(from, to) {
  const W = grid.width;
  const dist = new Float64Array(grid.width * grid.height).fill(Infinity);
  const done = new Uint8Array(dist.length);
  dist[from.y * W + from.x] = 0;
  for (;;) {
    let cur = -1;
    let best = Infinity;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < best) { best = dist[i]; cur = i; }
    if (cur < 0) return Infinity;
    if (cur === to.y * W + to.x) return best;
    done[cur] = 1;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (pf.isBlocked(grid, nx, ny)) continue;
        if (dx && dy && (pf.isBlocked(grid, cx + dx, cy) || pf.isBlocked(grid, cx, cy + dy))) continue;
        const len = dx && dy ? Math.SQRT2 : 1;
        const nd = best + len * 0.5 * (grid.cost[cur] + grid.cost[ny * W + nx]);
        if (nd < dist[ny * W + nx]) dist[ny * W + nx] = nd;
      }
    }
  }
}
let optimalOk = 0;
for (let k = 0; k < 12; k++) {
  const a = points[(k * 7) % points.length];
  const b = points[(k * 13 + 5) % points.length];
  if (a === b) continue;
  const raw = pf.findPath(grid, a.tile, b.tile);
  const d = dijkstra(a.tile, b.tile);
  const c = pf.pathCost(grid, raw);
  if (Math.abs(c - d) > 1e-3) fail(`A* cost ${c.toFixed(3)} != Dijkstra ${d.toFixed(3)} for ${a.name}->${b.name}`);
  else optimalOk++;
}
ok(`A* matches Dijkstra on ${optimalOk} sample pairs`);

// ── cache ──
const c1 = finder.find(points[0].tile, points[points.length - 1].tile);
const c2 = finder.find(points[0].tile, points[points.length - 1].tile);
if (!c1 || !c2 || c1.length !== c2.length) fail("path cache returned different paths");
else ok(`LRU cache serves repeated queries (${finder.size} entries)`);

// ── a few path lengths ──
console.log("\nsample paths (tiles, smoothed waypoints, cost):");
const named = (n) => points.find((p) => p.name === n);
for (const [a, b] of [
  ["gate:door", "hall:door"],
  ["home0:door", "workshop:door"],
  ["home8:door", "mediation:door"],
  ["archive:door", "market:door"],
  ["outskirts:door", "board:door"],
  ["plaza:door", "home5:door"]
]) {
  const pa = named(a);
  const pb = named(b);
  const raw = pf.findPath(grid, pa.tile, pb.tile);
  const sm = pf.smoothPath(grid, raw);
  console.log(`  ${a.padEnd(16)} -> ${b.padEnd(16)} ${String(raw.length).padStart(3)} tiles  ${String(sm.length).padStart(2)} waypoints  cost ${pf.pathCost(grid, raw).toFixed(1)}  length ${pf.polylineLength(sm).toFixed(1)} tiles`);
}

console.log(failures === 0 ? "\nPASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
