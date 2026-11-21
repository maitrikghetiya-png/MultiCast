import type {
  AdaptiveQualitySnapshot,
  IceServerConfig,
  PeerConnectionStatus,
  QualityMode,
  RtcTelemetryStats,
  StreamContentHint,
  StreamFrameRate,
  StreamResolutionId,
} from '../../types/streaming.ts';
import { getBrowserConnectionType } from '../../utils/platform.ts';
import type { TypedSocketClient } from '../socket/socketClient.ts';
import {
  createInitialAdaptiveTracker,
  evaluateAdaptiveTransition,
  resolveQualityProfile,
  type AdaptivePeerTracker,
  type ResolvedQualityTarget,
} from './adaptiveQuality.ts';

const FALLBACK_DEV_STUN_SERVERS: IceServerConfig[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

function sanitizeIceServerList(raw: unknown): IceServerConfig[] {
  if (!Array.isArray(raw)) return [];
  const valid: IceServerConfig[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const candidate = item as Record<string, unknown>;
    const urls = candidate.urls;
    const hasValidUrls =
      (typeof urls === 'string' && urls.trim().length > 0) ||
      (Array.isArray(urls) &&
        urls.length > 0 &&
        urls.every((u) => typeof u === 'string' && u.trim().length > 0));
    if (!hasValidUrls) continue;

    const entry: IceServerConfig = {
      urls: typeof urls === 'string' ? urls.trim() : (urls as string[]).map((u) => u.trim()),
    };
    if (typeof candidate.username === 'string' && candidate.username.length > 0) {
      entry.username = candidate.username;
    }
    if (typeof candidate.credential === 'string' && candidate.credential.length > 0) {
      entry.credential = candidate.credential;
    }
    valid.push(entry);
  }
  return valid;
}

export async function fetchIceServers(authToken?: string | null): Promise<IceServerConfig[]> {
  try {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch('/api/ice-config', {
      cache: 'no-store',
      credentials: 'include',
      headers,
    });
    if (response.ok) {
      const data = (await response.json()) as { iceServers?: unknown };
      const parsed = sanitizeIceServerList(data.iceServers);
      if (parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Fall back to public STUN server if runtime ICE endpoint is temporarily unreachable
  }
  return FALLBACK_DEV_STUN_SERVERS;
}

export function buildRtcConfiguration(iceServers: IceServerConfig[]): RTCConfiguration {
  return {
    iceServers,
    iceCandidatePoolSize: 6,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  };
}

function getSdpSessionKey(sdp?: string): string | null {
  if (!sdp) return null;
  const originMatch = sdp.match(/^o=\S+\s+(\S+)/m);
  const fingerprintMatch = sdp.match(/^a=fingerprint:([^\r\n]+)/m);
  if (!originMatch && !fingerprintMatch) return null;
  return `${originMatch?.[1] || ''}:${fingerprintMatch?.[1]?.trim() || ''}`;
}

function applyPreferredVideoCodecs(pc: RTCPeerConnection, contentHint: StreamContentHint): void {
  if (
    typeof RTCRtpReceiver === 'undefined' ||
    typeof RTCRtpReceiver.getCapabilities !== 'function' ||
    typeof pc.getTransceivers !== 'function'
  ) {
    return;
  }

  try {
    const capabilities = RTCRtpReceiver.getCapabilities('video');
    if (!capabilities?.codecs?.length) return;

    const preferredMimeOrder =
      contentHint === 'detail'
        ? ['video/vp9', 'video/h264', 'video/vp8']
        : ['video/h264', 'video/vp9', 'video/vp8'];

    const ranked = [...capabilities.codecs].sort((a, b) => {
      const aMime = a.mimeType.toLowerCase();
      const bMime = b.mimeType.toLowerCase();
      const aRank = preferredMimeOrder.indexOf(aMime);
      const bRank = preferredMimeOrder.indexOf(bMime);
      const aScore = aRank === -1 ? 99 : aRank;
      const bScore = bRank === -1 ? 99 : bRank;
      return aScore - bScore;
    });

    for (const transceiver of pc.getTransceivers()) {
      const kind = transceiver.sender.track?.kind || transceiver.receiver.track?.kind;
      if (kind === 'video' && typeof transceiver.setCodecPreferences === 'function') {
        transceiver.setCodecPreferences(ranked);
      }
    }
  } catch {
    // Ignore if browser restricts codec preference reordering
  }
}

export function evaluatePeerConnectionStatus(pc: RTCPeerConnection): PeerConnectionStatus {
  const conn = pc.connectionState;
  const ice = pc.iceConnectionState;

  if (conn === 'failed' || ice === 'failed' || conn === 'closed' || ice === 'closed') {
    return 'failed';
  }
  if (conn === 'disconnected' || ice === 'disconnected') {
    return 'disconnected';
  }
  if (conn === 'connected' && (ice === 'connected' || ice === 'completed')) {
    return 'connected';
  }
  return 'connecting';
}

interface OutboundPeerEntry {
  pc: RTCPeerConnection;
  pendingCandidates: RTCIceCandidateInit[];
  hasRemoteDescription: boolean;
  prevBytesSent: number;
  prevAudioBytesSent: number;
  prevPacketsLost: number;
  prevTimestamp: number;
  failureNotified: boolean;
  iceRestartAttempts: number;
  disconnectRecoveryTimer: number | null;
  adaptive: AdaptivePeerTracker;
  currentTarget: ResolvedQualityTarget;
}

export interface BroadcasterEncodingConfig {
  qualityMode?: QualityMode;
  resolutionId?: StreamResolutionId;
  frameRate?: StreamFrameRate;
  contentHint?: StreamContentHint;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceFrameRate?: number;
}

export interface BroadcasterManagerCallbacks {
  onPeerStateChange: (receiverSocketId: string, status: PeerConnectionStatus) => void;
  onPeerStats: (receiverSocketId: string, stats: RtcTelemetryStats) => void;
  onPeerAdaptiveQuality?: (
    receiverSocketId: string,
    quality: AdaptiveQualitySnapshot,
  ) => void;
  onPeerError?: (receiverSocketId: string, message: string) => void;
  onPeerIceRestart?: (receiverSocketId: string, attempt: number) => void;
}

export class BroadcasterWebRtcManager {
  private socket: TypedSocketClient;
  private callbacks: BroadcasterManagerCallbacks;
  private peers: Map<string, OutboundPeerEntry> = new Map();
  private peerEpochs: Map<string, number> = new Map();
  private localStream: MediaStream | null = null;
  private qualityMode: QualityMode = 'auto';
  private baseResolutionId: StreamResolutionId = '1080p';
  private targetFrameRate: StreamFrameRate = 60;
  private contentHint: StreamContentHint = 'detail';
  private sourceWidth?: number;
  private sourceHeight?: number;
  private sourceFrameRate?: number;
  private authToken: string | null = null;
  private cachedIceServers: IceServerConfig[] | null = null;
  private statsIntervalId: number | null = null;

  constructor(socket: TypedSocketClient, callbacks: BroadcasterManagerCallbacks) {
    this.socket = socket;
    this.callbacks = callbacks;
  }

  private getSourceDimensionsFromStream(): {
    width?: number;
    height?: number;
    frameRate?: number;
  } {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
      return {
        width: this.sourceWidth,
        height: this.sourceHeight,
        frameRate: this.sourceFrameRate,
      };
    }
    const settings = track.getSettings();
    return {
      width: settings.width || this.sourceWidth,
      height: settings.height || this.sourceHeight,
      frameRate: settings.frameRate
        ? Math.round(settings.frameRate)
        : this.sourceFrameRate,
    };
  }

  private buildTargetForTracker(
    tracker: AdaptivePeerTracker,
  ): ResolvedQualityTarget {
    const sourceDims = this.getSourceDimensionsFromStream();
    return resolveQualityProfile({
      mode: this.qualityMode,
      level: tracker.level,
      contentHint: this.contentHint,
      baseResolutionId: this.baseResolutionId,
      baseFrameRate: this.targetFrameRate,
      sourceWidth: sourceDims.width,
      sourceHeight: sourceDims.height,
      sourceFrameRate: sourceDims.frameRate,
      reason: tracker.lastReason,
    });
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  public setIceServers(servers?: IceServerConfig[] | null): void {
    const valid = sanitizeIceServerList(servers);
    this.cachedIceServers = valid.length > 0 ? valid : null;
  }

  private async resolveIceServers(): Promise<IceServerConfig[]> {
    if (this.cachedIceServers && this.cachedIceServers.length > 0) {
      return this.cachedIceServers;
    }
    const fetched = await fetchIceServers(this.authToken);
    this.cachedIceServers = fetched;
    return fetched;
  }

  private bumpEpoch(receiverSocketId: string): number {
    const next = (this.peerEpochs.get(receiverSocketId) || 0) + 1;
    this.peerEpochs.set(receiverSocketId, next);
    return next;
  }

  private isCurrentEpoch(receiverSocketId: string, epoch: number): boolean {
    return this.peerEpochs.get(receiverSocketId) === epoch;
  }

  public setLocalStream(stream: MediaStream | null, _maxBitrateBps?: number): void {
    this.localStream = stream;
    if (stream) {
      const settings = stream.getVideoTracks()[0]?.getSettings();
      this.sourceWidth = settings?.width;
      this.sourceHeight = settings?.height;
      this.sourceFrameRate = settings?.frameRate
        ? Math.round(settings.frameRate)
        : undefined;
    } else {
      this.sourceWidth = undefined;
      this.sourceHeight = undefined;
      this.sourceFrameRate = undefined;
    }
  }

  public async setEncodingConfig(config: BroadcasterEncodingConfig): Promise<void> {
    const modeChanged =
      config.qualityMode !== undefined && config.qualityMode !== this.qualityMode;

    if (config.qualityMode !== undefined) {
      this.qualityMode = config.qualityMode;
    }
    if (config.resolutionId !== undefined) {
      this.baseResolutionId = config.resolutionId;
    }
    if (config.frameRate !== undefined) {
      this.targetFrameRate = config.frameRate;
    }
    if (config.contentHint !== undefined) {
      this.contentHint = config.contentHint;
    }
    if (config.sourceWidth !== undefined) {
      this.sourceWidth = config.sourceWidth;
    }
    if (config.sourceHeight !== undefined) {
      this.sourceHeight = config.sourceHeight;
    }
    if (config.sourceFrameRate !== undefined) {
      this.sourceFrameRate = config.sourceFrameRate;
    }

    const now = Date.now();
    for (const [receiverId, entry] of this.peers.entries()) {
      if (modeChanged) {
        entry.adaptive = createInitialAdaptiveTracker(now);
      }
      const nextTarget = this.buildTargetForTracker(entry.adaptive);
      entry.currentTarget = nextTarget;
      await this.applySenderParameters(entry.pc, nextTarget);
      this.callbacks.onPeerAdaptiveQuality?.(receiverId, nextTarget);
    }
  }

  public async setMaxBitrate(_maxBitrateBps: number): Promise<void> {
    await this.setEncodingConfig({});
  }

  public async connectToReceiver(receiverSocketId: string): Promise<void> {
    const stream = this.localStream;
    if (!stream) {
      this.callbacks.onPeerStateChange(receiverSocketId, 'waiting-stream');
      return;
    }

    const epoch = this.bumpEpoch(receiverSocketId);
    this.teardownPeerConnection(receiverSocketId);

    const iceServers = await this.resolveIceServers();
    if (!this.isCurrentEpoch(receiverSocketId, epoch) || this.localStream !== stream) {
      return;
    }

    const pc = new RTCPeerConnection(buildRtcConfiguration(iceServers));
    const tracker = createInitialAdaptiveTracker(Date.now());
    const initialTarget = this.buildTargetForTracker(tracker);
    const entry: OutboundPeerEntry = {
      pc,
      pendingCandidates: [],
      hasRemoteDescription: false,
      prevBytesSent: 0,
      prevAudioBytesSent: 0,
      prevPacketsLost: 0,
      prevTimestamp: 0,
      failureNotified: false,
      iceRestartAttempts: 0,
      disconnectRecoveryTimer: null,
      adaptive: tracker,
      currentTarget: initialTarget,
    };
    this.peers.set(receiverSocketId, entry);
    this.callbacks.onPeerStateChange(receiverSocketId, 'negotiating');
    this.callbacks.onPeerAdaptiveQuality?.(receiverSocketId, initialTarget);

    // Separate video and audio track addition so each media line negotiates cleanly
    const liveVideoTrack = stream.getVideoTracks().find((t) => t.readyState === 'live');
    if (liveVideoTrack) {
      pc.addTrack(liveVideoTrack, stream);
    }
    const liveAudioTrack = stream.getAudioTracks().find((t) => t.readyState === 'live');
    if (liveAudioTrack) {
      pc.addTrack(liveAudioTrack, stream);
    }

    applyPreferredVideoCodecs(pc, this.contentHint);
    await this.applySenderParameters(pc, initialTarget);

    const clearRecoveryTimer = () => {
      if (entry.disconnectRecoveryTimer !== null) {
        window.clearTimeout(entry.disconnectRecoveryTimer);
        entry.disconnectRecoveryTimer = null;
      }
    };

    const scheduleIceRecovery = (immediate: boolean) => {
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) return;
      if (entry.iceRestartAttempts >= 2) {
        return;
      }
      if (immediate) {
        clearRecoveryTimer();
        void this.restartIceForPeer(receiverSocketId);
        return;
      }
      if (entry.disconnectRecoveryTimer !== null) return;
      entry.disconnectRecoveryTimer = window.setTimeout(() => {
        entry.disconnectRecoveryTimer = null;
        if (!this.isCurrentEpoch(receiverSocketId, epoch)) return;
        const currentStatus = evaluatePeerConnectionStatus(pc);
        if (currentStatus === 'disconnected' || currentStatus === 'failed') {
          void this.restartIceForPeer(receiverSocketId);
        }
      }, 3500);
    };

    const syncState = () => {
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) return;
      const status = evaluatePeerConnectionStatus(pc);
      this.callbacks.onPeerStateChange(receiverSocketId, status);

      if (status === 'connected') {
        clearRecoveryTimer();
        entry.iceRestartAttempts = 0;
        entry.failureNotified = false;
      } else if (status === 'disconnected') {
        if (this.socket.connected && this.localStream) {
          scheduleIceRecovery(false);
        }
      } else if (status === 'failed') {
        if (entry.iceRestartAttempts < 2 && this.socket.connected && this.localStream) {
          scheduleIceRecovery(true);
          return;
        }
        clearRecoveryTimer();
        if (!entry.failureNotified) {
          entry.failureNotified = true;
          this.callbacks.onPeerError?.(
            receiverSocketId,
            'WebRTC ICE/DTLS connection to receiver failed. Check Wi-Fi firewall rules or configure a TURN server.',
          );
        }
      }
    };

    let offerSent = false;
    const queuedLocalCandidates: RTCIceCandidateInit[] = [];

    pc.onicecandidate = (event) => {
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) return;
      if (event.candidate) {
        const serialized = event.candidate.toJSON();
        if (!offerSent) {
          queuedLocalCandidates.push(serialized);
          return;
        }
        this.socket.emit('webrtc:ice-candidate', {
          targetSocketId: receiverSocketId,
          candidate: serialized,
        });
      }
    };

    pc.onconnectionstatechange = syncState;
    pc.oniceconnectionstatechange = syncState;

    try {
      const offer = await pc.createOffer();
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) {
        this.disposeRawPeer(pc);
        return;
      }

      await pc.setLocalDescription(offer);
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) {
        this.disposeRawPeer(pc);
        return;
      }

      if (pc.localDescription) {
        this.socket.emit('webrtc:offer', {
          targetSocketId: receiverSocketId,
          sdp: pc.localDescription.toJSON(),
        });
        offerSent = true;
        for (const candidate of queuedLocalCandidates) {
          this.socket.emit('webrtc:ice-candidate', {
            targetSocketId: receiverSocketId,
            candidate,
          });
        }
        queuedLocalCandidates.length = 0;
      }

      this.ensureStatsPolling();
    } catch (err) {
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) return;
      this.callbacks.onPeerStateChange(receiverSocketId, 'failed');
      this.callbacks.onPeerError?.(
        receiverSocketId,
        err instanceof Error
          ? `Failed to create WebRTC offer: ${err.message}`
          : 'Failed to create WebRTC offer for receiver.',
      );
      this.teardownPeerConnection(receiverSocketId);
    }
  }

  public async restartIceForPeer(receiverSocketId: string): Promise<void> {
    const entry = this.peers.get(receiverSocketId);
    if (
      !entry ||
      !this.localStream ||
      !this.socket.connected ||
      entry.pc.signalingState === 'closed' ||
      entry.pc.signalingState !== 'stable'
    ) {
      await this.connectToReceiver(receiverSocketId);
      return;
    }

    const epoch = this.peerEpochs.get(receiverSocketId) || 0;
    entry.iceRestartAttempts += 1;
    this.callbacks.onPeerStateChange(receiverSocketId, 'reconnecting');
    this.callbacks.onPeerIceRestart?.(receiverSocketId, entry.iceRestartAttempts);

    try {
      if (typeof entry.pc.restartIce === 'function') {
        entry.pc.restartIce();
      }
      const offer = await entry.pc.createOffer({ iceRestart: true });
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) return;
      entry.hasRemoteDescription = false;
      await entry.pc.setLocalDescription(offer);
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) return;

      if (entry.pc.localDescription) {
        this.socket.emit('webrtc:offer', {
          targetSocketId: receiverSocketId,
          sdp: entry.pc.localDescription.toJSON(),
        });
      }
    } catch {
      if (!this.isCurrentEpoch(receiverSocketId, epoch)) return;
      await this.connectToReceiver(receiverSocketId);
    }
  }

  public async recoverReceiversAfterSignalingReconnect(
    receiverSocketIds: string[],
  ): Promise<void> {
    if (!this.localStream) return;
    for (const id of receiverSocketIds) {
      const entry = this.peers.get(id);
      if (!entry) {
        await this.connectToReceiver(id);
        continue;
      }
      const status = evaluatePeerConnectionStatus(entry.pc);
      if (status !== 'connected') {
        entry.iceRestartAttempts = 0;
        await this.restartIceForPeer(id);
      }
    }
  }

  public async replaceActiveStreamTracks(
    newStream: MediaStream,
    _maxBitrateBps?: number,
  ): Promise<void> {
    this.setLocalStream(newStream);

    const newVideoTrack = newStream.getVideoTracks().find((t) => t.readyState === 'live') || null;
    const newAudioTrack = newStream.getAudioTracks().find((t) => t.readyState === 'live') || null;

    const peerEntries = Array.from(this.peers.entries());
    for (const [receiverId, entry] of peerEntries) {
      const senders = entry.pc.getSenders();
      const transceivers =
        typeof entry.pc.getTransceivers === 'function' ? entry.pc.getTransceivers() : [];
      const videoSender =
        senders.find((s) => s.track?.kind === 'video') ||
        transceivers.find((t) => t.receiver.track?.kind === 'video')?.sender;
      const audioSender =
        senders.find((s) => s.track?.kind === 'audio') ||
        transceivers.find((t) => t.receiver.track?.kind === 'audio')?.sender;

      try {
        if (videoSender && newVideoTrack) {
          await videoSender.replaceTrack(newVideoTrack);
          const nextTarget = this.buildTargetForTracker(entry.adaptive);
          entry.currentTarget = nextTarget;
          await this.applySenderParameters(entry.pc, nextTarget);
          this.callbacks.onPeerAdaptiveQuality?.(receiverId, nextTarget);
        } else {
          await this.connectToReceiver(receiverId);
          continue;
        }

        if (audioSender && newAudioTrack) {
          await audioSender.replaceTrack(newAudioTrack);
        } else if (audioSender && !newAudioTrack) {
          await audioSender.replaceTrack(null);
        } else if (!audioSender && newAudioTrack) {
          // Renegotiate cleanly when an audio track becomes available mid-cast
          await this.connectToReceiver(receiverId);
        }
      } catch {
        await this.connectToReceiver(receiverId);
      }
    }
  }

  public async handleAnswer(
    fromSocketId: string,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    const entry = this.peers.get(fromSocketId);
    if (!entry) return;
    if (entry.pc.signalingState !== 'have-local-offer') {
      return;
    }

    try {
      await entry.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      entry.hasRemoteDescription = true;
      const nextTarget = this.buildTargetForTracker(entry.adaptive);
      entry.currentTarget = nextTarget;
      await this.applySenderParameters(entry.pc, nextTarget);
      this.callbacks.onPeerAdaptiveQuality?.(fromSocketId, nextTarget);

      for (const candidate of entry.pendingCandidates) {
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Ignore stale queued candidates
        }
      }
      entry.pendingCandidates = [];
    } catch (err) {
      this.callbacks.onPeerStateChange(fromSocketId, 'failed');
      this.callbacks.onPeerError?.(
        fromSocketId,
        err instanceof Error
          ? `Failed to apply receiver WebRTC answer: ${err.message}`
          : 'Failed to apply receiver WebRTC answer.',
      );
    }
  }

  public async handleIceCandidate(
    fromSocketId: string,
    candidate: RTCIceCandidateInit,
  ): Promise<void> {
    const entry = this.peers.get(fromSocketId);
    if (!entry) return;

    if (!entry.hasRemoteDescription) {
      entry.pendingCandidates.push(candidate);
      return;
    }

    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore stale ICE candidates from superseded offers
    }
  }

  public closePeer(receiverSocketId: string): void {
    this.bumpEpoch(receiverSocketId);
    this.teardownPeerConnection(receiverSocketId);
  }

  public closeAllPeers(): void {
    for (const receiverId of Array.from(this.peerEpochs.keys())) {
      this.bumpEpoch(receiverId);
    }
    for (const receiverId of Array.from(this.peers.keys())) {
      this.teardownPeerConnection(receiverId);
    }
  }

  private disposeRawPeer(pc: RTCPeerConnection): void {
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    try {
      for (const sender of pc.getSenders()) {
        pc.removeTrack(sender);
      }
    } catch {
      // Ignore if peer is already closed
    }
    try {
      pc.close();
    } catch {
      // Ignore if already closed
    }
  }

  private teardownPeerConnection(receiverSocketId: string): void {
    const entry = this.peers.get(receiverSocketId);
    if (entry) {
      if (entry.disconnectRecoveryTimer !== null) {
        window.clearTimeout(entry.disconnectRecoveryTimer);
        entry.disconnectRecoveryTimer = null;
      }
      this.disposeRawPeer(entry.pc);
      entry.pendingCandidates = [];
      this.peers.delete(receiverSocketId);
    }
    if (this.peers.size === 0 && this.statsIntervalId !== null) {
      window.clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
  }

  private async applySenderParameters(
    pc: RTCPeerConnection,
    target: ResolvedQualityTarget,
  ): Promise<void> {
    const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (!videoSender) return;

    try {
      const params = videoSender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.degradationPreference = target.degradationPreference;
      params.encodings[0].maxBitrate = target.targetBitrateBps;
      params.encodings[0].scaleResolutionDownBy = target.scaleResolutionDownBy;
      params.encodings[0].maxFramerate = target.maxFramerate;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';
      await videoSender.setParameters(params);
    } catch {
      try {
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = target.targetBitrateBps;
        params.encodings[0].scaleResolutionDownBy = target.scaleResolutionDownBy;
        await videoSender.setParameters(params);
      } catch {
        // Ignore if negotiation is still pending
      }
    }
  }

  private ensureStatsPolling(): void {
    if (this.statsIntervalId !== null) return;
    this.statsIntervalId = window.setInterval(() => {
      void this.collectAllPeerStats();
    }, 1000);
  }

  private async collectAllPeerStats(): Promise<void> {
    for (const [receiverId, entry] of this.peers.entries()) {
      if (entry.pc.connectionState !== 'connected') continue;
      try {
        const report = await entry.pc.getStats();
        let bytesSent = 0;
        let audioBytesSent = 0;
        let timestamp = 0;
        let fps = 0;
        let width = 0;
        let height = 0;
        let rttMs: number | null = null;
        let jitterMs: number | null = null;
        let packetsLost = 0;
        let candidateType: string | null = null;

        let activeCandidatePairId: string | null = null;
        const localCandidates = new Map<string, string>();

        report.forEach((stat) => {
          if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
            bytesSent = stat.bytesSent || 0;
            timestamp = stat.timestamp || Date.now();
            fps = Math.round(stat.framesPerSecond || 0);
            width = stat.frameWidth || 0;
            height = stat.frameHeight || 0;
          } else if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
            audioBytesSent = stat.bytesSent || 0;
            if (!timestamp) {
              timestamp = stat.timestamp || Date.now();
            }
          } else if (
            stat.type === 'remote-inbound-rtp' &&
            (stat.kind === 'video' || stat.mediaType === 'video')
          ) {
            if (typeof stat.packetsLost === 'number') {
              packetsLost = Math.max(0, stat.packetsLost);
            }
            if (typeof stat.jitter === 'number') {
              jitterMs = Math.round(stat.jitter * 1000 * 10) / 10;
            }
            if (rttMs === null && typeof stat.roundTripTime === 'number') {
              rttMs = Math.round(stat.roundTripTime * 1000);
            }
          } else if (stat.type === 'candidate-pair' && stat.nominated) {
            if (typeof stat.currentRoundTripTime === 'number') {
              rttMs = Math.round(stat.currentRoundTripTime * 1000);
            }
            activeCandidatePairId = stat.localCandidateId || null;
          } else if (stat.type === 'local-candidate') {
            localCandidates.set(stat.id, stat.candidateType || '');
          }
        });

        if (activeCandidatePairId && localCandidates.has(activeCandidatePairId)) {
          candidateType = localCandidates.get(activeCandidatePairId) || null;
        }

        let bitrateKbps = 0;
        let packetsLostDelta = 0;
        if (entry.prevTimestamp > 0 && timestamp > entry.prevTimestamp) {
          const deltaBytes = Math.max(0, bytesSent - entry.prevBytesSent);
          const deltaSec = (timestamp - entry.prevTimestamp) / 1000;
          bitrateKbps = Math.round((deltaBytes * 8) / deltaSec / 1000);
          packetsLostDelta = Math.max(0, packetsLost - entry.prevPacketsLost);
        }
        const audioActive = audioBytesSent > entry.prevAudioBytesSent;
        entry.prevBytesSent = bytesSent;
        entry.prevAudioBytesSent = audioBytesSent;
        entry.prevPacketsLost = packetsLost;
        entry.prevTimestamp = timestamp;

        const now = Date.now();
        if (this.qualityMode === 'auto') {
          const transition = evaluateAdaptiveTransition(entry.adaptive, {
            rttMs,
            packetsLostDelta,
            jitterMs,
            now,
          });
          entry.adaptive = transition.nextState;
          if (transition.changed) {
            const adaptedTarget = this.buildTargetForTracker(entry.adaptive);
            entry.currentTarget = adaptedTarget;
            void this.applySenderParameters(entry.pc, adaptedTarget);
            this.callbacks.onPeerAdaptiveQuality?.(receiverId, adaptedTarget);
          }
        }

        this.callbacks.onPeerStats(receiverId, {
          bitrateKbps,
          fps,
          width,
          height,
          rttMs,
          jitterMs,
          packetsLost,
          packetsLostDelta,
          candidateType,
          connectionType: getBrowserConnectionType(),
          audioActive,
          audioBytes: audioBytesSent,
          timestamp,
        });
      } catch {
        // Ignore transient stats errors on closing peer connections
      }
    }
  }
}

