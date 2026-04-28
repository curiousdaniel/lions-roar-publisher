import { NextResponse } from "next/server";
import { getJob, getProcessingMode } from "@/lib/process/jobs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (getProcessingMode() !== "background") {
    return NextResponse.json({ error: "Background processing is disabled" }, { status: 400 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "completed") {
    return NextResponse.json({ error: "Job not completed", job }, { status: 409 });
  }

  return NextResponse.json({
    outputUrl: job.outputUrl,
    youtubeUrl: job.youtubeUrl,
    job,
  });
}
