"use client";

// The complete game UI: Phaser town + HUD + modals. It is purely driven by props
// (snapshot / actions / busy / error / connection) so whoever owns the data can
// wire it to the real API, or to the dev fixture.
//
// Guardian-spirit rules this UI keeps: no free chat, no needs bars, no direct
// control of the Agent. The player only answers forks (岔路), judgments, wavering
// challenges, leaves ≤50-char notes and reads the nightly postcard.
//
// It is also the game's shell: loading screen -> title screen -> play, the music bed
// (title / day / night), sound effects derived from snapshot diffs, the keyboard map
// (game/keymap.ts), the "第 N 天" card and the welcome-back card.
//
// Typography (decided by screenshot, see hud/*.module.css): the pixel font at 12 px for all chrome
// and small text, at 24 px for headings, buttons, key numbers AND for the prose that carries the
// story (fork prompts, the Agent's judgment speech, postcards). Fusion Pixel's CJK glyphs are
// designed on a 12 px grid and stay perfectly readable at 24 px, so the long texts keep the same
// pixel look as the chrome instead of switching to a system font.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentView, FeedItem, GameSnapshot, LocationId, MomentView } from "@/lib/types";
import type { BusyKey, GameActions } from "./actions";
import PhaserTown, { type PhaserTownHandle } from "./town/PhaserTown";
import { readLocationMeta, type LocationMeta, type TiledMap } from "./town/tiled";
import { TOWN_MAP_URL, ensurePixelFont, type BgmMode } from "./game/keys";
import { AgentCard, ActionBar, ClockPill, OffsetNote, StatusPills } from "./hud/TopHud";
import { Drawer, FeedPanel, Inspector, LocationCard, Rail, type DrawerTab } from "./hud/SidePanels";
import { Banner, CoachMarks, Dock, FeedbackPrompt, LocateButton, TestPanel, Toasts, type CoachStep, type ToastItem } from "./hud/Overlays";
import { ForkModal, ImprintModal, JudgmentModal, NoteModal, OnboardingModal, PostcardModal, WaveringModal } from "./hud/Modals";
import { DayCard, FadeIn, HelpButton, KeyHelp, LoadingScreen, SoundButton, SoundMenu, TitleScreen, WelcomeBackCard } from "./hud/GameScreens";
import { townSocialFor } from "./hud/social";
import { dayNumber, fmtClock } from "./hud/time";
import { emitToTown, onTown } from "./game/bus";
import { useAudio } from "./game/useAudio";
import { PAN_CODES, isTypingTarget } from "./game/keymap";
import hud from "./hud/hud.module.css";
import styles from "./GameShell.module.css";

export type GameShellProps = {
  snapshot: GameSnapshot | null;
  actions: GameActions;
  busy: BusyKey;
  error: string | null;
  /** "retrying" shows the reconnect banner; defaults to "ok" */
  connection?: "ok" | "retrying";
  /** dev QA: draw the road graph / areas over the town */
  debugTown?: boolean;
};

type UserModal = "note" | "postcards" | "moments" | null;

const COACH_KEY = "polis.coach.v1.";
const RATED_KEY = "polis.rated.v1";

function readSeen(): Set<string> {
  const out = new Set<string>();
  try {
    for (const k of ["agent", "activity", "note", "postcard"]) if (window.localStorage.getItem(COACH_KEY + k)) out.add(k);
  } catch {
    /* storage may be blocked */
  }
  return out;
}

function writeSeen(keys: string[]): void {
  try {
    for (const k of keys) window.localStorage.setItem(COACH_KEY + k, "1");
  } catch {
    /* ignore */
  }
}

