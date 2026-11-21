import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../src/types/signaling.ts';
import { verifyFirebaseIdToken } from '../auth/firebaseAuth.ts';
import { getRuntimeIceServers, hasTurnServerConfigured } from '../config/env.ts';
import {
  getSocketClientKey,
  type SocketClientMetadata,
} from '../middleware/socketAuth.ts';
import type { RoomService } from '../services/roomService.ts';

export type TypedSocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const MAX_SDP_BYTES = 32_768;
const MAX_ICE_CANDIDATE_CHARS = 1_024;
const SOCKET_EVENT_WINDOW_MS = 10_000;
const SOCKET_EVENT_MAX_PER_WINDOW = 220;
const SOCKET_JOIN_CREATE_WINDOW_MS = 60_000;
const SOCKET_JOIN_CREATE_MAX_PER_WINDOW = 20;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCodeString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 16;
}

function isValidSocketId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function isValidSdpPayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const type = value.type;
  const validType =
    type === 'offer' ||
    type === 'answer' ||
    type === 'pranswer' ||
    type === 'rollback';
  if (!validType) return false;
  if (value.sdp !== undefined) {
    if (
      typeof value.sdp !== 'string' ||
      value.sdp.length === 0 ||
      value.sdp.length > MAX_SDP_BYTES
    ) {
      return false;
    }
  }
  return true;
}

function isValidIceCandidatePayload(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const hasCandidate = typeof value.candidate === 'string';
  const hasSdpMid = typeof value.sdpMid === 'string';
  const hasSdpMLineIndex = typeof value.sdpMLineIndex === 'number';
  if (!hasCandidate && !hasSdpMid && !hasSdpMLineIndex) {
    return false;
  }
  if (value.candidate !== undefined) {
    if (typeof value.candidate !== 'string' || value.candidate.length > MAX_ICE_CANDIDATE_CHARS) {
      return false;
    }
  }
  if (value.sdpMid !== undefined && value.sdpMid !== null) {
    if (typeof value.sdpMid !== 'string' || value.sdpMid.length > 64) {
      return false;
    }
  }
  if (value.sdpMLineIndex !== undefined && value.sdpMLineIndex !== null) {
    if (
      typeof value.sdpMLineIndex !== 'number' ||
      !Number.isInteger(value.sdpMLineIndex) ||
      value.sdpMLineIndex < 0 ||
      value.sdpMLineIndex > 64
    ) {
      return false;
    }
  }
  return true;
}

interface SocketWindowCounter {
  count: number;
  windowStart: number;
}

