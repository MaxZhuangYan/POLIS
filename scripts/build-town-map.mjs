#!/usr/bin/env node
// Generates the Polis town as a Tiled map:  public/assets/town/polis-town.tmj
//
//     node scripts/extrude-tileset.py        (once: python3 scripts/extrude-tileset.py)
//     node scripts/build-town-map.mjs        -> public/assets/town/polis-town.tmj
//     python3 scripts/render-town-preview.py -> PNG preview of the result
//
// The output is a plain Tiled JSON map (orthogonal, 16x16, finite, right-down) with the tileset embedded, so it can
// also be opened and edited directly in the Tiled editor (https://www.mapeditor.org). This script is just the
// "designer's source": section 1 below is readable layout data (roads, buildings, props, location areas); tweak it
// and rebuild. No dependencies.
//
// ── Layer conventions (consumed by app/components/town/tiled.ts) ───────────────────────────────────────────────
//   tile layers, drawn in this order (the order Phaser draws them):
//     ground     base terrain: orange sand-ground, grass
//     paths      roads + plaza paving (autotiled: sand 9-slice + concave corners from the neighbour mask)
//     water      ponds / canal (9-slice + shore halo)
//     deco       flowers, rocks, signs, small props, bridge decks, steps, fences — walkable unless `collision` says so
//     buildings  lower parts of buildings, tree trunks, big props (drawn below residents)
//     collision  invisible. ANY NON-EMPTY TILE = BLOCKED for path finding (marker tile = extras tile (4,40)).
//                This is the single collision convention; there is no per-tile `collides` property.
//     above      roofs, tree canopies, torii beams, lamp tops — drawn ABOVE residents so they walk behind them
//   tile property `cost` (float) on tileset tiles = movement cost when a resident stands on that tile:
//     road / plaza / steps / bridge 1 · bare ground 2 · grass 2.5 · decorative non-blocking props 4.
//     Cost is looked up top-down: deco tile, then paths tile, then ground tile.
//   object layer `locations` (one layer, `type`/`class` identifies the object):
//     location      rect  name = LocationId           props: label (string), owner (npc id or "")   — walkable stand area
//                         (several rects with the same name = one location with several areas)
//     door          point props: location             — the ENTRY tile centre in front of a building's door (walkable)
//     home_door     point props: slot (0..8), location="home" — entry tile in front of each residence
//     interactable  rect  props: location (+ slot)    — click / hover target over a building or landmark
//
// Everything is deterministic (seeded PRNG), so the committed .tmj is exactly what this script produces.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/assets/town/polis-town.tmj");

// ═════════════════════════════ 0. tileset constants ═════════════════════════════
const TILE = 16;
const COLS = 28; // tileset columns
const SRC_ROWS = 40; // rows of the original pack tileset
const ROWS = 42; // + 2 rows of derived tiles (scripts/extrude-tileset.py)
const TILESET_IMAGE = "tileset.png"; // extruded: margin 1, spacing 2
const gid = (c, r) => 1 + r * COLS + c;
const FLIP_H = 0x80000000;

const G = {
  // ground
  orange: [18, 6],
  orangeAlt: [21, 11],
  orangeTuft: [24, 11],
  grass: [22, 11],
  grassDark: [23, 11],
  // sand road 9-slice (+ concave corners in the extras row)
  sand: { tl: [20, 12], t: [21, 12], tr: [22, 12], l: [20, 13], c: [21, 13], r: [22, 13], bl: [20, 14], b: [21, 14], br: [22, 14] },
  sandInner: { tl: [0, 40], tr: [1, 40], bl: [2, 40], br: [3, 40] },
  // stone-framed plaza pad 9-slice
  pad: { tl: [25, 12], t: [26, 12], tr: [27, 12], l: [25, 13], c: [26, 13], r: [27, 13], bl: [25, 14], b: [26, 14], br: [27, 14] },
  paveEmblem: [24, 13],
  // water 9-slice + shore halo ring
  water: { tl: [19, 7], t: [20, 7], tr: [21, 7], l: [19, 8], c: [20, 8], r: [21, 8], bl: [19, 9], b: [20, 9], br: [21, 9] },
  halo: { tl: [18, 6], t: [20, 6], tr: [22, 6], l: [18, 8], r: [22, 8], bl: [18, 10], b: [20, 10], br: [22, 10] },
  marker: [4, 40]
};

// ═════════════════════════════ 1. LAYOUT DATA (edit me) ═════════════════════════════
// All coordinates are TILE coordinates, rectangles are [x0, y0, x1, y1] INCLUSIVE. Map is 64 x 42 tiles.
//
//        west block (x 1-21)        canal (x 22-26)      centre (x 27-43)        east block (x 44-62)
//   y 2-9    archive + hut                              hall (议事厅) + steps       outskirts forest (NE)
//   y 11-24  homes: 2 rows x 4 houses                    plaza (statue pad)          workshop yard (y 13-19)
//   y 27-33  market street                               notice board square         mediation garden + torii
//   y 34-41  pond + grove                                spine -> south gate         (y 22-38)

const W = 64;
const H = 42;
const SEED = 20260610;

// Sand roads / squares. Union of rectangles; the autotiler derives edges, convex and concave corners.
// Rules: every rectangle >= 2 tiles thick; two roads that touch must share an edge or overlap.
const ROADS = [
  // hall court, plaza, main spine to the south gate
  [29, 8, 42, 11],
  [28, 12, 43, 24],
  [34, 25, 36, 41],
  // north-west road: hut + archive, over the canal bridge into the hall court
  [1, 8, 28, 9],
  // homes: two streets + a lane linking them to the north-west road and the market
  [1, 15, 21, 16],
  [1, 22, 21, 23],
  [20, 8, 21, 30],
  // market street (west), bridge, link to the board square
  [2, 29, 21, 30],
  [27, 29, 29, 30],
  // board square south of the plaza
  [30, 28, 42, 32],
  // east road to the workshop, trail north into the forest, clearing (outskirts)
  [44, 17, 59, 18],
  [57, 7, 58, 16],
  [52, 3, 59, 6],
  // road to the mediation garden, torii entrance, garden court
  [37, 35, 53, 36],
  [51, 32, 53, 34],
  [47, 25, 54, 31]
];

