import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  LayoutGrid,
  List as ListIcon,
  Star,
  UserRound,
  Plus,
  Minus,
  ExternalLink,
  HardDriveDownload,
  FolderSync,
  Play,
  BookOpen,
} from "lucide-react";
import { AnimeCard, Cover, countdown } from "@/components/AnimeCard";
import { PageHeader } from "@/components/AppShell";
import { useLibrary, useMediaMode } from "@/lib/store";
import { getActiveMediaScan, buildStreamUrl } from "@/lib/tunnel-client";
import { UnlinkedFolderModal } from "@/components/UnlinkedFolderModal";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { MangaReader } from "@/components/reader/MangaReader";
import type { ScannedAnime, ScannedManga } from "@/server/scanner.server";
import {
  MODE_COPY,
  STATUS_ORDER,
  statusLabel,
  totalUnits,
  mediaTypeOf,
  type WatchStatus,
  type LibraryEntry,
  type AnimeMedia,
} from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "Library — Koka Anime Dashboard" },
      {
        name: "description",
        content:
          "Track watching progress, scores, rewatches and personal notes for all your anime and manga.",
      },
      { property: "og:title", content: "Library — Koka Anime Dashboard" },
      {
        property: "og:description",
        content: "Filter your anime collection by status, genre and score.",
      },
    ],
  }),
  component: LibraryPage,
});

type SortKey = "updated" | "title" | "score" | "progress";
type ViewMode = "grid" | "list";

const STORAGE_KEYS = {
  viewMode: "koka:library:viewMode",
  sort: "koka:library:sort",
  status: "koka:library:status",
  genre: "koka:library:genre",
};

function getStoredValue<T extends string>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const val = localStorage.getItem(key);
    return (val as T) || fallback;
  } catch {
    return fallback;
  }
}

function setStoredValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function LibraryListRow({
  entry,
  onBump,
  onScoreChange,
}: {
  entry: LibraryEntry;
  onBump: (delta: number) => void;
  onScoreChange: (score: number | null) => void;
}) {
  const { mode } = useMediaMode();
  const copy = MODE_COPY[mode];
  const media = entry.media;
  const total = totalUnits(media);
  const unit = mediaTypeOf(media) === "MANGA" ? "ch" : "eps";
  const pct = total
    ? Math.min(100, Math.round((entry.progress / total) * 100))
    : 0;

  return (
    <div className="panel flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-3 transition-all duration-200 hover:border-primary/40 min-w-0 overflow-hidden">
      {/* Cover & Title */}
      <div className="flex items-center gap-3 min-w-0 flex-1 w-full md:w-auto">
        <Link
          to="/anime/$id"
          params={{ id: String(media.id) }}
          className="shrink-0 block overflow-hidden rounded"
        >
          <Cover
            media={media}
            className="h-14 w-10 sm:h-16 sm:w-12 rounded object-cover"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <Link
              to="/anime/$id"
              params={{ id: String(media.id) }}
              className="truncate text-sm font-semibold hover:text-primary transition-colors block"
            >
              {media.title}
            </Link>
            {media.seasonYear ? (
              <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                ({media.seasonYear})
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                entry.status === "CURRENT" &&
                  "bg-primary/10 text-primary border border-primary/20",
                entry.status === "COMPLETED" &&
                  "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20",
                entry.status === "PLANNING" &&
                  "bg-amber-500/10 text-amber-500 border border-amber-500/20",
                entry.status === "DROPPED" &&
                  "bg-rose-500/10 text-rose-500 border border-rose-500/20",
                entry.status === "PAUSED" &&
                  "bg-muted text-muted-foreground border border-border",
                entry.status === "REPEATING" &&
                  "bg-indigo-500/10 text-indigo-500 border border-indigo-500/20",
              )}
            >
              {statusLabel(entry.status, mode)}
            </span>

            {media.format ? (
              <span className="hidden sm:inline">· {media.format}</span>
            ) : null}

            {entry.repeat ? (
              <span className="hidden md:inline">
                · {mode === "MANGA" ? "reread" : "rewatched"} {entry.repeat}×
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Progress & Controls */}
      <div className="flex items-center justify-between md:justify-end gap-3 w-full md:w-auto pt-2 md:pt-0 border-t md:border-t-0 border-border/50">
        <div className="flex flex-col gap-1 min-w-[100px] sm:min-w-[120px]">
          <div className="flex justify-between items-center text-xs">
            <span className="font-medium text-foreground">
              {entry.progress}{" "}
              <span className="text-muted-foreground">
                / {total ?? "?"} {unit}
              </span>
            </span>
            {total ? (
              <span className="text-[10px] text-muted-foreground font-mono">
                {pct}%
              </span>
            ) : null}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => onBump(-1)}
            aria-label="Decrease progress"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => onBump(1)}
            aria-label="Increase progress"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>

        {/* Score */}
        <div className="flex items-center gap-1.5 text-xs shrink-0">
          <div className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1">
            <UserRound className="h-3 w-3 text-primary" />
            <input
              type="number"
              min={0}
              max={10}
              step={0.1}
              value={entry.score ?? ""}
              placeholder="—"
              onChange={(e) => {
                const v = e.target.value;
                onScoreChange(
                  v === "" ? null : Math.min(10, Math.max(0, Number(v))),
                );
              }}
              className="w-8 bg-transparent text-center font-medium focus:outline-none text-xs"
              title="Your Score"
            />
            <span className="text-[11px] text-muted-foreground">/10</span>
          </div>

          {media.averageScore ? (
            <div
              className="hidden lg:flex items-center gap-1 text-[11px] text-muted-foreground px-1"
              title="AniList public score"
            >
              <Star className="h-3 w-3 text-amber-500" />
              <span>{media.averageScore}%</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LibraryPage() {
  const { mode } = useMediaMode();
  const copy = MODE_COPY[mode];
  const { library, patch } = useLibrary();

  const { data: scanState, refetch: refetchScan } = useQuery({
    queryKey: ["libraryScanStatus"],
    queryFn: () => getActiveMediaScan(),
    staleTime: 1000 * 30,
  });

  const [downloadedOnly, setDownloadedOnly] = useState(false);
  const [selectedUnlinkedFolder, setSelectedUnlinkedFolder] = useState<
    ScannedAnime | ScannedManga | null
  >(null);

  // Direct player/reader trigger for unlinked items
  const [directPlayAnime, setDirectPlayAnime] = useState<ScannedAnime | null>(
    null,
  );
  const [directReadManga, setDirectReadManga] = useState<{
    manga: ScannedManga;
    chapterFile: string;
  } | null>(null);

  // Cache downloaded scan sets for O(1) checks in filtering
  const scanMediaIds = useMemo(() => {
    if (!scanState) return new Set<number>();
    const items = mode === "MANGA" ? scanState.manga : scanState.anime;
    return new Set(
      items
        .map((m) => m.mediaId)
        .filter((id): id is number => id !== undefined),
    );
  }, [scanState, mode]);

  const scanSlugs = useMemo(() => {
    if (!scanState) return new Set<string>();
    const items = mode === "MANGA" ? scanState.manga : scanState.anime;
    return new Set(items.map((m) => m.slug).filter(Boolean));
  }, [scanState, mode]);

  // Local media check helper
  const isMediaDownloaded = useCallback(
    (mediaId: number, title: string) => {
      if (!scanState) return false;
      const slug = toSlug(title);
      return scanMediaIds.has(mediaId) || scanSlugs.has(slug);
    },
    [scanState, scanMediaIds, scanSlugs],
  );

  // Compute unlinked folders on disk
  const unlinkedFolders = useMemo(() => {
    if (!scanState) return [];
    const items = mode === "MANGA" ? scanState.manga : scanState.anime;

    // Create sets for O(1) lookups against library items
    const libraryIds = new Set(library.map((e) => e.media.id));
    const librarySlugs = new Set(library.map((e) => toSlug(e.media.title)));

    return items.filter((item) => {
      if (item.mediaId && libraryIds.has(item.mediaId)) {
        return false;
      }
      if (librarySlugs.has(item.slug)) {
        return false;
      }
      return true;
    });
  }, [scanState, mode, library]);

  // LocalStorage-persisted filters and view preferences
  const [viewMode, setViewModeState] = useState<ViewMode>(() =>
    getStoredValue(STORAGE_KEYS.viewMode, "grid"),
  );
  const [sort, setSortState] = useState<SortKey>(() =>
    getStoredValue(STORAGE_KEYS.sort, "updated"),
  );
  const [status, setStatusState] = useState<WatchStatus | "ALL">(() =>
    getStoredValue(STORAGE_KEYS.status, "ALL"),
  );
  const [genre, setGenreState] = useState<string>(() =>
    getStoredValue(STORAGE_KEYS.genre, "ALL"),
  );
  const [customList, setCustomList] = useState("ALL");
  const [query, setQuery] = useState("");

  const setViewMode = (v: ViewMode) => {
    setViewModeState(v);
    setStoredValue(STORAGE_KEYS.viewMode, v);
  };

  const setSort = (s: SortKey) => {
    setSortState(s);
    setStoredValue(STORAGE_KEYS.sort, s);
  };

  const setStatus = (st: WatchStatus | "ALL") => {
    setStatusState(st);
    setStoredValue(STORAGE_KEYS.status, st);
  };

  const setGenre = (g: string) => {
    setGenreState(g);
    setStoredValue(STORAGE_KEYS.genre, g);
  };

  const genres = useMemo(() => {
    const set = new Set<string>();
    library.forEach((e) => e.media.genres?.forEach((g) => set.add(g)));
    return [...set].sort();
  }, [library]);

  const customLists = useMemo(() => {
    const set = new Set<string>();
    library.forEach((e) =>
      e.customLists?.forEach((c) => set.add(c.trim().toLowerCase())),
    );
    return [...set].sort();
  }, [library]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    library.forEach((e) =>
      e.tags?.forEach((t) => set.add(t.trim().toLowerCase())),
    );
    return [...set].sort();
  }, [library]);

  const filtered = useMemo(() => {
    const rawQuery = query.trim().toLowerCase();
    const isHashtagSearch = rawQuery.startsWith("#");
    const q = rawQuery.replace(/^#/, "");

    return library
      .filter((e) => status === "ALL" || e.status === status)
      .filter((e) => genre === "ALL" || e.media.genres?.includes(genre))
      .filter(
        (e) => !downloadedOnly || isMediaDownloaded(e.media.id, e.media.title),
      )
      .filter(
        (e) =>
          customList === "ALL" ||
          e.customLists?.some(
            (c) => c.trim().toLowerCase() === customList.trim().toLowerCase(),
          ),
      )
      .filter((e) => {
        if (!q) return true;

        const tagMatch = e.tags?.some((t) => t.toLowerCase().includes(q));

        if (isHashtagSearch) {
          return tagMatch;
        }

        const titleMatch = e.media.title.toLowerCase().includes(q);
        const genreMatch = e.media.genres?.some((g) =>
          g?.toLowerCase().includes(q),
        );
        const studioMatch = e.media.studios?.some((s) =>
          s?.toLowerCase().includes(q),
        );
        const customListMatch = e.customLists?.some((c) =>
          c?.toLowerCase().includes(q),
        );

        return (
          !!titleMatch ||
          !!genreMatch ||
          !!studioMatch ||
          !!tagMatch ||
          !!customListMatch
        );
      })
      .sort((a, b) => {
        if (sort === "title") return a.media.title.localeCompare(b.media.title);
        if (sort === "score") return (b.score ?? 0) - (a.score ?? 0);
        if (sort === "progress") return b.progress - a.progress;
        return b.updatedAt - a.updatedAt;
      });
  }, [
    library,
    status,
    genre,
    customList,
    query,
    sort,
    downloadedOnly,
    scanState,
    mode,
  ]);

  const filteredUnlinked = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return unlinkedFolders;
    return unlinkedFolders.filter(
      (f) =>
        f.folderName.toLowerCase().includes(q) ||
        f.slug.toLowerCase().includes(q),
    );
  }, [unlinkedFolders, query]);

  return (
    <>
      <PageHeader
        title={mode === "MANGA" ? "Manga library" : "Anime library"}
        subtitle={`${library.length} titles · ${filtered.length} shown${unlinkedFolders.length > 0 ? ` · ${unlinkedFolders.length} unlinked on disk` : ""}`}
        action={
          <div className="flex items-center rounded-lg border border-border bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors",
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="Grid View"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Grid</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="List View"
            >
              <ListIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">List</span>
            </button>
          </div>
        }
      />

      <div className="mb-5 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search by title, genre, or custom tag (e.g. #ecchi, #fav)`}
            className="pl-9"
          />
        </div>

        {allTags.length ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar text-xs text-muted-foreground">
            <span className="shrink-0 font-medium text-foreground">Tags:</span>
            {allTags.map((t) => (
              <button
                key={t}
                onClick={() =>
                  setQuery(
                    query.toLowerCase().replace(/^#/, "") === t.toLowerCase()
                      ? ""
                      : `#${t}`,
                  )
                }
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                  query.toLowerCase().replace(/^#/, "") === t.toLowerCase()
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border hover:border-primary hover:text-foreground",
                )}
              >
                #{t}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none no-scrollbar">
          <button
            type="button"
            onClick={() => setDownloadedOnly((d) => !d)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors whitespace-nowrap flex items-center gap-1.5",
              downloadedOnly
                ? "border-primary bg-primary text-primary-foreground font-medium"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <HardDriveDownload className="h-3.5 w-3.5" />
            <span>Downloaded</span>
            {unlinkedFolders.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-background/20 rounded-full text-[10px]">
                +{unlinkedFolders.length}
              </span>
            )}
          </button>

          {(["ALL", ...STATUS_ORDER] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors whitespace-nowrap",
                status === s
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s === "ALL" ? "All" : statusLabel(s, mode)}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap gap-2">
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5"
            >
              <option value="ALL">All genres</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            {customLists.length > 0 ? (
              <select
                value={customList}
                onChange={(e) => setCustomList(e.target.value)}
                className="rounded-lg border border-border bg-surface px-2.5 py-1.5 capitalize"
              >
                <option value="ALL">All custom lists</option>
                {customLists.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5"
            >
              <option value="updated">Recently updated</option>
              <option value="title">Title A–Z</option>
              <option value="score">Score</option>
              <option value="progress">Progress</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Grid or List View */}
      {filtered.length || (downloadedOnly && filteredUnlinked.length) ? (
        <div className="space-y-6">
          {filtered.length > 0 &&
            (viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {filtered.map((e) => (
                  <AnimeCard
                    key={e.media.id}
                    media={e.media}
                    entry={e}
                    hasLocalMedia={isMediaDownloaded(e.media.id, e.media.title)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {filtered.map((e) => (
                  <LibraryListRow
                    key={e.media.id}
                    entry={e}
                    onBump={(delta) => {
                      const current = e.progress ?? 0;
                      const next = Math.max(0, current + delta);
                      patch(e.media.id, { progress: next });
                    }}
                    onScoreChange={(newScore) => {
                      patch(e.media.id, { score: newScore });
                    }}
                  />
                ))}
              </div>
            ))}

          {/* Unlinked Local Media Section */}
          {downloadedOnly && filteredUnlinked.length > 0 && (
            <div className="pt-4 border-t border-border/60">
              <div className="flex items-center gap-2 mb-3">
                <FolderSync className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">
                  Detected on Disk (Unlinked)
                </h3>
                <span className="text-xs text-muted-foreground">
                  ({filteredUnlinked.length} folders found)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {filteredUnlinked.map((folder) => {
                  const count =
                    mode === "MANGA"
                      ? `${(folder as ScannedManga).chapterCount} chapters`
                      : `${(folder as ScannedAnime).episodeCount} episodes`;

                  return (
                    <div
                      key={folder.slug}
                      onClick={() => setSelectedUnlinkedFolder(folder)}
                      className="group cursor-pointer rounded-xl border border-dashed border-border bg-card p-2.5 transition-all duration-200 hover:border-primary hover:shadow-md flex flex-col justify-between"
                    >
                      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-secondary/50 flex items-center justify-center mb-2">
                        <HardDriveDownload className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors" />
                        <div className="absolute top-1.5 right-1.5 bg-background/90 text-primary text-[10px] font-semibold px-1.5 py-0.5 rounded shadow-sm border border-border">
                          Unlinked
                        </div>
                      </div>

                      <div className="space-y-1">
                        <h4 className="text-xs font-bold truncate text-foreground group-hover:text-primary transition-colors">
                          {folder.folderName}
                        </h4>
                        <span className="text-[11px] text-muted-foreground block truncate">
                          {count} · Click to link to AniList
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="panel p-8 text-center text-sm text-muted-foreground">
          {downloadedOnly
            ? "No downloaded titles found. Verify your library paths in Settings."
            : "Nothing here yet. Import a list or add titles from the browse tab."}
        </p>
      )}

      {/* Unlinked Folder Link / Play Dialog */}
      <UnlinkedFolderModal
        open={Boolean(selectedUnlinkedFolder)}
        onOpenChange={(open) => {
          if (!open) setSelectedUnlinkedFolder(null);
        }}
        folder={selectedUnlinkedFolder}
        mediaType={mode}
        onLinkedSuccess={() => {
          refetchScan();
        }}
        onDirectPlay={(folder) => {
          if (mode === "MANGA") {
            const manga = folder as ScannedManga;
            if (manga.chapters.length > 0 && manga.chapters[0]) {
              setDirectReadManga({
                manga,
                chapterFile: manga.chapters[0].file,
              });
            }
          } else {
            const anime = folder as ScannedAnime;
            setDirectPlayAnime(anime);
          }
        }}
      />

      {/* Direct Video Player Overlay for Unlinked Anime */}
      {directPlayAnime && directPlayAnime.seasons.length > 0 && (
        <VideoPlayer
          slug={directPlayAnime.slug}
          title={directPlayAnime.folderName}
          season={directPlayAnime.seasons[0]?.name ?? "Season 1"}
          episodeFile={directPlayAnime.seasons[0]?.episodes[0]?.file ?? ""}
          seasons={directPlayAnime.seasons}
          onEpisodeChange={(sName, epFile) => {
            // handle episode switch
          }}
          onClose={() => setDirectPlayAnime(null)}
        />
      )}

      {/* Direct Manga Reader Overlay for Unlinked Manga */}
      {directReadManga && (
        <MangaReader
          slug={directReadManga.manga.slug}
          title={directReadManga.manga.folderName}
          chapterFile={directReadManga.chapterFile}
          chapters={directReadManga.manga.chapters}
          onChapterChange={(chFile) => {
            setDirectReadManga({
              manga: directReadManga.manga,
              chapterFile: chFile,
            });
          }}
          onClose={() => setDirectReadManga(null)}
        />
      )}
    </>
  );
}
