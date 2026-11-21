import crypto from 'node:crypto';
import { getServerConfig } from '../config/env.ts';

export type RoomRole = 'source' | 'receiver';

export interface RoomAuthContext {
  socketId: string;
  memberId?: string;
  roomId: string;
  code: string;
  role: RoomRole;
  issuedAt: number;
}

interface RateLimitBucket {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
}

const PIN_RATE_WINDOW_MS = 60_000;
const PIN_MAX_FAILURES = 5;
const PIN_BLOCK_DURATION_MS = 60_000;

const PIN_ROOM_RATE_WINDOW_MS = 60_000;
const PIN_ROOM_MAX_FAILURES = 20;
const PIN_ROOM_BLOCK_DURATION_MS = 60_000;
const MAX_RATE_BUCKETS = 10_000;

export class RoomAuthService {
  private pinFailureBuckets: Map<string, RateLimitBucket> = new Map();
  private roomFailureBuckets: Map<string, RateLimitBucket> = new Map();

  public generateSecurePin(digits = 4): string {
    const min = 10 ** (digits - 1);
    const max = 10 ** digits;
    return String(crypto.randomInt(min, max));
  }

  public isValidPinFormat(pin: string): boolean {
    return /^\d{4,6}$/.test(pin.trim());
  }

  public hashPin(pin: string, salt: string): string {
    return crypto
      .createHmac('sha256', getServerConfig().roomSettings.roomAuthSecret)
      .update(`${salt}:${pin.trim()}`)
      .digest('hex');
  }

  public verifyPin(candidatePin: string, salt: string, expectedHash: string): boolean {
    const candidateHash = this.hashPin(candidatePin, salt);
    const a = Buffer.from(candidateHash, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  }

  public issueAuthToken(context: RoomAuthContext): string {
    const payload = Buffer.from(JSON.stringify(context), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', getServerConfig().roomSettings.roomAuthSecret)
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  public verifyAuthToken(token: string): RoomAuthContext | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, providedSig] = parts;
    const expectedSig = crypto
      .createHmac('sha256', getServerConfig().roomSettings.roomAuthSecret)
      .update(payload)
      .digest('base64url');

    const a = Buffer.from(providedSig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    try {
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as RoomAuthContext;
      if (
        !decoded.socketId ||
        !decoded.roomId ||
        !decoded.code ||
        (decoded.role !== 'source' && decoded.role !== 'receiver')
      ) {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  private pruneBuckets(map: Map<string, RateLimitBucket>, windowMs: number, now: number): void {
    if (map.size < MAX_RATE_BUCKETS) return;
    for (const [key, bucket] of map.entries()) {
      if (bucket.blockedUntil <= now && now - bucket.windowStartedAt > windowMs) {
        map.delete(key);
      }
    }
    if (map.size >= MAX_RATE_BUCKETS) {
      const oldest = map.keys().next().value;
      if (oldest) map.delete(oldest);
    }
  }

  private checkBucket(
    map: Map<string, RateLimitBucket>,
    key: string,
    windowMs: number,
  ): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const bucket = map.get(key);
    if (!bucket) {
      return { allowed: true, retryAfterSec: 0 };
    }
    if (bucket.blockedUntil > now) {
      return {
        allowed: false,
        retryAfterSec: Math.ceil((bucket.blockedUntil - now) / 1000),
      };
    }
    if (now - bucket.windowStartedAt > windowMs) {
      map.delete(key);
      return { allowed: true, retryAfterSec: 0 };
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  private recordFailure(
    map: Map<string, RateLimitBucket>,
    key: string,
    windowMs: number,
    maxFailures: number,
    blockDurationMs: number,
  ): void {
    const now = Date.now();
    this.pruneBuckets(map, windowMs, now);
    const existing = map.get(key);
    if (!existing || now - existing.windowStartedAt > windowMs) {
      map.set(key, {
        failures: 1,
        windowStartedAt: now,
        blockedUntil: 0,
      });
      return;
    }

    existing.failures += 1;
    if (existing.failures >= maxFailures) {
      existing.blockedUntil = now + blockDurationMs;
    }
  }

  public checkPinRateLimit(clientKey: string): { allowed: boolean; retryAfterSec: number } {
    return this.checkBucket(this.pinFailureBuckets, clientKey, PIN_RATE_WINDOW_MS);
  }

  public recordPinFailure(clientKey: string): void {
    this.recordFailure(
      this.pinFailureBuckets,
      clientKey,
      PIN_RATE_WINDOW_MS,
      PIN_MAX_FAILURES,
      PIN_BLOCK_DURATION_MS,
    );
  }

  public clearPinFailures(clientKey: string): void {
    this.pinFailureBuckets.delete(clientKey);
  }

  public checkRoomPinRateLimit(roomCode: string): { allowed: boolean; retryAfterSec: number } {
    return this.checkBucket(this.roomFailureBuckets, roomCode, PIN_ROOM_RATE_WINDOW_MS);
  }

  public recordRoomPinFailure(roomCode: string): void {
    this.recordFailure(
      this.roomFailureBuckets,
      roomCode,
      PIN_ROOM_RATE_WINDOW_MS,
      PIN_ROOM_MAX_FAILURES,
      PIN_ROOM_BLOCK_DURATION_MS,
    );
  }
}
