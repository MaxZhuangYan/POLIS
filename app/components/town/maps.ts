// The registry of the maps the client can load. A map is one Tiled file (.tmj) with its tilesets EMBEDDED; the tileset
// images, their margin / spacing and tile size are read from the .tmj itself (tiled.ts: readTilesets), so registering a
// map takes four lines. How to author one: doc/MAPS.md. Validate it: `npm run map:check`.
//
// Which map the game uses (resolveMap):
//   1. an explicit id — only the dev page passes one (`/dev/town?map=<id>`),
//   2. NEXT_PUBLIC_POLIS_MAP (inlined at build time; set it before `next dev` / `next build`),
//   3. DEFAULT_MAP_ID (the shipped town).
// An unknown id never breaks the game: it logs a warning and falls through to the next rule.
//
// The server never sees any of this: lib/ only knows LocationIds, never geometry.
//
// No imports on purpose: this file is also read under plain node (scripts/map-check.mjs).

export interface MapDef {
  /** url-safe id: used in `?map=` and NEXT_PUBLIC_POLIS_MAP */
  id: string;
  /** Chinese display name (dev page, docs) */
  title: string;
  /** site path of the .tmj (public/ + this path = the file) */
  tmj: string;
  /** one line: what this map is for */
  description?: string;
  /** repo path of a PNG preview (`npm run map:preview -- <tmj> --out <preview>`); not served */
  preview?: string;
}

export const DEFAULT_MAP_ID = "polis-town";

export const MAPS: MapDef[] = [
  {
    id: "polis-town",
    title: "Polis 城邦",
    tmj: "/assets/town/polis-town.tmj",
    description: "正式地图：64×42，由 scripts/build-town-map.mjs 生成，可直接用 Tiled 打开修改",
    preview: "doc/town-preview.png"
  }
];

export function getMap(id: string | null | undefined): MapDef | undefined {
  return id ? MAPS.find((m) => m.id === id) : undefined;
}

/** The map to play. `requested` (an id) wins, then NEXT_PUBLIC_POLIS_MAP, then the default town. */
export function resolveMap(requested?: string | null): MapDef {
  const warn = (what: string, id: string) => {
    if (typeof console !== "undefined") console.warn(`[polis] ${what} "${id}" is not a registered map (${MAPS.map((m) => m.id).join(", ")}); using the next fallback`);
  };
  if (requested) {
    const m = getMap(requested);
    if (m) return m;
    warn("map", requested);
  }
  // must stay a literal `process.env.NEXT_PUBLIC_*` access: Next inlines it into the client bundle
  const env = process.env.NEXT_PUBLIC_POLIS_MAP;
  if (env) {
    const m = getMap(env);
    if (m) return m;
    warn("NEXT_PUBLIC_POLIS_MAP", env);
  }
  return getMap(DEFAULT_MAP_ID) as MapDef;
}
