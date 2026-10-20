import { accessSync, constants, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseEnv } from "node:util";
import path from "node:path";
import type { ConnectionStatus } from "./domain";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

// Next loads .env before it starts eve. Inherited empty keys can then be
// protected from eve's env watcher. Read this local studio's file at call time
// so Next and workflow workers agree after a key is added or changed.
export function runtimeEnv(name: string) {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.STUDIO_PROJECT_DIR
  ) {
    for (const file of [
      ".env.development.local",
      ".env.local",
      ".env.development",
      ".env",
    ]) {
      try {
        const values = parseEnv(
          readFileSync(path.join(process.env.STUDIO_PROJECT_DIR, file), "utf8"),
        );
        if (Object.hasOwn(values, name)) return values[name];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return process.env[name];
}
export function textKey() {
  return runtimeEnv("MINIMAX_TEXT_API_KEY") || runtimeEnv("MINIMAX_API_KEY");
}
export function videoKey() {
  return runtimeEnv("MINIMAX_VIDEO_API_KEY") || runtimeEnv("MINIMAX_API_KEY");
}
export function trendKey() {
  return runtimeEnv("TWITTERAPI_IO_API_KEY");
}
export function exaKey() {
  return runtimeEnv("EXA_API_KEY");
}
export function officialXKey() {
  return runtimeEnv("X_API_BEARER_TOKEN");
}
export function discoveryStatus() {
  const official = Boolean(officialXKey());
  const thirdParty = Boolean(trendKey());
  const preference = runtimeEnv("X_SEARCH_PROVIDER")?.trim() || "auto";
  const valid = ["auto", "official", "twitterapi-io", "none"].includes(
    preference,
  );
  const provider =
    !valid || preference === "none"
      ? null
      : preference === "auto"
        ? official
          ? "official"
          : thirdParty
            ? "twitterapi-io"
            : null
        : (preference as "official" | "twitterapi-io");
  const xConfigured =
    provider === "official"
      ? official
      : provider === "twitterapi-io"
        ? thirdParty
        : false;
  return {
    xProvider: provider,
    xConfigured,
    exaConfigured: Boolean(exaKey()),
    officialXConfigured: official,
    twitterApiIoConfigured: thirdParty,
    uploadOnly: !xConfigured && !exaKey(),
    xMaxSearchDays: provider === "official" ? 7 : 30,
    configurationError: !valid
      ? "X_SEARCH_PROVIDER must be auto, official, twitterapi-io or none."
      : provider && !xConfigured
        ? `The selected ${provider} X provider has no server credential. Upload a reference or configure that provider.`
        : undefined,
  };
}
export function modelId() {
  return process.env.MINIMAX_TEXT_MODEL || "MiniMax-M3.1-Flash-Preview";
}
export function videoModelId() {
  return runtimeEnv("MINIMAX_VIDEO_MODEL") || "MiniMax-H3";
}
export function binary(name: "ffmpeg" | "ffprobe") {
  const configured =
    process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (configured) return configured;
  for (const dir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
    try {
      accessSync(`${dir}/${name}`, constants.X_OK);
      return `${dir}/${name}`;
    } catch {
      /* Try next conventional location. */
    }
  }
  return name === "ffmpeg" ? ffmpegInstaller.path : ffprobeInstaller.path;
}
export function connectionStatus(): ConnectionStatus {
  let ffmpeg = false;
  try {
    execFileSync(/* turbopackIgnore: true */ binary("ffmpeg"), ["-version"], {
      stdio: "ignore",
      timeout: 2000,
    });
    ffmpeg = true;
  } catch {
    /* UI offers setup instructions. */
  }
  return {
    text: Boolean(textKey()),
    video: Boolean(videoKey()),
    ffmpeg,
    model: modelId(),
    storage: process.env.STUDIO_STORAGE === "cloud" ? "cloud" : "local",
    discovery: discoveryStatus(),
  };
}
