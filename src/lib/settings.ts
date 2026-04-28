import { kv } from "@vercel/kv";
import type { AppSettings } from "@/types";

export const defaultSettings: AppSettings = {
  defaultSplashStart: null,
  defaultSplashEnd: null,
  defaultBellStart: null,
  defaultBellEnd: null,
  defaultDescription: "",
  youtubeTokens: null,
};

export async function getSettings(): Promise<AppSettings> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return defaultSettings;
  }
  const settings = await kv.get<AppSettings>("app:settings");
  return settings ?? defaultSettings;
}

export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...partial };
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return next;
  }
  await kv.set("app:settings", next);
  return next;
}
