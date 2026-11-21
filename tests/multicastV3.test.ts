import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { RoomAuthService } from '../server/auth/roomAuth.ts';
import { initServerConfig } from '../server/config/env.ts';
import { createApiRouter } from '../server/routes/healthRoutes.ts';
import { RoomService } from '../server/services/roomService.ts';
import { registerRoomSocketHandlers } from '../server/socket/roomSocketHandlers.ts';
import {
  computeHonestResolutionCeiling,
  createInitialAdaptiveTracker,
  evaluateAdaptiveTransition,
  resolveQualityProfile,
} from '../src/services/streaming/adaptiveQuality.ts';
import {
  clampAudioVolume,
  resolveAudioStatusSnapshot,
} from '../src/services/streaming/audioState.ts';
import type {
  ClientToServerEvents,
  CreateSessionAck,
  GetAnalyticsAck,
  JoinSessionAck,
  ServerToClientEvents,
  ToggleRoomLockAck,
} from '../src/types/signaling.ts';
import { buildReceiverJoinUrl, parseQrJoinPayload } from '../src/utils/platform.ts';

function createConfiguredService(maxReceiversEnv = '9'): {
  service: RoomService;
  restoreEnv: () => void;
} {
  const prevMax = process.env.MAX_RECEIVERS_PER_ROOM;
  const prevSecret = process.env.ROOM_AUTH_SECRET;
  process.env.MAX_RECEIVERS_PER_ROOM = maxReceiversEnv;
  process.env.ROOM_AUTH_SECRET = 'test_multicast_secret_at_least_32_characters_long';
  initServerConfig();

  const authService = new RoomAuthService();
  const service = new RoomService(authService);

  return {
    service,
    restoreEnv: () => {
      service.stopExpirationSweep();
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
    },
  };
}

