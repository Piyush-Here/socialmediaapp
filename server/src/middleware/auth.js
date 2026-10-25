import { config } from '../config.js';
import { User } from '../models/index.js';
import { HttpError } from '../utils/errors.js';
import { COOKIE_NAME, verifyToken } from '../utils/tokens.js';

/** Validates a session token and returns the user. Shared by the REST API and the socket handshake. */
export async function authenticate(token) {
  if (!token) throw new HttpError(401, 'Not authenticated');
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new HttpError(401, 'Session expired');
  }
  // Load the user so deleted accounts can't keep using an unexpired token.
  const user = await User.findById(payload.sub).select('username displayName avatar emailVerified passwordChangedAt');
  if (!user) throw new HttpError(401, 'Not authenticated');
  // A password reset invalidates every session issued before it (compared in whole seconds, like `iat`).
  if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    throw new HttpError(401, 'Session expired');
  }
  return user;
}

export async function requireAuth(req, _res, next) {
  req.user = await authenticate(req.cookies?.[COOKIE_NAME]);
  next();
}

export function requireVerified(req, _res, next) {
  if (config.requireEmailVerification && !req.user.emailVerified) {
    throw new HttpError(403, 'Please verify your email address first', 'EMAIL_NOT_VERIFIED');
  }
  next();
}
