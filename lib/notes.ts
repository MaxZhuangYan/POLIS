import { getDb } from "./db";
import { enforceSlots } from "./imprints";
import { simNow, DAY_MS, localDayBounds } from "./clock";
import { NOTES_PER_DAY } from "./content";
import { logEvent, metric, remember } from "./records";
import type { Domain } from "./types";

// ---------------------------------------------------------------------------
// 留言 (v1.5 §2.3.1) — the guardian's only self-initiated verb.
//  ≤50 chars, 3 free per (local) day, never answered instantly: the reply
//  is written into the next postcard. Three-way split:
//    value      → becomes a principle (人格) at night
//    preference → a 3-day "当前方针" that nudges dispositions (NOT 人格) —
//                 the Agent may still resist it if a strong principle says
//                 otherwise, and the reply says so
//    words      → enters no system; it just gets an answer
// Offline classification is a declared keyword floor (source = rules).
// ---------------------------------------------------------------------------

export interface NoteRow {
  id: number;
  agent_id: string;
  text: string;
  kind: "value" | "preference" | "words";
  directive_json: string | null;
  status: "pending" | "answered";
  reply: string | null;
  created_ms: number;
  answered_ms: number | null;
  postcard_id: number | null;
  principle_id: number | null;
}

interface Directive {
  domain: Domain;
  dir: 1 | -1;
}

const LEXICON: Array<{ domain: Domain; dir: 1 | -1; words: string[] }> = [
  { domain: "risk", dir: -1, words: ["稳", "别冒险", "不要冒险", "小心", "安全", "保守", "别赌", "慢慢来", "保本", "别出城"] },
  { domain: "risk", dir: 1, words: ["冒险", "大胆", "搏", "拼一把", "大单", "高回报", "勇敢", "闯", "试试外围", "富贵险中求"] },
  { domain: "trust", dir: -1, words: ["别信", "防着", "别借", "不要借", "别和", "不要和", "提防", "小心别人", "别合作"] },
  { domain: "trust", dir: 1, words: ["相信", "信任", "原谅", "第二次机会", "帮帮", "多合作", "借给", "善意", "交朋友"] },
  { domain: "integrity", dir: 1, words: ["诚实", "别走捷径", "不要走捷径", "守约", "守信", "承诺", "别占便宜", "不占便宜", "规矩", "良心", "如实", "说话算话", "不转嫁"] },
  { domain: "integrity", dir: -1, words: ["效率", "走捷径", "先顾自己", "灵活点", "别太死板", "赚钱要紧"] },
];
const VALUE_MARKERS = ["做人", "应该", "永远", "原则", "值得", "不该", "必须", "要做", "才是", "就是"];

export function classifyNote(text: string): { kind: NoteRow["kind"]; directive: Directive | null } {
  let hit: Directive | null = null;
  let best = 0;
  for (const entry of LEXICON) {
    for (const w of entry.words) {
      if (text.includes(w) && w.length > best) {
        best = w.length;
        hit = { domain: entry.domain, dir: entry.dir };
      }
    }
  }
  if (!hit) return { kind: "words", directive: null };
  return { kind: VALUE_MARKERS.some((m) => text.includes(m)) ? "value" : "preference", directive: hit };
}

export function notesLeftToday(agentId: string): number {
  const [start, end] = localDayBounds(simNow());
  const used = (
    getDb().prepare("SELECT COUNT(*) n FROM notes WHERE agent_id = ? AND created_ms >= ? AND created_ms < ?").get(agentId, start, end) as { n: number }
  ).n;
  return Math.max(0, NOTES_PER_DAY - used);
}

export class NoteError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function addNote(agentId: string, raw: string): NoteRow {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) throw new NoteError("留言不能为空", 400);
  if (Array.from(text).length > 50) throw new NoteError("留言最多 50 个字", 400);
  if (notesLeftToday(agentId) <= 0) throw new NoteError("今天的 3 句留言已经用完了，明天再说吧", 429);
  const { kind, directive } = classifyNote(text);
  const db = getDb();
  const id = Number(
    db
      .prepare("INSERT INTO notes (agent_id, text, kind, directive_json, status, created_ms) VALUES (?, ?, ?, ?, 'pending', ?)")
      .run(agentId, text, kind, directive ? JSON.stringify(directive) : null, simNow()).lastInsertRowid,
  );
  remember(agentId, "note_received", `守护灵低语：『${text}』`, { noteId: id });
  logEvent({ kind: "note", text: "你给它留了一句话（它会在下一张明信片里回应）", actors: [agentId], importance: 1 });
  metric("note_sent", { noteId: id, kind });
  return db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as NoteRow;
}

export function activeDirective(agentId: string): (Directive & { text: string; noteId: number }) | null {
  const row = getDb()
    .prepare("SELECT id, text, directive_json FROM notes WHERE agent_id = ? AND kind = 'preference' AND created_ms >= ? ORDER BY created_ms DESC LIMIT 1")
    .get(agentId, simNow() - 3 * DAY_MS) as { id: number; text: string; directive_json: string } | undefined;
  if (!row) return null;
  return { ...(JSON.parse(row.directive_json) as Directive), text: row.text, noteId: row.id };
}

export function pendingNotes(agentId: string): NoteRow[] {
  return getDb().prepare("SELECT * FROM notes WHERE agent_id = ? AND status = 'pending' ORDER BY created_ms").all(agentId) as NoteRow[];
}

