import crypto from 'node:crypto';
import os from 'node:os';
import { Router, type Request, type Response } from 'express';
import {
  isFirebaseAuthConfigured,
  requireFirebaseAuth,
  type AuthenticatedRequest,
} from '../auth/firebaseAuth.ts';
import {
  getPublicStunIceServers,
  getRuntimeIceServers,
  getServerConfig,
  hasTurnServerConfigured,
} from '../config/env.ts';
import { createHttpRateLimiter } from '../middleware/rateLimit.ts';
import type { RoomService } from '../services/roomService.ts';

function getLocalNetworkAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const ifaceList of Object.values(interfaces)) {
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function extractRoomAuthToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }
  const customHeader = req.headers['x-room-auth'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }
  return null;
}

interface PhoneOtpBucket {
  count: number;
  resetAt: number;
}

export function createApiRouter(roomService: RoomService): Router {
  const router = Router();
  const healthLimiter = createHttpRateLimiter({
    keyPrefix: 'api-health',
    windowMs: 60_000,
    maxRequests: 120,
  });
  const iceConfigLimiter = createHttpRateLimiter({
    keyPrefix: 'api-ice',
    windowMs: 60_000,
    maxRequests: 40,
  });
  const sessionLookupLimiter = createHttpRateLimiter({
    keyPrefix: 'api-session-lookup',
    windowMs: 60_000,
    maxRequests: 30,
  });
  const authSessionLimiter = createHttpRateLimiter({
    keyPrefix: 'api-auth-session',
    windowMs: 60_000,
    maxRequests: 60,
  });
  const otpIpLimiter = createHttpRateLimiter({
    keyPrefix: 'api-otp-ip',
    windowMs: 10 * 60_000,
    maxRequests: 5,
  });
  const phoneOtpBuckets = new Map<string, PhoneOtpBucket>();

  router.get('/health', healthLimiter, (_req: Request, res: Response) => {
    const stats = roomService.getStats();
    const config = getServerConfig();
    res.json({
      status: 'ok',
      service: 'multicast-signaling',
      environment: config.nodeEnv,
      uptimeSeconds: Math.floor(process.uptime()),
      activeSessions: stats.activeRooms,
      connectedReceivers: stats.totalReceivers,
      maxReceiversPerRoom: stats.maxReceiversPerRoom,
      maxTotalDevicesPerRoom: stats.maxTotalDevicesPerRoom,
      roomIdleTtlMs: config.roomSettings.roomIdleTtlMs,
      roomMaxLifetimeMs: config.roomSettings.roomMaxLifetimeMs,
      firebaseAuthConfigured: isFirebaseAuthConfigured(),
      lanAddresses: getLocalNetworkAddresses(),
      port: config.port,
      corsAllowedOriginsCount: config.corsOrigins.length,
      iceServerCount: config.iceServers.length,
      turnConfigured: hasTurnServerConfigured(),
    });
  });

  router.get(
    '/auth/session',
    authSessionLimiter,
    requireFirebaseAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const config = getServerConfig();
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.json({
        ok: true,
        user: req.firebaseUser,
        identityVerified: Boolean(req.identityVerified),
        roomLimits: {
          maxReceiversPerRoom: config.roomSettings.maxReceiversPerRoom,
          maxTotalDevicesPerRoom: config.roomSettings.maxTotalDevicesPerRoom,
          roomIdleTtlMs: config.roomSettings.roomIdleTtlMs,
          roomMaxLifetimeMs: config.roomSettings.roomMaxLifetimeMs,
        },
      });
    },
  );

  router.post('/auth/otp-preflight', otpIpLimiter, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const rawPhone =
      typeof req.body?.phoneNumber === 'string' ? req.body.phoneNumber.trim() : '';
    if (!/^\+[1-9]\d{6,14}$/.test(rawPhone)) {
      res.status(400).json({
        error: 'Enter a valid international mobile number in E.164 format (e.g. +14155550100).',
        code: 'INVALID_PHONE_NUMBER',
      });
      return;
    }

    // Rate limit per hashed phone number without storing raw phone numbers in memory
    const phoneHash = crypto.createHash('sha256').update(rawPhone).digest('hex');
    const now = Date.now();
    const windowMs = 10 * 60_000;
    const maxPerPhone = 3;

    if (phoneOtpBuckets.size > 5000) {
      for (const [key, bucket] of phoneOtpBuckets.entries()) {
        if (bucket.resetAt <= now) phoneOtpBuckets.delete(key);
      }
    }

    let bucket = phoneOtpBuckets.get(phoneHash);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 1, resetAt: now + windowMs };
      phoneOtpBuckets.set(phoneHash, bucket);
    } else {
      bucket.count += 1;
    }

    if (bucket.count > maxPerPhone) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Too many verification code requests for this phone number. Try again in ${retryAfterSec}s.`,
        code: 'OTP_RATE_LIMITED',
      });
      return;
    }

    res.json({
      ok: true,
      allowed: true,
      remainingForNumber: Math.max(0, maxPerPhone - bucket.count),
    });
  });

  router.get('/ice-config', iceConfigLimiter, (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');

    const token = extractRoomAuthToken(req);
    if (token) {
      const verification = roomService.verifyIceAccessToken(token);
      if (!verification.ok) {
        res.status(401).json({
          error: verification.message,
          code: verification.errorCode,
        });
        return;
      }

      res.json({
        iceServers: getRuntimeIceServers(),
        turnAuthorized: hasTurnServerConfigured(),
      });
      return;
    }

    // Never expose TURN credentials or private relay URLs to unauthenticated callers
    res.json({
      iceServers: getPublicStunIceServers(),
      turnAuthorized: false,
    });
  });

  router.get('/sessions/:code', sessionLookupLimiter, (req: Request, res: Response) => {
    const rawCode = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    const normalized = (rawCode || '').trim().toUpperCase();
    if (!roomService.isValidCodeFormat(normalized)) {
      res.status(400).json({
        exists: false,
        code: 'INVALID_CODE',
        error: 'Room ID must be 6 alphanumeric characters.',
      });
      return;
    }

    const lookup = roomService.getRoomLookupStatus(normalized);
    if (lookup.status === 'active') {
      const snapshot = lookup.snapshot;
      res.json({
        exists: true,
        status: 'active',
        code: snapshot.code,
        requiresPin: true,
        broadcaster: {
          deviceName: snapshot.broadcaster.deviceName,
          platform: snapshot.broadcaster.platform,
        },
        streamActive: snapshot.stream.active,
        receiverCount: snapshot.receivers.length,
        maxReceivers: snapshot.maxReceivers,
        totalDevices: snapshot.totalDevices,
        maxTotalDevices: snapshot.maxTotalDevices,
        isFull:
          snapshot.receivers.length >= snapshot.maxReceivers ||
          snapshot.totalDevices >= snapshot.maxTotalDevices,
        isLocked: snapshot.locked,
        expiresAt: snapshot.expiresAt,
        lifetimeMs: snapshot.lifetimeMs,
        idleTtlMs: snapshot.idleTtlMs,
      });
      return;
    }

    if (lookup.status === 'not_found') {
      res.status(404).json({
        exists: false,
        status: 'not_found',
        code: 'ROOM_NOT_FOUND',
        error: `No active cast room found for ID "${normalized}".`,
      });
      return;
    }

    res.status(410).json({
      exists: false,
      status: lookup.status,
      code: 'ROOM_EXPIRED',
      error: lookup.reason,
      expiredAt: lookup.expiredAt,
    });
  });

  return router;
}
