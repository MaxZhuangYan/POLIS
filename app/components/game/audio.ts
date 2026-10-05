// The game's audio: an AudioManager driven entirely through the EventBus, owned by a persistent AudioScene.
//
//   React -> Phaser   cmd-audio-settings (music / sfx on-off + volume), cmd-bgm (title | day | night | null),
//                     cmd-sfx (click | confirm | moment | postcard | imprint | coin | voice | error), cmd-audio-unlock
//   Phaser -> React   audio-ready (I am listening: send me the current settings + bed), audio-status
//
// Design rules
//  * Audio never blocks the game. Its files live in their own asset-pack sections (audio-core: sfx + title music,
//    audio-bgm: the two 70 s day / night loops) which THIS scene loads in the background after the town is on
//    screen. A file that fails to load or decode is reported in `audio-status` and the game simply stays silent.
//  * Browsers keep the AudioContext suspended until a user gesture. Nothing is queued meanwhile: SFX are dropped,
//    and the wanted music bed starts the moment the context is unlocked (the title button, any first click / key).
//  * Beds loop and crossfade for 1.5 s whenever the wanted bed changes. Hiding the tab pauses everything.
//  * Music beds are STREAMED through HTMLAudioElement (ogg where supported, mp3 otherwise) instead of being
//    decoded into WebAudio buffers: three 70 s loops decode to ~72 MB of PCM, too much for phones. Only the short
//    SFX are decoded (they need low latency and overlap).
//
// This module imports Phaser: load it with dynamic import() from the browser only (PhaserTown does).

import * as Phaser from "phaser";
import { EventBus } from "./EventBus";
import { AUDIO_KEYS, AUDIO_PACK_SECTIONS, BGM_KEY, DEFAULT_AUDIO_SETTINGS, KEYS, SCENES, sfxKey, type AudioSettings, type AudioStatus, type BgmMode, type SfxName } from "./keys";

export const CROSSFADE_MS = 1500;
const SFX_MIN_GAP_MS = 45;
const MAX_SFX_VOICES = 8;

interface Bed {
  mode: BgmMode;
  el: HTMLAudioElement;
  /** proxy the tween animates; its value is copied to el.volume */
  level: { v: number };
  /** the tween currently ramping this bed's volume */
  tween: Phaser.Tweens.Tween | null;
}

const BGM_DIR = "/assets/audio/";

function bgmUrl(key: string): string {
  let ogg = false;
  try {
    ogg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== "";
  } catch {
    ogg = false;
  }
  return `${BGM_DIR}${key}.${ogg ? "ogg" : "mp3"}`;
}

export class AudioManager {
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private wanted: BgmMode | null = null;
  private bed: Bed | null = null;
  private failed = new Set<string>();
  private lastSfx = new Map<string, number>();
  private hidden = false;
  private started = false;

  constructor(private readonly scene: Phaser.Scene) {}

  private get sound(): Phaser.Sound.BaseSoundManager {
    return this.scene.sound;
  }

  private get contextState(): AudioContextState | "none" {
    const ctx = (this.sound as Phaser.Sound.WebAudioSoundManager).context;
    return ctx ? ctx.state : "none";
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    // we handle "tab hidden" ourselves (Phaser's pauseOnBlur would also suspend the context whenever the window merely
    // loses focus, e.g. while the user clicks into the dev tools)
    this.sound.pauseOnBlur = false;

    EventBus.on("cmd-audio-settings", this.setSettings, this);
    EventBus.on("cmd-bgm", this.setBgm, this);
    EventBus.on("cmd-sfx", this.playSfx, this);
    EventBus.on("cmd-audio-unlock", this.unlock, this);
    this.sound.on(Phaser.Sound.Events.UNLOCKED, this.onUnlocked, this);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);

