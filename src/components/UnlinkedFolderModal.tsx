import React, { useState } from "react";
import {
  Check,
  FolderSync,
  HardDrive,
  Link as LinkIcon,
  Play,
  BookOpen,
  Search,
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
import type { ScannedAnime, ScannedManga } from "@/server/scanner.server";
import type { AnimeMedia, MediaType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface UnlinkedFolderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: ScannedAnime | ScannedManga | null;
  mediaType: MediaType;
  onLinkedSuccess: () => void;
  onDirectPlay?: (folder: ScannedAnime | ScannedManga) => void;
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
  const [query, setQuery] = useState(folder ? folder.folderName : "");
  const [results, setResults] = useState<AnimeMedia[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLinking, setIsLinking] = useState(false);

  React.useEffect(() => {
    if (folder) {
      setQuery(folder.folderName);
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

  const countLabel =
    mediaType === "MANGA"
      ? `${(folder as ScannedManga).chapterCount} chapters`
      : `${(folder as ScannedAnime).episodeCount} episodes`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col p-6 gap-4">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Unlinked Local Media: {folder.folderName}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Found on disk ({countLabel}). Link it to an AniList title to
                track progress, score, and notes.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Action button: Direct play / read */}
        {onDirectPlay && (
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary/30">
            <div className="text-xs">
              <span className="font-semibold block text-foreground">
                Quick Launch
              </span>
              <span className="text-muted-foreground">
                Open player/reader directly without linking
              </span>
            </div>
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs font-semibold"
              onClick={() => {
                onOpenChange(false);
                onDirectPlay(folder);
              }}
            >
              {mediaType === "MANGA" ? (
                <>
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>Read Chapter 1</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  <span>Play Episode 1</span>
                </>
              )}
            </Button>
          </div>
        )}

        {/* Search AniList to Link */}
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

        {/* Search Results List */}
        <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[300px] space-y-2 pr-1">
          {results.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
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
      </DialogContent>
    </Dialog>
  );
}
