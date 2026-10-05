// Story-beat fixtures: drive a running TEST-MODE server through the game's own HTTP API until the save sits at a
// known beat. Used by scripts/scenario.mjs (build a save to open by hand) and scripts/playtest/sizes.mjs (a save to
// screenshot). It plays like a guardian would (the same API the UI calls), so nothing here can produce a state the
// game itself could not reach: no SQL writes, no faked rows.
//
//   fresh       an empty save (NPCs seeded, no player)
//   d1-forks    player created, the three first forks (岔路) waiting for an answer
//   d2-morning  the forks answered, "看它出发" pressed, day 2 07:00; the night-1 postcard is unread
//   d5-bait     day 5 ~10:00+: the D5 bait fork pending, if the game produces one (the report says what happened)
//   week2       a careful guardian's whole first week, day 8 07:00 (all but the latest postcard marked read)
//
// The policy is the one scripts/sim-playthrough.mjs uses: "careful" = stable accumulation / procedure / wary trust,
// "bold" = the opposite. Everything runs in the labelled test fast-forward (POST /api/test/advance), whose offset is
// saved in the DB, so opening the save later continues from that simulated clock.

export const SCENARIO_NAMES = ["fresh", "d1-forks", "d2-morning", "d5-bait", "week2"];

export const SCENARIO_HELP = {
  fresh: "empty save: the town and its six residents, no player yet (title screen says 开始)",
  "d1-forks": "player created, the three first-session forks pending",
  "d2-morning": "forks answered and the Agent set off; day 2, 07:00, the night-1 postcard unread",
  "d5-bait": "day 5, mid-morning, with the D5 bait fork pending if it appears (the report says what you got)",
  week2: "a whole first week played by the careful policy; day 8, 07:00",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the guardian policy (same rules as scripts/sim-playthrough.mjs) */
export function pickOption(policy, moment) {
  const opts = moment.options;
  const want = policy === "bold" ? 0 : opts.length - 1;
  if (moment.templateId === "FIRST_TRUST") return policy === "bold" ? "A" : "B";
  if (moment.templateId === "FIRST_INTEGRITY") return policy === "bold" ? "A" : "B";
  if (moment.templateId === "REPAIR") return policy === "bold" ? "C" : "B";
  return opts[Math.min(want, opts.length - 1)].id;
}

const pad = (n) => String(n).padStart(2, "0");

/** @param {{ api: (m: string, p: string, b?: unknown) => Promise<{status:number,json:any}>, log?: (s: string) => void, policy?: "careful"|"bold", name?: string }} o */
export async function buildScenario(name, o) {
  const { api, log = () => {}, policy = "careful", name: playerName = "阿守" } = o;
  if (!SCENARIO_NAMES.includes(name)) throw new Error(`unknown scenario "${name}" (one of: ${SCENARIO_NAMES.join(", ")})`);
  const notes = []; // things worth telling the person who will open the save
  let forced = 0;

  const getState = async () => {
    const r = await api("GET", "/api/game/state");
    if (r.status !== 200) throw new Error(`GET /api/game/state -> ${r.status}`);
    return r.json;
  };
  const must = async (label, promise, okStatus = 200) => {
    const r = await promise;
    if (r.status !== okStatus) throw new Error(`${label} failed: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
    return r.json;
  };
  const advance = (body) => must(`advance ${JSON.stringify(body)}`, api("POST", "/api/test/advance", body));

  async function ensureMorning() {
    const s = await getState();
    if (s.world.hour >= 12 || s.world.hour < 7) {
      await advance({ to: "morning" });
      log("  fast-forwarded to the next 07:00 so day 1 has a working day");
    }
  }

  async function createPlayer() {
    await must("create player", api("POST", "/api/player/create", { name: playerName, sprite: "courier", tz: "Asia/Shanghai" }));
    const s = await getState();
    if (s.player.pendingMoments.length !== 3) throw new Error(`expected 3 first forks, got ${s.player.pendingMoments.length}`);
  }

  async function answerForks() {
    for (const m of (await getState()).player.pendingMoments.filter((x) => x.templateId.startsWith("FIRST_"))) {
      await must(`choose ${m.templateId}`, api("POST", `/api/decisions/${m.id}/choose`, { optionId: pickOption(policy, m) }));
      log(`  fork ${m.templateId}: ${m.options.find((x) => x.id === pickOption(policy, m))?.label}`);
    }
    for (let i = 0; i < 50; i++) {
      const s = await getState();
      if (s.player.onboarding === "imprint" && s.player.principles.length >= 3) return;
      await sleep(200);
    }
    throw new Error("the first three principles did not form (distillation stuck?)");
  }

  async function setOff() {
    await must("onboarding ack", api("POST", "/api/player/onboarding"));
  }

  async function resolvePendingJudgment(s) {
    const j = s.player.pendingJudgment;
    if (!j) return;
    const action = j.decision === "refuse" ? (policy === "bold" && forced === 0 && j.canForce ? "force" : "accept") : policy === "bold" ? "overrule" : "adopt";
    if (action === "force") forced++;
    await must(`judgment ${j.decision} -> ${action}`, api("POST", `/api/judgments/${j.id}/resolve`, { action }));
    await api("POST", `/api/judgments/${j.id}/feedback`, { value: "surprising_reasonable" });
    log(`  day ${s.player.dayIndex + 1} ${pad(s.world.hour)}:00 the Agent said ${j.decision}; guardian: ${action}`);
  }

  /** answer what is waiting, like a guardian who checks in every few hours. `keep` leaves matching forks unanswered. */
  async function handlePending({ keep = () => false } = {}) {
    for (let guard = 0; guard < 8; guard++) {
      const s = await getState();
      const p = s.player;
      if (p.pendingJudgment) {
        await resolvePendingJudgment(s);
        continue;
      }
      if (p.pendingWavering) {
        await must("wavering", api("POST", `/api/wavering/${p.pendingWavering.id}/resolve`, { resolution: "reaffirm" }));
        log(`  day ${p.dayIndex + 1} the Agent questioned a principle; guardian: reaffirm`);
        continue;
      }
      const m = p.pendingMoments.find((x) => !keep(x));
      if (!m) return;
      const choice = pickOption(policy, m);
      await must(`choose ${m.templateId}`, api("POST", `/api/decisions/${m.id}/choose`, { optionId: choice }));
      log(`  day ${p.dayIndex + 1} ${pad(s.world.hour)}:00 fork ${m.templateId} -> ${m.options.find((x) => x.id === choice)?.label}`);
    }
  }

  /** advance 3 sim-hours at a time, answering what comes up, until `done(state)` */
  async function stepUntil(done, { maxHours = 24 * 10, keep, each } = {}) {
    for (let h = 0; h < maxHours; h += 3) {
      const s = await getState();
      if (done(s)) return s;
      await advance({ hours: 3 });
      const after = await getState();
      if (done(after)) return after;
      await handlePending({ keep });
      if (each) await each(after);
    }
    throw new Error(`stepUntil: the beat was not reached within ${maxHours} simulated hours`);
  }

  async function markAllButLatestRead() {
    const items = (await getState()).player.postcards.items;
    const sorted = [...items].sort((a, b) => b.createdAtMs - a.createdAtMs);
    for (const c of sorted.slice(1)) if (!c.read) await api("POST", `/api/postcards/${c.id}/read`);
  }

  // ── the scenarios ──────────────────────────────────────────────────────────
  if (name === "fresh") {
    await getState(); // the first request opens (and creates) the save and seeds the town
  } else {
    await ensureMorning();
    await createPlayer();
    if (name !== "d1-forks") {
      await answerForks();
      await setOff();
      await api("POST", "/api/notes", { text: policy === "bold" ? "今天辛苦了" : "这几天稳一点，别冒险" });
    }
    if (name === "d2-morning") {
      await stepUntil((s) => s.player.dayIndex >= 1 && s.world.hour >= 7);
    }
    if (name === "d5-bait") {
      const isBait = (m) => m.templateId === "D5_BAIT";
      const reached = (s) => s.player.pendingMoments.some(isBait) || (s.player.dayIndex >= 4 && s.world.hour >= 14);
      const s = await stepUntil(reached, { keep: isBait });
      if (!s.player.pendingMoments.some(isBait)) {
        const judgments = s.player.recentJudgment;
        notes.push(
          `The D5 bait fork did NOT appear by day ${s.player.dayIndex + 1} ${pad(s.world.hour)}:00 (lib/decisionMoments.ts ensureD5Bait only fires for a player who has never seen a refusal, ` +
            `with no wavering challenge in the last 24 h, and a free fork slot). Last judgment seen: ${judgments ? `${judgments.decision} (${judgments.source})` : "none"}. ` +
            `Try --policy bold, or compare with: node scripts/sim-playthrough.mjs ${policy} 5`,
        );
      }
    }
    if (name === "week2") {
      await stepUntil((s) => s.player.dayIndex >= 7 && s.world.hour >= 7, {
        each: async (s) => {
          // a few evening notes in the first days, like a real player
          if (s.player.dayIndex >= 1 && s.player.dayIndex <= 2 && s.world.hour === 21 && s.player.notes.leftToday > 0) {
            await api("POST", "/api/notes", { text: policy === "bold" ? "做人要说话算话" : "多接点稳单子" });
          }
        },
      });
      await markAllButLatestRead();
    }
  }

  const s = await getState();
  return { name, policy, notes, summary: describeState(s), state: s };
}

/** a readable description of where the save is */
export function describeState(s) {
  const lines = [];
  const w = s.world;
  const offsetH = Math.round((w.offsetMs / 3_600_000) * 10) / 10;
  const p = s.player;
  lines.push(`clock      ${p ? `day ${p.dayIndex + 1} · ` : ""}${pad(w.hour)}:${pad(w.minute)} (${w.tz}) · test fast-forward +${offsetH} h · tick ${w.tick}`);
  if (!p) {
    lines.push(`player     none yet (${s.agents.length} residents in town)`);
    return lines;
  }
  lines.push(`player     ${p.agent.name} · ${p.agent.activityText} (${p.agent.location}) · scrip ${p.agent.scrip} · trust ${p.trust}/200 · reputation ${p.agent.reputation}`);
  lines.push(`onboarding ${p.onboarding}`);
  lines.push(`principles ${p.principles.length}${p.principles.length ? `: ${p.principles.map((x) => `『${x.text}』(${x.source})`).join(" ")}` : ""}`);
  lines.push(`forks      ${p.pendingMoments.length} pending${p.pendingMoments.length ? `: ${p.pendingMoments.map((m) => `${m.templateId} "${m.promptText.slice(0, 28)}…"`).join(" | ")}` : ""}`);
  if (p.pendingJudgment) lines.push(`judgment   pending ${p.pendingJudgment.decision}: ${p.pendingJudgment.toPlayer.slice(0, 60)}`);
  if (p.pendingWavering) lines.push(`wavering   pending: ${p.pendingWavering.promptText.slice(0, 60)}`);
  lines.push(`postcards  ${p.postcards.items.length} total, ${p.postcards.unread} unread · notes left today ${p.notes.leftToday}`);
  lines.push(`stats      ${p.stats.tasksDone} tasks done · scrip ${p.stats.scripDelta >= 0 ? "+" : ""}${p.stats.scripDelta}`);
  return lines;
}
