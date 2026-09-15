import { useState, useMemo, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  Minus,
  Plus,
  Trash2,
  Play,
  BookOpen,
  FolderPlus,
  CheckCircle2,
  Film,
  Folder,
  ChevronRight,
  Edit3,
  Check,
  Star,
  Trophy,
} from "lucide-react";
import { Cover, countdown } from "@/components/AnimeCard";
import { AiPanel } from "@/components/AiPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { NoteEditor } from "@/components/NoteEditor";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { MangaReader } from "@/components/reader/MangaReader";
import { LocalMediaLinkModal } from "@/components/LocalMediaLinkModal";
import { getWatchProgress, getReadProgress } from "@/lib/media.functions";
import { getActiveMediaScan } from "@/lib/tunnel-client";
import { fetchByIds } from "@/lib/anilist";
import { useLibrary, useMediaMode, useNotes } from "@/lib/store";
import {
  MODE_COPY,
  STATUS_ORDER,
  statusLabel,
  totalUnits,
  type CustomLink,
  type LibraryEntry,
  type WatchStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  CURRENT: "#f0788a",
  PLANNING: "#94a3b8",
  COMPLETED: "#10b981",
  DROPPED: "#ef4444",
  PAUSED: "#e5a93b",
  REPEATING: "#06b6d4",
};

export const Route = createFileRoute("/anime/$id")({
  head: () => ({
    meta: [
      { title: "Title details — Koka" },
      {
        name: "description",
        content:
          "Track progress, update scores, write notes and ask AI about this title.",
      },
      { property: "og:title", content: "Title details — Koka" },
      {
        property: "og:description",
        content:
          "Progress tracking, markdown notes and spoiler-free AI summaries per title.",
      },
    ],
  }),
  component: AnimeDetail,
});

function getBackDestination(): { label: string; to: string } {
  if (typeof window === "undefined") {
    return { label: "Back to library", to: "/library" };
  }
  try {
    const lastPath = sessionStorage.getItem("koka:last_browse_path") || "";
    const ref = document.referrer || "";

    if (lastPath.startsWith("/seasons") || ref.includes("/seasons")) {
      return { label: "Back to discover", to: "/seasons" };
    }
    if (lastPath === "/" || ref.endsWith("/")) {
      return { label: "Back to dashboard", to: "/" };
    }
    if (lastPath.startsWith("/notes") || ref.includes("/notes")) {
      return { label: "Back to notes", to: "/notes" };
    }
  } catch {
    /* ignore storage errors */
  }
  return { label: "Back to library", to: "/library" };
}

