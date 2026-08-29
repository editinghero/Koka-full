# Koka Streamer — Lightweight Media Bridge for PC & Mobile Termux

An ultra-lightweight, zero-dependency Node.js media streaming bridge for Koka Hybrid (`kokaaq.pages.dev`).

Runs on any Desktop PC or Android phone (via Termux) to securely stream your local anime (`.mp4`, `.mkv`) and manga (`.cbz`, images) across a Cloudflare Tunnel.

---

## Features

- **Zero npm dependencies**: Uses only built-in Node.js modules (`node:http`, `node:fs`, `node:path`).
- **HTTP 206 Partial Content**: Full instant video scrubbing and timestamp seeking in the browser.
- **Pre-Shared Token Security**: Requires `X-Koka-Stream-Secret` header so unauthorized visitors cannot access your tunnel.
- **Path Traversal Protection**: Sandboxed to designated anime and manga folders.

---

## Quick Start on PC

1. Configure `config.json` or `.env`:
   ```json
   {
     "port": 3399,
     "nodeName": "Main-Desktop-PC",
     "secret": "sd",
     "animePath": "D:/Media/Anime",
     "mangaPath": "D:/Media/Manga"
   }
   ```

2. Start the streamer:
   ```bash
   node index.js
   ```

3. Expose via Cloudflare Tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:3399
   ```

4. Paste the tunnel URL and secret key into **Koka Settings -> Streaming Bridge**.

---

## Quick Start on Android (Termux)

You only need to copy this `koka-streamer` folder to your phone (under 50KB total!).

1. In Termux:
   ```bash
   pkg install nodejs-lts -y
   termux-setup-storage
   ```

2. In `config.json`, set phone storage paths:
   ```json
   {
     "port": 3399,
     "nodeName": "Pixel-Phone",
     "secret": "sd",
     "animePath": "/sdcard/Anime",
     "mangaPath": "/sdcard/Manga"
   }
   ```

3. Start streamer and tunnel in Termux:
   ```bash
   node index.js
   ```
