import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  findAnimeBySlug,
  findMangaBySlug,
  getMangaPageBuffer,
  getMimeType,
} from "./media.server";
import { getScanState, scanLibrary } from "./scanner.server";
import { isSafePath } from "./path-guard.server";

const ALLOWED_VIDEO_EXTS = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".avi",
  ".mov",
  ".flv",
  ".ts",
  ".m4v",
]);
const ALLOWED_SUBTITLE_EXTS = new Set([".vtt", ".srt", ".ass", ".ssa"]);

function isMaliciousPathSegment(segment: string | null): boolean {
  if (!segment) return false;
  try {
    const decoded = decodeURIComponent(segment);
    if (decoded.includes("\0")) return true;
    if (decoded.includes("..")) return true;
    if (/^[a-zA-Z]:/i.test(decoded)) return true;
    if (decoded.startsWith("/") || decoded.startsWith("\\")) return true;
    if (/^\.(env|git|ssh|config|aws|bash|npm|profile|htaccess)/i.test(decoded))
      return true;
    return false;
  } catch {
    return true;
  }
}

export async function handleMediaStreamRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 0. Health check and Scanner state endpoints for Dashboard / Probe
  if (pathname === "/api/health" || pathname === "/health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        deviceId: "pc",
        nodeName: "Koka Desktop Host",
        nodeType: "desktop",
        authenticated: true,
        timestamp: Date.now(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  if (pathname === "/api/scanner/state") {
    let state = getScanState();
    if (state.lastScannedAt === 0 && !state.isScanning) {
      state = await scanLibrary();
    }

    return new Response(
      JSON.stringify({
        online: true,
        deviceId: "pc",
        nodeName: "Koka Desktop Host",
        nodeType: "desktop",
        anime: state.anime || [],
        manga: state.manga || [],
        timestamp: state.lastScannedAt || Date.now(),
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  // 1. Video streaming endpoint
  if (pathname === "/api/stream/video") {
    const slug = url.searchParams.get("slug");
    const season = url.searchParams.get("season");
    const file = url.searchParams.get("file");

    if (
      !slug ||
      !file ||
      isMaliciousPathSegment(slug) ||
      isMaliciousPathSegment(season) ||
      isMaliciousPathSegment(file)
    ) {
      return new Response("Invalid or missing parameters", { status: 400 });
    }

    const reqExt = extname(file).toLowerCase();
    if (!ALLOWED_VIDEO_EXTS.has(reqExt)) {
      return new Response("Forbidden: Invalid video file type", { status: 403 });
    }

    const anime = findAnimeBySlug(slug);
    if (!anime) {
      return new Response("Anime not found", { status: 404 });
    }

    let targetPath = "";
    // Search in anime seasons
    for (const s of anime.seasons) {
      if (!season || s.name === season) {
        const ep = s.episodes.find(
          (e) => e.file === file || e.relativePath === file,
        );
        if (ep) {
          targetPath = join(anime.folderPath, ep.relativePath);
          if (!isSafePath(anime.folderPath, targetPath)) {
            return new Response("Forbidden path", { status: 403 });
          }
          break;
        }
      }
    }

    if (!targetPath || !existsSync(targetPath)) {
      // Fallback: direct check in folder
      const direct = join(anime.folderPath, file);
      if (!isSafePath(anime.folderPath, direct)) {
        return new Response("Forbidden path", { status: 403 });
      }
      if (existsSync(direct)) {
        targetPath = direct;
      } else {
        return new Response("Video file not found", { status: 404 });
      }
    }

    const stat = statSync(targetPath);
    const fileSize = stat.size;
    const range = request.headers.get("range");
    const mimeType = getMimeType(targetPath);

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const startStr = parts[0];
      const start = startStr ? parseInt(startStr, 10) : 0;
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      const nodeStream = createReadStream(targetPath, { start, end });
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunksize),
          "Content-Type": mimeType,
          "Cache-Control": "no-cache",
        },
      });
    }

    const nodeStream = createReadStream(targetPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    return new Response(webStream, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileSize),
        "Content-Type": mimeType,
      },
    });
  }

  // 2. Subtitle endpoint
  if (pathname === "/api/stream/subtitle") {
    const slug = url.searchParams.get("slug");
    const file = url.searchParams.get("file");

    if (!slug || !file || isMaliciousPathSegment(slug) || isMaliciousPathSegment(file)) {
      return new Response("Invalid or missing parameters", { status: 400 });
    }

    const ext = extname(file).toLowerCase();
    if (!ALLOWED_SUBTITLE_EXTS.has(ext)) {
      return new Response("Forbidden: Invalid subtitle format", { status: 403 });
    }

    const anime = findAnimeBySlug(slug);
    if (!anime) {
      return new Response("Anime not found", { status: 404 });
    }

    const subPath = join(anime.folderPath, file);
    if (!isSafePath(anime.folderPath, subPath)) {
      return new Response("Forbidden path", { status: 403 });
    }
    if (!existsSync(subPath)) {
      return new Response("Subtitle file not found", { status: 404 });
    }

    const content = readFileSync(subPath, "utf-8");
    const isVtt = ext === ".vtt";

    return new Response(content, {
      headers: {
        "Content-Type": isVtt
          ? "text/vtt; charset=utf-8"
          : "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // 3. Manga Page & Embedded Resource endpoint
  if (pathname === "/api/stream/manga-page" || pathname === "/api/stream/manga-resource") {
    const slug = url.searchParams.get("slug");
    const rawChapter = url.searchParams.get("chapter");
    const pageStr = url.searchParams.get("page");
    const pageIndex = pageStr ? parseInt(pageStr, 10) : 0;
    const epubResource = url.searchParams.get("epubResource") || url.searchParams.get("resource");

    if (
      !slug ||
      !rawChapter ||
      isMaliciousPathSegment(slug) ||
      (isNaN(pageIndex) && !epubResource)
    ) {
      return new Response("Invalid or missing parameters", { status: 400 });
    }

    // Decode the chapter param — filenames can contain brackets, spaces, etc.
    let chapter = rawChapter;
    try { chapter = decodeURIComponent(rawChapter.replace(/\+/g, " ")); } catch { /* keep raw */ }

    if (isMaliciousPathSegment(chapter)) {
      return new Response("Invalid or missing parameters", { status: 400 });
    }

    try {
      // Trigger a scan if library hasn't been loaded yet
      let state = getScanState();
      if (state.lastScannedAt === 0 && !state.isScanning) {
        state = await scanLibrary();
      }

      const result = await getMangaPageBuffer(slug, chapter, pageIndex, epubResource);
      if (!result) {
        // Log what we have to diagnose mismatches
        const allSlugs = getScanState().manga.map((m) => `${m.slug} (${m.folderName})`).join(", ");
        console.warn(`[manga-page] 404 slug=${slug} chapter=${chapter} page=${pageIndex}. Known manga: ${allSlugs}`);
        return new Response("Page not found", { status: 404 });
      }

      return new Response(new Uint8Array(result.buffer), {
        headers: {
          "Content-Type": result.mimeType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (err) {
      console.error("Manga page error:", err);
      return new Response("Error extracting page", { status: 500 });
    }
  }

  // 4. Local Poster / Banner endpoint
  if (pathname === "/api/media/poster" || pathname === "/api/media/banner") {
    const type = url.searchParams.get("type"); // anime | manga
    const slug = url.searchParams.get("slug");
    const isBanner = pathname.includes("banner");

    if (!slug) return new Response("Missing slug", { status: 400 });

    const media =
      type === "manga" ? findMangaBySlug(slug) : findAnimeBySlug(slug);
    if (!media) return new Response("Not found", { status: 404 });

    const baseNames = isBanner
      ? ["banner.jpg", "banner.png", "banner.webp", "banner.jpeg"]
      : ["poster.jpg", "poster.png", "poster.webp", "cover.jpg", "cover.png"];

    for (const name of baseNames) {
      const imagePath = join(media.folderPath, name);
      if (existsSync(imagePath)) {
        const buffer = readFileSync(imagePath);
        return new Response(new Uint8Array(buffer), {
          headers: {
            "Content-Type": getMimeType(imagePath),
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    }

    return new Response("No local image", { status: 404 });
  }

  return null;
}
