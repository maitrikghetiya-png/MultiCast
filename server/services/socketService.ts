import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../src/types/signaling.ts';
import { isCorsOriginAllowed } from '../config/env.ts';
import { socketAuthMiddleware } from '../middleware/socketAuth.ts';
import { registerRoomSocketHandlers } from '../socket/roomSocketHandlers.ts';
import type { ExpiredRoomEvent, RoomService } from './roomService.ts';

export type TypedSocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

export function createSocketSignalingServer(
  httpServer: HttpServer,
  roomService: RoomService,
): {
  io: TypedSocketServer;
  notifyRoomExpired: (event: ExpiredRoomEvent) => void;
} {
  const io: TypedSocketServer = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || isCorsOriginAllowed(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowRequest: (req, callback) => {
      const originHeader =
        typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      if (isCorsOriginAllowed(originHeader, req)) {
        callback(null, true);
        return;
      }
      console.warn(
        `[Socket.IO] Rejected handshake from unauthorized origin "${originHeader || 'unknown'}".`,
      );
      callback(
        `Socket.IO CORS rejected origin "${originHeader || 'unknown'}".`,
        false,
      );
    },
    transports: ['websocket', 'polling'],
    allowUpgrades: true,
    allowEIO3: false,
    maxHttpBufferSize: 128 * 1024,
    connectTimeout: 20_000,
    pingInterval: 10_000,
    pingTimeout: 20_000,
  });

  io.engine.on('connection_error', (err: {
    code?: number | string;
    message?: string;
    req?: { headers?: Record<string, string | string[] | undefined>; url?: string };
  }) => {
    const origin =
      typeof err.req?.headers?.origin === 'string'
        ? err.req.headers.origin
        : 'same-origin/unknown';
    console.warn(
      `[Socket.IO Engine Error] code=${String(err.code ?? 'unknown')} origin="${origin}" message="${err.message ?? 'Connection error'}"`,
    );
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    socket.on('error', (err) => {
      console.warn(
        `[Socket.IO Client Error] socket=${socket.id} message="${err instanceof Error ? err.message : 'Unknown error'}"`,
      );
    });
    registerRoomSocketHandlers(io, socket, roomService);
  });

  const notifyRoomExpired = (event: ExpiredRoomEvent) => {
    io.to(event.code).emit('session:closed', { reason: event.reason });
    io.in(event.code).socketsLeave(event.code);
  };

  return { io, notifyRoomExpired };
}