describe('MultiCast V3 Room Capacity, Locking, Reconnect & Host Authorization', () => {
  test('1. enforces 10-device limit per room (1 source + 9 receivers) and caps excess env config', () => {
    const { service, restoreEnv } = createConfiguredService('25');
    try {
      const stats = service.getStats();
      assert.equal(stats.maxReceiversPerRoom, 9);
      assert.equal(stats.maxTotalDevicesPerRoom, 10);

      const created = service.createRoom(
        {
          socketId: 'src-1',
          deviceId: 'source-dev-1',
          deviceName: 'Host MacBook',
          platform: 'macOS',
          browser: 'Chrome',
        },
        '4821',
      );
      assert.equal(created.ok, true);
      if (!created.ok) return;

      assert.equal(created.snapshot.totalDevices, 1);
      assert.equal(created.snapshot.maxTotalDevices, 10);
      assert.equal(created.snapshot.maxReceivers, 9);

      for (let i = 1; i <= 9; i += 1) {
        const joined = service.joinReceiver({
          socketId: `rx-${i}`,
          code: created.snapshot.code,
          pin: '4821',
          deviceId: `rx-device-${i}`,
          deviceName: `Display ${i}`,
          platform: 'Windows',
          browser: 'Edge',
        });
        assert.equal(joined.ok, true, `Receiver ${i} should be admitted`);
        if (joined.ok) {
          assert.equal(joined.snapshot.totalDevices, i + 1);
        }
      }

      const overflow = service.joinReceiver({
        socketId: 'rx-10',
        code: created.snapshot.code,
        pin: '4821',
        deviceId: 'rx-device-10',
        deviceName: 'Display 10',
        platform: 'Linux',
        browser: 'Chrome',
      });
      assert.equal(overflow.ok, false);
      if (!overflow.ok) {
        assert.equal(overflow.errorCode, 'ROOM_FULL');
      }
    } finally {
      restoreEnv();
    }
  });

  test('2. supports host removal freeing slots, room locking/unlocking, and blocks unauthorized receivers', () => {
    const { service, restoreEnv } = createConfiguredService('9');
    try {
      const created = service.createRoom(
        {
          socketId: 'src-lock',
          deviceId: 'source-lock',
          deviceName: 'Presenter PC',
          platform: 'Windows',
          browser: 'Chrome',
        },
        '7711',
      );
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const code = created.snapshot.code;

      for (let i = 1; i <= 9; i += 1) {
        const res = service.joinReceiver({
          socketId: `rx-${i}`,
          code,
          pin: '7711',
          deviceId: `dev-${i}`,
          deviceName: `Screen ${i}`,
          platform: 'macOS',
          browser: 'Safari',
        });
        assert.equal(res.ok, true);
      }

      // Receiver cannot kick or lock
      const unauthKick = service.kickReceiver('rx-1', code, 'rx-2');
      assert.equal(unauthKick.ok, false);
      if (!unauthKick.ok) assert.equal(unauthKick.errorCode, 'UNAUTHORIZED');

      const unauthLock = service.toggleRoomLock('rx-1', code, true);
      assert.equal(unauthLock.ok, false);
      if (!unauthLock.ok) assert.equal(unauthLock.errorCode, 'UNAUTHORIZED');

      // Host removes rx-3, freeing a device slot
      const kicked = service.kickReceiver('src-lock', code, 'rx-3');
      assert.equal(kicked.ok, true);
      if (kicked.ok) {
        assert.equal(kicked.snapshot.receivers.length, 8);
        assert.equal(kicked.snapshot.totalDevices, 9);
      }

      // Host locks room; new receiver with valid PIN must be blocked with ROOM_LOCKED
      const locked = service.toggleRoomLock('src-lock', code, true);
      assert.equal(locked.ok, true);
      if (locked.ok) {
        assert.equal(locked.snapshot.locked, true);
      }

      const blockedJoin = service.joinReceiver({
        socketId: 'rx-new-locked',
        code,
        pin: '7711',
        deviceId: 'dev-new-1',
        deviceName: 'Late Joiner',
        platform: 'Windows',
        browser: 'Chrome',
      });
      assert.equal(blockedJoin.ok, false);
      if (!blockedJoin.ok) {
        assert.equal(blockedJoin.errorCode, 'ROOM_LOCKED');
      }

      // Host unlocks room; new joiner can now occupy the freed slot
      const unlocked = service.toggleRoomLock('src-lock', code, false);
      assert.equal(unlocked.ok, true);
      if (unlocked.ok) {
        assert.equal(unlocked.snapshot.locked, false);
      }

      const allowedJoin = service.joinReceiver({
        socketId: 'rx-new-open',
        code,
        pin: '7711',
        deviceId: 'dev-new-1',
        deviceName: 'Late Joiner',
        platform: 'Windows',
        browser: 'Chrome',
      });
      assert.equal(allowedJoin.ok, true);
      if (allowedJoin.ok) {
        assert.equal(allowedJoin.snapshot.totalDevices, 10);
      }
    } finally {
      restoreEnv();
    }
  });

  test('3. receiver reconnection deduplicates same deviceId without consuming extra slots and updates analytics', () => {
    const { service, restoreEnv } = createConfiguredService('9');
    try {
      const created = service.createRoom(
        {
          socketId: 'src-rec',
          deviceId: 'host-rec',
          deviceName: 'Host',
          platform: 'macOS',
          browser: 'Chrome',
        },
        '3399',
      );
      assert.equal(created.ok, true);
      if (!created.ok) return;
      const code = created.snapshot.code;

      const firstJoin = service.joinReceiver({
        socketId: 'rx-old',
        code,
        pin: '3399',
        deviceId: 'same-display-id',
        deviceName: 'Auditorium Display',
        platform: 'Windows',
        browser: 'Chrome',
      });
      assert.equal(firstJoin.ok, true);
      if (!firstJoin.ok) return;
      assert.equal(firstJoin.snapshot.receivers.length, 1);

      // Rejoin with same deviceId -> replaces prior socket, still 1 receiver / 2 total devices
      const duplicateDeviceRejoin = service.joinReceiver({
        socketId: 'rx-replacement',
        code,
        pin: '3399',
        deviceId: 'same-display-id',
        deviceName: 'Auditorium Display',
        platform: 'Windows',
        browser: 'Chrome',
      });
      assert.equal(duplicateDeviceRejoin.ok, true);
      if (!duplicateDeviceRejoin.ok) return;
      assert.equal(duplicateDeviceRejoin.replacedSocketId, 'rx-old');
      assert.equal(duplicateDeviceRejoin.snapshot.receivers.length, 1);
      assert.equal(duplicateDeviceRejoin.snapshot.totalDevices, 2);

      // Simulate transient disconnect + session resume
      service.handleDisconnect('rx-replacement');
      const resumed = service.resumeSession({
        authToken: duplicateDeviceRejoin.authToken,
        socketId: 'rx-resumed',
        deviceId: 'same-display-id',
      });
      assert.equal(resumed.ok, true);
      if (!resumed.ok) return;
      assert.equal(resumed.role, 'receiver');
      assert.equal(resumed.snapshot.receivers.length, 1);
      assert.equal(resumed.snapshot.receivers[0].socketId, 'rx-resumed');

      const analytics = service.getRoomAnalytics('src-rec', code);
      assert.equal(analytics.ok, true);
      if (analytics.ok) {
        assert.equal(analytics.analytics.peakReceivers, 1);
        assert.ok(analytics.analytics.reconnectCount >= 2);
      }
    } finally {
      restoreEnv();
    }
  });
});

