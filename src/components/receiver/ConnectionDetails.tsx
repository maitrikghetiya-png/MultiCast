import type {
  ConnectionTimings,
  PeerConnectionStatus,
  RtcTelemetryStats,
} from '../../types/streaming.ts';
import { formatBitrate } from '../../utils/platform.ts';

interface ConnectionDetailsProps {
  peerStatus: PeerConnectionStatus;
  stats: RtcTelemetryStats | null;
  timings?: ConnectionTimings;
  connectionType?: string | null;
}

function formatCandidatePath(candidateType: string | null): string {
  switch (candidateType) {
    case 'host':
      return 'Direct LAN / Wi-Fi';
    case 'srflx':
      return 'STUN Routed';
    case 'prflx':
      return 'Peer Reflexive';
    case 'relay':
      return 'TURN Relay';
    default:
      return 'Unavailable';
  }
}

export function ConnectionDetails({
  peerStatus,
  stats,
  timings,
  connectionType = null,
}: ConnectionDetailsProps) {
  const isConnected = peerStatus === 'connected' && stats !== null;
  const resolvedConnectionType = stats?.connectionType ?? connectionType ?? null;
  const hasTimings = Boolean(
    timings &&
      (timings.socketConnectMs !== null ||
        timings.roomAuthMs !== null ||
        timings.webrtcConnectMs !== null ||
        timings.firstFrameMs !== null),
  );

  return (
    <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200">
        <div className="p-4">
          <div className="text-xs text-zinc-500">Incoming Resolution</div>
          <div className="mt-1 font-mono text-base font-semibold text-zinc-900 tabular-nums">
            {isConnected && stats.width > 0 && stats.height > 0
              ? `${stats.width}×${stats.height}`
              : 'Unavailable'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-zinc-500">Frame Rate</div>
          <div className="mt-1 font-mono text-base font-semibold text-zinc-900 tabular-nums">
            {isConnected && stats.fps > 0 ? `${stats.fps} fps` : 'Unavailable'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-zinc-500">Receive Bitrate</div>
          <div className="mt-1 font-mono text-base font-semibold text-zinc-900 tabular-nums">
            {isConnected ? formatBitrate(stats.bitrateKbps) : 'Unavailable'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-zinc-500">RTT / Jitter</div>
          <div className="mt-1 font-mono text-base font-semibold text-zinc-900 tabular-nums">
            {isConnected && stats.rttMs !== null
              ? `${stats.rttMs} ms${
                  stats.jitterMs !== null && stats.jitterMs !== undefined
                    ? ` · ${stats.jitterMs}ms`
                    : ''
                }`
              : 'Unavailable'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-zinc-500">Packet Loss</div>
          <div className="mt-1 font-mono text-base font-semibold text-zinc-900 tabular-nums">
            {isConnected
              ? `${stats.packetsLost} (${stats.packetsLostDelta ?? 0}/s)`
              : 'Unavailable'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-zinc-500">Transport Path</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">
            {isConnected ? formatCandidatePath(stats.candidateType) : 'Unavailable'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-zinc-500">Connection Type</div>
          <div className="mt-1 text-sm font-semibold text-zinc-900">
            {resolvedConnectionType || 'Unavailable'}
          </div>
        </div>
      </div>

      {hasTimings && timings ? (
        <div className="px-4 py-2.5 border-t border-zinc-200 bg-zinc-50/70 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-zinc-600 tabular-nums">
          <span className="font-medium text-zinc-700">Connection Timing:</span>
          <span>
            Socket:{' '}
            <strong className="font-mono text-zinc-900">
              {timings.socketConnectMs !== null ? `${timings.socketConnectMs} ms` : 'Unavailable'}
            </strong>
          </span>
          <span>
            Room Auth:{' '}
            <strong className="font-mono text-zinc-900">
              {timings.roomAuthMs !== null ? `${timings.roomAuthMs} ms` : 'Unavailable'}
            </strong>
          </span>
          <span>
            WebRTC ICE:{' '}
            <strong className="font-mono text-zinc-900">
              {timings.webrtcConnectMs !== null ? `${timings.webrtcConnectMs} ms` : 'Unavailable'}
            </strong>
          </span>
          <span>
            First Frame:{' '}
            <strong className="font-mono text-zinc-900">
              {timings.firstFrameMs !== null ? `${timings.firstFrameMs} ms` : 'Unavailable'}
            </strong>
          </span>
        </div>
      ) : null}
    </section>
  );
}