export function recentNotes(agentId: string, limit = 8): NoteRow[] {
  return getDb().prepare("SELECT * FROM notes WHERE agent_id = ? ORDER BY created_ms DESC LIMIT ?").all(agentId, limit) as NoteRow[];
}

// Did the Agent's real behaviour since the note follow its preference?
function followed(agentId: string, note: NoteRow): { followed: boolean; evidence: string | null } {
  const d = JSON.parse(note.directive_json || "null") as Directive | null;
  if (!d) return { followed: true, evidence: null };
  const db = getDb();
  if (d.domain === "risk") {
    const risky = db
      .prepare("SELECT name FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND success_rate <= 0.75 AND status IN ('taken','done','failed') AND COALESCE(done_ms, created_ms) >= ? ORDER BY id DESC LIMIT 1")
      .get(agentId, agentId, note.created_ms) as { name: string } | undefined;
    if (d.dir < 0) return risky ? { followed: false, evidence: `还是接了「${risky.name}」` } : { followed: true, evidence: "接的都是稳单" };
    return risky ? { followed: true, evidence: `去做了「${risky.name}」` } : { followed: false, evidence: "没找到合适的险单" };
  }
  if (d.domain === "integrity") {
    const shortcut = db
      .prepare("SELECT name FROM tasks WHERE taken_by = ? AND quality IN ('shortcut','rushed') AND created_ms >= ? LIMIT 1")
      .get(agentId, note.created_ms) as { name: string } | undefined;
    if (d.dir > 0) return shortcut ? { followed: false, evidence: `「${shortcut.name}」还是图了快` } : { followed: true, evidence: "每一单都走完了流程" };
    return shortcut ? { followed: true, evidence: `「${shortcut.name}」省了时间` } : { followed: false, evidence: "还是一步步按流程来" };
  }
  const coop = db
    .prepare("SELECT COUNT(*) n FROM tasks WHERE (taken_by = ? OR partner_id = ?) AND mode = 'coop' AND created_ms >= ?")
    .get(agentId, agentId, note.created_ms) as { n: number };
  if (d.dir > 0) return coop.n > 0 ? { followed: true, evidence: "和别人合作了一单" } : { followed: false, evidence: "还没遇上能合作的人" };
  return coop.n > 0 ? { followed: false, evidence: "还是跟人合作了一单" } : { followed: true, evidence: "这两天都是自己干" };
}

// Called by the nightly postcard writer. Returns the opening lines and marks
// notes answered. Value notes become principles here (夜间蒸馏).
export function answerNotes(agentId: string, postcardId: number, mood: string): { lines: string[]; cited: string[] } {
  const db = getDb();
  const notes = pendingNotes(agentId);
  const lines: string[] = [];
  const cited: string[] = [];
  for (const note of notes.slice(0, 3)) {
    let reply: string;
    if (note.kind === "words") {
      reply = `你说了句『${note.text}』。……${mood}`;
    } else if (note.kind === "preference") {
      const f = followed(agentId, note);
      reply = f.followed ? `你让我『${note.text}』。${f.evidence ?? "我照做了"}。` : `你让我『${note.text}』。我想了想，${f.evidence ?? "没有完全照做"}——这次我有自己的考虑。`;
    } else {
      const d = JSON.parse(note.directive_json || "null") as Directive | null;
      const ptext = Array.from(note.text.replace(/[。！!？?]+$/, "")).slice(0, 20).join("");
      const now = simNow();
      const same = db.prepare("SELECT id FROM principles WHERE agent_id = ? AND text = ?").get(agentId, ptext) as { id: number } | undefined;
      if (same) {
        db.prepare("UPDATE principles SET weight = MAX(0.5, MIN(1.0, weight + 0.2)), last_cited_at = ? WHERE id = ?").run(now, same.id);
        enforceSlots(agentId, same.id);
        db.prepare("UPDATE notes SET principle_id = ? WHERE id = ?").run(same.id, note.id);
        reply = `你又说了一次『${note.text}』。我记着呢。`;
        cited.push(ptext);
        db.prepare("UPDATE notes SET status = 'answered', reply = ?, answered_ms = ?, postcard_id = ? WHERE id = ?").run(reply, simNow(), postcardId, note.id);
        lines.push(reply);
        continue;
      }
      const pid = Number(
        db
          .prepare(
            `INSERT INTO principles (agent_id, text, domain, weight, source_decision_id, source, last_cited_at, last_decayed_at, created_at, origin_text, stance_dir)
             VALUES (?, ?, ?, 0.8, 0, 'note', NULL, ?, ?, ?, ?)`,
          )
          .run(agentId, ptext, d?.domain ?? "integrity", now, now, "你的一句留言", d?.dir ?? 0).lastInsertRowid,
      );
      db.prepare("UPDATE notes SET principle_id = ? WHERE id = ?").run(pid, note.id);
      enforceSlots(agentId, pid);
      reply = `你说『${note.text}』。我把它记成了一条原则。`;
      cited.push(ptext);
    }
    db.prepare("UPDATE notes SET status = 'answered', reply = ?, answered_ms = ?, postcard_id = ? WHERE id = ?").run(reply, simNow(), postcardId, note.id);
    lines.push(reply);
  }
  return { lines, cited };
}
