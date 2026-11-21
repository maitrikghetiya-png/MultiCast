import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, test } from 'node:test';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { RoomAuthService } from '../server/auth/roomAuth.ts';
import { initServerConfig } from '../server/config/env.ts';
import { createApiRouter } from '../server/routes/healthRoutes.ts';
import { RoomService } from '../server/services/roomService.ts';
import { registerRoomSocketHandlers } from '../server/socket/roomSocketHandlers.ts';
import type {
  ClientToServerEvents,
  JoinSessionAck,
  ResumeSessionAck,
  ServerToClientEvents,
  SessionSnapshot,
  ToggleRoomLockAck,
} from '../src/types/signaling.ts';
import { buildReceiverJoinUrl, parseQrJoinPayload } from '../src/utils/platform.ts';

type TestClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

interface TestHarness {
  httpServer: http.Server;
  ioServer: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  roomService: RoomService;
  baseUrl: string;
  connectClient: () => Promise<TestClientSocket>;
  cleanup: () => Promise<void>;
}

async function createTestHarness(maxReceiversEnv = '9'): Promise<TestHarness> {
  const prevMax = process.env.MAX_RECEIVERS_PER_ROOM;
  const prevSecret = process.env.ROOM_AUTH_SECRET;
  process.env.MAX_RECEIVERS_PER_ROOM = maxReceiversEnv;
  process.env.ROOM_AUTH_SECRET = 'test_capacity_enforcement_secret_at_least_32_chars';
  initServerConfig();

  const authService = new RoomAuthService();
  const roomService = new RoomService(authService);
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(roomService));

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
    baseUrl,
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

function emitResume(
  socket: TestClientSocket,
  payload: { authToken: string; deviceId?: string; deviceName?: string },
): Promise<ResumeSessionAck> {
  return new Promise((resolve) => {
    socket.emit('session:resume', payload, resolve);
  });
}

async function seedHostRoom(
  harness: TestHarness,
  pin = '6420',
): Promise<{
  hostSocket: TestClientSocket;
  code: string;
  sourceAuthToken: string;
}> {
  const hostSocket = await harness.connectClient();
  const created = harness.roomService.createRoom(
    {
      socketId: hostSocket.id!,
      deviceId: 'host-primary-device',
      deviceName: 'Presenter MacBook Pro',
      platform: 'macOS',
      browser: 'Chrome',
      ownerUid: 'host-uid-1',
      ownerName: 'Host',
    },
    pin,
  );
  assert.equal(created.ok, true);
  if (!created.ok) {
    throw new Error('Failed to seed host room');
  }
  const serverSocket = harness.ioServer.sockets.sockets.get(hostSocket.id!);
  assert.ok(serverSocket, 'Host server socket should exist');
  await serverSocket.join(created.snapshot.code);
  return {
    hostSocket,
    code: created.snapshot.code,
    sourceAuthToken: created.authToken,
  };
}

