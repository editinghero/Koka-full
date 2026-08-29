# Koka Standalone — Local Anime & Manga Dashboard

A 100% self-hosted, offline-capable anime and manga dashboard with local filesystem media library integration, built-in HTML5 video player, multi-mode manga reader, AniList synchronization, and embedded SQLite/LibSQL database.

Designed to run completely on your local machine (Windows, macOS, Linux) or on Android via Termux with direct disk access.

---

## Features

### Local Media Library & Streaming
- **Anime Directory Scanner**: Automatically scans local directories for anime series, detecting seasons, specials, and video episodes (`.mp4`, `.mkv`, `.webm`) with natural numerical sorting.
- **Manga Archive Scanner**: Detects manga titles, folders, and chapter archives (`.cbz`, `.cbr`, `.zip`, and raw image folders) with zero manual indexing required.
- **Embedded HTML5 Video Player**: Custom video player supporting playback speed adjustment (0.5x–2x), subtitle track selection (`.vtt`, `.srt`), 10-second skip gestures, fullscreen toggle, and automatic timestamp progress persistence.
- **Multi-Mode Manga Reader**: Continuous Webtoon vertical scroll with automatic pixel-accurate resume, Single Page, and Double Page spreads (LTR and RTL reading directions) with zoom controls, fit modes, and pinch gestures.
- **Local Media Linking**: Automatic title slug matching to AniList entries. Unlinked disk titles appear in the Downloaded section with quick-play and manual search-to-link capabilities.

### Offline & Online Integration
- **Zero Cloud Dependencies**: All library data, watch history, rewatch counts, and notes are saved locally to `file:.data/koka.db`.
- **AniList & MAL Integration**: Query metadata directly via the AniList GraphQL API, with full import/export support for AniList sync, MyAnimeList (MAL CSV), and local JSON backups.
- **Airing Schedule Radar**: Real-time countdowns for upcoming weekly episodes with urgent countdown indicators and browser desktop alerts.
- **Personal Notes & PIN Protection**: Markdown notes attached per title or globally, protected by a local device PIN security lock.

---

## Tech Stack

- **Frontend**: React 19, TanStack Router, TanStack Query, Tailwind CSS, Lucide React
- **Backend**: TanStack Start SSR, Server Functions, Node.js HTTP Streaming API
- **Database**: Local LibSQL / SQLite (`.data/koka.db`)
- **Package Manager**: `pnpm`

---

## Getting Started

### 1. Installation

```bash
# From workspace root
pnpm install
```

### 2. Running Locally

```bash
# Start development server on port 3399
pnpm dev:standalone
```

Open your browser at `http://localhost:3399`.

### 3. Production Build

```bash
pnpm build:standalone
pnpm --filter @koka/standalone start
```

---

## Running on Android (Termux)

1. **Install Prerequisites in Termux**:
   ```bash
   pkg update && pkg upgrade -y
   pkg install nodejs-lts git -y
   npm install -g pnpm
   ```

2. **Grant Storage Permissions**:
   ```bash
   termux-setup-storage
   ```

3. **Configure Media Paths in Settings**:
   - Anime folder: `/sdcard/Anime`
   - Manga folder: `/sdcard/Manga`

4. **Launch Server**:
   ```bash
   pnpm dev:standalone
   ```
   Access `http://localhost:3399` directly in your mobile browser.
