import { kv } from "@vercel/kv";
import { getSettings } from "@/lib/settings";
import type { EditSession, IncomingRecording, ZoomRecording } from "@/types";
import { EditPageClient } from "./EditPageClient";
import { EditSessionProvider } from "./EditSessionContext";

function toZoomRecording(recording: IncomingRecording): ZoomRecording {
  return {
    id: recording.meetingId,
    uuid: recording.uuid,
    topic: recording.topic,
    start_time: recording.startTime,
    duration: 0,
    recording_files: recording.recordingFiles,
  };
}

export default async function EditPage({
  params,
}: {
  params: Promise<{ recordingId: string }>;
}) {
  const { recordingId } = await params;

  const settings = await getSettings();

  let incoming: IncomingRecording | null = null;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    incoming = await kv.get<IncomingRecording>(`recording:${recordingId}`);
  }

  const fallback: IncomingRecording = {
    uuid: recordingId,
    meetingId: process.env.ZOOM_MEETING_ID ?? "",
    topic: "Sunday Service",
    startTime: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    status: "editing",
    recordingFiles: [],
  };

  const recording = toZoomRecording(incoming ?? fallback);

  const initialSession: EditSession = {
    recording,
    trimStart: 0,
    trimEnd: 0,
    splashStartUrl: settings.defaultSplashStart,
    splashEndUrl: settings.defaultSplashEnd,
    bellStartUrl: settings.defaultBellStart,
    bellEndUrl: settings.defaultBellEnd,
    description: settings.defaultDescription,
    title: `Sunday Service - ${new Date(recording.start_time).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`,
    youtubeConnected: Boolean(settings.youtubeTokens),
  };

  return (
    <EditSessionProvider initialSession={initialSession}>
      <EditPageClient />
    </EditSessionProvider>
  );
}
