"use client";

// The "game shell" screens around the town: loading, title, the day card, the welcome-back card, the help dialog and the
// 更多 sheet. (The HUD itself is in TopHud / SidePanels / Overlays, the dialogs in Modals.)

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AgentView, FeedItem } from "@/lib/types";
import { KEY_HELP } from "../game/keymap";
import { Btn, GLYPH_GEAR, GLYPH_SOUND_OFF, GLYPH_SOUND_ON, Icon, Keycap, PixelGlyph, Portrait, SunMoon } from "./common";
import { ModalFrame } from "./Modals";
import g from "./game.module.css";

// ───────────────────────────── loading ─────────────────────────────

const BAR_SEGMENTS = 20;

/** First load must never look frozen: a pixel progress bar with the Preloader's real percentage (EventBus
 *  `load-progress`), then "entering the town" while the first snapshot is still on its way. */
export function LoadingScreen({ progress, waitingForTown }: { progress: number; waitingForTown: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const filled = Math.round((pct / 100) * BAR_SEGMENTS);
  return (
    <div className={g.loading} role="status" aria-live="polite">
      <div className={g.loadingBox}>
        <h1 className={g.loadingTitle}>POLIS</h1>
        <div className={g.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="加载进度">
          {Array.from({ length: BAR_SEGMENTS }, (_, i) => (
            <i key={i} className={i < filled ? g.barOn : ""} />
          ))}
        </div>
        <p className={g.loadingText}>
          <span className={g.loadingPct}>{pct}%</span>
          <span>{waitingForTown ? "正在进入小镇…" : "正在搬运小镇的砖瓦…"}</span>
        </p>
      </div>
    </div>
  );
}

// ───────────────────────────── title ─────────────────────────────

export function TitleScreen({
  me,
  day,
  leaving,
  blocked = false,
  soundOn,
  onToggleSound,
  onStart,
  onMenu
}: {
  /** my Agent, when a game already exists ("继续"); null for a new player ("开始") */
  me: AgentView | null;
  day: number;
  leaving: boolean;
  /** a dialog (设置 / 制作名单 / 新的存档) is open above the title: nothing on the title can be reached until it closes */
  blocked?: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onStart: () => void;
  /** the secondary title-menu entries (新的存档 / 设置 / 制作名单) */
  onMenu?: (item: "newsave" | "settings" | "credits") => void;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  const blockedRef = useRef(blocked);
  useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);
  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
    // Enter starts the game even when focus is elsewhere (a button that has focus handles Enter itself)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || leaving || blockedRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "BUTTON" || t.tagName === "INPUT")) return;
      onStart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leaving, onStart]);
  return (
    <div className={`${g.title} ${leaving ? g.titleLeaving : ""}`} role="dialog" aria-label="Polis" inert={blocked}>
      <div className={g.shade} aria-hidden />
      <div className={g.logoBox}>
        <h1 className={g.logo}>POLIS</h1>
        <p className={g.tagline}>你是守护灵。它会记住你。</p>
      </div>
      <div className={g.menu}>
        <button ref={startRef} type="button" className={g.startBtn} onClick={onStart} disabled={leaving} data-sfx="none">
          <span className={g.startArrow} aria-hidden />
          <span>{me ? "继续" : "开始"}</span>
        </button>
        {me ? (
          <p className={g.save}>
            <Portrait sprite={me.sprite} size={32} player />
            <span>
              {me.name} · 第 {day} 天
            </span>
          </p>
        ) : (
          <p className={g.save}>给它起个名字，让它入城</p>
        )}
        {onMenu ? (
          <nav className={g.subMenu} aria-label="更多">
            {me ? (
              <button type="button" className={g.subBtn} onClick={() => onMenu("newsave")} disabled={leaving}>
                新的存档
              </button>
            ) : null}
            <button type="button" className={g.subBtn} onClick={() => onMenu("settings")} disabled={leaving}>
              设置
            </button>
            <button type="button" className={g.subBtn} onClick={() => onMenu("credits")} disabled={leaving}>
              制作名单
            </button>
          </nav>
        ) : null}
      </div>
      <button type="button" className={g.soundBtn} onClick={onToggleSound} aria-pressed={soundOn} title={soundOn ? "关闭声音" : "打开声音"}>
        <PixelGlyph rows={soundOn ? GLYPH_SOUND_ON : GLYPH_SOUND_OFF} scale={2} />
        <span>声音 {soundOn ? "开" : "关"}</span>
      </button>
      <p className={g.credit}>像素美术与音乐 CC0 · Ninja Adventure · 字体 Fusion Pixel</p>
      <div className={g.curtainOut} aria-hidden />
    </div>
  );
}

