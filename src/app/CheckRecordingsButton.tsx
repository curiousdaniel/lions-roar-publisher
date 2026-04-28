"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export function CheckRecordingsButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onClick() {
    setLoading(true);
    try {
      const response = await fetch("/api/zoom/recordings", { method: "GET" });
      const payload = (await response.json()) as { recordings?: unknown[]; error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to check recordings");
      }

      toast.success(`Checked Zoom. Found ${payload.recordings?.length ?? 0} recording(s).`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to check recordings");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="rounded-md bg-[#C17D3C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      type="button"
      onClick={onClick}
      disabled={loading}
    >
      {loading ? "Checking..." : "Check for Recordings"}
    </button>
  );
}