describe('MultiCast V3 QR Invitations, Adaptive Quality & Independent Audio States', () => {
  test('4. QR invitation URLs omit PIN/secrets and parser extracts room codes safely', () => {
    const invite = buildReceiverJoinUrl('k7p4m9');
    assert.equal(invite, '/join?code=K7P4M9');
    assert.equal(parseQrJoinPayload(invite)?.code, 'K7P4M9');
    assert.equal(parseQrJoinPayload('https://multicast.app/join?code=ab12cd')?.code, 'AB12CD');
    assert.equal(parseQrJoinPayload('{"code":"xy98zw","pin":"9999"}')?.code, 'XY98ZW');
    assert.equal(parseQrJoinPayload('q4r5t6')?.code, 'Q4R5T6');
    assert.equal(parseQrJoinPayload('invalid-code'), null);
  });

  test('5. adaptive quality respects cooldowns, preserves text resolution first, recovers gradually, and avoids false 1080p claims', () => {
    // Source only captures 720p — must never claim 1080p even on 1080p/High setting
    const ceiling = computeHonestResolutionCeiling({
      requestedResolutionId: '1080p',
      requestedFrameRate: 60,
      sourceWidth: 1280,
      sourceHeight: 720,
      sourceFrameRate: 30,
    });
    assert.equal(ceiling.width, 1280);
    assert.equal(ceiling.height, 720);
    assert.equal(ceiling.fps, 30);

    const portraitCeiling = computeHonestResolutionCeiling({
      requestedResolutionId: '1080p',
      requestedFrameRate: 30,
      sourceWidth: 720,
      sourceHeight: 1280,
      sourceFrameRate: 30,
    });
    assert.equal(portraitCeiling.width, 720);
    assert.equal(portraitCeiling.height, 1280);

    const portraitMedium = resolveQualityProfile({
      mode: 'medium',
      level: 0,
      contentHint: 'detail',
      baseResolutionId: '1080p',
      baseFrameRate: 30,
      sourceWidth: 1080,
      sourceHeight: 1920,
      sourceFrameRate: 30,
    });
    assert.equal(portraitMedium.effectiveWidth, 720);
    assert.equal(portraitMedium.effectiveHeight, 1280);

    let tracker = createInitialAdaptiveTracker(0);

    // 1 poor sample alone must not switch
    let step = evaluateAdaptiveTransition(tracker, {
      rttMs: 220,
      packetsLostDelta: 8,
      now: 10_000,
    });
    assert.equal(step.changed, false);
    tracker = step.nextState;

    // 2nd consecutive poor sample after cooldown -> steps down to level 1
    step = evaluateAdaptiveTransition(tracker, {
      rttMs: 220,
      packetsLostDelta: 8,
      now: 13_000,
    });
    assert.equal(step.changed, true);
    assert.equal(step.nextState.level, 1);
    tracker = step.nextState;

    // Level 1 in 'detail' mode keeps 1.0 resolution scale so text remains sharp
    const detailLevel1 = resolveQualityProfile({
      mode: 'auto',
      level: tracker.level,
      contentHint: 'detail',
      baseResolutionId: '1080p',
      baseFrameRate: 30,
      sourceWidth: 1920,
      sourceHeight: 1080,
      sourceFrameRate: 30,
    });
    assert.equal(detailLevel1.scaleResolutionDownBy, 1.0);
    assert.equal(detailLevel1.degradationPreference, 'maintain-resolution');

    // Cooldown prevents rapid thrashing right after switching
    const blockedInsideCooldown = evaluateAdaptiveTransition(tracker, {
      rttMs: 250,
      packetsLostDelta: 12,
      now: 15_000,
    });
    assert.equal(blockedInsideCooldown.changed, false);

    // Gradual recovery only after 5 consecutive healthy samples and >= 12s upscale cooldown
    for (let i = 1; i <= 4; i += 1) {
      step = evaluateAdaptiveTransition(tracker, {
        rttMs: 20,
        packetsLostDelta: 0,
        jitterMs: 4,
        now: 20_000 + i * 2000,
      });
      assert.equal(step.changed, false);
      tracker = step.nextState;
    }
    step = evaluateAdaptiveTransition(tracker, {
      rttMs: 20,
      packetsLostDelta: 0,
      jitterMs: 4,
      now: 30_000,
    });
    assert.equal(step.changed, true);
    assert.equal(step.nextState.level, 0);

    // Manual Medium preset caps height cleanly at 720p
    const mediumPreset = resolveQualityProfile({
      mode: 'medium',
      level: 0,
      contentHint: 'detail',
      baseResolutionId: '1080p',
      baseFrameRate: 60,
      sourceWidth: 1920,
      sourceHeight: 1080,
      sourceFrameRate: 60,
    });
    assert.equal(mediumPreset.effectiveHeight, 720);
    assert.equal(mediumPreset.maxFramerate, 30);
  });

  test('6. independent audio status reports exact states & keeps video unaffected on unavailability/autoplay block', () => {
    const unavailable = resolveAudioStatusSnapshot({
      role: 'receiver',
      isStreaming: true,
      hasLiveAudioTrack: false,
      streamHasAudio: false,
    });
    assert.equal(unavailable.state, 'unavailable');
    assert.equal(unavailable.label, 'Audio unavailable');
    assert.equal(unavailable.videoUnaffected, true);

    const autoplayBlocked = resolveAudioStatusSnapshot({
      role: 'receiver',
      isStreaming: true,
      hasLiveAudioTrack: true,
      streamHasAudio: true,
      autoplayBlocked: true,
      hasActivePeerAudio: true,
    });
    assert.equal(autoplayBlocked.state, 'permission-required');
    assert.equal(autoplayBlocked.label, 'Permission required');
    assert.equal(autoplayBlocked.controlLabel, 'Enable Audio');
    assert.equal(autoplayBlocked.videoUnaffected, true);

    const muted = resolveAudioStatusSnapshot({
      role: 'receiver',
      isStreaming: true,
      hasLiveAudioTrack: true,
      streamHasAudio: true,
      receiverMuted: true,
    });
    assert.equal(muted.state, 'muted');
    assert.equal(muted.label, 'Audio muted');

    const available = resolveAudioStatusSnapshot({
      role: 'receiver',
      isStreaming: true,
      hasLiveAudioTrack: true,
      streamHasAudio: true,
      hasActivePeerAudio: true,
    });
    assert.equal(available.label, 'Audio available');
    assert.equal(available.canPlay, true);

    assert.equal(clampAudioVolume(-0.4), 0);
    assert.equal(clampAudioVolume(1.8), 1);
    assert.equal(clampAudioVolume(0.45), 0.45);
  });
});

