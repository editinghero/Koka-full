import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, join, parse, resolve } from "node:path";
import AdmZip from "adm-zip";
import { getScanState, naturalSort } from "./scanner.server";
import { isSafePath } from "./path-guard.server";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
]);

const MIME_MAP: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".ts": "video/mp2t",
  ".vtt": "text/vtt",
  ".srt": "text/plain",
  ".ass": "text/plain",
  ".ssa": "text/plain",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
};

export interface MangaChapterPageInfo {
  pageCount: number;
  pages: { index: number; name: string }[];
}

export function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

/**
 * Locate anime media on disk by slug
 */
export function findAnimeBySlug(slug: string) {
  const state = getScanState();
  return state.anime.find((a) => a.slug === slug);
}

/**
 * Locate manga media on disk by slug
 */
export function findMangaBySlug(slug: string) {
  const state = getScanState();
  return state.manga.find((m) => m.slug === slug);
}

/**
 * Get pages list for a manga chapter
 */
export async function getMangaChapterPages(
  slug: string,
  chapterFile: string,
): Promise<MangaChapterPageInfo> {
  const manga = findMangaBySlug(slug);
  if (!manga) throw new Error("Manga not found");

  const chapter = manga.chapters.find((c) => c.file === chapterFile);
  if (!chapter) throw new Error("Chapter not found");

  const chapterPath = join(manga.folderPath, chapter.relativePath);
  if (!isSafePath(manga.folderPath, chapterPath) || !existsSync(chapterPath)) {
    throw new Error("Chapter file does not exist");
  }

  if (chapter.format === "folder") {
    const files = readdirSync(chapterPath, { withFileTypes: true });
    const imageFiles = files
      .filter(
        (f) =>
          f.isFile() && IMAGE_EXTENSIONS.has(extname(f.name).toLowerCase()),
      )
      .map((f) => f.name)
      .sort(naturalSort);

    return {
      pageCount: imageFiles.length,
      pages: imageFiles.map((name, index) => ({ index, name })),
    };
  }

  if (chapter.format === "cbz" || chapter.format === "zip") {
    const zip = new AdmZip(chapterPath);
    const entries = zip
      .getEntries()
      .filter(
        (e) =>
          !e.isDirectory &&
          IMAGE_EXTENSIONS.has(extname(e.entryName).toLowerCase()),
      )
      .sort((a, b) => naturalSort(a.entryName, b.entryName));

    return {
      pageCount: entries.length,
      pages: entries.map((entry, index) => ({
        index,
        name: parse(entry.entryName).base,
      })),
    };
  }

  if (chapter.format === "cbr") {
    try {
      const { createExtractorFromFile } = await import("node-unrar-js");
      const extractor = await createExtractorFromFile({
        filepath: chapterPath,
      });
      const list = extractor.getFileList();
      const files = [...list.fileHeaders]
        .filter(
          (f) =>
            !f.flags.directory &&
            IMAGE_EXTENSIONS.has(extname(f.name).toLowerCase()),
        )
        .sort((a, b) => naturalSort(a.name, b.name));

      return {
        pageCount: files.length,
        pages: files.map((f, index) => ({
          index,
          name: parse(f.name).base,
        })),
      };
    } catch (err) {
      console.warn("CBR listing error:", err);
      return { pageCount: 0, pages: [] };
    }
  }

  return { pageCount: 0, pages: [] };
}

/**
 * Get single page image buffer from manga chapter
 */
export async function getMangaPageBuffer(
  slug: string,
  chapterFile: string,
  pageIndex: number,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const manga = findMangaBySlug(slug);
  if (!manga) return null;

  const chapter = manga.chapters.find((c) => c.file === chapterFile);
  if (!chapter) return null;

  const chapterPath = join(manga.folderPath, chapter.relativePath);
  if (!isSafePath(manga.folderPath, chapterPath) || !existsSync(chapterPath)) {
    return null;
  }

  if (chapter.format === "folder") {
    const files = readdirSync(chapterPath, { withFileTypes: true });
    const imageFiles = files
      .filter(
        (f) =>
          f.isFile() && IMAGE_EXTENSIONS.has(extname(f.name).toLowerCase()),
      )
      .map((f) => f.name)
      .sort(naturalSort);

    const targetFile = imageFiles[pageIndex];
    if (!targetFile) return null;

    const fullImagePath = join(chapterPath, targetFile);
    const buffer = readFileSync(fullImagePath);
    return { buffer, mimeType: getMimeType(targetFile) };
  }

  if (chapter.format === "cbz" || chapter.format === "zip") {
    const zip = new AdmZip(chapterPath);
    const entries = zip
      .getEntries()
      .filter(
        (e) =>
          !e.isDirectory &&
          IMAGE_EXTENSIONS.has(extname(e.entryName).toLowerCase()),
      )
      .sort((a, b) => naturalSort(a.entryName, b.entryName));

    const entry = entries[pageIndex];
    if (!entry) return null;

    const buffer = entry.getData();
    return { buffer, mimeType: getMimeType(entry.entryName) };
  }

  if (chapter.format === "cbr") {
    try {
      const { createExtractorFromFile } = await import("node-unrar-js");
      const extractor = await createExtractorFromFile({
        filepath: chapterPath,
      });
      const list = extractor.getFileList();
      const files = [...list.fileHeaders]
        .filter(
          (f) =>
            !f.flags.directory &&
            IMAGE_EXTENSIONS.has(extname(f.name).toLowerCase()),
        )
        .sort((a, b) => naturalSort(a.name, b.name));

      const target = files[pageIndex];
      if (!target) return null;

      const extracted = extractor.extract({ files: [target.name] });
      const filesExtracted = [...extracted.files] as unknown as {
        fileHeader: { name: string };
        extraction?: Uint8Array;
      }[];
      const fileData = filesExtracted[0];
      if (!fileData?.extraction) return null;

      const buffer = Buffer.from(fileData.extraction);
      return { buffer, mimeType: getMimeType(target.name) };
    } catch (err) {
      console.warn("CBR page extraction error:", err);
      return null;
    }
  }

  return null;
}
