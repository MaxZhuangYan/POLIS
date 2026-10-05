// Grid path finding for the town: A* with a binary-heap open set, 8-neighbour moves without corner cutting,
// octile heuristic, per-tile movement costs (residents prefer roads), cost-aware path smoothing
// (line-of-sight "string pulling") and a small LRU cache.
//
// Pure TypeScript: no Phaser, no DOM, no imports — the server could reuse it as is, and
// scripts/test-pathfinding.mjs runs it directly under node.

export interface PathGrid {
  width: number;
  height: number;
  /** 1 = blocked */
  blocked: Uint8Array;
  /** movement cost of standing on / entering a tile, >= 1 (roads 1, bare ground 2, grass 2.5, decoration 4) */
  cost: Float32Array;
}

export interface TilePoint {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;

export const inBounds = (g: PathGrid, x: number, y: number): boolean => x >= 0 && y >= 0 && x < g.width && y < g.height;
export const isBlocked = (g: PathGrid, x: number, y: number): boolean => !inBounds(g, x, y) || g.blocked[y * g.width + x] === 1;
export const tileCost = (g: PathGrid, x: number, y: number): number => g.cost[y * g.width + x];

/** smallest cost on the grid: the scale for the admissible heuristic */
export function minCost(g: PathGrid): number {
  let m = Infinity;
  for (let i = 0; i < g.cost.length; i++) if (!g.blocked[i] && g.cost[i] < m) m = g.cost[i];
  return Number.isFinite(m) ? m : 1;
}

/** nearest walkable tile to p (breadth-first rings), or null */
export function nearestWalkable(g: PathGrid, p: TilePoint, maxRadius = 12): TilePoint | null {
  const px = Math.round(p.x);
  const py = Math.round(p.y);
  if (!isBlocked(g, px, py)) return { x: px, y: py };
  for (let r = 1; r <= maxRadius; r++) {
    let best: TilePoint | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = px + dx;
        const y = py + dy;
        if (isBlocked(g, x, y)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// ───────────────────────────── binary heap ─────────────────────────────

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const ids = this.ids;
    const keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop() as number;
    const lastKey = keys.pop() as number;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}

// ───────────────────────────── A* ─────────────────────────────

export interface FindOptions {
  /** allow diagonal steps (default true). Diagonals never cut a blocked corner. */
  diagonal?: boolean;
  /** safety cap on expanded nodes */
  maxNodes?: number;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2]
];

/**
 * A* from `from` to `to` (tile coordinates, both inclusive in the result). A blocked start / goal is snapped to the
 * nearest walkable tile. Returns null when no route exists.
 */
export function findPath(g: PathGrid, from: TilePoint, to: TilePoint, opts: FindOptions = {}): TilePoint[] | null {
  const start = nearestWalkable(g, from);
  const goal = nearestWalkable(g, to);
  if (!start || !goal) return null;
  const W = g.width;
  const sIdx = start.y * W + start.x;
  const gIdx = goal.y * W + goal.x;
  if (sIdx === gIdx) return [start];

  const diagonal = opts.diagonal !== false;
  const maxNodes = opts.maxNodes ?? g.width * g.height * 2;
  const n = g.width * g.height;
  const gScore = new Float32Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open = new MinHeap();
  const base = minCost(g);
  // octile distance, scaled by the cheapest tile so it never overestimates
  const h = (x: number, y: number): number => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return base * (dx + dy + (SQRT2 - 2) * Math.min(dx, dy));
  };

  gScore[sIdx] = 0;
  open.push(sIdx, h(start.x, start.y));
  let expanded = 0;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === gIdx) {
      const out: TilePoint[] = [];
      for (let i = cur; i !== -1; i = parent[i]) out.push({ x: i % W, y: (i / W) | 0 });
      return out.reverse();
    }
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = cur % W;
    const cy = (cur / W) | 0;
    const cc = g.cost[cur];
    for (let k = 0; k < (diagonal ? 8 : 4); k++) {
      const [dx, dy, len] = NEIGHBOURS[k];
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlocked(g, nx, ny)) continue;
      // no corner cutting: both orthogonal neighbours of a diagonal step must be free
      if (dx !== 0 && dy !== 0 && (isBlocked(g, cx + dx, cy) || isBlocked(g, cx, cy + dy))) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = gScore[cur] + len * 0.5 * (cc + g.cost[ni]);
      if (ng < gScore[ni]) {
        gScore[ni] = ng;
        parent[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  return null;
}

// ───────────────────────────── smoothing ─────────────────────────────

/**
 * Walk the segment a→b (tile centres) and call `visit` with the tile under every sample (step 0.25 tile).
 * `lateral` also samples two parallel lines to each side so a body of that half-width keeps clear of blocked tiles.
 */
function eachSample(a: TilePoint, b: TilePoint, lateral: number, visit: (tx: number, ty: number, step: number) => boolean): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return visit(a.x, a.y, 0);
  const steps = Math.max(1, Math.ceil(len / 0.25));
  const nx = -dy / len;
  const ny = dx / len;
  const stepLen = len / steps;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    if (!visit(Math.floor(x + 0.5), Math.floor(y + 0.5), i === 0 || i === steps ? stepLen / 2 : stepLen)) return false;
    if (lateral > 0) {
      for (const s of [-lateral, lateral]) {
        if (!visit(Math.floor(x + nx * s + 0.5), Math.floor(y + ny * s + 0.5), 0)) return false;
      }
    }
  }
  return true;
}

