#!/usr/bin/env node

/**
 * Koka Lightweight Streaming Bridge (PC & Android Termux)
 * Zero-dependency standalone media daemon with HTTP Range streaming and token security.
 * Supports: Video, Subtitles, Images, CBZ, ZIP, CBR, RAR, CB7, 7Z, CBT, TAR, PDF, and EPUB.
 */

import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

// Load configuration from config.json, custom config file, or environment variables
function getFreshConfig() {
  const args = process.argv.slice(2);
  let configArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--config" && args[i + 1]) {
      configArg = args[i + 1];
    }
  }

  const configEnv = process.env.CONFIG_PATH || process.env.KOKA_CONFIG;
  const configFileName = configArg || configEnv || "config.json";
  const configPath = path.isAbsolute(configFileName)
    ? configFileName
    : path.resolve(process.cwd(), configFileName);

  let cfg = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      cfg = JSON.parse(raw);
    } catch (err) {
      console.warn("Could not parse config file, using defaults:", err.message);
    }
  }

  const defaultId = os.hostname().toLowerCase().replace(/[^a-z0-9_-]/g, "-");

  const animePath = path.resolve(process.cwd(), process.env.ANIME_PATH || cfg.animePath || "./anime");
  const mangaPath = path.resolve(process.cwd(), process.env.MANGA_PATH || cfg.mangaPath || "./manga");
  const novelPath = (process.env.NOVEL_PATH || cfg.novelPath)
    ? path.resolve(process.cwd(), process.env.NOVEL_PATH || cfg.novelPath)
    : null;

  const animeSources = Array.isArray(cfg.animeSources)
    ? cfg.animeSources.map((p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)))
    : [];
  const mangaSources = Array.isArray(cfg.mangaSources)
    ? cfg.mangaSources.map((p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)))
    : [];
  const novelSources = Array.isArray(cfg.novelSources)
    ? cfg.novelSources.map((p) => (path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)))
    : [];

  const allAnimePaths = Array.from(new Set([animePath, ...animeSources]));
  const allMangaPaths = Array.from(new Set([mangaPath, ...(novelPath ? [novelPath] : []), ...mangaSources, ...novelSources]));

  return {
    PORT: parseInt(process.env.PORT || String(cfg.port || 3399), 10),
    DEVICE_ID: (process.env.KOKA_DEVICE_ID || cfg.deviceId || defaultId).trim(),
    NODE_NAME: process.env.KOKA_NODE_NAME || cfg.nodeName || `${os.hostname()} (${os.platform()})`,
    STREAM_SECRET: process.env.KOKA_STREAM_SECRET || cfg.secret || "",
    ANIME_PATH: animePath,
    MANGA_PATH: mangaPath,
    NOVEL_PATH: novelPath,
    ANIME_PATHS: allAnimePaths,
    MANGA_PATHS: allMangaPaths,
    NODE_TYPE: os.platform() === "android" || process.env.PREFIX?.includes("termux") ? "mobile" : "desktop",
    CONFIG_LOADED: configPath,
  };
}

const MIME_TYPES = {
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
  ".html": "text/html",
  ".xhtml": "application/xhtml+xml",
  ".htm": "text/html",
  ".txt": "text/plain",
};

const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".ts", ".m4v"]);
const ALLOWED_SUBTITLE_EXTS = new Set([".vtt", ".srt", ".ass", ".ssa"]);
const ALLOWED_MANGA_ARCHIVE_EXTS = new Set([
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
]);
const IMAGE_EXTENSIONS_REGEX = /\.(jpg|jpeg|png|webp|gif|avif|bmp|tiff|tif|jxl|heic|heif)$/i;
const MANGA_FILE_REGEX = /\.(cbz|zip|cbr|rar|cb7|7z|cbt|tar|pdf|epub)$/i;

