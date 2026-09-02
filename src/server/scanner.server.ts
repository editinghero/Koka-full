import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
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
  group?: string | undefined;
  format: "folder" | "cbz" | "zip" | "cbr" | "cb7" | "cbt" | "pdf" | "epub" | "txt" | "docx" | "doc" | "images";
  pageCount?: number | undefined;
}

export interface MangaGroup {
  name: string;
  chapters: MangaChapter[];
}

export interface ScannedManga {
  slug: string;
  folderName: string;
  folderPath: string;
  statusFolder?: string | undefined;
  chapters: MangaChapter[];
  groups?: MangaGroup[] | undefined;
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
  ".bmp",
  ".tiff",
  ".tif",
  ".jxl",
  ".heic",
  ".heif",
]);
const ARCHIVE_EXTENSIONS = new Set([
  ".cbz",
  ".zip",
  ".cbr",
  ".rar",
  ".cb7",
  ".7z",
  ".cbt",
  ".tar",
  ".pdf",
  ".epub",
  ".txt",
  ".docx",
  ".doc",
]);

export function getMangaFormat(filename: string): MangaChapter["format"] {
  const ext = extname(filename).toLowerCase();
  if (ext === ".cbz") return "cbz";
  if (ext === ".zip") return "zip";
  if (ext === ".cbr" || ext === ".rar") return "cbr";
  if (ext === ".cb7" || ext === ".7z") return "cb7";
  if (ext === ".cbt" || ext === ".tar") return "cbt";
  if (ext === ".pdf") return "pdf";
  if (ext === ".epub") return "epub";
  if (ext === ".txt") return "txt";
  if (ext === ".docx") return "docx";
  if (ext === ".doc") return "doc";
  return "zip";
}

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

export function extractPageNumber(filename: string): number | null {
  const base = parse(filename).name;
  const matches = base.match(/(\d+(?:\.\d+)?)/g);
  if (matches && matches.length > 0) {
    const num = parseFloat(matches[matches.length - 1]!);
    if (!isNaN(num)) return num;
  }
  return null;
}

