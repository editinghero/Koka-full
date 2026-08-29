/**
 * Server-only data layer.
 *
 * Uses a robust, local SQLite database via @libsql/client.
 * Full offline/local-first data persistence with zero native build crashes.
 */
import {
  normalizeTags,
  type LibraryEntry,
  type MediaType,
  type Note,
} from "@/lib/types";
import { ensureDbInitialized } from "./db.server";

export type StoredUser = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
};

export type SettingsRow = {
  gemini_key: string; // encrypted at rest
  model: string;
  anilist_user: string;
  spoiler_free: number;
  theme: string;
  light_theme: string;
  dark_theme: string;
  media_mode: string;
  anime_path?: string;
  manga_path?: string;
};

export type ImportLogRow = {
  id: number;
  source: string;
  mode: string;
  count: number;
  created_at: number;
};

export const DEFAULT_SETTINGS_ROW: SettingsRow = {
  gemini_key: "",
  model: "gemini-2.5-flash",
  anilist_user: "",
  spoiler_free: 1,
  theme: "dark",
  light_theme: "paper",
  dark_theme: "koka",
  media_mode: "ANIME",
  anime_path: "./anime",
  manga_path: "./manga",
};

export type Repo = {
  userByEmail(email: string): Promise<StoredUser | null>;
  userById(id: string): Promise<StoredUser | null>;
  createUser(user: StoredUser): Promise<void>;
  updateUserName(id: string, name: string): Promise<void>;
  updateUserPassword(id: string, hash: string): Promise<void>;

  getSettings(userId: string): Promise<SettingsRow>;
  saveSettings(userId: string, row: SettingsRow): Promise<void>;

  listLibrary(userId: string): Promise<LibraryEntry[]>;
  upsertEntries(userId: string, entries: LibraryEntry[]): Promise<void>;
  deleteEntry(userId: string, type: MediaType, mediaId: number): Promise<void>;
  replaceLibrary(
    userId: string,
    entries: LibraryEntry[],
    types: MediaType[],
  ): Promise<void>;

  listNotes(userId: string): Promise<Note[]>;
  saveNotes(userId: string, notes: Note[]): Promise<void>;
  deleteNote(userId: string, type: MediaType, mediaId: number): Promise<void>;
  replaceNotes(
    userId: string,
    notes: Note[],
    types: MediaType[],
  ): Promise<void>;

  logImport(
    userId: string,
    entry: { source: string; mode: string; count: number },
  ): Promise<void>;
  listImportLog(userId: string): Promise<ImportLogRow[]>;
};

const typeOf = (e: LibraryEntry): MediaType =>
  e.media.type === "MANGA" ? "MANGA" : "ANIME";
const noteTypeOf = (n: Note): MediaType =>
  n.mediaType === "MANGA" ? "MANGA" : "ANIME";

