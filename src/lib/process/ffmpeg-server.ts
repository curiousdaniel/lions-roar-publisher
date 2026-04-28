import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

let ffmpeg: FFmpeg | null = null;
let loaded = false;

async function loadFFmpegServer(): Promise<FFmpeg> {
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

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(Array.from(data));
}

function inferAssetKind(asset: string): "image" | "video" | "audio" {
  const name = asset.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)$/i.test(name)) return "image";
  if (/\.(mp3|wav|m4a|aac|ogg)$/i.test(name)) return "audio";
  return "video";
}

async function createVideoSegment(instance: FFmpeg, inputName: string, outputName: string, kind: "image" | "video") {
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

  await instance.exec(["-i", inputName, "-c:v", "libx264", "-c:a", "aac", outputName]);
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

async function overlayBell(instance: FFmpeg, videoInput: string, bellUrl: string | null, outputName: string): Promise<string> {
  if (!bellUrl) return videoInput;

  await instance.writeFile("bell.mp3", await fetchFile(bellUrl));
  await instance.exec(["-i", videoInput, "-i", "bell.mp3", "-c:v", "copy", "-c:a", "aac", "-shortest", outputName]);
  return outputName;
}

export async function processVideoServer(options: {
  sourceVideoUrl: string;
  trimStart: number;
  trimEnd: number;
  splashStartUrl: string | null;
  splashEndUrl: string | null;
  bellStartUrl: string | null;
  bellEndUrl: string | null;
  onProgress: (progress: number) => Promise<void> | void;
}): Promise<Blob> {
  const instance = await loadFFmpegServer();

  instance.on("progress", ({ progress }) => {
    void options.onProgress(Math.max(0, Math.min(95, 10 + Math.round(progress * 80))));
  });

  await options.onProgress(2);
  await instance.writeFile("input.mp4", await fetchFile(options.sourceVideoUrl));

  const start = Math.max(0, options.trimStart).toFixed(3);
  const end = Math.max(options.trimStart + 0.5, options.trimEnd).toFixed(3);

  await options.onProgress(6);
  await instance.exec(["-ss", start, "-to", end, "-i", "input.mp4", "-c", "copy", "trimmed_raw.mp4"]);

  await options.onProgress(18);
  await ensureMainHasAudio(instance, "trimmed_raw.mp4", "trimmed_main.mp4");

  let splashStartSegment: string | null = null;
  if (options.splashStartUrl) {
    const kind = inferAssetKind(options.splashStartUrl) === "image" ? "image" : "video";
    const sourceName = kind === "image" ? "splash_start.png" : "splash_start.mp4";
    await instance.writeFile(sourceName, await fetchFile(options.splashStartUrl));
    await createVideoSegment(instance, sourceName, "splash_start_rendered.mp4", kind);
    splashStartSegment = await overlayBell(instance, "splash_start_rendered.mp4", options.bellStartUrl, "splash_start_with_bell.mp4");
  }

  let splashEndSegment: string | null = null;
  if (options.splashEndUrl) {
    const kind = inferAssetKind(options.splashEndUrl) === "image" ? "image" : "video";
    const sourceName = kind === "image" ? "splash_end.png" : "splash_end.mp4";
    await instance.writeFile(sourceName, await fetchFile(options.splashEndUrl));
    await createVideoSegment(instance, sourceName, "splash_end_rendered.mp4", kind);
    splashEndSegment = await overlayBell(instance, "splash_end_rendered.mp4", options.bellEndUrl, "splash_end_with_bell.mp4");
  }

  const parts: string[] = [];
  if (splashStartSegment) parts.push(splashStartSegment);
  parts.push("trimmed_main.mp4");
  if (splashEndSegment) parts.push(splashEndSegment);

  await options.onProgress(88);
  await instance.writeFile("concat.txt", toBytes(`${parts.map((name) => `file '${name}'`).join("\n")}\n`));
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
  await options.onProgress(100);
  return new Blob([new Uint8Array(Array.from(toBytes(output)))], { type: "video/mp4" });
}
