const { Pool } = require("pg");

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://coderpad:coderpad@localhost:5432/coderpad";

const pool = new Pool({
  connectionString: DATABASE_URL,
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      snapshot BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function loadSnapshot(sessionId) {
  const result = await pool.query("SELECT snapshot FROM sessions WHERE id = $1", [sessionId]);
  return result.rows[0]?.snapshot ?? null;
}

async function saveSnapshot(sessionId, snapshot) {
  await pool.query(
    `
      INSERT INTO sessions (id, snapshot, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (id)
      DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = now()
    `,
    [sessionId, Buffer.from(snapshot)],
  );
}

async function closeDatabase() {
  await pool.end();
}

module.exports = {
  closeDatabase,
  initDatabase,
  loadSnapshot,
  saveSnapshot,
};
