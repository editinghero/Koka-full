#!/usr/bin/env node

/**
 * Koka Lightweight Streaming Bridge (PC & Android Termux)
 * Zero-dependency standalone media daemon with HTTP Range streaming and token security.
 */

import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

// Load configuration from config.json or environment variables
function getFreshConfig() {
  const configPath = path.resolve(process.cwd(), "config.json");
  let cfg = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      cfg = JSON.parse(raw);
    } catch (err) {
      console.warn("Could not parse config.json, using defaults:", err.message);
    }
  }

  const defaultId = os.hostname().toLowerCase().replace(/[^a-z0-9_-]/g, "-");

  return {
    PORT: parseInt(process.env.PORT || String(cfg.port || 3399), 10),
    DEVICE_ID: (process.env.KOKA_DEVICE_ID || cfg.deviceId || defaultId).trim(),
    NODE_NAME: process.env.KOKA_NODE_NAME || cfg.nodeName || `${os.hostname()} (${os.platform()})`,
    STREAM_SECRET: process.env.KOKA_STREAM_SECRET || cfg.secret || "",
    ANIME_PATH: path.resolve(process.cwd(), process.env.ANIME_PATH || cfg.animePath || "./anime"),
    MANGA_PATH: path.resolve(process.cwd(), process.env.MANGA_PATH || cfg.mangaPath || "./manga"),
    NODE_TYPE: os.platform() === "android" || process.env.PREFIX?.includes("termux") ? "mobile" : "desktop",
  };
}

const MIME_TYPES = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".vtt": "text/vtt",
  ".srt": "text/plain",
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
};

const IMAGE_EXTENSIONS_REGEX = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?|jxl|heic|heif)$/i;

