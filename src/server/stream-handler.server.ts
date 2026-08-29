import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  findAnimeBySlug,
  findMangaBySlug,
  getMangaPageBuffer,
  getMimeType,
} from "./media.server";

function isSafePath(base: string, target: string): boolean {
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  return (
    resolvedTarget === resolvedBase ||
    resolvedTarget.startsWith(resolvedBase + sep)
  );
}

export async function handleMediaStreamRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Video streaming endpoint
  if (pathname === "/api/stream/video") {
    const slug = url.searchParams.get("slug");
    const season = url.searchParams.get("season");
    const file = url.searchParams.get("file");

    if (!slug || !file) {
      return new Response("Missing slug or file parameter", { status: 400 });
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

    if (!slug || !file) {
      return new Response("Missing parameters", { status: 400 });
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
    const ext = extname(subPath).toLowerCase();
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

  // 3. Manga Page endpoint
  if (pathname === "/api/stream/manga-page") {
    const slug = url.searchParams.get("slug");
    const chapter = url.searchParams.get("chapter");
    const pageStr = url.searchParams.get("page");
    const pageIndex = pageStr ? parseInt(pageStr, 10) : 0;

    if (!slug || !chapter || isNaN(pageIndex)) {
      return new Response("Missing parameters", { status: 400 });
    }

    try {
      const result = await getMangaPageBuffer(slug, chapter, pageIndex);
      if (!result) {
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
