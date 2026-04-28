"use client";

import { useEffect, useMemo, useState } from "react";
import { DescriptionEditor } from "@/components/DescriptionEditor";
import { ProcessingModal } from "@/components/ProcessingModal";
import { SplashUploader } from "@/components/SplashUploader";
import { WaveformEditor } from "@/components/WaveformEditor";
import { processVideo } from "@/lib/ffmpeg";
import { toast } from "sonner";
import type { ProcessingJob, ProcessingMode } from "@/types";
import { useEditSession } from "./EditSessionContext";

function isBlobUrl(value: string | null | undefined): value is string {
  return Boolean(value && value.startsWith("blob:"));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function EditPageClient() {
  const { session, setSession } = useEditSession();
  const [sourceOverride, setSourceOverride] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Preparing...");
  const [youtubeUrl, setYoutubeUrl] = useState<string | null>(null);
  const [sourceFileSizeBytes, setSourceFileSizeBytes] = useState<number | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ProcessingJob | null>(null);
  const processingMode = process.env.NEXT_PUBLIC_PROCESSING_MODE === "background" ? "background" : "browser";

  useEffect(() => {
    return () => {
      if (isBlobUrl(sourceOverride)) {
        URL.revokeObjectURL(sourceOverride);
      }
    };
  }, [sourceOverride]);

  function setSessionAsset<K extends "splashStartUrl" | "splashEndUrl" | "bellStartUrl" | "bellEndUrl">(
    key: K,
    nextValue: string | null,
  ) {
    setSession((prev) => {
      const previous = prev[key];
      if (isBlobUrl(previous) && previous !== nextValue) {
        URL.revokeObjectURL(previous);
      }
      return { ...prev, [key]: nextValue };
    });
  }

  const sourceVideoUrl = useMemo(
    () => sourceOverride ?? session.recording.recording_files[0]?.download_url ?? null,
    [session.recording.recording_files, sourceOverride],
  );
  const effectiveSourceSizeBytes = sourceFileSizeBytes ?? session.recording.recording_files[0]?.file_size ?? null;
  const isLargeFile = Boolean(effectiveSourceSizeBytes && effectiveSourceSizeBytes > 2 * 1024 * 1024 * 1024);

  useEffect(() => {
    if (processingMode !== "background") return;

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/process/status?recordingUuid=${encodeURIComponent(session.recording.uuid)}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { job?: ProcessingJob | null };
        if (data.job) {
          setActiveJob(data.job);
          setActiveJobId(data.job.id);
        }
      } catch {
        // ignore background resume probe errors
      }
    })();

    return () => controller.abort();
  }, [processingMode, session.recording.uuid]);

  useEffect(() => {
    if (processingMode !== "background" || !activeJobId) return;

    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/process/status?id=${encodeURIComponent(activeJobId)}`);
          const data = (await response.json()) as { job?: ProcessingJob };
          if (!cancelled && data.job) {
            setActiveJob(data.job);
            if (data.job.status === "completed" || data.job.status === "failed") {
              setProcessing(false);
              setUploading(false);
            }
          }
        } catch {
          // ignore transient poll errors
        }
      })();
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [processingMode, activeJobId]);

  async function enqueueBackgroundJob(mode: ProcessingMode): Promise<void> {
    if (!sourceVideoUrl) {
      throw new Error("Select a source video first.");
    }
    if (sourceVideoUrl.startsWith("blob:")) {
      throw new Error("Background mode requires a Zoom/cloud URL. Local-only blob files require browser mode.");
    }

    const response = await fetch("/api/process/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        recordingUuid: session.recording.uuid,
        payload: {
          sourceVideoUrl,
          trimStart: session.trimStart,
          trimEnd: session.trimEnd,
          splashStartUrl: session.splashStartUrl,
          splashEndUrl: session.splashEndUrl,
          bellStartUrl: session.bellStartUrl,
          bellEndUrl: session.bellEndUrl,
          title: session.title,
          description: session.description,
        },
      }),
    });

    const payload = (await response.json()) as { job?: ProcessingJob; error?: string; reused?: boolean };
    if (!response.ok || !payload.job) {
      throw new Error(payload.error ?? "Failed to enqueue processing job");
    }

    setActiveJob(payload.job);
    setActiveJobId(payload.job.id);
    setStatus(payload.reused ? "Using existing job..." : "Queued");
    toast.success(payload.reused ? "Resumed existing background job." : "Background processing queued.");
  }

  async function handleCancelAndStartFresh() {
    if (processingMode !== "background") return;
    if (!activeJob) {
      toast.info("No active background job to cancel.");
      return;
    }

    try {
      const response = await fetch("/api/process/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeJob.id }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to cancel job");
      }

      setActiveJob(null);
      setActiveJobId(null);
      setProcessing(false);
      setUploading(false);
      setStatus("Cancelled");
      toast.success("Cancelled previous job. You can start fresh now.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel job");
    }
  }

  async function runProcessing(): Promise<Blob> {
    if (!sourceVideoUrl) {
      throw new Error("Select a source video first.");
    }

    const proxied = sourceVideoUrl.startsWith("http")
      ? `/api/zoom/proxy?url=${encodeURIComponent(sourceVideoUrl)}`
      : sourceVideoUrl;

    return processVideo({
      sourceVideoUrl: proxied,
      trimStart: session.trimStart,
      trimEnd: session.trimEnd,
      splashStartFile: session.splashStartUrl,
      splashEndFile: session.splashEndUrl,
      bellStartFile: session.bellStartUrl,
      bellEndFile: session.bellEndUrl,
      onProgress: (next) => {
        setProgress(next);
        setStatus(next < 100 ? "Processing..." : "Finalizing...");
      },
    });
  }

  async function handleProcessDownload() {
    if (!sourceVideoUrl) {
      toast.error("Select a source video first.");
      return;
    }

    setProcessing(true);
    setProgress(1);
    setStatus("Loading FFmpeg...");
    if (isLargeFile) {
      toast.warning("Large source file detected (>2GB). Processing may be slow.");
    }

    try {
      setYoutubeUrl(null);
      if (processingMode === "background") {
        await enqueueBackgroundJob("download");
      } else {
        const output = await runProcessing();
        downloadBlob(output, `${session.title.replace(/\s+/g, "-").toLowerCase() || "sunday-service"}.mp4`);
        setStatus("Done");
        toast.success("Video processed and downloaded.");
      }
    } catch (error) {
      console.error(error);
      toast.error("Video processing failed. Check console for details.");
      setStatus("Failed");
    } finally {
      if (processingMode !== "background") {
        setProcessing(false);
      }
    }
  }

  async function handleProcessUploadYouTube() {
    if (!sourceVideoUrl) {
      toast.error("Select a source video first.");
      return;
    }

    setProcessing(true);
    setUploading(true);
    setProgress(1);
    setStatus("Loading FFmpeg...");
    if (!session.youtubeConnected) {
      setUploading(false);
      setProcessing(false);
      toast.error("Connect YouTube first from Settings.");
      return;
    }
    if (isLargeFile) {
      toast.warning("Large source file detected (>2GB). Processing and upload may take longer.");
    }

    try {
      if (processingMode === "background") {
        await enqueueBackgroundJob("youtube");
      } else {
        const output = await runProcessing();

        setStatus("Uploading to YouTube...");
        const formData = new FormData();
        formData.append("video", new File([output], "processed.mp4", { type: "video/mp4" }));
        formData.append("title", session.title);
        formData.append("description", session.description);

        const response = await fetch("/api/youtube/upload", {
          method: "POST",
          body: formData,
        });

        const payload = (await response.json()) as { youtubeUrl?: string; error?: string };
        if (!response.ok || !payload.youtubeUrl) {
          throw new Error(payload.error ?? "YouTube upload failed");
        }

        setYoutubeUrl(payload.youtubeUrl);
        setStatus("Upload complete");
        toast.success("Upload complete. Video is unlisted on YouTube.");
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "YouTube upload failed.");
      setStatus("Failed");
    } finally {
      if (processingMode !== "background") {
        setUploading(false);
        setProcessing(false);
      }
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Edit Recording {session.recording.uuid}</h1>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <label className="block text-sm font-medium text-zinc-700">Source Video (optional override)</label>
        <input
          type="file"
          accept="video/*"
          className="mt-2 block"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const nextObjectUrl = URL.createObjectURL(file);
            setSourceFileSizeBytes(file.size);
            setSourceOverride((previous) => {
              if (isBlobUrl(previous) && previous !== nextObjectUrl) {
                URL.revokeObjectURL(previous);
              }
              return nextObjectUrl;
            });
          }}
        />
      </div>

      <WaveformEditor
        sourceVideoUrl={sourceVideoUrl}
        trimStart={session.trimStart}
        trimEnd={session.trimEnd}
        onTrimChange={(start, end) => setSession((prev) => ({ ...prev, trimStart: start, trimEnd: end }))}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <SplashUploader
          label="Intro Splash"
          accept="image/*,video/*"
          currentValue={session.splashStartUrl}
          onSelect={(value) => setSessionAsset("splashStartUrl", value)}
          onClear={() => setSessionAsset("splashStartUrl", null)}
        />
        <SplashUploader
          label="Outro Splash"
          accept="image/*,video/*"
          currentValue={session.splashEndUrl}
          onSelect={(value) => setSessionAsset("splashEndUrl", value)}
          onClear={() => setSessionAsset("splashEndUrl", null)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SplashUploader
          label="Intro Bell"
          accept="audio/*"
          currentValue={session.bellStartUrl}
          onSelect={(value) => setSessionAsset("bellStartUrl", value)}
          onClear={() => setSessionAsset("bellStartUrl", null)}
        />
        <SplashUploader
          label="Outro Bell"
          accept="audio/*"
          currentValue={session.bellEndUrl}
          onSelect={(value) => setSessionAsset("bellEndUrl", value)}
          onClear={() => setSessionAsset("bellEndUrl", null)}
        />
      </div>

      <DescriptionEditor
        initialValue={session.description}
        onChange={(description) => setSession((prev) => ({ ...prev, description }))}
      />

      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        <h2 className="mb-2 text-base font-semibold text-zinc-900">Processing Summary</h2>
        <p>Mode: {processingMode === "background" ? "Durable background queue" : "In-browser processing"}</p>
        <p>Title: {session.title}</p>
        <p>Trim Range: {Math.floor(session.trimStart)}s - {Math.floor(session.trimEnd)}s</p>
        <p>Intro Splash: {session.splashStartUrl ? "Set" : "None"}</p>
        <p>Outro Splash: {session.splashEndUrl ? "Set" : "None"}</p>
        <p>Intro Bell: {session.bellStartUrl ? "Set" : "None"}</p>
        <p>Outro Bell: {session.bellEndUrl ? "Set" : "None"}</p>
        <p>YouTube: {session.youtubeConnected ? "Connected" : "Not connected"}</p>
      </div>

      {isLargeFile && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Source file appears larger than 2GB. Processing can be slow; close other browser tabs for best results.
        </div>
      )}

      {processingMode === "background" && activeJob && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-medium">Background Job: {activeJob.status}</p>
          <p>Progress: {activeJob.progress}%</p>
          <p>Job ID: {activeJob.id}</p>
          {activeJob.status === "completed" && activeJob.outputUrl && (
            <p>
              Output:{" "}
              <a href={activeJob.outputUrl} target="_blank" rel="noreferrer" className="underline">
                Download processed video
              </a>
            </p>
          )}
          {activeJob.status === "completed" && activeJob.youtubeUrl && (
            <p>
              YouTube:{" "}
              <a href={activeJob.youtubeUrl} target="_blank" rel="noreferrer" className="underline">
                {activeJob.youtubeUrl}
              </a>
            </p>
          )}
          {activeJob.status === "failed" && activeJob.error && <p>Error: {activeJob.error}</p>}
          <p className="mt-2 text-xs">You can close this tab and come back later. Job status is persisted.</p>
          {(activeJob.status === "queued" || activeJob.status === "running") && (
            <button
              type="button"
              onClick={handleCancelAndStartFresh}
              className="mt-3 rounded-md border border-blue-300 bg-white px-3 py-2 text-xs font-medium text-blue-800"
            >
              Cancel & Start Fresh
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-4">
        <button
          className="rounded-md bg-[#C17D3C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={handleProcessDownload}
          disabled={processing || uploading}
          type="button"
        >
          {processing ? `Processing... ${progress}%` : "Process & Download"}
        </button>
        <button
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          type="button"
          onClick={handleProcessUploadYouTube}
          disabled={processing || uploading || !session.youtubeConnected}
        >
          {!session.youtubeConnected ? "Connect YouTube first" : uploading ? "Uploading..." : "Process & Upload to YouTube"}
        </button>
      </div>

      {processing && processingMode !== "background" && (
        <ProcessingModal progress={progress} status={status} onClose={() => setProcessing(false)} canClose={!processing && !uploading} />
      )}
      {youtubeUrl && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Uploaded as Unlisted:{" "}
          <a href={youtubeUrl} target="_blank" rel="noreferrer" className="underline">
            {youtubeUrl}
          </a>
        </div>
      )}
    </div>
  );
}