describe('Server-Side 10-Device Room Capacity Enforcement', () => {
  let activeHarness: TestHarness | null = null;

  afterEach(async () => {
    if (activeHarness) {
      await activeHarness.cleanup();
      activeHarness = null;
    }
  });

  test('normalizes legacy or oversized MAX_RECEIVERS_PER_ROOM env overrides to 9 receivers (10 total devices)', async () => {
    activeHarness = await createTestHarness('4');
    const healthRes = await fetch(`${activeHarness.baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = (await healthRes.json()) as {
      maxReceiversPerRoom: number;
      maxTotalDevicesPerRoom: number;
    };
    assert.equal(health.maxReceiversPerRoom, 9);
    assert.equal(health.maxTotalDevicesPerRoom, 10);
  });

  test('sequentially accepts Receiver 1-9 and rejects Receiver 10 with ROOM_FULL', async () => {
    activeHarness = await createTestHarness('9');
    const { hostSocket, code } = await seedHostRoom(activeHarness, '4192');

    const hostStates: SessionSnapshot[] = [];
    hostSocket.on('session:state', (snapshot) => {
      hostStates.push(snapshot);
    });

    for (let i = 1; i <= 9; i += 1) {
      const rx = await activeHarness.connectClient();
      const ack = await emitJoin(rx, {
        code,
        pin: '4192',
        deviceId: `seq-rx-${i}`,
        deviceName: `Display ${i}`,
        platform: 'Windows',
        browser: 'Edge',
      });
      assert.equal(ack.ok, true, `Receiver ${i} should be accepted`);
      if (ack.ok) {
        assert.equal(ack.session.receivers.length, i);
        assert.equal(ack.session.totalDevices, i + 1);
        assert.equal(ack.session.maxTotalDevices, 10);
      }
    }

    const tenthReceiver = await activeHarness.connectClient();
    const tenthAck = await emitJoin(tenthReceiver, {
      code,
      pin: '4192',
      deviceId: 'seq-rx-10',
      deviceName: 'Display 10',
      platform: 'macOS',
      browser: 'Safari',
    });
    assert.equal(tenthAck.ok, false, '10th receiver must be rejected');
    if (!tenthAck.ok) {
      assert.equal(tenthAck.errorCode, 'ROOM_FULL');
      assert.match(tenthAck.error, /10 total devices/i);
    }

    const finalSnapshot = activeHarness.roomService.getRoomSnapshot(code);
    assert.ok(finalSnapshot);
    assert.equal(finalSnapshot.receivers.length, 9);
    assert.equal(finalSnapshot.totalDevices, 10);
    assert.ok(
      hostStates.some((s) => s.receivers.length === 9 && s.totalDevices === 10),
      'Host must receive updated state reaching 10 total devices',
    );
  });

  test('concurrent Socket.IO join burst (18 simultaneous clients) never exceeds 10 total devices', async () => {
    activeHarness = await createTestHarness('9');
    const { hostSocket, code } = await seedHostRoom(activeHarness, '8821');

    let latestHostSnapshot: SessionSnapshot | null = null;
    hostSocket.on('session:state', (snapshot) => {
      latestHostSnapshot = snapshot;
    });

    const contenderSockets = await Promise.all(
      Array.from({ length: 18 }, () => activeHarness!.connectClient()),
    );

    const rejectedSocketsStateEvents: SessionSnapshot[] = [];

    const results = await Promise.all(
      contenderSockets.map((sock, idx) =>
        emitJoin(sock, {
          code,
          pin: '8821',
          deviceId: `concurrent-dev-${idx + 1}`,
          deviceName: `Concurrent Receiver ${idx + 1}`,
          platform: 'Windows',
          browser: 'Chrome',
        }).then((ack) => ({ sock, ack })),
      ),
    );

    const accepted = results.filter((entry) => entry.ack.ok);
    const rejected = results.filter((entry) => !entry.ack.ok);

    assert.equal(accepted.length, 9, 'Exactly 9 concurrent receivers must be accepted');
    assert.equal(rejected.length, 9, 'Remaining 9 concurrent receivers must be rejected');

    for (const entry of rejected) {
      assert.equal(entry.ack.ok, false);
      if (!entry.ack.ok) {
        assert.equal(entry.ack.errorCode, 'ROOM_FULL');
      }
      entry.sock.on('session:state', (s) => rejectedSocketsStateEvents.push(s));
    }

    const authoritativeSnapshot = activeHarness.roomService.getRoomSnapshot(code);
    assert.ok(authoritativeSnapshot);
    assert.equal(authoritativeSnapshot.receivers.length, 9);
    assert.equal(authoritativeSnapshot.totalDevices, 10);

    // Trigger a room state broadcast (lock/unlock) and verify rejected sockets never receive room broadcasts
    await new Promise<ToggleRoomLockAck>((resolve) => {
      hostSocket.emit('session:toggle-lock', { code, locked: false }, resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(
      rejectedSocketsStateEvents.length,
      0,
      'Rejected ROOM_FULL sockets must not receive room session:state broadcasts',
    );
    assert.ok(latestHostSnapshot);
    assert.equal((latestHostSnapshot as SessionSnapshot).totalDevices, 10);
    assert.equal((latestHostSnapshot as SessionSnapshot).receivers.length, 9);
  });

  test('ignores forged frontend counts/roles, blocks host self-join, and enforces single active source', async () => {
    activeHarness = await createTestHarness('9');
    const { hostSocket, code, sourceAuthToken } = await seedHostRoom(activeHarness, '5501');

    // Host socket cannot join its own room as a receiver
    const hostSelfJoin = await emitJoin(hostSocket, {
      code,
      pin: '5501',
      deviceId: 'host-primary-device',
      deviceName: 'Host Pretending Receiver',
      platform: 'macOS',
      browser: 'Chrome',
    });
    assert.equal(hostSelfJoin.ok, false);
    if (!hostSelfJoin.ok) {
      assert.equal(hostSelfJoin.errorCode, 'ROLE_CONFLICT');
    }

    // Client passing forged role/count overrides cannot alter server limit or gain source privileges
    const forgedClient = await activeHarness.connectClient();
    const forgedJoin = await emitJoin(forgedClient, {
      code,
      pin: '5501',
      deviceId: 'forged-rx-1',
      deviceName: 'Forged Receiver',
      platform: 'Linux',
      browser: 'Chrome',
      role: 'source',
      totalDevices: 1,
      maxReceivers: 99,
      maxTotalDevices: 100,
    });
    assert.equal(forgedJoin.ok, true);
    if (forgedJoin.ok) {
      assert.equal(forgedJoin.session.maxReceivers, 9);
      assert.equal(forgedJoin.session.maxTotalDevices, 10);
      assert.equal(forgedJoin.session.totalDevices, 2);
      assert.equal(forgedJoin.session.broadcaster.socketId, hostSocket.id);
    }

    // Forged client must still be rejected on host-only operations
    const lockAttempt = await new Promise<ToggleRoomLockAck>((resolve) => {
      forgedClient.emit('session:toggle-lock', { code, locked: true }, resolve);
    });
    assert.equal(lockAttempt.ok, false);
    if (!lockAttempt.ok) {
      assert.equal(lockAttempt.errorCode, 'UNAUTHORIZED');
    }

    // Only one active source is allowed: resuming source from a new socket supersedes old source socket
    const replacementSource = await activeHarness.connectClient();
    const oldSourceClosed = new Promise<{ reason: string }>((resolve) => {
      hostSocket.once('session:closed', resolve);
    });

    const resumedSource = await emitResume(replacementSource, {
      authToken: sourceAuthToken,
      deviceId: 'host-primary-device',
      deviceName: 'Presenter MacBook Pro (Reconnected)',
    });
    assert.equal(resumedSource.ok, true);
    if (resumedSource.ok) {
      assert.equal(resumedSource.session.broadcaster.socketId, replacementSource.id);
      assert.equal(resumedSource.session.totalDevices, 2); // still 1 source + 1 receiver
    }

    const closedNotice = await oldSourceClosed;
    assert.match(closedNotice.reason, /resumed/i);

    // Superseded source socket can no longer mutate room state
    const staleHostLock = await new Promise<ToggleRoomLockAck>((resolve) => {
      hostSocket.emit('session:toggle-lock', { code, locked: true }, resolve);
    });
    assert.equal(staleHostLock.ok, false);
    if (!staleHostLock.ok) {
      assert.equal(staleHostLock.errorCode, 'UNAUTHORIZED');
    }
  });

  test('deduplicates duplicate sockets, preserves reconnect slot at 10/10, releases slots on disconnect/kick, broadcasts updates, and enforces QR/invite parity', async () => {
    activeHarness = await createTestHarness('9');
    const { hostSocket, code } = await seedHostRoom(activeHarness, '9042');

    const authorizedReceivers: Array<{ socket: TestClientSocket; authToken: string; deviceId: string }> = [];
    for (let i = 1; i <= 9; i += 1) {
      const sock = await activeHarness.connectClient();
      const deviceId = `rx-slot-${i}`;
      const ack = await emitJoin(sock, {
        code,
        pin: '9042',
        deviceId,
        deviceName: `Screen ${i}`,
        platform: 'Windows',
        browser: 'Chrome',
      });
      assert.equal(ack.ok, true);
      if (ack.ok) {
        authorizedReceivers.push({ socket: sock, authToken: ack.authToken, deviceId });
      }
    }

    // Same physical/browser deviceId opening a duplicate Socket.IO connection replaces its own slot without exceeding 10/10
    const oldTarget2 = authorizedReceivers[1];
    const replacedClosed = new Promise<{ reason: string }>((resolve) => {
      oldTarget2.socket.once('session:closed', resolve);
    });
    const duplicateTabSocket = await activeHarness.connectClient();
    const dedupAck = await emitJoin(duplicateTabSocket, {
      code,
      pin: '9042',
      deviceId: oldTarget2.deviceId,
      deviceName: 'Screen 2 (New Tab)',
      platform: 'Windows',
      browser: 'Chrome',
    });
    assert.equal(dedupAck.ok, true);
    if (dedupAck.ok) {
      assert.equal(dedupAck.session.receivers.length, 9);
      assert.equal(dedupAck.session.totalDevices, 10);
      authorizedReceivers[1] = {
        socket: duplicateTabSocket,
        authToken: dedupAck.authToken,
        deviceId: oldTarget2.deviceId,
      };
    }
    await replacedClosed;

    // Resuming an existing authorized receiver while room is at 10/10 does NOT fail with ROOM_FULL or add an extra slot
    const target5 = authorizedReceivers[4];
    const resumedSocket5 = await activeHarness.connectClient();
    const resumeAck5 = await emitResume(resumedSocket5, {
      authToken: target5.authToken,
      deviceId: target5.deviceId,
    });
    assert.equal(resumeAck5.ok, true);
    if (resumeAck5.ok) {
      assert.equal(resumeAck5.session.receivers.length, 9);
      assert.equal(resumeAck5.session.totalDevices, 10);
      authorizedReceivers[4] = {
        socket: resumedSocket5,
        authToken: resumeAck5.authToken,
        deviceId: target5.deviceId,
      };
    }

    // Joining via QR / invitation link URL uses identical server capacity limits and rejects when room is 10/10
    const inviteUrl = buildReceiverJoinUrl(code);
    const parsedQr = parseQrJoinPayload(inviteUrl);
    assert.ok(parsedQr);
    assert.equal(parsedQr.code, code);

    const qrJoiner = await activeHarness.connectClient();
    const qrRejected = await emitJoin(qrJoiner, {
      code: parsedQr.code,
      pin: '9042',
      deviceId: 'qr-invite-joiner',
      deviceName: 'QR Tablet',
      platform: 'macOS',
      browser: 'Safari',
    });
    assert.equal(qrRejected.ok, false);
    if (!qrRejected.ok) {
      assert.equal(qrRejected.errorCode, 'ROOM_FULL');
    }

    // Disconnect receiver #1 and verify host + remaining authorized receiver receive updated 9 total devices count
    const observerSocket = authorizedReceivers[8].socket;
    const disconnectBroadcastHost = new Promise<SessionSnapshot>((resolve) => {
      const handler = (s: SessionSnapshot) => {
        if (s.totalDevices === 9 && s.receivers.length === 8) {
          hostSocket.off('session:state', handler);
          resolve(s);
        }
      };
      hostSocket.on('session:state', handler);
    });
    const disconnectBroadcastPeer = new Promise<SessionSnapshot>((resolve) => {
      const handler = (s: SessionSnapshot) => {
        if (s.totalDevices === 9 && s.receivers.length === 8) {
          observerSocket.off('session:state', handler);
          resolve(s);
        }
      };
      observerSocket.on('session:state', handler);
    });

    authorizedReceivers[0].socket.disconnect();
    const [hostAfterDisconnect, peerAfterDisconnect] = await Promise.all([
      disconnectBroadcastHost,
      disconnectBroadcastPeer,
    ]);
    assert.equal(hostAfterDisconnect.totalDevices, 9);
    assert.equal(peerAfterDisconnect.totalDevices, 9);

    // Host kicks receiver #3 -> drops to 8 total devices (7 receivers) and broadcasts to host + authorized receivers
    const kickBroadcastHost = new Promise<SessionSnapshot>((resolve) => {
      const handler = (s: SessionSnapshot) => {
        if (s.totalDevices === 8 && s.receivers.length === 7) {
          hostSocket.off('session:state', handler);
          resolve(s);
        }
      };
      hostSocket.on('session:state', handler);
    });
    const kickBroadcastPeer = new Promise<SessionSnapshot>((resolve) => {
      const handler = (s: SessionSnapshot) => {
        if (s.totalDevices === 8 && s.receivers.length === 7) {
          observerSocket.off('session:state', handler);
          resolve(s);
        }
      };
      observerSocket.on('session:state', handler);
    });

    const kickedClosed = new Promise<{ reason: string }>((resolve) => {
      authorizedReceivers[2].socket.once('session:closed', resolve);
    });

    hostSocket.emit('session:kick-receiver', {
      code,
      targetSocketId: authorizedReceivers[2].socket.id!,
    });

    const [, hostAfterKick, peerAfterKick] = await Promise.all([
      kickedClosed,
      kickBroadcastHost,
      kickBroadcastPeer,
    ]);
    assert.equal(hostAfterKick.totalDevices, 8);
    assert.equal(peerAfterKick.totalDevices, 8);

    // Freed slots now admit 2 new receivers (including the QR link joiner), and 3rd hits ROOM_FULL
    const qrAdmitted = await emitJoin(qrJoiner, {
      code: parsedQr.code,
      pin: '9042',
      deviceId: 'qr-invite-joiner',
      deviceName: 'QR Tablet',
      platform: 'macOS',
      browser: 'Safari',
    });
    assert.equal(qrAdmitted.ok, true);
    if (qrAdmitted.ok) {
      assert.equal(qrAdmitted.session.totalDevices, 9);
    }

    const inviteSlot9 = await activeHarness.connectClient();
    const inviteAdmitted = await emitJoin(inviteSlot9, {
      code: parsedQr.code,
      pin: '9042',
      deviceId: 'invite-slot-9',
      deviceName: 'Invite Laptop',
      platform: 'Windows',
      browser: 'Edge',
    });
    assert.equal(inviteAdmitted.ok, true);
    if (inviteAdmitted.ok) {
      assert.equal(inviteAdmitted.session.totalDevices, 10);
      assert.equal(inviteAdmitted.session.receivers.length, 9);
    }

    const extraAfterRefill = await activeHarness.connectClient();
    const extraRejected = await emitJoin(extraAfterRefill, {
      code: parsedQr.code,
      pin: '9042',
      deviceId: 'invite-overflow-10',
      deviceName: 'Overflow Laptop',
      platform: 'Linux',
      browser: 'Chrome',
    });
    assert.equal(extraRejected.ok, false);
    if (!extraRejected.ok) {
      assert.equal(extraRejected.errorCode, 'ROOM_FULL');
    }
  });
});
