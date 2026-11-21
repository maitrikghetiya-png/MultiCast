import crypto from 'node:crypto';
import type {
  SessionBroadcasterInfo,
  SessionSnapshot,
} from '../../src/types/signaling.ts';
import type {
  AverageQualityLabel,
  DevicePlatform,
  ReceiverPeer,
  RoomSessionAnalytics,
  StreamMetadata,
} from '../../src/types/streaming.ts';
import type { RoomAuthContext, RoomAuthService, RoomRole } from '../auth/roomAuth.ts';
import { getServerConfig } from '../config/env.ts';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const VALID_PLATFORMS: ReadonlySet<DevicePlatform> = new Set([
  'Windows',
  'macOS',
  'Linux',
  'ChromeOS',
  'Android',
  'iOS',
  'iPadOS',
  'Unknown',
]);

export type RoomErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CODE'
  | 'INVALID_PIN'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_EXPIRED'
  | 'ROOM_FULL'
  | 'ROOM_LOCKED'
  | 'ROLE_CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'PEER_NOT_FOUND';

export interface RoomFailure {
  ok: false;
  errorCode: RoomErrorCode;
  message: string;
}

export interface RoomCreateSuccess {
  ok: true;
  snapshot: SessionSnapshot;
  analytics: RoomSessionAnalytics;
  pin: string;
  authContext: RoomAuthContext;
  authToken: string;
}

export interface PreviousRoomDeparture {
  code: string;
  broadcasterSocketId: string;
  snapshot: SessionSnapshot;
}

export interface RoomJoinSuccess {
  ok: true;
  snapshot: SessionSnapshot;
  receiver: ReceiverPeer;
  added: boolean;
  replacedSocketId?: string;
  authContext: RoomAuthContext;
  authToken: string;
  previousRoomDeparture?: PreviousRoomDeparture;
}

export interface RoomAuthorizationResult {
  ok: true;
  room: RoomRecord;
  membership: SocketMembership;
}

const SOURCE_RECONNECT_GRACE_MS = 25_000;
export const SERVER_MAX_TOTAL_DEVICES_PER_ROOM = 10; // 1 source + 9 receivers
export const SERVER_MAX_RECEIVERS_PER_ROOM = SERVER_MAX_TOTAL_DEVICES_PER_ROOM - 1; // 9

export interface RoomResumeSuccess {
  ok: true;
  role: RoomRole;
  snapshot: SessionSnapshot;
  analytics?: RoomSessionAnalytics;
  previousSocketId: string;
  receiver?: ReceiverPeer;
  added?: boolean;
  replacedSocketId?: string;
  authContext: RoomAuthContext;
  authToken: string;
  previousRoomDeparture?: PreviousRoomDeparture;
}

export interface RoomRecord {
  roomId: string;
  code: string;
  pinSalt: string;
  pinHash: string;
  createdAt: number;
  lastActivityAt: number;
  lifetimeMs: number; // 0 = no fixed expiry (idle cleanup or explicit close only)
  locked: boolean;
  maxReceivers: number;
  ownerUid?: string;
  ownerName?: string;
  ownerIsAdmin?: boolean;
  source: SessionBroadcasterInfo;
  sourceDisconnectedAt: number | null;
  stream: StreamMetadata;
  receivers: Map<string, ReceiverPeer>;
  kickedSocketIds: Set<string>;
  kickedMemberIds: Set<string>;
  receiverMemberIds: Map<string, string>;
  receiverDeviceIndex: Map<string, string>; // deviceId -> socketId
  recentReceiverProfiles: Map<string, ReceiverPeer>;
  analytics: {
    peakReceivers: number;
    totalReceiversJoined: number;
    reconnectCount: number;
    qualityScoreSum: number;
    qualitySamplesCount: number;
  };
}

export interface SocketMembership {
  roomId: string;
  code: string;
  role: RoomRole;
}

export interface ExpiredRoomEvent {
  code: string;
  roomId: string;
  reason: string;
  memberSocketIds: string[];
}

export interface ExpiredRoomRecord {
  code: string;
  status: 'expired' | 'closed';
  reason: string;
  expiredAt: number;
}

export type RoomLookupStatus =
  | { status: 'active'; snapshot: SessionSnapshot }
  | { status: 'expired' | 'closed'; code: string; reason: string; expiredAt: number }
  | { status: 'not_found'; code: string };

export class RoomService {
  private rooms: Map<string, RoomRecord> = new Map();
  private expiredRooms: Map<string, ExpiredRoomRecord> = new Map();
  private socketMemberships: Map<string, SocketMembership> = new Map();
  private sourceDisconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private roomOperationLocks: Set<string> = new Set();
  private authService: RoomAuthService;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private onRoomExpired?: (event: ExpiredRoomEvent) => void;

  constructor(
    authService: RoomAuthService,
    onRoomExpired?: (event: ExpiredRoomEvent) => void,
  ) {
    this.authService = authService;
    this.onRoomExpired = onRoomExpired;
  }

  private withRoomLock<T>(code: string, fn: () => T): T {
    const normalized = this.normalizeCode(code);
    if (this.roomOperationLocks.has(normalized)) {
      throw new Error(`Concurrent room mutation conflict for room "${normalized}".`);
    }
    this.roomOperationLocks.add(normalized);
    try {
      return fn();
    } finally {
      this.roomOperationLocks.delete(normalized);
    }
  }

  public startExpirationSweep(intervalMs = 30_000): void {
    this.stopExpirationSweep();
    this.cleanupTimer = setInterval(() => {
      this.sweepAbandonedRooms();
    }, intervalMs);
    this.cleanupTimer.unref();
  }

  public stopExpirationSweep(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const timer of this.sourceDisconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.sourceDisconnectTimers.clear();
  }

  public normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  public isValidCodeFormat(code: string): boolean {
    return /^[A-Z0-9]{6}$/.test(this.normalizeCode(code));
  }

  public sanitizePlatform(platform: unknown): DevicePlatform {
    if (typeof platform === 'string' && VALID_PLATFORMS.has(platform as DevicePlatform)) {
      return platform as DevicePlatform;
    }
    return 'Unknown';
  }

  private stripControlChars(value: string): string {
    return value.replace(/[\u0000-\u001F\u007F]/g, '');
  }

  public sanitizeDeviceName(raw: unknown, fallback: string): string {
    if (typeof raw !== 'string') return fallback;
    const cleaned = this.stripControlChars(raw).trim().slice(0, 64);
    return cleaned || fallback;
  }

  public sanitizeBrowserName(raw: unknown): string {
    if (typeof raw !== 'string') return 'Browser';
    const cleaned = this.stripControlChars(raw).trim().slice(0, 32);
    return cleaned || 'Browser';
  }

