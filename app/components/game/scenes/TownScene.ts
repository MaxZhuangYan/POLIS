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
  readTilesets,
  tileToWorld,
  worldToTile,
  type Interactable,
  type TiledMap,
  type TownModel
} from "@/app/components/town/tiled";
import { PathFinder, type TilePoint } from "@/app/components/town/pathfinding";
import { WALK_FPS, animKey, frameIndex, spriteTexture, type Direction } from "@/app/components/town/characters";
import { EventBus } from "../EventBus";
import { BG_COLOR, DEPTH, KEYS, MAP_ABOVE_LAYER, MAP_LAYERS, PIXEL_FONT, SCENES, emoteTexture, tilesetTextureKey } from "../keys";
import { planStands, type StandSpot } from "../standPlan";
import { layoutLabels, type LabelBox } from "../labelLayout";
import { CUE_KINDS, cuesForFeedItem, thinCues, type Cue, type CueIcon, type CueTone } from "../feedCues";

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
const CATCH_SPEED_MIN = 36; // px / s: walking back to a tile that changed (a partner arrived, a fast-forward moved the town on)
const CATCH_SPEED_MAX = 150;
const CATCH_SECONDS = 2.2; // a long way is covered in about this time (within the speed limits)
const TRIP_SPEED_MIN = 20; // px / s: a trip is walked at least this fast, so a short trip ends early and the resident waits at the door
const TRIP_SPEED_MAX = 100; // px / s: never faster than this when the clock jumps ahead
const WANDER_SPEED = 15; // px / s
const STRIDE_PX = 3; // ground covered per animation frame, so feet and ground move together
const GOLD = 0xf2c75c;
const CUE_MS = 2600; // a floating result lives this long
const CUE_STAGGER_MS = 300; // consecutive cues of one burst start this far apart
const CUE_MAX_PER_RESIDENT = 3;
const CUE_BURST_LIMIT = 8; // a fast-forward can bring dozens of feed items at once: at most this many cues per snapshot
const CUE_STALE_MS = 5000; // a queued cue older than this (the tab was hidden) is dropped, not replayed

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
/** move `v` towards `target` by at most `step`, never past it */
const approach = (v: number, target: number, step: number) => (target > v ? Math.min(target, v + step) : Math.max(target, v - step));

/** the guardian's name plate rides this many screen px above the head (its pointer fills the gap) */
const PLATE_LIFT = 3;

/** result-chip icons: pixel art, 2 px per pixel. X = the tone colour, O ink, G gold, H highlight, D dark gold */
const CUE_ICONS: Record<Exclude<CueIcon, "none">, string[]> = {
  coin: ["..OOO..", ".OHHGO.", "OHGGGDO", "OHGDGDO", "OGGGGDO", ".ODDDO.", "..OOO.."],
  check: [".....XX", "....XX.", "X..XX..", "XXXX...", ".XX....", "..X...."],
  cross: ["XX...XX", "XXX.XXX", ".XXXXX.", "..XXX..", ".XXXXX.", "XXX.XXX", "XX...XX"],
  heart: [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."],
  crack: [".XX.XX.", "XXX.XXX", "XXXX.XX", ".XX.XX.", "..XX.X.", "...X..."],
  star: ["...X...", "...X...", "XXXXXXX", ".XXXXX.", "..XXX..", ".XX.XX.", ".X...X."],
  alert: ["..XXX..", "..XXX..", "..XXX..", "...X...", ".......", "..XXX..", "..XXX.."],
  link: [".XXX.XXX.", "X...X...X", "X...X...X", ".XXX.XXX."]
};
const CUE_TONES: Record<CueTone, { css: string; edge: number }> = {
  gold: { css: "#ffd86a", edge: 0xf2c75c },
  green: { css: "#a8ec8f", edge: 0x7cc86a },
  red: { css: "#ff8e7e", edge: 0xe0584a },
  teal: { css: "#8fe3ff", edge: 0x58b8d8 },
  orange: { css: "#ffb55e", edge: 0xe08a30 },
  pink: { css: "#ff9ec7", edge: 0xe0709e },
  blue: { css: "#9bbcff", edge: 0x6f93e0 }
};

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
  w: number;
  h: number;
}

/** a floating result above a resident's head (a feed item turned into a short chip) */
interface CueView {
  box: Phaser.GameObjects.Container;
  born: number; // performance.now()
  key: string; // icon + text, to merge repeats
  y: number; // current offset (px above the stack), eased towards its slot
}

/** the line a resident is walking: a server-announced trip or a catch-up to a tile that changed */
interface Route {
  walk: Walk;
  d: number;
  kind: "travel" | "catch";
  /** catch-up speed, px / s */
  speed: number;
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
  ghost: Phaser.GameObjects.Sprite; // a see-through copy drawn over roofs and canopies while the resident is behind one
  light: Phaser.GameObjects.Image; // a soft lamp glow around the resident at night
  texture: string;
  top: Phaser.GameObjects.Container; // label + emote + bubble + cues (kept above all sprites)
  label: Phaser.GameObjects.Text;
  plate: Phaser.GameObjects.Graphics | null; // the guardian's Agent wears its name on a gold-edged plate
  emoteBg: Phaser.GameObjects.Image;
  emoteIcon: Phaser.GameObjects.Image;
  emoteKey: string | null;
  bubble: BubbleView | null;
  bubbleSeenAt: number | null;
  cues: CueView[];
  // motion
  x: number; // feet, world px
  y: number;
  dir: Direction;
  walking: boolean;
  speedEma: number;
  fresh: boolean; // first frame: snap to the planned place
  planLoc: LocationId; // where it is, or where its trip leads
  stand: StandSpot | null; // the tile it stands on there (never shared)
  standLoc: LocationId | null;
  travelKey: string | null; // the trip a route was built for
  route: Route | null;
  vis: number; // 0 = inside the house (asleep), 1 = on the street
  phase: number;
  // wander
  rng: () => number;
  wander: Wander | null;
  wUntil: number;
  // labels
  labelLevel: number; // lift steps of the name tag (hysteresis for the layout)
  labelLift: number; // current lift, screen px
  labelAlpha: number;
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
  private pairGfx!: Phaser.GameObjects.Graphics; // the ring under two residents who are working together
  private hovered: Interactable | null = null;
  private placeLabels: { id: LocationId; box: Phaser.GameObjects.Container; w: number; h: number; ax: number; ay: number; alpha: number }[] = [];
  private hoverResId: string | null = null;
  // night lights: doors, lamps (static) and a glow around every resident (see updateLights)
  private nightLights: { img: Phaser.GameObjects.Image; kind: "door" | "lamp"; base: number; homeSlot: number }[] = [];
  private lightK = 0; // 0 = day … 1 = full night: how much the lamps give
  // results on the map: feed items that arrived since the last snapshot become short chips above their actors
  private feedSeen: Set<number> | null = null;
  private feedMaxId = 0;
  private cueQueue: { actor: string; cue: Cue; at: number }[] = [];
  private faceCache = new Map<number, Direction | "none">();
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