// Stone-framed paving pads (rectangles).
const PADS = [[33, 16, 38, 21]];

// Water (each >= 2x2). A 1-tile shore halo is added around each rectangle.
const WATERS = [
  [23, 4, 25, 36], // canal
  [4, 35, 9, 37], // south-west pond
  [56, 26, 59, 29] // garden pond
];
// Bridges: [x0, x1, y] deck row across water (planks run north-south, walkers east-west)
const BRIDGES = [
  [22, 26, 9],
  [22, 26, 29]
];

// Grass lawns / forest floor (hard-edged, mostly hidden under trees), minus the ORANGE_CUT areas.
const GRASS = [
  [46, 0, 63, 12],
  [45, 21, 61, 37]
];
const ORANGE_CUT = [
  [51, 2, 60, 7],
  [56, 7, 59, 12],
  [46, 24, 55, 32],
  [55, 24, 61, 31],
  [50, 31, 54, 38],
  [45, 34, 54, 37]
];

// ── stamps: src = [col, row, w, h] in the source tileset ─────────────────────────────────────────────────────
// above: number of top rows drawn in the `above` layer (over residents);
// solid: 'all' (default) | 'none' | 'base' (rows below `above`) | per-row strings ('#' blocked)
const STAMPS = {
  houseA: { src: [0, 0, 4, 3], above: 2, door: [1, 2], doorless: [2, 2] },
  houseB: { src: [4, 0, 4, 3], above: 2, door: [1, 2], doorless: [2, 2] },
  houseC: { src: [8, 0, 4, 3], above: 2, door: [1, 2], doorless: [2, 2] },
  houseD: { src: [12, 0, 4, 3], above: 2, door: [1, 2], doorless: [2, 2] },
  hut: { src: [16, 0, 3, 2], above: 1, door: [1, 1] },
  // a windowless tier (B's roof + blank wall) used as the hall's upper storey
  hallTop: { src: [4, 0, 4, 2], above: 2, extraRow: [[4, 2], [6, 2], [6, 2], [7, 2]] },
  torii: { src: [0, 3, 3, 2], above: 1, solid: ["...", "#.#"] },
  steps: { src: [16, 3, 3, 3], above: 0, layer: "deco", solid: "none" },
  pillar: { src: [4, 3, 1, 3], above: 1, solid: "all" },
  statue: { src: [26, 2, 2, 2], above: 1, solid: "all" },
  buddha: { src: [26, 0, 2, 2], above: 1, solid: "all" },
  bush2: { src: [0, 10, 2, 2], above: 1, solid: ["..", "##"] },
  bushTrio: { src: [2, 9, 4, 3], above: 2, solid: ["....", "....", "####"], skip: [[0, 0], [3, 0]] },
  pine2: { src: [6, 10, 2, 2], above: 1, solid: ["..", "##"] },
  pineTrio: { src: [6, 9, 6, 3], above: 2, solid: ["......", "......", "######"], skip: [[0, 0], [1, 0], [2, 0], [3, 0], [5, 0]] },
  boulder: { src: [12, 10, 2, 2], above: 0, solid: "all" },
  rocks: { src: [14, 9, 4, 3], above: 0, solid: "all", skip: [[0, 0]] },
  bonsai: { src: [11, 8, 2, 2], above: 1, solid: ["..", "##"] },
  board: { src: [14, 6, 4, 1], above: 0, solid: "all" },
  lamp: { src: [10, 5, 1, 2], above: 1, solid: ["#", "#"] },
  bench: { src: [7, 3, 2, 1], above: 0, solid: "all" },
  cart1: { src: [5, 8, 2, 2], above: 0, solid: "all" },
  cart2: { src: [7, 8, 2, 2], above: 0, solid: "all" },
  laundry: { src: [8, 4, 2, 2], above: 0, solid: "all" },
  swordSign: { src: [14, 5, 2, 1], above: 0, solid: "all" },
  shelfBooks: { src: [10, 37, 2, 2], above: 0, solid: "all" },
  shelfBooks2: { src: [12, 37, 1, 2], above: 0, solid: "all" },
  dock: { src: [24, 9, 2, 2], above: 0, solid: "all" },
  boat: { src: [26, 10, 2, 1], above: 0, layer: "deco", solid: "none" },
  // market stall canopy: drawn over residents, the counter below it blocks
  awning: { src: [3, 3, 1, 1], above: 1, solid: "none" }
};
// 1x1 props: name -> [col,row]. All of them block unless listed in SOFT.
const PROPS = {
  crate: [11, 4], planks: [12, 4], fruit: [13, 4], drawers: [11, 5], chest: [12, 5], pot: [1, 6], barrel: [2, 6],
  basket: [2, 5], table: [8, 6], bucket: [9, 6], eggs: [15, 7], shelf: [16, 7], cheese: [16, 8], frame: [14, 7],
  signSmall: [14, 8], signArrow: [15, 8], scroll: [14, 3], scrollBox: [15, 3], hay: [3, 8], pumpkin: [4, 8],
  stump: [9, 8], tanuki: [10, 8], logs: [4, 6], stone: [3, 6], vase: [12, 3], bushOne: [0, 6], lanternG: [10, 4],
  grave: [11, 7], shrine: [3, 4], guardian: [3, 5], well: [5, 7], wellRing: [4, 7], forge: [12, 6], anvil: [13, 6],
  rock1: [1, 7], rock2: [0, 7], stallRed: [3, 3],
  // soft (walkable, cost 4) decoration
  daisy: [1, 8], sunflower: [3, 15], clover: [4, 15], whiteFlower: [14, 9], tuft: [0, 5], sprout: [0, 8], mushrooms: [3, 16],
  grassBig: [9, 15], grassBig2: [10, 16], coral: [10, 17], leafPlant: [13, 8], sparkle: [2, 8]
};
const SOFT = new Set(["daisy", "sunflower", "clover", "whiteFlower", "tuft", "sprout", "mushrooms", "grassBig", "grassBig2", "coral", "leafPlant", "sparkle"]);
const WATER_DECO = [[23, 6], [23, 7], [23, 9], [23, 8], [23, 6], [23, 7]]; // ripples, lily pad (same blue as the centre tile)