function isMaliciousPathSegment(segment) {
  if (!segment || typeof segment !== "string") return false;
  try {
    const decoded = decodeURIComponent(segment);
    if (decoded.includes("\0")) return true;
    if (decoded.includes("..")) return true;
    if (/^[a-zA-Z]:/i.test(decoded)) return true;
    if (decoded.startsWith("/") || decoded.startsWith("\\")) return true;
    if (/^\.(env|git|ssh|config|aws|bash|npm|profile|htaccess|htpasswd)/i.test(path.basename(decoded))) return true;
    return false;
  } catch {
    return true; // malformed URI encoding is treated as hostile
  }
}

function isSafePath(base, target) {
  if (!base || !target) return false;
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

function isSafeUnderAnyBase(bases, target) {
  if (!bases || !Array.isArray(bases) || !target) return false;
  return bases.some((b) => isSafePath(b, target));
}

function extractPageNumber(filename) {
  const base = path.basename(filename).replace(/\.[^/.]+$/, "");
  const matches = base.match(/(\d+(?:\.\d+)?)/g);
  if (matches && matches.length > 0) {
    const num = parseFloat(matches[matches.length - 1]);
    if (!isNaN(num)) return num;
  }
  return null;
}

function naturalSortPages(a, b) {
  const strA = typeof a === "string" ? a : (a?.name || a?.file || "");
  const strB = typeof b === "string" ? b : (b?.name || b?.file || "");

  const numA = extractPageNumber(strA);
  const numB = extractPageNumber(strB);

  if (numA !== null && numB !== null && numA !== numB) {
    return numA - numB;
  }
  return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
}

function isDirEntry(entry, parentPath) {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(parentPath, entry.name)).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

function isFileEntry(entry, parentPath) {
  if (entry.isFile()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return fs.statSync(path.join(parentPath, entry.name)).isFile();
    } catch {
      return false;
    }
  }
  return false;
}

function naturalSort(a, b) {
  const strA = typeof a === "string" ? a : (a?.name || a?.file || "");
  const strB = typeof b === "string" ? b : (b?.name || b?.file || "");
  return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
}

function getMangaFormat(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".cbz") return "cbz";
  if (ext === ".zip") return "zip";
  if (ext === ".cbr" || ext === ".rar") return "cbr";
  if (ext === ".cb7" || ext === ".7z") return "cb7";
  if (ext === ".cbt" || ext === ".tar") return "cbt";
  if (ext === ".pdf") return "pdf";
  if (ext === ".epub") return "epub";
  return "zip";
}

