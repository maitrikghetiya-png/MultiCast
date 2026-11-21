import crypto from 'node:crypto';
import dotenv from 'dotenv';
import type { IceServerConfig } from '../../src/types/streaming.ts';

dotenv.config();

const DEFAULT_DEV_CORS_ORIGIN = 'http://localhost:5173';
const DEFAULT_DEV_STUN_URL = 'stun:stun.l.google.com:19302';

const PLACEHOLDER_VALUES = new Set([
  'MY_APP_URL',
  'MY_GEMINI_API_KEY',
  'MY_TURN_USERNAME',
  'MY_TURN_CREDENTIAL',
  'MY_TURN_SHARED_SECRET',
  'MY_CORS_ORIGIN',
  'MY_ROOM_AUTH_SECRET',
]);

export class EnvValidationError extends Error {
  public readonly variable: string;

  constructor(variable: string, message: string) {
    super(`[Environment Validation Error] ${variable}: ${message}`);
    this.name = 'EnvValidationError';
    this.variable = variable;
  }
}

function cleanOptionalEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (
    !trimmed ||
    PLACEHOLDER_VALUES.has(trimmed) ||
    /^(MY_|YOUR_|CHANGE_ME|REPLACE_|PLACEHOLDER)/i.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

export function normalizeOrigin(rawOrigin: string): string {
  const trimmed = rawOrigin.trim();
  if (!trimmed) {
    throw new EnvValidationError('CORS_ORIGIN', 'Origin entry cannot be empty.');
  }
  if (trimmed === '*') {
    return '*';
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new EnvValidationError(
      'CORS_ORIGIN',
      `Invalid origin URL "${trimmed}". Expected format like "http://localhost:5173" or "https://app.example.com".`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new EnvValidationError(
      'CORS_ORIGIN',
      `Unsupported protocol in origin "${trimmed}". Only http:// and https:// are permitted.`,
    );
  }

  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new EnvValidationError(
      'CORS_ORIGIN',
      `Origin "${trimmed}" must not include a path, query string, or hash. Use "${parsed.origin}".`,
    );
  }

  return parsed.origin;
}

function parseCorsOrigins(
  rawCorsOrigin: string | undefined,
  rawAppUrl: string | undefined,
  port: number,
  isProduction: boolean,
): { origins: string[]; explicitCorsConfigured: boolean } {
  const cleanedCors = cleanOptionalEnv(rawCorsOrigin);
  const cleanedAppUrl = cleanOptionalEnv(rawAppUrl);

  if (cleanedCors) {
    const entries = cleanedCors
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    if (entries.length === 0) {
      throw new EnvValidationError(
        'CORS_ORIGIN',
        'CORS_ORIGIN was provided but contains no valid origins.',
      );
    }

    const normalized = new Set<string>();
    for (const entry of entries) {
      const origin = normalizeOrigin(entry);
      if (origin === '*') {
        throw new EnvValidationError(
          'CORS_ORIGIN',
          'Unrestricted wildcard "*" is not allowed. Configure an explicit comma-separated origin allowlist (e.g. "http://localhost:5173" in development or your deployed HTTPS URL in production).',
        );
      }
      normalized.add(origin);
    }

    if (!isProduction) {
      normalized.add(`http://localhost:${port}`);
      normalized.add(`http://127.0.0.1:${port}`);
    }

    if (cleanedAppUrl) {
      try {
        const appOrigin = normalizeOrigin(cleanedAppUrl);
        if (appOrigin !== '*') {
          normalized.add(appOrigin);
        }
      } catch {
        // Ignore invalid optional APP_URL when explicit CORS_ORIGIN is configured
      }
    }

    return {
      origins: Array.from(normalized),
      explicitCorsConfigured: true,
    };
  }

  if (isProduction) {
    if (cleanedAppUrl) {
      const deployedOrigin = normalizeOrigin(cleanedAppUrl);
      if (deployedOrigin === '*') {
        throw new EnvValidationError(
          'CORS_ORIGIN',
          'Wildcard "*" cannot be used in production.',
        );
      }
      return {
        origins: [deployedOrigin],
        explicitCorsConfigured: false,
      };
    }

    // Single-service production (e.g. Cloud Run without preconfigured CORS_ORIGIN):
    // allow verified same-origin requests based on Host/X-Forwarded-Proto and block cross-origin.
    return {
      origins: [],
      explicitCorsConfigured: false,
    };
  }

  // Local development defaults: primary Vite origin + local full-stack port + optional APP_URL
  const devOrigins = new Set<string>([
    DEFAULT_DEV_CORS_ORIGIN,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);

  if (cleanedAppUrl) {
    try {
      const appOrigin = normalizeOrigin(cleanedAppUrl);
      if (appOrigin !== '*') {
        devOrigins.add(appOrigin);
      }
    } catch {
      // Ignore invalid optional APP_URL in dev fallback
    }
  }

  return {
    origins: Array.from(devOrigins),
    explicitCorsConfigured: false,
  };
}

function isValidIceUrl(url: string): boolean {
  return /^(stun|stuns|turn|turns):.+$/i.test(url.trim());
}

function isTurnUrl(url: string): boolean {
  return /^(turn|turns):/i.test(url.trim());
}

function parseTurnUrls(raw: string | undefined): string[] {
  const cleaned = cleanOptionalEnv(raw);
  if (!cleaned) return [];
  const urls = cleaned
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

  for (const url of urls) {
    if (!isTurnUrl(url)) {
      throw new EnvValidationError(
        'TURN_URLS',
        `Invalid TURN URL "${url}". Each entry must begin with "turn:" or "turns:".`,
      );
    }
  }
  return urls;
}

interface ParsedTurnCredentials {
  turnUrls: string[];
  username?: string;
  credential?: string;
  sharedSecret?: string;
  ttlSeconds: number;
}

function parsePrivateTurnCredentials(): ParsedTurnCredentials {
  const turnUrls = parseTurnUrls(process.env.TURN_URLS);
  const username = cleanOptionalEnv(process.env.TURN_USERNAME);
  const credential = cleanOptionalEnv(process.env.TURN_CREDENTIAL);
  const sharedSecret = cleanOptionalEnv(process.env.TURN_SHARED_SECRET);

  const rawTtl = process.env.TURN_TTL_SECONDS?.trim();
  let ttlSeconds = 3600;
  if (rawTtl) {
    const parsedTtl = Number(rawTtl);
    if (!Number.isInteger(parsedTtl) || parsedTtl < 60 || parsedTtl > 86400) {
      throw new EnvValidationError(
        'TURN_TTL_SECONDS',
        `Invalid TURN_TTL_SECONDS "${rawTtl}". Must be an integer between 60 and 86400.`,
      );
    }
    ttlSeconds = parsedTtl;
  }

  if ((username && !credential) || (!username && credential)) {
    throw new EnvValidationError(
      'TURN_USERNAME / TURN_CREDENTIAL',
      'Both TURN_USERNAME and TURN_CREDENTIAL must be set together when using static TURN credentials.',
    );
  }

  if (turnUrls.length > 0 && !sharedSecret && !(username && credential)) {
    throw new EnvValidationError(
      'TURN_URLS',
      'TURN_URLS was configured without private credentials. Set TURN_USERNAME and TURN_CREDENTIAL (or TURN_SHARED_SECRET) in your environment.',
    );
  }

  return {
    turnUrls,
    username,
    credential,
    sharedSecret,
    ttlSeconds,
  };
}

function parseIceServers(
  rawIceServers: string | undefined,
  turnConfig: ParsedTurnCredentials,
): IceServerConfig[] {
  const cleaned = cleanOptionalEnv(rawIceServers);
  let servers: IceServerConfig[];

  if (!cleaned) {
    servers = [{ urls: DEFAULT_DEV_STUN_URL }];
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Malformed JSON';
      throw new EnvValidationError(
        'ICE_SERVERS',
        `ICE_SERVERS must be valid JSON array of RTCIceServer objects (${detail}). Example: '[{"urls":"stun:stun.l.google.com:19302"}]'`,
      );
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new EnvValidationError(
        'ICE_SERVERS',
        'ICE_SERVERS must be a non-empty JSON array.',
      );
    }

    servers = parsed.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new EnvValidationError(
          'ICE_SERVERS',
          `Entry at index ${index} must be an object with a "urls" property.`,
        );
      }

      const candidate = entry as Record<string, unknown>;
      const rawUrls = candidate.urls;
      const urlList: string[] = [];

      if (typeof rawUrls === 'string' && rawUrls.trim()) {
        urlList.push(rawUrls.trim());
      } else if (
        Array.isArray(rawUrls) &&
        rawUrls.length > 0 &&
        rawUrls.every((u) => typeof u === 'string' && u.trim().length > 0)
      ) {
        for (const u of rawUrls) {
          urlList.push((u as string).trim());
        }
      } else {
        throw new EnvValidationError(
          'ICE_SERVERS',
          `Entry at index ${index} must define "urls" as a non-empty string or array of strings.`,
        );
      }

      for (const u of urlList) {
        if (!isValidIceUrl(u)) {
          throw new EnvValidationError(
            'ICE_SERVERS',
            `Invalid ICE server URL "${u}" at index ${index}. URLs must start with stun:, stuns:, turn:, or turns:.`,
          );
        }
      }

      const serverEntry: IceServerConfig = {
        urls: urlList.length === 1 ? urlList[0] : urlList,
      };

      if (typeof candidate.username === 'string' && candidate.username.trim()) {
        serverEntry.username = candidate.username.trim();
      }
      if (typeof candidate.credential === 'string' && candidate.credential.trim()) {
        serverEntry.credential = candidate.credential.trim();
      }

      if (
        (serverEntry.username && !serverEntry.credential) ||
        (!serverEntry.username && serverEntry.credential)
      ) {
        throw new EnvValidationError(
          'ICE_SERVERS',
          `Entry at index ${index} must provide both "username" and "credential", or omit both to use private TURN_* env vars.`,
        );
      }

      const containsTurn = urlList.some(isTurnUrl);
      if (
        containsTurn &&
        !serverEntry.username &&
        !turnConfig.sharedSecret &&
        !(turnConfig.username && turnConfig.credential)
      ) {
        throw new EnvValidationError(
          'ICE_SERVERS',
          `TURN entry "${urlList.join(', ')}" at index ${index} has no credentials. Set private TURN_USERNAME and TURN_CREDENTIAL (or TURN_SHARED_SECRET) environment variables.`,
        );
      }

      return serverEntry;
    });
  }

  if (turnConfig.turnUrls.length > 0) {
    servers.push({
      urls:
        turnConfig.turnUrls.length === 1
          ? turnConfig.turnUrls[0]
          : turnConfig.turnUrls,
    });
  }

  return servers;
}

