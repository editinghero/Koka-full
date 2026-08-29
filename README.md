# Koka - Modern Anime & Manga Dashboard

A comprehensive, full-stack anime and manga management dashboard with local media library integration, built-in HTML5 video player, multi-mode manga reader, AI news radar, AniList sync, and local LibSQL/SQLite database.

---

## Features

### Local Media Library & Streaming

- **Anime Library Scanner** - Automatically scans local directories for anime folders, detecting seasons, specials, and video episodes (`.mp4`, `.mkv`, `.webm`) with natural numerical sorting.
- **Manga Library Scanner** - Detects manga titles, folders, and chapter archives (`.cbz`, `.cbr`, `.zip`, and raw image folders) with zero manual indexing needed.
- **Embedded Video Player** - Custom video player supporting playback speed adjustment (0.5x–2x), subtitle track selection (`.vtt`, `.srt`), 10-second skip gestures, fullscreen toggle, and automatic timestamp progress saving.
- **Multi-Mode Manga Reader** - Continuous Webtoon vertical scroll, Single Page, and Double Page spreads (LTR and RTL reading directions) with attached seamless page spreads, zoom controls, fit modes (Width, Height, Contain, 1:1), and mobile pinch gestures.
- **Local Media Linking & Unlinked Management** - Automatic title slug matching to AniList entries. Unlinked disk titles appear in the Downloaded section with quick-play and manual search-to-link capabilities.

### Online Tracking & Community

- **AniList & MAL Integration** - Automatic metadata querying via the AniList GraphQL API, with full import/export support for AniList sync, MyAnimeList (MAL CSV), and local JSON backups.
- **Custom Tagging & Search** - Tag series with custom keywords (`#fav`, `#must-watch`, `#comfort`). Filter library entries instantly by title names, genres, studios, custom lists, or tag pills.
- **Airing Schedule Radar** - Real-time countdowns for upcoming weekly episodes with urgent countdown indicators and browser notification support.
- **Grounded AI News Radar** - Anime news digests, trailer releases, and schedule breakdowns powered by Google Gemini with Search Grounding.
- **Personal Notes & PIN Protection** - Markdown notes attached per title or globally, protected by a local device PIN security lock.

---

## Tech Stack

- **Frontend:** React 19, TanStack Router, TanStack Query, Tailwind CSS, Lucide React
- **Backend:** TanStack Start SSR, Server Functions, Node.js HTTP Streaming API
- **Database:** LibSQL / SQLite (`file:.data/koka.db`)
- **APIs:** AniList GraphQL API, Google Gemini AI (optional)
- **Package Manager:** `pnpm`

---

## Getting Started

### 1. Prerequisites

- Node.js v20+ or v22+
- `pnpm` (preferred package manager)

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/editinghero/koka.git
cd koka

# Install dependencies
pnpm install
```

### 3. Running Locally

```bash
# Start development server on port 3399
pnpm dev
```

Open your browser at `http://localhost:3399`.

---

## Local Folder Organization

### Anime Folder Layout

```text
Anime/
  └── Frieren Beyond Journeys End/
      ├── Season 1/
      │   ├── Episode 01.mp4
      │   ├── Episode 02.mp4
      │   └── ...
      └── poster.jpg (optional)
```

### Manga Folder Layout

```text
Manga/
  └── Chainsaw Man/
      ├── Chapter 01.cbz
      ├── Chapter 02.cbz
      └── ...
```

Configure your Anime and Manga base folder paths in **Settings -> Local Media Library** and click **Rescan Library**.

---

## Project Structure

```text
├── src/
│   ├── components/
│   │   ├── player/
│   │   │   └── VideoPlayer.tsx          # Custom HTML5 video player
│   │   ├── reader/
│   │   │   └── MangaReader.tsx          # Multi-mode Manga reader
│   │   ├── AnimeCard.tsx                # Media card component
│   │   ├── AppShell.tsx                 # Navigation and layout
│   │   ├── LocalMediaLinkModal.tsx      # Disk folder to AniList linker
│   │   ├── UnlinkedFolderModal.tsx      # Unlinked title launcher & linker
│   │   └── NotificationsDropdown.tsx    # Airing episode radar
│   ├── lib/
│   │   ├── anilist.ts                   # AniList GraphQL queries
│   │   ├── media.functions.ts           # Media scan & stream server functions
│   │   ├── data.functions.ts            # User library & preferences RPC
│   │   ├── store.ts                     # Client state management
│   │   └── types.ts                     # TypeScript definitions
│   ├── routes/
│   │   ├── index.tsx                    # Home dashboard
│   │   ├── library.tsx                  # Library with Downloaded tab
│   │   ├── anime.$id.tsx                # Title detail & streaming page
│   │   ├── settings.tsx                 # App & local library configuration
│   │   └── news.tsx                     # AI-grounded news digest
│   └── server/
│       ├── config.server.ts             # App config storage
│       ├── db.server.ts                 # LibSQL database connection
│       ├── repo.server.ts               # Local database repository
│       └── scanner.server.ts            # Fast disk media indexing
├── package.json
└── vite.config.ts
```

---

Built for anime and manga enthusiasts.
