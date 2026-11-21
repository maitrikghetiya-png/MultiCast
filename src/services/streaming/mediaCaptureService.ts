import {
  STREAM_RESOLUTION_OPTIONS,
  type DevicePlatform,
  type DisplaySurfacePreference,
  type QualityMode,
  type StreamContentHint,
  type StreamFrameRate,
  type StreamMetadata,
  type StreamResolutionId,
} from '../../types/streaming.ts';
import {
  detectBrowserName,
  detectDevicePlatform,
  isMobileOrTabletDevice,
} from '../../utils/platform.ts';

export interface CaptureOptions {
  resolutionId: StreamResolutionId;
  frameRate: StreamFrameRate;
  captureAudio: boolean;
  contentHint: StreamContentHint;
  surfacePreference?: DisplaySurfacePreference;
}

export interface ScreenCaptureSupport {
  supported: boolean;
  secureContext: boolean;
  supportsDisplaySurfaceConstraint: boolean;
  platform: DevicePlatform;
  browser: string;
  isMobileOrTablet: boolean;
  reason?: string;
  guidance?: string;
}

export interface AudioSharingSupport {
  tabAudioSupported: boolean;
  systemAudioSupported: boolean;
  summary: string;
}

export type ScreenCaptureErrorCode =
  | 'PERMISSION_DENIED'
  | 'INSECURE_CONTEXT'
  | 'NOT_SUPPORTED'
  | 'NO_SOURCE_AVAILABLE'
  | 'NOT_READABLE'
  | 'OVERCONSTRAINED'
  | 'INVALID_STATE'
  | 'UNKNOWN';

export class ScreenCaptureError extends Error {
  public readonly code: ScreenCaptureErrorCode;

  constructor(code: ScreenCaptureErrorCode, message: string) {
    super(message);
    this.name = 'ScreenCaptureError';
    this.code = code;
  }
}

export function computeDefaultCapturePreset(mobileOrTablet: boolean): {
  resolutionId: StreamResolutionId;
  frameRate: StreamFrameRate;
  qualityMode: QualityMode;
} {
  if (mobileOrTablet) {
    return {
      resolutionId: '720p',
      frameRate: 30,
      qualityMode: 'auto',
    };
  }
  return {
    resolutionId: '1080p',
    frameRate: 60,
    qualityMode: 'auto',
  };
}

export function resolveCaptureDimensions(
  resolutionId: StreamResolutionId,
  portrait: boolean,
): { width: number; height: number } {
  const { width, height } = STREAM_RESOLUTION_OPTIONS[resolutionId];
  return portrait ? { width: height, height: width } : { width, height };
}

function isPortraitDisplay(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.screen !== 'undefined' &&
    window.screen.height > window.screen.width;
}

