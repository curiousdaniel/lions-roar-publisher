"use client";

type Props = {
  label: string;
  accept?: string;
  currentValue?: string | null;
  onSelect?: (value: string) => void;
  onClear?: () => void;
};

export function SplashUploader({ label, accept = "*/*", currentValue, onSelect, onClear }: Props) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-700">
      <label className="flex cursor-pointer flex-col gap-2">
        <span className="font-medium">{label}</span>
        <input
          type="file"
          accept={accept}
          className="text-sm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            onSelect?.(URL.createObjectURL(file));
          }}
        />
      </label>
      {currentValue && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-zinc-500">{currentValue}</p>
          <button
            type="button"
            onClick={onClear}
            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