// Locations. `area` rects are the walkable stand areas (several = one location); `entry` is the door tile residents
// walk to when the location has no building of its own (buildings tagged `loc` below give their door tile).
const LOCATIONS = {
  hall: { label: "议事厅", owner: "", area: [[31, 8, 40, 11]], entry: null, interact: [[30, 2, 41, 7]] },
  plaza: { label: "广场", owner: "", area: [[29, 12, 42, 24]], entry: [35, 24], interact: [[33, 16, 38, 21]] },
  archive: { label: "档案馆", owner: "iris", area: [[6, 8, 17, 9]], entry: null, interact: [[12, 5, 15, 7]] },
  workshop: { label: "工坊", owner: "tao", area: [[46, 17, 58, 18], [51, 14, 58, 16]], entry: null, interact: [] },
  market: { label: "市集", owner: "sol", area: [[4, 29, 19, 30]], entry: [11, 30], interact: [[3, 27, 19, 28], [3, 31, 19, 33]] },
  board: { label: "公告栏", owner: "", area: [[36, 29, 42, 32]], entry: [39, 30], interact: [[38, 27, 41, 27]] },
  mediation: { label: "调解所", owner: "kade", area: [[47, 25, 54, 31]], entry: null, interact: [] },
  outskirts: { label: "城邦外围", owner: "nova", area: [[52, 3, 59, 6]], entry: null, interact: [] },
  gate: { label: "城门", owner: "", area: [[33, 34, 37, 36]], entry: [35, 36], interact: [[34, 38, 36, 39]] },
  home: { label: "住宅区", owner: "", area: [[1, 11, 20, 24]], entry: null, interact: [] }
};

// Buildings: stamp, tile position, optional location tag / home slot.
const BUILDINGS = [
  // 议事厅 — three attached buildings, the middle one has the door; a stone upper storey behind it
  { s: "hallTop", x: 34, y: 2 },
  { s: "houseA", x: 30, y: 5, doorless: true },
  { s: "houseD", x: 34, y: 5, loc: "hall" },
  { s: "houseC", x: 38, y: 5, doorless: true },
  // 档案馆 — stone building + wing
  { s: "houseB", x: 8, y: 5, loc: "archive" },
  { s: "houseB", x: 12, y: 5, doorless: true },
  // 工坊
  { s: "houseA", x: 47, y: 14, loc: "workshop" },
  // 调解所
  { s: "houseB", x: 51, y: 22, loc: "mediation" },
  // 住宅区 — row A (slots 0-3), row B (4-7), hut (8)
  { s: "houseA", x: 1, y: 12, home: 0 },
  { s: "houseC", x: 6, y: 12, home: 1 },
  { s: "houseD", x: 11, y: 12, home: 2 },
  { s: "houseB", x: 16, y: 12, home: 3 },
  { s: "houseB", x: 1, y: 19, home: 4 },
  { s: "houseD", x: 6, y: 19, home: 5 },
  { s: "houseA", x: 11, y: 19, home: 6 },
  { s: "houseC", x: 16, y: 19, home: 7 },
  { s: "hut", x: 2, y: 6, home: 8 },
  // 城邦外围 — the scout's hut in the woods
  { s: "hut", x: 55, y: 1, loc: "outskirts" }
];

