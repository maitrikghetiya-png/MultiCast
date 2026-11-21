import { useCallback, useEffect, useRef, useState } from 'react';
import type { TypedSocketClient } from '../services/socket/socketClient.ts';
import {
  BroadcasterWebRtcManager,
  ReceiverWebRtcManager,
  type BroadcasterEncodingConfig,
} from '../services/streaming/webrtcService.ts';
import type {
  AdaptiveQualitySnapshot,
  IceServerConfig,
  PeerConnectionStatus,
  RtcTelemetryStats,
} from '../types/streaming.ts';

export function useBroadcasterWebRtc(
  socket: TypedSocketClient,
  hasActiveLocalStream: () => boolean,
  onPeerIceRestart?: (receiverSocketId: string, attempt: number) => void,
) {
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerConnectionStatus>>(
    {},
  );
  const [peerStats, setPeerStats] = useState<Record<string, RtcTelemetryStats | null>>(
    {},
  );
  const [peerAdaptiveQuality, setPeerAdaptiveQuality] = useState<
    Record<string, AdaptiveQualitySnapshot | null>
  >({});
  const [rtcError, setRtcError] = useState<string | null>(null);

  const managerRef = useRef<BroadcasterWebRtcManager | null>(null);
  const hasStreamRef = useRef(hasActiveLocalStream);
  const onIceRestartRef = useRef(onPeerIceRestart);
  hasStreamRef.current = hasActiveLocalStream;
  onIceRestartRef.current = onPeerIceRestart;

  useEffect(() => {
    const manager = new BroadcasterWebRtcManager(socket, {
      onPeerStateChange: (receiverSocketId, status) => {
        setPeerStatuses((prev) => ({ ...prev, [receiverSocketId]: status }));
        if (
          status === 'disconnected' ||
          status === 'failed' ||
          status === 'idle' ||
          status === 'waiting-stream'
        ) {
          setPeerStats((prev) =>
            prev[receiverSocketId] ? { ...prev, [receiverSocketId]: null } : prev,
          );
        }
      },
      onPeerStats: (receiverSocketId, stats) => {
        setPeerStats((prev) => ({ ...prev, [receiverSocketId]: stats }));
      },
      onPeerAdaptiveQuality: (receiverSocketId, quality) => {
        setPeerAdaptiveQuality((prev) => ({ ...prev, [receiverSocketId]: quality }));
      },
      onPeerError: (_receiverSocketId, message) => {
        setRtcError(message);
      },
      onPeerIceRestart: (receiverSocketId, attempt) => {
        onIceRestartRef.current?.(receiverSocketId, attempt);
      },
    });
    managerRef.current = manager;

    const handleAnswer = ({
      fromSocketId,
      sdp,
    }: {
      fromSocketId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      void manager.handleAnswer(fromSocketId, sdp);
    };

    const handleIceCandidate = ({
      fromSocketId,
      candidate,
    }: {
      fromSocketId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      void manager.handleIceCandidate(fromSocketId, candidate);
    };

    const handleOfferRequested = ({ fromSocketId }: { fromSocketId: string }) => {
      if (hasStreamRef.current()) {
        void manager.connectToReceiver(fromSocketId);
      }
    };

    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);
    socket.on('webrtc:offer-requested', handleOfferRequested);

    return () => {
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
      socket.off('webrtc:offer-requested', handleOfferRequested);
      manager.closeAllPeers();
      managerRef.current = null;
    };
  }, [socket]);

  const setAuthToken = useCallback((token: string | null) => {
    managerRef.current?.setAuthToken(token);
  }, []);

  const setIceServers = useCallback((servers?: IceServerConfig[] | null) => {
    managerRef.current?.setIceServers(servers);
  }, []);

  const setLocalStream = useCallback(
    (stream: MediaStream | null, maxBitrateBps?: number) => {
      managerRef.current?.setLocalStream(stream, maxBitrateBps);
    },
    [],
  );

  const setEncodingConfig = useCallback(async (config: BroadcasterEncodingConfig) => {
    await managerRef.current?.setEncodingConfig(config);
  }, []);

  const setMaxBitrate = useCallback(async (maxBitrateBps: number) => {
    await managerRef.current?.setMaxBitrate(maxBitrateBps);
  }, []);

  const connectToReceiver = useCallback(async (receiverSocketId: string) => {
    await managerRef.current?.connectToReceiver(receiverSocketId);
  }, []);

  const restartIceForPeer = useCallback(async (receiverSocketId: string) => {
    await managerRef.current?.restartIceForPeer(receiverSocketId);
  }, []);

  const recoverReceiversAfterSignalingReconnect = useCallback(
    async (receiverSocketIds: string[]) => {
      await managerRef.current?.recoverReceiversAfterSignalingReconnect(
        receiverSocketIds,
      );
    },
    [],
  );

  const replaceActiveStreamTracks = useCallback(
    async (newStream: MediaStream, maxBitrateBps?: number) => {
      await managerRef.current?.replaceActiveStreamTracks(newStream, maxBitrateBps);
    },
    [],
  );

  const closePeer = useCallback((receiverSocketId: string) => {
    managerRef.current?.closePeer(receiverSocketId);
    setPeerStatuses((prev) => {
      const next = { ...prev };
      delete next[receiverSocketId];
      return next;
    });
    setPeerStats((prev) => {
      const next = { ...prev };
      delete next[receiverSocketId];
      return next;
    });
    setPeerAdaptiveQuality((prev) => {
      const next = { ...prev };
      delete next[receiverSocketId];
      return next;
    });
  }, []);

  const closeAllPeers = useCallback((resetStatusesToWaitingIds?: string[]) => {
    managerRef.current?.closeAllPeers();
    if (resetStatusesToWaitingIds && resetStatusesToWaitingIds.length > 0) {
      setPeerStatuses(() => {
        const next: Record<string, PeerConnectionStatus> = {};
        for (const id of resetStatusesToWaitingIds) {
          next[id] = 'waiting-stream';
        }
        return next;
      });
    } else {
      setPeerStatuses({});
    }
    setPeerStats({});
    setPeerAdaptiveQuality({});
  }, []);

  const setPeerStatus = useCallback(
    (receiverSocketId: string, status: PeerConnectionStatus) => {
      setPeerStatuses((prev) => ({ ...prev, [receiverSocketId]: status }));
    },
    [],
  );

  const clearRtcError = useCallback(() => {
    setRtcError(null);
  }, []);

  return {
    peerStatuses,
    peerStats,
    peerAdaptiveQuality,
    rtcError,
    clearRtcError,
    setAuthToken,
    setIceServers,
    setLocalStream,
    setEncodingConfig,
    setMaxBitrate,
    connectToReceiver,
    restartIceForPeer,
    recoverReceiversAfterSignalingReconnect,
    replaceActiveStreamTracks,
    closePeer,
    closeAllPeers,
    setPeerStatus,
  };
}

export function useReceiverWebRtc(
  socket: TypedSocketClient,
  onRecoveryNeeded?: () => void,
  onWebRtcConnected?: (elapsedMs: number) => void,
) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [streamRevision, setStreamRevision] = useState<number>(0);
  const [peerStatus, setPeerStatus] = useState<PeerConnectionStatus>('idle');
  const [stats, setStats] = useState<RtcTelemetryStats | null>(null);
  const [rtcError, setRtcError] = useState<string | null>(null);

  const managerRef = useRef<ReceiverWebRtcManager | null>(null);
  const recoveryCallbackRef = useRef(onRecoveryNeeded);
  const connectedTimingRef = useRef(onWebRtcConnected);
  recoveryCallbackRef.current = onRecoveryNeeded;
  connectedTimingRef.current = onWebRtcConnected;

  useEffect(() => {
    const manager = new ReceiverWebRtcManager(socket, {
      onStatusChange: (status) => setPeerStatus(status),
      onRemoteStream: (stream, revision) => {
        setRemoteStream(stream);
        setStreamRevision(revision);
      },
      onStats: (nextStats) => setStats(nextStats),
      onError: (message) => setRtcError(message),
      onRecoveryNeeded: () => recoveryCallbackRef.current?.(),
      onWebRtcConnected: (elapsedMs) => connectedTimingRef.current?.(elapsedMs),
    });
    managerRef.current = manager;

    const handleOffer = ({
      fromSocketId,
      sdp,
    }: {
      fromSocketId: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      setRtcError(null);
      void manager.handleOffer(fromSocketId, sdp);
    };

    const handleIceCandidate = ({
      candidate,
    }: {
      fromSocketId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      void manager.handleIceCandidate(candidate);
    };

    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);

    return () => {
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
      manager.close();
      managerRef.current = null;
    };
  }, [socket]);

  const setAuthToken = useCallback((token: string | null) => {
    managerRef.current?.setAuthToken(token);
  }, []);

  const setIceServers = useCallback((servers?: IceServerConfig[] | null) => {
    managerRef.current?.setIceServers(servers);
  }, []);

  const closePeer = useCallback((nextStatus: PeerConnectionStatus = 'idle') => {
    managerRef.current?.close();
    setPeerStatus(nextStatus);
  }, []);

  const requestOffer = useCallback(
    (roomCode: string) => {
      setRtcError(null);
      setPeerStatus('negotiating');
      socket.emit('webrtc:request-offer', { code: roomCode });
    },
    [socket],
  );

  const updateBroadcasterSocketId = useCallback((nextSocketId: string) => {
    managerRef.current?.updateBroadcasterSocketId(nextSocketId);
  }, []);

  const clearRtcError = useCallback(() => {
    setRtcError(null);
  }, []);

  return {
    remoteStream,
    streamRevision,
    peerStatus,
    setPeerStatus,
    stats,
    rtcError,
    clearRtcError,
    setAuthToken,
    setIceServers,
    closePeer,
    requestOffer,
    updateBroadcasterSocketId,
  };
}
