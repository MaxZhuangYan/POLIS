// React-side access to the EventBus without importing Phaser at module scope.
//
// EventBus.ts imports Phaser (its EventEmitter), and Phaser touches `window` on import, so nothing that is also
// rendered on the server may import it statically. Components use these helpers instead: the bus is imported lazily,
// in the browser, once; emits keep their order because they all chain on the same promise.

import type { TownEventBus, TownEventName, TownEvents } from "./EventBus";

let busPromise: Promise<TownEventBus> | null = null;

export function loadBus(): Promise<TownEventBus> {
  if (!busPromise) busPromise = import("./EventBus").then((m) => m.EventBus);
  return busPromise;
}

/** send a React -> Phaser command (dropped silently if the bus can't load: the game then simply has no audio etc.) */
export function emitToTown<K extends TownEventName>(event: K, ...args: Parameters<TownEvents[K]>): void {
  void loadBus()
    .then((bus) => bus.emit(event, ...args))
    .catch(() => undefined);
}

/** subscribe to a Phaser -> React event; returns the unsubscribe function (usable before the bus has loaded) */
export function onTown<K extends TownEventName>(event: K, fn: TownEvents[K]): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void loadBus()
    .then((bus) => {
      if (cancelled) return;
      bus.on(event, fn);
      off = () => bus.off(event, fn);
    })
    .catch(() => undefined);
  return () => {
    cancelled = true;
    off?.();
  };
}
