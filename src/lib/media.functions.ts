import { createServerFn } from "@tanstack/react-start";
import type { MediaType } from "./types";

export interface WatchProgressRecord {
  slug: string;
  season: string;
  episodeFile: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  lastWatchedAt: string;
}

export interface ReadProgressRecord {
  slug: string;
  chapterFile: string;
  pageNumber: number;
  totalPages: number;
  completed: boolean;
  lastReadAt: string;
}

/** Get library scan status and summary */
export const getLibraryScanStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getScanState, scanLibrary } =
      await import("@/server/scanner.server");
    let state = getScanState();
    if (state.lastScannedAt === 0 && !state.isScanning) {
      state = await scanLibrary();
    }
    return state;
  },
);

/** Trigger a full library re-scan */
export const rescanMediaLibrary = createServerFn({ method: "POST" }).handler(
  async () => {
    const { scanLibrary } = await import("@/server/scanner.server");
    return await scanLibrary();
  },
);

/** Save anime watch progress */
export const saveWatchProgress = createServerFn({ method: "POST" })
  .validator(
    (data: {
      slug: string;
      season: string;
      episodeFile: string;
      positionSeconds: number;
      durationSeconds: number;
      completed?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const isCompleted =
      data.completed ??
      (data.durationSeconds > 0 &&
        data.positionSeconds / data.durationSeconds > 0.9);

    const { getD1 } = await import("@/server/runtime.server");
    const d1 = getD1();
    if (d1) {
      await d1
        .prepare(
          `INSERT INTO watch_progress (slug, season, episode_file, position_seconds, duration_seconds, completed, last_watched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug, season, episode_file) DO UPDATE SET
             position_seconds = excluded.position_seconds,
             duration_seconds = excluded.duration_seconds,
             completed = excluded.completed,
             last_watched_at = excluded.last_watched_at`,
        )
        .bind(
          data.slug,
          data.season,
          data.episodeFile,
          data.positionSeconds,
          data.durationSeconds,
          isCompleted ? 1 : 0,
          new Date().toISOString(),
        )
        .run();
      return { ok: true };
    }

    try {
      const { ensureDbInitialized } = await import("@/server/db.server");
      const db = await ensureDbInitialized();
      await db.execute({
        sql: `INSERT INTO watch_progress (slug, season, episode_file, position_seconds, duration_seconds, completed, last_watched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug, season, episode_file) DO UPDATE SET
           position_seconds = excluded.position_seconds,
           duration_seconds = excluded.duration_seconds,
           completed = excluded.completed,
           last_watched_at = excluded.last_watched_at`,
        args: [
          data.slug,
          data.season,
          data.episodeFile,
          data.positionSeconds,
          data.durationSeconds,
          isCompleted ? 1 : 0,
          new Date().toISOString(),
        ],
      });
    } catch (err) {
      console.warn("Could not save watch progress locally:", err);
    }

    return { ok: true };
  });

/** Get watch progress records for an anime */
export const getWatchProgress = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }): Promise<WatchProgressRecord[]> => {
    const { getD1 } = await import("@/server/runtime.server");
    const d1 = getD1();
    if (d1) {
      const res = await d1
        .prepare(
          "SELECT * FROM watch_progress WHERE slug = ? ORDER BY last_watched_at DESC",
        )
        .bind(data.slug)
        .all();
      return (res.results || []).map((r) => ({
        slug: String(r["slug"]),
        season: String(r["season"]),
        episodeFile: String(r["episode_file"]),
        positionSeconds: Number(r["position_seconds"] ?? 0),
        durationSeconds: Number(r["duration_seconds"] ?? 0),
        completed: Number(r["completed"] ?? 0) === 1,
        lastWatchedAt: String(r["last_watched_at"]),
      }));
    }

    try {
      const { ensureDbInitialized } = await import("@/server/db.server");
      const db = await ensureDbInitialized();
      const res = await db.execute({
        sql: "SELECT * FROM watch_progress WHERE slug = ? ORDER BY last_watched_at DESC",
        args: [data.slug],
      });
      return res.rows.map((r) => ({
        slug: String(r["slug"]),
        season: String(r["season"]),
        episodeFile: String(r["episode_file"]),
        positionSeconds: Number(r["position_seconds"] ?? 0),
        durationSeconds: Number(r["duration_seconds"] ?? 0),
        completed: Number(r["completed"] ?? 0) === 1,
        lastWatchedAt: String(r["last_watched_at"]),
      }));
    } catch {
      return [];
    }
  });

