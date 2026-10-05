// Turns a Tiled map (a .tmj registered in maps.ts, e.g. public/assets/town/polis-town.tmj; raw JSON — e.g.
// `scene.cache.tilemap.get(key).data`) into a TownModel: the data-driven geography of the town.
//
//   locations     id, label, owner npc, stand-area rects, door (entry) tile, stand slots
//   homeDoors     entry tile of every residence, by AgentView.homeSlot (0..8)
//   gate          entry tile of the town gate
//   interactables click / hover rectangles over buildings and landmarks
//   grid          walkability + per-tile movement cost for pathfinding.ts
//
// Layer / object conventions are documented in doc/MAPS.md (and at the top of scripts/build-town-map.mjs).
// `npm run map:check` validates a map against exactly these rules.
// No Phaser import: the model builds on the server / under node too (scripts/test-pathfinding.mjs, scripts/map-check.mjs).

import type { LocationId } from "@/lib/types";
import type { PathGrid, TilePoint } from "./pathfinding";

export const TILE_SIZE = 16;

export const LOCATION_IDS: LocationId[] = ["archive", "market", "plaza", "workshop", "outskirts", "mediation", "hall", "board", "gate", "home"];
/** the nominal number of residences (AgentView.homeSlot is documented as 0..8); the shipped town has 9 */
export const HOME_SLOTS = 9;
/** what a map must provide at least: the player lives in slot 0 and the six seed NPCs in slots 1..6 (lib/content.ts).
 *  home_door slots must be contiguous from 0; the scene wraps a slot onto the available doors (slot % doors). */
export const MIN_HOME_SLOTS = 7;
/** tile layers every map needs (collision = what blocks, ground = what the town stands on, also the map-margin fill) */
export const REQUIRED_TILE_LAYERS = ["ground", "collision"] as const;
/** tile layers that are optional: a missing one counts as an empty layer */
export const OPTIONAL_TILE_LAYERS = ["paths", "water", "deco", "buildings", "above"] as const;
/** the Tiled object layer that holds location / door / home_door / interactable objects */
export const OBJECT_LAYER = "locations";
export const OBJECT_TYPES = ["location", "door", "home_door", "interactable"] as const;
/** Tiled flag bits (flip / rotate) live above this mask in a gid */
export const GID_MASK = 0x1fffffff;

// ───────────────────────────── raw Tiled JSON (the subset we read) ─────────────────────────────

export interface TiledProperty {
  name: string;
  type?: string;
  value: string | number | boolean;
}
export interface TiledObject {
  id: number;
  name: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  /** set on Tiled "tile objects" (an image placed on the map); their origin is the bottom-left corner */
  gid?: number;
  properties?: TiledProperty[];
}
export interface TiledLayer {
  name: string;
  type: "tilelayer" | "objectgroup" | "group" | "imagelayer" | string;
  width?: number;
  height?: number;
  offsetx?: number;
  offsety?: number;
  /** a plain number[] (Tile Layer Format: CSV). A string means base64 — not supported */
  data?: number[] | string;
  encoding?: string;
  compression?: string;
  /** infinite maps store chunks instead of data — not supported */
  chunks?: unknown[];
  objects?: TiledObject[];
  layers?: TiledLayer[];
}
export interface TiledTileset {
  firstgid: number;
  name?: string;
  /** external tileset (.tsx / .tsj): not supported, embed it (Tiled: Map → Embed Tilesets) */
  source?: string;
  /** image path, relative to the .tmj */
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  margin?: number;
  spacing?: number;
  columns?: number;
  tilecount?: number;
  /** per-tile data: `properties` (cost), or `image` for an "image collection" tileset (not supported) */
  tiles?: { id: number; image?: string; properties?: TiledProperty[] }[];
}
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  orientation?: string;
  infinite?: boolean;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

/** what the loader and the scene need to know about one embedded tileset */
export interface TilesetInfo {
  name: string;
  firstgid: number;
  tilewidth: number;
  tileheight: number;
  margin: number;
  spacing: number;
  columns: number;
  tilecount: number;
  /** image URL, resolved against the .tmj URL */
  imageUrl: string;
}

