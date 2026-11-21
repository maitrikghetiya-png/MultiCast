import type { SignalingConnectionState } from '../../services/socket/socketClient.ts';
import type { PeerConnectionStatus } from '../../types/streaming.ts';

interface StatusLabelProps {
  status: PeerConnectionStatus | SignalingConnectionState;
  dark?: boolean;
}

const LIGHT_STATUS_MAP: Record<
  PeerConnectionStatus | SignalingConnectionState,
  { label: string; textClass: string; dotClass: string }
> = {
  connected: {
    label: 'Connected',
    textClass: 'text-emerald-700',
    dotClass: 'bg-emerald-600',
  },
  connecting: {
    label: 'Connecting',
    textClass: 'text-amber-700',
    dotClass: 'bg-amber-500',
  },
  negotiating: {
    label: 'Negotiating',
    textClass: 'text-amber-700',
    dotClass: 'bg-amber-500',
  },
  'waiting-stream': {
    label: 'Waiting for stream',
    textClass: 'text-zinc-600',
    dotClass: 'bg-zinc-400',
  },
  idle: {
    label: 'Standby',
    textClass: 'text-zinc-600',
    dotClass: 'bg-zinc-400',
  },
  disconnected: {
    label: 'Disconnected',
    textClass: 'text-zinc-600',
    dotClass: 'bg-zinc-400',
  },
  reconnecting: {
    label: 'Reconnecting',
    textClass: 'text-amber-700',
    dotClass: 'bg-amber-500',
  },
  failed: {
    label: 'Failed',
    textClass: 'text-red-700',
    dotClass: 'bg-red-600',
  },
  error: {
    label: 'Error',
    textClass: 'text-red-700',
    dotClass: 'bg-red-600',
  },
};

const DARK_STATUS_MAP: Record<
  PeerConnectionStatus | SignalingConnectionState,
  { label: string; textClass: string; dotClass: string }
> = {
  connected: {
    label: 'Connected',
    textClass: 'text-emerald-400',
    dotClass: 'bg-emerald-400',
  },
  connecting: {
    label: 'Connecting',
    textClass: 'text-amber-300',
    dotClass: 'bg-amber-400',
  },
  negotiating: {
    label: 'Negotiating',
    textClass: 'text-amber-300',
    dotClass: 'bg-amber-400',
  },
  'waiting-stream': {
    label: 'Waiting for stream',
    textClass: 'text-zinc-300',
    dotClass: 'bg-zinc-400',
  },
  idle: {
    label: 'Standby',
    textClass: 'text-zinc-400',
    dotClass: 'bg-zinc-500',
  },
  disconnected: {
    label: 'Disconnected',
    textClass: 'text-zinc-400',
    dotClass: 'bg-zinc-500',
  },
  reconnecting: {
    label: 'Reconnecting',
    textClass: 'text-amber-300',
    dotClass: 'bg-amber-400',
  },
  failed: {
    label: 'Failed',
    textClass: 'text-red-400',
    dotClass: 'bg-red-400',
  },
  error: {
    label: 'Error',
    textClass: 'text-red-400',
    dotClass: 'bg-red-400',
  },
};

export function StatusLabel({ status, dark = false }: StatusLabelProps) {
  const map = dark ? DARK_STATUS_MAP : LIGHT_STATUS_MAP;
  const config = map[status] || map.idle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${config.textClass}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${config.dotClass}`}
        aria-hidden="true"
      />
      <span>{config.label}</span>
    </span>
  );
}
