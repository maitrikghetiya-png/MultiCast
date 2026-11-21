import {
  computeTargetBitrateBps,
  STREAM_RESOLUTION_OPTIONS,
  type AdaptiveQualitySnapshot,
  type AdaptiveTierLabel,
  type QualityMode,
  type StreamContentHint,
  type StreamFrameRate,
  type StreamResolutionId,
} from '../../types/streaming.ts';

export type AdaptiveLevel = 0 | 1 | 2 | 3;

export interface AdaptivePeerTracker {
  level: AdaptiveLevel;
  poorStreak: number;
  goodStreak: number;
  lastSwitchAt: number;
  lastReason: string;
}

export interface AdaptiveQualityOptions {
  poorSamplesThreshold?: number;
  goodSamplesThreshold?: number;
  downscaleCooldownMs?: number;
  upscaleCooldownMs?: number;
}

export interface ResolvedQualityTarget extends AdaptiveQualitySnapshot {
  degradationPreference: 'maintain-resolution' | 'balanced';
}

export const QUALITY_MODE_OPTIONS: Array<{
  id: QualityMode;
  label: string;
  description: string;
}> = [
  {
    id: 'auto',
    label: 'Auto (Adaptive)',
    description: 'Adapts per receiver while prioritizing text & slide readability',
  },
  {
    id: 'high',
    label: 'High',
    description: 'Uses full configured source resolution and frame rate',
  },
  {
    id: 'medium',
    label: 'Medium',
    description: 'Caps output up to 720p @ 30 fps (~2.5 Mbps/peer)',
  },
  {
    id: 'low',
    label: 'Low',
    description: 'Caps output up to 540p @ 24 fps (~1.0 Mbps/peer)',
  },
];

export function createInitialAdaptiveTracker(now = 0): AdaptivePeerTracker {
  return {
    level: 0,
    poorStreak: 0,
    goodStreak: 0,
    lastSwitchAt: now,
    lastReason: 'Full configured quality',
  };
}

export function computeHonestResolutionCeiling(params: {
  requestedResolutionId: StreamResolutionId;
  requestedFrameRate: StreamFrameRate;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceFrameRate?: number;
}): {
  width: number;
  height: number;
  fps: number;
  maxBitrateBps: number;
} {
  const configured = STREAM_RESOLUTION_OPTIONS[params.requestedResolutionId];
  const baseBitrate = computeTargetBitrateBps(
    params.requestedResolutionId,
    params.requestedFrameRate,
  );

  // Never promise higher resolution or frame rate than the actual live source provides
  const portraitSource = Boolean(
    params.sourceWidth &&
      params.sourceHeight &&
      params.sourceHeight > params.sourceWidth,
  );
  const configuredWidth = portraitSource ? configured.height : configured.width;
  const configuredHeight = portraitSource ? configured.width : configured.height;
  const effectiveWidth =
    params.sourceWidth && params.sourceWidth > 0
      ? Math.min(configuredWidth, params.sourceWidth)
      : configuredWidth;
  const effectiveHeight =
    params.sourceHeight && params.sourceHeight > 0
      ? Math.min(configuredHeight, params.sourceHeight)
      : configuredHeight;
  const effectiveFps =
    params.sourceFrameRate && params.sourceFrameRate > 0
      ? Math.min(params.requestedFrameRate, params.sourceFrameRate)
      : params.requestedFrameRate;

  return {
    width: effectiveWidth,
    height: effectiveHeight,
    fps: effectiveFps,
    maxBitrateBps: baseBitrate,
  };
}

function tierFromScaledHeight(height: number | undefined): AdaptiveTierLabel {
  if (!height || height >= 900) return 'High';
  if (height >= 640) return 'Medium';
  return 'Low';
}

