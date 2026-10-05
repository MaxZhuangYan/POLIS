// Turns the Tiled map (public/assets/town/polis-town.tmj, raw JSON — e.g. `scene.cache.tilemap.get(key).data`)
// into a TownModel: the data-driven geography of the town.
//
//   locations     id, label, owner npc, stand-area rects, door (entry) tile, stand slots
//   homeDoors     entry tile of every residence, by AgentView.homeSlot (0..8)
//   gate          entry tile of the town gate
//   interactables click / hover rectangles over buildings and landmarks
//   grid          walkability + per-tile movement cost for pathfinding.ts
//
// Layer / object conventions are documented at the top of scripts/build-town-map.mjs.
// No Phaser import: the model builds on the server / under node too (scripts/test-pathfinding.mjs).

import type { LocationId } from "@/lib/types";
import type { PathGrid, TilePoint } from "./pathfinding";

export const TILE_SIZE = 16;

export const LOCATION_IDS: LocationId[] = ["archive", "market", "plaza", "workshop", "outskirts", "mediation", "hall", "board", "gate", "home"];
export const HOME_SLOTS = 9;

// ───────────────────────────── raw Tiled JSON (the subset we read) ─────────────────────────────

interface TiledProperty {
  name: string;
  type?: string;
  value: string | number | boolean;
}
interface TiledObject {
  id: number;
  name: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: TiledProperty[];
}
interface TiledLayer {
  name: string;
  type: "tilelayer" | "objectgroup" | string;
  data?: number[];
  objects?: TiledObject[];
}
interface TiledTileset {
  firstgid: number;
  tiles?: { id: number; properties?: TiledProperty[] }[];
}
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

// ───────────────────────────── model ─────────────────────────────

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TownLocation {
  id: LocationId;
  label: string;
  /** npc id that "owns" the place ("" = public) */
  owner: string;
  /** walkable stand areas, in tiles */
  areas: TileRect[];
  /** entry tile (walkable, in front of the door); null for `home` (see homeDoors) */
  door: TilePoint | null;
  /** stand points inside the areas (door first), spread out, every one reachable from the door */
  slots: TilePoint[];
  /** every walkable, reachable tile of the areas (micro-wander targets) */
  walkTiles: TilePoint[];
  /** world px centre of the location (camera / labels) */
  center: { x: number; y: number };
}

export interface HomeDoor {
  slot: number;
  tile: TilePoint;
}

export interface Interactable {
  id: string;
  location: LocationId;
  slot?: number;
  /** world px */
  rect: PxRect;
}

export interface TownModel {
  width: number;
  height: number;
  tileSize: number;
  pxWidth: number;
  pxHeight: number;
  locations: Record<LocationId, TownLocation>;
  homeDoors: HomeDoor[];
  gate: TilePoint;
  interactables: Interactable[];
  grid: PathGrid;
  /** 1 where an `above` tile hides residents (roofs, canopies, torii beams) */
  covered: Uint8Array;
}

const prop = (o: { properties?: TiledProperty[] }, name: string): string | number | boolean | undefined => o.properties?.find((p) => p.name === name)?.value;
const objType = (o: TiledObject): string => o.type || o.class || "";
const FLAG_MASK = 0x1fffffff;

const tileOf = (o: TiledObject): TilePoint => ({ x: Math.floor(o.x / TILE_SIZE), y: Math.floor(o.y / TILE_SIZE) });

