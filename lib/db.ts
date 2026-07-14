import Database from "better-sqlite3";
import path from "node:path";

const SEED_AGENT_NAMES = ["Mira", "Nova", "Sol", "Tao", "Iris"];

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
  `);

  const worldRow = db.prepare("SELECT id FROM world_state WHERE id = 1").get();
  if (!worldRow) {
    db.prepare("INSERT INTO world_state (id, current_tick, is_running) VALUES (1, 0, 0)").run();
  }

  const agentCount = db.prepare("SELECT COUNT(*) as n FROM agents").get() as { n: number };
  if (agentCount.n === 0) {
    const insertAgent = db.prepare(`
      INSERT INTO agents (id, name, personality, reputation, scrip, current_location, state)
      VALUES (@id, @name, @personality, 20, 0, 'town-center', 'idle')
    `);
    for (const name of SEED_AGENT_NAMES) {
      insertAgent.run({ id: name.toLowerCase(), name, personality: "" });
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
