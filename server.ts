import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { logSystem } from './server/db.ts';
import { createApiRouter } from './server/routes.ts';
import { attachOptionalOperator } from './server/security.ts';
import { wsHub } from './server/wsHub.ts';

dotenv.config();

async function bootstrap(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS origin not allowed'));
        }
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '15mb' }));
  app.use(attachOptionalOperator);

  app.use('/api', createApiRouter());

  // Structured JSON error handler (never exposes raw stack traces)
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logSystem('ERROR', 'Express', err.message || 'Unhandled server error');
    console.error('[Server Error]', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  const server = http.createServer(app);

  server.on('upgrade', (req, socket, head) => {
    const handled = wsHub.handleUpgrade(req, socket, head);
    if (!handled) {
      // Allow Vite HMR websocket upgrades in dev if needed, otherwise ignore
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname.startsWith('/ws/')) {
        socket.destroy();
      }
    }
  });

  const distPath = path.resolve(process.cwd(), 'dist');
  const isProd =
    process.env.NODE_ENV === 'production' ||
    (process.env.npm_lifecycle_event === 'start' && fs.existsSync(path.join(distPath, 'index.html')));

  if (isProd) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(port, '0.0.0.0', () => {
    logSystem('INFO', 'Server', `VisionGuard application server listening on port ${port}`);
    console.log(`VisionGuard server listening at http://0.0.0.0:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start VisionGuard server:', err);
  process.exit(1);
});
