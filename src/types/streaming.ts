export type DevicePlatform =
  | 'Windows'
  | 'macOS'
  | 'Linux'
  | 'ChromeOS'
  | 'Android'
  | 'iOS'
  | 'iPadOS'
  | 'Unknown';

export type DeviceFormFactor = 'phone' | 'tablet' | 'desktop';

export type WorkspaceRole =
  | 'landing'
  | 'broadcaster'
  | 'receiver'
  | 'guide'
  | 'auth'
  | 'profile';

export type StreamResolutionId = '1440p' | '1080p' | '720p' | '540p';

export type StreamFrameRate = 60 | 30 | 15;

export interface StreamResolutionOption {
  id: StreamResolutionId;
  label: string;
  width: number;
  height: number;
}

export const STREAM_RESOLUTION_OPTIONS: Record<
  StreamResolutionId,
  StreamResolutionOption
> = {
  '1440p': {
    id: '1440p',
    label: '1440p (QHD)',
    width: 2560,
    height: 1440,
  },
  '1080p': {
    id: '1080p',
    label: '1080p (Full HD)',
    width: 1920,
    height: 1080,
  },
  '720p': {
    id: '720p',
    label: '720p (HD · Multi-Screen)',
    width: 1280,
    height: 720,
  },
  '540p': {
    id: '540p',
    label: '540p (Low Bandwidth)',
    width: 960,
    height: 540,
  },
};

export const STREAM_FRAME_RATE_OPTIONS: Array<{
  value: StreamFrameRate;
  label: string;
}> = [
  { value: 60, label: '60 fps (Smooth Motion)' },
  { value: 30, label: '30 fps (Balanced)' },
  { value: 15, label: '15 fps (Docs & Slides)' },
];

export function computeTargetBitrateBps(
  resolutionId: StreamResolutionId,
  frameRate: StreamFrameRate,
): number {
  const matrix: Record<StreamResolutionId, Record<StreamFrameRate, number>> = {
    '1440p': { 60: 14_000_000, 30: 9_000_000, 15: 5_500_000 },
    '1080p': { 60: 8_000_000, 30: 5_000_000, 15: 3_000_000 },
    '720p': { 60: 4_000_000, 30: 2_500_000, 15: 1_600_000 },
    '540p': { 60: 2_200_000, 30: 1_500_000, 15: 950_000 },
  };
  return matrix[resolutionId][frameRate];
}

export type StreamQualityId =
  | '1440p60'
  | '1080p60'
  | '1080p30'
  | '720p60'
  | '720p30'
  | '540p30';

export type StreamContentHint = 'detail' | 'motion';

export type DisplaySurfacePreference = 'any' | 'monitor' | 'window' | 'browser';

export type ScreenCaptureStatus =
  | 'idle'
  | 'requesting'
  | 'sharing'
  | 'permission-denied'
  | 'stopped'
  | 'unsupported'
  | 'error';

export type AudioConnectionState =
  | 'available'
  | 'connected'
  | 'muted'
  | 'unavailable'
  | 'permission-required';

export type QualityMode = 'auto' | 'high' | 'medium' | 'low';

export type AdaptiveTierLabel = 'High' | 'Medium' | 'Low';

export interface AdaptiveQualitySnapshot {
  mode: QualityMode;
  tierLabel: AdaptiveTierLabel;
  targetBitrateBps: number;
  scaleResolutionDownBy: number;
  maxFramerate: number;
  effectiveWidth?: number;
  effectiveHeight?: number;
  reason: string;
  adaptedDown: boolean;
}

export const DISPLAY_SURFACE_OPTIONS: Array<{
  id: DisplaySurfacePreference;
  label: string;
  description: string;
}> = [
  {
    id: 'any',
    label: 'Any Surface',
    description: 'Choose full display, window, or browser tab in picker',
  },
  {
    id: 'monitor',
    label: 'Full Display',
    description: 'Prefer capturing an entire physical monitor',
  },
  {
    id: 'window',
    label: 'App Window',
    description: 'Prefer capturing a single desktop application window',
  },
  {
    id: 'browser',
    label: 'Browser Tab',
    description: 'Prefer capturing an individual browser tab',
  },
];

export const ROOM_LIFETIME_PRESETS: Array<{
  label: string;
  ms: number;
}> = [
  { label: '4 hours', ms: 4 * 60 * 60 * 1000 },
  { label: '12 hours', ms: 12 * 60 * 60 * 1000 },
  { label: '24 hours (Default)', ms: 24 * 60 * 60 * 1000 },
  { label: '3 days', ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'No fixed expiry (Idle cleanup only)', ms: 0 },
];

export type PeerConnectionStatus =
  | 'idle'
  | 'waiting-stream'
  | 'negotiating'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export type ConnectionQualityTier =
  | 'standby'
  | 'measuring'
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor';

export type AverageQualityLabel = 'Excellent' | 'Good' | 'Fair' | 'Poor';

export interface RoomSessionAnalytics {
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  peakReceivers: number;
  totalReceiversJoined: number;
  reconnectCount: number;
  qualitySamplesCount: number;
  averageQualityLabel: AverageQualityLabel | null;
}

export interface PresentationPointerState {
  active: boolean;
  x: number;
  y: number;
  updatedAt?: number;
}

export interface ReceiverPeer {
  socketId: string;
  deviceId?: string;
  deviceName: string;
  platform: DevicePlatform;
  browser: string;
  joinedAt: number;
}

export interface StreamMetadata {
  active: boolean;
  hasAudio: boolean;
  audioMuted?: boolean;
  audioTrackMuted?: boolean;
  audioReason?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  displaySurface?: string;
}

export interface RtcTelemetryStats {
  bitrateKbps: number;
  fps: number;
  width: number;
  height: number;
  rttMs: number | null;
  jitterMs?: number | null;
  packetsLost: number;
  packetsLostDelta?: number;
  candidateType: string | null;
  connectionType?: string | null;
  audioActive?: boolean;
  audioBytes?: number;
  timestamp: number;
}

export interface ConnectionTimings {
  roomAuthMs: number | null;
  socketConnectMs: number | null;
  webrtcConnectMs: number | null;
  firstFrameMs: number | null;
}

export interface BroadcasterPeerState extends ReceiverPeer {
  rtcState: PeerConnectionStatus;
  stats: RtcTelemetryStats | null;
  adaptiveQuality?: AdaptiveQualitySnapshot | null;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type NotificationTone = 'info' | 'success' | 'warning' | 'error';

export interface AppNotification {
  id: string;
  tone: NotificationTone;
  title: string;
  detail?: string;
  timestamp: number;
}

export interface RecentRoomEntry {
  id: string;
  ownerUid: string;
  code: string;
  role: 'broadcaster' | 'receiver';
  hostName: string;
  deviceName: string;
  updatedAt: number;
}