/** a black curtain that clears: the second half of the title -> game fade (the first half is TitleScreen's) */
export function FadeIn({ onDone }: { onDone: () => void }) {
  return <div className={g.curtainIn} onAnimationEnd={onDone} aria-hidden />;
}

// ───────────────────────────── day card ─────────────────────────────

/** "第 N 天": a title card that fades in and out in about 1.6 s. It never blocks anything; a click skips it. */
export function DayCard({ day, night, onDone }: { day: number; night: boolean; onDone: () => void }) {
  const [phase, setPhase] = useState<"pre" | "in" | "out">("pre");
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    const t0 = window.setTimeout(() => setPhase("in"), 30);
    const t1 = window.setTimeout(() => setPhase("out"), 1050);
    const t2 = window.setTimeout(() => doneRef.current(), 1600);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  const skip = () => {
    setPhase("out");
    window.setTimeout(() => doneRef.current(), 260);
  };
  return (
    <div className={g.dayWrap} role="status" aria-live="polite">
      <button type="button" className={`${g.dayCard} ${phase === "in" ? g.dayIn : ""} ${phase === "out" ? g.dayOut : ""}`} onClick={skip} data-sfx="none" aria-label={`第 ${day} 天`}>
        <span className={g.daySmall}>
          <SunMoon night={night} size={16} /> 新的一天
        </span>
        <span className={g.dayBig}>第 {day} 天</span>
      </button>
    </div>
  );
}

// ───────────────────────────── welcome back ─────────────────────────────

export interface WelcomeSummary {
  /** town events since the player last looked, and whether the feed was long enough to have lost the older ones */
  events: number;
  capped: boolean;
  /** how many of them involve my Agent */
  mine: number;
  /** the headlines: the most important lines since then (mine first) */
  headlines: FeedItem[];
  /** times the Agent had to decide on its own because nobody answered (real feed rows) */
  decidedAlone: number;
}

