import type { DeviceFormFactor, DevicePlatform } from '../types/streaming.ts';

interface NavigatorWithUAData extends Navigator {
  userAgentData?: {
    platform?: string;
    mobile?: boolean;
    brands?: Array<{ brand: string; version: string }>;
  };
}

const DEVICE_ID_STORAGE_KEY = 'multicast_device_id';

export function getOrCreateClientDeviceId(): string {
  if (typeof window === 'undefined') {
    return 'ssr-device';
  }
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_\-:.]{8,128}$/.test(existing)) {
      return existing;
    }
    const generated =
      typeof window.crypto?.randomUUID === 'function'
        ? `mc_${window.crypto.randomUUID()}`
        : `mc_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `mc_session_${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function detectDevicePlatformFrom(
  ua: string,
  rawPlatform = '',
  maxTouchPoints = 0,
): DevicePlatform {
  const lowerUa = ua.toLowerCase();
  const lowerPlatform = rawPlatform.toLowerCase();
  const combined = `${lowerPlatform} ${lowerUa}`;

  if (lowerUa.includes('iphone') || lowerUa.includes('ipod')) {
    return 'iOS';
  }
  if (
    lowerUa.includes('ipad') ||
    ((lowerPlatform.includes('mac') || lowerUa.includes('macintosh')) &&
      maxTouchPoints > 1)
  ) {
    return 'iPadOS';
  }
  if (combined.includes('android')) {
    return 'Android';
  }
  if (lowerPlatform.includes('win') || lowerUa.includes('windows')) {
    return 'Windows';
  }
  if (combined.includes('cros')) {
    return 'ChromeOS';
  }
  if (lowerPlatform.includes('mac') || lowerPlatform.includes('darwin') || lowerUa.includes('macintosh')) {
    return 'macOS';
  }
  if (lowerPlatform.includes('linux') || lowerUa.includes('linux')) {
    return 'Linux';
  }
  return 'Unknown';
}

export function detectDevicePlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') {
    return 'Unknown';
  }

  const nav = navigator as NavigatorWithUAData;
  const rawPlatform = nav.userAgentData?.platform || navigator.platform || '';
  return detectDevicePlatformFrom(
    navigator.userAgent || '',
    rawPlatform,
    navigator.maxTouchPoints || 0,
  );
}

export function detectBrowserNameFrom(ua: string): string {
  if (!ua) return 'Browser';
  if (ua.includes('SamsungBrowser/')) return 'Samsung Internet';
  if (ua.includes('EdgiOS/') || ua.includes('EdgA/') || ua.includes('Edg/')) {
    return 'Edge';
  }
  if (ua.includes('CriOS/')) return 'Chrome';
  if (ua.includes('FxiOS/') || ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('OPR/') || ua.includes('Opera/')) return 'Opera';
  if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  return 'Browser';
}

export function detectBrowserName(): string {
  if (typeof navigator === 'undefined') {
    return 'Browser';
  }
  return detectBrowserNameFrom(navigator.userAgent || '');
}

export function detectDeviceFormFactorFrom(
  ua: string,
  platform: DevicePlatform,
  maxTouchPoints = 0,
  screenMinDimension?: number,
): DeviceFormFactor {
  const lowerUa = ua.toLowerCase();
  if (platform === 'iPadOS') return 'tablet';
  if (platform === 'iOS') {
    return lowerUa.includes('ipad') ? 'tablet' : 'phone';
  }
  if (platform === 'Android') {
    if (lowerUa.includes('mobile')) return 'phone';
    if (typeof screenMinDimension === 'number' && screenMinDimension > 0 && screenMinDimension < 600) {
      return 'phone';
    }
    return 'tablet';
  }
  if (
    maxTouchPoints > 1 &&
    typeof screenMinDimension === 'number' &&
    screenMinDimension > 0 &&
    screenMinDimension < 600
  ) {
    return 'phone';
  }
  return 'desktop';
}

export function detectDeviceFormFactor(): DeviceFormFactor {
  if (typeof navigator === 'undefined') {
    return 'desktop';
  }
  const platform = detectDevicePlatform();
  const screenMin =
    typeof window !== 'undefined' && window.screen
      ? Math.min(window.screen.width || 0, window.screen.height || 0)
      : undefined;
  return detectDeviceFormFactorFrom(
    navigator.userAgent || '',
    platform,
    navigator.maxTouchPoints || 0,
    screenMin,
  );
}

export function isMobileOrTabletDevice(): boolean {
  const formFactor = detectDeviceFormFactor();
  return formFactor === 'phone' || formFactor === 'tablet';
}

