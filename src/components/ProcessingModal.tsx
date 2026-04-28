"use client";

export function ProcessingModal({
  progress,
  status,
  onClose,
  canClose = true,
}: {
  progress: number;
  status: string;
  onClose: () => void;
  canClose?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900">Processing Video</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            className="text-sm text-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Close
          </button>
        </div>
        <p className="text-sm text-zinc-700">{status} ({progress}%)</p>
        <div className="mt-2 h-2 w-full rounded bg-zinc-100">
          <div className="h-full rounded bg-amber-700" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}