/** Save manga reading progress */
export const saveReadProgress = createServerFn({ method: "POST" })
  .validator(
    (data: {
      slug: string;
      chapterFile: string;
      pageNumber: number;
      totalPages: number;
      completed?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const isCompleted =
      data.completed ??
      (data.totalPages > 0 && data.pageNumber >= data.totalPages);

    const { getD1 } = await import("@/server/runtime.server");
    const d1 = getD1();
    if (d1) {
      await d1
        .prepare(
          `INSERT INTO read_progress (slug, chapter_file, page_number, total_pages, completed, last_read_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(slug, chapter_file) DO UPDATE SET
             page_number = excluded.page_number,
             total_pages = excluded.total_pages,
             completed = excluded.completed,
             last_read_at = excluded.last_read_at`,
        )
        .bind(
          data.slug,
          data.chapterFile,
          data.pageNumber,
          data.totalPages,
          isCompleted ? 1 : 0,
          new Date().toISOString(),
        )
        .run();
      return { ok: true };
    }

    try {
      const { ensureDbInitialized } = await import("@/server/db.server");
      const db = await ensureDbInitialized();
      await db.execute({
        sql: `INSERT INTO read_progress (slug, chapter_file, page_number, total_pages, completed, last_read_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(slug, chapter_file) DO UPDATE SET
           page_number = excluded.page_number,
           total_pages = excluded.total_pages,
           completed = excluded.completed,
           last_read_at = excluded.last_read_at`,
        args: [
          data.slug,
          data.chapterFile,
          data.pageNumber,
          data.totalPages,
          isCompleted ? 1 : 0,
          new Date().toISOString(),
        ],
      });
    } catch (err) {
      console.warn("Could not save read progress locally:", err);
    }

    return { ok: true };
  });

/** Get reading progress records for a manga */
export const getReadProgress = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => data)
  .handler(async ({ data }): Promise<ReadProgressRecord[]> => {
    const { getD1 } = await import("@/server/runtime.server");
    const d1 = getD1();
    if (d1) {
      const res = await d1
        .prepare(
          "SELECT * FROM read_progress WHERE slug = ? ORDER BY last_read_at DESC",
        )
        .bind(data.slug)
        .all();
      return (res.results || []).map((r) => ({
        slug: String(r["slug"]),
        chapterFile: String(r["chapter_file"]),
        pageNumber: Number(r["page_number"] ?? 0),
        totalPages: Number(r["total_pages"] ?? 0),
        completed: Number(r["completed"] ?? 0) === 1,
        lastReadAt: String(r["last_read_at"]),
      }));
    }

    try {
      const { ensureDbInitialized } = await import("@/server/db.server");
      const db = await ensureDbInitialized();
      const res = await db.execute({
        sql: "SELECT * FROM read_progress WHERE slug = ? ORDER BY last_read_at DESC",
        args: [data.slug],
      });
      return res.rows.map((r) => ({
        slug: String(r["slug"]),
        chapterFile: String(r["chapter_file"]),
        pageNumber: Number(r["page_number"] ?? 0),
        totalPages: Number(r["total_pages"] ?? 0),
        completed: Number(r["completed"] ?? 0) === 1,
        lastReadAt: String(r["last_read_at"]),
      }));
    } catch {
      return [];
    }
  });

/** Get chapter page list */
export const getMangaChapterPagesInfo = createServerFn({ method: "GET" })
  .validator((data: { slug: string; chapterFile: string }) => data)
  .handler(async ({ data }) => {
    const { getMangaChapterPages } = await import("@/server/media.server");
    return await getMangaChapterPages(data.slug, data.chapterFile);
  });

