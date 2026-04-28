import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

if (!ffmpegPath) {
  throw new Error("ffmpeg-static binary not available");
}
const ffmpegBin = ffmpegPath;

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

function inferAssetKind(url: string): "image" | "video" | "audio" {
  const lower = url.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(lower)) return "image";
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|$)/.test(lower)) return "audio";
  return "video";
}

async function downloadToFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset (${response.status}): ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, bytes);
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

async function ensureMainHasAudio(inputPath: string, outputPath: string): Promise<void> {
  try {
    await runFfmpeg([
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      outputPath,
    ]);
  } catch {
    await runFfmpeg([
      "-i",
      inputPath,
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
      outputPath,
    ]);
  }
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
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      renderedPath,
    ]);
  } else {
    await runFfmpeg(["-i", sourcePath, "-c:v", "libx264", "-c:a", "aac", renderedPath]);
  }

  if (!params.bellUrl) {
    return renderedPath;
  }

  const bellPath = join(params.tempDir, `${params.outputPrefix}_bell.mp3`);
  const withBellPath = join(params.tempDir, `${params.outputPrefix}_with_bell.mp4`);
  await downloadToFile(params.bellUrl, bellPath);
  await runFfmpeg(["-i", renderedPath, "-i", bellPath, "-c:v", "copy", "-c:a", "aac", "-shortest", withBellPath]);
  return withBellPath;
}

export async function processVideoServer(options: ProcessOptions): Promise<Blob> {
  const tempDir = await mkdtemp(join(tmpdir(), "lions-roar-"));

  try {
    const inputPath = join(tempDir, "input.mp4");
    const trimmedRawPath = join(tempDir, "trimmed_raw.mp4");
    const trimmedMainPath = join(tempDir, "trimmed_main.mp4");
    const outputPath = join(tempDir, "output.mp4");
    const concatPath = join(tempDir, "concat.txt");

    await options.onProgress(2);
    await downloadToFile(options.sourceVideoUrl, inputPath);

    const start = Math.max(0, options.trimStart).toFixed(3);
    const end = Math.max(options.trimStart + 0.5, options.trimEnd).toFixed(3);

    await options.onProgress(10);
    await runFfmpeg(["-ss", start, "-to", end, "-i", inputPath, "-c", "copy", trimmedRawPath]);

    await options.onProgress(25);
    await ensureMainHasAudio(trimmedRawPath, trimmedMainPath);

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

    await options.onProgress(80);

    const concatContent = `${parts.map((filePath) => `file '${filePath.replace(/'/g, "'\\''")}'`).join("\n")}\n`;
    await writeFile(concatPath, concatContent, "utf8");

    await runFfmpeg([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    await options.onProgress(100);
    const outputBuffer = await readFile(outputPath);
    return new Blob([outputBuffer], { type: "video/mp4" });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
