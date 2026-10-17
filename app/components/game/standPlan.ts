// Where each resident stands at a location. Pure data in, pure data out (no Phaser): the scene feeds it who is at /
// heading for a location and what each is doing, and gets back one distinct tile per resident.
//
//   * no two residents ever share a tile (when the stand slots run out the nearest free walkable tile is used);
//   * collaborators stand side by side (the lexicographically smaller id leads and keeps its slot, the partner takes the
//     tile next to it); residents who are socializing at the same place gather in small groups of up to three;
//   * the plan is sticky: a resident that already has a valid tile keeps it, so a new snapshot never shuffles people.
//
// Only erasable TypeScript here (no enums / parameter properties), so `node --experimental-strip-types` can run it
// for the logic checks in scripts/.

export interface TilePt {
  x: number;
  y: number;
}

export interface PlanPerson {
  id: string;
  isPlayer: boolean;
  activity: string;
  partnerId: string | null;
  /** the tile this resident stood on in the previous plan for this same location (null: none / elsewhere) */
  prev: TilePt | null;
}

export interface PlanLocation {
  /** preferred stand points, spread out */
  slots: TilePt[];
  /** every walkable tile of the location */
  tiles: TilePt[];
  walkable: (x: number, y: number) => boolean;
  /** optional: a tile with a counter / forge / wall next to it, where someone at work belongs */
  bench?: (x: number, y: number) => boolean;
}

export interface StandSpot {
  tile: TilePt;
  /** the resident this one stands with and faces (collaborator / group lead); null when alone */
  mate: string | null;
  lead: boolean;
}

/** group size cap for people chatting together */
export const SOCIAL_GROUP = 3;

// beside first (a row reads as people standing together), then two tiles out, then the diagonals, then above / below
const NEIGHBOURS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [2, 0],
  [-2, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [0, 1],
  [0, -1]
];

