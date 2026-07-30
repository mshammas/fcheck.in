/**
 * A minimal D1Database adapter over better-sqlite3, for tests.
 *
 * Implements exactly the slice of the D1 API the app uses:
 * `prepare(sql).bind(...).run() / .first() / .all()` and `db.batch([...])`.
 * This lets the DB-touching modules (admin queries, job promotions) run against
 * real SQLite — FTS5 included — in vitest, with no Workers runtime and no keys.
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

class Stmt {
  private args: unknown[] = [];
  constructor(
    private readonly db: Database.Database,
    private readonly sql: string
  ) {}

  bind(...args: unknown[]): Stmt {
    this.args = args;
    return this;
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number; duration: number } }> {
    const info = this.db.prepare(this.sql).run(...(this.args as never[]));
    return {
      success: true,
      meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid), duration: 0 },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.args as never[]));
    return (row as T) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const rows = this.db.prepare(this.sql).all(...(this.args as never[]));
    return { results: rows as T[], success: true };
  }
}

class D1 {
  constructor(private readonly db: Database.Database) {}

  prepare(sql: string): Stmt {
    return new Stmt(this.db, sql);
  }

  async batch(statements: Stmt[]): Promise<unknown[]> {
    // D1 runs a batch atomically. better-sqlite3 transactions are synchronous,
    // so run each statement's SQL inside one transaction and collect results.
    const runAll = this.db.transaction((stmts: Stmt[]) => {
      return stmts.map((s) => {
        const { sql, args } = s as unknown as { sql: string; args: unknown[] };
        const info = this.db.prepare(sql).run(...((args ?? []) as never[]));
        return { success: true, meta: { changes: info.changes } };
      });
    });
    return runAll(statements);
  }
}

/** Fresh in-memory DB with all migrations applied. Returns the D1 shim + raw handle. */
export function freshDb(): { db: D1Database; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');

  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    // Skip the demo-data seed — tests insert exactly what they need.
    if (file.includes('seed_demo')) continue;
    raw.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  return { db: new D1(raw) as unknown as D1Database, raw };
}
