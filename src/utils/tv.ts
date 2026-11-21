export type TvPlatform =
  | 'Android TV / Google TV'
  | 'Samsung Tizen'
  | 'LG webOS'
  | 'Fire TV'
  | 'Unidentified TV browser';

export interface TvReceiverCapabilities {
  hasPeerConnection: boolean;
  hasMediaStreamPlayback: boolean;
}

export function detectTvPlatformFromUserAgent(userAgent: string): TvPlatform {
  const ua = userAgent.toLowerCase();
  if (/\baft[a-z0-9]+\b/.test(ua) || ua.includes('fire tv') || ua.includes('aftb')) {
    return 'Fire TV';
  }
  if (ua.includes('tizen') || ua.includes('samsungtv') || ua.includes('smart-tv')) {
    return 'Samsung Tizen';
  }
  if (ua.includes('web0s') || ua.includes('webos') || ua.includes('netcast')) {
    return 'LG webOS';
  }
  if (ua.includes('android tv') || ua.includes('googletv') || ua.includes('google tv')) {
    return 'Android TV / Google TV';
  }
  return 'Unidentified TV browser';
}

export function canReceiveTvWebRtc(capabilities: TvReceiverCapabilities): boolean {
  return capabilities.hasPeerConnection && capabilities.hasMediaStreamPlayback;
}

export function detectTvReceiverCapabilities(): TvReceiverCapabilities {
  if (typeof window === 'undefined' || typeof HTMLMediaElement === 'undefined') {
    return { hasPeerConnection: false, hasMediaStreamPlayback: false };
  }

  const PeerConnection = window.RTCPeerConnection;
  return {
    hasPeerConnection:
      typeof PeerConnection === 'function' &&
      typeof PeerConnection.prototype.setRemoteDescription === 'function',
    hasMediaStreamPlayback: 'srcObject' in HTMLMediaElement.prototype,
  };
}
