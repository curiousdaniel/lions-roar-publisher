import { kv } from "@vercel/kv";
import { RecordingCard } from "@/components/RecordingCard";
import type { IncomingRecording } from "@/types";

export default async function DashboardPage() {
  let recordings: IncomingRecording[] = [];
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const ids = (await kv.lrange<string[]>("recordings:list", 0, 49).catch(() => [])) as unknown as string[];
    recordings = (
      await Promise.all(ids.map((id) => kv.get<IncomingRecording>(`recording:${id}`)))
    ).filter(Boolean) as IncomingRecording[];
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-lora text-3xl font-semibold">Lion&apos;s Roar Talk Publisher</h1>
        <p className="text-zinc-600">Online Sunday Service - The Shambhala Journey</p>
      </div>

      <form action="/api/zoom/recordings" method="get">
        <button className="rounded-md bg-[#C17D3C] px-4 py-2 text-sm font-medium text-white" type="submit">
          Check for Recordings
        </button>
      </form>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        Recordings appear here automatically when Zoom finishes processing. You&apos;ll also receive an email.
      </div>

      {recordings.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">No recordings found yet.</div>
      ) : (
        <div className="grid gap-4">
          {recordings.map((recording) => (
            <RecordingCard key={recording.uuid} recording={recording} />
          ))}
        </div>
      )}
    </div>
  );
}