export function getScreenCaptureSupport(
  platform: DevicePlatform = detectDevicePlatform(),
  browser: string = detectBrowserName(),
  secureContext: boolean = typeof window !== 'undefined' ? window.isSecureContext !== false : true,
  hasGetDisplayMedia: boolean = typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function',
  supportsDisplaySurfaceConstraint?: boolean,
): ScreenCaptureSupport {
  const mobileOrTablet =
    platform === 'Android' ||
    platform === 'iOS' ||
    platform === 'iPadOS' ||
    isMobileOrTabletDevice();

  if (!secureContext) {
    return {
      supported: false,
      secureContext: false,
      supportsDisplaySurfaceConstraint: false,
      platform,
      browser,
      isMobileOrTablet: mobileOrTablet,
      reason:
        'Screen broadcasting requires a secure context (HTTPS or localhost). Open MultiCast over HTTPS on the broadcaster device.',
      guidance:
        'You can still join rooms immediately as a Receiver Display on this device without HTTPS screen capture.',
    };
  }

  if (!hasGetDisplayMedia) {
    if (platform === 'iOS' || platform === 'iPadOS') {
      return {
        supported: false,
        secureContext,
        supportsDisplaySurfaceConstraint: false,
        platform,
        browser,
        isMobileOrTablet: true,
        reason: `${platform} restricts web browsers (${browser}/WebKit) from accessing browser screen-sharing APIs (getDisplayMedia).`,
        guidance:
          'Use this iPhone or iPad as a Receiver Display, or broadcast from a desktop browser. Android browser capture is enabled only when the API is present and still depends on the device.',
      };
    }

    if (platform === 'Android') {
      return {
        supported: false,
        secureContext,
        supportsDisplaySurfaceConstraint: false,
        platform,
        browser,
        isMobileOrTablet: true,
        reason: `${browser} on this Android device does not expose navigator.mediaDevices.getDisplayMedia.`,
        guidance:
          'Try a current browser over HTTPS that exposes screen capture on this Android OS build, or switch to Receiver Display. Browser availability does not guarantee hardware capture.',
      };
    }

    return {
      supported: false,
      secureContext,
      supportsDisplaySurfaceConstraint: false,
      platform,
      browser,
      isMobileOrTablet: mobileOrTablet,
      reason: `navigator.mediaDevices.getDisplayMedia is unavailable in ${browser} on ${platform}.`,
      guidance:
        'Use Chrome, Edge, Firefox, or macOS Safari over HTTPS to broadcast, or switch this browser to Receiver Display.',
    };
  }

  const detectedSurfaceSupport =
    supportsDisplaySurfaceConstraint ??
    (platform !== 'Android' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getSupportedConstraints === 'function'
      ? 'displaySurface' in navigator.mediaDevices.getSupportedConstraints()
      : false);

  return {
    supported: true,
    secureContext,
    supportsDisplaySurfaceConstraint: detectedSurfaceSupport,
    platform,
    browser,
    isMobileOrTablet: mobileOrTablet,
    guidance: mobileOrTablet
      ? `The screen-capture API is available in ${browser} on ${platform}. MultiCast defaults to mobile-optimized 720p @ 30 fps Adaptive streaming; device capture still depends on OS/browser support.`
      : undefined,
  };
}

export function getAudioSharingSupport(
  platform: DevicePlatform = detectDevicePlatform(),
  browser: string = detectBrowserName(),
): AudioSharingSupport {
  if (platform === 'iOS' || platform === 'iPadOS') {
    return {
      tabAudioSupported: false,
      systemAudioSupported: false,
      summary:
        `${platform} browsers cannot capture screen audio; receivers on iPhone/iPad can still listen to audio sent by Windows, macOS, or supported Android broadcasters.`,
    };
  }
  if (platform === 'Android') {
    return {
      tabAudioSupported: false,
      systemAudioSupported: false,
      summary:
        'Android screen audio varies by OS version, browser, and capture source. MultiCast requests audio, but it is available only if the Android share prompt and browser return a live audio track.',
    };
  }
  const isChromium = browser === 'Chrome' || browser === 'Edge';
  if (isChromium && platform === 'Windows') {
    return {
      tabAudioSupported: true,
      systemAudioSupported: true,
      summary:
        'Chrome and Edge on Windows support sharing both browser tab audio and full system audio (enable "Share audio" in the picker).',
    };
  }
  if (isChromium && platform === 'macOS') {
    return {
      tabAudioSupported: true,
      systemAudioSupported: true,
      summary:
        'Tab audio works directly; full system audio requires macOS 13+ Screen & System Audio Recording permission.',
    };
  }
  if (isChromium) {
    return {
      tabAudioSupported: true,
      systemAudioSupported: false,
      summary:
        'Browser tab audio is supported; full-display audio varies by Linux/ChromeOS desktop.',
    };
  }
  if (browser === 'Safari') {
    return {
      tabAudioSupported: false,
      systemAudioSupported: false,
      summary:
        'Safari screen sharing captures video only on macOS; switch to Chrome or Edge on the broadcaster if you need to stream audio.',
    };
  }
  if (browser === 'Firefox') {
    return {
      tabAudioSupported: false,
      systemAudioSupported: false,
      summary:
        'Firefox screen capture is video-only on most desktop platforms; use Chrome or Edge on the source for audio.',
    };
  }
  return {
    tabAudioSupported: true,
    systemAudioSupported: false,
    summary: 'Audio sharing depends on the selected surface and browser support.',
  };
}

export function isDisplayMediaSupported(): boolean {
  return getScreenCaptureSupport().supported;
}

