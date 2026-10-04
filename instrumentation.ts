// Runs once when the Next.js server process starts, whether or not any page
// is ever opened: the world keeps running while the player is away
// (POLIS_ARCHITECTURE 部署形态). startWorld() also catches up the hourly
// ticks missed while the server was down (bounded), so "回来看看" works even
// on a laptop dev server that was closed overnight.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorld } = await import("./lib/sim");
    startWorld();
  }
}
