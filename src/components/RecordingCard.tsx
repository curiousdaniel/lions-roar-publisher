import Link from "next/link";
import type { IncomingRecording } from "@/types";
import { formatDate } from "@/lib/utils";

export function RecordingCard({ recording }: { recording: IncomingRecording }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold text-zinc-900">{recording.topic}</h3>
      <p className="text-sm text-zinc-600">{formatDate(recording.startTime)}</p>
      <p className="mt-1 text-sm text-zinc-600">Status: {recording.status}</p>
      <Link
        href={`/edit/${encodeURIComponent(recording.uuid)}`}
        className="mt-3 inline-flex rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white"
      >
        Edit & Publish
      </Link>
    </div>
  );
}
