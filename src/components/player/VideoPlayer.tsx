import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  RotateCcw,
  RotateCw,
  Maximize,
  Minimize,
  Subtitles,
  ListVideo,
  X,
  Settings2,
  Check,
} from "lucide-react";
import { saveWatchProgress } from "@/lib/media.functions";
import { buildStreamUrl } from "@/lib/tunnel-client";
import type { AnimeSeason, AnimeEpisode } from "@/server/scanner.server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface VideoPlayerProps {
  slug: string;
  title: string;
  season: string;
  episodeFile: string;
  seasons: AnimeSeason[];
  initialPosition?: number;
  onEpisodeChange: (season: string, episodeFile: string) => void;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const mStr = String(m).padStart(2, "0");
  const sStr = String(s).padStart(2, "0");

  if (h > 0) {
    const hStr = String(h).padStart(2, "0");
    return `${hStr}:${mStr}:${sStr}`;
  }
  return `${mStr}:${sStr}`;
}

export function VideoPlayer({
  slug,
  title,
  season,
  episodeFile,
  seasons,
  initialPosition = 0,
  onEpisodeChange,
  onClose,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Menus
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showEpisodeMenu, setShowEpisodeMenu] = useState(false);

  // Subtitles
  const [activeSubtitle, setActiveSubtitle] = useState<string | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<string[]>([]);

  // Mobile gesture indicators
  const [seekFeedback, setSeekFeedback] = useState<{
    side: "left" | "right";
    amount: number;
  } | null>(null);
  const seekFeedbackTimer = useRef<NodeJS.Timeout | null>(null);
  const lastTapRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });
  const hideControlsTimer = useRef<NodeJS.Timeout | null>(null);

  // Video stream source URL
  const videoSrc = buildStreamUrl("/api/stream/video", {
    slug,
    season,
    file: episodeFile,
  });

  // Find current episode and its subtitles
  useEffect(() => {
    const s = seasons.find((s) => s.name === season);
    const ep = s?.episodes.find((e) => e.file === episodeFile);
    if (ep?.subtitles && ep.subtitles.length > 0) {
      setSubtitleTracks(ep.subtitles);
      setActiveSubtitle(ep.subtitles[0] ?? null);
    } else {
      setSubtitleTracks([]);
      setActiveSubtitle(null);
    }
  }, [season, episodeFile, seasons]);

  // Activate subtitle track via the TextTrack API whenever activeSubtitle changes.
  // The `default` attribute alone is unreliable when the src changes dynamically.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const applyTrack = () => {
      const tracks = Array.from(video.textTracks);
      tracks.forEach((track) => {
        track.mode = "disabled";
      });
      if (activeSubtitle !== null && tracks.length > 0) {
        // Find the track whose label matches or just pick the first enabled one
        const target = tracks[0];
        if (target) target.mode = "showing";
      }
    };

    // Apply immediately and also after the track loads
    applyTrack();
    video.addEventListener("loadedmetadata", applyTrack);
    return () => {
      video.removeEventListener("loadedmetadata", applyTrack);
    };
  }, [activeSubtitle]);

  // Set initial position once metadata is loaded
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
    if (
      initialPosition > 0 &&
      initialPosition < videoRef.current.duration - 10
    ) {
      videoRef.current.currentTime = initialPosition;
      setCurrentTime(initialPosition);
    }
    videoRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  };

  // Auto-hide controls
  const pingControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);

    hideControlsTimer.current = setTimeout(() => {
      if (isPlaying) {
        setControlsVisible(false);
        setShowSpeedMenu(false);
        setShowSubMenu(false);
        setShowEpisodeMenu(false);
      }
    }, 3500);
  }, [isPlaying]);

  // Save progress periodically and on unmount
  const saveCurrentProgress = useCallback(
    (pos: number, dur: number, completed = false) => {
      if (dur > 0 && pos >= 0) {
        const isComp = completed || pos / dur > 0.9;
        try {
          const rec = {
            slug,
            season,
            episodeFile,
            positionSeconds: Math.floor(pos),
            durationSeconds: Math.floor(dur),
            completed: isComp,
            lastWatchedAt: new Date().toISOString(),
          };
          localStorage.setItem(
            `koka:watch:${slug}:${season}:${episodeFile}`,
            JSON.stringify(rec),
          );
          localStorage.setItem(
            `koka:watch:latest:${slug}`,
            JSON.stringify(rec),
          );
        } catch {
          /* ignore */
        }

        saveWatchProgress({
          data: {
            slug,
            season,
            episodeFile,
            positionSeconds: Math.floor(pos),
            durationSeconds: Math.floor(dur),
            completed: isComp,
          },
        }).catch(() => {});
      }
    },
    [slug, season, episodeFile],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current && isPlaying) {
        saveCurrentProgress(
          videoRef.current.currentTime,
          videoRef.current.duration,
        );
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      if (videoRef.current) {
        saveCurrentProgress(
          videoRef.current.currentTime,
          videoRef.current.duration,
        );
      }
    };
  }, [isPlaying, saveCurrentProgress]);

  // Play / Pause toggle
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
    pingControls();
  };

  // Seek relative
  const seekRelative = (seconds: number) => {
    if (!videoRef.current) return;
    const target = Math.max(
      0,
      Math.min(
        videoRef.current.duration,
        videoRef.current.currentTime + seconds,
      ),
    );
    videoRef.current.currentTime = target;
    setCurrentTime(target);
    pingControls();
  };

  // Seekbar click / drag
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!seekBarRef.current || !videoRef.current) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const ratio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / rect.width),
    );
    const target = ratio * duration;
    videoRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const lastMousePos = useRef<{ x: number; y: number }>({ x: -1, y: -1 });
  const singleTapTimer = useRef<NodeJS.Timeout | null>(null);

  // Toggle controls visibility helper
  const toggleControlsVisibility = useCallback(() => {
    setControlsVisible((prev) => {
      const next = !prev;
      if (next) {
        setControlsVisible(true);
        if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
        hideControlsTimer.current = setTimeout(() => {
          if (videoRef.current && !videoRef.current.paused) {
            setControlsVisible(false);
            setShowSpeedMenu(false);
            setShowSubMenu(false);
            setShowEpisodeMenu(false);
          }
        }, 3500);
      } else {
        if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
        setShowSpeedMenu(false);
        setShowSubMenu(false);
        setShowEpisodeMenu(false);
      }
      return next;
    });
  }, []);

  // Fullscreen toggle
  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      try {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        /* fullscreen denied */
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  // Mouse move handler with distance threshold to ignore jitter
  const handleMouseMove = (e: React.MouseEvent) => {
    const dx = Math.abs(e.clientX - lastMousePos.current.x);
    const dy = Math.abs(e.clientY - lastMousePos.current.y);
    if (dx > 6 || dy > 6) {
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      pingControls();
    }
  };

  // Desktop click handler (with touch suppression to avoid double toggles)
  const handleScreenClick = (e: React.MouseEvent) => {
    if (Date.now() - lastTapRef.current.time < 500) return;
    toggleControlsVisibility();
  };

  // Mobile touch gesture handler (single tap = toggle controls, double tap = seek/fullscreen)
  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const now = Date.now();
    const touch = e.changedTouches[0];
    if (!touch || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const touchX = touch.clientX - rect.left;
    const timeDelta = now - lastTapRef.current.time;
    const distDelta = Math.abs(touchX - lastTapRef.current.x);

    if (timeDelta < 300 && distDelta < 60) {
      // DOUBLE TAP
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      lastTapRef.current = { time: 0, x: 0 };

      const width = rect.width;
      if (touchX < width * 0.35) {
        seekRelative(-10);
        setSeekFeedback({ side: "left", amount: 10 });
      } else if (touchX > width * 0.65) {
        seekRelative(10);
        setSeekFeedback({ side: "right", amount: 10 });
      } else {
        toggleFullscreen();
      }

      if (seekFeedbackTimer.current) clearTimeout(seekFeedbackTimer.current);
      seekFeedbackTimer.current = setTimeout(() => setSeekFeedback(null), 800);
    } else {
      // SINGLE TAP (debounced to avoid triggering on first tap of a double tap)
      lastTapRef.current = { time: now, x: touchX };
      if (singleTapTimer.current) clearTimeout(singleTapTimer.current);
      singleTapTimer.current = setTimeout(() => {
        toggleControlsVisibility();
        singleTapTimer.current = null;
      }, 260);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        ["input", "textarea"].includes(
          (e.target as HTMLElement)?.tagName?.toLowerCase(),
        )
      )
        return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
        case "j":
          e.preventDefault();
          seekRelative(-10);
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          seekRelative(10);
          break;
        case "f":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "m":
          e.preventDefault();
          setIsMuted((m) => {
            if (videoRef.current) videoRef.current.muted = !m;
            return !m;
          });
          break;
        case "Escape":
          if (!document.fullscreenElement) {
            onClose();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, toggleFullscreen, onClose]);

  // Current Episode and Season details
  const currentSeasonObj = seasons.find((s) => s.name === season);
  // Lock body scroll while player is open
  useEffect(() => {
    document.body.classList.add("overflow-hidden");
    return () => {
      document.body.classList.remove("overflow-hidden");
    };
  }, []);

  const currentEpObj = currentSeasonObj?.episodes.find(
    (e) => e.file === episodeFile,
  );
  const epLabel = currentEpObj?.label || episodeFile;

  // Subtitle src URL (only for vtt — browsers can't render .srt/.ass natively)
  const subtitleSrcUrl =
    activeSubtitle !== null
      ? buildStreamUrl("/api/stream/subtitle", {
          slug,
          file: activeSubtitle,
        })
      : null;

  const isVttSubtitle =
    activeSubtitle !== null &&
    activeSubtitle.toLowerCase().endsWith(".vtt");

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black select-none overflow-hidden"
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        src={videoSrc}
        className="w-full h-full object-contain pointer-events-none"
        onTimeUpdate={() => {
          if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
        }}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => {
          setIsPlaying(false);
          if (videoRef.current) {
            saveCurrentProgress(
              videoRef.current.duration,
              videoRef.current.duration,
              true,
            );
          }
        }}
        playsInline
        crossOrigin="anonymous"
      >
        {/* Only render <track> for .vtt; .srt/.ass need conversion */}
        {isVttSubtitle && subtitleSrcUrl && (
          <track
            key={activeSubtitle}
            src={subtitleSrcUrl}
            kind="subtitles"
            srcLang="en"
            label="Subtitles"
            default
          />
        )}
      </video>

      {/* Full-screen Interaction Surface (handles single click/tap to toggle controls and double tap to seek) */}
      <div
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={handleScreenClick}
        onTouchEnd={handleTouchEnd}
      />

      {/* Double Tap Seek Feedback Ripple */}
      {seekFeedback && (
        <div
          className={cn(
            "absolute top-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none z-30",
            seekFeedback.side === "left"
              ? "left-12 text-left"
              : "right-12 text-right",
          )}
        >
          <div className="bg-black/75 backdrop-blur-md rounded-full px-5 py-3 text-white text-sm font-semibold flex items-center gap-2 border border-white/10 shadow-2xl animate-in zoom-in-75 duration-200">
            {seekFeedback.side === "left" ? (
              <RotateCcw className="w-5 h-5 text-primary" />
            ) : null}
            <span>{seekFeedback.side === "left" ? "-10s" : "+10s"}</span>
            {seekFeedback.side === "right" ? (
              <RotateCw className="w-5 h-5 text-primary" />
            ) : null}
          </div>
        </div>
      )}

      {/* Top Controls Overlay — frosted glass gradient */}
      <div
        className={cn(
          "absolute top-0 inset-x-0 p-4 md:p-6 flex items-center justify-between transition-opacity duration-300 z-20",
          "bg-gradient-to-b from-black/80 via-black/30 to-transparent",
          "[backdrop-filter:blur(0px)]", // top bar uses gradient only, no blur needed
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-white/60 font-semibold">
            {season} &bull; {epLabel}
          </span>
          <h2 className="text-base md:text-lg font-bold text-white tracking-tight truncate max-w-md md:max-w-xl">
            {title}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Episode Switcher Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setShowEpisodeMenu((prev) => !prev);
              setShowSpeedMenu(false);
              setShowSubMenu(false);
            }}
            className="text-white hover:bg-white/10 rounded-full h-10 w-10"
            title="Episodes"
          >
            <ListVideo className="w-5 h-5" />
          </Button>

          {/* Close Player */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-white hover:bg-white/10 rounded-full h-10 w-10"
            title="Close"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Episode Switcher Drawer — frosted glass */}
      {showEpisodeMenu && (
        <div
          className="absolute right-4 top-20 bottom-24 w-80 max-w-[calc(100vw-2rem)] rounded-2xl shadow-2xl p-4 overflow-y-auto z-30 flex flex-col gap-4 animate-in slide-in-from-right-4 duration-200"
          style={{
            background: "rgba(10,10,20,0.72)",
            backdropFilter: "blur(36px) saturate(180%)",
            WebkitBackdropFilter: "blur(36px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <h3 className="font-display font-semibold text-sm text-white">
              Select Episode
            </h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-white hover:bg-white/10"
              onClick={() => setShowEpisodeMenu(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="space-y-4">
            {seasons.map((s) => (
              <div key={s.name} className="space-y-1.5">
                <span className="text-xs font-semibold text-white/50 uppercase tracking-wider px-1">
                  {s.name}
                </span>
                <div className="grid gap-1">
                  {s.episodes.map((ep) => {
                    const isSelected =
                      s.name === season && ep.file === episodeFile;
                    return (
                      <button
                        key={ep.file}
                        onClick={() => {
                          onEpisodeChange(s.name, ep.file);
                          setShowEpisodeMenu(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground font-semibold"
                            : "hover:bg-white/10 text-white/80 hover:text-white",
                        )}
                      >
                        <span className="truncate">{ep.label}</span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 ml-2 shrink-0" />
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

      {/* Speed Menu — frosted glass */}
      {showSpeedMenu && (
        <div
          className="absolute right-16 bottom-24 rounded-2xl shadow-2xl p-2 z-30 flex flex-col gap-1 min-w-[130px] animate-in zoom-in-95 duration-150"
          style={{
            background: "rgba(10,10,20,0.72)",
            backdropFilter: "blur(36px) saturate(180%)",
            WebkitBackdropFilter: "blur(36px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <span className="text-[10px] font-semibold text-white/50 uppercase px-2 py-1">
            Playback Speed
          </span>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((spd) => (
            <button
              key={spd}
              onClick={() => {
                if (videoRef.current) videoRef.current.playbackRate = spd;
                setPlaybackSpeed(spd);
                setShowSpeedMenu(false);
              }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium text-left flex items-center justify-between transition-colors",
                playbackSpeed === spd
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "hover:bg-white/10 text-white/80 hover:text-white",
              )}
            >
              <span>{spd === 1 ? "Normal (1x)" : `${spd}x`}</span>
              {playbackSpeed === spd && <Check className="w-3 h-3 ml-2" />}
            </button>
          ))}
        </div>
      )}

      {/* Subtitles Menu — frosted glass */}
      {showSubMenu && (
        <div
          className="absolute right-28 bottom-24 rounded-2xl shadow-2xl p-2 z-30 flex flex-col gap-1 min-w-[160px] animate-in zoom-in-95 duration-150"
          style={{
            background: "rgba(10,10,20,0.72)",
            backdropFilter: "blur(36px) saturate(180%)",
            WebkitBackdropFilter: "blur(36px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <span className="text-[10px] font-semibold text-white/50 uppercase px-2 py-1">
            Subtitles
          </span>
          <button
            onClick={() => {
              setActiveSubtitle(null);
              setShowSubMenu(false);
            }}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium text-left flex items-center justify-between transition-colors",
              activeSubtitle === null
                ? "bg-primary text-primary-foreground font-semibold"
                : "hover:bg-white/10 text-white/80 hover:text-white",
            )}
          >
            <span>Off</span>
            {activeSubtitle === null && <Check className="w-3 h-3 ml-2" />}
          </button>
          {subtitleTracks.map((track) => (
            <button
              key={track}
              onClick={() => {
                setActiveSubtitle(track);
                setShowSubMenu(false);
              }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium text-left flex items-center justify-between transition-colors",
                activeSubtitle === track
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "hover:bg-white/10 text-white/80 hover:text-white",
              )}
            >
              <span className="truncate">{track}</span>
              {activeSubtitle === track && (
                <Check className="w-3 h-3 ml-2 shrink-0" />
              )}
            </button>
          ))}
          {subtitleTracks.length === 0 && (
            <p className="px-3 py-2 text-xs text-white/40">
              No subtitle tracks found.
            </p>
          )}
        </div>
      )}

      {/* Bottom Controls Overlay — frosted glass gradient */}
      <div
        className={cn(
          "absolute bottom-0 inset-x-0 p-4 md:p-6 flex flex-col gap-3 transition-opacity duration-300 z-20",
          "bg-gradient-to-t from-black/90 via-black/40 to-transparent",
          controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      >
        {/* Custom Seek Progress Bar */}
        <div
          ref={seekBarRef}
          onClick={handleSeek}
          className="relative w-full h-2 group cursor-pointer flex items-center"
        >
          <div className="w-full h-1 group-hover:h-2 bg-white/20 rounded-full overflow-hidden transition-all duration-200">
            <div
              className="h-full bg-primary rounded-full relative"
              style={{
                width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
              }}
            />
          </div>
          <div
            className="absolute h-3.5 w-3.5 bg-primary rounded-full shadow-md -translate-x-1/2 scale-0 group-hover:scale-100 transition-transform duration-150"
            style={{
              left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
            }}
          />
        </div>

        {/* Action Controls Bar */}
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-3 md:gap-4">
            {/* Play/Pause Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              className="text-white hover:bg-white/10 rounded-full h-10 w-10"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
            </Button>

            {/* Seek Back 10s */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => seekRelative(-10)}
              className="text-white hover:bg-white/10 rounded-full h-9 w-9"
              title="Seek -10s"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>

            {/* Seek Forward 10s */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => seekRelative(10)}
              className="text-white hover:bg-white/10 rounded-full h-9 w-9"
              title="Seek +10s"
            >
              <RotateCw className="w-4 h-4" />
            </Button>

            {/* Volume Control */}
            <div className="hidden sm:flex items-center gap-2 group">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setIsMuted((m) => {
                    if (videoRef.current) videoRef.current.muted = !m;
                    return !m;
                  });
                }}
                className="text-white hover:bg-white/10 rounded-full h-9 w-9"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </Button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setVolume(val);
                  setIsMuted(val === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = val;
                    videoRef.current.muted = val === 0;
                  }
                }}
                className="w-16 h-1 accent-primary cursor-pointer"
              />
            </div>

            {/* Time Stamp */}
            <div className="text-xs font-mono text-white/80">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* Subtitles Toggle — always shown so user can see if tracks exist */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setShowSubMenu((prev) => !prev);
                setShowSpeedMenu(false);
                setShowEpisodeMenu(false);
              }}
              className={cn(
                "rounded-full h-9 w-9",
                activeSubtitle
                  ? "text-primary hover:bg-primary/20"
                  : "text-white hover:bg-white/10",
              )}
              title="Subtitles"
            >
              <Subtitles className="w-4 h-4" />
            </Button>

            {/* Playback Speed Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setShowSpeedMenu((prev) => !prev);
                setShowSubMenu(false);
                setShowEpisodeMenu(false);
              }}
              className="text-white hover:bg-white/10 rounded-full h-9 w-9"
              title="Speed"
            >
              <Settings2 className="w-4 h-4" />
            </Button>

            {/* Fullscreen Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="text-white hover:bg-white/10 rounded-full h-9 w-9"
              title="Fullscreen"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