function parsePort(rawPort: string | undefined, isProduction: boolean): number {
  const nginxPort = process.env.NGINX_PORT?.trim();
  const defaultAppPort = process.env.DEFAULT_APP_PORT?.trim();
  if (!isProduction && nginxPort && rawPort?.trim() === nginxPort) {
    const fallbackPort = Number(defaultAppPort || '3000');
    if (Number.isInteger(fallbackPort) && fallbackPort >= 1 && fallbackPort <= 65535) {
      return fallbackPort;
    }
    return 3000;
  }

  if (!rawPort || rawPort.trim() === '') {
    return 3000;
  }
  const port = Number(rawPort.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvValidationError(
      'PORT',
      `Invalid PORT "${rawPort}". Expected an integer between 1 and 65535.`,
    );
  }
  return port;
}

export const MAX_TOTAL_DEVICES_PER_ROOM = 10;
export const MAX_RECEIVERS_HARD_CAP = MAX_TOTAL_DEVICES_PER_ROOM - 1; // 1 source + up to 9 receivers = 10 total devices
const MAX_CONFIGURABLE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface RoomSettingsConfig {
  maxReceiversPerRoom: number;
  maxTotalDevicesPerRoom: number;
  maxActiveRooms: number;
  roomIdleTtlMs: number;
  roomMaxLifetimeMs: number; // 0 = no fixed expiry (idle cleanup or explicit close only)
  roomAuthSecret: string;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  variable: string,
  min: number,
  max: number,
): number {
  if (!raw || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new EnvValidationError(
      variable,
      `Invalid ${variable} "${raw}". Expected an integer between ${min} and ${max}.`,
    );
  }
  return value;
}

