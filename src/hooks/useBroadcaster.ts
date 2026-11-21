import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import type { SignalingConnectionState } from '../services/socket/socketClient.ts';
import { resolveQualityProfile } from '../services/streaming/adaptiveQuality.ts';
import { resolveAudioStatusSnapshot } from '../services/streaming/audioState.ts';
import {
  applyVideoTrackConstraints,
  attachStreamLifecycleListeners,
  captureScreenStream,
  computeDefaultCapturePreset,
  extractStreamMetadata,
  formatDisplaySurface,
  getAudioSharingSupport,
  getScreenCaptureSupport,
  ScreenCaptureError,
  setStreamAudioEnabled,
  stopMediaStream,
  type AudioSharingSupport,
  type ScreenCaptureSupport,
} from '../services/streaming/mediaCaptureService.ts';
import type { SessionSnapshot } from '../types/signaling.ts';
import {
  computeTargetBitrateBps,
  STREAM_RESOLUTION_OPTIONS,
  type AdaptiveQualitySnapshot,
  type AudioConnectionState,
  type BroadcasterPeerState,
  type DisplaySurfacePreference,
  type QualityMode,
  type ReceiverPeer,
  type RoomSessionAnalytics,
  type ScreenCaptureStatus,
  type StreamContentHint,
  type StreamFrameRate,
  type StreamMetadata,
  type StreamResolutionId,
} from '../types/streaming.ts';
import {
  detectBrowserName,
  detectDevicePlatform,
  getBrowserConnectionType,
  getDefaultDeviceName,
  getOrCreateClientDeviceId,
} from '../utils/platform.ts';
import type { NotifyOptions } from './useNotifications.ts';
import { useRoomHeartbeat, useSocketConnection } from './useSocketConnection.ts';
import { useBroadcasterWebRtc } from './useWebRtcPeers.ts';

export interface UseBroadcasterReturn {
  deviceName: string;
  setDeviceName: (name: string) => void;
  commitDeviceName: (nextName?: string) => Promise<boolean>;
  customPin: string;
  setCustomPin: (pin: string) => void;
  maxReceivers: number;
  serverMaxReceivers: number;
  serverMaxTotalDevices: number;
  updateMaxReceivers: (limit: number) => void;
  roomLifetimeMs: number;
  serverMaxLifetimeMs: number;
  isAdmin: boolean;
  updateRoomLifetime: (lifetimeMs: number) => void;
  resolutionId: StreamResolutionId;
  setResolutionId: (resolutionId: StreamResolutionId) => void;
  frameRate: StreamFrameRate;
  setFrameRate: (frameRate: StreamFrameRate) => void;
  qualityMode: QualityMode;
  setQualityMode: (mode: QualityMode) => void;
  effectiveCeiling: AdaptiveQualitySnapshot;
  targetBitrateBps: number;
  surfacePreference: DisplaySurfacePreference;
  setSurfacePreference: (surface: DisplaySurfacePreference) => void;
  captureAudio: boolean;
  setCaptureAudio: (enabled: boolean) => void;
  sourceAudioMuted: boolean;
  toggleSourceAudio: () => void;
  audioState: AudioConnectionState;
  audioStatusLabel: string;
  audioSupport: AudioSharingSupport;
  contentHint: StreamContentHint;
  setContentHint: (hint: StreamContentHint) => void;
  pointerEnabled: boolean;
  setPointerEnabled: (enabled: boolean) => void;
  emitPointer: (active: boolean, x: number, y: number) => void;
  signalingState: SignalingConnectionState;
  isOnline: boolean;
  isReconnectingSession: boolean;
  reconnectSignaling: () => void;
  session: SessionSnapshot | null;
  sessionPin: string | null;
  analytics: RoomSessionAnalytics | null;
  isRoomLocked: boolean;
  toggleRoomLock: (locked?: boolean) => void;
  localStream: MediaStream | null;
  streamMetadata: StreamMetadata;
  captureStatus: ScreenCaptureStatus;
  captureSupport: ScreenCaptureSupport;
  captureSourceLabel: string | null;
  peers: BroadcasterPeerState[];
  connectedReceiverCount: number;
  totalDevicesConnected: number;
  totalUploadKbps: number;
  averageRttMs: number | null;
  totalPacketsLostDelta: number;
  sourceConnectionType: string | null;
  streamStartedAt: number | null;
  lastRoomEvent: string | null;
  error: string | null;
  sourceLifecycleNotice: string | null;
  clearSourceLifecycleNotice: () => void;
  clearError: () => void;
  displayMediaSupported: boolean;
  isMobileOptimizedDefault: boolean;
  isBusy: boolean;
  openRoom: () => Promise<SessionSnapshot | null>;
  startScreenCast: () => Promise<void>;
  switchScreenSource: () => Promise<void>;
  stopScreenCast: (reason?: string) => void;
  closeSession: () => void;
  kickReceiver: (socketId: string) => void;
  reconnectPeer: (socketId: string) => void;
}