// Props placed by hand: [stamp-or-prop, x, y]
const PLACED = [
  // hall: steps, pillars, lamps, benches, flanking trees
  ["steps", 34, 8],
  ["pillar", 33, 8],
  ["pillar", 37, 8],
  ["lamp", 31, 9],
  ["lamp", 40, 9],
  ["bushTrio", 26, 3],
  ["bushTrio", 42, 3],
  ["bush2", 29, 2],
  ["bush2", 41, 1],
  // plaza centrepiece, emblem paving, benches, lamps, flower beds
  ["statue", 35, 18],
  ["lamp", 32, 15],
  ["lamp", 39, 15],
  ["lamp", 32, 21],
  ["lamp", 39, 21],
  ["bench", 34, 14],
  ["bench", 37, 14],
  ["bench", 34, 23],
  ["bench", 37, 23],
  ["sunflower", 30, 13],
  ["daisy", 31, 13],
  ["sunflower", 41, 13],
  ["daisy", 40, 13],
  ["daisy", 30, 23],
  ["sunflower", 31, 23],
  ["daisy", 41, 23],
  ["sunflower", 40, 23],
  ["clover", 29, 18],
  ["clover", 42, 18],
  // archive props
  ["shelfBooks", 5, 7],
  ["shelfBooks2", 17, 7],
  ["scroll", 7, 7],
  ["scrollBox", 16, 7],
  ["crate", 18, 7],
  ["crate", 19, 7],
  ["lanternG", 6, 9],
  // workshop yard
  ["forge", 51, 15],
  ["anvil", 52, 15],
  ["crate", 54, 14],
  ["crate", 55, 14],
  ["barrel", 56, 15],
  ["barrel", 57, 15],
  ["planks", 53, 13],
  ["planks", 54, 13],
  ["cart1", 56, 13],
  ["swordSign", 49, 13],
  ["barrel", 46, 15],
  ["crate", 46, 14],
  // notice board square
  ["board", 38, 27],
  ["signSmall", 37, 27],
  ["signArrow", 42, 28],
  ["lamp", 31, 28],
  ["lamp", 41, 29],
  ["bench", 31, 31],
  ["bench", 41, 31],
  // market stalls, north side
  ["laundry", 3, 27],
  ["table", 6, 28],
  ["crate", 7, 28],
  ["basket", 8, 28],
  ["awning", 6, 27],
  ["awning", 7, 27],
  ["awning", 8, 27],
  ["cart2", 10, 27],
  ["eggs", 13, 28],
  ["shelf", 14, 28],
  ["cheese", 15, 28],
  ["awning", 13, 27],
  ["awning", 14, 27],
  ["awning", 15, 27],
  ["laundry", 17, 27],
  ["barrel", 19, 28],
  ["pumpkin", 12, 28],
  ["crate", 9, 26],
  ["barrel", 12, 26],
  ["well", 16, 26],
  // market stalls, south side
  ["cart1", 3, 31],
  ["table", 6, 32],
  ["pot", 7, 32],
  ["barrel", 8, 32],
  ["awning", 6, 31],
  ["awning", 7, 31],
  ["awning", 8, 31],
  ["hay", 10, 32],
  ["pumpkin", 11, 32],
  ["fruit", 12, 32],
  ["basket", 13, 32],
  ["awning", 10, 31],
  ["awning", 11, 31],
  ["awning", 12, 31],
  ["awning", 13, 31],
  ["laundry", 15, 31],
  ["crate", 18, 31],
  ["drawers", 19, 31],
  ["barrel", 5, 33],
  ["crate", 8, 33],
  ["hay", 11, 33],
  ["basket", 14, 33],
  ["pot", 17, 33],
  // south-west pond: dock + boat
  ["dock", 10, 34],
  ["boat", 5, 38],
  // mediation garden
  ["torii", 51, 33],
  ["buddha", 48, 26],
  ["bonsai", 49, 29],
  ["lanternG", 47, 31],
  ["lanternG", 54, 31],
  ["buddha", 60, 25],
  ["rocks", 56, 31],
  // canal banks: boulders & bushes
  ["bush2", 27, 5],
  ["boulder", 20, 32],
  ["bush2", 27, 33],
  ["rock2", 27, 12],
  ["rock1", 21, 27],
  // gate
  ["torii", 34, 38],
  ["pillar", 33, 37],
  ["pillar", 37, 37],
  ["lamp", 32, 34],
  ["lamp", 38, 34]
];

// Picket fence rows: [x0, x1, y]
const FENCES = [
  [28, 32, 39],
  [38, 42, 39],
  [46, 50, 32],
  [54, 55, 32],
  [1, 4, 18],
  [6, 9, 18],
  [11, 14, 18],
  [16, 19, 18]
];

// Hedges (1x1 bushes) closing the 1-tile gaps between neighbouring houses: [x, y0, y1]
const HEDGES = [
  [5, 13, 14],
  [10, 13, 14],
  [15, 13, 14],
  [5, 20, 21],
  [10, 20, 21],
  [15, 20, 21],
  [0, 12, 14],
  [0, 19, 21],
  // mediation garden: hedges close the court on the west and east side, the torii on the south road is the way in
  [46, 24, 31],
  [55, 24, 31]
];
// Hedge rows: [x0, x1, y]
const HEDGE_ROWS = [[47, 50, 24]];

// Scatter decoration (seeded): { rect, items, count } — only on free ground outside roads / stand areas
const SCATTER = [
  { rect: [1, 3, 21, 7], items: ["daisy", "tuft", "sprout", "sunflower"], count: 12 },
  { rect: [1, 10, 21, 11], items: ["daisy", "sunflower", "clover", "tuft"], count: 8 },
  { rect: [1, 17, 21, 18], items: ["daisy", "tuft", "sprout", "clover"], count: 8 },
  { rect: [1, 24, 21, 27], items: ["daisy", "tuft", "stone", "sprout"], count: 10 },
  { rect: [27, 3, 33, 7], items: ["daisy", "tuft", "sprout"], count: 6 },
  { rect: [43, 3, 46, 12], items: ["daisy", "tuft"], count: 3 },
  { rect: [27, 25, 33, 38], items: ["daisy", "tuft", "sprout", "sunflower"], count: 12 },
  { rect: [37, 24, 45, 28], items: ["daisy", "tuft", "clover"], count: 6 },
  { rect: [37, 33, 44, 40], items: ["daisy", "tuft", "sprout"], count: 8 },
  { rect: [44, 19, 62, 24], items: ["daisy", "tuft", "whiteFlower"], count: 8 },
  { rect: [1, 32, 21, 40], items: ["daisy", "tuft", "sprout", "stone", "sunflower"], count: 16 },
  { rect: [45, 21, 61, 37], items: ["whiteFlower", "tuft", "mushrooms", "clover", "grassBig"], count: 20 },
  { rect: [46, 0, 63, 12], items: ["tuft", "mushrooms", "grassBig", "grassBig2", "clover", "leafPlant", "stump", "logs"], count: 30 }
];

// Trees: a ring along the map border, groves, denser forest in the NE woods. kinds are STAMPS names.
const GROVES = [
  { rect: [2, 2, 21, 7], n: 4, kinds: ["bushTrio", "pineTrio", "bush2"] },
  { rect: [2, 25, 19, 27], n: 3, kinds: ["bush2", "pine2"] },
  { rect: [10, 33, 21, 40], n: 5, kinds: ["bushTrio", "pineTrio", "pine2", "bush2"] },
  { rect: [1, 33, 4, 40], n: 3, kinds: ["pine2", "bush2"] },
  { rect: [27, 25, 33, 40], n: 5, kinds: ["bush2", "pine2", "bushTrio"] },
  { rect: [37, 37, 62, 40], n: 8, kinds: ["pine2", "bush2"] },
  { rect: [43, 19, 62, 24], n: 7, kinds: ["pine2", "bush2", "bushTrio"] },
];
// Forests: grid-packed trees (2x2 cells with a stagger) so the woods read dense: p = chance a cell gets a tree
const FORESTS = [{ rect: [46, 1, 63, 12], p: 0.72, kinds: ["pine2", "pine2", "bush2", "pine2", "bushTrio", "pineTrio"] }];
const BORDER_GAPS = { bottom: [[32, 38]] }; // x ranges left open in the south tree line (the gate road)