    this.loadSections();
    EventBus.emit("audio-ready");
  }

  destroy(): void {
    if (!this.started) return;
    this.started = false;
    EventBus.off("cmd-audio-settings", this.setSettings, this);
    EventBus.off("cmd-bgm", this.setBgm, this);
    EventBus.off("cmd-sfx", this.playSfx, this);
    EventBus.off("cmd-audio-unlock", this.unlock, this);
    document.removeEventListener("visibilitychange", this.onVisibility);
    try {
      this.sound.off(Phaser.Sound.Events.UNLOCKED, this.onUnlocked, this);
    } catch {
      /* the sound manager may already be gone */
    }
  }

  // ───────────── loading (background, never blocking) ─────────────

  private loadSections(): void {
    const manifest = this.scene.cache.json.get(KEYS.manifest) as unknown;
    if (!manifest) return;
    const load = this.scene.load;
    load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.failed.add(file.key);
      this.report();
    });
    const next = (i: number) => {
      if (i >= AUDIO_PACK_SECTIONS.length) return;
      const section = AUDIO_PACK_SECTIONS[i];
      load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.report();
        this.applyMusic(); // the bed we were waiting for may have just decoded
        next(i + 1);
      });
      load.pack({ key: `${KEYS.pack}-${section}`, url: manifest as object, dataKey: section });
      load.start();
    };
    next(0);
  }

  private has(key: string): boolean {
    if (key.startsWith("bgm-")) return !this.failed.has(key); // streamed, nothing to decode
    return this.scene.cache.audio.exists(key);
  }

  report(): void {
    const status: AudioStatus = {
      loaded: AUDIO_KEYS.filter((k) => this.has(k)),
      failed: Array.from(this.failed),
      locked: this.sound.locked || this.contextState !== "running",
      bgm: this.bed?.mode ?? null
    };
    EventBus.emit("audio-status", status);
  }

  // ───────────── settings / unlock ─────────────

  private setSettings(s: AudioSettings): void {
    this.settings = { ...DEFAULT_AUDIO_SETTINGS, ...s };
    this.applyMusic();
  }

  private unlock(): void {
    const ctx = (this.sound as Phaser.Sound.WebAudioSoundManager).context;
    if (!ctx || ctx.state === "running") {
      (this.sound as unknown as { locked: boolean }).locked = false;
      this.onUnlocked();
      return;
    }
    ctx.resume().then(
      () => {
        (this.sound as unknown as { locked: boolean }).locked = false;
        this.onUnlocked();
      },
      () => undefined
    );
  }

  private onUnlocked(): void {
    this.applyMusic();
    this.report();
  }

  private onVisibility = (): void => {
    this.hidden = document.visibilityState === "hidden";
    if (this.hidden) {
      this.sound.pauseAll();
      this.bed?.el.pause();
    } else {
      this.sound.resumeAll();
      if (this.bed) void this.bed.el.play().catch(() => undefined);
      if (this.contextState === "suspended" || this.contextState === "interrupted") {
        void (this.sound as Phaser.Sound.WebAudioSoundManager).context?.resume();
      }
    }
  };

  // ───────────── music beds ─────────────

  private setBgm(mode: BgmMode | null): void {
    if (this.wanted === mode) return;
    this.wanted = mode;
    this.applyMusic();
  }

  private musicVolume(): number {
    return this.settings.music ? Phaser.Math.Clamp(this.settings.musicVol, 0, 1) : 0;
  }

  /** bring the playing bed in line with (wanted bed, music on/off, volume): start, crossfade, fade out or re-level */
  private applyMusic(): void {
    if (!this.started) return;
    const locked = this.sound.locked || this.contextState !== "running";
    const vol = this.musicVolume();
    const want = this.settings.music && vol > 0 ? this.wanted : null;

    if (!want || locked) {
      // music off, nothing wanted: fade the running bed out. (locked: nothing is playing yet, nothing to do)
      if (this.bed && !locked) this.fadeOutBed();
      return;
    }
    if (this.bed && this.bed.mode === want) {
      this.rampBed(this.bed, vol, 120); // volume slider
      return;
    }
    const key = BGM_KEY[want];
    if (!this.has(key)) return; // still decoding: applyMusic runs again when its section completes
    if (this.bed) this.fadeOutBed();
    try {
      const el = new Audio(bgmUrl(key));
      el.loop = true;
      el.preload = "auto";
      el.volume = 0;
      el.addEventListener("error", () => {
        this.failed.add(key);
        this.report();
      });
      const bed: Bed = { mode: want, el, level: { v: 0 }, tween: null };
      this.bed = bed;
      if (!this.hidden) void el.play().catch(() => undefined);
      this.rampBed(bed, vol, CROSSFADE_MS);
    } catch {
      this.failed.add(key);
    }
    this.report();
  }

  private rampBed(bed: Bed, to: number, ms: number): void {
    bed.tween?.stop();
    bed.tween = this.scene.tweens.add({
      targets: bed.level,
      v: to,
      duration: ms,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        bed.el.volume = Phaser.Math.Clamp(bed.level.v, 0, 1);
      }
    });
  }

  private fadeOutBed(): void {
    const old = this.bed;
    if (!old) return;
    this.bed = null;
    old.tween?.stop();
    this.scene.tweens.add({
      targets: old.level,
      v: 0,
      duration: CROSSFADE_MS,
      ease: "Sine.easeInOut",
      onUpdate: () => {
        old.el.volume = Phaser.Math.Clamp(old.level.v, 0, 1);
      },
      onComplete: () => {
        old.el.pause();
        old.el.removeAttribute("src");
        old.el.load();
      }
    });
  }

  // ───────────── sound effects ─────────────

  private playSfx(name: SfxName): void {
    if (!this.started || !this.settings.sfx || this.hidden) return;
    const vol = Phaser.Math.Clamp(this.settings.sfxVol, 0, 1);
    if (vol <= 0 || this.sound.locked || this.contextState !== "running") return;
    const key = sfxKey(name);
    if (!this.has(key)) return;
    const now = performance.now();
    if (now - (this.lastSfx.get(key) ?? -1e9) < SFX_MIN_GAP_MS) return;
    this.lastSfx.set(key, now);
    if (this.sound.getAllPlaying().length > MAX_SFX_VOICES) return;
    try {
      this.sound.play(key, { volume: vol });
    } catch {
      this.failed.add(key);
    }
  }
}

/** A scene that does nothing but own the AudioManager. It is launched by the Preloader and never stopped, so the
 *  background audio loader (a scene plugin) keeps running while the town scene plays. */
export class AudioScene extends Phaser.Scene {
  manager!: AudioManager;

  constructor() {
    super({ key: SCENES.audio });
  }

  create(): void {
    this.manager = new AudioManager(this);
    this.manager.start();
    // QA handle (dev builds): game.cache.audio / game.sound are reachable through window.__phaser as well
    if (process.env.NODE_ENV !== "production") (window as unknown as { __audio?: AudioManager }).__audio = this.manager;
  }
}