/** What changed while the player was away, in the order it matters, and one button that leads to the next thing worth doing. */
export function WelcomeBackCard({
  awayLabel,
  name,
  summary,
  unread,
  pending,
  urgentLeft,
  onPostcards,
  onRespond,
  onClose
}: {
  awayLabel: string;
  name: string;
  summary: WelcomeSummary;
  unread: number;
  pending: number;
  /** "5 小时": how long the oldest open fork still has before the Agent decides without you */
  urgentLeft: string | null;
  onPostcards: () => void;
  onRespond: () => void;
  onClose: () => void;
}) {
  // the one primary button: a question waiting for you beats a postcard, a postcard beats "just look"
  const primary: "respond" | "postcards" | "town" = pending > 0 ? "respond" : unread > 0 ? "postcards" : "town";
  const next =
    primary === "respond"
      ? urgentLeft
        ? `有 ${pending} 件事等你回应，最急的一件还剩 ${urgentLeft}，之后它会自己决定。`
        : `有 ${pending} 件事等你回应。`
      : primary === "postcards"
        ? `${name} 给你写了 ${unread} 张还没读的明信片。`
        : `没有等你的事。${name} 在按自己的节奏过日子。`;
  const respondBtn = (
    <Btn variant={primary === "respond" ? "primary" : "default"} onClick={onRespond} autoFocus={primary === "respond"} sfx="confirm">
      去回应它{pending > 1 ? `（${pending}）` : ""}
    </Btn>
  );
  const cardBtn = (
    <Btn variant={primary === "postcards" ? "primary" : "default"} onClick={onPostcards} autoFocus={primary === "postcards"} sfx="confirm">
      读明信片{unread > 1 ? `（${unread}）` : ""}
    </Btn>
  );
  return (
    <ModalFrame title="欢迎回来" eyebrow={`你离开了 ${awayLabel}`} onClose={onClose} wide tone="gold">
      <p className={g.welcomeCount}>
        这段时间小镇里发生了{" "}
        <b>
          {summary.events}
          {summary.capped ? "+" : ""}
        </b>{" "}
        件事
        {summary.mine > 0 ? (
          <>
            ，其中 <b>{summary.mine}</b> 件和 {name} 有关
          </>
        ) : null}
        。
      </p>
      <section className={g.welcomeLines} aria-label="这段时间的要闻">
        <h3>要闻</h3>
        {summary.headlines.length > 0 ? (
          <ul>
            {summary.headlines.map((l) => (
              <li key={l.id}>
                <time>{l.clock}</time>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={g.welcomeQuiet}>没什么特别的事。</p>
        )}
        {summary.decidedAlone > 0 ? <p className={g.welcomeAlone}>没等到你的回应，它自己拿了 {summary.decidedAlone} 次主意。</p> : null}
      </section>
      <p className={g.welcomeNext}>{next}</p>
      <div className={g.welcomeActions}>
        {primary === "respond" ? respondBtn : null}
        {unread > 0 ? cardBtn : null}
        {primary !== "respond" && pending > 0 ? respondBtn : null}
        <Btn variant={primary === "town" ? "primary" : "ghost"} onClick={onClose} autoFocus={primary === "town"}>
          看看小镇
        </Btn>
      </div>
    </ModalFrame>
  );
}

// ───────────────────────────── help ─────────────────────────────

const HOW_TO_PLAY: ReactNode[] = [
  <>你没有身体，也不能指挥它。它自己安排一天。</>,
  <>
    它拿不定主意时，会来问你一句——这是 <b>岔路</b>。你的回答会被记成 <b>烙印</b>。
  </>,
  <>
    它有自己的立场：可能 <b>照做</b>、<b>调整</b>，或 <b>拒绝</b>。拒绝时你可以强制执行，要付 30 Scrip，它对你的信任也会 −10。
  </>,
  <>
    有时它被人说动，回来 <b>质问</b> 自己的某条原则：你可以让它重申，或修订。
  </>,
  <>
    每天最多 3 条 <b>留言</b>（50 字以内）。它不会秒回，会在夜里的 <b>明信片</b> 里回应你。
  </>,
  <>点居民或建筑，看他在做什么、为什么；点小镇动态里的一条，镜头会带你过去。</>
];

/** 帮助: how the game works, then the keys. One home for both (the button is top-right, or inside 更多 on a phone). */
export function HelpModal({ phone, onClose, onBack }: { phone: boolean; onClose: () => void; onBack?: () => void }) {
  return (
    <ModalFrame title="帮助" eyebrow="你是守护灵" onClose={onClose} onBack={onBack} wide>
      <section className={g.helpHow} aria-label="玩法">
        <ul>
          {HOW_TO_PLAY.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      </section>
      <details className={g.keysBox} open={!phone}>
        <summary>键盘按键{phone ? "（有键盘时）" : ""}</summary>
        <div className={g.keyGroups}>
          {KEY_HELP.map((group) => (
            <section key={group.title} className={g.keyGroup}>
              <h3>{group.title}</h3>
              <ul>
                {group.rows.map((row) => (
                  <li key={row.label}>
                    <span className={g.keyCaps}>
                      {row.keys.map((alt, i) => (
                        <span key={i} className={g.keyAlt}>
                          {i > 0 ? <em>或</em> : null}
                          {alt.map((k) => (
                            <Keycap key={k}>{k}</Keycap>
                          ))}
                        </span>
                      ))}
                    </span>
                    <span className={g.keyLabel}>{row.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className={g.keyNote}>在输入框里打字时，这些按键不会生效。手机上：拖动镜头，双指缩放。</p>
      </details>
    </ModalFrame>
  );
}

// ───────────────────────────── top-right system buttons, 更多 ─────────────────────────────

export function HelpButton({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <button type="button" className={`${g.hudBtn} ${open ? g.hudBtnOn : ""}`} onClick={onClick} title="帮助（?）" aria-haspopup="dialog">
      <span className={g.hudBtnText} aria-hidden>
        ?
      </span>
      <span className={g.srOnly}>帮助</span>
    </button>
  );
}

export function SettingsButton({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <button type="button" className={`${g.hudBtn} ${open ? g.hudBtnOn : ""}`} onClick={onClick} title="设置：声音、动态效果" aria-haspopup="dialog" data-coach="settings">
      <PixelGlyph rows={GLYPH_GEAR} scale={2} />
      <span className={g.srOnly}>设置</span>
    </button>
  );
}

export interface MoreItem {
  key: string;
  icon?: string;
  glyph?: string[];
  label: string;
  hint: string;
  onClick: () => void;
}

/** 更多 (phones): the desktop rail and the top-right buttons, as one sheet. Opening one replaces the sheet. */
export function MoreSheet({ items, onClose }: { items: MoreItem[]; onClose: () => void }) {
  return (
    <ModalFrame title="更多" onClose={onClose}>
      <ul className={g.moreGrid}>
        {items.map((it) => (
          <li key={it.key}>
            <button type="button" className={g.moreItem} onClick={it.onClick}>
              <span className={g.moreIcon} aria-hidden>
                {it.icon ? <Icon name={it.icon} size={32} /> : it.glyph ? <PixelGlyph rows={it.glyph} scale={2} /> : null}
              </span>
              <span className={g.moreText}>
                <b>{it.label}</b>
                <small>{it.hint}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ModalFrame>
  );
}
