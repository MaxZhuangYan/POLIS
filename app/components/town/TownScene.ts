// The Phaser side of the town view.
//
// Design rule (see POLIS 玩法设计): everything a resident does on screen is
// *presentation of logical state*. The snapshot says where an agent is (or
// which road it is on, and between which sim timestamps); the scene only
// decides how to draw that — walking cadence, idle wander inside the location,
// bubbles — and never invents positions that contradict the state.
//
// This module imports Phaser statically, so it must only ever be loaded with a
// dynamic import() from the browser (PhaserTown.tsx does that).

import * as Phaser from "phaser";
import type { AgentView, Emote, GameSnapshot, LocationId } from "@/lib/types";
import {
  EDGES,
  LOCATIONS,
  MAP_H,
  MAP_W,
  NODES,
  anchorOf,
  areasOf,
  clampToAreas,
  dist,
  homeDoor,
  inAreas,
  pathBetween,
  pathFromPoint,
  pathLength,
  pointAlong,
  slotsOf,
  type Pt
} from "./mapData";

// ───────────────────────────── public surface ─────────────────────────────

export interface TownSceneCallbacks {
  /** a resident was clicked (id) or empty ground was clicked (null) */
  onSelect?: (id: string | null) => void;
  /** the user dragged the map while following, so following stopped */
  onFollowChange?: (id: string | null) => void;
  /** assets finished loading and the town is on screen */
  onReady?: () => void;
  /** asset loading progress 0..1 */
  onProgress?: (p: number) => void;
}

export interface TownSceneOptions extends TownSceneCallbacks {
  /** draw road graph / areas / slots over the map */
  debug?: boolean;
}

export interface TownApi {
  setSnapshot(snapshot: GameSnapshot | null): void;
  focusAgent(id: string): void;
  setFollow(id: string | null): void;
  setSelected(id: string | null): void;
  /** live screen position (canvas px) of my Agent's body; null when off-screen or absent */
  getPlayerScreen(): { x: number; y: number } | null;
}

// ───────────────────────────── constants ─────────────────────────────

const FONT = '"PingFang SC","Noto Sans CJK SC","Noto Sans SC","Microsoft YaHei",sans-serif';
const MAX_ZOOM = 2.4;
const CHAR_PX = 44; // displayed character height at zoom 1
const SPRITE_BBOX_H = 76; // opaque height inside the 80x80 frame
const SPRITE_SCALE = CHAR_PX / SPRITE_BBOX_H;
const BUBBLE_MS = 7000;
const BUBBLE_FADE_MS = 700;
const CATCHUP_MAX_S = 2;
const GOLD = 0xf2c75c;

const SPRITE_KEYS = ["architect", "broker", "maker", "archivist", "mediator", "scout", "rookie", "courier", "guide"];
const EMOTE_PNG: Partial<Record<Emote, string>> = {
  think: "/assets/aiv/ui/icon-thoughts.png",
  trade: "/assets/aiv/ui/icon-scrip.png",
  wait: "/assets/aiv/ui/icon-help.png",
  happy: "/assets/aiv/ui/icon-health.png",
  upset: "/assets/aiv/ui/icon-energy.png",
  work: "/assets/aiv/ui/icon-brick.png"
};

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

// day / night grade -----------------------------------------------------------

interface Grade {
  bright: number; // colour-matrix brightness on the map (1 = artwork as is)
  night: number; // blue overlay alpha
  warm: number; // warm overlay alpha
  warmColor: number;
}

