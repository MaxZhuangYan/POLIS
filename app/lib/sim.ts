import type { Agent, Mission, WorldEvent } from "@/app/data/polis";

export type SimulationResult = {
  workLog: string[];
  event: WorldEvent;
  delta: {
    scrip: number;
    reputation: number;
    compute: number;
    contribution: number;
  };
};

export function fallbackSimulation(agent: Agent, mission: Mission, epoch: number): SimulationResult {
  const partnerIds = Object.entries(agent.affinity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => id.toUpperCase());
  const computeCost = Math.max(4, mission.difficulty * 5 - Math.floor(agent.compute / 20));
  const repGain = Math.max(2, Math.round(mission.contribution / 3));
  const scripGain = mission.reward;

  return {
    workLog: [
      `[epoch ${epoch}] ${agent.name} accepted ${mission.title} in ${mission.sector}.`,
      `[planner] Role ${agent.role} decomposed mission into survey, contract, execution, and audit steps.`,
      `[social] Consulted ${partnerIds.join(" + ")} to reduce coordination risk and raise witness coverage.`,
      `[contract] Locked mock agreement: reward ${mission.reward} scrip, contribution ${mission.contribution}, difficulty ${mission.difficulty}.`,
      `[execution] Spent ${computeCost} compute credit and produced a verifiable work fragment.`,
      `[memory] Archived result into civic log; reputation delta +${repGain}, scrip delta +${scripGain}.`
    ],
    event: {
      id: `event-${Date.now()}`,
      time: `E${epoch} ${new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}`,
      kind: "contract",
      text: `${agent.name} completed '${mission.title}' and added ${mission.contribution} contribution to the epoch ledger.`
    },
    delta: {
      scrip: scripGain,
      reputation: repGain,
      compute: -computeCost,
      contribution: mission.contribution
    }
  };
}
