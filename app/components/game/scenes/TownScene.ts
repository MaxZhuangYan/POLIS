// The world scene: a Tiled tilemap town with animated residents.
//
// Design rule (see POLIS 玩法设计): everything a resident does on screen is *presentation of logical state*. The
// snapshot says where an agent is (or which road it is on, and between which sim timestamps); the scene only
// decides how to draw that — A* routes along the tile roads, walk animations, idle wander inside the location,
// bubbles — and never invents positions that contradict the state.
//
// This module imports Phaser statically, so it must only ever be loaded with a dynamic import() from the browser
// (PhaserTown.tsx does that). It talks to React through EventBus, never through callbacks.

import * as Phaser from "phaser";
import type { AgentView, GameSnapshot, LocationId } from "@/lib/types";
import {
  buildTownModel,
  interactableAt,
  tileToWorld,
  worldToTile,
  type Interactable,
  type TiledMap,
  type TownModel
} from "@/app/components/town/tiled";
import { PathFinder, type TilePoint } from "@/app/components/town/pathfinding";
import { animKey, frameIndex, spriteTexture, type Direction } from "@/app/components/town/characters";
import { EventBus } from "../EventBus";
import { BG_COLOR, DEPTH, KEYS, MAP_ABOVE_LAYER, MAP_LAYERS, PIXEL_FONT, SCENES, emoteTexture } from "../keys";

// ───────────────────────────── public surface ─────────────────────────────

export interface TownApi {
  setSnapshot(snapshot: GameSnapshot | null): void;
  focusAgent(id: string): void;
  setFollow(id: string | null): void;
  setSelected(id: string | null): void;
  /** live screen position (canvas px) of my Agent's body; null when off-screen or absent */
  getPlayerScreen(): { x: number; y: number } | null;
}

// ───────────────────────────── constants ─────────────────────────────

// Every in-world text uses the one pixel font (keys.ts), drawn at 12 px (names, places, bubbles) so its 12 px grid lands
// on whole screen pixels: the label containers are scaled by 1/zoom, which makes the net screen scale exactly 1.
const FONT = PIXEL_FONT;
const INK = "#2b180d"; // deep brown: text outlines and bubble text
const MAX_ZOOM = 4;
const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3, 4];
const DEFAULT_ZOOM = 2;
const DEFAULT_ZOOM_PHONE = 2;
const CHAR_H = 16; // a character is one tile
const BUBBLE_MS = 7000;
const BUBBLE_FADE_MS = 700;
const CATCHUP_MAX_S = 2.4;
const CATCHUP_SPEED = 80; // px / s
const WANDER_SPEED = 15; // px / s
const GOLD = 0xf2c75c;

// ───────────────────────────── helpers ─────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}

/** greedy line breaking that also works for CJK text (no spaces) */
function wrapText(text: string, maxPx: number, fontPx: number, maxLines = 4): string {
  const lines: string[] = [];
  let line = "";
  let w = 0;
  const chars = Array.from(text);
  let i = 0;
  for (; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "\n") {
      lines.push(line);
      line = "";
      w = 0;
      continue;
    }
    const cw = /[⺀-￿]/.test(ch) ? fontPx : fontPx * 0.56;
    if (w + cw > maxPx && line) {
      lines.push(line);
      line = "";
      w = 0;
    }
    if (lines.length >= maxLines) break;
    line += ch;
    w += cw;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (i < chars.length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/.$/, "…");
  }
  return lines.slice(0, maxLines).join("\n");
}

interface Pt {
  x: number;
  y: number;
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** a polyline in world px with its cumulative length */
interface Walk {
  pts: Pt[];
  len: number;
}

function makeWalk(pts: Pt[]): Walk {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return { pts, len };
}

function tilesToWalk(tiles: TilePoint[], start?: Pt, end?: Pt): Walk {
  const pts = tiles.map(tileToWorld);
  if (start) pts.unshift(start);
  if (end) pts.push(end);
  return makeWalk(pts);
}

interface PathSample {
  x: number;
  y: number;
  /** unit direction of travel at this point */
  dx: number;
  dy: number;
}

/** point `d` px along a walk (clamped to its ends) */
function pointAlong(walk: Walk, d: number): PathSample {
  const pts = walk.pts;
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y, dx: 0, dy: 0 };
  let remain = Math.max(0, d);
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (remain <= seg || i === pts.length - 1) {
      const t = seg === 0 ? 1 : Math.min(1, remain / seg);
      const dx = seg === 0 ? 0 : (pts[i].x - pts[i - 1].x) / seg;
      const dy = seg === 0 ? 0 : (pts[i].y - pts[i - 1].y) / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, dx, dy };
    }
    remain -= seg;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, dx: 0, dy: 0 };
}

function dirFromVec(dx: number, dy: number, prev: Direction): Direction {
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) return prev;
  // keep the current facing when the other axis only wins by a hair (no flicker on diagonals)
  if (Math.abs(dx) > Math.abs(dy) * 1.15) return dx > 0 ? "right" : "left";
  if (Math.abs(dy) > Math.abs(dx) * 1.15) return dy > 0 ? "down" : "up";
  return prev;
}

// day / night grade -----------------------------------------------------------

interface Grade {
  bright: number; // lifts the artwork towards "day" (1 = as is)
  night: number; // blue overlay alpha
  warm: number; // warm overlay alpha
  warmColor: number;
}

const GRADE_KEYS: { h: number; g: Grade }[] = [
  { h: 0, g: { bright: 0.9, night: 0.56, warm: 0, warmColor: 0xff9a4a } },
  { h: 5, g: { bright: 0.92, night: 0.5, warm: 0, warmColor: 0xff9a4a } },
  { h: 6.5, g: { bright: 1.1, night: 0.12, warm: 0.16, warmColor: 0xff9a5a } },
  { h: 8, g: { bright: 1.0, night: 0, warm: 0.04, warmColor: 0xffd890 } },
  { h: 16.5, g: { bright: 1.0, night: 0, warm: 0.04, warmColor: 0xffd890 } },
  { h: 18, g: { bright: 1.0, night: 0.06, warm: 0.2, warmColor: 0xff8a40 } },
  { h: 19.5, g: { bright: 1.0, night: 0.18, warm: 0.16, warmColor: 0xff7a40 } },
  { h: 22, g: { bright: 0.92, night: 0.5, warm: 0, warmColor: 0xff9a4a } },
  { h: 24, g: { bright: 0.9, night: 0.56, warm: 0, warmColor: 0xff9a4a } }
];

function gradeAt(hour: number): Grade {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < GRADE_KEYS.length; i++) {
    const a = GRADE_KEYS[i - 1];
    const b = GRADE_KEYS[i];
    if (h <= b.h) {
      const t = (h - a.h) / (b.h - a.h);
      const e = t * t * (3 - 2 * t); // smoothstep
      return {
        bright: lerp(a.g.bright, b.g.bright, e),
        night: lerp(a.g.night, b.g.night, e),
        warm: lerp(a.g.warm, b.g.warm, e),
        warmColor: lerpColor(a.g.warmColor, b.g.warmColor, e)
      };
    }
  }
  return GRADE_KEYS[0].g;
}

// ───────────────────────────── resident ─────────────────────────────

interface BubbleView {
  box: Phaser.GameObjects.Container;
  shownAt: number; // performance.now()
}

interface CatchUp {
  walk: Walk;
  dur: number;
  t: number;
}

interface Wander {
  walk: Walk;
  d: number;
}

interface Resident {
  id: string;
  data: AgentView;
  // display objects
  root: Phaser.GameObjects.Container; // world position, sprite part
  shadow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image | null;
  sel: Phaser.GameObjects.Image;
  sprite: Phaser.GameObjects.Sprite;
  texture: string;
  top: Phaser.GameObjects.Container; // label + emote + bubble (kept above all sprites)
  label: Phaser.GameObjects.Text;
  emoteBg: Phaser.GameObjects.Image;
  emoteIcon: Phaser.GameObjects.Image;
  emoteKey: string | null;
  bubble: BubbleView | null;
  bubbleSeenAt: number | null;
  // motion
  x: number; // feet, world px
  y: number;
  dir: Direction;
  walking: boolean;
  speedEma: number;
  fresh: boolean; // first frame: snap to target
  locShown: LocationId | null;
  travelKey: string | null;
  travelWalk: Walk | null;
  catchUp: CatchUp | null;
  slotLoc: LocationId | null;
  slotIdx: number;
  // wander
  rng: () => number;
  wx: number;
  wy: number;
  wander: Wander | null;
  wUntil: number;
  wBase: Pt | null;
  breathe: number;
  lift: number; // label lift (px) to avoid name tags colliding
  liftCur: number;
}

