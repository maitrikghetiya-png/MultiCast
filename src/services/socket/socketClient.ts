import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../types/signaling.ts';

export type TypedSocketClient = Socket<ServerToClientEvents, ClientToServerEvents>;

export type SignalingConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

class SocketClientManager {
  private socket: TypedSocketClient | null = null;
  private firebaseToken: string | null = null;

  public getSocket(): TypedSocketClient {
    if (!this.socket) {
      // Same-origin connection (automatically uses wss:// behind HTTPS and ws:// on local HTTP)
      this.socket = io({
        path: '/socket.io',
        autoConnect: false,
        transports: ['websocket', 'polling'],
        upgrade: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 600,
        reconnectionDelayMax: 10000,
        randomizationFactor: 0.3,
        timeout: 10000,
        withCredentials: true,
        auth: (cb) => {
          cb(this.firebaseToken ? { firebaseToken: this.firebaseToken } : {});
        },
      });
    }
    return this.socket;
  }

  public setFirebaseToken(token: string | null): void {
    this.firebaseToken = token;
    if (this.socket) {
      this.socket.auth = token ? { firebaseToken: token } : {};
    }
  }

  public getTransportName(): string | null {
    if (!this.socket?.connected) return null;
    const engine = this.socket.io.engine as { transport?: { name?: string } } | undefined;
    return engine?.transport?.name || null;
  }

  public connect(): TypedSocketClient {
    const socket = this.getSocket();
    if (!socket.connected) {
      socket.connect();
    }
    return socket;
  }

  public disconnect(): void {
    if (this.socket && this.socket.connected) {
      this.socket.disconnect();
    }
  }
}

export const socketClient = new SocketClientManager();
