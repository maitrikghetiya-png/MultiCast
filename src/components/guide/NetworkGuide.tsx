import { Check, Copy, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getScreenCaptureSupport } from '../../services/streaming/mediaCaptureService.ts';
import { formatLifetimeDuration } from '../../utils/platform.ts';

interface ServerHealthInfo {
  status: string;
  uptimeSeconds: number;
  activeSessions: number;
  connectedReceivers: number;
  maxTotalDevicesPerRoom?: number;
  maxReceiversPerRoom?: number;
  roomMaxLifetimeMs?: number;
  firebaseAuthConfigured?: boolean;
  lanAddresses: string[];
  port: number;
  turnConfigured?: boolean;
}

export function NetworkGuide() {
  const [captureSupport] = useState(() => getScreenCaptureSupport());
  const [health, setHealth] = useState<ServerHealthInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const loadHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      const data = (await response.json()) as ServerHealthInfo;
      setHealth(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach /api/health.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHealth();
  }, []);

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIp(url);
      window.setTimeout(() => setCopiedIp(null), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="max-w-4xl space-y-6">
      <section className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">
              Signaling Server &amp; Network Diagnostics
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              MultiCast runs a unified Express and Socket.IO backend on the same origin as
              the web app, then establishes direct 1-to-many WebRTC peer connections between
              the source and up to 9 receiver displays (10 devices total per room).
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadHealth()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-red-600 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-red-700">{error}</p>
        ) : health ? (
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-6 gap-4 pt-5 border-t border-zinc-200">
            <div>
              <div className="text-xs text-zinc-500">Server Status</div>
              <div className="mt-1 text-sm font-semibold text-emerald-700">
                Online
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Active Rooms</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                {health.activeSessions}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Receivers</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                {health.connectedReceivers}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Room Limit</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                {health.maxTotalDevicesPerRoom ?? 10} devices
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Max Lifetime</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">
                {typeof health.roomMaxLifetimeMs === 'number'
                  ? formatLifetimeDuration(health.roomMaxLifetimeMs)
                  : '24 hours'}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">TURN / Uptime</div>
              <div className="mt-1 font-mono text-sm font-semibold text-zinc-900 tabular-nums">
                {health.turnConfigured ? 'TURN · ' : 'STUN · '}
                {health.uptimeSeconds}s
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-900">
          Connecting Phones, Tablets &amp; Computers Over Wi-Fi or HTTPS
        </h3>
        <ol className="space-y-3 text-sm text-zinc-600 list-decimal list-inside leading-relaxed">
          <li>
            Connect the source device and up to 9 receiver displays (Windows, macOS,
            iPad, iPhone, or Android — 10 devices maximum per room) to the same Wi-Fi
            network or open the deployed HTTPS / WSS URL.
          </li>
          <li>
            Sign in with Google, Email &amp; Password, or Mobile OTP on the source device,
            then open <strong>Source Broadcaster</strong> and click{' '}
            <strong>Start Sharing</strong> to choose a display, window, or browser tab.
          </li>
          <li>
            Share the 6-character room code, QR code (or invitation link), and private
            numeric PIN with each receiver. Phone and tablet receivers can scan the QR code
            from <strong>Receiver Display</strong>, switch between portrait and landscape
            fullscreen, and tap <strong>Enable Audio</strong> if mobile autoplay pauses sound.
          </li>
          <li>
            Note on OS &amp; browser limits: <code className="font-mono text-xs">getDisplayMedia</code>{' '}
            requires HTTPS or <code className="font-mono text-xs">localhost</code>. Desktop
            browsers and Android browsers that expose the API can attempt broadcasting; API detection
            does not guarantee device capture. Apple iOS and
            iPadOS restrict web browsers from screen broadcasting (iPhone/iPad work great
            as receivers).
          </li>
        </ol>

        <div className="pt-4 border-t border-zinc-200 space-y-2.5">
          <div className="text-xs font-medium text-zinc-700">
            Reachable Application URLs
          </div>
          <div className="space-y-2">
            {currentOrigin ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2">
                <span className="font-mono text-xs text-zinc-800 truncate">
                  {currentOrigin}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyUrl(currentOrigin)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 hover:text-red-600 whitespace-nowrap shrink-0"
                >
                  {copiedIp === currentOrigin ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-zinc-500" />
                  )}
                  <span>{copiedIp === currentOrigin ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            ) : null}

            {health?.lanAddresses.map((ip) => {
              const lanUrl = `http://${ip}:${health.port}`;
              return (
                <div
                  key={ip}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2"
                >
                  <span className="font-mono text-xs text-zinc-800 truncate">
                    {lanUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl(lanUrl)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-700 hover:text-red-600 whitespace-nowrap shrink-0"
                  >
                    {copiedIp === lanUrl ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-zinc-500" />
                    )}
                    <span>{copiedIp === lanUrl ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-900">
            Cross-Platform Screen Capture &amp; Receiver Compatibility
          </h3>
          <span
            className={`text-xs font-medium ${
              captureSupport.supported ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {captureSupport.supported
              ? 'Current browser supports getDisplayMedia'
              : captureSupport.secureContext
                ? `${captureSupport.platform} ${captureSupport.browser}: Receiver Ready`
                : 'Insecure HTTP context (capture blocked)'}
          </span>
        </div>

        <p className="text-sm text-zinc-600 leading-relaxed">
          Browsers restrict{' '}
          <code className="font-mono text-xs">navigator.mediaDevices.getDisplayMedia()</code>{' '}
          to a <strong className="text-zinc-900">Secure Context</strong> (
          <code className="font-mono text-xs">https://</code> or{' '}
          <code className="font-mono text-xs">http://localhost</code>) and direct user
          activation. Every modern mobile and desktop browser works as a WebRTC{' '}
          <strong className="text-zinc-900">Receiver Display</strong>.
        </p>

        <div className="overflow-x-auto border border-zinc-200 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Platform &amp; Browser</th>
                <th className="px-4 py-2.5 font-semibold">Receiver Display</th>
                <th className="px-4 py-2.5 font-semibold">Source Broadcasting</th>
                <th className="px-4 py-2.5 font-semibold">Audio Capture</th>
                <th className="px-4 py-2.5 font-semibold">Fullscreen &amp; Recovery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 text-zinc-700">
              <tr>
                <td className="px-4 py-2.5 font-medium text-zinc-900">
                  Chrome / Edge (Win &amp; macOS)
                </td>
                <td className="px-4 py-2.5">Supported (Video + Audio)</td>
                <td className="px-4 py-2.5">Display, Window, Tab</td>
                <td className="px-4 py-2.5">Tab audio &amp; System (Win / macOS 13+)</td>
                <td className="px-4 py-2.5">ICE Restart + Fullscreen + PiP</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-medium text-zinc-900">
                  Safari / Firefox (macOS &amp; Win)
                </td>
                <td className="px-4 py-2.5">Supported (Video + Audio)</td>
                <td className="px-4 py-2.5">Display &amp; Window</td>
                <td className="px-4 py-2.5">Video-only in standard picker</td>
                <td className="px-4 py-2.5">ICE Restart + Fullscreen</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-medium text-zinc-900">
                  Android Browsers (Phone &amp; Tablet)
                </td>
                <td className="px-4 py-2.5">Capture API-gated; hardware unverified</td>
                <td className="px-4 py-2.5">Screen capture if supported (720p30 default)</td>
                <td className="px-4 py-2.5">Only when returned as a live audio track</td>
                <td className="px-4 py-2.5">Browser/model dependent; not physically tested</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-medium text-zinc-900">
                  iPhone Safari &amp; iPad Safari / Chrome
                </td>
                <td className="px-4 py-2.5">Supported + Tap Enable Audio</td>
                <td className="px-4 py-2.5 text-amber-700 font-medium">
                  Blocked by iOS/iPadOS WebKit
                </td>
                <td className="px-4 py-2.5">Receives audio from desktop hosts</td>
                <td className="px-4 py-2.5">Viewport Fullscreen + Scroll-Lock</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            1-to-Many Bandwidth Scaling
          </h3>
          <p className="mt-1 text-sm text-zinc-600 leading-relaxed">
            Each receiver receives an independent WebRTC stream from the source device. Step
            down to <strong>720p · 30 fps</strong> when casting to 3+ screens over shared
            Wi-Fi.
          </p>
        </div>

        <div className="overflow-x-auto border border-zinc-200 rounded-lg">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Quality Preset</th>
                <th className="px-4 py-2.5 font-semibold text-right">1 Receiver</th>
                <th className="px-4 py-2.5 font-semibold text-right">2 Receivers</th>
                <th className="px-4 py-2.5 font-semibold text-right">3 Receivers</th>
                <th className="px-4 py-2.5 font-semibold text-right">4 Receivers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 text-zinc-700 font-mono">
              <tr>
                <td className="px-4 py-2.5 font-sans font-medium text-zinc-900">1440p · 60 fps</td>
                <td className="px-4 py-2.5 text-right">14.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">28.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">42.0 Mbps</td>
                <td className="px-4 py-2.5 text-right text-amber-700 font-semibold">56.0 Mbps</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-sans font-medium text-zinc-900">1080p · 60 fps</td>
                <td className="px-4 py-2.5 text-right">8.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">16.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">24.0 Mbps</td>
                <td className="px-4 py-2.5 text-right font-semibold">32.0 Mbps</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-sans font-medium text-zinc-900">1080p · 30 fps</td>
                <td className="px-4 py-2.5 text-right">5.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">10.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">15.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">20.0 Mbps</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-sans font-medium text-zinc-900">720p · 30 fps (Multi-Screen)</td>
                <td className="px-4 py-2.5 text-right">2.5 Mbps</td>
                <td className="px-4 py-2.5 text-right">5.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">7.5 Mbps</td>
                <td className="px-4 py-2.5 text-right text-emerald-700 font-semibold">10.0 Mbps</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-sans font-medium text-zinc-900">540p · 30 fps (Low Bandwidth)</td>
                <td className="px-4 py-2.5 text-right">1.5 Mbps</td>
                <td className="px-4 py-2.5 text-right">3.0 Mbps</td>
                <td className="px-4 py-2.5 text-right">4.5 Mbps</td>
                <td className="px-4 py-2.5 text-right text-emerald-700 font-semibold">6.0 Mbps</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
