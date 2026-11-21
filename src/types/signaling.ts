import type {
  DevicePlatform,
  IceServerConfig,
  PresentationPointerState,
  ReceiverPeer,
  RoomSessionAnalytics,
  StreamMetadata,
} from './streaming.ts';

export interface SessionBroadcasterInfo {
  socketId: string;
  deviceId?: string;
  deviceName: string;
  platform: DevicePlatform;
  browser: string;
}

export interface SessionSnapshot {
  roomId: string;
  code: string;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number | null;
  lifetimeMs: number;
  idleTtlMs: number;
  locked: boolean;
  maxReceivers: number;
  totalDevices: number;
  maxTotalDevices: number;
  ownerUid?: string;
  ownerName?: string;
  broadcaster: SessionBroadcasterInfo;
  stream: StreamMetadata;
  receivers: ReceiverPeer[];
}

export interface CreateSessionPayload {
  deviceId?: string;
  deviceName: string;
  platform: DevicePlatform;
  browser: string;
  pin?: string;
  maxReceivers?: number;
  lifetimeMs?: number;
  firebaseToken?: string;
}

export interface CreateSessionAck {
  ok: boolean;
  errorCode?: string;
  session?: SessionSnapshot;
  analytics?: RoomSessionAnalytics;
  pin?: string;
  authToken?: string;
  iceServers?: IceServerConfig[];
  turnAuthorized?: boolean;
  error?: string;
}

export interface JoinSessionPayload {
  code: string;
  pin: string;
  deviceId?: string;
  deviceName: string;
  platform: DevicePlatform;
  browser: string;
  firebaseToken?: string;
}

export interface JoinSessionAck {
  ok: boolean;
  errorCode?: string;
  session?: SessionSnapshot;
  selfSocketId?: string;
  authToken?: string;
  iceServers?: IceServerConfig[];
  turnAuthorized?: boolean;
  error?: string;
}

export interface ResumeSessionPayload {
  authToken: string;
  deviceId?: string;
  deviceName?: string;
}

export interface ResumeSessionAck {
  ok: boolean;
  session?: SessionSnapshot;
  analytics?: RoomSessionAnalytics;
  selfSocketId?: string;
  authToken?: string;
  iceServers?: IceServerConfig[];
  turnAuthorized?: boolean;
  errorCode?: string;
  error?: string;
}

export interface UpdateDeviceNamePayload {
  code: string;
  deviceName: string;
}

export interface UpdateDeviceNameAck {
  ok: boolean;
  deviceName?: string;
  error?: string;
}

export interface ToggleRoomLockPayload {
  code: string;
  locked: boolean;
}

export interface ToggleRoomLockAck {
  ok: boolean;
  locked?: boolean;
  errorCode?: string;
  error?: string;
}

export interface ReportQualitySamplePayload {
  code: string;
  score: 1 | 2 | 3 | 4;
}

export interface GetAnalyticsAck {
  ok: boolean;
  analytics?: RoomSessionAnalytics;
  errorCode?: string;
  error?: string;
}

export interface PresentationPointerEventPayload {
  code: string;
  active: boolean;
  x: number;
  y: number;
}

export interface UpdateStreamPayload {
  code: string;
  stream: StreamMetadata;
}

export interface SessionDescriptionPayload {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidatePayload {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface WebRtcOfferPayload {
  targetSocketId: string;
  sdp: SessionDescriptionPayload;
}

export interface WebRtcAnswerPayload {
  targetSocketId: string;
  sdp: SessionDescriptionPayload;
}

export interface WebRtcIceCandidatePayload {
  targetSocketId: string;
  candidate: IceCandidatePayload;
}

export interface RelayOfferPayload {
  fromSocketId: string;
  sdp: SessionDescriptionPayload;
}

export interface RelayAnswerPayload {
  fromSocketId: string;
  sdp: SessionDescriptionPayload;
}

export interface RelayIceCandidatePayload {
  fromSocketId: string;
  candidate: IceCandidatePayload;
}

export interface ClientToServerEvents {
  'session:create': (
    payload: CreateSessionPayload,
    ack: (response: CreateSessionAck) => void,
  ) => void;
  'session:join': (
    payload: JoinSessionPayload,
    ack: (response: JoinSessionAck) => void,
  ) => void;
  'session:resume': (
    payload: ResumeSessionPayload,
    ack: (response: ResumeSessionAck) => void,
  ) => void;
  'session:update-device-name': (
    payload: UpdateDeviceNamePayload,
    ack?: (response: UpdateDeviceNameAck) => void,
  ) => void;
  'session:toggle-lock': (
    payload: ToggleRoomLockPayload,
    ack?: (response: ToggleRoomLockAck) => void,
  ) => void;
  'session:get-analytics': (
    payload: { code: string },
    ack: (response: GetAnalyticsAck) => void,
  ) => void;
  'session:report-quality': (payload: ReportQualitySamplePayload) => void;
  'session:leave': (payload: { code: string }) => void;
  'session:close': (payload: { code: string }) => void;
  'session:kick-receiver': (payload: { code: string; targetSocketId: string }) => void;
  'session:update-limit': (payload: { code: string; maxReceivers: number }) => void;
  'session:update-lifetime': (payload: { code: string; lifetimeMs: number }) => void;
  'session:update-stream': (payload: UpdateStreamPayload) => void;
  'presentation:pointer': (payload: PresentationPointerEventPayload) => void;
  'room:heartbeat': (payload: { code: string }) => void;
  'webrtc:offer': (payload: WebRtcOfferPayload) => void;
  'webrtc:answer': (payload: WebRtcAnswerPayload) => void;
  'webrtc:ice-candidate': (payload: WebRtcIceCandidatePayload) => void;
  'webrtc:request-offer': (payload: { code: string }) => void;
}

export interface ServerToClientEvents {
  'session:state': (snapshot: SessionSnapshot) => void;
  'session:analytics': (analytics: RoomSessionAnalytics) => void;
  'session:receiver-joined': (payload: { receiver: ReceiverPeer }) => void;
  'session:receiver-left': (payload: { socketId: string }) => void;
  'session:stream-status': (payload: { stream: StreamMetadata }) => void;
  'session:source-stopped': (payload: { code: string; reason: string }) => void;
  'session:source-reconnecting': (payload: {
    code: string;
    graceMs: number;
    reason: string;
  }) => void;
  'session:source-reconnected': (payload: {
    code: string;
    broadcasterSocketId: string;
  }) => void;
  'session:closed': (payload: { reason: string }) => void;
  'session:error': (payload: { code: string; message: string }) => void;
  'presentation:pointer': (payload: PresentationPointerState) => void;
  'webrtc:offer': (payload: RelayOfferPayload) => void;
  'webrtc:answer': (payload: RelayAnswerPayload) => void;
  'webrtc:ice-candidate': (payload: RelayIceCandidatePayload) => void;
  'webrtc:offer-requested': (payload: { fromSocketId: string }) => void;
}