const GRADE_KEYS: { h: number; g: Grade }[] = [
  { h: 0, g: { bright: 0.92, night: 0.36, warm: 0, warmColor: 0xff9a4a } },
  { h: 5, g: { bright: 0.94, night: 0.32, warm: 0, warmColor: 0xff9a4a } },
  { h: 6.5, g: { bright: 1.14, night: 0.1, warm: 0.2, warmColor: 0xff9a5a } },
  { h: 8, g: { bright: 1.32, night: 0, warm: 0.06, warmColor: 0xffd890 } },
  { h: 16.5, g: { bright: 1.32, night: 0, warm: 0.06, warmColor: 0xffd890 } },
  { h: 18, g: { bright: 1.14, night: 0.05, warm: 0.26, warmColor: 0xff8a40 } },
  { h: 19.5, g: { bright: 1.0, night: 0.16, warm: 0.2, warmColor: 0xff7a40 } },
  { h: 22, g: { bright: 0.93, night: 0.33, warm: 0, warmColor: 0xff9a4a } },
  { h: 24, g: { bright: 0.92, night: 0.36, warm: 0, warmColor: 0xff9a4a } }
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
  pts: Pt[];
  len: number;
  dur: number;
  t: number;
}

interface Resident {
  id: string;
  data: AgentView;
  // display objects
  root: Phaser.GameObjects.Container; // world position, sprite part
  shadow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image | null;
  sel: Phaser.GameObjects.Image;
  sprite: Phaser.GameObjects.Image;
  top: Phaser.GameObjects.Container; // label + emote + bubble (kept above all sprites)
  label: Phaser.GameObjects.Text;
  emoteBg: Phaser.GameObjects.Image;
  emoteIcon: Phaser.GameObjects.Image;
  emoteKey: string | null;
  bubble: BubbleView | null;
  bubbleSeenAt: number | null;
  // motion
  x: number;
  y: number;
  vx: number;
  facing: 1 | -1;
  phase: number;
  walking: boolean;
  speedEma: number;
  fresh: boolean; // first frame: snap to target
  locShown: LocationId | null;
  travelKey: string | null;
  travelPath: Pt[] | null;
  travelLen: number;
  catchUp: CatchUp | null;
  slotLoc: LocationId | null;
  slotIdx: number;
  // wander
  rng: () => number;
  wx: number;
  wy: number;
  wtx: number;
  wty: number;
  wMoving: boolean;
  wUntil: number;
  wBase: Pt | null;
  breathe: number;
  lift: number; // label lift (px) to avoid name tags colliding
  liftCur: number;
}

// ───────────────────────────── the scene ─────────────────────────────

export class TownScene extends Phaser.Scene implements TownApi {
  private opts: TownSceneOptions;
  private snapshot: GameSnapshot | null = null;
  private receivedAt = 0;
  private ready = false;
  private residents = new Map<string, Resident>();
  private uiLayer!: Phaser.GameObjects.Container;
  private mapImg!: Phaser.GameObjects.Image;
  private dayLight!: Phaser.GameObjects.Rectangle;
  private warmOverlay!: Phaser.GameObjects.Rectangle;
  private nightOverlay!: Phaser.GameObjects.Rectangle;
  private mapFallback = false;
  private grade: Grade | null = null;
  private lastGradeKey = "";
  private selectedId: string | null = null;
  private followId: string | null = null;
  private labelRes = 2;
  // camera
  private minZoom = 0.5;
  /** screen px covered by HUD on each side; the camera may scroll that far past
   *  the map edge so a resident near the edge can be brought into view, and
   *  follow/focus centre the target in the uncovered area */
  private safe = { l: 0, r: 0, t: 0, b: 0 };
  private userZoomed = false;
  private zoomAnim: { target: number; sx: number; sy: number } | null = null;
  private camAnim: { t: number; dur: number; id: string; zoomTo: number; fromX: number; fromY: number; fromZ: number } | null = null;
  private didInitialCenter = false;
  private downAt: { x: number; y: number } | null = null;
  private dragged = false;
  private pinch: { dist: number } | null = null;
  private debugGfx: Phaser.GameObjects.Graphics | null = null;

  constructor(opts: TownSceneOptions = {}) {
    super({ key: "town" });
    this.opts = opts;
  }

