import { useState, useMemo } from "react";
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
  Layers,
} from "lucide-react";
import { Cover, countdown } from "@/components/AnimeCard";
import { AiPanel } from "@/components/AiPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { NoteEditor } from "@/components/NoteEditor";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { MangaReader } from "@/components/reader/MangaReader";
import { LocalMediaLinkModal } from "@/components/LocalMediaLinkModal";
import {
  getLibraryScanStatus,
  getWatchProgress,
  getReadProgress,
} from "@/lib/media.functions";
import type { ScannedAnime, ScannedManga } from "@/server/scanner.server";
import { fetchByIds } from "@/lib/anilist";
import { useLibrary, useMediaMode, useNotes } from "@/lib/store";
import {
  MODE_COPY,
  STATUS_ORDER,
  statusLabel,
  totalUnits,
  type WatchStatus,
} from "@/lib/types";
import { Button } from "@/components/ui/button";

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

function AnimeDetail() {
  const { id } = Route.useParams();
  const animeId = Number(id);
  const { mode } = useMediaMode();
  const copy = MODE_COPY[mode];
  const { library, upsert, patch, remove } = useLibrary();
  const { notes } = useNotes();
  const note = notes.find((n) => n.animeId === animeId);
  const entry = library.find((e) => e.media.id === animeId);

  const { data, isLoading } = useQuery({
    queryKey: ["media", mode, animeId],
    queryFn: async () => (await fetchByIds([animeId], mode))[0] ?? null,
    enabled: !entry,
    staleTime: 1000 * 60 * 30,
  });

  const media = entry?.media ?? data ?? null;

  if (!media) {
    return (
      <p className="panel p-8 text-center text-sm text-muted-foreground">
        {isLoading ? "Loading title…" : `Couldn't find that ${copy.noun}.`}
      </p>
    );
  }

  const progress = entry?.progress ?? 0;
  const total = totalUnits(media);

  function setStatus(status: WatchStatus) {
    if (!media) return;
    if (entry) patch(media.id, { status });
    else
      upsert({
        media: { ...media, type: mode },
        status,
        progress: 0,
        score: null,
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
        updatedAt: Date.now(),
        addedAt: Date.now(),
      });
  }

  const { data: scanState, refetch: refetchScan } = useQuery({
    queryKey: ["localMediaScan"],
    queryFn: () => getLibraryScanStatus(),
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
          a.slug === media.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
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
          m.slug === media.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      ) ||
      null
    );
  }, [scanState?.manga, media, mode]);

  const { data: watchRecords, refetch: refetchWatch } = useQuery({
    queryKey: ["watchProgress", localAnime?.slug],
    queryFn: () =>
      localAnime ? getWatchProgress({ data: { slug: localAnime.slug } }) : [],
    enabled: !!localAnime,
  });

  const { data: readRecords, refetch: refetchRead } = useQuery({
    queryKey: ["readProgress", localManga?.slug],
    queryFn: () =>
      localManga ? getReadProgress({ data: { slug: localManga.slug } }) : [],
    enabled: !!localManga,
  });

  return (
    <div className="animate-in duration-300 fade-in-0 slide-in-from-bottom-3">
      <Link
        to="/library"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to library
      </Link>

      <div className="panel overflow-hidden">
        {media.banner ? (
          <img
            src={media.banner}
            alt=""
            loading="lazy"
            className="h-32 w-full object-cover md:h-44"
          />
        ) : null}
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
                  className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {g}
                </span>
              ))}
            </div>

            {media.nextEpisode ? (
              <p className="mt-3 text-xs text-primary">
                Episode {media.nextEpisode.episode} in{" "}
                {countdown(media.nextEpisode.airingAt)}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-1.5">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-full border px-3 py-1 text-xs transition-all duration-200 active:scale-95 ${
                    entry?.status === s
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {statusLabel(s, mode)}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => bump(-1)}
                  aria-label="Decrease progress"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="text-sm tabular-nums">
                  {progress}/{total ?? "?"}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => bump(1)}
                  aria-label="Increase progress"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Score
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={entry?.score ?? ""}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value;
                    patch(media.id, {
                      score:
                        v === "" ? null : Math.min(10, Math.max(0, Number(v))),
                    });
                  }}
                  disabled={!entry}
                  className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-xs"
                />
                <span>/10</span>
              </label>

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

              {entry ? (
                <button
                  onClick={() => remove(media.id)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              ) : null}
            </div>

            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <div>
                <dt className="text-muted-foreground">Your score</dt>
                <dd className="font-medium text-primary">
                  {entry?.score ? `${entry.score}/10` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Public score</dt>
                <dd className="font-medium">
                  {media.averageScore ? `${media.averageScore}%` : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Started</dt>
                <dd className="font-medium">{entry?.startedAt ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Finished</dt>
                <dd className="font-medium">{entry?.completedAt ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {mode === "MANGA" ? "Rereads" : "Rewatches"}
                </dt>
                <dd className="font-medium">{entry?.repeat ?? 0}</dd>
              </div>
            </dl>

            {/* Custom User Tags */}
            <div className="mt-4 border-t border-border pt-3">
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
                      <Link
                        to="/library"
                        search={(prev: Record<string, unknown>) => ({
                          ...prev,
                          search: `#${tagLower}`,
                        })}
                        className="hover:underline"
                      >
                        #{tagLower}
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          const nextTags = (entry?.tags ?? []).filter(
                            (tag) => tag.trim().toLowerCase() !== tagLower,
                          );
                          patch(media.id, { tags: nextTags });
                        }}
                        className="ml-0.5 text-primary/70 hover:text-destructive"
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
                    const clean = newTag.trim().toLowerCase().replace(/^#/, "");
                    if (!clean) return;
                    if (!entry) {
                      upsert({
                        media: { ...media, type: mode },
                        status: "PLANNING",
                        progress: 0,
                        tags: [clean],
                        updatedAt: Date.now(),
                        addedAt: Date.now(),
                      });
                    } else {
                      const current = (entry.tags ?? []).map((t) =>
                        t.trim().toLowerCase(),
                      );
                      if (!current.includes(clean)) {
                        patch(media.id, { tags: [...current, clean] });
                      }
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Local Media Playback & Reading Section */}
      <section className="panel mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            {mode === "MANGA" ? (
              <BookOpen className="h-5 w-5 text-primary" />
            ) : (
              <Film className="h-5 w-5 text-primary" />
            )}
            <div>
              <h2 className="font-display text-sm font-semibold">
                {mode === "MANGA" ? "Local Manga Chapters" : "Local Anime Episodes"}
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
              className="h-8 text-xs gap-1.5"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              {localAnime || localManga ? "Change Linked Folder" : "Link Local Folder"}
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
              let nextLabel = localAnime.seasons[0]?.episodes[0]?.label ?? "Episode 1";
              let nextPos = 0;

              if (latestWatch) {
                nextSeason = latestWatch.season;
                nextFile = latestWatch.episodeFile;
                nextPos = latestWatch.completed ? 0 : latestWatch.positionSeconds;
                const foundEp = localAnime.seasons
                  .find((s) => s.name === latestWatch.season)
                  ?.episodes.find((e) => e.file === latestWatch.episodeFile);
                if (foundEp) nextLabel = foundEp.label;
              }

              if (!nextFile) return null;

              return (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-primary/10 border border-primary/20">
                  <div className="min-w-0">
                    <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
                      {latestWatch && !latestWatch.completed ? "Resume Watching" : "Play Next"}
                    </span>
                    <h3 className="font-display font-semibold text-sm truncate text-foreground">
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
                    className="gap-2 shrink-0 h-9"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {latestWatch && !latestWatch.completed ? "Resume" : "Play Episode"}
                  </Button>
                </div>
              );
            })()}

            {/* Seasons & Episodes Grid */}
            <div className="space-y-4">
              {localAnime.seasons.map((s) => (
                <div key={s.name} className="space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {s.name} ({s.episodes.length} files)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {s.episodes.map((ep) => {
                      const watch = watchRecords?.find(
                        (w) => w.season === s.name && w.episodeFile === ep.file,
                      );
                      const isComplete = watch?.completed;
                      const progressPct =
                        watch && watch.durationSeconds > 0
                          ? (watch.positionSeconds / watch.durationSeconds) * 100
                          : 0;

                      return (
                        <button
                          key={ep.file}
                          onClick={() =>
                            setActiveVideo({
                              season: s.name,
                              file: ep.file,
                              initialPosition: isComplete ? 0 : (watch?.positionSeconds ?? 0),
                            })
                          }
                          className="group relative flex flex-col p-3 rounded-lg border border-border bg-card/60 hover:bg-accent/70 hover:border-primary/40 transition-all text-left overflow-hidden"
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate pr-2">
                              {ep.label}
                            </span>
                            {isComplete ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                            ) : (
                              <Play className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                            )}
                          </div>

                          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="truncate">{ep.file}</span>
                            {ep.subtitles.length > 0 && (
                              <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-muted">
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
                      {latestRead && !latestRead.completed ? "Resume Reading" : "Read Next"}
                    </span>
                    <h3 className="font-display font-semibold text-sm whitespace-normal break-words leading-relaxed text-foreground mt-0.5">
                      {nextLabel} {latestRead && !latestRead.completed ? `(Page ${nextPage})` : ""}
                    </h3>
                  </div>

                  <Button
                    onClick={() =>
                      setActiveChapter({
                        file: nextFile,
                        initialPage: nextPage,
                      })
                    }
                    className="gap-2 shrink-0 h-9"
                  >
                    <BookOpen className="h-4 w-4" />
                    {latestRead && !latestRead.completed ? "Resume Reading" : "Read Chapter"}
                  </Button>
                </div>
              );
            })()}

            {/* Chapters Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {localManga.chapters.map((ch) => {
                const read = readRecords?.find((r) => r.chapterFile === ch.file);
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
                    className="group flex flex-col p-3 rounded-lg border border-border bg-card/60 hover:bg-accent/70 hover:border-primary/40 transition-all text-left overflow-hidden"
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate pr-2">
                        {ch.label}
                      </span>
                      {isComplete ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : (
                        <BookOpen className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                      )}
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
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
        )}

        {/* Empty State */}
        {!localAnime && !localManga && (
          <div className="mt-4 p-6 rounded-xl border border-dashed border-border text-center flex flex-col items-center justify-center gap-3">
            <p className="text-xs text-muted-foreground max-w-sm">
              No local {mode === "MANGA" ? "manga chapter files" : "anime video files"} were automatically matched for &ldquo;{media.title}&rdquo;.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLinkModalOpen(true)}
              className="text-xs gap-1.5"
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
            setActiveVideo({ season: newSeason, file: newFile, initialPosition: 0 })
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
            mode === "MANGA" ? (scanState?.manga ?? []) : (scanState?.anime ?? [])
          }
          currentLinkedSlug={
            mode === "MANGA" ? localManga?.slug : localAnime?.slug
          }
          onLinkedChange={() => {
            refetchScan();
          }}
        />
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

      {media.description ? (
        <section className="panel mt-4 p-5">
          <h2 className="font-display text-sm font-semibold">Synopsis</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {media.description}
          </p>
        </section>
      ) : null}

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
        className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
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