function AnimeDetail() {
  const { id } = Route.useParams();
  const animeId = Number(id);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { mode } = useMediaMode();
  const currentMode = mounted ? mode : "ANIME";
  const copy = MODE_COPY[currentMode];
  const { library, upsert, patch, remove } = useLibrary();
  const { notes } = useNotes();
  const note = notes.find((n) => n.animeId === animeId);
  const entry = mounted ? library.find((e) => e.media.id === animeId) : undefined;
  const [isEditing, setIsEditing] = useState(false);
  const [backNav, setBackNav] = useState({
    label: "Back to library",
    to: "/library",
  });

  useEffect(() => {
    setBackNav(getBackDestination());
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["media", currentMode, animeId],
    queryFn: async () => (await fetchByIds([animeId], currentMode))[0] ?? null,
    staleTime: 1000 * 60 * 30,
  });

  const media = data
    ? { ...(entry?.media ?? {}), ...data }
    : (entry?.media ?? null);

  const progress = entry?.progress ?? 0;
  const total = media ? totalUnits(media) : 0;

  function ensureEntry(): LibraryEntry {
    if (entry) return entry;
    const newEntry: LibraryEntry = {
      media: { ...media!, type: mode },
      status: "PLANNING",
      progress: 0,
      score: null,
      startedAt: null,
      completedAt: null,
      repeat: 0,
      isRewatching: false,
      customLinks: [],
      tags: [],
      updatedAt: Date.now(),
      addedAt: Date.now(),
    };
    upsert(newEntry);
    return newEntry;
  }

  function updateField<K extends keyof LibraryEntry>(
    key: K,
    val: LibraryEntry[K],
  ) {
    if (!media) return;
    if (!entry) {
      const fresh = ensureEntry();
      upsert({ ...fresh, [key]: val, updatedAt: Date.now() });
    } else {
      patch(media.id, { [key]: val });
    }
  }

  function setStatus(status: WatchStatus) {
    if (!media) return;
    if (entry) patch(media.id, { status });
    else
      upsert({
        media: { ...media, type: mode },
        status,
        progress: 0,
        score: null,
        startedAt: null,
        completedAt: null,
        repeat: 0,
        isRewatching: false,
        customLinks: [],
        tags: [],
        updatedAt: Date.now(),
        addedAt: Date.now(),
      });
  }

  function bump(delta: number) {
    if (!media) return;
    const next = Math.max(0, progress + delta);
    if (entry) patch(media.id, { progress: next });
    else
      upsert({
        media: { ...media, type: mode },
        status: "CURRENT",
        progress: next,
        score: null,
        startedAt: null,
        completedAt: null,
        repeat: 0,
        isRewatching: false,
        customLinks: [],
        tags: [],
        updatedAt: Date.now(),
        addedAt: Date.now(),
      });
  }

  function addLink() {
    const current = entry?.customLinks ?? [];
    const isFirst = current.length === 0;
    const next: CustomLink[] = [
      ...current,
      { label: "", url: "", isPrimary: isFirst },
    ];
    updateField("customLinks", next);
  }

  function updateLink(index: number, patchData: Partial<CustomLink>) {
    const current = [...(entry?.customLinks ?? [])];
    if (!current[index]) return;
    current[index] = { ...current[index], ...patchData };
    updateField("customLinks", current);
  }

  function togglePrimaryLink(index: number) {
    const current = [...(entry?.customLinks ?? [])];
    if (!current[index]) return;
    const targetNewPrimary = !current[index].isPrimary;
    const next = current.map((l, i) => ({
      ...l,
      isPrimary: i === index ? targetNewPrimary : false,
    }));
    updateField("customLinks", next);
  }

  function removeLink(index: number) {
    const current = [...(entry?.customLinks ?? [])];
    const wasPrimary = current[index]?.isPrimary;
    current.splice(index, 1);
    if (wasPrimary && current[0]) {
      current[0].isPrimary = true;
    }
    updateField("customLinks", current);
  }

  const rawLinks = (entry?.customLinks ?? []).filter((l) => l.url.trim());
  const validLinks = [...rawLinks].sort(
    (a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0),
  );

  const { data: scanState, refetch: refetchScan } = useQuery({
    queryKey: ["localMediaScan"],
    queryFn: () => getActiveMediaScan(),
    staleTime: 1000 * 30,
  });

  const [activeVideo, setActiveVideo] = useState<{
    season: string;
    file: string;
    initialPosition: number;
  } | null>(null);

  const [activeChapter, setActiveChapter] = useState<{
    file: string;
    initialPage: number;
  } | null>(null);

  const [linkModalOpen, setLinkModalOpen] = useState(false);

  // Find matching local item
  const localAnime = useMemo(() => {
    if (!scanState?.anime || mode !== "ANIME" || !media) return null;
    return (
      scanState.anime.find((a) => a.mediaId === media.id) ||
      scanState.anime.find(
        (a) =>
          a.slug ===
          media.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
      ) ||
      null
    );
  }, [scanState?.anime, media, mode]);

  const localManga = useMemo(() => {
    if (!scanState?.manga || mode !== "MANGA" || !media) return null;
    return (
      scanState.manga.find((m) => m.mediaId === media.id) ||
      scanState.manga.find(
        (m) =>
          m.slug ===
          media.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
      ) ||
      null
    );
  }, [scanState?.manga, media, mode]);

  const { data: serverWatchRecords, refetch: refetchWatch } = useQuery({
    queryKey: ["watchProgress", localAnime?.slug],
    queryFn: () =>
      localAnime ? getWatchProgress({ data: { slug: localAnime.slug } }) : [],
    enabled: !!localAnime,
  });

  const { data: serverReadRecords, refetch: refetchRead } = useQuery({
    queryKey: ["readProgress", localManga?.slug],
    queryFn: () =>
      localManga ? getReadProgress({ data: { slug: localManga.slug } }) : [],
    enabled: !!localManga,
  });

  // Merge server records with instant local storage records
  const watchRecords = useMemo(() => {
    if (!localAnime) return [];
    const list = [...(serverWatchRecords ?? [])];
    if (typeof window !== "undefined") {
      try {
        const rawLatest = localStorage.getItem(
          `koka:watch:latest:${localAnime.slug}`,
        );
        if (rawLatest) {
          const parsed = JSON.parse(rawLatest);
          const existingIdx = list.findIndex(
            (w) =>
              w.season === parsed.season &&
              w.episodeFile === parsed.episodeFile,
          );
          if (existingIdx !== -1) {
            list[existingIdx] = parsed;
          } else {
            list.unshift(parsed);
          }
        }
      } catch {
        /* ignore */
      }
    }
    return list;
  }, [serverWatchRecords, localAnime]);

  const readRecords = useMemo(() => {
    if (!localManga) return [];
    const list = [...(serverReadRecords ?? [])];
    if (typeof window !== "undefined") {
      try {
        const rawLatest = localStorage.getItem(
          `koka:read:latest:${localManga.slug}`,
        );
        if (rawLatest) {
          const parsed = JSON.parse(rawLatest);
          const existingIdx = list.findIndex(
            (r) => r.chapterFile === parsed.chapterFile,
          );
          if (existingIdx !== -1) {
            list[existingIdx] = parsed;
          } else {
            list.unshift(parsed);
          }
        }
      } catch {
        /* ignore */
      }
    }
    return list;
  }, [serverReadRecords, localManga]);

  const totalStatusAmount = (media?.statusDistribution || []).reduce(
    (sum, item) => sum + (item.amount || 0),
    0,
  );

  if (!mounted || !media) {
    return (
      <p className="panel p-8 text-center text-sm text-muted-foreground">
        {isLoading || !mounted ? "Loading title…" : `Couldn't find that ${copy.noun}.`}
      </p>
    );
  }

  return (
    <div className="animate-in duration-150 fade-in-0">
      <Link
        to={backNav.to}
        onClick={(e) => {
          if (typeof window !== "undefined" && window.history.length > 1) {
            e.preventDefault();
            window.history.back();
          }
        }}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {backNav.label}
      </Link>

      <div className="panel relative overflow-hidden">
        {/* Banner with top-right Edit button */}
        <div className="relative h-32 w-full bg-surface-2 md:h-44">
          {media.banner ? (
            <img
              src={media.banner}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-r from-surface to-surface-2" />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-black/40" />

          {/* Top-right Edit/Done toggle button */}
          <div className="absolute right-3 top-3 z-10">
            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur-md transition-all duration-150 active:scale-95 ${
                isEditing
                  ? "border border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border/80 bg-surface/90 text-foreground hover:bg-surface"
              }`}
            >
              {isEditing ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>Done</span>
                </>
              ) : (
                <>
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-5 p-5 sm:flex-row">
          <Cover media={media} className="h-44 w-32 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-semibold md:text-2xl">
              {media.title}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[
                media.titleNative,
                media.format,
                media.seasonYear ? `${media.season} ${media.seasonYear}` : null,
                total ? `${total} ${copy.unit}` : null,
                media.volumes ? `${media.volumes} volumes` : null,
                media.studios?.[0],
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {media.genres?.slice(0, 6).map((g) => (
                <span
                  key={g}
                  className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {g}
                </span>
              ))}
            </div>

            {media.nextEpisode ? (
              <p className="mt-3 text-xs text-primary font-medium">
                Episode {media.nextEpisode.episode} in{" "}
                {countdown(media.nextEpisode.airingAt)}
              </p>
            ) : null}

            {/* PREVIEW MODE vs EDIT MODE */}
            {!isEditing ? (
              /* PREVIEW / READ-ONLY MODE */
              <div className="mt-4 space-y-3.5">
                {/* Status & Progress Bar Row */}
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                      entry?.status === "CURRENT" &&
                        "bg-primary/15 text-primary border border-primary/30",
                      entry?.status === "COMPLETED" &&
                        "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30",
                      entry?.status === "PLANNING" &&
                        "bg-amber-500/15 text-amber-500 border border-amber-500/30",
                      entry?.status === "DROPPED" &&
                        "bg-rose-500/15 text-rose-500 border border-rose-500/30",
                      entry?.status === "PAUSED" &&
                        "bg-muted text-muted-foreground border border-border",
                      entry?.status === "REPEATING" &&
                        "bg-indigo-500/15 text-indigo-500 border border-indigo-500/30",
                      !entry &&
                        "bg-secondary text-muted-foreground border border-border",
                    )}
                  >
                    {entry ? statusLabel(entry.status, mode) : "Not in library"}
                  </span>

                  {/* Inline Progress Controller */}
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 active:scale-95"
                      onClick={() => bump(-1)}
                      aria-label="Decrease progress"
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="text-xs font-semibold tabular-nums text-foreground">
                      {progress} / {total ?? "?"} {copy.unit}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7 active:scale-95"
                      onClick={() => bump(1)}
                      aria-label="Increase progress"
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Play Buttons: shows all added custom links */}
                  {validLinks.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {validLinks.map((link, idx) => {
                        const label =
                          link.label.trim() ||
                          (mode === "MANGA" ? `Read ${idx + 1}` : `Play ${idx + 1}`);
                        return (
                          <a
                            key={idx}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-all duration-150 hover:bg-surface-2 active:scale-95"
                            title={`Open ${link.url}`}
                          >
                            <Play className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{label}</span>
                          </a>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Read-only Score */}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span>Score:</span>
                    <span className="font-semibold text-primary">
                      {entry?.score != null ? `${entry.score}/10` : "—"}
                    </span>
                  </div>

                  {media.siteUrl ? (
                    <a
                      href={media.siteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      AniList <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>

                {/* Read-only details list */}
                <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Public score</dt>
                    <dd className="font-medium">
                      {media.averageScore ? `${media.averageScore}%` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Started</dt>
                    <dd className="font-medium">{entry?.startedAt || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Finished</dt>
                    <dd className="font-medium">{entry?.completedAt || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {mode === "MANGA" ? "Rereads" : "Rewatches"}
                    </dt>
                    <dd className="font-medium">{entry?.repeat ?? 0}</dd>
                  </div>
                </dl>

                {/* Read-only custom tags */}
                {entry?.tags && entry.tags.length > 0 ? (
                  <div className="border-t border-border pt-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      Tags:
                    </span>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {entry.tags.map((t) => {
                        const tagLower = t.trim().toLowerCase();
                        return (
                          <Link
                            key={tagLower}
                            to="/library"
                            search={(prev: Record<string, unknown>) => ({
                              ...prev,
                              search: `#${tagLower}`,
                            })}
                            className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs text-primary transition-colors hover:bg-primary/20 active:scale-95"
                          >
                            #{tagLower}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              /* EDIT MODE */
              <div className="mt-4 space-y-4 rounded-xl border border-border/80 bg-surface/50 p-4">
                {/* Status selector */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Status
                  </label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {STATUS_ORDER.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStatus(s)}
                        className={`rounded-full border px-3 py-1 text-xs transition-all duration-200 active:scale-95 ${
                          entry?.status === s
                            ? "border-primary bg-primary font-semibold text-primary-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {statusLabel(s, mode)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Progress, Score, and Remove */}
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Progress
                    </label>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 active:scale-95"
                        onClick={() => bump(-1)}
                        aria-label="Decrease progress"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <input
                        type="number"
                        min={0}
                        max={total || 9999}
                        value={progress}
                        onChange={(e) => {
                          const val = Math.max(
                            0,
                            parseInt(e.target.value, 10) || 0,
                          );
                          updateField("progress", val);
                        }}
                        className="h-8 w-16 rounded-md border border-border bg-surface px-2 text-center text-xs font-semibold tabular-nums focus:border-primary focus:outline-none"
                      />
                      <span className="text-xs text-muted-foreground">
                        / {total ?? "?"}
                      </span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 active:scale-95"
                        onClick={() => bump(1)}
                        aria-label="Increase progress"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">
                      Score
                    </label>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        value={entry?.score ?? ""}
                        placeholder="—"
                        onChange={(e) => {
                          const v = e.target.value;
                          updateField(
                            "score",
                            v === ""
                              ? null
                              : Math.min(10, Math.max(0, parseFloat(v))),
                          );
                        }}
                        className="h-8 w-16 rounded-md border border-border bg-surface px-2 text-center text-xs font-semibold tabular-nums focus:border-primary focus:outline-none"
                      />
                      <span className="text-xs text-muted-foreground">/ 10</span>
                    </div>
                  </div>

                  {entry ? (
                    <div className="ml-auto flex items-center pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Remove "${media.title}" from library?`)) {
                            remove(media.id);
                            setIsEditing(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive active:scale-95"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove from library
                      </button>
                    </div>
                  ) : null}
                </div>

                {/* Dates and Repeat Section */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Started Date
                    </label>
                    <input
                      type="date"
                      value={entry?.startedAt ?? ""}
                      onChange={(e) =>
                        updateField("startedAt", e.target.value || null)
                      }
                      className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Completed Date
                    </label>
                    <input
                      type="date"
                      value={entry?.completedAt ?? ""}
                      onChange={(e) =>
                        updateField("completedAt", e.target.value || null)
                      }
                      className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs focus:border-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-muted-foreground">
                      {mode === "MANGA" ? "Rereads" : "Rewatches"} Count
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={entry?.repeat ?? 0}
                      onChange={(e) =>
                        updateField(
                          "repeat",
                          Math.max(0, parseInt(e.target.value, 10) || 0),
                        )
                      }
                      className="mt-1 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs tabular-nums focus:border-primary focus:outline-none"
                    />
                  </div>
                </div>

                {/* Custom Links Section */}
                <div className="border-t border-border/80 pt-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-foreground">
                        Custom Links
                      </span>
                      <p className="text-[11px] text-muted-foreground">
                        Add streaming or platform links. The starred link is used
                        for the Play button on the Home screen schedule.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addLink}
                      className="h-7 text-xs active:scale-95"
                    >
                      <Plus className="mr-1 h-3 w-3" /> Add link
                    </Button>
                  </div>

                  <div className="mt-2 space-y-2">
                    {(entry?.customLinks ?? []).length === 0 ? (
                      <p className="py-2 text-xs italic text-muted-foreground">
                        No custom links added yet. Click &quot;Add link&quot; above.
                      </p>
                    ) : (
                      (entry?.customLinks ?? []).map((link, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2"
                        >
                          <input
                            type="text"
                            value={link.label}
                            placeholder="Label (e.g. S1, Dub)"
                            onChange={(e) =>
                              updateLink(idx, { label: e.target.value })
                            }
                            className="h-7 w-28 shrink-0 rounded border border-border bg-background px-2 text-xs focus:border-primary focus:outline-none"
                          />
                          <input
                            type="url"
                            value={link.url}
                            placeholder="https://..."
                            onChange={(e) =>
                              updateLink(idx, { url: e.target.value })
                            }
                            className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs focus:border-primary focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => togglePrimaryLink(idx)}
                            className={`rounded p-1.5 transition-all active:scale-95 ${
                              link.isPrimary
                                ? "bg-amber-500/20 text-amber-500"
                                : "text-muted-foreground hover:text-amber-500"
                            }`}
                            title={
                              link.isPrimary
                                ? "Primary link (starred)"
                                : "Mark as primary link"
                            }
                          >
                            <Star
                              className={`h-4 w-4 ${
                                link.isPrimary
                                  ? "fill-amber-400 text-amber-400"
                                  : ""
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeLink(idx)}
                            className="rounded p-1.5 text-muted-foreground transition-colors hover:text-destructive active:scale-95"
                            title="Remove link"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Custom Tags Section */}
                <div className="border-t border-border/80 pt-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    Custom Tags:
                  </span>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {(entry?.tags ?? []).map((t) => {
                      const tagLower = t.trim().toLowerCase();
                      return (
                        <span
                          key={tagLower}
                          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs text-primary"
                        >
                          #{tagLower}
                          <button
                            type="button"
                            onClick={() => {
                              const nextTags = (entry?.tags ?? []).filter(
                                (tag) => tag.trim().toLowerCase() !== tagLower,
                              );
                              updateField("tags", nextTags);
                            }}
                            className="ml-0.5 text-primary/70 transition-colors hover:text-destructive active:scale-95"
                            title="Remove tag"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    <TagAdder
                      allTags={Array.from(
                        new Set(
                          library
                            .flatMap((e) => e.tags ?? [])
                            .map((t) => t.trim().toLowerCase()),
                        ),
                      )}
                      onAdd={(newTag) => {
                        const clean = newTag
                          .trim()
                          .toLowerCase()
                          .replace(/^#/, "");
                        if (!clean) return;
                        const current = (entry?.tags ?? []).map((t) =>
                          t.trim().toLowerCase(),
                        );
                        if (!current.includes(clean)) {
                          updateField("tags", [...current, clean]);
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Done Button */}
                <div className="pt-2">
                  <Button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="h-8 w-full text-xs font-semibold active:scale-95"
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Done Editing
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Synopsis Section (Placed at top before local media / AI) */}
      {media.description ? (
        <section className="panel mt-6 p-5">
          <h2 className="font-display text-sm font-semibold">Synopsis</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
            {media.description}
          </p>
        </section>
      ) : null}

      {/* Local Media Playback & Reading Section */}
      <section className="panel mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            {mode === "MANGA" ? (
              <BookOpen className="h-5 w-5 text-primary" />
            ) : (
              <Film className="h-5 w-5 text-primary" />
            )}
            <div>
              <h2 className="font-display text-sm font-semibold">
                {mode === "MANGA"
                  ? "Local Manga Chapters"
                  : "Local Anime Episodes"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {localAnime
                  ? `Detected ${localAnime.episodeCount} episode${localAnime.episodeCount === 1 ? "" : "s"} on disk`
                  : localManga
                    ? `Detected ${localManga.chapterCount} chapter${localManga.chapterCount === 1 ? "" : "s"} on disk`
                    : "No local files linked yet"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLinkModalOpen(true)}
              className="h-8 text-xs gap-1.5 active:scale-95"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {localAnime || localManga
                ? "Change Linked Folder"
                : "Link Local Folder"}
            </Button>
          </div>
        </div>

        {/* Anime Local Episodes */}
        {mode === "ANIME" && localAnime && (
          <div className="mt-4 space-y-5">
            {/* Quick Resume Card */}
            {(() => {
              const latestWatch = watchRecords?.[0];
              let nextSeason = localAnime.seasons[0]?.name ?? "Season 1";
              let nextFile = localAnime.seasons[0]?.episodes[0]?.file ?? "";
              let nextLabel =
                localAnime.seasons[0]?.episodes[0]?.label ?? "Episode 1";
              let nextPos = 0;

              if (latestWatch) {
                nextSeason = latestWatch.season;
                nextFile = latestWatch.episodeFile;
                nextPos = latestWatch.completed
                  ? 0
                  : latestWatch.positionSeconds;
                const foundEp = localAnime.seasons
                  .find((s) => s.name === latestWatch.season)
                  ?.episodes.find((e) => e.file === latestWatch.episodeFile);
                if (foundEp) nextLabel = foundEp.label;
              }

              if (!nextFile) return null;

              return (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-primary/10 border border-primary/20">
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-semibold text-primary uppercase tracking-wider block">
                      {latestWatch && !latestWatch.completed
                        ? "Resume Watching"
                        : "Play Next"}
                    </span>
                    <h3 className="font-display font-semibold text-sm whitespace-normal break-words leading-relaxed text-foreground mt-0.5">
                      {nextSeason} &bull; {nextLabel}
                    </h3>
                  </div>

                  <Button
                    onClick={() =>
                      setActiveVideo({
                        season: nextSeason,
                        file: nextFile,
                        initialPosition: nextPos,
                      })
                    }
                    className="gap-2 shrink-0 h-9 active:scale-95"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {latestWatch && !latestWatch.completed
                      ? "Resume"
                      : "Play Episode"}
                  </Button>
                </div>
              );
            })()}

            {/* Seasons & Episodes Grid */}
            <div className="space-y-6">
              {(localAnime.seasons ?? []).map((s) => (
                <div key={s.name} className="space-y-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                    {s.name.split("/").map((seg, idx, arr) => (
                      <span key={idx} className="flex items-center gap-1.5 text-xs font-semibold">
                        <span className={idx === arr.length - 1 ? "text-foreground" : "text-muted-foreground"}>
                          {seg}
                        </span>
                        {idx < arr.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
                      </span>
                    ))}
                    <span className="text-[11px] text-muted-foreground font-normal ml-1">
                      ({s.episodes?.length ?? 0} files)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {(s.episodes ?? []).map((ep) => {
                      const watch = watchRecords?.find(
                        (w) => w.season === s.name && w.episodeFile === ep.file,
                      );
                      const isComplete = watch?.completed;
                      const progressPct =
                        watch && watch.durationSeconds > 0
                          ? (watch.positionSeconds / watch.durationSeconds) *
                            100
                          : 0;

                      return (
                        <button
                          key={ep.file}
                          onClick={() =>
                            setActiveVideo({
                              season: s.name,
                              file: ep.file,
                              initialPosition: isComplete
                                ? 0
                                : (watch?.positionSeconds ?? 0),
                            })
                          }
                          className="group relative flex flex-col p-3 rounded-lg border border-border bg-card/60 hover:bg-accent/70 hover:border-primary/40 transition-all text-left overflow-hidden active:scale-[0.98]"
                        >
                          <div className="flex items-start justify-between w-full gap-2">
                            <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors line-clamp-2 break-words leading-snug">
                              {ep.label}
                            </span>
                            {isComplete ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                            ) : (
                              <Play className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0 transition-colors mt-0.5" />
                            )}
                          </div>

                          <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground w-full">
                            <span className="truncate flex-1 min-w-0 pr-1">{ep.file}</span>
                            {(ep.subtitles?.length ?? 0) > 0 && (
                              <span className="shrink-0 text-[9px] px-1 py-0.2 rounded bg-muted">
                                CC
                              </span>
                            )}
                          </div>

                          {progressPct > 0 && !isComplete && (
                            <div className="mt-2 w-full bg-muted/60 h-1 rounded-full overflow-hidden">
                              <div
                                className="bg-primary h-full rounded-full"
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manga Local Chapters */}
        {mode === "MANGA" && localManga && (
          <div className="mt-4 space-y-5">
            {/* Quick Resume Card */}
            {(() => {
              const latestRead = readRecords?.[0];
              let nextFile = localManga.chapters[0]?.file ?? "";
              let nextLabel = localManga.chapters[0]?.label ?? "Chapter 1";
              let nextPage = 1;

              if (latestRead) {
                nextFile = latestRead.chapterFile;
                nextPage = latestRead.completed ? 1 : latestRead.pageNumber;
                const foundCh = localManga.chapters.find(
                  (c) => c.file === latestRead.chapterFile,
                );
                if (foundCh) nextLabel = foundCh.label;
              }

              if (!nextFile) return null;

              return (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl bg-primary/10 border border-primary/20">
                  <div className="min-w-0 flex-1">
                    <span className="text-[11px] font-semibold text-primary uppercase tracking-wider block">
                      {latestRead && !latestRead.completed
                        ? "Resume Reading"
                        : "Read Next"}
                    </span>
                    <h3 className="font-display font-semibold text-sm whitespace-normal break-words leading-relaxed text-foreground mt-0.5">
                      {nextLabel}{" "}
                      {latestRead && !latestRead.completed
                        ? `(Page ${nextPage})`
                        : ""}
                    </h3>
                  </div>

                  <Button
                    onClick={() =>
                      setActiveChapter({
                        file: nextFile,
                        initialPage: nextPage,
                      })
                    }
                    className="gap-2 shrink-0 h-9 active:scale-95"
                  >
                    <BookOpen className="h-4 w-4" />
                    {latestRead && !latestRead.completed
                      ? "Resume Reading"
                      : "Read Chapter"}
                  </Button>
                </div>
              );
            })()}

            {/* Chapters Grouped by Volume/Folder */}
            {(() => {
              const groups =
                localManga.groups && localManga.groups.length > 0
                  ? localManga.groups
                  : [{ name: "Chapters", chapters: localManga.chapters }];

              return (
                <div className="space-y-6">
                  {groups.map((group) => (
                    <div key={group.name} className="space-y-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                        {group.name.split("/").map((seg, idx, arr) => (
                          <span key={idx} className="flex items-center gap-1.5 text-xs font-semibold">
                            <span className={idx === arr.length - 1 ? "text-foreground" : "text-muted-foreground"}>
                              {seg}
                            </span>
                            {idx < arr.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
                          </span>
                        ))}
                        <span className="text-[11px] text-muted-foreground font-normal ml-1">
                          ({group.chapters.length} files)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                        {group.chapters.map((ch) => {
                          const read = readRecords?.find(
                            (r) => r.chapterFile === ch.file,
                          );
                          const isComplete = read?.completed;

                          return (
                            <button
                              key={ch.file}
                              onClick={() =>
                                setActiveChapter({
                                  file: ch.file,
                                  initialPage: isComplete ? 1 : (read?.pageNumber ?? 1),
                                })
                              }
                              className="group flex flex-col p-3 rounded-lg border border-border bg-card/60 hover:bg-accent/70 hover:border-primary/40 transition-all text-left overflow-hidden active:scale-[0.98]"
                            >
                              <div className="flex items-start justify-between w-full gap-2">
                                <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors line-clamp-2 break-words leading-snug">
                                  {ch.label}
                                </span>
                                {isComplete ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                                ) : (
                                  <BookOpen className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0 transition-colors mt-0.5" />
                                )}
                              </div>

                              <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground w-full">
                                <span className="uppercase text-[9px] px-1 py-0.2 rounded bg-muted">
                                  {ch.format}
                                </span>
                                {read && (
                                  <span>
                                    {read.pageNumber}/{read.totalPages} p
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Empty State */}
        {!localAnime && !localManga && (
          <div className="mt-4 p-6 rounded-xl border border-dashed border-border text-center flex flex-col items-center justify-center gap-3">
            <p className="text-xs text-muted-foreground max-w-sm">
              No local{" "}
              {mode === "MANGA" ? "manga chapter files" : "anime video files"}{" "}
              were automatically matched for &ldquo;{media.title}&rdquo;.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLinkModalOpen(true)}
              className="text-xs gap-1.5 active:scale-95"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Link Folder on Disk
            </Button>
          </div>
        )}
      </section>

      {/* Video Player Modal Overlay */}
      {activeVideo && localAnime && (
        <VideoPlayer
          slug={localAnime.slug}
          title={media.title}
          season={activeVideo.season}
          episodeFile={activeVideo.file}
          seasons={localAnime.seasons}
          initialPosition={activeVideo.initialPosition}
          onEpisodeChange={(newSeason, newFile) =>
            setActiveVideo({
              season: newSeason,
              file: newFile,
              initialPosition: 0,
            })
          }
          onClose={() => {
            setActiveVideo(null);
            refetchWatch();
          }}
        />
      )}

      {/* Manga Reader Modal Overlay */}
      {activeChapter && localManga && (
        <MangaReader
          slug={localManga.slug}
          title={media.title}
          chapterFile={activeChapter.file}
          chapters={localManga.chapters}
          initialPage={activeChapter.initialPage}
          onChapterChange={(newFile) =>
            setActiveChapter({ file: newFile, initialPage: 1 })
          }
          onClose={() => {
            setActiveChapter(null);
            refetchRead();
          }}
        />
      )}

      {/* Folder Linker Modal */}
      {linkModalOpen && (
        <LocalMediaLinkModal
          open={linkModalOpen}
          onOpenChange={setLinkModalOpen}
          media={media}
          mediaType={mode}
          allLocalMedia={
            mode === "MANGA"
              ? (scanState?.manga ?? [])
              : (scanState?.anime ?? [])
          }
          currentLinkedSlug={
            mode === "MANGA" ? localManga?.slug : localAnime?.slug
          }
          onLinkedChange={() => {
            refetchScan();
          }}
        />
      )}

      {/* Stats Distribution & Rankings (From anistash, styled with Koka design system) */}
      {((media.statusDistribution && media.statusDistribution.length > 0) ||
        (media.rankings && media.rankings.length > 0)) && (
        <div
          className={cn(
            "mt-6 grid gap-4",
            media.statusDistribution?.length && media.rankings?.length
              ? "lg:grid-cols-2"
              : "grid-cols-1",
          )}
        >
          {/* Status Distribution */}
          {media.statusDistribution && media.statusDistribution.length > 0 ? (
            <div className="panel space-y-3 p-5">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                <div className="flex items-center gap-1.5">
                  <BarChart3 className="h-3.5 w-3.5 text-primary" />
                  <span>Status Distribution</span>
                </div>
                <span className="text-muted-foreground font-normal">
                  {totalStatusAmount.toLocaleString()} members
                </span>
              </div>

              {/* Proportional Segmented Bar */}
              {totalStatusAmount > 0 && (
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary/80">
                  {media.statusDistribution.map((item) => {
                    const pct = (item.amount / totalStatusAmount) * 100;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={item.status}
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            STATUS_COLORS[item.status] ||
                            "var(--muted-foreground)",
                        }}
                        title={`${item.status}: ${item.amount.toLocaleString()} (${pct.toFixed(1)}%)`}
                        className="transition-all hover:opacity-80"
                      />
                    );
                  })}
                </div>
              )}

              {/* Status Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-xs">
                {media.statusDistribution.map((item) => (
                  <div
                    key={item.status}
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-surface/60 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            STATUS_COLORS[item.status] ||
                            "var(--muted-foreground)",
                        }}
                      />
                      <span className="truncate text-[11px] font-medium capitalize text-muted-foreground">
                        {item.status.toLowerCase()}
                      </span>
                    </div>
                    <span className="ml-1.5 shrink-0 tabular-nums text-[11px] font-semibold text-foreground">
                      {item.amount.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Rankings & Achievements */}
          {media.rankings && media.rankings.length > 0 ? (
            <div className="panel space-y-3 p-5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Trophy className="h-3.5 w-3.5 text-amber-500" />
                <span>Rankings & Achievements</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {media.rankings.slice(0, 6).map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-surface/60 px-3 py-2 text-xs"
                  >
                    <span className="shrink-0 tabular-nums font-bold text-primary">
                      #{r.rank}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {r.context} {r.season ? `${r.season} ` : ""}
                      {r.year ? r.year : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-6">
        <ChatPanel
          animeId={media.id}
          title={`Ask about ${media.title}`}
          description="Toggle spoilers on when you want the full picture, or toggle notes to include your personal notes."
          compact
          notesContext={note?.body}
          context={`The user is asking about the ${copy.noun} "${media.title}"${
            media.seasonYear ? ` (${media.season} ${media.seasonYear})` : ""
          }. Genres: ${media.genres?.join(", ") || "unknown"}. Their progress: ${progress}/${
            total ?? "?"
          } ${copy.unit}${entry?.score ? `, their score ${entry.score}/10` : ""}.`}
          suggestions={[
            "Is it worth finishing?",
            mode === "MANGA"
              ? "How does the anime adaptation compare?"
              : "How faithful is it to the source?",
            `What should I ${copy.verb} after this?`,
          ]}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <AiPanel
          title="Where was I? (AI Story Recap)"
          description={`Spoiler-free recap strictly up to your progress (${progress}/${total ?? "?"} ${copy.unit}).`}
          label="Generate Recap"
          spoilerFree
          prompt={() =>
            `The user is currently at ${copy.noun} progress ${progress}/${total ?? "?"} ${copy.unit} for "${media.title}". Provide a concise 3-4 sentence story recap of key events that occurred up to ${copy.unit} ${progress}. CRITICAL: Do NOT spoil anything beyond ${copy.unit} ${progress}. Keep it clean and spoiler-free.`
          }
        />
        <AiPanel
          title="Spoiler-free plot summary"
          description="Premise, tone and setting only — no characters, no twists."
          label="Summarise"
          prompt={() =>
            `Write a spoiler-free markdown summary of the ${copy.noun} "${media.title}" (${media.seasonYear ?? ""}). Sections: Premise (3-4 sentences), Tone & style, Themes, Who it's for. Do not name or describe any characters. Do not reveal any plot developments beyond the opening setup.`
          }
        />
        <AiPanel
          title="Latest news"
          description="Recent announcements about this title."
          label="Fetch news"
          search
          spoilerFree={false}
          prompt={() =>
            `Search the web for news from the last 30 days about the ${copy.noun} "${media.title}". Return short markdown bullets with bold dates. If there is nothing, say so plainly.`
          }
        />
        <AiPanel
          title={mode === "MANGA" ? "Reading guide" : "Watch guide"}
          description={
            mode === "MANGA"
              ? "Reading order, arcs, volumes and where the anime catches up."
              : "Order, adaptations, filler and where the season ends."
          }
          label="Build guide"
          search
          prompt={() =>
            mode === "MANGA"
              ? `Create an accurate, spoiler-free reading guide for the manga "${media.title}" (${media.volumes ? `${media.volumes} volumes` : ""}, ${media.chapters ? `${media.chapters} chapters` : ""}, status: ${media.airingStatus ?? "unknown"}). Search and verify real-world publication history. Include recommended reading order, canon spin-offs (if any), arc/volume milestones, and where any anime adaptation begins or ends. Markdown table where helpful. Do not hallucinate non-existent sequels. No plot spoilers.`
              : `Create an accurate, spoiler-free watch guide for the anime "${media.title}" (Format: ${media.format ?? "TV"}, Episodes: ${total ?? "unknown"}, Release Year: ${media.seasonYear ?? "unknown"}, Status: ${media.airingStatus ?? "unknown"}). CRITICAL: Search and verify the exact real-world franchise history. If this title has only 1 season or is standalone, state clearly that it is a single-season / standalone release and do NOT fabricate extra seasons. If multiple seasons, movies, or OVAs officially exist, provide the chronological vs release watch order, filler episodes to skip, and source material continuation. Markdown table where helpful. No plot spoilers.`
          }
        />
        <AiPanel
          title="Similar titles"
          description={`What to ${copy.verb} if you liked this (from across all anime & web).`}
          label="Find similar"
          search
          prompt={() =>
            `Recommend 5 standout ${copy.nounPlural} from across the entire anime/manga universe and web (explore beyond any specific list — include both well-known classics and hidden gems) that share similar themes, tone, vibe, or plot premise with "${media.title}" (genres: ${media.genres?.join(", ") || "unknown"}). For each recommendation, provide the title in bold (e.g. **Title**) and a 1-2 sentence spoiler-free explanation of why fans of "${media.title}" will enjoy it.`
          }
        />
      </div>

      <div className="mt-6">
        <h2 className="mb-3 font-display text-lg font-semibold">Your notes</h2>
        <NoteEditor animeId={media.id} title={media.title} mediaType={mode} />
      </div>
    </div>
  );
}

function TagAdder({
  onAdd,
  allTags = [],
}: {
  onAdd: (tag: string) => void;
  allTags?: string[];
}) {
  const [adding, setAdding] = useState(false);
  const [tag, setTag] = useState("");

  function submit() {
    const trimmed = tag.trim().toLowerCase().replace(/^#/, "");
    if (trimmed) {
      onAdd(trimmed);
      setTag("");
    }
    setAdding(false);
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground active:scale-95"
      >
        + Add tag
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-center gap-1"
    >
      <input
        autoFocus
        list="tag-suggestions"
        value={tag}
        onChange={(e) => setTag(e.target.value.toLowerCase())}
        placeholder="e.g. ecchi, fav"
        className="h-6 w-28 rounded-full border border-border bg-surface px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
        onBlur={submit}
      />
      {allTags.length > 0 ? (
        <datalist id="tag-suggestions">
          {allTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      ) : null}
    </form>
  );
}