  public sanitizeDeviceId(raw: unknown): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const cleaned = raw.trim().replace(/[^a-zA-Z0-9_\-:.]/g, '').slice(0, 128);
    return cleaned.length >= 4 ? cleaned : undefined;
  }

  private resolveRequestedLifetime(
    requestedLifetimeMs: unknown,
    isAdmin = false,
  ): { ok: true; lifetimeMs: number } | RoomFailure {
    const serverDefault = getServerConfig().roomSettings.roomMaxLifetimeMs;
    const maxAllowedMs = 30 * 24 * 60 * 60 * 1000;

    if (requestedLifetimeMs === undefined || requestedLifetimeMs === null) {
      return { ok: true, lifetimeMs: serverDefault };
    }

    if (typeof requestedLifetimeMs !== 'number' || !Number.isFinite(requestedLifetimeMs)) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'Room lifetime must be a valid number in milliseconds (or 0 for no fixed limit).',
      };
    }

    const rounded = Math.round(requestedLifetimeMs);
    if (rounded === 0) {
      if (serverDefault !== 0 && !isAdmin) {
        return { ok: true, lifetimeMs: serverDefault };
      }
      return { ok: true, lifetimeMs: 0 };
    }

    if (rounded < 60_000 || rounded > maxAllowedMs) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'Room lifetime must be between 1 minute and 30 days (or 0 for no fixed limit).',
      };
    }

    if (!isAdmin && serverDefault > 0 && rounded > serverDefault) {
      return { ok: true, lifetimeMs: serverDefault };
    }

    return { ok: true, lifetimeMs: rounded };
  }

  private generateUniqueRoomCode(): string {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        code += CODE_ALPHABET.charAt(crypto.randomInt(0, CODE_ALPHABET.length));
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error('Unable to allocate a unique room code.');
  }

  public createRoom(
    sourceInput: {
      socketId: string;
      deviceId?: unknown;
      deviceName: unknown;
      platform: unknown;
      browser: unknown;
      ownerUid?: string;
      ownerName?: string;
      ownerIsAdmin?: boolean;
    },
    requestedPin?: unknown,
    requestedMaxReceivers?: unknown,
    requestedLifetimeMs?: unknown,
  ): RoomCreateSuccess | RoomFailure {
    const existing = this.socketMemberships.get(sourceInput.socketId);
    if (existing) {
      if (existing.role === 'receiver') {
        return {
          ok: false,
          errorCode: 'ROLE_CONFLICT',
          message:
            'Leave your active receiver session before creating a source broadcast room.',
        };
      }
      // Replace prior room owned by the same source socket
      this.closeRoomBySource(sourceInput.socketId);
    }

    let pin: string;
    if (typeof requestedPin === 'string' && requestedPin.trim().length > 0) {
      const normalizedPin = requestedPin.trim();
      if (!this.authService.isValidPinFormat(normalizedPin)) {
        return {
          ok: false,
          errorCode: 'INVALID_PIN',
          message: 'Room PIN must be 4 to 6 numeric digits.',
        };
      }
      pin = normalizedPin;
    } else {
      pin = this.authService.generateSecurePin(4);
    }

    const serverMaxReceivers = Math.min(
      getServerConfig().roomSettings.maxReceiversPerRoom,
      SERVER_MAX_RECEIVERS_PER_ROOM,
    );
    const { maxActiveRooms } = getServerConfig().roomSettings;
    if (this.rooms.size >= maxActiveRooms) {
      this.sweepAbandonedRooms();
      if (this.rooms.size >= maxActiveRooms) {
        return {
          ok: false,
          errorCode: 'RATE_LIMITED',
          message: 'Server active room capacity reached. Please try again shortly.',
        };
      }
    }

    let resolvedMaxReceivers = serverMaxReceivers;
    if (requestedMaxReceivers !== undefined && requestedMaxReceivers !== null) {
      if (
        typeof requestedMaxReceivers !== 'number' ||
        !Number.isInteger(requestedMaxReceivers) ||
        requestedMaxReceivers < 1 ||
        requestedMaxReceivers > serverMaxReceivers
      ) {
        return {
          ok: false,
          errorCode: 'VALIDATION_ERROR',
          message: `Receiver limit must be an integer between 1 and ${serverMaxReceivers}.`,
        };
      }
      resolvedMaxReceivers = Math.min(requestedMaxReceivers, SERVER_MAX_RECEIVERS_PER_ROOM);
    }

    const lifetimeResult = this.resolveRequestedLifetime(
      requestedLifetimeMs,
      Boolean(sourceInput.ownerIsAdmin),
    );
    if (!lifetimeResult.ok) {
      return lifetimeResult;
    }

    const roomId = crypto.randomUUID();
    const code = this.generateUniqueRoomCode();
    const pinSalt = crypto.randomBytes(16).toString('hex');
    const pinHash = this.authService.hashPin(pin, pinSalt);
    const now = Date.now();

    const source: SessionBroadcasterInfo = {
      socketId: sourceInput.socketId,
      deviceId: this.sanitizeDeviceId(sourceInput.deviceId),
      deviceName: this.sanitizeDeviceName(sourceInput.deviceName, 'Source Display'),
      platform: this.sanitizePlatform(sourceInput.platform),
      browser: this.sanitizeBrowserName(sourceInput.browser),
    };

    const record: RoomRecord = {
      roomId,
      code,
      pinSalt,
      pinHash,
      createdAt: now,
      lastActivityAt: now,
      lifetimeMs: lifetimeResult.lifetimeMs,
      locked: false,
      maxReceivers: resolvedMaxReceivers,
      ownerUid: sourceInput.ownerUid,
      ownerName: sourceInput.ownerName,
      ownerIsAdmin: sourceInput.ownerIsAdmin,
      source,
      sourceDisconnectedAt: null,
      stream: {
        active: false,
        hasAudio: false,
      },
      receivers: new Map(),
      kickedSocketIds: new Set(),
      kickedMemberIds: new Set(),
      receiverMemberIds: new Map(),
      receiverDeviceIndex: new Map(),
      recentReceiverProfiles: new Map(),
      analytics: {
        peakReceivers: 0,
        totalReceiversJoined: 0,
        reconnectCount: 0,
        qualityScoreSum: 0,
        qualitySamplesCount: 0,
      },
    };

    this.expiredRooms.delete(code);
    this.rooms.set(code, record);
    this.socketMemberships.set(source.socketId, {
      roomId,
      code,
      role: 'source',
    });

    const authContext: RoomAuthContext = {
      socketId: source.socketId,
      roomId,
      code,
      role: 'source',
      issuedAt: now,
    };

    return {
      ok: true,
      snapshot: this.toSnapshot(record),
      analytics: this.toAnalytics(record),
      pin,
      authContext,
      authToken: this.authService.issueAuthToken(authContext),
    };
  }

  public joinReceiver(input: {
    socketId: string;
    clientKey: string;
    code: unknown;
    pin: unknown;
    deviceId?: unknown;
    deviceName: unknown;
    platform: unknown;
    browser: unknown;
  }): RoomJoinSuccess | RoomFailure {
    if (typeof input.code !== 'string' || !this.isValidCodeFormat(input.code)) {
      return {
        ok: false,
        errorCode: 'INVALID_CODE',
        message: 'Room ID must be 6 alphanumeric characters.',
      };
    }

    if (typeof input.pin !== 'string' || !this.authService.isValidPinFormat(input.pin)) {
      return {
        ok: false,
        errorCode: 'INVALID_PIN',
        message: 'Room PIN must be 4 to 6 numeric digits.',
      };
    }
    const validatedPin = input.pin;

    const rateCheck = this.authService.checkPinRateLimit(input.clientKey);
    if (!rateCheck.allowed) {
      return {
        ok: false,
        errorCode: 'RATE_LIMITED',
        message: `Too many incorrect PIN attempts. Try again in ${rateCheck.retryAfterSec}s.`,
      };
    }

    const normalizedCode = this.normalizeCode(input.code);
    const roomRateCheck = this.authService.checkRoomPinRateLimit(normalizedCode);
    if (!roomRateCheck.allowed) {
      return {
        ok: false,
        errorCode: 'RATE_LIMITED',
        message: `This room is temporarily rate-limited after repeated failed PIN attempts. Try again in ${roomRateCheck.retryAfterSec}s.`,
      };
    }

    return this.withRoomLock(normalizedCode, () => {
      this.expireIfStale(normalizedCode);
      const record = this.rooms.get(normalizedCode);
      if (!record) {
        const expiredRecord = this.expiredRooms.get(normalizedCode);
        if (expiredRecord) {
          return {
            ok: false,
            errorCode: 'ROOM_EXPIRED',
            message: expiredRecord.reason,
          };
        }
        return {
          ok: false,
          errorCode: 'ROOM_NOT_FOUND',
          message: `No active cast room found for ID "${normalizedCode}". Verify the source computer is broadcasting.`,
        };
      }

      const existingMembership = this.socketMemberships.get(input.socketId);
      if (existingMembership?.role === 'source') {
        return {
          ok: false,
          errorCode: 'ROLE_CONFLICT',
          message:
            'This connection owns an active source broadcast room and cannot join as a receiver.',
        };
      }

      if (record.source.socketId === input.socketId) {
        return {
          ok: false,
          errorCode: 'ROLE_CONFLICT',
          message: 'Only one active source is allowed per room; the host cannot join as a receiver.',
        };
      }

      if (!this.authService.verifyPin(validatedPin, record.pinSalt, record.pinHash)) {
        this.authService.recordPinFailure(input.clientKey);
        this.authService.recordRoomPinFailure(normalizedCode);
        return {
          ok: false,
          errorCode: 'INVALID_PIN',
          message:
            'Incorrect room PIN. Check the PIN displayed on the source broadcaster.',
        };
      }

      this.authService.clearPinFailures(input.clientKey);

      if (record.locked) {
        return {
          ok: false,
          errorCode: 'ROOM_LOCKED',
          message: `Room "${normalizedCode}" is currently locked by the host and not accepting new receivers.`,
        };
      }

      const sanitizedDeviceId = this.sanitizeDeviceId(input.deviceId);
      const existingSameSocketReceiver = record.receivers.get(input.socketId);
      const alreadyInRoom = Boolean(existingSameSocketReceiver);

      const candidateReplacementSocketId = sanitizedDeviceId
        ? record.receiverDeviceIndex.get(sanitizedDeviceId)
        : undefined;
      const canReplaceExistingDeviceSlot = Boolean(
        candidateReplacementSocketId &&
          candidateReplacementSocketId !== input.socketId &&
          record.receivers.has(candidateReplacementSocketId),
      );

      // Atomic capacity check BEFORE mutating any receiver slot or device index
      const effectiveMaxReceivers = Math.min(
        record.maxReceivers,
        SERVER_MAX_RECEIVERS_PER_ROOM,
      );
      const maxTotalDevices = Math.min(
        1 + effectiveMaxReceivers,
        SERVER_MAX_TOTAL_DEVICES_PER_ROOM,
      );
      const currentTotalDevices = 1 + record.receivers.size;
      if (
        !alreadyInRoom &&
        !canReplaceExistingDeviceSlot &&
        currentTotalDevices >= maxTotalDevices
      ) {
        return {
          ok: false,
          errorCode: 'ROOM_FULL',
          message: `Room "${normalizedCode}" is full (${maxTotalDevices} total devices: 1 source + ${effectiveMaxReceivers} receivers).`,
        };
      }

      let replacedSocketId: string | undefined;
      if (canReplaceExistingDeviceSlot && candidateReplacementSocketId) {
        // Deduplicate: replace previous connection for the same physical/browser device without consuming an extra slot
        replacedSocketId = candidateReplacementSocketId;
        record.receivers.delete(candidateReplacementSocketId);
        record.recentReceiverProfiles.delete(candidateReplacementSocketId);
        const oldMember = record.receiverMemberIds.get(candidateReplacementSocketId);
        if (oldMember) {
          record.receiverMemberIds.set(input.socketId, oldMember);
          record.receiverMemberIds.delete(candidateReplacementSocketId);
        }
        const prevMembership = this.socketMemberships.get(candidateReplacementSocketId);
        if (prevMembership && prevMembership.code === record.code) {
          this.socketMemberships.delete(candidateReplacementSocketId);
        }
      }

      if (
        existingSameSocketReceiver?.deviceId &&
        existingSameSocketReceiver.deviceId !== sanitizedDeviceId &&
        record.receiverDeviceIndex.get(existingSameSocketReceiver.deviceId) === input.socketId
      ) {
        record.receiverDeviceIndex.delete(existingSameSocketReceiver.deviceId);
      }

      // If this receiver socket was previously in a different room, remove it cleanly
      let previousRoomDeparture: PreviousRoomDeparture | undefined;
      if (existingMembership && existingMembership.code !== normalizedCode) {
        const removedPrev = this.removeReceiver(existingMembership.code, input.socketId);
        if (removedPrev?.removed) {
          previousRoomDeparture = {
            code: existingMembership.code,
            broadcasterSocketId: removedPrev.snapshot.broadcaster.socketId,
            snapshot: removedPrev.snapshot,
          };
        }
      }

      const now = Date.now();
      const memberId = record.receiverMemberIds.get(input.socketId) || crypto.randomUUID();
      const receiver: ReceiverPeer = {
        socketId: input.socketId,
        deviceId: sanitizedDeviceId,
        deviceName: this.sanitizeDeviceName(input.deviceName, 'Receiver Computer'),
        platform: this.sanitizePlatform(input.platform),
        browser: this.sanitizeBrowserName(input.browser),
        joinedAt: existingSameSocketReceiver?.joinedAt || now,
      };

      record.receivers.set(input.socketId, receiver);
      record.receiverMemberIds.set(input.socketId, memberId);
      if (sanitizedDeviceId) {
        record.receiverDeviceIndex.set(sanitizedDeviceId, input.socketId);
      }
      if (replacedSocketId) {
        record.analytics.reconnectCount += 1;
      } else if (!alreadyInRoom) {
        record.analytics.totalReceiversJoined += 1;
      }
      record.analytics.peakReceivers = Math.max(
        record.analytics.peakReceivers,
        record.receivers.size,
      );
      record.lastActivityAt = now;
      this.socketMemberships.set(input.socketId, {
        roomId: record.roomId,
        code: record.code,
        role: 'receiver',
      });

      const authContext: RoomAuthContext = {
        socketId: input.socketId,
        memberId,
        roomId: record.roomId,
        code: record.code,
        role: 'receiver',
        issuedAt: now,
      };

      return {
        ok: true,
        snapshot: this.toSnapshot(record),
        receiver,
        added: !alreadyInRoom,
        replacedSocketId,
        authContext,
        authToken: this.authService.issueAuthToken(authContext),
        previousRoomDeparture,
      };
    });
  }

  public resumeSession(input: {
    socketId: string;
    authToken: unknown;
    deviceId?: unknown;
    deviceName?: unknown;
  }): RoomResumeSuccess | RoomFailure {
    if (typeof input.authToken !== 'string' || input.authToken.length < 16 || input.authToken.length > 2048) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Invalid or missing session resume token.',
      };
    }

    const authContext = this.authService.verifyAuthToken(input.authToken);
    if (!authContext) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Session resume token signature is invalid.',
      };
    }

    const now = Date.now();
    const normalizedCode = this.normalizeCode(authContext.code);
    return this.withRoomLock(normalizedCode, () => {
      this.expireIfStale(normalizedCode, now);
      const room = this.rooms.get(normalizedCode);
      if (!room) {
        const expired = this.expiredRooms.get(normalizedCode);
        return {
          ok: false,
          errorCode: expired ? 'ROOM_EXPIRED' : 'ROOM_NOT_FOUND',
          message:
            expired?.reason ||
            `Room "${normalizedCode}" has ended or is no longer active.`,
        };
      }

      if (
        typeof authContext.issuedAt !== 'number' ||
        (room.lifetimeMs > 0 && now - authContext.issuedAt > room.lifetimeMs)
      ) {
        return {
          ok: false,
          errorCode: 'ROOM_EXPIRED',
          message: 'Session token expired. Create or rejoin the room using the room code and PIN.',
        };
      }

      if (room.roomId !== authContext.roomId) {
        return {
          ok: false,
          errorCode: 'ROOM_EXPIRED',
          message: 'This resume token belongs to a previous closed session.',
        };
      }

      let previousRoomDeparture: PreviousRoomDeparture | undefined;
      const existingMembership = this.socketMemberships.get(input.socketId);
      if (existingMembership && existingMembership.code !== room.code) {
        if (existingMembership.role === 'source') {
          return {
            ok: false,
            errorCode: 'ROLE_CONFLICT',
            message: 'Close your active broadcast room before resuming another session.',
          };
        }
        const removedPrev = this.removeReceiver(existingMembership.code, input.socketId);
        if (removedPrev?.removed) {
          previousRoomDeparture = {
            code: existingMembership.code,
            broadcasterSocketId: removedPrev.snapshot.broadcaster.socketId,
            snapshot: removedPrev.snapshot,
          };
        }
      }

      if (authContext.role === 'source') {
        const timer = this.sourceDisconnectTimers.get(room.code);
        if (timer) {
          clearTimeout(timer);
          this.sourceDisconnectTimers.delete(room.code);
        }

        const previousSocketId = room.source.socketId;
        if (previousSocketId !== input.socketId) {
          const oldMembership = this.socketMemberships.get(previousSocketId);
          if (oldMembership && oldMembership.roomId === room.roomId && oldMembership.role === 'source') {
            this.socketMemberships.delete(previousSocketId);
          }
        }

        room.source.socketId = input.socketId;
        if (typeof input.deviceName === 'string' && input.deviceName.trim().length > 0) {
          room.source.deviceName = this.sanitizeDeviceName(input.deviceName, room.source.deviceName);
        }
        room.sourceDisconnectedAt = null;
        room.lastActivityAt = now;

        this.socketMemberships.set(input.socketId, {
          roomId: room.roomId,
          code: room.code,
          role: 'source',
        });

        const nextAuthContext: RoomAuthContext = {
          socketId: input.socketId,
          roomId: room.roomId,
          code: room.code,
          role: 'source',
          issuedAt: now,
        };

        return {
          ok: true,
          role: 'source',
          snapshot: this.toSnapshot(room),
          analytics: this.toAnalytics(room),
          previousSocketId,
          authContext: nextAuthContext,
          authToken: this.authService.issueAuthToken(nextAuthContext),
          previousRoomDeparture,
        };
      }

      const memberId = authContext.memberId || room.receiverMemberIds.get(authContext.socketId);
      if (
        room.kickedSocketIds.has(authContext.socketId) ||
        (memberId && room.kickedMemberIds.has(memberId))
      ) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED',
          message: 'Disconnected by the source broadcaster.',
        };
      }

      const previousSocketId = authContext.socketId;
      const priorProfile =
        room.receivers.get(previousSocketId) ||
        room.recentReceiverProfiles.get(previousSocketId);

      const sanitizedDeviceId =
        this.sanitizeDeviceId(input.deviceId) || priorProfile?.deviceId;

      const existingSameSocket = room.receivers.has(input.socketId);
      const hasActivePreviousSlot =
        previousSocketId !== input.socketId && room.receivers.has(previousSocketId);
      const indexedDeviceSocket = sanitizedDeviceId
        ? room.receiverDeviceIndex.get(sanitizedDeviceId)
        : undefined;
      const canReplaceIndexedDevice = Boolean(
        indexedDeviceSocket &&
          indexedDeviceSocket !== input.socketId &&
          indexedDeviceSocket !== previousSocketId &&
          room.receivers.has(indexedDeviceSocket),
      );

      // Atomic capacity check BEFORE mutating active slots
      const effectiveMaxReceivers = Math.min(
        room.maxReceivers,
        SERVER_MAX_RECEIVERS_PER_ROOM,
      );
      const maxTotalDevices = Math.min(
        1 + effectiveMaxReceivers,
        SERVER_MAX_TOTAL_DEVICES_PER_ROOM,
      );
      if (
        !existingSameSocket &&
        !hasActivePreviousSlot &&
        !canReplaceIndexedDevice &&
        1 + room.receivers.size >= maxTotalDevices
      ) {
        return {
          ok: false,
          errorCode: 'ROOM_FULL',
          message: `Room "${room.code}" is full (${maxTotalDevices} total devices: 1 source + ${effectiveMaxReceivers} receivers).`,
        };
      }

      let replacedSocketId: string | undefined;
      if (canReplaceIndexedDevice && indexedDeviceSocket) {
        replacedSocketId = indexedDeviceSocket;
        room.receivers.delete(indexedDeviceSocket);
        const idxMem = this.socketMemberships.get(indexedDeviceSocket);
        if (idxMem && idxMem.code === room.code && idxMem.role === 'receiver') {
          this.socketMemberships.delete(indexedDeviceSocket);
        }
      }

      if (hasActivePreviousSlot) {
        room.receivers.delete(previousSocketId);
        const oldMem = this.socketMemberships.get(previousSocketId);
        if (oldMem && oldMem.roomId === room.roomId && oldMem.role === 'receiver') {
          this.socketMemberships.delete(previousSocketId);
        }
      }

    const resolvedMemberId = memberId || crypto.randomUUID();
    const receiver: ReceiverPeer = {
      socketId: input.socketId,
      deviceId: sanitizedDeviceId,
      deviceName: this.sanitizeDeviceName(
        input.deviceName,
        priorProfile?.deviceName || 'Receiver Computer',
      ),
      platform: priorProfile?.platform || 'Unknown',
      browser: priorProfile?.browser || 'Browser',
      joinedAt: priorProfile?.joinedAt || now,
    };

    room.receivers.set(input.socketId, receiver);
    room.receiverMemberIds.delete(previousSocketId);
    room.receiverMemberIds.set(input.socketId, resolvedMemberId);
    if (sanitizedDeviceId) {
      room.receiverDeviceIndex.set(sanitizedDeviceId, input.socketId);
    }
    room.recentReceiverProfiles.delete(previousSocketId);
    room.recentReceiverProfiles.set(input.socketId, receiver);
    if (!existingSameSocket) {
      room.analytics.reconnectCount += 1;
    }
    room.analytics.peakReceivers = Math.max(
      room.analytics.peakReceivers,
      room.receivers.size,
    );
    room.lastActivityAt = now;
    this.socketMemberships.set(input.socketId, {
      roomId: room.roomId,
      code: room.code,
      role: 'receiver',
    });

    const nextAuthContext: RoomAuthContext = {
      socketId: input.socketId,
      memberId: resolvedMemberId,
      roomId: room.roomId,
      code: room.code,
      role: 'receiver',
      issuedAt: now,
    };

      return {
        ok: true,
        role: 'receiver',
        snapshot: this.toSnapshot(room),
        previousSocketId,
        replacedSocketId,
        receiver,
        added: !existingSameSocket,
        authContext: nextAuthContext,
        authToken: this.authService.issueAuthToken(nextAuthContext),
        previousRoomDeparture,
      };
    });
  }

  public updateDeviceName(
    socketId: string,
    code: string,
    rawDeviceName: unknown,
  ): { ok: true; snapshot: SessionSnapshot; deviceName: string; role: RoomRole } | RoomFailure {
    const auth = this.authorizeEvent(socketId, undefined, code);
    if (!auth.ok) {
      return auth;
    }

    if (typeof rawDeviceName !== 'string') {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'Device name must be a non-empty string.',
      };
    }

    const cleaned = this.stripControlChars(rawDeviceName).trim().slice(0, 64);
    if (cleaned.length === 0) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'Device name cannot be empty.',
      };
    }

    if (auth.membership.role === 'source') {
      auth.room.source.deviceName = cleaned;
    } else {
      const receiver = auth.room.receivers.get(socketId);
      if (!receiver) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED',
          message: 'Receiver is no longer registered in this room.',
        };
      }
      receiver.deviceName = cleaned;
      auth.room.recentReceiverProfiles.set(socketId, receiver);
    }

    auth.room.lastActivityAt = Date.now();
    return {
      ok: true,
      snapshot: this.toSnapshot(auth.room),
      deviceName: cleaned,
      role: auth.membership.role,
    };
  }

  public authorizeEvent(
    socketId: string,
    expectedRole?: RoomRole,
    rawCode?: string,
  ): RoomAuthorizationResult | RoomFailure {
    const membership = this.socketMemberships.get(socketId);
    if (!membership) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Socket is not an authenticated member of any active room.',
      };
    }

    if (rawCode && this.normalizeCode(rawCode) !== membership.code) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Socket is not authorized to access the specified room.',
      };
    }

    if (expectedRole && membership.role !== expectedRole) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: `This action requires the "${expectedRole}" role.`,
      };
    }

    const expiredEvent = this.expireIfStale(membership.code);
    if (expiredEvent) {
      return {
        ok: false,
        errorCode: 'ROOM_EXPIRED',
        message: expiredEvent.reason,
      };
    }

    const room = this.rooms.get(membership.code);
    if (!room) {
      this.socketMemberships.delete(socketId);
      const expiredRecord = this.expiredRooms.get(membership.code);
      return {
        ok: false,
        errorCode: expiredRecord ? 'ROOM_EXPIRED' : 'ROOM_NOT_FOUND',
        message: expiredRecord?.reason || 'The target room is no longer active.',
      };
    }

    if (membership.role === 'source' && room.source.socketId !== socketId) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Source ownership mismatch for this room.',
      };
    }

    if (membership.role === 'receiver' && !room.receivers.has(socketId)) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Receiver is no longer registered in this room.',
      };
    }

    return {
      ok: true,
      room,
      membership,
    };
  }

  public authorizePeerRelay(
    senderSocketId: string,
    targetSocketId: string,
    requiredSenderRole?: RoomRole,
  ): RoomAuthorizationResult | RoomFailure {
    const auth = this.authorizeEvent(senderSocketId, requiredSenderRole);
    if (!auth.ok) {
      return auth;
    }

    const targetMembership = this.socketMemberships.get(targetSocketId);
    if (!targetMembership || targetMembership.code !== auth.room.code) {
      return {
        ok: false,
        errorCode: 'PEER_NOT_FOUND',
        message: 'Target peer is not connected to this room.',
      };
    }

    // Enforce source <-> receiver direction (receivers cannot relay directly to other receivers)
    if (auth.membership.role === 'source' && targetMembership.role !== 'receiver') {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Source can only relay WebRTC signaling to a connected receiver.',
      };
    }

    if (auth.membership.role === 'receiver' && targetMembership.role !== 'source') {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Receivers can only relay WebRTC signaling to the room source.',
      };
    }

    return auth;
  }

  public updateStreamMetadata(
    socketId: string,
    code: string,
    stream: StreamMetadata,
  ): { ok: true; snapshot: SessionSnapshot; wasActive: boolean } | RoomFailure {
    const auth = this.authorizeEvent(socketId, 'source', code);
    if (!auth.ok) {
      return auth;
    }

    const wasActive = auth.room.stream.active;

    const sanitizeDimension = (value: unknown): number | undefined => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      const rounded = Math.round(value);
      return rounded >= 1 && rounded <= 16384 ? rounded : undefined;
    };

    const sanitizeFrameRate = (value: unknown): number | undefined => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
      return value >= 0 && value <= 240 ? Math.round(value * 100) / 100 : undefined;
    };

    auth.room.stream = {
      active: Boolean(stream.active),
      hasAudio: Boolean(stream.hasAudio),
      audioMuted:
        typeof stream.audioMuted === 'boolean' ? stream.audioMuted : undefined,
      width: sanitizeDimension(stream.width),
      height: sanitizeDimension(stream.height),
      frameRate: sanitizeFrameRate(stream.frameRate),
      displaySurface:
        typeof stream.displaySurface === 'string'
          ? this.stripControlChars(stream.displaySurface).trim().slice(0, 32) || undefined
          : undefined,
    };
    auth.room.lastActivityAt = Date.now();

    return {
      ok: true,
      snapshot: this.toSnapshot(auth.room),
      wasActive,
    };
  }

  public touchActivity(socketId: string, code?: string): void {
    const auth = this.authorizeEvent(socketId, undefined, code);
    if (auth.ok) {
      auth.room.lastActivityAt = Date.now();
    }
  }

  public updateMaxReceivers(
    sourceSocketId: string,
    code: string,
    requestedMaxReceivers: unknown,
  ): { ok: true; snapshot: SessionSnapshot } | RoomFailure {
    const auth = this.authorizeEvent(sourceSocketId, 'source', code);
    if (!auth.ok) {
      return auth;
    }

    const serverMaxReceivers = Math.min(
      getServerConfig().roomSettings.maxReceiversPerRoom,
      SERVER_MAX_RECEIVERS_PER_ROOM,
    );
    if (
      typeof requestedMaxReceivers !== 'number' ||
      !Number.isInteger(requestedMaxReceivers) ||
      requestedMaxReceivers < 1 ||
      requestedMaxReceivers > serverMaxReceivers
    ) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: `Receiver limit must be an integer between 1 and ${serverMaxReceivers}.`,
      };
    }

    return this.withRoomLock(auth.room.code, () => {
      if (requestedMaxReceivers < auth.room.receivers.size) {
        return {
          ok: false,
          errorCode: 'VALIDATION_ERROR',
          message: `Cannot reduce receiver limit to ${requestedMaxReceivers} while ${auth.room.receivers.size} receivers are connected. Disconnect receivers first.`,
        };
      }

      auth.room.maxReceivers = Math.min(requestedMaxReceivers, SERVER_MAX_RECEIVERS_PER_ROOM);
      auth.room.lastActivityAt = Date.now();

      return {
        ok: true,
        snapshot: this.toSnapshot(auth.room),
      };
    });
  }

  public updateRoomLifetime(
    sourceSocketId: string,
    code: string,
    requestedLifetimeMs: unknown,
    isAdmin = false,
  ): { ok: true; snapshot: SessionSnapshot } | RoomFailure {
    const auth = this.authorizeEvent(sourceSocketId, 'source', code);
    if (!auth.ok) {
      return auth;
    }

    const lifetimeResult = this.resolveRequestedLifetime(
      requestedLifetimeMs,
      Boolean(isAdmin || auth.room.ownerIsAdmin),
    );
    if (!lifetimeResult.ok) {
      return lifetimeResult;
    }

    auth.room.lifetimeMs = lifetimeResult.lifetimeMs;
    auth.room.lastActivityAt = Date.now();

    return {
      ok: true,
      snapshot: this.toSnapshot(auth.room),
    };
  }

  public toggleRoomLock(
    sourceSocketId: string,
    code: string,
    requestedLocked: unknown,
  ): { ok: true; snapshot: SessionSnapshot; locked: boolean } | RoomFailure {
    const auth = this.authorizeEvent(sourceSocketId, 'source', code);
    if (!auth.ok) {
      return auth;
    }

    if (typeof requestedLocked !== 'boolean') {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'Room lock state must be a boolean value.',
      };
    }

    auth.room.locked = requestedLocked;
    auth.room.lastActivityAt = Date.now();
    return {
      ok: true,
      snapshot: this.toSnapshot(auth.room),
      locked: requestedLocked,
    };
  }

  public recordQualitySample(
    sourceSocketId: string,
    code: string,
    score: unknown,
  ): { ok: true; analytics: RoomSessionAnalytics } | RoomFailure {
    const auth = this.authorizeEvent(sourceSocketId, 'source', code);
    if (!auth.ok) {
      return auth;
    }

    if (
      typeof score !== 'number' ||
      !Number.isInteger(score) ||
      score < 1 ||
      score > 4
    ) {
      return {
        ok: false,
        errorCode: 'VALIDATION_ERROR',
        message: 'Quality score must be an integer between 1 and 4.',
      };
    }

    // Keep accumulated sample sums bounded cleanly over very long sessions
    if (auth.room.analytics.qualitySamplesCount >= 10_000) {
      auth.room.analytics.qualityScoreSum = Math.round(
        (auth.room.analytics.qualityScoreSum / auth.room.analytics.qualitySamplesCount) *
          1000,
      );
      auth.room.analytics.qualitySamplesCount = 1000;
    }

    auth.room.analytics.qualityScoreSum += score;
    auth.room.analytics.qualitySamplesCount += 1;

    return {
      ok: true,
      analytics: this.toAnalytics(auth.room),
    };
  }

  public getRoomAnalytics(
    requesterSocketId: string,
    code: string,
  ): { ok: true; analytics: RoomSessionAnalytics } | RoomFailure {
    const auth = this.authorizeEvent(requesterSocketId, 'source', code);
    if (!auth.ok) {
      return auth;
    }

    return {
      ok: true,
      analytics: this.toAnalytics(auth.room),
    };
  }

  public getRoomAnalyticsByCodeForSource(
    rawCode: string,
  ): RoomSessionAnalytics | null {
    const room = this.rooms.get(this.normalizeCode(rawCode));
    return room ? this.toAnalytics(room) : null;
  }

  public kickReceiver(
    sourceSocketId: string,
    code: string,
    targetSocketId: string,
  ): { ok: true; snapshot: SessionSnapshot } | RoomFailure {
    const auth = this.authorizeEvent(sourceSocketId, 'source', code);
    if (!auth.ok) {
      return auth;
    }

    const targetReceiver = auth.room.receivers.get(targetSocketId);
    if (!targetReceiver) {
      return {
        ok: false,
        errorCode: 'PEER_NOT_FOUND',
        message: 'Target receiver is not in this room.',
      };
    }

    const memberId = auth.room.receiverMemberIds.get(targetSocketId);
    if (memberId) {
      auth.room.kickedMemberIds.add(memberId);
      auth.room.receiverMemberIds.delete(targetSocketId);
    }
    if (
      targetReceiver.deviceId &&
      auth.room.receiverDeviceIndex.get(targetReceiver.deviceId) === targetSocketId
    ) {
      auth.room.receiverDeviceIndex.delete(targetReceiver.deviceId);
    }
    auth.room.receivers.delete(targetSocketId);
    auth.room.recentReceiverProfiles.delete(targetSocketId);
    auth.room.kickedSocketIds.add(targetSocketId);
    const targetMembership = this.socketMemberships.get(targetSocketId);
    if (targetMembership && targetMembership.code === auth.room.code) {
      this.socketMemberships.delete(targetSocketId);
    }
    auth.room.lastActivityAt = Date.now();

    return {
      ok: true,
      snapshot: this.toSnapshot(auth.room),
    };
  }

  public removeReceiver(
    rawCode: string,
    receiverSocketId: string,
    preserveProfileForResume = false,
  ): { snapshot: SessionSnapshot; removed: boolean } | null {
    const code = this.normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) {
      return null;
    }

    const existing = room.receivers.get(receiverSocketId);
    const removed = room.receivers.delete(receiverSocketId);
    if (
      existing?.deviceId &&
      room.receiverDeviceIndex.get(existing.deviceId) === receiverSocketId
    ) {
      room.receiverDeviceIndex.delete(existing.deviceId);
    }
    if (preserveProfileForResume && existing) {
      room.recentReceiverProfiles.set(receiverSocketId, existing);
    } else {
      room.recentReceiverProfiles.delete(receiverSocketId);
      room.receiverMemberIds.delete(receiverSocketId);
    }
    const membership = this.socketMemberships.get(receiverSocketId);
    if (membership && membership.code === code && membership.role === 'receiver') {
      this.socketMemberships.delete(receiverSocketId);
    }
    if (removed) {
      room.lastActivityAt = Date.now();
    }

    return {
      snapshot: this.toSnapshot(room),
      removed,
    };
  }

  public closeRoomBySource(
    sourceSocketId: string,
    rawCode?: string,
  ): {
    snapshot: SessionSnapshot;
    receiverSocketIds: string[];
    finalAnalytics: RoomSessionAnalytics;
  } | null {
    const membership = this.socketMemberships.get(sourceSocketId);
    if (!membership || membership.role !== 'source') {
      return null;
    }

    if (rawCode && this.normalizeCode(rawCode) !== membership.code) {
      return null;
    }

    const closed = this.deleteRoom(membership.code);
    if (closed) {
      this.recordExpiredRoom(
        membership.code,
        'closed',
        'This cast room was ended by the source broadcaster.',
      );
    }
    return closed;
  }

  public handleDisconnect(socketId: string):
    | {
        role: 'source-reconnecting';
        snapshot: SessionSnapshot;
        graceMs: number;
      }
    | {
        role: 'receiver';
        snapshot: SessionSnapshot;
      }
    | null {
    const membership = this.socketMemberships.get(socketId);
    if (!membership) {
      return null;
    }

    if (membership.role === 'source') {
      const room = this.rooms.get(membership.code);
      this.socketMemberships.delete(socketId);
      if (!room || room.source.socketId !== socketId) {
        return null;
      }

      const existingTimer = this.sourceDisconnectTimers.get(room.code);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      room.sourceDisconnectedAt = Date.now();
      const timer = setTimeout(() => {
        this.sourceDisconnectTimers.delete(room.code);
        const current = this.rooms.get(room.code);
        if (!current || current.sourceDisconnectedAt === null) {
          return;
        }
        const closed = this.deleteRoom(room.code);
        if (!closed) return;
        const reason =
          'The source device lost network connectivity and did not reconnect within 25 seconds.';
        this.recordExpiredRoom(room.code, 'closed', reason);
        this.onRoomExpired?.({
          code: room.code,
          roomId: room.roomId,
          reason,
          memberSocketIds: closed.receiverSocketIds,
        });
      }, SOURCE_RECONNECT_GRACE_MS);
      timer.unref();
      this.sourceDisconnectTimers.set(room.code, timer);

      return {
        role: 'source-reconnecting',
        snapshot: this.toSnapshot(room),
        graceMs: SOURCE_RECONNECT_GRACE_MS,
      };
    }

    const result = this.removeReceiver(membership.code, socketId, true);
    if (!result || !result.removed) return null;
    return {
      role: 'receiver',
      snapshot: result.snapshot,
    };
  }

  private getRoomExpirationReason(room: RoomRecord, now: number): string | null {
    const { roomIdleTtlMs } = getServerConfig().roomSettings;
    const idleElapsed = now - room.lastActivityAt;
    const totalElapsed = now - room.createdAt;
    const isAbandonedIdle =
      !room.stream.active &&
      room.receivers.size === 0 &&
      idleElapsed >= roomIdleTtlMs;
    const isPastMaxLifetime =
      room.lifetimeMs > 0 &&
      totalElapsed >= room.lifetimeMs &&
      idleElapsed >= roomIdleTtlMs;

    if (isAbandonedIdle) {
      return 'This room expired automatically after inactivity.';
    }
    if (isPastMaxLifetime) {
      return 'This room expired after exceeding maximum session lifetime.';
    }
    return null;
  }

  private expireIfStale(rawCode: string, now = Date.now()): ExpiredRoomEvent | null {
    const code = this.normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room) return null;

    const reason = this.getRoomExpirationReason(room, now);
    if (!reason) return null;

    const deleted = this.deleteRoom(code);
    if (!deleted) return null;

    this.recordExpiredRoom(code, 'expired', reason, now);
    const event: ExpiredRoomEvent = {
      code: room.code,
      roomId: room.roomId,
      reason,
      memberSocketIds: [
        deleted.snapshot.broadcaster.socketId,
        ...deleted.receiverSocketIds,
      ],
    };
    this.onRoomExpired?.(event);
    return event;
  }

  public sweepAbandonedRooms(now = Date.now()): ExpiredRoomEvent[] {
    const expired: ExpiredRoomEvent[] = [];

    for (const room of Array.from(this.rooms.values())) {
      const event = this.expireIfStale(room.code, now);
      if (event) {
        expired.push(event);
      }
    }

    // Prune stale expiration tombstones older than 24 hours
    const tombstoneMaxAgeMs = 24 * 60 * 60 * 1000;
    for (const [code, record] of this.expiredRooms.entries()) {
      if (now - record.expiredAt > tombstoneMaxAgeMs) {
        this.expiredRooms.delete(code);
      }
    }

    return expired;
  }

  public getRoomSnapshot(rawCode: string): SessionSnapshot | null {
    const normalized = this.normalizeCode(rawCode);
    this.expireIfStale(normalized);
    const room = this.rooms.get(normalized);
    return room ? this.toSnapshot(room) : null;
  }

  public getRoomLookupStatus(rawCode: string): RoomLookupStatus {
    const normalized = this.normalizeCode(rawCode);
    this.expireIfStale(normalized);
    const room = this.rooms.get(normalized);
    if (room) {
      return {
        status: 'active',
        snapshot: this.toSnapshot(room),
      };
    }

    const expiredRecord = this.expiredRooms.get(normalized);
    if (expiredRecord) {
      return {
        status: expiredRecord.status,
        code: normalized,
        reason: expiredRecord.reason,
        expiredAt: expiredRecord.expiredAt,
      };
    }

    return {
      status: 'not_found',
      code: normalized,
    };
  }

  public getMembership(socketId: string): SocketMembership | null {
    return this.socketMemberships.get(socketId) ?? null;
  }

  public verifyIceAccessToken(
    rawToken: string,
  ): { ok: true; code: string; role: RoomRole } | RoomFailure {
    const trimmed = rawToken.trim();
    if (!trimmed || trimmed.length < 16 || trimmed.length > 2048) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Invalid room authorization token.',
      };
    }

    const context = this.authService.verifyAuthToken(trimmed);
    if (!context) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Invalid or tampered room authorization token.',
      };
    }

    const now = Date.now();
    const normalizedCode = this.normalizeCode(context.code);
    this.expireIfStale(normalizedCode, now);
    const room = this.rooms.get(normalizedCode);
    if (!room || room.roomId !== context.roomId) {
      return {
        ok: false,
        errorCode: 'ROOM_NOT_FOUND',
        message: 'Room is no longer active.',
      };
    }

    if (
      typeof context.issuedAt !== 'number' ||
      (room.lifetimeMs > 0 && now - context.issuedAt > room.lifetimeMs)
    ) {
      return {
        ok: false,
        errorCode: 'ROOM_EXPIRED',
        message: 'Room authorization token has expired.',
      };
    }

    if (context.role === 'receiver') {
      const memberId = context.memberId || room.receiverMemberIds.get(context.socketId);
      if (
        room.kickedSocketIds.has(context.socketId) ||
        (memberId && room.kickedMemberIds.has(memberId))
      ) {
        return {
          ok: false,
          errorCode: 'UNAUTHORIZED',
          message: 'Receiver access to this room was revoked.',
        };
      }
    }

    return {
      ok: true,
      code: room.code,
      role: context.role,
    };
  }

  public getStats(): {
    activeRooms: number;
    totalReceivers: number;
    maxReceiversPerRoom: number;
    maxTotalDevicesPerRoom: number;
    roomIdleTtlMs: number;
    roomMaxLifetimeMs: number;
  } {
    let totalReceivers = 0;
    for (const room of this.rooms.values()) {
      totalReceivers += room.receivers.size;
    }
    const {
      maxReceiversPerRoom,
      maxTotalDevicesPerRoom,
      roomIdleTtlMs,
      roomMaxLifetimeMs,
    } = getServerConfig().roomSettings;
    return {
      activeRooms: this.rooms.size,
      totalReceivers,
      maxReceiversPerRoom,
      maxTotalDevicesPerRoom,
      roomIdleTtlMs,
      roomMaxLifetimeMs,
    };
  }

  private recordExpiredRoom(
    code: string,
    status: 'expired' | 'closed',
    reason: string,
    expiredAt = Date.now(),
  ): void {
    if (this.expiredRooms.size >= 1000) {
      const oldestKey = this.expiredRooms.keys().next().value;
      if (oldestKey) {
        this.expiredRooms.delete(oldestKey);
      }
    }
    this.expiredRooms.set(this.normalizeCode(code), {
      code: this.normalizeCode(code),
      status,
      reason,
      expiredAt,
    });
  }

  private deleteRoom(rawCode: string): {
    snapshot: SessionSnapshot;
    receiverSocketIds: string[];
    finalAnalytics: RoomSessionAnalytics;
  } | null {
    const code = this.normalizeCode(rawCode);
    const disconnectTimer = this.sourceDisconnectTimers.get(code);
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      this.sourceDisconnectTimers.delete(code);
    }

    const room = this.rooms.get(code);
    if (!room) {
      return null;
    }

    const finalAnalytics = this.toAnalytics(room, Date.now());
    const snapshot = this.toSnapshot(room);
    const receiverSocketIds = Array.from(room.receivers.keys());

    this.socketMemberships.delete(room.source.socketId);
    for (const receiverId of receiverSocketIds) {
      this.socketMemberships.delete(receiverId);
    }
    this.rooms.delete(code);

    return { snapshot, receiverSocketIds, finalAnalytics };
  }

  private computeExpiresAt(room: RoomRecord): number | null {
    const { roomIdleTtlMs } = getServerConfig().roomSettings;
    const maxDeadline = room.lifetimeMs > 0 ? room.createdAt + room.lifetimeMs : null;
    if (!room.stream.active && room.receivers.size === 0) {
      const idleDeadline = room.lastActivityAt + roomIdleTtlMs;
      return maxDeadline !== null ? Math.min(idleDeadline, maxDeadline) : idleDeadline;
    }
    return maxDeadline;
  }

  private toAnalytics(
    room: RoomRecord,
    endedAt: number | null = null,
  ): RoomSessionAnalytics {
    const effectiveEnd = endedAt ?? Date.now();
    let averageQualityLabel: AverageQualityLabel | null = null;
    if (room.analytics.qualitySamplesCount >= 3) {
      const avgScore =
        room.analytics.qualityScoreSum / room.analytics.qualitySamplesCount;
      if (avgScore >= 3.5) averageQualityLabel = 'Excellent';
      else if (avgScore >= 2.5) averageQualityLabel = 'Good';
      else if (avgScore >= 1.75) averageQualityLabel = 'Fair';
      else averageQualityLabel = 'Poor';
    }

    return {
      startedAt: room.createdAt,
      endedAt,
      durationMs: Math.max(0, effectiveEnd - room.createdAt),
      peakReceivers: room.analytics.peakReceivers,
      totalReceiversJoined: room.analytics.totalReceiversJoined,
      reconnectCount: room.analytics.reconnectCount,
      qualitySamplesCount: room.analytics.qualitySamplesCount,
      averageQualityLabel,
    };
  }

  private toSnapshot(room: RoomRecord): SessionSnapshot {
    const { roomIdleTtlMs } = getServerConfig().roomSettings;
    const effectiveMaxReceivers = Math.min(
      room.maxReceivers,
      SERVER_MAX_RECEIVERS_PER_ROOM,
    );
    const maxTotalDevices = Math.min(
      1 + effectiveMaxReceivers,
      SERVER_MAX_TOTAL_DEVICES_PER_ROOM,
    );
    return {
      roomId: room.roomId,
      code: room.code,
      createdAt: room.createdAt,
      lastActivityAt: room.lastActivityAt,
      expiresAt: this.computeExpiresAt(room),
      lifetimeMs: room.lifetimeMs,
      idleTtlMs: roomIdleTtlMs,
      locked: room.locked,
      maxReceivers: effectiveMaxReceivers,
      totalDevices: 1 + room.receivers.size,
      maxTotalDevices,
      ownerUid: room.ownerUid,
      ownerName: room.ownerName,
      broadcaster: { ...room.source },
      stream: { ...room.stream },
      receivers: Array.from(room.receivers.values()),
    };
  }
}