  // ───────────── api (called from React) ─────────────

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
    if (id && this.ready) this.startCamAnim(id, Math.max(this.cameras.main.zoom, Math.min(1.4, this.minZoom * 1.45)));
  }

  focusAgent(id: string): void {
    if (!this.ready) return;
    this.followId = null;
    this.startCamAnim(id, Math.max(this.cameras.main.zoom, Math.min(1.4, this.minZoom * 1.45)));
  }

  setCallbacks(cb: TownSceneCallbacks): void {
    this.opts = { ...this.opts, ...cb };
  }

  // ───────────── phaser lifecycle ─────────────

  preload(): void {
    this.load.on("progress", (v: number) => this.opts.onProgress?.(v));
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      // the lighter webp is preferred; fall back to the png if it cannot be fetched
      if (file.key === "map" && !this.mapFallback) {
        this.mapFallback = true;
        this.load.image("map", "/assets/polis-pixel-town-map.png");
      }
    });
    this.load.image("map", "/assets/polis-pixel-town-map.webp");
    for (const k of SPRITE_KEYS) this.load.image(`spr-${k}`, `/assets/polis-sprites/${k}.png`);
    for (const [k, src] of Object.entries(EMOTE_PNG)) this.load.image(`emote-${k}`, src);
  }

  create(): void {
    // (the canvas renderer ignores text resolution when drawing, so keep it 1 there)
    this.labelRes = this.game.renderer.type === Phaser.WEBGL ? Math.max(2, Math.min(3, Math.ceil(window.devicePixelRatio || 1))) : 1;
    const cam = this.cameras.main;
    cam.setBackgroundColor("#0b1020");
    cam.setBounds(0, 0, MAP_W, MAP_H);
    cam.setRoundPixels(false);

    // smooth scaling for the artwork (it is shown below 1:1 most of the time)
    for (const key of ["map", ...SPRITE_KEYS.map((k) => `spr-${k}`), ...Object.keys(EMOTE_PNG).map((k) => `emote-${k}`)]) {
      if (this.textures.exists(key)) this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
    }

    this.makeTextures();

    this.mapImg = this.add.image(0, 0, "map").setOrigin(0, 0).setDepth(0);
    if (this.mapImg.width !== MAP_W) this.mapImg.setDisplaySize(MAP_W, MAP_H);

    // Day / night grade as overlays above the map (same look in WebGL and canvas). A preFX colour matrix
    // would be neater, but preFX renders through a screen-sized buffer and clips any big object that is
    // partly off-screen — which a zoomed / panned map always is.
    this.dayLight = this.add
      .rectangle(0, 0, MAP_W, MAP_H, 0xfff3d6, 0)
      .setOrigin(0, 0)
      .setDepth(1)
      .setBlendMode(Phaser.BlendModes.SCREEN);
    this.warmOverlay = this.add.rectangle(0, 0, MAP_W, MAP_H, 0xff9a4a, 0).setOrigin(0, 0).setDepth(2);
    this.nightOverlay = this.add.rectangle(0, 0, MAP_W, MAP_H, 0x0a1448, 0).setOrigin(0, 0).setDepth(3);

    this.uiLayer = this.add.container(0, 0).setDepth(20000);

    if (this.opts.debug) {
      this.drawDebug();
      (window as unknown as { __town?: TownScene }).__town = this;
    }

    this.input.setDefaultCursor("grab");
    this.input.addPointer(2);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);
    this.input.on("wheel", this.onWheel, this);
    this.scale.on("resize", this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.onResize, this);
    });

    this.onResize();
    cam.setZoom(this.minZoom);
    cam.centerOn(MAP_W / 2, MAP_H / 2);

    this.ready = true;
    this.syncResidents();
    this.opts.onReady?.();
  }

  // ───────────── textures ─────────────

  private makeTextures(): void {
    const mk = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const tex = this.textures.createCanvas(key, w, h);
      if (!tex) return;
      draw(tex.getContext());
      tex.refresh();
      tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
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
    mk("emote-bg", 32, 32, (c) => {
      c.fillStyle = "rgba(255,252,240,0.96)";
      c.strokeStyle = "#2b3350";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(16, 16, 14, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    });
    // pixel glyph emotes that have no icon asset
    const glyph = (key: string, bg: string, fg: string, rows: string[], px: number) => {
      mk(key, 64, 64, (c) => {
        c.fillStyle = fg;
        const w = rows[0].length * px;
        const h = rows.length * px;
        const ox = Math.round((64 - w) / 2);
        const oy = Math.round((64 - h) / 2);
        rows.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) if (row[x] === "X") c.fillRect(ox + x * px, oy + y * px, px, px);
        });
        void bg;
      });
    };
    glyph("emote-sleep", "#cfe0ff", "#3452b0", [
      "XXXXX......",
      "...X.......",
      "..X....XXX.",
      ".X......X..",
      "XXXXX..XXX."
    ].map((r) => r.padEnd(11, ".")), 5);
    glyph("emote-alert", "#ff7a6a", "#d1322a", [
      ".XX.",
      ".XX.",
      ".XX.",
      ".XX.",
      ".XX.",
      "....",
      ".XX."
    ], 7);
  }

  // ───────────── residents ─────────────

  private spriteKeyFor(a: AgentView): string {
    const k = `spr-${a.sprite}`;
    return this.textures.exists(k) ? k : "spr-rookie";
  }

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
            this.cameras.main.centerOn(res.x, res.y - 20);
          });
        }
      }
    }
  }

  private createResident(a: AgentView): Resident {
    const isMe = a.isPlayer;
    const root = this.add.container(0, 0);
    const shadow = this.add.image(0, 0, "shadow").setOrigin(0.5, 0.5).setScale(1.0, 1.0).setAlpha(0.9);
    const ring = isMe ? this.add.image(0, 2, "ring-gold").setOrigin(0.5, 0.5).setScale(0.78) : null;
    const sel = this.add.image(0, 2, "ring-sel").setOrigin(0.5, 0.5).setScale(0.78).setVisible(false);
    const sprite = this.add
      .image(0, 0, this.spriteKeyFor(a))
      .setOrigin(0.5, 0.975)
      .setScale(SPRITE_SCALE);
    root.add([shadow]);
    if (ring) root.add(ring);
    root.add([sel, sprite]);

    const top = this.add.container(0, 0);
    const label = this.add
      .text(0, 0, isMe ? `★ ${a.name}` : a.name, {
        fontFamily: FONT,
        fontSize: "14px",
        fontStyle: "bold",
        color: isMe ? "#f2c75c" : "#ffffff",
        stroke: "#0b1020",
        strokeThickness: 4
      })
      .setOrigin(0.5, 1)
      .setResolution(this.labelRes);
    label.setShadow(0, 1, "#000000", 2, true, true);
    const emoteBg = this.add.image(0, -22, "emote-bg").setScale(0.78).setVisible(false);
    const emoteIcon = this.add.image(0, -22, "emote-think").setDisplaySize(18, 18).setVisible(false);
    top.add([label, emoteBg, emoteIcon]);
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
      top,
      label,
      emoteBg,
      emoteIcon,
      emoteKey: null,
      bubble: null,
      bubbleSeenAt: null,
      x: 0,
      y: 0,
      vx: 0,
      facing: 1,
      phase: (seed % 628) / 100,
      walking: false,
      speedEma: 0,
      fresh: true,
      locShown: null,
      travelKey: null,
      travelPath: null,
      travelLen: 0,
      catchUp: null,
      slotLoc: null,
      slotIdx: -1,
      rng: mulberry32(seed),
      wx: 0,
      wy: 0,
      wtx: 0,
      wty: 0,
      wMoving: false,
      wUntil: 0,
      wBase: null,
      breathe: (seed % 100) / 15,
      lift: 0,
      liftCur: 0
    };
    return res;
  }

  private applyData(res: Resident, a: AgentView): void {
    const prev = res.data;
    res.data = a;
    if (prev.sprite !== a.sprite) res.sprite.setTexture(this.spriteKeyFor(a));
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
      .text(0, 0, wrapped, {
        fontFamily: FONT,
        fontSize: `${fontPx}px`,
        color: "#1b1f33",
        lineSpacing: 3
      })
      .setResolution(this.labelRes);
    const padX = 9;
    const padY = 7;
    const w = Math.max(38, Math.ceil(t.width) + padX * 2);
    const h = Math.ceil(t.height) + padY * 2;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(-w / 2 + 2, -h + 3, w, h, 8);
    g.fillStyle(0xfffbea, 1);
    g.lineStyle(2, 0x2b3350, 1);
    g.fillRoundedRect(-w / 2, -h, w, h, 8);
    g.strokeRoundedRect(-w / 2, -h, w, h, 8);
    g.fillTriangle(-6, -1.5, 6, -1.5, 0, 7);
    g.lineStyle(2, 0x2b3350, 1);
    g.beginPath();
    g.moveTo(-6, -1);
    g.lineTo(0, 7);
    g.lineTo(6, -1);
    g.strokePath();
    g.fillStyle(0xfffbea, 1);
    g.fillRect(-5, -3, 10, 3);
    t.setPosition(-w / 2 + padX, -h + padY);
    const box = this.add.container(0, 0, [g, t]);
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
        const tex = `emote-${key}`;
        if (this.textures.exists(tex)) {
          res.emoteIcon.setTexture(tex).setVisible(true).setDisplaySize(key === "sleep" || key === "alert" ? 20 : 18, key === "sleep" || key === "alert" ? 20 : 18);
          res.emoteBg.setVisible(true);
        } else {
          res.emoteBg.setVisible(false);
          res.emoteIcon.setVisible(false);
        }
      }
    }
  }

  // ───────────── slots ─────────────

  private slotPoint(res: Resident, loc: LocationId): Pt {
    const home = res.data.homeSlot;
    if (loc === "home") return homeDoor(home);
    const slots = slotsOf(loc);
    if (res.slotLoc !== loc || res.slotIdx < 0) {
      // pick the free slot that is farthest from everybody already standing here
      const takenIdx = new Set<number>();
      const takenPts: Pt[] = [];
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
        const d = takenPts.length === 0 ? 1 : Math.min(...takenPts.map((t) => dist(t, slots[idx])));
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

  // ───────────── per-frame resident logic ─────────────

  /** where this resident *should* be right now, according to logical state */
  private logicalTarget(res: Resident, simNow: number, dt: number, nowMs: number): { x: number; y: number; travelling: boolean; dirX: number } {
    const a = res.data;
    const loc = a.location;
    const home = a.homeSlot;

    // 1. on the road
    if (a.travel) {
      const tr = a.travel;
      const key = `${tr.from}>${tr.to}@${tr.startMs}`;
      if (res.travelKey !== key || !res.travelPath) {
        res.travelKey = key;
        res.travelPath = pathBetween(tr.from, tr.to, home, home);
        res.travelLen = pathLength(res.travelPath);
      }
      const span = Math.max(1, tr.endMs - tr.startMs);
      const p = clamp((simNow - tr.startMs) / span, 0, 1);
      const s = pointAlong(res.travelPath, p * res.travelLen);
      res.locShown = tr.to; // when the road ends we are *at* the destination already
      res.catchUp = null;
      this.releaseSlot(res);
      res.wBase = null;
      return { x: s.x, y: s.y, travelling: p < 1, dirX: s.dx };
    }
    res.travelKey = null;
    res.travelPath = null;

    // 2. location changed without travel info (fast-forward jump etc.) → walk there along the graph, quickly
    if (res.locShown !== loc) {
      const first = res.locShown === null;
      const base = this.standBase(res, loc);
      if (!first && !res.fresh) {
        const from = { x: res.x, y: res.y };
        if (dist(from, base) > 30) {
          const pts = pathFromPoint(from, loc, home);
          pts.push(base);
          const len = pathLength(pts);
          res.catchUp = { pts, len, dur: clamp(len / 240, 0.5, CATCHUP_MAX_S), t: 0 };
        }
      }
      res.locShown = loc;
      res.wBase = null;
    }
    if (res.catchUp) {
      const c = res.catchUp;
      c.t += dt;
      const k = clamp(c.t / c.dur, 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
      const s = pointAlong(c.pts, e * c.len);
      if (k >= 1) res.catchUp = null;
      return { x: s.x, y: s.y, travelling: true, dirX: s.dx };
    }

    // 3. standing at the location (collaborating, sleeping, waiting are still)
    const base = this.standBase(res, loc);
    const still = a.activity === "sleeping" || a.activity === "waiting" || a.activity === "collaborating" || loc === "home";
    if (still) {
      res.wBase = base;
      res.wx = base.x;
      res.wy = base.y;
      res.wMoving = false;
      return { x: base.x, y: base.y, travelling: false, dirX: 0 };
    }
    // gentle micro wander around the stand point, never leaving the location's areas
    if (!res.wBase || dist(res.wBase, base) > 1) {
      res.wBase = base;
      res.wx = base.x;
      res.wy = base.y;
      res.wMoving = false;
      res.wUntil = nowMs + 800 + res.rng() * 3500;
    }
    if (res.wMoving) {
      const dx = res.wtx - res.wx;
      const dy = res.wty - res.wy;
      const d = Math.hypot(dx, dy);
      const step = 15 * dt;
      if (d <= step) {
        res.wx = res.wtx;
        res.wy = res.wty;
        res.wMoving = false;
        res.wUntil = nowMs + 2200 + res.rng() * 5200;
      } else {
        res.wx += (dx / d) * step;
        res.wy += (dy / d) * step;
      }
      return { x: res.wx, y: res.wy, travelling: false, dirX: dx };
    }
    if (nowMs >= res.wUntil) {
      for (let tries = 0; tries < 8; tries++) {
        const ang = res.rng() * Math.PI * 2;
        const rad = 8 + res.rng() * 12;
        const cand = { x: base.x + Math.cos(ang) * rad, y: base.y + Math.sin(ang) * rad * 0.6 };
        if (inAreas(loc, cand, home)) {
          res.wtx = cand.x;
          res.wty = cand.y;
          res.wMoving = true;
          break;
        }
      }
      if (!res.wMoving) res.wUntil = nowMs + 3000;
    }
    return { x: res.wx, y: res.wy, travelling: false, dirX: 0 };
  }

  /** the stand point of a resident at a location (collaborators pair up) */
  private standBase(res: Resident, loc: LocationId): Pt {
    const a = res.data;
    const base = this.slotPoint(res, loc);
    if (a.activity === "collaborating" && a.partnerId && loc !== "home") {
      const partner = this.residents.get(a.partnerId);
      if (partner && !partner.data.travel && partner.data.location === loc && partner.data.activity === "collaborating") {
        // the lexicographically smaller id leads: it stands left of the lead's slot, the follower right of it
        const lead = a.id < partner.id ? res : partner;
        const leadBase = lead === res ? base : this.slotPoint(partner, loc);
        return clampToAreas(loc, { x: leadBase.x + (lead === res ? -22 : 22), y: leadBase.y }, a.homeSlot);
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
        const k = 1 - Math.exp(-dt * (d > 140 ? 3 : 7));
        const step = Math.min(d, Math.max(d * k, (d > 140 ? 140 : 28) * dt));
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
    res.walking = !sleeping && (onRoad || res.speedEma > 7);

    // facing
    const faceDx = Math.abs(vx) > 3 ? vx : tgt.dirX;
    if (Math.abs(faceDx) > 0.5 && !sleeping && !waiting) res.facing = faceDx > 0 ? 1 : -1;
    if (a.activity === "collaborating" && a.partnerId) {
      const partner = this.residents.get(a.partnerId);
      if (partner && !res.walking) res.facing = partner.x >= res.x ? 1 : -1;
    }
    if (waiting) res.facing = 1;
    res.sprite.setFlipX(res.facing < 0);

    // animation
    const baseScale = SPRITE_SCALE;
    if (res.walking) {
      const cadence = clamp(res.speedEma / 24, 0.75, 1.5) * 10.5;
      res.phase += dt * cadence;
      const bob = Math.abs(Math.sin(res.phase)) * 3.2;
      const sq = Math.sin(res.phase * 2) * 0.035;
      res.sprite.y = -bob;
      res.sprite.setScale(baseScale * (1 - sq), baseScale * (1 + sq));
    } else if (sleeping) {
      res.breathe += dt * 1.1;
      res.sprite.y = 0;
      res.sprite.setScale(baseScale * 1.0, baseScale * (0.96 + Math.sin(res.breathe) * 0.012));
    } else {
      res.breathe += dt * 2.2;
      const hop = waiting ? Math.max(0, Math.sin(timeSec * 2.4)) ** 6 * 2.2 : 0;
      res.sprite.y = -hop;
      res.sprite.setScale(baseScale * (1 - Math.sin(res.breathe) * 0.008), baseScale * (1 + Math.sin(res.breathe) * 0.016));
    }
    if (sleeping) {
      res.sprite.setTint(0x8f9fd6);
      res.sprite.setAlpha(0.78);
      res.shadow.setAlpha(0.6);
    } else {
      res.sprite.clearTint();
      res.sprite.setAlpha(1);
      res.shadow.setAlpha(0.9);
    }

    // placement + depth
    res.root.setPosition(res.x, res.y);
    res.root.setDepth(10 + res.y);
    if (res.ring) {
      const pulse = 0.5 + 0.5 * Math.sin(timeSec * 3.2);
      res.ring.setScale(0.78 + pulse * 0.07);
      res.ring.setAlpha(0.65 + pulse * 0.35);
    }
    const selected = this.selectedId === res.id;
    res.sel.setVisible(selected);
    if (selected) res.sel.setAlpha(0.7 + 0.3 * Math.sin(timeSec * 5));

    // label / emote / bubble live in the top layer, scale against zoom so text stays readable
    const zoom = this.cameras.main.zoom;
    const s = clamp(1 / zoom, 0.62, 1.12);
    res.top.setScale(s);
    res.top.setPosition(res.x, res.y - CHAR_PX - 3 - res.liftCur);
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
    this.separateLabels(dt);
    this.updateGrade(dt);
    this.updateCamera(dt);
  }

  /** stack name tags upwards when two residents stand so close that the tags would overlap */
  private separateLabels(dt: number): void {
    const list = Array.from(this.residents.values()).sort((a, b) => a.y - b.y || a.x - b.x);
    const done: Resident[] = [];
    const s = clamp(1 / this.cameras.main.zoom, 0.62, 1.12);
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
      r.top.setY(r.y - CHAR_PX - 3 - r.liftCur);
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
    // brightening: a screen-blended light layer lifts the night-lit artwork towards "day"
    this.dayLight.setFillStyle(0xfff3d6, clamp((g.bright - 1) * 0.6, 0, 0.5));
    this.warmOverlay.setFillStyle(g.warmColor, g.warm);
    this.nightOverlay.setFillStyle(0x0a1448, g.night);
  }

  // ───────────── camera ─────────────

  private onResize(): void {
    const cam = this.cameras.main;
    const w = this.scale.width;
    const h = this.scale.height;
    if (w <= 0 || h <= 0) return;
    this.safe = w < 700 ? { l: 0, r: 64, t: 130, b: 170 } : { l: 380, r: 84, t: 64, b: 104 };
    const cover = Math.max(w / MAP_W, h / MAP_H);
    const wasCover = !this.userZoomed || Math.abs(cam.zoom - this.minZoom) < 0.001;
    this.minZoom = cover;
    if (wasCover) cam.setZoom(cover);
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
    const { l, r, t, b } = this.safe;
    cam.setBounds(-l / z, -t / z, MAP_W + (l + r) / z, MAP_H + (t + b) / z);
  }

  /** world point that puts (x, y) in the middle of the HUD-free area */
  private safeCenterFor(x: number, y: number): Pt {
    const z = this.cameras.main.zoom || 1;
    const { l, r, t, b } = this.safe;
    return { x: x - (l - r) / (2 * z), y: y - (t - b) / (2 * z) };
  }

  private updateCamera(dt: number): void {
    const cam = this.cameras.main;
    this.applySafeBounds();
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
        const goal = this.safeCenterFor(res.x, res.y - 18);
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
        const goal = this.safeCenterFor(res.x, res.y - 18);
        this.setCenter(lerp(c.x, goal.x, k), lerp(c.y, goal.y, k));
      }
    }
  }

  getPlayerScreen(): { x: number; y: number } | null {
    if (!this.ready) return null;
    const me = Array.from(this.residents.values()).find((r) => r.data.isPlayer);
    if (!me) return null;
    const s = this.worldToScreen(me.x, me.y - CHAR_PX * 0.5);
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
      // hover cursor over residents
      const hit = this.hitResident(p.x, p.y);
      this.input.setDefaultCursor(hit ? "pointer" : "grab");
      return;
    }
    if (!this.downAt) return;
    if (!this.dragged && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 6) {
      this.dragged = true;
      if (this.followId) {
        this.followId = null;
        this.opts.onFollowChange?.(null);
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
    this.opts.onSelect?.(hit ? hit.id : null);
  }

  private onWheel(pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number): void {
    const cam = this.cameras.main;
    const base = this.zoomAnim ? this.zoomAnim.target : cam.zoom;
    const target = clamp(base * Math.exp(-dy * 0.0013), this.minZoom, MAX_ZOOM);
    this.camAnim = null;
    this.userZoomed = true;
    this.zoomAnim = { target, sx: pointer.x, sy: pointer.y };
  }

  private hitResident(sx: number, sy: number): Resident | null {
    const w = this.screenToWorld(sx, sy);
    const zoom = this.cameras.main.zoom;
    const padX = Math.max(26, 18 / zoom + 10);
    let best: Resident | null = null;
    for (const r of this.residents.values()) {
      const dx = Math.abs(w.x - r.x);
      const dyUp = r.y - w.y; // positive when the pointer is above the feet
      if (dx <= padX && dyUp >= -12 && dyUp <= CHAR_PX + 22) {
        if (!best || r.y > best.y) best = r;
      }
    }
    return best;
  }

  // ───────────── debug overlay ─────────────

  private drawDebug(): void {
    const g = this.add.graphics().setDepth(9000);
    g.lineStyle(3, 0xff4040, 0.9);
    for (const [a, b] of EDGES) {
      g.lineBetween(NODES[a].x, NODES[a].y, NODES[b].x, NODES[b].y);
    }
    g.fillStyle(0xffff00, 1);
    for (const n of Object.values(NODES)) g.fillCircle(n.x, n.y, 4);
    for (const id of Object.keys(LOCATIONS) as LocationId[]) {
      g.lineStyle(2, 0x00ffff, 0.9);
      g.fillStyle(0x00ffff, 0.12);
      for (const r of areasOf(id)) {
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeRect(r.x, r.y, r.w, r.h);
      }
      g.fillStyle(0x30ff30, 1);
      for (const s of slotsOf(id)) g.fillCircle(s.x, s.y, 3);
      const an = anchorOf(id);
      this.add
        .text(an.x + 6, an.y - 16, id, { fontFamily: FONT, fontSize: "12px", color: "#ffffff", stroke: "#000", strokeThickness: 3 })
        .setDepth(9001);
    }
    this.debugGfx = g;
  }
}