/** Link a local media folder to an AniList series */
export const linkLocalFolder = createServerFn({ method: "POST" })
  .validator(
    (data: {
      mediaType: MediaType;
      mediaId: number;
      folderSlug: string;
      folderName: string;
      folderPath?: string;
      customTitle?: string;
      metaJson?: Record<string, unknown>;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { getD1 } = await import("@/server/runtime.server");
    const d1 = getD1();
    if (d1) {
      await d1
        .prepare(
          `INSERT INTO local_media_links (media_type, media_id, folder_slug, folder_name, folder_path, custom_title, linked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(media_type, media_id) DO UPDATE SET
             folder_slug = excluded.folder_slug,
             folder_name = excluded.folder_name,
             folder_path = excluded.folder_path,
             custom_title = excluded.custom_title,
             linked_at = excluded.linked_at`,
        )
        .bind(
          data.mediaType,
          data.mediaId,
          data.folderSlug,
          data.folderName,
          data.folderPath ?? "",
          data.customTitle ?? null,
          Date.now(),
        )
        .run();
      return { ok: true };
    }

    try {
      const { ensureDbInitialized } = await import("@/server/db.server");
      const db = await ensureDbInitialized();
      await db.execute({
        sql: `INSERT INTO local_media_links (media_type, media_id, folder_slug, folder_name, folder_path, custom_title, linked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(media_type, media_id) DO UPDATE SET
           folder_slug = excluded.folder_slug,
           folder_name = excluded.folder_name,
           folder_path = excluded.folder_path,
           custom_title = excluded.custom_title,
           linked_at = excluded.linked_at`,
        args: [
          data.mediaType,
          data.mediaId,
          data.folderSlug,
          data.folderName,
          data.folderPath ?? "",
          data.customTitle ?? null,
          Date.now(),
        ],
      });
    } catch (err) {
      console.warn("Could not save local media link:", err);
    }

    // If metaJson is provided, save meta.json to the folder
    if (data.metaJson && data.folderPath) {
      try {
        const { writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const metaPath = join(data.folderPath, "meta.json");
        writeFileSync(
          metaPath,
          JSON.stringify(data.metaJson, null, 2),
          "utf-8",
        );
      } catch (err) {
        console.warn("Could not write meta.json to folder:", err);
      }
    }

    // Trigger scan refresh
    const { scanLibrary } = await import("@/server/scanner.server");
    await scanLibrary();

    return { ok: true };
  });

/** Unlink a local media folder */
export const unlinkLocalFolder = createServerFn({ method: "POST" })
  .validator((data: { mediaType: MediaType; mediaId: number }) => data)
  .handler(async ({ data }) => {
    const { getD1 } = await import("@/server/runtime.server");
    const d1 = getD1();
    if (d1) {
      await d1
        .prepare(
          "DELETE FROM local_media_links WHERE media_type = ? AND media_id = ?",
        )
        .bind(data.mediaType, data.mediaId)
        .run();
      return { ok: true };
    }

    try {
      const { ensureDbInitialized } = await import("@/server/db.server");
      const db = await ensureDbInitialized();
      await db.execute({
        sql: "DELETE FROM local_media_links WHERE media_type = ? AND media_id = ?",
        args: [data.mediaType, data.mediaId],
      });
    } catch (err) {
      console.warn("Could not unlink folder:", err);
    }

    const { scanLibrary } = await import("@/server/scanner.server");
    await scanLibrary();

    return { ok: true };
  });

/** Get media configuration (paths, etc.) */
export const getMediaConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    const { loadAppConfig } = await import("@/server/config.server");
    return loadAppConfig();
  },
);

/** Update media configuration */
export const updateMediaConfig = createServerFn({ method: "POST" })
  .validator(
    (data: {
      animePath?: string;
      mangaPath?: string;
      anilistUsername?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { saveAppConfig } = await import("@/server/config.server");
    const updated = saveAppConfig(data);

    // Rescan with updated paths
    const { scanLibrary } = await import("@/server/scanner.server");
    await scanLibrary();

    return updated;
  });