function parseDurationToMs(raw: string | undefined, variable: string): number | undefined {
  const cleaned = cleanOptionalEnv(raw);
  if (!cleaned) return undefined;
  const lower = cleaned.toLowerCase();
  if (lower === '0' || lower === 'unlimited' || lower === 'infinite' || lower === 'none') {
    return 0;
  }

  if (/^\d+$/.test(lower)) {
    const value = Number(lower);
    if (!Number.isFinite(value)) {
      console.warn(
        `[Config Notice] ${variable}="${cleaned}" is not finite; falling back to default.`,
      );
      return undefined;
    }
    if (variable === 'ROOM_MAX_LIFETIME' && value >= 1 && value <= 720) {
      console.warn(
        `[Config Notice] Interpreting bare integer ROOM_MAX_LIFETIME="${cleaned}" as ${value} hour(s) (use e.g. "${value}h", "7d", or milliseconds).`,
      );
      return value * 3_600_000;
    }
    if (value < 60_000) {
      console.warn(
        `[Config Notice] ${variable}="${cleaned}" is below minimum 60000ms; clamping to 60000ms.`,
      );
      return 60_000;
    }
    if (value > MAX_CONFIGURABLE_LIFETIME_MS) {
      console.warn(
        `[Config Notice] ${variable}="${cleaned}" exceeds 30 days; clamping to ${MAX_CONFIGURABLE_LIFETIME_MS}ms.`,
      );
      return MAX_CONFIGURABLE_LIFETIME_MS;
    }
    return value;
  }

  const match = lower.match(
    /^(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/,
  );
  if (!match) {
    console.warn(
      `[Config Notice] Unrecognized ${variable}="${cleaned}" (expected e.g. "24h", "7d", "unlimited", or ms). Falling back to default.`,
    );
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit.startsWith('s')
    ? 1_000
    : unit.startsWith('m')
      ? 60_000
      : unit.startsWith('h')
        ? 3_600_000
        : 86_400_000;
  const ms = Math.round(amount * multiplier);
  if (!Number.isFinite(ms) || ms < 60_000) {
    console.warn(
      `[Config Notice] ${variable}="${cleaned}" is below 1 minute; clamping to 60000ms.`,
    );
    return 60_000;
  }
  if (ms > MAX_CONFIGURABLE_LIFETIME_MS) {
    console.warn(
      `[Config Notice] ${variable}="${cleaned}" exceeds 30 days; clamping to 30 days.`,
    );
    return MAX_CONFIGURABLE_LIFETIME_MS;
  }
  return ms;
}

function parseAdminEmails(raw: string | undefined): string[] {
  const cleaned = cleanOptionalEnv(raw);
  if (!cleaned) return [];
  return cleaned
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes('@'));
}

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  trustProxy: boolean;
  appUrl: string;
  corsOrigins: string[];
  explicitCorsConfigured: boolean;
  iceServers: IceServerConfig[];
  turnConfig: ParsedTurnCredentials;
  roomSettings: RoomSettingsConfig;
  firebaseProjectId: string | undefined;
  adminEmails: string[];
}

