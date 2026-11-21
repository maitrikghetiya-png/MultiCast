import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { getServerConfig } from '../config/env.ts';

export interface VerifiedFirebaseUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  name: string | null;
  signInProvider: string | null;
  isAdmin: boolean;
}

let cachedProjectId: string | null = null;
let firebaseAdminApp: App | null = null;

function resolveFirebaseProjectId(): string | null {
  if (cachedProjectId) return cachedProjectId;

  const envProjectId = getServerConfig().firebaseProjectId;
  if (envProjectId) {
    cachedProjectId = envProjectId;
    return cachedProjectId;
  }

  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        projectId?: string;
      };
      if (
        typeof raw.projectId === 'string' &&
        raw.projectId.trim().length > 0 &&
        raw.projectId !== 'remixed-project-id'
      ) {
        cachedProjectId = raw.projectId.trim();
        return cachedProjectId;
      }
    } catch {
      // Ignore malformed config file
    }
  }

  return null;
}

function getFirebaseAdminApp(): App | null {
  if (firebaseAdminApp) return firebaseAdminApp;

  const projectId = resolveFirebaseProjectId();
  if (!projectId) return null;

  firebaseAdminApp = getApps().length
    ? getApp()
    : initializeApp({
        projectId,
      });

  return firebaseAdminApp;
}

export function isFirebaseAuthConfigured(): boolean {
  return Boolean(resolveFirebaseProjectId());
}

export function isVerifiedAccountIdentity(decoded: DecodedIdToken): boolean {
  const provider = decoded.firebase?.sign_in_provider || null;
  if (provider === 'phone' && typeof decoded.phone_number === 'string' && decoded.phone_number.length > 0) {
    return true;
  }
  return Boolean(decoded.email_verified);
}

function toVerifiedUser(decoded: DecodedIdToken): VerifiedFirebaseUser {
  const email = typeof decoded.email === 'string' ? decoded.email : null;
  const emailVerified = Boolean(decoded.email_verified);
  const { adminEmails } = getServerConfig();
  const isAdmin = Boolean(
    email && emailVerified && adminEmails.includes(email.toLowerCase()),
  );

  return {
    uid: decoded.uid,
    email,
    emailVerified,
    phoneNumber: typeof decoded.phone_number === 'string' ? decoded.phone_number : null,
    name: typeof decoded.name === 'string' ? decoded.name : null,
    signInProvider: decoded.firebase?.sign_in_provider || null,
    isAdmin,
  };
}

export async function verifyFirebaseIdToken(
  rawToken: string | undefined | null,
): Promise<
  | { ok: true; user: VerifiedFirebaseUser; identityVerified: boolean }
  | { ok: false; code: 'UNCONFIGURED' | 'MISSING_TOKEN' | 'INVALID_TOKEN'; message: string }
> {
  const app = getFirebaseAdminApp();
  if (!app) {
    return {
      ok: false,
      code: 'UNCONFIGURED',
      message: 'Firebase Authentication project is not configured on the server.',
    };
  }

  if (typeof rawToken !== 'string' || rawToken.trim().length < 20) {
    return {
      ok: false,
      code: 'MISSING_TOKEN',
      message: 'Authentication required. Sign in to your MultiCast account to continue.',
    };
  }

  try {
    // verifyIdToken(token) verifies signature & claims locally using Google public keys without requiring IAM
    const decoded = await getAuth(app).verifyIdToken(rawToken.trim());
    return {
      ok: true,
      user: toVerifiedUser(decoded),
      identityVerified: isVerifiedAccountIdentity(decoded),
    };
  } catch {
    return {
      ok: false,
      code: 'INVALID_TOKEN',
      message: 'Your login session expired or could not be verified. Please sign in again.',
    };
  }
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    return token || null;
  }
  return null;
}

export interface AuthenticatedRequest extends Request {
  firebaseUser?: VerifiedFirebaseUser;
  identityVerified?: boolean;
}

export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req);
  const result = await verifyFirebaseIdToken(token);
  if (!result.ok) {
    res.status(401).json({
      error: result.message,
      code: result.code,
    });
    return;
  }

  req.firebaseUser = result.user;
  req.identityVerified = result.identityVerified;
  next();
}
