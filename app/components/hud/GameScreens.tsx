"use client";

// The "game shell" screens around the town: loading, title, the day card, the welcome-back card, the key help and the
// sound popover. (The HUD itself is in TopHud / SidePanels / Overlays, the dialogs in Modals.)

import { useEffect, useRef, useState } from "react";
import type { AgentView, FeedItem } from "@/lib/types";
import type { AudioSettings, AudioStatus } from "../game/keys";
import { KEY_HELP } from "../game/keymap";
import { Btn, CloseGlyph, GLYPH_SOUND_OFF, GLYPH_SOUND_ON, Keycap, PixelGlyph, Portrait, SunMoon } from "./common";
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
  soundOn,
  onToggleSound,
  onStart
}: {
  /** my Agent, when a game already exists ("继续"); null for a new player ("开始") */
  me: AgentView | null;
  day: number;
  leaving: boolean;
  soundOn: boolean;
  onToggleSound: () => void;
  onStart: () => void;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
    // Enter starts the game even when focus is elsewhere (a button that has focus handles Enter itself)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || leaving) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "BUTTON" || t.tagName === "INPUT")) return;
      onStart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leaving, onStart]);
  return (
    <div className={`${g.title} ${leaving ? g.titleLeaving : ""}`} role="dialog" aria-label="Polis">
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

export function WelcomeBackCard({
  awayLabel,
  eventCount,
  eventsCapped,
  lines,
  unread,
  pending,
  onPostcards,
  onRespond,
  onClose
}: {
  awayLabel: string;
  eventCount: number;
  eventsCapped: boolean;
  lines: FeedItem[];
  unread: number;
  pending: number;
  onPostcards: () => void;
  onRespond: () => void;
  onClose: () => void;
}) {
  return (
    <ModalFrame title="欢迎回来" eyebrow={`你离开了 ${awayLabel}`} onClose={onClose} wide tone="gold">
      <p className={g.welcomeCount}>
        这段时间，小镇里发生了 <b>{eventCount}{eventsCapped ? "+" : ""}</b> 件事。
      </p>
      <section className={g.welcomeLines} aria-label="它的这段时间">
        <h3>它这段时间</h3>
        {lines.length > 0 ? (
          <ul>
            {lines.map((l) => (
              <li key={l.id}>
                <time>{l.clock}</time>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={g.welcomeQuiet}>没什么特别的事。它在按自己的节奏过日子。</p>
        )}
      </section>
      <div className={g.welcomeActions}>
        {unread > 0 ? (
          <Btn variant="primary" onClick={onPostcards} autoFocus sfx="confirm">
            读明信片{unread > 1 ? `（${unread}）` : ""}
          </Btn>
        ) : null}
        {pending > 0 ? (
          <Btn variant={unread > 0 ? "default" : "primary"} onClick={onRespond} autoFocus={unread === 0} sfx="confirm">
            去回应它{pending > 1 ? `（${pending}）` : ""}
          </Btn>
        ) : null}
        <Btn variant={unread === 0 && pending === 0 ? "primary" : "default"} onClick={onClose} autoFocus={unread === 0 && pending === 0}>
          看看小镇
        </Btn>
      </div>
    </ModalFrame>
  );
}

// ───────────────────────────── key help ─────────────────────────────

export function KeyHelp({ onClose }: { onClose: () => void }) {
  return (
    <ModalFrame title="按键说明" eyebrow="键盘玩法（手机：拖动镜头，双指缩放）" onClose={onClose} wide>
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
      <p className={g.keyNote}>在输入框里打字时，这些按键不会生效。</p>
    </ModalFrame>
  );
}

// ───────────────────────────── sound ─────────────────────────────

export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className={g.hudBtn} onClick={onClick} title="按键说明（?）">
      <span className={g.hudBtnText} aria-hidden>
        ?
      </span>
      <span className={g.srOnly}>按键说明</span>
    </button>
  );
}

export function SoundButton({ open, on, onToggle }: { open: boolean; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`${g.hudBtn} ${open ? g.hudBtnOn : ""}`} onClick={onToggle} aria-haspopup="dialog" aria-expanded={open} title="声音设置" data-coach="sound">
      <PixelGlyph rows={on ? GLYPH_SOUND_ON : GLYPH_SOUND_OFF} scale={2} />
      <span className={g.srOnly}>声音设置</span>
    </button>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`${g.switch} ${on ? g.switchOn : ""}`} onClick={() => onChange(!on)}>
      <span>{on ? "开" : "关"}</span>
    </button>
  );
}

function VolumeRow({ title, on, vol, onOn, onVol }: { title: string; on: boolean; vol: number; onOn: (v: boolean) => void; onVol: (v: number) => void }) {
  return (
    <div className={g.volRow}>
      <span className={g.volTitle}>{title}</span>
      <Switch on={on} onChange={onOn} label={`${title}开关`} />
      <input
        type="range"
        className={g.range}
        min={0}
        max={10}
        step={1}
        value={Math.round(vol * 10)}
        disabled={!on}
        onChange={(e) => onVol(Number(e.target.value) / 10)}
        aria-label={`${title}音量`}
      />
    </div>
  );
}

/** the 🔊 popover: music on/off + volume, sound effects on/off + volume. Settings persist (localStorage). */
export function SoundMenu({ settings, status, onUpdate, onClose }: { settings: AudioSettings; status: AudioStatus | null; onUpdate: (p: Partial<AudioSettings>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || ref.current?.contains(t) || t.closest("[data-coach=sound]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);
  const failed = status?.failed.length ?? 0;
  return (
    <div ref={ref} className={g.soundMenu} role="dialog" aria-label="声音设置">
      <h3>声音</h3>
      <VolumeRow title="音乐" on={settings.music} vol={settings.musicVol} onOn={(v) => onUpdate({ music: v })} onVol={(v) => onUpdate({ musicVol: v })} />
      <VolumeRow title="音效" on={settings.sfx} vol={settings.sfxVol} onOn={(v) => onUpdate({ sfx: v })} onVol={(v) => onUpdate({ sfxVol: v })} />
      {status?.locked && (settings.music || settings.sfx) ? <p className={g.soundNote}>浏览器要先收到一次点击，才允许出声。</p> : null}
      {failed > 0 ? <p className={g.soundNote}>有 {failed} 个声音文件没能加载，游戏会安静地继续。</p> : null}
      <button type="button" className={g.soundClose} onClick={onClose} aria-label="关闭">
        <CloseGlyph scale={2} />
      </button>
    </div>
  );
}
