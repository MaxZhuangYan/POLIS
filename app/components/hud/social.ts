// The town's social web as the resident inspector shows it ("城里的关系"): who a resident knows best, and the grudges
// they hold or that are held against them. Pure data shaping over GameSnapshot.townRelations (no React).

import type { AgentView, TownRelationView } from "@/lib/types";

export interface TownTie {
  id: string;
  name: string;
  sprite: string;
  familiarity: number;
  coopDone: number;
}

export interface TownGrudge {
  id: string;
  name: string;
  text: string;
}

export interface TownSocial {
  /** top 3 by familiarity, from this resident's point of view */
  top: TownTie[];
  /** grudges this resident holds ("记着 Nova：…") */
  held: TownGrudge[];
  /** grudges others hold against this resident ("被 Kade 记着：…") */
  against: TownGrudge[];
}

export function townSocialFor(id: string, relations: TownRelationView[] | undefined, byId: Map<string, AgentView>): TownSocial {
  const out: TownSocial = { top: [], held: [], against: [] };
  if (!relations || relations.length === 0) return out;
  for (const r of relations) {
    if (r.from === id) {
      const other = byId.get(r.to);
      if (!other) continue;
      if (r.familiarity > 0 || r.coopDone > 0) out.top.push({ id: other.id, name: other.name, sprite: other.sprite, familiarity: r.familiarity, coopDone: r.coopDone });
      if (r.grudge) out.held.push({ id: other.id, name: other.name, text: r.grudge });
    } else if (r.to === id && r.grudge) {
      const other = byId.get(r.from);
      if (other) out.against.push({ id: other.id, name: other.name, text: r.grudge });
    }
  }
  out.top.sort((a, b) => b.familiarity - a.familiarity || b.coopDone - a.coopDone || a.name.localeCompare(b.name));
  out.top = out.top.slice(0, 3);
  out.held = out.held.slice(0, 2);
  out.against = out.against.slice(0, 2);
  return out;
}
