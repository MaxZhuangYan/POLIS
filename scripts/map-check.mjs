#!/usr/bin/env node
// Validates a Polis map (.tmj) against the rules the game actually relies on (app/components/town/tiled.ts), so a map
// edited in Tiled fails here — with the layer / object / tile named — instead of as a blank screen in the browser.
//
//   npm run map:check                       every map registered in app/components/town/maps.ts
//   npm run map:check -- path/to/map.tmj    one file
//   npm run map:check -- --preview out.png  also render a PNG preview (python3 + Pillow; skipped if missing)
//
// Errors (exit 1): wrong orientation / tile size, infinite map, missing or mis-sized tile layers, base64 / chunked
// data, external or image-collection tilesets, missing tileset images or images whose size disagrees with the
// tileset, gids outside every tileset, bad `cost` properties, anything buildTownModel rejects (missing location
// area / door, home doors), doors on blocked tiles, doors unreachable from the gate.
// Warnings: missing optional layers, unknown layer names, doors hidden under `above`, locations with < 3 stand slots.
// How to author a map: doc/MAPS.md.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tiled = await import(join(ROOT, "app/components/town/tiled.ts"));
const pf = await import(join(ROOT, "app/components/town/pathfinding.ts"));
const { MAPS } = await import(join(ROOT, "app/components/town/maps.ts"));

const args = process.argv.slice(2);
const previewAt = args.indexOf("--preview");
const preview = previewAt >= 0 ? args[previewAt + 1] : null;
const files = args.filter((a, i) => !a.startsWith("--") && i !== previewAt + 1);
const targets = files.length
  ? files.map((f) => ({ id: relative(ROOT, resolve(f)), file: resolve(f), site: "/" + relative(join(ROOT, "public"), resolve(f)).replaceAll("\\", "/") }))
  : MAPS.map((m) => ({ id: m.id, file: join(ROOT, "public", m.tmj), site: m.tmj }));

