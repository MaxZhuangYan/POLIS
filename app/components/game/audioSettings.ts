// Audio settings persistence (localStorage, every access guarded: storage can be blocked or throw).
// No Phaser import: used by the React HUD.

import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "./keys";

const STORAGE_KEY = "polis.audio.v1";

const clamp01 = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    const v = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      music: typeof v.music === "boolean" ? v.music : DEFAULT_AUDIO_SETTINGS.music,
      musicVol: clamp01(v.musicVol, DEFAULT_AUDIO_SETTINGS.musicVol),
      sfx: typeof v.sfx === "boolean" ? v.sfx : DEFAULT_AUDIO_SETTINGS.sfx,
      sfxVol: clamp01(v.sfxVol, DEFAULT_AUDIO_SETTINGS.sfxVol)
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(s: AudioSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
