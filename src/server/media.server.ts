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
  ".svg",
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
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".html": "text/html",
  ".xhtml": "application/xhtml+xml",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".css": "text/css",
  ".xml": "application/xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
};

export interface MangaChapterPageInfo {
  pageCount: number;
  pages: { index: number; name: string; type?: "html" | "image" | "text" }[];
  isPdf?: boolean;
  isEpub?: boolean;
  isNovel?: boolean;
  isDocx?: boolean;
  isTxt?: boolean;
  format?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseTxtToPages(content: string): { title: string; html: string }[] {
  const text = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");

  const chapterRegex = /^(?:chapter|volume|prologue|epilogue|act|scene|part|section|interlude|side\s*story|\#+\s|第[0-9一二三四五六七八九十百千万]+[章|話|節|卷|巻])\b/i;

  const pages: { title: string; html: string }[] = [];
  let currentTitle = "Chapter 1";
  let currentParagraphs: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] || "").trim();
    if (chapterRegex.test(line) && currentParagraphs.length > 0) {
      const html = `<div class="novel-page font-serif leading-relaxed space-y-4 max-w-3xl mx-auto p-4 md:p-8"><h2 class="text-xl md:text-2xl font-bold mb-6">${escapeHtml(currentTitle)}</h2>` +
        currentParagraphs.map((p) => `<p class="text-base md:text-lg">${escapeHtml(p)}</p>`).join("") +
        `</div>`;
      pages.push({ title: currentTitle, html });
      currentTitle = line;
      currentParagraphs = [];
      continue;
    }

    if (line.length > 0) {
      currentParagraphs.push(line);
    }

    if (currentParagraphs.length >= 80) {
      const html = `<div class="novel-page font-serif leading-relaxed space-y-4 max-w-3xl mx-auto p-4 md:p-8"><h2 class="text-xl md:text-2xl font-bold mb-6">${escapeHtml(currentTitle)}</h2>` +
        currentParagraphs.map((p) => `<p class="text-base md:text-lg">${escapeHtml(p)}</p>`).join("") +
        `</div>`;
      pages.push({ title: currentTitle, html });
      currentParagraphs = [];
      currentTitle = `Page ${pages.length + 1}`;
    }
  }

  if (currentParagraphs.length > 0) {
    const html = `<div class="novel-page font-serif leading-relaxed space-y-4 max-w-3xl mx-auto p-4 md:p-8"><h2 class="text-xl md:text-2xl font-bold mb-6">${escapeHtml(currentTitle)}</h2>` +
      currentParagraphs.map((p) => `<p class="text-base md:text-lg">${escapeHtml(p)}</p>`).join("") +
      `</div>`;
    pages.push({ title: currentTitle, html });
  }

  if (pages.length === 0) {
    pages.push({
      title: "Content",
      html: `<div class="novel-page font-serif leading-relaxed space-y-4 max-w-3xl mx-auto p-4 md:p-8"><p class="text-muted-foreground italic">Empty document</p></div>`,
    });
  }

  return pages;
}

