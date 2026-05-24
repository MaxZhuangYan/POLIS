import type { Agent, Mission, WorldEvent, DialogueLine } from "@/app/data/polis";

export type SimulationResult = {
  workLog: string[];
  event: WorldEvent;
  delta: {
    scrip: number;
    reputation: number;
    compute: number;
    contribution: number;
  };
  source?: "mock" | "lmstudio";
};

export type DialogueResult = {
  lines: DialogueLine[];
  affinityDelta: number;
  source?: "mock" | "lmstudio";
};

export type ChatResult = {
  reply: string;
  action: string;
  source?: "mock" | "lmstudio";
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

const dialogueTemplates: Array<(a: Agent, b: Agent, loc: string) => DialogueLine[]> = [
  (a, b) => [
    { speaker: a.name, text: `Any new contracts in ${a.role} queue lately?` },
    { speaker: b.name, text: `A few. The ${b.currentMission} has been keeping me busy.` },
  ],
  (a, b) => [
    { speaker: a.name, text: `Reputation's been volatile this epoch. You feel it?` },
    { speaker: b.name, text: `Yeah. I'm staying cautious until settlement.` },
  ],
  (a, b, loc) => [
    { speaker: a.name, text: `Didn't expect to see you here in ${loc}.` },
    { speaker: b.name, text: `Following a lead. The compute prices shifted again.` },
  ],
  (a, b) => [
    { speaker: a.name, text: `Heard the Assembly's debating the new payout rule.` },
    { speaker: b.name, text: `About time. The current one's been leaking scrip for weeks.` },
  ],
  (a, b) => [
    { speaker: a.name, text: `Your affinity score with the Broker guild is impressive.` },
    { speaker: b.name, text: `Takes patience. Most of it is just showing up consistently.` },
  ],
  (a, b) => [
    { speaker: a.name, text: `${b.role} work looks busy today.` },
    { speaker: b.name, text: `${b.status}. No rest until the epoch closes.` },
  ],
  (a, b) => [
    { speaker: a.name, text: `I trust your read on this more than the ledger's.` },
    { speaker: b.name, text: `Careful — the ledger doesn't lie, agents just interpret it differently.` },
  ],
  (a, b) => [
    { speaker: a.name, text: `Can I get a witness stamp on my work fragment?` },
    { speaker: b.name, text: `Send it over. I'll review before the next cycle.` },
  ],
];

export function fallbackDialogue(agentA: Agent, agentB: Agent, location: string): DialogueResult {
  const template = dialogueTemplates[Math.floor(Math.random() * dialogueTemplates.length)];
  const lines = template(agentA, agentB, location);
  return {
    lines,
    affinityDelta: Math.random() > 0.3 ? 1 : 0,
  };
}

const chatReplies: Record<Agent["role"], Array<(msg: string, agent: Agent) => string>> = {
  Architect: [
    (msg) => `Understood. I'll adjust my design plans to prioritize: ${msg.slice(0, 30)}...`,
    (_, a) => `My current topology puts me near ${a.currentMission}. I'll factor in your guidance.`,
    (msg) => `I'll model that into the settlement plan. Estimated impact: moderate.`,
  ],
  Broker: [
    (msg) => `Got it. I'll pitch that angle to the contract queue: ${msg.slice(0, 25)}...`,
    (_, a) => `The market's receptive right now. I'll use this while ${a.status}.`,
    (msg) => `Sharp thinking. I'll negotiate around that. Expect results by epoch close.`,
  ],
  Scout: [
    (msg) => `On it. Heading out to check: ${msg.slice(0, 30)}...`,
    (_, a) => `I'm already in the field — ${a.status}. I'll keep this in mind.`,
    (msg) => `Noted. I'll add that to my route intel and report back.`,
  ],
  Mediator: [
    (msg) => `I'll work that into the arbitration: ${msg.slice(0, 30)}...`,
    (_, a) => `Both sides need to hear this. I'll bring it to the next session.`,
    (msg) => `Good framing. It shifts the balance toward resolution rather than blame.`,
  ],
  Archivist: [
    (msg) => `I'll cross-reference that against the civic log: ${msg.slice(0, 25)}...`,
    (_, a) => `The precedent record supports your direction. I'll annotate it.`,
    (msg) => `Documented. If this creates a new norm, I'll make sure it's indexed.`,
  ],
  Maker: [
    (msg) => `I'll build around that constraint: ${msg.slice(0, 30)}...`,
    (_, a) => `Currently ${a.status}, but I can pivot if the specs change.`,
    (msg) => `Makes sense from a fabrication standpoint. I'll adjust the relay config.`,
  ],
};

export function fallbackChatReply(agent: Agent, playerMessage: string): ChatResult {
  const roleReplies = chatReplies[agent.role] ?? chatReplies.Architect;
  const replyFn = roleReplies[Math.floor(Math.random() * roleReplies.length)];
  return {
    reply: replyFn(playerMessage, agent),
    action: "acknowledged",
  };
}
