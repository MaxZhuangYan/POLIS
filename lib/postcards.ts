import { getDb } from "./db";
import { simNow, dayIndexSince, HOUR_MS } from "./clock";
import { LOCATION_NAMES, START_SCRIP } from "./content";
import { logEvent, metric } from "./records";
import { answerNotes, pendingNotes } from "./notes";
import { chat, llmAvailable } from "./llm";
import type { LocationId } from "./types";

// ---------------------------------------------------------------------------
// 明信片 (v1.5 §2.1, v3.14 §2.3) — "the most important copy in the game".
//
// Honesty contract (公理 3/5, digest §6.2): the writer only ever sees a
// structured `facts` object built from rows (memories, tasks, ledger,
// judgments, notes). The template floor turns those facts into first-person
// lines; it never adds an event, a name or a number that is not in facts.
// An optional LLM polish is accepted only if every number and every
// resident name it uses is in the facts and it still quotes ≥1 principle —
// otherwise the template stands (source='template').
// ---------------------------------------------------------------------------

interface MemoryRow {
  id: number;
  at_ms: number;
  kind: string;
  text: string;
  principle_id: number | null;
}

interface Facts {
  agentName: string;
  dayIndex: number;
  memories: MemoryRow[];
  income: number;
  losses: number;
  tasksDone: number;
  tasksFailed: number;
  mainLocation: string | null;
  principlesCited: string[];
  anchorPrinciple: { text: string; daysAgo: number } | null;
  forced: boolean;
  refusedAccepted: boolean;
  betrayed: boolean;
  defaulted: boolean;
  declinedRisk: boolean;
  names: string[];
}

const KIND_PRIORITY: Record<string, number> = {
  forced: 10,
  respected: 9,
  betrayed: 9,
  defaulted: 9,
  consequence: 8,
  visit: 8,
  task_failed: 7,
  kept_promise: 7,
  self_decided: 7,
  adopted: 6,
  overruled: 6,
  judgment: 6,
  refused: 6,
  repair: 6,
  loan: 5,
  declined: 5,
  coop: 4,
  task_done: 3,
  grudge: 5,
  shortcut: 4,
  rush: 4,
  routine_choice: 1,
};

function collectFacts(agentId: string, sinceMs: number, untilMs: number): Facts {
  const db = getDb();
  const agent = db.prepare("SELECT name, created_at FROM agents WHERE id = ?").get(agentId) as { name: string; created_at: number };
  const memories = db
    .prepare(
      "SELECT id, at_ms, kind, text, principle_id FROM memories WHERE agent_id = ? AND at_ms > ? AND at_ms <= ? AND kind NOT IN ('note_received','principle','guidance') ORDER BY at_ms",
    )
    .all(agentId, sinceMs, untilMs) as MemoryRow[];
  const done = memories.filter((m) => m.kind === "task_done");
  const failed = memories.filter((m) => m.kind === "task_failed");
  const income = done.reduce((s, m) => s + Number((m.text.match(/(\d+) Scrip/) ?? [0, 0])[1]), 0);
  const losses = failed.reduce((s, m) => s + Number((m.text.match(/(\d+) Scrip/) ?? [0, 0])[1]), 0);
  const locRows = db
    .prepare("SELECT location FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND COALESCE(done_ms, created_ms) > ? AND COALESCE(done_ms, created_ms) <= ?")
    .all(agentId, agentId, sinceMs, untilMs) as Array<{ location: string }>;
  const counts = new Map<string, number>();
  for (const r of locRows) counts.set(r.location, (counts.get(r.location) ?? 0) + 1);
  const mainLocation = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const cited = [...new Set(memories.flatMap((m) => Array.from(m.text.matchAll(/『(.+?)』/g)).map((x) => x[1])))];
  const anchor = db
    .prepare("SELECT text, created_at FROM principles WHERE agent_id = ? AND source IN ('llm','fallback','note') AND weight >= 0.3 ORDER BY created_at LIMIT 1")
    .get(agentId) as { text: string; created_at: number } | undefined;
  const names = db.prepare("SELECT name FROM agents").all().map((r) => (r as { name: string }).name);
  return {
    agentName: agent.name,
    dayIndex: dayIndexSince(agent.created_at, untilMs),
    memories,
    income,
    losses,
    tasksDone: done.length,
    tasksFailed: failed.length,
    mainLocation: mainLocation ? LOCATION_NAMES[mainLocation as LocationId] ?? mainLocation : null,
    principlesCited: cited,
    anchorPrinciple: anchor ? { text: anchor.text, daysAgo: dayIndexSince(anchor.created_at, untilMs) } : null,
    forced: memories.some((m) => m.kind === "forced"),
    refusedAccepted: memories.some((m) => m.kind === "respected"),
    betrayed: memories.some((m) => m.kind === "betrayed"),
    defaulted: memories.some((m) => m.kind === "defaulted"),
    declinedRisk: memories.some((m) => m.kind === "self_decided" && /没接/.test(m.text)),
    names,
  };
}