export function naturalSortPages(a: string, b: string): number {
  const numA = extractPageNumber(a);
  const numB = extractPageNumber(b);

  if (numA !== null && numB !== null && numA !== numB) {
    return numA - numB;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
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

/**
 * Returns true if the dirent is a real directory OR a symlink/junction that
 * resolves to a directory. This lets the scanner follow Windows junctions and
 * Unix symlinks transparently.
 */
function isDirEntry(entry: Dirent, parentPath: string): boolean {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return statSync(join(parentPath, entry.name)).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Returns true if the dirent is a real file OR a symlink that resolves to a
 * file. Needed because symlinked files return isSymbolicLink()=true and
 * isFile()=false on Windows junction / Unix symlink scenarios.
 */
function isFileEntry(entry: Dirent, parentPath: string): boolean {
  if (entry.isFile()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return statSync(join(parentPath, entry.name)).isFile();
    } catch {
      return false;
    }
  }
  return false;
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

  function scanAnimeSubDir(currentDir: string, relativeDir: string = "") {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    const videos: string[] = [];
    const subtitles: string[] = [];

    for (const item of entries) {
      if (item.name.startsWith(".")) continue;
      if (isFileEntry(item, currentDir)) {
        const ext = extname(item.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) {
          videos.push(item.name);
        } else if (SUBTITLE_EXTENSIONS.has(ext)) {
          subtitles.push(item.name);
        }
      }
    }

    if (videos.length > 0) {
      const seasonName = relativeDir ? relativeDir.replace(/\\/g, "/") : "Season 1";
      const episodes: AnimeEpisode[] = videos.map((f) => {
        const base = parse(f).name;
        const subs = subtitles
          .filter((sub) => {
            const subBase = parse(sub).name;
            return subBase === base || subBase.startsWith(base);
          })
          .map((s) => (relativeDir ? join(relativeDir, s) : s).replace(/\\/g, "/"));

        return {
          file: f,
          label: base,
          season: seasonName,
          relativePath: (relativeDir ? join(relativeDir, f) : f).replace(/\\/g, "/"),
          subtitles: subs,
        };
      });

      episodes.sort((a, b) => naturalSort(a.file, b.file));
      seasons.push({ name: seasonName, episodes });
      totalEpisodes += episodes.length;
    }

    // Recurse into subdirectories
    for (const item of entries) {
      if (item.name.startsWith(".") || IGNORE_DIRS.has(item.name.toLowerCase())) continue;
      if (isDirEntry(item, currentDir)) {
        const subPath = join(currentDir, item.name);
        const subRelPath = relativeDir ? join(relativeDir, item.name).replace(/\\/g, "/") : item.name;
        scanAnimeSubDir(subPath, subRelPath);
      }
    }
  }

  scanAnimeSubDir(titlePath);

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

  function scanDirRecursive(currentDir: string, relativeDir: string = "") {
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // 1. Collect all archive / novel / document files in this directory
    const groupName = relativeDir ? relativeDir.replace(/\\/g, "/") : "Main";
    for (const item of entries) {
      if (item.name.startsWith(".")) continue;
      const relPath = relativeDir ? join(relativeDir, item.name).replace(/\\/g, "/") : item.name;

      if (isFileEntry(item, currentDir)) {
        const ext = extname(item.name).toLowerCase();
        if (ARCHIVE_EXTENSIONS.has(ext)) {
          chapters.push({
            file: relPath,
            label: parse(item.name).name,
            relativePath: relPath,
            group: groupName,
            format: getMangaFormat(item.name),
          });
        }
      }
    }

    // 2. Inspect subdirectories
    for (const item of entries) {
      if (item.name.startsWith(".") || IGNORE_DIRS.has(item.name.toLowerCase())) continue;
      if (isDirEntry(item, currentDir)) {
        const subPath = join(currentDir, item.name);
        const relPath = relativeDir ? join(relativeDir, item.name).replace(/\\/g, "/") : item.name;

        try {
          const subEntries = readdirSync(subPath, { withFileTypes: true });
          const imageFiles = subEntries.filter(
            (f) => isFileEntry(f, subPath) && IMAGE_EXTENSIONS.has(extname(f.name).toLowerCase()),
          );
          const hasChildDirs = subEntries.some((d) => isDirEntry(d, subPath) && !d.name.startsWith("."));
          const hasChildDocs = subEntries.some((f) => isFileEntry(f, subPath) && ARCHIVE_EXTENSIONS.has(extname(f.name).toLowerCase()));

          if (imageFiles.length > 0 && !hasChildDirs && !hasChildDocs) {
            // Pure chapter folder of images
            chapters.push({
              file: relPath,
              label: item.name,
              relativePath: relPath,
              group: groupName,
              format: "folder",
              pageCount: imageFiles.length,
            });
          } else {
            // Volume folder or mixed folder — recurse inside
            scanDirRecursive(subPath, relPath);
          }
        } catch {
          /* ignore unreadable directory */
        }
      }
    }
  }

  scanDirRecursive(titlePath);

  // If no archive or chapter subfolders found, check for direct loose images in the root title folder
  if (chapters.length === 0) {
    try {
      const rootEntries = readdirSync(titlePath, { withFileTypes: true });
      const looseImages = rootEntries.filter(
        (f) => isFileEntry(f, titlePath) && IMAGE_EXTENSIONS.has(extname(f.name).toLowerCase()),
      );
      if (looseImages.length > 0) {
        chapters.push({
          file: folderName,
          label: folderName,
          relativePath: "",
          group: "Main",
          format: "folder",
          pageCount: looseImages.length,
        });
      }
    } catch {
      /* ignore */
    }
  }

  // Natural sort chapters
  chapters.sort((a, b) => naturalSort(a.file, b.file));

  // Build folder/volume groups (just like anime seasons)
  const groupMap = new Map<string, MangaChapter[]>();
  for (const ch of chapters) {
    const g = ch.group || "Main";
    if (!groupMap.has(g)) groupMap.set(g, []);
    groupMap.get(g)!.push(ch);
  }
  const groups: MangaGroup[] = Array.from(groupMap.entries())
    .map(([name, chs]) => ({ name, chapters: chs }))
    .sort((a, b) => naturalSort(a.name, b.name));

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
    groups,
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
          !isDirEntry(entry, animeRoot) ||
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
              isDirEntry(d, statusDir) &&
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

    // 2. Scan Manga & Novel Library
    const mangaRoots = [
      resolvePath(config.mangaPath),
      ...(config.novelPath ? [resolvePath(config.novelPath)] : []),
    ];

    for (const mangaRoot of mangaRoots) {
      if (!existsSync(mangaRoot)) continue;
      const rootEntries = readdirSync(mangaRoot, { withFileTypes: true });

      for (const entry of rootEntries) {
        if (
          !isDirEntry(entry, mangaRoot) ||
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
              isDirEntry(d, statusDir) &&
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
          // Direct manga / novel folder
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

      // Scan standalone files placed directly in manga/novel root
      const rootArchives = rootEntries.filter(
        (f) =>
          isFileEntry(f, mangaRoot) &&
          ARCHIVE_EXTENSIONS.has(extname(f.name).toLowerCase()),
      );
      for (const file of rootArchives) {
        const baseName = parse(file.name).name;
        const slug = toSlug(baseName);
        const format = getMangaFormat(file.name);

        const mediaId =
          mangaLinks?.get(slug) ?? mangaLinks?.get(baseName.toLowerCase());

        scannedManga.push({
          slug,
          folderName: baseName,
          folderPath: join(mangaRoot, file.name),
          chapters: [
            {
              file: file.name,
              label: baseName,
              relativePath: file.name,
              format,
            },
          ],
          chapterCount: 1,
          hasLocalPoster: false,
          hasLocalBanner: false,
          mediaId,
        });
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
