"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { JudgmentView } from "@/lib/types";
import type { GameActions } from "../actions";
import { Btn, Icon, Spinner } from "./common";
import styles from "./hud.module.css";

// ───────────────────────────── guardian dock (bottom-centre) ─────────────────────────────

export function Dock({
  pending,
  noteLeft,
  unread,
  onDecisions,
  onNote,
  onPostcards,
  onPrinciples
}: {
  pending: number;
  noteLeft: number;
  unread: number;
  onDecisions: () => void;
  onNote: () => void;
  onPostcards: () => void;
  onPrinciples: () => void;
}) {
  return (
    <nav className={`${styles.panel} ${styles.dock}`} aria-label="守护灵">
      <button type="button" className={`${styles.dockBtn} ${pending > 0 ? styles.dockPulse : ""}`} onClick={onDecisions} data-coach="decisions">
        <Icon name="help" size={30} />
        <span className={styles.dockLabel}>岔路</span>
        {pending > 0 ? <span className={styles.badge}>{pending}</span> : null}
      </button>
      <button type="button" className={styles.dockBtn} onClick={onNote} data-coach="note">
        <Icon name="keyboard" size={30} />
        <span className={styles.dockLabel}>留言</span>
        <span className={`${styles.badge} ${styles.badgeSoft}`}>{noteLeft}/3</span>
      </button>
      <button type="button" className={`${styles.dockBtn} ${unread > 0 ? styles.dockPulse : ""}`} onClick={onPostcards} data-coach="postcard">
        <Icon name="ticket" size={30} />
        <span className={styles.dockLabel}>明信片</span>
        {unread > 0 ? <span className={styles.badge}>{unread}</span> : null}
      </button>
      <button type="button" className={styles.dockBtn} onClick={onPrinciples}>
        <Icon name="thoughts" size={30} />
        <span className={styles.dockLabel}>烙印</span>
      </button>
    </nav>
  );
}

