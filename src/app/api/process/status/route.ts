import { NextResponse } from "next/server";
import { getActiveJob, getJob, getProcessingMode } from "@/lib/process/jobs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (getProcessingMode() !== "background") {
    return NextResponse.json({ error: "Background processing is disabled" }, { status: 400 });
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({ error: "KV is not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const recordingUuid = url.searchParams.get("recordingUuid");

  if (id) {
    const job = await getJob(id);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ job });
  }

  if (recordingUuid) {
    const job = await getActiveJob(recordingUuid);
    return NextResponse.json({ job });
  }

  return NextResponse.json({ error: "Provide id or recordingUuid" }, { status: 400 });
}
