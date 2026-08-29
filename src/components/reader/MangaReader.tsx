import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Maximize,
  Minimize,
  X,
  Scroll,
  Columns2,
  FileText,
  ListOrdered,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Check,
  SlidersHorizontal,
  EyeOff,
  Play,
  Pause,
  Gauge,
} from "lucide-react";
import {
  saveReadProgress,
} from "@/lib/media.functions";
import { buildStreamUrl, fetchMangaChapterPages } from "@/lib/tunnel-client";
import type { MangaChapter } from "@/server/scanner.server";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export type ReaderMode = "webtoon" | "single" | "double";
export type ReadingDirection = "ltr" | "rtl";
export type ImageFitMode = "contain" | "width" | "height" | "original";
export type ColorFilterMode = "default" | "night" | "sepia" | "invert";

interface ReaderPreferences {
  mode: ReaderMode;
  direction: ReadingDirection;
  fit: ImageFitMode;
  zoom: number;
  autoScrollSeconds: number;
  brightness: number;
  contrast: number;
  filterMode: ColorFilterMode;
  grayscale: boolean;
  pageTexture: boolean;
}

const STORAGE_PREFS_KEY = "koka:manga_reader_preferences";

function loadReaderPreferences(): ReaderPreferences {
  if (typeof window === "undefined") {
    return {
      mode: "webtoon",
      direction: "rtl",
      fit: "contain",
      zoom: 100,
      autoScrollSeconds: 15,
      brightness: 100,
      contrast: 100,
      filterMode: "default",
      grayscale: false,
      pageTexture: false,
    };
  }
  try {
    const raw = localStorage.getItem(STORAGE_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReaderPreferences>;
      return {
        mode: parsed.mode ?? "webtoon",
        direction: parsed.direction ?? "rtl",
        fit: parsed.fit ?? "contain",
        zoom: parsed.zoom ?? 100,
        autoScrollSeconds: parsed.autoScrollSeconds ?? 15,
        brightness: parsed.brightness ?? 100,
        contrast: parsed.contrast ?? 100,
        filterMode: parsed.filterMode ?? "default",
        grayscale: parsed.grayscale ?? false,
        pageTexture: parsed.pageTexture ?? false,
      };
    }
  } catch {
    /* fallback */
  }
  return {
    mode: "webtoon",
    direction: "rtl",
    fit: "contain",
    zoom: 100,
    autoScrollSeconds: 15,
    brightness: 100,
    contrast: 100,
    filterMode: "default",
    grayscale: false,
    pageTexture: false,
  };
}

function saveReaderPreferences(prefs: ReaderPreferences) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

interface MangaReaderProps {
  slug: string;
  title: string;
  chapterFile: string;
  chapters: MangaChapter[];
  initialPage?: number;
  onChapterChange: (chapterFile: string) => void;
  onClose: () => void;
}

