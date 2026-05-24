export type AgentRole = "Architect" | "Broker" | "Scout" | "Mediator" | "Archivist" | "Maker";

export type MBTI =
  | "INTJ" | "INTP" | "ENTJ" | "ENTP"
  | "INFJ" | "INFP" | "ENFJ" | "ENFP"
  | "ISTJ" | "ISFJ" | "ESTJ" | "ESFJ"
  | "ISTP" | "ISFP" | "ESTP" | "ESFP";

export const mbtiDescriptions: Record<MBTI, { label: string; traits: string[]; bestRole: AgentRole; group: string }> = {
  INTJ: { label: "Architect",     traits: ["strategic", "independent", "decisive"],   bestRole: "Architect", group: "Analysts"  },
  INTP: { label: "Logician",      traits: ["analytical", "curious", "reserved"],      bestRole: "Archivist", group: "Analysts"  },
  ENTJ: { label: "Commander",     traits: ["bold", "assertive", "efficient"],         bestRole: "Architect", group: "Analysts"  },
  ENTP: { label: "Debater",       traits: ["inventive", "quick", "knowledgeable"],    bestRole: "Broker",    group: "Analysts"  },
  INFJ: { label: "Advocate",      traits: ["insightful", "principled", "empathetic"], bestRole: "Mediator",  group: "Diplomats" },
  INFP: { label: "Mediator",      traits: ["idealistic", "empathetic", "creative"],   bestRole: "Mediator",  group: "Diplomats" },
  ENFJ: { label: "Protagonist",   traits: ["charismatic", "empathetic", "organized"], bestRole: "Mediator",  group: "Diplomats" },
  ENFP: { label: "Campaigner",    traits: ["enthusiastic", "creative", "sociable"],   bestRole: "Broker",    group: "Diplomats" },
  ISTJ: { label: "Logistician",   traits: ["reliable", "thorough", "organized"],      bestRole: "Archivist", group: "Sentinels" },
  ISFJ: { label: "Defender",      traits: ["warm", "loyal", "meticulous"],            bestRole: "Maker",     group: "Sentinels" },
  ESTJ: { label: "Executive",     traits: ["organized", "efficient", "assertive"],    bestRole: "Architect", group: "Sentinels" },
  ESFJ: { label: "Consul",        traits: ["caring", "social", "loyal"],              bestRole: "Broker",    group: "Sentinels" },
  ISTP: { label: "Virtuoso",      traits: ["practical", "observant", "independent"],  bestRole: "Maker",     group: "Explorers" },
  ISFP: { label: "Adventurer",    traits: ["artistic", "flexible", "charming"],       bestRole: "Scout",     group: "Explorers" },
  ESTP: { label: "Entrepreneur",  traits: ["energetic", "perceptive", "direct"],      bestRole: "Broker",    group: "Explorers" },
  ESFP: { label: "Entertainer",   traits: ["spontaneous", "energetic", "playful"],    bestRole: "Scout",     group: "Explorers" },
};

export const mbtiGroups: { label: string; types: MBTI[] }[] = [
  { label: "Analysts",  types: ["INTJ", "INTP", "ENTJ", "ENTP"] },
  { label: "Diplomats", types: ["INFJ", "INFP", "ENFJ", "ENFP"] },
  { label: "Sentinels", types: ["ISTJ", "ISFJ", "ESTJ", "ESFJ"] },
  { label: "Explorers", types: ["ISTP", "ISFP", "ESTP", "ESFP"] },
];

export type Agent = {
  id: string;
  name: string;
  role: AgentRole;
  mbti: MBTI;
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
  isPlayer?: boolean;
  thoughts?: string;
  dailyPlan?: string;
  dailyPlanDay?: number;
  planFocus?: "work" | "trade" | "study" | "social" | "rest" | "build";
};

export type DialogueLine = { speaker: string; text: string };

