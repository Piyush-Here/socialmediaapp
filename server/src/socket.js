import { parseCookie } from 'cookie';
import { Server } from 'socket.io';
import { config } from './config.js';
import { authenticate } from './middleware/auth.js';
import { userRoom } from './utils/realtime.js';
import { COOKIE_NAME } from './utils/tokens.js';

export function attachSocket(httpServer, app) {
  const io = new Server(httpServer, {
    // Same-origin deployment: no CORS headers are needed. Origins are enforced in allowRequest.
    serveClient: false,
    maxHttpBufferSize: 10_000,
    allowRequest(req, cb) {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true); // non-browser client (browsers always send Origin on WS)
      const sameHost = (() => {
        try {
          return new URL(origin).host === req.headers.host;
        } catch {
          return false;
        }
      })();
      cb(null, sameHost || config.clientOrigins.includes(origin));
    },
  });

  // Authenticate the handshake with the same httpOnly cookie the REST API uses.
  io.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie || '');
      const user = await authenticate(cookies[COOKIE_NAME]);
      socket.data.userId = String(user._id);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.userId));
  });

  app.set('io', io);
  return io;
}