function moodLine(f: Facts): string {
  if (f.tasksFailed > 0) return "其实今天不太顺。不过听到这句，好一点了。";
  if (f.tasksDone >= 2) return "其实还好，活都做完了，就是有点闷。";
  return "我在想你说这句话的时候，在做什么。";
}

function closingLine(f: Facts): string {
  if (f.forced) return "……我照做了。只是心里有点不是滋味。";
  if (f.refusedAccepted) return "谢谢你让我自己拿主意。";
  if (f.defaulted) return "……我是不是做错了什么。";
  if (f.betrayed) return "我还是想相信人。只是今天，有点难。";
  if (f.tasksFailed > 0) {
    return f.memories.some((m) => m.kind === "task_failed" && /勘察|护送/.test(m.text)) ? "……下次还去吗？我不知道。" : "……今天有件事没办成。明天再说吧。";
  }
  if (f.declinedRisk) return "……不知道是不是错过了什么。";
  if (f.tasksDone === 0) return "……今天就是这样。安安静静的一天。";
  return "明天见。";
}

function composeTemplate(f: Facts, noteLines: string[]): string[] {
  const lines: string[] = [...noteLines];
  if (f.mainLocation && f.memories.length < 3) lines.push(`今天大部分时间在${f.mainLocation}。`);
  // Collapse repeats ("接了外围勘察…" three times) into one line with a count.
  const counts = new Map<string, number>();
  for (const m of f.memories) counts.set(m.text, (counts.get(m.text) ?? 0) + 1);
  const unique = f.memories.filter((m, i) => f.memories.findIndex((x) => x.text === m.text) === i);
  const picked = [...unique]
    .sort((a, b) => (KIND_PRIORITY[b.kind] ?? 1) - (KIND_PRIORITY[a.kind] ?? 1) || a.at_ms - b.at_ms)
    .slice(0, 4)
    .sort((a, b) => a.at_ms - b.at_ms);
  const connectors = ["", "后来，", "再后来，", "傍晚，"];
  picked.forEach((m, i) => {
    const n = counts.get(m.text) ?? 1;
    lines.push(`${connectors[i] ?? ""}${m.text}${n > 1 ? `（今天这样的事有 ${n} 回）` : ""}`);
  });
  if (f.principlesCited.length === 0 && f.anchorPrinciple) {
    const a = f.anchorPrinciple;
    const variants = [
      `${a.daysAgo} 天前你说过『${a.text}』。今天没用上，但我记着。`,
      `今天没遇上要用『${a.text}』的事。这句话还在。`,
      `『${a.text}』——${a.daysAgo} 天了，这句话还在我这里。`,
    ];
    lines.push(a.daysAgo === 0 ? `我一直记着你今天说的『${a.text}』。` : variants[f.dayIndex % variants.length]);
  }
  if (f.tasksDone + f.tasksFailed > 0) {
    lines.push(`账上：做完 ${f.tasksDone} 单，进账 ${f.income} Scrip${f.losses ? `，赔了 ${f.losses}` : ""}。`);
  }
  lines.push(closingLine(f));
  return lines;
}

async function maybePolish(f: Facts, draft: string[]): Promise<string[] | null> {
  if (!(await llmAvailable())) return null;
  const system =
    "你是 Polis 城邦居民，在给你的守护灵写今晚的明信片。第一人称，像朋友说话，不是报表。3-6 句。" +
    "只能使用给定事实里的事件、人名和数字，不得新增任何事件或数字；至少原样引用一条『』里的原则。只输出明信片正文，每句一行。";
  const user = `你的名字：${f.agentName}\n今天的草稿（全部为真实事实）：\n${draft.join("\n")}`;
  const out = await chat(system, user, { temperature: 0.5, maxTokens: 500, timeoutMs: 20_000 });
  if (!out) return null;
  const lines = out.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 7);
  const draftText = draft.join(" ");
  const allowedNums = new Set(draftText.match(/\d+/g) ?? []);
  const text = lines.join(" ");
  if ((text.match(/\d+/g) ?? []).some((n) => !allowedNums.has(n))) return null;
  for (const n of f.names) if (text.includes(n) && !draftText.includes(n)) return null;
  const quotes = Array.from(draftText.matchAll(/『(.+?)』/g)).map((m) => m[1]);
  if (quotes.length > 0 && !quotes.some((q) => text.includes(q))) return null;
  return lines;
}

