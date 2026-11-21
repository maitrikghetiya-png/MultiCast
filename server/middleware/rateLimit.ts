import type { NextFunction, Request, Response } from 'express';
import { getServerConfig } from '../config/env.ts';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface HttpRateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

const MAX_BUCKETS = 10_000;

export function getHttpClientIp(req: Request): string {
  const { trustProxy } = getServerConfig();
  if (trustProxy && req.ip) {
    return req.ip;
  }
  return req.socket.remoteAddress || 'unknown';
}

export function createHttpRateLimiter(options: HttpRateLimiterOptions) {
  const buckets = new Map<string, RateLimitEntry>();

  const pruneExpired = (now: number) => {
    if (buckets.size < MAX_BUCKETS) return;
    for (const [key, entry] of buckets.entries()) {
      if (entry.resetAt <= now) {
        buckets.delete(key);
      }
    }
    if (buckets.size >= MAX_BUCKETS) {
      const oldest = buckets.keys().next().value;
      if (oldest) buckets.delete(oldest);
    }
  };

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    pruneExpired(now);

    const clientIp = getHttpClientIp(req);
    const key = `${options.keyPrefix}:${clientIp}`;
    let entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 1,
        resetAt: now + options.windowMs,
      };
      buckets.set(key, entry);
    } else {
      entry.count += 1;
    }

    const remaining = Math.max(0, options.maxRequests - entry.count);
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > options.maxRequests) {
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: `Too many requests. Try again in ${retryAfterSec}s.`,
        code: 'RATE_LIMITED',
      });
      return;
    }

    next();
  };
}