function readRated(): number[] {
  try {
    const raw = window.localStorage.getItem(RATED_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}

// "welcome back": where the sim clock stood when the player last looked (per Agent, in sim ms)
const LAST_SEEN_KEY = "polis.lastSeenSimMs.v1";
const AWAY_THRESHOLD_MS = 2 * 3_600_000;

function readLastSeen(): { ms: number; createdAtMs: number } | null {
  try {
    const raw = window.localStorage.getItem(LAST_SEEN_KEY);
    const v = raw ? (JSON.parse(raw) as { ms?: unknown; createdAtMs?: unknown }) : null;
    return v && typeof v.ms === "number" && typeof v.createdAtMs === "number" ? { ms: v.ms, createdAtMs: v.createdAtMs } : null;
  } catch {
    return null;
  }
}

function writeLastSeen(ms: number, createdAtMs: number): void {
  try {
    window.localStorage.setItem(LAST_SEEN_KEY, JSON.stringify({ ms: Math.round(ms), createdAtMs }));
  } catch {
    /* ignore */
  }
}

/** "3 小时" / "2 天 5 小时" */
function fmtAway(ms: number): string {
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  if (hours < 24) return `${hours} 小时`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h === 0 ? `${d} 天` : `${d} 天 ${h} 小时`;
}

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

async function run(fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false; // the owner of `actions` reports failures through the `error` prop
  }
}

export default function GameShell({ snapshot, actions, busy, error, connection = "ok", debugTown = false }: GameShellProps) {
  const world = snapshot?.world ?? null;
  const player = snapshot?.player ?? null;
  const me: AgentView | null = player?.agent ?? null;
  const phone = useIsPhone();

  // ── game flow: loading -> title -> playing ─────────────────────────────
  const audio = useAudio();
  const { sfx, setBgm, unlock } = audio;
  const [flow, setFlow] = useState<"title" | "leaving" | "playing">("title");
  const flowRef = useRef(flow);
  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);
  const [boot, setBoot] = useState({ pct: 0, sceneReady: false });
  const [fontReady, setFontReady] = useState(false);
  const [curtain, setCurtain] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [dayCard, setDayCard] = useState<{ day: number; key: number } | null>(null);
  const [welcome, setWelcome] = useState<{ sinceMs: number; awayMs: number } | null>(null);
  const [welcomeDone, setWelcomeDone] = useState(false);

  // ?title=0 skips the title screen (dev / QA / tests); everyone else always starts on it
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("title") === "0") setFlow("playing");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    let off = false;
    void ensurePixelFont().then(() => {
      if (!off) setFontReady(true);
    });
    return () => {
      off = true;
    };
  }, []);
  // the Preloader's real progress, and "the town is on screen" (then the scene wants to know if we are on the title)
  useEffect(() => {
    const offProgress = onTown("load-progress", (v) => setBoot((b) => ({ ...b, pct: Math.max(b.pct, v) })));
    const offReady = onTown("scene-ready", () => {
      setBoot((b) => ({ ...b, pct: 1, sceneReady: true }));
      emitToTown("cmd-title-mode", flowRef.current !== "playing");
    });
    return () => {
      offProgress();
      offReady();
    };
  }, []);
  useEffect(() => {
    emitToTown("cmd-title-mode", flow !== "playing");
  }, [flow]);
  const loading = !snapshot || !boot.sceneReady || !fontReady;

  // music bed: the title's, then day 06:00-19:59 / night, crossfaded by the AudioManager
  const hour = world?.hour ?? 12;
  const bgmMode: BgmMode = flow !== "playing" ? "title" : hour >= 6 && hour < 20 ? "day" : "night";
  useEffect(() => {
    setBgm(bgmMode);
  }, [bgmMode, setBgm]);

  // ── agents & time ──────────────────────────────────────────────────────
  const agents = useMemo(() => {
    const map = new Map<string, AgentView>();
    for (const a of snapshot?.agents ?? []) map.set(a.id, a);
    if (snapshot?.player) map.set(snapshot.player.agent.id, snapshot.player.agent);
    return Array.from(map.values());
  }, [snapshot]);
  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const receivedAt = useMemo(() => performance.now(), [snapshot]);
  const [nowPerf, setNowPerf] = useState(0);
  useEffect(() => {
    setNowPerf(performance.now());
    const h = window.setInterval(() => setNowPerf(performance.now()), 1000);
    return () => window.clearInterval(h);
  }, []);
  const simNow = world ? world.simNowMs + Math.max(0, nowPerf - receivedAt) : 0;
  const tz = world?.tz ?? "UTC";
  const simNowRef = useRef(0);
  simNowRef.current = simNow;

  // welcome back: decided once, from the last-seen clock stored by the previous session
  const welcomeInit = useRef(false);
  const createdAtMs = player?.createdAtMs ?? null;
  useEffect(() => {
    if (welcomeInit.current || !snapshot || !snapshot.player) return;
    welcomeInit.current = true;
    const seen = readLastSeen();
    if (seen && seen.createdAtMs === snapshot.player.createdAtMs) {
      const away = snapshot.world.simNowMs - seen.ms;
      if (away >= AWAY_THRESHOLD_MS) setWelcome({ sinceMs: seen.ms, awayMs: away });
    }
  }, [snapshot]);
  // ... and kept up to date while the player is here
  useEffect(() => {
    if (createdAtMs === null) return;
    const save = () => {
      if (simNowRef.current > 0 && welcomeInit.current) writeLastSeen(simNowRef.current, createdAtMs);
    };
    const h = window.setInterval(save, 10_000);
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearInterval(h);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [createdAtMs]);

  // ── town interaction ───────────────────────────────────────────────────
  const townRef = useRef<PhaserTownHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLoc, setSelectedLoc] = useState<LocationId | null>(null);
  const [locMeta, setLocMeta] = useState<Partial<Record<LocationId, LocationMeta>>>({});
  const [followId, setFollowId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerTab | null>(null);
  const [feedOpen, setFeedOpen] = useState(true);
  useEffect(() => {
    if (phone) setFeedOpen(false);
  }, [phone]);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setDrawer(null);
      setSelectedLoc(null);
    }
  }, []);
  // a building / landmark was clicked in the town: open its card (names + owners come from the Tiled map itself)
  const handleSelectLocation = useCallback((id: LocationId | null) => {
    setSelectedLoc(id);
    if (id) {
      setSelectedId(null);
      setDrawer(null);
    }
  }, []);
  useEffect(() => {
    let off = false;
    fetch(TOWN_MAP_URL)
      .then((r) => r.json() as Promise<TiledMap>)
      .then((m) => {
        if (!off) setLocMeta(readLocationMeta(m));
      })
      .catch(() => {
        /* the card falls back to the location id */
      });
    return () => {
      off = true;
    };
  }, []);
  // opening a drawer closes the building card (the card never hides behind a drawer and pops back later)
  useEffect(() => {
    if (drawer) setSelectedLoc(null);
  }, [drawer]);
  const getPlayerScreen = useCallback(() => townRef.current?.getPlayerScreen() ?? null, []);
  const handleFollowChange = useCallback((id: string | null) => setFollowId(id), []);

  const locate = useCallback(() => {
    if (!me) return;
    setFollowId((cur) => (cur === me.id ? null : me.id));
  }, [me]);

  const pickFeed = useCallback((item: FeedItem) => {
    // A postcard line opens the postcard itself; everything else focuses the town.
    if (item.kind === "postcard") {
      setUserModal("postcards");
      return;
    }
    const id = item.actors[0];
    if (!id) return;
    setFollowId(null);
    setSelectedId(id);
    setSelectedLoc(null);
    setDrawer(null);
    townRef.current?.focusAgent(id);
  }, []);

  // ── modals ─────────────────────────────────────────────────────────────
  const [userModal, setUserModal] = useState<UserModal>(null);
  const [dismissedJudgment, setDismissedJudgment] = useState<number | null>(null);
  const [dismissedWavering, setDismissedWavering] = useState<number | null>(null);
  const [momentIdx, setMomentIdx] = useState(0);
  const [errDismissed, setErrDismissed] = useState<string | null>(null);
  const forkTotal = useRef(3);

  const moments = player?.pendingMoments ?? [];
  if (player?.onboarding === "forks") forkTotal.current = Math.max(forkTotal.current, moments.length);
  const effUserModal: UserModal = userModal === "moments" && moments.length === 0 ? null : userModal;

  const welcomeOpen = flow === "playing" && !!welcome && !welcomeDone;
  type Active = "none" | "welcome" | "onboarding" | "fork" | "imprint" | "judgment" | "wavering" | "note" | "postcards" | "moments";
  let modal: Active = "none";
  if (snapshot && flow === "playing") {
    if (welcomeOpen) modal = "welcome";
    else if (!player) modal = "onboarding";
    else if (player.onboarding === "forks") modal = moments.length > 0 ? "fork" : "none";
    else if (player.onboarding === "imprint") modal = "imprint";
    else if (effUserModal) modal = effUserModal;
    else if (player.pendingJudgment && dismissedJudgment !== player.pendingJudgment.id) modal = "judgment";
    else if (player.pendingWavering && dismissedWavering !== player.pendingWavering.id) modal = "wavering";
  }

  const closeModal = useCallback(() => {
    if (modal === "welcome") setWelcomeDone(true);
    else if (modal === "note" || modal === "postcards" || modal === "moments") setUserModal(null);
    else if (modal === "judgment" && player?.pendingJudgment) setDismissedJudgment(player.pendingJudgment.id);
    else if (modal === "wavering" && player?.pendingWavering) setDismissedWavering(player.pendingWavering.id);
  }, [modal, player?.pendingJudgment, player?.pendingWavering]);

  const closable = modal === "welcome" || modal === "note" || modal === "postcards" || modal === "moments" || modal === "judgment" || modal === "wavering";

  const openDecisions = useCallback(() => {
    if (!player) return;
    if (player.pendingJudgment) {
      setDismissedJudgment(null);
      setUserModal(null);
    } else if (player.pendingWavering) {
      setDismissedWavering(null);
      setUserModal(null);
    } else if (player.pendingMoments.length > 0) {
      setMomentIdx(0);
      setUserModal("moments");
    } else {
      pushToast("现在没有需要你回应的岔路。它在按自己的节奏过日子。", "info");
    }
  }, [player]);

  // ── toasts (derived from snapshot diffs) ───────────────────────────────
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);
  function pushToast(text: string, tone: ToastItem["tone"]) {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((cur) => [...cur.filter((t) => t.text !== text), { id, text, tone }].slice(-3));
  }
  const dismissToast = useCallback((id: number) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);

  const prevSnap = useRef<GameSnapshot | null>(null);
  useEffect(() => {
    const prev = prevSnap.current;
    prevSnap.current = snapshot;
    if (!snapshot || !prev) return;
    const playing = flowRef.current === "playing";
    const out: { text: string; tone: ToastItem["tone"] }[] = [];
    const seenFeed = new Set(prev.feed.map((f) => f.id));
    for (const f of snapshot.feed) {
      if (seenFeed.has(f.id) || !f.involvesPlayer) continue;
      if (f.kind === "principle" || f.kind === "postcard" || f.kind === "judgment") continue; // covered below
      out.push({ text: f.text, tone: "player" });
    }
    const pl = snapshot.player;
    const pp = prev.player;
    if (pl && pp && playing) {
      // sound effects, derived from what changed since the last snapshot
      const oldMoments = new Set(pp.pendingMoments.map((m) => m.id));
      if (pl.pendingMoments.some((m) => !oldMoments.has(m.id))) sfx("moment");
      const oldCardIds = new Set(pp.postcards.items.map((c) => c.id));
      if (pl.postcards.items.some((c) => !c.read && !oldCardIds.has(c.id))) sfx("postcard");
      const oldPrinciples = new Set(pp.principles.map((p) => p.id));
      if (pl.principles.some((p) => !oldPrinciples.has(p.id))) sfx("imprint");
      if (pl.agent.scrip > pp.agent.scrip) sfx("coin");
    }
    if (pl && pp) {
      if (pl.onboarding === "done") {
        const old = new Set(pp.principles.map((p) => p.id));
        for (const p of pl.principles) if (!old.has(p.id)) out.push({ text: `它记住了：『${p.text}』`, tone: "principle" });
      }
      const oldCards = new Set(pp.postcards.items.map((c) => c.id));
      for (const c of pl.postcards.items) if (!oldCards.has(c.id)) out.push({ text: `收到一张明信片：${c.title}`, tone: "postcard" });
      if (pp.pendingJudgment && !pl.pendingJudgment && pl.recentJudgment && pl.recentJudgment.id === pp.pendingJudgment.id) {
        const j = pl.recentJudgment;
        const t =
          j.status === "forced"
            ? `你强制执行了。它照做了，但 Scrip −${j.forceCost}，信任 −10。`
            : j.status === "adopted"
              ? "你采纳了它的调整。"
              : j.status === "overruled"
                ? "你坚持了原来的选择。"
                : "你尊重了它的判断。";
        out.push({ text: t, tone: "judgment" });
      }
    }
    if (playing) for (const t of out.slice(0, 3)) pushToast(t.text, t.tone);
  }, [snapshot, sfx]);

  // ── judgment feedback (inline) ─────────────────────────────────────────
  const [rated, setRated] = useState<Set<number>>(new Set());
  useEffect(() => setRated(new Set(readRated())), []);
  const markRated = useCallback((id: number) => {
    setRated((cur) => {
      const next = new Set(cur).add(id);
      try {
        window.localStorage.setItem(RATED_KEY, JSON.stringify(Array.from(next).slice(-50)));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const recentJ = player?.recentJudgment ?? null;
  const showFeedback = !!(recentJ && recentJ.status !== "pending" && !rated.has(recentJ.id) && modal === "none" && !player?.pendingJudgment);

  // ── coach marks ────────────────────────────────────────────────────────
  const [seen, setSeen] = useState<Set<string> | null>(null);
  useEffect(() => setSeen(readSeen()), []);
  const nextPostcardLabel = player ? fmtClock(player.nextPostcardAtMs, tz) : "23:00";
  const coachSteps: CoachStep[] = useMemo(
    () => [
      { key: "agent", target: "agent", text: "金色光圈就是你守护的 Agent" },
      { key: "activity", target: "activity", text: "它会自己安排一天" },
      { key: "note", target: "note", text: "想对它说一句话？在这里留言——每天 3 条，50 字以内" },
      { key: "postcard", target: "postcard", text: `今晚 ${nextPostcardLabel} 它会寄来第一张明信片` }
    ],
    [nextPostcardLabel]
  );
  // coach marks wait (queue) while anything else is on screen: modals, drawers, the inspector, the feedback panel
  const overlayOpen = modal !== "none" || helpOpen || soundOpen || drawer !== null || selectedId !== null || selectedLoc !== null || showFeedback;
  const coachReady = flow === "playing" && !!player && player.onboarding === "done" && !overlayOpen && seen !== null;
  const coachPending = seen ? coachSteps.filter((s) => !seen.has(s.key)) : [];
  const coachStep = coachReady && coachPending.length > 0 ? coachPending[0] : null;
  const coachIndex = coachStep ? coachSteps.findIndex((s) => s.key === coachStep.key) : 0;
  const coachNext = useCallback(() => {
    if (!coachStep) return;
    writeSeen([coachStep.key]);
    setSeen((cur) => new Set(cur ?? []).add(coachStep.key));
  }, [coachStep]);
  const coachSkip = useCallback(() => {
    const all = coachSteps.map((s) => s.key);
    writeSeen(all);
    setSeen(new Set(all));
  }, [coachSteps]);
  const coachKey = coachStep?.key ?? null;
  const meId = me?.id ?? null;
  // while the "this is your Agent" mark is open the camera keeps the (possibly walking) Agent in view
  const coachFollowing = useRef(false);
  useEffect(() => {
    if (coachKey === "agent" && meId) {
      coachFollowing.current = true;
      setFollowId(meId);
    } else if (coachFollowing.current) {
      coachFollowing.current = false;
      setFollowId((cur) => (cur === meId ? null : cur));
    }
  }, [coachKey, meId]);

  // ── more sound effects: a judgment modal opens (voice), an error banner appears (error) ──
  const prevModal = useRef<string>("none");
  useEffect(() => {
    if (modal === "judgment" && prevModal.current !== "judgment") sfx("voice");
    prevModal.current = modal;
  }, [modal, sfx]);

  // ── keyboard: the map is in game/keymap.ts (and the ? overlay) ─────────
  // One listener for the whole session. It reads the volatile UI state through `keyCtx`, so a re-render (every
  // snapshot) never tears it down: a held pan key must not stop because the world ticked.
  const curMoment = modal === "fork" ? (moments[0] ?? null) : modal === "moments" ? (moments[Math.min(momentIdx, moments.length - 1)] ?? null) : null;
  const keyCtx = useRef({} as {
    flow: typeof flow;
    hasSnapshot: boolean;
    soundOpen: boolean;
    helpOpen: boolean;
    coachSkip: (() => void) | null;
    dayCard: boolean;
    modal: string;
    closable: boolean;
    closeModal: () => void;
    drawerOpen: boolean;
    selectedId: string | null;
    selectedLoc: string | null;
    curMoment: MomentView | null;
    choosing: boolean;
    meId: string | null;
    actions: GameActions;
  });
  keyCtx.current = {
    flow,
    hasSnapshot: !!snapshot,
    soundOpen,
    helpOpen,
    coachSkip: coachStep ? coachSkip : null,
    dayCard: !!dayCard,
    modal,
    closable,
    closeModal,
    drawerOpen: drawer !== null,
    selectedId,
    selectedLoc,
    curMoment,
    choosing: busy === "choose",
    meId: me?.id ?? null,
    actions
  };
  useEffect(() => {
    const held = new Set<string>();
    let lastVx = 0;
    let lastVy = 0;
    let spaceDown = false;
    const pushPan = () => {
      let vx = 0;
      let vy = 0;
      for (const code of held) {
        const v = PAN_CODES[code];
        if (v) {
          vx += v[0];
          vy += v[1];
        }
      }
      vx = Math.max(-1, Math.min(1, vx));
      vy = Math.max(-1, Math.min(1, vy));
      if (vx !== lastVx || vy !== lastVy) {
        lastVx = vx;
        lastVy = vy;
        emitToTown("cmd-pan", vx, vy);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts (Cmd+R ...) stay the browser's
      const k = keyCtx.current;
      if (e.key === "Escape") {
        if (k.soundOpen) setSoundOpen(false);
        else if (k.helpOpen) setHelpOpen(false);
        else if (k.coachSkip) k.coachSkip();
        else if (k.dayCard) setDayCard(null);
        else if (k.modal !== "none") {
          if (k.closable) k.closeModal();
        } else if (k.drawerOpen) setDrawer(null);
        else if (k.selectedId) setSelectedId(null);
        else if (k.selectedLoc) setSelectedLoc(null);
        return;
      }
      if (isTypingTarget(e.target) || k.flow !== "playing" || !k.hasSnapshot) return;
      // ? or H: the key help (above everything, even a fork card)
      if (e.key === "?" || e.key === "h" || e.key === "H") {
        e.preventDefault();
        if (!e.repeat) setHelpOpen((v) => !v);
        return;
      }
      if (k.helpOpen) return;
      // 1 / 2 / 3: answer the open fork card
      if ((k.modal === "fork" || k.modal === "moments") && /^[1-3]$/.test(e.key)) {
        const opt = k.curMoment?.options[Number(e.key) - 1];
        const moment = k.curMoment;
        if (moment && opt && !k.choosing && !e.repeat) {
          e.preventDefault();
          sfx("confirm");
          void run(() => k.actions.choose(moment.id, opt.id));
        }
        return;
      }
      if (k.modal !== "none") return;
      if (PAN_CODES[e.code]) {
        e.preventDefault();
        held.add(e.code);
        pushPan();
        return;
      }
      if (e.repeat) return;
      if (e.code === "Space") {
        // Space = find my Agent and follow it (it must not also "click" a focused button)
        e.preventDefault();
        spaceDown = true;
        if (k.meId) {
          setFollowId(k.meId);
          townRef.current?.setFollow(k.meId);
        }
        return;
      }
      if (e.code === "KeyQ" || e.key === "-" || e.key === "_") emitToTown("cmd-zoom-step", -1);
      else if (e.code === "KeyE" || e.key === "=" || e.key === "+") emitToTown("cmd-zoom-step", 1);
      else if (e.key === "n" || e.key === "N") setUserModal("note");
      else if (e.key === "p" || e.key === "P") setUserModal("postcards");
      else if (e.key === "r" || e.key === "R") {
        setSelectedId(null);
        setDrawer((cur) => (cur === "principles" ? null : "principles"));
      } else if (e.key === "f" || e.key === "F") setFeedOpen((v) => !v);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (held.delete(e.code)) pushPan();
      if (e.code === "Space" && spaceDown) {
        spaceDown = false;
        e.preventDefault();
      }
    };
    const onBlur = () => {
      held.clear();
      pushPan();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      held.clear();
      pushPan();
    };
  }, [sfx]);

  // ── derived view data ──────────────────────────────────────────────────
  const selectedAgent = selectedId ? (agentById.get(selectedId) ?? null) : null;
  const selectedRel = selectedAgent && player ? (player.relationships.find((r) => r.otherId === selectedAgent.id) ?? null) : null;
  const selectedLines = useMemo(() => {
    if (!selectedId || !snapshot) return [];
    return snapshot.feed
      .filter((f) => f.actors.includes(selectedId))
      .sort((a, b) => b.atMs - a.atMs || b.id - a.id)
      .slice(0, 3);
  }, [selectedId, snapshot]);

  // building card: owner NPC, who is standing there now, and the latest feed lines that mention the place
  const locCard = useMemo(() => {
    if (!selectedLoc || !snapshot) return null;
    const meta = locMeta[selectedLoc];
    const label = meta?.label ?? selectedLoc;
    const owner = meta?.owner ? (agentById.get(meta.owner) ?? null) : null;
    const here = agents.filter((a) => a.location === selectedLoc && !a.travel);
    const lines = snapshot.feed
      .filter((f) => f.text.includes(label))
      .sort((a, b) => b.atMs - a.atMs || b.id - a.id)
      .slice(0, 3);
    return { id: selectedLoc, label, owner, here, lines };
  }, [selectedLoc, snapshot, locMeta, agentById, agents]);

  const pendingCount = player ? player.pendingMoments.length + (player.pendingJudgment ? 1 : 0) + (player.pendingWavering ? 1 : 0) : 0;
  const minutesToTick = world ? Math.max(0, Math.ceil((world.nextTickAtMs - simNow) / 60000)) : null;
  const clock = world ? fmtClock(simNow, tz) : "--:--";
  const day = world ? (player ? dayNumber(simNow, player.createdAtMs, tz, player.dayIndex) : 1) : 1;
  const challenger = agents.find((a) => a.sprite === "mediator")?.name ?? "Kade";

  const errorForModal = error;
  const showErrorBanner = !!error && modal === "none" && errDismissed !== error;
  const bannerCount = (connection === "retrying" ? 1 : 0) + (showErrorBanner ? 1 : 0);
  const topPx = (phone ? 8 : 12) + bannerCount * 52;

  const busyIs = (k: BusyKey) => busy === k;

  // a new error (banner, or the line inside a dialog) -> the error sound
  useEffect(() => {
    if (error && flowRef.current === "playing") sfx("error");
  }, [error, sfx]);

  // "第 N 天": when the Agent's day count goes up while the player is here
  const dayIdx = player?.dayIndex ?? null;
  const prevDayIdx = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevDayIdx.current;
    prevDayIdx.current = dayIdx;
    if (dayIdx === null || prev === null || dayIdx <= prev) return;
    if (flowRef.current === "playing") setDayCard({ day: dayIdx + 1, key: Date.now() });
  }, [dayIdx]);

  // the town's social web around the resident being inspected
  const selectedSocial = useMemo(() => (selectedId ? townSocialFor(selectedId, snapshot?.townRelations, agentById) : undefined), [selectedId, snapshot?.townRelations, agentById]);

  // welcome-back card: the town's events since the player last looked, and up to three lines about my Agent
  const welcomeData = useMemo(() => {
    if (!welcome || !snapshot) return null;
    const since = snapshot.feed.filter((f) => f.atMs > welcome.sinceMs);
    const mine = me
      ? since
          .filter((f) => f.involvesPlayer || f.actors.includes(me.id))
          .sort((a, b) => b.atMs - a.atMs || b.id - a.id)
          .slice(0, 3)
      : [];
    return { count: since.length, capped: snapshot.feed.length >= 40 && since.length >= snapshot.feed.length, lines: mine };
  }, [welcome, snapshot, me]);

  // title -> game: the title fades to black, then the black clears over the town
  const startGame = useCallback(() => {
    if (flowRef.current !== "title") return;
    unlock();
    sfx("confirm");
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setFlow("leaving");
    window.setTimeout(() => {
      setFlow("playing");
      if (!reduce) setCurtain(true);
    }, reduce ? 0 : 520);
  }, [unlock, sfx]);

  // ── delegated sounds: one listener for every button (data-sfx="confirm" | "none" overrides the plain click) ──
  const unlockedRef = useRef(false);
  useEffect(() => {
    unlockedRef.current = audio.status ? !audio.status.locked : false;
  }, [audio.status]);
  const onRootPointerDown = () => {
    if (!unlockedRef.current) unlock(); // the first gesture of the session: let the browser play sound
  };
  const onRootClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("button, [role=button], [role=tab], [role=switch]");
    if (!el || (el as HTMLButtonElement).disabled || flowRef.current === "leaving") return;
    const kind = el.dataset.sfx ?? el.closest<HTMLElement>("[data-sfx]")?.dataset.sfx;
    if (kind === "none") return;
    sfx(kind === "confirm" ? "confirm" : "click");
  };

  // ── render ─────────────────────────────────────────────────────────────
  const clockPill = world ? <ClockPill day={day} clock={clock} night={world.isNight} minutesToTick={minutesToTick} /> : null;
  const pills = world ? <StatusPills world={world} /> : null;
  const rail = player ? (
    <Rail
      active={drawer}
      unread={player.postcards.unread}
      postcardOpen={modal === "postcards"}
      onDrawer={(t) => {
        setSelectedId(null);
        setDrawer((cur) => (cur === t ? null : t));
      }}
      onPostcards={() => setUserModal("postcards")}
    />
  ) : null;

  return (
    <div className={styles.root} lang="zh-CN" onPointerDownCapture={onRootPointerDown} onClickCapture={onRootClick}>
      <PhaserTown
        ref={townRef}
        snapshot={snapshot}
        selectedId={selectedId}
        followId={followId}
        onSelect={handleSelect}
        onSelectLocation={handleSelectLocation}
        onFollowChange={handleFollowChange}
        debug={debugTown}
      />

      {snapshot && world && flow === "playing" ? (
        <div className={styles.hud} style={{ ["--top" as string]: `${topPx}px` }}>
          {bannerCount > 0 ? (
            <div className={hud.banners}>
              {connection === "retrying" ? <Banner kind="conn" text="与小镇的连接中断，正在重连…" /> : null}
              {showErrorBanner && error ? <Banner kind="error" text={`没成功：${error}（稍后再试一次）`} onClose={() => setErrDismissed(error)} /> : null}
            </div>
          ) : null}

          <div className={hud.leftCol}>
            {me && player ? <AgentCard agent={me} trust={player.trust} onOpenPrinciples={() => setDrawer("principles")} /> : null}
            {phone && me ? <ActionBar agent={me} simNow={simNow} /> : null}
            {phone ? <OffsetNote world={world} /> : null}
            <FeedPanel feed={snapshot.feed} open={feedOpen} onToggle={() => setFeedOpen((v) => !v)} onPick={pickFeed} />
          </div>

          {phone ? (
            <div className={hud.rightCol}>
              {clockPill}
              <div className={hud.sysRow}>
                <SoundButton open={soundOpen} on={audio.settings.music || audio.settings.sfx} onToggle={() => setSoundOpen((v) => !v)} />
              </div>
              {pills}
              {rail}
            </div>
          ) : (
            <>
              <div className={hud.topCenter}>
                {clockPill}
                {me ? <ActionBar agent={me} simNow={simNow} /> : null}
                <OffsetNote world={world} />
              </div>
              <div className={hud.topRight}>
                {pills}
                <div className={hud.sysRow}>
                  <HelpButton onClick={() => setHelpOpen(true)} />
                  <SoundButton open={soundOpen} on={audio.settings.music || audio.settings.sfx} onToggle={() => setSoundOpen((v) => !v)} />
                </div>
              </div>
              {rail}
            </>
          )}

          {soundOpen ? <SoundMenu settings={audio.settings} status={audio.status} onUpdate={audio.update} onClose={() => setSoundOpen(false)} /> : null}

          {drawer && player ? (
            <Drawer tab={drawer} onTab={setDrawer} onClose={() => setDrawer(null)} player={player} agents={agents} simNowTz={tz} />
          ) : null}

          {selectedAgent && !drawer ? (
            <Inspector
              agent={selectedAgent}
              isMine={!!me && selectedAgent.id === me.id}
              rel={selectedRel}
              lines={selectedLines}
              following={followId === selectedAgent.id}
              onFollow={() => setFollowId((cur) => (cur === selectedAgent.id ? null : selectedAgent.id))}
              onClose={() => setSelectedId(null)}
              onOpenPrinciples={() => {
                setSelectedId(null);
                setDrawer("principles");
              }}
              social={selectedSocial}
            />
          ) : null}

          {locCard && !drawer && !selectedAgent ? (
            <LocationCard
              id={locCard.id}
              label={locCard.label}
              owner={locCard.owner}
              here={locCard.here}
              lines={locCard.lines}
              onPick={(id) => {
                setSelectedLoc(null);
                setFollowId(null);
                setSelectedId(id);
                townRef.current?.focusAgent(id);
              }}
              onClose={() => setSelectedLoc(null)}
            />
          ) : null}

          {player ? (
            <>
              <Dock
                pending={pendingCount}
                noteLeft={player.notes.leftToday}
                unread={player.postcards.unread}
                onDecisions={openDecisions}
                onNote={() => setUserModal("note")}
                onPostcards={() => setUserModal("postcards")}
                onPrinciples={() => setDrawer((cur) => (cur === "principles" ? null : "principles"))}
              />
              <LocateButton following={!!me && followId === me.id} onClick={locate} />
            </>
          ) : null}

          {showFeedback && recentJ ? (
            <FeedbackPrompt
              judgment={recentJ}
              busy={false}
              onPick={(v) => {
                markRated(recentJ.id);
                void run(() => actions.feedback(recentJ.id, v));
              }}
              onDismiss={() => markRated(recentJ.id)}
            />
          ) : null}

          {world.testMode ? <TestPanel busy={busyIs("advance")} onAdvance={actions.advance} /> : null}
          <Toasts items={toasts} onDismiss={dismissToast} />
        </div>
      ) : null}

      {/* ── modals ── */}
      {modal === "welcome" && welcome && welcomeData && player ? (
        <WelcomeBackCard
          awayLabel={fmtAway(welcome.awayMs)}
          eventCount={welcomeData.count}
          eventsCapped={welcomeData.capped}
          lines={welcomeData.lines}
          unread={player.postcards.unread}
          pending={pendingCount}
          onPostcards={() => {
            setWelcomeDone(true);
            setUserModal("postcards");
          }}
          onRespond={() => {
            setWelcomeDone(true);
            openDecisions();
          }}
          onClose={() => setWelcomeDone(true)}
        />
      ) : null}

      {modal === "onboarding" ? <OnboardingModal busy={busyIs("create")} error={errorForModal} onCreate={(input) => void run(() => actions.createAgent(input))} /> : null}

      {modal === "fork" && me && moments[0] ? (
        <ForkModal
          key={moments[0].id}
          moment={moments[0]}
          speaker={moments[0].speakerId ? (agentById.get(moments[0].speakerId) ?? null) : null}
          me={me}
          step={{ index: Math.min(forkTotal.current, forkTotal.current - moments.length + 1), total: forkTotal.current }}
          simNow={simNow}
          busy={busyIs("choose")}
          error={errorForModal}
          onChoose={(optionId) => void run(() => actions.choose(moments[0].id, optionId))}
        />
      ) : null}

      {modal === "moments" && me && moments.length > 0
        ? (() => {
            const idx = Math.min(momentIdx, moments.length - 1);
            const mo = moments[idx];
            return (
              <ForkModal
                key={mo.id}
                moment={mo}
                speaker={mo.speakerId ? (agentById.get(mo.speakerId) ?? null) : null}
                me={me}
                step={null}
                simNow={simNow}
                busy={busyIs("choose")}
                error={errorForModal}
                queue={{ index: idx, total: moments.length, onPick: setMomentIdx }}
                onChoose={(optionId) => void run(() => actions.choose(mo.id, optionId))}
                onLater={closeModal}
              />
            );
          })()
        : null}

      {modal === "imprint" && player ? (
        <ImprintModal principles={player.principles} distilling={player.distilling} busy={busy !== null && busy !== "advance"} error={errorForModal} onAck={() => void run(() => actions.ackOnboarding())} />
      ) : null}

      {modal === "judgment" && me && player?.pendingJudgment ? (
        <JudgmentModal
          key={player.pendingJudgment.id}
          j={player.pendingJudgment}
          me={me}
          busy={busyIs("judgment")}
          error={errorForModal}
          onResolve={(a) => void run(() => actions.resolveJudgment(player.pendingJudgment!.id, a))}
          onClose={closeModal}
        />
      ) : null}

      {modal === "wavering" && me && player?.pendingWavering ? (
        <WaveringModal
          key={player.pendingWavering.id}
          w={player.pendingWavering}
          me={me}
          challenger={challenger}
          busy={busyIs("wavering")}
          error={errorForModal}
          onResolve={(r, text) => void run(() => actions.resolveWavering(player.pendingWavering!.id, r, text))}
          onClose={closeModal}
        />
      ) : null}

      {modal === "note" && player ? (
        <NoteModal left={player.notes.leftToday} items={player.notes.items} tz={tz} busy={busyIs("note")} error={errorForModal} onSend={(text) => run(() => actions.sendNote(text))} onClose={closeModal} />
      ) : null}

      {modal === "postcards" && player ? (
        <PostcardModal
          items={player.postcards.items}
          busy={busyIs("postcard")}
          error={errorForModal}
          initialId={null}
          onRead={(id) => void run(() => actions.readPostcard(id))}
          onClose={closeModal}
        />
      ) : null}

      {coachStep ? <CoachMarks step={coachStep} index={coachIndex} total={coachSteps.length} getPlayerScreen={getPlayerScreen} onNext={coachNext} onSkip={coachSkip} /> : null}

      {helpOpen && flow === "playing" ? <KeyHelp onClose={() => setHelpOpen(false)} /> : null}

      {dayCard && flow === "playing" ? <DayCard key={dayCard.key} day={dayCard.day} night={!!world?.isNight} onDone={() => setDayCard(null)} /> : null}

      {!loading && (flow === "title" || flow === "leaving") ? (
        <TitleScreen
          me={me}
          day={day}
          leaving={flow === "leaving"}
          soundOn={audio.settings.music || audio.settings.sfx}
          onToggleSound={audio.toggleAll}
          onStart={startGame}
        />
      ) : null}

      {curtain ? <FadeIn onDone={() => setCurtain(false)} /> : null}

      {loading ? <LoadingScreen progress={boot.pct} waitingForTown={boot.sceneReady && fontReady} /> : null}
    </div>
  );
}
