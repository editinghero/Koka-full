/**
 * Cloudflare D1 Database Adapter for Koka Hybrid
 * Provides unified cloud storage for user library, history, notes, and preferences.
 */

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result<unknown>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

/**
 * Initializes D1 tables if they do not exist
 */
export async function initializeD1Schema(db: D1Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_library (
      media_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      score REAL,
      notes TEXT,
      custom_tags TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playback_history (
      id TEXT PRIMARY KEY,
      media_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      title TEXT NOT NULL,
      season_or_volume TEXT,
      episode_or_chapter TEXT NOT NULL,
      progress_percent REAL NOT NULL,
      time_seconds REAL NOT NULL,
      duration_seconds REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

/**
 * Helper to get active D1 database from Cloudflare request event context
 */
export function getD1FromContext(context: unknown): D1Database | null {
  if (
    context &&
    typeof context === "object" &&
    "env" in context &&
    (context as { env: { DB?: D1Database } }).env?.DB
  ) {
    return (context as { env: { DB: D1Database } }).env.DB;
  }
  return null;
}
