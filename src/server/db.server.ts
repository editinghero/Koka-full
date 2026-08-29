import { createClient, type Client } from "@libsql/client";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

let dbInstance: Client | null = null;
let initialized = false;

export function getDb(): Client {
  if (dbInstance) return dbInstance;

  try {
    const dataDir = join(process.cwd(), ".data");
    if (typeof existsSync === "function" && typeof mkdirSync === "function") {
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
    }
  } catch {
    /* ignore in Cloudflare Pages edge runtime */
  }

  const dbPath = join(process.cwd(), ".data", "koka.db").replace(/\\/g, "/");
  const client = createClient({
    url: `file:${dbPath}`,
  });

  dbInstance = client;
  return dbInstance;
}

export async function ensureDbInitialized(): Promise<Client> {
  const client = getDb();
  if (initialized) return client;

  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT PRIMARY KEY,
      gemini_key TEXT,
      model TEXT,
      anilist_user TEXT,
      spoiler_free INTEGER NOT NULL DEFAULT 1,
      theme TEXT NOT NULL DEFAULT 'dark',
      light_theme TEXT NOT NULL DEFAULT 'paper',
      dark_theme TEXT NOT NULL DEFAULT 'koka',
      media_mode TEXT NOT NULL DEFAULT 'ANIME',
      anime_path TEXT NOT NULL DEFAULT './anime',
      manga_path TEXT NOT NULL DEFAULT './manga',
      updated_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_entries (
      user_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      score REAL,
      favorite INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      repeat_count INTEGER,
      tags TEXT NOT NULL DEFAULT '[]',
      custom_lists TEXT NOT NULL DEFAULT '[]',
      media TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, media_type, media_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      user_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, media_type, media_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      source TEXT NOT NULL,
      mode TEXT NOT NULL,
      count INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS watch_progress (
      slug TEXT NOT NULL,
      season TEXT NOT NULL,
      episode_file TEXT NOT NULL,
      position_seconds REAL NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      last_watched_at TEXT NOT NULL,
      PRIMARY KEY (slug, season, episode_file)
    );

    CREATE TABLE IF NOT EXISTS read_progress (
      slug TEXT NOT NULL,
      chapter_file TEXT NOT NULL,
      page_number INTEGER NOT NULL DEFAULT 1,
      total_pages INTEGER NOT NULL DEFAULT 1,
      completed INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT NOT NULL,
      PRIMARY KEY (slug, chapter_file)
    );

    CREATE TABLE IF NOT EXISTS local_media_links (
      media_type TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      folder_slug TEXT NOT NULL,
      folder_name TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      custom_title TEXT,
      linked_at INTEGER NOT NULL,
      PRIMARY KEY (media_type, media_id)
    );

    CREATE TABLE IF NOT EXISTS metadata_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_watch_progress_lastWatched 
    ON watch_progress(last_watched_at DESC);

    CREATE INDEX IF NOT EXISTS idx_read_progress_lastRead 
    ON read_progress(last_read_at DESC);

    CREATE INDEX IF NOT EXISTS idx_local_media_slug
    ON local_media_links(media_type, folder_slug);
  `);

  initialized = true;
  return client;
}
