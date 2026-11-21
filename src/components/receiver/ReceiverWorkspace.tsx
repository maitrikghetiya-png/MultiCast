import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Maximize2,
  Minimize2,
  Monitor,
  Pencil,
  PictureInPicture2,
  Play,
  RefreshCw,
  ShieldAlert,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext.tsx';
import type { UseReceiverReturn } from '../../hooks/useReceiver.ts';
import {
  clampAudioVolume,
  resolveAudioStatusSnapshot,
} from '../../services/streaming/audioState.ts';
import {
  detectBrowserName,
  detectDevicePlatform,
  type ParsedQrPayload,
} from '../../utils/platform.ts';
import { EmptyState } from '../common/EmptyState.tsx';
import { StatusLabel } from '../common/StatusLabel.tsx';
import { ConnectionDetails } from './ConnectionDetails.tsx';
import { NetworkQualityIndicator } from './NetworkQualityIndicator.tsx';
import { QrScannerPanel } from './QrScannerPanel.tsx';

interface ReceiverWorkspaceProps {
  receiver: UseReceiverReturn;
  initialCode?: string;
}

interface FormValidationErrors {
  code?: string;
  pin?: string;
}

type RoomLookupState =
  | { status: 'idle' }
  | { status: 'checking'; code: string }
  | {
      status: 'active';
      code: string;
      broadcasterName: string;
      broadcasterPlatform: string;
      receiverCount: number;
      maxReceivers: number;
      totalDevices: number;
      maxTotalDevices: number;
      isFull: boolean;
      isLocked: boolean;
      expiresAt: number | null;
    }
  | { status: 'expired'; code: string; message: string }
  | { status: 'not_found'; code: string; message: string };