function isSafePath(base, target) {
  if (!base || !target) return false;
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
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

function naturalSort(a, b) {
  const strA = typeof a === "string" ? a : (a?.name || a?.file || "");
  const strB = typeof b === "string" ? b : (b?.name || b?.file || "");
  return strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
}

const initialConfig = getFreshConfig();
console.log("=========================================");
console.log(" Koka Streaming Bridge (Standalone)");
console.log(` Device ID : ${initialConfig.DEVICE_ID}`);
console.log(` Node Name : ${initialConfig.NODE_NAME}`);
console.log(` Node Type : ${initialConfig.NODE_TYPE}`);
console.log(` Anime Path: ${initialConfig.ANIME_PATH}`);
console.log(` Manga Path: ${initialConfig.MANGA_PATH}`);
console.log(` Listening : http://0.0.0.0:${initialConfig.PORT}`);
console.log("=========================================");

const server = http.createServer((req, res) => {
  const currentConfig = getFreshConfig();
  const { PORT, DEVICE_ID, NODE_NAME, STREAM_SECRET, ANIME_PATH, MANGA_PATH, NODE_TYPE } = currentConfig;

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

  // 2. Secret Verification Guard for all other media/scanner requests
  if (STREAM_SECRET) {
    const headerSecret = req.headers["x-koka-stream-secret"];
    const querySecret = parsedUrl.searchParams.get("secret");
    if (headerSecret !== STREAM_SECRET && querySecret !== STREAM_SECRET) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing X-Koka-Stream-Secret key." }));
      return;
    }
  }

  // 3. Scanner state endpoint
  if (pathname === "/api/scanner/state") {
    let animeList = [];
    let mangaList = [];

    try {
      if (fs.existsSync(ANIME_PATH)) {
        const animeDirs = fs.readdirSync(ANIME_PATH, { withFileTypes: true }).filter((d) => d.isDirectory());
        animeList = animeDirs.map((dir) => {
          const folderPath = path.join(ANIME_PATH, dir.name);
          const slug = dir.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          let seasons = [];
          
          try {
            const subItems = fs.readdirSync(folderPath, { withFileTypes: true });
            const subDirs = subItems.filter((d) => d.isDirectory()).sort((a, b) => naturalSort(a.name, b.name));
            
            if (subDirs.length > 0) {
              seasons = subDirs.map((s) => {
                const sPath = path.join(folderPath, s.name);
                const sFiles = fs.readdirSync(sPath, { withFileTypes: true })
                  .filter((f) => f.isFile() && /\.(mp4|mkv|webm|avi|mov)$/i.test(f.name))
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
                .filter((f) => f.isFile() && /\.(mp4|mkv|webm|avi|mov)$/i.test(f.name))
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

          return {
            slug,
            folderName: dir.name,
            folderPath,
            seasons,
            episodeCount: seasons.reduce((acc, s) => acc + s.episodes.length, 0),
          };
        });
      }

      if (fs.existsSync(MANGA_PATH)) {
        const rootEntries = fs.readdirSync(MANGA_PATH, { withFileTypes: true });
        const mangaDirs = rootEntries.filter((d) => d.isDirectory());
        
        // 1. Scan manga subdirectories
        for (const dir of mangaDirs) {
          const folderPath = path.join(MANGA_PATH, dir.name);
          const slug = dir.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          let chapters = [];
          
          try {
            const subItems = fs.readdirSync(folderPath, { withFileTypes: true });
            
            // Check for cbz / zip files
            const archiveChapters = subItems
              .filter((f) => f.isFile() && /\.(cbz|zip)$/i.test(f.name))
              .map((f) => ({
                file: f.name,
                label: f.name.replace(/\.[^/.]+$/, ""),
                relativePath: f.name,
                format: f.name.endsWith(".cbz") ? "cbz" : "zip",
              }))
              .sort((a, b) => naturalSort(a.file, b.file));

            // Check for chapter subdirectories
            const folderChapters = subItems
              .filter((d) => d.isDirectory() && !d.name.startsWith("."))
              .map((d) => ({
                file: d.name,
                label: d.name,
                relativePath: d.name,
                format: "folder",
              }))
              .sort((a, b) => naturalSort(a.file, b.file));

            // Check for direct loose images in series directory
            const looseImages = subItems.filter((f) => f.isFile() && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name));

            if (archiveChapters.length > 0) {
              chapters = archiveChapters;
            } else if (folderChapters.length > 0) {
              chapters = folderChapters;
            } else if (looseImages.length > 0) {
              chapters = [{
                file: "Chapter 1",
                label: "Chapter 1",
                relativePath: "",
                format: "folder",
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

        // 2. Scan root manga files (.cbz / .zip files directly in MANGA_PATH)
        const rootArchives = rootEntries.filter((f) => f.isFile() && /\.(cbz|zip)$/i.test(f.name));
        for (const file of rootArchives) {
          const baseName = file.name.replace(/\.[^/.]+$/, "");
          const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          mangaList.push({
            slug,
            folderName: baseName,
            folderPath: path.join(MANGA_PATH, file.name),
            chapters: [{
              file: file.name,
              label: baseName,
              relativePath: file.name,
              format: file.name.endsWith(".cbz") ? "cbz" : "zip",
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

function findVideoFilePath(baseDir, slug, season, file) {
  if (!baseDir || !fs.existsSync(baseDir)) return null;

  // 1. Direct path check
  const directPath = path.join(baseDir, slug, file);
  if (fs.existsSync(directPath) && isSafePath(baseDir, directPath)) return directPath;

  if (season && season !== "Season 1") {
    const directSeasonPath = path.join(baseDir, slug, season, file);
    if (fs.existsSync(directSeasonPath) && isSafePath(baseDir, directSeasonPath)) return directSeasonPath;
  }

  // 2. Scan directory to match folder by exact name or normalized slug
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const targetFolder = entries.find((e) => e.isDirectory() && (
      e.name === slug ||
      e.name.toLowerCase() === slug.toLowerCase() ||
      e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === slug.toLowerCase()
    ));

    if (targetFolder) {
      const folderPath = path.join(baseDir, targetFolder.name);

      // Check root of folder
      const inFolder = path.join(folderPath, file);
      if (fs.existsSync(inFolder) && isSafePath(baseDir, inFolder)) return inFolder;

      // Check season subfolder
      if (season) {
        const inSeason = path.join(folderPath, season, file);
        if (fs.existsSync(inSeason) && isSafePath(baseDir, inSeason)) return inSeason;
      }

      // Scan all subdirectories (seasons)
      const subEntries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isDirectory()) {
          const subPath = path.join(folderPath, sub.name, file);
          if (fs.existsSync(subPath) && isSafePath(baseDir, subPath)) return subPath;

          // Case-insensitive file match
          const nestedFiles = fs.readdirSync(path.join(folderPath, sub.name), { withFileTypes: true });
          const match = nestedFiles.find((f) => f.isFile() && f.name.toLowerCase() === file.toLowerCase());
          if (match) {
            const resolved = path.join(folderPath, sub.name, match.name);
            if (isSafePath(baseDir, resolved)) return resolved;
          }
        }
      }

      // Root files case-insensitive match
      const rootMatch = subEntries.find((f) => f.isFile() && f.name.toLowerCase() === file.toLowerCase());
      if (rootMatch) {
        const resolved = path.join(folderPath, rootMatch.name);
        if (isSafePath(baseDir, resolved)) return resolved;
      }
    }
  } catch (err) {
    console.warn("Path search error:", err.message);
  }

  return null;
}

  // 4. Video Stream Endpoint (with HTTP 206 Range seeking support)
  if (pathname === "/api/stream/video") {
    const slug = parsedUrl.searchParams.get("slug");
    const file = parsedUrl.searchParams.get("file");
    const season = parsedUrl.searchParams.get("season");

    if (!slug || !file) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing slug or file parameter");
      return;
    }

    const targetPath = findVideoFilePath(ANIME_PATH, slug, season, file);

    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Video file not found");
      return;
    }

    const stat = fs.statSync(targetPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "video/mp4";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(targetPath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType,
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Accept-Ranges": "bytes",
        "Content-Type": contentType,
      });
      fs.createReadStream(targetPath).pipe(res);
    }
    return;
  }

function parseZipEntries(buffer) {
  const entries = [];

  // Find End of Central Directory record (0x06054b50) searching backwards
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

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

      if (!filename.endsWith("/") && !filename.startsWith("__MACOSX") && IMAGE_EXTENSIONS_REGEX.test(filename)) {
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

  // Fallback: scan local headers if central directory was empty
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

        if (!filename.endsWith("/") && !filename.startsWith("__MACOSX") && IMAGE_EXTENSIONS_REGEX.test(filename)) {
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

function findMangaPath(baseDir, slug, chapter) {
  if (!baseDir || !fs.existsSync(baseDir)) return null;

  // 1. Direct path check
  if (slug && chapter) {
    const directPath = path.join(baseDir, slug, chapter);
    if (fs.existsSync(directPath)) return directPath;
  }
  if (slug) {
    const directSlug = path.join(baseDir, slug);
    if (fs.existsSync(directSlug)) {
      if (!chapter || chapter === "Chapter 1" || chapter === "") return directSlug;
    }
  }
  if (chapter) {
    const directChapter = path.join(baseDir, chapter);
    if (fs.existsSync(directChapter)) return directChapter;
  }

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });

    // Check if root archive matches slug or chapter
    const rootArchive = entries.find((e) => e.isFile() && (
      e.name === chapter ||
      e.name.toLowerCase() === (chapter || "").toLowerCase() ||
      e.name === slug ||
      e.name.toLowerCase() === (slug || "").toLowerCase() ||
      e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === (slug || "").toLowerCase() ||
      e.name.replace(/\.[^/.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-") === (slug || "").toLowerCase()
    ));
    if (rootArchive) return path.join(baseDir, rootArchive.name);

    // Find matching series folder
    const targetFolder = entries.find((e) => e.isDirectory() && (
      e.name === slug ||
      e.name.toLowerCase() === (slug || "").toLowerCase() ||
      e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === (slug || "").toLowerCase()
    ));

    if (targetFolder) {
      const folderPath = path.join(baseDir, targetFolder.name);
      if (!chapter || chapter === "Chapter 1" || chapter === "") return folderPath;

      const inChapter = path.join(folderPath, chapter);
      if (fs.existsSync(inChapter)) return inChapter;

      const subEntries = fs.readdirSync(folderPath, { withFileTypes: true });
      const subMatch = subEntries.find((s) => (
        s.name === chapter ||
        s.name.toLowerCase() === chapter.toLowerCase() ||
        s.name.replace(/\.[^/.]+$/, "").toLowerCase() === chapter.replace(/\.[^/.]+$/, "").toLowerCase() ||
        s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") === chapter.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      ));
      if (subMatch) return path.join(folderPath, subMatch.name);

      // If no subfolder/archive matched, but folder has loose images, treat folder itself as the chapter
      const hasImages = subEntries.some((f) => f.isFile() && IMAGE_EXTENSIONS_REGEX.test(f.name));
      if (hasImages) return folderPath;
    }
  } catch (err) {
    console.warn("Manga path search error:", err.message);
  }

  return null;
}

  // 5. Manga Chapter Pages List Endpoint
  if (pathname === "/api/manga/pages") {
    const slug = parsedUrl.searchParams.get("slug");
    const chapter = parsedUrl.searchParams.get("chapter");

    if (!slug) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing slug parameter" }));
      return;
    }

    const targetPath = findMangaPath(MANGA_PATH, slug, chapter);
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Manga chapter not found" }));
      return;
    }

    try {
      const stat = fs.statSync(targetPath);
      if (stat.isFile() && /\.(cbz|zip)$/i.test(targetPath)) {
        const buffer = fs.readFileSync(targetPath);
        const entries = parseZipEntries(buffer);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          pageCount: entries.length,
          pages: entries.map((e, idx) => ({ index: idx, name: path.basename(e.name) })),
        }));
        return;
      } else if (stat.isDirectory()) {
        const subFiles = fs.readdirSync(targetPath, { withFileTypes: true });
        const imageFiles = subFiles
          .filter((f) => f.isFile() && IMAGE_EXTENSIONS_REGEX.test(f.name))
          .map((f) => f.name)
          .sort(naturalSortPages);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          pageCount: imageFiles.length,
          pages: imageFiles.map((name, idx) => ({ index: idx, name })),
        }));
        return;
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // 6. Manga Page Image Stream Endpoint
  if (pathname === "/api/stream/manga-page") {
    const slug = parsedUrl.searchParams.get("slug");
    const chapter = parsedUrl.searchParams.get("chapter");
    const pageStr = parsedUrl.searchParams.get("page");
    const pageIndex = parseInt(pageStr || "0", 10);

    if (!slug) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing slug");
      return;
    }

    const targetPath = findMangaPath(MANGA_PATH, slug, chapter);
    if (!targetPath || !fs.existsSync(targetPath)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Chapter not found");
      return;
    }

    try {
      const stat = fs.statSync(targetPath);
      if (stat.isFile() && /\.(cbz|zip)$/i.test(targetPath)) {
        const buffer = fs.readFileSync(targetPath);
        const entries = parseZipEntries(buffer);
        if (pageIndex < 0 || pageIndex >= entries.length) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Page not found");
          return;
        }
        const imgBuffer = extractZipEntry(buffer, entries[pageIndex]);
        const ext = path.extname(entries[pageIndex].name).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        });
        res.end(imgBuffer);
        return;
      } else if (stat.isDirectory()) {
        const subFiles = fs.readdirSync(targetPath, { withFileTypes: true });
        const imageFiles = subFiles
          .filter((f) => f.isFile() && IMAGE_EXTENSIONS_REGEX.test(f.name))
          .map((f) => f.name)
          .sort(naturalSortPages);

        if (pageIndex < 0 || pageIndex >= imageFiles.length) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Page not found");
          return;
        }
        const imgPath = path.join(targetPath, imageFiles[pageIndex]);
        const ext = path.extname(imgPath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[ext] || "image/jpeg",
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
