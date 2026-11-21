import type { Socket } from 'socket.io';
import type { VerifiedFirebaseUser } from '../auth/firebaseAuth.ts';
import type { RoomAuthContext } from '../auth/roomAuth.ts';
import { getServerConfig, isCorsOriginAllowed } from '../config/env.ts';

export interface SocketClientMetadata {
  remoteAddress: string;
  userAgent: string;
  connectedAt: number;
  roomAuth?: RoomAuthContext;
  firebaseUser?: VerifiedFirebaseUser;
}

export function getSocketClientKey(socket: Socket): string {
  if (getServerConfig().trustProxy) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    const forwardedIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : '';
    if (forwardedIp) {
      return forwardedIp;
    }
  }
  return socket.handshake.address || socket.id;
}

export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
): void {
  const originHeader = socket.handshake.headers.origin;
  if (!isCorsOriginAllowed(originHeader, socket.request)) {
    next(
      new Error(
        `Unauthorized signaling origin "${originHeader || 'unknown'}".`,
      ),
    );
    return;
  }

  const userAgentHeader = socket.handshake.headers['user-agent'];
  const metadata: SocketClientMetadata = {
    remoteAddress: getSocketClientKey(socket),
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : 'Unknown',
    connectedAt: Date.now(),
  };

  (socket.data as { clientMeta?: SocketClientMetadata }).clientMeta = metadata;
  next();
}
