import 'dotenv/config';
import path from 'node:path';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

export const config = {
  isProd,
  isTest,
  port: Number(env.PORT) || 4000,
  mongoUri: env.MONGODB_URI || 'mongodb://127.0.0.1:27017/socialapp',
  jwtSecret: env.JWT_SECRET || (isProd ? '' : 'dev-only-insecure-secret-change-me-please'),
  jwtDays: Number(env.JWT_EXPIRES_DAYS) || 7,
  // Comma-separated extra origins allowed for CORS / websockets. Empty = same-origin only.
  clientOrigins: (env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Cookies are Secure by default in production, which REQUIRES HTTPS.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProd,
  uploadsDir: path.resolve(env.UPLOADS_DIR || './uploads'),
  // Public URL of the web app; used to build links in emails.
  appUrl: (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  mailFrom: env.MAIL_FROM || 'Sociable <no-reply@localhost>',
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true', // true for port 465, false for 587 (STARTTLS)
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
  // Reverse proxies in front of the app (Caddy = 1). Wrong values make every client look like one IP.
  trustProxy: env.TRUST_PROXY === undefined ? 1 : Number.isNaN(Number(env.TRUST_PROXY)) ? env.TRUST_PROXY : Number(env.TRUST_PROXY),
  // Load testing only: a single generator IP would otherwise hit the per-IP limits instantly.
  rateLimitDisabled: env.RATE_LIMIT_DISABLED === 'true',
  // If set, Express also serves the built React app from this folder (single-service deploys, e.g. PaaS).
  clientDir: env.CLIENT_DIR ? path.resolve(env.CLIENT_DIR) : '',
  // Demo deployments without a mail provider: emails are printed to the log instead of sent.
  allowNoSmtp: env.ALLOW_NO_SMTP === 'true',
  // When true, unverified accounts can log in and read but not post/comment/message.
  requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION ? env.REQUIRE_EMAIL_VERIFICATION === 'true' : isProd,
};

if (isProd && !config.allowNoSmtp && (!config.smtp.host || !env.APP_URL || !env.MAIL_FROM)) {
  throw new Error('SMTP_HOST, APP_URL and MAIL_FROM must be set in production (password reset and verification need email)');
}
if (isProd && config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters in production');
}
