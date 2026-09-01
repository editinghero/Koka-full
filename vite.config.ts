import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3399,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    {
      name: "koka-media-stream-dev-middleware",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (
            req.url &&
            (req.url.startsWith("/api/stream/") ||
              req.url.startsWith("/api/scanner/") ||
              req.url.startsWith("/api/health") ||
              req.url.startsWith("/api/media/"))
          ) {
            try {
              const { handleMediaStreamRequest } = await import(
                "./src/server/stream-handler.server"
              );
              const fullUrl = `http://${req.headers.host || "localhost:3399"}${req.url}`;
              const headers = new Headers();
              for (const [k, v] of Object.entries(req.headers)) {
                if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
              }
              const webReq = new Request(fullUrl, {
                method: req.method || "GET",
                headers,
              });
              const webRes = await handleMediaStreamRequest(webReq);
              if (webRes) {
                res.statusCode = webRes.status;
                webRes.headers.forEach((val, key) => {
                  res.setHeader(key, val);
                });
                if (webRes.body) {
                  const reader = webRes.body.getReader();
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                  }
                }
                res.end();
                return;
              }
            } catch (err) {
              console.error("Dev middleware media error:", err);
            }
          }
          next();
        });
      },
    },
    react(),
    tailwindcss(),
  ],
});
