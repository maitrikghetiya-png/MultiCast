import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.tsx';
import type { SignalingConnectionState } from '../services/socket/socketClient.ts';
import type { SessionSnapshot } from '../types/signaling.ts';
import type {
  ConnectionTimings,
  PeerConnectionStatus,
  PresentationPointerState,
  RtcTelemetryStats,
  StreamMetadata,
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
import { useReceiverWebRtc } from './useWebRtcPeers.ts';

export interface UseReceiverReturn {
  deviceName: string;
  setDeviceName: (name: string) => void;
  commitDeviceName: (nextName?: string) => Promise<boolean>;
  signalingState: SignalingConnectionState;
  isOnline: boolean;
  isReconnectingSession: boolean;
  sourceReconnecting: boolean;
  reconnectSignaling: () => void;
  session: SessionSnapshot | null;
  selfSocketId: string | null;
  remoteStream: MediaStream | null;
  streamRevision: number;
  streamMetadata: StreamMetadata;
  peerStatus: PeerConnectionStatus;
  stats: RtcTelemetryStats | null;
  timings: ConnectionTimings;
  pointerState: PresentationPointerState | null;
  connectionType: string | null;
  recordFirstFrame: () => void;
  error: string | null;
  notice: string | null;
  isJoining: boolean;
  clearMessages: () => void;
  joinSession: (code: string, pin: string) => Promise<void>;
  leaveSession: () => void;
  requestStreamSync: () => void;
}

const EMPTY_TIMINGS: ConnectionTimings = {
  roomAuthMs: null,
  socketConnectMs: null,
  webrtcConnectMs: null,
  firstFrameMs: null,
};

export function useReceiver(
  notify?: (options: NotifyOptions) => void,
): UseReceiverReturn {
  const { profile, getIdToken, recordRecentRoom } = useAuth();

  const {
    socket,
    connectionState: signalingState,
    connectionError,
    ensureConnected,
    reconnect: reconnectSignaling,
    clearConnectionError,
  } = useSocketConnection();

  const [deviceName, setDeviceName] = useState<string>(
    () => profile?.defaultDeviceName || getDefaultDeviceName('receiver'),
  );
  const [deviceId] = useState<string>(() => getOrCreateClientDeviceId());
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [selfSocketId, setSelfSocketId] = useState<string | null>(null);
  const [streamMetadata, setStreamMetadata] = useState<StreamMetadata>({
    active: false,
    hasAudio: false,
  });
  const [timings, setTimings] = useState<ConnectionTimings>(EMPTY_TIMINGS);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [isReconnectingSession, setIsReconnectingSession] = useState<boolean>(false);
  const [sourceReconnecting, setSourceReconnecting] = useState<boolean>(false);
  const [pointerState, setPointerState] = useState<PresentationPointerState | null>(null);

  const sessionRef = useRef<SessionSnapshot | null>(null);
  const streamMetadataRef = useRef<StreamMetadata>(streamMetadata);
  const authTokenRef = useRef<string | null>(null);
  const deviceNameRef = useRef<string>(deviceName);
  const reconnectGraceTimerRef = useRef<number | null>(null);
  const notifyRef = useRef(notify);
  const requestOfferRef = useRef<(roomCode: string) => void>(() => {});
  const joinStartedAtRef = useRef<number>(0);

  sessionRef.current = session;
  streamMetadataRef.current = streamMetadata;
  deviceNameRef.current = deviceName;
  notifyRef.current = notify;

  useEffect(() => {
    if (!sessionRef.current && profile?.defaultDeviceName) {
      setDeviceName(profile.defaultDeviceName);
    }
  }, [profile?.defaultDeviceName]);

  const handleWebRtcRecoveryNeeded = useCallback(() => {
    const activeSession = sessionRef.current;
    if (!activeSession || !streamMetadataRef.current.active || !socket.connected) {
      return;
    }
    notifyRef.current?.({
      tone: 'warning',
      title: 'WebRTC stream interrupted',
      detail: 'Attempting automatic reconnection with the source broadcaster...',
      dedupeKey: 'receiver-rtc-recovery',
    });
    requestOfferRef.current(activeSession.code);
  }, [socket]);

  const handleWebRtcConnected = useCallback((elapsedMs: number) => {
    setTimings((prev) => ({
      ...prev,
      webrtcConnectMs: elapsedMs,
    }));
  }, []);

  const {
    remoteStream,
    streamRevision,
    peerStatus,
    setPeerStatus,
    stats,
    rtcError,
    clearRtcError,
    setAuthToken: setRtcAuthToken,
    setIceServers: setRtcIceServers,
    closePeer,
    requestOffer,
    updateBroadcasterSocketId,
  } = useReceiverWebRtc(
    socket,
    handleWebRtcRecoveryNeeded,
    handleWebRtcConnected,
  );

  const peerStatusRef = useRef<PeerConnectionStatus>(peerStatus);
  const offerWatchdogRef = useRef<number | null>(null);
  peerStatusRef.current = peerStatus;
  requestOfferRef.current = requestOffer;

  useRoomHeartbeat(session?.code || null, Boolean(session));

  const recordFirstFrame = useCallback(() => {
    if (!joinStartedAtRef.current) return;
    setTimings((prev) => {
      if (prev.firstFrameMs !== null) return prev;
      return {
        ...prev,
        firstFrameMs: Math.max(1, Math.round(performance.now() - joinStartedAtRef.current)),
      };
    });
  }, []);

  const clearGraceTimer = useCallback(() => {
    if (reconnectGraceTimerRef.current !== null) {
      window.clearTimeout(reconnectGraceTimerRef.current);
      reconnectGraceTimerRef.current = null;
    }
    if (offerWatchdogRef.current !== null) {
      window.clearTimeout(offerWatchdogRef.current);
      offerWatchdogRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      notifyRef.current?.({
        tone: 'success',
        title: 'Network connection restored',
        detail: sessionRef.current
          ? 'Reconnecting to cast room...'
          : 'Signaling server reachable.',
        dedupeKey: 'rx-network-online',
      });
      if (!socket.connected) {
        reconnectSignaling();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      notifyRef.current?.({
        tone: 'error',
        title: 'Device went offline',
        detail: sessionRef.current
          ? 'Waiting for Wi-Fi connectivity to resume your viewing session.'
          : 'Check your Wi-Fi or Ethernet connection.',
        dedupeKey: 'rx-network-offline',
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
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      if (!socket.connected) {
        reconnectSignaling();
        return;
      }
      if (
        streamMetadataRef.current.active &&
        (peerStatusRef.current === 'disconnected' ||
          peerStatusRef.current === 'failed' ||
          peerStatusRef.current === 'reconnecting')
      ) {
        requestOfferRef.current(activeSession.code);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [reconnectSignaling, socket]);

  useEffect(() => {
    const handleDisconnect = (reason: string) => {
      if (sessionRef.current && reason !== 'io client disconnect') {
        setIsReconnectingSession(true);
        setNotice(
          'Signaling connection interrupted. Attempting automatic reconnection...',
        );
        notifyRef.current?.({
          tone: 'warning',
          title: 'Signaling connection interrupted',
          detail: 'Attempting automatic room recovery...',
          dedupeKey: 'rx-sig-disconnect',
        });

        clearGraceTimer();
        reconnectGraceTimerRef.current = window.setTimeout(() => {
          reconnectGraceTimerRef.current = null;
          if (!socket.connected && sessionRef.current) {
            closePeer('idle');
            setSession(null);
            sessionRef.current = null;
            authTokenRef.current = null;
            setRtcAuthToken(null);
            setSelfSocketId(null);
            setStreamMetadata({ active: false, hasAudio: false });
            setTimings(EMPTY_TIMINGS);
            setIsReconnectingSession(false);
            setSourceReconnecting(false);
            setError(
              'Lost connection to the signaling server for over 30 seconds. Rejoin the room with its code and PIN.',
            );
          }
        }, 30_000);
      }
    };

    const handleConnect = () => {
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
          setIsReconnectingSession(false);
          if (!ack.ok || !ack.session) {
            closePeer('idle');
            setSession(null);
            sessionRef.current = null;
            authTokenRef.current = null;
            setRtcAuthToken(null);
            setSelfSocketId(null);
            setStreamMetadata({ active: false, hasAudio: false });
            setTimings(EMPTY_TIMINGS);
            setSourceReconnecting(false);
            const msg = ack.error || 'The cast room ended while reconnecting.';
            setError(msg);
            notifyRef.current?.({
              tone: 'error',
              title: 'Could not rejoin room',
              detail: msg,
              dedupeKey: 'rx-resume-failed',
            });
            return;
          }

          const nextToken = ack.authToken || token;
          authTokenRef.current = nextToken;
          setRtcAuthToken(nextToken);
          if (ack.iceServers) {
            setRtcIceServers(ack.iceServers);
          }
          updateBroadcasterSocketId(ack.session.broadcaster.socketId);
          setSession(ack.session);
          sessionRef.current = ack.session;
          setSelfSocketId(ack.selfSocketId || socket.id || null);
          setStreamMetadata(ack.session.stream);
          setError(null);
          setNotice(null);
          notifyRef.current?.({
            tone: 'success',
            title: 'Reconnected to cast room',
            detail: `Room ${ack.session.code} restored automatically.`,
            dedupeKey: 'rx-resumed',
          });

          if (ack.session.stream.active) {
            if (peerStatusRef.current !== 'connected') {
              requestOffer(ack.session.code);
            }
          } else {
            setPeerStatus('waiting-stream');
          }
        },
      );
    };

    const handleSessionState = (snapshot: SessionSnapshot) => {
      if (!sessionRef.current || sessionRef.current.code !== snapshot.code) return;
      if (
        sessionRef.current.broadcaster.socketId !== snapshot.broadcaster.socketId
      ) {
        updateBroadcasterSocketId(snapshot.broadcaster.socketId);
      }
      sessionRef.current = snapshot;
      setSession(snapshot);
      setStreamMetadata(snapshot.stream);
    };

    const handleStreamStatus = ({ stream }: { stream: StreamMetadata }) => {
      setStreamMetadata(stream);
      if (stream.active) {
        setNotice(null);
      } else {
        closePeer('waiting-stream');
      }
    };

    const handleSourceStopped = ({ reason }: { code: string; reason: string }) => {
      closePeer('waiting-stream');
      setStreamMetadata({ active: false, hasAudio: false });
      setPointerState(null);
      const msg = reason || 'The source device stopped screen sharing.';
      setNotice(msg);
      notifyRef.current?.({
        tone: 'info',
        title: 'Screen share paused',
        detail: msg,
        dedupeKey: 'rx-source-stopped',
      });
    };

    const handleSourceReconnecting = ({
      reason,
    }: {
      code: string;
      graceMs: number;
      reason: string;
    }) => {
      setSourceReconnecting(true);
      setNotice(reason);
      notifyRef.current?.({
        tone: 'warning',
        title: 'Source network interrupted',
        detail: 'Waiting up to 25 seconds for the source broadcaster to reconnect...',
        dedupeKey: 'rx-source-reconnecting',
      });
    };

    const handleSourceReconnected = ({
      code,
      broadcasterSocketId,
    }: {
      code: string;
      broadcasterSocketId: string;
    }) => {
      updateBroadcasterSocketId(broadcasterSocketId);
      if (sessionRef.current && sessionRef.current.code === code) {
        const nextSession: SessionSnapshot = {
          ...sessionRef.current,
          broadcaster: {
            ...sessionRef.current.broadcaster,
            socketId: broadcasterSocketId,
          },
        };
        sessionRef.current = nextSession;
        setSession(nextSession);
      }
      setSourceReconnecting(false);
      setNotice(null);
      notifyRef.current?.({
        tone: 'success',
        title: 'Source broadcaster reconnected',
        detail: 'Resuming live screen stream...',
        dedupeKey: 'rx-source-reconnected',
      });
      if (streamMetadataRef.current.active && peerStatusRef.current !== 'connected') {
        requestOffer(code);
      }
    };

    const handleSessionClosed = ({ reason }: { reason: string }) => {
      clearGraceTimer();
      closePeer('idle');
      setSession(null);
      sessionRef.current = null;
      authTokenRef.current = null;
      setRtcAuthToken(null);
      setSelfSocketId(null);
      setStreamMetadata({ active: false, hasAudio: false });
      setTimings(EMPTY_TIMINGS);
      setPointerState(null);
      setIsReconnectingSession(false);
      setSourceReconnecting(false);
      const msg = reason || 'The cast room has ended.';
      setNotice(msg);
      notifyRef.current?.({
        tone: 'warning',
        title: 'Session ended',
        detail: msg,
        dedupeKey: 'rx-session-closed',
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

    const handlePointer = (payload: PresentationPointerState) => {
      setPointerState(payload.active ? payload : null);
    };

    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    socket.on('session:state', handleSessionState);
    socket.on('session:stream-status', handleStreamStatus);
    socket.on('session:source-stopped', handleSourceStopped);
    socket.on('session:source-reconnecting', handleSourceReconnecting);
    socket.on('session:source-reconnected', handleSourceReconnected);
    socket.on('session:closed', handleSessionClosed);
    socket.on('session:error', handleSessionError);
    socket.on('presentation:pointer', handlePointer);

    return () => {
      clearGraceTimer();
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
      socket.off('session:state', handleSessionState);
      socket.off('session:stream-status', handleStreamStatus);
      socket.off('session:source-stopped', handleSourceStopped);
      socket.off('session:source-reconnecting', handleSourceReconnecting);
      socket.off('session:source-reconnected', handleSourceReconnected);
      socket.off('session:closed', handleSessionClosed);
      socket.off('session:error', handleSessionError);
      socket.off('presentation:pointer', handlePointer);

      closePeer('idle');
      if (sessionRef.current) {
        socket.emit('session:leave', { code: sessionRef.current.code });
      }
    };
  }, [
    clearGraceTimer,
    closePeer,
    deviceId,
    requestOffer,
    setPeerStatus,
    setRtcAuthToken,
    setRtcIceServers,
    socket,
    updateBroadcasterSocketId,
  ]);

  const joinSession = useCallback(
    async (rawCode: string, rawPin: string) => {
      const normalizedCode = rawCode.trim().toUpperCase();
      const normalizedPin = rawPin.trim();

      if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
        setError('Enter a valid 6-character room code (letters and numbers).');
        return;
      }

      if (!/^\d{4,6}$/.test(normalizedPin)) {
        setError('Enter a valid 4 to 6 digit numeric PIN.');
        return;
      }

      setError(null);
      setNotice(null);
      clearConnectionError();
      clearRtcError();
      setTimings(EMPTY_TIMINGS);
      setIsJoining(true);

      joinStartedAtRef.current = performance.now();

      try {
        const socketStart = performance.now();
        const connectedSocket = await ensureConnected();
        const socketConnectMs = Math.max(1, Math.round(performance.now() - socketStart));

        if (sessionRef.current && sessionRef.current.code !== normalizedCode) {
          connectedSocket.emit('session:leave', { code: sessionRef.current.code });
          closePeer('idle');
        }

        const firebaseToken = await getIdToken().catch(() => null);
        const resolvedDeviceName = deviceName.trim() || getDefaultDeviceName('receiver');
        const authStart = performance.now();

        const result = await new Promise<{
          session: SessionSnapshot;
          selfSocketId: string;
          authToken: string;
        }>((resolve, reject) => {
          let settled = false;
          const timer = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('Join request timed out waiting for the signaling server.'));
          }, 10_000);

          connectedSocket.emit(
            'session:join',
            {
              code: normalizedCode,
              pin: normalizedPin,
              deviceId,
              deviceName: resolvedDeviceName,
              platform: detectDevicePlatform(),
              browser: detectBrowserName(),
              firebaseToken: firebaseToken || undefined,
            },
            (ack) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              if (!ack.ok || !ack.session) {
                reject(new Error(ack.error || 'Failed to join cast room.'));
                return;
              }
              if (ack.iceServers) {
                setRtcIceServers(ack.iceServers);
              }
              resolve({
                session: ack.session,
                selfSocketId: ack.selfSocketId || connectedSocket.id || '',
                authToken: ack.authToken || '',
              });
            },
          );
        });

        const roomAuthMs = Math.max(1, Math.round(performance.now() - authStart));
        setTimings({
          socketConnectMs,
          roomAuthMs,
          webrtcConnectMs: null,
          firstFrameMs: null,
        });

        authTokenRef.current = result.authToken || null;
        setRtcAuthToken(authTokenRef.current);
        updateBroadcasterSocketId(result.session.broadcaster.socketId);
        setSession(result.session);
        sessionRef.current = result.session;
        setSelfSocketId(result.selfSocketId);
        setStreamMetadata(result.session.stream);
        setIsReconnectingSession(false);
        setSourceReconnecting(false);
        setPeerStatus(result.session.stream.active ? 'negotiating' : 'waiting-stream');

        void recordRecentRoom({
          code: result.session.code,
          role: 'receiver',
          hostName: result.session.broadcaster.deviceName,
          deviceName: resolvedDeviceName,
        });

        if (result.session.stream.active) {
          if (offerWatchdogRef.current !== null) {
            window.clearTimeout(offerWatchdogRef.current);
          }
          const joinedCode = result.session.code;
          // Fast fallback request after 650ms only if the broadcaster's automatic offer didn't already trigger negotiation
          offerWatchdogRef.current = window.setTimeout(() => {
            offerWatchdogRef.current = null;
            if (
              sessionRef.current?.code === joinedCode &&
              streamMetadataRef.current.active &&
              peerStatusRef.current === 'negotiating' &&
              socket.connected
            ) {
              requestOfferRef.current(joinedCode);
            }
          }, 650);
        }

        notifyRef.current?.({
          tone: 'success',
          title: `Joined room ${result.session.code}`,
          detail: `Paired with ${result.session.broadcaster.deviceName}.`,
          dedupeKey: `rx-joined-${result.session.code}`,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to join cast room.');
      } finally {
        setIsJoining(false);
      }
    },
    [
      clearConnectionError,
      clearRtcError,
      closePeer,
      deviceId,
      deviceName,
      ensureConnected,
      getIdToken,
      recordRecentRoom,
      setPeerStatus,
      setRtcAuthToken,
      setRtcIceServers,
      socket,
      updateBroadcasterSocketId,
    ],
  );

  const commitDeviceName = useCallback(
    async (explicitName?: string): Promise<boolean> => {
      const candidate = (explicitName ?? deviceNameRef.current).trim().slice(0, 64);
      if (!candidate) {
        setError('Receiver device name cannot be empty.');
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
                setError(ack?.error || 'Could not rename receiver device.');
                resolve(false);
                return;
              }
              resolve(true);
            },
          );
        });
        if (ok) {
          notifyRef.current?.({
            tone: 'success',
            title: 'Device renamed',
            detail: `Source now sees this receiver as "${candidate}".`,
            dedupeKey: 'rx-renamed',
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

  const leaveSession = useCallback(() => {
    clearGraceTimer();
    closePeer('idle');
    if (sessionRef.current) {
      socket.emit('session:leave', {
        code: sessionRef.current.code,
      });
    }
    setSession(null);
    sessionRef.current = null;
    authTokenRef.current = null;
    setRtcAuthToken(null);
    setSelfSocketId(null);
    setStreamMetadata({ active: false, hasAudio: false });
    setTimings(EMPTY_TIMINGS);
    setPointerState(null);
    setIsReconnectingSession(false);
    setSourceReconnecting(false);
    setError(null);
    clearRtcError();
    setNotice('Disconnected from cast room.');
    notifyRef.current?.({
      tone: 'info',
      title: 'Left cast room',
      dedupeKey: 'rx-left',
    });
  }, [clearGraceTimer, clearRtcError, closePeer, setRtcAuthToken, socket]);

  const requestStreamSync = useCallback(() => {
    if (!sessionRef.current) return;
    requestOffer(sessionRef.current.code);
  }, [requestOffer]);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
    clearConnectionError();
    clearRtcError();
  }, [clearConnectionError, clearRtcError]);

  const effectivePeerStatus: PeerConnectionStatus =
    isReconnectingSession || sourceReconnecting ? 'reconnecting' : peerStatus;

  return {
    deviceName,
    setDeviceName,
    commitDeviceName,
    signalingState,
    isOnline,
    isReconnectingSession,
    sourceReconnecting,
    reconnectSignaling,
    session,
    selfSocketId,
    remoteStream,
    streamRevision,
    streamMetadata,
    peerStatus: effectivePeerStatus,
    stats,
    timings,
    pointerState,
    connectionType: stats?.connectionType ?? getBrowserConnectionType(),
    recordFirstFrame,
    error: error || rtcError || connectionError,
    notice,
    isJoining,
    clearMessages,
    joinSession,
    leaveSession,
    requestStreamSync,
  };
}
