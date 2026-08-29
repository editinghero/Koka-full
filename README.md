# Koka — Modern Anime & Manga Dashboard

A comprehensive, full-stack anime and manga management dashboard with local media library integration, built-in HTML5 video player, multi-mode manga reader, AI news radar, AniList sync, and SQLite/D1 database support.

---

## Workspace Structure

This monorepo is structured into two dedicated packages:

```text
koka/
├── standalone/     # 100% Self-contained local application (PC & Android Termux)
└── hybrid/         # Cloudflare Pages + Cloudflare D1 + Remote Tunnel Streaming Bridge
```

---

## Packages Overview

### 1. `standalone` (100% Self-Hosted Local App)
- **Use Case**: Running completely locally on your Desktop PC, Laptop, or Android Phone (via Termux).
- **Storage**: Local LibSQL / SQLite (`file:.data/koka.db`) with zero external cloud dependencies.
- **Media**: Directly reads anime video files (`.mp4`, `.mkv`) and manga archives (`.cbz`, `.cbr`, folders) from your disk.
- **Documentation**: See [standalone/README.md](file:///e:/Web/devProjects/Koka-full/standalone/README.md).

### 2. `hybrid` (Cloudflare Pages + D1 + Streaming Bridge)
- **Use Case**: 24/7 online website hosted on Cloudflare Pages with Cloudflare D1 distributed database.
- **Media**: Connects to your local PC or Android Termux storage on-demand through an encrypted Cloudflare Tunnel.
- **Documentation**: See [hybrid/README.md](file:///e:/Web/devProjects/Koka-full/hybrid/README.md).

---

## Commands

| Command | Description |
|---|---|
| `pnpm dev:standalone` | Launch standalone local development server on `http://localhost:3399` |
| `pnpm dev:hybrid` | Launch hybrid Cloudflare Pages development server |
| `pnpm build:standalone` | Build standalone production bundle |
| `pnpm build:hybrid` | Build Cloudflare Pages hybrid production bundle |
| `pnpm build` | Build all workspace packages |
| `node hybrid/scripts/koka-streamer.js` | Run lightweight streaming daemon on PC/Termux |
