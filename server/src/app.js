import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler } from './utils/errors.js';
import authRoutes from './routes/auth.js';
import conversationRoutes from './routes/conversations.js';
import notificationRoutes from './routes/notifications.js';
import postRoutes from './routes/posts.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  // We run behind a reverse proxy (Caddy): trust it so rate limiting sees real client IPs. See TRUST_PROXY.
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Uploaded images are served by this app and displayed by the SPA on the same origin.
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Same policy Caddy sends for the static site, so single-service mode is equally locked down.
      // blob: is needed for the image preview in the post composer.
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'img-src': ["'self'", 'data:', 'blob:'],
          'upgrade-insecure-requests': null, // TLS is terminated by the proxy/platform; breaks plain-http localhost use
        },
      },
    }),
  );
  if (config.clientOrigins.length) {
    app.use(cors({ origin: config.clientOrigins, credentials: true }));
  }
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  app.use(
    '/uploads',
    express.static(config.uploadsDir, {
      index: false,
      dotfiles: 'deny',
      maxAge: '30d',
      immutable: true, // filenames are random and never reused
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  );

  const limiter = (windowMs, max) =>
    rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => config.isTest || config.rateLimitDisabled });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', limiter(60_000, 300));
  app.use('/api/auth/login', limiter(15 * 60_000, 20));
  app.use('/api/auth/register', limiter(60 * 60_000, 10));
  // Anything that can send an email or burn a token is tightly limited (email-bombing / token guessing).
  app.use('/api/auth/forgot-password', limiter(60 * 60_000, 5));
  app.use('/api/auth/reset-password', limiter(60 * 60_000, 10));
  app.use('/api/auth/verify-email', limiter(60 * 60_000, 20));
  app.use('/api/auth/resend-verification', limiter(60 * 60_000, 5));
  // Messaging and posting get tighter write limits to blunt spam.
  app.post('/api/conversations/:id/messages', limiter(60_000, 60));
  app.post('/api/posts', limiter(60_000, 20));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/posts', postRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/conversations', conversationRoutes);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (config.clientDir) {
    const indexHtml = path.join(config.clientDir, 'index.html');
    app.use(
      express.static(config.clientDir, {
        index: false,
        setHeaders(res, file) {
          // Vite fingerprints everything under /assets, so it can be cached forever.
          if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    // SPA fallback: any other GET that isn't API/uploads/websocket serves the app shell (client-side routing).
    app.use((req, res, next) => {
      if (req.method !== 'GET' || /^\/(api|uploads|socket\.io)(\/|$)/.test(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
