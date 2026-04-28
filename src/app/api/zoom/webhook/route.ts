import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { notifyNewRecording } from "@/lib/notify";
import type { IncomingRecording, ZoomRecordingFile } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) {
    return NextResponse.json({ error: "Missing webhook secret" }, { status: 500 });
  }

  const rawBody = await request.text();
  const body = JSON.parse(rawBody) as Record<string, any>;

  if (body.event === "endpoint.url_validation") {
    const plainToken = body.payload?.plainToken as string | undefined;
    if (!plainToken) {
      return NextResponse.json({ error: "Missing plainToken" }, { status: 400 });
    }
    const encryptedToken = createHmac("sha256", secret).update(plainToken).digest("hex");
    return NextResponse.json({ plainToken, encryptedToken });
  }

  const timestamp = request.headers.get("x-zm-request-timestamp") ?? "";
  const signature = request.headers.get("x-zm-signature") ?? "";
  const message = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(message).digest("hex")}`;

  if (signature !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (body.event !== "recording.completed") {
    return NextResponse.json({ status: "ignored" });
  }

  const object = body.payload?.object;
  if (!object || String(object.id) !== process.env.ZOOM_MEETING_ID) {
    return NextResponse.json({ status: "ignored" });
  }

  const files = ((object.recording_files ?? []) as ZoomRecordingFile[]).filter(
    (f) => f.file_type === "MP4" && f.status === "completed",
  );

  if (files.length === 0) {
    return NextResponse.json({ status: "received" });
  }

  const incoming: IncomingRecording = {
    uuid: object.uuid,
    meetingId: String(object.id),
    topic: object.topic,
    startTime: object.start_time,
    receivedAt: new Date().toISOString(),
    status: "pending",
    recordingFiles: files,
  };

  const added = await kv.sadd("recordings:index", incoming.uuid);
  if (added === 0) {
    return NextResponse.json({ status: "already-received" });
  }

  await kv.set(`recording:${incoming.uuid}`, incoming);
  await kv.lpush("recordings:list", incoming.uuid);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    void notifyNewRecording({
      topic: incoming.topic,
      startTime: incoming.startTime,
      editUrl: `${appUrl}/edit/${incoming.uuid}`,
    });
  }

  return NextResponse.json({ status: "received" });
}
