import {
  ArrowLeft,
  Maximize,
  Minimize,
  Pause,
  QrCode,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { UseReceiverReturn } from '../../hooks/useReceiver.ts';
import { evaluateConnectionQuality } from './NetworkQualityIndicator.tsx';
import { buildReceiverJoinUrl } from '../../utils/platform.ts';
import {
  canReceiveTvWebRtc,
  detectTvPlatformFromUserAgent,
  detectTvReceiverCapabilities,
} from '../../utils/tv.ts';

interface TvReceiverWorkspaceProps {
  receiver: UseReceiverReturn;
  initialCode?: string;
  onExit: () => void;
}

export function TvReceiverWorkspace({
  receiver,
  initialCode = '',
  onExit,
}: TvReceiverWorkspaceProps) {
  const [code, setCode] = useState(initialCode);
  const [pin, setPin] = useState('');
  const [isMuted, setIsMuted] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewportFullscreen, setViewportFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showJoinQr, setShowJoinQr] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [joinQr, setJoinQr] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const capability = detectTvReceiverCapabilities();
  const webRtcAvailable = canReceiveTvWebRtc(capability);
  const fullscreenActive = isFullscreen || viewportFullscreen;
  const tvPlatform =
    typeof navigator === 'undefined'
      ? 'Unidentified TV browser'
      : detectTvPlatformFromUserAgent(navigator.userAgent);

  const {
    session,
    remoteStream,
    streamRevision,
    peerStatus,
    stats,
    signalingState,
    isJoining,
    error,
    notice,
    joinSession,
    leaveSession,
    requestStreamSync,
  } = receiver;

  useEffect(() => {
    setCode(initialCode.toUpperCase());
  }, [initialCode]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!remoteStream) {
      video.pause();
      video.srcObject = null;
      setIsPaused(false);
      setResolution('');
      return;
    }

    video.srcObject = remoteStream;
    video.muted = isMuted;
    void video.play().then(
      () => setPlaybackError(null),
      () => setPlaybackError('Press Play to start the incoming stream.'),
    );
  }, [isMuted, remoteStream, streamRevision]);

  useEffect(() => {
    if (!session) {
      setJoinQr(null);
      setShowJoinQr(false);
      return;
    }
    let active = true;
    QRCode.toDataURL(buildReceiverJoinUrl(session.code), {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    }).then(
      (dataUrl) => {
        if (active) setJoinQr(dataUrl);
      },
      () => {
        if (active) setJoinQr(null);
      },
    );
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(document.fullscreenElement || doc.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const onRemoteKey = (event: KeyboardEvent) => {
      const isBackspace = event.key === 'Backspace';
      const isBackKey =
        event.key === 'BrowserBack' ||
        event.key === 'GoBack' ||
        event.key === 'Back' ||
        event.key === 'XF86Back' ||
        event.keyCode === 461 ||
        event.keyCode === 10009;
      const isEditingText =
        event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (
        (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) &&
        (event.key === 'Escape' || isBackKey)
      ) {
        event.target.blur();
        return;
      }
      if (
        event.key === 'Escape' ||
        isBackKey ||
        (isBackspace && !isEditingText)
      ) {
        if (fullscreenActive) {
          if (document.exitFullscreen) void document.exitFullscreen();
          setViewportFullscreen(false);
        } else if (session) {
          leaveSession();
        } else {
          onExit();
        }
      } else if (event.key.toLowerCase() === 'm' && session) {
        const video = videoRef.current;
        if (video) {
          video.muted = !video.muted;
          setIsMuted(video.muted);
          if (!video.muted) {
            void video.play().catch(() => {
              setPlaybackError('This browser blocked audio playback. Select Enable audio to retry.');
            });
          }
        } else {
          setIsMuted((muted) => !muted);
        }
      } else if (event.key.toLowerCase() === 'f' && session) {
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onRemoteKey);
    return () => window.removeEventListener('keydown', onRemoteKey);
  }, [fullscreenActive, leaveSession, onExit, session]);

  const toggleFullscreen = useCallback(async () => {
    if (fullscreenActive) {
      const doc = document as Document & {
        webkitExitFullscreen?: () => Promise<void> | void;
        webkitFullscreenElement?: Element | null;
      };
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) {
        await doc.webkitExitFullscreen();
      }
      setViewportFullscreen(false);
      return;
    }

    const stage = stageRef.current as
      | (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    try {
      if (stage?.requestFullscreen) {
        await stage.requestFullscreen();
        return;
      }
      if (stage?.webkitRequestFullscreen) {
        await stage.webkitRequestFullscreen();
        return;
      }
    } catch {
      setViewportFullscreen(true);
      return;
    }
    setViewportFullscreen(true);
  }, [fullscreenActive]);

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    void joinSession(code, pin);
  };

  const playStream = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setIsPaused(false);
      setPlaybackError(null);
    } catch {
      setPlaybackError('This browser blocked playback. Try selecting Play again.');
    }
  };

  const toggleAudio = async () => {
    const video = videoRef.current;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (!video) return;
    video.muted = nextMuted;
    if (!nextMuted) await playStream();
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await playStream();
    } else {
      video.pause();
      setIsPaused(true);
    }
  };

  const quality = evaluateConnectionQuality(peerStatus, stats);

  return (
    <div className={`tv-receiver ${viewportFullscreen ? 'tv-viewport-fullscreen' : ''}`}>
      {!session ? (
        <main className="tv-pairing">
          <div className="tv-brand-row">
            <div>
              <p className="tv-eyebrow">MULTICAST · TV RECEIVER</p>
              <h1>Watch a shared screen</h1>
              <p className="tv-subtitle">
                Enter the room code and PIN shown on the source display.
              </p>
            </div>
            <span className={`tv-capability ${webRtcAvailable ? 'is-ready' : 'is-blocked'}`}>
              {webRtcAvailable ? 'WebRTC ready' : 'WebRTC unavailable'}
            </span>
          </div>

          <div className="tv-pairing-grid">
            <form className="tv-form" onSubmit={handleJoin}>
              <label htmlFor="tv-room-code">Room code</label>
              <input
                autoComplete="off"
                autoCapitalize="characters"
                id="tv-room-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="ABC123"
                aria-describedby="tv-code-hint"
              />
              <p id="tv-code-hint" className="tv-hint">6 letters or numbers</p>
              <label htmlFor="tv-room-pin">Room PIN</label>
              <input
                autoComplete="off"
                id="tv-room-pin"
                inputMode="numeric"
                maxLength={6}
                type="password"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
                placeholder="Enter PIN"
              />
              <button
                className="tv-button tv-primary"
                type="submit"
                disabled={!webRtcAvailable || isJoining || !/^[A-Z0-9]{6}$/.test(code) || !/^\d{4,6}$/.test(pin)}
              >
                {isJoining ? 'Connecting…' : 'Connect to room'}
              </button>
              {!webRtcAvailable ? (
                <p className="tv-alert" role="alert">
                  This browser does not expose the WebRTC and media playback APIs required to
                  receive a stream. Try an up-to-date browser on a supported device.
                </p>
              ) : null}
              {error ? <p className="tv-alert" role="alert">{error}</p> : null}
            </form>

            <aside className="tv-instructions">
              <p className="tv-eyebrow">PAIRING INSTRUCTIONS</p>
              <ol>
                <li>On the source computer, open MultiCast and start sharing.</li>
                <li>Enter the six-character room code and the source PIN here.</li>
                <li>Keep this TV online while the stream connects.</li>
              </ol>
              <div className="tv-platform-note">
                <strong>{tvPlatform}</strong>
                <span>
                  {webRtcAvailable
                    ? 'Browser APIs detected. Video/audio playback on this TV model has not been physically verified.'
                    : 'Receiver is disabled because required browser APIs were not detected.'}
                </span>
              </div>
            </aside>
          </div>
          <button type="button" className="tv-button tv-back" onClick={onExit}>
            <ArrowLeft aria-hidden="true" /> Exit TV mode
          </button>
        </main>
      ) : (
        <main className="tv-viewing">
          <section
            ref={stageRef}
            className={`tv-stage ${fullscreenActive ? 'tv-native-fullscreen' : ''}`}
            aria-label="Incoming MultiCast stream"
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={isMuted}
              onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                setResolution(videoWidth > 0 ? `${videoWidth} × ${videoHeight}` : '');
              }}
              onResize={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                setResolution(videoWidth > 0 ? `${videoWidth} × ${videoHeight}` : '');
              }}
              onPlay={() => setIsPaused(false)}
              onPause={() => setIsPaused(true)}
            />
            {!remoteStream || peerStatus !== 'connected' ? (
              <div className="tv-stage-message">
                <p className="tv-eyebrow">{session.code}</p>
                <h1>{peerStatus === 'failed' ? 'Stream connection failed' : 'Waiting for stream'}</h1>
                <p>
                  {peerStatus === 'failed'
                    ? 'Retry the WebRTC connection or check the source device.'
                    : 'The room is connected. The source must start sharing before video appears.'}
                </p>
                <button className="tv-button" type="button" onClick={requestStreamSync}>
                  <RefreshCw aria-hidden="true" /> Retry connection
                </button>
              </div>
            ) : null}
            {playbackError ? (
              <button type="button" className="tv-play-prompt" onClick={() => void playStream()}>
                <Play aria-hidden="true" /> {playbackError}
              </button>
            ) : null}
            {fullscreenActive ? (
              <div className="tv-overlay">
                <span>{session.code} · {resolution || 'Live stream'}</span>
                <span className="tv-status">{quality.label}</span>
                <button
                  type="button"
                  className="tv-button"
                  onClick={() => void toggleFullscreen()}
                  aria-label="Exit fullscreen"
                >
                  <Minimize aria-hidden="true" /> Exit fullscreen
                </button>
              </div>
            ) : null}
          </section>

          {!fullscreenActive ? (
            <section className="tv-controls" aria-label="TV playback controls">
              <div className="tv-room-info">
                <p className="tv-room-code">ROOM {session.code}</p>
                <h1>{session.broadcaster.deviceName}</h1>
                <p className="tv-status-line">
                  {peerStatus === 'connected' ? 'Connected' : peerStatus.replace('-', ' ')}
                  {' · '}
                  {signalingState === 'connected' ? 'Signal online' : 'Reconnecting'}
                  {resolution ? ` · ${resolution}` : ''}
                  {' · '}
                  Network: {quality.label}
                </p>
              </div>
              <div className="tv-action-row">
                <button
                  type="button"
                  className="tv-button"
                  onClick={() => void togglePlayback()}
                  aria-label={isPaused ? 'Resume playback' : 'Pause playback'}
                >
                  {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  className="tv-button"
                  onClick={() => void toggleAudio()}
                  aria-label={isMuted ? 'Enable audio' : 'Mute audio'}
                >
                  {isMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
                  {isMuted ? 'Enable audio' : 'Mute audio'}
                </button>
                <button type="button" className="tv-button" onClick={() => void toggleFullscreen()}>
                  <Maximize aria-hidden="true" /> Fullscreen
                </button>
                <button type="button" className="tv-button" onClick={requestStreamSync}>
                  <RefreshCw aria-hidden="true" /> Reconnect
                </button>
                <button
                  type="button"
                  className="tv-button"
                  onClick={() => setShowJoinQr((visible) => !visible)}
                  aria-expanded={showJoinQr}
                >
                  <QrCode aria-hidden="true" /> Phone QR
                </button>
                <button type="button" className="tv-button" onClick={leaveSession}>
                  <ArrowLeft aria-hidden="true" /> Leave room
                </button>
              </div>
            </section>
          ) : null}

          {joinQr && showJoinQr && !fullscreenActive ? (
            <aside className="tv-phone-assist">
              <img src={joinQr} alt={`QR code to open room ${session.code} on a phone`} />
              <button
                type="button"
                className="tv-phone-close"
                onClick={() => setShowJoinQr(false)}
                aria-label="Close phone QR code"
              >
                <X aria-hidden="true" />
              </button>
              <p>Scan to join on a phone. The PIN is not included; this uses another receiver slot.</p>
            </aside>
          ) : null}
          {error || notice ? (
            <p className="tv-session-message" role={error ? 'alert' : 'status'}>
              {error || notice}
            </p>
          ) : null}
        </main>
      )}
    </div>
  );
}