export function classifyScreenCaptureError(err: unknown): ScreenCaptureError {
  if (err instanceof ScreenCaptureError) {
    return err;
  }

  const errorObj = err as { name?: string; message?: string } | null;
  const name = errorObj?.name || '';
  const rawMessage = errorObj?.message || '';
  const lowerMessage = rawMessage.toLowerCase();

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    const isAndroid = detectDevicePlatform() === 'Android';
    if (
      !isAndroid &&
      (lowerMessage.includes('system') ||
        lowerMessage.includes('screen recording') ||
        lowerMessage.includes('os '))
    ) {
      return new ScreenCaptureError(
        'PERMISSION_DENIED',
        'Screen recording permission was denied by your operating system. Enable Screen Recording access for your browser in System Settings, then try again.',
      );
    }
    return new ScreenCaptureError(
      'PERMISSION_DENIED',
      isAndroid
        ? 'Android screen sharing was cancelled or not allowed. Tap Start Broadcasting again and confirm the Android screen-capture prompt.'
        : 'Screen capture permission was rejected or the OS share prompt was cancelled. Tap Start Sharing and confirm screen access.',
    );
  }

  if (name === 'NotFoundError') {
    return new ScreenCaptureError(
      'NO_SOURCE_AVAILABLE',
      'No shareable display, application window, or browser tab was found on this device.',
    );
  }

  if (name === 'NotReadableError' || name === 'AbortError') {
    return new ScreenCaptureError(
      'NOT_READABLE',
      'The selected display or window could not be captured by the browser (hardware/OS read failure). Try selecting another source.',
    );
  }

  if (name === 'OverconstrainedError') {
    return new ScreenCaptureError(
      'OVERCONSTRAINED',
      'The selected capture source could not satisfy the requested resolution or frame rate constraints.',
    );
  }

  if (name === 'InvalidStateError') {
    return new ScreenCaptureError(
      'INVALID_STATE',
      'Screen capture must be started directly from a user click in an active, focused browser tab.',
    );
  }

  if (name === 'TypeError' || name === 'NotSupportedError') {
    return new ScreenCaptureError(
      'NOT_SUPPORTED',
      rawMessage ||
        'This browser rejected the requested getDisplayMedia capture configuration.',
    );
  }

  return new ScreenCaptureError(
    'UNKNOWN',
    rawMessage || 'Unable to start screen capture.',
  );
}

interface ExtendedDisplayMediaOptions extends DisplayMediaStreamOptions {
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
  systemAudio?: 'include' | 'exclude';
  suppressLocalAudioPlayback?: boolean;
}

function buildDisplayMediaOptions(
  options: CaptureOptions,
  includeDisplaySurfaceHint: boolean,
  simplifyAudio = false,
  omitChromeAudioHints = false,
): ExtendedDisplayMediaOptions {
  const isAndroid = detectDevicePlatform() === 'Android';
  const dimensions = resolveCaptureDimensions(options.resolutionId, isPortraitDisplay());
  const videoConstraints: MediaTrackConstraints & {
    displaySurface?: 'monitor' | 'window' | 'browser';
  } = {
    width: { ideal: dimensions.width },
    height: { ideal: dimensions.height },
    frameRate: { ideal: options.frameRate },
  };

  if (
    includeDisplaySurfaceHint &&
    options.surfacePreference &&
    options.surfacePreference !== 'any'
  ) {
    videoConstraints.displaySurface = options.surfacePreference;
  }

  const base: ExtendedDisplayMediaOptions = {
    video: videoConstraints,
    audio: options.captureAudio
      ? simplifyAudio || isAndroid
        ? true
        : {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
      : false,
  };

  if (!omitChromeAudioHints && !isAndroid) {
    base.selfBrowserSurface = 'exclude';
    base.surfaceSwitching = 'include';
    base.monitorTypeSurfaces = 'include';
    if (options.captureAudio) {
      base.systemAudio = 'include';
      base.suppressLocalAudioPlayback = false;
    }
  }

  return base;
}

export async function captureScreenStream(options: CaptureOptions): Promise<MediaStream> {
  const support = getScreenCaptureSupport();
  if (!support.supported) {
    throw new ScreenCaptureError(
      support.secureContext ? 'NOT_SUPPORTED' : 'INSECURE_CONTEXT',
      support.reason ||
        'Screen capture (getDisplayMedia) requires a supported desktop browser over HTTPS or localhost.',
    );
  }

  const shouldTrySurfaceHint =
    Boolean(options.surfacePreference && options.surfacePreference !== 'any') &&
    support.supportsDisplaySurfaceConstraint;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(
      buildDisplayMediaOptions(options, shouldTrySurfaceHint, false, false),
    );
  } catch (err) {
    const errName = (err as { name?: string } | null)?.name;
    // Fallback cleanly for Safari/Firefox or stricter browsers that reject Chromium systemAudio or audio constraint objects
    if (
      errName === 'OverconstrainedError' ||
      errName === 'TypeError' ||
      errName === 'NotSupportedError'
    ) {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(
          buildDisplayMediaOptions(options, false, true, true),
        );
      } catch (fallbackErr) {
        throw classifyScreenCaptureError(fallbackErr);
      }
    } else {
      throw classifyScreenCaptureError(err);
    }
  }

  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack || videoTrack.readyState !== 'live') {
    stopMediaStream(stream);
    throw new ScreenCaptureError(
      'NO_SOURCE_AVAILABLE',
      'The browser returned a MediaStream without an active video track.',
    );
  }

  if ('contentHint' in videoTrack) {
    try {
      videoTrack.contentHint = options.contentHint;
    } catch {
      // Ignore if browser treats contentHint as read-only
    }
  }

  return stream;
}

