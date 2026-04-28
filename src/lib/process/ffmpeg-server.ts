import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

if (!ffmpegPath) {
  throw new Error("ffmpeg-static binary not available");
}
const ffmpegBin = ffmpegPath;
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const VIDEO_FILTER = `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2`;
const VIDEO_ENCODE_ARGS = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "29", "-pix_fmt", "yuv420p"];
const AUDIO_ENCODE_ARGS = ["-c:a", "aac", "-b:a", "128k"];

type ProcessOptions = {
  sourceVideoUrl: string;
  trimStart: number;
  trimEnd: number;
  splashStartUrl: string | null;
  splashEndUrl: string | null;
  bellStartUrl: string | null;
  bellEndUrl: string | null;
  onProgress: (progress: number) => Promise<void> | void;
};

export type ProcessVideoServerResult = {
  outputPath: string;
  cleanup: () => Promise<void>;
};

function inferAssetKind(url: string): "image" | "video" | "audio" {
  const lower = url.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(lower)) return "image";
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|$)/.test(lower)) return "audio";
  return "video";
}

async function downloadToFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch asset (${response.status}): ${url}`);
  }

  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(outputPath));
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegBin, ["-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-2000)}`));
      }
    });
  });
}

function standardEncodeArgs(outputPath: string): string[] {
  return ["-vf", VIDEO_FILTER, ...VIDEO_ENCODE_ARGS, ...AUDIO_ENCODE_ARGS, outputPath];
}

async function ensureMainHasAudioFromSource(sourceUrl: string, start: string, end: string, outputPath: string): Promise<void> {
  try {
    await runFfmpeg([
      "-ss",
      start,
      "-to",
      end,
      "-i",
      sourceUrl,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      ...standardEncodeArgs(outputPath),
    ]);
  } catch {
    await runFfmpeg([
      "-ss",
      start,
      "-to",
      end,
      "-i",
      sourceUrl,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-shortest",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      ...standardEncodeArgs(outputPath),
    ]);
  }
}

async function safeUnlink(path: string): Promise<void> {
  await unlink(path).catch(() => {
    // ignore missing/unlink race cleanup errors
  });
}

async function renderSplashSegment(params: {
  sourceUrl: string;
  bellUrl: string | null;
  tempDir: string;
  outputPrefix: string;
}): Promise<string> {
  const kind = inferAssetKind(params.sourceUrl) === "image" ? "image" : "video";
  const sourceExt = kind === "image" ? "png" : "mp4";
  const sourcePath = join(params.tempDir, `${params.outputPrefix}_src.${sourceExt}`);
  const renderedPath = join(params.tempDir, `${params.outputPrefix}_rendered.mp4`);

  await downloadToFile(params.sourceUrl, sourcePath);

  if (kind === "image") {
    await runFfmpeg([
      "-loop",
      "1",
      "-i",
      sourcePath,
      "-t",
      "3",
      "-vf",
      VIDEO_FILTER,
      ...VIDEO_ENCODE_ARGS,
      renderedPath,
    ]);
  } else {
    await runFfmpeg(["-i", sourcePath, ...standardEncodeArgs(renderedPath)]);
  }

  if (!params.bellUrl) {
    await safeUnlink(sourcePath);
    return renderedPath;
  }

  const bellPath = join(params.tempDir, `${params.outputPrefix}_bell.mp3`);
  const withBellPath = join(params.tempDir, `${params.outputPrefix}_with_bell.mp4`);
  await downloadToFile(params.bellUrl, bellPath);
  await runFfmpeg(["-i", renderedPath, "-i", bellPath, "-c:v", "copy", "-c:a", "aac", "-shortest", withBellPath]);
  await safeUnlink(sourcePath);
  await safeUnlink(renderedPath);
  await safeUnlink(bellPath);
  return withBellPath;
}

export async function processVideoServer(options: ProcessOptions): Promise<ProcessVideoServerResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "lions-roar-"));

  const cleanup = async () => {
    await rm(tempDir, { recursive: true, force: true });
  };

  try {
    const trimmedMainPath = join(tempDir, "trimmed_main.mp4");
    const outputPath = join(tempDir, "output.mp4");
    const concatPath = join(tempDir, "concat.txt");

    const start = Math.max(0, options.trimStart).toFixed(3);
    const end = Math.max(options.trimStart + 0.5, options.trimEnd).toFixed(3);

    await options.onProgress(8);
    await ensureMainHasAudioFromSource(options.sourceVideoUrl, start, end, trimmedMainPath);

    const parts: string[] = [];

    if (options.splashStartUrl) {
      const introSegment = await renderSplashSegment({
        sourceUrl: options.splashStartUrl,
        bellUrl: options.bellStartUrl,
        tempDir,
        outputPrefix: "splash_start",
      });
      parts.push(introSegment);
    }

    parts.push(trimmedMainPath);

    if (options.splashEndUrl) {
      const outroSegment = await renderSplashSegment({
        sourceUrl: options.splashEndUrl,
        bellUrl: options.bellEndUrl,
        tempDir,
        outputPrefix: "splash_end",
      });
      parts.push(outroSegment);
    }

    await options.onProgress(82);

    const concatContent = `${parts.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join("\n")}\n`;
    await writeFile(concatPath, concatContent, "utf8");

    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
    ...VIDEO_ENCODE_ARGS,
    ...AUDIO_ENCODE_ARGS,
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    await safeUnlink(concatPath);
    for (const segment of parts) {
      await safeUnlink(segment);
    }

    await options.onProgress(100);
    return { outputPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
