import { Readable } from "node:stream";
import { google } from "googleapis";
import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Missing YouTube OAuth env vars" }, { status: 500 });
  }

  const formData = await request.formData();
  const video = formData.get("video");
  const title = String(formData.get("title") ?? "Sunday Service");
  const description = String(formData.get("description") ?? "");

  if (!(video instanceof File)) {
    return NextResponse.json({ error: "Missing video file" }, { status: 400 });
  }

  const tokens = await kv.get("youtube:tokens");
  if (!tokens) {
    return NextResponse.json({ error: "YouTube not connected" }, { status: 401 });
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials(tokens as any);

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  const arrayBuffer = await video.arrayBuffer();
  const stream = Readable.from(Buffer.from(arrayBuffer));

  const result = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description },
      status: { privacyStatus: "unlisted" },
    },
    media: { body: stream },
  });

  const videoId = result.data.id;
  if (!videoId) {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  return NextResponse.json({
    videoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
  });
}