// Decoration along the streets: probability that a free ground cell next to a road / water gets a small prop
const EDGE_DECO = { chance: 0.11, items: ["barrel", "crate", "pot", "bushOne", "daisy", "tuft", "lanternG", "sunflower", "clover"] };

// ═════════════════════════════ 2. tooling ═════════════════════════════
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const rint = (a, b) => a + Math.floor(rng() * (b - a + 1));

// minimal PNG reader (RGBA8, non-interlaced) to find fully transparent tiles of the source sheet
function readPng(file) {
  const d = readFileSync(file);
  let p = 8;
  let w = 0;
  let h = 0;
  const idat = [];
  while (p < d.length) {
    const len = d.readUInt32BE(p);
    const type = d.toString("ascii", p + 4, p + 8);
    if (type === "IHDR") {
      w = d.readUInt32BE(p + 8);
      h = d.readUInt32BE(p + 12);
      if (d[p + 16] !== 8 || d[p + 17] !== 6 || d[p + 20] !== 0) throw new Error("tileset.png must be RGBA8, non-interlaced");
    } else if (type === "IDAT") idat.push(d.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = r & 255;
    }
  }
  return { w, h, data: out };
}
const sheet = readPng(join(ROOT, "scripts/town-src/tileset.png"));
const emptyCache = new Map();
function isEmptyTile(c, r) {
  const k = r * COLS + c;
  if (emptyCache.has(k)) return emptyCache.get(k);
  let empty = true;
  for (let y = 0; y < TILE && empty; y++) {
    for (let x = 0; x < TILE; x++) {
      if (sheet.data[((r * TILE + y) * sheet.w + c * TILE + x) * 4 + 3] > 0) {
        empty = false;
        break;
      }
    }
  }
  emptyCache.set(k, empty);
  return empty;
}

const idx = (x, y) => y * W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const mk = (Type = Uint32Array) => new Type(W * H);
const L = { ground: mk(), paths: mk(), water: mk(), deco: mk(), buildings: mk(), above: mk() };
const block = mk(Uint8Array); // collision
const occ = mk(Uint8Array); // something placed (props avoid it)
const roadMask = mk(Uint8Array);
const padMask = mk(Uint8Array);
const waterMask = mk(Uint8Array);
const warnings = [];
const warn = (m) => warnings.push(m);

function fillRect(rect, fn) {
  const [x0, y0, x1, y1] = rect;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) fn(x, y);
}
const inRect = (r, x, y) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];

// ═════════════════════════════ 3. ground ═════════════════════════════
fillRect([0, 0, W - 1, H - 1], (x, y) => {
  const r = rng();
  L.ground[idx(x, y)] = gid(...(r < 0.02 ? G.orangeAlt : G.orange));
});
{
  const cutMask = mk(Uint8Array);
  for (const c of ORANGE_CUT) fillRect(c, (x, y) => (cutMask[idx(x, y)] = 1));
  for (const g of GRASS) {
    fillRect(g, (x, y) => {
      if (cutMask[idx(x, y)]) return;
      const r = rng();
      L.ground[idx(x, y)] = gid(...(r < 0.16 ? G.grassDark : G.grass));
    });
  }
}

// ═════════════════════════════ 4. autotiled roads / pads ═════════════════════════════
function maskAt(mask, x, y) {
  // outside the map repeats the nearest cell, so a road running off the edge has no rim there
  const cx = Math.max(0, Math.min(W - 1, x));
  const cy = Math.max(0, Math.min(H - 1, y));
  return mask[idx(cx, cy)] === 1;
}

// building footprints that touch a road extend the road mask underneath them (no orange fringe under walls)
for (const r of ROADS) fillRect(r, (x, y) => (roadMask[idx(x, y)] = 1));
for (const r of PADS) fillRect(r, (x, y) => (padMask[idx(x, y)] = 1));

function autotile(mask, tiles, inner, layer, label) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[idx(x, y)]) continue;
      const n = maskAt(mask, x, y - 1);
      const s = maskAt(mask, x, y + 1);
      const w = maskAt(mask, x - 1, y);
      const e = maskAt(mask, x + 1, y);
      let key;
      if (n && s && w && e) {
        const nw = maskAt(mask, x - 1, y - 1);
        const ne = maskAt(mask, x + 1, y - 1);
        const sw = maskAt(mask, x - 1, y + 1);
        const se = maskAt(mask, x + 1, y + 1);
        const missing = [!nw && "tl", !ne && "tr", !sw && "bl", !se && "br"].filter(Boolean);
        if (missing.length === 0) key = "c";
        else {
          if (missing.length > 1) warn(`${label}: ${missing.length} concave corners at ${x},${y}`);
          key = inner ? `i${missing[0]}` : "c";
        }
      } else if (!n && !s) {
        warn(`${label}: 1-tile-thick horizontal strip at ${x},${y}`);
        key = "c";
      } else if (!w && !e) {
        warn(`${label}: 1-tile-thick vertical strip at ${x},${y}`);
        key = "c";
      } else if (!n && !w) key = "tl";
      else if (!n && !e) key = "tr";
      else if (!s && !w) key = "bl";
      else if (!s && !e) key = "br";
      else if (!n) key = "t";
      else if (!s) key = "b";
      else if (!w) key = "l";
      else key = "r";
      const t = key.startsWith("i") ? inner[key.slice(1)] : tiles[key];
      layer[idx(x, y)] = gid(...t);
    }
  }
}

