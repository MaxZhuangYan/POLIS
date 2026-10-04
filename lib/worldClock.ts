import { getDb } from "./db";
import { maybeGenerateMoment, expirePendingMoments, ensureD2Citation } from "./decisionMoments";
import { maybeRunDistillationBatch } from "./distillation";
import { decayPrinciples } from "./principleEngine";

const DEFAULT_TICK_INTERVAL_MS = 5000;
// P2 fix: an invalid/non-positive TICK_INTERVAL_MS (e.g. "bad", "0", a negative
// value) used to pass straight through `Number(...)` — `setInterval` treats any
// non-positive delay as ~0ms, effectively ticking near-every-millisecond and
// hammering the DB. Validate and fall back to the default, matching the guard
// pattern already used for MOMENT_MIN_INTERVAL_MS/DISTILLATION_INTERVAL_MS/etc.
function readIntervalEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
const TICK_INTERVAL_MS = readIntervalEnv("TICK_INTERVAL_MS", DEFAULT_TICK_INTERVAL_MS);

const TASK_TYPES = ["info", "transport", "guard"] as const;
const TASK_SPAWN_CHANCE = 0.4;
const AGENT_PICKUP_CHANCE = 0.5;
const TASK_DURATION_TICKS = 3;
const BURN_RATE = 0.05;

type AgentRow = {
  id: string;
  state: string;
};