export interface ReceiverManagerCallbacks {
  onStatusChange: (status: PeerConnectionStatus) => void;
  onRemoteStream: (stream: MediaStream | null, revision: number) => void;
  onStats: (stats: RtcTelemetryStats | null) => void;
  onError?: (message: string) => void;
  onRecoveryNeeded?: () => void;
  onWebRtcConnected?: (elapsedMs: number) => void;
}

export class ReceiverWebRtcManager {
  private socket: TypedSocketClient;
  private callbacks: ReceiverManagerCallbacks;
  private pc: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private trackedRemoteTracks: Map<MediaStreamTrack, () => void> = new Map();
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private hasRemoteDescription = false;
  private broadcasterSocketId: string | null = null;
  private authToken: string | null = null;
  private cachedIceServers: IceServerConfig[] | null = null;
  private lastRemoteSessionKey: string | null = null;
  private statsIntervalId: number | null = null;
  private recoveryTimerId: number | null = null;
  private recoveryAttempts = 0;
  private prevBytesReceived = 0;
  private prevAudioBytesReceived = 0;
  private prevPacketsLost = 0;
  private prevTimestamp = 0;
  private negotiationEpoch = 0;
  private negotiationStartedAt = 0;
  private connectedTimingReported = false;
  private streamRevision = 0;
  private failureNotified = false;