function findZipEntry(zip: AdmZip, targetPath: string): AdmZip.IZipEntry | null {
  const cleanTarget = targetPath.replace(/\\/g, "/").replace(/^\//, "").trim();
  const exact = zip.getEntry(cleanTarget) || zip.getEntry(targetPath);
  if (exact) return exact;

  const targetNorm = cleanTarget.toLowerCase();
  const all = zip.getEntries();
  return (
    all.find((e) => {
      const eNorm = e.entryName.replace(/\\/g, "/").toLowerCase().trim().replace(/^\//, "");
      return eNorm === targetNorm || eNorm.endsWith("/" + targetNorm);
    }) || null
  );
}

function parseDocxDocument(
  zip: AdmZip,
  slug: string,
  chapterFile: string,
): { pages: { title: string; html: string }[]; mediaEntries: Set<string> } {
  const mediaEntries = new Set<string>();
  const relsEntry = findZipEntry(zip, "word/_rels/document.xml.rels");
  const relMap: Record<string, string> = {};

  if (relsEntry) {
    const relsXml = relsEntry.getData().toString("utf-8");
    const relRegex = /<Relationship\s+([^>]+)\/>/gi;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = relRegex.exec(relsXml)) !== null) {
      const attrs = rMatch[1] || "";
      const idMatch = attrs.match(/Id=["']([^"']+)["']/i);
      const targetMatch = attrs.match(/Target=["']([^"']+)["']/i);
      if (idMatch?.[1] && targetMatch?.[1]) {
        let target = targetMatch[1];
        if (!target.startsWith("word/")) {
          target = "word/" + target.replace(/^\//, "");
        }
        relMap[idMatch[1]] = target;
        mediaEntries.add(target);
      }
    }
  }

  const docEntry = findZipEntry(zip, "word/document.xml");
  if (!docEntry) {
    return {
      pages: [{ title: "Error", html: "<p>Invalid DOCX file: missing document.xml</p>" }],
      mediaEntries,
    };
  }

  const docXml = docEntry.getData().toString("utf-8");
  const pages: { title: string; html: string }[] = [];
  let currentPageHtml: string[] = [];
  let currentPageTitle = "Section 1";

  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
  let pMatch: RegExpExecArray | null;

  while ((pMatch = pRegex.exec(docXml)) !== null) {
    const pContent = pMatch[1] || "";

    const hasPageBreak = pContent.includes('w:type="page"') || pContent.includes("<w:lastRenderedPageBreak");
    const isHeading = /w:pStyle\s+w:val=["']Heading/i.test(pContent);

    if ((hasPageBreak || (isHeading && currentPageHtml.length >= 8)) && currentPageHtml.length > 0) {
      pages.push({
        title: currentPageTitle,
        html: `<div class="novel-page font-serif leading-relaxed space-y-4 max-w-3xl mx-auto p-4 md:p-8">${currentPageHtml.join("")}</div>`,
      });
      currentPageHtml = [];
      currentPageTitle = `Section ${pages.length + 1}`;
    }

    let imgHtml = "";
    const imgRegex = /<a:blip[^>]+r:embed=["']([^"']+)["']/gi;
    let blipMatch: RegExpExecArray | null;
    while ((blipMatch = imgRegex.exec(pContent)) !== null) {
      const rId = blipMatch[1];
      if (rId && relMap[rId]) {
        const targetPath = relMap[rId];
        const imgUrl = buildEpubResourceUrl(slug, chapterFile, targetPath);
        imgHtml += `<div class="my-4 flex justify-center"><img src="${imgUrl}" alt="illustration" class="max-w-full rounded-lg shadow-md max-h-[85vh] object-contain" /></div>`;
      }
    }

    let pText = "";
    const rRegex = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi;
    let rMatch: RegExpExecArray | null;

    while ((rMatch = rRegex.exec(pContent)) !== null) {
      const rContent = rMatch[1] || "";
      const isBold = /<w:b\b/i.test(rContent);
      const isItalic = /<w:i\b/i.test(rContent);

      const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
      let tMatch: RegExpExecArray | null;
      let runText = "";
      while ((tMatch = tRegex.exec(rContent)) !== null) {
        if (tMatch[1]) {
          runText += tMatch[1];
        }
      }

      if (runText) {
        let formatted = escapeHtml(runText);
        if (isBold) formatted = `<strong>${formatted}</strong>`;
        if (isItalic) formatted = `<em>${formatted}</em>`;
        pText += formatted;
      }
    }

    if (pText.trim() || imgHtml) {
      if (isHeading) {
        if (!currentPageTitle || currentPageTitle.startsWith("Section")) {
          currentPageTitle = pText.replace(/<[^>]+>/g, "").trim() || currentPageTitle;
        }
        currentPageHtml.push(`<h2 class="text-xl md:text-2xl font-bold mt-6 mb-4">${pText}</h2>`);
      } else if (pText.trim()) {
        currentPageHtml.push(`<p class="text-base md:text-lg mb-4 text-justify leading-relaxed">${pText}</p>`);
      }
      if (imgHtml) {
        currentPageHtml.push(imgHtml);
      }
    }

    if (currentPageHtml.length >= 25) {
      pages.push({
        title: currentPageTitle,
        html: `<div class="novel-page font-serif leading-relaxed space-y-4 max-w-3xl mx-auto p-4 md:p-8">${currentPageHtml.join("")}</div>`,
      });
      currentPageHtml = [];
      currentPageTitle = `Section ${pages.length + 1}`;
    }
  }

  if (currentPageHtml.length > 0) {
    pages.push({
      title: currentPageTitle,
      html: `<div class="novel-page font-serif leading-relaxed space-y-4 max-w-3xl mx-auto p-4 md:p-8">${currentPageHtml.join("")}</div>`,
    });
  }

  if (pages.length === 0) {
    pages.push({
      title: "Document",
      html: `<div class="novel-page font-serif leading-relaxed space-y-4 max-w-3xl mx-auto p-4 md:p-8"><p class="text-muted-foreground italic">No text content found in DOCX</p></div>`,
    });
  }

  return { pages, mediaEntries };
}

function parseDocToPages(buffer: Buffer): { title: string; html: string }[] {
  const str = buffer.toString("binary");
  const matches = str.match(/[\x20-\x7E\s]{4,}/g) || [];
  const cleanLines = matches
    .map((m) => m.trim())
    .filter((m) => m.length > 3 && !/^(Normal|Heading|Title|Default|Font|Times|Calibri|Arial)/i.test(m));

  return parseTxtToPages(cleanLines.join("\n\n"));
}

function getZipDirname(path: string) {
  const parts = path.split("/");
  parts.pop();
  return parts.length > 0 ? parts.join("/") + "/" : "";
}

function resolveZipPath(dir: string, href: string) {
  const raw = href.trim();
  const hashIndex = raw.indexOf("#");
  const withoutFragment = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutFragment.indexOf("?");
  const pathOnly = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;

  let decoded = pathOnly;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    /* keep raw */
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
  const containerEntry = findZipEntry(zip, "META-INF/container.xml");
  if (!containerEntry) throw new Error("Not a valid EPUB");
  const containerXml = containerEntry.getData().toString("utf-8");

  const rootfileMatch = containerXml.match(
    /<rootfile[^>]+full-path=["']([^"']+)["']/i,
  );
  if (!rootfileMatch?.[1]) throw new Error("No rootfile found in EPUB");
  const opfPath = rootfileMatch[1];

  const opfEntry = findZipEntry(zip, opfPath);
  if (!opfEntry) throw new Error("OPF file not found: " + opfPath);
  const opfContent = opfEntry.getData().toString("utf-8");

  const manifestMatch = opfContent.match(/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i);
  const manifestItems: Record<string, string> = {};
  const manifestContent = manifestMatch ? manifestMatch[1] : opfContent;

  const itemRegex = /<item\s+([^>]+)>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(manifestContent || "")) !== null) {
    const attrs = match[1] || "";
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);
    const hrefMatch = attrs.match(/href=["']([^"']+)["']/i);
    if (idMatch?.[1] && hrefMatch?.[1]) {
      manifestItems[idMatch[1]] = hrefMatch[1];
    }
  }

  const spineMatch = opfContent.match(/<spine\b[^>]*>([\s\S]*?)<\/spine>/i);
  const spineItems: string[] = [];
  if (spineMatch?.[1]) {
    const itemrefRegex = /<itemref\s+([^>]+)>/gi;
    while ((match = itemrefRegex.exec(spineMatch[1])) !== null) {
      const attrs = match[1] || "";
      const idrefMatch = attrs.match(/idref=["']([^"']+)["']/i);
      if (idrefMatch?.[1]) {
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

function getEpubEntries(zip: AdmZip): string[] {
  try {
    const spine = parseEpubSpine(zip);
    const chosen = spine.filter((e) =>
      /\.(xhtml|html|htm|svg|jpe?g|png|webp|gif|avif|bmp|tiff?|jxl|heic|heif)$/i.test(e),
    );
    if (chosen.length > 0) return chosen;
  } catch (err) {
    console.warn("EPUB spine parsing fallback:", err);
  }

  // Robust fallback: gather all HTML/XHTML/image entries from the archive
  const allEntries = zip.getEntries();
  const valid = allEntries
    .filter(
      (e) =>
        !e.isDirectory &&
        !e.entryName.startsWith("__MACOSX") &&
        !e.entryName.toLowerCase().includes("toc") &&
        /\.(xhtml|html|htm|jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(e.entryName),
    )
    .map((e) => e.entryName)
    .sort(naturalSortPages);

  return valid;
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

function parseEpubToc(zip: AdmZip, opfPath: string): Map<string, string> {
  const tocMap = new Map<string, string>();
  const opfDir = getZipDirname(opfPath);

  // 1. Parse toc.ncx (EPUB 2 / 3 NCX format)
  const ncxEntry =
    findZipEntry(zip, "toc.ncx") ||
    findZipEntry(zip, resolveZipPath(opfDir, "toc.ncx")) ||
    zip.getEntries().find((e) => /\.ncx$/i.test(e.entryName));

  if (ncxEntry) {
    try {
      const xml = ncxEntry.getData().toString("utf-8");
      const npRegex = /<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi;
      let match: RegExpExecArray | null;
      while ((match = npRegex.exec(xml)) !== null) {
        const block = match[1] || "";
        const textMatch = block.match(/<text\b[^>]*>([\s\S]*?)<\/text>/i);
        const srcMatch = block.match(/<content\b[^>]*src=["']([^"']+)["']/i);
        if (textMatch?.[1] && srcMatch?.[1]) {
          const title = textMatch[1].replace(/<[^>]+>/g, "").trim();
          const cleanSrc = srcMatch[1].split("#")[0] || "";
          const fullPath = resolveZipPath(getZipDirname(ncxEntry.entryName), cleanSrc);
          const normKey = fullPath.replace(/\\/g, "/").toLowerCase().trim().replace(/^\//, "");
          if (title && !tocMap.has(normKey)) {
            tocMap.set(normKey, title);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 2. Parse EPUB 3 nav document (nav.xhtml or toc.xhtml)
  const navEntry =
    findZipEntry(zip, "nav.xhtml") ||
    findZipEntry(zip, "toc.xhtml") ||
    findZipEntry(zip, resolveZipPath(opfDir, "nav.xhtml")) ||
    zip.getEntries().find((e) => /(?:nav|toc)\.x?html?$/i.test(e.entryName));

  if (navEntry) {
    try {
      const xml = navEntry.getData().toString("utf-8");
      const aRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = aRegex.exec(xml)) !== null) {
        const href = match[1] || "";
        const title = match[2]?.replace(/<[^>]+>/g, "").trim();
        const cleanHref = href.split("#")[0] || "";
        const fullPath = resolveZipPath(getZipDirname(navEntry.entryName), cleanHref);
        const normKey = fullPath.replace(/\\/g, "/").toLowerCase().trim().replace(/^\//, "");
        if (title && !tocMap.has(normKey)) {
          tocMap.set(normKey, title);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return tocMap;
}

function extractHtmlTitle(zip: AdmZip, entryName: string): string | null {
  const entry = findZipEntry(zip, entryName);
  if (!entry) return null;
  try {
    const raw = entry.getData().toString("utf-8");
    const h1Match = raw.match(/<h[1-2]\b[^>]*>([\s\S]*?)<\/h[1-2]>/i);
    if (h1Match?.[1]) {
      const t = h1Match[1].replace(/<[^>]+>/g, "").trim();
      if (t.length > 0 && t.length < 120) return t;
    }
    const titleMatch = raw.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) {
      const t = titleMatch[1].replace(/<[^>]+>/g, "").trim();
      if (t.length > 0 && t.length < 120 && !t.toLowerCase().includes("untitled")) return t;
    }
  } catch {}
  return null;
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

  // 1. Rewrite media and stylesheet elements
  html = html.replace(
    /<(img|image|source|audio|video|track|iframe|object|embed|link)\b([^>]*)>/gis,
    (match, tag, attrs) => {
      const tagName = String(tag).toLowerCase();
      const isStylesheet =
        tagName === "link" && /\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["']/i.test(attrs);

      if (tagName === "link" && !isStylesheet) return match;

      const rewritten = attrs.replace(
        /\b(src|href)\s*=\s*(["'])(.*?)\2/gi,
        (attrMatch: string, attrName: string, quote: string, value: string) => {
          if (isExternalEpubUrl(value) || value.startsWith("data:") || value.startsWith("#")) {
            return attrMatch;
          }
          const resourcePath = resolveZipPath(baseDir, value);
          return `${attrName}=${quote}${buildEpubResourceUrl(slug, chapterFile, resourcePath)}${quote}`;
        },
      );

      return `<${tag} ${rewritten}>`;
    },
  );

  // 2. Rewrite hyperlinks <a> for seamless in-reader navigation and backlinking
  html = html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gis,
    (match, attrs, content) => {
      const hrefMatch = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
      if (!hrefMatch) return match;

      const rawHref = hrefMatch[2].trim();
      if (/^(?:https?:|\/\/|mailto:)/i.test(rawHref)) {
        return `<a ${attrs.replace(/\btarget=["'][^"']*["']/i, "")} target="_blank" rel="noopener noreferrer">${content}</a>`;
      }

      if (rawHref.startsWith("#")) {
        const anchor = rawHref.slice(1);
        return `<a href="#${anchor}" data-epub-anchor="${anchor}" class="epub-internal-link hover:underline text-primary font-medium cursor-pointer">${content}</a>`;
      }

      const [pathOnly, anchor] = rawHref.split("#");
      const targetPath = resolveZipPath(baseDir, pathOnly || "");
      return `<a href="#epub-nav" data-epub-target="${targetPath}" data-epub-anchor="${anchor || ""}" class="epub-internal-link hover:underline text-primary font-medium cursor-pointer">${content}</a>`;
    },
  );

  // 3. Rewrite embedded <style> blocks
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

  const norm = (s: string) => (s || "").replace(/\\/g, "/").toLowerCase().trim();
  const decodedChapter = decodeURIComponent(chapterFile.replace(/\+/g, " "));
  const targetNorm = norm(decodedChapter);
  const rawNorm = norm(chapterFile);

  const chapter =
    manga.chapters.find((c) => {
      const cFileNorm = norm(c.file);
      const cRelNorm = norm(c.relativePath);
      const cLabelNorm = norm(c.label);
      return (
        cFileNorm === targetNorm ||
        cFileNorm === rawNorm ||
        cRelNorm === targetNorm ||
        cRelNorm === rawNorm ||
        cLabelNorm === targetNorm ||
        cLabelNorm === rawNorm ||
        cFileNorm.endsWith("/" + targetNorm) ||
        targetNorm.endsWith("/" + cFileNorm) ||
        cRelNorm.endsWith("/" + targetNorm) ||
        targetNorm.endsWith("/" + cRelNorm)
      );
    }) || (manga.chapters.length === 1 ? manga.chapters[0] : undefined);

  if (!chapter) throw new Error(`Chapter not found: ${chapterFile}`);

  let chapterPath = "";
  if (existsSync(manga.folderPath) && statSync(manga.folderPath).isFile()) {
    chapterPath = manga.folderPath;
  } else {
    const candidates = [
      join(manga.folderPath, chapter.relativePath || ""),
      join(manga.folderPath, chapter.file || ""),
      join(manga.folderPath, decodedChapter),
      join(manga.folderPath, chapterFile),
    ];
    for (const cand of candidates) {
      if (cand && existsSync(cand)) {
        chapterPath = cand;
        break;
      }
    }
  }

  if (!chapterPath || !existsSync(chapterPath)) {
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
      const chosenEntries = getEpubEntries(zip);

      return {
        pageCount: Math.max(1, chosenEntries.length),
        pages: chosenEntries.map((e, index) => ({
          index,
          name: parse(e).base,
          type: /\.(xhtml|html|htm)$/i.test(e) ? "html" : "image",
        })),
        isEpub: true,
        isNovel: true,
        format: "epub",
      };
    } catch {
      return { pageCount: 1, pages: [{ index: 0, name: parse(chapterFile).name }], isEpub: true, isNovel: true, format: "epub" };
    }
  }

  if (chapter.format === "docx" || chapterPath.toLowerCase().endsWith(".docx")) {
    try {
      const zip = new AdmZip(chapterPath);
      const doc = parseDocxDocument(zip, slug, chapterFile);
      return {
        pageCount: doc.pages.length,
        pages: doc.pages.map((p, index) => ({
          index,
          name: p.title || `Section ${index + 1}`,
          type: "html",
        })),
        isDocx: true,
        isNovel: true,
        format: "docx",
      };
    } catch {
      return { pageCount: 1, pages: [{ index: 0, name: parse(chapterFile).name }], isDocx: true, isNovel: true, format: "docx" };
    }
  }

  if (chapter.format === "txt" || chapterPath.toLowerCase().endsWith(".txt")) {
    try {
      const rawText = readFileSync(chapterPath, "utf-8");
      const pages = parseTxtToPages(rawText);
      return {
        pageCount: pages.length,
        pages: pages.map((p, index) => ({
          index,
          name: p.title || `Section ${index + 1}`,
          type: "html",
        })),
        isTxt: true,
        isNovel: true,
        format: "txt",
      };
    } catch {
      return { pageCount: 1, pages: [{ index: 0, name: parse(chapterFile).name }], isTxt: true, isNovel: true, format: "txt" };
    }
  }

  if (chapter.format === "doc" || chapterPath.toLowerCase().endsWith(".doc")) {
    try {
      const buffer = readFileSync(chapterPath);
      const pages = parseDocToPages(buffer);
      return {
        pageCount: pages.length,
        pages: pages.map((p, index) => ({
          index,
          name: p.title || `Section ${index + 1}`,
          type: "html",
        })),
        isNovel: true,
        format: "doc",
      };
    } catch {
      return { pageCount: 1, pages: [{ index: 0, name: parse(chapterFile).name }], isNovel: true, format: "doc" };
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

  const norm = (s: string) => (s || "").replace(/\\/g, "/").toLowerCase().trim();
  const decodedChapter = decodeURIComponent(chapterFile.replace(/\+/g, " "));
  const targetNorm = norm(decodedChapter);
  const rawNorm = norm(chapterFile);

  const chapter =
    manga.chapters.find((c) => {
      const cFileNorm = norm(c.file);
      const cRelNorm = norm(c.relativePath);
      const cLabelNorm = norm(c.label);
      return (
        cFileNorm === targetNorm ||
        cFileNorm === rawNorm ||
        cRelNorm === targetNorm ||
        cRelNorm === rawNorm ||
        cLabelNorm === targetNorm ||
        cLabelNorm === rawNorm ||
        cFileNorm.endsWith("/" + targetNorm) ||
        targetNorm.endsWith("/" + cFileNorm) ||
        cRelNorm.endsWith("/" + targetNorm) ||
        targetNorm.endsWith("/" + cRelNorm)
      );
    }) || (manga.chapters.length === 1 ? manga.chapters[0] : undefined);

  if (!chapter) return null;

  let chapterPath = "";
  if (existsSync(manga.folderPath) && statSync(manga.folderPath).isFile()) {
    chapterPath = manga.folderPath;
  } else {
    const candidates = [
      join(manga.folderPath, chapter.relativePath || ""),
      join(manga.folderPath, chapter.file || ""),
      join(manga.folderPath, decodedChapter),
      join(manga.folderPath, chapterFile),
    ];
    for (const cand of candidates) {
      if (cand && existsSync(cand)) {
        chapterPath = cand;
        break;
      }
    }
  }

  if (!chapterPath || !existsSync(chapterPath)) {
    return null;
  }

  if (chapter.format === "pdf" || chapterPath.toLowerCase().endsWith(".pdf")) {
    const buffer = readFileSync(chapterPath);
    return { buffer, mimeType: "application/pdf" };
  }

  if (chapter.format === "epub" || chapterPath.toLowerCase().endsWith(".epub")) {
    const zip = new AdmZip(chapterPath);
    
    if (epubResourcePath) {
      const entry = findZipEntry(zip, epubResourcePath);
      if (!entry) return null;
      return { buffer: entry.getData(), mimeType: getMimeType(entry.entryName) };
    }

    const chosenEntries = getEpubEntries(zip);
    if (chosenEntries.length === 0) return null;

    const currentFile = chosenEntries[pageIndex] || chosenEntries[0];
    if (!currentFile) return null;

    const entry = findZipEntry(zip, currentFile);
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

  if (chapter.format === "docx" || chapterPath.toLowerCase().endsWith(".docx")) {
    const zip = new AdmZip(chapterPath);
    if (epubResourcePath) {
      const entry = zip.getEntry(epubResourcePath);
      if (!entry) return null;
      return { buffer: entry.getData(), mimeType: getMimeType(entry.entryName) };
    }
    const doc = parseDocxDocument(zip, slug, chapterFile);
    const page = doc.pages[pageIndex] || doc.pages[0];
    if (!page) return null;
    return { buffer: Buffer.from(page.html, "utf-8"), mimeType: "text/html" };
  }

  if (chapter.format === "txt" || chapterPath.toLowerCase().endsWith(".txt")) {
    const rawText = readFileSync(chapterPath, "utf-8");
    const pages = parseTxtToPages(rawText);
    const page = pages[pageIndex] || pages[0];
    if (!page) return null;
    return { buffer: Buffer.from(page.html, "utf-8"), mimeType: "text/html" };
  }

  if (chapter.format === "doc" || chapterPath.toLowerCase().endsWith(".doc")) {
    const rawBuffer = readFileSync(chapterPath);
    const pages = parseDocToPages(rawBuffer);
    const page = pages[pageIndex] || pages[0];
    if (!page) return null;
    return { buffer: Buffer.from(page.html, "utf-8"), mimeType: "text/html" };
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