/** Build the model from the raw map. Throws on a malformed map (missing layer, missing location, ...). */
export function buildTownModel(map: TiledMap): TownModel {
  const W = map.width;
  const H = map.height;
  const layer = (name: string): TiledLayer => {
    const l = map.layers.find((x) => x.name === name);
    if (!l) throw new Error(`town map: missing layer "${name}"`);
    return l;
  };
  const data = (name: string): number[] => layer(name).data ?? [];

  // ── tile properties (cost) ──
  const ts = map.tilesets[0];
  const costOf = new Map<number, number>();
  for (const t of ts.tiles ?? []) {
    const c = t.properties?.find((p) => p.name === "cost")?.value;
    if (typeof c === "number") costOf.set(ts.firstgid + t.id, c);
  }
  const lookup = (gid: number): number | undefined => (gid ? costOf.get(gid & FLAG_MASK) : undefined);

  const ground = data("ground");
  const paths = data("paths");
  const deco = data("deco");
  const collision = data("collision");
  const above = data("above");

  const blocked = new Uint8Array(W * H);
  const cost = new Float32Array(W * H);
  const covered = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    blocked[i] = collision[i] ? 1 : 0;
    covered[i] = above[i] ? 1 : 0;
    // cost: decoration first, then road paving, then the ground underneath
    cost[i] = Math.max(1, lookup(deco[i]) ?? lookup(paths[i]) ?? lookup(ground[i]) ?? (paths[i] ? 1 : 2.5));
  }
  const grid: PathGrid = { width: W, height: H, blocked, cost };

  // ── objects ──
  const objs = (map.layers.find((l) => l.type === "objectgroup" && l.name === "locations")?.objects ?? []) as TiledObject[];
  const areas = new Map<LocationId, { label: string; owner: string; rects: TileRect[] }>();
  const doors = new Map<LocationId, TilePoint>();
  const homeDoors: HomeDoor[] = [];
  const interactables: Interactable[] = [];
  for (const o of objs) {
    const t = objType(o);
    if (t === "location") {
      const id = o.name as LocationId;
      const entry = areas.get(id) ?? { label: String(prop(o, "label") ?? id), owner: String(prop(o, "owner") ?? ""), rects: [] };
      const x0 = Math.floor(o.x / TILE_SIZE);
      const y0 = Math.floor(o.y / TILE_SIZE);
      entry.rects.push({ x: x0, y: y0, w: Math.max(1, Math.round(o.width / TILE_SIZE)), h: Math.max(1, Math.round(o.height / TILE_SIZE)) });
      areas.set(id, entry);
    } else if (t === "door") {
      doors.set(String(prop(o, "location")) as LocationId, tileOf(o));
    } else if (t === "home_door") {
      homeDoors.push({ slot: Number(prop(o, "slot")), tile: tileOf(o) });
    } else if (t === "interactable") {
      const slot = prop(o, "slot");
      interactables.push({
        id: o.name,
        location: String(prop(o, "location")) as LocationId,
        slot: typeof slot === "number" ? slot : undefined,
        rect: { x: o.x, y: o.y, w: o.width, h: o.height }
      });
    }
  }
  homeDoors.sort((a, b) => a.slot - b.slot);
  if (homeDoors.length !== HOME_SLOTS || homeDoors.some((d, i) => d.slot !== i)) throw new Error(`town map: expected home_door slots 0..${HOME_SLOTS - 1}`);

  // ── reachability from the gate ──
  const gate = doors.get("gate");
  if (!gate) throw new Error('town map: no door for "gate"');
  const reach = (from: TilePoint): Uint8Array => {
    const seen = new Uint8Array(W * H);
    const stack = [from.y * W + from.x];
    seen[stack[0]] = 1;
    while (stack.length) {
      const cur = stack.pop() as number;
      const cx = cur % W;
      const cy = (cur / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (!seen[ni] && !blocked[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    return seen;
  };
  const reachable = reach(gate);

  // ── locations ──
  const locations = {} as Record<LocationId, TownLocation>;
  for (const id of LOCATION_IDS) {
    const a = areas.get(id);
    if (!a) throw new Error(`town map: missing location "${id}"`);
    const door = id === "home" ? null : (doors.get(id) ?? null);
    if (id !== "home" && !door) throw new Error(`town map: location "${id}" has no door`);
    const walkTiles: TilePoint[] = [];
    for (const r of a.rects) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          if (!blocked[y * W + x] && reachable[y * W + x] && !covered[y * W + x]) walkTiles.push({ x, y });
        }
      }
    }
    const slots = id === "home" ? [] : pickSlots(walkTiles, door as TilePoint, 10);
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const r of a.rects) {
      sx += (r.x + r.w / 2) * r.w * r.h;
      sy += (r.y + r.h / 2) * r.w * r.h;
      n += r.w * r.h;
    }
    locations[id] = {
      id,
      label: a.label,
      owner: a.owner,
      areas: a.rects,
      door,
      slots,
      walkTiles,
      center: { x: (sx / n) * TILE_SIZE, y: (sy / n) * TILE_SIZE }
    };
  }

  return {
    width: W,
    height: H,
    tileSize: TILE_SIZE,
    pxWidth: W * TILE_SIZE,
    pxHeight: H * TILE_SIZE,
    locations,
    homeDoors,
    gate,
    interactables,
    grid,
    covered
  };
}

/** farthest-point sampling: the door first, then repeatedly the tile that is farthest from every chosen slot (min spacing 2) */
function pickSlots(tiles: TilePoint[], door: TilePoint, max: number): TilePoint[] {
  if (tiles.length === 0) return [door];
  const first = tiles.find((t) => t.x === door.x && t.y === door.y) ?? tiles.reduce((b, t) => (Math.hypot(t.x - door.x, t.y - door.y) < Math.hypot(b.x - door.x, b.y - door.y) ? t : b), tiles[0]);
  const chosen: TilePoint[] = [first];
  while (chosen.length < max) {
    let best: TilePoint | null = null;
    let bestD = 0;
    for (const t of tiles) {
      let d = Infinity;
      for (const c of chosen) d = Math.min(d, Math.hypot(t.x - c.x, t.y - c.y));
      // prefer tiles near the door when equally spread (stable, deterministic)
      const score = d - 0.001 * Math.hypot(t.x - door.x, t.y - door.y);
      if (d >= 2 && score > bestD) {
        bestD = score;
        best = t;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}

export interface LocationMeta {
  id: LocationId;
  label: string;
  owner: string;
}

/** just the label / owner of every location — what the React HUD needs to title a building card */
export function readLocationMeta(map: TiledMap): Partial<Record<LocationId, LocationMeta>> {
  const out: Partial<Record<LocationId, LocationMeta>> = {};
  for (const l of map.layers) {
    if (l.type !== "objectgroup") continue;
    for (const o of l.objects ?? []) {
      if (objType(o) !== "location") continue;
      const id = o.name as LocationId;
      if (!out[id]) out[id] = { id, label: String(prop(o, "label") ?? id), owner: String(prop(o, "owner") ?? "") };
    }
  }
  return out;
}

/** the interactable under a world-px point (smallest rect wins), or null */
export function interactableAt(model: TownModel, wx: number, wy: number): Interactable | null {
  let best: Interactable | null = null;
  let bestArea = Infinity;
  for (const it of model.interactables) {
    const r = it.rect;
    if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) {
      const a = r.w * r.h;
      if (a < bestArea) {
        bestArea = a;
        best = it;
      }
    }
  }
  return best;
}

/** tile centre in world px (feet line sits a little below the middle so sprites stand on the tile) */
export function tileToWorld(t: TilePoint): { x: number; y: number } {
  return { x: t.x * TILE_SIZE + TILE_SIZE / 2, y: t.y * TILE_SIZE + 14 };
}
export function worldToTile(x: number, y: number): TilePoint {
  return { x: Math.floor(x / TILE_SIZE), y: Math.floor((y - 6) / TILE_SIZE) };
}