    this.buildMap(raw);
    this.makeTextures();
    this.buildOverlays();
    this.buildLights(raw);
    this.buildDog();

    this.uiLayer = this.add.container(0, 0).setDepth(DEPTH.ui);
    this.buildPlaceLabels();
    this.hoverGfx = this.add.graphics().setDepth(DEPTH.hover);
    this.pairGfx = this.add.graphics().setDepth(DEPTH.residents - 1);
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

  private buildMap(raw: TiledMap): void {
    const map = this.make.tilemap({ key: KEYS.map });
    // every tileset the .tmj embeds, each backed by the image the Preloader loaded for it (margin / spacing / tile size
    // come from the .tmj); layers may mix tiles of all of them
    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const info of readTilesets(raw)) {
      const tileset = map.addTilesetImage(info.name, tilesetTextureKey(info.name), info.tilewidth, info.tileheight, info.margin, info.spacing);
      if (!tileset) throw new Error(`town map: tileset "${info.name}" is missing its image (see the Preloader log)`);
      tilesets.push(tileset);
    }
    // a layer the map does not have is simply not drawn (`npm run map:check` warns about the missing ones)
    MAP_LAYERS.forEach((name) => {
      if (map.getLayer(name)) map.createLayer(name, tilesets, 0, 0)?.setDepth(DEPTH[name]);
    });
    // roofs, canopies, torii beams: above every resident, so residents walk behind them
    if (map.getLayer(MAP_ABOVE_LAYER)) map.createLayer(MAP_ABOVE_LAYER, tilesets, 0, 0)?.setDepth(DEPTH.above);
    this.buildMapMargin(map, tilesets);
  }

  /** The land goes on past the map edge. The HUD-safe camera bounds let the view slide beyond the map when the
   *  Agent stands at an edge (so it is never hidden under a panel); there the player sees the town's ground,
   *  darkened and fading out, instead of the empty void. */
  private buildMapMargin(map: Phaser.Tilemaps.Tilemap, tilesets: Phaser.Tilemaps.Tileset[]): void {
    // the ground layer's commonest tile is what the town stands on (it may come from any of the map's tilesets)
    const counts = new Map<number, number>();
    for (const row of map.getLayer("ground")?.data ?? []) for (const t of row) if (t.index > 0) counts.set(t.index, (counts.get(t.index) ?? 0) + 1);
    const gid = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (gid === undefined) return;
    const tileset = tilesets.find((t) => t.containsTileIndex(gid));
    const at = tileset ? (tileset.getTileTextureCoordinates(gid) as { x: number; y: number } | null) : null;
    const tex = tileset?.image;
    if (!tileset || !at || !tex) return;
    if (!tex.has("map-margin")) tex.add("map-margin", 0, at.x, at.y, tileset.tileWidth, tileset.tileHeight);
    const M = 1024; // wider than any HUD inset at the smallest zoom
    const { mapW: w, mapH: h } = this;
    this.add
      .tileSprite(-M, -M, w + 2 * M, h + 2 * M, tex.key, "map-margin")
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
    // The guardian's Agent stands on a pixel ring, drawn 1:1 in world pixels (so it is 2-4 screen px thick at the
    // game's zoom): a gold band with a dark outline on both edges, readable on sand, grass, stone and at night.
    mk(
      "ring-gold",
      36,
      18,
      (c) => {
        const cx = 18;
        const cy = 9;
        const rx = 15.5;
        const ry = 6.5;
        for (let py = 0; py < 18; py++) {
          for (let px = 0; px < 36; px++) {
            const v = ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / ry) ** 2;
            let col: string | null = null;
            if (v >= 0.66 && v < 0.84) col = "#fff0b0"; // inner highlight
            else if (v >= 0.84 && v < 1.0) col = "#f2c75c"; // the gold band
            else if (v >= 1.0 && v < 1.22) col = "rgba(43,24,13,0.85)"; // outer outline
            else if (v >= 0.5 && v < 0.66) col = "rgba(43,24,13,0.45)"; // inner outline
            if (!col) continue;
            c.fillStyle = col;
            c.fillRect(px, py, 1, 1);
          }
        }
      },
      true
    );
    // soft light pools for the night (added on top of the night grade; see updateLights)
    mk("light-soft", 128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,236,190,0.95)");
      g.addColorStop(0.25, "rgba(255,206,130,0.6)");
      g.addColorStop(0.6, "rgba(255,170,80,0.2)");
      g.addColorStop(1, "rgba(255,150,60,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
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

  /** a 1-px stepped-corner rectangle (the pixel-art plate shape used by plaques, name plates and result chips) */
  private steppedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    g.fillRect(x + 1, y, w - 2, h);
    g.fillRect(x, y + 1, w, h - 2);
  }

  private buildPlaceLabels(): void {
    // One small plaque per place, above its biggest building / landmark; the residential district gets one over its
    // first row of houses (each house shows its own on hover). A plaque is a dark plate with cream text, so it never
    // reads like a resident's name (plain outlined text).
    const make = (id: LocationId, label: string, ax: number, ay: number) => {
      const text = this.add.text(0, 0, label, { fontFamily: FONT, fontSize: "12px", color: "#fff3d0" }).setOrigin(0.5, 0.5).setResolution(this.labelRes);
      const w = Math.ceil(text.width) + 12;
      const h = Math.ceil(text.height) + 3;
      const g = this.add.graphics();
      g.fillStyle(0x2b180d, 0.5);
      this.steppedRect(g, -w / 2, -h + 1, w, h); // a 1 px drop shadow
      g.fillStyle(0xd9b36a, 0.95);
      this.steppedRect(g, -w / 2, -h, w, h);
      g.fillStyle(0x3a2412, 0.92);
      this.steppedRect(g, -w / 2 + 1, -h + 1, w - 2, h - 2);
      text.setPosition(0, Math.round(-h / 2));
      const box = this.add.container(0, 0, [g, text]);
      this.uiLayer.add(box);
      this.placeLabels.push({ id, box, w, h, ax, ay, alpha: 1 });
    };
    for (const id of Object.keys(this.model.locations) as LocationId[]) {
      const loc = this.model.locations[id];
      if (id === "home") {
        const top = loc.areas.reduce((m, r) => Math.min(m, r.y), Infinity);
        const left = loc.areas.reduce((m, r) => Math.min(m, r.x), Infinity);
        const right = loc.areas.reduce((m, r) => Math.max(m, r.x + r.w), -Infinity);
        if (Number.isFinite(top)) make(id, loc.label, ((left + right) / 2) * 16, top * 16 + 6);
        continue;
      }
      const its = this.model.interactables.filter((i) => i.location === id);
      if (its.length === 0) continue;
      const big = its.reduce((a, b) => (b.rect.w * b.rect.h > a.rect.w * a.rect.h ? b : a));
      make(id, loc.label, big.rect.x + big.rect.w / 2, big.rect.y + 2);
    }
  }

  private updateHover(): void {
    const zoom = this.cameras.main.zoom;
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
        res.ghost.destroy();
        res.light.destroy();
        this.residents.delete(id);
        if (this.selectedId === id) this.selectedId = null;
        if (this.followId === id) this.followId = null;
      }
    }
    this.planAllStands();
    this.ingestFeed();
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
    const ring = isMe ? this.add.image(0, 1, "ring-gold").setOrigin(0.5, 0.5) : null;
    const sel = this.add.image(0, 0, "ring-sel").setOrigin(0.5, 0.5).setScale(0.3).setVisible(false);
    const sprite = this.add.sprite(0, 0, texture, frameIndex("down")).setOrigin(0.5, 1);
    root.add([shadow]);
    if (ring) root.add(ring);
    root.add([sel, sprite]);
    // behind a roof or a canopy the resident is only a see-through copy of itself, drawn above the roof layer
    const ghost = this.add.sprite(0, 0, texture, frameIndex("down")).setOrigin(0.5, 1).setDepth(DEPTH.above + 1).setVisible(false);
    ghost.setTintFill(isMe ? 0xffe27a : 0xfff3d6);
    const light = this.add
      .image(0, 0, "light-soft")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH.grade + 3)
      .setScale(isMe ? 0.7 : 0.46)
      .setTint(isMe ? 0xffd27a : 0xffe2b0)
      .setVisible(false);

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
    const plate = isMe ? this.add.graphics() : null;
    const emoteBg = this.add.image(0, -22, "emote-bg").setVisible(false);
    const emoteIcon = this.add.image(0, -22, emoteTexture("think")).setDisplaySize(16, 16).setVisible(false);
    top.add(plate ? [plate, label, emoteBg, emoteIcon] : [label, emoteBg, emoteIcon]);
    this.uiLayer.add(top);

    const seed = hashStr(a.id);
    const res: Resident = {
      id: a.id,
      data: a,
      root,
      shadow,
      ring,
      sel,
      sprite,
      ghost,
      light,
      texture,
      top,
      label,
      plate,
      emoteBg,
      emoteIcon,
      emoteKey: null,
      bubble: null,
      bubbleSeenAt: null,
      cues: [],
      x: 0,
      y: 0,
      dir: "down",
      walking: false,
      speedEma: 0,
      fresh: true,
      planLoc: this.safeLoc(a.travel ? a.travel.to : a.location),
      stand: null,
      standLoc: null,
      travelKey: null,
      route: null,
      vis: a.activity === "sleeping" && !a.travel && a.location === "home" ? 0 : 1,
      phase: (seed % 628) / 100,
      rng: mulberry32(seed),
      wander: null,
      wUntil: 0,
      labelLevel: 0,
      labelLift: 0,
      labelAlpha: 1
    };
    this.drawPlate(res);
    return res;
  }

  /** the dark, gold-edged plate (with a pointer towards the head) behind the guardian's Agent's name */
  private drawPlate(res: Resident): void {
    const g = res.plate;
    if (!g) return;
    const w = Math.ceil(res.label.width) + 8;
    const h = Math.ceil(res.label.height) + 2;
    const y0 = -PLATE_LIFT; // the plate's bottom edge
    g.clear();
    g.fillStyle(0x2b180d, 0.45);
    this.steppedRect(g, -w / 2, y0 - h + 2, w, h);
    g.fillStyle(0xf2c75c, 1);
    this.steppedRect(g, -w / 2, y0 - h + 1, w, h);
    g.fillStyle(0x2b180d, 0.94);
    this.steppedRect(g, -w / 2 + 1, y0 - h + 2, w - 2, h - 2);
    // the pointer: a gold stepped triangle under the plate
    g.fillStyle(0xf2c75c, 1);
    g.fillRect(-3, y0 + 1, 7, 1);
    g.fillRect(-2, y0 + 2, 5, 1);
    g.fillRect(-1, y0 + 3, 3, 1);
    g.fillStyle(0x2b180d, 0.94);
    g.fillRect(-2, y0, 5, 1);
    g.fillRect(-1, y0 + 1, 3, 1);
    res.label.setY(y0 - 1);
  }

  private applyData(res: Resident, a: AgentView): void {
    const prev = res.data;
    res.data = a;
    if (prev.sprite !== a.sprite) {
      res.texture = spriteTexture(a.sprite);
      res.sprite.setTexture(res.texture, frameIndex(res.dir));
      res.ghost.setTexture(res.texture, frameIndex(res.dir));
    }
    if (prev.name !== a.name || prev.isPlayer !== a.isPlayer) {
      res.label.setText(a.isPlayer ? `★ ${a.name}` : a.name);
      this.drawPlate(res);
    }
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
    res.bubble = { box, shownAt: performance.now(), w, h: h + 6 };
  }

  /** whether the resident has come to rest (not on a road, not walking): only then do sleep / work poses apply */
  private settled(res: Resident): boolean {
    return !res.route && !res.walking;
  }

  private updateEmote(res: Resident): void {
    const a = res.data;
    let key: string | null = a.emote ?? null;
    if (!key) {
      if (a.activity === "sleeping") key = "sleep";
      else if (a.activity === "waiting") key = "wait";
    }
    // the sleep symbol belongs to someone in bed, not to a resident who is still walking home
    if (key === "sleep" && !this.settled(res)) key = null;
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

  // ───────────── where everybody stands ─────────────

  /** a location id we can place on the map (anything unknown falls back to the plaza) */
  private safeLoc(id: LocationId): LocationId {
    return this.model.locations[id] ? id : "plaza";
  }

  private slotTiles(loc: LocationId, homeSlot: number): TilePoint[] {
    if (loc === "home") {
      const n = this.model.homeDoors.length; // 9 in the town; a smaller map wraps the slots onto its doors
      return [this.model.homeDoors[((Math.floor(homeSlot) % n) + n) % n].tile];
    }
    const l = this.model.locations[loc];
    return l.slots.length > 0 ? l.slots : l.door ? [l.door] : [{ x: 1, y: 1 }];
  }

  private entryTile(loc: LocationId, homeSlot: number): TilePoint {
    return loc === "home" ? this.slotTiles("home", homeSlot)[0] : (this.model.locations[loc].door ?? this.slotTiles(loc, homeSlot)[0]);
  }

  private tileKey(t: TilePoint): number {
    return t.y * this.model.width + t.x;
  }

  /** Give every resident its own tile at the place it is (or is walking) to. Runs with every snapshot; it is sticky,
   *  so people who already stand somewhere valid stay put. Collaborators stand side by side, people who are
   *  socializing at the same place gather in small groups, and nobody shares a tile (see standPlan.ts). */
  private planAllStands(): void {
    const byLoc = new Map<LocationId, Resident[]>();
    for (const r of this.residents.values()) {
      const a = r.data;
      const loc = this.safeLoc(a.travel ? a.travel.to : a.location);
      r.planLoc = loc;
      if (loc === "home") {
        r.stand = { tile: this.slotTiles("home", a.homeSlot)[0], mate: null, lead: true };
        r.standLoc = "home";
        continue;
      }
      const list = byLoc.get(loc);
      if (list) list.push(r);
      else byLoc.set(loc, [r]);
    }
    const w = this.model.width;
    for (const [loc, list] of byLoc) {
      const l = this.model.locations[loc];
      const set = this.walkSets[loc];
      const plan = planStands(
        list.map((r) => ({
          id: r.id,
          isPlayer: r.data.isPlayer,
          activity: r.data.activity,
          partnerId: r.data.partnerId,
          prev: r.stand && r.standLoc === loc ? r.stand.tile : null
        })),
        {
          slots: l.slots.length > 0 ? l.slots : l.door ? [l.door] : [],
          tiles: l.walkTiles,
          walkable: (x, y) => set.has(y * w + x),
          bench: (x, y) => this.benchFacing(x, y) !== null
        }
      );
      for (const r of list) {
        const spot = plan.get(r.id);
        if (spot) {
          r.stand = spot;
          r.standLoc = loc;
        }
      }
    }
  }

  /** which way someone working at (x, y) faces: towards the counter / forge / wall next to the tile; null in the open */
  private benchFacing(x: number, y: number): Direction | null {
    const k = y * this.model.width + x;
    let d = this.faceCache.get(k);
    if (d === undefined) {
      const g = this.model.grid;
      const blocked = (bx: number, by: number) => bx < 0 || by < 0 || bx >= g.width || by >= g.height || g.blocked[by * g.width + bx] === 1;
      d = blocked(x, y - 1) ? "up" : blocked(x, y + 1) ? "down" : blocked(x - 1, y) ? "left" : blocked(x + 1, y) ? "right" : "none";
      this.faceCache.set(k, d);
    }
    return d === "none" ? null : d;
  }

  // ───────────── per-frame resident logic ─────────────

  /** another resident stands on, or is walking to, this tile */
  private tileBusy(res: Resident, t: TilePoint): boolean {
    const k = this.tileKey(t);
    const c = tileToWorld(t);
    for (const o of this.residents.values()) {
      if (o === res) continue;
      if (o.stand && this.tileKey(o.stand.tile) === k) return true;
      if (Math.hypot(o.x - c.x, o.y - c.y) < 12) return true;
    }
    return false;
  }

  /** Move one resident for this frame, along the road network only: a trip the server announced (walked at least as
   *  fast as TRIP_SPEED_MIN, so a short trip ends early and the resident waits at the door), a catch-up when the planned
   *  tile changed, or a short stroll for someone who is just looking around. Returns the walking direction. */
  private moveResident(res: Resident, simNow: number, dt: number, nowMs: number): { dx: number; dy: number } {
    const a = res.data;
    const tile = res.stand?.tile ?? this.entryTile(res.planLoc, a.homeSlot);

    // 1. a trip the server announced: build the route once, from where the resident actually is
    if (a.travel) {
      const tr = a.travel;
      const tkey = `${tr.from}>${tr.to}@${tr.startMs}`;
      if (res.travelKey !== tkey) {
        res.travelKey = tkey;
        res.wander = null;
        const fromTile = res.fresh ? this.entryTile(this.safeLoc(tr.from), a.homeSlot) : worldToTile(res.x, res.y);
        const tiles = this.finder.find(fromTile, tile) ?? [fromTile, tile];
        res.route = { walk: tilesToWalk(tiles, res.fresh ? undefined : { x: res.x, y: res.y }), d: 0, kind: "travel", speed: 0 };
      }
    } else {
      res.travelKey = null; // an unfinished route is walked to its end below
    }

    // 2. standing: settle on the planned tile, or walk there when the plan changed (a partner arrived, the clock jumped)
    if (!res.route) {
      if (res.fresh) {
        const p = tileToWorld(tile);
        res.x = p.x;
        res.y = p.y;
        res.wander = null;
        return { dx: 0, dy: 0 };
      }
      const canWander = a.activity === "idle" && res.planLoc !== "home" && !a.travel;
      const here = worldToTile(res.x, res.y);
      const away = here.x !== tile.x || here.y !== tile.y;
      // an idle resident may stroll within three tiles of its stand tile; everybody else belongs exactly on it
      const strolling = canWander && Math.max(Math.abs(here.x - tile.x), Math.abs(here.y - tile.y)) <= 3;
      if (away && !strolling) {
        const tiles = this.finder.find(here, tile) ?? [here, tile];
        const walk = tilesToWalk(tiles, { x: res.x, y: res.y });
        res.wander = null;
        res.route = { walk, d: 0, kind: "catch", speed: clamp(walk.len / CATCH_SECONDS, CATCH_SPEED_MIN, CATCH_SPEED_MAX) };
      }
    }

    // 3. on a route: advance along it
    if (res.route) {
      const r = res.route;
      const len = r.walk.len;
      let goal = len;
      if (r.kind === "travel" && a.travel && res.travelKey) {
        const tr = a.travel;
        const p = clamp((simNow - tr.startMs) / Math.max(1, tr.endMs - tr.startMs), 0, 1);
        goal = Math.min(len, Math.max(p * len, (Math.max(0, simNow - tr.startMs) / 1000) * TRIP_SPEED_MIN));
      }
      if (res.fresh) r.d = goal;
      else if (r.kind === "travel") r.d = Math.max(r.d, Math.min(goal, r.d + TRIP_SPEED_MAX * dt));
      else r.d = Math.min(len, r.d + r.speed * dt);
      const s = pointAlong(r.walk, r.d);
      res.x = s.x;
      res.y = s.y;
      if (r.d >= len - 0.01) res.route = null;
      return { dx: s.dx, dy: s.dy };
    }

    // 4. at rest. Only someone who is idle strolls around; everybody else keeps their tile
    const canWander = a.activity === "idle" && res.planLoc !== "home" && !a.travel;
    if (!canWander) {
      res.wander = null;
      return { dx: 0, dy: 0 };
    }
    if (res.wander) {
      const w = res.wander;
      w.d += WANDER_SPEED * dt;
      const s = pointAlong(w.walk, w.d);
      res.x = s.x;
      res.y = s.y;
      if (w.d >= w.walk.len) {
        res.wander = null;
        res.wUntil = nowMs + 2200 + res.rng() * 5200;
      }
      return { dx: s.dx, dy: s.dy };
    }
    if (res.wUntil === 0) res.wUntil = nowMs + 800 + res.rng() * 3500;
    if (nowMs >= res.wUntil) {
      const here = worldToTile(res.x, res.y);
      const base = tile;
      const walkTiles = this.model.locations[res.planLoc].walkTiles;
      const near = walkTiles.filter(
        (t) => Math.max(Math.abs(t.x - base.x), Math.abs(t.y - base.y)) <= 3 && (t.x !== here.x || t.y !== here.y) && this.model.grid.cost[this.tileKey(t)] <= 2 && !this.tileBusy(res, t)
      );
      for (let tries = 0; tries < 6 && near.length > 0; tries++) {
        const cand = near[Math.floor(res.rng() * near.length)];
        const tiles = this.finder.find(here, cand);
        if (tiles && tiles.length > 1 && tiles.length <= 9) {
          res.wander = { walk: tilesToWalk(tiles, { x: res.x, y: res.y }), d: 0 };
          break;
        }
      }
      if (!res.wander) res.wUntil = nowMs + 3000;
    }
    return { dx: 0, dy: 0 };
  }

  /** the way a resident at rest faces, or null to keep the current facing */
  private restFacing(res: Resident, timeSec: number): Direction | null {
    const a = res.data;
    if (a.activity === "sleeping") return "down";
    const working = a.activity === "working" || a.activity === "collaborating";
    // at work they face the counter / forge / shelf next to them (partners at one bench face the same bench)
    if (working && res.stand) {
      const bench = this.benchFacing(res.stand.tile.x, res.stand.tile.y);
      if (bench) return bench;
    }
    // collaborators and people chatting look at each other
    const mate = res.stand?.mate ? this.residents.get(res.stand.mate) : undefined;
    if (mate && !mate.route && mate.planLoc === res.planLoc && Math.hypot(mate.x - res.x, mate.y - res.y) < 40) {
      return dirFromVec(mate.x - res.x, (mate.y - res.y) * 0.4, res.dir);
    }
    // waiting for the guardian (or for a partner): glances left and right, never jumps about
    if (a.activity === "waiting") return (["down", "left", "down", "right"] as const)[Math.floor(timeSec / 1.6 + res.phase) % 4];
    if (working) return "down";
    if (res.planLoc === "home") return "up"; // in front of the house, facing the door
    return null;
  }

  /** The pairing cue: two residents who are working together stand on one teal ring (under both, above the ground), so
   *  "these two are doing a job together" reads at any zoom, in addition to facing each other and tapping in counter-step. */
  private updatePairs(timeSec: number): void {
    const g = this.pairGfx;
    g.clear();
    const pulse = 0.5 + 0.5 * Math.sin(timeSec * 3);
    for (const r of this.residents.values()) {
      if (!r.stand?.lead || !r.stand.mate || r.data.activity !== "collaborating") continue;
      const m = this.residents.get(r.stand.mate);
      if (!m || m.data.activity !== "collaborating" || m.planLoc !== r.planLoc) continue;
      if (r.route || m.route || Math.hypot(r.x - m.x, r.y - m.y) > 40) continue;
      const cx = (r.x + m.x) / 2;
      const cy = (r.y + m.y) / 2 - 1;
      const w = Math.abs(r.x - m.x) + 30;
      const h = Math.abs(r.y - m.y) + 14;
      g.lineStyle(3, 0x2b180d, 0.5);
      g.strokeEllipse(Math.round(cx), Math.round(cy + 1), w, h);
      g.lineStyle(2, 0x7fdcf5, 0.55 + 0.35 * pulse);
      g.strokeEllipse(Math.round(cx), Math.round(cy), w, h);
    }
  }

  /** how much of the resident's body is behind a roof / canopy / beam tile (0..1) */
  private coveredAmount(x: number, y: number): number {
    const m = this.model;
    let hits = 0;
    for (const [ox, oy] of [[-5, -14], [5, -14], [0, -8], [-5, -3], [5, -3]]) {
      const tx = Math.floor((x + ox) / 16);
      const ty = Math.floor((y + oy) / 16);
      if (tx >= 0 && ty >= 0 && tx < m.width && ty < m.height && m.covered[ty * m.width + tx]) hits++;
    }
    return hits / 5;
  }

  private updateResident(res: Resident, simNow: number, dt: number, nowMs: number, timeSec: number): void {
    const a = res.data;
    const px = res.x;
    const py = res.y;
    const wasFresh = res.fresh;
    const mv = this.moveResident(res, simNow, dt, nowMs);
    res.fresh = false;

    // measured speed -> walking state (with a little hysteresis) -> facing + animation
    const vx = dt > 0 && !wasFresh ? (res.x - px) / dt : 0;
    const vy = dt > 0 && !wasFresh ? (res.y - py) / dt : 0;
    const speed = Math.hypot(vx, vy);
    res.speedEma = lerp(res.speedEma, speed, 1 - Math.exp(-dt * 10));
    res.walking = res.speedEma > (res.walking ? 1.2 : 2.6);
    const settled = this.settled(res);

    if (res.walking) {
      res.dir = Math.abs(mv.dx) + Math.abs(mv.dy) > 0.01 ? dirFromVec(mv.dx, mv.dy, res.dir) : dirFromVec(vx, vy, res.dir);
    } else if (settled) {
      const f = this.restFacing(res, timeSec);
      if (f) res.dir = f;
    }

    if (res.walking) {
      res.sprite.anims.play(animKey(res.texture, "walk", res.dir), true);
      // feet and ground move together: the cycle runs as fast as the ground goes by
      res.sprite.anims.timeScale = clamp(res.speedEma / (STRIDE_PX * WALK_FPS), 0.3, 1.8);
    } else {
      if (res.sprite.anims.isPlaying) res.sprite.anims.stop();
      res.sprite.setFrame(frameIndex(res.dir));
    }

    // poses at rest: a worker taps (a partner in counter-step), someone speaking nods, a sleeper goes indoors
    const asleepInside = a.activity === "sleeping" && res.planLoc === "home" && settled;
    const asleepOutside = a.activity === "sleeping" && res.planLoc !== "home" && settled;
    res.vis = wasFresh ? (asleepInside ? 0 : 1) : approach(res.vis, asleepInside ? 0 : 1, dt * 2.2);
    let tap = 0;
    if (settled && (a.activity === "working" || a.activity === "collaborating")) {
      tap = Math.sin(timeSec * 7 + res.phase + (res.stand?.lead === false ? Math.PI : 0)) > 0.45 ? 1 : 0;
    } else if (settled && res.bubble && a.activity !== "sleeping") {
      tap = Math.sin(timeSec * 9) > 0.7 ? 1 : 0;
    }
    res.sprite.x = 0;
    res.sprite.y = -tap;
    if (asleepOutside) {
      res.sprite.setTint(0x8f9fd6);
      res.sprite.setAlpha(0.78 * res.vis);
    } else {
      res.sprite.clearTint();
      res.sprite.setAlpha(res.vis);
    }
    res.sprite.setVisible(res.vis > 0.02);
    res.shadow.setAlpha(0.9 * res.vis);

    // placement + depth: y-sorted between the ground layers and the `above` layer
    res.root.setPosition(Math.round(res.x), Math.round(res.y));
    res.root.setDepth(DEPTH.residents + res.y);
    if (res.ring) {
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 3.2);
      res.ring.setAlpha(0.7 + pulse * 0.3);
    }
    const selected = this.selectedId === res.id;
    res.sel.setVisible(selected);
    if (selected) res.sel.setAlpha(0.7 + 0.3 * Math.sin(timeSec * 5));

    // see-through copy while a roof, canopy or beam hides the resident
    const cover = res.vis > 0.5 ? this.coveredAmount(res.x, res.y) : 0;
    if (cover >= 0.4) {
      res.ghost.setVisible(true);
      res.ghost.setFrame(res.sprite.frame.name);
      res.ghost.setPosition(Math.round(res.x), Math.round(res.y - tap));
      res.ghost.setAlpha((a.isPlayer ? 0.62 : 0.4) * cover);
    } else if (res.ghost.visible) {
      res.ghost.setVisible(false);
    }

    // a lamp glow around the resident at night (nobody glows from inside their bed)
    const glow = this.lightK * (a.isPlayer ? 0.8 : 0.5) * res.vis;
    if (glow > 0.02) {
      res.light.setVisible(true);
      res.light.setAlpha(glow);
      res.light.setPosition(Math.round(res.x), Math.round(res.y - 7));
    } else if (res.light.visible) {
      res.light.setVisible(false);
    }

    this.updateEmote(res);
  }

  /** label / emote / bubble / cues live in the top layer, scaled against zoom so text keeps its screen size */
  private updateTop(res: Resident, nowMs: number, timeSec: number): void {
    const zoom = this.cameras.main.zoom;
    const s = clamp(1 / zoom, 0.18, 1.2);
    const base = res.plate ? PLATE_LIFT + 3 : 0; // the guardian's name plate rides a little higher (its pointer needs room)
    res.top.setScale(s);
    res.top.setPosition(Math.round(res.x), Math.round(res.y - CHAR_H - (2 + res.labelLift) / zoom));
    res.top.setDepth(100 + res.y);
    res.top.setAlpha(res.labelAlpha);
    res.top.setVisible(res.labelAlpha > 0.02);
    const lh = res.label.height;
    if (res.emoteKey) {
      const bobY = Math.sin(timeSec * 3 + res.phase) * 1.6;
      const ey = -(base + lh + 14) + bobY;
      res.emoteBg.setY(Math.round(ey));
      res.emoteIcon.setY(Math.round(ey));
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
        const by = -(base + lh + 4) - (res.emoteKey ? 26 : 0) - (1 - clamp(age / 160, 0, 1)) * 6;
        res.bubble.box.setPosition(0, Math.round(by));
        res.bubble.box.setAlpha(clamp(alpha, 0, 1));
      }
    }
  }

  /** how far above the tag's baseline (screen px) the resident's stack of label + emote + bubble reaches */
  private stackHeight(res: Resident): number {
    const base = res.plate ? PLATE_LIFT + 3 : 0;
    const lh = res.label.height;
    let top = base + lh;
    if (res.emoteKey) top = Math.max(top, base + lh + 26);
    if (res.bubble) top = Math.max(top, base + lh + 4 + (res.emoteKey ? 26 : 0) + res.bubble.h);
    return top;
  }

  update(time: number, delta: number): void {
    if (!this.ready) return;
    const dt = Math.min(delta, 100) / 1000;
    const nowMs = performance.now();
    const simNow = this.estSimNow();
    this.updateGrade(dt);
    for (const res of this.residents.values()) this.updateResident(res, simNow, dt, nowMs, time / 1000);
    this.updateDog(dt, nowMs);
    this.updatePairs(time / 1000);
    this.layoutLabels(dt);
    for (const res of this.residents.values()) this.updateTop(res, nowMs, time / 1000);
    this.updateCues(dt, nowMs);
    this.updateLights();
    this.updateHover();
    this.updateCamera(dt);
  }

  /** Name tags in screen space: every tag tries to sit right above its owner; when that spot is taken it is lifted a
   *  step, and when the highest step is taken too, the lowest-priority tag is hidden. The guardian's Agent, the
   *  selected / hovered resident and anyone showing a cue or a line of speech are never hidden. Place plaques take
   *  part as the lowest priority (they hide instead of lifting). */
  private layoutLabels(dt: number): void {
    const zoom = this.cameras.main.zoom;
    const boxes: LabelBox[] = [];
    const k = 1 - Math.exp(-dt * 12);
    for (const r of this.residents.values()) {
      const sc = this.worldToScreen(r.x, r.y);
      const lw = Math.ceil(r.label.width) + (r.plate ? 8 : 2);
      const width = Math.max(lw, r.emoteKey ? 24 : 0, r.bubble ? r.bubble.w : 0);
      const pinned = r.data.isPlayer || this.selectedId === r.id || this.hoverResId === r.id || r.cues.length > 0 || !!r.bubble;
      boxes.push({
        id: r.id,
        x: sc.x,
        y: sc.y - CHAR_H * zoom - 2,
        w: width,
        h: this.stackHeight(r),
        priority: r.data.isPlayer ? 0 : this.selectedId === r.id || this.hoverResId === r.id ? 1 : pinned ? 2 : 10,
        pinned,
        maxLevel: 2,
        level: r.labelLevel,
        // (only the name tag's own height decides the lift step: stacks above it follow it)
      });
    }
    const showPlaces = zoom <= 3.4;
    for (const l of this.placeLabels) {
      const hide = !showPlaces || this.hovered?.location === l.id;
      if (hide) continue;
      const sc = this.worldToScreen(l.ax, l.ay);
      boxes.push({ id: `place:${l.id}`, x: sc.x, y: sc.y - 2, w: l.w, h: l.h, priority: 50, pinned: false, maxLevel: 0, level: 0 });
    }
    const slots = layoutLabels(boxes, 17, 2);
    for (const r of this.residents.values()) {
      const slot = slots.get(r.id);
      const lift = slot ? slot.level * 17 : 0;
      if (slot) r.labelLevel = slot.level;
      r.labelLift = lerp(r.labelLift, lift, k);
      r.labelAlpha = lerp(r.labelAlpha, slot?.hidden ? 0 : 1, k);
      if (Math.abs(r.labelAlpha - (slot?.hidden ? 0 : 1)) < 0.02) r.labelAlpha = slot?.hidden ? 0 : 1;
    }
    const s = clamp(1 / zoom, 0.18, 1.2);
    for (const l of this.placeLabels) {
      const slot = slots.get(`place:${l.id}`);
      const want = slot && !slot.hidden ? 0.95 : 0;
      l.alpha = lerp(l.alpha, want, k);
      l.box.setVisible(l.alpha > 0.02);
      l.box.setAlpha(l.alpha);
      l.box.setScale(s);
      l.box.setPosition(Math.round(l.ax), Math.round(l.ay - 2 / zoom));
    }
  }

  // ───────────── results on the map: floating cues ─────────────

  /** Feed items that arrived since the last snapshot become short chips above their actors (see feedCues.ts for the
   *  rules: only real items, only numbers that are in the item's own text). The first snapshot of a session is history:
   *  no cues. A burst (a fast-forward) is thinned to CUE_BURST_LIMIT, the guardian's own Agent first. */
  private ingestFeed(): void {
    const feed = this.snapshot?.feed;
    if (!feed) return;
    const maxId = feed.reduce((m, f) => Math.max(m, f.id), 0);
    if (!this.feedSeen || maxId < this.feedMaxId) {
      // first snapshot, or a different save (ids went backwards): everything in the feed is history
      this.feedSeen = new Set(feed.map((f) => f.id));
      this.feedMaxId = maxId;
      return;
    }
    const seen = this.feedSeen;
    const fresh = feed.filter((f) => !seen.has(f.id) && f.importance >= 2 && CUE_KINDS.has(f.kind)).sort((x, y) => x.atMs - y.atMs || x.id - y.id);
    this.feedSeen = new Set(feed.map((f) => f.id));
    this.feedMaxId = Math.max(this.feedMaxId, maxId);
    if (fresh.length === 0 || document.visibilityState === "hidden") return;
    const cues: Cue[] = [];
    for (const item of fresh) cues.push(...cuesForFeedItem(item).filter((c) => this.residents.has(c.actor)));
    const kept = thinCues(cues, CUE_BURST_LIMIT, this.snapshot?.player?.agent.id ?? null);
    const now = performance.now();
    // one item's cues start together; the next item's a moment later, so a busy hour reads as a sequence
    let at = now;
    let lastItemKey = "";
    kept.forEach((cue, i) => {
      const itemKey = cue.text + cue.icon;
      if (i > 0 && itemKey !== lastItemKey) at += CUE_STAGGER_MS;
      lastItemKey = itemKey;
      this.cueQueue.push({ actor: cue.actor, cue, at });
    });
  }

  private cueIconKey(icon: CueIcon, tone: CueTone): string | null {
    if (icon === "none") return null;
    const key = icon === "coin" ? "cue-coin" : `cue-${icon}-${tone}`;
    if (this.textures.exists(key)) return key;
    const rows = CUE_ICONS[icon];
    const px = 2;
    const fg = CUE_TONES[tone].css;
    const colors: Record<string, string> = { X: fg, O: "#2b180d", G: "#f2c75c", H: "#fff1a8", D: "#b9842a" };
    const tex = this.textures.createCanvas(key, rows[0].length * px, rows.length * px);
    if (!tex) return null;
    const c = tex.getContext();
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const col = colors[row[x]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x * px, y * px, px, px);
      }
    });
    tex.refresh();
    tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
    return key;
  }

  private spawnCue(res: Resident, cue: Cue, nowMs: number): void {
    const key = `${cue.icon}|${cue.text}`;
    if (res.cues.some((c) => c.key === key && nowMs - c.born < 3500)) return; // the same result twice in a row is one chip
    while (res.cues.length >= CUE_MAX_PER_RESIDENT) res.cues.shift()?.box.destroy();
    const tone = CUE_TONES[cue.tone];
    const iconKey = this.cueIconKey(cue.icon, cue.tone);
    const text = cue.text ? this.add.text(0, 0, cue.text, { fontFamily: FONT, fontSize: "12px", color: tone.css }).setOrigin(0, 0.5).setResolution(this.labelRes) : null;
    const iconImg = iconKey ? this.add.image(0, 0, iconKey).setOrigin(0, 0.5) : null;
    const iw = iconImg ? iconImg.width : 0;
    const w = 6 + iw + (iconImg && text ? 4 : 0) + (text ? Math.ceil(text.width) : 0) + 6;
    const h = 20;
    const g = this.add.graphics();
    g.fillStyle(0x2b180d, 0.5);
    this.steppedRect(g, -w / 2, -h + 1, w, h);
    g.fillStyle(tone.edge, 1);
    this.steppedRect(g, -w / 2, -h, w, h);
    g.fillStyle(0x2b180d, 0.95);
    this.steppedRect(g, -w / 2 + 1, -h + 1, w - 2, h - 2);
    let x = Math.round(-w / 2 + 6);
    const parts: Phaser.GameObjects.GameObject[] = [g];
    if (iconImg) {
      iconImg.setPosition(x, Math.round(-h / 2));
      parts.push(iconImg);
      x += iw + (text ? 4 : 0);
    }
    if (text) {
      text.setPosition(x, Math.round(-h / 2));
      parts.push(text);
    }
    const box = this.add.container(0, 0, parts);
    box.setAlpha(0);
    res.top.add(box);
    res.cues.push({ box, born: nowMs, key, y: -1 });
  }

  private updateCues(dt: number, nowMs: number): void {
    // start the cues that are due; one that waited far too long (the tab was in the background) is dropped, not replayed
    if (this.cueQueue.length > 0) {
      const rest: typeof this.cueQueue = [];
      for (const q of this.cueQueue) {
        if (q.at > nowMs) rest.push(q);
        else if (nowMs - q.at <= CUE_STALE_MS) {
          const res = this.residents.get(q.actor);
          if (res) this.spawnCue(res, q.cue, nowMs);
        }
      }
      this.cueQueue = rest;
    }
    const k = 1 - Math.exp(-dt * 14);
    for (const r of this.residents.values()) {
      if (r.cues.length === 0) continue;
      const top = this.stackHeight(r);
      let slot = 0;
      for (let i = r.cues.length - 1; i >= 0; i--) {
        const c = r.cues[i];
        const age = nowMs - c.born;
        if (age > CUE_MS) {
          c.box.destroy();
          r.cues.splice(i, 1);
          continue;
        }
        // newest nearest the head; older ones are pushed up a slot; each chip also drifts up a little as it ages
        const target = top + 5 + slot * 22 + clamp(age / 420, 0, 1) * 8;
        c.y = c.y < 0 ? target : lerp(c.y, target, k);
        c.box.setY(-Math.round(c.y));
        const fadeIn = clamp(age / 140, 0, 1);
        const fadeOut = age > CUE_MS - 500 ? clamp((CUE_MS - age) / 500, 0, 1) : 1;
        c.box.setAlpha(fadeIn * fadeOut);
        slot++;
      }
    }
  }

  // ───────────── night lights ─────────────

  /** Warm pools of light that come on at dusk and keep the town readable at night: one at every door (a house whose
   *  owner sleeps goes dark), and one per lamp the map lists in its optional `lights` object layer (points; custom
   *  property `radius` in px, default 28). Residents carry their own glow (see updateResident). */
  private buildLights(raw: TiledMap): void {
    const add = (x: number, y: number, radius: number, kind: "door" | "lamp", base: number, tint: number, homeSlot = -1) => {
      const img = this.add
        .image(Math.round(x), Math.round(y), "light-soft")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.grade + 3)
        .setScale((radius * 2) / 128)
        .setTint(tint)
        .setVisible(false);
      this.nightLights.push({ img, kind, base, homeSlot });
    };
    for (const [id, loc] of Object.entries(this.model.locations)) {
      if (id === "home" || !loc.door) continue;
      const p = tileToWorld(loc.door);
      add(p.x, p.y - 12, 30, "door", 0.5, 0xffd9a0);
    }
    for (const h of this.model.homeDoors) {
      const p = tileToWorld(h.tile);
      add(p.x, p.y - 12, 26, "door", 0.55, 0xffd9a0, h.slot);
    }
    const layer = raw.layers.find((l) => l.type === "objectgroup" && l.name === "lights");
    for (const o of layer?.objects ?? []) {
      const radius = Number(o.properties?.find((p) => p.name === "radius")?.value ?? 28);
      add(o.x, o.y, radius, "lamp", 0.5, 0xffc878);
    }
  }

  private updateLights(): void {
    const k = this.lightK;
    // who sleeps behind which front door
    const dark = new Set<number>();
    if (k > 0.02) for (const r of this.residents.values()) if (r.data.activity === "sleeping" && r.planLoc === "home" && r.vis < 0.5) dark.add(Math.floor(r.data.homeSlot));
    for (const l of this.nightLights) {
      const flicker = l.kind === "lamp" ? 0.94 + 0.06 * Math.sin(this.time.now / 380 + l.img.x * 0.7) : 1;
      const out = l.homeSlot >= 0 && dark.has(l.homeSlot) ? 0.12 : 1;
      const a = k * l.base * flicker * out;
      if (a > 0.02) {
        l.img.setVisible(true);
        l.img.setAlpha(a);
      } else if (l.img.visible) l.img.setVisible(false);
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
    // the lamps come on as the evening grade rises and go out in the morning (follows the same smooth curve)
    this.lightK = clamp(g.night * 2 + g.warm * 0.5, 0, 1);

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
      this.hoverResId = hit?.id ?? null; // a hovered resident always shows its name
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