/** Resolve `rel` (as written in the .tmj) against the URL / path of the .tmj. Works for site paths and absolute URLs. */
export function resolveAssetUrl(baseUrl: string, rel: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(rel)) return rel;
  const u = new URL(rel, new URL(baseUrl, "http://polis.invalid"));
  return /^[a-z][a-z0-9+.-]*:/i.test(baseUrl) ? u.href : u.pathname + u.search;
}

/** The embedded tilesets of a map, ready for `load.image` / `addTilesetImage`. Throws on a tileset the game cannot use. */
export function readTilesets(map: TiledMap, tmjUrl = "/"): TilesetInfo[] {
  if (!map.tilesets?.length) throw new Error("map has no tileset");
  return map.tilesets.map((ts, i) => {
    const name = ts.name ?? `tileset${i}`;
    if (ts.source) throw new Error(`tileset "${name}" is external (${ts.source}); embed it in Tiled: Map → Embed Tilesets`);
    if (!ts.image) throw new Error(`tileset "${name}" has no image (image-collection tilesets are not supported)`);
    return {
      name,
      firstgid: ts.firstgid,
      tilewidth: ts.tilewidth ?? TILE_SIZE,
      tileheight: ts.tileheight ?? TILE_SIZE,
      margin: ts.margin ?? 0,
      spacing: ts.spacing ?? 0,
      columns: ts.columns ?? 0,
      tilecount: ts.tilecount ?? 0,
      imageUrl: resolveAssetUrl(tmjUrl, ts.image)
    };
  });
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

/** a custom property of a Tiled object / tile, by name */
export const tiledProp = (o: { properties?: TiledProperty[] }, name: string): string | number | boolean | undefined => o.properties?.find((p) => p.name === name)?.value;
/** the object's type (Tiled 1.9+ calls it `class`) */
export const tiledObjectType = (o: TiledObject): string => o.type || o.class || "";
const prop = tiledProp;
const objType = tiledObjectType;

const tileOf = (o: TiledObject): TilePoint => ({ x: Math.floor(o.x / TILE_SIZE), y: Math.floor(o.y / TILE_SIZE) });

/** Build the model from the raw map. Throws on a malformed map (missing ground / collision layer, missing location, ...).
 *  The optional layers (paths, deco, above, ...) count as empty when the map has none. */
export function buildTownModel(map: TiledMap): TownModel {
  const W = map.width;
  const H = map.height;
  const tileLayer = (name: string): TiledLayer | undefined => map.layers.find((x) => x.type === "tilelayer" && x.name === name);
  const required = (name: string): number[] => {
    const l = tileLayer(name);
    if (!l) throw new Error(`town map: missing layer "${name}"`);
    return Array.isArray(l.data) ? l.data : [];
  };
  const optional = (name: string): number[] => {
    const l = tileLayer(name);
    return l && Array.isArray(l.data) ? l.data : [];
  };

  // ── tile properties (cost), from every tileset ──
  const costOf = new Map<number, number>();
  for (const ts of map.tilesets) {
    for (const t of ts.tiles ?? []) {
      const c = t.properties?.find((p) => p.name === "cost")?.value;
      if (typeof c === "number") costOf.set(ts.firstgid + t.id, c);
    }
  }
  const lookup = (gid: number): number | undefined => (gid ? costOf.get(gid & GID_MASK) : undefined);

  const ground = required("ground");
  const collision = required("collision");
  const paths = optional("paths");
  const deco = optional("deco");
  const above = optional("above");

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
  const objs = (map.layers.find((l) => l.type === "objectgroup" && l.name === OBJECT_LAYER)?.objects ?? []) as TiledObject[];
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
  if (homeDoors.length < MIN_HOME_SLOTS || homeDoors.some((d, i) => d.slot !== i)) {
    throw new Error(`town map: expected home_door slots 0..${MIN_HOME_SLOTS - 1} at least (contiguous from 0), found [${homeDoors.map((d) => d.slot).join(",")}]`);
  }

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
