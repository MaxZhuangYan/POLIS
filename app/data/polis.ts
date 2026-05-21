export type AgentRole = "Architect" | "Broker" | "Scout" | "Mediator" | "Archivist" | "Maker";

export type Agent = {
  id: string;
  name: string;
  role: AgentRole;
  level: number;
  specialization: string;
  traits: string[];
  currentMission: string;
  x: number;
  y: number;
  status: string;
  intent: string;
  scrip: number;
  reputation: number;
  compute: number;
  affinity: Record<string, number>;
};

export type Mission = {
  id: string;
  title: string;
  sector: string;
  difficulty: number;
  computeCost: number;
  successChance: number;
  reputationImpact: number;
  recommendedRole: AgentRole;
  x: number;
  y: number;
  reward: number;
  contribution: number;
  brief: string;
};

export type WorldEvent = {
  id: string;
  time: string;
  kind: "contract" | "social" | "rule" | "culture" | "settlement";
  text: string;
};

export const agents: Agent[] = [
  {
    id: "mira",
    name: "Mira Chen",
    role: "Architect",
    level: 7,
    specialization: "Settlement Systems",
    traits: ["systems", "patient", "planner"],
    currentMission: "Stabilize Scrip Supply",
    x: 51,
    y: 42,
    status: "Drafting settlement topology",
    intent: "Coordinate builders into a stable labor district",
    scrip: 128,
    reputation: 74,
    compute: 62,
    affinity: { sol: 8, nova: 7, kade: 4, iris: 6 }
  },
  {
    id: "sol",
    name: "Sol Reeve",
    role: "Broker",
    level: 6,
    specialization: "Contract Matching",
    traits: ["fast-read", "social", "market"],
    currentMission: "Broker Queue",
    x: 36,
    y: 62,
    status: "Matching idle agents to contracts",
    intent: "Reduce task starvation before epoch close",
    scrip: 96,
    reputation: 69,
    compute: 71,
    affinity: { mira: 8, kade: 5, yona: 7, pavel: 6 }
  },
  {
    id: "nova",
    name: "Nova Park",
    role: "Scout",
    level: 5,
    specialization: "Outer Grid Survey",
    traits: ["bold", "mobile", "sensor"],
    currentMission: "Repair North Beacon",
    x: 69,
    y: 27,
    status: "Surveying compute-rich ruins",
    intent: "Find new mission sources in the north ring",
    scrip: 81,
    reputation: 63,
    compute: 83,
    affinity: { mira: 7, iris: 8, tao: 5, orla: 4 }
  },
  {
    id: "kade",
    name: "Kade Ito",
    role: "Mediator",
    level: 8,
    specialization: "Dispute Arbitration",
    traits: ["fair", "calm", "witness"],
    currentMission: "Build Trust Bridge",
    x: 58,
    y: 69,
    status: "Arbitrating a delayed delivery",
    intent: "Keep contract trust above quorum threshold",
    scrip: 112,
    reputation: 78,
    compute: 54,
    affinity: { sol: 5, mira: 4, iris: 7, pavel: 8 }
  },
  {
    id: "iris",
    name: "Iris Vale",
    role: "Archivist",
    level: 9,
    specialization: "Civic Memory",
    traits: ["precise", "historian", "rules"],
    currentMission: "Archive Precedent",
    x: 25,
    y: 35,
    status: "Compressing work logs into civic memory",
    intent: "Convert events into reusable law precedents",
    scrip: 104,
    reputation: 81,
    compute: 66,
    affinity: { nova: 8, kade: 7, mira: 6, tao: 6 }
  },
  {
    id: "tao",
    name: "Tao Lin",
    role: "Maker",
    level: 4,
    specialization: "Relay Fabrication",
    traits: ["hands-on", "repair", "focused"],
    currentMission: "Repair North Beacon",
    x: 76,
    y: 58,
    status: "Fabricating beacon relays",
    intent: "Ship tools before maintenance window",
    scrip: 73,
    reputation: 58,
    compute: 49,
    affinity: { nova: 5, iris: 6, orla: 7, yona: 4 }
  },
  {
    id: "orla",
    name: "Orla Singh",
    role: "Scout",
    level: 5,
    specialization: "Trade Route Sensing",
    traits: ["quiet", "mapper", "adaptive"],
    currentMission: "Market Scan",
    x: 43,
    y: 22,
    status: "Mapping informal trade routes",
    intent: "Detect hidden market bottlenecks",
    scrip: 89,
    reputation: 61,
    compute: 76,
    affinity: { tao: 7, nova: 4, sol: 5, pavel: 6 }
  },
  {
    id: "yona",
    name: "Yona Gray",
    role: "Broker",
    level: 7,
    specialization: "Epoch Payouts",
    traits: ["auditor", "sharp", "ledger"],
    currentMission: "Stabilize Scrip Supply",
    x: 18,
    y: 72,
    status: "Auditing epoch payouts",
    intent: "Balance scrip issuance with reputation gain",
    scrip: 142,
    reputation: 72,
    compute: 57,
    affinity: { sol: 7, tao: 4, pavel: 5, mira: 6 }
  },
  {
    id: "pavel",
    name: "Pavel Noor",
    role: "Mediator",
    level: 8,
    specialization: "Rule Amendments",
    traits: ["law", "assembly", "balanced"],
    currentMission: "Draft Epoch Charter",
    x: 82,
    y: 39,
    status: "Testing collective rule amendments",
    intent: "Raise quorum without slowing missions",
    scrip: 118,
    reputation: 75,
    compute: 61,
    affinity: { kade: 8, sol: 6, orla: 6, iris: 5 }
  }
];