  constructor(socket: TypedSocketClient, callbacks: ReceiverManagerCallbacks) {
    this.socket = socket;
    this.callbacks = callbacks;
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  public setIceServers(servers?: IceServerConfig[] | null): void {
    const valid = sanitizeIceServerList(servers);
    this.cachedIceServers = valid.length > 0 ? valid : null;
  }

  private async resolveIceServers(): Promise<IceServerConfig[]> {
    if (this.cachedIceServers && this.cachedIceServers.length > 0) {
      return this.cachedIceServers;
    }
    const fetched = await fetchIceServers(this.authToken);
    this.cachedIceServers = fetched;
    return fetched;
  }

  public updateBroadcasterSocketId(nextSocketId: string): void {
    if (nextSocketId) {
      this.broadcasterSocketId = nextSocketId;
    }
  }

  private bindRemoteTrack(track: MediaStreamTrack, epoch: number): void {
    if (this.trackedRemoteTracks.has(track)) return;
    const notifyTrackChange = () => {
      if (epoch !== this.negotiationEpoch || !this.remoteStream) return;
      this.streamRevision += 1;
      this.callbacks.onRemoteStream(this.remoteStream, this.streamRevision);
    };

    track.addEventListener('mute', notifyTrackChange);
    track.addEventListener('unmute', notifyTrackChange);
    track.addEventListener('ended', notifyTrackChange);
    this.trackedRemoteTracks.set(track, () => {
      track.removeEventListener('mute', notifyTrackChange);
      track.removeEventListener('unmute', notifyTrackChange);
      track.removeEventListener('ended', notifyTrackChange);
    });
  }

  private clearTrackedRemoteTracks(): void {
    for (const cleanup of this.trackedRemoteTracks.values()) {
      cleanup();
    }
    this.trackedRemoteTracks.clear();
  }

  public async handleOffer(
    fromSocketId: string,
    sdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    const epoch = ++this.negotiationEpoch;
    const incomingSessionKey = getSdpSessionKey(sdp.sdp);
    const canReuseExistingPc = Boolean(
      this.pc &&
        this.broadcasterSocketId === fromSocketId &&
        this.pc.signalingState !== 'closed' &&
        this.pc.connectionState !== 'closed' &&
        this.pc.connectionState !== 'failed' &&
        incomingSessionKey !== null &&
        incomingSessionKey === this.lastRemoteSessionKey,
    );

    if (canReuseExistingPc && this.pc) {
      const pc = this.pc;
      this.hasRemoteDescription = false;
      this.failureNotified = false;
      this.callbacks.onStatusChange('negotiating');

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        if (epoch !== this.negotiationEpoch) return;
        this.hasRemoteDescription = true;

        for (const candidate of this.pendingCandidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {
            // Ignore stale queued ICE candidates
          }
        }
        this.pendingCandidates = [];

        const answer = await pc.createAnswer();
        if (epoch !== this.negotiationEpoch) return;

        await pc.setLocalDescription(answer);
        if (epoch !== this.negotiationEpoch) return;

        if (pc.localDescription) {
          this.socket.emit('webrtc:answer', {
            targetSocketId: fromSocketId,
            sdp: pc.localDescription.toJSON(),
          });
        }
        return;
      } catch {
        // Fall through to full peer recreation if in-place renegotiation failed
      }
    }

    this.teardownConnection();

    this.broadcasterSocketId = fromSocketId;
    this.lastRemoteSessionKey = incomingSessionKey;
    this.failureNotified = false;
    this.negotiationStartedAt = performance.now();
    this.connectedTimingReported = false;
    this.callbacks.onStatusChange('negotiating');

    const iceServers = await this.resolveIceServers();
    if (epoch !== this.negotiationEpoch) {
      return;
    }

    const pc = new RTCPeerConnection(buildRtcConfiguration(iceServers));
    this.pc = pc;
    this.remoteStream = new MediaStream();
    this.hasRemoteDescription = false;

    this.callbacks.onStatusChange('connecting');

    pc.ontrack = (event) => {
      if (epoch !== this.negotiationEpoch) return;
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
      }

      const incomingStream = event.streams?.[0];
      if (incomingStream) {
        for (const t of incomingStream.getTracks()) {
          if (!this.remoteStream.getTracks().some((existing) => existing.id === t.id)) {
            this.remoteStream.addTrack(t);
          }
          this.bindRemoteTrack(t, epoch);
        }
      }

      if (!this.remoteStream.getTracks().some((existing) => existing.id === event.track.id)) {
        this.remoteStream.addTrack(event.track);
      }
      this.bindRemoteTrack(event.track, epoch);

      this.streamRevision += 1;
      this.callbacks.onRemoteStream(this.remoteStream, this.streamRevision);
    };

