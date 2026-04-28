import { NextResponse } from "next/server";
import { createJob, getActiveJob, getProcessingMode } from "@/lib/process/jobs";
import type { ProcessingJobPayload, ProcessingMode } from "@/types";

export const runtime = "nodejs";

function validateBody(body: Record<string, unknown>): { ok: true; mode: ProcessingMode; recordingUuid: string; payload: ProcessingJobPayload } | { ok: false; error: string } {
  const mode = body.mode;
  const recordingUuid = body.recordingUuid;
  const payload = body.payload;

  if ((mode !== "download" && mode !== "youtube") || typeof recordingUuid !== "string" || !recordingUuid) {
    return { ok: false, error: "Invalid mode or recordingUuid" };
  }

  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Missing payload" };
  }

  const p = payload as Record<string, unknown>;
  if (typeof p.sourceVideoUrl !== "string" || !p.sourceVideoUrl) {
    return { ok: false, error: "Missing sourceVideoUrl" };
  }

  return {
    ok: true,
    mode,
    recordingUuid,
    payload: {
      sourceVideoUrl: String(p.sourceVideoUrl),
      trimStart: Number(p.trimStart ?? 0),
      trimEnd: Number(p.trimEnd ?? 0),
      splashStartUrl: (p.splashStartUrl as string | null) ?? null,
      splashEndUrl: (p.splashEndUrl as string | null) ?? null,
      bellStartUrl: (p.bellStartUrl as string | null) ?? null,
      bellEndUrl: (p.bellEndUrl as string | null) ?? null,
      title: String(p.title ?? "Sunday Service"),
      description: String(p.description ?? ""),
    },
  };
}

export async function POST(request: Request) {
  if (getProcessingMode() !== "background") {
    return NextResponse.json({ error: "Background processing is disabled" }, { status: 400 });
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({ error: "KV is not configured" }, { status: 500 });
  }

  const raw = (await request.json()) as Record<string, unknown>;
  const parsed = validateBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await getActiveJob(parsed.recordingUuid);
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return NextResponse.json({ job: existing, reused: true });
  }

  const job = await createJob({
    recordingUuid: parsed.recordingUuid,
    mode: parsed.mode,
    payload: parsed.payload,
  });

  const appSecret = process.env.APP_SECRET;
  const workerUrl = new URL("/api/process/worker", request.url).toString();
  void fetch(workerUrl, {
    method: "POST",
    headers: appSecret ? { "x-app-secret": appSecret } : undefined,
  }).catch((error) => {
    console.error("Failed to trigger worker", error);
  });

  return NextResponse.json({ job, reused: false });
}
