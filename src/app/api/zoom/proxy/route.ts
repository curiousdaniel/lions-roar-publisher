import { NextResponse } from "next/server";
import { getZoomToken } from "@/lib/zoom";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAllowedZoomUrl(url: URL): boolean {
  return url.hostname === "zoom.us" || url.hostname.endsWith(".zoom.us");
}

export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams.get("url");
  if (!incoming) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const target = new URL(incoming);
  if (!isAllowedZoomUrl(target)) {
    return NextResponse.json({ error: "Invalid Zoom URL" }, { status: 400 });
  }

  if (target.searchParams.get("access_token")) {
    return NextResponse.redirect(target.toString());
  }

  const token = await getZoomToken();
  const response = await fetch(target, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok || !response.body) {
    const details = await response.text().catch(() => "");
    return NextResponse.json(
      { error: "Failed to fetch recording", details: details.slice(0, 500) },
      { status: response.status || 500 },
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", response.headers.get("Content-Type") ?? "video/mp4");
  const contentLength = response.headers.get("Content-Length");
  if (contentLength) headers.set("Content-Length", contentLength);

  return new NextResponse(response.body, { status: 200, headers });
}
