// ---------------------------------------------------------------------------
// Consequences as data.
//
// A fork option, a job outcome or a delayed follow-up can carry a list of
// Steps; runSteps() turns them into real rows (relationships, ledger, grudges,
// memories, feed events, new jobs, scheduled follow-ups). Nothing here writes
// narrative that the DB does not also hold: a memory or event step is always
// paired, in the content that uses it, with the state change it describes.
//
//   "$agent" in any `who` field = the guardian's Agent the steps run for;
//   "{agent}" in any text       = that Agent's name; "{who}" = the step's subject.
//
// Hooks that run steps:
//   Effect { kind: "steps" }               lib/decisionMoments.ts applyEffect
//   TaskMeta.onSuccess / onFail / onDefault lib/tasks.ts resolveTask / defaultOnCoop
//   { do: "later" }                         scheduled table, kind "steps"
// Adding content = writing Steps (see lib/dilemmas.ts); no new engine code.
// ---------------------------------------------------------------------------

import { getDb } from "./db";
import { simNow, HOUR_MS, DAY_MS } from "./clock";
import { TEMPLATE_BY_ID } from "./content";
import { adjustRelationship, adjustReputation, agentName, changeTrust, logEvent, metric, pay, recordIncident, remember, say } from "./records";
import { createTask, scheduleEvent, applyQuality, type TaskMeta } from "./tasks";
import type { Emote } from "./types";

export type Who = string; // an agent id, or "$agent"
type EventKind = Parameters<typeof logEvent>[0]["kind"];

export type Step =
  | { do: "rel"; from: Who; to: Who; delta: number; why?: string | null; coop?: number }
  | { do: "rep"; who: Who; delta: number }
  | { do: "transfer"; from: Who; to: Who; amount: number; reason: string; note?: string }
  | { do: "incident"; holder: Who; offender: Who; kind: string; text: string }
  | { do: "resolve_incidents"; holder: Who; offender: Who }
  | { do: "memory"; who: Who; kind: string; text: string }
  | { do: "say"; who: Who; text: string; emote?: Emote | null }
  | { do: "event"; kind: EventKind; text: string; actors: Who[]; importance?: 1 | 2 | 3 }
  | {
      do: "task";
      template: string;
      takenBy: Who;
      partner?: Who;
      name?: string;
      reward?: number;
      duration?: number;
      successRate?: number;
      meta?: TaskMeta;
    }
  | { do: "quality"; taskId: number; who: Who; quality: "normal" | "shortcut" | "rushed" }
  | { do: "debt"; creditor: Who; debtor: Who; amount: number; hours?: number }
  | { do: "trust"; delta: number; why: string }
  | { do: "later"; hours: number; steps: Step[] }
  | { do: "chance"; p: number; then: Step[]; else?: Step[] };

function resolveWho(who: Who, agentId: string): string {
  return who === "$agent" ? agentId : who;
}

function fill(text: string, agentId: string, subject?: string): string {
  return text.replaceAll("{agent}", agentName(agentId)).replaceAll("{who}", subject ? agentName(subject) : "");
}

function scripOf(id: string): number {
  return (getDb().prepare("SELECT scrip FROM agents WHERE id = ?").get(id) as { scrip: number } | undefined)?.scrip ?? 0;
}

/** Run the steps for `agentId`. Returns the ids of any jobs created (so callers can queue or cite them). */
export function runSteps(agentId: string, steps: Step[] | undefined, depth = 0): number[] {
  if (!steps || steps.length === 0 || depth > 4) return [];
  const created: number[] = [];
  for (const s of steps) {
    try {
      created.push(...runStep(agentId, s, depth));
    } catch (err) {
      console.error("[consequences] step failed", s.do, err);
    }
  }
  return created;
}

