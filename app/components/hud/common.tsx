"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { Domain, PrincipleView } from "@/lib/types";
import { SPRITE_KEYS, facePath, normalizeSprite } from "../town/characters";
import styles from "./hud.module.css";

// ───────────────────────────── icons & portraits ─────────────────────────────

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/assets/aiv/ui/icon-${name}.png`}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`${styles.icon} ${className ?? ""}`}
    />
  );
}

export const KNOWN_SPRITES: string[] = SPRITE_KEYS;

/** 38x38 faceset portrait of a logical sprite — the same character the town draws (town/characters.ts) */
export function Portrait({ sprite, size = 48, player = false, className }: { sprite: string; size?: number; player?: boolean; className?: string }) {
  const key = normalizeSprite(sprite);
  return (
    <span
      className={`${styles.portrait} ${player ? styles.portraitPlayer : ""} ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={facePath(key)} alt="" draggable={false} />
    </span>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className={styles.spinner} style={{ width: size, height: size }} role="status" aria-label="处理中" />;
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

export const DOMAIN_META: Record<Domain, { label: string; color: string }> = {
  trust: { label: "信任", color: "#5cc8a4" },
  risk: { label: "风险", color: "#f08a4b" },
  integrity: { label: "原则", color: "#7aa2ff" }
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

export function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
  busy,
  type = "button",
  title,
  full,
  autoFocus,
  className
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  title?: string;
  full?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const v = variant === "primary" ? styles.btnPrimary : variant === "danger" ? styles.btnDanger : variant === "ghost" ? styles.btnGhost : "";
  return (
    <button
      type={type}
      className={`${styles.btn} ${v} ${full ? styles.btnFull : ""} ${className ?? ""}`}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      aria-busy={busy || undefined}
      data-autofocus={autoFocus ? "" : undefined}
    >
      {busy ? <Spinner size={14} /> : null}
      <span>{children}</span>
    </button>
  );
}
