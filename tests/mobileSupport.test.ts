import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { RoomAuthService } from '../server/auth/roomAuth.ts';
import { initServerConfig } from '../server/config/env.ts';
import { RoomService } from '../server/services/roomService.ts';
import { registerRoomSocketHandlers } from '../server/socket/roomSocketHandlers.ts';
import {
  computeDefaultCapturePreset,
  getAudioSharingSupport,
  getScreenCaptureSupport,
  resolveCaptureDimensions,
} from '../src/services/streaming/mediaCaptureService.ts';
import type {
  ClientToServerEvents,
  JoinSessionAck,
  ServerToClientEvents,
} from '../src/types/signaling.ts';
import {
  buildReceiverJoinUrl,
  detectBrowserNameFrom,
  detectDeviceFormFactorFrom,
  detectDevicePlatformFrom,
  parseQrJoinPayload,
} from '../src/utils/platform.ts';
import {
  canReceiveTvWebRtc,
  detectTvPlatformFromUserAgent,
} from '../src/utils/tv.ts';

type TestClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

interface MobileTestHarness {
  httpServer: http.Server;
  ioServer: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  roomService: RoomService;
  connectClient: () => Promise<TestClientSocket>;
  cleanup: () => Promise<void>;
}

async function createMobileHarness(): Promise<MobileTestHarness> {
  const prevMax = process.env.MAX_RECEIVERS_PER_ROOM;
  const prevSecret = process.env.ROOM_AUTH_SECRET;
  process.env.MAX_RECEIVERS_PER_ROOM = '9';
  process.env.ROOM_AUTH_SECRET = 'test_mobile_support_secret_key_at_least_32_chars';
  initServerConfig();

  const authService = new RoomAuthService();
  const roomService = new RoomService(authService);
  const app = express();
  const httpServer = http.createServer(app);
  const ioServer = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer);
  ioServer.on('connection', (socket) => {
    registerRoomSocketHandlers(ioServer, socket, roomService);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = httpServer.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind test HTTP server');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const clientSockets: TestClientSocket[] = [];

  const connectClient = (): Promise<TestClientSocket> =>
    new Promise((resolve, reject) => {
      const client: TestClientSocket = ioClient(baseUrl, {
        transports: ['websocket'],
        forceNew: true,
      });
      clientSockets.push(client);
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });

  const cleanup = async () => {
    roomService.stopExpirationSweep();
    for (const sock of clientSockets) {
      sock.disconnect();
    }
    await new Promise<void>((resolve) => {
      ioServer.close(() => resolve());
    });
    if (httpServer.listening) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    if (prevMax === undefined) {
      delete process.env.MAX_RECEIVERS_PER_ROOM;
    } else {
      process.env.MAX_RECEIVERS_PER_ROOM = prevMax;
    }
    if (prevSecret === undefined) {
      delete process.env.ROOM_AUTH_SECRET;
    } else {
      process.env.ROOM_AUTH_SECRET = prevSecret;
    }
    initServerConfig();
  };

  return {
    httpServer,
    ioServer,
    roomService,
    connectClient,
    cleanup,
  };
}

function emitJoin(
  socket: TestClientSocket,
  payload: Record<string, unknown>,
): Promise<JoinSessionAck> {
  return new Promise((resolve) => {
    socket.emit('session:join', payload as never, resolve);
  });
}

describe('Mobile & Tablet Platform Detection, Capture Presets, and Capacity Parity', () => {
  let activeHarness: MobileTestHarness | null = null;

  afterEach(async () => {
    if (activeHarness) {
      await activeHarness.cleanup();
      activeHarness = null;
    }
  });

  test('identifies TV browser families without treating user-agent detection as playback support', () => {
    assert.equal(
      detectTvPlatformFromUserAgent('Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36'),
      'Android TV / Google TV',
    );
    assert.equal(
      detectTvPlatformFromUserAgent('Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36'),
      'Samsung Tizen',
    );
    assert.equal(
      detectTvPlatformFromUserAgent('Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36'),
      'LG webOS',
    );
    assert.equal(
      detectTvPlatformFromUserAgent('Mozilla/5.0 (Linux; Android 9; AFTMM) AppleWebKit/537.36'),
      'Fire TV',
    );
    assert.equal(detectTvPlatformFromUserAgent('Mozilla/5.0 (X11; Linux x86_64)'), 'Unidentified TV browser');

    assert.equal(canReceiveTvWebRtc({ hasPeerConnection: true, hasMediaStreamPlayback: true }), true);
    assert.equal(canReceiveTvWebRtc({ hasPeerConnection: false, hasMediaStreamPlayback: true }), false);
    assert.equal(canReceiveTvWebRtc({ hasPeerConnection: true, hasMediaStreamPlayback: false }), false);
  });

  test('detects iPhone, iPad (including desktop-UA iPadOS), Android Phone, Android Tablet, Windows Edge, and macOS Safari/Chrome', () => {
    const iphoneSafariUa =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const iphonePlatform = detectDevicePlatformFrom(iphoneSafariUa, 'iPhone', 5);
    assert.equal(iphonePlatform, 'iOS');
    assert.equal(detectBrowserNameFrom(iphoneSafariUa), 'Safari');
    assert.equal(detectDeviceFormFactorFrom(iphoneSafariUa, iphonePlatform, 5, 390), 'phone');

    const iphoneChromeUa =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1';
    const iphoneChromePlatform = detectDevicePlatformFrom(iphoneChromeUa, 'iPhone', 5);
    assert.equal(iphoneChromePlatform, 'iOS');
    assert.equal(detectBrowserNameFrom(iphoneChromeUa), 'Chrome');
    assert.equal(detectDeviceFormFactorFrom(iphoneChromeUa, iphoneChromePlatform, 5, 393), 'phone');

    // Modern iPadOS reports Macintosh + MacIntel platform with multi-touch support
    const ipadDesktopUa =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const ipadPlatform = detectDevicePlatformFrom(ipadDesktopUa, 'MacIntel', 5);
    assert.equal(ipadPlatform, 'iPadOS');
    assert.equal(detectBrowserNameFrom(ipadDesktopUa), 'Safari');
    assert.equal(detectDeviceFormFactorFrom(ipadDesktopUa, ipadPlatform, 5, 820), 'tablet');

    const androidPhoneUa =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Mobile Safari/537.36';
    const androidPhonePlatform = detectDevicePlatformFrom(androidPhoneUa, 'Linux armv8l', 5);
    assert.equal(androidPhonePlatform, 'Android');
    assert.equal(detectBrowserNameFrom(androidPhoneUa), 'Chrome');
    assert.equal(detectDeviceFormFactorFrom(androidPhoneUa, androidPhonePlatform, 5, 412), 'phone');

    const androidTabletUa =
      'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Safari/537.36';
    const androidTabletPlatform = detectDevicePlatformFrom(androidTabletUa, 'Linux aarch64', 5);
    assert.equal(androidTabletPlatform, 'Android');
    assert.equal(detectBrowserNameFrom(androidTabletUa), 'Chrome');
    assert.equal(detectDeviceFormFactorFrom(androidTabletUa, androidTabletPlatform, 5, 800), 'tablet');

    const windowsEdgeUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';
    const winPlatform = detectDevicePlatformFrom(windowsEdgeUa, 'Win32', 0);
    assert.equal(winPlatform, 'Windows');
    assert.equal(detectBrowserNameFrom(windowsEdgeUa), 'Edge');
    assert.equal(detectDeviceFormFactorFrom(windowsEdgeUa, winPlatform, 0, 1080), 'desktop');

    const macChromeUa =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    const macPlatform = detectDevicePlatformFrom(macChromeUa, 'MacIntel', 0);
    assert.equal(macPlatform, 'macOS');
    assert.equal(detectBrowserNameFrom(macChromeUa), 'Chrome');
    assert.equal(detectDeviceFormFactorFrom(macChromeUa, macPlatform, 0, 900), 'desktop');
  });

  test('computes mobile-optimized 720p @ 30fps capture presets and honest browser/OS screen capture support', () => {
    assert.deepEqual(resolveCaptureDimensions('720p', false), { width: 1280, height: 720 });
    assert.deepEqual(resolveCaptureDimensions('720p', true), { width: 720, height: 1280 });

    const mobilePreset = computeDefaultCapturePreset(true);
    assert.deepEqual(mobilePreset, {
      resolutionId: '720p',
      frameRate: 30,
      qualityMode: 'auto',
    });

    const desktopPreset = computeDefaultCapturePreset(false);
    assert.deepEqual(desktopPreset, {
      resolutionId: '1080p',
      frameRate: 60,
      qualityMode: 'auto',
    });

    // API detection enables Android capture; it does not certify playback/capture on a physical model.
    const androidChromeSupport = getScreenCaptureSupport('Android', 'Chrome', true, true, true);
    assert.equal(androidChromeSupport.supported, true);
    assert.equal(androidChromeSupport.isMobileOrTablet, true);
    assert.match(androidChromeSupport.guidance || '', /720p @ 30 fps/i);

    const androidBrowserWithoutCapture = getScreenCaptureSupport(
      'Android',
      'Samsung Internet',
      true,
      false,
    );
    assert.equal(androidBrowserWithoutCapture.supported, false);
    assert.match(androidBrowserWithoutCapture.reason || '', /getDisplayMedia/i);

    const androidAudio = getAudioSharingSupport('Android', 'Chrome');
    assert.equal(androidAudio.systemAudioSupported, false);
    assert.equal(androidAudio.tabAudioSupported, false);
    assert.match(androidAudio.summary, /live audio track/i);

    // iOS Safari / iPadOS Safari without getDisplayMedia clearly explains WebKit restriction + Receiver option
    const iosSafariSupport = getScreenCaptureSupport('iOS', 'Safari', true, false, false);
    assert.equal(iosSafariSupport.supported, false);
    assert.equal(iosSafariSupport.isMobileOrTablet, true);
    assert.match(iosSafariSupport.reason || '', /iOS restricts web browsers/i);
    assert.match(iosSafariSupport.guidance || '', /Receiver Display/i);

    const ipadSafariSupport = getScreenCaptureSupport('iPadOS', 'Safari', true, false, false);
    assert.equal(ipadSafariSupport.supported, false);
    assert.match(ipadSafariSupport.reason || '', /iPadOS restricts web browsers/i);

    // Insecure HTTP context blocks capture cleanly and highlights Receiver Display compatibility
    const insecureSupport = getScreenCaptureSupport('Android', 'Chrome', false, false, false);
    assert.equal(insecureSupport.supported, false);
    assert.equal(insecureSupport.secureContext, false);
    assert.match(insecureSupport.reason || '', /HTTPS/i);
    assert.match(insecureSupport.guidance || '', /Receiver Display/i);

    const iosAudio = getAudioSharingSupport('iOS', 'Safari');
    assert.equal(iosAudio.tabAudioSupported, false);
    assert.equal(iosAudio.systemAudioSupported, false);
    assert.match(iosAudio.summary, /listen to audio/i);
  });

  test('enforces 10-device capacity identically across iOS, iPadOS, Android, Windows, and macOS clients (including QR links)', async () => {
    activeHarness = await createMobileHarness();
    const hostSocket = await activeHarness.connectClient();
    const created = activeHarness.roomService.createRoom(
      {
        socketId: hostSocket.id!,
        deviceId: 'android-host-1',
        deviceName: 'Android Phone · Chrome Source',
        platform: 'Android',
        browser: 'Chrome',
      },
      '7391',
    );
    assert.equal(created.ok, true);
    if (!created.ok) throw new Error('Expected host room creation');

    const code = created.snapshot.code;
    assert.equal(created.snapshot.broadcaster.platform, 'Android');

    const inviteUrl = buildReceiverJoinUrl(code);
    const parsedQr = parseQrJoinPayload(inviteUrl);
    assert.ok(parsedQr);
    assert.equal(parsedQr.code, code);

    const mixedReceivers: Array<{
      deviceId: string;
      deviceName: string;
      platform: 'iOS' | 'iPadOS' | 'Android' | 'Windows' | 'macOS';
      browser: string;
    }> = [
      { deviceId: 'rx-iphone-1', deviceName: 'iPhone · Safari Display', platform: 'iOS', browser: 'Safari' },
      { deviceId: 'rx-ipad-2', deviceName: 'iPad · Safari Display', platform: 'iPadOS', browser: 'Safari' },
      { deviceId: 'rx-android-3', deviceName: 'Android Phone · Chrome Display', platform: 'Android', browser: 'Chrome' },
      { deviceId: 'rx-android-tab-4', deviceName: 'Android Tablet · Samsung Internet Display', platform: 'Android', browser: 'Samsung Internet' },
      { deviceId: 'rx-iphone-chrome-5', deviceName: 'iPhone · Chrome Display', platform: 'iOS', browser: 'Chrome' },
      { deviceId: 'rx-windows-6', deviceName: 'Windows PC · Edge Display', platform: 'Windows', browser: 'Edge' },
      { deviceId: 'rx-mac-7', deviceName: 'Mac · Safari Display', platform: 'macOS', browser: 'Safari' },
      { deviceId: 'rx-ipad-8', deviceName: 'iPad Pro · Safari Display', platform: 'iPadOS', browser: 'Safari' },
      { deviceId: 'rx-android-9', deviceName: 'Android Phone · Firefox Display', platform: 'Android', browser: 'Firefox' },
    ];

    const connectedSockets: TestClientSocket[] = [];
    for (let idx = 0; idx < mixedReceivers.length; idx += 1) {
      const sock = await activeHarness.connectClient();
      connectedSockets.push(sock);
      const spec = mixedReceivers[idx];
      const ack = await emitJoin(sock, {
        code: parsedQr.code,
        pin: '7391',
        ...spec,
      });
      assert.equal(ack.ok, true, `Mobile/desktop receiver #${idx + 1} (${spec.platform}) should be accepted`);
      if (ack.ok) {
        assert.equal(ack.session.receivers.length, idx + 1);
        assert.equal(ack.session.totalDevices, idx + 2);
      }
    }

    const fullSnapshot = activeHarness.roomService.getRoomSnapshot(code);
    assert.ok(fullSnapshot);
    assert.equal(fullSnapshot.totalDevices, 10);
    assert.ok(fullSnapshot.receivers.some((r) => r.platform === 'iOS'));
    assert.ok(fullSnapshot.receivers.some((r) => r.platform === 'iPadOS'));
    assert.ok(fullSnapshot.receivers.some((r) => r.platform === 'Android'));

    // 10th receiver (Android via QR invite link) must be rejected with ROOM_FULL
    const tenthMobile = await activeHarness.connectClient();
    const rejectedAck = await emitJoin(tenthMobile, {
      code: parsedQr.code,
      pin: '7391',
      deviceId: 'rx-overflow-iphone-10',
      deviceName: 'iPhone · Safari Display 10',
      platform: 'iOS',
      browser: 'Safari',
    });
    assert.equal(rejectedAck.ok, false);
    if (!rejectedAck.ok) {
      assert.equal(rejectedAck.errorCode, 'ROOM_FULL');
    }

    // Disconnecting 1 iOS receiver releases its slot for the waiting device
    connectedSockets[0].disconnect();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const admittedAfterLeave = await emitJoin(tenthMobile, {
      code: parsedQr.code,
      pin: '7391',
      deviceId: 'rx-overflow-iphone-10',
      deviceName: 'iPhone · Safari Display 10',
      platform: 'iOS',
      browser: 'Safari',
    });
    assert.equal(admittedAfterLeave.ok, true);
    if (admittedAfterLeave.ok) {
      assert.equal(admittedAfterLeave.session.totalDevices, 10);
      assert.equal(admittedAfterLeave.session.receivers.length, 9);
    }
  });
});
