import { getDb } from "./db";

const TICK_INTERVAL_MS = Number(process.env.TICK_INTERVAL_MS ?? 5000);

// Phase 0 · Task ①: tick only advances the clock.
// Task generation and agent behavior are added in Task ②.
function tick() {
  const db = getDb();
  db.prepare("UPDATE world_state SET current_tick = current_tick + 1 WHERE id = 1").run();
}

declare global {
  // eslint-disable-next-line no-var
  var __polisClockInterval: ReturnType<typeof setInterval> | undefined;
}

export function startClock() {
  const db = getDb();
  db.prepare("UPDATE world_state SET is_running = 1 WHERE id = 1").run();

  if (!globalThis.__polisClockInterval) {
    globalThis.__polisClockInterval = setInterval(tick, TICK_INTERVAL_MS);
  }
}

export function pauseClock() {
  const db = getDb();
  db.prepare("UPDATE world_state SET is_running = 0 WHERE id = 1").run();

  if (globalThis.__polisClockInterval) {
    clearInterval(globalThis.__polisClockInterval);
    globalThis.__polisClockInterval = undefined;
  }
}

// Self-heal after a dev-server restart: if the DB says the clock was
// running but no interval exists in this process, resume it.
export function ensureClockMatchesState() {
  const db = getDb();
  const row = db.prepare("SELECT is_running FROM world_state WHERE id = 1").get() as
    | { is_running: number }
    | undefined;

  if (row?.is_running && !globalThis.__polisClockInterval) {
    globalThis.__polisClockInterval = setInterval(tick, TICK_INTERVAL_MS);
  }
}