export function registerRoomSocketHandlers(
  io: TypedSocketServer,
  socket: TypedSocket,
  roomService: RoomService,
): void {
  const generalLimiter: SocketWindowCounter = {
    count: 0,
    windowStart: Date.now(),
  };
  const authMutationLimiter: SocketWindowCounter = {
    count: 0,
    windowStart: Date.now(),
  };
  const pointerLimiter: SocketWindowCounter = {
    count: 0,
    windowStart: Date.now(),
  };

  const allowSocketEvent = (
    counter: SocketWindowCounter,
    windowMs: number,
    maxCount: number,
  ): boolean => {
    const now = Date.now();
    if (now - counter.windowStart > windowMs) {
      counter.windowStart = now;
      counter.count = 1;
      return true;
    }
    counter.count += 1;
    return counter.count <= maxCount;
  };

  let inFlightRoomMutation = false;

  const emitAuthError = (code: string, message: string) => {
    socket.emit('session:error', { code, message });
  };

  const clearSocketRoomAuth = (targetSocket: TypedSocket) => {
    const meta = (targetSocket.data as { clientMeta?: SocketClientMetadata }).clientMeta;
    if (meta) {
      meta.roomAuth = undefined;
    }
  };

  const checkGeneralRate = (): boolean => {
    if (!allowSocketEvent(generalLimiter, SOCKET_EVENT_WINDOW_MS, SOCKET_EVENT_MAX_PER_WINDOW)) {
      emitAuthError(
        'RATE_LIMITED',
        'Signaling event rate limit exceeded. Slow down and try again.',
      );
      return false;
    }
    return true;
  };

  const handleReplacedSocket = (
    roomCode: string,
    broadcasterSocketId: string,
    replacedSocketId?: string,
  ) => {
    if (!replacedSocketId) return;
    const oldSocket = io.sockets.sockets.get(replacedSocketId);
    if (oldSocket) {
      clearSocketRoomAuth(oldSocket);
      oldSocket.emit('session:closed', {
        reason: 'This device reconnected in a newer tab or session.',
      });
      void oldSocket.leave(roomCode);
    }
    io.to(broadcasterSocketId).emit('session:receiver-left', {
      socketId: replacedSocketId,
    });
  };

  socket.on('session:create', async (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (inFlightRoomMutation) {
      ack({
        ok: false,
        errorCode: 'RATE_LIMITED',
        error: 'A room operation is already in progress for this connection.',
      });
      return;
    }
    inFlightRoomMutation = true;
    try {
    if (
      !checkGeneralRate() ||
      !allowSocketEvent(
        authMutationLimiter,
        SOCKET_JOIN_CREATE_WINDOW_MS,
        SOCKET_JOIN_CREATE_MAX_PER_WINDOW,
      )
    ) {
      ack({
        ok: false,
        errorCode: 'RATE_LIMITED',
        error: 'Too many room requests. Please wait a moment.',
      });
      return;
    }
    if (!isPlainObject(payload)) {
      ack({
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        error: 'Malformed room creation payload.',
      });
      return;
    }

    const handshakeAuth = socket.handshake.auth as { firebaseToken?: unknown } | undefined;
    const rawFirebaseToken =
      typeof payload.firebaseToken === 'string'
        ? payload.firebaseToken
        : typeof handshakeAuth?.firebaseToken === 'string'
          ? handshakeAuth.firebaseToken
          : null;

    const tokenCheck = await verifyFirebaseIdToken(rawFirebaseToken);
    if (!tokenCheck.ok) {
      ack({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        error: tokenCheck.message,
      });
      return;
    }

    if (!tokenCheck.identityVerified) {
      ack({
        ok: false,
        errorCode: 'EMAIL_UNVERIFIED',
        error:
          'Verify your email address (or sign in with Google or mobile OTP) before creating a broadcast room.',
      });
      return;
    }

    const result = roomService.createRoom(
      {
        socketId: socket.id,
        deviceId: payload.deviceId,
        deviceName: payload.deviceName,
        platform: payload.platform,
        browser: payload.browser,
        ownerUid: tokenCheck.user.uid,
        ownerName:
          tokenCheck.user.name ||
          tokenCheck.user.email ||
          tokenCheck.user.phoneNumber ||
          'MultiCast Host',
        ownerIsAdmin: tokenCheck.user.isAdmin,
      },
      payload.pin,
      payload.maxReceivers,
      payload.lifetimeMs,
    );

    if (!result.ok) {
      ack({ ok: false, errorCode: result.errorCode, error: result.message });
      return;
    }

    const clientMeta = (socket.data as { clientMeta?: SocketClientMetadata }).clientMeta;
    if (clientMeta) {
      clientMeta.roomAuth = result.authContext;
      clientMeta.firebaseUser = tokenCheck.user;
    }

    void socket.join(result.snapshot.code);
    ack({
      ok: true,
      session: result.snapshot,
      analytics: result.analytics,
      pin: result.pin,
      authToken: result.authToken,
      iceServers: getRuntimeIceServers(),
      turnAuthorized: hasTurnServerConfigured(),
    });
    } finally {
      inFlightRoomMutation = false;
    }
  });

  socket.on('session:join', async (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (inFlightRoomMutation) {
      ack({
        ok: false,
        errorCode: 'RATE_LIMITED',
        error: 'A room join operation is already in progress for this connection.',
      });
      return;
    }
    inFlightRoomMutation = true;
    try {
    if (
      !checkGeneralRate() ||
      !allowSocketEvent(
        authMutationLimiter,
        SOCKET_JOIN_CREATE_WINDOW_MS,
        SOCKET_JOIN_CREATE_MAX_PER_WINDOW,
      )
    ) {
      ack({
        ok: false,
        errorCode: 'RATE_LIMITED',
        error: 'Too many join attempts. Please wait a moment.',
      });
      return;
    }
    if (!isPlainObject(payload)) {
      ack({
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        error: 'Malformed room join payload.',
      });
      return;
    }

    const result = roomService.joinReceiver({
      socketId: socket.id,
      clientKey: getSocketClientKey(socket),
      code: payload.code,
      pin: payload.pin,
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      platform: payload.platform,
      browser: payload.browser,
    });

    if (!result.ok) {
      ack({ ok: false, errorCode: result.errorCode, error: result.message });
      return;
    }

    const clientMeta = (socket.data as { clientMeta?: SocketClientMetadata }).clientMeta;
    if (clientMeta) {
      clientMeta.roomAuth = result.authContext;
    }

    if (result.previousRoomDeparture) {
      const prev = result.previousRoomDeparture;
      await socket.leave(prev.code);
      io.to(prev.broadcasterSocketId).emit('session:receiver-left', {
        socketId: socket.id,
      });
      io.to(prev.code).emit(
        'session:state',
        roomService.getRoomSnapshot(prev.code) ?? prev.snapshot,
      );
    }

    handleReplacedSocket(
      result.snapshot.code,
      result.snapshot.broadcaster.socketId,
      result.replacedSocketId,
    );

    await socket.join(result.snapshot.code);
    const latestSnapshot =
      roomService.getRoomSnapshot(result.snapshot.code) ?? result.snapshot;
    ack({
      ok: true,
      session: latestSnapshot,
      selfSocketId: socket.id,
      authToken: result.authToken,
      iceServers: getRuntimeIceServers(),
      turnAuthorized: hasTurnServerConfigured(),
    });

    if (result.added) {
      io.to(latestSnapshot.broadcaster.socketId).emit('session:receiver-joined', {
        receiver: result.receiver,
      });
    }
    // Always broadcast updated receiver count and membership to host and all authorized clients in the room
    io.to(latestSnapshot.code).emit('session:state', latestSnapshot);
    const sourceAnalytics = roomService.getRoomAnalyticsByCodeForSource(latestSnapshot.code);
    if (sourceAnalytics) {
      io.to(latestSnapshot.broadcaster.socketId).emit('session:analytics', sourceAnalytics);
    }
    } finally {
      inFlightRoomMutation = false;
    }
  });

  socket.on('session:resume', async (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (inFlightRoomMutation) {
      ack({
        ok: false,
        errorCode: 'RATE_LIMITED',
        error: 'A session resume operation is already in progress for this connection.',
      });
      return;
    }
    inFlightRoomMutation = true;
    try {
    if (
      !checkGeneralRate() ||
      !allowSocketEvent(
        authMutationLimiter,
        SOCKET_JOIN_CREATE_WINDOW_MS,
        SOCKET_JOIN_CREATE_MAX_PER_WINDOW,
      )
    ) {
      ack({
        ok: false,
        errorCode: 'RATE_LIMITED',
        error: 'Too many reconnect attempts. Please wait a moment.',
      });
      return;
    }
    if (!isPlainObject(payload) || typeof payload.authToken !== 'string') {
      ack({
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        error: 'Malformed session resume payload.',
      });
      return;
    }

    const result = roomService.resumeSession({
      socketId: socket.id,
      authToken: payload.authToken,
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
    });

    if (!result.ok) {
      ack({ ok: false, errorCode: result.errorCode, error: result.message });
      return;
    }

    const clientMeta = (socket.data as { clientMeta?: SocketClientMetadata }).clientMeta;
    if (clientMeta) {
      clientMeta.roomAuth = result.authContext;
    }

    if (result.previousRoomDeparture) {
      const prev = result.previousRoomDeparture;
      await socket.leave(prev.code);
      io.to(prev.broadcasterSocketId).emit('session:receiver-left', {
        socketId: socket.id,
      });
      io.to(prev.code).emit(
        'session:state',
        roomService.getRoomSnapshot(prev.code) ?? prev.snapshot,
      );
    }

    handleReplacedSocket(
      result.snapshot.code,
      result.snapshot.broadcaster.socketId,
      result.replacedSocketId,
    );

    await socket.join(result.snapshot.code);
    const latestSnapshot =
      roomService.getRoomSnapshot(result.snapshot.code) ?? result.snapshot;
    ack({
      ok: true,
      session: latestSnapshot,
      analytics: result.role === 'source' ? result.analytics : undefined,
      selfSocketId: socket.id,
      authToken: result.authToken,
      iceServers: getRuntimeIceServers(),
      turnAuthorized: hasTurnServerConfigured(),
    });

    if (result.role === 'source') {
      if (result.previousSocketId !== socket.id) {
        const oldSourceSocket = io.sockets.sockets.get(result.previousSocketId);
        if (oldSourceSocket) {
          clearSocketRoomAuth(oldSourceSocket);
          oldSourceSocket.emit('session:closed', {
            reason: 'Broadcaster session resumed in another connection.',
          });
          void oldSourceSocket.leave(latestSnapshot.code);
        }
      }
      socket.to(latestSnapshot.code).emit('session:source-reconnected', {
        code: latestSnapshot.code,
        broadcasterSocketId: socket.id,
      });
      io.to(latestSnapshot.code).emit('session:state', latestSnapshot);
      if (result.analytics) {
        socket.emit('session:analytics', result.analytics);
      }
    } else if (result.receiver) {
      if (result.previousSocketId !== socket.id) {
        if (result.previousSocketId !== result.replacedSocketId) {
          const oldReceiverSocket = io.sockets.sockets.get(result.previousSocketId);
          if (oldReceiverSocket) {
            clearSocketRoomAuth(oldReceiverSocket);
            void oldReceiverSocket.leave(latestSnapshot.code);
          }
        }
        io.to(latestSnapshot.broadcaster.socketId).emit('session:receiver-left', {
          socketId: result.previousSocketId,
        });
      }
      if (result.added) {
        io.to(latestSnapshot.broadcaster.socketId).emit('session:receiver-joined', {
          receiver: result.receiver,
        });
      }
      io.to(latestSnapshot.code).emit('session:state', latestSnapshot);
      const sourceAnalytics = roomService.getRoomAnalyticsByCodeForSource(latestSnapshot.code);
      if (sourceAnalytics) {
        io.to(latestSnapshot.broadcaster.socketId).emit('session:analytics', sourceAnalytics);
      }
    }
    } finally {
      inFlightRoomMutation = false;
    }
  });

  socket.on('session:update-device-name', (payload, ack) => {
    if (!checkGeneralRate()) {
      ack?.({ ok: false, error: 'Rate limit exceeded.' });
      return;
    }
    if (
      !isPlainObject(payload) ||
      !isValidCodeString(payload.code) ||
      typeof payload.deviceName !== 'string'
    ) {
      const msg = 'Invalid device name payload.';
      emitAuthError('VALIDATION_ERROR', msg);
      ack?.({ ok: false, error: msg });
      return;
    }

    const result = roomService.updateDeviceName(
      socket.id,
      payload.code,
      payload.deviceName,
    );
    if (!result.ok) {
      emitAuthError(result.errorCode, result.message);
      ack?.({ ok: false, error: result.message });
      return;
    }

    ack?.({ ok: true, deviceName: result.deviceName });
    io.to(result.snapshot.code).emit('session:state', result.snapshot);
  });

  socket.on('session:update-stream', (payload) => {
    if (!checkGeneralRate()) return;
    if (
      !isPlainObject(payload) ||
      !isValidCodeString(payload.code) ||
      !isPlainObject(payload.stream)
    ) {
      emitAuthError('VALIDATION_ERROR', 'Invalid stream metadata payload.');
      return;
    }

    const result = roomService.updateStreamMetadata(
      socket.id,
      payload.code,
      payload.stream,
    );

    if (!result.ok) {
      emitAuthError(result.errorCode, result.message);
      return;
    }

    io.to(result.snapshot.code).emit('session:stream-status', {
      stream: result.snapshot.stream,
    });
    if (result.wasActive && !result.snapshot.stream.active) {
      io.to(result.snapshot.code).emit('session:source-stopped', {
        code: result.snapshot.code,
        reason: 'The source device stopped screen sharing.',
      });
    }
    io.to(result.snapshot.code).emit('session:state', result.snapshot);
  });

  socket.on('session:kick-receiver', (payload) => {
    if (!checkGeneralRate()) return;
    if (
      !isPlainObject(payload) ||
      !isValidCodeString(payload.code) ||
      !isValidSocketId(payload.targetSocketId)
    ) {
      emitAuthError('VALIDATION_ERROR', 'Invalid receiver disconnect payload.');
      return;
    }

    const result = roomService.kickReceiver(
      socket.id,
      payload.code,
      payload.targetSocketId,
    );
    if (!result.ok) {
      emitAuthError(result.errorCode, result.message);
      return;
    }

    const targetSocket = io.sockets.sockets.get(payload.targetSocketId);
    if (targetSocket) {
      clearSocketRoomAuth(targetSocket);
      targetSocket.emit('session:closed', {
        reason: 'Disconnected by the source broadcaster.',
      });
      void targetSocket.leave(result.snapshot.code);
    }

    io.to(result.snapshot.broadcaster.socketId).emit('session:receiver-left', {
      socketId: payload.targetSocketId,
    });
    io.to(result.snapshot.code).emit('session:state', result.snapshot);
  });

  socket.on('session:update-limit', (payload) => {
    if (!checkGeneralRate()) return;
    if (!isPlainObject(payload) || !isValidCodeString(payload.code)) {
      emitAuthError('VALIDATION_ERROR', 'Invalid receiver limit payload.');
      return;
    }

    const result = roomService.updateMaxReceivers(
      socket.id,
      payload.code,
      payload.maxReceivers,
    );
    if (!result.ok) {
      emitAuthError(result.errorCode, result.message);
      return;
    }

    io.to(result.snapshot.code).emit('session:state', result.snapshot);
  });

  socket.on('session:update-lifetime', (payload) => {
    if (!checkGeneralRate()) return;
    if (!isPlainObject(payload) || !isValidCodeString(payload.code)) {
      emitAuthError('VALIDATION_ERROR', 'Invalid room lifetime payload.');
      return;
    }

    const clientMeta = (socket.data as { clientMeta?: SocketClientMetadata }).clientMeta;
    const result = roomService.updateRoomLifetime(
      socket.id,
      payload.code,
      payload.lifetimeMs,
      Boolean(clientMeta?.firebaseUser?.isAdmin),
    );
    if (!result.ok) {
      emitAuthError(result.errorCode, result.message);
      return;
    }

    io.to(result.snapshot.code).emit('session:state', result.snapshot);
  });

  socket.on('session:toggle-lock', (payload, ack) => {
    if (!checkGeneralRate()) {
      ack?.({ ok: false, errorCode: 'RATE_LIMITED', error: 'Rate limit exceeded.' });
      return;
    }
    if (
      !isPlainObject(payload) ||
      !isValidCodeString(payload.code) ||
      typeof payload.locked !== 'boolean'
    ) {
      const msg = 'Invalid room lock payload.';
      emitAuthError('VALIDATION_ERROR', msg);
      ack?.({ ok: false, errorCode: 'VALIDATION_ERROR', error: msg });
      return;
    }

    const result = roomService.toggleRoomLock(
      socket.id,
      payload.code,
      payload.locked,
    );
    if (!result.ok) {
      emitAuthError(result.errorCode, result.message);
      ack?.({ ok: false, errorCode: result.errorCode, error: result.message });
      return;
    }

    ack?.({ ok: true, locked: result.locked });
    io.to(result.snapshot.code).emit('session:state', result.snapshot);
  });

  socket.on('session:report-quality', (payload) => {
    if (!checkGeneralRate()) return;
    if (!isPlainObject(payload) || !isValidCodeString(payload.code)) {
      return;
    }
    const result = roomService.recordQualitySample(
      socket.id,
      payload.code,
      payload.score,
    );
    if (!result.ok) {
      emitAuthError(result.errorCode, result.message);
      return;
    }
    socket.emit('session:analytics', result.analytics);
  });

  socket.on('session:get-analytics', (payload, ack) => {
    if (typeof ack !== 'function') return;
    if (!checkGeneralRate()) {
      ack({ ok: false, errorCode: 'RATE_LIMITED', error: 'Rate limit exceeded.' });
      return;
    }
    if (!isPlainObject(payload) || !isValidCodeString(payload.code)) {
      ack({
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        error: 'Invalid analytics lookup payload.',
      });
      return;
    }

    const result = roomService.getRoomAnalytics(socket.id, payload.code);
    if (!result.ok) {
      ack({ ok: false, errorCode: result.errorCode, error: result.message });
      return;
    }
    ack({ ok: true, analytics: result.analytics });
  });

  socket.on('presentation:pointer', (payload) => {
    if (!allowSocketEvent(pointerLimiter, 10_000, 260)) {
      return;
    }
    if (
      !isPlainObject(payload) ||
      !isValidCodeString(payload.code) ||
      typeof payload.active !== 'boolean' ||
      typeof payload.x !== 'number' ||
      typeof payload.y !== 'number' ||
      !Number.isFinite(payload.x) ||
      !Number.isFinite(payload.y)
    ) {
      return;
    }

    const auth = roomService.authorizeEvent(socket.id, 'source', payload.code);
    if (!auth.ok) {
      emitAuthError(auth.errorCode, auth.message);
      return;
    }

    const clampedX = Math.max(0, Math.min(1, payload.x));
    const clampedY = Math.max(0, Math.min(1, payload.y));
    socket.to(auth.room.code).emit('presentation:pointer', {
      active: payload.active,
      x: clampedX,
      y: clampedY,
      updatedAt: Date.now(),
    });
  });

  socket.on('session:leave', (payload) => {
    if (!checkGeneralRate()) return;
    if (!isPlainObject(payload) || !isValidCodeString(payload.code)) {
      emitAuthError('VALIDATION_ERROR', 'Invalid leave room payload.');
      return;
    }

    const auth = roomService.authorizeEvent(socket.id, 'receiver', payload.code);
    if (!auth.ok) {
      emitAuthError(auth.errorCode, auth.message);
      return;
    }

    const result = roomService.removeReceiver(auth.room.code, socket.id);
    clearSocketRoomAuth(socket);
    void socket.leave(auth.room.code);
    if (result?.removed) {
      io.to(result.snapshot.broadcaster.socketId).emit('session:receiver-left', {
        socketId: socket.id,
      });
      io.to(result.snapshot.code).emit('session:state', result.snapshot);
    }
  });

  socket.on('session:close', (payload) => {
    if (!checkGeneralRate()) return;
    if (!isPlainObject(payload) || !isValidCodeString(payload.code)) {
      emitAuthError('VALIDATION_ERROR', 'Invalid close room payload.');
      return;
    }

    const auth = roomService.authorizeEvent(socket.id, 'source', payload.code);
    if (!auth.ok) {
      emitAuthError(auth.errorCode, auth.message);
      return;
    }

    const closed = roomService.closeRoomBySource(socket.id, auth.room.code);
    if (closed) {
      socket.emit('session:analytics', closed.finalAnalytics);
      socket.to(closed.snapshot.code).emit('session:closed', {
        reason: 'The source device ended the screen cast.',
      });
      io.in(closed.snapshot.code).socketsLeave(closed.snapshot.code);
    }
  });

  socket.on('room:heartbeat', (payload) => {
    if (!checkGeneralRate()) return;
    if (!isPlainObject(payload) || !isValidCodeString(payload.code)) return;
    roomService.touchActivity(socket.id, payload.code);
  });

  socket.on('webrtc:offer', (payload) => {
    if (!checkGeneralRate()) return;
    if (
      !isPlainObject(payload) ||
      !isValidSocketId(payload.targetSocketId) ||
      !isValidSdpPayload(payload.sdp)
    ) {
      emitAuthError('VALIDATION_ERROR', 'Invalid WebRTC offer payload.');
      return;
    }

    const auth = roomService.authorizePeerRelay(
      socket.id,
      payload.targetSocketId,
      'source',
    );
    if (!auth.ok) {
      emitAuthError(auth.errorCode, auth.message);
      return;
    }

    roomService.touchActivity(socket.id, auth.room.code);
    io.to(payload.targetSocketId).emit('webrtc:offer', {
      fromSocketId: socket.id,
      sdp: payload.sdp,
    });
  });

  socket.on('webrtc:answer', (payload) => {
    if (!checkGeneralRate()) return;
    if (
      !isPlainObject(payload) ||
      !isValidSocketId(payload.targetSocketId) ||
      !isValidSdpPayload(payload.sdp)
    ) {
      emitAuthError('VALIDATION_ERROR', 'Invalid WebRTC answer payload.');
      return;
    }

    const auth = roomService.authorizePeerRelay(
      socket.id,
      payload.targetSocketId,
      'receiver',
    );
    if (!auth.ok) {
      emitAuthError(auth.errorCode, auth.message);
      return;
    }

    roomService.touchActivity(socket.id, auth.room.code);
    io.to(payload.targetSocketId).emit('webrtc:answer', {
      fromSocketId: socket.id,
      sdp: payload.sdp,
    });
  });

  socket.on('webrtc:ice-candidate', (payload) => {
    if (!checkGeneralRate()) return;
    if (
      !isPlainObject(payload) ||
      !isValidSocketId(payload.targetSocketId) ||
      !isValidIceCandidatePayload(payload.candidate)
    ) {
      emitAuthError('VALIDATION_ERROR', 'Invalid ICE candidate payload.');
      return;
    }

    const auth = roomService.authorizePeerRelay(socket.id, payload.targetSocketId);
    if (!auth.ok) {
      emitAuthError(auth.errorCode, auth.message);
      return;
    }

    io.to(payload.targetSocketId).emit('webrtc:ice-candidate', {
      fromSocketId: socket.id,
      candidate: payload.candidate,
    });
  });

  socket.on('webrtc:request-offer', (payload) => {
    if (!checkGeneralRate()) return;
    if (!isPlainObject(payload) || !isValidCodeString(payload.code)) {
      emitAuthError('VALIDATION_ERROR', 'Invalid offer request payload.');
      return;
    }

    const auth = roomService.authorizeEvent(socket.id, 'receiver', payload.code);
    if (!auth.ok) {
      emitAuthError(auth.errorCode, auth.message);
      return;
    }

    roomService.touchActivity(socket.id, auth.room.code);
    io.to(auth.room.source.socketId).emit('webrtc:offer-requested', {
      fromSocketId: socket.id,
    });
  });

  socket.on('disconnect', () => {
    const outcome = roomService.handleDisconnect(socket.id);
    if (!outcome) return;

    if (outcome.role === 'source-reconnecting') {
      io.to(outcome.snapshot.code).emit('session:source-reconnecting', {
        code: outcome.snapshot.code,
        graceMs: outcome.graceMs,
        reason:
          'Source network connection interrupted. Holding room open for automatic reconnection...',
      });
    } else {
      io.to(outcome.snapshot.broadcaster.socketId).emit('session:receiver-left', {
        socketId: socket.id,
      });
      io.to(outcome.snapshot.code).emit('session:state', outcome.snapshot);
    }
  });
}
