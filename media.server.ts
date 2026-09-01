import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { extname, join, parse, resolve } from "node:path";
import AdmZip from "adm-zip";
import { getScanState, naturalSort, naturalSortPages } from "./scanner.server";

function getZipDirname(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.length > 0 ? parts.join("/") + "/" : "";
}

function resolveZipPath(dir: string, href: string) {
  // EPUB URLs may contain query strings/fragments and percent-encoding.
  const raw = href.trim();
  const hashIndex = raw.indexOf("#");
  const withoutFragment = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutFragment.indexOf("?");
  const pathOnly = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;

  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    // Keep the raw path if malformed percent-encoding is present.
  }

  const parts = (dir + decoded).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== "." && part !== "") {
      resolved.push(part);
    }
  }
  return resolved.join("/");
}

function parseEpubSpine(zip: AdmZip): string[] {
  const containerEntry = zip.getEntry("META-INF/container.xml");
  if (!containerEntry) throw new Error("Not a valid EPUB");
  const containerXml = containerEntry.getData().toString("utf-8");

  const rootfileMatch = containerXml.match(
    /<rootfile[^>]+full-path=["']([^"']+)["']/i,
  );
  if (!rootfileMatch) throw new Error("No rootfile found in EPUB");
  const opfPath = rootfileMatch[1];

  const opfEntry = zip.getEntry(opfPath);
  if (!opfEntry) throw new Error("OPF file not found");
  const opfContent = opfEntry.getData().toString("utf-8");

  const manifestMatch = opfContent.match(/<manifest>([\s\S]*?)<\/manifest>/i);
  const manifestItems: Record<string, string> = {};
  const manifestContent = manifestMatch ? manifestMatch[1] : opfContent;

  const itemRegex = /<item\s+([^>]+)>/gi;
  let match;
  while ((match = itemRegex.exec(manifestContent)) !== null) {
    const attrs = match[1];
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
    if (idMatch && hrefMatch) {
      manifestItems[idMatch[1]] = hrefMatch[1];
    }
  }

  const spineMatch = opfContent.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
  const spineItems: string[] = [];
  if (spineMatch) {
    const itemrefRegex = /<itemref\s+([^>]+)>/gi;
    while ((match = itemrefRegex.exec(spineMatch[1])) !== null) {
      const attrs = match[1];
      const idrefMatch = attrs.match(/idref=["']([^"']+)["']/i);
      if (idrefMatch) {
        const idref = idrefMatch[1];
        const href = manifestItems[idref];
        if (href) {
          spineItems.push(resolveZipPath(getZipDirname(opfPath), href));
        }
      }
    }
  }

  return spineItems;
}
import { isSafePath } from "./path-guard.server";

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
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".jxl": "image/jxl",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".svg": "image/svg+xml",
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".html": "text/html",
  ".xhtml": "application/xhtml+xml",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export interface MangaChapterPageInfo {
  pageCount: number;
  pages: { index: number; name: string; type?: "html" | "image" }[];
  isPdf?: boolean;
  isEpub?: boolean;
  format?: string;
}

function parseTarEntries(buffer: Buffer): { name: string; size: number; dataOffset: number }[] {
  const entries: { name: string; size: number; dataOffset: number }[] = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header[0] === 0) break;
    
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
    const name = header.toString("utf-8", 0, nameEnd).trim();
    
    const sizeStr = header.toString("utf-8", 124, 136).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;
    
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const isFile = typeFlag === "0" || typeFlag === "\0" || typeFlag === "";
    
    const dataOffset = offset + 512;
    if (isFile && IMAGE_EXTENSIONS.has(extname(name).toLowerCase()) && !name.startsWith("._")) {
      entries.push({
        name,
        size,
        dataOffset,
      });
    }
    
    const blocks = Math.ceil(size / 512);
    offset = dataOffset + blocks * 512;
  }
  entries.sort((a, b) => naturalSortPages(a.name, b.name));
  return entries;
}

function isEpubHtmlMime(mimeType: string) {
  return mimeType === "text/html" || mimeType === "application/xhtml+xml";
}

function isExternalEpubUrl(value: string) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || value.startsWith("#");
}

function buildEpubResourceUrl(slug: string, chapterFile: string, resourcePath: string) {
  const params = new URLSearchParams({
    slug,
    chapter: chapterFile,
    epubResource: resourcePath,
  });
  return `/api/stream/manga-page?${params.toString()}`;
}

function rewriteCssUrls(css: string, baseDir: string, slug: string, chapterFile: string) {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, value) => {
    const raw = String(value).trim();
    if (!raw || isExternalEpubUrl(raw) || raw.startsWith("data:")) return match;
    const resourcePath = resolveZipPath(baseDir, raw);
    return `url(${quote}${buildEpubResourceUrl(slug, chapterFile, resourcePath)}${quote})`;
  });
}

