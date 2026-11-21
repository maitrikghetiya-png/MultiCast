import type { AudioConnectionState } from '../../types/streaming.ts';

export interface ResolvedAudioStatus {
  state: AudioConnectionState;
  label: string;
  controlLabel: string;
  description: string;
  canPlay: boolean;
  videoUnaffected: boolean;
}

export function clampAudioVolume(rawVolume: number): number {
  if (!Number.isFinite(rawVolume)) return 1;
  return Math.max(0, Math.min(1, Math.round(rawVolume * 100) / 100));
}

export function resolveAudioStatusSnapshot(params: {
  role: 'broadcaster' | 'receiver';
  isStreaming: boolean;
  hasLiveAudioTrack: boolean;
  streamHasAudio: boolean;
  sourceAudioMuted?: boolean;
  sourceTrackMuted?: boolean;
  receiverMuted?: boolean;
  autoplayBlocked?: boolean;
  hasActivePeerAudio?: boolean;
  audioReason?: string;
}): ResolvedAudioStatus {
  const sourceHasAudio = Boolean(params.hasLiveAudioTrack && params.streamHasAudio);

  if (!params.isStreaming || !sourceHasAudio) {
    return {
      state: 'unavailable',
      label: 'Audio unavailable',
      controlLabel: 'Audio Unavailable',
      description:
        params.audioReason ||
        'No audio track received from the source screen capture. Video playback remains active.',
      canPlay: false,
      videoUnaffected: true,
    };
  }

  if (params.sourceAudioMuted || params.sourceTrackMuted) {
    return {
      state: 'muted',
      label: 'Audio muted',
      controlLabel: params.role === 'broadcaster' ? 'Unmute Audio (M)' : 'Host Muted',
      description: 'Shared audio is muted on the source computer.',
      canPlay: false,
      videoUnaffected: true,
    };
  }

  if (params.role === 'receiver' && params.autoplayBlocked) {
    return {
      state: 'permission-required',
      label: 'Permission required',
      controlLabel: 'Enable Audio',
      description:
        'Browser autoplay rules paused sound playback. Click Enable Audio to play remote audio while video continues.',
      canPlay: false,
      videoUnaffected: true,
    };
  }

  if (params.role === 'receiver' && params.receiverMuted) {
    return {
      state: 'muted',
      label: 'Audio muted',
      controlLabel: 'Unmute Audio (M)',
      description: 'Audio is muted locally on this receiver.',
      canPlay: false,
      videoUnaffected: true,
    };
  }

  return {
    state: params.hasActivePeerAudio ? 'connected' : 'available',
    label: 'Audio available',
    controlLabel: 'Mute Audio (M)',
    description:
      params.role === 'broadcaster'
        ? 'Live source audio is included in the broadcast.'
        : 'Live source audio is streaming independently of the muted video frame.',
    canPlay: true,
    videoUnaffected: true,
  };
}