export async function applyVideoTrackConstraints(
  stream: MediaStream | null,
  resolutionId: StreamResolutionId,
  frameRate: StreamFrameRate,
  contentHint?: StreamContentHint,
): Promise<boolean> {
  const videoTrack = stream?.getVideoTracks()[0];
  if (!videoTrack || videoTrack.readyState !== 'live') {
    return false;
  }

  if (contentHint && 'contentHint' in videoTrack) {
    try {
      videoTrack.contentHint = contentHint;
    } catch {
      // Ignore read-only contentHint
    }
  }

  const currentSettings = videoTrack.getSettings();
  const isPortrait =
    currentSettings.width && currentSettings.height
      ? currentSettings.height > currentSettings.width
      : isPortraitDisplay();
  const dimensions = resolveCaptureDimensions(resolutionId, isPortrait);
  try {
    await videoTrack.applyConstraints({
      width: { ideal: dimensions.width, max: dimensions.width },
      height: { ideal: dimensions.height, max: dimensions.height },
      frameRate: { ideal: frameRate, max: frameRate },
    });
    return true;
  } catch {
    try {
      await videoTrack.applyConstraints({
        width: { ideal: dimensions.width },
        height: { ideal: dimensions.height },
        frameRate: { ideal: frameRate },
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function setStreamAudioEnabled(
  stream: MediaStream | null,
  enabled: boolean,
): boolean {
  if (!stream) return false;
  const audioTracks = stream.getAudioTracks().filter((t) => t.readyState === 'live');
  if (audioTracks.length === 0) return false;
  for (const track of audioTracks) {
    track.enabled = enabled;
  }
  return true;
}

export function extractStreamMetadata(stream: MediaStream | null): StreamMetadata {
  if (!stream) {
    return { active: false, hasAudio: false };
  }

  const videoTrack = stream.getVideoTracks()[0];
  const liveAudioTracks = stream
    .getAudioTracks()
    .filter((track) => track.readyState === 'live');
  if (!videoTrack || videoTrack.readyState !== 'live') {
    return { active: false, hasAudio: false };
  }

  const settings = videoTrack.getSettings() as MediaTrackSettings & {
    displaySurface?: string;
  };

  const hasAudio = liveAudioTracks.length > 0;
  const audioMuted = hasAudio
    ? liveAudioTracks.every((track) => !track.enabled)
    : undefined;
  const audioTrackMuted = hasAudio
    ? liveAudioTracks.every((track) => track.muted)
    : undefined;

  let audioReason: string | undefined;
  if (!hasAudio) {
    audioReason =
      'No audio track captured. Check "Share audio" when picking a Chrome/Edge tab or Windows display (Safari & Firefox screen capture is typically video-only).';
  } else if (audioTrackMuted) {
    audioReason =
      'Audio track present, but paused or muted at the OS/browser capture source.';
  } else if (audioMuted) {
    audioReason = 'Source broadcaster muted shared audio.';
  }

  return {
    active: true,
    hasAudio,
    audioMuted,
    audioTrackMuted,
    audioReason,
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate ? Math.round(settings.frameRate) : undefined,
    displaySurface: settings.displaySurface,
  };
}

export function formatDisplaySurface(surface?: string): string {
  switch (surface) {
    case 'monitor':
      return 'Full Display';
    case 'window':
      return 'Application Window';
    case 'browser':
      return 'Browser Tab';
    default:
      return 'Screen Surface';
  }
}

export function attachStreamLifecycleListeners(
  stream: MediaStream,
  callbacks: {
    onNativeStop: (reason: string) => void;
    onMetadataChange?: (metadata: StreamMetadata) => void;
    onAudioTracksChanged?: (stream: MediaStream) => void;
  },
): () => void {
  let cleanedUp = false;
  let stopTriggered = false;
  const boundTrackCleanups = new Map<MediaStreamTrack, () => void>();

  const triggerStop = (reason: string) => {
    if (cleanedUp || stopTriggered) return;
    stopTriggered = true;
    callbacks.onNativeStop(reason);
  };

  const handleVideoTrackEnded = () => {
    triggerStop('Screen sharing stopped from browser controls.');
  };

  const handleStreamInactive = () => {
    triggerStop('Captured MediaStream became inactive.');
  };

  const handleAudioTrackStateChange = () => {
    if (cleanedUp || stopTriggered) return;
    callbacks.onMetadataChange?.(extractStreamMetadata(stream));
  };

  const bindTrack = (track: MediaStreamTrack) => {
    if (boundTrackCleanups.has(track)) return;
    if (track.kind === 'video') {
      track.addEventListener('ended', handleVideoTrackEnded);
      boundTrackCleanups.set(track, () => {
        track.removeEventListener('ended', handleVideoTrackEnded);
      });
    } else if (track.kind === 'audio') {
      track.addEventListener('ended', handleAudioTrackStateChange);
      track.addEventListener('mute', handleAudioTrackStateChange);
      track.addEventListener('unmute', handleAudioTrackStateChange);
      boundTrackCleanups.set(track, () => {
        track.removeEventListener('ended', handleAudioTrackStateChange);
        track.removeEventListener('mute', handleAudioTrackStateChange);
        track.removeEventListener('unmute', handleAudioTrackStateChange);
      });
    }
  };

  for (const track of stream.getTracks()) {
    bindTrack(track);
  }

  const handleAddTrack = (event: MediaStreamTrackEvent) => {
    if (cleanedUp || stopTriggered) return;
    bindTrack(event.track);
    callbacks.onMetadataChange?.(extractStreamMetadata(stream));
    if (event.track.kind === 'audio') {
      callbacks.onAudioTracksChanged?.(stream);
    }
  };

  const handleRemoveTrack = (event: MediaStreamTrackEvent) => {
    if (cleanedUp || stopTriggered) return;
    const cleanup = boundTrackCleanups.get(event.track);
    if (cleanup) {
      cleanup();
      boundTrackCleanups.delete(event.track);
    }
    callbacks.onMetadataChange?.(extractStreamMetadata(stream));
    if (event.track.kind === 'audio') {
      callbacks.onAudioTracksChanged?.(stream);
    }
  };

  stream.addEventListener?.('inactive', handleStreamInactive);
  stream.addEventListener?.('addtrack', handleAddTrack);
  stream.addEventListener?.('removetrack', handleRemoveTrack);

  return () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const cleanup of boundTrackCleanups.values()) {
      cleanup();
    }
    boundTrackCleanups.clear();
    stream.removeEventListener?.('inactive', handleStreamInactive);
    stream.removeEventListener?.('addtrack', handleAddTrack);
    stream.removeEventListener?.('removetrack', handleRemoveTrack);
  };
}

export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.onended = null;
      if (track.readyState !== 'ended') {
        track.stop();
      }
    } catch {
      // Ignore already-stopped track errors
    }
  }
}
