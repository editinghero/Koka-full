# Koka Hybrid — Cloudflare Pages + Local Media Streaming Bridge

A hybrid deployment architecture for Koka:
- **Cloud Edge (Online)**: Hosted on Cloudflare Pages with Cloudflare D1 distributed database for 24/7 global access to your library, watch progress, AniList tracking, news radar, and notes.
- **Local Streamer (On-Demand)**: A lightweight streaming bridge daemon (`koka-streamer.js`) that runs on your local PC or Android Termux, securely connected via Cloudflare Tunnel whenever you want to stream anime or read manga.

---

## Architecture Overview

```text
[ Cloudflare Pages Frontend ]  <--- (24/7 Global Web App)
             |
             +---> [ Cloudflare D1 Database ] (Synced Library, Progress, Notes)
             |
             +---> [ Cloudflare Tunnel ] (Encrypted Remote Tunnel)
                         |
                         +---> [ Local Streamer Bridge (PC or Mobile Termux) ]
                                     |
                                     +---> Anime Folder (MP4, MKV, Subtitles)
                                     +---> Manga Folder (CBZ, CBR, Folders)
```

---

## Key Features

1. **24/7 Cloud Availability**:
   - Access your anime list, airing radar, AniList sync, and markdown notes from any device, even when your PC is shut down.
2. **Dynamic Multi-Device Tunnel Discovery**:
   - Seamlessly connect to your home PC (e.g. 200GB collection) or mobile phone (local downloads in Termux).
   - Real-time latency measurement and connected node identification.
3. **Offline Streamer Detection**:
   - When your local PC or Termux streamer is offline, the Downloaded section displays a clean connection status card with a single-click reconnect action.
4. **Zero Open Ports**:
   - Cloudflare Tunnel securely forwards streaming traffic from your home machine without needing port forwarding or public IP exposure.

---

## Tech Stack

- **Frontend**: React 19, TanStack Router, TanStack Query, Tailwind CSS, Lucide React
- **Cloud Platform**: Cloudflare Pages, Cloudflare Workers Runtime
- **Cloud Database**: Cloudflare D1 Distributed SQLite Database
- **Streaming Bridge**: Node.js HTTP Streaming Bridge + Cloudflare Tunnel (`cloudflared`)

---

## Getting Started

### 1. Development Mode

```bash
# Start the hybrid Cloudflare frontend
pnpm dev:hybrid
```

### 2. Running Local Streaming Bridge on PC / Android Termux

On your PC or Android phone containing your downloaded anime and manga:

```bash
# Start the lightweight streaming bridge
node scripts/koka-streamer.js
```

By default, the bridge listens on port `3399` and scans `./anime` and `./manga` directories.

### 3. Exposing Streamer via Cloudflare Tunnel

```bash
# Point Cloudflare Tunnel to your local bridge
cloudflared tunnel --url http://localhost:3399
```

Copy the generated tunnel address (e.g. `https://your-tunnel-name.trycloudflare.com`) and paste it into **Koka Settings -> Streaming Tunnel URL**.

---

## Cloudflare D1 Deployment

### Initialize Schema on Cloudflare D1

```bash
# Apply schema to local/remote D1 database
npx wrangler d1 execute koka --remote --file db/d1-schema.sql
```

### Build & Deploy to Cloudflare Pages

```bash
pnpm build:hybrid
npx wrangler pages deploy dist/client
```