export function resolveQualityProfile(params: {
  mode: QualityMode;
  level: AdaptiveLevel;
  contentHint: StreamContentHint;
  baseResolutionId: StreamResolutionId;
  baseFrameRate: StreamFrameRate;
  sourceWidth?: number;
  sourceHeight?: number;
  sourceFrameRate?: number;
  reason?: string;
}): ResolvedQualityTarget {
  const ceiling = computeHonestResolutionCeiling({
    requestedResolutionId: params.baseResolutionId,
    requestedFrameRate: params.baseFrameRate,
    sourceWidth: params.sourceWidth,
    sourceHeight: params.sourceHeight,
    sourceFrameRate: params.sourceFrameRate,
  });

  const degradationPreference: 'maintain-resolution' | 'balanced' =
    params.contentHint === 'detail' ? 'maintain-resolution' : 'balanced';
  const sourceShortEdge = Math.min(ceiling.width, ceiling.height);

  if (params.mode === 'high') {
    const tierLabel = tierFromScaledHeight(sourceShortEdge);
    return {
      mode: 'high',
      tierLabel,
      targetBitrateBps: ceiling.maxBitrateBps,
      scaleResolutionDownBy: 1.0,
      maxFramerate: ceiling.fps,
      effectiveWidth: ceiling.width,
      effectiveHeight: ceiling.height,
      reason: 'Manual High preset',
      adaptedDown: false,
      degradationPreference,
    };
  }

  if (params.mode === 'medium') {
    const scaleResolutionDownBy =
      sourceShortEdge > 720 ? Number((sourceShortEdge / 720).toFixed(2)) : 1.0;
    const effectiveWidth = Math.round(ceiling.width / scaleResolutionDownBy);
    const effectiveHeight = Math.round(ceiling.height / scaleResolutionDownBy);
    const maxFramerate = Math.min(ceiling.fps, 30);
    return {
      mode: 'medium',
      tierLabel: tierFromScaledHeight(Math.min(effectiveWidth, effectiveHeight)),
      targetBitrateBps: Math.min(ceiling.maxBitrateBps, 2_500_000),
      scaleResolutionDownBy,
      maxFramerate,
      effectiveWidth,
      effectiveHeight,
      reason: 'Manual Medium preset (720p target)',
      adaptedDown: scaleResolutionDownBy > 1.0 || maxFramerate < ceiling.fps,
      degradationPreference,
    };
  }

  if (params.mode === 'low') {
    const scaleResolutionDownBy =
      sourceShortEdge > 540 ? Number((sourceShortEdge / 540).toFixed(2)) : 1.0;
    const effectiveWidth = Math.round(ceiling.width / scaleResolutionDownBy);
    const effectiveHeight = Math.round(ceiling.height / scaleResolutionDownBy);
    const maxFramerate = Math.min(ceiling.fps, 24);
    return {
      mode: 'low',
      tierLabel: 'Low',
      targetBitrateBps: Math.min(ceiling.maxBitrateBps, 1_000_000),
      scaleResolutionDownBy,
      maxFramerate,
      effectiveWidth,
      effectiveHeight,
      reason: 'Manual Low bandwidth preset (540p target)',
      adaptedDown: true,
      degradationPreference,
    };
  }

  // Adaptive Auto mode: prioritizes text/presentation sharpness before spatial scaling
  const isDetail = params.contentHint === 'detail';
  let bitrateScale = 1.0;
  let scaleResolutionDownBy = 1.0;
  let maxFramerate = ceiling.fps;
  let reason = params.reason || 'Optimal link';

  if (params.level === 1) {
    bitrateScale = 0.65;
    scaleResolutionDownBy = isDetail ? 1.0 : 1.25;
    maxFramerate = Math.min(ceiling.fps, isDetail ? 24 : 30);
    reason = params.reason || 'Conserving bitrate & FPS while preserving text sharpness';
  } else if (params.level === 2) {
    bitrateScale = 0.42;
    scaleResolutionDownBy = isDetail
      ? sourceShortEdge > 720
        ? Number((sourceShortEdge / 720).toFixed(2))
        : 1.0
      : 1.5;
    maxFramerate = Math.min(ceiling.fps, isDetail ? 15 : 24);
    reason = params.reason || 'Reduced resolution & FPS for network stability';
  } else if (params.level >= 3) {
    bitrateScale = 0.25;
    scaleResolutionDownBy =
      sourceShortEdge > 540 ? Number((sourceShortEdge / 540).toFixed(2)) : 1.5;
    maxFramerate = Math.min(ceiling.fps, 15);
    reason = params.reason || 'Low-bandwidth protection active';
  }

  const targetBitrateBps = Math.max(
    500_000,
    Math.round(ceiling.maxBitrateBps * bitrateScale),
  );
  const effectiveWidth = Math.max(160, Math.round(ceiling.width / scaleResolutionDownBy));
  const effectiveHeight = Math.max(90, Math.round(ceiling.height / scaleResolutionDownBy));
  const effectiveShortEdge = Math.min(effectiveWidth, effectiveHeight);

  return {
    mode: 'auto',
    tierLabel:
      params.level === 0
        ? tierFromScaledHeight(effectiveShortEdge)
        : params.level <= 2 && effectiveShortEdge >= 640
          ? 'Medium'
          : 'Low',
    targetBitrateBps,
    scaleResolutionDownBy,
    maxFramerate,
    effectiveWidth,
    effectiveHeight,
    reason,
    adaptedDown: params.level > 0,
    degradationPreference,
  };
}

