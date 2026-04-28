"use client";

import { useEffect, useState } from "react";

export function DescriptionEditor({
  initialValue,
  onChange,
}: {
  initialValue: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <label className="mb-2 block text-sm font-medium text-zinc-700">YouTube Description</label>
      <textarea
        className="min-h-32 w-full rounded-md border border-zinc-300 p-2 text-sm"
        value={value}
        onChange={(event) => {
          const next = event.target.value.slice(0, 5000);
          setValue(next);
          onChange?.(next);
        }}
      />
      <p className="mt-2 text-xs text-zinc-500">{value.length}/5000</p>
    </div>
  );
}