// ═════════════════════════════ 5. water ═════════════════════════════
for (const [x0, y0, x1, y1] of WATERS) {
  if (x1 - x0 < 1 || y1 - y0 < 1) throw new Error("water rect must be >= 2x2");
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (!inb(x, y)) continue;
      const row = y < y0 ? "t" : y > y1 ? "b" : "";
      const col = x < x0 ? "l" : x > x1 ? "r" : "";
      if (!row && !col) {
        // inside: 9-slice from the rectangle border, sprinkled with ripple / lily-pad variants in the middle
        const r = y === y0 ? "t" : y === y1 ? "b" : "";
        const c = x === x0 ? "l" : x === x1 ? "r" : "";
        const key = r + c || "c";
        let t = G.water[key];
        if (key === "c" && rng() < 0.16) t = pick(WATER_DECO);
        L.water[idx(x, y)] = gid(...t);
        waterMask[idx(x, y)] = 1;
        block[idx(x, y)] = 1;
      } else {
        L.water[idx(x, y)] = gid(...G.halo[row + col]);
      }
      occ[idx(x, y)] = 1;
    }
  }
}

// ═════════════════════════════ 6. stamps ═════════════════════════════
const deferredObjects = { buildings: [], interact: [] };
function stampCells(name, x, y, opts = {}) {
  const s = STAMPS[name];
  if (!s) throw new Error(`unknown stamp ${name}`);
  const [sc, sr, sw, sh] = s.src;
  const cells = [];
  const totalH = sh + (s.extraRow ? 1 : 0);
  for (let dy = 0; dy < totalH; dy++) {
    for (let dx = 0; dx < sw; dx++) {
      let c = sc + dx;
      let r = sr + dy;
      if (dy >= sh) [c, r] = s.extraRow[dx];
      else if (opts.doorless && s.door && s.doorless && dx === s.door[0] && dy === s.door[1]) [c, r] = s.doorless;
      if (isEmptyTile(c, r) || s.skip?.some(([sx, sy]) => sx === dx && sy === dy)) continue;
      const layerName = dy < (s.above ?? 0) ? "above" : s.layer ?? "buildings";
      let solid;
      if (s.solid === "none") solid = false;
      else if (Array.isArray(s.solid)) solid = s.solid[dy]?.[dx] === "#";
      else if (s.solid === "base") solid = dy >= (s.above ?? 0);
      else solid = true; // 'all' / default
      cells.push({ x: x + dx, y: y + dy, gid: gid(c, r), layer: layerName, solid, dx, dy });
    }
  }
  return { cells, w: sw, h: totalH };
}
function putStamp(name, x, y, opts = {}) {
  const { cells, w, h } = stampCells(name, x, y, opts);
  for (const c of cells) {
    if (!inb(c.x, c.y)) continue;
    let g = c.gid;
    if (opts.flip) g = (g | FLIP_H) >>> 0;
    L[c.layer][idx(c.x, c.y)] = g;
    if (c.solid) block[idx(c.x, c.y)] = 1;
    occ[idx(c.x, c.y)] = 1;
  }
  return { x, y, w, h };
}
function putProp(name, x, y) {
  const t = PROPS[name];
  if (!t) throw new Error(`unknown prop ${name}`);
  if (!inb(x, y)) return;
  const soft = SOFT.has(name);
  L[soft ? "deco" : "buildings"][idx(x, y)] = gid(...t);
  if (!soft) block[idx(x, y)] = 1;
  occ[idx(x, y)] = 1;
}

// bridges first (decks on `deco`, cells become walkable)
const bridgeCells = new Set();
for (const [x0, x1, y] of BRIDGES) {
  for (let x = x0; x <= x1; x++) {
    const t = x === x0 ? [24, 8] : x === x1 ? [24, 8] : [25, 8];
    L.deco[idx(x, y)] = (gid(...t) | (x === x1 ? FLIP_H : 0)) >>> 0;
    block[idx(x, y)] = 0;
    occ[idx(x, y)] = 1;
    bridgeCells.add(idx(x, y));
  }
}

// roads underneath building walls that face a road
for (const b of BUILDINGS) {
  const s = STAMPS[b.s];
  const wallY = b.y + (s.src[3] - 1);
  const below = wallY + 1;
  for (let dx = 0; dx < s.src[2]; dx++) {
    if (maskAt(roadMask, b.x + dx, below) && inb(b.x + dx, below) && roadMask[idx(b.x + dx, below)]) roadMask[idx(b.x + dx, wallY)] = 1;
  }
}
autotile(roadMask, G.sand, G.sandInner, L.paths, "road");
autotile(padMask, G.pad, null, L.paths, "pad");

// ═════════════════════════════ 7. buildings & props ═════════════════════════════
const doors = []; // { loc, slot?, x, y }  entry tile in front of the door
const interactables = []; // { loc, slot?, rect:[x0,y0,x1,y1] tiles }
for (const b of BUILDINGS) {
  const placed = putStamp(b.s, b.x, b.y, { doorless: b.doorless });
  const s = STAMPS[b.s];
  const rect = [b.x, b.y, b.x + placed.w - 1, b.y + placed.h - 1];
  if (b.loc || b.home !== undefined) {
    const ex = b.x + s.door[0];
    const ey = b.y + s.door[1] + 1;
    if (b.home !== undefined) {
      doors.push({ loc: "home", slot: b.home, x: ex, y: ey });
      interactables.push({ loc: "home", slot: b.home, rect });
    } else {
      doors.push({ loc: b.loc, x: ex, y: ey });
      interactables.push({ loc: b.loc, rect });
    }
  } else if (b.s === "hallTop") {
    interactables.push({ loc: "hall", rect });
  }
}
for (const [name, x, y] of PLACED) {
  if (STAMPS[name]) putStamp(name, x, y);
  else putProp(name, x, y);
}
// picket fences
for (const [x0, x1, y] of FENCES) {
  for (let x = x0; x <= x1; x++) {
    const left = x === x0;
    const right = x === x1;
    const t = left || right ? [21, 1] : [22, 1];
    L.buildings[idx(x, y)] = (gid(...t) | (left ? FLIP_H : 0)) >>> 0;
    block[idx(x, y)] = 1;
    occ[idx(x, y)] = 1;
  }
}