function runStep(agentId: string, s: Step, depth: number): number[] {
  const W = (w: Who) => resolveWho(w, agentId);
  switch (s.do) {
    case "rel":
      adjustRelationship(W(s.from), W(s.to), s.delta, s.why ? fill(s.why, agentId) : null, s.coop ?? 0);
      return [];
    case "rep":
      adjustReputation(W(s.who), s.delta);
      return [];
    case "transfer": {
      // money moves, it is never minted: the payer can only give what it has
      const from = W(s.from);
      const to = W(s.to);
      const amount = Math.min(s.amount, scripOf(from));
      if (amount <= 0) return [];
      pay(from, -amount, s.reason);
      pay(to, amount, s.reason);
      if (s.note) logEvent({ kind: "relationship", text: fill(s.note, agentId).replaceAll("{amount}", String(amount)), actors: [from, to], importance: 2 });
      return [];
    }
    case "incident":
      recordIncident(W(s.holder), W(s.offender), s.kind, fill(s.text, agentId));
      return [];
    case "resolve_incidents":
      getDb().prepare("UPDATE incidents SET resolved = 1 WHERE holder_id = ? AND offender_id = ?").run(W(s.holder), W(s.offender));
      return [];
    case "memory":
      remember(W(s.who), s.kind, fill(s.text, agentId, W(s.who)), {});
      return [];
    case "say":
      say(W(s.who), fill(s.text, agentId), s.emote ?? null);
      return [];
    case "event":
      logEvent({ kind: s.kind, text: fill(s.text, agentId), actors: s.actors.map(W), importance: s.importance ?? 2 });
      return [];
    case "task": {
      const tpl = TEMPLATE_BY_ID[s.template];
      if (!tpl) return [];
      const id = createTask(tpl, {
        status: "reserved",
        taken_by: W(s.takenBy),
        partner_id: s.partner ? W(s.partner) : null,
        mode: s.partner ? "coop" : tpl.mode,
        name: s.name,
        reward: s.reward,
        duration: s.duration,
        success_rate: s.successRate,
        source: "steps",
        meta: { ...(s.meta ?? {}), stepsAgent: agentId },
      });
      // both members queue it; the sim starts it when they are free
      enqueue(W(s.takenBy), id);
      if (s.partner) enqueue(W(s.partner), id);
      return [id];
    }
    case "quality":
      applyQuality(s.taskId, W(s.who), s.quality);
      return [];
    case "debt":
      // the existing loan machinery: due date, repayment or a grudge
      scheduleEvent(simNow() + (s.hours ?? 48) * HOUR_MS, "loan_due", { lender: W(s.creditor), borrower: W(s.debtor), amount: s.amount });
      return [];
    case "trust":
      changeTrust(agentId, s.delta, s.why);
      return [];
    case "later":
      scheduleEvent(simNow() + Math.max(0.25, s.hours) * HOUR_MS, "steps", { agentId, steps: s.steps });
      return [];
    case "chance": {
      const hit = Math.random() < Math.max(0, Math.min(1, s.p));
      metric("steps_chance", { p: s.p, hit });
      return runSteps(agentId, hit ? s.then : s.else, depth + 1);
    }
  }
}

function enqueue(agentId: string, taskId: number): void {
  const db = getDb();
  const row = db.prepare("SELECT plan_json FROM agents WHERE id = ?").get(agentId) as { plan_json: string } | undefined;
  if (!row) return;
  const plan = JSON.parse(row.plan_json || "{}") as { queue?: Array<{ taskId: number }> };
  plan.queue = [...(plan.queue ?? []), { taskId }];
  db.prepare("UPDATE agents SET plan_json = ? WHERE id = ?").run(JSON.stringify(plan), agentId);
}

/** a job's outcome hook: TaskMeta.onSuccess / onFail / onDefault */
export function runTaskHook(meta: TaskMeta, which: "onSuccess" | "onFail" | "onDefault", fallbackAgent: string): void {
  const steps = meta[which];
  if (!steps || steps.length === 0) return;
  runSteps(meta.stepsAgent ?? fallbackAgent, steps);
}

export const WEEK_MS = 7 * DAY_MS;
