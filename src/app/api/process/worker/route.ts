import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import {
  acquireWorkerLock,
  getJob,
  getProcessingMode,
  popQueuedJobId,
  releaseWorkerLock,
  updateJob,
} from "@/lib/process/jobs";
import { processVideoServer } from "@/lib/process/ffmpeg-server";

export const runtime = "nodejs";
export const maxDuration = 300;

function getBlobAccessMode(): "public" | "private" {
  return process.env.BLOB_STORE_ACCESS === "public" ? "public" : "private";
}

function isAuthorized(request: Request): boolean {
  const secret = process.env.APP_SECRET;
  if (!secret) return true;
  const header = request.headers.get("x-app-secret");
  return header === secret;
}

async function uploadToYouTubeViaApi(params: {
  origin: string;
  outputPath: string;
  title: string;
  description: string;
}): Promise<string | null> {
  const outputBuffer = await readFile(params.outputPath);
  const formData = new FormData();
  formData.append("video", new File([outputBuffer], "processed.mp4", { type: "video/mp4" }));
  formData.append("title", params.title);
  formData.append("description", params.description);

  const response = await fetch(`${params.origin}/api/youtube/upload`, {
    method: "POST",
    body: formData,
  });

  const payload = (await response.json()) as { youtubeUrl?: string };
  return payload.youtubeUrl ?? null;
}

function toWorkerFetchableSourceUrl(requestUrl: string, rawUrl: string): string {
  try {
    const target = new URL(rawUrl);
    const isZoom = target.hostname === "zoom.us" || target.hostname.endsWith(".zoom.us");
    if (!isZoom) return rawUrl;
    return `${new URL(requestUrl).origin}/api/zoom/proxy?url=${encodeURIComponent(rawUrl)}`;
  } catch {
    return rawUrl;
  }
}

export async function POST(request: Request) {
  if (getProcessingMode() !== "background") {
    return NextResponse.json({ error: "Background processing is disabled" }, { status: 400 });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({ error: "KV is not configured" }, { status: 500 });
  }

  const lockToken = randomUUID();
  const acquired = await acquireWorkerLock(lockToken);
  if (!acquired) {
    return NextResponse.json({ status: "busy" });
  }

  let currentJobId: string | null = null;
  let currentCleanup: (() => Promise<void>) | null = null;
  try {
    const jobId = await popQueuedJobId();
    currentJobId = jobId;
    if (!jobId) {
      return NextResponse.json({ status: "idle" });
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ status: "missing-job", jobId });
    }

    await updateJob(jobId, { status: "running", startedAt: new Date().toISOString(), progress: 3, error: null });

    let outputPath: string | null = null;
    let attemptError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await processVideoServer({
          sourceVideoUrl: toWorkerFetchableSourceUrl(request.url, job.payload.sourceVideoUrl),
          trimStart: job.payload.trimStart,
          trimEnd: job.payload.trimEnd,
          splashStartUrl: job.payload.splashStartUrl,
          splashEndUrl: job.payload.splashEndUrl,
          bellStartUrl: job.payload.bellStartUrl,
          bellEndUrl: job.payload.bellEndUrl,
          onProgress: async (progress) => {
            await updateJob(jobId, { progress });
          },
        });
        outputPath = result.outputPath;
        currentCleanup = result.cleanup;
        break;
      } catch (error) {
        attemptError = error;
        if (attempt < 2) {
          await updateJob(jobId, { error: `Retrying after failure (attempt ${attempt})...` });
          continue;
        }
      }
    }

    if (!outputPath || !currentCleanup) {
      throw attemptError instanceof Error ? attemptError : new Error("Processing failed after retries");
    }

    const blob = await put(`outputs/${job.recordingUuid}-${Date.now()}.mp4`, createReadStream(outputPath) as any, {
      access: getBlobAccessMode(),
      addRandomSuffix: true,
    });

    let youtubeUrl: string | null = null;
    if (job.mode === "youtube") {
      youtubeUrl = await uploadToYouTubeViaApi({
        origin: new URL(request.url).origin,
        outputPath,
        title: job.payload.title,
        description: job.payload.description,
      });
    }

    await currentCleanup();
    currentCleanup = null;

    await updateJob(jobId, {
      status: "completed",
      progress: 100,
      finishedAt: new Date().toISOString(),
      outputUrl: blob.url,
      youtubeUrl,
      error: null,
    });

    return NextResponse.json({ status: "completed", jobId, outputUrl: blob.url, youtubeUrl });
  } catch (error) {
    console.error("Background worker failed", error);
    if (currentCleanup) {
      await currentCleanup().catch(() => {
        // ignore cleanup failures in error path
      });
      currentCleanup = null;
    }

    const message = error instanceof Error ? error.message : "Unknown worker error";
    if (currentJobId) {
      await updateJob(currentJobId, {
        status: "failed",
        progress: 100,
        finishedAt: new Date().toISOString(),
        error: message,
      });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await releaseWorkerLock(lockToken);
  }
}