interface Dog {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  walk: Walk | null;
  d: number;
  until: number;
  lying: boolean;
}

// ───────────────────────────── the scene ─────────────────────────────

export class TownScene extends Phaser.Scene implements TownApi {
  private model!: TownModel;
  private finder!: PathFinder;
  private walkSets = {} as Record<LocationId, Set<number>>;
  private mapW = 1024;
  private mapH = 672;
  private debug = false;

  private snapshot: GameSnapshot | null = null;
  private receivedAt = 0;
  private ready = false;
  private residents = new Map<string, Resident>();
  private dog: Dog | null = null;
  private uiLayer!: Phaser.GameObjects.Container;
  private dayLight!: Phaser.GameObjects.Rectangle;
  private warmOverlay!: Phaser.GameObjects.Rectangle;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private hoverGfx!: Phaser.GameObjects.Graphics;
  private hoverTip!: Phaser.GameObjects.Text;
  private hovered: Interactable | null = null;
  private placeLabels: { id: LocationId; text: Phaser.GameObjects.Text; ax: number; ay: number }[] = [];
  private grade: Grade | null = null;
  private lastGradeKey = "";
  private selectedId: string | null = null;
  private followId: string | null = null;
  private labelRes = 2;
  // camera
  private minZoom = 1;
  /** screen px covered by HUD on each side; the camera may scroll that far past the map edge so a resident near
   *  the edge can be brought into view, and follow/focus centre the target in the uncovered area */
  private safe = { l: 0, r: 0, t: 0, b: 0 };
  private userZoomed = false;
  private zoomAnim: { target: number; sx: number; sy: number } | null = null;
  private camAnim: { t: number; dur: number; id: string; zoomTo: number; fromX: number; fromY: number; fromZ: number } | null = null;
  private didInitialCenter = false;
  // title screen: slow drift over the town (no follow, no input)
  private titleMode = false;
  private titlePath: Pt[] = [];
  private titleTarget = 0;
  private titleVel: Pt = { x: 0, y: 0 };
  // held-key pan (-1..1 per axis), set by the React key handler
  private panVec: Pt = { x: 0, y: 0 };
  private downAt: { x: number; y: number } | null = null;
  private dragged = false;
  private pinch: { dist: number } | null = null;

  constructor() {
    super({ key: SCENES.town });
  }

  // ───────────── api (called through the EventBus) ─────────────

  setSnapshot(snapshot: GameSnapshot | null): void {
    this.snapshot = snapshot;
    this.receivedAt = performance.now();
    if (this.ready) this.syncResidents();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
  }

  setFollow(id: string | null): void {
    this.followId = id;
    if (id && this.ready) this.startCamAnim(id, Math.max(this.cameras.main.zoom, this.defaultZoom()));
  }

  focusAgent(id: string): void {
    if (!this.ready) return;
    this.followId = null;
    this.startCamAnim(id, Math.max(this.cameras.main.zoom, this.defaultZoom()));
  }

  /** title screen on: the camera drifts slowly across the town and ignores follow; off: back to my Agent */
  setTitleMode(on: boolean): void {
    if (this.titleMode === on) return;
    this.titleMode = on;
    this.panVec = { x: 0, y: 0 };
    if (on) {
      this.camAnim = null;
      this.zoomAnim = null;
      this.titleVel = { x: 0, y: 0 };
      // start the drift with the waypoint nearest to where the camera already is
      const c = this.centerOf();
      let best = 0;
      this.titlePath.forEach((p, i) => {
        if (dist(p, c) < dist(this.titlePath[best], c)) best = i;
      });
      this.titleTarget = (best + 1) % Math.max(1, this.titlePath.length);
    } else {
      this.userZoomed = false;
      this.recenterOnPlayer();
    }
  }

  /** held-key pan; any non-zero pan ends "follow" (the same as dragging the map) */
  setPan(vx: number, vy: number): void {
    this.panVec = { x: clamp(vx, -1, 1), y: clamp(vy, -1, 1) };
  }

  /** one zoom step in (+1) / out (-1) around the screen centre (keyboard Q / E, - / =) */
  zoomStep(dir: 1 | -1): void {
    if (!this.ready || this.titleMode) return;
    const cam = this.cameras.main;
    this.stepZoom(dir, cam.width / 2, cam.height / 2);
  }

  // ───────────── phaser lifecycle ─────────────