export function MangaReader({
  slug,
  title,
  chapterFile,
  chapters,
  initialPage = 1,
  onChapterChange,
  onClose,
}: MangaReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const initialPrefs = loadReaderPreferences();
  const [mode, setModeState] = useState<ReaderMode>(initialPrefs.mode);
  const [direction, setDirectionState] = useState<ReadingDirection>(
    initialPrefs.direction,
  );
  const [fit, setFitState] = useState<ImageFitMode>(initialPrefs.fit);
  const [zoomLevel, setZoomLevelState] = useState<number>(initialPrefs.zoom);
  const [autoScrollSeconds, setAutoScrollSecondsState] = useState<number>(
    initialPrefs.autoScrollSeconds,
  );

  // Drag & Pan state for Zoomed Pages
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const isDraggingRef = useRef<boolean>(false);
  const wasDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Visual Effects & Lighting
  const [brightness, setBrightnessState] = useState<number>(
    initialPrefs.brightness,
  );
  const [contrast, setContrastState] = useState<number>(initialPrefs.contrast);
  const [filterMode, setFilterModeState] = useState<ColorFilterMode>(
    initialPrefs.filterMode,
  );
  const [grayscale, setGrayscaleState] = useState<boolean>(
    initialPrefs.grayscale,
  );
  const [pageTexture, setPageTextureState] = useState<boolean>(
    initialPrefs.pageTexture,
  );

  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [pagesList, setPagesList] = useState<{ index: number; name: string }[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Reset pan offset when zoom returns to 100% or mode/page changes
  useEffect(() => {
    if (zoomLevel <= 100) {
      setPanOffset({ x: 0, y: 0 });
    }
  }, [zoomLevel, currentPage, mode]);

  // Distraction-free reading by default
  const [controlsVisible, setControlsVisible] = useState<boolean>(false);
  const [isTopBarCollapsed, setIsTopBarCollapsed] = useState<boolean>(false);
  const [isAutoScrolling, setIsAutoScrolling] = useState<boolean>(false);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showChapterMenu, setShowChapterMenu] = useState<boolean>(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [showMoreMenu, setShowMoreMenu] = useState<boolean>(false);
  const [showMobileModeMenu, setShowMobileModeMenu] = useState<boolean>(false);

  const touchDistanceRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef<number>(0);
  const autoScrollAnimRef = useRef<number | null>(null);
  const scrollAccumulatorRef = useRef<number>(0);
  const isAutoScrollingRef = useRef<boolean>(false);

  useEffect(() => {
    isAutoScrollingRef.current = isAutoScrolling;
  }, [isAutoScrolling]);

  // Lock body scroll while reader is open
  useEffect(() => {
    document.body.classList.add("overflow-hidden");
    return () => {
      document.body.classList.remove("overflow-hidden");
    };
  }, []);

  // Prevent full browser viewport scaling during mobile pinch gestures
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
      }
    };

    container.addEventListener("touchmove", handleNativeTouchMove, {
      passive: false,
    });
    return () => {
      container.removeEventListener("touchmove", handleNativeTouchMove);
    };
  }, []);

  // Sync and persist reader preferences
  const updatePreference = useCallback(
    (updates: Partial<ReaderPreferences>) => {
      const current: ReaderPreferences = {
        mode,
        direction,
        fit,
        zoom: zoomLevel,
        autoScrollSeconds,
        brightness,
        contrast,
        filterMode,
        grayscale,
        pageTexture,
        ...updates,
      };
      if (updates.mode !== undefined) setModeState(updates.mode);
      if (updates.direction !== undefined) setDirectionState(updates.direction);
      if (updates.fit !== undefined) setFitState(updates.fit);
      if (updates.zoom !== undefined) setZoomLevelState(updates.zoom);
      if (updates.autoScrollSeconds !== undefined)
        setAutoScrollSecondsState(updates.autoScrollSeconds);
      if (updates.brightness !== undefined)
        setBrightnessState(updates.brightness);
      if (updates.contrast !== undefined) setContrastState(updates.contrast);
      if (updates.filterMode !== undefined)
        setFilterModeState(updates.filterMode);
      if (updates.grayscale !== undefined) setGrayscaleState(updates.grayscale);
      if (updates.pageTexture !== undefined)
        setPageTextureState(updates.pageTexture);

      saveReaderPreferences(current);
    },
    [
      mode,
      direction,
      fit,
      zoomLevel,
      autoScrollSeconds,
      brightness,
      contrast,
      filterMode,
      grayscale,
      pageTexture,
    ],
  );

  // Switch reader mode and preserve the current page position across modes
  const handleModeSwitch = (newMode: ReaderMode) => {
    if (newMode === mode) return;
    setIsAutoScrolling(false);
    updatePreference({ mode: newMode });

    if (newMode === "webtoon") {
      setTimeout(() => {
        const pageEl = document.getElementById(
          `manga-page-${Math.max(0, currentPage - 1)}`,
        );
        if (pageEl && scrollContainerRef.current) {
          pageEl.scrollIntoView({ behavior: "instant" });
        }
      }, 50);
    }
  };

  // Sync scroll accumulator and save webtoon reading position
  const handleScroll = () => {
    if (scrollContainerRef.current) {
      scrollAccumulatorRef.current = scrollContainerRef.current.scrollTop;
      if (
        mode === "webtoon" &&
        slug &&
        chapterFile &&
        scrollContainerRef.current.scrollHeight > 0
      ) {
        const pct =
          scrollContainerRef.current.scrollTop /
          scrollContainerRef.current.scrollHeight;
        try {
          localStorage.setItem(
            `koka:manga:scroll:${slug}:${chapterFile}`,
            pct.toString(),
          );
        } catch {
          /* ignore */
        }
      }
    }
  };

  // Restore Webtoon reading progress on load
  useEffect(() => {
    if (
      mode === "webtoon" &&
      !isLoading &&
      pagesList.length > 0 &&
      slug &&
      chapterFile
    ) {
      try {
        const saved = localStorage.getItem(
          `koka:manga:scroll:${slug}:${chapterFile}`,
        );
        if (saved && scrollContainerRef.current) {
          const pct = parseFloat(saved);
          if (!isNaN(pct) && pct > 0 && pct < 0.99) {
            setTimeout(() => {
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop =
                  pct * scrollContainerRef.current.scrollHeight;
              }
            }, 80);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }, [slug, chapterFile, isLoading, pagesList, mode]);

  // Reliable continuous auto-scroll loop for Webtoon mode
  useEffect(() => {
    if (!isAutoScrolling || mode !== "webtoon") {
      if (autoScrollAnimRef.current) {
        cancelAnimationFrame(autoScrollAnimRef.current);
        autoScrollAnimRef.current = null;
      }
      return;
    }

    const el = scrollContainerRef.current;
    if (!el) return;

    scrollAccumulatorRef.current = el.scrollTop;
    let lastTimestamp = performance.now();

    const stepScroll = (timestamp: number) => {
      if (!isAutoScrollingRef.current) return;
      const deltaMs = Math.min(64, timestamp - lastTimestamp);
      lastTimestamp = timestamp;

      const container = scrollContainerRef.current;
      if (container) {
        const viewportH = container.clientHeight || window.innerHeight;
        const pxPerMs = viewportH / (Math.max(2, autoScrollSeconds) * 1000);
        scrollAccumulatorRef.current += pxPerMs * deltaMs;
        container.scrollTop = scrollAccumulatorRef.current;

        // Check if strictly at the bottom
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll > 30 && container.scrollTop >= maxScroll - 2) {
          setIsAutoScrolling(false);
          return;
        }
      }
      autoScrollAnimRef.current = requestAnimationFrame(stepScroll);
    };

    autoScrollAnimRef.current = requestAnimationFrame(stepScroll);

    return () => {
      if (autoScrollAnimRef.current) {
        cancelAnimationFrame(autoScrollAnimRef.current);
        autoScrollAnimRef.current = null;
      }
    };
  }, [isAutoScrolling, mode, autoScrollSeconds]);

  // Fetch chapter pages metadata
  useEffect(() => {
    let active = true;
    setIsLoading(true);

    fetchMangaChapterPages(slug, chapterFile)
      .then((info) => {
        if (!active) return;
        setTotalPages(info.pageCount || 1);
        setPagesList(info.pages || []);
        const validInitial = Math.min(
          Math.max(1, initialPage),
          info.pageCount || 1,
        );
        setCurrentPage(validInitial);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load chapter pages:", err);
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, chapterFile, initialPage]);

  // Save reading progress
  const saveProgress = useCallback(
    (page: number, total: number) => {
      if (total > 0 && page >= 1) {
        const isComp = page >= total;
        try {
          const rec = {
            slug,
            chapterFile,
            pageNumber: page,
            totalPages: total,
            completed: isComp,
            lastReadAt: new Date().toISOString(),
          };
          localStorage.setItem(
            `koka:read:${slug}:${chapterFile}`,
            JSON.stringify(rec),
          );
          localStorage.setItem(
            `koka:read:latest:${slug}`,
            JSON.stringify(rec),
          );
        } catch {
          /* ignore */
        }

        saveReadProgress({
          data: {
            slug,
            chapterFile,
            pageNumber: page,
            totalPages: total,
            completed: isComp,
          },
        }).catch(() => {});
      }
    },
    [slug, chapterFile],
  );

  // Update progress on page change
  useEffect(() => {
    if (!isLoading && totalPages > 0) {
      saveProgress(currentPage, totalPages);
    }
  }, [currentPage, totalPages, isLoading, saveProgress]);

  // Handle page navigation
  const goToPage = (page: number) => {
    const target = Math.max(1, Math.min(totalPages, page));
    setCurrentPage(target);

    if (mode === "webtoon" && scrollContainerRef.current) {
      const pageEl = document.getElementById(`manga-page-${target - 1}`);
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: "smooth" });
      }
    }
  };

  const nextPage = () => {
    if (currentPage < totalPages) {
      goToPage(currentPage + (mode === "double" ? 2 : 1));
    } else {
      const currIdx = chapters.findIndex((c) => c.file === chapterFile);
      if (currIdx !== -1 && currIdx < chapters.length - 1) {
        const nextCh = chapters[currIdx + 1];
        if (nextCh) onChapterChange(nextCh.file);
      }
    }
  };

  const prevPage = () => {
    if (currentPage > 1) {
      goToPage(currentPage - (mode === "double" ? 2 : 1));
    } else {
      const currIdx = chapters.findIndex((c) => c.file === chapterFile);
      if (currIdx > 0) {
        const prevCh = chapters[currIdx - 1];
        if (prevCh) onChapterChange(prevCh.file);
      }
    }
  };

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

  // Track active page in webtoon mode via IntersectionObserver
  useEffect(() => {
    if (mode !== "webtoon" || isLoading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageIndex = Number(
              entry.target.getAttribute("data-page-index"),
            );
            if (!isNaN(pageIndex)) {
              setCurrentPage(pageIndex + 1);
            }
          }
        }
      },
      { root: scrollContainerRef.current, threshold: 0.3 },
    );

    const elements = document.querySelectorAll(".webtoon-manga-page");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [mode, isLoading, pagesList]);

  // Ctrl + Wheel Zoom Handler for PC
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 10 : -10;
        setZoomLevelState((prev) => {
          const next = Math.max(50, Math.min(250, prev + delta));
          saveReaderPreferences({
            mode,
            direction,
            fit,
            zoom: next,
            autoScrollSeconds,
            brightness,
            contrast,
            filterMode,
            grayscale,
            pageTexture,
          });
          return next;
        });
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener("wheel", handleWheel, { passive: false });
    }
    return () => {
      if (container) {
        container.removeEventListener("wheel", handleWheel);
      }
    };
  }, [
    mode,
    direction,
    fit,
    autoScrollSeconds,
    brightness,
    contrast,
    filterMode,
    grayscale,
    pageTexture,
  ]);

  // Touch handlers for mobile pinch zoom, panning, & double tap
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      if (t1 && t2) {
        const dist = Math.hypot(
          t1.clientX - t2.clientX,
          t1.clientY - t2.clientY,
        );
        touchDistanceRef.current = dist;
      }
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      if (touch && zoomLevel > 100 && mode !== "webtoon") {
        isDraggingRef.current = true;
        dragStartRef.current = {
          x: touch.clientX - panOffset.x,
          y: touch.clientY - panOffset.y,
        };
      }

      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        setZoomLevelState((prev) => {
          const next = prev >= 130 ? 100 : 135;
          saveReaderPreferences({
            mode,
            direction,
            fit,
            zoom: next,
            autoScrollSeconds,
            brightness,
            contrast,
            filterMode,
            grayscale,
            pageTexture,
          });
          return next;
        });
      }
      lastTapTimeRef.current = now;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchDistanceRef.current !== null) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      if (t1 && t2) {
        const newDist = Math.hypot(
          t1.clientX - t2.clientX,
          t1.clientY - t2.clientY,
        );
        const scaleFactor = newDist / touchDistanceRef.current;
        if (scaleFactor > 1.04 || scaleFactor < 0.96) {
          setZoomLevelState((prev) => {
            const next = Math.max(
              50,
              Math.min(250, Math.round(prev * scaleFactor)),
            );
            touchDistanceRef.current = newDist;
            saveReaderPreferences({
              mode,
              direction,
              fit,
              zoom: next,
              autoScrollSeconds,
              brightness,
              contrast,
              filterMode,
              grayscale,
              pageTexture,
            });
            return next;
          });
        }
      }
    } else if (
      e.touches.length === 1 &&
      isDraggingRef.current &&
      zoomLevel > 100 &&
      mode !== "webtoon"
    ) {
      const touch = e.touches[0];
      if (touch) {
        wasDraggingRef.current = true;
        setPanOffset({
          x: touch.clientX - dragStartRef.current.x,
          y: touch.clientY - dragStartRef.current.y,
        });
      }
    }
  };

  const handleTouchEnd = () => {
    touchDistanceRef.current = null;
    if (wasDraggingRef.current) {
      setTimeout(() => {
        wasDraggingRef.current = false;
      }, 50);
    }
    isDraggingRef.current = false;
  };

  // Mouse Drag / Pan handlers for desktop when zoomed in
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel > 100 && mode !== "webtoon" && e.button === 0) {
      isDraggingRef.current = true;
      dragStartRef.current = {
        x: e.clientX - panOffset.x,
        y: e.clientY - panOffset.y,
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingRef.current && zoomLevel > 100 && mode !== "webtoon") {
      wasDraggingRef.current = true;
      setPanOffset({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    }
  };

  const handleMouseUp = () => {
    if (wasDraggingRef.current) {
      setTimeout(() => {
        wasDraggingRef.current = false;
      }, 50);
    }
    isDraggingRef.current = false;
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        ["input", "textarea"].includes(
          (e.target as HTMLElement)?.tagName?.toLowerCase(),
        )
      )
        return;

      switch (e.key) {
        case "ArrowRight":
        case "l":
          direction === "rtl" ? prevPage() : nextPage();
          break;
        case "ArrowLeft":
        case "h":
          direction === "rtl" ? nextPage() : prevPage();
          break;
        case "ArrowDown":
        case "j":
        case "PageDown":
          if (mode === "webtoon" && scrollContainerRef.current) {
            scrollContainerRef.current.scrollBy({
              top: window.innerHeight * 0.75,
              behavior: "smooth",
            });
          } else {
            nextPage();
          }
          break;
        case "ArrowUp":
        case "k":
        case "PageUp":
          if (mode === "webtoon" && scrollContainerRef.current) {
            scrollContainerRef.current.scrollBy({
              top: -window.innerHeight * 0.75,
              behavior: "smooth",
            });
          } else {
            prevPage();
          }
          break;
        case "[":
          updatePreference({
            autoScrollSeconds: Math.max(3, autoScrollSeconds - 2),
          });
          break;
        case "]":
          updatePreference({
            autoScrollSeconds: Math.min(35, autoScrollSeconds + 2),
          });
          break;
        case " ":
          if (mode === "webtoon") {
            setIsAutoScrolling((prev) => !prev);
          } else {
            nextPage();
          }
          break;
        case "+":
        case "=":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            updatePreference({ zoom: Math.min(250, zoomLevel + 15) });
          }
          break;
        case "-":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            updatePreference({ zoom: Math.max(50, zoomLevel - 15) });
          }
          break;
        case "0":
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            updatePreference({ zoom: 100 });
          }
          break;
        case "f":
        case "F":
          toggleFullscreen();
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
  }, [
    direction,
    mode,
    currentPage,
    totalPages,
    zoomLevel,
    updatePreference,
    onClose,
  ]);

  // Center click handler
  const handleCenterClick = (e: React.MouseEvent) => {
    if (isDraggingRef.current || wasDraggingRef.current) return;
    e.stopPropagation();
    if (!controlsVisible) {
      setControlsVisible(true);
    } else {
      setControlsVisible(false);
      setShowMoreMenu(false);
      setShowChapterMenu(false);
      setShowSpeedMenu(false);
      setShowMobileModeMenu(false);
    }
  };

  // Compute CSS filter style for images
  const getImageFilterStyle = (): React.CSSProperties => {
    const filters: string[] = [];
    if (brightness !== 100) filters.push(`brightness(${brightness}%)`);
    if (contrast !== 100) filters.push(`contrast(${contrast}%)`);
    if (grayscale) filters.push("grayscale(100%)");

    if (filterMode === "night") {
      filters.push("brightness(85%) contrast(105%) hue-rotate(345deg)");
    } else if (filterMode === "sepia") {
      filters.push("sepia(35%) contrast(98%) brightness(95%)");
    } else if (filterMode === "invert") {
      filters.push("invert(100%) hue-rotate(180deg)");
    }

    return filters.length > 0 ? { filter: filters.join(" ") } : {};
  };

  // Sizing styles for Single / Double mode based on fit option
  const getSingleImageClass = () => {
    switch (fit) {
      case "width":
        return "w-full max-w-[98vw] h-auto object-contain";
      case "height":
        return "h-[94vh] w-auto max-w-none object-contain";
      case "original":
        return "w-auto h-auto max-w-none max-h-none";
      case "contain":
      default:
        return "max-h-[94vh] max-w-[94vw] w-auto h-auto object-contain";
    }
  };

  const getDoubleImageClass = (isRightOrSingle = false) => {
    switch (fit) {
      case "width":
        return "w-[49vw] max-w-[49vw] h-auto object-contain";
      case "height":
        return "h-[94vh] w-auto max-w-none object-contain";
      case "original":
        return "w-auto h-auto max-w-none max-h-none";
      case "contain":
      default:
        return cn(
          "max-h-[94vh] w-auto h-auto object-contain",
          isRightOrSingle ? "max-w-[94vw] sm:max-w-[48vw]" : "max-w-[48vw]",
        );
    }
  };

  // 80% baseline scale for comfortable desktop reading with drag pan translation
  const getTransformStyle = (): React.CSSProperties => {
    const scale = (zoomLevel / 100) * 0.8;
    const isPanned =
      (panOffset.x !== 0 || panOffset.y !== 0) && zoomLevel > 100;
    return {
      transform:
        `${scale !== 1 ? `scale(${scale})` : ""} ${isPanned ? `translate(${panOffset.x / scale}px, ${panOffset.y / scale}px)` : ""}`.trim() ||
        undefined,
      transformOrigin: "center center",
      transition: isDraggingRef.current ? "none" : "transform 0.15s ease-out",
      cursor: zoomLevel > 100 ? "grab" : "default",
    };
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ touchAction: mode === "webtoon" ? "pan-y pinch-zoom" : "none" }}
      className={cn(
        "fixed inset-0 z-[100] flex flex-col select-none overflow-hidden transition-colors duration-300",
        filterMode === "night"
          ? "bg-black text-foreground"
          : "bg-background text-foreground",
      )}
    >
      {/* High-definition Tactile Paper Grain Texture Overlay via Inline SVG */}
      {pageTexture && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[105] mix-blend-overlay"
        >
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <filter id="mangaPaperGrain">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.55"
                numOctaves="5"
                stitchTiles="stitch"
              />
              <feColorMatrix
                type="matrix"
                values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0.91 0"
              />
            </filter>
            <rect
              width="100%"
              height="100%"
              filter="url(#mangaPaperGrain)"
              fill="#9e8a75"
            />
          </svg>
        </div>
      )}

      {/* Floating Top Controls Area */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] pointer-events-none flex items-center justify-center w-full max-w-[95vw]">
        {/* State A: Full Top Controls Bar */}
        {controlsVisible && !isTopBarCollapsed && (
          <div className="pointer-events-auto glass-floating border border-border/80 px-3 py-1.5 rounded-full shadow-2xl flex items-center gap-1 sm:gap-2 animate-in fade-in zoom-in-95 duration-200">
            {/* Exit Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-full h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              title="Exit Reader"
            >
              <X className="w-4 h-4" />
            </Button>

            <div className="h-4 w-px bg-border mx-0.5" />

            {/* Mobile View: Mode Dropdown Trigger with ChevronDown */}
            <div className="sm:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowMobileModeMenu((prev) => !prev);
                  setShowSpeedMenu(false);
                  setShowMoreMenu(false);
                  setShowChapterMenu(false);
                }}
                title="Select Reading Mode"
              >
                {mode === "webtoon" && <Scroll className="w-4 h-4" />}
                {mode === "single" && <FileText className="w-4 h-4" />}
                {mode === "double" && <Columns2 className="w-4 h-4" />}
              </Button>
            </div>

            {/* Desktop View: Horizontal Reader Mode Selector */}
            <div className="hidden sm:flex items-center bg-muted/60 p-0.5 rounded-full border border-border/60">
              <Button
                variant={mode === "webtoon" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 rounded-full text-[11px] font-medium"
                onClick={() => handleModeSwitch("webtoon")}
                title="Continuous Webtoon Scroll"
              >
                <Scroll className="w-3.5 h-3.5 sm:mr-1" />
                <span>Webtoon</span>
              </Button>
              <Button
                variant={mode === "single" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 rounded-full text-[11px] font-medium"
                onClick={() => handleModeSwitch("single")}
                title="Single Page Mode"
              >
                <FileText className="w-3.5 h-3.5 sm:mr-1" />
                <span>Single</span>
              </Button>
              <Button
                variant={mode === "double" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2.5 rounded-full text-[11px] font-medium"
                onClick={() => handleModeSwitch("double")}
                title="Double Page Mode"
              >
                <Columns2 className="w-3.5 h-3.5 sm:mr-1" />
                <span>Double</span>
              </Button>
            </div>

            {/* Auto Scroll Controls for Webtoon Mode */}
            {mode === "webtoon" && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 rounded-full transition-colors",
                    isAutoScrolling
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setIsAutoScrolling((prev) => !prev)}
                  title={
                    isAutoScrolling
                      ? "Pause Auto-Scroll (Space)"
                      : "Start Auto-Scroll (Space)"
                  }
                >
                  {isAutoScrolling ? (
                    <Pause className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                </Button>

                {/* Auto-scroll Speed Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setShowSpeedMenu((prev) => !prev);
                    setShowMoreMenu(false);
                    setShowChapterMenu(false);
                    setShowMobileModeMenu(false);
                  }}
                  title="Auto-Scroll Speed (Seconds)"
                >
                  <Gauge className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Reading Direction Toggle (for paged mode) */}
            {mode !== "webtoon" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-[11px] font-semibold rounded-full text-muted-foreground hover:text-foreground"
                onClick={() =>
                  updatePreference({
                    direction: direction === "rtl" ? "ltr" : "rtl",
                  })
                }
                title={`Reading Direction: ${direction.toUpperCase()}`}
              >
                {direction.toUpperCase()}
              </Button>
            )}

            {/* Unified "More" Settings Trigger */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setShowMoreMenu((prev) => !prev);
                setShowSpeedMenu(false);
                setShowChapterMenu(false);
                setShowMobileModeMenu(false);
              }}
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              title="Display, Fit & Lighting Settings"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </Button>

            {/* Chapter Selector Drawer Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setShowChapterMenu((prev) => !prev);
                setShowSpeedMenu(false);
                setShowMoreMenu(false);
                setShowMobileModeMenu(false);
              }}
              className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Chapters List"
            >
              <ListOrdered className="w-4 h-4" />
            </Button>

            {/* Fullscreen Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </Button>

            {/* Collapse Top Bar into Show Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setIsTopBarCollapsed(true);
                setShowMoreMenu(false);
                setShowChapterMenu(false);
                setShowSpeedMenu(false);
                setShowMobileModeMenu(false);
              }}
              className="rounded-full h-8 w-8 text-muted-foreground hover:text-foreground"
              title="Collapse Controls"
            >
              <EyeOff className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Floating Top-Right "Show" Button */}
      {controlsVisible && isTopBarCollapsed && (
        <div className="fixed top-4 right-4 z-[120] pointer-events-auto flex items-center gap-1.5 glass-floating border border-border/80 px-3 py-1.5 rounded-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-xs font-semibold gap-1.5 text-foreground hover:text-primary rounded-full"
            onClick={() => setIsTopBarCollapsed(false)}
            title="Expand Full Controls"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
            <span>Show</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
            title="Exit Reader"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Top-Level Popups (Directly attached to viewport to guarantee pristine hardware-accelerated glass blur) */}

      {/* 1. Mobile Mode Menu */}
      {showMobileModeMenu && (
        <>
          <div
            className="fixed inset-0 z-[125]"
            onClick={() => setShowMobileModeMenu(false)}
          />
          <div className="fixed inset-x-6 top-16 z-[130] mx-auto w-48 border border-border/80 glass-popover rounded-2xl shadow-2xl p-2 flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-150">
            <button
              onClick={() => {
                handleModeSwitch("webtoon");
                setShowMobileModeMenu(false);
              }}
              className={cn(
                "px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors",
                mode === "webtoon"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "hover:bg-accent text-foreground",
              )}
            >
              <div className="flex items-center gap-2">
                <Scroll className="w-3.5 h-3.5" />
                <span>Webtoon</span>
              </div>
              {mode === "webtoon" && <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => {
                handleModeSwitch("single");
                setShowMobileModeMenu(false);
              }}
              className={cn(
                "px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors",
                mode === "single"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "hover:bg-accent text-foreground",
              )}
            >
              <div className="flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" />
                <span>Single Page</span>
              </div>
              {mode === "single" && <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => {
                handleModeSwitch("double");
                setShowMobileModeMenu(false);
              }}
              className={cn(
                "px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors",
                mode === "double"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "hover:bg-accent text-foreground",
              )}
            >
              <div className="flex items-center gap-2">
                <Columns2 className="w-3.5 h-3.5" />
                <span>Double Page</span>
              </div>
              {mode === "double" && <Check className="w-3.5 h-3.5" />}
            </button>
          </div>
        </>
      )}

      {/* 2. Auto-Scroll Speed Menu */}
      {showSpeedMenu && (
        <>
          <div
            className="fixed inset-0 z-[125]"
            onClick={() => setShowSpeedMenu(false)}
          />
          <div className="fixed inset-x-4 top-16 z-[130] mx-auto w-auto max-w-xs sm:left-1/2 sm:-translate-x-1/2 sm:w-56 border border-border/80 glass-popover rounded-2xl shadow-2xl p-4 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground uppercase text-[10px]">
                Scroll Speed
              </span>
              <span className="font-mono font-bold text-foreground">
                {autoScrollSeconds}s / screen
              </span>
            </div>
            <Slider
              min={3}
              max={35}
              step={1}
              value={[autoScrollSeconds]}
              onValueChange={(val) => {
                if (val[0])
                  updatePreference({ autoScrollSeconds: val[0] });
              }}
              className="flex-1"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Fast (3s)</span>
              <span>Slow (35s)</span>
            </div>
          </div>
        </>
      )}

      {/* 3. Display, Fit & Lighting Settings Menu */}
      {showMoreMenu && (
        <>
          <div
            className="fixed inset-0 z-[125]"
            onClick={() => setShowMoreMenu(false)}
          />
          <div className="fixed inset-x-4 top-16 z-[130] mx-auto w-auto max-w-sm max-h-[80vh] overflow-y-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-80 border border-border/80 glass-popover rounded-2xl shadow-2xl p-4 flex flex-col gap-3.5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-border/80 pb-2">
              <span className="text-xs font-bold text-foreground">
                Reading & Display Settings
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() =>
                  updatePreference({
                    fit: "contain",
                    zoom: 100,
                    brightness: 100,
                    contrast: 100,
                    filterMode: "default",
                    grayscale: false,
                    pageTexture: false,
                  })
                }
              >
                Reset All
              </Button>
            </div>

            {/* Section 1: Image Sizing / Fit Mode */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Image Fit
              </span>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {(
                  [
                    ["contain", "Fit Screen"],
                    ["width", "Fit Width"],
                    ["height", "Fit Height"],
                    ["original", "1:1 Original"],
                  ] as const
                ).map(([fKey, fLabel]) => (
                  <button
                    key={fKey}
                    onClick={() => updatePreference({ fit: fKey })}
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-left font-medium transition-colors text-xs flex items-center justify-between",
                      fit === fKey
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "hover:bg-accent text-foreground",
                    )}
                  >
                    <span>{fLabel}</span>
                    {fit === fKey && <Check className="w-3 h-3 ml-1" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Section 2: Zoom Slider */}
            <div className="space-y-1.5 border-t border-border/80 pt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Zoom
                </span>
                <span className="font-mono font-medium">
                  {zoomLevel}%
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  onClick={() =>
                    updatePreference({
                      zoom: Math.max(50, zoomLevel - 15),
                    })
                  }
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </Button>
                <Slider
                  min={50}
                  max={250}
                  step={5}
                  value={[zoomLevel]}
                  onValueChange={(val) => {
                    if (val[0]) updatePreference({ zoom: val[0] });
                  }}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  onClick={() =>
                    updatePreference({
                      zoom: Math.min(250, zoomLevel + 15),
                    })
                  }
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-lg"
                  onClick={() => updatePreference({ zoom: 100 })}
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Section 3: Brightness & Contrast */}
            <div className="space-y-2 border-t border-border/80 pt-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground font-medium">
                    Brightness
                  </span>
                  <span className="font-mono text-foreground font-semibold">
                    {brightness}%
                  </span>
                </div>
                <Slider
                  min={50}
                  max={150}
                  step={5}
                  value={[brightness]}
                  onValueChange={(val) => {
                    if (val[0])
                      updatePreference({ brightness: val[0] });
                  }}
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground font-medium">
                    Contrast
                  </span>
                  <span className="font-mono text-foreground font-semibold">
                    {contrast}%
                  </span>
                </div>
                <Slider
                  min={50}
                  max={150}
                  step={5}
                  value={[contrast]}
                  onValueChange={(val) => {
                    if (val[0]) updatePreference({ contrast: val[0] });
                  }}
                />
              </div>
            </div>

            {/* Section 4: Color Modes Grid */}
            <div className="space-y-1.5 pt-2 border-t border-border/80">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Color Tone
              </span>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {(
                  [
                    ["default", "Normal"],
                    ["night", "Night Mode"],
                    ["sepia", "Vintage Sepia"],
                    ["invert", "Invert Dark"],
                  ] as const
                ).map(([cKey, cLabel]) => (
                  <button
                    key={cKey}
                    onClick={() =>
                      updatePreference({ filterMode: cKey })
                    }
                    className={cn(
                      "px-2.5 py-1.5 rounded-lg text-left font-medium transition-colors text-xs flex items-center justify-between",
                      filterMode === cKey
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "hover:bg-accent text-foreground",
                    )}
                  >
                    <span>{cLabel}</span>
                    {filterMode === cKey && (
                      <Check className="w-3 h-3 ml-1" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Section 5: Toggles */}
            <div className="grid grid-cols-2 gap-1 pt-2 border-t border-border/80">
              <button
                onClick={() =>
                  updatePreference({ grayscale: !grayscale })
                }
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-left font-medium transition-colors text-xs flex items-center justify-between",
                  grayscale
                    ? "bg-secondary font-semibold text-foreground border border-border"
                    : "hover:bg-accent text-muted-foreground",
                )}
              >
                <span>Grayscale</span>
                {grayscale && (
                  <Check className="w-3 h-3 text-primary" />
                )}
              </button>

              <button
                onClick={() =>
                  updatePreference({ pageTexture: !pageTexture })
                }
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-left font-medium transition-colors text-xs flex items-center justify-between",
                  pageTexture
                    ? "bg-secondary font-semibold text-foreground border border-border"
                    : "hover:bg-accent text-muted-foreground",
                )}
              >
                <span>Paper Grain</span>
                {pageTexture && (
                  <Check className="w-3 h-3 text-primary" />
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* 4. Chapter Drawer with Multiline Word Wrapping */}
      {showChapterMenu && (
        <>
          <div
            className="fixed inset-0 z-[125]"
            onClick={() => setShowChapterMenu(false)}
          />
          <div className="fixed right-4 top-16 bottom-20 w-80 max-w-[calc(100vw-2rem)] border border-border/80 glass-popover rounded-2xl shadow-2xl p-4 overflow-y-auto z-[130] flex flex-col gap-3 animate-in slide-in-from-right-4 duration-200">
            <div className="flex items-center justify-between border-b border-border/80 pb-2">
              <h3 className="font-display font-semibold text-sm whitespace-normal break-words leading-snug flex-1 pr-2">
                {title || "Chapters"}
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full shrink-0"
                onClick={() => setShowChapterMenu(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid gap-1 overflow-y-auto">
              {chapters.map((ch) => {
                const isSelected = ch.file === chapterFile;
                return (
                  <button
                    key={ch.file}
                    onClick={() => {
                      onChapterChange(ch.file);
                      setShowChapterMenu(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors min-w-0 gap-2",
                      isSelected
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "hover:bg-accent text-foreground",
                    )}
                  >
                    <span className="whitespace-normal break-words leading-relaxed flex-1 text-left">
                      {ch.label}
                    </span>
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Reader Content Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={cn(
          "flex-1 w-full h-full overflow-y-auto flex justify-center items-start relative bg-muted/5",
          zoomLevel > 100 ? "overflow-x-auto" : "overflow-x-hidden",
        )}
      >
        {isLoading ? (
          <div className="flex items-center justify-center w-full h-full min-h-screen text-muted-foreground text-sm font-medium">
            Loading chapter pages...
          </div>
        ) : mode === "webtoon" ? (
          // Continuous Webtoon Scroll with Zoom scaling on desktop and mobile
          <div
            onClick={handleCenterClick}
            className="flex flex-col items-center gap-0 min-h-screen py-0 sm:py-0 cursor-pointer transition-all duration-150 ease-out mx-auto"
            style={
              fit === "height" || fit === "original"
                ? {
                    width: "100%",
                    maxWidth: fit === "original" ? "100vw" : "none",
                  }
                : {
                    width:
                      fit === "width"
                        ? `${zoomLevel}%`
                        : `${Math.round((700 * zoomLevel) / 100)}px`,
                    maxWidth:
                      zoomLevel > 100
                        ? "none"
                        : fit === "width"
                          ? "100%"
                          : `${zoomLevel}vw`,
                  }
            }
          >
            {pagesList.map((p) => (
              <div
                key={p.index}
                id={`manga-page-${p.index}`}
                data-page-index={p.index}
                className="webtoon-manga-page relative w-full flex justify-center min-h-[250px]"
              >
                <img
                  src={buildStreamUrl("/api/stream/manga-page", {
                    slug,
                    chapter: chapterFile,
                    page: p.index,
                  })}
                  alt={`Page ${p.index + 1}`}
                  loading="lazy"
                  style={getImageFilterStyle()}
                  className={cn(
                    "object-contain transition-all duration-200",
                    fit === "height"
                      ? "h-[92vh] w-auto max-w-[98vw]"
                      : fit === "original"
                        ? "w-auto h-auto max-w-[100vw] sm:max-w-none max-h-none"
                        : "w-full h-auto",
                  )}
                />
              </div>
            ))}
          </div>
        ) : (
          // Single / Double Paged View
          <div className="w-full h-full min-h-full flex items-center justify-center relative select-none">
            {/* Left Zone (30%): Page Turn */}
            <div
              className="absolute left-0 inset-y-0 w-[30%] cursor-pointer z-10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                direction === "rtl" ? nextPage() : prevPage();
              }}
              title={direction === "rtl" ? "Next Page" : "Previous Page"}
            />

            {/* Middle Zone (40%): Toggle Controls */}
            <div
              className="absolute left-[30%] inset-y-0 w-[40%] cursor-pointer z-10"
              onClick={handleCenterClick}
              title="Toggle Controls"
            />

            {/* Right Zone (30%): Page Turn */}
            <div
              className="absolute right-0 inset-y-0 w-[30%] cursor-pointer z-10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                direction === "rtl" ? prevPage() : nextPage();
              }}
              title={direction === "rtl" ? "Previous Page" : "Next Page"}
            />

            {/* Page Display with 80% baseline comfort scaling, pan/drag offset, and custom filters */}
            <div
              className="flex items-center justify-center w-full h-full p-1 sm:p-2 pointer-events-none"
              style={getTransformStyle()}
            >
              {mode === "single" ? (
                <img
                  src={buildStreamUrl("/api/stream/manga-page", {
                    slug,
                    chapter: chapterFile,
                    page: currentPage - 1,
                  })}
                  alt={`Page ${currentPage}`}
                  style={getImageFilterStyle()}
                  className={cn(
                    getSingleImageClass(),
                    "rounded-md shadow-2xl transition-all duration-200",
                  )}
                />
              ) : (
                // Double page spread
                <div className="flex items-center justify-center gap-0 max-h-[96vh] max-w-[98vw]">
                  {direction === "rtl" ? (
                    <>
                      {currentPage < totalPages && (
                        <img
                          src={buildStreamUrl("/api/stream/manga-page", {
                            slug,
                            chapter: chapterFile,
                            page: currentPage,
                          })}
                          alt={`Page ${currentPage + 1}`}
                          style={getImageFilterStyle()}
                          className={cn(
                            getDoubleImageClass(false),
                            "rounded-l-md shadow-2xl transition-all duration-200",
                          )}
                        />
                      )}
                      <img
                        src={buildStreamUrl("/api/stream/manga-page", {
                          slug,
                          chapter: chapterFile,
                          page: currentPage - 1,
                        })}
                        alt={`Page ${currentPage}`}
                        style={getImageFilterStyle()}
                        className={cn(
                          getDoubleImageClass(currentPage >= totalPages),
                          currentPage < totalPages
                            ? "rounded-r-md"
                            : "rounded-md",
                          "shadow-2xl transition-all duration-200",
                        )}
                      />
                    </>
                  ) : (
                    <>
                      <img
                        src={buildStreamUrl("/api/stream/manga-page", {
                          slug,
                          chapter: chapterFile,
                          page: currentPage - 1,
                        })}
                        alt={`Page ${currentPage}`}
                        style={getImageFilterStyle()}
                        className={cn(
                          getDoubleImageClass(currentPage >= totalPages),
                          currentPage < totalPages
                            ? "rounded-l-md"
                            : "rounded-md",
                          "shadow-2xl transition-all duration-200",
                        )}
                      />
                      {currentPage < totalPages && (
                        <img
                          src={buildStreamUrl("/api/stream/manga-page", {
                            slug,
                            chapter: chapterFile,
                            page: currentPage,
                          })}
                          alt={`Page ${currentPage}`}
                          style={getImageFilterStyle()}
                          className={cn(
                            getDoubleImageClass(false),
                            "rounded-r-md shadow-2xl transition-all duration-200",
                          )}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Floating Rounded Bottom Control Bar with Mouse Wheel Page Scrolling */}
      <div
        onWheel={(e) => {
          e.stopPropagation();
          if (e.deltaY < 0) {
            direction === "rtl" ? prevPage() : nextPage();
          } else if (e.deltaY > 0) {
            direction === "rtl" ? nextPage() : prevPage();
          }
        }}
        className={cn(
          "fixed bottom-4 left-1/2 -translate-x-1/2 z-[120] glass-bottom-bar border border-border/80 px-4 py-2 rounded-full shadow-2xl flex items-center justify-between gap-3 max-w-lg w-[90vw] transition-all duration-300 ease-out",
          controlsVisible
            ? "translate-y-0 opacity-100 scale-100 pointer-events-auto"
            : "translate-y-8 opacity-0 scale-95 pointer-events-none",
        )}
      >
        {/* Previous Page Button */}
        <Button
          variant="outline"
          size="icon"
          className="rounded-full h-8 w-8 shrink-0 border-border"
          onClick={prevPage}
          disabled={currentPage <= 1}
          title="Previous Page (Left Arrow / Wheel Up)"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        {/* Page Slider */}
        <div className="flex-1 flex items-center gap-2.5">
          <span className="text-xs font-mono font-medium text-foreground w-8 text-right">
            {currentPage}
          </span>
          <Slider
            min={1}
            max={totalPages}
            step={1}
            value={[currentPage]}
            onValueChange={(val) => {
              if (val[0]) goToPage(val[0]);
            }}
            className="flex-1"
          />
          <span className="text-xs font-mono text-muted-foreground w-8">
            / {totalPages}
          </span>
        </div>

        {/* Next Page Button */}
        <Button
          variant="outline"
          size="icon"
          className="rounded-full h-8 w-8 shrink-0 border-border"
          onClick={nextPage}
          disabled={currentPage >= totalPages}
          title="Next Page (Right Arrow / Wheel Down)"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
