# Lion's Roar Talk Publisher

A Next.js app that ingests Zoom Sunday service recordings, lets volunteers trim and package videos, and either download the final MP4 or upload to YouTube.

## Background Processing Rollout

Durable processing is feature-flagged.

### Environment flags

- `PROCESSING_MODE=background`
  - Enables server-side queued processing APIs and worker execution.
  - If omitted, app defaults to in-browser processing.
- `NEXT_PUBLIC_PROCESSING_MODE=background`
  - Enables enqueue/poll UI path on the edit page.
- `BLOB_STORE_ACCESS=private` or `public`
  - Controls access mode for processed output blobs from the background worker.
  - Defaults to `private` when unset.

### Required existing env vars

Background mode relies on the current app envs already in use:
- Zoom credentials + meeting/webhook vars
- KV vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`)
- Blob token (`BLOB_READ_WRITE_TOKEN`)
- Optional YouTube vars for `mode=youtube`

## New Background APIs

- `POST /api/process/enqueue`
  - Creates a job and enqueues it.
- `GET /api/process/status?id=<jobId>`
  - Returns persisted job state.
- `GET /api/process/status?recordingUuid=<uuid>`
  - Returns currently active job for a recording.
- `GET /api/process/output?id=<jobId>`
  - Returns output metadata when completed.
- `POST /api/process/worker`
  - Protected worker endpoint (`x-app-secret: APP_SECRET` when APP_SECRET is set).

## One-time Legacy Dedupe

- `POST /api/admin/cleanup-recordings?secret=<APP_SECRET>`
  - Deduplicates `recordings:list` and rebuilds `recordings:index`.

## Validation Checklist

1. Set `PROCESSING_MODE=background` and `NEXT_PUBLIC_PROCESSING_MODE=background` in Vercel.
2. Trigger "Check for Recordings" and open an edit page.
3. Click "Process & Download".
4. Confirm job card shows `queued -> running -> completed`.
5. Close tab during running, reopen edit page, confirm job status resumes.
6. Confirm completed output URL appears.
7. Optionally run `mode=youtube` and confirm YouTube URL appears.

## Development

```bash
npm install
npm run dev
npm run build
```
