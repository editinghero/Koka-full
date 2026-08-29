#!/usr/bin/env node

/**
 * Koka Lightweight Streaming Bridge (for PC & Android Termux)
 * Exposes local Anime/Manga folders over LAN or Cloudflare Tunnel to the Koka Pages Hybrid App.
 */

import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = parseInt(process.env.PORT || "3399", 10);
const NODE_NAME = process.env.KOKA_NODE_NAME || `${os.hostname()} (${os.platform()})`;
const NODE_TYPE = os.platform() === "android" || process.env.PREFIX?.includes("termux") ? "mobile" : "desktop";

// Default folder paths
const DEFAULT_ANIME_PATH = process.env.ANIME_PATH || path.resolve(process.cwd(), "anime");
const DEFAULT_MANGA_PATH = process.env.MANGA_PATH || path.resolve(process.cwd(), "manga");

console.log("=========================================");
console.log(` Starting Koka Streaming Bridge`);
console.log(` Node Name : ${NODE_NAME}`);
console.log(` Node Type : ${NODE_TYPE}`);
console.log(` Anime Path: ${DEFAULT_ANIME_PATH}`);
console.log(` Manga Path: ${DEFAULT_MANGA_PATH}`);
console.log(` Listening : http://0.0.0.0:${PORT}`);
console.log("=========================================");

const server = http.createServer((req, res) => {
  // CORS Headers for Hybrid Pages Frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range, Authorization");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // Health check endpoint
  if (pathname === "/api/health" || pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", nodeName: NODE_NAME, nodeType: NODE_TYPE, timestamp: Date.now() }));
    return;
  }

  // Scanner status endpoint
  if (pathname === "/api/scanner/state") {
    let animeFolders = [];
    let mangaFolders = [];
    try {
      if (fs.existsSync(DEFAULT_ANIME_PATH)) {
        animeFolders = fs.readdirSync(DEFAULT_ANIME_PATH, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => ({ slug: d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), folderName: d.name }));
      }
      if (fs.existsSync(DEFAULT_MANGA_PATH)) {
        mangaFolders = fs.readdirSync(DEFAULT_MANGA_PATH, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => ({ slug: d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), folderName: d.name }));
      }
    } catch (e) {
      console.warn("Scan error:", e.message);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      online: true,
      nodeName: NODE_NAME,
      nodeType: NODE_TYPE,
      anime: animeFolders,
      manga: mangaFolders,
      timestamp: Date.now()
    }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(` Bridge active on port ${PORT}. Ready to pair with Cloudflare Tunnel.`);
});