export type Conversation = {
  id: string;
  time: string;
  agentIds: [string, string];
  lines: DialogueLine[];
  location: string;
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
  progress: number;
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
    mbti: "INTJ",
    level: 7,
    specialization: "Settlement Systems",
    traits: ["systems", "patient", "planner"],
    currentMission: "Stabilize Scrip Supply",
    x: 51, y: 42,
    status: "Drafting settlement topology",
    intent: "Coordinate builders into a stable labor district",
    scrip: 128, reputation: 74, compute: 62,
    affinity: { sol: 8, nova: 7, kade: 4, iris: 6 },
    thoughts: "The scrip issuance curve needs recalibration before the next epoch close."
  },
  {
    id: "sol",
    name: "Sol Reeve",
    role: "Broker",
    mbti: "ESTP",
    level: 6,
    specialization: "Contract Matching",
    traits: ["fast-read", "social", "market"],
    currentMission: "Broker Queue",
    x: 36, y: 62,
    status: "Matching idle agents to contracts",
    intent: "Reduce task starvation before epoch close",
    scrip: 96, reputation: 69, compute: 71,
    affinity: { mira: 8, kade: 5, yona: 7, pavel: 6 },
    thoughts: "Three idle Makers need contracts. I see an opening in the fabrication queue."
  },
  {
    id: "nova",
    name: "Nova Park",
    role: "Scout",
    mbti: "ESFP",
    level: 5,
    specialization: "Outer Grid Survey",
    traits: ["bold", "mobile", "sensor"],
    currentMission: "Repair North Beacon",
    x: 69, y: 27,
    status: "Surveying compute-rich ruins",
    intent: "Find new mission sources in the north ring",
    scrip: 81, reputation: 63, compute: 83,
    affinity: { mira: 7, iris: 8, tao: 5, orla: 4 },
    thoughts: "The north ruins have more compute nodes than the map shows. Need to report back."
  },
  {
    id: "kade",
    name: "Kade Ito",
    role: "Mediator",
    mbti: "INFJ",
    level: 8,
    specialization: "Dispute Arbitration",
    traits: ["fair", "calm", "witness"],
    currentMission: "Build Trust Bridge",
    x: 58, y: 69,
    status: "Arbitrating a delayed delivery",
    intent: "Keep contract trust above quorum threshold",
    scrip: 112, reputation: 78, compute: 54,
    affinity: { sol: 5, mira: 4, iris: 7, pavel: 8 },
    thoughts: "The delivery dispute between Tao and Orla can be resolved with a partial escrow."
  },
  {
    id: "iris",
    name: "Iris Vale",
    role: "Archivist",
    mbti: "ISTJ",
    level: 9,
    specialization: "Civic Memory",
    traits: ["precise", "historian", "rules"],
    currentMission: "Archive Precedent",
    x: 25, y: 35,
    status: "Compressing work logs into civic memory",
    intent: "Convert events into reusable law precedents",
    scrip: 104, reputation: 81, compute: 66,
    affinity: { nova: 8, kade: 7, mira: 6, tao: 6 },
    thoughts: "147 contracts this epoch. The trust graph is consolidating around three clusters."
  },
  {
    id: "tao",
    name: "Tao Lin",
    role: "Maker",
    mbti: "ISTP",
    level: 4,
    specialization: "Relay Fabrication",
    traits: ["hands-on", "repair", "focused"],
    currentMission: "Repair North Beacon",
    x: 76, y: 58,
    status: "Fabricating beacon relays",
    intent: "Ship tools before maintenance window",
    scrip: 73, reputation: 58, compute: 49,
    affinity: { nova: 5, iris: 6, orla: 7, yona: 4 },
    thoughts: "If I finish two more relay casings today, the beacon can be live before nightfall."
  },
  {
    id: "orla",
    name: "Orla Singh",
    role: "Scout",
    mbti: "ISFP",
    level: 5,
    specialization: "Trade Route Sensing",
    traits: ["quiet", "mapper", "adaptive"],
    currentMission: "Market Scan",
    x: 43, y: 22,
    status: "Mapping informal trade routes",
    intent: "Detect hidden market bottlenecks",
    scrip: 89, reputation: 61, compute: 76,
    affinity: { tao: 7, nova: 4, sol: 5, pavel: 6 },
    thoughts: "The western corridor has an undocumented food cache. That could be leverage."
  },
  {
    id: "yona",
    name: "Yona Gray",
    role: "Broker",
    mbti: "ESFJ",
    level: 7,
    specialization: "Epoch Payouts",
    traits: ["auditor", "sharp", "ledger"],
    currentMission: "Stabilize Scrip Supply",
    x: 18, y: 72,
    status: "Auditing epoch payouts",
    intent: "Balance scrip issuance with reputation gain",
    scrip: 142, reputation: 72, compute: 57,
    affinity: { sol: 7, tao: 4, pavel: 5, mira: 6 },
    thoughts: "Scrip inflation is at 4.2%. Need to flag this before settlement vote."
  },
  {
    id: "pavel",
    name: "Pavel Noor",
    role: "Mediator",
    mbti: "ENFJ",
    level: 8,
    specialization: "Rule Amendments",
    traits: ["law", "assembly", "balanced"],
    currentMission: "Draft Epoch Charter",
    x: 82, y: 39,
    status: "Testing collective rule amendments",
    intent: "Raise quorum without slowing missions",
    scrip: 118, reputation: 75, compute: 61,
    affinity: { kade: 8, sol: 6, orla: 6, iris: 5 },
    thoughts: "If the charter passes, all future disputes go to arbitration first. That's progress."
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
    x: 28, y: 70,
    reward: 28,
    progress: 0,
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
    x: 53, y: 50,
    reward: 20,
    progress: 0,
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
    x: 78, y: 28,
    reward: 36,
    progress: 0,
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
    x: 70, y: 74,
    reward: 44,
    progress: 0,
    contribution: 22,
    brief: "Synthesize disputes into one collective rule amendment for the next settlement vote."
  }
];

export const initialEvents: WorldEvent[] = [
  { id: "e1", time: "E12 06:10", kind: "culture",  text: "The phrase 'proof before payout' spread through three guilds." },
  { id: "e2", time: "E12 06:24", kind: "contract", text: "Mira and Tao signed a relay maintenance contract." },
  { id: "e3", time: "E12 06:31", kind: "social",   text: "Iris raised trust toward Kade after a clean arbitration." },
  { id: "e4", time: "E12 06:45", kind: "rule",     text: "Assembly opened debate on delayed-work penalties." }
];
