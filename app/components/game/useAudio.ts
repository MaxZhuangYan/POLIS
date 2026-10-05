"use client";

// React side of the audio system: owns the (persisted) settings, forwards them and the wanted music bed to the
// AudioManager over the EventBus, and re-sends everything whenever the AudioManager announces `audio-ready`
// (it is created after the preloader, long after the first render). All traffic goes through ./bus.ts, so this
// module never imports Phaser.

import { useCallback, useEffect, useRef, useState } from "react";
import { emitToTown, onTown } from "./bus";
import { loadAudioSettings, saveAudioSettings } from "./audioSettings";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings, type AudioStatus, type BgmMode, type SfxName } from "./keys";

export interface AudioApi {
  settings: AudioSettings;
  update: (patch: Partial<AudioSettings>) => void;
  /** everything on / everything off (the title screen's sound toggle) */
  toggleAll: () => void;
  sfx: (name: SfxName) => void;
  /** the music bed the game wants right now */
  setBgm: (mode: BgmMode | null) => void;
  /** call from a user gesture: resumes the browser's audio context */
  unlock: () => void;
  status: AudioStatus | null;
}

export function useAudio(): AudioApi {
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const settingsRef = useRef(settings);
  const bgmRef = useRef<BgmMode | null>(null);

  // hydrate from localStorage after mount (the server render always uses the defaults)
  useEffect(() => {
    const stored = loadAudioSettings();
    settingsRef.current = stored;
    setSettings(stored);
    setHydrated(true); // applied in the same render as `stored`, so the save below never writes the defaults over it
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
    if (!hydrated) return;
    saveAudioSettings(settings);
    emitToTown("cmd-audio-settings", settings);
  }, [settings, hydrated]);

  useEffect(() => {
    const offReady = onTown("audio-ready", () => {
      emitToTown("cmd-audio-settings", settingsRef.current);
      emitToTown("cmd-bgm", bgmRef.current);
    });
    const offStatus = onTown("audio-status", (s) => setStatus(s));
    return () => {
      offReady();
      offStatus();
    };
  }, []);

  const update = useCallback((patch: Partial<AudioSettings>) => setSettings((cur) => ({ ...cur, ...patch })), []);
  const toggleAll = useCallback(
    () =>
      setSettings((cur) => {
        const anyOn = cur.music || cur.sfx;
        return { ...cur, music: !anyOn, sfx: !anyOn };
      }),
    []
  );
  const sfx = useCallback((name: SfxName) => emitToTown("cmd-sfx", name), []);
  const setBgm = useCallback((mode: BgmMode | null) => {
    if (bgmRef.current === mode) return;
    bgmRef.current = mode;
    emitToTown("cmd-bgm", mode);
  }, []);
  const unlock = useCallback(() => emitToTown("cmd-audio-unlock"), []);

  return { settings, update, toggleAll, sfx, setBgm, unlock, status };
}
