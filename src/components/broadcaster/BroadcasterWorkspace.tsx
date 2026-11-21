import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Cast,
  Check,
  Copy,
  Crosshair,
  Info,
  Link2,
  Lock,
  Mic,
  MicOff,
  Monitor,
  MonitorUp,
  RefreshCw,
  Square,
  Unlock,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import type { UseBroadcasterReturn } from '../../hooks/useBroadcaster.ts';
import { QUALITY_MODE_OPTIONS } from '../../services/streaming/adaptiveQuality.ts';
import { formatDisplaySurface } from '../../services/streaming/mediaCaptureService.ts';
import {
  DISPLAY_SURFACE_OPTIONS,
  ROOM_LIFETIME_PRESETS,
  STREAM_FRAME_RATE_OPTIONS,
  STREAM_RESOLUTION_OPTIONS,
  type AudioConnectionState,
  type DisplaySurfacePreference,
  type ScreenCaptureStatus,
  type StreamContentHint,
  type StreamFrameRate,
  type StreamResolutionId,
} from '../../types/streaming.ts';
import {
  buildReceiverJoinUrl,
  formatBitrate,
  formatElapsedTime,
  formatJoinTime,
  formatLifetimeDuration,
  formatRemainingLifetime,
} from '../../utils/platform.ts';
import { EmptyState } from '../common/EmptyState.tsx';
import { StatusLabel } from '../common/StatusLabel.tsx';
import { ReceiverRoster } from './ReceiverRoster.tsx';

interface BroadcasterWorkspaceProps {
  broadcaster: UseBroadcasterReturn;
  onSwitchToReceiver?: () => void;
}

function getCaptureStatusSummary(
  status: ScreenCaptureStatus,
  displaySurface: string | undefined,
  startedAt: number | null,
  now: number,
): { label: string; colorClass: string; dotClass?: string; elapsed?: string } {
  switch (status) {
    case 'sharing':
      return {
        label: `Sharing ${formatDisplaySurface(displaySurface)}`,
        colorClass: 'text-emerald-700',
        dotClass: 'bg-emerald-600',
        elapsed: formatElapsedTime(startedAt, now),
      };
    case 'requesting':
      return {
        label: 'Awaiting screen selection...',
        colorClass: 'text-amber-700',
        dotClass: 'bg-amber-500',
      };
    case 'permission-denied':
      return {
        label: 'Permission rejected',
        colorClass: 'text-red-700',
        dotClass: 'bg-red-600',
      };
    case 'stopped':
      return {
        label: 'Sharing stopped',
        colorClass: 'text-zinc-600',
      };
    case 'unsupported':
      return {
        label: 'Capture unavailable in browser',
        colorClass: 'text-amber-700',
      };
    case 'error':
      return {
        label: 'Capture error',
        colorClass: 'text-red-700',
      };
    default:
      return {
        label: 'Standby',
        colorClass: 'text-zinc-500',
      };
  }
}

