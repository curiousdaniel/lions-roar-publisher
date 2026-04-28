"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loaded = false;

export async function loadFFmpeg(): Promise<FFmpeg> {
  if (!ffmpeg) {
    ffmpeg = new FFmpeg();
  }

  if (!loaded) {
    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
    await ffmpeg.load({
      coreURL: `${base}/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg-core.wasm`,
    });
    loaded = true;
  }

  return ffmpeg;
}

export interface ProcessVideoOptions {
  sourceVideoUrl: string;
  trimStart: number;
  trimEnd: number;
  splashStartFile: File | string | null;
  splashEndFile: File | string | null;
  bellStartFile: File | string | null;
  bellEndFile: File | string | null;
  onProgress: (progress: number) => void;
}

function inferAssetKind(asset: File | string): "image" | "video" | "audio" {
  const name = typeof asset === "string" ? asset.toLowerCase() : asset.name.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)$/i.test(name)) return "image";
  if (/\.(mp3|wav|m4a|aac|ogg)$/i.test(name)) return "audio";
  return "video";
}

function inferSplashKind(asset: File | string): "image" | "video" {
  return inferAssetKind(asset) === "image" ? "image" : "video";
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(Array.from(data));
}

async function writeAsset(instance: FFmpeg, targetName: string, asset: File | string): Promise<void> {
  await instance.writeFile(targetName, await fetchFile(asset));
}

async function createVideoSegment(
  instance: FFmpeg,
  inputName: string,
  outputName: string,
  kind: "image" | "video",
): Promise<void> {
  if (kind === "image") {
    await instance.exec([
      "-loop",
      "1",
      "-i",
      inputName,
      "-t",
      "3",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      outputName,
    ]);
    return;
  }

  await instance.exec([
    "-i",
    inputName,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outputName,
  ]);
}

async function overlayBellIfNeeded(
  instance: FFmpeg,
  videoInput: string,
  bellAsset: File | string | null,
  bellInputName: string,
  outputName: string,
): Promise<string> {
  if (!bellAsset) return videoInput;

  await writeAsset(instance, bellInputName, bellAsset);

  await instance.exec([
    "-i",
    videoInput,
    "-i",
    bellInputName,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    outputName,
  ]);

  return outputName;
}

async function ensureMainHasAudio(instance: FFmpeg, inputName: string, outputName: string): Promise<void> {
  try {
    await instance.exec([
      "-i",
      inputName,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      outputName,
    ]);
  } catch {
    await instance.exec([
      "-i",
      inputName,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-shortest",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      outputName,
    ]);
  }
}

export async function processVideo(options: ProcessVideoOptions): Promise<Blob> {
  const instance = await loadFFmpeg();

  instance.on("progress", ({ progress }) => {
    const mapped = 15 + Math.round(progress * 75);
    options.onProgress(Math.max(0, Math.min(99, mapped)));
  });

  options.onProgress(2);
  await instance.writeFile("input.mp4", await fetchFile(options.sourceVideoUrl));

  const start = Math.max(0, options.trimStart).toFixed(3);
  const end = Math.max(options.trimStart + 0.5, options.trimEnd).toFixed(3);

  options.onProgress(8);
  await instance.exec([
    "-ss",
    start,
    "-to",
    end,
    "-i",
    "input.mp4",
    "-c",
    "copy",
    "trimmed_raw.mp4",
  ]);

  options.onProgress(18);
  await ensureMainHasAudio(instance, "trimmed_raw.mp4", "trimmed_main.mp4");

  let splashStartSegment: string | null = null;
  if (options.splashStartFile) {
    const startKind = inferSplashKind(options.splashStartFile);
    await writeAsset(instance, `splash_start_src.${startKind === "image" ? "png" : "mp4"}`, options.splashStartFile);
    await createVideoSegment(
      instance,
      `splash_start_src.${startKind === "image" ? "png" : "mp4"}`,
      "splash_start.mp4",
      startKind,
    );

    splashStartSegment = await overlayBellIfNeeded(
      instance,
      "splash_start.mp4",
      options.bellStartFile,
      "bell_start.mp3",
      "splash_start_with_bell.mp4",
    );
  }

  let splashEndSegment: string | null = null;
  if (options.splashEndFile) {
    const endKind = inferSplashKind(options.splashEndFile);
    await writeAsset(instance, `splash_end_src.${endKind === "image" ? "png" : "mp4"}`, options.splashEndFile);
    await createVideoSegment(
      instance,
      `splash_end_src.${endKind === "image" ? "png" : "mp4"}`,
      "splash_end.mp4",
      endKind,
    );

    splashEndSegment = await overlayBellIfNeeded(
      instance,
      "splash_end.mp4",
      options.bellEndFile,
      "bell_end.mp3",
      "splash_end_with_bell.mp4",
    );
  }

  options.onProgress(85);

  const parts: string[] = [];
  if (splashStartSegment) parts.push(splashStartSegment);
  parts.push("trimmed_main.mp4");
  if (splashEndSegment) parts.push(splashEndSegment);

  const concatFile = `${parts.map((name) => `file '${name}'`).join("\n")}\n`;
  await instance.writeFile("concat.txt", toBytes(concatFile));

  await instance.exec([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    "concat.txt",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "output.mp4",
  ]);

  const output = await instance.readFile("output.mp4");
  options.onProgress(100);

  return new Blob([new Uint8Array(Array.from(toBytes(output)))], { type: "video/mp4" });
}