/** width / height of a PNG from its IHDR chunk */
function pngSize(path) {
  const b = readFileSync(path);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

let totalErrors = 0;
for (const t of targets) {
  const errors = [];
  const warns = [];
  const E = (m) => errors.push(m);
  const W = (m) => warns.push(m);
  console.log(`\n── ${t.id}  (${relative(ROOT, t.file)})`);
  if (!existsSync(t.file)) {
    console.log(`  ✗ 文件不存在`);
    totalErrors++;
    continue;
  }
  let map;
  try {
    map = JSON.parse(readFileSync(t.file, "utf8"));
  } catch (e) {
    console.log(`  ✗ 不是合法的 JSON（Tiled 里另存为 .tmj / JSON 格式）：${e.message}`);
    totalErrors++;
    continue;
  }

  // ── map header ──
  if (map.orientation && map.orientation !== "orthogonal") E(`地图方向是 ${map.orientation}，只支持 orthogonal（正交）`);
  if (map.infinite) E("这是无限地图（infinite）：在 Tiled 的地图属性里取消「无限」");
  if (map.tilewidth !== tiled.TILE_SIZE || map.tileheight !== tiled.TILE_SIZE) E(`格子大小是 ${map.tilewidth}×${map.tileheight}，游戏按 ${tiled.TILE_SIZE}×${tiled.TILE_SIZE} 计算`);
  const N = map.width * map.height;

  // ── tile layers ──
  const known = new Set([...tiled.REQUIRED_TILE_LAYERS, ...tiled.OPTIONAL_TILE_LAYERS]);
  const tileLayers = (map.layers ?? []).filter((l) => l.type === "tilelayer");
  for (const name of tiled.REQUIRED_TILE_LAYERS) if (!tileLayers.some((l) => l.name === name)) E(`缺少必需的图块层「${name}」`);
  for (const name of tiled.OPTIONAL_TILE_LAYERS) if (!tileLayers.some((l) => l.name === name)) W(`没有可选图块层「${name}」（当作空层）`);
  for (const l of tileLayers) {
    if (!known.has(l.name)) W(`图块层「${l.name}」游戏不会绘制（已知：${[...known].join(" / ")}）`);
    if (typeof l.data === "string" || l.encoding || l.compression) E(`图块层「${l.name}」用了 ${l.encoding ?? "压缩"} 编码：在 Tiled 的地图属性里把 Tile Layer Format 改成 CSV`);
    else if (l.chunks) E(`图块层「${l.name}」是分块（chunk）存储：取消无限地图`);
    else if (!Array.isArray(l.data) || l.data.length !== N) E(`图块层「${l.name}」的格子数是 ${l.data?.length ?? 0}，应为 ${map.width}×${map.height} = ${N}`);
    if (l.offsetx || l.offsety) W(`图块层「${l.name}」有偏移 (${l.offsetx ?? 0}, ${l.offsety ?? 0})，游戏会忽略它`);
  }
  if (!(map.layers ?? []).some((l) => l.type === "objectgroup" && l.name === tiled.OBJECT_LAYER)) E(`缺少对象层「${tiled.OBJECT_LAYER}」（地点、门、住处门、可点击区域都在这里）`);

  // ── tilesets ──
  let sets = [];
  try {
    sets = tiled.readTilesets(map, t.site);
  } catch (e) {
    E(`tileset：${e.message}`);
  }
  for (const s of sets) {
    const raw = map.tilesets.find((x) => (x.name ?? "") === s.name) ?? {};
    const imgPath = join(ROOT, "public", s.imageUrl);
    if (!existsSync(imgPath)) {
      E(`tileset「${s.name}」的图片不存在：${relative(ROOT, imgPath)}`);
      continue;
    }
    const size = imgPath.toLowerCase().endsWith(".png") ? pngSize(imgPath) : null;
    if (size && raw.imagewidth && (size.w !== raw.imagewidth || size.h !== raw.imageheight)) {
      E(`tileset「${s.name}」：.tmj 记的图片尺寸 ${raw.imagewidth}×${raw.imageheight}，实际 ${size.w}×${size.h}（在 Tiled 里重新载入图片）`);
    }
    if (size) {
      const cols = Math.floor((size.w - 2 * s.margin + s.spacing) / (s.tilewidth + s.spacing));
      const rows = Math.floor((size.h - 2 * s.margin + s.spacing) / (s.tileheight + s.spacing));
      if (s.columns && cols !== s.columns) E(`tileset「${s.name}」：按 margin ${s.margin} / spacing ${s.spacing} 算出 ${cols} 列，.tmj 写的是 ${s.columns} 列（margin / spacing 设错了？挤压过的图集是 margin 1、spacing 2）`);
      if (s.tilecount && cols * rows < s.tilecount) E(`tileset「${s.name}」：图片只放得下 ${cols * rows} 块，.tmj 写的是 ${s.tilecount} 块`);
    }
    for (const tile of raw.tiles ?? []) {
      if (tile.image) E(`tileset「${s.name}」是图片集合（image collection），不支持：请用单张图集`);
      for (const p of tile.properties ?? []) {
        if (p.name === "cost" && !(typeof p.value === "number" && p.value > 0)) E(`tileset「${s.name}」第 ${tile.id} 块的 cost = ${JSON.stringify(p.value)}：必须是大于 0 的数（float）`);
      }
    }
  }
  // gids must land in a tileset
  const ranges = sets.map((s) => [s.firstgid, s.firstgid + (s.tilecount || 1 << 20)]);
  for (const l of tileLayers) {
    if (!Array.isArray(l.data)) continue;
    let bad = 0;
    let first = -1;
    l.data.forEach((g, i) => {
      const gid = g & tiled.GID_MASK;
      if (gid && !ranges.some(([a, b]) => gid >= a && gid < b)) {
        bad++;
        if (first < 0) first = i;
      }
    });
    if (bad) E(`图块层「${l.name}」有 ${bad} 个格子的 gid 不属于任何 tileset（第一个在 (${first % map.width}, ${Math.floor(first / map.width)})）`);
  }

  // ── objects ──
  const objs = (map.layers ?? []).find((l) => l.type === "objectgroup" && l.name === tiled.OBJECT_LAYER)?.objects ?? [];
  const types = new Set(tiled.OBJECT_TYPES);
  for (const o of objs) {
    const ty = tiled.tiledObjectType(o);
    if (!types.has(ty)) W(`对象「${o.name || o.id}」的类型是「${ty || "（空）"}」，游戏只认 ${[...types].join(" / ")}`);
  }

  // ── the model the game builds, and the walks it needs ──
  let model = null;
  if (errors.length === 0) {
    try {
      model = tiled.buildTownModel(map);
    } catch (e) {
      E(e.message.replace(/^town map: /, "地图模型：") + "（对象层的约定见 doc/MAPS.md）");
    }
  }
  if (model) {
    const g = model.grid;
    const pts = [];
    for (const [id, loc] of Object.entries(model.locations)) {
      if (loc.door) pts.push({ name: `${id} 的门`, tile: loc.door });
      if (id !== "home" && loc.slots.length < 3) W(`地点 ${id} 只有 ${loc.slots.length} 个站位（建议 ≥3，人多时会挤在一起）`);
    }
    for (const h of model.homeDoors) pts.push({ name: `住处 ${h.slot} 的门`, tile: h.tile });
    for (const p of pts) {
      if (pf.isBlocked(g, p.tile.x, p.tile.y)) E(`${p.name} (${p.tile.x}, ${p.tile.y}) 在碰撞格上，走不进去`);
      else if (model.covered[p.tile.y * model.width + p.tile.x]) W(`${p.name} (${p.tile.x}, ${p.tile.y}) 被 above 层遮住，居民站在那里看不见`);
    }
    const finder = new pf.PathFinder(g, 4096);
    const gate = model.locations.gate?.door ?? model.gate;
    let unreachable = 0;
    for (const p of pts) {
      if (pf.isBlocked(g, p.tile.x, p.tile.y)) continue;
      if (!finder.find(gate, p.tile)) {
        unreachable++;
        E(`从城门走不到 ${p.name} (${p.tile.x}, ${p.tile.y})：路被碰撞层堵住了`);
      }
    }
    console.log(
      `  ${map.width}×${map.height} 格 · tileset ${sets.map((s) => s.name).join(", ")} · 地点 ${Object.keys(model.locations).length} · 住处 ${model.homeDoors.length} · 可点击 ${model.interactables.length} · 从城门可达 ${pts.length - unreachable}/${pts.length}`,
    );
  }

  for (const w of warns) console.log(`  ! ${w}`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(errors.length ? `  ${errors.length} 个错误` : "  ✓ 通过");
  totalErrors += errors.length;

  if (preview && errors.length === 0) {
    const r = spawnSync("python3", [join(ROOT, "scripts/render-town-preview.py"), "--out", preview, ...(t.file.endsWith("polis-town.tmj") ? [] : ["--map", t.file])], { stdio: "inherit" });
    if (r.error || r.status !== 0) console.log("  （预览没有生成：需要 python3 + Pillow）");
  }
}
process.exit(totalErrors ? 1 : 0);
