// ---------------------------------------------------------------------------
// 置业 — each resident saves toward something of their own, one thing after another.
//
// Why: without it every wallet only grows (a 28-day hands-off run ended with residents at 2,000–3,000 Scrip),
// nobody ever needs a loan after the first day, and the loan → repay / default → grudge → hearsay chain goes
// quiet. A goal gives money somewhere to go, in character:
//   * at noon a resident who can afford their goal buys it — real Scrip leaves their wallet (ledger `purchase`),
//     the town sees it, they remember it;
//   * one who is close (short by 10–60) may ask a friend for the difference — the ordinary loan path in sim.ts,
//     including the guardian's Agent (its fork names what the money is for), due in two days like any loan;
//   * then the next, dearer goal.
// Nothing here is a need bar: nobody suffers for not buying; it is what they choose to spend on.
// ---------------------------------------------------------------------------

import { getDb } from "./db";
import { adjustReputation, agentName, logEvent, metric, pay, remember, say } from "./records";

/** What each resident is saving for, in order (the list repeats, dearer each round). */
const GOALS: Record<string, string[]> = {
  mira: ["给北灯塔换一套新脚手架", "把市集的旧棚子翻修一遍", "给工地添一批好木料", "请人画一张新城区的图"],
  sol: ["盘下市集边上的小铺面", "进一批远方的货", "给铺子装一道好锁", "在码头租一个货位"],
  tao: ["添一台新车床", "换一套好刨刀", "把工坊的炉子重砌一遍", "攒一批硬木料"],
  iris: ["印一卷新的城志", "给档案馆添两个书架", "买一批好纸和墨", "装订那几卷散档"],
  kade: ["修好议事厅的钟", "给调解室换几把椅子", "请人誊一份新的城约", "给议事厅换新门"],
  nova: ["给搜救队添一套绳索和信号灯", "换一双能走远路的靴子", "修好那顶旧帐篷", "攒一批干粮和药"],
};

const BASE_PRICE = 240;
const STEP = 120;
/** shortest / longest gap a resident will ask a friend to cover */
const MIN_GAP = 10;
const MAX_GAP = 60;

export interface Goal {
  npc: string;
  what: string;
  price: number;
  level: number;
}

export function goalOf(npc: string): Goal | null {
  const list = GOALS[npc];
  if (!list) return null;
  const row = getDb().prepare("SELECT goal_level FROM agents WHERE id = ?").get(npc) as { goal_level: number } | undefined;
  const level = row?.goal_level ?? 0;
  return { npc, what: list[level % list.length], price: BASE_PRICE + STEP * level, level };
}

/** Buy the goal if the wallet allows. Returns what was bought. */
export function buyIfAffordable(npc: string, lender?: string | null): Goal | null {
  const g = goalOf(npc);
  if (!g) return null;
  const db = getDb();
  const scrip = (db.prepare("SELECT scrip FROM agents WHERE id = ?").get(npc) as { scrip: number }).scrip;
  if (scrip < g.price) return null;
  pay(npc, -g.price, "purchase");
  db.prepare("UPDATE agents SET goal_level = goal_level + 1 WHERE id = ?").run(npc);
  adjustReputation(npc, 1);
  remember(npc, "purchase", `攒够了 ${g.price} Scrip，${g.what}。${lender ? `差的那点，是 ${agentName(lender)} 借的。` : ""}`, { price: g.price, lender: lender ?? null });
  if (lender) {
    const isPlayer = (db.prepare("SELECT is_player FROM agents WHERE id = ?").get(lender) as { is_player: number } | undefined)?.is_player;
    if (isPlayer) remember(lender, "consequence", `${agentName(npc)} 拿我借的钱补上了差额，${g.what}。`, { npc, price: g.price });
  }
  logEvent({
    kind: "relationship",
    text: `${agentName(npc)} 攒够了钱，${g.what}（${g.price} Scrip）${lender ? `——差的那点是 ${agentName(lender)} 借的` : ""}`,
    actors: lender ? [npc, lender] : [npc],
    importance: 2,
  });
  say(npc, `${g.what.replace(/^给|^把/, "")}，总算成了。`, "happy");
  metric("purchase", { npc, what: g.what, price: g.price, level: g.level, lender: lender ?? null });
  return g;
}

/** Noon: residents who can afford their goal buy it. */
export function residentPurchases(): void {
  const npcs = getDb().prepare("SELECT id FROM agents WHERE is_player = 0").all() as Array<{ id: string }>;
  for (const n of npcs) buyIfAffordable(n.id);
}

/** A resident a little short of their goal: how much they would ask a friend for, and what for (null if not). */
export function goalLoanWant(npc: string, scrip: number, risk: number): { amount: number; purpose: string } | null {
  const g = goalOf(npc);
  if (!g) return null;
  const gap = g.price - scrip;
  if (gap < MIN_GAP || gap > MAX_GAP) return null;
  // the bolder ones borrow; the careful ones would rather wait a day
  if (Math.random() > 0.25 + 0.5 * risk) return null;
  return { amount: gap, purpose: g.what };
}

/** For the weekly volume: what residents bought since `since`, and who is close to their next goal. */
export function goalNews(since: number): { bought: string[]; close: string[] } {
  const db = getDb();
  const bought = (
    db.prepare("SELECT payload_json FROM metric_events WHERE name = 'purchase' AND at_ms >= ? ORDER BY at_ms").all(since) as Array<{ payload_json: string }>
  ).map((r) => {
    const p = JSON.parse(r.payload_json) as { npc: string; what: string };
    return `${agentName(p.npc)}${p.what}`;
  });
  const close: string[] = [];
  for (const n of db.prepare("SELECT id, scrip FROM agents WHERE is_player = 0").all() as Array<{ id: string; scrip: number }>) {
    const g = goalOf(n.id);
    if (g && g.price - n.scrip > 0 && g.price - n.scrip <= 80) close.push(`${agentName(n.id)}想${g.what}，还差 ${g.price - n.scrip} Scrip`);
  }
  return { bought, close };
}
