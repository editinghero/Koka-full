#!/usr/bin/env node

/**
 * Koka Lightweight Streaming Bridge (PC & Android Termux)
 * Zero-dependency standalone media daemon with HTTP Range streaming and token security.
 */

import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
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
  ".gif": "image/gif",
};

function isSafePath(base, target) {
  if (!base || !target) return false;
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
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

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(initialConfig.PORT, () => {
  console.log(` Koka Bridge ready on port ${initialConfig.PORT}`);
});
