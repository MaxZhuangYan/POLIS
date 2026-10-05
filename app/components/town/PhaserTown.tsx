"use client";

// React wrapper around the Phaser game (Boot -> Preloader -> Town scenes).
// Phaser touches `window` when it is imported, so it is only ever loaded with a dynamic import() inside
// useEffect — never during SSR or at module scope.
//
// React <-> Phaser traffic goes through the typed EventBus (app/components/game/EventBus.ts):
//   props   -> cmd-snapshot / cmd-select / cmd-follow / cmd-focus   (the scene re-requests state with scene-ready)
//   scene   -> resident-selected / location-selected / follow-changed / boot-ready / load-progress / scene-ready
// GameShell talks to the same bus for the rest (title mode, keyboard pan / zoom, audio) through game/bus.ts, and shows
// the loading screen itself (from load-progress / scene-ready), so this component draws no overlay of its own.
// Only the synchronous "where is my Agent on screen" query reads the scene directly.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { GameSnapshot, LocationId } from "@/lib/types";
import type { TownEventBus } from "../game/EventBus";
import type { TownScene } from "../game/scenes/TownScene";
import { BG_COLOR, SCENES } from "../game/keys";
import styles from "./PhaserTown.module.css";

export interface PhaserTownProps {
  snapshot: GameSnapshot | null;
  selectedId: string | null;
  followId: string | null;
  /** resident clicked (id) or empty ground clicked (null) */
  onSelect: (id: string | null) => void;
  /** a building / landmark clicked (id) or something else clicked (null) */
  onSelectLocation?: (id: LocationId | null) => void;
  /** the user panned the map, which ends "follow" */
  onFollowChange: (id: string | null) => void;
  /** draw collision / stand areas / slots / doors over the map (dev QA) */
  debug?: boolean;
  /** which registered map (town/maps.ts) the Preloader loads and the Town scene builds; changing it restarts the game */
  mapId?: string;
}

export interface PhaserTownHandle {
  focusAgent(id: string): void;
  setFollow(id: string | null): void;
  setSelected(id: string | null): void;
  /** live screen position of my Agent inside the canvas (null when off-screen / not loaded) */
  getPlayerScreen(): { x: number; y: number } | null;
}

const PhaserTown = forwardRef<PhaserTownHandle, PhaserTownProps>(function PhaserTown(props, ref) {
  const { snapshot, selectedId, followId, debug = false, mapId } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<import("phaser").Game | null>(null);
  const busRef = useRef<TownEventBus | null>(null);
  const latest = useRef(props);

  useEffect(() => {
    latest.current = props;
  });

  useImperativeHandle(
    ref,
    () => ({
      focusAgent: (id) => busRef.current?.emit("cmd-focus", id),
      setFollow: (id) => busRef.current?.emit("cmd-follow", id),
      setSelected: (id) => busRef.current?.emit("cmd-select", id),
      getPlayerScreen: () => {
        const scene = gameRef.current?.scene.getScene(SCENES.town) as TownScene | null | undefined;
        return scene?.getPlayerScreen() ?? null;
      }
    }),
    []
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let teardown: (() => void) | null = null;

    (async () => {
      const [phaserMod, busMod, bootMod, preMod, townMod, audioMod] = await Promise.all([
        import("phaser"),
        import("../game/EventBus"),
        import("../game/scenes/BootScene"),
        import("../game/scenes/PreloaderScene"),
        import("../game/scenes/TownScene"),
        import("../game/audio")
      ]);
      if (cancelled) return;
      const Phaser = phaserMod.default ?? phaserMod;
      const bus = busMod.EventBus;
      busRef.current = bus;

      // scene -> React
      const onResident = (id: string | null) => latest.current.onSelect(id);
      const onLocation = (id: LocationId | null) => latest.current.onSelectLocation?.(id);
      const onFollow = (id: string | null) => latest.current.onFollowChange(id);
      // the town scene is up: give it everything React currently knows
      const onSceneReady = () => {
        const p = latest.current;
        bus.emit("cmd-snapshot", p.snapshot);
        bus.emit("cmd-select", p.selectedId);
        bus.emit("cmd-follow", p.followId);
      };
      bus.on("resident-selected", onResident);
      bus.on("location-selected", onLocation);
      bus.on("follow-changed", onFollow);
      bus.on("scene-ready", onSceneReady);

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        width: Math.max(1, host.clientWidth || window.innerWidth),
        height: Math.max(1, host.clientHeight || window.innerHeight),
        backgroundColor: BG_COLOR,
        // pixel-perfect: nearest-neighbour sampling, no antialiasing, positions rounded to whole pixels
        pixelArt: true,
        roundPixels: true,
        antialias: false,
        banner: false,
        // audio is enabled: the AudioScene (launched by the Preloader) owns the AudioManager and loads its files in
        // the background; a browser without audio support just ends up with a silent game
        audio: { disableWebAudio: false },
        disableContextMenu: true,
        fps: { target: 60 },
        scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
        callbacks: {
          preBoot: (g) => {
            g.registry.set("debug", debug);
            g.registry.set("mapId", mapId ?? null); // read by the Preloader (resolveMap falls back to the default)
          }
        },
        scene: [bootMod.BootScene, preMod.PreloaderScene, townMod.TownScene, audioMod.AudioScene]
      });
      gameRef.current = game;
      // QA handle (dev builds): game.sound, game.cache.audio ...
      if (process.env.NODE_ENV !== "production") (window as unknown as { __phaser?: unknown }).__phaser = game;
      observer = new ResizeObserver(() => game.scale.refresh());
      observer.observe(host);

      teardown = () => {
        bus.off("resident-selected", onResident);
        bus.off("location-selected", onLocation);
        bus.off("follow-changed", onFollow);
        bus.off("scene-ready", onSceneReady);
        game.destroy(true);
      };
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      gameRef.current = null;
      busRef.current = null;
      teardown?.();
      teardown = null;
    };
  }, [debug, mapId]);

  useEffect(() => {
    busRef.current?.emit("cmd-snapshot", snapshot);
  }, [snapshot]);

  useEffect(() => {
    busRef.current?.emit("cmd-select", selectedId);
  }, [selectedId]);

  useEffect(() => {
    busRef.current?.emit("cmd-follow", followId);
  }, [followId]);

  return (
    <div className={styles.wrap}>
      <div ref={hostRef} className={styles.host} role="img" aria-label="Polis 小镇" />
    </div>
  );
});

export default PhaserTown;
