import { getDb } from "./db";

// ---------------------------------------------------------------------------
// Simulated wall clock.
//
// Formal rule (玩法设计 v1.5 §3.5 / §10.2): tick = 1 real hour, game time =
// real time 1:1. Every place in lib/ that needs "now" calls simNow() instead
// of Date.now(). In normal play world_state.time_offset_ms is 0, so simNow()
// IS real time and nothing about the formal rules changes.
//
// The only way the offset becomes non-zero is the explicitly labelled test
// fast-forward (POST /api/test/advance, only when POLIS_TEST_MODE=1). It
// moves the whole world — tick schedule, 24h Moment expiry, D1-D7 day
// windows, decay — forward together, so a tester can experience cross-day
// content without any rule being shortened.
// ---------------------------------------------------------------------------

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

declare global {
  // eslint-disable-next-line no-var
  var __polisOffsetMs: number | undefined;
}

export function getOffsetMs(): number {
  if (globalThis.__polisOffsetMs === undefined) {
    const row = getDb().prepare("SELECT time_offset_ms FROM world_state WHERE id = 1").get() as
      | { time_offset_ms: number }
      | undefined;
    globalThis.__polisOffsetMs = row?.time_offset_ms ?? 0;
  }
  return globalThis.__polisOffsetMs;
}

export function addOffsetMs(deltaMs: number): number {
  const next = getOffsetMs() + Math.max(0, Math.floor(deltaMs));
  getDb().prepare("UPDATE world_state SET time_offset_ms = ? WHERE id = 1").run(next);
  globalThis.__polisOffsetMs = next;
  return next;
}

declare global {
  // eslint-disable-next-line no-var
  var __polisSimOverrideMs: number | undefined;
}

export function simNow(): number {
  if (globalThis.__polisSimOverrideMs !== undefined) return globalThis.__polisSimOverrideMs;
  return Date.now() + getOffsetMs();
}

// Catch-up ticks (after a restart or a test fast-forward) must happen "at"
// their own hour, so every timestamp they write and every 24h / day-window
// comparison they make is correct. Synchronous only.
export function atSimTime<T>(ms: number, fn: () => T): T {
  const prev = globalThis.__polisSimOverrideMs;
  globalThis.__polisSimOverrideMs = ms;
  try {
    return fn();
  } finally {
    globalThis.__polisSimOverrideMs = prev;
  }
}

export function isTestMode(): boolean {
  return process.env.POLIS_TEST_MODE === "1";
}

export function worldTz(): string {
  const row = getDb().prepare("SELECT tz FROM world_state WHERE id = 1").get() as { tz: string | null } | undefined;
  return row?.tz || process.env.POLIS_TZ || "Asia/Shanghai";
}

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateKey: string; // YYYY-MM-DD in the world's timezone
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function localParts(ms: number, tz: string = worldTz()): LocalParts {
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(tz, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return { year, month, day, hour, minute, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

export function clockLabel(ms: number, tz: string = worldTz()): string {
  const p = localParts(ms, tz);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

// Start of the (local) hour containing ms. Works for any tz whose UTC offset
// is a whole number of minutes (all real ones).
export function hourStart(ms: number, tz: string = worldTz()): number {
  const p = localParts(ms, tz);
  return ms - p.minute * 60_000 - (ms % 60_000);
}

// Calendar-day index of `ms` relative to `originMs` in the world timezone:
// 0 = same local date (入城当天 = D1), 1 = next local date (D2), ...
export function dayIndexSince(originMs: number, ms: number = simNow(), tz: string = worldTz()): number {
  const a = localParts(originMs, tz);
  const b = localParts(ms, tz);
  const da = Date.UTC(a.year, a.month - 1, a.day);
  const dbb = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((dbb - da) / DAY_MS);
}

// Sim-time ms of the next occurrence of local `hour`:00 strictly after `fromMs`.
export function nextLocalHour(hour: number, fromMs: number = simNow(), tz: string = worldTz()): number {
  let t = hourStart(fromMs, tz) + HOUR_MS;
  for (let i = 0; i < 48; i++) {
    if (localParts(t, tz).hour === hour) return t;
    t += HOUR_MS;
  }
  return t;
}

// [start, end) of the local calendar day containing ms.
export function localDayBounds(ms: number, tz: string = worldTz()): [number, number] {
  const p = localParts(ms, tz);
  const start = hourStart(ms, tz) - p.hour * HOUR_MS;
  return [start, start + DAY_MS];
}
