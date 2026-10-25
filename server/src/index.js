import http from 'node:http';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config.js';
import { attachSocket } from './socket.js';
import { verifyMail } from './utils/mailer.js';

mongoose.set('strictQuery', true);
await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
console.log('MongoDB connected');
await mongoose.syncIndexes();
await verifyMail(); // ensure unique indexes exist before accepting traffic

if (config.rateLimitDisabled) console.warn('WARNING: RATE_LIMIT_DISABLED=true — rate limiting is OFF. Never use this on a public server.');
if (config.allowNoSmtp && config.isProd) console.warn('WARNING: ALLOW_NO_SMTP=true — emails are only logged, so password reset will not work.');
const app = createApp();
const server = http.createServer(app);
attachSocket(server, app);
server.listen(config.port, () => console.log(`API listening on :${config.port}`));

const shutdown = (sig) => {
  console.log(`${sig} received, shutting down`);
  server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
