import Database from "better-sqlite3";
import path from "node:path";

const SEED_AGENTS: Array<{ id: string; name: string; personality: string }> = [
  { id: "mira", name: "Mira", personality: "轻信，习惯把人往好处想；出错时先怪自己。温和，道歉式口吻，爱用省略号。" },
  { id: "sol", name: "Sol", personality: "精明，句子短，张口就是数字，从不寒暄。" },
  { id: "tao", name: "Tao", personality: "慢性子，惜字如金。" },
  { id: "iris", name: "Iris", personality: "严谨，说话像引用文献，对“记录”有近乎信仰的执着。" },
  { id: "kade", name: "Kade", personality: "中立到近乎冷淡，措辞永远留有余地。" },
  { id: "nova", name: "Nova", personality: "冲动，嗓门大，赌性写在脸上。" },
];

function createDb(): Database.Database {
  const dbPath = path.join(process.cwd(), "polis.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

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
      type TEXT NOT NULL,              -- 'trust' | 'risk' | 'integrity'
      template_id TEXT NOT NULL,       -- e.g. 'FIRST_TRUST', 'T-2', 'R-4', 'I-1'
      prompt_text TEXT NOT NULL,
      options_json TEXT NOT NULL,      -- JSON array of {id, label, fallbackPrinciple}
      counterparty_id TEXT,
      created_at INTEGER NOT NULL,     -- wall-clock ms epoch (Date.now()) -- NEVER a tick count
      expires_at INTEGER NOT NULL,     -- created_at + 24h in ms -- NEVER a tick count
      status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'decided' | 'expired_autonomous'
      player_choice TEXT,
      autonomous_choice TEXT
    );

    CREATE TABLE IF NOT EXISTS principles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      text TEXT NOT NULL,
      domain TEXT NOT NULL,                  -- 'trust' | 'risk' | 'integrity'
      weight REAL NOT NULL DEFAULT 1.0,
      source_decision_id INTEGER NOT NULL,   -- decision_moments.id this was distilled from
      source TEXT NOT NULL,                  -- 'llm' | 'fallback'
      last_cited_at INTEGER,                 -- wall-clock ms; NULL until first cited
      last_decayed_at INTEGER NOT NULL,      -- wall-clock ms; bookkeeping, starts = created_at
      created_at INTEGER NOT NULL            -- wall-clock ms
    );

    CREATE TABLE IF NOT EXISTS principle_citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      principle_id INTEGER NOT NULL,
      context TEXT NOT NULL,
      outcome TEXT NOT NULL,                 -- 'positive' | 'negative' | 'neutral'
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wavering_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      principle_id INTEGER NOT NULL,
      prompt_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'resolved'
      resolution TEXT,                          -- 'reaffirm' | 'revise'
      revised_text TEXT,
      resolved_at INTEGER
    );

    -- Cross-process/container duplicate-distillation guard (Build Decision ⑧'s
    -- __polisDistillationInFlight boolean only prevents overlap within a single
    -- Node process; this DB-level constraint is what actually enforces "each
    -- decision_moments row distills to at most one principle" when two separate
    -- processes race). IF NOT EXISTS keeps this safe against pre-existing DB
    -- files from earlier test runs, matching this file's other idempotent DDL.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_principles_source_decision_id ON principles(source_decision_id);
  `);

  // --- Idempotent migration: new columns on agents (safe against pre-existing DB files) ---
  const agentColumns = db.pragma("table_info(agents)") as Array<{ name: string }>;
  const hasColumn = (colName: string) => agentColumns.some((c) => c.name === colName);

  if (!hasColumn("mbti")) {
    db.exec(`ALTER TABLE agents ADD COLUMN mbti TEXT`);
  }
  if (!hasColumn("is_player")) {
    db.exec(`ALTER TABLE agents ADD COLUMN is_player INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn("trust")) {
    db.exec(`ALTER TABLE agents ADD COLUMN trust INTEGER NOT NULL DEFAULT 100`);
  }
  if (!hasColumn("created_at")) {
    // Nullable, no default. SQLite refuses a non-constant ALTER TABLE ADD
    // COLUMN default (e.g. an expression evaluating to "now") once a table
    // already has rows -- and `agents` always does by this point (seed
    // NPCs, possibly a player). So existing rows land NULL here, and so does
    // every row inserted afterwards by app/api/player/create's INSERT
    // (which lists explicit columns that don't include this one either).
    // lib/decisionMoments.ts's ensureD2Citation() self-heals this: the first
    // tick that observes a NULL created_at for a given agent stamps it with
    // Date.now() then (see comment there). Added for the D2 首次引用硬规则
    // (needs a real "day since agent creation" reference point).
    db.exec(`ALTER TABLE agents ADD COLUMN created_at INTEGER`);
  }
  if (!hasColumn("first_citation_at")) {
    // Wall-clock ms epoch (Date.now()); NULL until this agent's D2 首次引用
    // (first-citation) event is fulfilled. Doubles as the "指标钩子：首次
    // 引用时间戳" metrics hook mentioned in the design doc (full dashboard is
    // Phase 4; this just captures/logs the timestamp now).
    db.exec(`ALTER TABLE agents ADD COLUMN first_citation_at INTEGER`);
  }

  const worldRow = db.prepare("SELECT id FROM world_state WHERE id = 1").get();
  if (!worldRow) {
    db.prepare("INSERT INTO world_state (id, current_tick, is_running) VALUES (1, 0, 0)").run();
  }

  const agentCount = db.prepare("SELECT COUNT(*) as n FROM agents").get() as { n: number };
  if (agentCount.n === 0) {
    const insertAgent = db.prepare(`
      INSERT INTO agents (id, name, personality, reputation, scrip, current_location, state, mbti, is_player, trust)
      VALUES (@id, @name, @personality, 20, 0, 'town-center', 'idle', NULL, 0, 100)
    `);
    for (const agent of SEED_AGENTS) {
      insertAgent.run(agent);
    }
  } else {
    // Backfill personality for pre-existing seed rows from earlier Phase 0 test runs
    // that were inserted with personality: "" (blank), and ensure Kade exists.
    const backfillPersonality = db.prepare(
      "UPDATE agents SET personality = @personality WHERE id = @id AND personality = ''"
    );
    const insertIfMissing = db.prepare(`
      INSERT OR IGNORE INTO agents (id, name, personality, reputation, scrip, current_location, state, mbti, is_player, trust)
      VALUES (@id, @name, @personality, 20, 0, 'town-center', 'idle', NULL, 0, 100)
    `);
    for (const agent of SEED_AGENTS) {
      insertIfMissing.run(agent);
      backfillPersonality.run(agent);
    }
  }

  return db;
}

declare global {
  // eslint-disable-next-line no-var
  var __polisDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!globalThis.__polisDb) {
    globalThis.__polisDb = createDb();
  }
  return globalThis.__polisDb;
}
