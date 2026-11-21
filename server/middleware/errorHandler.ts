import type { NextFunction, Request, Response } from 'express';
import { getServerConfig } from '../config/env.ts';

export class ApiHttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function apiNotFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
}

export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiHttpError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  const isProd = getServerConfig().isProduction;
  const message =
    !isProd && err instanceof Error
      ? err.message
      : 'Internal server error while processing request.';

  res.status(500).json({
    error: message,
    code: 'INTERNAL_ERROR',
  });
}
