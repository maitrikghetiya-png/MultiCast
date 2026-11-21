import {
  Activity,
  ArrowRight,
  Cast,
  Check,
  Laptop,
  Layers,
  Menu,
  Monitor,
  ShieldCheck,
  Sliders,
  Smartphone,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import heroStudioImage from '../../assets/images/multicast_hero_red_white_1795269866373.jpg';
import { isDisplayMediaSupported } from '../../services/streaming/mediaCaptureService.ts';
import type { WorkspaceRole } from '../../types/streaming.ts';
import { detectBrowserName, detectDevicePlatform } from '../../utils/platform.ts';
import { BrandMark } from '../common/BrandMark.tsx';

interface LandingPageProps {
  onNavigate: (role: WorkspaceRole) => void;
  isAuthenticated?: boolean;
}

interface HealthSummary {
  status: string;
  activeSessions: number;
  connectedReceivers: number;
  maxTotalDevicesPerRoom?: number;
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function LandingPage({ onNavigate, isAuthenticated = false }: LandingPageProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [heroImageError, setHeroImageError] = useState(false);
  const [health, setHealth] = useState<HealthSummary | null>(null);

  const detectedPlatform = detectDevicePlatform();
  const detectedBrowser = detectBrowserName();
  const canBroadcastHere = isDisplayMediaSupported();

  useEffect(() => {
    let active = true;
    fetch('/api/health')
      .then((res) => (res.ok ? (res.json() as Promise<HealthSummary>) : null))
      .then((data) => {
        if (active && data) {
          setHealth(data);
        }
      })
      .catch(() => {
        // Optional status summary on initial landing render
      });
    return () => {
      active = false;
    };
  }, []);

  const scrollToSection = (id: string) => {
    setMobileMenuOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-[#FAFAFA] text-zinc-900 relative overflow-x-hidden">
        {/* Top Bar Contract: 3 zones (Brand — 4 single-line links — 1 primary CTA) */}
        <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/90 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600 rounded-md whitespace-nowrap shrink-0"
            >
              <BrandMark />
            </button>

            <nav
              aria-label="Primary navigation"
              className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600"
            >
              <button
                type="button"
                onClick={() => scrollToSection('how-it-works')}
                className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0"
              >
                How It Works
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('supported-devices')}
                className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0"
              >
                Devices
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('features')}
                className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0"
              >
                Capabilities
              </button>
              <button
                type="button"
                onClick={() => onNavigate('guide')}
                className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0"
              >
                Network Setup
              </button>
              <button
                type="button"
                onClick={() => onNavigate(isAuthenticated ? 'profile' : 'auth')}
                className="hover:text-zinc-950 transition-colors whitespace-nowrap shrink-0"
              >
                {isAuthenticated ? 'Account' : 'Sign In'}
              </button>
            </nav>

            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('broadcaster')}
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
              >
                <span>Start Sharing</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                onClick={() => setMobileMenuOpen((prev) => !prev)}
                className="md:hidden inline-flex items-center justify-center h-10 w-10 rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:text-zinc-950 hover:bg-zinc-50 transition-colors"
              >
                {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {mobileMenuOpen ? (
            <div className="md:hidden border-t border-zinc-200 bg-white px-6 py-4 space-y-3">
              <button
                type="button"
                onClick={() => scrollToSection('how-it-works')}
                className="block w-full text-left py-2 text-sm text-zinc-700 hover:text-zinc-950"
              >
                How It Works
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('supported-devices')}
                className="block w-full text-left py-2 text-sm text-zinc-700 hover:text-zinc-950"
              >
                Devices
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('features')}
                className="block w-full text-left py-2 text-sm text-zinc-700 hover:text-zinc-950"
              >
                Capabilities
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate('guide');
                }}
                className="block w-full text-left py-2 text-sm text-zinc-700 hover:text-zinc-950"
              >
                Network Setup
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onNavigate(isAuthenticated ? 'profile' : 'auth');
                }}
                className="block w-full text-left py-2 text-sm text-zinc-700 hover:text-zinc-950"
              >
                {isAuthenticated ? 'Account & Profile' : 'Sign In / Register'}
              </button>
              <div className="pt-2 flex flex-col gap-2 border-t border-zinc-200">
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onNavigate('broadcaster');
                  }}
                  className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 text-sm font-semibold text-white text-center"
                >
                  Start Sharing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onNavigate('receiver');
                  }}
                  className="w-full px-4 py-2.5 rounded-lg border border-zinc-200 bg-white text-sm font-medium text-zinc-800 text-center"
                >
                  Join Room
                </button>
              </div>
            </div>
          ) : null}
        </header>

        <main>
          {/* Hero Section */}
          <section className="relative bg-white border-b border-zinc-200/80">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_75%_60%_at_50%_0%,rgba(220,38,38,0.06),transparent_72%)]"
            />

            <div className="relative max-w-7xl mx-auto px-6 pt-14 pb-20 lg:pt-20 lg:pb-24">
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
                className="max-w-3xl mx-auto text-center"
              >
                <div className="text-xs font-medium text-red-600">
                  WebRTC Screen Casting <span aria-hidden="true">·</span> Live System Audio{' '}
                  <span aria-hidden="true">·</span> Up to 10 Devices per Room
                </div>

                <h1
                  className="mt-4 font-display font-bold tracking-tight text-zinc-950 leading-[1.08]"
                  style={{
                    fontSize: 'clamp(2.4rem, 5vw, 4.1rem)',
                    textWrap: 'balance',
                  }}
                >
                  One Source.{' '}
                  <span className="bg-gradient-to-r from-red-600 to-rose-600 bg-clip-text text-transparent">
                    Every Screen in Sync.
                  </span>
                </h1>

                <p className="mt-5 text-base sm:text-lg text-zinc-600 leading-relaxed max-w-2xl mx-auto">
                  Share a display, application window, or browser tab with sound across up
                  to 9 receiver displays (10 devices total) on Windows, macOS, iPad, iPhone,
                  and Android directly in your browser.
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
                  <button
                    type="button"
                    onClick={() => onNavigate('broadcaster')}
                    className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 text-sm font-semibold text-white shadow-sm shadow-red-600/20 transition-all whitespace-nowrap shrink-0"
                  >
                    <Cast className="h-4 w-4" />
                    <span>Start Sharing</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNavigate('receiver')}
                    className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl border border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 text-sm font-semibold text-zinc-900 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Monitor className="h-4 w-4 text-red-600" />
                    <span>Join Room</span>
                  </button>
                </div>
              </motion.div>

              {/* 16:9 Studio Visual */}
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.08, ease: EASE_OUT_EXPO }}
                className="mt-12 max-w-5xl mx-auto"
              >
                <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden shadow-xl shadow-zinc-900/5">
                  <div className="aspect-video w-full bg-zinc-100 relative overflow-hidden">
                    {!heroImageError ? (
                      <img
                        src={heroStudioImage}
                        alt="Wireless screen sharing from a laptop source to dual studio monitors in crisp crimson and white"
                        referrerPolicy="no-referrer"
                        onError={() => setHeroImageError(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-white via-zinc-50 to-red-50">
                        <Cast className="h-10 w-10 text-red-600 mb-3" />
                        <p className="text-sm font-semibold text-zinc-900">
                          MultiCast Wireless Display Studio
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Direct WebRTC display and audio sharing across desktops
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="px-6 py-4 border-t border-zinc-200 bg-white flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-500">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-zinc-900">Signaling Service</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {health ? 'Socket.IO Ready' : 'Checking /api/health'}
                      </span>
                      {health ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-zinc-700">
                            {health.activeSessions} active{' '}
                            {health.activeSessions === 1 ? 'room' : 'rooms'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-zinc-700">
                            {health.connectedReceivers}{' '}
                            {health.connectedReceivers === 1 ? 'receiver' : 'receivers'}
                          </span>
                        </>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => onNavigate('guide')}
                      className="inline-flex items-center gap-1.5 font-semibold text-red-600 hover:text-red-700 transition-colors whitespace-nowrap"
                    >
                      <span>View Network &amp; Setup</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </section>

          {/* How It Works Section */}
          <section id="how-it-works" className="py-20 lg:py-24 bg-[#FAFAFA]">
            <div className="max-w-7xl mx-auto px-6">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold text-red-600">How It Works</p>
                <h2
                  className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-950"
                  style={{ textWrap: 'balance' }}
                >
                  Pair screens in seconds with a room code and PIN
                </h2>
                <p className="mt-3 text-base text-zinc-600 leading-relaxed">
                  Room access stays protected by server-verified PINs while video and audio
                  travel peer-to-peer over WebRTC.
                </p>
              </div>

              <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  {
                    step: '01. Start Sharing on Source',
                    description:
                      'Open Source Broadcaster, select 720p to 1440p streaming quality, and pick any monitor, window, or tab with optional system audio.',
                    actionLabel: 'Open Source Broadcaster',
                    target: 'broadcaster' as WorkspaceRole,
                  },
                  {
                    step: '02. Share Code, QR & PIN',
                    description:
                      'The server issues a random 6-character room code, QR join link, and private numeric PIN—no PIN secrets ever leave inside the QR code.',
                    actionLabel: 'Inspect Network Setup',
                    target: 'guide' as WorkspaceRole,
                  },
                  {
                    step: '03. Watch & Hear Live',
                    description:
                      'Receivers open the room link or scan the QR code, verify the PIN, and view fullscreen hardware-decoded video and audio.',
                    actionLabel: 'Join a Room',
                    target: 'receiver' as WorkspaceRole,
                  },
                ].map((item, idx) => (
                  <motion.div
                    key={item.step}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, amount: 0.2 }}
                    transition={{
                      duration: 0.4,
                      delay: idx * 0.06,
                      ease: EASE_OUT_EXPO,
                    }}
                    className="rounded-xl border border-zinc-200 bg-white p-6 flex flex-col justify-between"
                  >
                    <div>
                      <h3 className="font-display text-lg font-semibold text-zinc-950">
                        {item.step}
                      </h3>
                      <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                    <div className="mt-6 pt-4 border-t border-zinc-100">
                      <button
                        type="button"
                        onClick={() => onNavigate(item.target)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 transition-colors"
                      >
                        <span>{item.actionLabel}</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* Supported Devices Section */}
          <section
            id="supported-devices"
            className="border-t border-zinc-200 bg-white py-20 lg:py-24"
          >
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div className="max-w-2xl">
                  <p className="text-xs font-semibold text-red-600">Supported Devices</p>
                  <h2
                    className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-950"
                    style={{ textWrap: 'balance' }}
                  >
                    Built for phones, tablets, and desktop browsers
                  </h2>
                  <p className="mt-3 text-base text-zinc-600 leading-relaxed">
                    MultiCast receivers use browser WebRTC support across phones, tablets, and computers. Broadcasting is enabled only when screen-capture APIs are detected; API availability alone does not verify playback or capture on a specific device.
                  </p>
                </div>

                <div className="text-xs text-zinc-600 border border-zinc-200 bg-zinc-50 rounded-lg px-4 py-2.5 shrink-0">
                  This browser:{' '}
                  <span className="text-zinc-900 font-semibold">{detectedPlatform}</span>{' '}
                  <span aria-hidden="true">·</span> {detectedBrowser}{' '}
                  <span aria-hidden="true">·</span>{' '}
                  <span className={canBroadcastHere ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                    {canBroadcastHere ? 'Capture API detected' : 'Receiver mode available'}
                  </span>
                </div>
              </div>

              <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-6">
                {[
                  {
                    icon: Laptop,
                    title: 'Source Broadcasters',
                    platforms: 'Windows · macOS · Android browsers with capture API (HTTPS)',
                    points: [
                      'Full display, app window, or browser tab capture on desktop browsers',
                      'Android capture is API-gated and defaults to mobile-tuned 720p @ 30 fps; real-device behavior varies',
                      'Note: iOS & iPadOS restrict web browsers from screen broadcasting',
                    ],
                    action: 'Open Source Broadcaster',
                    role: 'broadcaster' as WorkspaceRole,
                  },
                  {
                    icon: Monitor,
                    title: 'Desktop Receivers',
                    platforms: 'Windows 10/11 · macOS · Linux',
                    points: [
                      'Smooth playback in Chrome, Microsoft Edge, Safari, and Firefox',
                      'Fullscreen display mode, Picture-in-Picture, and live audio mute',
                      'Automatic ICE and signaling reconnection on Wi-Fi hiccups',
                    ],
                    action: 'Open Receiver Display',
                    role: 'receiver' as WorkspaceRole,
                  },
                  {
                    icon: Smartphone,
                    title: 'iPhone, iPad & Android Receivers',
                    platforms: 'iOS Safari · iPadOS Safari · Android browsers',
                    points: [
                      'Instant QR camera join or invitation link prefill with PIN lock',
                      'Touch-friendly portrait/landscape fullscreen with scroll lock & Enable Audio',
                      'Playback depends on browser/device WebRTC support; 10-device capacity is server-enforced',
                    ],
                    action: 'Join from Phone or Tablet',
                    role: 'receiver' as WorkspaceRole,
                  },
                ].map((card) => {
                  const CardIcon = card.icon;
                  return (
                    <div
                      key={card.title}
                      className="rounded-xl border border-zinc-200 bg-[#FAFAFA] p-6 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-600 shrink-0">
                            <CardIcon className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-display text-base font-semibold text-zinc-950">
                              {card.title}
                            </h3>
                            <p className="text-xs text-zinc-500">{card.platforms}</p>
                          </div>
                        </div>
                        <ul className="mt-5 space-y-2.5 text-sm text-zinc-700">
                          {card.points.map((point) => (
                            <li key={point} className="flex items-start gap-2.5">
                              <Check className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                              <span>{point}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="mt-6 pt-4 border-t border-zinc-200">
                        <button
                          type="button"
                          onClick={() => onNavigate(card.role)}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 inline-flex items-center gap-1.5"
                        >
                          <span>{card.action}</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Capabilities Section (Asymmetric Bento Grid) */}
          <section
            id="features"
            className="border-t border-zinc-200 bg-[#FAFAFA] py-20 lg:py-24"
          >
            <div className="max-w-7xl mx-auto px-6">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold text-red-600">Capabilities</p>
                <h2
                  className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-zinc-950"
                  style={{ textWrap: 'balance' }}
                >
                  Engineered for crisp screen readability and stable multi-peer streams
                </h2>
              </div>

              <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-2 rounded-xl border border-zinc-200 bg-white p-7">
                  <div className="h-9 w-9 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-600">
                    <Layers className="h-4 w-4" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-zinc-950">
                    1-to-Many WebRTC Star Topology
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 leading-relaxed max-w-2xl">
                    Each connected receiver gets a dedicated peer connection with live track
                    replacement when switching displays, plus per-peer adaptive congestion
                    control that preserves text resolution first.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-7">
                  <div className="h-9 w-9 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-600">
                    <Sliders className="h-4 w-4" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-zinc-950">
                    Resolution &amp; Content Hints
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                    Adjust 540p to 1440p60 bitrate caps live and prioritize crisp Text &amp; UI
                    or fluid Video &amp; Motion encoding.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-7">
                  <div className="h-9 w-9 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-600">
                    <Volume2 className="h-4 w-4" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-zinc-950">
                    Synchronized Audio Sharing
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                    Broadcast system or browser tab audio where supported, with honest track
                    status and one-click browser autoplay unlock on receivers.
                  </p>
                </div>

                <div className="md:col-span-2 rounded-xl border border-zinc-200 bg-white p-7">
                  <div className="h-9 w-9 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-600">
                    <Activity className="h-4 w-4" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-zinc-950">
                    Real-Time RTP Telemetry &amp; Recovery
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 leading-relaxed max-w-2xl">
                    Inspect live bitrate, frame rate, RTT, jitter, and ICE transport paths
                    from RTCPeerConnection.getStats(), backed by automatic Socket.IO
                    exponential backoff and ICE restarts.
                  </p>
                </div>

                <div className="md:col-span-2 rounded-xl border border-zinc-200 bg-white p-7">
                  <div className="h-9 w-9 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-600">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-zinc-950">
                    Server-Verified PINs &amp; Protected TURN Credentials
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 leading-relaxed max-w-2xl">
                    Production signaling enforces strict origin validation, room rate limits,
                    and authenticated ICE configuration so TURN relay credentials are issued
                    only to joined room members.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-7">
                  <div className="h-9 w-9 rounded-lg border border-red-200 bg-red-50 flex items-center justify-center text-red-600">
                    <Wifi className="h-4 w-4" />
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-zinc-950">
                    Same-Origin &amp; WSS Ready
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                    Unified Express + Socket.IO backend upgrades cleanly over HTTPS/WSS behind
                    Render or Cloud Run proxies.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Bottom Conversion Banner */}
          <section className="border-t border-zinc-200 bg-white py-16">
            <div className="max-w-7xl mx-auto px-6">
              <div className="rounded-2xl border border-red-200/80 bg-gradient-to-r from-red-600 to-rose-600 p-8 sm:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6 text-white">
                <div className="max-w-xl">
                  <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">
                    Ready to cast across your screens?
                  </h2>
                  <p className="mt-2 text-sm text-red-50 leading-relaxed">
                    Start sharing from your source computer or join an existing room using a
                    code, QR scan, and PIN.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigate('broadcaster')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-red-700 hover:bg-red-50 text-sm font-semibold transition-colors whitespace-nowrap"
                  >
                    <Cast className="h-4 w-4" />
                    <span>Start Sharing</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('receiver')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/40 bg-white/10 hover:bg-white/20 text-sm font-semibold text-white transition-colors whitespace-nowrap"
                  >
                    <Monitor className="h-4 w-4" />
                    <span>Join Room</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        </main>

        {/* Quiet Footer */}
        <footer className="border-t border-zinc-200 bg-white py-10">
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <BrandMark />
              <p className="mt-2 text-xs text-zinc-500">
                Cross-platform WebRTC screen casting and audio sharing across Windows, macOS, Android, iPhone, and iPad.
              </p>
              <p className="mt-1 text-xs font-medium text-zinc-700">
                Made by Maitrik Ghetiya
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs font-medium text-zinc-600">
              <button
                type="button"
                onClick={() => onNavigate('broadcaster')}
                className="hover:text-red-600 transition-colors"
              >
                Start Sharing
              </button>
              <button
                type="button"
                onClick={() => onNavigate('receiver')}
                className="hover:text-red-600 transition-colors"
              >
                Join Room
              </button>
              <button
                type="button"
                onClick={() => onNavigate('guide')}
                className="hover:text-red-600 transition-colors"
              >
                Network Setup
              </button>
              <button
                type="button"
                onClick={() => onNavigate(isAuthenticated ? 'profile' : 'auth')}
                className="hover:text-red-600 transition-colors"
              >
                {isAuthenticated ? 'Account & Profile' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('features')}
                className="hover:text-red-600 transition-colors"
              >
                Capabilities
              </button>
            </div>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}