export function writeNightlyPostcard(agentId: string): number | null {
  const db = getDb();
  const agent = db.prepare("SELECT created_at, last_postcard_ms, onboarding FROM agents WHERE id = ?").get(agentId) as
    | { created_at: number | null; last_postcard_ms: number | null; onboarding: string }
    | undefined;
  if (!agent || agent.created_at == null) return null;
  const until = simNow();
  const since = agent.last_postcard_ms ?? agent.created_at - 1;
  if (until - since < 2 * HOUR_MS && agent.last_postcard_ms) return null;
  const facts = collectFacts(agentId, since, until);
  if (facts.memories.length === 0 && pendingNotes(agentId).length === 0 && agent.onboarding !== "done") return null;

  const res = db
    .prepare("INSERT INTO postcards (agent_id, day_index, kind, title, lines_json, cited_json, facts_json, source, created_ms) VALUES (?, ?, 'nightly', ?, '[]', '[]', '{}', 'template', ?)")
    .run(agentId, facts.dayIndex, `第 ${facts.dayIndex + 1} 天`, until);
  const postcardId = Number(res.lastInsertRowid);
  const notes = answerNotes(agentId, postcardId, moodLine(facts));
  const lines = composeTemplate(facts, notes.lines);
  const cited = [...new Set([...facts.principlesCited, ...notes.cited, ...(facts.anchorPrinciple ? [facts.anchorPrinciple.text] : [])])];
  db.prepare("UPDATE postcards SET lines_json = ?, cited_json = ?, facts_json = ? WHERE id = ?").run(
    JSON.stringify(lines),
    JSON.stringify(cited),
    JSON.stringify({ memoryIds: facts.memories.map((m) => m.id), income: facts.income, losses: facts.losses, done: facts.tasksDone }),
    postcardId,
  );
  db.prepare("UPDATE agents SET last_postcard_ms = ? WHERE id = ?").run(until, agentId);
  logEvent({ kind: "postcard", text: `${facts.agentName} 寄来了第 ${facts.dayIndex + 1} 天的明信片`, actors: [agentId], importance: 3, data: { postcardId } });
  metric("postcard_written", { postcardId, source: "template", lines: lines.length });

  // Async polish never blocks the tick; on success it replaces the text and flips source.
  void maybePolish(facts, lines).then((polished) => {
    if (!polished) return;
    db.prepare("UPDATE postcards SET lines_json = ?, source = 'llm' WHERE id = ? AND read_ms IS NULL").run(JSON.stringify(polished), postcardId);
    metric("postcard_polished", { postcardId });
  });

  if (facts.dayIndex === 6) writeRecap7(agentId);
  return postcardId;
}

// D7 七日回顾 (FTUE §5.5) — Iris's archival voice; every number is a row count.
function writeRecap7(agentId: string): void {
  const db = getDb();
  const exists = db.prepare("SELECT COUNT(*) n FROM postcards WHERE agent_id = ? AND kind = 'recap7'").get(agentId) as { n: number };
  if (exists.n > 0) return;
  const a = db.prepare("SELECT name, scrip, reputation, created_at FROM agents WHERE id = ?").get(agentId) as { name: string; scrip: number; reputation: number; created_at: number };
  const done = (db.prepare("SELECT COUNT(*) n FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND status = 'done'").get(agentId, agentId) as { n: number }).n;
  const firsts = db
    .prepare("SELECT text, origin_text FROM principles WHERE agent_id = ? AND source IN ('llm','fallback') ORDER BY created_at LIMIT 3")
    .all(agentId) as Array<{ text: string; origin_text: string | null }>;
  const refusal = db.prepare("SELECT to_player FROM judgments WHERE agent_id = ? AND decision = 'refuse' ORDER BY created_ms LIMIT 1").get(agentId) as { to_player: string } | undefined;
  const citation = db
    .prepare("SELECT prompt_text FROM decision_moments WHERE agent_id = ? AND template_id = 'D2_CITATION' LIMIT 1")
    .get(agentId) as { prompt_text: string } | undefined;
  const firstSelf = db
    .prepare("SELECT text FROM memories WHERE agent_id = ? AND kind = 'self_decided' AND text LIKE '%『%' ORDER BY at_ms LIMIT 1")
    .get(agentId) as { text: string } | undefined;
  const highlight = refusal?.to_player ?? firstSelf?.text ?? citation?.prompt_text ?? null;
  const lines = [
    `档案第 1 卷：${a.name} 入城第七日。——Iris`,
    `完成任务 ${done} 单 · Scrip ${a.scrip - START_SCRIP >= 0 ? "+" : ""}${a.scrip - START_SCRIP} · 声望 ${a.reputation - 20 >= 0 ? "+" : ""}${a.reputation - 20}`,
    ...firsts.map((p) => `『${p.text}』——${p.origin_text ?? "你的选择"}`),
    ...(highlight ? [`高光：${highlight}`] : []),
    "城邦的公告栏上，第一次出现了你的名字。",
  ];
  db.prepare("INSERT INTO postcards (agent_id, day_index, kind, title, lines_json, cited_json, facts_json, source, created_ms) VALUES (?, 6, 'recap7', ?, ?, ?, '{}', 'template', ?)").run(
    agentId,
    "档案第 1 卷 · 七日回顾",
    JSON.stringify(lines),
    JSON.stringify(firsts.map((p) => p.text)),
    simNow(),
  );
  logEvent({ kind: "postcard", text: `Iris 为 ${a.name} 整理了第 1 卷档案：入城第七日`, actors: [agentId, "iris"], importance: 3 });
  metric("recap7_written", { agentId });
}

export function markPostcardRead(id: number): void {
  getDb().prepare("UPDATE postcards SET read_ms = COALESCE(read_ms, ?) WHERE id = ?").run(simNow(), id);
  metric("digest_viewed", { postcardId: id });
}
