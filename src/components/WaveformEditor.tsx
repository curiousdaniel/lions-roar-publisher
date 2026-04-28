"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WaveSurferType = {
  load: (url: string) => Promise<void>;
  getDuration: () => number;
  on: (event: string, cb: (...args: any[]) => void) => void;
  registerPlugin: (plugin: any) => any;
  destroy: () => void;
  playPause: () => void;
};

function formatHms(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(safe / 3600)).padStart(2, "0");
  const mm = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

async function detectTrimWindow(url: string): Promise<{ start: number; end: number }> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();

  const audioContext = new AudioContext();
  const decoded = await audioContext.decodeAudioData(buffer.slice(0));
  const channelData = decoded.getChannelData(0);

  const windowSize = Math.floor(decoded.sampleRate * 0.5);
  const threshold = 0.01;

  let first = 0;
  let last = channelData.length - 1;

  for (let i = 0; i < channelData.length; i += windowSize) {
    let sum = 0;
    for (let j = i; j < Math.min(i + windowSize, channelData.length); j += 1) {
      sum += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sum / windowSize);
    if (rms > threshold) {
      first = i;
      break;
    }
  }

  for (let i = channelData.length - 1; i > 0; i -= windowSize) {
    let sum = 0;
    const start = Math.max(0, i - windowSize);
    for (let j = start; j < i; j += 1) {
      sum += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(sum / windowSize);
    if (rms > threshold) {
      last = i;
      break;
    }
  }

  const duration = decoded.duration;
  const startSec = Math.max(0, first / decoded.sampleRate - 2);
  const endSec = Math.min(duration, last / decoded.sampleRate + 2);

  await audioContext.close();
  return { start: startSec, end: Math.max(startSec + 1, endSec) };
}

export function WaveformEditor({
  sourceVideoUrl,
  trimStart,
  trimEnd,
  onTrimChange,
}: {
  sourceVideoUrl: string | null;
  trimStart: number;
  trimEnd: number;
  onTrimChange: (start: number, end: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurferType | null>(null);
  const regionRef = useRef<any>(null);

  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  const effectiveUrl = useMemo(() => {
    if (localVideoUrl) return localVideoUrl;
    if (!sourceVideoUrl) return null;
    return `/api/zoom/proxy?url=${encodeURIComponent(sourceVideoUrl)}`;
  }, [localVideoUrl, sourceVideoUrl]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!containerRef.current || !effectiveUrl) return;

      const WaveSurfer = (await import("wavesurfer.js")).default;
      const RegionsPlugin = (await import("wavesurfer.js/dist/plugins/regions.esm.js")).default;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "#D4B896",
        progressColor: "#C17D3C",
        backend: "WebAudio",
        height: 120,
      }) as WaveSurferType;

      const regions = ws.registerPlugin(RegionsPlugin.create());
      wsRef.current = ws;

      ws.on("ready", async () => {
        if (!mounted) return;
        setReady(true);

        let start = trimStart;
        let end = trimEnd;

        if (start === 0 && end === 0) {
          try {
            const detected = await detectTrimWindow(effectiveUrl);
            start = detected.start;
            end = detected.end;
          } catch {
            const duration = ws.getDuration();
            start = 0;
            end = duration;
          }
        }

        regionRef.current = regions.addRegion({
          start,
          end,
          color: "rgba(193, 125, 60, 0.2)",
          drag: true,
          resize: true,
        });

        onTrimChange(start, end);

        regionRef.current.on("update-end", () => {
          onTrimChange(regionRef.current.start, regionRef.current.end);
        });
      });

      ws.on("play", () => setPlaying(true));
      ws.on("pause", () => setPlaying(false));

      await ws.load(effectiveUrl);
    }

    void init();

    return () => {
      mounted = false;
      if (wsRef.current) {
        wsRef.current.destroy();
        wsRef.current = null;
      }
    };
  }, [effectiveUrl]);

  useEffect(() => {
    return () => {
      if (localVideoUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(localVideoUrl);
      }
    };
  }, [localVideoUrl]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700">
          Load local video
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const objectUrl = URL.createObjectURL(file);
              setLocalVideoUrl((previous) => {
                if (previous?.startsWith("blob:") && previous !== objectUrl) {
                  URL.revokeObjectURL(previous);
                }
                return objectUrl;
              });
            }}
          />
        </label>
        <button
          type="button"
          disabled={!ready}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          onClick={() => wsRef.current?.playPause()}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>

      {effectiveUrl ? (
        <>
          <div ref={containerRef} className="w-full" />
          <div className="mt-3 flex gap-4 text-sm text-zinc-700">
            <span>Start: {formatHms(trimStart)}</span>
            <span>End: {formatHms(trimEnd)}</span>
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-600">Choose a local file or ensure this recording has a Zoom MP4 URL.</p>
      )}
    </div>
  );
}
