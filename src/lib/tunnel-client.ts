/**
 * Koka Tunnel Client & Node Discovery
 * Connects Cloudflare Pages frontend to local streaming bridges (PC, Android Termux, or LAN server).
 */

export interface ConnectedNodeInfo {
  online: boolean;
  nodeName: string;
  nodeType: "desktop" | "mobile" | "server" | "unknown";
  endpoint: string;
  animeCount: number;
  mangaCount: number;
  totalStorageGb?: number;
  latencyMs: number;
  lastChecked: number;
  errorMessage?: string;
}

const DEFAULT_TUNNEL_KEY = "koka:hybrid:tunnel_url";
const DEFAULT_TUNNEL_SECRET_KEY = "koka:hybrid:tunnel_secret";

export function getStoredTunnelUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(DEFAULT_TUNNEL_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredTunnelUrl(url: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DEFAULT_TUNNEL_KEY, url.trim().replace(/\/+$/, ""));
  } catch {
    /* ignore */
  }
}

export function getStoredTunnelSecret(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(DEFAULT_TUNNEL_SECRET_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredTunnelSecret(secret: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DEFAULT_TUNNEL_SECRET_KEY, secret.trim());
  } catch {
    /* ignore */
  }
}

/**
 * Probes the target streaming tunnel URL for health and library metadata
 */
export async function probeTunnelNode(
  endpointUrl?: string,
  secretKey?: string,
): Promise<ConnectedNodeInfo> {
  const target =
    endpointUrl ||
    getStoredTunnelUrl() ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const secret =
    secretKey !== undefined ? secretKey : getStoredTunnelSecret();
  
  if (!target) {
    return {
      online: false,
      nodeName: "No Node Configured",
      nodeType: "unknown",
      endpoint: "",
      animeCount: 0,
      mangaCount: 0,
      latencyMs: 0,
      lastChecked: Date.now(),
      errorMessage: "No local tunnel URL configured in settings",
    };
  }

  const cleanUrl = target.replace(/\/+$/, "");
  const startTime = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const headers: Record<string, string> = { Accept: "application/json" };
    if (secret) {
      headers["X-Koka-Stream-Secret"] = secret;
    }

    const res = await fetch(`${cleanUrl}/api/scanner/state`, {
      method: "GET",
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);

    const latencyMs = Math.round(performance.now() - startTime);

    if (!res.ok) {
      return {
        online: false,
        nodeName: "Unreachable Node",
        nodeType: "unknown",
        endpoint: cleanUrl,
        animeCount: 0,
        mangaCount: 0,
        latencyMs,
        lastChecked: Date.now(),
        errorMessage: `Server returned HTTP ${res.status}`,
      };
    }

    const data = await res.json() as {
      anime?: unknown[];
      manga?: unknown[];
      nodeName?: string;
      nodeType?: "desktop" | "mobile" | "server";
    };

    const animeCount = Array.isArray(data?.anime) ? data.anime.length : 0;
    const mangaCount = Array.isArray(data?.manga) ? data.manga.length : 0;

    return {
      online: true,
      nodeName: data?.nodeName || (cleanUrl.includes("localhost") || cleanUrl.includes("127.0.0.1") ? "Local Device" : "Remote Tunnel Node"),
      nodeType: data?.nodeType || "desktop",
      endpoint: cleanUrl,
      animeCount,
      mangaCount,
      latencyMs,
      lastChecked: Date.now(),
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      online: false,
      nodeName: "Offline Node",
      nodeType: "unknown",
      endpoint: cleanUrl,
      animeCount: 0,
      mangaCount: 0,
      latencyMs,
      lastChecked: Date.now(),
      errorMessage:
        err instanceof Error ? err.message : "Connection timed out or refused",
    };
  }
}

export function buildStreamUrl(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const tunnel = getStoredTunnelUrl();
  const secret = getStoredTunnelSecret();
  const base = tunnel ? tunnel.replace(/\/+$/, "") : "";
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) query.set(k, String(v));
  }
  if (secret) {
    query.set("secret", secret);
  }
  const queryString = query.toString();
  return `${base}${path}${queryString ? `?${queryString}` : ""}`;
}
