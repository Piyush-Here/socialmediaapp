import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { EmailToken, User } from '../models/index.js';
import { HttpError, parse } from '../utils/errors.js';
import { sendMail } from '../utils/mailer.js';
import { userRoom } from '../utils/realtime.js';
import { selfUser } from '../utils/serialize.js';
import { clearAuthCookie, setAuthCookie, signToken } from '../utils/tokens.js';

const router = Router();
const COST = 12;
// Compared against when the account doesn't exist, so login timing doesn't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', COST);

const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  // bcrypt silently truncates past 72 bytes, so cap by bytes rather than characters.
  .refine((p) => Buffer.byteLength(p) <= 72, 'Password too long (max 72 bytes)');

// ---------- email tokens ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const TTL = { verify: 24 * 60 * 60_000, reset: 60 * 60_000 };
const tokenField = z.string().regex(/^[a-f0-9]{64}$/, 'Invalid or expired link');

/** Creates a fresh token (replacing any older one of the same type) and returns the raw value to email. */
async function issueToken(userId, type) {
  const raw = crypto.randomBytes(32).toString('hex');
  await EmailToken.deleteMany({ user: userId, type });
  await EmailToken.create({ user: userId, type, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TTL[type]) });
  return raw;
}
/** Atomically deletes and returns the token row, so a link works exactly once. */
const consumeToken = (raw, type) =>
  EmailToken.findOneAndDelete({ tokenHash: sha256(raw), type, expiresAt: { $gt: new Date() } });
const issuedRecently = (userId, type, ms) =>
  EmailToken.exists({ user: userId, type, createdAt: { $gt: new Date(Date.now() - ms) } });

async function sendVerificationEmail(user) {
  const raw = await issueToken(user._id, 'verify');
  await sendMail({
    to: user.email,
    subject: 'Verify your email address',
    text: `Hi ${user.displayName},\n\nConfirm your email address to finish setting up your account:\n\n${config.appUrl}/verify-email?token=${raw}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this email.`,
  });
}

// ---------- register / login ----------
const registerSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, '3-20 characters: letters, numbers, underscore'),
  email: z.string().trim().email().max(254),
  password: passwordField,
  displayName: z.string().trim().min(1).max(40).optional(),
});

router.post('/register', async (req, res) => {
  const data = parse(registerSchema, req.body);
  const passwordHash = await bcrypt.hash(data.password, COST);
  let user;
  try {
    user = await User.create({
      username: data.username,
      email: data.email,
      passwordHash,
      displayName: data.displayName ?? data.username,
    });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, 'Username or email already in use');
    throw err;
  }
  // Don't make signup wait on (or fail because of) the mail server; the user can use "resend".
  sendVerificationEmail(user).catch((e) => console.error('verification email failed:', e.message));
  setAuthCookie(res, signToken(user._id));
  res.status(201).json({ user: selfUser(user) });
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254), // email or username
  password: z.string().min(1).max(200),
});

router.post('/login', async (req, res) => {
  const { identifier, password } = parse(loginSchema, req.body);
  const key = identifier.toLowerCase();
  const user = await User.findOne(key.includes('@') ? { email: key } : { username: key }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid credentials');
  setAuthCookie(res, signToken(user._id));
  res.json({ user: selfUser(user) });
});

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user._id);
  res.json({ user: selfUser(user) });
});

// ---------- email verification ----------
router.post('/verify-email', async (req, res) => {
  const { token } = parse(z.object({ token: tokenField }), req.body);
  const doc = await consumeToken(token, 'verify');
  if (!doc) throw new HttpError(400, 'Invalid or expired link');
  await User.updateOne({ _id: doc.user }, { emailVerified: true });
  res.json({ ok: true });
});

router.post('/resend-verification', requireAuth, async (req, res) => {
  const user = await User.findById(req.user._id);
  if (user.emailVerified) return res.json({ ok: true });
  if (await issuedRecently(user._id, 'verify', 60_000)) {
    throw new HttpError(429, 'Please wait a minute before requesting another email');
  }
  await sendVerificationEmail(user); // awaited so a broken mail server is reported to the user
  res.json({ ok: true });
});

// ---------- password reset ----------
const GENERIC = 'If an account with that email exists, a reset link has been sent.';

router.post('/forgot-password', async (req, res) => {
  const { email } = parse(z.object({ email: z.string().trim().email().max(254) }), req.body);
  // Same response, and same (fast) timing, whether or not the account exists: the lookup and the
  // email happen after we've already answered, so this endpoint can't be used to enumerate emails.
  res.json({ ok: true, message: GENERIC });
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return;
    if (await issuedRecently(user._id, 'reset', 5 * 60_000)) return; // throttle email-bombing a victim
    const raw = await issueToken(user._id, 'reset');
    await sendMail({
      to: user.email,
      subject: 'Reset your password',
      text: `Hi ${user.displayName},\n\nSomeone asked to reset your password. To choose a new one, open:\n\n${config.appUrl}/reset-password?token=${raw}\n\nThis link expires in 1 hour and works once. If it wasn't you, ignore this email — your password stays unchanged.`,
    });
  } catch (err) {
    console.error('forgot-password failed:', err.message);
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = parse(z.object({ token: tokenField, password: passwordField }), req.body);
  const doc = await consumeToken(token, 'reset');
  if (!doc) throw new HttpError(400, 'Invalid or expired link');
  const passwordHash = await bcrypt.hash(password, COST);
  // Receiving the link proves control of the mailbox, so the address counts as verified too.
  await User.updateOne({ _id: doc.user }, { passwordHash, passwordChangedAt: new Date(), emailVerified: true });
  await EmailToken.deleteMany({ user: doc.user });
  // Kick existing realtime connections; existing cookies stop working via passwordChangedAt.
  req.app.get('io')?.in(userRoom(doc.user)).disconnectSockets(true);
  clearAuthCookie(res);
  res.json({ ok: true });
});

export default router;