function rewriteEpubHtmlResources(html: string, currentFile: string, slug: string, chapterFile: string) {
  const baseDir = getZipDirname(currentFile);

  html = html.replace(
    /<(img|image|source|audio|video|track|iframe|object|embed|link)\b([^>]*)>/gis,
    (match, tag, attrs) => {
      const tagName = String(tag).toLowerCase();
      const isStylesheet =
        tagName === "link" && /\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["']/i.test(attrs);

      if (tagName === "link" && !isStylesheet) return match;

      let rewritten = attrs.replace(
        /\b(src|href)\s*=\s*(["'])(.*?)\2/gi,
        (attrMatch: string, attrName: string, quote: string, value: string) => {
          if (isExternalEpubUrl(value) || value.startsWith("data:") || value.startsWith("#")) {
            return attrMatch;
          }
          const resourcePath = resolveZipPath(baseDir, value);
          return `${attrName}=${quote}${buildEpubResourceUrl(slug, chapterFile, resourcePath)}${quote}`;
        },
      );

      rewritten = rewritten.replace(
        /\bsrcset\s*=\s*(["'])(.*?)\1/gi,
        (attrMatch: string, quote: string, value: string) => {
          const entries = String(value)
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
              const parts = entry.split(/\s+/);
              const rawUrl = parts.shift() || "";
              if (!rawUrl || isExternalEpubUrl(rawUrl) || rawUrl.startsWith("data:") || rawUrl.startsWith("#")) {
                return entry;
              }
              const resourcePath = resolveZipPath(baseDir, rawUrl);
              return [buildEpubResourceUrl(slug, chapterFile, resourcePath), ...parts].join(" ");
            });
          return `srcset=${quote}${entries.join(", ")}${quote}`;
        },
      );

      if (/\bstyle\s*=\s*["']/i.test(rewritten)) {
        rewritten = rewritten.replace(
          /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi,
          (attrMatch: string, quote: string, css: string) =>
            `style=${quote}${rewriteCssUrls(css, baseDir, slug, chapterFile)}${quote}`,
        );
      }

      return `<${tag}${rewritten}>`;
    },
  );

  // Cover/resource links can also appear in inline style blocks.
  html = html.replace(
    /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
    (match, css) => `<style>${rewriteCssUrls(css, baseDir, slug, chapterFile)}</style>`,
  );

  return html;
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
  const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (
    state.manga.find((m) => m.slug === slug) ||
    state.manga.find((m) => m.slug === clean) ||
    state.manga.find((m) => m.folderName.toLowerCase() === slug.toLowerCase()) ||
    state.manga.find((m) => m.slug.startsWith(clean) || clean.startsWith(m.slug)) ||
    state.manga.find(
      (m) =>
        m.folderName.toLowerCase().includes(slug.toLowerCase()) ||
        slug.toLowerCase().includes(m.folderName.toLowerCase()),
    )
  );
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

  const decodedChapter = decodeURIComponent(chapterFile);
  const chapter =
    manga.chapters.find(
      (c) =>
        c.file === chapterFile ||
        c.file === decodedChapter ||
        c.relativePath === chapterFile ||
        c.label === chapterFile ||
        c.file.toLowerCase() === chapterFile.toLowerCase() ||
        c.file.toLowerCase() === decodedChapter.toLowerCase(),
    ) || (manga.chapters.length === 1 ? manga.chapters[0] : undefined);

  if (!chapter) throw new Error("Chapter not found");

  let chapterPath = "";
  if (existsSync(manga.folderPath) && statSync(manga.folderPath).isFile()) {
    chapterPath = manga.folderPath;
  } else {
    chapterPath = join(manga.folderPath, chapter.relativePath || chapterFile);
    if (!existsSync(chapterPath)) {
      chapterPath = join(manga.folderPath, decodedChapter);
    }
  }

  if (!existsSync(chapterPath)) {
    throw new Error("Chapter file does not exist");
  }

  if (chapter.format === "pdf" || chapterPath.toLowerCase().endsWith(".pdf")) {
    return {
      pageCount: 1,
      pages: [{ index: 0, name: parse(chapterFile).name }],
      isPdf: true,
      format: "pdf",
    };
  }

  if (chapter.format === "epub" || chapterPath.toLowerCase().endsWith(".epub")) {
    try {
      const zip = new AdmZip(chapterPath);
      const spineItems = parseEpubSpine(zip);
      
      // The EPUB spine can legally contain both document (XHTML/HTML) and
      // image items. Keep them in spine order, but label the page type so the
      // frontend never decodes an image as HTML.
      const chosenEntries = spineItems.filter((e) =>
        /\.(xhtml|html|htm|svg|jpe?g|png|webp|gif|avif|bmp|tiff?|jxl|heic|heif)$/i.test(e),
      );

      return {
        pageCount: chosenEntries.length,
        pages: chosenEntries.map((e, index) => ({
          index,
          name: parse(e).base,
          type: /\.(xhtml|html|htm)$/i.test(e) ? "html" : "image",
        })),
        isEpub: true,
        format: "epub",
      };
    } catch {
      return { pageCount: 1, pages: [{ index: 0, name: parse(chapterFile).name }], isEpub: true, format: "epub" };
    }
  }

  if (chapter.format === "cbt" || chapterPath.toLowerCase().endsWith(".cbt") || chapterPath.toLowerCase().endsWith(".tar")) {
    const buffer = readFileSync(chapterPath);
    const entries = parseTarEntries(buffer);
    return {
      pageCount: entries.length,
      pages: entries.map((entry, index) => ({
        index,
        name: parse(entry.name).base,
      })),
      format: "cbt",
    };
  }

  if (chapter.format === "folder") {
    const files = readdirSync(chapterPath, { withFileTypes: true });
    const imageFiles = files
      .filter(
        (f) =>
          f.isFile() && IMAGE_EXTENSIONS.has(extname(f.name).toLowerCase()),
      )
      .map((f) => f.name)
      .sort(naturalSortPages);

    return {
      pageCount: imageFiles.length,
      pages: imageFiles.map((name, index) => ({ index, name })),
      format: "folder",
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
      .sort((a, b) => naturalSortPages(a.entryName, b.entryName));

    return {
      pageCount: entries.length,
      pages: entries.map((entry, index) => ({
        index,
        name: parse(entry.entryName).base,
      })),
      format: chapter.format,
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
        .sort((a, b) => naturalSortPages(a.name, b.name));

      return {
        pageCount: files.length,
        pages: files.map((f, index) => ({
          index,
          name: parse(f.name).base,
        })),
        format: "cbr",
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
  epubResourcePath?: string | null,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const manga = findMangaBySlug(slug);
  if (!manga) return null;

  const decodedChapter = decodeURIComponent(chapterFile);
  const chapter =
    manga.chapters.find(
      (c) =>
        c.file === chapterFile ||
        c.file === decodedChapter ||
        c.relativePath === chapterFile ||
        c.label === chapterFile ||
        c.file.toLowerCase() === chapterFile.toLowerCase() ||
        c.file.toLowerCase() === decodedChapter.toLowerCase(),
    ) || (manga.chapters.length === 1 ? manga.chapters[0] : undefined);

  if (!chapter) return null;

  let chapterPath = "";
  if (existsSync(manga.folderPath) && statSync(manga.folderPath).isFile()) {
    chapterPath = manga.folderPath;
  } else {
    chapterPath = join(manga.folderPath, chapter.relativePath || chapterFile);
    if (!existsSync(chapterPath)) {
      chapterPath = join(manga.folderPath, decodedChapter);
    }
  }

  if (!existsSync(chapterPath)) {
    return null;
  }

  if (chapter.format === "pdf" || chapterPath.toLowerCase().endsWith(".pdf")) {
    const buffer = readFileSync(chapterPath);
    return { buffer, mimeType: "application/pdf" };
  }

  if (chapter.format === "epub" || chapterPath.toLowerCase().endsWith(".epub")) {
    const zip = new AdmZip(chapterPath);
    
    if (epubResourcePath) {
      const entry = zip.getEntry(epubResourcePath);
      if (!entry) return null;
      return { buffer: entry.getData(), mimeType: getMimeType(entry.entryName) };
    }

    const spineItems = parseEpubSpine(zip);
    const chosenEntries = spineItems.filter((e) =>
      /\.(xhtml|html|htm|svg|jpe?g|png|webp|gif|avif|bmp|tiff?|jxl|heic|heif)$/i.test(e),
    );
    const currentFile = chosenEntries[pageIndex];
    if (!currentFile) return null;

    const entry = zip.getEntry(currentFile);
    if (!entry) return null;

    let buffer = entry.getData();
    const mimeType = getMimeType(entry.entryName);
    
    // Rewrite image sources in HTML to point to our stream endpoint
    if (isEpubHtmlMime(mimeType)) {
      buffer = Buffer.from(
        rewriteEpubHtmlResources(buffer.toString("utf-8"), currentFile, slug, chapterFile),
        "utf-8",
      );
    } else if (mimeType === "text/css") {
      buffer = Buffer.from(
        rewriteCssUrls(buffer.toString("utf-8"), getZipDirname(currentFile), slug, chapterFile),
        "utf-8",
      );
    }

    return { buffer, mimeType };
  }

  if (chapter.format === "cbt" || chapterPath.toLowerCase().endsWith(".cbt") || chapterPath.toLowerCase().endsWith(".tar")) {
    const fileBuffer = readFileSync(chapterPath);
    const entries = parseTarEntries(fileBuffer);
    const entry = entries[pageIndex];
    if (!entry) return null;

    const buffer = fileBuffer.subarray(entry.dataOffset, entry.dataOffset + entry.size);
    return { buffer, mimeType: getMimeType(entry.name) };
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
