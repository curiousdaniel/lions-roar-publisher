import { randomUUID } from "node:crypto";
import { kv } from "@vercel/kv";
import type { ProcessingJob, ProcessingJobPayload, ProcessingMode } from "@/types";

const JOB_PREFIX = "job:";
const QUEUE_KEY = "jobs:queue";
const WORKER_LOCK_KEY = "jobs:worker:lock";

function nowIso(): string {
  return new Date().toISOString();
}

export function getProcessingMode(): "browser" | "background" {
  return process.env.PROCESSING_MODE === "background" ? "background" : "browser";
}

export function getQueueKey(): string {
  return QUEUE_KEY;
}

export function getWorkerLockKey(): string {
  return WORKER_LOCK_KEY;
}

export function getJobKey(id: string): string {
  return `${JOB_PREFIX}${id}`;
}

export function getActiveJobKey(recordingUuid: string): string {
  return `job:active:${recordingUuid}`;
}

export async function createJob(params: {
  recordingUuid: string;
  mode: ProcessingMode;
  payload: ProcessingJobPayload;
}): Promise<ProcessingJob> {
  const id = randomUUID();
  const job: ProcessingJob = {
    id,
    recordingUuid: params.recordingUuid,
    mode: params.mode,
    status: "queued",
    progress: 0,
    error: null,
    outputUrl: null,
    youtubeUrl: null,
    payload: params.payload,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
  };

  await kv.set(getJobKey(id), job);
  await kv.set(getActiveJobKey(params.recordingUuid), id);
  await kv.lpush(getQueueKey(), id);

  return job;
}

export async function getJob(id: string): Promise<ProcessingJob | null> {
  return (await kv.get<ProcessingJob>(getJobKey(id))) ?? null;
}

export async function getActiveJob(recordingUuid: string): Promise<ProcessingJob | null> {
  const id = await kv.get<string>(getActiveJobKey(recordingUuid));
  if (!id) return null;
  return getJob(id);
}

export async function updateJob(id: string, patch: Partial<ProcessingJob>): Promise<ProcessingJob | null> {
  const current = await getJob(id);
  if (!current) return null;

  const next: ProcessingJob = { ...current, ...patch };
  await kv.set(getJobKey(id), next);

  if (next.status === "completed" || next.status === "failed") {
    await kv.del(getActiveJobKey(next.recordingUuid));
  }

  return next;
}

export async function popQueuedJobId(): Promise<string | null> {
  return (await kv.rpop<string>(getQueueKey())) ?? null;
}

export async function acquireWorkerLock(token: string): Promise<boolean> {
  const result = await kv.set(getWorkerLockKey(), token, { nx: true, ex: 300 });
  return result === "OK";
}

export async function releaseWorkerLock(token: string): Promise<void> {
  const current = await kv.get<string>(getWorkerLockKey());
  if (current === token) {
    await kv.del(getWorkerLockKey());
  }
}
