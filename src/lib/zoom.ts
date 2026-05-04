import type { ZoomRecording } from "@/types";

type ZoomTokenResponse = {
  access_token: string;
  expires_in: number;
};

type ZoomMeetingEntry = {
  id: string | number;
  uuid: string;
  topic: string;
  start_time: string;
  duration: number;
  recording_files: ZoomRecording["recording_files"];
};

type RecordingsFetchResult = {
  recordings: ZoomRecording[];
  source: "account" | "user";
  warning?: string;
};

const scopeFallbackCode = '"code":4711';

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

async function fetchRecordingsFromEndpoint(params: {
  token: string;
  urlFactory: (nextPageToken: string) => URL;
}): Promise<{ meetings: ZoomMeetingEntry[]; lastErrorBody?: string; status?: number }> {
  const allMeetings: ZoomMeetingEntry[] = [];

  let nextPageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const url = params.urlFactory(nextPageToken);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${params.token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      return { meetings: [], lastErrorBody: details, status: response.status };
    }

    const data = (await response.json()) as {
      meetings?: ZoomMeetingEntry[];
      next_page_token?: string;
    };

    allMeetings.push(...(data.meetings ?? []));
    nextPageToken = data.next_page_token ?? "";

    if (!nextPageToken || allMeetings.length >= 200) {
      break;
    }
  }

  return { meetings: allMeetings };
}

function normalizeRecentMeetings(meetings: ZoomMeetingEntry[], limit: number): ZoomRecording[] {
  return meetings
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
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
    .slice(0, limit);
}

export async function getRecentRecordings(limit = 5): Promise<RecordingsFetchResult> {
  const token = await getZoomToken();
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("Missing ZOOM_ACCOUNT_ID");
  }

  const accountFetch = await fetchRecordingsFromEndpoint({
    token,
    urlFactory: (nextPageToken) => {
      const url = new URL(`https://api.zoom.us/v2/accounts/${accountId}/recordings`);
      url.searchParams.set("page_size", "100");
      if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);
      return url;
    },
  });

  if (accountFetch.meetings.length > 0) {
    return { recordings: normalizeRecentMeetings(accountFetch.meetings, limit), source: "account" };
  }

  const isScopeFallback = Boolean(
    accountFetch.status === 400 && accountFetch.lastErrorBody?.includes(scopeFallbackCode),
  );

  if (!isScopeFallback && accountFetch.status) {
    throw new Error(
      `Failed to fetch recordings (${accountFetch.status}): ${accountFetch.lastErrorBody ?? "Unknown response"}`,
    );
  }

  const userFetch = await fetchRecordingsFromEndpoint({
    token,
    urlFactory: (nextPageToken) => {
      const fromDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const url = new URL("https://api.zoom.us/v2/users/me/recordings");
      url.searchParams.set("from", fromDate);
      url.searchParams.set("page_size", "100");
      if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);
      return url;
    },
  });

  if (userFetch.status) {
    throw new Error(`Failed to fetch recordings (${userFetch.status}): ${userFetch.lastErrorBody ?? "Unknown response"}`);
  }

  return {
    recordings: normalizeRecentMeetings(userFetch.meetings, limit),
    source: "user",
    warning: isScopeFallback
      ? "Fell back to users/me recordings because account-level recording scope was rejected by Zoom token."
      : undefined,
  };
}

/**
 * Fetches current recording file metadata for a meeting UUID.
 * Zoom requires double-encoding the UUID in the path when it contains `/` or other reserved characters.
 * Download URLs from webhooks or older KV entries expire; call this when loading the edit page.
 */
export async function refreshRecordingFilesForMeetingUuid(meetingUuid: string): Promise<ZoomRecording["recording_files"]> {
  const token = await getZoomToken();
  const pathId = encodeURIComponent(encodeURIComponent(meetingUuid));
  const url = `https://api.zoom.us/v2/meetings/${pathId}/recordings`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Zoom meeting recordings (${response.status}): ${details.slice(0, 400)}`);
  }

  const data = (await response.json()) as { recording_files?: ZoomRecording["recording_files"] };
  return (data.recording_files ?? []).filter((f) => f.file_type === "MP4" && f.status === "completed");
}