export function getDefaultDeviceName(role: 'broadcaster' | 'receiver'): string {
  const platform = detectDevicePlatform();
  const browser = detectBrowserName();
  const formFactor = detectDeviceFormFactor();

  let prefix = 'Device';
  if (platform === 'iOS') prefix = 'iPhone';
  else if (platform === 'iPadOS') prefix = 'iPad';
  else if (platform === 'Android') {
    prefix = formFactor === 'tablet' ? 'Android Tablet' : 'Android Phone';
  } else if (platform === 'macOS') prefix = 'Mac';
  else if (platform === 'Windows') prefix = 'Windows PC';
  else if (platform === 'ChromeOS') prefix = 'Chromebook';
  else if (platform === 'Linux') prefix = 'Linux Workstation';

  const suffix = role === 'broadcaster' ? 'Source' : 'Display';
  return `${prefix} · ${browser} ${suffix}`;
}

export function getBrowserConnectionType(): string | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const nav = navigator as Navigator & {
    connection?: {
      type?: string;
      effectiveType?: string;
    };
    mozConnection?: {
      type?: string;
      effectiveType?: string;
    };
    webkitConnection?: {
      type?: string;
      effectiveType?: string;
    };
  };
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  if (!conn) return null;

  const parts: string[] = [];
  if (typeof conn.type === 'string' && conn.type && conn.type !== 'unknown') {
    if (conn.type === 'wifi') parts.push('Wi-Fi');
    else if (conn.type === 'ethernet') parts.push('Ethernet');
    else if (conn.type === 'cellular') parts.push('Cellular');
    else parts.push(conn.type.toUpperCase());
  }
  if (typeof conn.effectiveType === 'string' && conn.effectiveType) {
    parts.push(conn.effectiveType.toUpperCase());
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatJoinTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '—';
  try {
    return new Date(timestampMs).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function formatBitrate(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) {
    return '0 kbps';
  }
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`;
  }
  return `${Math.round(kbps)} kbps`;
}

export function formatElapsedTime(startedAt: number | null, now: number): string {
  if (!startedAt) return '00:00';
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatLifetimeDuration(lifetimeMs: number): string {
  if (lifetimeMs <= 0) return 'No fixed expiry';
  const totalHours = Math.round(lifetimeMs / 3_600_000);
  if (totalHours >= 24 && totalHours % 24 === 0) {
    const days = totalHours / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (totalHours >= 1) {
    return `${totalHours} ${totalHours === 1 ? 'hour' : 'hours'}`;
  }
  const mins = Math.max(1, Math.round(lifetimeMs / 60_000));
  return `${mins} min`;
}

export function formatRemainingLifetime(
  expiresAt: number | null,
  lifetimeMs: number,
  now: number,
): string {
  if (lifetimeMs === 0 || expiresAt === null) {
    return 'No fixed expiry (idle cleanup active)';
  }
  const remainingMs = Math.max(0, expiresAt - now);
  if (remainingMs === 0) {
    return 'Idle grace active';
  }
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h left`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m left`;
  }
  return `${mins}m left`;
}

export function buildReceiverJoinUrl(code: string): string {
  const normalizedCode = code.trim().toUpperCase();
  if (typeof window === 'undefined') {
    return `/join?code=${encodeURIComponent(normalizedCode)}`;
  }
  const url = new URL('/join', window.location.origin);
  url.searchParams.set('code', normalizedCode);
  return url.toString();
}

export interface ParsedQrPayload {
  code: string;
}

export function parseQrJoinPayload(raw: string): ParsedQrPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Bare 6-character room code (e.g. K7P4M9)
  if (/^[A-Z0-9]{6}$/i.test(trimmed)) {
    return { code: trimmed.toUpperCase() };
  }

  // 2. JSON payload: {"code":"XXXXXX"} (intentionally ignores any pin/secret fields)
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { code?: unknown; roomId?: unknown };
      const rawCode =
        typeof parsed.code === 'string'
          ? parsed.code
          : typeof parsed.roomId === 'string'
            ? parsed.roomId
            : '';
      const cleanCode = rawCode.trim().toUpperCase();
      if (/^[A-Z0-9]{6}$/.test(cleanCode)) {
        return { code: cleanCode };
      }
    } catch {
      return null;
    }
  }

  // 3. Full URL or relative path with ?code=XXXXXX (or ?room=XXXXXX)
  if (
    trimmed.includes('://') ||
    trimmed.includes('?') ||
    trimmed.includes('code=') ||
    trimmed.includes('room=')
  ) {
    try {
      const url = trimmed.includes('://')
        ? new URL(trimmed)
        : new URL(trimmed.startsWith('/') ? trimmed : `/?${trimmed}`, 'http://localhost');
      const code = (url.searchParams.get('code') || url.searchParams.get('room') || '')
        .trim()
        .toUpperCase();
      if (/^[A-Z0-9]{6}$/.test(code)) {
        return { code };
      }
    } catch {
      return null;
    }
  }

  return null;
}