// Pure JS Tar Archive Parser
function parseTarEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header[0] === 0) break;

    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
    const name = header.toString("utf-8", 0, nameEnd).trim();

    const sizeStr = header.toString("utf-8", 124, 136).replace(/\0.*$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;

    const typeFlag = String.fromCharCode(header[156]);
    const isFile = typeFlag === "0" || typeFlag === "\0" || typeFlag === "";

    const dataOffset = offset + 512;
    if (isFile && IMAGE_EXTENSIONS_REGEX.test(name) && !name.startsWith("._")) {
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

// Pure JS Zip Archive Parser (CBZ, ZIP, EPUB)
function parseZipEntries(buffer, allowHtml = false) {
  const entries = [];

  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  const matchesFilter = (name) => {
    if (name.endsWith("/") || name.startsWith("__MACOSX")) return false;
    if (IMAGE_EXTENSIONS_REGEX.test(name)) return true;
    if (allowHtml && /\.(xhtml|html|htm)$/i.test(name) && !name.toLowerCase().includes("toc") && !name.toLowerCase().includes("nav")) return true;
    return false;
  };

  if (eocdOffset !== -1) {
    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
    let p = cdOffset;

    for (let k = 0; k < totalEntries && p < eocdOffset; k++) {
      if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) break;
      const compMethod = buffer.readUInt16LE(p + 10);
      const compSize = buffer.readUInt32LE(p + 20);
      const uncompSize = buffer.readUInt32LE(p + 24);
      const nameLen = buffer.readUInt16LE(p + 28);
      const extraLen = buffer.readUInt16LE(p + 30);
      const commentLen = buffer.readUInt16LE(p + 32);
      const localOffset = buffer.readUInt32LE(p + 42);
      const filename = buffer.toString("utf-8", p + 46, p + 46 + nameLen);

      if (matchesFilter(filename)) {
        if (localOffset + 30 <= buffer.length && buffer.readUInt32LE(localOffset) === 0x04034b50) {
          const locNameLen = buffer.readUInt16LE(localOffset + 26);
          const locExtraLen = buffer.readUInt16LE(localOffset + 28);
          const dataOffset = localOffset + 30 + locNameLen + locExtraLen;
          entries.push({
            name: filename,
            compMethod,
            compSize,
            uncompSize,
            dataOffset,
          });
        }
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
  }

  // Fallback: scan local headers
  if (entries.length === 0) {
    let i = 0;
    while (i < buffer.length - 30) {
      if (buffer.readUInt32LE(i) === 0x04034b50) {
        const compMethod = buffer.readUInt16LE(i + 8);
        const compSize = buffer.readUInt32LE(i + 18);
        const uncompSize = buffer.readUInt32LE(i + 22);
        const nameLen = buffer.readUInt16LE(i + 26);
        const extraLen = buffer.readUInt16LE(i + 28);
        const filename = buffer.toString("utf-8", i + 30, i + 30 + nameLen);
        const dataOffset = i + 30 + nameLen + extraLen;

        if (matchesFilter(filename)) {
          entries.push({
            name: filename,
            compMethod,
            compSize,
            uncompSize,
            dataOffset,
          });
        }
        i = compSize > 0 ? dataOffset + compSize : i + 1;
      } else {
        i++;
      }
    }
  }

  entries.sort((a, b) => naturalSortPages(a.name, b.name));
  return entries;
}

function extractZipEntry(buffer, entry) {
  const compressed = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.compSize);
  if (entry.compMethod === 0) {
    return compressed;
  }
  if (entry.compMethod === 8) {
    return zlib.inflateRawSync(compressed);
  }
  throw new Error(`Unsupported compression method: ${entry.compMethod}`);
}

const initialConfig = getFreshConfig();
console.log("=========================================");
console.log(" Koka Streaming Bridge (Standalone)");
console.log(` Device ID   : ${initialConfig.DEVICE_ID}`);
console.log(` Node Name   : ${initialConfig.NODE_NAME}`);
console.log(` Node Type   : ${initialConfig.NODE_TYPE}`);
console.log(` Config File : ${initialConfig.CONFIG_LOADED}`);
console.log(` Anime Paths : ${initialConfig.ANIME_PATHS.join(", ")}`);
console.log(` Manga Paths : ${initialConfig.MANGA_PATHS.join(", ")}`);
console.log(` Listening   : http://0.0.0.0:${initialConfig.PORT}`);
console.log("=========================================");

const server = http.createServer((req, res) => {
  const currentConfig = getFreshConfig();
  const { PORT, DEVICE_ID, NODE_NAME, STREAM_SECRET, ANIME_PATHS, MANGA_PATHS, NODE_TYPE } = currentConfig;

  // CORS Headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization, X-Koka-Stream-Secret");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  console.log(`[REQ] ${req.method} ${pathname} ${parsedUrl.search}`);

  // 1. Health check endpoint
  if (pathname === "/api/health" || pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      deviceId: DEVICE_ID,
      nodeName: NODE_NAME,
      nodeType: NODE_TYPE,
      authenticated: true,
      timestamp: Date.now(),
    }));
    return;
  }

  // 2. Secret Verification Guard
  if (STREAM_SECRET) {
    const headerSecret = req.headers["x-koka-stream-secret"];
    const querySecret = parsedUrl.searchParams.get("secret");
    if (headerSecret !== STREAM_SECRET && querySecret !== STREAM_SECRET) {
      console.warn(`[AUTH FAILED] Secret mismatch on ${pathname}. Provided query: "${querySecret}", Expected: "${STREAM_SECRET}"`);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing X-Koka-Stream-Secret key." }));
      return;
    }
  }

  // 3. Scanner state endpoint (Multi-Source scanning)
  if (pathname === "/api/scanner/state") {
    let animeList = [];
    let mangaList = [];

    try {
      // 1. Scan all Anime directories
      for (const animeRoot of ANIME_PATHS) {
        if (!fs.existsSync(animeRoot)) continue;
        const animeDirs = fs.readdirSync(animeRoot, { withFileTypes: true }).filter((d) => isDirEntry(d, animeRoot));
        
        for (const dir of animeDirs) {
          const folderPath = path.join(animeRoot, dir.name);
          const slug = dir.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          let seasons = [];

          try {
            const subItems = fs.readdirSync(folderPath, { withFileTypes: true });
            const subDirs = subItems.filter((d) => isDirEntry(d, folderPath)).sort((a, b) => naturalSort(a.name, b.name));

            if (subDirs.length > 0) {
              seasons = subDirs.map((s) => {
                const sPath = path.join(folderPath, s.name);
                const sFiles = fs.readdirSync(sPath, { withFileTypes: true })
                  .filter((f) => isFileEntry(f, sPath) && /\.(mp4|mkv|webm|avi|mov|flv|ts|m4v)$/i.test(f.name))
                  .map((f) => ({
                    file: f.name,
                    label: f.name.replace(/\.[^/.]+$/, ""),
                    season: s.name,
                    relativePath: path.join(s.name, f.name).replace(/\\/g, "/"),
                    subtitles: [],
                  }))
                  .sort((a, b) => naturalSort(a.file, b.file));
                return { name: s.name, episodes: sFiles };
              });
            } else {
              const rootFiles = subItems
                .filter((f) => isFileEntry(f, folderPath) && /\.(mp4|mkv|webm|avi|mov|flv|ts|m4v)$/i.test(f.name))
                .map((f) => ({
                  file: f.name,
                  label: f.name.replace(/\.[^/.]+$/, ""),
                  season: "Season 1",
                  relativePath: f.name,
                  subtitles: [],
                }))
                .sort((a, b) => naturalSort(a.file, b.file));
              if (rootFiles.length > 0) {
                seasons = [{ name: "Season 1", episodes: rootFiles }];
              }
            }
          } catch (err) {
            console.warn(`Error scanning anime folder ${dir.name}:`, err.message);
          }

          if (seasons.length > 0) {
            animeList.push({
              slug,
              folderName: dir.name,
              folderPath,
              seasons,
              episodeCount: seasons.reduce((acc, s) => acc + s.episodes.length, 0),
            });
          }
        }
      }

      // 2. Scan all Manga / Comic / Novel directories
      for (const mangaRoot of MANGA_PATHS) {
        if (!fs.existsSync(mangaRoot)) continue;
        const rootEntries = fs.readdirSync(mangaRoot, { withFileTypes: true });
        const mangaDirs = rootEntries.filter((d) => isDirEntry(d, mangaRoot));

        for (const dir of mangaDirs) {
          const folderPath = path.join(mangaRoot, dir.name);
          const slug = dir.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          let chapters = [];

          try {
            const subItems = fs.readdirSync(folderPath, { withFileTypes: true });

            // Check for archives, PDFs, EPUBs
            const archiveChapters = subItems
              .filter((f) => isFileEntry(f, folderPath) && MANGA_FILE_REGEX.test(f.name))
              .map((f) => ({
                file: f.name,
                label: f.name.replace(/\.[^/.]+$/, ""),
                relativePath: f.name,
                format: getMangaFormat(f.name),
              }))
              .sort((a, b) => naturalSort(a.file, b.file));

            // Check for chapter subdirectories
            const folderChapters = subItems
              .filter((d) => isDirEntry(d, folderPath) && !d.name.startsWith("."))
              .map((d) => ({
                file: d.name,
                label: d.name,
                relativePath: d.name,
                format: "folder",
              }))
              .sort((a, b) => naturalSort(a.file, b.file));

            // Check for loose root images
            const looseImages = subItems.filter((f) => isFileEntry(f, folderPath) && IMAGE_EXTENSIONS_REGEX.test(f.name));

            if (archiveChapters.length > 0) {
              chapters = archiveChapters;
            } else if (folderChapters.length > 0) {
              chapters = folderChapters;
            } else if (looseImages.length > 0) {
              chapters = [{
                file: dir.name,
                label: dir.name,
                relativePath: "",
                format: "folder",
                pageCount: looseImages.length,
              }];
            }
          } catch (err) {
            console.warn(`Error scanning manga folder ${dir.name}:`, err.message);
          }

          if (chapters.length > 0) {
            mangaList.push({
              slug,
              folderName: dir.name,
              folderPath,
              chapters,
              chapterCount: chapters.length,
            });
          }
        }

        // Scan standalone files placed directly in manga root
        const rootArchives = rootEntries.filter((f) => isFileEntry(f, mangaRoot) && MANGA_FILE_REGEX.test(f.name));
        for (const file of rootArchives) {
          const baseName = file.name.replace(/\.[^/.]+$/, "");
          const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          mangaList.push({
            slug,
            folderName: baseName,
            folderPath: path.join(mangaRoot, file.name),
            chapters: [{
              file: file.name,
              label: baseName,
              relativePath: file.name,
              format: getMangaFormat(file.name),
            }],
            chapterCount: 1,
          });
        }
      }
    } catch (err) {
      console.error("Scan error:", err.message);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      online: true,
      deviceId: DEVICE_ID,
      nodeName: NODE_NAME,
      nodeType: NODE_TYPE,
      anime: animeList,
      manga: mangaList,
      timestamp: Date.now(),
    }));
    return;
  }

  function findVideoFilePath(slug, season, file) {
    for (const animeRoot of ANIME_PATHS) {
      if (!fs.existsSync(animeRoot)) continue;
      try {
        const entries = fs.readdirSync(animeRoot, { withFileTypes: true });
        const targetFolder = entries.find((e) => isDirEntry(e, animeRoot) && (
          e.name === slug ||
          e.name.toLowerCase() === slug.toLowerCase() ||
          e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === slug.toLowerCase()
        ));

        if (!targetFolder) continue;
        const folderPath = path.join(animeRoot, targetFolder.name);

        if (season) {
          const seasonPath = path.join(folderPath, season, file);
          if (fs.existsSync(seasonPath) && isSafePath(animeRoot, seasonPath)) return seasonPath;
        }

        const directPath = path.join(folderPath, file);
        if (fs.existsSync(directPath) && isSafePath(animeRoot, directPath)) return directPath;
      } catch {}
    }
    return null;
  }

  // 4. Video Stream Endpoint with Range Support
  if (pathname === "/api/stream/video") {
    const slug = parsedUrl.searchParams.get("slug");
    const season = parsedUrl.searchParams.get("season");
    const episode = parsedUrl.searchParams.get("episode");

    if (!slug || !episode || isMaliciousPathSegment(slug) || isMaliciousPathSegment(season) || isMaliciousPathSegment(episode)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid or missing parameters");
      return;
    }

    const ext = path.extname(episode).toLowerCase();
    if (!ALLOWED_VIDEO_EXTS.has(ext) && !ALLOWED_MANGA_ARCHIVE_EXTS.has(ext)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: Invalid file format");
      return;
    }

    const filePath = findVideoFilePath(slug, season, episode);
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("File not found");
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const contentType = MIME_TYPES[ext] || "video/mp4";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Content-Type": contentType,
        });
        res.end();
        return;
      }

      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType,
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Accept-Ranges": "bytes",
        "Content-Type": contentType,
      });
      fs.createReadStream(filePath).pipe(res);
    }
    return;
  }

  // 5. Subtitle Stream Endpoint
  if (pathname === "/api/stream/subtitle") {
    const slug = parsedUrl.searchParams.get("slug");
    const file = parsedUrl.searchParams.get("file");

    if (!slug || !file || isMaliciousPathSegment(slug) || isMaliciousPathSegment(file)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid or missing parameters");
      return;
    }

    const ext = path.extname(file).toLowerCase();
    if (!ALLOWED_SUBTITLE_EXTS.has(ext)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden: Invalid subtitle format");
      return;
    }

    let subtitlePath = null;
    for (const animeRoot of ANIME_PATHS) {
      if (!fs.existsSync(animeRoot)) continue;
      const targetFolder = fs.readdirSync(animeRoot, { withFileTypes: true }).find((e) => isDirEntry(e, animeRoot) && (
        e.name === slug ||
        e.name.toLowerCase() === slug.toLowerCase() ||
        e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === slug.toLowerCase()
      ));

      if (targetFolder) {
        const p = path.join(animeRoot, targetFolder.name, file);
        if (fs.existsSync(p) && isSafePath(animeRoot, p)) {
          subtitlePath = p;
          break;
        }
      }
    }

    if (!subtitlePath) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Subtitle file not found");
      return;
    }

    const content = fs.readFileSync(subtitlePath, "utf-8");
    res.writeHead(200, {
      "Content-Type": ext === ".vtt" ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(content);
    return;
  }

  function findMangaPathMulti(slug, chapter) {
    if (isMaliciousPathSegment(slug) || isMaliciousPathSegment(chapter)) return null;

    for (const mangaRoot of MANGA_PATHS) {
      if (!fs.existsSync(mangaRoot)) continue;

      if (slug && chapter) {
        const direct = path.join(mangaRoot, slug, chapter);
        if (fs.existsSync(direct) && isSafePath(mangaRoot, direct)) return direct;
      }
      if (slug) {
        const directSlug = path.join(mangaRoot, slug);
        if (fs.existsSync(directSlug) && isSafePath(mangaRoot, directSlug)) {
          if (!chapter || chapter === "Chapter 1" || chapter === "") return directSlug;
        }
      }
      if (chapter) {
        const directChapter = path.join(mangaRoot, chapter);
        if (fs.existsSync(directChapter) && isSafePath(mangaRoot, directChapter)) return directChapter;
      }

      try {
        const entries = fs.readdirSync(mangaRoot, { withFileTypes: true });

        const rootArchive = entries.find((e) => isFileEntry(e, mangaRoot) && (
          e.name === chapter ||
          e.name.toLowerCase() === (chapter || "").toLowerCase() ||
          e.name === slug ||
          e.name.toLowerCase() === (slug || "").toLowerCase() ||
          e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === (slug || "").toLowerCase() ||
          e.name.replace(/\.[^/.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-") === (slug || "").toLowerCase()
        ));
        if (rootArchive) {
          const p = path.join(mangaRoot, rootArchive.name);
          if (isSafePath(mangaRoot, p)) return p;
        }

        const targetFolder = entries.find((e) => isDirEntry(e, mangaRoot) && (
          e.name === slug ||
          e.name.toLowerCase() === (slug || "").toLowerCase() ||
          e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === (slug || "").toLowerCase()
        ));

        if (targetFolder) {
          const folderPath = path.join(mangaRoot, targetFolder.name);
          if (!chapter || chapter === "Chapter 1" || chapter === "") {
            if (isSafePath(mangaRoot, folderPath)) return folderPath;
          }

          const inChapter = path.join(folderPath, chapter);
          if (fs.existsSync(inChapter) && isSafePath(mangaRoot, inChapter)) return inChapter;

          const subEntries = fs.readdirSync(folderPath, { withFileTypes: true });
          const subMatch = subEntries.find((s) => (
            s.name === chapter ||
            s.name.toLowerCase() === chapter.toLowerCase() ||
            s.name.replace(/\.[^/.]+$/, "").toLowerCase() === chapter.replace(/\.[^/.]+$/, "").toLowerCase() ||
            s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === chapter.toLowerCase().replace(/[^a-z0-9]+/g, "-")
          ));
          if (subMatch) {
            const p = path.join(folderPath, subMatch.name);
            if (isSafePath(mangaRoot, p)) return p;
          }

          const hasImages = subEntries.some((f) => isFileEntry(f, folderPath) && IMAGE_EXTENSIONS_REGEX.test(f.name));
          if (hasImages && isSafePath(mangaRoot, folderPath)) return folderPath;
        }
      } catch {}
    }
    return null;
  }

  // 6. Manga Chapter Pages List Endpoint
  if (pathname === "/api/manga/pages") {
    const slug = parsedUrl.searchParams.get("slug");
    const chapter = parsedUrl.searchParams.get("chapter");

    if (!slug || isMaliciousPathSegment(slug) || isMaliciousPathSegment(chapter)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing parameters" }));
      return;
    }

    const targetPath = findMangaPathMulti(slug, chapter);
    if (!targetPath || !fs.existsSync(targetPath) || !isSafeUnderAnyBase(MANGA_PATHS, targetPath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Manga chapter not found" }));
      return;
    }

    try {
      const stat = fs.statSync(targetPath);
      const ext = path.extname(targetPath).toLowerCase();

      // PDF
      if (stat.isFile() && ext === ".pdf") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          pageCount: 1,
          pages: [{ index: 0, name: path.basename(targetPath) }],
          isPdf: true,
          format: "pdf",
        }));
        return;
      }

      // EPUB
      if (stat.isFile() && ext === ".epub") {
        const buffer = fs.readFileSync(targetPath);
        const entries = parseZipEntries(buffer, true);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          pageCount: entries.length || 1,
          pages: entries.map((e, idx) => ({ index: idx, name: path.basename(e.name) })),
          isEpub: true,
          format: "epub",
        }));
        return;
      }

      // TAR / CBT
      if (stat.isFile() && (ext === ".cbt" || ext === ".tar")) {
        const buffer = fs.readFileSync(targetPath);
        const entries = parseTarEntries(buffer);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          pageCount: entries.length,
          pages: entries.map((e, idx) => ({ index: idx, name: path.basename(e.name) })),
          format: "cbt",
        }));
        return;
      }

      // ZIP / CBZ
      if (stat.isFile() && /\.(cbz|zip)$/i.test(targetPath)) {
        const buffer = fs.readFileSync(targetPath);
        const entries = parseZipEntries(buffer);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          pageCount: entries.length,
          pages: entries.map((e, idx) => ({ index: idx, name: path.basename(e.name) })),
          format: ext === ".cbz" ? "cbz" : "zip",
        }));
        return;
      }

      // Directory of images
      if (stat.isDirectory()) {
        const subFiles = fs.readdirSync(targetPath, { withFileTypes: true });
        const imageFiles = subFiles
          .filter((f) => isFileEntry(f, targetPath) && IMAGE_EXTENSIONS_REGEX.test(f.name))
          .map((f) => f.name)
          .sort(naturalSortPages);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          pageCount: imageFiles.length,
          pages: imageFiles.map((name, idx) => ({ index: idx, name })),
          format: "folder",
        }));
        return;
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to read manga pages: " + err.message }));
      return;
    }
  }

  // 7. Manga Page Image / Document Stream Endpoint
  if (pathname === "/api/stream/manga-page") {
    const slug = parsedUrl.searchParams.get("slug");
    const chapter = parsedUrl.searchParams.get("chapter");
    const pageStr = parsedUrl.searchParams.get("page");
    const pageIndex = parseInt(pageStr || "0", 10);

    if (!slug || isMaliciousPathSegment(slug) || isMaliciousPathSegment(chapter) || isNaN(pageIndex)) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Invalid or missing parameters");
      return;
    }

    const targetPath = findMangaPathMulti(slug, chapter);
    if (!targetPath || !fs.existsSync(targetPath) || !isSafeUnderAnyBase(MANGA_PATHS, targetPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Chapter not found");
      return;
    }

    try {
      const stat = fs.statSync(targetPath);
      const ext = path.extname(targetPath).toLowerCase();

      // PDF Streaming
      if (stat.isFile() && ext === ".pdf") {
        const fileSize = stat.size;
        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = end - start + 1;
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": "application/pdf",
          });
          fs.createReadStream(targetPath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            "Content-Length": fileSize,
            "Content-Type": "application/pdf",
            "Cache-Control": "public, max-age=86400",
          });
          fs.createReadStream(targetPath).pipe(res);
        }
        return;
      }

      // EPUB Streaming
      if (stat.isFile() && ext === ".epub") {
        const buffer = fs.readFileSync(targetPath);
        const entries = parseZipEntries(buffer, true);
        if (pageIndex < 0 || pageIndex >= entries.length) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Page not found");
          return;
        }
        const fileBuffer = extractZipEntry(buffer, entries[pageIndex]);
        const entryExt = path.extname(entries[pageIndex].name).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[entryExt] || "application/octet-stream",
          "Cache-Control": "public, max-age=86400",
        });
        res.end(fileBuffer);
        return;
      }

      // TAR / CBT Streaming
      if (stat.isFile() && (ext === ".cbt" || ext === ".tar")) {
        const buffer = fs.readFileSync(targetPath);
        const entries = parseTarEntries(buffer);
        if (pageIndex < 0 || pageIndex >= entries.length) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Page not found");
          return;
        }
        const entry = entries[pageIndex];
        const pageBuffer = buffer.subarray(entry.dataOffset, entry.dataOffset + entry.size);
        const entryExt = path.extname(entry.name).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[entryExt] || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        });
        res.end(pageBuffer);
        return;
      }

      // ZIP / CBZ Streaming
      if (stat.isFile() && /\.(cbz|zip)$/i.test(targetPath)) {
        const buffer = fs.readFileSync(targetPath);
        const entries = parseZipEntries(buffer);
        if (pageIndex < 0 || pageIndex >= entries.length) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Page not found");
          return;
        }
        const imgBuffer = extractZipEntry(buffer, entries[pageIndex]);
        const entryExt = path.extname(entries[pageIndex].name).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[entryExt] || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        });
        res.end(imgBuffer);
        return;
      }

      // Folder of Images Streaming
      if (stat.isDirectory()) {
        const subFiles = fs.readdirSync(targetPath, { withFileTypes: true });
        const imageFiles = subFiles
          .filter((f) => isFileEntry(f, targetPath) && IMAGE_EXTENSIONS_REGEX.test(f.name))
          .map((f) => f.name)
          .sort(naturalSortPages);

        if (pageIndex < 0 || pageIndex >= imageFiles.length) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Page not found");
          return;
        }
        const imgPath = path.join(targetPath, imageFiles[pageIndex]);
        const imgExt = path.extname(imgPath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[imgExt] || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        });
        fs.createReadStream(imgPath).pipe(res);
        return;
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(err.message);
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(initialConfig.PORT, () => {
  console.log(` Koka Bridge ready on port ${initialConfig.PORT}`);
});

process.on("uncaughtException", (err) => {
  console.error("[STREAMER ERROR]", err.message);
});

process.on("unhandledRejection", (reason) => {
  console.error("[STREAMER REJECTION]", reason);
});