type TaskRow = {
  id: number;
  type: string;
  reward: number;
  status: string;
  taken_by: string | null;
  created_tick: number;
  taken_at_tick: number | null;
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// World tick — the task/ledger economy simulation. Only advances while the
// world clock is "started" (see startClock()/pauseClock() below). Pausing
// this is a deliberate demo/dev control over the Phase 0 economy loop.
// ---------------------------------------------------------------------------
function tick() {
  const db = getDb();

  const run = db.transaction(() => {
    // Task ①: advance the clock.
    db.prepare("UPDATE world_state SET current_tick = current_tick + 1 WHERE id = 1").run();
    const world = db.prepare("SELECT current_tick FROM world_state WHERE id = 1").get() as {
      current_tick: number;
    };
    const currentTick = world.current_tick;

    // Task ②a: task generation (pure rules, no LLM).
    if (Math.random() < TASK_SPAWN_CHANCE) {
      const type = TASK_TYPES[randomInt(0, TASK_TYPES.length - 1)];
      const reward = randomInt(10, 50);
      db.prepare(
        "INSERT INTO tasks (type, reward, status, created_tick) VALUES (?, ?, 'open', ?)",
      ).run(type, reward, currentTick);
    }

    // Task ②b: idle agents roll to pick up an open task.
    // Re-querying 'open' tasks inside this single synchronous loop guarantees a task
    // flips away from 'open' before the next agent's turn, so it can never be
    // double-assigned within the same tick (or across ticks, since only idle agents
    // are considered and a picked agent immediately becomes 'working').
    const idleAgents = db.prepare("SELECT id, state FROM agents WHERE state = 'idle'").all() as AgentRow[];
    for (const agent of idleAgents) {
      if (Math.random() >= AGENT_PICKUP_CHANCE) continue;

      const openTask = db
        .prepare("SELECT * FROM tasks WHERE status = 'open' ORDER BY RANDOM() LIMIT 1")
        .get() as TaskRow | undefined;
      if (!openTask) continue;

      const result = db
        .prepare("UPDATE tasks SET status = 'taken', taken_by = ?, taken_at_tick = ? WHERE id = ? AND status = 'open'")
        .run(agent.id, currentTick, openTask.id);
      if (result.changes === 0) continue; // defensive: task was already taken, skip

      db.prepare("UPDATE agents SET state = 'working', current_location = ? WHERE id = ?").run(
        openTask.type,
        agent.id,
      );
    }

    // Task ②c + ③: tasks that have run 3 ticks complete, pay out, and burn 5%.
    const workingTasks = db.prepare("SELECT * FROM tasks WHERE status = 'taken'").all() as TaskRow[];
    for (const task of workingTasks) {
      if (task.taken_at_tick === null) continue;
      if (currentTick - task.taken_at_tick < TASK_DURATION_TICKS) continue;
      if (!task.taken_by) continue;

      const income = Math.floor(task.reward * (1 - BURN_RATE));
      const burn = task.reward - income; // remainder, so income + burn always == reward

      db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(task.id);
      db.prepare(
        "UPDATE agents SET state = 'idle', current_location = 'town-center', scrip = scrip + ? WHERE id = ?",
      ).run(income, task.taken_by);
      db.prepare("INSERT INTO ledger (agent_id, amount, reason, tick) VALUES (?, ?, 'task_reward', ?)").run(
        task.taken_by,
        income,
        currentTick,
      );
      db.prepare("INSERT INTO ledger (agent_id, amount, reason, tick) VALUES (?, ?, 'burn', ?)").run(
        task.taken_by,
        -burn,
        currentTick,
      );
    }
  });

  run();
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

// ---------------------------------------------------------------------------
// Background jobs — Decision Moment expiry/generation/D2-citation, principle
// distillation, and decay.
//
// P2 fix (found in code review): these used to run *inside* tick() above,
// which meant pauseClock() silently paused them too. That's wrong per Build
// Decision ④ — these are wall-clock-driven narrative/memory mechanics, not
// part of the task/ledger economy simulation, and shouldn't stop just
// because a developer/demo control paused the economy loop. A player's
// Decision Moments must still expire on schedule, and distillation/decay
// must still run, regardless of whether anyone has "started" the world.
//
// This runs on its own always-on interval, started once at server boot (see
// instrumentation.ts) and never touched by startClock()/pauseClock().
// ---------------------------------------------------------------------------
const DEFAULT_BACKGROUND_JOBS_INTERVAL_MS = 10000;
const BACKGROUND_JOBS_INTERVAL_MS = readIntervalEnv(
  "BACKGROUND_JOBS_INTERVAL_MS",
  DEFAULT_BACKGROUND_JOBS_INTERVAL_MS,
);

function backgroundJobsTick() {
  const db = getDb();

  expirePendingMoments();
  const player = db.prepare("SELECT id FROM agents WHERE is_player = 1").get() as
    | { id: string }
    | undefined;
  if (player) {
    maybeGenerateMoment(player.id);
    ensureD2Citation(player.id);
  }

  maybeRunDistillationBatch();
  maybeRunDecay();
}

declare global {
  // eslint-disable-next-line no-var
  var __polisLastDecayCheck: number | undefined;
  // eslint-disable-next-line no-var
  var __polisBackgroundJobsInterval: ReturnType<typeof setInterval> | undefined;
}

const DEFAULT_DECAY_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 real hour (decayPrinciples()
// itself is idempotent within a 14-day window, so this throttle is purely to avoid
// scanning the principles table every single background tick — not correctness-critical).

function maybeRunDecay() {
  const intervalMs = readIntervalEnv("DECAY_CHECK_INTERVAL_MS", DEFAULT_DECAY_CHECK_INTERVAL_MS);

  const now = Date.now();
  const last = globalThis.__polisLastDecayCheck;
  if (last !== undefined && now - last < intervalMs) {
    return;
  }
  globalThis.__polisLastDecayCheck = now;
  decayPrinciples();
}

// Called once at server boot (instrumentation.ts) — unconditional, not tied
// to world_state.is_running. Safe to call more than once (idempotent via the
// globalThis singleton guard, same pattern as the world clock's interval).
export function ensureBackgroundJobsRunning() {
  if (!globalThis.__polisBackgroundJobsInterval) {
    globalThis.__polisBackgroundJobsInterval = setInterval(backgroundJobsTick, BACKGROUND_JOBS_INTERVAL_MS);
  }
}
