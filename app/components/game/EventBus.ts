// A tiny typed event bus between React and Phaser, in the spirit of the official Phaser + React template:
// one Phaser.Events.EventEmitter singleton that both sides import.
//
//   Phaser -> React   boot-ready, load-progress, scene-ready, resident-selected, location-selected, follow-changed
//   React  -> Phaser  cmd-snapshot, cmd-select, cmd-follow, cmd-focus
//
// This module imports Phaser, so like every Phaser module it must only be loaded in the browser (dynamic import()).

import { Events } from "phaser";
import type { GameSnapshot, LocationId } from "@/lib/types";

export interface TownEvents {
  /** the canvas is up and the preloader is about to draw its bar */
  "boot-ready": () => void;
  /** asset loading progress 0..1 and the key of the file in flight */
  "load-progress": (progress: number, file: string) => void;
  /** TownScene is created and the world is on screen: React should (re)send its current state */
  "scene-ready": () => void;
  /** a resident was clicked (id) or empty ground was clicked (null) */
  "resident-selected": (id: string | null) => void;
  /** a building / landmark was clicked (id) or something else was clicked (null) */
  "location-selected": (id: LocationId | null) => void;
  /** the user dragged the map while following, so following stopped */
  "follow-changed": (id: string | null) => void;

  "cmd-snapshot": (snapshot: GameSnapshot | null) => void;
  "cmd-select": (id: string | null) => void;
  "cmd-follow": (id: string | null) => void;
  "cmd-focus": (id: string) => void;
}

export type TownEventName = keyof TownEvents;

export class TownEventBus extends Events.EventEmitter {
  override emit<K extends TownEventName>(event: K, ...args: Parameters<TownEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
  override on<K extends TownEventName>(event: K, fn: TownEvents[K], context?: unknown): this {
    return super.on(event, fn, context);
  }
  override once<K extends TownEventName>(event: K, fn: TownEvents[K], context?: unknown): this {
    return super.once(event, fn, context);
  }
  override off<K extends TownEventName>(event: K, fn?: TownEvents[K], context?: unknown, once?: boolean): this {
    return super.off(event, fn, context, once);
  }
}

export const EventBus = new TownEventBus();
