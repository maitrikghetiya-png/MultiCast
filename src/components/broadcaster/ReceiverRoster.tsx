import { Lock, Monitor, RefreshCw, Unlock, UserX } from 'lucide-react';
import type { BroadcasterPeerState } from '../../types/streaming.ts';
import { formatBitrate, formatJoinTime } from '../../utils/platform.ts';
import { StatusLabel } from '../common/StatusLabel.tsx';
import { evaluateConnectionQuality } from '../receiver/NetworkQualityIndicator.tsx';

interface ReceiverRosterProps {
  peers: BroadcasterPeerState[];
  sessionCode: string | null;
  maxReceivers?: number;
  maxTotalDevices?: number;
  totalDevicesConnected?: number;
  isRoomLocked?: boolean;
  onToggleRoomLock?: () => void;
  onKickReceiver: (socketId: string) => void;
  onRetryPeer?: (socketId: string) => void;
  isStreaming?: boolean;
}

export function ReceiverRoster({
  peers,
  sessionCode,
  maxReceivers = 9,
  maxTotalDevices = 10,
  totalDevicesConnected = 1,
  isRoomLocked = false,
  onToggleRoomLock,
  onKickReceiver,
  onRetryPeer,
  isStreaming = false,
}: ReceiverRosterProps) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-200 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-sm font-semibold text-zinc-900">
              Live Receiver Dashboard
            </h2>
            {isRoomLocked ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                <Lock className="h-3 w-3" />
                <span>Room Locked</span>
              </span>
            ) : null}
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">
            Each receiver maintains an independent RTCPeerConnection receiving the shared source stream (1 source + up to {maxReceivers} receivers).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {sessionCode && onToggleRoomLock ? (
            <button
              type="button"
              onClick={onToggleRoomLock}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                isRoomLocked
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-red-200 hover:bg-red-50/40'
              }`}
            >
              {isRoomLocked ? (
                <>
                  <Unlock className="h-3.5 w-3.5" />
                  <span>Unlock Room</span>
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5 text-red-600" />
                  <span>Lock Room</span>
                </>
              )}
            </button>
          ) : null}

          <div className="text-xs text-zinc-600 tabular-nums whitespace-nowrap">
            <span className="font-mono font-semibold text-zinc-900">
              {totalDevicesConnected} / {maxTotalDevices}
            </span>{' '}
            devices <span aria-hidden="true">·</span>{' '}
            <span className="font-mono font-semibold text-zinc-900">
              {peers.length} / {maxReceivers}
            </span>{' '}
            receivers
          </div>
        </div>
      </div>

      {peers.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-500">
            <Monitor className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-zinc-900">
            {isRoomLocked
              ? 'Room is locked · No receivers connected'
              : 'No receiver computers connected'}
          </p>
          <p className="mt-1 text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
            {isRoomLocked
              ? 'Unlock the room to allow new receiver displays to join with the room code and PIN.'
              : sessionCode
                ? `Open MultiCast on any Windows, Mac, tablet, or phone, open Receiver Display, and join room ${sessionCode} with the room PIN.`
                : 'Open a pairing room or click Start Sharing to generate a 6-character room code, invite link, QR code, and PIN.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile & Tablet Card List */}
          <div className="md:hidden divide-y divide-zinc-200">
            {peers.map((peer) => {
              const canRetry =
                Boolean(onRetryPeer) &&
                isStreaming &&
                (peer.rtcState === 'failed' ||
                  peer.rtcState === 'disconnected' ||
                  peer.rtcState === 'reconnecting');
              const quality = evaluateConnectionQuality(peer.rtcState, peer.stats);
              const adaptive = peer.adaptiveQuality;
              return (
                <div key={peer.socketId} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-zinc-900 truncate">
                        {peer.deviceName}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {peer.platform} <span aria-hidden="true">·</span> {peer.browser}{' '}
                        <span aria-hidden="true">·</span> Joined {formatJoinTime(peer.joinedAt)}
                      </div>
                    </div>
                    <StatusLabel status={peer.rtcState} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-zinc-50/70 p-2.5 text-xs tabular-nums">
                    <div>
                      <span className="text-zinc-500">Quality: </span>
                      <span className={`font-medium ${quality.lightTextClass}`}>
                        {quality.label}
                      </span>
                      {adaptive ? (
                        <span className="text-zinc-500 font-mono"> · {adaptive.effectiveHeight}p</span>
                      ) : null}
                    </div>
                    <div>
                      <span className="text-zinc-500">Rate: </span>
                      <span className="font-mono text-zinc-800">
                        {peer.stats ? formatBitrate(peer.stats.bitrateKbps) : 'Unavailable'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">RTT: </span>
                      <span className="font-mono text-zinc-800">
                        {peer.stats && peer.stats.rttMs !== null
                          ? `${peer.stats.rttMs} ms`
                          : 'Unavailable'}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">FPS: </span>
                      <span className="font-mono text-zinc-800">
                        {peer.stats && peer.stats.fps > 0
                          ? `${peer.stats.fps} fps`
                          : 'Unavailable'}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {canRetry ? (
                      <button
                        type="button"
                        onClick={() => onRetryPeer?.(peer.socketId)}
                        className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors touch-manipulation"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Reconnect</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => onKickReceiver(peer.socketId)}
                      className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-700 hover:text-red-700 hover:border-red-200 hover:bg-red-50 transition-colors touch-manipulation"
                    >
                      <UserX className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/70 text-xs font-medium text-zinc-500">
                  <th className="py-2.5 px-5">Device Name</th>
                  <th className="py-2.5 px-4">OS / Browser</th>
                  <th className="py-2.5 px-4">Joined</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Quality &amp; Stream</th>
                  <th className="py-2.5 px-4 text-right">Throughput</th>
                  <th className="py-2.5 px-4 text-right">FPS</th>
                  <th className="py-2.5 px-4 text-right">RTT</th>
                  <th className="py-2.5 px-4 text-right">Loss</th>
                  <th className="py-2.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-sm">
                {peers.map((peer) => {
                  const canRetry =
                    Boolean(onRetryPeer) &&
                    isStreaming &&
                    (peer.rtcState === 'failed' ||
                      peer.rtcState === 'disconnected' ||
                      peer.rtcState === 'reconnecting');
                  const quality = evaluateConnectionQuality(peer.rtcState, peer.stats);
                  const adaptive = peer.adaptiveQuality;
                  return (
                    <tr
                      key={peer.socketId}
                      className="hover:bg-zinc-50/70 transition-colors"
                    >
                      <td className="py-3 px-5 font-medium text-zinc-900 whitespace-nowrap">
                        {peer.deviceName}
                      </td>
                      <td className="py-3 px-4 text-xs text-zinc-600 whitespace-nowrap">
                        {peer.platform} <span aria-hidden="true">·</span> {peer.browser}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-zinc-600 tabular-nums whitespace-nowrap">
                        {formatJoinTime(peer.joinedAt)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusLabel status={peer.rtcState} />
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <div
                          className={`font-medium ${quality.lightTextClass}`}
                          title={adaptive?.reason || undefined}
                        >
                          {quality.label}
                          {adaptive ? (
                            <span className="ml-1.5 font-mono text-[11px] text-zinc-500 font-normal">
                              ({adaptive.tierLabel} · {adaptive.effectiveHeight}p)
                            </span>
                          ) : null}
                        </div>
                        {adaptive?.adaptedDown ? (
                          <div className="text-[11px] text-amber-700 truncate max-w-[210px]">
                            {adaptive.reason}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-zinc-700 tabular-nums whitespace-nowrap">
                        {peer.stats ? formatBitrate(peer.stats.bitrateKbps) : 'Unavailable'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-zinc-700 tabular-nums whitespace-nowrap">
                        {peer.stats && peer.stats.fps > 0 ? `${peer.stats.fps} fps` : 'Unavailable'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-zinc-700 tabular-nums whitespace-nowrap">
                        {peer.stats && peer.stats.rttMs !== null
                          ? `${peer.stats.rttMs} ms`
                          : 'Unavailable'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-zinc-700 tabular-nums whitespace-nowrap">
                        {peer.stats ? `${peer.stats.packetsLostDelta ?? 0}/s` : 'Unavailable'}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {canRetry ? (
                            <button
                              type="button"
                              onClick={() => onRetryPeer?.(peer.socketId)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-red-700 hover:bg-red-50 transition-colors whitespace-nowrap"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              <span>Reconnect</span>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => onKickReceiver(peer.socketId)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-zinc-600 hover:text-red-700 hover:bg-red-50 transition-colors whitespace-nowrap"
                          >
                            <UserX className="h-3.5 w-3.5" />
                            <span>Remove</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