export function evaluateAdaptiveTransition(
  current: AdaptivePeerTracker,
  sample: {
    rttMs: number | null;
    packetsLostDelta: number;
    jitterMs?: number | null;
    now: number;
  },
  options: AdaptiveQualityOptions = {},
): { nextState: AdaptivePeerTracker; changed: boolean } {
  const poorSamplesThreshold = options.poorSamplesThreshold ?? 2;
  const goodSamplesThreshold = options.goodSamplesThreshold ?? 5;
  const downscaleCooldownMs = options.downscaleCooldownMs ?? 8_000;
  const upscaleCooldownMs = options.upscaleCooldownMs ?? 12_000;

  const rtt = sample.rttMs;
  const loss = Math.max(0, sample.packetsLostDelta);
  const jitter = sample.jitterMs ?? 0;

  const isPoor = loss >= 6 || (rtt !== null && rtt > 180) || jitter > 40;
  const isHealthy =
    loss === 0 && (rtt === null || rtt <= 105) && jitter <= 22;

  if (isPoor) {
    const poorStreak = current.poorStreak + 1;
    const cooldownElapsed = sample.now - current.lastSwitchAt >= downscaleCooldownMs;
    if (poorStreak >= poorSamplesThreshold && cooldownElapsed && current.level < 3) {
      const nextLevel = (current.level + 1) as AdaptiveLevel;
      const triggerDetail =
        loss >= 6
          ? `packet loss (${loss}/s)`
          : rtt !== null && rtt > 180
            ? `high RTT (${rtt}ms)`
            : `jitter (${jitter}ms)`;
      return {
        nextState: {
          level: nextLevel,
          poorStreak: 0,
          goodStreak: 0,
          lastSwitchAt: sample.now,
          lastReason: `Stepped down due to ${triggerDetail}`,
        },
        changed: true,
      };
    }
    return {
      nextState: {
        ...current,
        poorStreak,
        goodStreak: 0,
      },
      changed: false,
    };
  }

  if (isHealthy) {
    const goodStreak = current.goodStreak + 1;
    const cooldownElapsed = sample.now - current.lastSwitchAt >= upscaleCooldownMs;
    if (goodStreak >= goodSamplesThreshold && cooldownElapsed && current.level > 0) {
      const nextLevel = (current.level - 1) as AdaptiveLevel;
      return {
        nextState: {
          level: nextLevel,
          poorStreak: 0,
          goodStreak: 0,
          lastSwitchAt: sample.now,
          lastReason:
            nextLevel === 0
              ? 'Restored full configured quality'
              : 'Gradually restoring quality after stable recovery',
        },
        changed: true,
      };
    }
    return {
      nextState: {
        ...current,
        poorStreak: 0,
        goodStreak,
      },
      changed: false,
    };
  }

  // Borderline / steady-state window: avoid unnecessary switching
  return {
    nextState: {
      ...current,
      poorStreak: 0,
    },
    changed: false,
  };
}
