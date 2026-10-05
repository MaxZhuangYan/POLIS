import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { NPCS, SEED_INCIDENTS, SEED_RELATIONS } from "./content";

// ---------------------------------------------------------------------------
// SQLite schema. Every change below is ADDITIVE (CREATE IF NOT EXISTS /
// ALTER TABLE ADD COLUMN guarded by table_info) so an existing polis.db save
// from an earlier build keeps loading. POLIS_DB_PATH lets a tester point the
// server at a throwaway save without touching the real one.
// ---------------------------------------------------------------------------

function addColumns(db: Database.Database, table: string, cols: Array<[string, string]>) {
  const existing = new Set((db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name));
  for (const [name, ddl] of cols) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}

function createDb(): Database.Database {
  const dbPath = dbPathFromEnv();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      personality TEXT NOT NULL DEFAULT '',
      reputation INTEGER NOT NULL DEFAULT 20,
      scrip INTEGER NOT NULL DEFAULT 0,
      current_location TEXT NOT NULL DEFAULT 'town-center',
      state TEXT NOT NULL DEFAULT 'idle'
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      reward INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      taken_by TEXT,
      created_tick INTEGER NOT NULL,
      taken_at_tick INTEGER
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      tick INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_tick INTEGER NOT NULL DEFAULT 0,
      is_running INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS decision_moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      template_id TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      options_json TEXT NOT NULL,
      counterparty_id TEXT,
      created_at INTEGER NOT NULL,     -- sim wall-clock ms (lib/clock.ts simNow) -- NEVER a tick count
      expires_at INTEGER NOT NULL,     -- created_at + 24h
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'decided' | 'expired_autonomous'
      player_choice TEXT,
      autonomous_choice TEXT
    );

    CREATE TABLE IF NOT EXISTS principles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      text TEXT NOT NULL,
      domain TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      source_decision_id INTEGER NOT NULL,
      source TEXT NOT NULL,                  -- 'llm' | 'fallback' | 'forced' | 'note' | 'core'
      last_cited_at INTEGER,
      last_decayed_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS principle_citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      principle_id INTEGER NOT NULL,
      context TEXT NOT NULL,
      outcome TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wavering_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      principle_id INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      resolution TEXT,
      revised_text TEXT,
      resolved_at INTEGER
    );

    -- Town-visible events (feed). Narrative is only ever composed from these
    -- rows + memories, never invented.
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at_ms INTEGER NOT NULL,
      tick INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      actors_json TEXT NOT NULL DEFAULT '[]',
      involves_player INTEGER NOT NULL DEFAULT 0,
      importance INTEGER NOT NULL DEFAULT 1,
      data_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_events_at ON events(at_ms);

    -- Per-agent episodic memory (first-person facts).
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      refs_json TEXT NOT NULL DEFAULT '{}',
      principle_id INTEGER,
      event_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id, at_ms);

    -- Directed relationship record: agent_id's view of other_id.
    CREATE TABLE IF NOT EXISTS relationships (
      agent_id TEXT NOT NULL,
      other_id TEXT NOT NULL,
      familiarity INTEGER NOT NULL DEFAULT 0,
      coop_done INTEGER NOT NULL DEFAULT 0,
      last_event TEXT,
      updated_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, other_id)
    );

    -- Grudges: holder remembers what offender did. ≤5 kept per pair (newest wins).
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holder_id TEXT NOT NULL,
      offender_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0
    );

    -- Autonomy engine verdicts on the guardian's choices (v3.14 §2.4).
    CREATE TABLE IF NOT EXISTS judgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      moment_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      decision TEXT NOT NULL,            -- 'execute' | 'adjust' | 'refuse'
      chosen_option TEXT NOT NULL,
      alt_option TEXT,                   -- what the Agent would do instead (adjust/refuse)
      to_player TEXT NOT NULL,
      cited_principle_id INTEGER,
      reasons_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL,              -- 'llm' | 'rules'
      gate TEXT,                         -- telemetry: judged | llm_down | gate_fail | timing_gate
      status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | forced | adopted | overruled
      created_ms INTEGER NOT NULL,
      resolved_ms INTEGER,
      feedback TEXT,
      final_option TEXT,
      success_trust_pending INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS trust_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metric_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      at_ms INTEGER NOT NULL
    );

    -- 留言 (v1.5 §2.3.1): async, answered in the next postcard.
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      text TEXT NOT NULL,
      kind TEXT NOT NULL,                -- 'value' | 'preference' | 'words'
      directive_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reply TEXT,
      created_ms INTEGER NOT NULL,
      answered_ms INTEGER,
      postcard_id INTEGER,
      principle_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS postcards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      day_index INTEGER NOT NULL,
      kind TEXT NOT NULL,                -- 'nightly' | 'recap7'
      title TEXT NOT NULL,
      lines_json TEXT NOT NULL,
      cited_json TEXT NOT NULL DEFAULT '[]',
      facts_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL,              -- 'llm' | 'template'
      created_ms INTEGER NOT NULL,
      read_ms INTEGER
    );

    -- Delayed consequences (inspection of a shortcut, loan due dates, ...).
    CREATE TABLE IF NOT EXISTS scheduled (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      due_ms INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      done INTEGER NOT NULL DEFAULT 0
    );

    -- 默契 (lib/dilemmas.ts): a decision the Agent makes by itself by evening; the guardian may guess it first
    CREATE TABLE IF NOT EXISTS guesses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      npc TEXT NOT NULL,
      origin TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      options_json TEXT NOT NULL,
      decided_option TEXT NOT NULL,
      effect_json TEXT NOT NULL,
      principle_id INTEGER,
      principle_text TEXT,
      guessed_option TEXT,
      created_ms INTEGER NOT NULL,
      due_ms INTEGER NOT NULL,
      resolved_ms INTEGER,
      correct INTEGER
    );
  `);

  addColumns(db, "agents", [
    ["mbti", "TEXT"],
    ["is_player", "INTEGER NOT NULL DEFAULT 0"],
    ["trust", "INTEGER NOT NULL DEFAULT 100"],
    ["created_at", "INTEGER"],
    ["first_citation_at", "INTEGER"],
    ["role", "TEXT NOT NULL DEFAULT ''"],
    ["sprite", "TEXT NOT NULL DEFAULT 'rookie'"],
    ["home_slot", "INTEGER NOT NULL DEFAULT 0"],
    ["traits_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["activity", "TEXT NOT NULL DEFAULT 'idle'"],
    ["activity_text", "TEXT NOT NULL DEFAULT ''"],
    ["reason_text", "TEXT"],
    ["travel_from", "TEXT"],
    ["travel_to", "TEXT"],
    ["travel_start_ms", "INTEGER"],
    ["travel_end_ms", "INTEGER"],
    ["partner_id", "TEXT"],
    ["current_task_id", "INTEGER"],
    ["bubble_text", "TEXT"],
    ["bubble_at_ms", "INTEGER"],
    ["emote", "TEXT"],
    ["plan_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["record_done", "INTEGER NOT NULL DEFAULT 0"],
    ["record_defaults", "INTEGER NOT NULL DEFAULT 0"],
    ["onboarding", "TEXT NOT NULL DEFAULT 'done'"],
    ["last_postcard_ms", "INTEGER"],
      // 记忆槽位 (lib/imprints.ts): live imprints the Agent can hold
    ["memory_slots", "INTEGER NOT NULL DEFAULT 5"],
    // three words the guardian used for its Agent at each weekly recap (lib/progression.ts)
    ["survey_json", "TEXT NOT NULL DEFAULT '[]'"],
    // highest reputation title reached (so a tier-up is announced once)
    ["title_tier", "INTEGER NOT NULL DEFAULT 0"],
    // 置业 (lib/goals.ts): how many of its goals a resident has bought
    ["goal_level", "INTEGER NOT NULL DEFAULT 0"],
  ]);

  addColumns(db, "world_state", [
    ["time_offset_ms", "INTEGER NOT NULL DEFAULT 0"],
    ["tz", "TEXT"],
    ["last_tick_ms", "INTEGER"],
  ]);

  addColumns(db, "tasks", [
    ["template_id", "TEXT"],
    ["name", "TEXT"],
    ["location", "TEXT"],
    ["giver", "TEXT"],
    ["mode", "TEXT"],
    ["duration", "INTEGER NOT NULL DEFAULT 2"],
    ["success_rate", "REAL NOT NULL DEFAULT 1"],
    ["partner_id", "TEXT"],
    ["progress", "INTEGER NOT NULL DEFAULT 0"],
    ["quality", "TEXT"],
    ["outcome_text", "TEXT"],
    ["moment_id", "INTEGER"],
    ["chain_parent_id", "INTEGER"],
    ["created_ms", "INTEGER"],
    ["done_ms", "INTEGER"],
    ["source", "TEXT"],
    ["reason_text", "TEXT"],
    ["principle_id", "INTEGER"],
    ["receiver_id", "TEXT"],
    ["meta_json", "TEXT NOT NULL DEFAULT '{}'"],
  ]);

  // 记忆槽位 arrived after some saves already held more than five live imprints: those saves keep them all
  // (up to the eight-slot cap) instead of having the guardian's past words fall asleep overnight.
  db.prepare(
    `UPDATE agents SET memory_slots = MIN(8, (SELECT COUNT(*) FROM principles p WHERE p.agent_id = agents.id
       AND p.source IN ('llm','fallback','note','revised') AND p.weight >= 0.3))
     WHERE is_player = 1 AND memory_slots = 5 AND (SELECT COUNT(*) FROM principles p WHERE p.agent_id = agents.id
       AND p.source IN ('llm','fallback','note','revised') AND p.weight >= 0.3) > 5`,
  ).run();

  addColumns(db, "ledger", [
    // wall-clock of the entry (sim time), for the daily ledger (日结); rows written before this column are skipped there
    ["at_ms", "INTEGER"],
  ]);

  addColumns(db, "decision_moments", [
    ["speaker_id", "TEXT"],
    ["facts_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["escalation", "TEXT"],
    ["context_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["judgment_id", "INTEGER"],
    ["decided_ms", "INTEGER"],
    // set when the choice deepened an existing principle instead of forming a new one
    ["distilled_into", "INTEGER"],
  ]);

  addColumns(db, "principles", [
    ["origin_text", "TEXT"],
    ["stance_dir", "INTEGER NOT NULL DEFAULT 0"],
  ]);

  // The original unique index (one principle per decision) is kept in spirit
  // but narrowed to distilled principles, so a forced-execution imprint can
  // reference the same moment it was forced on.
  db.exec(`
    DROP INDEX IF EXISTS idx_principles_source_decision_id;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_principles_distilled_once
      ON principles(source_decision_id) WHERE source IN ('llm', 'fallback');
  `);

  const worldRow = db.prepare("SELECT id FROM world_state WHERE id = 1").get();
  if (!worldRow) {
    db.prepare("INSERT INTO world_state (id, current_tick, is_running) VALUES (1, 0, 1)").run();
  }
  // Polis is "a world that is always running" (POLIS_ARCHITECTURE 部署形态).
  db.prepare("UPDATE world_state SET is_running = 1 WHERE id = 1").run();

  // Legacy Phase-0 task rows (random info/transport/guard) are retired.
  db.prepare("UPDATE tasks SET status = 'legacy' WHERE template_id IS NULL AND status IN ('open','taken')").run();
  db.prepare("UPDATE agents SET current_location = 'plaza' WHERE current_location IN ('town-center','info','transport','guard')").run();

  seedNpcs(db);
  return db;
}

function seedNpcs(db: Database.Database) {
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO agents (id, name, personality, reputation, scrip, current_location, state, mbti, is_player, trust,
                        role, sprite, home_slot, traits_json, record_done, record_defaults, activity, created_at)
    VALUES (@id, @name, @personality, 20, 60, 'home', 'idle', NULL, 0, 100,
            @role, @sprite, @homeSlot, @traits, @done, @defaults, 'idle', @now)
    ON CONFLICT(id) DO UPDATE SET
      personality = excluded.personality,
      role = excluded.role,
      sprite = excluded.sprite,
      home_slot = excluded.home_slot,
      traits_json = excluded.traits_json
  `);
  for (const n of NPCS) {
    const existed = db.prepare("SELECT role FROM agents WHERE id = ?").get(n.id) as { role: string } | undefined;
    upsert.run({
      id: n.id,
      name: n.name,
      personality: n.personality,
      role: n.role,
      sprite: n.sprite,
      homeSlot: n.homeSlot,
      traits: JSON.stringify(n.traits),
      done: n.record.done,
      defaults: n.record.defaults,
      now,
    });
    if (!existed || !existed.role) {
      db.prepare("UPDATE agents SET record_done = ?, record_defaults = ?, scrip = MAX(scrip, 60) WHERE id = ?").run(
        n.record.done,
        n.record.defaults,
        n.id,
      );
    }
  }

  // Core principles (never decay) — inserted once per NPC.
  const hasCore = db.prepare("SELECT COUNT(*) AS n FROM principles WHERE agent_id = ? AND source = 'core'");
  const insertCore = db.prepare(`
    INSERT INTO principles (agent_id, text, domain, weight, source_decision_id, source, last_cited_at, last_decayed_at, created_at, origin_text, stance_dir)
    VALUES (?, ?, ?, 1.0, 0, 'core', NULL, ?, ?, ?, ?)
  `);
  for (const n of NPCS) {
    if ((hasCore.get(n.id) as { n: number }).n > 0) continue;
    for (const c of n.core) insertCore.run(n.id, c.text, c.domain, now, now, `${n.name} 的档案`, c.dir);
  }

  // Pre-history relationships and grudges, seeded once.
  const relCount = (db.prepare("SELECT COUNT(*) AS n FROM relationships").get() as { n: number }).n;
  if (relCount === 0) {
    const rel = db.prepare(
      "INSERT OR IGNORE INTO relationships (agent_id, other_id, familiarity, coop_done, last_event, updated_ms) VALUES (?, ?, ?, ?, NULL, ?)",
    );
    for (const r of SEED_RELATIONS) {
      rel.run(r.a, r.b, r.familiarity, Math.round(r.familiarity / 15), now);
      rel.run(r.b, r.a, r.familiarity, Math.round(r.familiarity / 15), now);
    }
    const inc = db.prepare(
      "INSERT INTO incidents (holder_id, offender_id, kind, text, at_ms, resolved) VALUES (?, ?, 'default', ?, ?, 0)",
    );
    for (const i of SEED_INCIDENTS) inc.run(i.holder, i.offender, i.text, now - i.daysAgo * 86_400_000);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __polisDb: Database.Database | undefined;
}

function dbPathFromEnv(): string {
  return process.env.POLIS_DB_PATH || path.join(process.cwd(), "polis.db");
}

/** 新的存档: close the current save, keep it as <file>.bak (one generation), and start an empty world. */
export function resetSave(): { backup: string } {
  const dbPath = dbPathFromEnv();
  try {
    globalThis.__polisDb?.close();
  } catch {
    /* already closed */
  }
  globalThis.__polisDb = undefined;
  const backup = `${dbPath}.bak`;
  for (const suf of ["", "-wal", "-shm"]) {
    if (fs.existsSync(backup + suf)) fs.rmSync(backup + suf);
    if (fs.existsSync(dbPath + suf)) fs.renameSync(dbPath + suf, backup + suf);
  }
  getDb();
  return { backup };
}

export function getDb(): Database.Database {
  if (!globalThis.__polisDb) {
    globalThis.__polisDb = createDb();
  }
  return globalThis.__polisDb;
}
