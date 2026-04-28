import { NextResponse } from "next/server";
import { cancelActiveJob, cancelJobById, getProcessingMode } from "@/lib/process/jobs";

export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const secret = process.env.APP_SECRET;
  if (!secret) return true;

  const headerSecret = request.headers.get("x-app-secret");
  const querySecret = new URL(request.url).searchParams.get("secret");
  return headerSecret === secret || querySecret === secret;
}

export async function POST(request: Request) {
  if (getProcessingMode() !== "background") {
    return NextResponse.json({ error: "Background processing is disabled" }, { status: 400 });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    recordingUuid?: string;
  };

  if (!body.id && !body.recordingUuid) {
    return NextResponse.json({ error: "Provide id or recordingUuid" }, { status: 400 });
  }

  const cancelled = body.id ? await cancelJobById(body.id) : await cancelActiveJob(String(body.recordingUuid));
  if (!cancelled) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ status: "cancelled", job: cancelled });
}
