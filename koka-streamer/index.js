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
  let cfg = {
    port: 3399,
    nodeName: `${os.hostname()} (${os.platform()})`,
    secret: "",
    animePath: "./anime",
    mangaPath: "./manga",
  };

  const configPath = path.resolve(process.cwd(), "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      cfg = { ...cfg, ...JSON.parse(raw) };
    } catch (err) {
      console.warn("Could not parse config.json, using defaults:", err.message);
    }
  }

  return {
    PORT: parseInt(process.env.PORT || String(cfg.port), 10),
    NODE_NAME: process.env.KOKA_NODE_NAME || cfg.nodeName,
    STREAM_SECRET: process.env.KOKA_STREAM_SECRET || cfg.secret,
    ANIME_PATH: path.resolve(process.cwd(), process.env.ANIME_PATH || cfg.animePath),
    MANGA_PATH: path.resolve(process.cwd(), process.env.MANGA_PATH || cfg.mangaPath),
    NODE_TYPE: os.platform() === "android" || process.env.PREFIX?.includes("termux") ? "mobile" : "desktop",
  };
}

const initialConfig = getFreshConfig();
console.log("=========================================");
console.log(" Koka Streaming Bridge (Standalone)");
console.log(` Node Name : ${initialConfig.NODE_NAME}`);
console.log(` Node Type : ${initialConfig.NODE_TYPE}`);
console.log(` Anime Path: ${initialConfig.ANIME_PATH}`);
console.log(` Manga Path: ${initialConfig.MANGA_PATH}`);
console.log(` Listening : http://0.0.0.0:${initialConfig.PORT}`);
console.log("=========================================");

const server = http.createServer((req, res) => {
  const currentConfig = getFreshConfig();
  const { PORT, NODE_NAME, STREAM_SECRET, ANIME_PATH, MANGA_PATH, NODE_TYPE } = currentConfig;

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
                }))
                .sort((a, b) => naturalSort(a.file, b.file));
              if (rootFiles.length > 0) {
                seasons = [{ name: "Season 1", episodes: rootFiles }];
              }
            }
          } catch (err) {
            console.warn(`Error scanning anime folder ${dir.name}:`, err.message);
          }

          const hasLocalPoster = fs.existsSync(path.join(folderPath, "poster.jpg")) || fs.existsSync(path.join(folderPath, "cover.jpg"));
          return {
            slug,
            folderName: dir.name,
            folderPath,
            seasons,
            episodeCount: seasons.reduce((acc, s) => acc + s.episodes.length, 0),
            hasLocalPoster,
          };
        });
      }

      if (fs.existsSync(MANGA_PATH)) {
        const rootEntries = fs.readdirSync(MANGA_PATH, { withFileTypes: true });
        const mangaDirs = rootEntries.filter((d) => d.isDirectory());
        
        // 1. Scan manga subdirectories
        mangaList = mangaDirs.map((dir) => {
          const folderPath = path.join(MANGA_PATH, dir.name);
          const slug = dir.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          let chapters = [];

          try {
            const items = fs.readdirSync(folderPath, { withFileTypes: true });
            
            // Check if folder contains direct image pages
            const directImages = items.filter((f) => f.isFile() && /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name));
            if (directImages.length > 0) {
              chapters = [{
                file: dir.name,
                label: "Chapter 1",
                relativePath: ".",
                format: "folder",
                pageCount: directImages.length,
              }];
            } else {
              chapters = items
                .filter((item) => item.isDirectory() || /\.(cbz|cbr|zip)$/i.test(item.name))
                .map((item) => ({
                  file: item.name,
                  label: item.name.replace(/\.[^/.]+$/, ""),
                  relativePath: item.name,
                  format: item.isDirectory() ? "folder" : item.name.endsWith(".cbz") ? "cbz" : "zip",
                }))
                .sort((a, b) => naturalSort(a.file, b.file));
            }
          } catch (err) {
            console.warn(`Error scanning manga folder ${dir.name}:`, err.message);
          }

          const hasLocalPoster = fs.existsSync(path.join(folderPath, "poster.jpg")) || fs.existsSync(path.join(folderPath, "cover.jpg"));
          return {
            slug,
            folderName: dir.name,
            folderPath,
            chapters,
            chapterCount: chapters.length,
            hasLocalPoster,
          };
        });

        // 2. Scan any root-level CBZ/ZIP files
        const rootMangaFiles = rootEntries.filter((f) => f.isFile() && /\.(cbz|cbr|zip)$/i.test(f.name));
        for (const file of rootMangaFiles) {
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
            hasLocalPoster: false,
          });
        }
      }
    } catch (err) {
      console.error("Scan error:", err.message);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      online: true,
      nodeName: NODE_NAME,
      nodeType: NODE_TYPE,
      anime: animeList,
      manga: mangaList,
      timestamp: Date.now(),
    }));
    return;
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

    let targetPath = "";
    if (season && season !== "Season 1") {
      targetPath = path.join(ANIME_PATH, slug, season, file);
    } else {
      targetPath = path.join(ANIME_PATH, slug, file);
      if (!fs.existsSync(targetPath)) {
        targetPath = path.join(ANIME_PATH, slug, "Season 1", file);
      }
    }

    if (!isSafePath(ANIME_PATH, targetPath) || !fs.existsSync(targetPath)) {
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

  // 5. Poster / Cover Art Endpoint
  if (pathname === "/api/media/poster") {
    const slug = parsedUrl.searchParams.get("slug");
    const type = parsedUrl.searchParams.get("type") || "anime";
    const baseDir = type === "manga" ? MANGA_PATH : ANIME_PATH;

    if (!slug) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Missing slug");
      return;
    }

    const possibleFiles = ["poster.jpg", "poster.png", "cover.jpg", "cover.png", "poster.webp"];
    for (const name of possibleFiles) {
      const p = path.join(baseDir, slug, name);
      if (isSafePath(baseDir, p) && fs.existsSync(p)) {
        const ext = path.extname(p).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "image/jpeg" });
        fs.createReadStream(p).pipe(res);
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Cover not found");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(initialConfig.PORT, "0.0.0.0", () => {
  console.log(` Koka Bridge ready on port ${initialConfig.PORT}`);
});
