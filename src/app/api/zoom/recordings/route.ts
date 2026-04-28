import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getMeetingRecordings } from "@/lib/zoom";
import type { IncomingRecording } from "@/types";

export async function GET() {
  const meetingId = process.env.ZOOM_MEETING_ID;
  if (!meetingId) {
    return NextResponse.json({ error: "Missing ZOOM_MEETING_ID" }, { status: 500 });
  }

  const recordings = await getMeetingRecordings(meetingId);

  for (const item of recordings) {
    const incoming: IncomingRecording = {
      uuid: item.uuid,
      meetingId,
      topic: item.topic,
      startTime: item.start_time,
      receivedAt: new Date().toISOString(),
      status: "pending",
      recordingFiles: item.recording_files,
    };

    await kv.set(`recording:${item.uuid}`, incoming);
    await kv.lpush("recordings:list", item.uuid);
  }

  return NextResponse.json({ recordings });
}
