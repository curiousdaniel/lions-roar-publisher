"use client";

import { useMemo, useState } from "react";
import { YouTubeConnectButton } from "@/components/YouTubeConnectButton";
import type { AppSettings } from "@/types";

type AssetType = "splashStart" | "splashEnd" | "bellStart" | "bellEnd";

async function uploadAsset(file: File, assetType: AssetType): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("assetType", assetType);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  const data = (await response.json()) as { url: string };
  return data.url;
}

export function SettingsForm({ initialSettings }: { initialSettings: AppSettings }) {
  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<AssetType | null>(null);
  const [status, setStatus] = useState<string>("");

  const descriptionCount = useMemo(() => settings.defaultDescription.length, [settings.defaultDescription]);

  async function saveSettings(next: Partial<AppSettings>) {
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });

      if (!response.ok) throw new Error("Failed to save settings");

      const saved = (await response.json()) as AppSettings;
      setSettings(saved);
      setStatus("Settings saved.");
    } catch {
      setStatus("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>, assetType: AssetType) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(assetType);
    setStatus("");

    try {
      const url = await uploadAsset(file, assetType);
      const keyMap = {
        splashStart: "defaultSplashStart",
        splashEnd: "defaultSplashEnd",
        bellStart: "defaultBellStart",
        bellEnd: "defaultBellEnd",
      } as const;

      const key = keyMap[assetType];
      const next = { ...settings, [key]: url };
      setSettings(next);
      setStatus("Asset uploaded.");
    } catch {
      setStatus("Asset upload failed.");
    } finally {
      setUploading(null);
      event.target.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-medium">Default Splash Screens</h2>
        <label className="block text-sm text-zinc-700">
          Default Intro Splash
          <input className="mt-2 block" type="file" accept="image/*,video/*" onChange={(event) => onFileChange(event, "splashStart")} />
          {settings.defaultSplashStart && <span className="mt-1 block text-xs text-zinc-500">{settings.defaultSplashStart}</span>}
        </label>

        <label className="block text-sm text-zinc-700">
          Default Outro Splash
          <input className="mt-2 block" type="file" accept="image/*,video/*" onChange={(event) => onFileChange(event, "splashEnd")} />
          {settings.defaultSplashEnd && <span className="mt-1 block text-xs text-zinc-500">{settings.defaultSplashEnd}</span>}
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-medium">Default Bell Sounds</h2>
        <label className="block text-sm text-zinc-700">
          Default Intro Bell
          <input className="mt-2 block" type="file" accept="audio/*" onChange={(event) => onFileChange(event, "bellStart")} />
          {settings.defaultBellStart && <span className="mt-1 block text-xs text-zinc-500">{settings.defaultBellStart}</span>}
        </label>

        <label className="block text-sm text-zinc-700">
          Default Outro Bell
          <input className="mt-2 block" type="file" accept="audio/*" onChange={(event) => onFileChange(event, "bellEnd")} />
          {settings.defaultBellEnd && <span className="mt-1 block text-xs text-zinc-500">{settings.defaultBellEnd}</span>}
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-medium">Default Video Description</h2>
        <textarea
          className="min-h-40 w-full rounded-md border border-zinc-300 p-2 text-sm"
          value={settings.defaultDescription}
          onChange={(event) => setSettings((prev) => ({ ...prev, defaultDescription: event.target.value.slice(0, 5000) }))}
        />
        <p className="text-xs text-zinc-500">{descriptionCount}/5000</p>
        <button
          type="button"
          disabled={saving}
          onClick={() => saveSettings({ defaultDescription: settings.defaultDescription })}
          className="rounded-md bg-[#C17D3C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Description"}
        </button>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        <h2 className="text-lg font-medium">YouTube Connection</h2>
        <YouTubeConnectButton connected={Boolean(settings.youtubeTokens)} />
      </section>

      {(uploading || status) && (
        <p className="text-sm text-zinc-600">
          {uploading ? `Uploading ${uploading}...` : status}
        </p>
      )}
    </div>
  );
}
