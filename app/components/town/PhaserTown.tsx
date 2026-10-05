"use client";

// React wrapper around the Phaser town scene.
// Phaser touches `window` when it is imported, so it is only ever loaded with a
// dynamic import() inside useEffect — never during SSR or at module scope.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { GameSnapshot } from "@/lib/types";
import type { TownScene } from "./TownScene";
import styles from "./PhaserTown.module.css";

export interface PhaserTownProps {
  snapshot: GameSnapshot | null;
  selectedId: string | null;
  followId: string | null;
  /** resident clicked (id) or empty ground clicked (null) */
  onSelect: (id: string | null) => void;
  /** the user panned the map, which ends "follow" */
  onFollowChange: (id: string | null) => void;
  /** draw road graph / areas / slots over the map (dev QA) */
  debug?: boolean;
}

export interface PhaserTownHandle {
  focusAgent(id: string): void;
  setFollow(id: string | null): void;
  setSelected(id: string | null): void;
  /** live screen position of my Agent inside the canvas (null when off-screen / not loaded) */
  getPlayerScreen(): { x: number; y: number } | null;
}

const PhaserTown = forwardRef<PhaserTownHandle, PhaserTownProps>(function PhaserTown(props, ref) {
  const { snapshot, selectedId, followId, debug = false } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TownScene | null>(null);
  const latest = useRef(props);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    latest.current = props;
  });

  useImperativeHandle(
    ref,
    () => ({
      focusAgent: (id) => sceneRef.current?.focusAgent(id),
      setFollow: (id) => sceneRef.current?.setFollow(id),
      setSelected: (id) => sceneRef.current?.setSelected(id),
      getPlayerScreen: () => sceneRef.current?.getPlayerScreen() ?? null
    }),
    []
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let game: import("phaser").Game | null = null;
    let observer: ResizeObserver | null = null;
    setReady(false);
    setProgress(0);

    (async () => {
      const [phaserMod, sceneMod] = await Promise.all([import("phaser"), import("./TownScene")]);
      if (cancelled) return;
      const Phaser = phaserMod.default ?? phaserMod;
      const scene = new sceneMod.TownScene({
        debug,
        onSelect: (id) => latest.current.onSelect(id),
        onFollowChange: (id) => latest.current.onFollowChange(id),
        onProgress: (p) => {
          if (!cancelled) setProgress(p);
        },
        onReady: () => {
          if (!cancelled) setReady(true);
        }
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
    <div className={styles.wrap}>
      <div ref={hostRef} className={styles.host} role="img" aria-label="Polis 小镇" />
      {!ready ? (
        <div className={styles.loading} role="status" aria-live="polite">
          <span className={styles.spinner} aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className={styles.text}>小镇加载中…{progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : ""}</span>
        </div>
      ) : null}
    </div>
  );
});

export default PhaserTown;