export function useBroadcaster(
  notify?: (options: NotifyOptions) => void,
): UseBroadcasterReturn {
  const {
    profile,
    isAdmin,
    serverLimits,
    getIdToken,
    recordRecentRoom,
  } = useAuth();

  const {
    socket,
    connectionState: signalingState,
    connectionError,
    ensureConnected,
    reconnect: reconnectSignaling,
    clearConnectionError,
  } = useSocketConnection();

  const [captureSupport] = useState<ScreenCaptureSupport>(() =>
    getScreenCaptureSupport(),
  );
  const [defaultPreset] = useState(() =>
    computeDefaultCapturePreset(captureSupport.isMobileOrTablet),
  );
  const [audioSupport] = useState<AudioSharingSupport>(() =>
    getAudioSharingSupport(detectDevicePlatform(), detectBrowserName()),
  );
  const [deviceName, setDeviceName] = useState<string>(
    () => profile?.defaultDeviceName || getDefaultDeviceName('broadcaster'),
  );
  const [deviceId] = useState<string>(() => getOrCreateClientDeviceId());
  const [customPin, setCustomPin] = useState<string>('');
  const [maxReceivers, setMaxReceiversState] = useState<number>(
    serverLimits.maxReceiversPerRoom,
  );
  const [roomLifetimeMs, setRoomLifetimeMsState] = useState<number>(
    serverLimits.roomMaxLifetimeMs,
  );
  const [resolutionId, setResolutionIdState] = useState<StreamResolutionId>(
    defaultPreset.resolutionId,
  );
  const [frameRate, setFrameRateState] = useState<StreamFrameRate>(
    defaultPreset.frameRate,
  );
  const [qualityMode, setQualityModeState] = useState<QualityMode>(
    defaultPreset.qualityMode,
  );
  const [surfacePreference, setSurfacePreference] =
    useState<DisplaySurfacePreference>('any');
  const [captureAudio, setCaptureAudio] = useState<boolean>(true);
  const [sourceAudioMuted, setSourceAudioMuted] = useState<boolean>(false);
  const [contentHint, setContentHintState] = useState<StreamContentHint>('detail');
  const [pointerEnabled, setPointerEnabledState] = useState<boolean>(false);
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [sessionPin, setSessionPin] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<RoomSessionAnalytics | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [streamMetadata, setStreamMetadata] = useState<StreamMetadata>({
    active: false,
    hasAudio: false,
  });
  const [captureStatus, setCaptureStatus] = useState<ScreenCaptureStatus>(() =>
    captureSupport.supported ? 'idle' : 'unsupported',
  );
  const [captureSourceLabel, setCaptureSourceLabel] = useState<string | null>(null);
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [lastRoomEvent, setLastRoomEvent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceLifecycleNotice, setSourceLifecycleNotice] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [isReconnectingSession, setIsReconnectingSession] = useState<boolean>(false);

  const sessionRef = useRef<SessionSnapshot | null>(null);
  const authTokenRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const streamDetachRef = useRef<(() => void) | null>(null);
  const resolutionIdRef = useRef<StreamResolutionId>(resolutionId);
  const frameRateRef = useRef<StreamFrameRate>(frameRate);
  const qualityModeRef = useRef<QualityMode>(qualityMode);
  const contentHintRef = useRef<StreamContentHint>(contentHint);
  const maxReceiversRef = useRef<number>(maxReceivers);
  const roomLifetimeRef = useRef<number>(roomLifetimeMs);
  const deviceNameRef = useRef<string>(deviceName);
  const lastPointerEmitAtRef = useRef<number>(0);
  const disconnectGraceTimerRef = useRef<number | null>(null);
  const wasBackgroundedRef = useRef(false);
  const pendingCloseAuthRef = useRef<{ code: string; authToken: string } | null>(null);
  const notifyRef = useRef(notify);

  sessionRef.current = session;
  localStreamRef.current = localStream;
  resolutionIdRef.current = resolutionId;
  frameRateRef.current = frameRate;
  qualityModeRef.current = qualityMode;
  contentHintRef.current = contentHint;
  maxReceiversRef.current = maxReceivers;
  roomLifetimeRef.current = roomLifetimeMs;
  deviceNameRef.current = deviceName;
  notifyRef.current = notify;

  const targetBitrateBps = computeTargetBitrateBps(resolutionId, frameRate);
  const serverMaxReceivers = serverLimits.maxReceiversPerRoom;
  const serverMaxTotalDevices = serverLimits.maxTotalDevicesPerRoom;
  const serverMaxLifetimeMs = serverLimits.roomMaxLifetimeMs;

  useEffect(() => {
    setMaxReceiversState((prev) => Math.min(prev, serverMaxReceivers));
  }, [serverMaxReceivers]);

  useEffect(() => {
    if (!sessionRef.current) {
      setRoomLifetimeMsState(serverMaxLifetimeMs);
    }
  }, [serverMaxLifetimeMs]);

  useEffect(() => {
    if (!sessionRef.current && profile?.defaultDeviceName) {
      setDeviceName(profile.defaultDeviceName);
    }
  }, [profile?.defaultDeviceName]);

  const handlePeerIceRestartNotification = useCallback(
    (receiverSocketId: string, attempt: number) => {
      const peer = sessionRef.current?.receivers.find(
        (r) => r.socketId === receiverSocketId,
      );
      notifyRef.current?.({
        tone: 'warning',
        title: `Recovering link to ${peer?.deviceName || 'receiver'}`,
        detail: `Automatic ICE restart attempt ${attempt} initiated after network hiccup.`,
        dedupeKey: `ice-restart-${receiverSocketId}`,
      });
    },
    [],
  );

  const {
    peerStatuses,
    peerStats,
    peerAdaptiveQuality,
    rtcError,
    clearRtcError,
    setAuthToken: setRtcAuthToken,
    setIceServers: setRtcIceServers,
    setLocalStream: setRtcLocalStream,
    setEncodingConfig: setRtcEncodingConfig,
    connectToReceiver,
    restartIceForPeer,
    recoverReceiversAfterSignalingReconnect,
    replaceActiveStreamTracks,
    closePeer,
    closeAllPeers,
    setPeerStatus,
  } = useBroadcasterWebRtc(
    socket,
    () => Boolean(localStreamRef.current),
    handlePeerIceRestartNotification,
  );

  useRoomHeartbeat(session?.code || null, Boolean(session));

  const cleanupCapturedStream = useCallback(() => {
    if (streamDetachRef.current) {
      streamDetachRef.current();
      streamDetachRef.current = null;
    }
    if (localStreamRef.current) {
      stopMediaStream(localStreamRef.current);
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setCaptureSourceLabel(null);
    setStreamStartedAt(null);
    setSourceAudioMuted(false);
    setStreamMetadata({ active: false, hasAudio: false });
  }, []);

  const clearGraceTimer = useCallback(() => {
    if (disconnectGraceTimerRef.current !== null) {
      window.clearTimeout(disconnectGraceTimerRef.current);
      disconnectGraceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      notifyRef.current?.({
        tone: 'success',
        title: 'Network connectivity restored',
        detail: sessionRef.current
          ? 'Resuming signaling connection and active peers...'
          : 'Signaling server reachable.',
        dedupeKey: 'network-online',
      });
      if (!socket.connected) {
        reconnectSignaling();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      notifyRef.current?.({
        tone: 'error',
        title: 'Network connection offline',
        detail: sessionRef.current
          ? 'Holding local capture ready for 25 seconds while waiting for Wi-Fi recovery.'
          : 'Waiting for device network interface to come back online.',
        dedupeKey: 'network-offline',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [reconnectSignaling, socket]);

  useEffect(() => {
    const handleDisconnect = (reason: string) => {
      if (sessionRef.current && reason !== 'io client disconnect') {
        setIsReconnectingSession(true);
        setLastRoomEvent(
          'Signaling link interrupted — holding room for automatic recovery...',
        );
        notifyRef.current?.({
          tone: 'warning',
          title: 'Signaling connection interrupted',
          detail:
            'Holding active screen cast and trying to resume your room automatically.',
          dedupeKey: 'broadcaster-sig-disconnect',
        });

        clearGraceTimer();
        disconnectGraceTimerRef.current = window.setTimeout(() => {
          disconnectGraceTimerRef.current = null;
          if (!socket.connected && sessionRef.current) {
            closeAllPeers();
            setRtcLocalStream(
              null,
              computeTargetBitrateBps(
                resolutionIdRef.current,
                frameRateRef.current,
              ),
            );
            cleanupCapturedStream();
            setCaptureStatus((prev) => (prev === 'unsupported' ? prev : 'stopped'));
            setSession(null);
            setSessionPin(null);
            sessionRef.current = null;
            authTokenRef.current = null;
            setRtcAuthToken(null);
            setIsReconnectingSession(false);
            setError(
              'Signaling reconnection timed out after 25 seconds. Open a new room to continue casting.',
            );
          }
        }, 28_000);
      }
    };

    const handleConnect = () => {
      if (pendingCloseAuthRef.current && !sessionRef.current) {
        const pendingClose = pendingCloseAuthRef.current;
        pendingCloseAuthRef.current = null;
        socket.emit(
          'session:resume',
          { authToken: pendingClose.authToken, deviceId },
          (ack) => {
            if (ack.ok && ack.session) {
              socket.emit('session:close', { code: ack.session.code });
            }
          },
        );
        setIsReconnectingSession(false);
        return;
      }

      if (!sessionRef.current || !authTokenRef.current) {
        setIsReconnectingSession(false);
        return;
      }

      clearGraceTimer();
      const token = authTokenRef.current;
      socket.emit(
        'session:resume',
        {
          authToken: token,
          deviceId,
          deviceName: deviceNameRef.current.trim() || undefined,
        },
        (ack) => {
          if (!ack.ok || !ack.session) {
            setIsReconnectingSession(false);
            closeAllPeers();
            cleanupCapturedStream();
            setCaptureStatus((prev) => (prev === 'unsupported' ? prev : 'stopped'));
            setSession(null);
            setSessionPin(null);
            sessionRef.current = null;
            authTokenRef.current = null;
            setRtcAuthToken(null);
            const msg =
              ack.error || 'Previous broadcast room expired while disconnected.';
            setError(msg);
            notifyRef.current?.({
              tone: 'error',
              title: 'Could not resume cast room',
              detail: msg,
              dedupeKey: 'broadcaster-resume-failed',
            });
            return;
          }

          const nextToken = ack.authToken || token;
          authTokenRef.current = nextToken;
          setRtcAuthToken(nextToken);
          if (ack.iceServers) {
            setRtcIceServers(ack.iceServers);
          }
          setSession(ack.session);
          sessionRef.current = ack.session;
          if (ack.analytics) {
            setAnalytics(ack.analytics);
          }
          setMaxReceiversState(ack.session.maxReceivers);
          setRoomLifetimeMsState(ack.session.lifetimeMs);
          setIsReconnectingSession(false);
          setError(null);
          setLastRoomEvent(
            `Reconnected to signaling server · Room ${ack.session.code} resumed`,
          );
          notifyRef.current?.({
            tone: 'success',
            title: 'Session resumed',
            detail: `Room ${ack.session.code} reconnected without dropping your screen cast.`,
            dedupeKey: 'broadcaster-resumed',
          });

          const activeStream = localStreamRef.current;
          if (activeStream) {
            const meta = extractStreamMetadata(activeStream);
            setStreamMetadata(meta);
            socket.emit('session:update-stream', {
              code: ack.session.code,
              stream: meta,
            });
            void recoverReceiversAfterSignalingReconnect(
              ack.session.receivers.map((r) => r.socketId),
            );
          }
        },
      );
    };

    const handleSessionState = (snapshot: SessionSnapshot) => {
      if (!sessionRef.current || sessionRef.current.code !== snapshot.code) return;
      sessionRef.current = snapshot;
      setSession(snapshot);
      setMaxReceiversState(snapshot.maxReceivers);
      setRoomLifetimeMsState(snapshot.lifetimeMs);
    };

    const handleSessionAnalytics = (nextAnalytics: RoomSessionAnalytics) => {
      setAnalytics(nextAnalytics);
    };

    const handleReceiverJoined = ({ receiver }: { receiver: ReceiverPeer }) => {
      if (sessionRef.current) {
        const exists = sessionRef.current.receivers.some(
          (r) => r.socketId === receiver.socketId,
        );
        if (!exists) {
          const nextReceivers = [...sessionRef.current.receivers, receiver];
          const nextSession: SessionSnapshot = {
            ...sessionRef.current,
            receivers: nextReceivers,
            totalDevices: 1 + nextReceivers.length,
          };
          sessionRef.current = nextSession;
          setSession(nextSession);
        }
      }
      const eventText = `${receiver.deviceName} (${receiver.platform} · ${receiver.browser}) joined`;
      setLastRoomEvent(eventText);
      notifyRef.current?.({
        tone: 'info',
        title: 'Receiver connected',
        detail: `${receiver.deviceName} (${receiver.platform} · ${receiver.browser})`,
        dedupeKey: `rx-joined-${receiver.socketId}`,
      });
      setPeerStatus(
        receiver.socketId,
        localStreamRef.current ? 'negotiating' : 'waiting-stream',
      );
      if (localStreamRef.current) {
        void connectToReceiver(receiver.socketId);
      }
    };

    const handleReceiverLeft = ({ socketId }: { socketId: string }) => {
      const leaving = sessionRef.current?.receivers.find((r) => r.socketId === socketId);
      if (leaving) {
        setLastRoomEvent(`${leaving.deviceName} left the room`);
        notifyRef.current?.({
          tone: 'info',
          title: 'Receiver disconnected',
          detail: leaving.deviceName,
          dedupeKey: `rx-left-${socketId}`,
        });
      }
      if (sessionRef.current) {
        const nextReceivers = sessionRef.current.receivers.filter(
          (r) => r.socketId !== socketId,
        );
        const nextSession: SessionSnapshot = {
          ...sessionRef.current,
          receivers: nextReceivers,
          totalDevices: 1 + nextReceivers.length,
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
      }
      closePeer(socketId);
    };

    const handleSessionClosed = ({ reason }: { reason: string }) => {
      clearGraceTimer();
      closeAllPeers();
      cleanupCapturedStream();
      setCaptureStatus((prev) => (prev === 'unsupported' ? prev : 'stopped'));
      setSession(null);
      setSessionPin(null);
      sessionRef.current = null;
      authTokenRef.current = null;
      setRtcAuthToken(null);
      setIsReconnectingSession(false);
      setLastRoomEvent(reason);
      notifyRef.current?.({
        tone: 'warning',
        title: 'Cast room closed',
        detail: reason,
        dedupeKey: 'broadcaster-room-closed',
      });
    };

    const handleSessionError = ({ message }: { code: string; message: string }) => {
      setError(message);
      notifyRef.current?.({
        tone: 'error',
        title: 'Signaling error',
        detail: message,
      });
    };

    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    socket.on('session:state', handleSessionState);
    socket.on('session:analytics', handleSessionAnalytics);
    socket.on('session:receiver-joined', handleReceiverJoined);
    socket.on('session:receiver-left', handleReceiverLeft);
    socket.on('session:closed', handleSessionClosed);
    socket.on('session:error', handleSessionError);

    return () => {
      clearGraceTimer();
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
      socket.off('session:state', handleSessionState);
      socket.off('session:analytics', handleSessionAnalytics);
      socket.off('session:receiver-joined', handleReceiverJoined);
      socket.off('session:receiver-left', handleReceiverLeft);
      socket.off('session:closed', handleSessionClosed);
      socket.off('session:error', handleSessionError);

      closeAllPeers();
      cleanupCapturedStream();
      if (sessionRef.current) {
        socket.emit('session:close', { code: sessionRef.current.code });
      }
    };
  }, [
    cleanupCapturedStream,
    clearGraceTimer,
    closeAllPeers,
    closePeer,
    connectToReceiver,
    deviceId,
    recoverReceiversAfterSignalingReconnect,
    setPeerStatus,
    setRtcAuthToken,
    setRtcIceServers,
    setRtcLocalStream,
    socket,
  ]);

  const teardownStreamForRoom = useCallback(
    (reason: string, notifyReceivers: boolean) => {
      const activeSession = sessionRef.current;
      closeAllPeers(
        notifyReceivers ? activeSession?.receivers.map((r) => r.socketId) : undefined,
      );
      setRtcLocalStream(
        null,
        computeTargetBitrateBps(resolutionIdRef.current, frameRateRef.current),
      );

      setPointerEnabledState(false);
      setSourceLifecycleNotice(null);
      const hadActiveStream = Boolean(localStreamRef.current);
      cleanupCapturedStream();
      setCaptureStatus((prev) => {
        if (prev === 'unsupported') return prev;
        return hadActiveStream ? 'stopped' : 'idle';
      });

      if (activeSession) {
        if (notifyReceivers && socket.connected) {
          socket.emit('presentation:pointer', {
            code: activeSession.code,
            active: false,
            x: 0.5,
            y: 0.5,
          });
          const idleMeta: StreamMetadata = { active: false, hasAudio: false };
          socket.emit('session:update-stream', {
            code: activeSession.code,
            stream: idleMeta,
          });
        }
        setLastRoomEvent(reason);
        if (notifyReceivers && hadActiveStream) {
          notifyRef.current?.({
            tone: 'info',
            title: 'Screen sharing stopped',
            detail: reason,
            dedupeKey: 'broadcaster-cast-stopped',
          });
        }
      }
    },
    [cleanupCapturedStream, closeAllPeers, setRtcLocalStream, socket],
  );

  const stopScreenCast = useCallback(
    (reason = 'Source stopped screen sharing.') => {
      teardownStreamForRoom(reason, true);
    },
    [teardownStreamForRoom],
  );

  useEffect(() => {
    if (!localStream) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!localStream.getVideoTracks().some((track) => track.readyState === 'live')) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [localStream]);

  // Sync orientation changes & recover cleanly if mobile screen lock ends capture tracks
  useEffect(() => {
    let orientationTimer: number | null = null;

    const syncLiveCaptureState = () => {
      const stream = localStreamRef.current;
      if (!stream) return;
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState === 'ended') {
        stopScreenCast('Screen sharing stopped while the device screen was locked or backgrounded.');
        return;
      }
      const nextMeta = extractStreamMetadata(stream);
      setStreamMetadata(nextMeta);
      void setRtcEncodingConfig({
        qualityMode: qualityModeRef.current,
        resolutionId: resolutionIdRef.current,
        frameRate: frameRateRef.current,
        contentHint: contentHintRef.current,
        sourceWidth: nextMeta.width,
        sourceHeight: nextMeta.height,
        sourceFrameRate: nextMeta.frameRate,
      });
      if (sessionRef.current && socket.connected) {
        socket.emit('session:update-stream', {
          code: sessionRef.current.code,
          stream: nextMeta,
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        if (captureSupport.platform === 'Android' && localStreamRef.current) {
          wasBackgroundedRef.current = true;
        }
        return;
      }

      if (wasBackgroundedRef.current) {
        wasBackgroundedRef.current = false;
        const videoTrack = localStreamRef.current?.getVideoTracks()[0];
        if (videoTrack?.readyState === 'live') {
          setSourceLifecycleNotice(
            'Returned to MultiCast after backgrounding. Android may pause screen capture; check the live preview and restart broadcasting if receivers are frozen.',
          );
        }
      }
      if (sessionRef.current && !socket.connected) {
        reconnectSignaling();
      }
      syncLiveCaptureState();
    };

    const handleOrientationChange = () => {
      if (!localStreamRef.current) return;
      if (orientationTimer !== null) {
        window.clearTimeout(orientationTimer);
      }
      orientationTimer = window.setTimeout(() => {
        orientationTimer = null;
        syncLiveCaptureState();
      }, 220);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('orientationchange', handleOrientationChange);
    return () => {
      if (orientationTimer !== null) {
        window.clearTimeout(orientationTimer);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [
    captureSupport.platform,
    reconnectSignaling,
    setRtcEncodingConfig,
    socket,
    stopScreenCast,
  ]);

  const openRoom = useCallback(async (): Promise<SessionSnapshot | null> => {
    const trimmedPin = customPin.trim();
    if (trimmedPin.length > 0 && !/^\d{4,6}$/.test(trimmedPin)) {
      setError('Custom room PIN must be 4 to 6 numeric digits.');
      return null;
    }

    setError(null);
    clearConnectionError();
    clearRtcError();
    setIsBusy(true);
    try {
      const firebaseToken = await getIdToken();
      if (!firebaseToken) {
        throw new Error('Sign in with a verified MultiCast account before opening a room.');
      }

      const connectedSocket = await ensureConnected();

      const created = await new Promise<{
        session: SessionSnapshot;
        analytics: RoomSessionAnalytics | null;
        pin: string;
        authToken: string;
      }>((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('Room creation timed out waiting for signaling server.'));
        }, 10_000);

        connectedSocket.emit(
          'session:create',
          {
            deviceId,
            deviceName: deviceName.trim() || getDefaultDeviceName('broadcaster'),
            platform: detectDevicePlatform(),
            browser: detectBrowserName(),
            pin: trimmedPin || undefined,
            maxReceivers: maxReceiversRef.current,
            lifetimeMs: roomLifetimeRef.current,
            firebaseToken,
          },
          (ack) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            if (!ack.ok || !ack.session) {
              reject(new Error(ack.error || 'Could not create session room.'));
              return;
            }
            if (ack.iceServers) {
              setRtcIceServers(ack.iceServers);
            }
            resolve({
              session: ack.session,
              analytics: ack.analytics || null,
              pin: ack.pin || '',
              authToken: ack.authToken || '',
            });
          },
        );
      });

      pendingCloseAuthRef.current = null;
      authTokenRef.current = created.authToken || null;
      setRtcAuthToken(authTokenRef.current);
      setSession(created.session);
      setAnalytics(created.analytics);
      setSessionPin(created.pin || null);
      setRoomLifetimeMsState(created.session.lifetimeMs);
      sessionRef.current = created.session;
      setIsReconnectingSession(false);
      setLastRoomEvent(`Room ${created.session.code} created`);

      void recordRecentRoom({
        code: created.session.code,
        role: 'broadcaster',
        hostName: created.session.broadcaster.deviceName,
        deviceName: created.session.broadcaster.deviceName,
      });

      notifyRef.current?.({
        tone: 'success',
        title: `Room ${created.session.code} opened`,
        detail: `PIN ${created.pin} · Ready for up to ${created.session.maxReceivers} receivers (${created.session.maxTotalDevices} devices total).`,
        dedupeKey: `room-opened-${created.session.code}`,
      });
      return created.session;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open cast room.');
      return null;
    } finally {
      setIsBusy(false);
    }
  }, [
    clearConnectionError,
    clearRtcError,
    customPin,
    deviceId,
    deviceName,
    ensureConnected,
    getIdToken,
    recordRecentRoom,
    setRtcAuthToken,
    setRtcIceServers,
  ]);

  const attachLifecycleToStream = useCallback(
    (stream: MediaStream) => {
      if (streamDetachRef.current) {
        streamDetachRef.current();
      }
      streamDetachRef.current = attachStreamLifecycleListeners(stream, {
        onNativeStop: (stopReason) => {
          if (localStreamRef.current === stream) {
            stopScreenCast(
              captureSupport.platform === 'Android'
                ? `Android ended screen capture. ${stopReason} Unlock the phone and start broadcasting again if needed.`
                : stopReason,
            );
          }
        },
        onMetadataChange: (nextMeta) => {
          if (localStreamRef.current !== stream) return;
          setStreamMetadata(nextMeta);
          if (sessionRef.current && socket.connected) {
            socket.emit('session:update-stream', {
              code: sessionRef.current.code,
              stream: nextMeta,
            });
          }
        },
        onAudioTracksChanged: (updatedStream) => {
          if (localStreamRef.current !== updatedStream) return;
          const bitrateBps = computeTargetBitrateBps(
            resolutionIdRef.current,
            frameRateRef.current,
          );
          void replaceActiveStreamTracks(updatedStream, bitrateBps);
        },
      });
    },
    [captureSupport.platform, replaceActiveStreamTracks, socket, stopScreenCast],
  );

  const startScreenCast = useCallback(async () => {
    if (!captureSupport.supported) {
      setCaptureStatus('unsupported');
      setError(
        captureSupport.reason ||
          'Screen capture requires a modern desktop browser over HTTPS or localhost.',
      );
      return;
    }

    const trimmedPin = customPin.trim();
    if (!sessionRef.current && trimmedPin.length > 0 && !/^\d{4,6}$/.test(trimmedPin)) {
      setError('Custom room PIN must be 4 to 6 numeric digits.');
      return;
    }

    setError(null);
    setSourceLifecycleNotice(null);
    clearConnectionError();
    clearRtcError();
    setCaptureStatus('requesting');
    setIsBusy(true);

    let capturedStream: MediaStream | null = null;
    try {
      // Call getDisplayMedia immediately inside click handler to preserve transient user activation
      capturedStream = await captureScreenStream({
        resolutionId: resolutionIdRef.current,
        frameRate: frameRateRef.current,
        captureAudio,
        contentHint: contentHintRef.current,
        surfacePreference,
      });

      let activeSession = sessionRef.current;
      if (!activeSession) {
        activeSession = await openRoom();
        if (!activeSession) {
          stopMediaStream(capturedStream);
          capturedStream = null;
          setCaptureStatus('error');
          return;
        }
      }

      const precheckTrack = capturedStream.getVideoTracks()[0];
      if (!precheckTrack || precheckTrack.readyState !== 'live') {
        stopMediaStream(capturedStream);
        capturedStream = null;
        setCaptureStatus('stopped');
        setLastRoomEvent('Screen sharing stopped before broadcast began.');
        return;
      }

      if (localStreamRef.current && localStreamRef.current !== capturedStream) {
        cleanupCapturedStream();
      }

      attachLifecycleToStream(capturedStream);
      localStreamRef.current = capturedStream;
      setLocalStream(capturedStream);
      setStreamStartedAt(Date.now());
      setSourceAudioMuted(false);
      setCaptureStatus('sharing');

      setCaptureSourceLabel(precheckTrack.label?.trim() || null);

      const meta = extractStreamMetadata(capturedStream);
      setStreamMetadata(meta);

      const bitrateBps = computeTargetBitrateBps(
        resolutionIdRef.current,
        frameRateRef.current,
      );
      setRtcLocalStream(capturedStream, bitrateBps);
      void setRtcEncodingConfig({
        qualityMode: qualityModeRef.current,
        resolutionId: resolutionIdRef.current,
        frameRate: frameRateRef.current,
        contentHint: contentHintRef.current,
        sourceWidth: meta.width,
        sourceHeight: meta.height,
        sourceFrameRate: meta.frameRate,
      });

      socket.emit('session:update-stream', {
        code: activeSession.code,
        stream: meta,
      });
      setLastRoomEvent(
        `Screen broadcast started (${formatDisplaySurface(meta.displaySurface)})`,
      );
      notifyRef.current?.({
        tone: 'success',
        title: 'Screen broadcast active',
        detail: `${formatDisplaySurface(meta.displaySurface)}${
          meta.width && meta.height ? ` · ${meta.width}×${meta.height}` : ''
        }${meta.frameRate ? ` @ ${meta.frameRate} fps` : ''}${
          meta.hasAudio ? ' · Audio Available' : ' · Video Only'
        }`,
        dedupeKey: 'broadcaster-cast-started',
      });

      if (captureAudio && !meta.hasAudio) {
        notifyRef.current?.({
          tone: 'warning',
          title: 'Video-only source captured',
          detail:
            meta.audioReason ||
            'The selected source did not return an audio track. Enable "Share audio" in the picker on Chrome/Edge.',
          dedupeKey: 'broadcaster-no-audio-track',
        });
      }

      const latestReceivers = sessionRef.current?.receivers || activeSession.receivers;
      for (const receiver of latestReceivers) {
        void connectToReceiver(receiver.socketId);
      }
    } catch (err) {
      if (capturedStream) {
        stopMediaStream(capturedStream);
      }
      if (err instanceof ScreenCaptureError) {
        if (err.code === 'PERMISSION_DENIED') {
          setCaptureStatus('permission-denied');
        } else if (err.code === 'INSECURE_CONTEXT' || err.code === 'NOT_SUPPORTED') {
          setCaptureStatus('unsupported');
        } else {
          setCaptureStatus('error');
        }
        setError(err.message);
      } else {
        setCaptureStatus('error');
        setError(
          err instanceof Error ? err.message : 'Screen capture could not be started.',
        );
      }
    } finally {
      setIsBusy(false);
    }
  }, [
    attachLifecycleToStream,
    captureAudio,
    captureSupport.reason,
    captureSupport.supported,
    cleanupCapturedStream,
    clearConnectionError,
    clearRtcError,
    connectToReceiver,
    customPin,
    openRoom,
    setRtcEncodingConfig,
    setRtcLocalStream,
    socket,
    surfacePreference,
  ]);

  const switchScreenSource = useCallback(async () => {
    if (!localStreamRef.current || !sessionRef.current) {
      await startScreenCast();
      return;
    }

    setError(null);
    clearRtcError();
    setIsBusy(true);
    let newStream: MediaStream | null = null;
    try {
      newStream = await captureScreenStream({
        resolutionId: resolutionIdRef.current,
        frameRate: frameRateRef.current,
        captureAudio,
        contentHint: contentHintRef.current,
        surfacePreference,
      });

      const oldStream = localStreamRef.current;
      if (streamDetachRef.current) {
        streamDetachRef.current();
        streamDetachRef.current = null;
      }

      attachLifecycleToStream(newStream);
      localStreamRef.current = newStream;
      setLocalStream(newStream);
      setSourceAudioMuted(false);
      setCaptureStatus('sharing');

      const videoTrack = newStream.getVideoTracks()[0];
      setCaptureSourceLabel(videoTrack?.label?.trim() || null);

      const meta = extractStreamMetadata(newStream);
      setStreamMetadata(meta);

      const bitrateBps = computeTargetBitrateBps(
        resolutionIdRef.current,
        frameRateRef.current,
      );
      await replaceActiveStreamTracks(newStream, bitrateBps);

      stopMediaStream(oldStream);

      socket.emit('session:update-stream', {
        code: sessionRef.current.code,
        stream: meta,
      });
      setLastRoomEvent(
        `Switched active screen source (${formatDisplaySurface(meta.displaySurface)})`,
      );
      notifyRef.current?.({
        tone: 'info',
        title: 'Switched capture source',
        detail: `${formatDisplaySurface(meta.displaySurface)}${
          meta.hasAudio ? ' (with audio)' : ' (video only)'
        }`,
        dedupeKey: 'broadcaster-switch-source',
      });
    } catch (err) {
      if (newStream) {
        stopMediaStream(newStream);
      }
      const message =
        err instanceof Error ? err.message : 'Screen switch was cancelled or denied.';
      setError(message);
    } finally {
      setIsBusy(false);
    }
  }, [
    attachLifecycleToStream,
    captureAudio,
    clearRtcError,
    replaceActiveStreamTracks,
    socket,
    startScreenCast,
    surfacePreference,
  ]);

  const applyLiveStreamTuning = useCallback(
    (
      nextResolution: StreamResolutionId,
      nextFrameRate: StreamFrameRate,
      nextHint: StreamContentHint,
      nextQualityMode: QualityMode,
      announceLabel?: string,
    ) => {
      const stream = localStreamRef.current;
      const meta = stream ? extractStreamMetadata(stream) : null;
      void setRtcEncodingConfig({
        qualityMode: nextQualityMode,
        resolutionId: nextResolution,
        frameRate: nextFrameRate,
        contentHint: nextHint,
        sourceWidth: meta?.width,
        sourceHeight: meta?.height,
        sourceFrameRate: meta?.frameRate,
      });

      if (stream) {
        void applyVideoTrackConstraints(
          stream,
          nextResolution,
          nextFrameRate,
          nextHint,
        ).finally(() => {
          if (localStreamRef.current !== stream) return;
          const nextMeta = extractStreamMetadata(stream);
          setStreamMetadata(nextMeta);
          if (sessionRef.current && socket.connected) {
            socket.emit('session:update-stream', {
              code: sessionRef.current.code,
              stream: nextMeta,
            });
          }
        });
      }

      if (announceLabel) {
        notifyRef.current?.({
          tone: 'info',
          title: 'Stream parameters updated',
          detail: announceLabel,
          dedupeKey: 'stream-tuning-updated',
        });
      }
    },
    [setRtcEncodingConfig, socket],
  );

  const setQualityMode = useCallback(
    (nextMode: QualityMode) => {
      setQualityModeState(nextMode);
      qualityModeRef.current = nextMode;
      const modeLabel =
        nextMode === 'auto'
          ? 'Auto (Adaptive · prioritizes text readability)'
          : nextMode === 'high'
            ? 'High (Manual)'
            : nextMode === 'medium'
              ? 'Medium (Up to 720p @ 30 fps)'
              : 'Low (Up to 540p @ 24 fps)';
      applyLiveStreamTuning(
        resolutionIdRef.current,
        frameRateRef.current,
        contentHintRef.current,
        nextMode,
        `Quality mode: ${modeLabel}`,
      );
    },
    [applyLiveStreamTuning],
  );

  const setResolutionId = useCallback(
    (nextResolution: StreamResolutionId) => {
      setResolutionIdState(nextResolution);
      resolutionIdRef.current = nextResolution;
      const option = STREAM_RESOLUTION_OPTIONS[nextResolution];
      const nextMbps = (
        computeTargetBitrateBps(nextResolution, frameRateRef.current) / 1_000_000
      ).toFixed(1);
      applyLiveStreamTuning(
        nextResolution,
        frameRateRef.current,
        contentHintRef.current,
        qualityModeRef.current,
        `${option.label} · ${frameRateRef.current} fps (${nextMbps} Mbps/peer cap)`,
      );
    },
    [applyLiveStreamTuning],
  );

  const setFrameRate = useCallback(
    (nextFrameRate: StreamFrameRate) => {
      setFrameRateState(nextFrameRate);
      frameRateRef.current = nextFrameRate;
      const option = STREAM_RESOLUTION_OPTIONS[resolutionIdRef.current];
      const nextMbps = (
        computeTargetBitrateBps(resolutionIdRef.current, nextFrameRate) / 1_000_000
      ).toFixed(1);
      applyLiveStreamTuning(
        resolutionIdRef.current,
        nextFrameRate,
        contentHintRef.current,
        qualityModeRef.current,
        `${option.width}×${option.height} at ${nextFrameRate} fps (${nextMbps} Mbps/peer cap)`,
      );
    },
    [applyLiveStreamTuning],
  );

  const setContentHint = useCallback(
    (nextHint: StreamContentHint) => {
      setContentHintState(nextHint);
      contentHintRef.current = nextHint;
      applyLiveStreamTuning(
        resolutionIdRef.current,
        frameRateRef.current,
        nextHint,
        qualityModeRef.current,
      );
    },
    [applyLiveStreamTuning],
  );

  const toggleSourceAudio = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !sourceAudioMuted;
    const applied = setStreamAudioEnabled(stream, !nextMuted);
    if (!applied) {
      notifyRef.current?.({
        tone: 'warning',
        title: 'No audio track in active capture',
        detail: 'Switch to a Browser Tab or Windows screen source with "Share audio" enabled.',
      });
      return;
    }
    setSourceAudioMuted(nextMuted);
    const meta = extractStreamMetadata(stream);
    setStreamMetadata(meta);
    if (sessionRef.current && socket.connected) {
      socket.emit('session:update-stream', {
        code: sessionRef.current.code,
        stream: meta,
      });
    }
    notifyRef.current?.({
      tone: 'info',
      title: nextMuted ? 'Source audio muted' : 'Source audio unmuted',
      detail: nextMuted
        ? 'Receivers are receiving video only until unmuted.'
        : 'Captured audio is streaming to connected receivers.',
      dedupeKey: 'broadcaster-audio-mute',
    });
  }, [socket, sourceAudioMuted]);

  const commitDeviceName = useCallback(
    async (explicitName?: string): Promise<boolean> => {
      const candidate = (explicitName ?? deviceNameRef.current).trim().slice(0, 64);
      if (!candidate) {
        setError('Source device name cannot be empty.');
        return false;
      }
      setDeviceName(candidate);
      deviceNameRef.current = candidate;

      const activeSession = sessionRef.current;
      if (!activeSession) {
        return true;
      }

      try {
        const connectedSocket = await ensureConnected();
        const ok = await new Promise<boolean>((resolve) => {
          connectedSocket.emit(
            'session:update-device-name',
            { code: activeSession.code, deviceName: candidate },
            (ack) => {
              if (!ack?.ok) {
                setError(ack?.error || 'Could not update source device name.');
                resolve(false);
                return;
              }
              resolve(true);
            },
          );
        });
        if (ok) {
          setLastRoomEvent(`Source device renamed to "${candidate}"`);
          notifyRef.current?.({
            tone: 'success',
            title: 'Device name updated',
            detail: `Connected receivers now see "${candidate}".`,
            dedupeKey: 'broadcaster-rename',
          });
        }
        return ok;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Unable to update device name.',
        );
        return false;
      }
    },
    [ensureConnected],
  );

  const updateMaxReceivers = useCallback(
    (limit: number) => {
      const clamped = Math.max(1, Math.min(serverMaxReceivers, Math.floor(limit)));
      const activeSession = sessionRef.current;
      if (!activeSession) {
        setMaxReceiversState(clamped);
        return;
      }

      if (clamped < activeSession.receivers.length) {
        setError(
          `Cannot set receiver limit to ${clamped} while ${activeSession.receivers.length} receivers are connected. Disconnect extra receivers first.`,
        );
        return;
      }

      setError(null);
      setMaxReceiversState(clamped);
      socket.emit('session:update-limit', {
        code: activeSession.code,
        maxReceivers: clamped,
      });
    },
    [serverMaxReceivers, socket],
  );

  const updateRoomLifetime = useCallback(
    (lifetimeMs: number) => {
      setRoomLifetimeMsState(lifetimeMs);
      roomLifetimeRef.current = lifetimeMs;
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      socket.emit('session:update-lifetime', {
        code: activeSession.code,
        lifetimeMs,
      });
    },
    [socket],
  );

  const toggleRoomLock = useCallback(
    (explicitLocked?: boolean) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      const nextLocked =
        typeof explicitLocked === 'boolean' ? explicitLocked : !activeSession.locked;
      socket.emit(
        'session:toggle-lock',
        { code: activeSession.code, locked: nextLocked },
        (ack) => {
          if (!ack?.ok) {
            if (ack?.error) setError(ack.error);
            return;
          }
          setLastRoomEvent(
            nextLocked
              ? `Room ${activeSession.code} locked (new receiver joins blocked)`
              : `Room ${activeSession.code} unlocked`,
          );
          notifyRef.current?.({
            tone: nextLocked ? 'warning' : 'success',
            title: nextLocked ? 'Room locked' : 'Room unlocked',
            detail: nextLocked
              ? 'New receivers cannot join until unlocked.'
              : 'New receivers can now join with the room code and PIN.',
            dedupeKey: `room-lock-${activeSession.code}`,
          });
        },
      );
    },
    [socket],
  );

  const setPointerEnabled = useCallback(
    (enabled: boolean) => {
      setPointerEnabledState(enabled);
      const activeSession = sessionRef.current;
      if (!enabled && activeSession && socket.connected) {
        socket.emit('presentation:pointer', {
          code: activeSession.code,
          active: false,
          x: 0.5,
          y: 0.5,
        });
      }
    },
    [socket],
  );

  const emitPointer = useCallback(
    (active: boolean, x: number, y: number) => {
      const activeSession = sessionRef.current;
      if (!activeSession || !socket.connected) return;
      const now = performance.now();
      if (active && now - lastPointerEmitAtRef.current < 50) {
        return;
      }
      lastPointerEmitAtRef.current = now;
      socket.emit('presentation:pointer', {
        code: activeSession.code,
        active,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      });
    },
    [socket],
  );

  const closeSession = useCallback(() => {
    clearGraceTimer();
    teardownStreamForRoom('Room ended by broadcaster.', false);
    if (sessionRef.current) {
      if (socket.connected) {
        pendingCloseAuthRef.current = null;
        socket.emit('session:close', {
          code: sessionRef.current.code,
        });
      } else if (authTokenRef.current) {
        pendingCloseAuthRef.current = {
          code: sessionRef.current.code,
          authToken: authTokenRef.current,
        };
      }
      setLastRoomEvent(`Room ${sessionRef.current.code} ended`);
    }
    setCaptureStatus(captureSupport.supported ? 'idle' : 'unsupported');
    setSession(null);
    setSessionPin(null);
    sessionRef.current = null;
    authTokenRef.current = null;
    setRtcAuthToken(null);
    setIsReconnectingSession(false);
  }, [
    captureSupport.supported,
    clearGraceTimer,
    setRtcAuthToken,
    socket,
    teardownStreamForRoom,
  ]);

  const kickReceiver = useCallback(
    (socketId: string) => {
      if (!sessionRef.current) return;
      socket.emit('session:kick-receiver', {
        code: sessionRef.current.code,
        targetSocketId: socketId,
      });
      closePeer(socketId);
    },
    [closePeer, socket],
  );

  const reconnectPeer = useCallback(
    (socketId: string) => {
      if (!localStreamRef.current) return;
      clearRtcError();
      setError(null);
      void restartIceForPeer(socketId);
    },
    [clearRtcError, restartIceForPeer],
  );

  const clearError = useCallback(() => {
    setError(null);
    clearConnectionError();
    clearRtcError();
    setCaptureStatus((prev) =>
      prev === 'permission-denied' || prev === 'error' ? 'idle' : prev,
    );
  }, [clearConnectionError, clearRtcError]);
  const clearSourceLifecycleNotice = useCallback(
    () => setSourceLifecycleNotice(null),
    [],
  );

  const peers: BroadcasterPeerState[] = (session?.receivers || []).map((receiver) => ({
    ...receiver,
    rtcState:
      peerStatuses[receiver.socketId] ||
      (localStream ? 'connecting' : 'waiting-stream'),
    stats: peerStats[receiver.socketId] || null,
    adaptiveQuality: peerAdaptiveQuality[receiver.socketId] || null,
  }));

  const peersRef = useRef<BroadcasterPeerState[]>(peers);
  peersRef.current = peers;

  // Report aggregate connection quality samples (~every 5s) when actively streaming to connected peers
  useEffect(() => {
    const activeCode = session?.code;
    if (!activeCode || !localStream || !streamMetadata.active) return;

    const timer = window.setInterval(() => {
      if (!socket.connected || !sessionRef.current) return;
      let scoreSum = 0;
      let sampleCount = 0;
      for (const peer of peersRef.current) {
        if (peer.rtcState !== 'connected' || !peer.stats) continue;
        if (peer.stats.bitrateKbps === 0 && peer.stats.fps === 0 && peer.stats.rttMs === null) {
          continue;
        }
        const rtt = peer.stats.rttMs ?? 0;
        const lossDelta = peer.stats.packetsLostDelta ?? 0;
        const jitter = peer.stats.jitterMs ?? 0;
        let score: 1 | 2 | 3 | 4 = 3;
        if (rtt > 160 || lossDelta >= 15 || jitter > 45) score = 1;
        else if (rtt > 75 || lossDelta >= 3 || jitter > 25) score = 2;
        else if (rtt <= 25 && lossDelta === 0 && (peer.stats.fps >= 24 || peer.stats.bitrateKbps >= 1500)) {
          score = 4;
        }
        scoreSum += score;
        sampleCount += 1;
      }
      if (sampleCount > 0) {
        const roundedScore = Math.max(
          1,
          Math.min(4, Math.round(scoreSum / sampleCount)),
        ) as 1 | 2 | 3 | 4;
        socket.emit('session:report-quality', {
          code: activeCode,
          score: roundedScore,
        });
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, [localStream, session?.code, socket, streamMetadata.active]);

  let totalUploadKbps = 0;
  let connectedReceiverCount = 0;
  let rttSum = 0;
  let rttSamples = 0;
  let totalPacketsLostDelta = 0;
  let hasActiveAudioPeer = false;

  for (const peer of peers) {
    if (peer.rtcState === 'connected') {
      connectedReceiverCount += 1;
      totalUploadKbps += peer.stats?.bitrateKbps || 0;
      if (peer.stats?.audioActive || (peer.stats?.audioBytes && peer.stats.audioBytes > 0)) {
        hasActiveAudioPeer = true;
      }
      if (peer.stats?.rttMs !== null && peer.stats?.rttMs !== undefined) {
        rttSum += peer.stats.rttMs;
        rttSamples += 1;
      }
      totalPacketsLostDelta += peer.stats?.packetsLostDelta || 0;
    }
  }

  const averageRttMs = rttSamples > 0 ? Math.round(rttSum / rttSamples) : null;
  const totalDevicesConnected = session ? 1 + session.receivers.length : 0;

  const hasLiveAudioTrack = Boolean(
    localStream?.getAudioTracks().some((t) => t.readyState === 'live'),
  );
  const resolvedAudio = resolveAudioStatusSnapshot({
    role: 'broadcaster',
    isStreaming: Boolean(localStream && streamMetadata.active),
    hasLiveAudioTrack,
    streamHasAudio: Boolean(streamMetadata.hasAudio),
    sourceAudioMuted: sourceAudioMuted || Boolean(streamMetadata.audioMuted),
    sourceTrackMuted: Boolean(streamMetadata.audioTrackMuted),
    hasActivePeerAudio: connectedReceiverCount > 0 && hasActiveAudioPeer,
    audioReason: streamMetadata.audioReason,
  });

  const effectiveCeiling = resolveQualityProfile({
    mode: qualityMode,
    level: 0,
    contentHint,
    baseResolutionId: resolutionId,
    baseFrameRate: frameRate,
    sourceWidth: streamMetadata.width,
    sourceHeight: streamMetadata.height,
    sourceFrameRate: streamMetadata.frameRate,
  });

  return {
    deviceName,
    setDeviceName,
    commitDeviceName,
    customPin,
    setCustomPin,
    maxReceivers: session?.maxReceivers ?? maxReceivers,
    serverMaxReceivers,
    serverMaxTotalDevices,
    updateMaxReceivers,
    roomLifetimeMs: session?.lifetimeMs ?? roomLifetimeMs,
    serverMaxLifetimeMs,
    isAdmin,
    updateRoomLifetime,
    resolutionId,
    setResolutionId,
    frameRate,
    setFrameRate,
    qualityMode,
    setQualityMode,
    effectiveCeiling,
    targetBitrateBps,
    surfacePreference,
    setSurfacePreference,
    captureAudio,
    setCaptureAudio,
    sourceAudioMuted,
    toggleSourceAudio,
    audioState: resolvedAudio.state,
    audioStatusLabel: resolvedAudio.label,
    audioSupport,
    contentHint,
    setContentHint,
    pointerEnabled,
    setPointerEnabled,
    emitPointer,
    signalingState,
    isOnline,
    isReconnectingSession,
    reconnectSignaling,
    session,
    sessionPin,
    analytics,
    isRoomLocked: Boolean(session?.locked),
    toggleRoomLock,
    localStream,
    streamMetadata,
    captureStatus,
    captureSupport,
    captureSourceLabel,
    peers,
    connectedReceiverCount,
    totalDevicesConnected,
    totalUploadKbps,
    averageRttMs,
    totalPacketsLostDelta,
    sourceConnectionType: getBrowserConnectionType(),
    streamStartedAt,
    lastRoomEvent,
    error: error || rtcError || connectionError,
    sourceLifecycleNotice,
    clearSourceLifecycleNotice,
    clearError,
    displayMediaSupported: captureSupport.supported,
    isMobileOptimizedDefault: captureSupport.isMobileOrTablet,
    isBusy,
    openRoom,
    startScreenCast,
    switchScreenSource,
    stopScreenCast,
    closeSession,
    kickReceiver,
    reconnectPeer,
  };
}
