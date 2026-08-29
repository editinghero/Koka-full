import React, { useState, useMemo } from "react";
import {
  Check,
  FolderSync,
  HardDrive,
  Link as LinkIcon,
  Play,
  BookOpen,
  Search,
  Film,
  Layers,
  Folder,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLibrary } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { linkLocalFolder } from "@/lib/media.functions";
import { searchAnime } from "@/lib/anilist";
import type { ScannedAnime, ScannedManga, AnimeSeason, AnimeEpisode, MangaChapter } from "@/server/scanner.server";
import type { AnimeMedia, MediaType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface UnlinkedFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: ScannedAnime | ScannedManga | null;
  mediaType: MediaType;
  onLinkedSuccess: () => void;
  onDirectPlay?: (
    folder: ScannedAnime | ScannedManga,
    seasonName?: string,
    episodeFile?: string,
  ) => void;
}

export function UnlinkedFolderModal({
  open,
  onOpenChange,
  folder,
  mediaType,
  onLinkedSuccess,
  onDirectPlay,
}: UnlinkedFolderModalProps) {
  const { library, upsert } = useLibrary();
  const [tab, setTab] = useState<"files" | "link">("files");
  const [fileSearch, setFileSearch] = useState("");
  const [query, setQuery] = useState(folder ? folder.folderName : "");
  const [results, setResults] = useState<AnimeMedia[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  React.useEffect(() => {
    if (folder) {
      setQuery(folder.folderName);
      setFileSearch("");
      setTab("files");
      searchAnime(folder.folderName, mediaType)
        .then(setResults)
        .catch(() => setResults([]));
    }
  }, [folder, mediaType]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    try {
      const res = await searchAnime(query.trim(), mediaType);
      setResults(res);
    } catch {
      toast.error("Failed to search AniList");
    } finally {
      setIsSearching(false);
    }
  };

  const handleLinkToSeries = async (target: AnimeMedia) => {
    if (!folder) return;
    setIsLinking(true);
    try {
      await linkLocalFolder({
        data: {
          deviceId: (folder as { deviceId?: string }).deviceId || "pc",
          mediaType,
          mediaId: target.id,
          folderSlug: folder.slug,
          folderName: folder.folderName,
          folderPath: folder.folderPath,
          customTitle: target.title,
        },
      });
      const exists = library.some((e) => e.media.id === target.id);
      if (!exists) {
        upsert({
          media: target,
          status: "CURRENT",
          progress: 0,
          score: null,
          favorite: false,
          updatedAt: Date.now(),
          addedAt: Date.now(),
        });
      }
      toast.success(`Linked "${folder.folderName}" to "${target.title}"`);
      onLinkedSuccess();
      onOpenChange(false);
    } catch {
      toast.error("Failed to link folder");
    } finally {
      setIsLinking(false);
    }
  };

  if (!folder) return null;

  const isAnime = mediaType === "ANIME";
  const animeFolder = isAnime ? (folder as ScannedAnime) : null;
  const mangaFolder = !isAnime ? (folder as ScannedManga) : null;

  const countLabel = isAnime
    ? `${animeFolder?.episodeCount ?? 0} files`
    : `${mangaFolder?.chapterCount ?? 0} chapters`;

  // Filtered anime seasons/episodes based on in-modal file search
  const filteredSeasons = animeFolder?.seasons
    ?.map((s) => {
      const filteredEps = fileSearch.trim()
        ? s.episodes.filter((ep) =>
            ep.label.toLowerCase().includes(fileSearch.toLowerCase()) ||
            ep.file.toLowerCase().includes(fileSearch.toLowerCase()),
          )
        : s.episodes;
      return { ...s, episodes: filteredEps };
    })
    .filter((s) => s.episodes.length > 0) ?? [];

  // Filtered manga chapters
  const filteredChapters = mangaFolder?.chapters?.filter((ch) =>
    fileSearch.trim()
      ? ch.label.toLowerCase().includes(fileSearch.toLowerCase()) ||
        ch.file.toLowerCase().includes(fileSearch.toLowerCase())
      : true,
  ) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-6 gap-4">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <Folder className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-bold truncate text-foreground">
                  {folder.folderName}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {countLabel} &bull; Local Media
                </DialogDescription>
              </div>
            </div>

            {/* Quick Tab Switcher */}
            <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg border border-border/80 shrink-0">
              <button
                type="button"
                onClick={() => setTab("files")}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-md transition-all",
                  tab === "files"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Local Files
              </button>
              <button
                type="button"
                onClick={() => setTab("link")}
                className={cn(
                  "px-3 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5",
                  tab === "link"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LinkIcon className="h-3 w-3" />
                <span>Link to AniList</span>
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Tab 1: Local Files Browser & Direct Play */}
        {tab === "files" && (
          <div className="flex flex-col flex-1 min-h-0 space-y-3">
            {/* Quick action bar */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Filter songs or files..."
                  className="pl-8 text-xs h-9 bg-secondary/20"
                />
              </div>

              {onDirectPlay && (
                <Button
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    if (isAnime && animeFolder?.seasons?.[0]?.episodes?.[0]) {
                      onDirectPlay(
                        folder,
                        animeFolder.seasons[0].name,
                        animeFolder.seasons[0].episodes[0].file,
                      );
                    } else if (!isAnime && mangaFolder?.chapters?.[0]) {
                      onDirectPlay(folder, "", mangaFolder.chapters[0].file);
                    }
                  }}
                  className="h-9 gap-1.5 text-xs font-semibold shrink-0"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  <span>Play First</span>
                </Button>
              )}
            </div>

            {/* Files list / Subdirectories */}
            <div className="flex-1 overflow-y-auto max-h-[50vh] space-y-4 pr-1 scrollbar-thin">
              {isAnime ? (
                filteredSeasons.length === 0 ? (
                  <div className="h-36 flex items-center justify-center text-xs text-muted-foreground">
                    No matching video files found.
                  </div>
                ) : (
                  filteredSeasons.map((s) => (
                    <div key={s.name} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {s.name} ({s.episodes.length} files)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {s.episodes.map((ep) => (
                          <button
                            key={ep.file}
                            type="button"
                            onClick={() => {
                              onOpenChange(false);
                              if (onDirectPlay) {
                                onDirectPlay(folder, s.name, ep.file);
                              }
                            }}
                            className="group flex items-center justify-between p-2.5 rounded-lg border border-border bg-card/60 hover:bg-accent/70 hover:border-primary/40 transition-all text-left overflow-hidden gap-2"
                          >
                            <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                              {ep.label}
                            </span>
                            <Play className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )
              ) : filteredChapters.length === 0 ? (
                <div className="h-36 flex items-center justify-center text-xs text-muted-foreground">
                  No matching chapters found.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {filteredChapters.map((ch) => (
                    <button
                      key={ch.file}
                      type="button"
                      onClick={() => {
                        onOpenChange(false);
                        if (onDirectPlay) {
                          onDirectPlay(folder, "", ch.file);
                        }
                      }}
                      className="group flex items-center justify-between p-2.5 rounded-lg border border-border bg-card/60 hover:bg-accent/70 hover:border-primary/40 transition-all text-left overflow-hidden gap-2"
                    >
                      <span className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors truncate">
                        {ch.label}
                      </span>
                      <BookOpen className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Search AniList & Link */}
        {tab === "link" && (
          <div className="flex flex-col flex-1 min-h-0 space-y-3">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search AniList series title..."
                  className="pl-8 text-xs h-9"
                />
              </div>
              <Button
                type="submit"
                size="sm"
                disabled={isSearching}
                className="h-9 text-xs font-semibold"
              >
                {isSearching ? "Searching..." : "Search"}
              </Button>
            </form>

            <div className="flex-1 overflow-y-auto max-h-[50vh] space-y-2 pr-1 scrollbar-thin">
              {results.length === 0 ? (
                <div className="h-36 flex items-center justify-center text-xs text-muted-foreground">
                  {isSearching
                    ? "Searching AniList..."
                    : "No titles found. Try searching a different keyword."}
                </div>
              ) : (
                results.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card hover:border-primary/40 transition-colors gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {item.cover ? (
                        <img
                          src={item.cover}
                          alt={item.title}
                          className="h-12 w-9 rounded object-cover shrink-0"
                        />
                      ) : (
                        <div className="h-12 w-9 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground shrink-0">
                          IMG
                        </div>
                      )}
                      <div className="min-w-0">
                        <h4 className="text-xs font-bold truncate text-foreground">
                          {item.title}
                        </h4>
                        <span className="text-[11px] text-muted-foreground block truncate">
                          {item.format} ·{" "}
                          {item.seasonYear ?? item.season ?? "Series"} ·{" "}
                          {item.genres?.slice(0, 2).join(", ")}
                        </span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isLinking}
                      onClick={() => handleLinkToSeries(item)}
                      className="h-7 text-xs font-medium gap-1 shrink-0"
                    >
                      <LinkIcon className="h-3 w-3" />
                      <span>Link Title</span>
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