export function LocateButton({ following, onClick }: { following: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.locate} ${following ? styles.locateOn : ""}`}
      onClick={onClick}
      aria-pressed={following}
      title={following ? "正在跟随（再点一次取消）" : "定位我的 Agent"}
    >
      <Icon name="player-marker" size={30} />
      <span className={styles.srOnly}>定位我的 Agent</span>
    </button>
  );
}

// ───────────────────────────── test fast-forward ─────────────────────────────

export function TestPanel({ busy, onAdvance }: { busy: boolean; onAdvance: GameActions["advance"] }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.matchMedia("(max-width: 760px)").matches) setOpen(false);
    } catch {
      /* ignore */
    }
  }, []);
  const btn = (label: string, opts: Parameters<GameActions["advance"]>[0]) => (
    <button type="button" className={styles.testBtn} disabled={busy} onClick={() => void onAdvance(opts).catch(() => undefined)}>
      {label}
    </button>
  );
  return (
    <section className={`${styles.panel} ${styles.testPanel}`} aria-label="测试快进">
      <button type="button" className={styles.testHead} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>🧪 测试快进（仅测试用）</span>
        {busy ? <Spinner size={14} /> : <span aria-hidden>{open ? "▾" : "▸"}</span>}
      </button>
      {open ? (
        <div className={styles.testBtns}>
          {btn("+1 小时", { hours: 1 })}
          {btn("到今晚 23:00", { to: "night" })}
          {btn("到明早 06:00", { to: "morning" })}
          {btn("+24 小时", { hours: 24 })}
        </div>
      ) : null}
    </section>
  );
}

// ───────────────────────────── toasts ─────────────────────────────

export interface ToastItem {
  id: number;
  text: string;
  tone: "player" | "principle" | "postcard" | "judgment" | "info";
}

const TOAST_ICON: Record<ToastItem["tone"], string> = {
  player: "player-marker",
  principle: "diary",
  postcard: "ticket",
  judgment: "reputation",
  info: "game"
};

export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className={styles.toasts} aria-live="polite">
      {items.map((t) => (
        <ToastRow key={t.id} item={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const h = window.setTimeout(() => onDismiss(item.id), item.tone === "principle" ? 6500 : 4800);
    return () => window.clearTimeout(h);
  }, [item.id, item.tone, onDismiss]);
  return (
    <button type="button" className={`${styles.toast} ${styles[`toast_${item.tone}`]}`} onClick={() => onDismiss(item.id)}>
      <Icon name={TOAST_ICON[item.tone]} size={20} />
      <span>{item.text}</span>
    </button>
  );
}

// ───────────────────────────── banners / loading ─────────────────────────────

export function Banner({ kind, text, onClose }: { kind: "conn" | "error"; text: string; onClose?: () => void }) {
  return (
    <div className={`${styles.banner} ${kind === "error" ? styles.bannerErr : styles.bannerConn}`} role={kind === "error" ? "alert" : "status"}>
      {kind === "conn" ? <Spinner size={14} /> : null}
      <span>{text}</span>
      {onClose ? (
        <button type="button" className={styles.bannerClose} onClick={onClose} aria-label="关闭提示">
          ✕
        </button>
      ) : null}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <div className={styles.loadingBox}>
        <span className={styles.loadingTitle}>POLIS</span>
        <span className={styles.pixelSpinner} aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className={styles.loadingText}>正在进入小镇…</span>
      </div>
    </div>
  );
}

// ───────────────────────────── judgment feedback (inline) ─────────────────────────────

export function FeedbackPrompt({
  judgment,
  busy,
  onPick,
  onDismiss
}: {
  judgment: JudgmentView;
  busy: boolean;
  onPick: (value: "expected" | "surprising_reasonable" | "confusing") => void;
  onDismiss: () => void;
}) {
  return (
    <section className={`${styles.panel} ${styles.feedback}`} aria-label="反馈">
      <p>这次它的反应让你觉得：</p>
      <div className={styles.feedbackBtns}>
        <Btn busy={busy} onClick={() => onPick("expected")}>
          意料之中
        </Btn>
        <Btn busy={busy} onClick={() => onPick("surprising_reasonable")}>
          意外但合理
        </Btn>
        <Btn busy={busy} onClick={() => onPick("confusing")}>
          莫名其妙
        </Btn>
      </div>
      <button type="button" className={styles.closeBtn} onClick={onDismiss} aria-label="不评价">
        ✕
      </button>
    </section>
  );
}

// ───────────────────────────── coach marks ─────────────────────────────

export interface CoachStep {
  key: string;
  /** "agent" is resolved from the scene's screen position; others are data-coach selectors */
  target: "agent" | string;
  text: string;
}

interface Hole {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function CoachMarks({
  step,
  index,
  total,
  getPlayerScreen,
  onNext,
  onSkip
}: {
  step: CoachStep;
  index: number;
  total: number;
  /** live position of my Agent in the viewport, read every frame */
  getPlayerScreen: () => { x: number; y: number } | null;
  onNext: () => void;
  onSkip: () => void;
}) {
  const [hole, setHole] = useState<Hole | null>(null);
  const missing = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef(onNext);
  useEffect(() => {
    nextRef.current = onNext;
  });
  // the mask does not block the page: using any other control (dock, rail, ...) simply counts as "got it"
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || cardRef.current?.contains(t)) return;
      if (t.closest("button, a, [role=button], [role=tab]")) nextRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);
  const playerRef = useRef(getPlayerScreen);
  useEffect(() => {
    playerRef.current = getPlayerScreen;
  });

  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      let next: Hole | null = null;
      if (step.target === "agent") {
        const p = playerRef.current();
        if (p) next = { x: p.x - 54, y: p.y - 70, w: 108, h: 132 };
      } else {
        const el = document.querySelector<HTMLElement>(`[data-coach="${step.target}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          if (r.width > 0) next = { x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12 };
        }
      }
      setHole((prev) => {
        if (!next) return prev === null ? prev : null;
        if (prev && Math.abs(prev.x - next.x) < 1 && Math.abs(prev.y - next.y) < 1 && Math.abs(prev.w - next.w) < 1 && Math.abs(prev.h - next.h) < 1) return prev;
        return next;
      });
      if (!next) {
        missing.current += 1;
        // a DOM target that never shows up (8 s) is skipped; the town target just waits for the scene to load
        if (step.target !== "agent" && missing.current > 480) onNext();
      } else missing.current = 0;
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [step, onNext]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 720;
  const cardW = Math.min(300, vw - 24);

  // Where the tooltip card sits. For a target that walks around (my Agent) the card is pinned the first
  // time it is placed, so its buttons never move; only the cut-out ring and the little arrow follow.
  interface Place {
    below: boolean;
    cx: number;
    top: number;
  }
  const pinned = useRef<{ key: string; place: Place } | null>(null);
  let place: Place | null = null;
  if (hole) {
    const below = hole.y + hole.h + 16 + 150 < vh;
    place = {
      below,
      cx: Math.min(vw - cardW / 2 - 12, Math.max(cardW / 2 + 12, hole.x + hole.w / 2)),
      top: below ? hole.y + hole.h + 14 : Math.max(8, hole.y - 14)
    };
    if (step.target === "agent") {
      if (!pinned.current || pinned.current.key !== step.key) pinned.current = { key: step.key, place };
      place = pinned.current.place;
    }
  }
  let cardStyle: CSSProperties = { left: "50%", top: "40%", transform: "translateX(-50%)" };
  const arrow: "up" | "down" = place && !place.below ? "down" : "up";
  if (place && hole) {
    const arrowX = Math.min(cardW - 28, Math.max(28, hole.x + hole.w / 2 - (place.cx - cardW / 2)));
    cardStyle = {
      left: place.cx,
      top: place.top,
      transform: place.below ? "translateX(-50%)" : "translate(-50%, -100%)",
      ["--arrow-x" as string]: `${arrowX}px`
    };
  }
  return (
    <div className={styles.coach} role="dialog" aria-label="新手提示">
      {hole ? <div className={styles.coachHole} style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h }} /> : <div className={styles.coachFull} />}
      <div ref={cardRef} className={`${styles.coachCard} ${arrow === "up" ? styles.coachUp : styles.coachDown}`} style={cardStyle}>
        <p>{step.text}</p>
        <div className={styles.coachFoot}>
          <span className={styles.coachStep}>
            {index + 1}/{total}
          </span>
          <button type="button" className={styles.coachSkip} onClick={onSkip}>
            跳过
          </button>
          <Btn variant="primary" onClick={onNext} autoFocus>
            知道了
          </Btn>
        </div>
      </div>
    </div>
  );
}
