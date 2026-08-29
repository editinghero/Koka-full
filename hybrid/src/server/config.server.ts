import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AppConfig {
  animePath: string;
  mangaPath: string;
  anilistUsername: string;
}

const CONFIG_PATH = join(process.cwd(), "config.json");

function getDefaultPaths(): { animePath: string; mangaPath: string } {
  return {
    animePath: existsSync(join(process.cwd(), "anime")) ? "./anime" : "./",
    mangaPath: existsSync(join(process.cwd(), "manga")) ? "./manga" : "./",
  };
}

export function loadAppConfig(): AppConfig {
  const defaults = getDefaultPaths();

  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {
        animePath: parsed.animePath ?? defaults.animePath,
        mangaPath: parsed.mangaPath ?? defaults.mangaPath,
        anilistUsername: parsed.anilistUsername ?? "",
      };
    }
  } catch (err) {
    console.error("Failed to read config.json:", err);
  }

  const initial: AppConfig = {
    animePath: defaults.animePath,
    mangaPath: defaults.mangaPath,
    anilistUsername: "",
  };

  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2), "utf-8");
  } catch (e) {
    /* ignore */
  }

  return initial;
}

export function saveAppConfig(config: Partial<AppConfig>): AppConfig {
  const defaults = getDefaultPaths();
  let current: AppConfig = {
    animePath: defaults.animePath,
    mangaPath: defaults.mangaPath,
    anilistUsername: "",
  };

  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      current = { ...current, ...(JSON.parse(raw) as Partial<AppConfig>) };
    }
  } catch {
    /* ignore */
  }

  const updated: AppConfig = {
    animePath: config.animePath ?? current.animePath,
    mangaPath: config.mangaPath ?? current.mangaPath,
    anilistUsername: config.anilistUsername ?? current.anilistUsername,
  };

  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write config.json:", err);
  }

  return updated;
}
