/**
 * Minimal D1 shim on `node:sqlite` (Node 22.13+, DatabaseSync) to run the
 * domain/batch modules against a REAL SQLite database loaded with schema.sql +
 * seed.sql (real decoded VSAM data). No mocks: full-fidelity testing.
 *
 * Implements the D1 surface actually used by src/lib/db.ts and the modules:
 *   - db.prepare(sql).bind(...).first() / .all() / .run()
 *   - db.batch([stmts])  (atomic transaction: BEGIN / COMMIT / ROLLBACK)
 *   - db.exec(sql)
 * `.run()`/`._exec()` return meta.changes; SELECTs return { results }.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// `node:sqlite` is not recognized by the Vite/vitest resolver:
// we load it at RUNTIME via createRequire to bypass the bundler.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = import('node:sqlite').DatabaseSync;

type BindValue = string | number | null;

class D1StmtShim {
  constructor(
    private readonly raw: DatabaseSync,
    private readonly sql: string,
    private readonly params: BindValue[] = [],
  ) {}

  bind(...params: BindValue[]): D1StmtShim {
    // undefined → null (D1 does not accept undefined).
    const norm = params.map((p) => (p === undefined ? null : p)) as BindValue[];
    return new D1StmtShim(this.raw, this.sql, norm);
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.raw.prepare(this.sql).get(...(this.params as never[]));
    return (row ?? null) as T | null;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: true; meta: object }> {
    const results = this.raw.prepare(this.sql).all(...(this.params as never[])) as T[];
    return { results, success: true, meta: {} };
  }

  async run(): Promise<D1ResultShape> {
    return this.execSync();
  }

  /** Synchronous execution used by batch(): routes SELECT → all, otherwise → run. */
  execSync(): D1ResultShape {
    if (/^\s*select/i.test(this.sql)) {
      const results = this.raw.prepare(this.sql).all(...(this.params as never[]));
      return { success: true, results, meta: { changes: 0, last_row_id: 0 } };
    }
    const info = this.raw.prepare(this.sql).run(...(this.params as never[]));
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }
}

interface D1ResultShape {
  success: true;
  results: unknown[];
  meta: { changes: number; last_row_id: number };
}

class D1Shim {
  constructor(private readonly raw: DatabaseSync) {}

  prepare(sql: string): D1StmtShim {
    return new D1StmtShim(this.raw, sql);
  }

  async batch(stmts: D1StmtShim[]): Promise<D1ResultShape[]> {
    this.raw.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.execSync());
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.raw.exec(sql);
    return { count: 0, duration: 0 };
  }
}

export interface TestEnv {
  DB: unknown; // cast to D1Database on the caller side (env as unknown as Env).
}

/**
 * Builds a fresh test env: :memory: database + schema.sql + seed.sql.
 * Also returns `raw` (DatabaseSync) for verification queries.
 */
export function makeEnv(): { env: { DB: unknown }; raw: DatabaseSync } {
  const root = process.cwd();
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(join(root, 'schema.sql'), 'utf8'));
  raw.exec(readFileSync(join(root, 'seed.sql'), 'utf8'));
  const db = new D1Shim(raw);
  return { env: { DB: db }, raw };
}

/** Helper: first row of a verification query (on the raw database). */
export function queryOne<T = Record<string, unknown>>(
  raw: DatabaseSync,
  sql: string,
  ...params: BindValue[]
): T | null {
  return (raw.prepare(sql).get(...(params as never[])) ?? null) as T | null;
}

/** Helper: all rows of a verification query. */
export function queryAll<T = Record<string, unknown>>(
  raw: DatabaseSync,
  sql: string,
  ...params: BindValue[]
): T[] {
  return raw.prepare(sql).all(...(params as never[])) as T[];
}
