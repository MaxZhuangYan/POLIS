// Runs once when the Next.js server process starts, independent of whether
// any request/page-load ever happens — this is the fix for a real gap found
// in code review: ensureClockMatchesState() was previously only invoked
// reactively from GET /api/world/state, so a server restart with nobody
// opening a page left the world (tick, task pool) stopped indefinitely,
// violating "the world keeps running while the player is offline."
//
// ensureBackgroundJobsRunning() (P2 fix) starts the separate, always-on
// interval for Decision Moment expiry/generation, D2-citation, distillation,
// and decay — unlike the world tick, this one is never paused by
// startClock()/pauseClock(), since those are wall-clock-driven narrative/
// memory mechanics, not part of the task/ledger economy simulation.
//
// Stable since Next.js 14 (App Router), no experimental flag needed.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureClockMatchesState, ensureBackgroundJobsRunning } = await import("./lib/worldClock");
    ensureClockMatchesState();
    ensureBackgroundJobsRunning();
  }
}
