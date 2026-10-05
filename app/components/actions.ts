// Action contract between the game UI (GameShell) and whoever owns the data
// (the real API integrator, or the dev fixture). GameShell never fetches by
// itself: everything goes through these methods and the `busy` / `error`
// props that describe their progress.

export interface GameActions {
  createAgent(input: { name: string; sprite: string }): Promise<void>;
  choose(momentId: number, optionId: string): Promise<void>;
  resolveJudgment(id: number, action: "accept" | "force" | "adopt" | "overrule"): Promise<void>;
  feedback(id: number, value: "expected" | "surprising_reasonable" | "confusing"): Promise<void>;
  resolveWavering(id: number, resolution: "reaffirm" | "revise", revisedText?: string): Promise<void>;
  sendNote(text: string): Promise<void>;
  readPostcard(id: number): Promise<void>;
  ackOnboarding(): Promise<void>;
  advance(opts: { hours?: number; to?: "night" | "morning" }): Promise<void>; // test fast-forward only
}

export type BusyKey = "create" | "choose" | "judgment" | "wavering" | "note" | "postcard" | "advance" | null;
