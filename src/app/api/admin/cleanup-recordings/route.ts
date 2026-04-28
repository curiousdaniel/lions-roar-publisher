import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const secret = process.env.APP_SECRET;
  if (!secret) return false;

  const headerSecret = request.headers.get("x-app-secret");
  const querySecret = new URL(request.url).searchParams.get("secret");
  return headerSecret === secret || querySecret === secret;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({ error: "KV is not configured" }, { status: 500 });
  }

  const ids = (await kv.lrange<string[]>("recordings:list", 0, 5000).catch(() => [])) as unknown as string[];
  const seen = new Set<string>();
  const uniqueNewestFirst: string[] = [];

  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    uniqueNewestFirst.push(id);
  }

  await kv.del("recordings:list");
  await kv.del("recordings:index");

  for (let i = uniqueNewestFirst.length - 1; i >= 0; i -= 1) {
    await kv.lpush("recordings:list", uniqueNewestFirst[i]);
  }

  for (const id of uniqueNewestFirst) {
    await kv.sadd("recordings:index", id);
  }

  return NextResponse.json({
    status: "ok",
    beforeCount: ids.length,
    afterCount: uniqueNewestFirst.length,
    removedDuplicates: ids.length - uniqueNewestFirst.length,
  });
}
