import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, parse, resolve } from "node:path";
import { ensureDbInitialized } from "./db.server";
import { loadAppConfig } from "./config.server";
import type { AnimeMedia, MediaType } from "@/lib/types";

export interface AnimeEpisode {
  file: string;
  label: string;
  season: string;
  relativePath: string;
  subtitles: string[];
}

export interface AnimeSeason {
  name: string;
  episodes: AnimeEpisode[];
}

export interface ScannedAnime {
  slug: string;
  folderName: string;
  folderPath: string;
  statusFolder?: string | undefined;
  seasons: AnimeSeason[];
  episodeCount: number;
  hasLocalPoster: boolean;
  hasLocalBanner: boolean;
  mediaId?: number | undefined;
  metadata?: AnimeMedia | undefined;
}

export interface MangaChapter {
  file: string;
  label: string;
  relativePath: string;
  format: "folder" | "cbz" | "zip" | "cbr";
  pageCount?: number | undefined;
}

export interface ScannedManga {
  slug: string;
  folderName: string;
  folderPath: string;
  statusFolder?: string | undefined;
  chapters: MangaChapter[];
  chapterCount: number;
  hasLocalPoster: boolean;
  hasLocalBanner: boolean;
  mediaId?: number | undefined;
  metadata?: AnimeMedia | undefined;
}

export interface LibraryScanState {
  anime: ScannedAnime[];
  manga: ScannedManga[];
  lastScannedAt: number;
  isScanning: boolean;
}

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".avi",
  ".mov",
  ".flv",
  ".ts",
  ".m4v",
]);
const SUBTITLE_EXTENSIONS = new Set([".vtt", ".srt", ".ass", ".ssa"]);
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
]);
const ARCHIVE_EXTENSIONS = new Set([".cbz", ".zip", ".cbr", ".rar"]);

const STATUS_FOLDERS = [
  "watching",
  "planned",
  "finished",
  "completed",
  "dropped",
  "on_hold",
  "reading",
  "paused",
];

// In-memory cached scan state
let globalScanState: LibraryScanState = {
  anime: [],
  manga: [],
  lastScannedAt: 0,
  isScanning: false,
};