const key = (t: TilePt): number => t.y * 4096 + t.x;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** groups of resident ids, the lead first: collaborating pairs, then chatting groups, then everybody else alone */
export function groupPeople(people: PlanPerson[]): string[][] {
  const sorted = [...people].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byId = new Map(sorted.map((p) => [p.id, p]));
  const used = new Set<string>();
  const groups: string[][] = [];
  for (const p of sorted) {
    if (used.has(p.id) || p.activity !== "collaborating" || !p.partnerId) continue;
    const q = byId.get(p.partnerId);
    if (!q || used.has(q.id) || q.activity !== "collaborating" || q.partnerId !== p.id) continue;
    groups.push([p.id, q.id].sort());
    used.add(p.id);
    used.add(q.id);
  }
  // chatting residents split into evenly sized groups of at most SOCIAL_GROUP (4 people: 2 + 2, never 3 + 1)
  const chatting = sorted.filter((p) => !used.has(p.id) && p.activity === "socializing");
  const nGroups = Math.ceil(chatting.length / SOCIAL_GROUP);
  for (let g = 0, at = 0; g < nGroups; g++) {
    const size = Math.floor(chatting.length / nGroups) + (g < chatting.length % nGroups ? 1 : 0);
    const chunk = chatting.slice(at, at + size).map((p) => p.id);
    at += size;
    groups.push(chunk);
    for (const id of chunk) used.add(id);
  }
  for (const p of sorted) if (!used.has(p.id)) groups.push([p.id]);
  // the guardian's Agent decides first (so it always gets the best tile), then by lead id
  const hasPlayer = (g: string[]) => g.some((id) => byId.get(id)?.isPlayer);
  return groups.sort((a, b) => Number(hasPlayer(b)) - Number(hasPlayer(a)) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function planStands(people: PlanPerson[], loc: PlanLocation): Map<string, StandSpot> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = new Map<string, StandSpot>();
  const taken = new Set<number>();
  const takenPts: TilePt[] = [];
  const claim = (t: TilePt) => {
    taken.add(key(t));
    takenPts.push(t);
  };
  const free = (t: TilePt) => !taken.has(key(t)) && loc.walkable(t.x, t.y);
  const groups = groupPeople(people);

  const freeNeighbours = (t: TilePt, n: number, extraTaken: Set<number> = new Set()): TilePt[] => {
    const res: TilePt[] = [];
    for (const [dx, dy] of NEIGHBOURS) {
      const c = { x: t.x + dx, y: t.y + dy };
      if (free(c) && !extraTaken.has(key(c))) res.push(c);
      if (res.length >= n) break;
    }
    return res;
  };
  const adjacent = (a: TilePt, b: TilePt) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 2;
  const setGroup = (ids: string[], tiles: TilePt[]) => {
    ids.forEach((id, i) => {
      out.set(id, { tile: tiles[i], mate: ids.length > 1 ? (i === 0 ? ids[1] : ids[0]) : null, lead: i === 0 });
      claim(tiles[i]);
    });
  };

  // pass 1: groups whose people already stand on valid, free, still-adjacent tiles keep them
  const pending: string[][] = [];
  for (const g of groups) {
    const prevs = g.map((id) => byId.get(id)?.prev ?? null);
    const ok =
      prevs.every((p) => p && free(p)) &&
      new Set(prevs.map((p) => key(p as TilePt))).size === g.length &&
      prevs.every((p, i) => i === 0 || adjacent(prevs[0] as TilePt, p as TilePt));
    if (ok) setGroup(g, prevs as TilePt[]);
    else pending.push(g);
  }

  // pass 2: everybody else
  const minDist = (t: TilePt): number => {
    let d = Infinity;
    for (const o of takenPts) d = Math.min(d, Math.hypot(o.x - t.x, o.y - t.y));
    return d;
  };
  for (const g of pending) {
    const need = g.length - 1;
    const seed = hash(g[0]);
    const slots = loc.slots.length > 0 ? loc.slots : loc.tiles;
    let best: TilePt | null = null;
    let bestScore = -1;
    const consider = (pool: TilePt[], requireRoom: boolean) => {
      for (let k = 0; k < pool.length; k++) {
        const t = pool[(seed + k) % pool.length];
        if (!free(t)) continue;
        if (requireRoom && freeNeighbours(t, need).length < need) continue;
        const score = takenPts.length === 0 ? 1 : minDist(t);
        if (score > bestScore + 0.5) {
          bestScore = score;
          best = t;
        }
      }
    };
    // someone who already stands somewhere valid stays there (a partner who walks up joins THEM, nobody jumps away)
    const prevLead = byId.get(g[0])?.prev ?? null;
    if (prevLead && free(prevLead) && freeNeighbours(prevLead, need).length >= need) best = prevLead;
    // people at work (alone or as a pair) belong at a bench: a counter, a forge, a shelf
    const working = byId.get(g[0])?.activity === "working" || byId.get(g[0])?.activity === "collaborating";
    if (!best && working && loc.bench) {
      const bench = loc.bench;
      consider(loc.tiles.filter((t) => bench(t.x, t.y)), true);
    }
    if (!best) consider(slots, true);
    if (!best) consider(loc.tiles, true); // slots are used up: any free tile that has room
    if (!best) consider(slots, false);
    if (!best) consider(loc.tiles, false);
    const lead: TilePt = best ?? slots[seed % Math.max(1, slots.length)] ?? { x: 1, y: 1 }; // last resort: stack (a map with no room at all)
    const tiles = [lead];
    const claimedNow = new Set<number>([key(lead)]);
    for (let i = 1; i < g.length; i++) {
      // a member keeps its own tile when it is already next to the lead, else takes a free tile beside the lead
      const mine = byId.get(g[i])?.prev ?? null;
      let t: TilePt | null = mine && free(mine) && !claimedNow.has(key(mine)) && adjacent(lead, mine) ? mine : null;
      if (!t) t = freeNeighbours(lead, need, claimedNow).find((c) => !claimedNow.has(key(c))) ?? lead;
      claimedNow.add(key(t));
      tiles.push(t);
    }
    setGroup(g, tiles);
  }
  return out;
}