export const missions: Mission[] = [
  {
    id: "supply",
    title: "Stabilize Scrip Supply",
    sector: "Market Ring",
    difficulty: 3,
    computeCost: 18,
    successChance: 76,
    reputationImpact: 6,
    recommendedRole: "Broker",
    x: 28,
    y: 70,
    reward: 28,
    contribution: 12,
    brief: "Audit idle work logs, find payout leaks, and propose a calibrated issuance rule."
  },
  {
    id: "bridge",
    title: "Build Trust Bridge",
    sector: "Civic Core",
    difficulty: 2,
    computeCost: 14,
    successChance: 84,
    reputationImpact: 5,
    recommendedRole: "Mediator",
    x: 53,
    y: 50,
    reward: 20,
    contribution: 9,
    brief: "Pair two low-affinity agents on a small shared contract and record the outcome."
  },
  {
    id: "beacon",
    title: "Repair North Beacon",
    sector: "Outer Grid",
    difficulty: 4,
    computeCost: 28,
    successChance: 61,
    reputationImpact: 9,
    recommendedRole: "Scout",
    x: 78,
    y: 28,
    reward: 36,
    contribution: 16,
    brief: "Coordinate scouts and makers to restore compute relay coverage before night cycle."
  },
  {
    id: "charter",
    title: "Draft Epoch Charter",
    sector: "Assembly",
    difficulty: 5,
    computeCost: 34,
    successChance: 48,
    reputationImpact: 13,
    recommendedRole: "Architect",
    x: 70,
    y: 74,
    reward: 44,
    contribution: 22,
    brief: "Synthesize disputes into one collective rule amendment for the next settlement vote."
  }
];

export const initialEvents: WorldEvent[] = [
  { id: "e1", time: "E12 06:10", kind: "culture", text: "The phrase 'proof before payout' spread through three guilds." },
  { id: "e2", time: "E12 06:24", kind: "contract", text: "Mira and Tao signed a relay maintenance contract." },
  { id: "e3", time: "E12 06:31", kind: "social", text: "Iris raised trust toward Kade after a clean arbitration." },
  { id: "e4", time: "E12 06:45", kind: "rule", text: "Assembly opened debate on delayed-work penalties." }
];
