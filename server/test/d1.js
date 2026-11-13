import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Test double for Cloudflare D1 on real SQLite.
export function memoryD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
  });
  return {
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec('BEGIN');
      try { for (const s of stmts) db.prepare(s.sql).run(...s.args); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    exec: (sql) => db.exec(sql),
  };
}
