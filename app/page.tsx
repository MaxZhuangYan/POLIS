"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GameShell from "./components/GameShell";
import type { BusyKey, GameActions } from "./components/actions";
import type { GameSnapshot } from "@/lib/types";

// The live game: GameShell renders whatever GET /api/game/state says, and
// every guardian verb is a POST followed by an immediate re-fetch. Polling is
// 2 s while the tab is visible (slower when hidden), with backoff + a visible
// "reconnecting" banner when the server is unreachable. Nothing here invents
// state: if a request fails, the UI shows the error and the snapshot stays.

const POLL_MS = 2000;
const HIDDEN_POLL_MS = 15000;

async function post<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `请求失败（${res.status}）`);
  return json;
}

export default function Page() {
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [busy, setBusy] = useState<BusyKey>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<"ok" | "retrying">("ok");
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch("/api/game/state", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setSnapshot((await res.json()) as GameSnapshot);
      failures.current = 0;
      setConnection("ok");
    } catch {
      failures.current += 1;
      if (failures.current >= 2) setConnection("retrying");
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    const loop = async () => {
      await refresh();
      if (stopped) return;
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      const backoff = failures.current > 0 ? Math.min(15000, 1000 * 2 ** failures.current) : hidden ? HIDDEN_POLL_MS : POLL_MS;
      timer.current = setTimeout(loop, backoff);
    };
    void loop();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const run = useCallback(
    async (key: Exclude<BusyKey, null>, fn: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        // Surface the error; never leave an unhandled rejection. UI state is
        // snapshot-driven, so a failed action simply leaves things as they were.
        setError(err instanceof Error ? err.message : "操作失败，请重试");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const actions = useMemo<GameActions>(
    () => ({
      createAgent: (input) =>
        run("create", () =>
          post("/api/player/create", { ...input, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        ),
      choose: (momentId, optionId) => run("choose", () => post(`/api/decisions/${momentId}/choose`, { optionId })),
      resolveJudgment: (id, action) => run("judgment", () => post(`/api/judgments/${id}/resolve`, { action })),
      feedback: (id, value) => run("judgment", () => post(`/api/judgments/${id}/feedback`, { value })),
      resolveWavering: (id, resolution, revisedText) =>
        run("wavering", () => post(`/api/wavering/${id}/resolve`, { resolution, revisedText })),
      sendNote: (text) => run("note", () => post("/api/notes", { text })),
      readPostcard: (id) => run("postcard", () => post(`/api/postcards/${id}/read`)),
      ackOnboarding: () => run("create", () => post("/api/player/onboarding")),
      advance: (opts) => run("advance", () => post("/api/test/advance", opts)),
    }),
    [run],
  );

  return <GameShell snapshot={snapshot} actions={actions} busy={busy} error={error} connection={connection} />;
}
