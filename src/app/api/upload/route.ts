import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { updateSettings } from "@/lib/settings";

export const runtime = "nodejs";

const keyMap: Record<string, "defaultSplashStart" | "defaultSplashEnd" | "defaultBellStart" | "defaultBellEnd"> = {
  splashStart: "defaultSplashStart",
  splashEnd: "defaultSplashEnd",
  bellStart: "defaultBellStart",
  bellEnd: "defaultBellEnd",
};

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const assetType = String(formData.get("assetType") ?? "");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const settingKey = keyMap[assetType];
  if (!settingKey) {
    return NextResponse.json({ error: "Invalid assetType" }, { status: 400 });
  }

  const blob = await put(`assets/${Date.now()}-${file.name}`, file, {
    access: "public",
  });

  await updateSettings({ [settingKey]: blob.url });

  return NextResponse.json({ url: blob.url });
}
