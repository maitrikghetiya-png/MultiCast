import type {
  ConnectionQualityTier,
  PeerConnectionStatus,
  RtcTelemetryStats,
} from '../../types/streaming.ts';

interface NetworkQualityIndicatorProps {
  peerStatus: PeerConnectionStatus;
  stats: RtcTelemetryStats | null;
}

export interface EvaluatedQuality {
  tier: ConnectionQualityTier;
  bars: number;
  label: string;
  lightTextClass: string;
  barColorClass: string;
}

export function evaluateConnectionQuality(
  peerStatus: PeerConnectionStatus,
  stats: RtcTelemetryStats | null,
): EvaluatedQuality {
  if (peerStatus !== 'connected') {
    return {
      tier: 'standby',
      bars: peerStatus === 'reconnecting' ? 1 : 0,
      label:
        peerStatus === 'failed'
          ? 'Link Failed'
          : peerStatus === 'reconnecting'
            ? 'Reconnecting'
            : peerStatus === 'disconnected'
              ? 'Interrupted'
              : 'Standby',
      lightTextClass:
        peerStatus === 'failed'
          ? 'text-red-700'
          : peerStatus === 'reconnecting' || peerStatus === 'disconnected'
            ? 'text-amber-700'
            : 'text-zinc-500',
      barColorClass:
        peerStatus === 'reconnecting' || peerStatus === 'disconnected'
          ? 'bg-amber-500'
          : 'bg-zinc-300',
    };
  }

  if (
    !stats ||
    (stats.bitrateKbps === 0 && stats.fps === 0 && stats.rttMs === null)
  ) {
    return {
      tier: 'measuring',
      bars: 2,
      label: 'Measuring',
      lightTextClass: 'text-zinc-700',
      barColorClass: 'bg-zinc-500',
    };
  }

  const rtt = stats.rttMs ?? 0;
  const fps = stats.fps;
  const lossDelta = stats.packetsLostDelta ?? 0;
  const jitter = stats.jitterMs ?? 0;

  if (rtt > 160 || lossDelta >= 15 || jitter > 45) {
    return {
      tier: 'poor',
      bars: 1,
      label: 'Poor',
      lightTextClass: 'text-red-700',
      barColorClass: 'bg-red-600',
    };
  }

  if (rtt > 75 || lossDelta >= 3 || jitter > 25) {
    return {
      tier: 'fair',
      bars: 2,
      label: 'Fair',
      lightTextClass: 'text-amber-700',
      barColorClass: 'bg-amber-500',
    };
  }

  if (rtt <= 25 && lossDelta === 0 && (fps >= 24 || stats.bitrateKbps >= 1500)) {
    return {
      tier: 'excellent',
      bars: 4,
      label: 'Excellent',
      lightTextClass: 'text-emerald-700',
      barColorClass: 'bg-emerald-600',
    };
  }

  if (fps >= 12 || stats.bitrateKbps >= 500) {
    return {
      tier: 'good',
      bars: 3,
      label: 'Good',
      lightTextClass: 'text-emerald-700',
      barColorClass: 'bg-emerald-500',
    };
  }

  return {
    tier: 'fair',
    bars: 2,
    label: 'Fair',
    lightTextClass: 'text-amber-700',
    barColorClass: 'bg-amber-500',
  };
}

export function NetworkQualityIndicator({
  peerStatus,
  stats,
}: NetworkQualityIndicatorProps) {
  const quality = evaluateConnectionQuality(peerStatus, stats);
  const heights = [6, 10, 14, 18];

  return (
    <div
      className="inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-zinc-50 whitespace-nowrap"
      title={
        stats
          ? `RTT: ${stats.rttMs ?? '—'} ms | FPS: ${stats.fps} | Jitter: ${
              stats.jitterMs ?? '—'
            } ms | Packet loss: ${stats.packetsLost} (${stats.packetsLostDelta ?? 0}/s)`
          : 'Waiting for active WebRTC telemetry'
      }
    >
      <div className="flex items-end gap-0.5 h-[18px]" aria-hidden="true">
        {heights.map((height, idx) => {
          const active = idx < quality.bars;
          return (
            <span
              key={height}
              style={{ height: `${height}px` }}
              className={`w-1 rounded-xs transition-colors ${
                active ? quality.barColorClass : 'bg-zinc-200'
              }`}
            />
          );
        })}
      </div>

      <div className="text-xs leading-none">
        <span className="text-zinc-500">Quality: </span>
        <span className={`font-semibold ${quality.lightTextClass}`}>{quality.label}</span>
        {peerStatus === 'connected' && stats && stats.rttMs !== null ? (
          <span className="ml-1.5 font-mono text-zinc-500 tabular-nums">
            {stats.rttMs}ms
          </span>
        ) : null}
      </div>
    </div>
  );
}
