// UI preferences that should survive a refresh, a restart and a week away: kept in this browser's localStorage, one small
// JSON object. Every read and write is wrapped (private windows, blocked storage and quota errors must never break the game),
// and the UI renders correctly without any of it. Sound and reduce-motion have their own keys (game/audioSettings.ts and
// Progress.tsx's REDUCE_MOTION_KEY); the unsent note draft is per browser too.

const KEY = "polis.ui.v1";
const DRAFT_KEY = "polis.noteDraft.v1";

export interface UiPrefs {
  /** the town feed: open / folded. Absent = the default for this screen (open on desktop, folded on a phone) */
  feedOpen?: boolean;
  /** the town feed shows every line (true) or only the headlines (false, default) */
  feedAll?: boolean;
}

export function readPrefs(): UiPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const out: UiPrefs = {};
    if (typeof v.feedOpen === "boolean") out.feedOpen = v.feedOpen;
    if (typeof v.feedAll === "boolean") out.feedAll = v.feedAll;
    return out;
  } catch {
    return {};
  }
}

export function writePrefs(patch: UiPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* storage blocked or full: the preference simply lasts until the page closes */
  }
}

/** the unsent note, so closing the dialog (or reloading) never loses what the player was writing */
export function readDraft(): string {
  try {
    return (window.localStorage.getItem(DRAFT_KEY) ?? "").slice(0, 50);
  } catch {
    return "";
  }
}

export function writeDraft(text: string): void {
  try {
    if (text) window.localStorage.setItem(DRAFT_KEY, text);
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