    pc.onicecandidate = (event) => {
      if (epoch !== this.negotiationEpoch) return;
      if (event.candidate && this.broadcasterSocketId) {
        this.socket.emit('webrtc:ice-candidate', {
          targetSocketId: this.broadcasterSocketId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    const clearRecoveryTimer = () => {
      if (this.recoveryTimerId !== null) {
        window.clearTimeout(this.recoveryTimerId);
        this.recoveryTimerId = null;
      }
    };

    const syncState = () => {
      if (epoch !== this.negotiationEpoch) return;
      const status = evaluatePeerConnectionStatus(pc);
      this.callbacks.onStatusChange(status);

      if (status === 'connected') {
        clearRecoveryTimer();
        this.recoveryAttempts = 0;
        this.failureNotified = false;
        if (!this.connectedTimingReported) {
          this.connectedTimingReported = true;
          const elapsed = Math.max(1, Math.round(performance.now() - this.negotiationStartedAt));
          this.callbacks.onWebRtcConnected?.(elapsed);
        }
        this.startStatsPolling();
      } else if (status === 'failed') {
        this.stopStatsPolling();
        clearRecoveryTimer();
        if (this.recoveryAttempts < 2 && this.socket.connected) {
          this.recoveryAttempts += 1;
          this.callbacks.onStatusChange('reconnecting');
          this.callbacks.onRecoveryNeeded?.();
          return;
        }
        if (!this.failureNotified) {
          this.failureNotified = true;
          this.callbacks.onError?.(
            'WebRTC peer connection failed (ICE negotiation could not establish a path). Click Retry Handshake or verify TURN/firewall configuration.',
          );
        }
      } else if (status === 'disconnected') {
        this.stopStatsPolling();
        if (this.recoveryTimerId === null && this.recoveryAttempts < 2 && this.socket.connected) {
          this.callbacks.onStatusChange('reconnecting');
          this.recoveryTimerId = window.setTimeout(() => {
            this.recoveryTimerId = null;
            if (epoch !== this.negotiationEpoch) return;
            const latestStatus = evaluatePeerConnectionStatus(pc);
            if (latestStatus === 'disconnected' || latestStatus === 'failed') {
              this.recoveryAttempts += 1;
              this.callbacks.onRecoveryNeeded?.();
            }
          }, 4000);
        }
      }
    };

    pc.onconnectionstatechange = syncState;
    pc.oniceconnectionstatechange = syncState;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      if (epoch !== this.negotiationEpoch) return;
      this.hasRemoteDescription = true;

      for (const candidate of this.pendingCandidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Ignore stale queued ICE candidates
        }
      }
      this.pendingCandidates = [];

      const answer = await pc.createAnswer();
      if (epoch !== this.negotiationEpoch) return;

      await pc.setLocalDescription(answer);
      if (epoch !== this.negotiationEpoch) return;

      if (pc.localDescription) {
        this.socket.emit('webrtc:answer', {
          targetSocketId: fromSocketId,
          sdp: pc.localDescription.toJSON(),
        });
      }
    } catch (err) {
      if (epoch !== this.negotiationEpoch) return;
      this.teardownConnection();
      this.callbacks.onStatusChange('failed');
      this.callbacks.onError?.(
        err instanceof Error
          ? `WebRTC SDP negotiation failed: ${err.message}`
          : 'WebRTC SDP negotiation failed.',
      );
    }
  }

  public async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc || !this.hasRemoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore stale ICE candidates
    }
  }

  public close(): void {
    this.negotiationEpoch += 1;
    this.recoveryAttempts = 0;
    this.teardownConnection();
  }

  private teardownConnection(): void {
    this.stopStatsPolling();
    if (this.recoveryTimerId !== null) {
      window.clearTimeout(this.recoveryTimerId);
      this.recoveryTimerId = null;
    }
    this.clearTrackedRemoteTracks();
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      try {
        this.pc.close();
      } catch {
        // Ignore already-closed peer
      }
      this.pc = null;
    }
    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      }
      this.remoteStream = null;
    }
    this.pendingCandidates = [];
    this.hasRemoteDescription = false;
    this.broadcasterSocketId = null;
    this.lastRemoteSessionKey = null;
    this.streamRevision += 1;
    this.callbacks.onRemoteStream(null, this.streamRevision);
    this.callbacks.onStats(null);
  }

  private startStatsPolling(): void {
    this.stopStatsPolling();
    this.prevBytesReceived = 0;
    this.prevAudioBytesReceived = 0;
    this.prevPacketsLost = 0;
    this.prevTimestamp = 0;
    // Collect an immediate baseline sample right away, then poll every 1s
    void this.collectStats();
    this.statsIntervalId = window.setInterval(() => {
      void this.collectStats();
    }, 1000);
  }

  private stopStatsPolling(): void {
    if (this.statsIntervalId !== null) {
      window.clearInterval(this.statsIntervalId);
      this.statsIntervalId = null;
    }
  }

  private async collectStats(): Promise<void> {
    if (!this.pc || this.pc.connectionState !== 'connected') return;
    try {
      const report = await this.pc.getStats();
      let bytesReceived = 0;
      let audioBytesReceived = 0;
      let timestamp = 0;
      let fps = 0;
      let width = 0;
      let height = 0;
      let packetsLost = 0;
      let jitterMs: number | null = null;
      let rttMs: number | null = null;
      let candidateType: string | null = null;

      let localCandidateId: string | null = null;
      const localCandidates = new Map<string, string>();

      report.forEach((stat) => {
        if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
          bytesReceived = stat.bytesReceived || 0;
          timestamp = stat.timestamp || Date.now();
          fps = Math.round(stat.framesPerSecond || 0);
          width = stat.frameWidth || 0;
          height = stat.frameHeight || 0;
          packetsLost = Math.max(0, stat.packetsLost || 0);
          if (typeof stat.jitter === 'number') {
            jitterMs = Math.round(stat.jitter * 1000 * 10) / 10;
          }
        } else if (stat.type === 'inbound-rtp' && stat.kind === 'audio') {
          audioBytesReceived = stat.bytesReceived || 0;
          if (!timestamp) {
            timestamp = stat.timestamp || Date.now();
          }
        } else if (stat.type === 'candidate-pair' && stat.nominated) {
          if (typeof stat.currentRoundTripTime === 'number') {
            rttMs = Math.round(stat.currentRoundTripTime * 1000);
          }
          localCandidateId = stat.localCandidateId || null;
        } else if (stat.type === 'local-candidate') {
          localCandidates.set(stat.id, stat.candidateType || '');
        }
      });

      if (localCandidateId && localCandidates.has(localCandidateId)) {
        candidateType = localCandidates.get(localCandidateId) || null;
      }

      let bitrateKbps = 0;
      let packetsLostDelta = 0;
      if (this.prevTimestamp > 0 && timestamp > this.prevTimestamp) {
        const deltaBytes = Math.max(0, bytesReceived - this.prevBytesReceived);
        const deltaSec = (timestamp - this.prevTimestamp) / 1000;
        bitrateKbps = Math.round((deltaBytes * 8) / deltaSec / 1000);
        packetsLostDelta = Math.max(0, packetsLost - this.prevPacketsLost);
      }
      const audioActive = audioBytesReceived > this.prevAudioBytesReceived;
      this.prevBytesReceived = bytesReceived;
      this.prevAudioBytesReceived = audioBytesReceived;
      this.prevPacketsLost = packetsLost;
      this.prevTimestamp = timestamp;

      this.callbacks.onStats({
        bitrateKbps,
        fps,
        width,
        height,
        rttMs,
        jitterMs,
        packetsLost,
        packetsLostDelta,
        candidateType,
        connectionType: getBrowserConnectionType(),
        audioActive,
        audioBytes: audioBytesReceived,
        timestamp,
      });
    } catch {
      // Ignore transient stats errors
    }
  }
}
