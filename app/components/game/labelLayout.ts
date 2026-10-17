// Name-tag layout in SCREEN pixels (no Phaser): residents standing close together would print their names on top of
// each other. Every tag tries to sit right above its owner's head; when that spot is taken it is lifted one step at a
// time, and when even the highest allowed step is taken the tag is hidden (the lowest priorities go first). The guardian's
// Agent, the selected and the hovered resident are "pinned": they are never hidden.
//
// Only erasable TypeScript here, so `node --experimental-strip-types` can run it for the logic checks.

export interface LabelBox {
  id: string;
  /** screen px: horizontal centre of the tag and the bottom edge of the tag at lift 0 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** lower = decided first = keeps its place */
  priority: number;
  pinned: boolean;
  /** how many lift steps the tag may use before it is hidden (0: it may only stay where it is) */
  maxLevel: number;
  /** the lift step it had in the previous frame: coming back down needs clear room, so tags do not flicker */
  level: number;
}

export interface LabelSlot {
  level: number;
  hidden: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect, margin: number): boolean => a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

export function layoutLabels(boxes: LabelBox[], step = 17, pad = 2): Map<string, LabelSlot> {
  const out = new Map<string, LabelSlot>();
  const placed: Rect[] = [];
  const order = [...boxes].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const b of order) {
    const at = (level: number): Rect => ({ x: b.x - b.w / 2, y: b.y - b.h - level * step, w: b.w, h: b.h });
    const top = b.pinned ? b.maxLevel + 3 : b.maxLevel;
    let chosen = -1;
    for (let level = 0; level <= top; level++) {
      const margin = pad + (level < b.level ? 5 : 0);
      const r = at(level);
      if (!placed.some((p) => overlaps(p, r, margin))) {
        chosen = level;
        break;
      }
    }
    if (chosen < 0) {
      if (!b.pinned) {
        out.set(b.id, { level: b.level, hidden: true });
        continue;
      }
      chosen = top; // pinned tags are always shown, on top of whatever is left
    }
    placed.push(at(chosen));
    out.set(b.id, { level: chosen, hidden: false });
  }
  return out;
}
