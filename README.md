# Koka (`kokaaq`) — Modern Anime & Manga Dashboard

A comprehensive, full-stack anime and manga management dashboard with local media library integration, built-in HTML5 video player, multi-mode manga reader, AI news radar, AniList synchronization, and Cloudflare Pages + Cloudflare D1 distributed database support.

---

## Features

### Media Streaming & Manga Reader
- **Anime Directory Scanner**: Scans local directories for anime series, detecting seasons, specials, and video episodes (`.mp4`, `.mkv`, `.webm`) with natural numerical sorting.
- **Manga Archive Scanner**: Detects manga titles, folders, and chapter archives (`.cbz`, `.cbr`, `.zip`, and raw image folders) with zero manual indexing required.
- **Embedded HTML5 Video Player**: Custom video player supporting playback speed adjustment (0.5x–2x), subtitle track selection (`.vtt`, `.srt`), 10-second skip gestures, fullscreen toggle, and automatic timestamp progress persistence.
- **Multi-Mode Manga Reader**: Continuous Webtoon vertical scroll with automatic pixel-accurate resume, Single Page, and Double Page spreads (LTR and RTL reading directions) with zoom controls, fit modes, and pinch gestures.
- **Local Media Linking**: Automatic title slug matching to AniList entries. Unlinked disk titles appear in the Downloaded section with quick-play and manual search-to-link capabilities.

### Online Tracking & Multi-Device Sync
- **24/7 Cloudflare Pages & D1 Database**: Deployed to Cloudflare Pages with Cloudflare D1 distributed SQLite database for global access to your library, watch progress, AniList tracking, news radar, and notes.
- **Multi-Device Local Streaming Bridge**: On-demand streaming from your Desktop PC (large 200GB+ collection) or Mobile Phone (Android Termux) through an encrypted Cloudflare Tunnel with pre-shared token security (`X-Koka-Stream-Secret`).
- **Offline Streamer Detection**: Displays a clean status card with instant connection retry when your local PC or Termux streamer is offline.
- **AniList & MAL Integration**: Query metadata directly via the AniList GraphQL API, with full import/export support for AniList sync, MyAnimeList (MAL CSV), and local JSON backups.
- **Airing Schedule Radar**: Real-time countdowns for upcoming weekly episodes with urgent countdown indicators and browser desktop alerts.
- **Personal Notes & PIN Protection**: Markdown notes attached per title or globally, protected by a local device PIN security lock.

---

## Tech Stack

- **Frontend**: React 19, TanStack Router, TanStack Query, Tailwind CSS, Lucide React
- **Cloud Platform**: Cloudflare Pages, Cloudflare Workers Runtime
- **Database**: Cloudflare D1 Distributed SQLite Database (Cloud) / LibSQL (Local Dev)
- **Streaming Bridge**: Zero-dependency Node.js Streaming Bridge + Cloudflare Tunnel (`cloudflared`)
- **Package Manager**: `pnpm`

---

## Getting Started

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/editinghero/koka.git
cd koka

# Install dependencies
pnpm install
```

### 2. Local Development (Pure Local Mode)

When running locally on your PC, Koka reads directly from local `./anime`, `./manga`, and local database without needing a tunnel:

```bash
# Start local development server on port 3399
pnpm dev
```

Open your browser at `http://localhost:3399`.

### 3. Deploying to Cloudflare Pages (`kokaaq.pages.dev`)

```bash
# Build the production bundle
pnpm build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist/client --project-name kokaaq
```

---

## Streaming Media from PC or Android Termux

To stream your downloaded anime and manga to `https://kokaaq.pages.dev`, use the lightweight companion daemon in `koka-streamer/`:

### 1. On Desktop PC

1. Configure `koka-streamer/config.json`:
   ```json
   {
     "port": 3399,
     "nodeName": "Main-Desktop-PC",
     "secret": "your_stream_secret_here",
     "animePath": "D:/Media/Anime",
     "mangaPath": "D:/Media/Manga"
   }
   ```
2. Start the streamer:
   ```bash
   cd koka-streamer
   node index.js
   ```
3. Start Cloudflare Tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:3399
   ```
4. Paste the tunnel URL and secret key into **Koka Settings -> Streaming Bridge**.

---

### 2. On Android Phone (Termux)

Copy only the `koka-streamer` folder (under 50KB) to your phone:

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
     "secret": "your_stream_secret_here",
     "animePath": "/sdcard/Anime",
     "mangaPath": "/sdcard/Manga"
   }
   ```
3. Start streamer in Termux:
   ```bash
   node index.js
   ```