export function getScanState(): LibraryScanState {
  return globalScanState;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function resolvePath(p: string): string {
  if (p.startsWith("./") || p.startsWith("../")) {
    return resolve(process.cwd(), p);
  }
  return resolve(p);
}

function cleanTitle(folderName: string): string {
  return folderName
    .replace(/\[.*?\]|\(.*?\)/g, "")
    .replace(/[_.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scanAnimeTitleFolder(
  titlePath: string,
  folderName: string,
  statusFolder?: string,
  linkMap?: Map<string, number>,
): ScannedAnime {
  const slug = toSlug(folderName);
  const seasons: AnimeSeason[] = [];
  let totalEpisodes = 0;

  const entries = readdirSync(titlePath, { withFileTypes: true });

  const rootVideos: string[] = [];
  const rootSubtitles: string[] = [];
  const seasonDirs: { name: string; path: string }[] = [];

  for (const item of entries) {
    if (item.name.startsWith(".")) continue;

    if (item.isFile()) {
      const ext = extname(item.name).toLowerCase();
      if (VIDEO_EXTENSIONS.has(ext)) {
        rootVideos.push(item.name);
      } else if (SUBTITLE_EXTENSIONS.has(ext)) {
        rootSubtitles.push(item.name);
      }
    } else if (item.isDirectory()) {
      const lower = item.name.toLowerCase();
      if (
        lower.startsWith("season") ||
        lower.startsWith("s1") ||
        lower.startsWith("s2") ||
        lower.startsWith("s3") ||
        lower.startsWith("s4") ||
        lower.startsWith("s0") ||
        lower.startsWith("specials") ||
        lower.startsWith("ova") ||
        lower.startsWith("movie") ||
        lower.includes("season")
      ) {
        seasonDirs.push({ name: item.name, path: join(titlePath, item.name) });
      }
    }
  }

  // If there are video files directly in the title folder
  if (rootVideos.length > 0) {
    const episodes: AnimeEpisode[] = rootVideos.map((file) => {
      const base = parse(file).name;
      const subs = rootSubtitles.filter((sub) => {
        const subBase = parse(sub).name;
        return subBase === base || subBase.startsWith(base);
      });

      return {
        file,
        label: base,
        season: "Season 1",
        relativePath: file,
        subtitles: subs,
      };
    });

    episodes.sort((a, b) => naturalSort(a.file, b.file));
    seasons.push({ name: "Season 1", episodes });
    totalEpisodes += episodes.length;
  }

  // Scan subfolders (seasons)
  for (const dir of seasonDirs) {
    try {
      const sEntries = readdirSync(dir.path, { withFileTypes: true });
      const sVideos: string[] = [];
      const sSubtitles: string[] = [];

      for (const item of sEntries) {
        if (item.name.startsWith(".")) continue;
        if (item.isFile()) {
          const ext = extname(item.name).toLowerCase();
          if (VIDEO_EXTENSIONS.has(ext)) {
            sVideos.push(item.name);
          } else if (SUBTITLE_EXTENSIONS.has(ext)) {
            sSubtitles.push(item.name);
          }
        }
      }

      if (sVideos.length > 0) {
        const episodes: AnimeEpisode[] = sVideos.map((f) => {
          const base = parse(f).name;
          const subs = sSubtitles
            .filter((sub) => {
              const subBase = parse(sub).name;
              return subBase === base || subBase.startsWith(base);
            })
            .map((s) => join(dir.name, s).replace(/\\/g, "/"));

          return {
            file: f,
            label: base,
            season: dir.name,
            relativePath: join(dir.name, f).replace(/\\/g, "/"),
            subtitles: subs,
          };
        });

        episodes.sort((a, b) => naturalSort(a.file, b.file));
        seasons.push({ name: dir.name, episodes });
        totalEpisodes += episodes.length;
      }
    } catch {
      /* ignore unreadable season */
    }
  }

  // Sort seasons naturally (Season 1 before Season 2)
  seasons.sort((a, b) => naturalSort(a.name, b.name));

  const hasLocalPoster =
    existsSync(join(titlePath, "poster.jpg")) ||
    existsSync(join(titlePath, "poster.png")) ||
    existsSync(join(titlePath, "poster.webp")) ||
    existsSync(join(titlePath, "cover.jpg")) ||
    existsSync(join(titlePath, "cover.png"));

  const hasLocalBanner =
    existsSync(join(titlePath, "banner.jpg")) ||
    existsSync(join(titlePath, "banner.png")) ||
    existsSync(join(titlePath, "banner.webp"));

  // Check meta.json
  let metadata: AnimeMedia | undefined;
  let mediaId: number | undefined;
  const metaPath = join(titlePath, "meta.json");
  if (existsSync(metaPath)) {
    try {
      const raw = readFileSync(metaPath, "utf-8");
      const meta = JSON.parse(raw);
      if (meta?.id) {
        mediaId = Number(meta.id);
        metadata = meta;
      }
    } catch {
      /* ignore invalid meta.json */
    }
  }

  // Check link map
  if (!mediaId && linkMap) {
    mediaId = linkMap.get(slug) ?? linkMap.get(folderName.toLowerCase());
  }

  return {
    slug,
    folderName,
    folderPath: titlePath,
    statusFolder,
    seasons,
    episodeCount: totalEpisodes,
    hasLocalPoster,
    hasLocalBanner,
    mediaId,
    metadata,
  };
}

function scanMangaTitleFolder(
  titlePath: string,
  folderName: string,
  statusFolder?: string,
  linkMap?: Map<string, number>,
): ScannedManga {
  const slug = toSlug(folderName);
  const chapters: MangaChapter[] = [];

  const entries = readdirSync(titlePath, { withFileTypes: true });

  for (const item of entries) {
    if (item.name.startsWith(".")) continue;

    if (item.isFile()) {
      const ext = extname(item.name).toLowerCase();
      if (ARCHIVE_EXTENSIONS.has(ext)) {
        const format = (
          ext === ".cbr" || ext === ".rar"
            ? "cbr"
            : ext === ".cbz"
              ? "cbz"
              : "zip"
        ) as MangaChapter["format"];
        chapters.push({
          file: item.name,
          label: parse(item.name).name,
          relativePath: item.name,
          format,
        });
      }
    } else if (item.isDirectory()) {
      // Subdirectory containing images (e.g. Chapter 1 folder)
      const subPath = join(titlePath, item.name);
      try {
        const subFiles = readdirSync(subPath, { withFileTypes: true });
        const imageCount = subFiles.filter(
          (f) =>
            f.isFile() && IMAGE_EXTENSIONS.has(extname(f.name).toLowerCase()),
        ).length;

        if (imageCount > 0) {
          chapters.push({
            file: item.name,
            label: item.name,
            relativePath: item.name,
            format: "folder",
            pageCount: imageCount,
          });
        }
      } catch {
        /* ignore unreadable directory */
      }
    }
  }

  // Natural sort chapters
  chapters.sort((a, b) => naturalSort(a.file, b.file));

  const hasLocalPoster =
    existsSync(join(titlePath, "poster.jpg")) ||
    existsSync(join(titlePath, "poster.png")) ||
    existsSync(join(titlePath, "poster.webp")) ||
    existsSync(join(titlePath, "cover.jpg")) ||
    existsSync(join(titlePath, "cover.png"));

  const hasLocalBanner =
    existsSync(join(titlePath, "banner.jpg")) ||
    existsSync(join(titlePath, "banner.png")) ||
    existsSync(join(titlePath, "banner.webp"));

  let metadata: AnimeMedia | undefined;
  let mediaId: number | undefined;
  const metaPath = join(titlePath, "meta.json");
  if (existsSync(metaPath)) {
    try {
      const raw = readFileSync(metaPath, "utf-8");
      const meta = JSON.parse(raw);
      if (meta?.id) {
        mediaId = Number(meta.id);
        metadata = meta;
      }
    } catch {
      /* ignore */
    }
  }

  if (!mediaId && linkMap) {
    mediaId = linkMap.get(slug) ?? linkMap.get(folderName.toLowerCase());
  }

  return {
    slug,
    folderName,
    folderPath: titlePath,
    statusFolder,
    chapters,
    chapterCount: chapters.length,
    hasLocalPoster,
    hasLocalBanner,
    mediaId,
    metadata,
  };
}

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "src",
  "db",
  "public",
  "scripts",
  ".data",
  ".wrangler",
  "anistash-play",
  ".git",
  ".vscode",
  ".idea",
  ".nitro",
  ".output",
  "dist-ssr",
]);

export async function scanLibrary(): Promise<LibraryScanState> {
  if (globalScanState.isScanning) {
    return globalScanState;
  }

  globalScanState.isScanning = true;
  const config = loadAppConfig();

  const scannedAnime: ScannedAnime[] = [];
  const scannedManga: ScannedManga[] = [];

  const animeLinks = new Map<string, number>();
  const mangaLinks = new Map<string, number>();

  try {
    const db = await ensureDbInitialized();
    const linksRes = await db.execute(
      "SELECT media_type, media_id, folder_slug, folder_name FROM local_media_links",
    );
    for (const r of linksRes.rows) {
      const mType = String(r["media_type"]);
      const mId = Number(r["media_id"]);
      const slug = String(r["folder_slug"]);
      const name = String(r["folder_name"]).toLowerCase();

      if (mType === "ANIME") {
        animeLinks.set(slug, mId);
        animeLinks.set(name, mId);
      } else {
        mangaLinks.set(slug, mId);
        mangaLinks.set(name, mId);
      }
    }
  } catch (err) {
    console.warn("Could not load local_media_links:", err);
  }

  try {
    // 1. Scan Anime Library
    const animeRoot = resolvePath(config.animePath);
    if (existsSync(animeRoot)) {
      const rootEntries = readdirSync(animeRoot, { withFileTypes: true });

      for (const entry of rootEntries) {
        if (
          !entry.isDirectory() ||
          entry.name.startsWith(".") ||
          IGNORE_DIRS.has(entry.name.toLowerCase())
        )
          continue;

        const lowerName = entry.name.toLowerCase();
        if (STATUS_FOLDERS.includes(lowerName)) {
          // Status subfolder like watching/finished
          const statusDir = join(animeRoot, entry.name);
          const titleDirs = readdirSync(statusDir, {
            withFileTypes: true,
          }).filter(
            (d) =>
              d.isDirectory() &&
              !d.name.startsWith(".") &&
              !IGNORE_DIRS.has(d.name.toLowerCase()),
          );
          for (const td of titleDirs) {
            const titlePath = join(statusDir, td.name);
            const anime = scanAnimeTitleFolder(
              titlePath,
              td.name,
              entry.name,
              animeLinks,
            );
            if (anime.episodeCount > 0) {
              scannedAnime.push(anime);
            }
          }
        } else {
          // Direct series folder
          const titlePath = join(animeRoot, entry.name);
          const anime = scanAnimeTitleFolder(
            titlePath,
            entry.name,
            undefined,
            animeLinks,
          );
          if (anime.episodeCount > 0) {
            scannedAnime.push(anime);
          }
        }
      }
    }

    // 2. Scan Manga Library
    const mangaRoot = resolvePath(config.mangaPath);
    if (existsSync(mangaRoot)) {
      const rootEntries = readdirSync(mangaRoot, { withFileTypes: true });

      for (const entry of rootEntries) {
        if (
          !entry.isDirectory() ||
          entry.name.startsWith(".") ||
          IGNORE_DIRS.has(entry.name.toLowerCase())
        )
          continue;

        const lowerName = entry.name.toLowerCase();
        if (STATUS_FOLDERS.includes(lowerName)) {
          // Status subfolder like reading/completed
          const statusDir = join(mangaRoot, entry.name);
          const titleDirs = readdirSync(statusDir, {
            withFileTypes: true,
          }).filter(
            (d) =>
              d.isDirectory() &&
              !d.name.startsWith(".") &&
              !IGNORE_DIRS.has(d.name.toLowerCase()),
          );
          for (const td of titleDirs) {
            const titlePath = join(statusDir, td.name);
            const manga = scanMangaTitleFolder(
              titlePath,
              td.name,
              entry.name,
              mangaLinks,
            );
            if (manga.chapterCount > 0) {
              scannedManga.push(manga);
            }
          }
        } else {
          // Direct manga folder
          const titlePath = join(mangaRoot, entry.name);
          const manga = scanMangaTitleFolder(
            titlePath,
            entry.name,
            undefined,
            mangaLinks,
          );
          if (manga.chapterCount > 0) {
            scannedManga.push(manga);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error scanning media library:", err);
  } finally {
    globalScanState = {
      anime: scannedAnime,
      manga: scannedManga,
      lastScannedAt: Date.now(),
      isScanning: false,
    };
  }

  return globalScanState;
}

export function findAnimeByMediaId(mediaId: number): ScannedAnime | undefined {
  return globalScanState.anime.find((a) => a.mediaId === mediaId);
}

export function findMangaByMediaId(mediaId: number): ScannedManga | undefined {
  return globalScanState.manga.find((m) => m.mediaId === mediaId);
}

export function findAnimeBySlug(slug: string): ScannedAnime | undefined {
  return globalScanState.anime.find((a) => a.slug === slug);
}

export function findMangaBySlug(slug: string): ScannedManga | undefined {
  return globalScanState.manga.find((m) => m.slug === slug);
}
