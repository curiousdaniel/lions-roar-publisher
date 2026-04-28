import type { ZoomRecording } from "@/types";

type ZoomTokenResponse = {
  access_token: string;
  expires_in: number;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getZoomToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error("Missing Zoom credentials in environment variables.");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const url = new URL("https://zoom.us/oauth/token");
  url.searchParams.set("grant_type", "account_credentials");
  url.searchParams.set("account_id", accountId);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to fetch Zoom token (${response.status}): ${details || response.statusText}`);
  }

  const data = (await response.json()) as ZoomTokenResponse;
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return data.access_token;
}

export async function getMeetingRecordings(meetingId: string): Promise<ZoomRecording[]> {
  const token = await getZoomToken();
  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/recordings`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to fetch recordings (${response.status}): ${details || response.statusText}`);
  }

  const data = (await response.json()) as {
    id: string;
    uuid: string;
    topic: string;
    start_time: string;
    duration: number;
    recording_files: ZoomRecording["recording_files"];
  };

  return [
    {
      id: String(data.id),
      uuid: data.uuid,
      topic: data.topic,
      start_time: data.start_time,
      duration: data.duration,
      recording_files: (data.recording_files ?? []).filter((f) => f.file_type === "MP4"),
    },
  ];
}
