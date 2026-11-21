import type { NextFunction, Request, Response } from 'express';
import { isCorsOriginAllowed } from '../config/env.ts';

export function corsAllowlistMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (!origin) {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
    return;
  }

  if (!isCorsOriginAllowed(origin, req)) {
    res.status(403).json({
      error: 'CORS policy: Origin is not in the configured CORS_ORIGIN allowlist.',
    });
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}