// hedges closing the gaps between neighbouring houses
for (const [x, y0, y1] of HEDGES) for (let y = y0; y <= y1; y++) if (!occ[idx(x, y)]) putProp("bushOne", x, y);
for (const [x0, x1, y] of HEDGE_ROWS) for (let x = x0; x <= x1; x++) if (!occ[idx(x, y)]) putProp("bushOne", x, y);

// cells that must stay clean: stand areas of the locations and the tiles around every door entry
const keepClear = mk(Uint8Array);
for (const def of Object.values(LOCATIONS)) for (const a of def.area) fillRect(a, (x, y) => (keepClear[idx(x, y)] = 1));
for (const d of doors) for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) if (inb(d.x + dx, d.y + dy)) keepClear[idx(d.x + dx, d.y + dy)] = 1;
for (const [id, def] of Object.entries(LOCATIONS)) if (def.entry) for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) keepClear[idx(def.entry[0] + dx, def.entry[1] + dy)] = 1;

// ── trees: border ring, groves, forest ────────────────────────────────────────────────────────────────────────
function treeFree(x, y, w, h, margin = 0) {
  for (let yy = y - margin; yy < y + h + margin; yy++)
    for (let xx = x - margin; xx < x + w + margin; xx++) {
      if (!inb(xx, yy)) return false;
      if (occ[idx(xx, yy)] || roadMask[idx(xx, yy)] || padMask[idx(xx, yy)] || keepClear[idx(xx, yy)]) return false;
    }
  return true;
}
const plantTree = (kind, x, y) => putStamp(kind, x, y);
// border ring (2 tiles deep): top, bottom, left, right
for (let x = 0; x < W; x += 2) {
  if (treeFree(x, 0, 2, 2)) plantTree(pick(["pine2", "bush2", "pine2"]), x, 0);
  const gap = (BORDER_GAPS.bottom ?? []).some(([a, b]) => x + 1 >= a && x <= b);
  if (!gap && treeFree(x, H - 2, 2, 2)) plantTree(pick(["pine2", "bush2", "pine2"]), x, H - 2);
}
for (let y = 2; y < H - 2; y += 2) {
  if (treeFree(0, y, 2, 2)) plantTree(pick(["pine2", "bush2"]), 0, y);
  if (treeFree(W - 2, y, 2, 2)) plantTree(pick(["pine2", "bush2"]), W - 2, y);
}
for (const g of GROVES) {
  const [x0, y0, x1, y1] = g.rect;
  let placed = 0;
  for (let tries = 0; tries < 4000 && placed < g.n; tries++) {
    const kind = pick(g.kinds);
    const [, , w, h] = STAMPS[kind].src;
    const x = rint(x0, x1 - w + 1);
    const y = rint(y0, y1 - h + 1);
    if (!treeFree(x, y, w, h, 1)) continue;
    plantTree(kind, x, y);
    placed++;
  }
}

for (const f of FORESTS) {
  const [x0, y0, x1, y1] = f.rect;
  for (let y = y0; y <= y1 - 1; y += 2) {
    const off = (y / 2) % 2 === 0 ? 0 : 1;
    for (let x = x0 + off; x <= x1 - 1; x += 2) {
      if (rng() > f.p) continue;
      const kind = pick(f.kinds);
      const [, , w, h] = STAMPS[kind].src;
      if (y + h - 1 > y1 + 1) continue;
      if (treeFree(x, y, w, h, 0)) plantTree(kind, x, y);
    }
  }
}

// ── scatter decoration + street-side props ───────────────────────────────────────────────────────────────────
const freeGround = (x, y) => inb(x, y) && !occ[idx(x, y)] && !roadMask[idx(x, y)] && !padMask[idx(x, y)] && !keepClear[idx(x, y)];
for (const sc of SCATTER) {
  let placed = 0;
  for (let tries = 0; tries < 800 && placed < sc.count; tries++) {
    const x = rint(sc.rect[0], sc.rect[2]);
    const y = rint(sc.rect[1], sc.rect[3]);
    if (!freeGround(x, y)) continue;
    putProp(pick(sc.items), x, y);
    placed++;
  }
}
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    if (!freeGround(x, y)) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++)
      for (let dx = -1; dx <= 1; dx++) if (roadMask[idx(x + dx, y + dy)] || waterMask[idx(x + dx, y + dy)]) near = true;
    if (near && rng() < EDGE_DECO.chance) putProp(pick(EDGE_DECO.items), x, y);
  }
}

// ═════════════════════════════ 8. location entry points ═════════════════════════════
for (const [id, def] of Object.entries(LOCATIONS)) {
  if (def.entry) doors.push({ loc: id, x: def.entry[0], y: def.entry[1] });
  for (const r of def.interact) interactables.push({ loc: id, rect: r });
}

// collision marker layer
const collisionLayer = mk();
for (let i = 0; i < W * H; i++) if (block[i]) collisionLayer[i] = gid(...G.marker);