function createServerConfig(): ServerConfig {
  const nodeEnv = process.env.NODE_ENV?.trim() || 'development';
  const isProduction = nodeEnv === 'production';
  const port = parsePort(process.env.PORT, isProduction);
  const { origins: corsOrigins, explicitCorsConfigured } = parseCorsOrigins(
    process.env.CORS_ORIGIN,
    process.env.APP_URL,
    port,
    isProduction,
  );
  const turnConfig = parsePrivateTurnCredentials();
  const iceServers = parseIceServers(process.env.ICE_SERVERS, turnConfig);

  const requestedMaxReceivers = parsePositiveInt(
    process.env.MAX_RECEIVERS_PER_ROOM,
    MAX_RECEIVERS_HARD_CAP,
    'MAX_RECEIVERS_PER_ROOM',
    1,
    32,
  );
  if (requestedMaxReceivers !== MAX_RECEIVERS_HARD_CAP) {
    console.warn(
      `[Config Notice] MAX_RECEIVERS_PER_ROOM=${requestedMaxReceivers} normalized to ${MAX_RECEIVERS_HARD_CAP} to enforce the 10-device room capacity (1 source + ${MAX_RECEIVERS_HARD_CAP} receivers).`,
    );
  }
  const maxReceiversPerRoom = MAX_RECEIVERS_HARD_CAP;

  const maxActiveRooms = parsePositiveInt(
    process.env.MAX_ACTIVE_ROOMS,
    200,
    'MAX_ACTIVE_ROOMS',
    1,
    5000,
  );
  const roomIdleTtlMs = parsePositiveInt(
    process.env.ROOM_IDLE_TTL_MS,
    30 * 60 * 1000,
    'ROOM_IDLE_TTL_MS',
    30_000,
    7 * 24 * 60 * 60 * 1000,
  );

  const parsedLifetime = parseDurationToMs(process.env.ROOM_MAX_LIFETIME, 'ROOM_MAX_LIFETIME');
  const parsedLifetimeMs = parseDurationToMs(
    process.env.ROOM_MAX_LIFETIME_MS,
    'ROOM_MAX_LIFETIME_MS',
  );
  const roomMaxLifetimeMs =
    parsedLifetime !== undefined
      ? parsedLifetime
      : parsedLifetimeMs !== undefined
        ? parsedLifetimeMs
        : 24 * 60 * 60 * 1000;

  const explicitAuthSecret = cleanOptionalEnv(process.env.ROOM_AUTH_SECRET);
  if (explicitAuthSecret && explicitAuthSecret.length < 32) {
    console.warn(
      '[Security Warning] ROOM_AUTH_SECRET is shorter than 32 characters. Use at least 32 random characters in production.',
    );
  }
  const roomAuthSecret =
    explicitAuthSecret || crypto.randomBytes(32).toString('hex');

  const rawTrustProxy = process.env.TRUST_PROXY?.trim().toLowerCase();
  const isCloudRun = Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB);
  const trustProxy =
    rawTrustProxy === 'true'
      ? true
      : rawTrustProxy === 'false'
        ? false
        : isProduction || isCloudRun;

  return {
    port,
    nodeEnv,
    isProduction,
    trustProxy,
    appUrl: cleanOptionalEnv(process.env.APP_URL) || (isProduction ? '' : `http://localhost:${port}`),
    corsOrigins,
    explicitCorsConfigured,
    iceServers,
    turnConfig,
    roomSettings: {
      maxReceiversPerRoom,
      maxTotalDevicesPerRoom: 1 + maxReceiversPerRoom,
      maxActiveRooms,
      roomIdleTtlMs,
      roomMaxLifetimeMs,
      roomAuthSecret,
    },
    firebaseProjectId: cleanOptionalEnv(process.env.FIREBASE_PROJECT_ID),
    adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
  };
}