export function ReceiverWorkspace({
  receiver,
  initialCode = '',
}: ReceiverWorkspaceProps) {
  const { recentRooms } = useAuth();
  const [codeInput, setCodeInput] = useState(initialCode);
  const [pinInput, setPinInput] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FormValidationErrors>({});
  const [roomLookup, setRoomLookup] = useState<RoomLookupState>({ status: 'idle' });
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isViewportFullscreen, setIsViewportFullscreen] = useState(false);
  const [showFullscreenControls, setShowFullscreenControls] = useState(true);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const [videoPlaybackBlocked, setVideoPlaybackBlocked] = useState(false);
  const [hasLiveVideoFrame, setHasLiveVideoFrame] = useState(false);
  const [hasLiveAudioTrack, setHasLiveAudioTrack] = useState(false);
  const [editingDeviceName, setEditingDeviceName] = useState(false);
  const isFullscreen = isNativeFullscreen || isViewportFullscreen;
  const supportsPiP =
    typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const fullscreenHideTimerRef = useRef<number | null>(null);
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const {
    deviceName,
    setDeviceName,
    commitDeviceName,
    signalingState,
    isOnline,
    isReconnectingSession,
    sourceReconnecting,
    reconnectSignaling,
    session,
    remoteStream,
    streamRevision,
    streamMetadata,
    peerStatus,
    stats,
    timings,
    pointerState,
    connectionType,
    recordFirstFrame,
    error,
    notice,
    isJoining,
    clearMessages,
    joinSession,
    leaveSession,
    requestStreamSync,
  } = receiver;

  const detectedPlatform = detectDevicePlatform();
  const detectedBrowser = detectBrowserName();

  useEffect(() => {
    if (initialCode) {
      setCodeInput(initialCode.toUpperCase());
      window.setTimeout(() => {
        pinInputRef.current?.focus();
      }, 40);
    }
  }, [initialCode]);

  useEffect(() => {
    if (session) return;
    const normalized = codeInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalized)) {
      setRoomLookup({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    setRoomLookup({ status: 'checking', code: normalized });

    fetch(`/api/sessions/${encodeURIComponent(normalized)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          exists?: boolean;
          status?: string;
          error?: string;
          broadcaster?: { deviceName?: string; platform?: string };
          receiverCount?: number;
          maxReceivers?: number;
          totalDevices?: number;
          maxTotalDevices?: number;
          isFull?: boolean;
          isLocked?: boolean;
          expiresAt?: number | null;
        };

        if (controller.signal.aborted) return;

        if (res.status === 410 || data.status === 'expired' || data.status === 'closed') {
          setRoomLookup({
            status: 'expired',
            code: normalized,
            message:
              data.error ||
              `Room "${normalized}" has expired or ended. Ask the source computer for a new QR code.`,
          });
          return;
        }

        if (!res.ok || !data.exists) {
          setRoomLookup({
            status: 'not_found',
            code: normalized,
            message:
              data.error ||
              `No active room found for ID "${normalized}". Verify the room code on the source computer.`,
          });
          return;
        }

        const receiverCount = data.receiverCount ?? 0;
        const maxReceivers = data.maxReceivers ?? 9;
        setRoomLookup({
          status: 'active',
          code: normalized,
          broadcasterName: data.broadcaster?.deviceName || 'Source Display',
          broadcasterPlatform: data.broadcaster?.platform || 'Desktop',
          receiverCount,
          maxReceivers,
          totalDevices: data.totalDevices ?? receiverCount + 1,
          maxTotalDevices: data.maxTotalDevices ?? maxReceivers + 1,
          isFull: Boolean(data.isFull),
          isLocked: Boolean(data.isLocked),
          expiresAt: data.expiresAt ?? null,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRoomLookup({ status: 'idle' });
        }
      });

    return () => {
      controller.abort();
    };
  }, [codeInput, session]);

  const attemptVideoPlayback = useCallback(async (videoEl: HTMLVideoElement) => {
    setVideoPlaybackBlocked(false);
    // Keep video element muted so autoplay policies never block screen frames;
    // audio is played cleanly through the dedicated <audio> element.
    videoEl.muted = true;
    try {
      await videoEl.play();
    } catch {
      setVideoPlaybackBlocked(true);
    }
  }, []);

  const syncAudioElement = useCallback(async (stream: MediaStream | null) => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const liveAudioTracks = stream
      ? stream.getAudioTracks().filter((track) => track.readyState === 'live')
      : [];

    setHasLiveAudioTrack(liveAudioTracks.length > 0);

    if (liveAudioTracks.length === 0) {
      audioEl.pause();
      audioEl.srcObject = null;
      audioStreamRef.current = null;
      setAudioPlaybackBlocked(false);
      return;
    }

    const existingIds = audioStreamRef.current
      ? audioStreamRef.current.getAudioTracks().map((t) => t.id).join(',')
      : '';
    const nextIds = liveAudioTracks.map((t) => t.id).join(',');

    if (existingIds !== nextIds) {
      const dedicatedAudioStream = new MediaStream(liveAudioTracks);
      audioStreamRef.current = dedicatedAudioStream;
      audioEl.srcObject = dedicatedAudioStream;
    }

    audioEl.muted = isMutedRef.current;
    audioEl.volume = clampAudioVolume(volumeRef.current);
    if (isMutedRef.current) {
      setAudioPlaybackBlocked(false);
      return;
    }

    try {
      await audioEl.play();
      setAudioPlaybackBlocked(false);
    } catch {
      // Honest autoplay-blocked indicator so user knows browser blocked sound until clicked
      setAudioPlaybackBlocked(true);
    }
  }, []);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (!remoteStream) {
      videoEl.pause();
      videoEl.srcObject = null;
      setHasLiveVideoFrame(false);
      setVideoPlaybackBlocked(false);
      void syncAudioElement(null);
      return;
    }

    if (videoEl.srcObject !== remoteStream) {
      videoEl.srcObject = remoteStream;
    }

    const tryStartMedia = () => {
      const videoTracks = remoteStream.getVideoTracks();
      if (videoTracks.some((t) => t.readyState === 'live')) {
        void attemptVideoPlayback(videoEl);
      } else {
        setHasLiveVideoFrame(false);
      }
      void syncAudioElement(remoteStream);
    };

    tryStartMedia();

    const handleStreamChanged = () => {
      tryStartMedia();
    };

    remoteStream.addEventListener('addtrack', handleStreamChanged);
    remoteStream.addEventListener('removetrack', handleStreamChanged);

    return () => {
      remoteStream.removeEventListener('addtrack', handleStreamChanged);
      remoteStream.removeEventListener('removetrack', handleStreamChanged);
    };
  }, [attemptVideoPlayback, remoteStream, streamRevision, syncAudioElement]);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    audioEl.muted = isMuted;
    audioEl.volume = clampAudioVolume(volume);
  }, [isMuted, volume]);

  useEffect(() => {
    if (!session) {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      }
      audioStreamRef.current = null;
      setHasLiveVideoFrame(false);
      setHasLiveAudioTrack(false);
      setAudioPlaybackBlocked(false);
      setVideoPlaybackBlocked(false);
      setIsViewportFullscreen(false);
    }
  }, [session]);

  useEffect(() => {
    if (!streamMetadata.active || peerStatus === 'failed' || peerStatus === 'disconnected') {
      setHasLiveVideoFrame(false);
    }
  }, [streamMetadata.active, peerStatus]);

  useEffect(() => {
    const handleVisibilityResume = () => {
      if (document.visibilityState !== 'visible' || !remoteStream) return;
      if (videoRef.current && remoteStream.getVideoTracks().some((t) => t.readyState === 'live')) {
        void attemptVideoPlayback(videoRef.current);
      }
      void syncAudioElement(remoteStream);
    };
    document.addEventListener('visibilitychange', handleVisibilityResume);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityResume);
    };
  }, [attemptVideoPlayback, remoteStream, syncAudioElement]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const body = document.body;
    if (isFullscreen) {
      root.classList.add('multicast-scroll-locked');
      body.classList.add('multicast-scroll-locked');
    } else {
      root.classList.remove('multicast-scroll-locked');
      body.classList.remove('multicast-scroll-locked');
    }
    return () => {
      root.classList.remove('multicast-scroll-locked');
      body.classList.remove('multicast-scroll-locked');
    };
  }, [isFullscreen]);

  const revealFullscreenControls = useCallback(() => {
    setShowFullscreenControls(true);
    if (fullscreenHideTimerRef.current !== null) {
      window.clearTimeout(fullscreenHideTimerRef.current);
      fullscreenHideTimerRef.current = null;
    }
    fullscreenHideTimerRef.current = window.setTimeout(() => {
      setShowFullscreenControls(false);
      fullscreenHideTimerRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const active = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
      setIsNativeFullscreen(active);
      if (active) {
        revealFullscreenControls();
      } else if (!isViewportFullscreen) {
        setShowFullscreenControls(true);
        if (fullscreenHideTimerRef.current !== null) {
          window.clearTimeout(fullscreenHideTimerRef.current);
          fullscreenHideTimerRef.current = null;
        }
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      if (fullscreenHideTimerRef.current !== null) {
        window.clearTimeout(fullscreenHideTimerRef.current);
      }
    };
  }, [isViewportFullscreen, revealFullscreenControls]);

  const validateJoinFields = (code: string, pin: string): FormValidationErrors => {
    const errors: FormValidationErrors = {};
    const cleanCode = code.trim().toUpperCase();
    const cleanPin = pin.trim();

    if (!cleanCode) {
      errors.code = 'Room code is required.';
    } else if (!/^[A-Z0-9]{6}$/.test(cleanCode)) {
      errors.code = 'Room code must be exactly 6 letters/numbers.';
    }

    if (!cleanPin) {
      errors.pin = 'Room PIN is required.';
    } else if (!/^\d{4,6}$/.test(cleanPin)) {
      errors.pin = 'PIN must be 4 to 6 numeric digits.';
    }

    return errors;
  };

  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    clearMessages();

    const errors = validateJoinFields(codeInput, pinInput);
    setFieldErrors(errors);
    if (errors.code || errors.pin) {
      return;
    }

    void joinSession(codeInput, pinInput);
  };

  const handleQrDecoded = (payload: ParsedQrPayload) => {
    const nextCode = payload.code.toUpperCase();
    setCodeInput(nextCode);
    setPinInput('');
    setFieldErrors({});
    clearMessages();
    window.setTimeout(() => {
      pinInputRef.current?.focus();
    }, 40);
  };

  const handleToggleFullscreen = useCallback(async () => {
    const stageEl = stageRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };

    if (!stageEl) return;

    const nativeActive = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
    if (nativeActive) {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        }
      } catch {
        // Ignore browser exit errors
      }
      setIsViewportFullscreen(false);
      return;
    }

    if (isViewportFullscreen) {
      setIsViewportFullscreen(false);
      setShowFullscreenControls(true);
      if (fullscreenHideTimerRef.current !== null) {
        window.clearTimeout(fullscreenHideTimerRef.current);
        fullscreenHideTimerRef.current = null;
      }
      return;
    }

    try {
      if (stageEl.requestFullscreen) {
        await stageEl.requestFullscreen();
        return;
      }
      if (stageEl.webkitRequestFullscreen) {
        await stageEl.webkitRequestFullscreen();
        return;
      }
    } catch {
      // Fall back cleanly to viewport presentation fullscreen on mobile browsers (e.g. iOS Safari)
    }

    setIsViewportFullscreen(true);
    revealFullscreenControls();
  }, [isViewportFullscreen, revealFullscreenControls]);

  const handleUnlockAudio = useCallback(async () => {
    setIsMuted(false);
    const audioEl = audioRef.current;
    if (!audioEl) return;
    try {
      audioEl.muted = false;
      await audioEl.play();
      setAudioPlaybackBlocked(false);
    } catch {
      setAudioPlaybackBlocked(true);
    }
  }, []);

  const toggleAudioControl = useCallback(async () => {
    if (audioPlaybackBlocked) {
      await handleUnlockAudio();
      return;
    }

    const nextMuted = !isMutedRef.current;
    setIsMuted(nextMuted);
    const audioEl = audioRef.current;
    if (audioEl) {
      audioEl.muted = nextMuted;
      if (!nextMuted && hasLiveAudioTrack) {
        try {
          await audioEl.play();
          setAudioPlaybackBlocked(false);
        } catch {
          setAudioPlaybackBlocked(true);
        }
      }
    }
  }, [audioPlaybackBlocked, handleUnlockAudio, hasLiveAudioTrack]);

  useEffect(() => {
    if (!session) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isViewportFullscreen) {
        event.preventDefault();
        setIsViewportFullscreen(false);
        setShowFullscreenControls(true);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        void handleToggleFullscreen();
      } else if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        void toggleAudioControl();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleToggleFullscreen, isViewportFullscreen, session, toggleAudioControl]);

  const handleTogglePiP = async () => {
    const videoEl = videoRef.current;
    if (!videoEl || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoEl.requestPictureInPicture();
      }
    } catch {
      // Ignore if PiP is unavailable
    }
  };

  const handleManualPlay = async () => {
    const videoEl = videoRef.current;
    if (videoEl) {
      setVideoPlaybackBlocked(false);
      try {
        videoEl.muted = true;
        await videoEl.play();
      } catch {
        setVideoPlaybackBlocked(true);
      }
    }
    const audioEl = audioRef.current;
    if (audioEl && hasLiveAudioTrack && !isMuted) {
      try {
        audioEl.muted = false;
        await audioEl.play();
        setAudioPlaybackBlocked(false);
      } catch {
        setAudioPlaybackBlocked(true);
      }
    }
  };

  if (!session) {
    return (
      <div className="max-w-5xl mx-auto py-4 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-zinc-950">
              Receiver Display
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Pair this {detectedPlatform} browser ({detectedBrowser}) with a source
              broadcaster.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
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
              onClick={clearMessages}
              className="text-xs font-medium text-red-700 hover:text-red-900 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 flex items-start justify-between gap-4 text-sm text-zinc-800">
            <span>{notice}</span>
            <button
              type="button"
              onClick={clearMessages}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Room Code & PIN Form (7 cols) */}
          <section className="lg:col-span-7 rounded-xl border border-zinc-200 bg-white p-6 sm:p-7 flex flex-col justify-between">
            <div>
              <h3 className="font-display text-base font-semibold text-zinc-950">
                Join Room
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                Enter the 6-character room code and numeric PIN shown on the source screen.
              </p>

              <form onSubmit={handleJoinSubmit} noValidate className="mt-6 space-y-5">
                {roomLookup.status === 'active' ? (
                  <div
                    className={`rounded-lg border px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
                      roomLookup.isLocked || roomLookup.isFull
                        ? 'border-amber-200 bg-amber-50 text-amber-900'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    }`}
                  >
                    <span>
                      Room <strong className="font-mono">{roomLookup.code}</strong>{' '}
                      found · Host: <strong>{roomLookup.broadcasterName}</strong> (
                      {roomLookup.broadcasterPlatform}) ·{' '}
                      {roomLookup.isLocked
                        ? 'Locked by host — new joins temporarily disabled'
                        : roomLookup.isFull
                          ? `Full (${roomLookup.totalDevices}/${roomLookup.maxTotalDevices} devices)`
                          : `${roomLookup.totalDevices}/${roomLookup.maxTotalDevices} devices (${roomLookup.receiverCount}/${roomLookup.maxReceivers} receivers) · Enter PIN to join`}
                    </span>
                  </div>
                ) : roomLookup.status === 'expired' ? (
                  <div
                    role="status"
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 flex items-center justify-between gap-3"
                  >
                    <span>{roomLookup.message}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setCodeInput('');
                        setPinInput('');
                        setRoomLookup({ status: 'idle' });
                      }}
                      className="text-xs font-semibold text-amber-800 hover:text-amber-950 whitespace-nowrap shrink-0"
                    >
                      Clear
                    </button>
                  </div>
                ) : roomLookup.status === 'not_found' ? (
                  <div
                    role="status"
                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-700"
                  >
                    {roomLookup.message}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="room-code-input"
                      className="block text-xs font-medium text-zinc-700 mb-1.5"
                    >
                      Room Code
                    </label>
                    <input
                      id="room-code-input"
                      type="text"
                      maxLength={6}
                      value={codeInput}
                      onChange={(e) => {
                        const sanitized = e.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9]/g, '');
                        setCodeInput(sanitized);
                        if (fieldErrors.code) {
                          setFieldErrors((prev) => ({ ...prev, code: undefined }));
                        }
                      }}
                      placeholder="K7P4M9"
                      autoComplete="off"
                      className={`w-full rounded-lg border bg-white px-3.5 py-2.5 font-mono text-lg font-semibold tracking-[0.22em] uppercase text-zinc-900 placeholder:text-zinc-400 placeholder:tracking-normal placeholder:font-normal placeholder:text-sm focus:outline-none focus:ring-2 ${
                        fieldErrors.code
                          ? 'border-red-500 focus:ring-red-600/20 focus:border-red-600'
                          : 'border-zinc-200 focus:ring-red-600/20 focus:border-red-600'
                      }`}
                    />
                    {fieldErrors.code ? (
                      <p className="mt-1.5 text-xs text-red-600">{fieldErrors.code}</p>
                    ) : null}
                  </div>

                  <div>
                    <label
                      htmlFor="room-pin-input"
                      className="block text-xs font-medium text-zinc-700 mb-1.5"
                    >
                      Room PIN (Required)
                    </label>
                    <div className="relative">
                      <input
                        ref={pinInputRef}
                        id="room-pin-input"
                        type={showPin ? 'text' : 'password'}
                        inputMode="numeric"
                        maxLength={6}
                        value={pinInput}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '');
                          setPinInput(digits);
                          if (fieldErrors.pin) {
                            setFieldErrors((prev) => ({ ...prev, pin: undefined }));
                          }
                        }}
                        placeholder="4821"
                        autoComplete="off"
                        className={`w-full rounded-lg border bg-white pl-3.5 pr-10 py-2.5 font-mono text-lg font-semibold tracking-[0.22em] text-zinc-900 placeholder:text-zinc-400 placeholder:tracking-normal placeholder:font-normal placeholder:text-sm focus:outline-none focus:ring-2 ${
                          fieldErrors.pin
                            ? 'border-red-500 focus:ring-red-600/20 focus:border-red-600'
                            : 'border-zinc-200 focus:ring-red-600/20 focus:border-red-600'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin((prev) => !prev)}
                        aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-zinc-400 hover:text-zinc-900 transition-colors touch-manipulation"
                      >
                        {showPin ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {fieldErrors.pin ? (
                      <p className="mt-1.5 text-xs text-red-600">{fieldErrors.pin}</p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="receiver-device-name"
                    className="block text-xs font-medium text-zinc-700 mb-1.5"
                  >
                    Receiver Device Name
                  </label>
                  <input
                    id="receiver-device-name"
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="e.g. Studio Display Windows"
                    className="w-full min-h-[44px] sm:min-h-0 rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-base sm:text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-600/20 focus:border-red-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isJoining}
                  className="w-full min-h-[46px] px-4 py-3 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-sm font-semibold text-white disabled:opacity-50 transition-all touch-manipulation"
                >
                  {isJoining ? 'Validating & Joining...' : 'Join Room'}
                </button>
              </form>
            </div>

            <div className="mt-6 pt-4 border-t border-zinc-200 text-xs text-zinc-500 flex flex-wrap items-center justify-between gap-2">
              <span>
                Detected OS: <strong className="text-zinc-900">{detectedPlatform}</strong>
              </span>
              <span>
                Browser: <strong className="text-zinc-900">{detectedBrowser}</strong>
              </span>
            </div>

            {recentRooms.length > 0 ? (
              <div className="mt-4 pt-4 border-t border-zinc-200">
                <div className="text-xs font-medium text-zinc-700 mb-2">
                  Recent Rooms
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentRooms.slice(0, 4).map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setCodeInput(entry.code);
                        setFieldErrors({});
                        window.setTimeout(() => pinInputRef.current?.focus(), 40);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-800 hover:border-red-200 hover:bg-red-50/40 transition-colors"
                    >
                      <span className="font-mono font-semibold text-zinc-950">
                        {entry.code}
                      </span>
                      <span className="text-zinc-500 truncate max-w-[140px]">
                        {entry.hostName}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* QR Joining Support (5 cols) */}
          <div className="lg:col-span-5 flex">
            <QrScannerPanel onDecoded={handleQrDecoded} />
          </div>
        </div>
      </div>
    );
  }

  const liveVideoTrack = remoteStream
    ?.getVideoTracks()
    .find((t) => t.readyState === 'live');
  const isStreamRenderable = Boolean(
    liveVideoTrack && streamMetadata.active && hasLiveVideoFrame && peerStatus === 'connected',
  );
  const isBufferingFirstFrame = Boolean(
    streamMetadata.active && peerStatus !== 'failed' && !isStreamRenderable && !videoPlaybackBlocked,
  );

  const audioSnapshot = resolveAudioStatusSnapshot({
    role: 'receiver',
    isStreaming: streamMetadata.active,
    hasLiveAudioTrack,
    streamHasAudio: streamMetadata.hasAudio,
    sourceAudioMuted: streamMetadata.audioMuted,
    sourceTrackMuted: streamMetadata.audioTrackMuted,
    receiverMuted: isMuted || volume === 0,
    autoplayBlocked: audioPlaybackBlocked,
    hasActivePeerAudio: peerStatus === 'connected',
    audioReason: streamMetadata.audioReason,
  });
  const sourceHasLiveAudio = Boolean(hasLiveAudioTrack && streamMetadata.hasAudio);
  const audioControlDisabled = !sourceHasLiveAudio;
  const receiverAudioState = audioSnapshot.state;
  const audioControlLabel = audioSnapshot.controlLabel;
  const audioControlTitle = audioSnapshot.description;

  return (
    <div className="space-y-6">
      {!isOnline || isReconnectingSession || sourceReconnecting ? (
        <div
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-amber-950"
        >
          <div className="flex items-center gap-2.5">
            <WifiOff className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              {!isOnline
                ? 'Device network is offline. Waiting for connectivity to restore your cast session...'
                : sourceReconnecting
                  ? 'Source broadcaster network dropped. Holding room open for automatic recovery...'
                  : 'Signaling link interrupted. Reconnecting automatically to your room...'}
            </span>
          </div>
          {isOnline && signalingState !== 'connected' ? (
            <button
              type="button"
              onClick={reconnectSignaling}
              className="px-3 py-1 rounded-md border border-amber-300 bg-white text-xs font-medium text-amber-900 hover:bg-amber-100 whitespace-nowrap"
            >
              Retry Signaling
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
            onClick={clearMessages}
            className="text-xs font-medium text-red-700 hover:text-red-900 whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 flex items-start justify-between gap-4 text-sm text-zinc-800">
          <span>{notice}</span>
          <button
            type="button"
            onClick={clearMessages}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {audioPlaybackBlocked && sourceHasLiveAudio && !streamMetadata.audioMuted ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950">
          <span>
            Mobile or desktop autoplay paused incoming stream audio. Tap Enable Audio to
            hear sound.
          </span>
          <button
            type="button"
            onClick={() => void handleUnlockAudio()}
            className="min-h-[44px] sm:min-h-0 px-4 py-2 sm:py-1.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 whitespace-nowrap touch-manipulation"
          >
            Enable Audio
          </button>
        </div>
      ) : null}

      <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden flex flex-col">
        <div className="px-4 sm:px-5 py-3.5 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-3 bg-white">
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="text-sm font-semibold text-zinc-950 truncate">
              {session.broadcaster.deviceName}
            </div>
            <span className="text-xs text-zinc-500 whitespace-nowrap">
              {session.broadcaster.platform} <span aria-hidden="true">·</span> Room{' '}
              <span className="font-mono font-semibold text-zinc-900">
                {session.code}
              </span>
            </span>
            <StatusLabel status={peerStatus} />
            <NetworkQualityIndicator peerStatus={peerStatus} stats={stats} />
            {editingDeviceName ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void commitDeviceName().then((ok) => {
                    if (ok) setEditingDeviceName(false);
                  });
                }}
                className="inline-flex items-center gap-1.5"
              >
                <input
                  type="text"
                  maxLength={64}
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  aria-label="Receiver display name"
                  className="w-40 min-h-[40px] sm:min-h-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-base sm:text-xs text-zinc-900 focus:outline-none focus:border-red-600"
                />
                <button
                  type="submit"
                  className="min-h-[40px] sm:min-h-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-600 text-xs sm:text-[11px] font-medium text-white hover:bg-red-700 touch-manipulation"
                >
                  <Check className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
                  <span>Save</span>
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setEditingDeviceName(true)}
                title="Rename this receiver display"
                className="min-h-[36px] sm:min-h-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-zinc-200 bg-zinc-50 text-xs text-zinc-700 hover:text-zinc-950 hover:border-zinc-300 transition-colors max-w-[200px] touch-manipulation"
              >
                <Pencil className="h-3 w-3 text-zinc-500 shrink-0" />
                <span className="truncate">{deviceName}</span>
              </button>
            )}
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

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => void toggleAudioControl()}
              disabled={audioControlDisabled}
              title={audioControlTitle}
              aria-label="Audio Control"
              className={`min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-3 py-2 sm:py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-45 touch-manipulation ${
                audioPlaybackBlocked && sourceHasLiveAudio
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                  : 'border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50'
              }`}
            >
              {!sourceHasLiveAudio ||
              isMuted ||
              volume === 0 ||
              streamMetadata.audioMuted ||
              audioPlaybackBlocked ? (
                <VolumeX className="h-3.5 w-3.5 text-zinc-500" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 text-red-600" />
              )}
              <span>{audioControlLabel}</span>
            </button>

            <label
              htmlFor="receiver-volume-slider"
              className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs text-zinc-600"
              title="Receiver playback volume"
            >
              <span className="sr-only">Receiver Volume</span>
              <input
                id="receiver-volume-slider"
                type="range"
                min={0}
                max={100}
                value={isMuted ? 0 : Math.round(volume * 100)}
                disabled={audioControlDisabled}
                onChange={(e) => {
                  const next = clampAudioVolume(Number(e.target.value) / 100);
                  setVolume(next);
                  if (next > 0 && isMuted) {
                    setIsMuted(false);
                  } else if (next === 0 && !isMuted) {
                    setIsMuted(true);
                  }
                }}
                className="w-16 accent-red-600 disabled:opacity-40 cursor-pointer"
              />
              <span className="font-mono text-[11px] text-zinc-700 w-8 text-right tabular-nums">
                {isMuted ? 0 : Math.round(volume * 100)}%
              </span>
            </label>

            <button
              type="button"
              onClick={requestStreamSync}
              className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-3 py-2 sm:py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:bg-zinc-50 transition-colors whitespace-nowrap touch-manipulation"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Resync</span>
            </button>

            {supportsPiP ? (
              <button
                type="button"
                onClick={() => void handleTogglePiP()}
                disabled={!isStreamRenderable}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 transition-colors whitespace-nowrap"
              >
                <PictureInPicture2 className="h-3.5 w-3.5" />
                <span>PiP</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              title="Toggle Presentation Mode Fullscreen (F)."
              className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-3 py-2 sm:py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-800 hover:bg-zinc-50 transition-colors whitespace-nowrap touch-manipulation"
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
              <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
            </button>

            <button
              type="button"
              onClick={leaveSession}
              className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-3.5 sm:px-3 py-2 sm:py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors whitespace-nowrap touch-manipulation"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Leave Room</span>
            </button>
          </div>
        </div>

        {/* Dedicated audio element keeps audio track playback independent of video frame decoding;
            never use display:none (hidden) because Safari pauses playback on display:none media elements */}
        <audio
          ref={audioRef}
          autoPlay
          playsInline
          muted={isMuted}
          className="fixed w-0 h-0 opacity-0 pointer-events-none"
        />

        {/* True Presentation Mode Viewport — native Fullscreen API with iOS Safari viewport fullscreen fallback */}
        <div
          ref={stageRef}
          onMouseMove={() => {
            if (isFullscreen) revealFullscreenControls();
          }}
          onClick={() => {
            if (!isFullscreen) return;
            if (showFullscreenControls) {
              setShowFullscreenControls(false);
            } else {
              revealFullscreenControls();
            }
          }}
          onDoubleClick={() => void handleToggleFullscreen()}
          className={`multicast-fullscreen-stage bg-[#09090B] aspect-video w-full flex items-center justify-center flex-1 relative overflow-hidden ${
            isViewportFullscreen ? 'multicast-viewport-fullscreen' : ''
          }`}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedData={(e) => {
              if (e.currentTarget.videoWidth > 0) {
                setHasLiveVideoFrame(true);
                recordFirstFrame();
              }
            }}
            onPlaying={(e) => {
              if (e.currentTarget.videoWidth > 0) {
                setHasLiveVideoFrame(true);
                recordFirstFrame();
              }
            }}
            onResize={(e) => {
              if (e.currentTarget.videoWidth > 0) {
                setHasLiveVideoFrame(true);
              }
            }}
            onEmptied={() => setHasLiveVideoFrame(false)}
            className={`w-full h-full object-contain ${
              isStreamRenderable ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          />

          {!isStreamRenderable ? (
            <div className="absolute inset-0 flex items-center justify-center">
              {peerStatus === 'failed' ? (
                <EmptyState
                  dark
                  icon={<ShieldAlert className="h-5 w-5 text-red-400" />}
                  title="WebRTC stream connection failed"
                  description="The peer-to-peer media link could not be established or was interrupted. Verify both devices are reachable and retry."
                  action={
                    <button
                      type="button"
                      onClick={requestStreamSync}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white transition-colors"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Retry WebRTC Handshake</span>
                    </button>
                  }
                />
              ) : videoPlaybackBlocked ? (
                <EmptyState
                  dark
                  icon={<Play className="h-5 w-5 text-red-400" />}
                  title="Browser paused video playback"
                  description="Your browser blocked automatic playback of the incoming WebRTC stream. Click below to start playing the live screen feed."
                  action={
                    <button
                      type="button"
                      onClick={() => void handleManualPlay()}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white transition-colors"
                    >
                      <Play className="h-3.5 w-3.5" />
                      <span>Start Video Playback</span>
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  dark
                  icon={
                    isBufferingFirstFrame ? (
                      <Loader2 className="h-5 w-5 text-red-400 animate-spin" />
                    ) : (
                      <Monitor className="h-5 w-5 text-red-400" />
                    )
                  }
                  title={
                    streamMetadata.active
                      ? 'Waiting for first WebRTC video frame...'
                      : 'Connected to room · Waiting for screen share'
                  }
                  description={
                    streamMetadata.active
                      ? 'Completing SDP and ICE negotiation with the source broadcaster. Live video appears here once real frames arrive.'
                      : `Paired with ${session.broadcaster.deviceName}. Video will begin rendering as soon as the source clicks Start Sharing.`
                  }
                  action={
                    streamMetadata.active ? (
                      <button
                        type="button"
                        onClick={requestStreamSync}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Request Offer Again</span>
                      </button>
                    ) : undefined
                  }
                />
              )}
            </div>
          ) : null}
          {isStreamRenderable && pointerState?.active ? (
            <div
              aria-hidden="true"
              style={{
                left: `${pointerState.x * 100}%`,
                top: `${pointerState.y * 100}%`,
              }}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-red-500 ring-4 ring-red-500/35 shadow-lg transition-all duration-75"
            />
          ) : null}

          {audioPlaybackBlocked && sourceHasLiveAudio && !streamMetadata.audioMuted && isStreamRenderable ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20"
            >
              <button
                type="button"
                onClick={() => void handleUnlockAudio()}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-full bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 text-xs font-semibold shadow-lg shadow-black/40 transition-colors whitespace-nowrap touch-manipulation"
              >
                <Volume2 className="h-4 w-4" />
                <span>Tap to Enable Audio</span>
              </button>
            </div>
          ) : null}

          {isFullscreen ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className={`absolute top-0 inset-x-0 z-20 p-3 sm:p-4 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-b from-black/75 via-black/35 to-transparent transition-opacity duration-200 ${
                showFullscreenControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/90">
                <span className="font-mono font-semibold px-2 py-1 rounded bg-white/10">
                  {session.code}
                </span>
                <StatusLabel status={peerStatus} />
                <NetworkQualityIndicator peerStatus={peerStatus} stats={stats} />
              </div>

              <div className="flex items-center gap-2">
                {sourceHasLiveAudio ? (
                  <button
                    type="button"
                    onClick={() => void toggleAudioControl()}
                    className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-zinc-950/80 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm hover:bg-zinc-900 touch-manipulation whitespace-nowrap"
                  >
                    {isMuted || audioPlaybackBlocked ? (
                      <VolumeX className="h-3.5 w-3.5 text-amber-400" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                    <span>{audioControlLabel}</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={requestStreamSync}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-zinc-950/80 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm hover:bg-zinc-900 touch-manipulation whitespace-nowrap"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Resync</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleFullscreen()}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-zinc-950/80 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm hover:bg-zinc-900 touch-manipulation whitespace-nowrap"
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                  <span>Exit</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="px-5 py-2.5 border-t border-zinc-200 bg-zinc-50/70 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-600">
          <div className="flex flex-wrap items-center gap-3 tabular-nums">
            <span>
              Audio Status:{' '}
              <strong
                className={`font-medium ${
                  receiverAudioState === 'connected' || receiverAudioState === 'available'
                    ? 'text-emerald-700'
                    : receiverAudioState === 'permission-required'
                      ? 'text-red-700'
                      : 'text-amber-700'
                }`}
              >
                {audioSnapshot.label}
              </strong>
            </span>
            {stats?.audioBytes !== undefined && sourceHasLiveAudio ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-zinc-500">
                  Audio RTP: {stats.audioBytes > 0 ? `${Math.round(stats.audioBytes / 1024)} KB` : 'active'}
                </span>
              </>
            ) : null}
            {!sourceHasLiveAudio && streamMetadata.active && streamMetadata.audioReason ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-zinc-500">{streamMetadata.audioReason}</span>
              </>
            ) : null}
          </div>

          <div className="text-[11px] text-zinc-500">
            Shortcuts: <span className="font-mono text-zinc-700">F</span> Presentation ·{' '}
            <span className="font-mono text-zinc-700">M</span> Mute ·{' '}
            <span className="font-mono text-zinc-700">Esc</span> Exit
          </div>
        </div>
      </section>

      <ConnectionDetails
        peerStatus={peerStatus}
        stats={stats}
        timings={timings}
        connectionType={connectionType}
      />
    </div>
  );
}
