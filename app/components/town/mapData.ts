// Logical geography of the Polis town, in map-image pixel coordinates
// (/assets/polis-pixel-town-map.png, 1672 x 941).
//
// Everything here is *presentation* data: where a LocationId stands on the
// picture, which patches of ground residents may idle on, and the road graph
// they walk along. The simulation only ever says "agent X is at location Y"
// (or "travelling Y -> Z between t0 and t1"); the scene turns that into pixels.
//
// All coordinates were checked against zoomed crops of the map so that anchors
// sit on roads / paving / open ground — never on roofs, water or trees.

import type { LocationId } from "@/lib/types";

export const MAP_W = 1672;
export const MAP_H = 941;

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LocationDef {
  id: LocationId;
  label: string;
  /** road-graph node the location is attached to (also the camera focus point) */
  node: string;
  /** where an agent "arrives" */
  anchor: Pt;
  /** open ground residents may stand on (union of rects) */
  areas: Rect[];
  /** stand points, assigned one per resident, every one inside `areas` */
  slots: Pt[];
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const p = (x: number, y: number): Pt => ({ x, y });

// ───────────────────────────── road graph ─────────────────────────────
// Nodes sit on stone road, dirt path or open grass next to it. Edges are
// straight segments between two nodes; every edge was eyeballed against the
// map so that it does not cross water or buildings.

export const NODES: Record<string, Pt> = {
  // hall + central crossroads
  hall: p(805, 272),
  cn: p(805, 322),
  cw1: p(690, 322),
  cw2: p(570, 322),
  ce1: p(925, 322),
  ce2: p(1030, 322),
  pn_in: p(805, 392),
  // plaza ring around the fountain (octagon floor)
  pN: p(805, 428),
  pNE: p(868, 440),
  pE: p(894, 487),
  pSE: p(868, 538),
  pS: p(803, 552),
  pSW: p(738, 538),
  pW: p(714, 487),
  pNW: p(740, 440),
  // east connector + east road
  e_pl: p(960, 487),
  e_mid: p(1030, 487),
  e_s: p(1030, 612),
  e_s2: p(1000, 700),
  e_s3: p(1000, 760),
  e_s4: p(1000, 830),
  // south road + south-east band
  ps1: p(805, 600),
  ps2: p(805, 650),
  s_e1: p(905, 672),
  s_e2: p(1000, 672),
  sj: p(805, 705),
  bd0: p(808, 760),
  board: p(808, 812),
  // workshop yard (south gate in the fence)
  ws_a: p(1140, 612),
  ws_b: p(1236, 612),
  ws_gap: p(1236, 586),
  ws_in: p(1240, 545),
  workshop: p(1248, 497),
  // mediation gazebo (entered from the south-west corner of the garden)
  md_a: p(1050, 834),
  md_b: p(1120, 832),
  md_c: p(1195, 822),
  md_d: p(1235, 800),
  mediation: p(1235, 772),
  // outskirts park trail
  pk0: p(1045, 296),
  pk1: p(1085, 296),
  pk2: p(1106, 278),
  pk3: p(1117, 255),
  pk4: p(1138, 240),
  pk5: p(1172, 232),
  pk6: p(1196, 222),
  pk7: p(1202, 196),
  pk8: p(1206, 170),
  pk9: p(1228, 154),
  pk10: p(1262, 150),
  pk11: p(1293, 160),
  pk12: p(1305, 182),
  pk13: p(1308, 205),
  pk14: p(1328, 220),
  outskirts: p(1346, 226),
  // archive courtyard + the path leading to the homes
  archive: p(365, 256),
  ar_a: p(365, 340),
  ar_b: p(400, 352),
  ar_c: p(520, 352),
  ar_d: p(552, 336),
  ar_e: p(365, 392),
  hc0: p(362, 428),
  hc1: p(360, 470),
  hc2: p(344, 496),
  hc3: p(318, 516),
  hc4: p(292, 536),
  hc5: p(268, 548),
  // bridge between homes and market
  br_n: p(278, 556),
  br_s: p(278, 604),
  // market (north entrance from the bridge, east entrance from the plaza road)
  mk_nw: p(279, 640),
  mk_nw2: p(282, 690),
  mk_n1: p(310, 698),
  mk_n2: p(400, 698),
  mk_n3: p(470, 703),
  market: p(478, 738),
  mk_e1: p(528, 705),
  mk_e2: p(598, 703),
  mk_e3: p(650, 710),
  mk_e4: p(730, 712),
  // gate bridge + road to the market
  gate: p(82, 818),
  g1: p(140, 816),
  g2: p(205, 806),
  g3: p(248, 794),
  g4: p(262, 775),
  g5: p(330, 777),
  g6: p(410, 779),
  g7: p(455, 774),
  // left cluster of homes (dirt path)
  hl0: p(82, 414),
  hl1: p(106, 436),
  hl2: p(122, 466),
  hl3: p(127, 506),
  hl4: p(138, 540),
  hl5: p(190, 551),
  hl6: p(240, 550),
  hl7: p(110, 560),
  hm1: p(442, 528),
  hm2: p(372, 546),
  // door slots 0..8 (homeSlot)
  home0: p(78, 404),
  home1: p(97, 448),
  home2: p(30, 563),
  home3: p(66, 563),
  home4: p(243, 512),
  home5: p(293, 509),
  home6: p(410, 554),
  home7: p(452, 500),
  home8: p(322, 524)
};

export const EDGES: [string, string][] = [
  // hall / crossroads / plaza
  ["hall", "cn"],
  ["cn", "cw1"],
  ["cw1", "cw2"],
  ["cn", "ce1"],
  ["ce1", "ce2"],
  ["cn", "pn_in"],
  ["pn_in", "pN"],
  ["pN", "pNE"],
  ["pNE", "pE"],
  ["pE", "pSE"],
  ["pSE", "pS"],
  ["pS", "pSW"],
  ["pSW", "pW"],
  ["pW", "pNW"],
  ["pNW", "pN"],
  ["pE", "e_pl"],
  ["e_pl", "e_mid"],
  ["ce2", "e_mid"],
  ["e_mid", "e_s"],
  ["e_s", "s_e2"],
  ["s_e2", "e_s2"],
  ["e_s2", "e_s3"],
  ["e_s3", "e_s4"],
  ["s_e2", "s_e1"],
  ["s_e1", "ps2"],
  ["pS", "ps1"],
  ["ps1", "ps2"],
  ["ps2", "sj"],
  ["sj", "bd0"],
  ["bd0", "board"],
  // workshop
  ["e_s", "ws_a"],
  ["ws_a", "ws_b"],
  ["ws_b", "ws_gap"],
  ["ws_gap", "ws_in"],
  ["ws_in", "workshop"],
  // mediation
  ["e_s4", "md_a"],
  ["md_a", "md_b"],
  ["md_b", "md_c"],
  ["md_c", "md_d"],
  ["md_d", "mediation"],
  // outskirts
  ["ce2", "pk0"],
  ["pk0", "pk1"],
  ["pk1", "pk2"],
  ["pk2", "pk3"],
  ["pk3", "pk4"],
  ["pk4", "pk5"],
  ["pk5", "pk6"],
  ["pk6", "pk7"],
  ["pk7", "pk8"],
  ["pk8", "pk9"],
  ["pk9", "pk10"],
  ["pk10", "pk11"],
  ["pk11", "pk12"],
  ["pk12", "pk13"],
  ["pk13", "pk14"],
  ["pk14", "outskirts"],
  // archive + homes
  ["archive", "ar_a"],
  ["ar_a", "ar_b"],
  ["ar_b", "ar_c"],
  ["ar_c", "ar_d"],
  ["ar_d", "cw2"],
  ["ar_a", "ar_e"],
  ["ar_e", "hc0"],
  ["hc0", "hc1"],
  ["hc1", "hc2"],
  ["hc2", "hc3"],
  ["hc3", "hc4"],
  ["hc4", "hc5"],
  ["hc5", "br_n"],
  ["br_n", "br_s"],
  ["br_s", "mk_nw"],
  ["mk_nw", "mk_nw2"],
  ["mk_nw2", "mk_n1"],
  ["mk_n1", "mk_n2"],
  ["mk_n2", "mk_n3"],
  ["mk_n3", "market"],
  ["market", "mk_e1"],
  ["mk_n3", "mk_e1"],
  ["mk_e1", "mk_e2"],
  ["mk_e2", "mk_e3"],
  ["mk_e3", "mk_e4"],
  ["mk_e4", "sj"],
  // gate
  ["gate", "g1"],
  ["g1", "g2"],
  ["g2", "g3"],
  ["g3", "g4"],
  ["g4", "g5"],
  ["g5", "g6"],
  ["g6", "g7"],
  ["g7", "market"],
  // homes, left cluster
  ["home0", "hl0"],
  ["hl0", "hl1"],
  ["home1", "hl1"],
  ["hl1", "hl2"],
  ["hl2", "hl3"],
  ["hl3", "hl4"],
  ["hl4", "hl7"],
  ["hl7", "home3"],
  ["home3", "home2"],
  ["hl4", "hl5"],
  ["hl5", "hl6"],
  ["hl6", "hc5"],
  ["home4", "hl6"],
  ["home5", "hc4"],
  ["home8", "hc3"],
  ["hc3", "hm2"],
  ["hm2", "home6"],
  ["home6", "hm1"],
  ["hm1", "home7"]
];

// ───────────────────────────── locations ─────────────────────────────

export const LOCATIONS: Record<LocationId, LocationDef> = {
  archive: {
    id: "archive",
    label: "档案馆",
    node: "archive",
    anchor: NODES.archive,
    areas: [r(335, 252, 62, 98)],
    slots: [p(350, 264), p(382, 268), p(365, 292), p(346, 318), p(386, 314), p(365, 338), p(350, 298), p(384, 292)]
  },
  hall: {
    id: "hall",
    label: "议事厅",
    node: "hall",
    anchor: NODES.hall,
    areas: [r(770, 262, 76, 52)],
    slots: [p(790, 274), p(822, 274), p(805, 292), p(782, 300), p(830, 300), p(805, 308)]
  },
  plaza: {
    id: "plaza",
    label: "广场",
    node: "pS",
    anchor: NODES.pS,
    areas: [r(736, 534, 138, 42), r(706, 447, 40, 86), r(862, 447, 40, 86)],
    slots: [p(803, 553), p(768, 557), p(838, 557), p(724, 480), p(724, 515), p(884, 480), p(884, 515), p(745, 545), p(862, 545)]
  },
  workshop: {
    id: "workshop",
    label: "工坊",
    node: "workshop",
    anchor: NODES.workshop,
    areas: [r(1218, 480, 104, 54)],
    slots: [p(1248, 497), p(1286, 492), p(1230, 516), p(1302, 514), p(1266, 525), p(1238, 484), p(1308, 484)]
  },
  market: {
    id: "market",
    label: "市集",
    node: "market",
    anchor: NODES.market,
    areas: [r(442, 696, 86, 74)],
    slots: [p(478, 738), p(505, 726), p(460, 714), p(502, 754), p(456, 756), p(522, 706)]
  },
  board: {
    id: "board",
    label: "公告栏",
    node: "board",
    anchor: NODES.board,
    areas: [r(786, 780, 48, 66)],
    slots: [p(808, 812), p(796, 792), p(822, 794), p(797, 832), p(820, 832), p(808, 846)]
  },
  mediation: {
    id: "mediation",
    label: "调解所",
    node: "mediation",
    anchor: NODES.mediation,
    areas: [r(1200, 770, 72, 46), r(1140, 780, 55, 70), r(1280, 780, 52, 70)],
    slots: [p(1235, 772), p(1214, 792), p(1256, 792), p(1235, 810), p(1166, 800), p(1166, 832), p(1306, 800), p(1306, 832)]
  },
  outskirts: {
    id: "outskirts",
    label: "城邦外围",
    node: "outskirts",
    anchor: NODES.outskirts,
    areas: [r(1325, 216, 125, 30), r(1385, 248, 57, 82)],
    slots: [p(1346, 226), p(1376, 232), p(1406, 226), p(1432, 232), p(1396, 262), p(1420, 290), p(1400, 312), p(1426, 262)]
  },
  gate: {
    id: "gate",
    label: "城门",
    node: "gate",
    anchor: NODES.gate,
    areas: [r(60, 806, 46, 26)],
    slots: [p(82, 818), p(68, 822), p(96, 816), p(82, 808)]
  },
  home: {
    id: "home",
    label: "住宅区",
    node: "hc3",
    anchor: NODES.hc3,
    areas: [r(300, 505, 44, 26)],
    slots: [p(322, 524)]
  }
};

export const HOME_SLOT_COUNT = 9;

export function homeNode(slot: number): string {
  const s = ((Math.floor(slot) % HOME_SLOT_COUNT) + HOME_SLOT_COUNT) % HOME_SLOT_COUNT;
  return `home${s}`;
}

/** door of residence `slot` (0..8) */
export function homeDoor(slot: number): Pt {
  return NODES[homeNode(slot)];
}

/** graph node for a location (home resolves to the resident's own door) */
export function locationNode(loc: LocationId, homeSlot = 0): string {
  return loc === "home" ? homeNode(homeSlot) : LOCATIONS[loc].node;
}

/** the walkable rects of a location; homes get a small yard around the door */
export function areasOf(loc: LocationId, homeSlot = 0): Rect[] {
  if (loc === "home") {
    const d = homeDoor(homeSlot);
    return [r(d.x - 16, d.y - 6, 32, 12)];
  }
  return LOCATIONS[loc].areas;
}

export function slotsOf(loc: LocationId, homeSlot = 0): Pt[] {
  if (loc === "home") return [homeDoor(homeSlot)];
  return LOCATIONS[loc].slots;
}

export function anchorOf(loc: LocationId, homeSlot = 0): Pt {
  return loc === "home" ? homeDoor(homeSlot) : LOCATIONS[loc].anchor;
}

export function inRect(pt: Pt, rect: Rect): boolean {
  return pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
}

export function inAreas(loc: LocationId, pt: Pt, homeSlot = 0): boolean {
  return areasOf(loc, homeSlot).some((a) => inRect(pt, a));
}

/** nearest point inside the location's areas */
export function clampToAreas(loc: LocationId, pt: Pt, homeSlot = 0): Pt {
  const areas = areasOf(loc, homeSlot);
  if (areas.some((a) => inRect(pt, a))) return pt;
  let best = areas[0];
  let bd = Infinity;
  for (const a of areas) {
    const cx = Math.max(a.x, Math.min(a.x + a.w, pt.x));
    const cy = Math.max(a.y, Math.min(a.y + a.h, pt.y));
    const d = (cx - pt.x) ** 2 + (cy - pt.y) ** 2;
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return {
    x: Math.max(best.x, Math.min(best.x + best.w, pt.x)),
    y: Math.max(best.y, Math.min(best.y + best.h, pt.y))
  };
}

// ───────────────────────────── path finding ─────────────────────────────

const ADJ: Record<string, { to: string; d: number }[]> = {};
for (const key of Object.keys(NODES)) ADJ[key] = [];
for (const [a, b] of EDGES) {
  const d = dist(NODES[a], NODES[b]);
  ADJ[a].push({ to: b, d });
  ADJ[b].push({ to: a, d });
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const pathCache = new Map<string, string[] | null>();

/** A* over the road graph; returns the node names, or null when unreachable */
export function findNodePath(from: string, to: string): string[] | null {
  if (from === to) return [from];
  const key = `${from}>${to}`;
  const hit = pathCache.get(key);
  if (hit !== undefined) return hit;
  if (!NODES[from] || !NODES[to]) return null;
  const goal = NODES[to];
  const g = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([from]);
  const closed = new Set<string>();
  let result: string[] | null = null;
  while (open.size > 0) {
    let cur = "";
    let best = Infinity;
    for (const n of open) {
      const f = (g.get(n) ?? Infinity) + dist(NODES[n], goal);
      if (f < best) {
        best = f;
        cur = n;
      }
    }
    if (cur === to) {
      const out = [cur];
      while (prev.has(out[0])) out.unshift(prev.get(out[0]) as string);
      result = out;
      break;
    }
    open.delete(cur);
    closed.add(cur);
    for (const e of ADJ[cur]) {
      if (closed.has(e.to)) continue;
      const ng = (g.get(cur) ?? 0) + e.d;
      if (ng < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, ng);
        prev.set(e.to, cur);
        open.add(e.to);
      }
    }
  }
  pathCache.set(key, result);
  return result;
}

export function nodesToPoints(nodes: string[]): Pt[] {
  return nodes.map((n) => ({ x: NODES[n].x, y: NODES[n].y }));
}

/** road path between two locations (anchors included) */
export function pathBetween(from: LocationId, to: LocationId, fromHomeSlot = 0, toHomeSlot = 0): Pt[] {
  const a = locationNode(from, fromHomeSlot);
  const b = locationNode(to, toHomeSlot);
  const nodes = findNodePath(a, b);
  if (!nodes) return [NODES[a], NODES[b]];
  return nodesToPoints(nodes);
}

/**
 * Path from an arbitrary point (an agent that is mid-way somewhere) to a
 * location: join the road graph through whichever of the 4 nearest nodes gives
 * the shortest overall walk.
 */
export function pathFromPoint(from: Pt, to: LocationId, toHomeSlot = 0): Pt[] {
  const target = locationNode(to, toHomeSlot);
  const near = Object.keys(NODES)
    .map((n) => ({ n, d: dist(from, NODES[n]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  let best: Pt[] | null = null;
  let bestLen = Infinity;
  for (const c of near) {
    const nodes = findNodePath(c.n, target);
    if (!nodes) continue;
    const pts = [from, ...nodesToPoints(nodes)];
    const len = pathLength(pts);
    if (len < bestLen) {
      bestLen = len;
      best = pts;
    }
  }
  return best ?? [from, NODES[target]];
}

export function pathLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

export interface PathSample {
  x: number;
  y: number;
  /** unit direction of travel at this point */
  dx: number;
  dy: number;
}

/** point `d` pixels along a polyline (clamped to its ends) */
export function pointAlong(pts: Pt[], d: number): PathSample {
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, dx: 0, dy: 0 };
  let remain = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (remain <= seg || i === pts.length - 1) {
      const t = seg === 0 ? 1 : Math.min(1, remain / seg);
      const dx = seg === 0 ? 0 : (pts[i].x - pts[i - 1].x) / seg;
      const dy = seg === 0 ? 0 : (pts[i].y - pts[i - 1].y) / seg;
      return {
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
        dx,
        dy
      };
    }
    remain -= seg;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, dx: 0, dy: 0 };
}

/** dev helper: every node reachable from every location? (returns unreachable node names) */
export function unreachableNodes(): string[] {
  const start = "market";
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const e of ADJ[cur]) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return Object.keys(NODES).filter((n) => !seen.has(n));
}
