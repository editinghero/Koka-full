import React, { useMemo, useState } from "react";
import {
  FolderCheck,
  FolderPlus,
  Link as LinkIcon,
  Search,
  Unlink,
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
import { Button } from "@/components/ui/button";
import { linkLocalFolder, unlinkLocalFolder } from "@/lib/media.functions";
import type { ScannedAnime, ScannedManga } from "@/server/scanner.server";
import type { AnimeMedia, MediaType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface LocalMediaLinkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  media: AnimeMedia;
  mediaType: MediaType;
  allLocalMedia: (ScannedAnime | ScannedManga)[];
  currentLinkedSlug?: string | undefined;
  onLinkedChange: () => void;
}

export function LocalMediaLinkModal({
  open,
  onOpenChange,
  media,
  mediaType,
  allLocalMedia,
  currentLinkedSlug,
  onLinkedChange,
}: LocalMediaLinkModalProps) {
  const [search, setSearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredFolders = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return allLocalMedia;
    return allLocalMedia.filter(
      (m) =>
        m.folderName.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q),
    );
  }, [allLocalMedia, search]);

  const handleLink = async (folder: ScannedAnime | ScannedManga) => {
    setIsSubmitting(true);
    try {
      await linkLocalFolder({
        data: {
          deviceId: (folder as { deviceId?: string }).deviceId || "pc",
          mediaType,
          mediaId: media.id,
          folderSlug: folder.slug,
          folderName: folder.folderName,
          folderPath: folder.folderPath,
          customTitle: media.title,
          metaJson: media,
        },
      });
      toast.success(
        `Linked "${media.title}" to local folder "${folder.folderName}"`,
      );
      onLinkedChange();
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to link folder");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnlink = async () => {
    setIsSubmitting(true);
    try {
      await unlinkLocalFolder({
        data: {
          mediaType,
          mediaId: media.id,
        },
      });
      toast.success("Unlinked local folder");
      onLinkedChange();
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to unlink folder");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-6 gap-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5 text-primary" />
            <span>Link Local Folder</span>
          </DialogTitle>
          <DialogDescription>
            Associate &ldquo;{media.title}&rdquo; with a folder detected on your
            hard drive.
          </DialogDescription>
        </DialogHeader>

        {currentLinkedSlug && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20 text-xs">
            <div className="flex items-center gap-2">
              <FolderCheck className="w-4 h-4 text-primary shrink-0" />
              <span className="font-medium text-foreground">
                Currently linked:{" "}
                <strong className="font-semibold">{currentLinkedSlug}</strong>
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnlink}
              disabled={isSubmitting}
              className="h-7 px-2 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Unlink className="w-3.5 h-3.5 mr-1" />
              Unlink
            </Button>
          </div>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search detected folders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto max-h-64 space-y-1.5 pr-1">
          {filteredFolders.length === 0 ? (
            <p className="text-center py-6 text-xs text-muted-foreground">
              No matching local folders found. Check your library paths in
              Settings.
            </p>
          ) : (
            filteredFolders.map((folder) => {
              const isLinked = folder.slug === currentLinkedSlug;
              const count =
                "episodeCount" in folder
                  ? `${folder.episodeCount} eps`
                  : `${(folder as ScannedManga).chapterCount} chs`;

              return (
                <div
                  key={folder.slug}
                  className={cn(
                    "flex items-center justify-between p-2.5 rounded-lg border transition-colors text-xs",
                    isLinked
                      ? "bg-accent border-primary/40 font-semibold"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-medium truncate text-foreground">
                      {folder.folderName}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate">
                      {folder.folderPath} &bull; {count}
                    </span>
                  </div>

                  <Button
                    size="sm"
                    variant={isLinked ? "secondary" : "default"}
                    onClick={() => handleLink(folder)}
                    disabled={isSubmitting || isLinked}
                    className="h-7 text-xs shrink-0"
                  >
                    <FolderPlus className="w-3.5 h-3.5 mr-1" />
                    {isLinked ? "Linked" : "Link"}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