let cachedConfig: ServerConfig | null = null;

export function initServerConfig(): ServerConfig {
  cachedConfig = createServerConfig();
  return cachedConfig;
}

export function getServerConfig(): ServerConfig {
  if (!cachedConfig) {
    cachedConfig = createServerConfig();
  }
  return cachedConfig;
}

export interface OriginCheckRequestLike {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
  socket?: unknown;
}

function getHeaderFirstValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}

function resolveRequestOrigin(
  req: OriginCheckRequestLike,
  trustProxy: boolean,
): string | null {
  const host =
    (trustProxy ? getHeaderFirstValue(req.headers['x-forwarded-host']) : undefined) ||
    getHeaderFirstValue(req.headers.host);
  if (!host) return null;

  const isEncrypted =
    typeof req.socket === 'object' &&
    req.socket !== null &&
    'encrypted' in req.socket &&
    Boolean((req.socket as { encrypted?: unknown }).encrypted);

  const forwardedProto = trustProxy
    ? getHeaderFirstValue(req.headers['x-forwarded-proto'])
    : undefined;
  const proto = forwardedProto || req.protocol || (isEncrypted ? 'https' : 'http');

  if (proto !== 'http' && proto !== 'https') {
    return null;
  }

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

export function isCorsOriginAllowed(
  origin: string | undefined,
  req?: OriginCheckRequestLike,
): boolean {
  if (!origin) {
    return true;
  }
  let normalized: string;
  try {
    normalized = normalizeOrigin(origin);
  } catch {
    return false;
  }

  const config = getServerConfig();
  if (config.corsOrigins.includes(normalized)) {
    return true;
  }

  if (!config.explicitCorsConfigured && req) {
    const requestOrigin = resolveRequestOrigin(req, config.trustProxy);
    if (requestOrigin && requestOrigin === normalized) {
      return true;
    }
  }

  return false;
}

export function getRuntimeIceServers(): IceServerConfig[] {
  const { turnConfig, iceServers } = getServerConfig();

  let dynamicUsername: string | undefined;
  let dynamicCredential: string | undefined;

  if (turnConfig.sharedSecret) {
    const expiresAt = Math.floor(Date.now() / 1000) + turnConfig.ttlSeconds;
    dynamicUsername = `${expiresAt}:multicast`;
    dynamicCredential = crypto
      .createHmac('sha1', turnConfig.sharedSecret)
      .update(dynamicUsername)
      .digest('base64');
  } else if (turnConfig.username && turnConfig.credential) {
    dynamicUsername = turnConfig.username;
    dynamicCredential = turnConfig.credential;
  }

  return iceServers.map((entry) => {
    const urlList = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const hasTurn = urlList.some(isTurnUrl);
    if (!hasTurn) {
      return { urls: entry.urls };
    }

    if (entry.username && entry.credential) {
      return { ...entry };
    }

    return {
      urls: entry.urls,
      username: dynamicUsername,
      credential: dynamicCredential,
    };
  });
}

export function getPublicStunIceServers(): IceServerConfig[] {
  const stunOnly: IceServerConfig[] = [];
  for (const entry of getServerConfig().iceServers) {
    const urlList = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const nonTurnUrls = urlList.filter((url) => !isTurnUrl(url));
    if (nonTurnUrls.length > 0) {
      stunOnly.push({
        urls: nonTurnUrls.length === 1 ? nonTurnUrls[0] : nonTurnUrls,
      });
    }
  }
  if (stunOnly.length === 0) {
    return [{ urls: DEFAULT_DEV_STUN_URL }];
  }
  return stunOnly;
}

export function hasTurnServerConfigured(): boolean {
  return getServerConfig().iceServers.some((entry) => {
    const urlList = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    return urlList.some(isTurnUrl);
  });
}
