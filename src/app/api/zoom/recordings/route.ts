import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { getRecentRecordings } from "@/lib/zoom";
import type { IncomingRecording } from "@/types";

export async function GET() {
  try {
    const recordings = await getRecentRecordings(5);

    if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      for (const item of recordings) {
        const added = await kv.sadd("recordings:index", item.uuid);
        if (added === 0) {
          continue;
        }

        const incoming: IncomingRecording = {
          uuid: item.uuid,
          meetingId: item.id,
          topic: item.topic,
          startTime: item.start_time,
          receivedAt: new Date().toISOString(),
          status: "pending",
          recordingFiles: item.recording_files,
        };

        await kv.set(`recording:${item.uuid}`, incoming);
        await kv.lpush("recordings:list", item.uuid);
      }
    }

    return NextResponse.json({ recordings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("GET /api/zoom/recordings failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
