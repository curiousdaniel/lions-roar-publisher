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

export async function getRecentRecordings(limit = 5): Promise<ZoomRecording[]> {
  const token = await getZoomToken();
  const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = new URL("https://api.zoom.us/v2/users/me/recordings");
  url.searchParams.set("from", fromDate);
  url.searchParams.set("page_size", "30");

  const response = await fetch(url, {
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
    meetings?: Array<{
      id: string | number;
      uuid: string;
      topic: string;
      start_time: string;
      duration: number;
      recording_files: ZoomRecording["recording_files"];
    }>;
  };

  const normalized = (data.meetings ?? [])
    .map<ZoomRecording>((meeting) => ({
      id: String(meeting.id),
      uuid: meeting.uuid,
      topic: meeting.topic,
      start_time: meeting.start_time,
      duration: meeting.duration,
      recording_files: (meeting.recording_files ?? []).filter(
        (f) => f.file_type === "MP4" && f.status === "completed",
      ),
    }))
    .filter((item) => item.recording_files.length > 0)
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

  return normalized.slice(0, limit);
}
