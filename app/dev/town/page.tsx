"use client";

// DEV ONLY: renders GameShell against a mock world that evolves over time.
// Query params for QA / screenshots:
//   ?scene=forks|imprint|play|refuse|refuseNoForce|adjust|wavering|notes|postcard|onboarding|loading
//   &hour=21 (world clock)  &test=0|1  &offline=0|1  &debug=1 (road graph)  &coach=1 (show coach marks)  &retry=1

import { useEffect, useRef, useState } from "react";
import type { GameSnapshot } from "@/lib/types";
import type { BusyKey } from "@/app/components/actions";
import GameShell from "@/app/components/GameShell";
import { MockGame, SCENES, type FixtureScene } from "@/app/components/devFixture";
import styles from "./page.module.css";

const HOURS = [6, 9, 14, 18, 21, 23];
const COACH_KEYS = ["agent", "activity", "note", "postcard"].map((k) => `polis.coach.v1.${k}`);

export default function DevTownPage() {
  const gameRef = useRef<MockGame | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [busy, setBusy] = useState<BusyKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<FixtureScene>("play");
  const [testMode, setTestMode] = useState(true);
  const [offline, setOffline] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [debug, setDebug] = useState(false);
  const [shellKey, setShellKey] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const wanted = q.get("scene") as FixtureScene | null;
    const initial: FixtureScene = wanted && SCENES.some((s) => s.id === wanted) ? wanted : "play";
    if (q.get("coach") !== "1") {
      try {
        for (const k of COACH_KEYS) window.localStorage.setItem(k, "1");
      } catch {
        /* ignore */
      }
    }
    const g = new MockGame(initial);
    gameRef.current = g;
    if (q.get("hour")) g.setHour(Number(q.get("hour")));
    if (q.get("test") === "0") g.opts.testMode = false;
    if (q.get("offline") === "0") g.opts.offline = false;
    if (q.get("retry") === "1") g.retrying = true;
    setScene(initial);
    setTestMode(g.opts.testMode);
    setOffline(g.opts.offline);
    setRetrying(g.retrying);
    setDebug(q.get("debug") === "1");
    const refresh = () => {
      setSnapshot(g.build());
      setBusy(g.busy);
      setError(g.error);
    };
    g.subscribe(refresh);
    refresh();
    setReady(true);
    const t = window.setInterval(refresh, 1000);
    return () => {
      window.clearInterval(t);
      g.dispose();
      gameRef.current = null;
    };
  }, []);

  const g = gameRef.current;

  const pick = (s: FixtureScene) => {
    setScene(s);
    g?.setScene(s);
  };

  return (
    <div className={styles.page}>
      <div className={styles.bar} role="toolbar" aria-label="dev 状态切换">
        <span className={styles.tag}>DEV</span>
        {SCENES.map((s) => (
          <button key={s.id} type="button" className={`${styles.chip} ${scene === s.id ? styles.on : ""}`} onClick={() => pick(s.id)}>
            {s.label}
          </button>
        ))}
        <span className={styles.sep} />
        {HOURS.map((h) => (
          <button key={h} type="button" className={styles.chip} onClick={() => g?.setHour(h)}>
            {String(h).padStart(2, "0")}:00
          </button>
        ))}
        <span className={styles.sep} />
        <button
          type="button"
          className={`${styles.chip} ${testMode ? styles.on : ""}`}
          onClick={() => {
            if (!g) return;
            g.opts.testMode = !g.opts.testMode;
            setTestMode(g.opts.testMode);
            g.emit();
          }}
        >
          测试模式
        </button>
        <button
          type="button"
          className={`${styles.chip} ${offline ? styles.on : ""}`}
          onClick={() => {
            if (!g) return;
            g.opts.offline = !g.opts.offline;
            setOffline(g.opts.offline);
            g.emit();
          }}
        >
          离线 LLM
        </button>
        <button
          type="button"
          className={`${styles.chip} ${retrying ? styles.on : ""}`}
          onClick={() => {
            if (!g) return;
            g.retrying = !g.retrying;
            setRetrying(g.retrying);
          }}
        >
          连接中断
        </button>
        <button
          type="button"
          className={`${styles.chip} ${failNext ? styles.on : ""}`}
          onClick={() => {
            if (!g) return;
            g.failNext = !g.failNext;
            setFailNext(g.failNext);
          }}
        >
          下次操作失败
        </button>
        <button type="button" className={`${styles.chip} ${debug ? styles.on : ""}`} onClick={() => setDebug((v) => !v)}>
          路线调试
        </button>
        <button
          type="button"
          className={styles.chip}
          onClick={() => {
            try {
              for (const k of COACH_KEYS) window.localStorage.removeItem(k);
              window.localStorage.removeItem("polis.rated.v1");
            } catch {
              /* ignore */
            }
            setShellKey((k) => k + 1);
          }}
        >
          重置新手提示
        </button>
      </div>
      <div className={styles.shell}>
        {ready && g ? (
          <GameShell key={`${shellKey}-${debug ? "d" : "n"}`} snapshot={snapshot} actions={g.actions} busy={busy} error={error} connection={retrying ? "retrying" : "ok"} debugTown={debug} />
        ) : null}
      </div>
    </div>
  );
}