/** true when the straight segment between two tile centres crosses no blocked tile (with `clearance` tiles of body) */
export function lineOfSight(g: PathGrid, a: TilePoint, b: TilePoint, clearance = 0.3): boolean {
  return eachSample(a, b, clearance, (tx, ty) => !isBlocked(g, tx, ty));
}

/** cost of walking the straight segment a→b */
export function segmentCost(g: PathGrid, a: TilePoint, b: TilePoint): number {
  let total = 0;
  eachSample(a, b, 0, (tx, ty, step) => {
    total += step * (isBlocked(g, tx, ty) ? 99 : tileCost(g, tx, ty));
    return true;
  });
  return total;
}

/** cost of an explicit tile path (same metric as the A* edges) */
export function pathCost(g: PathGrid, path: ReadonlyArray<TilePoint>): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = a.x !== b.x && a.y !== b.y ? SQRT2 : 1;
    total += len * 0.5 * (tileCost(g, a.x, a.y) + tileCost(g, b.x, b.y));
  }
  return total;
}

/**
 * String pulling: drop intermediate waypoints whenever the straight line between two waypoints is clear AND not
 * (much) more expensive than the A* path it replaces — so smoothing straightens corners but never lets a resident
 * cut across grass to avoid the road.
 */
export function smoothPath(g: PathGrid, path: ReadonlyArray<TilePoint>, tolerance = 1.04): TilePoint[] {
  if (path.length <= 2) return path.map((p) => ({ ...p }));
  const prefix: number[] = [0];
  for (let i = 1; i < path.length; i++) prefix.push(prefix[i - 1] + pathCost(g, [path[i - 1], path[i]]));
  const out: TilePoint[] = [{ ...path[0] }];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1) {
      if (lineOfSight(g, path[i], path[j]) && segmentCost(g, path[i], path[j]) <= (prefix[j] - prefix[i]) * tolerance + 1e-6) break;
      j--;
    }
    out.push({ ...path[j] });
    i = j;
  }
  return out;
}

// ───────────────────────────── cache ─────────────────────────────

/** A* + smoothing behind a small LRU cache (the town grid is static, so paths are reusable) */
export class PathFinder {
  readonly grid: PathGrid;
  private readonly capacity: number;
  private cache = new Map<string, TilePoint[] | null>();

  // (no constructor parameter properties: node's type-stripping, used by scripts/test-pathfinding.mjs, cannot erase them)
  constructor(grid: PathGrid, capacity = 256) {
    this.grid = grid;
    this.capacity = capacity;
  }

  find(from: TilePoint, to: TilePoint, opts: { smooth?: boolean } = {}): TilePoint[] | null {
    const smooth = opts.smooth !== false;
    const key = `${from.x},${from.y}>${to.x},${to.y}|${smooth ? 1 : 0}`;
    if (this.cache.has(key)) {
      const hit = this.cache.get(key) ?? null;
      this.cache.delete(key); // refresh recency
      this.cache.set(key, hit);
      return hit ? hit.map((p) => ({ ...p })) : null;
    }
    let path = findPath(this.grid, from, to);
    if (path && smooth) path = smoothPath(this.grid, path);
    this.cache.set(key, path);
    if (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return path ? path.map((p) => ({ ...p })) : null;
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

/** Euclidean length of a tile polyline, in tiles */
export function polylineLength(path: ReadonlyArray<TilePoint>): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return len;
}