function sqliteRepo(): Repo {
  return {
    async userByEmail(email: string): Promise<StoredUser | null> {
      const db = await ensureDbInitialized();
      const res = await db.execute({
        sql: "SELECT * FROM users WHERE email = ? LIMIT 1",
        args: [email],
      });
      const row = res.rows[0];
      if (!row) return null;
      return {
        id: String(row["id"]),
        email: String(row["email"]),
        name: String(row["name"]),
        password_hash: String(row["password_hash"]),
        created_at: Number(row["created_at"]),
      };
    },
    async userById(id: string): Promise<StoredUser | null> {
      const db = await ensureDbInitialized();
      const res = await db.execute({
        sql: "SELECT * FROM users WHERE id = ? LIMIT 1",
        args: [id],
      });
      const row = res.rows[0];
      if (!row) return null;
      return {
        id: String(row["id"]),
        email: String(row["email"]),
        name: String(row["name"]),
        password_hash: String(row["password_hash"]),
        created_at: Number(row["created_at"]),
      };
    },
    async createUser(user: StoredUser): Promise<void> {
      const db = await ensureDbInitialized();
      await db.execute({
        sql: "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [
          user.id,
          user.email,
          user.name,
          user.password_hash,
          user.created_at,
        ],
      });
    },
    async updateUserName(id: string, name: string): Promise<void> {
      const db = await ensureDbInitialized();
      await db.execute({
        sql: "UPDATE users SET name = ? WHERE id = ?",
        args: [name, id],
      });
    },
    async updateUserPassword(id: string, hash: string): Promise<void> {
      const db = await ensureDbInitialized();
      await db.execute({
        sql: "UPDATE users SET password_hash = ? WHERE id = ?",
        args: [hash, id],
      });
    },

    async getSettings(userId: string): Promise<SettingsRow> {
      const db = await ensureDbInitialized();
      const res = await db.execute({
        sql: "SELECT * FROM settings WHERE user_id = ? LIMIT 1",
        args: [userId],
      });
      const row = res.rows[0];
      if (!row) return DEFAULT_SETTINGS_ROW;
      return {
        gemini_key: row["gemini_key"] ? String(row["gemini_key"]) : "",
        model: row["model"] ? String(row["model"]) : DEFAULT_SETTINGS_ROW.model,
        anilist_user: row["anilist_user"] ? String(row["anilist_user"]) : "",
        spoiler_free:
          row["spoiler_free"] !== null ? Number(row["spoiler_free"]) : 1,
        theme: row["theme"] ? String(row["theme"]) : "dark",
        light_theme: row["light_theme"] ? String(row["light_theme"]) : "paper",
        dark_theme: row["dark_theme"] ? String(row["dark_theme"]) : "koka",
        media_mode: row["media_mode"] ? String(row["media_mode"]) : "ANIME",
        anime_path: row["anime_path"] ? String(row["anime_path"]) : "./anime",
        manga_path: row["manga_path"] ? String(row["manga_path"]) : "./manga",
      };
    },
    async saveSettings(userId: string, row: SettingsRow): Promise<void> {
      const db = await ensureDbInitialized();
      await db.execute({
        sql: `INSERT INTO settings (user_id, gemini_key, model, anilist_user, spoiler_free, theme, light_theme, dark_theme, media_mode, anime_path, manga_path, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           gemini_key = excluded.gemini_key,
           model = excluded.model,
           anilist_user = excluded.anilist_user,
           spoiler_free = excluded.spoiler_free,
           theme = excluded.theme,
           light_theme = excluded.light_theme,
           dark_theme = excluded.dark_theme,
           media_mode = excluded.media_mode,
           anime_path = excluded.anime_path,
           manga_path = excluded.manga_path,
           updated_at = excluded.updated_at`,
        args: [
          userId,
          row.gemini_key,
          row.model,
          row.anilist_user,
          row.spoiler_free,
          row.theme,
          row.light_theme,
          row.dark_theme,
          row.media_mode,
          row.anime_path ?? "./anime",
          row.manga_path ?? "./manga",
          Date.now(),
        ],
      });
    },

    async listLibrary(userId: string): Promise<LibraryEntry[]> {
      const db = await ensureDbInitialized();
      const res = await db.execute({
        sql: "SELECT * FROM library_entries WHERE user_id = ?",
        args: [userId],
      });
      return res.rows.map((r) => ({
        media: JSON.parse(String(r["media"])),
        status: r["status"] as LibraryEntry["status"],
        progress: Number(r["progress"] ?? 0),
        score:
          r["score"] !== null && r["score"] !== undefined
            ? Number(r["score"])
            : null,
        favorite: Number(r["favorite"]) === 1,
        startedAt: r["started_at"] ? String(r["started_at"]) : null,
        completedAt: r["completed_at"] ? String(r["completed_at"]) : null,
        repeat:
          r["repeat_count"] !== null && r["repeat_count"] !== undefined
            ? Number(r["repeat_count"])
            : null,
        tags: normalizeTags(JSON.parse(String(r["tags"] ?? "[]")) as string[]),
        customLists: normalizeTags(
          JSON.parse(String(r["custom_lists"] ?? "[]")) as string[],
        ),
        updatedAt: Number(r["updated_at"] ?? Date.now()),
        addedAt: Number(r["added_at"] ?? Date.now()),
      }));
    },
    async upsertEntries(
      userId: string,
      entries: LibraryEntry[],
    ): Promise<void> {
      if (entries.length === 0) return;
      const db = await ensureDbInitialized();
      const stmts = entries.map((e) => ({
        sql: `INSERT INTO library_entries (
          user_id, media_type, media_id, status, progress, score, favorite,
          started_at, completed_at, repeat_count, tags, custom_lists, media,
          updated_at, added_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, media_type, media_id) DO UPDATE SET
          status = excluded.status,
          progress = excluded.progress,
          score = excluded.score,
          favorite = excluded.favorite,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          repeat_count = excluded.repeat_count,
          tags = excluded.tags,
          custom_lists = excluded.custom_lists,
          media = excluded.media,
          updated_at = excluded.updated_at`,
        args: [
          userId,
          typeOf(e),
          e.media.id,
          e.status,
          e.progress ?? 0,
          e.score ?? null,
          e.favorite ? 1 : 0,
          e.startedAt ?? null,
          e.completedAt ?? null,
          e.repeat ?? null,
          JSON.stringify(normalizeTags(e.tags)),
          JSON.stringify(normalizeTags(e.customLists)),
          JSON.stringify(e.media),
          e.updatedAt ?? Date.now(),
          e.addedAt ?? Date.now(),
        ],
      }));

      await db.batch(stmts, "write");
    },
    async deleteEntry(
      userId: string,
      type: MediaType,
      mediaId: number,
    ): Promise<void> {
      const db = await ensureDbInitialized();
      await db.execute({
        sql: "DELETE FROM library_entries WHERE user_id = ? AND media_type = ? AND media_id = ?",
        args: [userId, type, mediaId],
      });
    },
    async replaceLibrary(
      userId: string,
      entries: LibraryEntry[],
      types: MediaType[],
    ): Promise<void> {
      const db = await ensureDbInitialized();
      const deleteStmts = types.map((t) => ({
        sql: "DELETE FROM library_entries WHERE user_id = ? AND media_type = ?",
        args: [userId, t],
      }));
      await db.batch(deleteStmts, "write");
      await this.upsertEntries(userId, entries);
    },

    async listNotes(userId: string): Promise<Note[]> {
      const db = await ensureDbInitialized();
      const res = await db.execute({
        sql: "SELECT * FROM notes WHERE user_id = ?",
        args: [userId],
      });
      return res.rows.map((r) => ({
        animeId: Number(r["media_id"]),
        mediaType: r["media_type"] as MediaType,
        title: String(r["title"]),
        body: String(r["body"] ?? ""),
        tags: normalizeTags(JSON.parse(String(r["tags"] ?? "[]")) as string[]),
        updatedAt: Number(r["updated_at"] ?? Date.now()),
      }));
    },
    async saveNotes(userId: string, notes: Note[]): Promise<void> {
      if (notes.length === 0) return;
      const db = await ensureDbInitialized();
      const stmts = notes.map((n) => ({
        sql: `INSERT INTO notes (user_id, media_type, media_id, title, body, tags, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, media_type, media_id) DO UPDATE SET
          title = excluded.title,
          body = excluded.body,
          tags = excluded.tags,
          updated_at = excluded.updated_at`,
        args: [
          userId,
          noteTypeOf(n),
          n.animeId,
          n.title,
          n.body,
          JSON.stringify(normalizeTags(n.tags)),
          n.updatedAt ?? Date.now(),
        ],
      }));
      await db.batch(stmts, "write");
    },
    async deleteNote(
      userId: string,
      type: MediaType,
      mediaId: number,
    ): Promise<void> {
      const db = await ensureDbInitialized();
      await db.execute({
        sql: "DELETE FROM notes WHERE user_id = ? AND media_type = ? AND media_id = ?",
        args: [userId, type, mediaId],
      });
    },
    async replaceNotes(
      userId: string,
      notes: Note[],
      types: MediaType[],
    ): Promise<void> {
      const db = await ensureDbInitialized();
      const deleteStmts = types.map((t) => ({
        sql: "DELETE FROM notes WHERE user_id = ? AND media_type = ?",
        args: [userId, t],
      }));
      await db.batch(deleteStmts, "write");
      await this.saveNotes(userId, notes);
    },

    async logImport(
      userId: string,
      entry: { source: string; mode: string; count: number },
    ): Promise<void> {
      const db = await ensureDbInitialized();
      await db.execute({
        sql: "INSERT INTO import_log (user_id, source, mode, count, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [userId, entry.source, entry.mode, entry.count, Date.now()],
      });
    },
    async listImportLog(userId: string): Promise<ImportLogRow[]> {
      const db = await ensureDbInitialized();
      const res = await db.execute({
        sql: "SELECT id, source, mode, count, created_at FROM import_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
        args: [userId],
      });
      return res.rows.map((r) => ({
        id: Number(r["id"]),
        source: String(r["source"]),
        mode: String(r["mode"]),
        count: Number(r["count"]),
        created_at: Number(r["created_at"]),
      }));
    },
  };
}

export function getRepo(): Repo {
  return sqliteRepo();
}

export function usingD1(): boolean {
  return false;
}
