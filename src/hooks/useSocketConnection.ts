import { useCallback, useEffect, useState } from 'react';
import {
  socketClient,
  type SignalingConnectionState,
  type TypedSocketClient,
} from '../services/socket/socketClient.ts';
import type { ServerToClientEvents } from '../types/signaling.ts';

export interface UseSocketConnectionReturn {
  socket: TypedSocketClient;
  connectionState: SignalingConnectionState;
  socketId: string | null;
  transportName: string | null;
  reconnectAttempt: number;
  connectionError: string | null;
  ensureConnected: (timeoutMs?: number) => Promise<TypedSocketClient>;
  reconnect: () => void;
  clearConnectionError: () => void;
}

export function useSocketConnection(): UseSocketConnectionReturn {
  const socket = socketClient.getSocket();

  const [connectionState, setConnectionState] = useState<SignalingConnectionState>(() =>
    socket.connected ? 'connected' : socket.active ? 'connecting' : 'disconnected',
  );
  const [socketId, setSocketId] = useState<string | null>(() => socket.id ?? null);
  const [transportName, setTransportName] = useState<string | null>(() =>
    socketClient.getTransportName(),
  );
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    let cleanupEngineUpgrade: (() => void) | null = null;

    const bindEngineTransportListener = () => {
      cleanupEngineUpgrade?.();
      cleanupEngineUpgrade = null;
      const engine = socket.io.engine as
        | {
            transport?: { name?: string };
            on?: (event: string, listener: (transport: { name?: string }) => void) => void;
            off?: (event: string, listener: (transport: { name?: string }) => void) => void;
          }
        | undefined;
      if (!engine) return;
      setTransportName(engine.transport?.name ?? null);
      const handleUpgrade = (nextTransport: { name?: string }) => {
        setTransportName(nextTransport?.name ?? null);
      };
      engine.on?.('upgrade', handleUpgrade);
      cleanupEngineUpgrade = () => {
        engine.off?.('upgrade', handleUpgrade);
      };
    };

    const onConnect = () => {
      setConnectionState('connected');
      setSocketId(socket.id ?? null);
      setReconnectAttempt(0);
      setConnectionError(null);
      bindEngineTransportListener();
    };

    const onDisconnect = (reason: string) => {
      setSocketId(null);
      setTransportName(null);
      cleanupEngineUpgrade?.();
      cleanupEngineUpgrade = null;
      if (reason === 'io client disconnect') {
        setConnectionState('disconnected');
      } else {
        setConnectionState('reconnecting');
      }
    };

    const onConnectError = (err: Error) => {
      setTransportName(null);
      setConnectionState((prev) =>
        prev === 'reconnecting' ? 'reconnecting' : 'error',
      );
      setConnectionError(
        err.message || 'Unable to reach the MultiCast signaling server.',
      );
    };

    const onReconnectAttempt = (attempt: number) => {
      setReconnectAttempt(attempt);
      setConnectionState('reconnecting');
    };

    const onReconnectError = (err: Error) => {
      setConnectionState('reconnecting');
      setConnectionError(
        err.message || 'Signaling reconnect attempt failed. Retrying...',
      );
    };

    const onReconnect = () => {
      setReconnectAttempt(0);
      setConnectionState('connected');
      setSocketId(socket.id ?? null);
      setConnectionError(null);
      bindEngineTransportListener();
    };

    const onReconnectFailed = () => {
      setConnectionState('error');
      setConnectionError('Reconnection to the signaling server failed.');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect_error', onReconnectError);
    socket.io.on('reconnect', onReconnect);
    socket.io.on('reconnect_failed', onReconnectFailed);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      cleanupEngineUpgrade?.();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect_error', onReconnectError);
      socket.io.off('reconnect', onReconnect);
      socket.io.off('reconnect_failed', onReconnectFailed);
    };
  }, [socket]);

  const ensureConnected = useCallback(
    (timeoutMs = 10000): Promise<TypedSocketClient> => {
      if (socket.connected) {
        setConnectionState('connected');
        setSocketId(socket.id ?? null);
        return Promise.resolve(socket);
      }

      setConnectionState('connecting');
      setConnectionError(null);

      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          cleanup();
          const msg = 'Timed out connecting to the MultiCast signaling server.';
          setConnectionState('error');
          setConnectionError(msg);
          reject(new Error(msg));
        }, timeoutMs);

        const handleConnect = () => {
          cleanup();
          setConnectionState('connected');
          setSocketId(socket.id ?? null);
          resolve(socket);
        };

        const handleError = (err: Error) => {
          cleanup();
          const msg =
            err.message || 'Unable to connect to the MultiCast signaling server.';
          setConnectionState('error');
          setConnectionError(msg);
          reject(new Error(msg));
        };

        const cleanup = () => {
          window.clearTimeout(timer);
          socket.off('connect', handleConnect);
          socket.off('connect_error', handleError);
        };

        socket.once('connect', handleConnect);
        socket.once('connect_error', handleError);
        socketClient.connect();
      });
    },
    [socket],
  );

  const reconnect = useCallback(() => {
    setConnectionError(null);
    setConnectionState('connecting');
    if (socket.connected) {
      socket.disconnect();
    }
    socketClient.connect();
  }, [socket]);

  const clearConnectionError = useCallback(() => {
    setConnectionError(null);
  }, []);

  return {
    socket,
    connectionState,
    socketId,
    transportName,
    reconnectAttempt,
    connectionError,
    ensureConnected,
    reconnect,
    clearConnectionError,
  };
}

export function useRoomHeartbeat(roomCode: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!roomCode || !enabled) return;
    const socket = socketClient.getSocket();

    const intervalId = window.setInterval(() => {
      if (socket.connected) {
        socket.emit('room:heartbeat', { code: roomCode });
      }
    }, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [roomCode, enabled]);
}

export function useSocketEvent<K extends keyof ServerToClientEvents>(
  event: K,
  handler: ServerToClientEvents[K],
): void {
  useEffect(() => {
    const socket = socketClient.getSocket();
    socket.on(event, handler as never);
    return () => {
      socket.off(event, handler as never);
    };
  }, [event, handler]);
}