// ═════════════════════════════ 9. validation ═════════════════════════════
{
  const free = (x, y) => inb(x, y) && !block[idx(x, y)];
  const seen = new Uint8Array(W * H);
  const start = doors.find((d) => d.loc === "gate");
  const stack = [[start.x, start.y]];
  seen[idx(start.x, start.y)] = 1;
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (free(nx, ny) && !seen[idx(nx, ny)]) {
        seen[idx(nx, ny)] = 1;
        stack.push([nx, ny]);
      }
    }
  }
  for (const d of doors) {
    if (!free(d.x, d.y)) warn(`door entry of ${d.loc}${d.slot ?? ""} at ${d.x},${d.y} is blocked`);
    else if (!seen[idx(d.x, d.y)]) warn(`door entry of ${d.loc}${d.slot ?? ""} at ${d.x},${d.y} is unreachable`);
    if (L.above[idx(d.x, d.y)]) warn(`door entry of ${d.loc}${d.slot ?? ""} is under an \`above\` tile`);
  }
  const slots = doors.filter((d) => d.loc === "home").map((d) => d.slot).sort();
  if (slots.join() !== "0,1,2,3,4,5,6,7,8") warn(`home slots are ${slots.join()}`);
  for (const [id, def] of Object.entries(LOCATIONS)) {
    if (id === "home") continue;
    let n = 0;
    for (const a of def.area) fillRect(a, (x, y) => free(x, y) && seen[idx(x, y)] && n++);
    if (n < 6) warn(`location ${id}: only ${n} reachable walkable tiles in its area`);
    if (!doors.some((d) => d.loc === id)) warn(`location ${id} has no door`);
  }
}

// ═════════════════════════════ 10. emit .tmj ═════════════════════════════
let nextObjectId = 1;
const prop = (name, value) => ({ name, type: typeof value === "number" ? (Number.isInteger(value) ? "int" : "float") : "string", value });
const obj = (name, type, x, y, w, h, props, point = false) => {
  const o = {
    id: nextObjectId++,
    name,
    type,
    class: type,
    x: x * TILE,
    y: y * TILE,
    width: w * TILE,
    height: h * TILE,
    rotation: 0,
    visible: true,
    properties: props
  };
  if (point) {
    o.point = true;
    o.width = 0;
    o.height = 0;
  }
  return o;
};
const objects = [];
for (const [id, def] of Object.entries(LOCATIONS)) {
  for (const [x0, y0, x1, y1] of def.area) {
    objects.push(obj(id, "location", x0, y0, x1 - x0 + 1, y1 - y0 + 1, [prop("label", def.label), prop("owner", def.owner)]));
  }
}
for (const d of doors.filter((d) => d.loc !== "home")) {
  objects.push({ ...obj(`door-${d.loc}`, "door", d.x + 0.5, d.y + 0.5, 0, 0, [prop("location", d.loc)], true) });
}
for (const d of doors.filter((d) => d.loc === "home").sort((a, b) => a.slot - b.slot)) {
  objects.push(obj(`home-${d.slot}`, "home_door", d.x + 0.5, d.y + 0.5, 0, 0, [prop("location", "home"), prop("slot", d.slot)], true));
}
for (const it of interactables) {
  const [x0, y0, x1, y1] = it.rect;
  const props = [prop("location", it.loc)];
  if (it.slot !== undefined) props.push(prop("slot", it.slot));
  objects.push(obj(`${it.loc}${it.slot !== undefined ? `-${it.slot}` : ""}`, "interactable", x0, y0, x1 - x0 + 1, y1 - y0 + 1, props));
}

// tile properties: movement cost per tile id (see header)
const tileProps = new Map();
const setCost = (c, r, v) => tileProps.set(r * COLS + c, v);
for (const grp of [G.sand, G.sandInner, G.pad]) for (const [c, r] of Object.values(grp)) setCost(c, r, 1);
setCost(...G.paveEmblem, 1);
setCost(...G.orange, 2);
setCost(...G.orangeAlt, 2);
setCost(...G.orangeTuft, 2);
setCost(...G.grass, 2.5);
setCost(...G.grassDark, 2.5);
for (let r = 3; r <= 5; r++) for (let c = 16; c <= 18; c++) setCost(c, r, 1); // steps
setCost(24, 8, 1);
setCost(25, 8, 1);
for (const name of SOFT) setCost(...PROPS[name], 4);

const tiles = [...tileProps.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([id, cost]) => ({ id, properties: [{ name: "cost", type: "float", value: cost }] }));

const layerOrder = ["ground", "paths", "water", "deco", "buildings"];
const layers = [];
let layerId = 1;
const tileLayer = (name, data, extra = {}) => ({
  id: layerId++,
  name,
  type: "tilelayer",
  x: 0,
  y: 0,
  width: W,
  height: H,
  opacity: 1,
  visible: true,
  data: Array.from(data),
  ...extra
});
for (const n of layerOrder) layers.push(tileLayer(n, L[n]));
layers.push(tileLayer("collision", collisionLayer, { visible: false, opacity: 0.5 }));
layers.push(tileLayer("above", L.above));
layers.push({ id: layerId++, name: "locations", type: "objectgroup", draworder: "topdown", opacity: 1, visible: true, x: 0, y: 0, objects });

const tmj = {
  compressionlevel: -1,
  height: H,
  width: W,
  infinite: false,
  orientation: "orthogonal",
  renderorder: "right-down",
  tiledversion: "1.10.2",
  version: "1.10",
  type: "map",
  tilewidth: TILE,
  tileheight: TILE,
  nextlayerid: layerId,
  nextobjectid: nextObjectId,
  properties: [
    { name: "collision", type: "string", value: "any non-empty tile in layer 'collision' blocks movement" },
    { name: "generator", type: "string", value: "scripts/build-town-map.mjs" }
  ],
  tilesets: [
    {
      firstgid: 1,
      name: "polis-tileset",
      image: TILESET_IMAGE,
      imagewidth: COLS * (TILE + 2),
      imageheight: ROWS * (TILE + 2),
      tilewidth: TILE,
      tileheight: TILE,
      margin: 1,
      spacing: 2,
      columns: COLS,
      tilecount: COLS * ROWS,
      tiles
    }
  ],
  layers
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(tmj));
const nBlocked = block.reduce((s, v) => s + v, 0);
console.log(`wrote ${OUT.replace(ROOT + "/", "")}  ${W}x${H} tiles, ${objects.length} objects, ${nBlocked} blocked tiles`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings.slice(0, 60)) console.log("  - " + w);
}
