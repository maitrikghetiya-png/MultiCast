import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { RoomAuthService } from './server/auth/roomAuth.ts';
import {
  EnvValidationError,
  hasTurnServerConfigured,
  initServerConfig,
} from './server/config/env.ts';
import { corsAllowlistMiddleware } from './server/middleware/cors.ts';
import {
  apiErrorHandler,
  apiNotFoundHandler,
} from './server/middleware/errorHandler.ts';
import { createApiRouter } from './server/routes/healthRoutes.ts';
import { RoomService } from './server/services/roomService.ts';
import { createSocketSignalingServer } from './server/services/socketService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrapServer(): Promise<void> {
  const serverConfig = initServerConfig();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', serverConfig.trustProxy ? 1 : false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
    if (
      serverConfig.isProduction &&
      (req.secure || req.headers['x-forwarded-proto'] === 'https')
    ) {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  const roomAuthService = new RoomAuthService();
  let notifyExpiredCallback: ((event: Parameters<RoomService['sweepAbandonedRooms']>[0] extends never ? never : {
    code: string;
    roomId: string;
    reason: string;
    memberSocketIds: string[];
  }) => void) | null = null;

  const roomService = new RoomService(roomAuthService, (expiredEvent) => {
    notifyExpiredCallback?.(expiredEvent);
  });

  const httpServer = createServer(app);
  const { io, notifyRoomExpired } = createSocketSignalingServer(httpServer, roomService);
  notifyExpiredCallback = notifyRoomExpired;
  roomService.startExpirationSweep();

  app.get('/health', (_req, res) => {
    const stats = roomService.getStats();
    res.status(200).json({
      status: 'ok',
      service: 'multicast',
      environment: serverConfig.nodeEnv,
      uptimeSeconds: Math.floor(process.uptime()),
      activeSessions: stats.activeRooms,
      port: serverConfig.port,
    });
  });

  app.use(
    '/api',
    corsAllowlistMiddleware,
    createApiRouter(roomService),
    apiNotFoundHandler,
    apiErrorHandler,
  );

  let viteDevServer: { close: () => Promise<void> } | null = null;

  if (!serverConfig.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    viteDevServer = vite;
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      app.use(
        express.static(distDir, {
          index: false,
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
              res.setHeader('Cache-Control', 'no-cache');
            } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
          },
        }),
      );
      app.get('*', (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtmlPath);
      });
    } else {
      console.error(
        `[Startup Warning] Production build directory missing at ${distDir}. Run "npm run build" before starting in production.`,
      );
    }
  }

  let isShuttingDown = false;
  const shutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`Received ${signal}; shutting down MultiCast gracefully...`);

    roomService.stopExpirationSweep();

    const forceExitTimer = setTimeout(() => {
      console.warn('Graceful shutdown timed out; forcing remaining connections closed.');
      httpServer.closeAllConnections?.();
      process.exit(0);
    }, 8_000);
    forceExitTimer.unref();

    const finalizeClose = () => {
      io.close(() => {
        httpServer.close(() => {
          clearTimeout(forceExitTimer);
          process.exit(0);
        });
        httpServer.closeIdleConnections?.();
      });
    };

    if (viteDevServer) {
      void viteDevServer.close().finally(finalizeClose);
    } else {
      finalizeClose();
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  httpServer.listen(serverConfig.port, '0.0.0.0', () => {
    console.log(
      `MultiCast server listening on http://0.0.0.0:${serverConfig.port} (${serverConfig.nodeEnv})`,
    );
    console.log(
      serverConfig.corsOrigins.length > 0
        ? `CORS allowlist (${serverConfig.corsOrigins.length}): ${serverConfig.corsOrigins.join(', ')}`
        : 'CORS policy: strict same-origin enforcement (set CORS_ORIGIN or APP_URL to allow additional origins)',
    );
    console.log(
      `ICE servers configured: ${serverConfig.iceServers.length} (TURN ${hasTurnServerConfigured() ? 'enabled' : 'disabled'})`,
    );
    console.log(
      `Room limits: max ${serverConfig.roomSettings.maxTotalDevicesPerRoom} devices (1 source + ${serverConfig.roomSettings.maxReceiversPerRoom} receivers), idle TTL ${Math.round(serverConfig.roomSettings.roomIdleTtlMs / 60000)}m`,
    );
  });
}

bootstrapServer().catch((err: unknown) => {
  if (err instanceof EnvValidationError) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error('Failed to start MultiCast server:', err);
  }
  process.exit(1);
});