  create(): void {
    this.debug = this.registry.get("debug") === true;
    // pixel font: text is drawn 1:1 (resolution 1) and the canvas is shown with image-rendering: pixelated, so every
    // glyph pixel is a whole screen pixel on any display density
    this.labelRes = 1;

    // data model + path finder from the very same map the tile layers are drawn from
    const raw = this.cache.tilemap.get(KEYS.map).data as TiledMap;
    this.model = buildTownModel(raw);
    this.finder = new PathFinder(this.model.grid, 512);
    this.mapW = this.model.pxWidth;
    this.mapH = this.model.pxHeight;
    for (const [id, loc] of Object.entries(this.model.locations)) {
      this.walkSets[id as LocationId] = new Set(loc.walkTiles.map((t) => t.y * this.model.width + t.x));
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor(BG_COLOR);
    cam.setBounds(0, 0, this.mapW, this.mapH);
    cam.setRoundPixels(true);

    this.buildMap();
    this.makeTextures();
    this.buildOverlays();
    this.buildDog();

    this.uiLayer = this.add.container(0, 0).setDepth(DEPTH.ui);
    this.buildPlaceLabels();
    this.hoverGfx = this.add.graphics().setDepth(DEPTH.hover);
    this.hoverTip = this.add
      .text(0, 0, "", { fontFamily: FONT, fontSize: "12px", color: "#ffe08a", stroke: INK, strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setResolution(this.labelRes)
      .setShadow(0, 1, INK, 0, true, true)
      .setVisible(false);
    this.uiLayer.add(this.hoverTip);

    if (this.debug) this.drawDebug();
    if (this.debug || process.env.NODE_ENV !== "production") {
      // dev handles for QA scripts: the scene, and the bus (to silence snapshots while staging a walk)
      (window as unknown as { __town?: TownScene }).__town = this;
      (window as unknown as { __townBus?: typeof EventBus }).__townBus = EventBus;
    }

    this.input.setDefaultCursor("grab");
    this.input.addPointer(2);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);
    this.input.on("wheel", this.onWheel, this);
    this.scale.on("resize", this.onResize, this);

    // React -> Phaser commands
    EventBus.on("cmd-snapshot", this.setSnapshot, this);
    EventBus.on("cmd-select", this.setSelected, this);
    EventBus.on("cmd-follow", this.setFollow, this);
    EventBus.on("cmd-focus", this.focusAgent, this);
    EventBus.on("cmd-title-mode", this.setTitleMode, this);
    EventBus.on("cmd-pan", this.setPan, this);
    EventBus.on("cmd-zoom-step", this.zoomStep, this);
    const unhook = () => {
      this.scale.off("resize", this.onResize, this);
      EventBus.off("cmd-snapshot", this.setSnapshot, this);
      EventBus.off("cmd-select", this.setSelected, this);
      EventBus.off("cmd-follow", this.setFollow, this);
      EventBus.off("cmd-focus", this.focusAgent, this);
      EventBus.off("cmd-title-mode", this.setTitleMode, this);
      EventBus.off("cmd-pan", this.setPan, this);
      EventBus.off("cmd-zoom-step", this.zoomStep, this);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unhook);
    this.events.once(Phaser.Scenes.Events.DESTROY, unhook);

    this.onResize();
    cam.setZoom(clamp(this.defaultZoom(), this.minZoom, MAX_ZOOM));
    cam.centerOn(this.mapW / 2, this.mapH / 2);
    this.buildTitlePath();

    this.ready = true;
    this.syncResidents();
    EventBus.emit("scene-ready");
  }

  // ───────────── map ─────────────

  private buildMap(): void {
    const map = this.make.tilemap({ key: KEYS.map });
    const tileset = map.addTilesetImage(KEYS.tilesetName, KEYS.tileset, 16, 16, 1, 2);
    if (!tileset) throw new Error("town tileset missing");
    MAP_LAYERS.forEach((name) => {
      const layer = map.createLayer(name, tileset, 0, 0);
      layer?.setDepth(DEPTH[name]);
    });
    // roofs, canopies, torii beams: above every resident, so residents walk behind them
    map.createLayer(MAP_ABOVE_LAYER, tileset, 0, 0)?.setDepth(DEPTH.above);
    this.buildMapMargin(map, tileset);
  }

  /** The land goes on past the map edge. The HUD-safe camera bounds let the view slide beyond the map when the
   *  Agent stands at an edge (so it is never hidden under a panel); there the player sees the town's ground,
   *  darkened and fading out, instead of the empty void. */
  private buildMapMargin(map: Phaser.Tilemaps.Tilemap, tileset: Phaser.Tilemaps.Tileset): void {
    // the ground layer's commonest tile is what the town stands on
    const counts = new Map<number, number>();
    for (const row of map.getLayer("ground")?.data ?? []) for (const t of row) if (t.index > 0) counts.set(t.index, (counts.get(t.index) ?? 0) + 1);
    const gid = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const at = gid !== undefined ? (tileset.getTileTextureCoordinates(gid) as { x: number; y: number } | null) : null;
    if (!at) return;
    const tex = this.textures.get(KEYS.tileset);
    if (!tex.has("map-margin")) tex.add("map-margin", 0, at.x, at.y, 16, 16);
    const M = 1024; // wider than any HUD inset at the smallest zoom
    const { mapW: w, mapH: h } = this;
    this.add
      .tileSprite(-M, -M, w + 2 * M, h + 2 * M, KEYS.tileset, "map-margin")
      .setOrigin(0, 0)
      .setDepth(DEPTH.ground - 1)
      .setTint(0x8a7060);
    // a soft edge: the ground dims over FADE px, then stays dim
    const FADE = 96;
    const dim = Phaser.Display.Color.HexStringToColor(BG_COLOR).color;
    const g = this.add.graphics().setDepth(DEPTH.ground - 0.5);
    g.fillGradientStyle(dim, dim, dim, dim, 0.55, 0.55, 0, 0); // top strip: darker above, clear at the map edge
    g.fillRect(-FADE, -FADE, w + 2 * FADE, FADE);
    g.fillGradientStyle(dim, dim, dim, dim, 0, 0, 0.55, 0.55);
    g.fillRect(-FADE, h, w + 2 * FADE, FADE);
    g.fillGradientStyle(dim, dim, dim, dim, 0.55, 0, 0.55, 0);
    g.fillRect(-FADE, 0, FADE, h);
    g.fillGradientStyle(dim, dim, dim, dim, 0, 0.55, 0, 0.55);
    g.fillRect(w, 0, FADE, h);
    g.fillStyle(dim, 0.55);
    g.fillRect(-M, -M, w + 2 * M, M - FADE);
    g.fillRect(-M, h + FADE, w + 2 * M, M - FADE);
    g.fillRect(-M, -FADE, M - FADE, h + 2 * FADE);
    g.fillRect(w + FADE, -FADE, M - FADE, h + 2 * FADE);
  }

  // ───────────── textures ─────────────

  private makeTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, nearest = false) => {
      if (this.textures.exists(key)) return;
      const tex = this.textures.createCanvas(key, w, h);
      if (!tex) return;
      draw(tex.getContext());
      tex.refresh();
      tex.setFilter(nearest ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
    };
    mk("shadow", 64, 28, (c) => {
      const g = c.createRadialGradient(32, 14, 2, 32, 14, 30);
      g.addColorStop(0, "rgba(0,0,0,0.5)");
      g.addColorStop(0.6, "rgba(0,0,0,0.25)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.save();
      c.scale(1, 0.44);
      c.fillStyle = g;
      c.beginPath();
      c.arc(32, 32, 31, 0, Math.PI * 2);
      c.fill();
      c.restore();
    });
    mk("ring-gold", 84, 40, (c) => {
      c.shadowColor = "rgba(242,199,92,0.95)";
      c.shadowBlur = 8;
      c.strokeStyle = "#f2c75c";
      c.lineWidth = 3;
      c.beginPath();
      c.ellipse(42, 20, 33, 13, 0, 0, Math.PI * 2);
      c.stroke();
      c.shadowBlur = 0;
      c.strokeStyle = "rgba(255,244,200,0.9)";
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(42, 20, 33, 13, 0, 0, Math.PI * 2);
      c.stroke();
    });
    mk("ring-sel", 84, 40, (c) => {
      c.shadowColor = "rgba(160,220,255,0.9)";
      c.shadowBlur = 6;
      c.strokeStyle = "rgba(235,248,255,0.95)";
      c.lineWidth = 2;
      c.setLineDash([7, 5]);
      c.beginPath();
      c.ellipse(42, 20, 30, 11, 0, 0, Math.PI * 2);
      c.stroke();
    });
    // pixel emote plate: a 22x22 cream square with stepped corners, a deep-brown outline and a 1 px drop shadow
    mk(
      "emote-bg",
      22,
      23,
      (c) => {
        const plate = (ox: number, oy: number, color: string) => {
          c.fillStyle = color;
          c.fillRect(ox + 2, oy, 18, 22);
          c.fillRect(ox, oy + 2, 22, 18);
          c.fillRect(ox + 1, oy + 1, 20, 20);
        };
        plate(0, 1, "rgba(43,24,13,0.45)");
        plate(0, 0, "#2b180d");
        c.fillStyle = "#fbeed6";
        c.fillRect(3, 1, 16, 20);
        c.fillRect(1, 3, 20, 16);
        c.fillRect(2, 2, 18, 18);
        c.fillStyle = "#e7c996"; // lower inner edge
        c.fillRect(3, 19, 16, 1);
      },
      true
    );
    // the bubble's pointer: its top three rows open the box's bottom border, then a stepped triangle with an outline
    mk(
      "bubble-tail",
      12,
      7,
      (c) => {
        const rows = [".OCCCCCCCCO.", ".OCCCCCCCCO.", ".OCCCCCCCCO.", "..OCCCCCCO..", "...OCCCCO...", "....OCCO....", ".....OO....."];
        rows.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) {
            if (row[x] === ".") continue;
            c.fillStyle = row[x] === "O" ? "#2b180d" : "#fbeed6";
            c.fillRect(x, y, 1, 1);
          }
        });
      },
      true
    );
    // pixel glyph emotes that have no icon asset, drawn 1:1 (the plate is 22 px, the 64 px icons are shown at 16 px)
    const glyph = (key: string, rows: string[], px: number, fg: string, size: number) => {
      mk(
        key,
        size,
        size,
        (c) => {
          c.fillStyle = fg;
          const w = rows[0].length * px;
          const h = rows.length * px;
          const ox = Math.round((size - w) / 2);
          const oy = Math.round((size - h) / 2);
          rows.forEach((row, y) => {
            for (let x = 0; x < row.length; x++) if (row[x] === "X") c.fillRect(ox + x * px, oy + y * px, px, px);
          });
        },
        true
      );
    };
    glyph("emote-sleep", ["XXXXX......", "...X.......", "..X....XXX.", ".X......X..", "XXXXX..XXX."].map((r) => r.padEnd(11, ".")), 2, "#3452b0", 22);
    glyph("emote-alert", [".XX.", ".XX.", ".XX.", ".XX.", ".XX.", "....", ".XX."], 2, "#d1322a", 16);
  }

  // ───────────── overlays: day / night ─────────────

  private buildOverlays(): void {
    // World-space rectangles far larger than the map (the camera may scroll past the edge by the HUD footprint).
    // Above every layer *and* resident, below the UI: the whole picture gets the grade. (A preFX colour matrix would
    // be neater, but preFX renders through a screen-sized buffer and clips big objects that are partly off-screen.)
    const pad = 2400;
    const mkRect = (color: number, depth: number) => this.add.rectangle(-pad, -pad, this.mapW + pad * 2, this.mapH + pad * 2, color, 0).setOrigin(0, 0).setDepth(depth);
    this.dayLight = mkRect(0xfff3d6, DEPTH.grade).setBlendMode(Phaser.BlendModes.SCREEN);
    this.warmOverlay = mkRect(0xff9a4a, DEPTH.grade + 1);
    this.nightOverlay = mkRect(0x0a1448, DEPTH.grade + 2);
  }

  // ───────────── ambient: the town dog ─────────────

  private buildDog(): void {
    if (!this.textures.exists("char-dog")) return;
    const start = this.model.locations.plaza.slots[3] ?? this.model.locations.plaza.door;
    if (!start) return;
    const p = tileToWorld(start);
    const shadow = this.add.image(p.x, p.y, "shadow").setScale(0.2, 0.22).setAlpha(0.8).setDepth(DEPTH.residents - 1);
    const sprite = this.add.sprite(p.x, p.y, "char-dog", 0).setOrigin(0.5, 1);
    sprite.anims.play("dog:sit");
    this.dog = { sprite, shadow, x: p.x, y: p.y, walk: null, d: 0, until: performance.now() + 2000, lying: false };
  }

  private updateDog(dt: number, nowMs: number): void {
    const dog = this.dog;
    if (!dog) return;
    if (dog.walk) {
      dog.d += 24 * dt;
      const s = pointAlong(dog.walk, dog.d);
      dog.x = s.x;
      dog.y = s.y;
      if (Math.abs(s.dx) > 0.1) dog.sprite.setFlipX(s.dx < 0);
      if (dog.d >= dog.walk.len) {
        dog.walk = null;
        dog.until = nowMs + 4000 + Math.random() * 7000;
        dog.lying = Math.random() < 0.5;
      }
    } else if (nowMs >= dog.until) {
      const here = worldToTile(dog.x, dog.y);
      const plaza = this.model.locations.plaza.walkTiles;
      const hall = this.model.locations.hall.walkTiles;
      const pool = Math.random() < 0.7 ? plaza : hall;
      const target = pool[Math.floor(Math.random() * pool.length)];
      const path = target ? this.finder.find(here, target) : null;
      if (path && path.length > 1) {
        dog.walk = tilesToWalk(path, { x: dog.x, y: dog.y });
        dog.d = 0;
        dog.lying = false;
      } else dog.until = nowMs + 3000;
    }
    const hop = dog.walk ? Math.abs(Math.sin(performance.now() / 70)) * 1.6 : 0;
    dog.sprite.anims.play(dog.lying && !dog.walk ? "dog:lie" : "dog:sit", true);
    dog.sprite.setPosition(Math.round(dog.x), Math.round(dog.y - hop));
    dog.sprite.setDepth(DEPTH.residents + dog.y);
    dog.shadow.setPosition(Math.round(dog.x), Math.round(dog.y - 1));
  }

  // ───────────── place labels / hover ─────────────

  private buildPlaceLabels(): void {
    // one small plaque per location, above its biggest building / landmark (houses get theirs on hover only)
    for (const id of Object.keys(this.model.locations) as LocationId[]) {
      if (id === "home") continue;
      const its = this.model.interactables.filter((i) => i.location === id);
      if (its.length === 0) continue;
      const big = its.reduce((a, b) => (b.rect.w * b.rect.h > a.rect.w * a.rect.h ? b : a));
      const text = this.add
        .text(0, 0, this.model.locations[id].label, { fontFamily: FONT, fontSize: "12px", color: "#fff3d0", stroke: INK, strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setResolution(this.labelRes)
        .setShadow(0, 1, INK, 0, true, true)
        .setAlpha(0.92);
      this.uiLayer.add(text);
      this.placeLabels.push({ id, text, ax: big.rect.x + big.rect.w / 2, ay: big.rect.y + 2 });
    }
  }

  private updatePlaceLabels(): void {
    const zoom = this.cameras.main.zoom;
    const s = clamp(1 / zoom, 0.18, 1.2);
    const show = zoom <= 3.4;
    for (const l of this.placeLabels) {
      l.text.setVisible(show && this.hovered?.location !== l.id);
      l.text.setScale(s);
      l.text.setPosition(Math.round(l.ax), Math.round(l.ay - 2 / zoom));
    }
    // hover plaque + highlight
    const h = this.hovered;
    this.hoverGfx.clear();
    if (!h) {
      this.hoverTip.setVisible(false);
      return;
    }
    const t = this.time.now / 1000;
    const pulse = 0.55 + 0.45 * Math.sin(t * 6);
    const r = h.rect;
    this.hoverGfx.fillStyle(0xfff3c4, 0.1 + 0.06 * pulse);
    this.hoverGfx.fillRoundedRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 3);
    this.hoverGfx.lineStyle(Math.max(1, 1.6 / zoom), GOLD, 0.7 + 0.3 * pulse);
    this.hoverGfx.strokeRoundedRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, 3);
    this.hoverTip.setText(this.model.locations[h.location].label);
    this.hoverTip.setVisible(true);
    this.hoverTip.setScale(clamp(1 / zoom, 0.18, 1.2));
    this.hoverTip.setPosition(Math.round(r.x + r.w / 2), Math.round(r.y - 3 / zoom));
  }

  // ───────────── residents ─────────────

  private allAgents(): AgentView[] {
    const snap = this.snapshot;
    if (!snap) return [];
    const map = new Map<string, AgentView>();
    for (const a of snap.agents) map.set(a.id, a);
    if (snap.player && !map.has(snap.player.agent.id)) map.set(snap.player.agent.id, snap.player.agent);
    return Array.from(map.values());
  }

  private syncResidents(): void {
    const agents = this.allAgents();
    const seen = new Set<string>();
    for (const a of agents) {
      seen.add(a.id);
      let res = this.residents.get(a.id);
      if (!res) {
        res = this.createResident(a);
        this.residents.set(a.id, res);
      }
      this.applyData(res, a);
    }
    for (const [id, res] of this.residents) {
      if (!seen.has(id)) {
        res.root.destroy();
        res.top.destroy();
        this.residents.delete(id);
        if (this.selectedId === id) this.selectedId = null;
        if (this.followId === id) this.followId = null;
      }
    }
    if (!this.didInitialCenter && agents.length > 0) {
      const me = agents.find((a) => a.isPlayer);
      if (me) {
        this.didInitialCenter = true;
        const res = this.residents.get(me.id);
        if (res) {
          // wait for the first update so the resident has a position
          this.time.delayedCall(30, () => {
            if (this.camAnim || this.followId) return;
            const c = this.safeCenterFor(res.x, res.y - 8);
            this.setCenter(c.x, c.y);
          });
        }
      }
    }
  }

  private createResident(a: AgentView): Resident {
    const isMe = a.isPlayer;
    const texture = spriteTexture(a.sprite);
    const root = this.add.container(0, 0);
    const shadow = this.add.image(0, -1, "shadow").setOrigin(0.5, 0.5).setScale(0.26, 0.26).setAlpha(0.9);
    const ring = isMe ? this.add.image(0, 0, "ring-gold").setOrigin(0.5, 0.5).setScale(0.3) : null;
    const sel = this.add.image(0, 0, "ring-sel").setOrigin(0.5, 0.5).setScale(0.3).setVisible(false);
    const sprite = this.add.sprite(0, 0, texture, frameIndex("down")).setOrigin(0.5, 1);
    root.add([shadow]);
    if (ring) root.add(ring);
    root.add([sel, sprite]);

    const top = this.add.container(0, 0);
    const label = this.add
      .text(0, 0, isMe ? `★ ${a.name}` : a.name, {
        fontFamily: FONT,
        fontSize: "12px",
        color: isMe ? "#ffd86a" : "#fff8e6",
        stroke: INK,
        strokeThickness: 3
      })
      .setOrigin(0.5, 1)
      .setResolution(this.labelRes);
    label.setShadow(0, 1, INK, 0, true, true); // hard 1 px drop shadow under the outline: crisp, pixel-art style
    const emoteBg = this.add.image(0, -22, "emote-bg").setVisible(false);
    const emoteIcon = this.add.image(0, -22, emoteTexture("think")).setDisplaySize(16, 16).setVisible(false);
    top.add([label, emoteBg, emoteIcon]);
    this.uiLayer.add(top);

    const seed = hashStr(a.id);
    return {
      id: a.id,
      data: a,
      root,
      shadow,
      ring,
      sel,
      sprite,
      texture,
      top,
      label,
      emoteBg,
      emoteIcon,
      emoteKey: null,
      bubble: null,
      bubbleSeenAt: null,
      x: 0,
      y: 0,
      dir: "down",
      walking: false,
      speedEma: 0,
      fresh: true,
      locShown: null,
      travelKey: null,
      travelWalk: null,
      catchUp: null,
      slotLoc: null,
      slotIdx: -1,
      rng: mulberry32(seed),
      wx: 0,
      wy: 0,
      wander: null,
      wUntil: 0,
      wBase: null,
      breathe: (seed % 100) / 15,
      lift: 0,
      liftCur: 0
    };
  }

  private applyData(res: Resident, a: AgentView): void {
    const prev = res.data;
    res.data = a;
    if (prev.sprite !== a.sprite) {
      res.texture = spriteTexture(a.sprite);
      res.sprite.setTexture(res.texture, frameIndex(res.dir));
    }
    if (prev.name !== a.name || prev.isPlayer !== a.isPlayer) res.label.setText(a.isPlayer ? `★ ${a.name}` : a.name);
    // bubbles: a new atMs means a new line; on first sight only show fresh ones
    const b = a.bubble;
    if (b && b.text) {
      if (res.bubbleSeenAt === null) {
        res.bubbleSeenAt = b.atMs;
        const simNow = this.estSimNow();
        if (simNow - b.atMs < 120000) this.showBubble(res, b.text);
      } else if (b.atMs !== res.bubbleSeenAt) {
        res.bubbleSeenAt = b.atMs;
        this.showBubble(res, b.text);
      }
    } else if (res.bubbleSeenAt === null) {
      res.bubbleSeenAt = -1;
    }
  }

  private estSimNow(): number {
    const w = this.snapshot?.world;
    if (!w) return Date.now();
    return w.simNowMs + (performance.now() - this.receivedAt);
  }

  // ───────────── bubbles / emotes ─────────────

  private showBubble(res: Resident, text: string): void {
    if (res.bubble) {
      res.bubble.box.destroy();
      res.bubble = null;
    }
    const fontPx = 12;
    const wrapped = wrapText(text, 168, fontPx, 4);
    const t = this.add
      .text(0, 0, wrapped, { fontFamily: FONT, fontSize: `${fontPx}px`, color: INK, lineSpacing: 4 })
      .setResolution(this.labelRes);
    const padX = 9;
    const padY = 7;
    const w = Math.max(40, Math.ceil(t.width) + padX * 2);
    const h = Math.ceil(t.height) + padY * 2;
    // parchment box from the shared 9-slice frame (public/assets/ui/frame-paper-s.png) + a stepped pointer
    const frame = this.add.nineslice(0, 0, KEYS.bubbleFrame, undefined, w, h, 4, 4, 4, 4).setOrigin(0.5, 1);
    const tail = this.add.image(0, -3, "bubble-tail").setOrigin(0.5, 0);
    t.setPosition(Math.round(-w / 2 + padX), Math.round(-h + padY));
    const box = this.add.container(0, 0, [frame, tail, t]);
    box.setAlpha(0);
    res.top.add(box);
    res.bubble = { box, shownAt: performance.now() };
  }

  private updateEmote(res: Resident): void {
    const a = res.data;
    let key: string | null = a.emote ?? null;
    if (!key) {
      if (a.activity === "sleeping") key = "sleep";
      else if (a.activity === "waiting") key = "wait";
    }
    if (key !== res.emoteKey) {
      res.emoteKey = key;
      if (!key) {
        res.emoteBg.setVisible(false);
        res.emoteIcon.setVisible(false);
      } else {
        const tex = key === "sleep" || key === "alert" ? `emote-${key}` : emoteTexture(key);
        if (this.textures.exists(tex)) {
          // glyph emotes are drawn 1:1; the 64 px icon art is shown at 16 px (a whole 1/4 scale)
          res.emoteIcon.setTexture(tex).setVisible(true);
          if (key === "sleep" || key === "alert") res.emoteIcon.setScale(1);
          else res.emoteIcon.setDisplaySize(16, 16);
          res.emoteBg.setVisible(true);
        } else {
          res.emoteBg.setVisible(false);
          res.emoteIcon.setVisible(false);
        }
      }
    }
  }

  // ───────────── slots ─────────────

  /** a location id we can place on the map (anything unknown falls back to the plaza) */
  private safeLoc(id: LocationId): LocationId {
    return this.model.locations[id] ? id : "plaza";
  }

  private slotTiles(loc: LocationId, homeSlot: number): TilePoint[] {
    if (loc === "home") return [this.model.homeDoors[((Math.floor(homeSlot) % 9) + 9) % 9].tile];
    const l = this.model.locations[loc];
    return l.slots.length > 0 ? l.slots : l.door ? [l.door] : [{ x: 1, y: 1 }];
  }

  private slotTile(res: Resident, loc: LocationId): TilePoint {
    const slots = this.slotTiles(loc, res.data.homeSlot);
    if (loc === "home") return slots[0];
    if (res.slotLoc !== loc || res.slotIdx < 0 || res.slotIdx >= slots.length) {
      // pick the free slot that is farthest from everybody already standing here
      const takenIdx = new Set<number>();
      const takenPts: TilePoint[] = [];
      for (const o of this.residents.values()) {
        if (o !== res && o.slotLoc === loc && o.slotIdx >= 0) {
          takenIdx.add(o.slotIdx);
          takenPts.push(slots[o.slotIdx]);
        }
      }
      const start = hashStr(res.id) % slots.length;
      let pick = -1;
      let bestD = -1;
      for (let k = 0; k < slots.length; k++) {
        const idx = (start + k) % slots.length;
        if (takenIdx.has(idx)) continue;
        const d = takenPts.length === 0 ? 1 : Math.min(...takenPts.map((t) => Math.hypot(t.x - slots[idx].x, t.y - slots[idx].y)));
        if (d > bestD + 0.5) {
          bestD = d;
          pick = idx;
        }
      }
      if (pick < 0) pick = start;
      res.slotLoc = loc;
      res.slotIdx = pick;
    }
    return slots[res.slotIdx];
  }

  private releaseSlot(res: Resident): void {
    res.slotLoc = null;
    res.slotIdx = -1;
  }

  private entryTile(loc: LocationId, homeSlot: number): TilePoint {
    return loc === "home" ? this.slotTiles("home", homeSlot)[0] : (this.model.locations[loc].door ?? this.slotTiles(loc, homeSlot)[0]);
  }

  /** a free walkable tile next to `t` inside the location (collaborators stand side by side) */
  private neighbourTile(loc: LocationId, t: TilePoint): TilePoint {
    const set = this.walkSets[loc];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
      const x = t.x + dx;
      const y = t.y + dy;
      if (set.has(y * this.model.width + x)) return { x, y };
    }
    return t;
  }

  // ───────────── per-frame resident logic ─────────────

  private tileKey(t: TilePoint): number {
    return t.y * this.model.width + t.x;
  }

  /** where this resident *should* be right now, according to logical state */
  private logicalTarget(res: Resident, simNow: number, dt: number, nowMs: number): { x: number; y: number; travelling: boolean; dirX: number; dirY: number } {
    const a = res.data;
    const loc = this.safeLoc(a.location);
    const home = a.homeSlot;

    // 1. on the road: walk the A* route between the two stand points, the elapsed fraction of the trip along it
    if (a.travel) {
      const tr = { ...a.travel, from: this.safeLoc(a.travel.from), to: this.safeLoc(a.travel.to) };
      const key = `${tr.from}>${tr.to}@${tr.startMs}`;
      if (res.travelKey !== key || !res.travelWalk) {
        res.travelKey = key;
        this.releaseSlot(res);
        const from = this.entryTile(tr.from, home);
        const to = this.slotTile(res, tr.to); // reserves the slot the resident will occupy on arrival
        const tiles = this.finder.find(from, to) ?? [from, to];
        res.travelWalk = tilesToWalk(tiles);
      }
      const span = Math.max(1, tr.endMs - tr.startMs);
      const p = clamp((simNow - tr.startMs) / span, 0, 1);
      const s = pointAlong(res.travelWalk, p * res.travelWalk.len);
      res.locShown = tr.to; // when the road ends we are *at* the destination already
      res.catchUp = null;
      res.wander = null;
      res.wBase = null;
      return { x: s.x, y: s.y, travelling: p < 1, dirX: s.dx, dirY: s.dy };
    }
    res.travelKey = null;
    res.travelWalk = null;

    // 2. location changed without travel info (fast-forward jump etc.) → walk there along the roads, quickly
    if (res.locShown !== loc) {
      const first = res.locShown === null;
      const base = this.standTile(res, loc);
      const basePx = tileToWorld(base);
      if (!first && !res.fresh) {
        const from = { x: res.x, y: res.y };
        if (dist(from, basePx) > 20) {
          const tiles = this.finder.find(worldToTile(from.x, from.y), base);
          if (tiles) {
            const walk = tilesToWalk(tiles, from, undefined);
            res.catchUp = { walk, dur: clamp(walk.len / CATCHUP_SPEED, 0.6, CATCHUP_MAX_S), t: 0 };
          }
        }
      }
      res.locShown = loc;
      res.wBase = null;
      res.wander = null;
    }
    if (res.catchUp) {
      const c = res.catchUp;
      c.t += dt;
      const k = clamp(c.t / c.dur, 0, 1);
      const s = pointAlong(c.walk, k * c.walk.len);
      if (k >= 1) res.catchUp = null;
      return { x: s.x, y: s.y, travelling: true, dirX: s.dx, dirY: s.dy };
    }

    // 3. standing at the location (collaborating, sleeping, waiting are still)
    const base = tileToWorld(this.standTile(res, loc));
    const still = a.activity === "sleeping" || a.activity === "waiting" || a.activity === "collaborating" || loc === "home";
    if (still) {
      res.wBase = base;
      res.wx = base.x;
      res.wy = base.y;
      res.wander = null;
      return { x: base.x, y: base.y, travelling: false, dirX: 0, dirY: 0 };
    }
    // gentle micro wander around the stand point, along tiles of the location's own area
    if (!res.wBase || dist(res.wBase, base) > 1) {
      res.wBase = base;
      res.wx = base.x;
      res.wy = base.y;
      res.wander = null;
      res.wUntil = nowMs + 800 + res.rng() * 3500;
    }
    if (res.wander) {
      const w = res.wander;
      w.d += WANDER_SPEED * dt;
      const s = pointAlong(w.walk, w.d);
      res.wx = s.x;
      res.wy = s.y;
      if (w.d >= w.walk.len) {
        res.wander = null;
        res.wUntil = nowMs + 2200 + res.rng() * 5200;
      }
      return { x: res.wx, y: res.wy, travelling: false, dirX: s.dx, dirY: s.dy };
    }
    if (nowMs >= res.wUntil) {
      const here = worldToTile(res.wx, res.wy);
      const baseTile = worldToTile(base.x, base.y);
      const loc3 = this.model.locations[loc];
      const near = loc3.walkTiles.filter((t) => Math.max(Math.abs(t.x - baseTile.x), Math.abs(t.y - baseTile.y)) <= 3 && (t.x !== here.x || t.y !== here.y) && this.model.grid.cost[this.tileKey(t)] <= 2);
      for (let tries = 0; tries < 6 && near.length > 0; tries++) {
        const cand = near[Math.floor(res.rng() * near.length)];
        const tiles = this.finder.find(here, cand);
        if (tiles && tiles.length > 1 && tiles.length <= 9) {
          res.wander = { walk: tilesToWalk(tiles, { x: res.wx, y: res.wy }), d: 0 };
          break;
        }
      }
      if (!res.wander) res.wUntil = nowMs + 3000;
    }
    return { x: res.wx, y: res.wy, travelling: false, dirX: 0, dirY: 0 };
  }

  /** the stand tile of a resident at a location (collaborators pair up side by side) */
  private standTile(res: Resident, loc: LocationId): TilePoint {
    const a = res.data;
    const base = this.slotTile(res, loc);
    if (a.activity === "collaborating" && a.partnerId && loc !== "home") {
      const partner = this.residents.get(a.partnerId);
      if (partner && !partner.data.travel && partner.data.location === loc && partner.data.activity === "collaborating") {
        // the lexicographically smaller id leads and keeps its slot; the follower stands right next to it
        const lead = a.id < partner.id ? res : partner;
        if (lead === res) return base;
        return this.neighbourTile(loc, this.slotTile(partner, loc));
      }
    }
    return base;
  }

  private updateResident(res: Resident, simNow: number, dt: number, nowMs: number, timeSec: number): void {
    const a = res.data;
    const tgt = this.logicalTarget(res, simNow, dt, nowMs);

    // follow the logical target with a little smoothing so state changes never teleport
    const px = res.x;
    const py = res.y;
    if (res.fresh) {
      res.x = tgt.x;
      res.y = tgt.y;
      res.fresh = false;
    } else if (res.catchUp) {
      res.x = tgt.x;
      res.y = tgt.y;
    } else {
      const dx = tgt.x - res.x;
      const dy = tgt.y - res.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) {
        const far = d > 80;
        const k = 1 - Math.exp(-dt * (far ? 3 : 8));
        const step = Math.min(d, Math.max(d * k, (far ? 90 : 18) * dt));
        res.x += (dx / d) * step;
        res.y += (dy / d) * step;
      }
    }
    const vx = dt > 0 ? (res.x - px) / dt : 0;
    const vy = dt > 0 ? (res.y - py) / dt : 0;
    const speed = Math.hypot(vx, vy);
    res.speedEma = lerp(res.speedEma, speed, 1 - Math.exp(-dt * 10));
    const sleeping = a.activity === "sleeping";
    const waiting = a.activity === "waiting";
    const onRoad = tgt.travelling && !sleeping;
    res.walking = !sleeping && (onRoad || res.speedEma > 6);

    // facing follows the direction of movement
    if (!sleeping && !waiting) {
      if (speed > 4) res.dir = dirFromVec(vx, vy, res.dir);
      else res.dir = dirFromVec(tgt.dirX, tgt.dirY, res.dir);
    }
    if (a.activity === "collaborating" && a.partnerId && !res.walking) {
      const partner = this.residents.get(a.partnerId);
      if (partner) res.dir = dirFromVec(partner.x - res.x, (partner.y - res.y) * 0.2, res.dir);
    }
    if (waiting || sleeping) res.dir = "down";

    // animation: walk cycle while moving, standing frame otherwise
    if (res.walking) {
      res.sprite.anims.play(animKey(res.texture, "walk", res.dir), true);
      res.sprite.anims.timeScale = clamp(0.75 + res.speedEma / 40, 0.75, 1.4);
    } else {
      if (res.sprite.anims.isPlaying) res.sprite.anims.stop();
      res.sprite.setFrame(frameIndex(res.dir));
    }
    res.sprite.x = 0;
    if (sleeping) {
      res.breathe += dt * 1.1;
      res.sprite.y = 0;
      res.sprite.setTint(0x8f9fd6);
      res.sprite.setAlpha(0.78);
      res.shadow.setAlpha(0.6);
    } else {
      const hop = waiting ? Math.max(0, Math.sin(timeSec * 2.4)) ** 6 * 1.6 : 0;
      res.sprite.y = -Math.round(hop);
      res.sprite.clearTint();
      res.sprite.setAlpha(1);
      res.shadow.setAlpha(0.9);
    }

    // placement + depth: y-sorted between the ground layers and the `above` layer
    res.root.setPosition(Math.round(res.x), Math.round(res.y));
    res.root.setDepth(DEPTH.residents + res.y);
    if (res.ring) {
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 3.2);
      res.ring.setScale(0.3 + pulse * 0.03);
      res.ring.setAlpha(0.65 + pulse * 0.35);
    }
    const selected = this.selectedId === res.id;
    res.sel.setVisible(selected);
    if (selected) res.sel.setAlpha(0.7 + 0.3 * Math.sin(timeSec * 5));

    // label / emote / bubble live in the top layer; scaled against zoom so text keeps its screen size
    const zoom = this.cameras.main.zoom;
    const s = clamp(1 / zoom, 0.18, 1.2);
    res.top.setScale(s);
    res.top.setPosition(Math.round(res.x), Math.round(res.y - CHAR_H - 2 / zoom - res.liftCur));
    res.top.setDepth(100 + res.y);
    this.updateEmote(res);
    if (res.emoteKey) {
      const bobY = Math.sin(timeSec * 3 + res.breathe) * 1.6;
      const ey = -(res.label.height + 14) + bobY;
      res.emoteBg.setY(ey);
      res.emoteIcon.setY(ey);
    }
    if (res.bubble) {
      const age = nowMs - res.bubble.shownAt;
      let alpha = 1;
      if (age < 160) alpha = age / 160;
      else if (age > BUBBLE_MS) alpha = 1 - (age - BUBBLE_MS) / BUBBLE_FADE_MS;
      if (age > BUBBLE_MS + BUBBLE_FADE_MS) {
        res.bubble.box.destroy();
        res.bubble = null;
      } else {
        const by = -(res.label.height + 4) - (res.emoteKey ? 26 : 0) - (1 - clamp(age / 160, 0, 1)) * 6;
        res.bubble.box.setPosition(0, by);
        res.bubble.box.setAlpha(clamp(alpha, 0, 1));
      }
    }
  }

  update(time: number, delta: number): void {
    if (!this.ready) return;
    const dt = Math.min(delta, 100) / 1000;
    const nowMs = performance.now();
    const simNow = this.estSimNow();
    for (const res of this.residents.values()) this.updateResident(res, simNow, dt, nowMs, time / 1000);
    this.updateDog(dt, nowMs);
    this.separateLabels(dt);
    this.updatePlaceLabels();
    this.updateGrade(dt);
    this.updateCamera(dt);
  }

  /** stack name tags upwards when two residents stand so close that the tags would overlap */
  private separateLabels(dt: number): void {
    const list = Array.from(this.residents.values()).sort((a, b) => a.y - b.y || a.x - b.x);
    const done: Resident[] = [];
    const zoom = this.cameras.main.zoom;
    const s = clamp(1 / zoom, 0.18, 1.2);
    const reachX = 52 * s;
    const step = 19 * s;
    for (const r of list) {
      let lift = 0;
      for (let pass = 0; pass < 4; pass++) {
        let hit = false;
        for (const o of done) {
          if (Math.abs(o.x - r.x) < reachX && Math.abs(o.y - o.lift - (r.y - lift)) < step) {
            hit = true;
            break;
          }
        }
        if (!hit) break;
        lift += step;
      }
      r.lift = lift;
      done.push(r);
    }
    const k = 1 - Math.exp(-dt * 10);
    for (const r of list) {
      r.liftCur = lerp(r.liftCur, r.lift, k);
      r.top.setY(Math.round(r.y - CHAR_H - 2 / zoom - r.liftCur));
    }
  }

  // ───────────── day / night ─────────────

  private updateGrade(dt: number): void {
    const w = this.snapshot?.world;
    let hourF = 21; // night-lit artwork until we know better
    if (w) hourF = w.hour + w.minute / 60 + (performance.now() - this.receivedAt) / 3_600_000;
    const target = gradeAt(hourF);
    if (!this.grade) this.grade = { ...target };
    const k = 1 - Math.exp(-dt * 2.2);
    const g = this.grade;
    g.bright = lerp(g.bright, target.bright, k);
    g.night = lerp(g.night, target.night, k);
    g.warm = lerp(g.warm, target.warm, k);
    g.warmColor = lerpColor(g.warmColor, target.warmColor, k);

    const key = `${g.bright.toFixed(3)}|${g.night.toFixed(3)}|${g.warm.toFixed(3)}`;
    if (key === this.lastGradeKey) return;
    this.lastGradeKey = key;
    this.dayLight.setFillStyle(0xfff3d6, clamp((g.bright - 1) * 0.6, 0, 0.5));
    this.warmOverlay.setFillStyle(g.warmColor, g.warm);
    this.nightOverlay.setFillStyle(0x0a1448, g.night);
  }

  // ───────────── camera ─────────────

  private defaultZoom(): number {
    return this.scale.width < 700 ? DEFAULT_ZOOM_PHONE : DEFAULT_ZOOM;
  }

  private onResize(): void {
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    if (w <= 0 || h <= 0) return;
    this.safe = w < 900 ? { l: 0, r: 64, t: 130, b: 170 } : { l: 380, r: 84, t: 64, b: 104 };
    // the map must always cover the viewport: that is the smallest zoom
    const cover = Math.max(w / this.mapW, h / this.mapH);
    const wasDefault = !this.userZoomed;
    this.minZoom = cover;
    if (wasDefault) cam.setZoom(clamp(this.defaultZoom(), cover, MAX_ZOOM));
    else cam.setZoom(clamp(cam.zoom, cover, MAX_ZOOM));
  }

  private centerOf(): Pt {
    const cam = this.cameras.main;
    return { x: cam.scrollX + cam.width / 2, y: cam.scrollY + cam.height / 2 };
  }

  private setCenter(x: number, y: number): void {
    const cam = this.cameras.main;
    cam.setScroll(x - cam.width / 2, y - cam.height / 2);
  }

  private screenToWorld(sx: number, sy: number, zoom = this.cameras.main.zoom): Pt {
    const cam = this.cameras.main;
    return {
      x: cam.width / 2 + (sx - cam.width / 2) / zoom + cam.scrollX,
      y: cam.height / 2 + (sy - cam.height / 2) / zoom + cam.scrollY
    };
  }

  private worldToScreen(wx: number, wy: number): Pt {
    const cam = this.cameras.main;
    const z = cam.zoom;
    return { x: (wx - cam.scrollX - cam.width / 2) * z + cam.width / 2, y: (wy - cam.scrollY - cam.height / 2) * z + cam.height / 2 };
  }

  /** zoom so that the world point under (sx, sy) stays under the cursor */
  private zoomAt(newZoom: number, sx: number, sy: number): void {
    const cam = this.cameras.main;
    const z = clamp(newZoom, this.minZoom, MAX_ZOOM);
    const before = this.screenToWorld(sx, sy);
    cam.setZoom(z);
    cam.setScroll(before.x - cam.width / 2 - (sx - cam.width / 2) / z, before.y - cam.height / 2 - (sy - cam.height / 2) / z);
  }

  private startCamAnim(id: string, zoomTo: number): void {
    const cam = this.cameras.main;
    const c = this.centerOf();
    this.zoomAnim = null;
    this.camAnim = { t: 0, dur: 0.7, id, zoomTo: clamp(zoomTo, this.minZoom, MAX_ZOOM), fromX: c.x, fromY: c.y, fromZ: cam.zoom };
    this.userZoomed = true;
  }

  private applySafeBounds(): void {
    const cam = this.cameras.main;
    const z = cam.zoom || 1;
    // the title screen has no HUD: the camera stays inside the map
    const { l, r, t, b } = this.titleMode ? { l: 0, r: 0, t: 0, b: 0 } : this.safe;
    cam.setBounds(-l / z, -t / z, this.mapW + (l + r) / z, this.mapH + (t + b) / z);
  }

  /** world point that puts (x, y) in the middle of the HUD-free area */
  private safeCenterFor(x: number, y: number): Pt {
    const z = this.cameras.main.zoom || 1;
    const { l, r, t, b } = this.safe;
    return { x: x - (l - r) / (2 * z), y: y - (t - b) / (2 * z) };
  }

  /** waypoints of the title drift: the centre of the busiest places, in a loop */
  private buildTitlePath(): void {
    const order: LocationId[] = ["plaza", "hall", "market", "workshop", "plaza", "mediation", "archive", "gate"];
    const pts: Pt[] = [];
    for (const id of order) {
      const loc = this.model.locations[id];
      const tile = loc?.door ?? loc?.slots[0];
      if (tile) pts.push(tileToWorld(tile));
    }
    this.titlePath = pts.length > 0 ? pts : [{ x: this.mapW / 2, y: this.mapH / 2 }];
  }

  /** put the camera on my Agent (or the plaza before there is one), as at the very first frame of a game */
  private recenterOnPlayer(): void {
    if (!this.ready) return;
    const cam = this.cameras.main;
    cam.setZoom(clamp(this.defaultZoom(), this.minZoom, MAX_ZOOM));
    this.applySafeBounds();
    const me = Array.from(this.residents.values()).find((r) => r.data.isPlayer);
    const at = me ? { x: me.x, y: me.y - 8 } : (this.titlePath[0] ?? { x: this.mapW / 2, y: this.mapH / 2 });
    const c = this.safeCenterFor(at.x, at.y);
    this.setCenter(c.x, c.y);
  }

  private updateTitleDrift(dt: number): void {
    const cam = this.cameras.main;
    const goal = this.titlePath[this.titleTarget % this.titlePath.length];
    const c = this.centerOf();
    const dx = goal.x - c.x;
    const dy = goal.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 14) this.titleTarget = (this.titleTarget + 1) % this.titlePath.length;
    const speed = 12; // world px / s: a slow, calm drift
    const k = 1 - Math.exp(-dt * 0.8); // turns are eased, never sharp
    this.titleVel.x += ((d > 0 ? (dx / d) * speed : 0) - this.titleVel.x) * k;
    this.titleVel.y += ((d > 0 ? (dy / d) * speed : 0) - this.titleVel.y) * k;
    const zoom = clamp(this.defaultZoom(), this.minZoom, MAX_ZOOM);
    cam.setZoom(lerp(cam.zoom, zoom, 1 - Math.exp(-dt * 3)));
    this.setCenter(c.x + this.titleVel.x * dt, c.y + this.titleVel.y * dt);
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    this.applySafeBounds();
    if (this.titleMode) {
      this.updateTitleDrift(dt);
      return;
    }
    if (this.panVec.x !== 0 || this.panVec.y !== 0) {
      // keyboard pan: ends follow, like dragging the map does
      if (this.followId) {
        this.followId = null;
        EventBus.emit("follow-changed", null);
      }
      this.camAnim = null;
      this.userZoomed = true;
      const len = Math.hypot(this.panVec.x, this.panVec.y) || 1;
      const sp = (340 * dt) / cam.zoom; // screen px / s -> world px
      cam.setScroll(cam.scrollX + (this.panVec.x / len) * sp, cam.scrollY + (this.panVec.y / len) * sp);
    }
    if (this.camAnim) {
      const an = this.camAnim;
      const res = this.residents.get(an.id);
      if (!res) {
        this.camAnim = null;
      } else {
        an.t += dt;
        const k = clamp(an.t / an.dur, 0, 1);
        const e = 1 - Math.pow(1 - k, 3);
        const z = lerp(an.fromZ, an.zoomTo, e);
        cam.setZoom(z);
        const goal = this.safeCenterFor(res.x, res.y - 8);
        this.setCenter(lerp(an.fromX, goal.x, e), lerp(an.fromY, goal.y, e));
        if (k >= 1) this.camAnim = null;
      }
      return;
    }
    if (this.zoomAnim) {
      const za = this.zoomAnim;
      const diff = za.target - cam.zoom;
      if (Math.abs(diff) < 0.002) {
        this.zoomAt(za.target, za.sx, za.sy);
        this.zoomAnim = null;
      } else {
        this.zoomAt(cam.zoom + diff * (1 - Math.exp(-dt * 14)), za.sx, za.sy);
      }
    }
    if (this.followId) {
      const res = this.residents.get(this.followId);
      if (res) {
        const c = this.centerOf();
        const k = 1 - Math.exp(-dt * 4.5);
        const goal = this.safeCenterFor(res.x, res.y - 8);
        this.setCenter(lerp(c.x, goal.x, k), lerp(c.y, goal.y, k));
      }
    }
  }

  getPlayerScreen(): { x: number; y: number } | null {
    if (!this.ready) return null;
    const me = Array.from(this.residents.values()).find((r) => r.data.isPlayer);
    if (!me) return null;
    const s = this.worldToScreen(me.x, me.y - CHAR_H * 0.5);
    if (s.x < 0 || s.y < 0 || s.x > this.scale.width || s.y > this.scale.height) return null;
    return s;
  }

  // ───────────── input ─────────────

  private onPointerDown(p: Phaser.Input.Pointer): void {
    this.downAt = { x: p.x, y: p.y };
    this.dragged = false;
    const p1 = this.input.pointer1;
    const p2 = this.input.pointer2;
    if (p1?.isDown && p2?.isDown) {
      this.pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) };
      this.dragged = true;
    }
  }

  private setHover(it: Interactable | null): void {
    this.hovered = it;
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const cam = this.cameras.main;
    const p1 = this.input.pointer1;
    const p2 = this.input.pointer2;
    if (p1?.isDown && p2?.isDown) {
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (this.pinch && this.pinch.dist > 0 && d > 0) {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        this.camAnim = null;
        this.zoomAnim = null;
        this.userZoomed = true;
        this.zoomAt(cam.zoom * (d / this.pinch.dist), mx, my);
      }
      this.pinch = { dist: d };
      this.dragged = true;
      return;
    }
    if (!p.isDown) {
      // hover: residents first, then buildings / landmarks
      const hit = this.hitResident(p.x, p.y);
      const w = this.screenToWorld(p.x, p.y);
      const it = hit ? null : interactableAt(this.model, w.x, w.y);
      this.setHover(it);
      this.input.setDefaultCursor(hit || it ? "pointer" : "grab");
      return;
    }
    if (!this.downAt) return;
    if (!this.dragged && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 6) {
      this.dragged = true;
      this.setHover(null);
      if (this.followId) {
        this.followId = null;
        EventBus.emit("follow-changed", null);
      }
      this.camAnim = null;
      this.input.setDefaultCursor("grabbing");
    }
    if (this.dragged) {
      const dx = (p.x - p.prevPosition.x) / cam.zoom;
      const dy = (p.y - p.prevPosition.y) / cam.zoom;
      cam.setScroll(cam.scrollX - dx, cam.scrollY - dy);
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    const p1 = this.input.pointer1;
    const p2 = this.input.pointer2;
    if (!(p1?.isDown && p2?.isDown)) this.pinch = null;
    const wasDrag = this.dragged;
    if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) {
      this.dragged = false;
      this.input.setDefaultCursor("grab");
    }
    if (wasDrag || !this.downAt) return;
    this.downAt = null;
    const hit = this.hitResident(p.x, p.y);
    if (hit) {
      EventBus.emit("location-selected", null);
      EventBus.emit("resident-selected", hit.id);
      return;
    }
    const w = this.screenToWorld(p.x, p.y);
    const it = interactableAt(this.model, w.x, w.y);
    EventBus.emit("resident-selected", null);
    EventBus.emit("location-selected", it ? it.location : null);
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    if (this.titleMode) return;
    this.stepZoom(dy < 0 ? 1 : -1, pointer.x, pointer.y);
  }

  /** one notch / key press = one zoom step (1, 1.5, 2, 2.5, 3, 4), so the pixel art keeps a tidy scale */
  private stepZoom(dir: 1 | -1, sx: number, sy: number): void {
    const cam = this.cameras.main;
    const base = this.zoomAnim ? this.zoomAnim.target : cam.zoom;
    const steps = Array.from(new Set([this.minZoom, ...ZOOM_STEPS.filter((z) => z > this.minZoom + 0.01 && z <= MAX_ZOOM)])).sort((a, b) => a - b);
    let idx = 0;
    for (let i = 0; i < steps.length; i++) if (Math.abs(steps[i] - base) < Math.abs(steps[idx] - base)) idx = i;
    const next = clamp(idx + dir, 0, steps.length - 1);
    this.camAnim = null;
    this.userZoomed = true;
    this.zoomAnim = { target: steps[next], sx, sy };
  }

  private hitResident(sx: number, sy: number): Resident | null {
    const w = this.screenToWorld(sx, sy);
    const zoom = this.cameras.main.zoom;
    const padX = Math.max(9, 20 / zoom);
    let best: Resident | null = null;
    for (const r of this.residents.values()) {
      const dx = Math.abs(w.x - r.x);
      const dyUp = r.y - w.y; // positive when the pointer is above the feet
      if (dx <= padX && dyUp >= -4 && dyUp <= CHAR_H + 6) {
        if (!best || r.y > best.y) best = r;
      }
    }
    return best;
  }

  // ───────────── debug overlay ─────────────

  private drawDebug(): void {
    const g = this.add.graphics().setDepth(DEPTH.hover - 1);
    const m = this.model;
    // blocked tiles
    g.fillStyle(0xff3030, 0.28);
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.grid.blocked[y * m.width + x]) g.fillRect(x * 16, y * 16, 16, 16);
    // costly (non-road) walkable tiles are left alone; stand areas, slots, doors
    for (const loc of Object.values(m.locations)) {
      g.lineStyle(1, 0x00ffff, 0.9);
      g.fillStyle(0x00ffff, 0.1);
      for (const r of loc.areas) {
        g.fillRect(r.x * 16, r.y * 16, r.w * 16, r.h * 16);
        g.strokeRect(r.x * 16, r.y * 16, r.w * 16, r.h * 16);
      }
      g.fillStyle(0x30ff30, 1);
      for (const s of loc.slots) g.fillCircle(s.x * 16 + 8, s.y * 16 + 8, 2);
      if (loc.door) {
        g.fillStyle(0xffff00, 1);
        g.fillCircle(loc.door.x * 16 + 8, loc.door.y * 16 + 8, 3);
      }
    }
    g.fillStyle(0xff80ff, 1);
    for (const h of m.homeDoors) g.fillCircle(h.tile.x * 16 + 8, h.tile.y * 16 + 8, 3);
    g.lineStyle(1, 0x60ff60, 0.9);
    for (const it of m.interactables) g.strokeRect(it.rect.x, it.rect.y, it.rect.w, it.rect.h);
  }

  /** dev helper: the path (world px) the finder would walk between two locations */
  debugPath(from: LocationId, to: LocationId, homeSlot = 0): Pt[] {
    const a = this.entryTile(from, homeSlot);
    const b = this.entryTile(to, homeSlot);
    return (this.finder.find(a, b) ?? []).map(tileToWorld);
  }
}
