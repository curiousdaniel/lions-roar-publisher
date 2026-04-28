export interface ZoomRecording {
  id: string;
  uuid: string;
  topic: string;
  start_time: string;
  duration: number;
  recording_files: ZoomRecordingFile[];
}

export interface ZoomRecordingFile {
  id: string;
  file_type: string;
  download_url: string;
  file_size: number;
  status: string;
}

export interface YouTubeTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface AppSettings {
  defaultSplashStart: string | null;
  defaultSplashEnd: string | null;
  defaultBellStart: string | null;
  defaultBellEnd: string | null;
  defaultDescription: string;
  youtubeTokens: YouTubeTokens | null;
}

export interface EditSession {
  recording: ZoomRecording;
  trimStart: number;
  trimEnd: number;
  splashStartUrl: string | null;
  splashEndUrl: string | null;
  bellStartUrl: string | null;
  bellEndUrl: string | null;
  description: string;
  title: string;
  youtubeConnected: boolean;
}

export interface IncomingRecording {
  uuid: string;
  meetingId: string;
  topic: string;
  startTime: string;
  receivedAt: string;
  status: "pending" | "editing" | "published";
  recordingFiles: ZoomRecordingFile[];
}

export type ProcessingMode = "download" | "youtube";
export type ProcessingJobStatus = "queued" | "running" | "completed" | "failed";

export interface ProcessingJobPayload {
  sourceVideoUrl: string;
  trimStart: number;
  trimEnd: number;
  splashStartUrl: string | null;
  splashEndUrl: string | null;
  bellStartUrl: string | null;
  bellEndUrl: string | null;
  title: string;
  description: string;
}

export interface ProcessingJob {
  id: string;
  recordingUuid: string;
  mode: ProcessingMode;
  status: ProcessingJobStatus;
  progress: number;
  error: string | null;
  outputUrl: string | null;
  youtubeUrl: string | null;
  payload: ProcessingJobPayload;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
