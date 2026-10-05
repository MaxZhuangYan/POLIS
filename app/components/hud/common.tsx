"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { Domain, PrincipleView } from "@/lib/types";
import { CHARACTERS, SPRITE_KEYS, facePath, normalizeSprite } from "../town/characters";
import styles from "./hud.module.css";

// ───────────────────────────── icons & portraits ─────────────────────────────

/** The icon art is 16x16 pixel art stored at 64x64, so only 16 / 32 / 48 px are whole multiples of it. */
const snapIcon = (size: number): number => Math.max(16, Math.round(size / 16) * 16);

export function Icon({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const px = snapIcon(size);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/assets/aiv/ui/icon-${name}.png`}
      alt=""
      width={px}
      height={px}
      draggable={false}
      className={`${styles.icon} ${className ?? ""}`}
    />
  );
}

export const KNOWN_SPRITES: string[] = SPRITE_KEYS;

/**
 * A resident's faceset in a framed box (the pack's own "faceset in a frame" look).
 *   size >= 90   2x: 76 px face in a 96 px box (modals)
 *   size 33..89  1x: 38 px face in a 48 px box (HUD cards, lists)
 *   size <= 32   a standing sprite at 2x (32 px) with no box (chips)
 * Faces are never scaled by fractions, so every art pixel stays square.
 */
export function Portrait({ sprite, size = 48, player = false, className }: { sprite: string; size?: number; player?: boolean; className?: string }) {
  const key = normalizeSprite(sprite);
  if (size <= 32) {
    const sheet = CHARACTERS[key].sheet;
    return (
      <span
        className={`${styles.miniFace} ${player ? styles.miniFacePlayer : ""} ${className ?? ""}`}
        style={{ backgroundImage: `url(/assets/town/characters/${sheet}.png)` }}
        aria-hidden
      />
    );
  }
  return (
    <span className={`${styles.portrait} ${size >= 90 ? styles.portrait2x : ""} ${player ? styles.portraitPlayer : ""} ${className ?? ""}`} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={facePath(key)} alt="" draggable={false} />
    </span>
  );
}

/** a resident's standing sprite (the one the town draws) at a whole-number scale: 16 px art x `scale` */
export function Figure({ sprite, scale = 4 }: { sprite: string; scale?: number }) {
  const sheet = CHARACTERS[normalizeSprite(sprite)].sheet;
  return (
    <span
      className={styles.figure}
      style={{ width: 16 * scale, height: 16 * scale, backgroundImage: `url(/assets/town/characters/${sheet}.png)`, backgroundSize: `${64 * scale}px ${112 * scale}px` }}
      aria-hidden
    />
  );
}

/** four pixels that blink in turn: the game's busy indicator */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} role="status" aria-label="处理中">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

// ───────────────────────────── pixel glyphs (inline, crisp) ─────────────────────────────

/** Draws a bitmap given as rows of "X" / "." with SVG rects: crisp at any integer scale, no font or image needed. */
export function PixelGlyph({ rows, scale = 2, color = "currentColor", label }: { rows: string[]; scale?: number; color?: string; label?: string }) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const rects: ReactNode[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== "X") {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === "X") end++;
      rects.push(<rect key={`${y}-${x}`} x={x} y={y} width={end - x} height={1} />);
      x = end;
    }
  });
  return (
    <svg
      width={w * scale}
      height={h * scale}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      fill={color}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={styles.glyph}
    >
      {rects}
    </svg>
  );
}

export const GLYPH_X = ["X.....X", ".X...X.", "..X.X..", "...X...", "..X.X..", ".X...X.", "X.....X"];
export const GLYPH_SOUND_ON = ["....X......", "...XX...X..", "XXXXX....X.", "XXXXX.X..X.", "XXXXX.X..X.", "XXXXX.X..X.", "XXXXX....X.", "...XX...X..", "....X......"];
export const GLYPH_SOUND_OFF = ["....X......", "...XX......", "XXXXX.X...X", "XXXXX..X.X.", "XXXXX...X..", "XXXXX..X.X.", "XXXXX.X...X", "...XX......", "....X......"];
export const GLYPH_DOWN = ["XXXXXXX", ".XXXXX.", "..XXX..", "...X..."];
export const GLYPH_RIGHT = ["X...", "XX..", "XXX.", "XXXX", "XXX.", "XX..", "X..."];

export function CloseGlyph({ scale = 2 }: { scale?: number }) {
  return <PixelGlyph rows={GLYPH_X} scale={scale} />;
}

/** a key cap, for the key-help overlay and the tooltips */
export function Keycap({ children }: { children: ReactNode }) {
  return <kbd className={styles.keycap}>{children}</kbd>;
}

export function SunMoon({ night, size = 18 }: { night: boolean; size?: number }) {
  return night ? (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-label="夜晚" role="img">
      <path d="M6 1h4v1H8v1H7v1H6v2H5v4h1v2h1v1h1v1h2v1H6v-1H4v-1H3v-2H2V6h1V4h1V3h2z" fill="#cfd8ff" />
      <path d="M11 3h1v1h1v1h-1v1h-1V5h-1V4h1z" fill="#f2c75c" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-label="白天" role="img">
      <path d="M7 0h2v2H7zM7 14h2v2H7zM0 7h2v2H0zM14 7h2v2h-2zM2 2h2v2H2zM12 2h2v2h-2zM2 12h2v2H2zM12 12h2v2h-2z" fill="#f2c75c" />
      <path d="M5 4h6v1h1v6h-1v1H5v-1H4V5h1z" fill="#ffd978" />
      <path d="M6 5h4v1h1v4h-1v1H6v-1H5V6h1z" fill="#fff0b0" />
    </svg>
  );
}

// ───────────────────────────── domain tags & tablets ─────────────────────────────

/** the three domains, tuned to the town's palette: `color` reads on parchment, `light` on wood */
export const DOMAIN_META: Record<Domain, { label: string; color: string; light: string }> = {
  trust: { label: "信任", color: "#2b7f5e", light: "#6fd9aa" },
  risk: { label: "风险", color: "#b8501b", light: "#ffa56a" },
  integrity: { label: "原则", color: "#3a5fae", light: "#9dbbff" }
};

export function DomainTag({ domain }: { domain: Domain }) {
  const m = DOMAIN_META[domain];
  return (
    <span className={styles.domainTag} style={{ color: m.color, borderColor: m.color }}>
      {m.label}
    </span>
  );
}

const SOURCE_LABEL: Record<PrincipleView["source"], string> = {
  llm: "凝练而成",
  fallback: "规则凝练",
  forced: "强制执行后留下",
  revised: "你修订过",
  core: "核心",
  note: "来自你的留言"
};

export function PrincipleTablet({ p, delayMs, appear = false }: { p: PrincipleView; delayMs?: number; appear?: boolean }) {
  const m = DOMAIN_META[p.domain];
  const weight = Math.max(0, Math.min(1, p.weight));
  return (
    <article
      className={`${styles.tablet} ${p.dormant ? styles.tabletDormant : ""} ${appear ? styles.tabletAppear : ""}`}
      style={{ ["--dom" as string]: m.color, animationDelay: delayMs ? `${delayMs}ms` : undefined }}
    >
      <header className={styles.tabletHead}>
        <DomainTag domain={p.domain} />
        {p.dormant ? <span className={styles.dormantNote}>沉睡中</span> : null}
        <span className={styles.tabletSource}>{SOURCE_LABEL[p.source]}</span>
      </header>
      <p className={styles.tabletText}>『{p.text}』</p>
      <div className={styles.weightRow} title={`权重 ${weight.toFixed(2)}`}>
        <span>分量</span>
        <span className={styles.weightTrack}>
          <i style={{ width: `${Math.round(weight * 100)}%` }} />
        </span>
        <span className={styles.cited}>被引用 {p.citedCount} 次</span>
      </div>
      {p.origin ? <p className={styles.tabletOrigin}>{p.origin}</p> : null}
    </article>
  );
}

export function TabletPlaceholder({ n }: { n: number }) {
  return (
    <div className={styles.tabletShimmer} aria-hidden>
      <span style={{ animationDelay: `${n * 140}ms` }} />
    </div>
  );
}

// ───────────────────────────── focus handling ─────────────────────────────

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** "focus-trap lite": focus moves into the dialog, Tab wraps inside it, focus returns on close */
export function useFocusTrap(active: boolean): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = node.querySelector<HTMLElement>("[data-autofocus]") ?? node.querySelector<HTMLElement>(FOCUSABLE) ?? node;
    window.setTimeout(() => first.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const a = items[0];
      const z = items[items.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === a || !node.contains(cur))) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (cur === z || !node.contains(cur))) {
        e.preventDefault();
        a.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active]);
  return ref;
}

// ───────────────────────────── buttons ─────────────────────────────

/**
 * The game's bevel button. `data-sfx` tells GameShell's one delegated click listener which sound to make:
 * default "click"; `sfx="confirm"` for buttons that commit something (choose, resolve, send); `sfx="none"` for
 * buttons whose action makes its own sound.
 */
export function Btn({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  busy,
  type = "button",
  title,
  full,
  autoFocus,
  sfx,
  className
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  /** md: 24 px label (the pixel font's 2x), sm: 12 px label */
  size?: "md" | "sm";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  title?: string;
  full?: boolean;
  autoFocus?: boolean;
  sfx?: "confirm" | "none";
  className?: string;
}) {
  const v = variant === "primary" ? styles.btnPrimary : variant === "danger" ? styles.btnDanger : variant === "ghost" ? styles.btnGhost : "";
  return (
    <button
      type={type}
      className={`${styles.btn} ${v} ${size === "sm" ? styles.btnSm : ""} ${full ? styles.btnFull : ""} ${className ?? ""}`}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      aria-busy={busy || undefined}
      data-autofocus={autoFocus ? "" : undefined}
      data-sfx={sfx}
    >
      {busy ? <Spinner size={14} /> : null}
      <span>{children}</span>
    </button>
  );
}