describe('MultiCast V3 Live HTTP + Socket.IO Security & Analytics Isolation', () => {
  let httpServer: http.Server;
  let ioServer: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  let roomService: RoomService;
  let baseUrl: string;
  let restoreEnv: () => void;
  const clientSockets: ClientSocket<ServerToClientEvents, ClientToServerEvents>[] = [];

  before(async () => {
    const setup = createConfiguredService('9');
    roomService = setup.service;
    restoreEnv = setup.restoreEnv;

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(roomService));

    httpServer = http.createServer(app);
    ioServer = new SocketIOServer(httpServer);
    ioServer.on('connection', (socket) => {
      registerRoomSocketHandlers(ioServer, socket, roomService);
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
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
    restoreEnv();
  });

  function connectClient(): Promise<ClientSocket<ServerToClientEvents, ClientToServerEvents>> {
    return new Promise((resolve, reject) => {
      const client: ClientSocket<ServerToClientEvents, ClientToServerEvents> = ioClient(
        baseUrl,
        {
          transports: ['websocket'],
          forceNew: true,
        },
      );
      clientSockets.push(client);
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
  }

  test('7. validates PIN & lock on server, delivers analytics only to host, and rejects unauthorized host events from receivers', async () => {
    const hostSocket = await connectClient();
    const receiverSocket = await connectClient();
    const intruderSocket = await connectClient();

    // Unauthenticated session:create over socket must be rejected without a verified Firebase token
    const unauthCreateAck = await new Promise<CreateSessionAck>((resolve) => {
      intruderSocket.emit(
        'session:create',
        {
          deviceId: 'intruder-1',
          deviceName: 'Unauthorized Source',
          platform: 'Linux',
          browser: 'Chrome',
        },
        resolve,
      );
    });
    assert.equal(unauthCreateAck.ok, false);
    if (!unauthCreateAck.ok) {
      assert.equal(unauthCreateAck.errorCode, 'UNAUTHORIZED');
    }

    // Seed verified room directly for the connected host socket & join its Socket.IO room
    const created = roomService.createRoom(
      {
        socketId: hostSocket.id!,
        deviceId: 'host-socket-dev',
        deviceName: 'Studio Host',
        platform: 'macOS',
        browser: 'Chrome',
        ownerUid: 'uid-host-1',
        ownerName: 'Host',
      },
      '5280',
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const roomCode = created.snapshot.code;
    await ioServer.sockets.sockets.get(hostSocket.id!)?.join(roomCode);

    // Public HTTP room lookup exposes lock & capacity metadata, never PIN or analytics
    const lookupRes = await fetch(`${baseUrl}/api/sessions/${roomCode}`);
    assert.equal(lookupRes.status, 200);
    const lookupJson = (await lookupRes.json()) as Record<string, unknown>;
    assert.equal(lookupJson.exists, true);
    assert.equal(lookupJson.requiresPin, true);
    assert.equal(lookupJson.isLocked, false);
    assert.equal('pin' in lookupJson, false);
    assert.equal('analytics' in lookupJson, false);

    // Wrong PIN over Socket.IO is rejected
    const badPinJoin = await new Promise<JoinSessionAck>((resolve) => {
      receiverSocket.emit(
        'session:join',
        {
          code: roomCode,
          pin: '0000',
          deviceId: 'rx-socket-dev',
          deviceName: 'Client Display',
          platform: 'Windows',
          browser: 'Edge',
        },
        resolve,
      );
    });
    assert.equal(badPinJoin.ok, false);
    if (!badPinJoin.ok) {
      assert.equal(badPinJoin.errorCode, 'INVALID_PIN');
    }

    // Listen for host analytics & receiver analytics isolation
    let receiverGotAnalytics = false;
    receiverSocket.on('session:analytics', () => {
      receiverGotAnalytics = true;
    });

    // Correct PIN succeeds
    const goodJoin = await new Promise<JoinSessionAck>((resolve) => {
      receiverSocket.emit(
        'session:join',
        {
          code: roomCode,
          pin: '5280',
          deviceId: 'rx-socket-dev',
          deviceName: 'Client Display',
          platform: 'Windows',
          browser: 'Edge',
        },
        resolve,
      );
    });
    assert.equal(goodJoin.ok, true);
    if (goodJoin.ok) {
      assert.equal('analytics' in goodJoin, false);
    }

    // Receiver attempting host-only controls & analytics must receive UNAUTHORIZED
    const rxLockAttempt = await new Promise<ToggleRoomLockAck>((resolve) => {
      receiverSocket.emit('session:toggle-lock', { code: roomCode, locked: true }, resolve);
    });
    assert.equal(rxLockAttempt.ok, false);
    if (!rxLockAttempt.ok) assert.equal(rxLockAttempt.errorCode, 'UNAUTHORIZED');

    const rxAnalyticsAttempt = await new Promise<GetAnalyticsAck>((resolve) => {
      receiverSocket.emit('session:get-analytics', { code: roomCode }, resolve);
    });
    assert.equal(rxAnalyticsAttempt.ok, false);
    if (!rxAnalyticsAttempt.ok) assert.equal(rxAnalyticsAttempt.errorCode, 'UNAUTHORIZED');

    // Host records 3 quality samples and fetches analytics -> receiver never sees analytics
    const threeSamplesReceived = new Promise<void>((resolve) => {
      let seen = 0;
      const onAnalytics = (data: { qualitySamplesCount: number }) => {
        seen += 1;
        if (data.qualitySamplesCount >= 3 || seen >= 3) {
          hostSocket.off('session:analytics', onAnalytics);
          resolve();
        }
      };
      hostSocket.on('session:analytics', onAnalytics);
    });
    hostSocket.emit('session:report-quality', { code: roomCode, score: 4 });
    hostSocket.emit('session:report-quality', { code: roomCode, score: 4 });
    hostSocket.emit('session:report-quality', { code: roomCode, score: 3 });
    await threeSamplesReceived;

    const hostAnalyticsAck = await new Promise<GetAnalyticsAck>((resolve) => {
      hostSocket.emit('session:get-analytics', { code: roomCode }, resolve);
    });
    assert.equal(hostAnalyticsAck.ok, true);
    if (hostAnalyticsAck.ok) {
      assert.equal(hostAnalyticsAck.analytics.peakReceivers, 1);
      assert.equal(hostAnalyticsAck.analytics.qualitySamplesCount, 3);
      assert.equal(hostAnalyticsAck.analytics.averageQualityLabel, 'Excellent');
    }

    // Host locks room over Socket.IO -> HTTP lookup reflects isLocked: true
    const hostLockAck = await new Promise<ToggleRoomLockAck>((resolve) => {
      hostSocket.emit('session:toggle-lock', { code: roomCode, locked: true }, resolve);
    });
    assert.equal(hostLockAck.ok, true);
    if (hostLockAck.ok) assert.equal(hostLockAck.locked, true);

    const lockedLookup = (await (
      await fetch(`${baseUrl}/api/sessions/${roomCode}`)
    ).json()) as Record<string, unknown>;
    assert.equal(lockedLookup.isLocked, true);

    // Host broadcasts pointer highlight -> receiver gets coordinates; receiver pointer attempts are ignored
    const pointerPromise = new Promise<{ active: boolean; x: number; y: number }>((resolve) => {
      receiverSocket.once('presentation:pointer', resolve);
    });
    hostSocket.emit('presentation:pointer', {
      code: roomCode,
      active: true,
      x: 0.42,
      y: 0.68,
    });
    const pointerEvent = await pointerPromise;
    assert.equal(pointerEvent.active, true);
    assert.equal(pointerEvent.x, 0.42);
    assert.equal(pointerEvent.y, 0.68);

    assert.equal(receiverGotAnalytics, false);
  });
});
