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
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("Missing ZOOM_ACCOUNT_ID");
  }

  const allMeetings: Array<{
    id: string | number;
    uuid: string;
    topic: string;
    start_time: string;
    duration: number;
    recording_files: ZoomRecording["recording_files"];
  }> = [];

  let nextPageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`https://api.zoom.us/v2/accounts/${accountId}/recordings`);
    url.searchParams.set("page_size", "100");
    if (nextPageToken) {
      url.searchParams.set("next_page_token", nextPageToken);
    }

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
      next_page_token?: string;
    };

    allMeetings.push(...(data.meetings ?? []));
    nextPageToken = data.next_page_token ?? "";

    if (!nextPageToken || allMeetings.length >= 200) {
      break;
    }
  }

  const normalized = allMeetings
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