export function BroadcasterWorkspace({
  broadcaster,
  onSwitchToReceiver,
}: BroadcasterWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [previewDims, setPreviewDims] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [localPointerPos, setLocalPointerPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  const {
    deviceName,
    setDeviceName,
    commitDeviceName,
    customPin,
    setCustomPin,
    maxReceivers,
    serverMaxReceivers,
    serverMaxTotalDevices,
    updateMaxReceivers,
    roomLifetimeMs,
    serverMaxLifetimeMs,
    isAdmin,
    updateRoomLifetime,
    resolutionId,
    setResolutionId,
    frameRate,
    setFrameRate,
    qualityMode,
    setQualityMode,
    effectiveCeiling,
    targetBitrateBps,
    surfacePreference,
    setSurfacePreference,
    captureAudio,
    setCaptureAudio,
    sourceAudioMuted,
    toggleSourceAudio,
    audioState,
    audioStatusLabel,
    audioSupport,
    contentHint,
    setContentHint,
    pointerEnabled,
    setPointerEnabled,
    emitPointer,
    signalingState,
    isOnline,
    isReconnectingSession,
    reconnectSignaling,
    session,
    sessionPin,
    analytics,
    isRoomLocked,
    toggleRoomLock,
    localStream,
    streamMetadata,
    captureStatus,
    captureSupport,
    captureSourceLabel,
    peers,
    connectedReceiverCount,
    totalDevicesConnected,
    totalUploadKbps,
    averageRttMs,
    totalPacketsLostDelta,
    sourceConnectionType,
    streamStartedAt,
    lastRoomEvent,
    error,
    sourceLifecycleNotice,
    clearSourceLifecycleNotice,
    clearError,
    displayMediaSupported,
    isMobileOptimizedDefault,
    isBusy,
    openRoom,
    startScreenCast,
    switchScreenSource,
    stopScreenCast,
    closeSession,
    kickReceiver,
    reconnectPeer,
  } = broadcaster;

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (!localStream) {
      videoEl.pause();
      videoEl.srcObject = null;
      setPreviewDims(null);
      return;
    }

    videoEl.srcObject = localStream;
    void videoEl.play().catch(() => {});
  }, [localStream]);

  useEffect(() => {
    if (!streamStartedAt && !session) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session, streamStartedAt]);

  useEffect(() => {
    if (!session) {
      setQrDataUrl(null);
      return;
    }
    // QR code contains only the receiver joining URL and public room code (never PIN or auth secrets)
    const joinUrl = buildReceiverJoinUrl(session.code);
    let active = true;
    QRCode.toDataURL(joinUrl, {
      width: 220,
      margin: 2,
      color: {
        dark: '#18181B',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [session]);

  const handleCopyCode = async () => {
    if (!session) return;
    try {
      const text = sessionPin ? `${session.code} (PIN: ${sessionPin})` : session.code;
      await navigator.clipboard.writeText(text);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 1800);
    } catch {
      // Clipboard API may fail without permission
    }
  };

  const handleCopyLink = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(buildReceiverJoinUrl(session.code));
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Clipboard API may fail without permission
    }
  };

  const hasLiveVideoTrack = Boolean(
    localStream?.getVideoTracks().some((track) => track.readyState === 'live'),
  );
  const hasLiveAudioTrack = Boolean(
    localStream?.getAudioTracks().some((track) => track.readyState === 'live'),
  );
  const isStreaming = Boolean(
    localStream && hasLiveVideoTrack && streamMetadata.active && captureStatus === 'sharing',
  );
  const isAndroidSource =
    captureSupport.platform === 'Android' && isMobileOptimizedDefault;
  useEffect(() => {
    if (!isStreaming || !hasLiveAudioTrack) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        toggleSourceAudio();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasLiveAudioTrack, isStreaming, toggleSourceAudio]);

  const perStreamMbps = targetBitrateBps / 1_000_000;
  const projectedCeilingMbps = Math.max(1, peers.length) * perStreamMbps;
  const measuredUploadLabel =
    connectedReceiverCount > 0
      ? totalUploadKbps > 0
        ? formatBitrate(totalUploadKbps)
        : 'Measuring...'
      : '—';
  const showUploadAdvisory =
    (peers.length >= 3 && perStreamMbps >= 8) || totalPacketsLostDelta >= 5;
  const deviceNameDirty = Boolean(
    session && deviceName.trim().length > 0 && deviceName.trim() !== session.broadcaster.deviceName,
  );
  const captureSummary = getCaptureStatusSummary(
    captureStatus,
    streamMetadata.displaySurface,
    streamStartedAt,
    now,
  );

  const AUDIO_STATE_LABELS: Record<AudioConnectionState, string> = {
    connected: 'Audio available',
    available: 'Audio available',
    muted: 'Audio muted',
    unavailable: 'Audio unavailable',
    'permission-required': 'Permission required',
  };
  const audioStatusText = isStreaming
    ? audioStatusLabel || AUDIO_STATE_LABELS[audioState]
    : captureAudio
      ? 'Requested on Share'
      : 'Audio unavailable';

  const hostQualitySummary =
    connectedReceiverCount === 0
      ? 'Standby'
      : totalPacketsLostDelta >= 15 || (averageRttMs !== null && averageRttMs > 160)
        ? 'Poor'
        : totalPacketsLostDelta >= 3 || (averageRttMs !== null && averageRttMs > 75)
          ? 'Fair'
          : averageRttMs !== null && averageRttMs <= 30 && totalPacketsLostDelta === 0
            ? 'Excellent'
            : averageRttMs !== null || totalUploadKbps > 0
              ? 'Good'
              : 'Measuring';

  const inviteJoinUrl = session ? buildReceiverJoinUrl(session.code) : '';

  return (
    <div className={`space-y-6 ${isAndroidSource ? 'android-broadcast-mode' : ''}`}>
      {!isOnline || isReconnectingSession ? (
        <div
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-amber-950"
        >
          <div className="flex items-center gap-2.5">
            <WifiOff className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              {!isOnline
                ? 'Device network is offline. Holding active capture ready for up to 25 seconds until connectivity returns.'
                : 'Signaling link interrupted. Reconnecting and preserving your active broadcast room...'}
            </span>
          </div>
          {isOnline && signalingState !== 'connected' ? (
            <button
              type="button"
              onClick={reconnectSignaling}
              className="px-3 py-1 rounded-md border border-amber-300 bg-white text-xs font-medium text-amber-900 hover:bg-amber-100 whitespace-nowrap"
            >
              Retry Now
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-2.5 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="text-xs font-medium text-red-700 hover:text-red-900 whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {isAndroidSource ? (
        <div className="android-broadcast-instructions" role="status">
          <strong>Android screen broadcasting</strong>
          <span>
            Tap Start Broadcasting, approve the Android screen-capture prompt, then choose
            whether to share device audio if your browser offers that option. Keep MultiCast
            open; Android may pause or end capture when you switch apps or lock the phone.
          </span>
        </div>
      ) : null}

      {sourceLifecycleNotice ? (
        <div className="android-lifecycle-notice" role="status">
          <span>{sourceLifecycleNotice}</span>
          <button type="button" onClick={clearSourceLifecycleNotice} aria-label="Dismiss backgrounding notice">
            Dismiss
          </button>
        </div>
      ) : null}

      {!captureSupport.supported ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="font-semibold">
              {!captureSupport.secureContext
                ? 'Secure HTTPS connection required for screen broadcasting'
                : `Screen broadcasting unavailable in ${captureSupport.browser} on ${captureSupport.platform}`}
            </div>
            <p className="text-xs text-amber-900 leading-relaxed">
              {captureSupport.reason}{' '}
              {captureSupport.guidance ? captureSupport.guidance : ''}
            </p>
          </div>
          {onSwitchToReceiver ? (
            <button
              type="button"
              onClick={onSwitchToReceiver}
              className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 touch-manipulation"
            >
              <Monitor className="h-3.5 w-3.5" />
              <span>Switch to Receiver Display</span>
            </button>
          ) : null}
        </div>
      ) : isMobileOptimizedDefault ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs text-zinc-600 flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-red-600 shrink-0" />
          <span>
            Mobile network preset active on {captureSupport.platform}: defaulting to{' '}
            <strong className="text-zinc-900">720p · 30 fps Adaptive</strong> for smoother cellular/Wi-Fi upload.
          </span>
        </div>
      ) : null}

      {isStreaming && captureAudio && (!hasLiveAudioTrack || !streamMetadata.hasAudio) ? (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-2.5 text-xs text-amber-900 leading-relaxed"
        >
          <strong>Audio Unavailable (Video Only):</strong>{' '}
          {streamMetadata.audioReason ||
            'Your browser or OS did not supply an audio track for the selected source. On Chrome/Edge desktop, share a Browser Tab with "Share tab audio" checked or Whole Screen with "Share system audio" checked; Safari and Firefox typically supply video only.'}
        </div>
      ) : null}

      {lastRoomEvent ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-zinc-700">
          <div className="flex items-center gap-2 min-w-0">
            <Info className="h-3.5 w-3.5 text-red-600 shrink-0" />
            <span className="truncate">{lastRoomEvent}</span>
          </div>
          <span className="text-[11px] text-zinc-400 whitespace-nowrap shrink-0">
            Room activity
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Primary Live Stage (8 cols) */}
        <section className="xl:col-span-8 rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-zinc-900">
                Source Screen Preview
              </h2>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-medium ${captureSummary.colorClass}`}
              >
                {captureSummary.dotClass ? (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${captureSummary.dotClass}`}
                    aria-hidden="true"
                  />
                ) : null}
                <span>{captureSummary.label}</span>
                {captureSummary.elapsed ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{captureSummary.elapsed}</span>
                  </>
                ) : null}
              </span>
              <span className="text-zinc-300" aria-hidden="true">
                ·
              </span>
              <div className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <span>Connection Status:</span>
                <StatusLabel status={signalingState} />
                {signalingState === 'disconnected' || signalingState === 'error' ? (
                  <button
                    type="button"
                    onClick={reconnectSignaling}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 whitespace-nowrap"
                  >
                    Reconnect
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={() => {
                    const next = !pointerEnabled;
                    setPointerEnabled(next);
                    if (!next) {
                      setLocalPointerPos(null);
                      emitPointer(false, 0.5, 0.5);
                    }
                  }}
                  title="Broadcast pointer highlight over your preview to all receivers"
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    pointerEnabled
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <Crosshair className="h-3.5 w-3.5" />
                  <span>{pointerEnabled ? 'Pointer On' : 'Pointer Highlight'}</span>
                </button>
              ) : null}
              {isStreaming && hasLiveAudioTrack && streamMetadata.hasAudio ? (
                <button
                  type="button"
                  onClick={toggleSourceAudio}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {sourceAudioMuted ? (
                    <MicOff className="h-3.5 w-3.5 text-amber-600" />
                  ) : (
                    <Mic className="h-3.5 w-3.5 text-emerald-600" />
                  )}
                  <span>{sourceAudioMuted ? 'Unmute Audio' : 'Mute Audio'}</span>
                </button>
              ) : null}
              {isStreaming ? (
                <>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void switchScreenSource()}
                    className="min-h-[44px] sm:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 touch-manipulation"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Switch Screen</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => stopScreenCast('Stopped by broadcaster.')}
                    className={`min-h-[44px] sm:min-h-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-red-600 text-xs font-semibold text-white hover:bg-red-700 transition-colors whitespace-nowrap shrink-0 touch-manipulation ${
                      isAndroidSource ? 'android-broadcast-action' : ''
                    }`}
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    <span>{isAndroidSource ? 'Stop Broadcasting' : 'Stop Sharing'}</span>
                  </button>
                </>
              ) : displayMediaSupported ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void startScreenCast()}
                  className={`min-h-[44px] sm:min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-xs font-semibold text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 touch-manipulation ${
                    isAndroidSource ? 'android-broadcast-action' : ''
                  }`}
                >
                  <MonitorUp className="h-3.5 w-3.5" />
                  <span>
                    {isBusy
                      ? 'Starting...'
                      : isAndroidSource
                        ? 'Start Broadcasting'
                        : 'Start Sharing'}
                  </span>
                </button>
              ) : onSwitchToReceiver ? (
                <button
                  type="button"
                  onClick={onSwitchToReceiver}
                  className="min-h-[44px] sm:min-h-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-zinc-200 bg-white hover:border-red-200 hover:bg-red-50/40 text-xs font-semibold text-zinc-900 transition-colors whitespace-nowrap shrink-0 touch-manipulation"
                >
                  <Monitor className="h-3.5 w-3.5 text-red-600" />
                  <span>Open Receiver Display</span>
                </button>
              ) : null}
            </div>
          </div>

          <div
            onPointerMove={(e) => {
              if (!isStreaming || !pointerEnabled) return;
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return;
              const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
              setLocalPointerPos({ x, y });
              emitPointer(true, x, y);
            }}
            onPointerLeave={() => {
              if (!pointerEnabled) return;
              setLocalPointerPos(null);
              emitPointer(false, 0.5, 0.5);
            }}
            className={`bg-[#09090B] aspect-video w-full flex items-center justify-center relative ${
              isStreaming && pointerEnabled ? 'cursor-crosshair' : ''
            }`}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                if (el.videoWidth > 0 && el.videoHeight > 0) {
                  setPreviewDims({ width: el.videoWidth, height: el.videoHeight });
                }
              }}
              onPlaying={(e) => {
                const el = e.currentTarget;
                if (el.videoWidth > 0 && el.videoHeight > 0) {
                  setPreviewDims({ width: el.videoWidth, height: el.videoHeight });
                }
              }}
              onResize={(e) => {
                const el = e.currentTarget;
                if (el.videoWidth > 0 && el.videoHeight > 0) {
                  setPreviewDims({ width: el.videoWidth, height: el.videoHeight });
                }
              }}
              onEmptied={() => setPreviewDims(null)}
              className={`w-full h-full object-contain ${isStreaming ? 'block' : 'hidden'}`}
            />

            {isStreaming && pointerEnabled && localPointerPos ? (
              <div
                aria-hidden="true"
                style={{
                  left: `${localPointerPos.x * 100}%`,
                  top: `${localPointerPos.y * 100}%`,
                }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-red-500/90 ring-4 ring-red-500/30 shadow-md"
              />
            ) : null}

            {!isStreaming ? (
              <EmptyState
                dark
                icon={<Cast className="h-5 w-5" />}
                title={
                  !displayMediaSupported
                    ? !captureSupport.secureContext
                      ? 'HTTPS connection required to share screen'
                      : `Screen capture unsupported on ${captureSupport.platform} ${captureSupport.browser}`
                    : captureStatus === 'permission-denied'
                      ? 'Screen capture permission denied'
                      : captureStatus === 'stopped'
                        ? 'Screen sharing ended'
                        : 'Ready to broadcast your screen'
                }
                description={
                  !displayMediaSupported
                    ? `${captureSupport.reason || 'This browser cannot share its screen.'} ${
                        captureSupport.guidance || ''
                      }`
                    : captureStatus === 'permission-denied'
                      ? isAndroidSource
                        ? 'Tap Start Broadcasting and approve the Android screen-capture prompt. If you cancelled it, tap again to retry.'
                        : 'Allow screen capture in your browser or OS Screen Recording settings, then tap Start Sharing.'
                      : isAndroidSource
                        ? 'Tap Start Broadcasting, then confirm the Android screen-capture prompt. Choose audio in the system prompt only if the option is offered.'
                        : 'Click Start Sharing to choose a display, window, or browser tab. Screen capture only runs after you confirm.'
                }
                action={
                  displayMediaSupported ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void startScreenCast()}
                      className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-sm font-semibold text-white disabled:opacity-50 transition-colors touch-manipulation ${
                        isAndroidSource ? 'android-broadcast-action' : ''
                      }`}
                    >
                      <MonitorUp className="h-4 w-4" />
                      <span>{isAndroidSource ? 'Start Broadcasting' : 'Start Sharing'}</span>
                    </button>
                  ) : onSwitchToReceiver ? (
                    <button
                      type="button"
                      onClick={onSwitchToReceiver}
                      className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-sm font-semibold text-white transition-colors touch-manipulation"
                    >
                      <Monitor className="h-4 w-4" />
                      <span>Switch to Receiver Display</span>
                    </button>
                  ) : undefined
                }
              />
            ) : null}
          </div>

          <div className="px-5 py-3 border-t border-zinc-200 bg-zinc-50/70 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-600">
            <div className="flex flex-wrap items-center gap-2 tabular-nums">
              <span>
                Resolution:{' '}
                <strong className="font-mono font-medium text-zinc-900">
                  {isStreaming && (previewDims?.width || streamMetadata.width)
                    ? `${previewDims?.width || streamMetadata.width}×${previewDims?.height || streamMetadata.height}`
                    : '—'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Capture FPS:{' '}
                <strong className="font-mono font-medium text-zinc-900">
                  {isStreaming && streamMetadata.frameRate
                    ? `${streamMetadata.frameRate} fps`
                    : '—'}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Audio Status:{' '}
                <strong
                  className={`font-medium ${
                    isStreaming && audioState === 'connected'
                      ? 'text-emerald-700'
                      : isStreaming && audioState === 'available'
                        ? 'text-zinc-900'
                        : isStreaming && (audioState === 'muted' || audioState === 'unavailable')
                          ? 'text-amber-700'
                          : 'text-zinc-900'
                  }`}
                >
                  {audioStatusText}
                </strong>
              </span>
            </div>
            {isStreaming ? (
              <span className="text-zinc-500 truncate max-w-[260px]" title={captureSourceLabel || undefined}>
                {formatDisplaySurface(streamMetadata.displaySurface)}
                {captureSourceLabel ? ` · ${captureSourceLabel}` : ''}
              </span>
            ) : null}
          </div>

          <div className="px-5 py-3 border-t border-zinc-200 bg-white flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-zinc-600 tabular-nums">
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
                <ArrowUpRight className="h-3.5 w-3.5 text-red-600 shrink-0" />
                <span>
                  Upload:{' '}
                  <strong className="font-mono font-semibold text-zinc-900">
                    {measuredUploadLabel}
                  </strong>
                </span>
              </span>
              <span className="text-zinc-300" aria-hidden="true">
                ·
              </span>
              <span>
                Devices:{' '}
                <strong className="font-mono font-medium text-zinc-900">
                  {totalDevicesConnected} / {session ? session.maxTotalDevices : maxReceivers + 1}
                </strong>{' '}
                <span className="text-zinc-500">
                  ({connectedReceiverCount}/{maxReceivers} receivers)
                </span>
              </span>
              <span className="text-zinc-300" aria-hidden="true">
                ·
              </span>
              <span>
                Active Cap:{' '}
                <strong className="font-mono font-medium text-zinc-900">
                  {effectiveCeiling.effectiveWidth}×{effectiveCeiling.effectiveHeight} ·{' '}
                  {effectiveCeiling.maxFramerate} fps
                </strong>
              </span>
              {connectedReceiverCount > 0 ? (
                <>
                  <span className="text-zinc-300" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    Avg RTT:{' '}
                    <strong className="font-mono font-medium text-zinc-900">
                      {averageRttMs !== null ? `${averageRttMs} ms` : 'Unavailable'}
                    </strong>
                  </span>
                  <span className="text-zinc-300" aria-hidden="true">
                    ·
                  </span>
                  <span>
                    Loss:{' '}
                    <strong
                      className={`font-mono font-medium ${
                        totalPacketsLostDelta > 0 ? 'text-amber-700' : 'text-zinc-900'
                      }`}
                    >
                      {totalPacketsLostDelta}/s
                    </strong>
                  </span>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="live-resolution-selector"
                className="text-zinc-500 whitespace-nowrap"
              >
                Res:
              </label>
              <select
                id="live-resolution-selector"
                value={resolutionId}
                onChange={(e) => setResolutionId(e.target.value as StreamResolutionId)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-800 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
              >
                {Object.values(STREAM_RESOLUTION_OPTIONS).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.id}
                  </option>
                ))}
              </select>

              <label
                htmlFor="live-fps-selector"
                className="text-zinc-500 whitespace-nowrap"
              >
                FPS:
              </label>
              <select
                id="live-fps-selector"
                value={frameRate}
                onChange={(e) => setFrameRate(Number(e.target.value) as StreamFrameRate)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-800 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
              >
                {STREAM_FRAME_RATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value} fps
                  </option>
                ))}
              </select>
            </div>
          </div>

          {showUploadAdvisory ? (
            <div className="px-5 py-2.5 border-t border-amber-200 bg-amber-50/70 text-xs text-amber-900">
              {totalPacketsLostDelta >= 5
                ? `Detected ${totalPacketsLostDelta} lost packets/sec across receivers. Step down to `
                : `P2P 1-to-${peers.length} broadcasting at ${perStreamMbps.toFixed(1)} Mbps/peer can pull up to ${projectedCeilingMbps.toFixed(1)} Mbps. Step down to `}
              <button
                type="button"
                onClick={() => {
                  setResolutionId('720p');
                  setFrameRate(30);
                }}
                className="font-semibold underline underline-offset-2 hover:text-amber-950"
              >
                720p · 30 fps (2.5 Mbps/peer)
              </button>{' '}
              for smoother multi-screen stability.
            </div>
          ) : null}
        </section>

        {/* Pairing, PIN, QR Code & Stream Settings Panel (4 cols) */}
        <aside className="xl:col-span-4 rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-200">
          <div className="p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-900">
                Room Code, Link &amp; QR
              </h2>
              {session ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleRoomLock()}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                      isRoomLocked
                        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:border-red-200 hover:text-red-700'
                    }`}
                  >
                    {isRoomLocked ? (
                      <>
                        <Lock className="h-3 w-3" />
                        <span>Locked</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="h-3 w-3" />
                        <span>Lock</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={closeSession}
                    className="text-xs font-medium text-zinc-500 hover:text-red-700 transition-colors"
                  >
                    Close Room
                  </button>
                </div>
              ) : null}
            </div>

            {session ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium text-zinc-500">
                      Room Code
                    </div>
                    <span className="font-mono text-xl font-semibold tracking-[0.2em] text-zinc-900 tabular-nums">
                      {session.code}
                    </span>
                  </div>
                  {sessionPin ? (
                    <div className="pl-3 border-l border-zinc-200">
                      <div className="text-[11px] font-medium text-zinc-500">PIN</div>
                      <span className="font-mono text-xl font-semibold tracking-[0.18em] text-red-600 tabular-nums">
                        {sessionPin}
                      </span>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleCopyCode()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:border-red-200 hover:bg-red-50/40 transition-colors whitespace-nowrap"
                  >
                    {copiedCode ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-red-600" />
                    )}
                    <span>{copiedCode ? 'Copied' : 'Copy Code'}</span>
                  </button>
                </div>

                {qrDataUrl ? (
                  <div className="rounded-lg border border-zinc-200 bg-white p-3.5 flex flex-col sm:flex-row items-center gap-4">
                    <img
                      src={qrDataUrl}
                      alt={`QR code to open receiver page for room ${session.code}`}
                      className="h-36 w-36 sm:h-28 sm:w-28 rounded-lg border border-zinc-100 shrink-0"
                    />
                    <div className="text-xs text-zinc-600 leading-relaxed space-y-1 text-center sm:text-left">
                      <p>
                        Scan from iPhone, iPad, or Android to open room{' '}
                        <strong className="font-mono text-zinc-900">{session.code}</strong>{' '}
                        with the code prefilled.
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        PIN and session tokens are never included in QR codes or URLs.
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-zinc-600 truncate">
                    {inviteJoinUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyLink()}
                    className="min-h-[38px] sm:min-h-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:border-red-200 hover:bg-red-50/40 transition-colors whitespace-nowrap shrink-0 touch-manipulation"
                  >
                    {copiedLink ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5 text-red-600" />
                    )}
                    <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                  </button>
                </div>

                <div className="text-[11px] text-zinc-500 flex items-center justify-between gap-2 tabular-nums">
                  <span>
                    {session.lifetimeMs === 0
                      ? 'Room lifetime policy'
                      : session.stream.active || session.receivers.length > 0
                        ? `Max lifetime (${formatLifetimeDuration(session.lifetimeMs)})`
                        : 'Room lifetime / idle cleanup'}
                  </span>
                  <span className="font-mono font-medium text-zinc-700">
                    {formatRemainingLifetime(session.expiresAt, session.lifetimeMs, now)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Open a room to generate a 6-character code, numeric PIN, and scannable QR
                  code before you start sharing.
                </p>
                <div>
                  <label
                    htmlFor="broadcaster-custom-pin"
                    className="block text-xs font-medium text-zinc-700 mb-1"
                  >
                    Custom Room PIN (optional, 4–6 digits)
                  </label>
                  <input
                    id="broadcaster-custom-pin"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={customPin}
                    onChange={(e) => setCustomPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="Auto-generate secure 4-digit PIN"
                    autoComplete="off"
                    className="w-full min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-base sm:text-sm text-zinc-900 placeholder:font-sans placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
                  />
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void openRoom()}
                  className="w-full min-h-[44px] sm:min-h-0 px-3.5 py-2.5 sm:py-2 rounded-lg border border-zinc-200 bg-white text-xs font-semibold text-zinc-800 hover:border-red-200 hover:bg-red-50/40 disabled:opacity-50 transition-colors whitespace-nowrap touch-manipulation"
                >
                  Open Pairing Room
                </button>
              </div>
            )}
          </div>

          <div className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-900">
              Broadcast Configuration
            </h3>

            <div>
              <label
                htmlFor="broadcaster-device-name"
                className="block text-xs font-medium text-zinc-700 mb-1.5"
              >
                Source Device Name
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="broadcaster-device-name"
                  type="text"
                  maxLength={64}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && session) {
                      e.preventDefault();
                      void commitDeviceName();
                    }
                  }}
                  placeholder="e.g. Studio MacBook Pro"
                  className="w-full min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
                />
                {session ? (
                  <button
                    type="button"
                    disabled={!deviceNameDirty}
                    onClick={() => void commitDeviceName()}
                    className="min-h-[44px] sm:min-h-0 px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-45 whitespace-nowrap shrink-0 touch-manipulation"
                  >
                    Rename
                  </button>
                ) : null}
              </div>
              {session ? (
                <p className="mt-1 text-[11px] text-zinc-500">
                  Live updates for all connected receivers.
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="capture-surface-preference"
                className="block text-xs font-medium text-zinc-700 mb-1.5"
              >
                Preferred Capture Source
              </label>
              <select
                id="capture-surface-preference"
                value={surfacePreference}
                onChange={(e) =>
                  setSurfacePreference(e.target.value as DisplaySurfacePreference)
                }
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
              >
                {DISPLAY_SURFACE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="max-receivers-limit"
                className="block text-xs font-medium text-zinc-700 mb-1.5"
              >
                Room Capacity (Up to {serverMaxTotalDevices} total devices: 1 source +{' '}
                {serverMaxReceivers} receivers)
              </label>
              <select
                id="max-receivers-limit"
                value={maxReceivers}
                onChange={(e) => updateMaxReceivers(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
              >
                {Array.from({ length: serverMaxReceivers }, (_, index) => index + 1).map(
                  (count) => (
                    <option
                      key={count}
                      value={count}
                      disabled={count < peers.length}
                    >
                      Up to {count} {count === 1 ? 'receiver' : 'receivers'} ({count + 1} total devices)
                      {count === serverMaxReceivers ? ' · Max' : ''}
                    </option>
                  ),
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="room-lifetime-limit"
                className="block text-xs font-medium text-zinc-700 mb-1.5"
              >
                Room Lifetime{isAdmin ? ' (Admin Control)' : ''}
              </label>
              <select
                id="room-lifetime-limit"
                value={roomLifetimeMs}
                onChange={(e) => updateRoomLifetime(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
              >
                {ROOM_LIFETIME_PRESETS.map((preset) => {
                  const exceedsServerCap =
                    !isAdmin &&
                    serverMaxLifetimeMs > 0 &&
                    (preset.ms === 0 || preset.ms > serverMaxLifetimeMs);
                  return (
                    <option
                      key={preset.ms}
                      value={preset.ms}
                      disabled={exceedsServerCap}
                    >
                      {preset.label}
                      {exceedsServerCap ? ' (Admin only)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="stream-resolution"
                  className="block text-xs font-medium text-zinc-700 mb-1.5"
                >
                  Resolution
                </label>
                <select
                  id="stream-resolution"
                  value={resolutionId}
                  onChange={(e) =>
                    setResolutionId(e.target.value as StreamResolutionId)
                  }
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
                >
                  {Object.values(STREAM_RESOLUTION_OPTIONS).map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="stream-frame-rate"
                  className="block text-xs font-medium text-zinc-700 mb-1.5"
                >
                  Frame Rate
                </label>
                <select
                  id="stream-frame-rate"
                  value={frameRate}
                  onChange={(e) =>
                    setFrameRate(Number(e.target.value) as StreamFrameRate)
                  }
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
                >
                  {STREAM_FRAME_RATE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="-mt-2 text-[11px] text-zinc-500 tabular-nums">
              Honest effective ceiling:{' '}
              <strong className="font-mono text-zinc-700">
                {effectiveCeiling.effectiveWidth}×{effectiveCeiling.effectiveHeight} ·{' '}
                {effectiveCeiling.maxFramerate} fps
              </strong>{' '}
              ({(effectiveCeiling.targetBitrateBps / 1_000_000).toFixed(1)} Mbps/peer max).
            </p>

            <div>
              <span className="block text-xs font-medium text-zinc-700 mb-1.5">
                Smart Streaming Quality
              </span>
              <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-100 rounded-lg">
                {QUALITY_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setQualityMode(option.id)}
                    title={option.description}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      qualityMode === option.id
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {option.id === 'auto' ? 'Auto' : option.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-zinc-500 leading-snug">
                {QUALITY_MODE_OPTIONS.find((q) => q.id === qualityMode)?.description}
              </p>
            </div>

            <div>
              <span className="block text-xs font-medium text-zinc-700 mb-1.5">
                Content Optimization
              </span>
              <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-100 rounded-lg">
                {(
                  [
                    { id: 'detail', label: 'Text & UI' },
                    { id: 'motion', label: 'Video & Motion' },
                  ] as Array<{ id: StreamContentHint; label: string }>
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setContentHint(option.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      contentHint === option.id
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-1 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                  {captureAudio ? (
                    <Volume2 className="h-4 w-4 text-red-600" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-zinc-400" />
                  )}
                  <span>
                    {captureSupport.platform === 'Android'
                      ? 'Request shared audio (if available)'
                      : 'Share System / Tab Audio'}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={captureAudio}
                  onClick={() => setCaptureAudio(!captureAudio)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    captureAudio ? 'bg-red-600' : 'bg-zinc-300'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform ${
                      captureAudio ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug">
                {audioSupport.summary}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <ReceiverRoster
        peers={peers}
        sessionCode={session?.code || null}
        maxReceivers={session?.maxReceivers ?? maxReceivers}
        maxTotalDevices={session?.maxTotalDevices ?? serverMaxTotalDevices}
        totalDevicesConnected={totalDevicesConnected}
        isRoomLocked={isRoomLocked}
        onToggleRoomLock={session ? () => toggleRoomLock() : undefined}
        onKickReceiver={kickReceiver}
        onRetryPeer={reconnectPeer}
        isStreaming={isStreaming}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-red-600 shrink-0" />
              <h2 className="text-sm font-semibold text-zinc-900">
                Network Performance Monitor
              </h2>
            </div>
            <span className="text-xs font-medium text-zinc-600">{hostQualitySummary}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200">
            <div className="p-4">
              <div className="text-xs text-zinc-500">WebRTC Avg RTT</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                {averageRttMs !== null ? `${averageRttMs} ms` : 'Unavailable'}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-zinc-500">Packet Loss Rate</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                {connectedReceiverCount > 0 ? `${totalPacketsLostDelta}/s` : 'Unavailable'}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-zinc-500">Source Network</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">
                {sourceConnectionType || 'Unavailable'}
              </div>
            </div>
          </div>
          <div className="px-5 py-2.5 border-t border-zinc-200 bg-zinc-50/70 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600 tabular-nums">
            <span>
              Upload throughput:{' '}
              <strong className="font-mono text-zinc-900">
                {connectedReceiverCount > 0 ? measuredUploadLabel : 'Unavailable'}
              </strong>
            </span>
            <span>
              Output ceiling:{' '}
              <strong className="font-mono text-zinc-900">
                {effectiveCeiling.effectiveWidth}×{effectiveCeiling.effectiveHeight} @{' '}
                {effectiveCeiling.maxFramerate} fps
              </strong>
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-red-600 shrink-0" />
              <h2 className="text-sm font-semibold text-zinc-900">
                Session Analytics (Host Only)
              </h2>
            </div>
            <span className="text-[11px] font-medium text-zinc-500">
              {analytics?.endedAt
                ? 'Final summary'
                : session
                  ? 'Live room telemetry'
                  : 'No active session'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-zinc-200">
            <div className="p-4">
              <div className="text-xs text-zinc-500">Session Duration</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                {analytics
                  ? formatElapsedTime(
                      analytics.startedAt,
                      analytics.endedAt ?? now,
                    )
                  : 'Unavailable'}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-zinc-500">Peak Receivers</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                {analytics ? analytics.peakReceivers : 'Unavailable'}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-zinc-500">Average Quality</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">
                {analytics
                  ? analytics.averageQualityLabel || 'Insufficient data'
                  : 'Unavailable'}
              </div>
            </div>
          </div>
          <div className="px-5 py-2.5 border-t border-zinc-200 bg-zinc-50/70 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-zinc-600 tabular-nums">
            <span>
              Started:{' '}
              <strong className="font-mono text-zinc-900">
                {analytics ? formatJoinTime(analytics.startedAt) : 'Unavailable'}
              </strong>
            </span>
            <span>
              Ended:{' '}
              <strong className="font-mono text-zinc-900">
                {analytics
                  ? analytics.endedAt
                    ? formatJoinTime(analytics.endedAt)
                    : 'Active now'
                  : 'Unavailable'}
              </strong>
            </span>
            <span>
              Joins:{' '}
              <strong className="font-mono text-zinc-900">
                {analytics ? analytics.totalReceiversJoined : '0'}
              </strong>
            </span>
            <span>
              Reconnects:{' '}
              <strong className="font-mono text-zinc-900">
                {analytics ? analytics.reconnectCount : '0'}
              </strong>
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
