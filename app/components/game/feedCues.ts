// "Results on the map": which short floating cue goes above which resident when a new town-feed item arrives.
//
// Everything here is read OUT of the real feed item (its kind, its text and the order of its actors); a number appears
// on screen only if the same number is in the item's text, and an item the rules below do not recognise produces no cue
// at all. Nothing is ever made up. Importance 1 items (routine jobs, gossip) never get a cue.
//
// Actor order is the server's convention: for 违约 / 拒绝 / 借出 / 还款 / 补偿 the first actor is the one who did it, the second
// the one it was done to.
//
// No Phaser import, only erasable TypeScript (so `node --experimental-strip-types` can run the logic checks).

export type CueIcon = "coin" | "check" | "cross" | "heart" | "crack" | "star" | "alert" | "link" | "none";
export type CueTone = "gold" | "green" | "red" | "teal" | "orange" | "pink" | "blue";

export interface Cue {
  /** agent id the cue floats above */
  actor: string;
  /** short Chinese label (may be empty: the icon alone) */
  text: string;
  icon: CueIcon;
  tone: CueTone;
  /** shown first when a burst has to be thinned out (higher wins) */
  weight: number;
}

export interface CueSource {
  kind: string;
  text: string;
  actors: string[];
  importance: number;
}

/** feed kinds that may produce a cue */
export const CUE_KINDS = new Set(["task", "coop", "default", "refuse", "risk", "relationship", "judgment", "trust"]);

const num = (m: RegExpMatchArray | null, i = 1): number | null => (m && m[i] !== undefined ? Number(m[i]) : null);
const SIGNED = /([+\-−﹣＋])\s*(\d+)/;

function signed(text: string, after: RegExp): number | null {
  const at = text.search(after);
  if (at < 0) return null;
  const m = text.slice(at).match(SIGNED);
  if (!m) return null;
  const v = Number(m[2]);
  return /[-−﹣]/.test(m[1]) ? -v : v;
}

export function cuesForFeedItem(item: CueSource): Cue[] {
  if (item.importance < 2 || !CUE_KINDS.has(item.kind) || item.actors.length === 0) return [];
  const t = item.text;
  const A = item.actors;
  const all = (c: Omit<Cue, "actor">, who: string[] = A): Cue[] => who.map((actor) => ({ actor, ...c }));
  const coin = (actor: string, delta: number): Cue => ({ actor, text: `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}`, icon: "coin", tone: delta >= 0 ? "gold" : "red", weight: 3 });
  const failed = /失败了/.test(t);

  switch (item.kind) {
    case "task":
    case "risk":
    case "coop": {
      if (failed) {
        const loss = num(t.match(/损失\s*(\d+)\s*Scrip/));
        return all({ text: loss ? `−${loss}` : "失败", icon: "cross", tone: "red", weight: 3 });
      }
      if (item.kind === "coop" && /完成了/.test(t)) return all({ text: "合作成了", icon: "check", tone: "green", weight: 3 });
      if (item.kind === "coop" && /开始一起做|答应|谈妥|约好|提议合作/.test(t)) return all({ text: "合作", icon: "link", tone: "teal", weight: 2 });
      if (item.kind === "coop") return all({ text: "合作", icon: "link", tone: "teal", weight: 2 });
      if (/完成了|做完|成了|找回|赚了|分到/.test(t)) {
        const gain = num(t.match(/[（(]\+(\d+)[）)]/)) ?? num(t.match(/(?:赚了|分到)\s*(\d+)\s*Scrip/));
        if (gain) return [coin(A[0], gain), ...A.slice(1).map((actor): Cue => ({ actor, text: "", icon: "check", tone: "green", weight: 2 }))];
        return all({ text: "完成", icon: "check", tone: "green", weight: 2 });
      }
      if (item.kind === "risk") return all({ text: "", icon: "alert", tone: "orange", weight: 2 }, [A[0]]);
      return [];
    }
    case "default": {
      const out: Cue[] = [{ actor: A[0], text: "违约", icon: "cross", tone: "red", weight: 4 }];
      if (A[1]) out.push({ actor: A[1], text: "", icon: "crack", tone: "pink", weight: 3 });
      return out;
    }
    case "refuse": {
      return [{ actor: A[0], text: "拒绝", icon: "cross", tone: "orange", weight: 3 }];
    }
    case "judgment": {
      if (/说了不/.test(t)) return all({ text: "说不", icon: "cross", tone: "orange", weight: 4 }, [A[0]]);
      if (/提出了调整/.test(t)) return all({ text: "调整", icon: "link", tone: "blue", weight: 3 }, [A[0]]);
      return [];
    }
    case "trust": {
      const d = signed(t, /信任/);
      if (d !== null && d !== 0) return all({ text: `信任 ${d > 0 ? "+" : "−"}${Math.abs(d)}`, icon: d > 0 ? "heart" : "crack", tone: d > 0 ? "green" : "red", weight: 3 }, [A[0]]);
      if (/尊重了/.test(t)) return all({ text: "尊重", icon: "heart", tone: "green", weight: 2 }, [A[0]]);
      if (/采纳了/.test(t)) return all({ text: "采纳", icon: "heart", tone: "green", weight: 2 }, [A[0]]);
      return [];
    }
    case "relationship": {
      let m = t.match(/借给\s*\S+\s*(\d+)\s*Scrip/);
      if (m && A.length >= 2) return [coin(A[0], -Number(m[1])), coin(A[1], Number(m[1]))];
      m = t.match(/按时还给\s*\S+\s*(\d+)\s*Scrip/);
      if (m && A.length >= 2) return [coin(A[0], -Number(m[1])), coin(A[1], Number(m[1]))];
      m = t.match(/补偿\s*\S+\s*(\d+)\s*Scrip/);
      if (m && A.length >= 2) return [coin(A[0], -Number(m[1])), coin(A[1], Number(m[1]))];
      if (/向\s*\S+\s*道歉/.test(t)) {
        if (/原谅/.test(t)) return all({ text: "", icon: "heart", tone: "pink", weight: 3 }, A.slice(0, 2));
        if (/还记着/.test(t)) return all({ text: "", icon: "crack", tone: "pink", weight: 3 }, A.slice(0, 2));
        return [];
      }
      if (/查明运送失败|终检查出问题|记下了这一笔/.test(t)) return all({ text: "", icon: "crack", tone: "pink", weight: 3 });
      m = t.match(/现在是「([^」]{1,8})」/);
      if (m) return [{ actor: A[0], text: m[1], icon: "star", tone: "gold", weight: 4 }];
      m = t.match(/熟悉度\s*\+(\d+)/);
      if (m) return all({ text: `+${m[1]}`, icon: "heart", tone: "pink", weight: 2 }, A.slice(0, 2));
      if (/作保|调解了|和解/.test(t)) return all({ text: "", icon: "heart", tone: "pink", weight: 2 }, A.slice(0, 2));
      return [];
    }
    default:
      return [];
  }
}

/** Thin out a burst (a fast-forward can bring dozens of feed items at once): keep every cue of the guardian's own
 *  Agent, then the heaviest, at most `limit` in total. The input order (oldest first) breaks ties, newest wins. */
export function thinCues(cues: Cue[], limit: number, playerId: string | null): Cue[] {
  if (cues.length <= limit) return cues;
  const rank = (c: Cue, i: number) => (c.actor === playerId ? 100 : 0) + c.weight * 10 + i / 1000;
  return cues
    .map((c, i) => ({ c, r: rank(c, i), i }))
    .sort((a, b) => b.r - a.r)
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.c);
}
