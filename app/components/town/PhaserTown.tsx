"use client";

// React wrapper around the Phaser town scene.
// Phaser touches `window` when it is imported, so it is only ever loaded with a
// dynamic import() inside useEffect — never during SSR or at module scope.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { GameSnapshot } from "@/lib/types";
import type { TownScene } from "./TownScene";

export interface PhaserTownProps {
  snapshot: GameSnapshot | null;
  selectedId: string | null;
  followId: string | null;
  /** resident clicked (id) or empty ground clicked (null) */
  onSelect: (id: string | null) => void;
  /** the user panned the map, which ends "follow" */
  onFollowChange: (id: string | null) => void;
  /** screen position of my Agent's head inside the canvas (null when off-screen), ~8 Hz */
  onPlayerScreen?: (pt: { x: number; y: number } | null) => void;
  /** draw road graph / areas / slots over the map (dev QA) */
  debug?: boolean;
}

export interface PhaserTownHandle {
  focusAgent(id: string): void;
  setFollow(id: string | null): void;
  setSelected(id: string | null): void;
}

const PhaserTown = forwardRef<PhaserTownHandle, PhaserTownProps>(function PhaserTown(props, ref) {
  const { snapshot, selectedId, followId, debug = false } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TownScene | null>(null);
  const latest = useRef(props);

  useEffect(() => {
    latest.current = props;
  });

  useImperativeHandle(
    ref,
    () => ({
      focusAgent: (id) => sceneRef.current?.focusAgent(id),
      setFollow: (id) => sceneRef.current?.setFollow(id),
      setSelected: (id) => sceneRef.current?.setSelected(id)
    }),
    []
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let game: import("phaser").Game | null = null;
    let observer: ResizeObserver | null = null;

    (async () => {
      const [phaserMod, sceneMod] = await Promise.all([import("phaser"), import("./TownScene")]);
      if (cancelled) return;
      const Phaser = phaserMod.default;
      const scene = new sceneMod.TownScene({
        debug,
        onSelect: (id) => latest.current.onSelect(id),
        onFollowChange: (id) => latest.current.onFollowChange(id),
        onPlayerScreen: (pt) => latest.current.onPlayerScreen?.(pt)
      });
      sceneRef.current = scene;
      scene.setSnapshot(latest.current.snapshot);
      scene.setSelected(latest.current.selectedId);
      scene.setFollow(latest.current.followId);
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host,
        width: Math.max(1, host.clientWidth || window.innerWidth),
        height: Math.max(1, host.clientHeight || window.innerHeight),
        backgroundColor: "#0b1020",
        pixelArt: true,
        banner: false,
        audio: { noAudio: true },
        disableContextMenu: true,
        fps: { target: 60 },
        scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
        scene
      });
      observer = new ResizeObserver(() => game?.scale.refresh());
      observer.observe(host);
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      sceneRef.current = null;
      if (game) {
        game.destroy(true);
        game = null;
      }
    };
  }, [debug]);

  useEffect(() => {
    sceneRef.current?.setSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    sceneRef.current?.setSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    sceneRef.current?.setFollow(followId);
  }, [followId]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="Polis 小镇"
      style={{ position: "absolute", inset: 0, overflow: "hidden", touchAction: "none", background: "#0b1020" }}
    />
  );
});

export default PhaserTown;
