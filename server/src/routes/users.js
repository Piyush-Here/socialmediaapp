import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { Follow, User } from '../models/index.js';
import { HttpError, parse } from '../utils/errors.js';
import { deleteImage, saveImage, upload } from '../utils/images.js';
import { notify } from '../utils/realtime.js';
import { publicUser, selfUser } from '../utils/serialize.js';

const router = Router();
router.use(requireAuth);

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const usernameParam = z.string().regex(/^[a-zA-Z0-9_]{3,20}$/, 'Invalid username');

router.get('/search', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(30) }), { q: req.query.q });
  const users = await User.find({ username: new RegExp(`^${escapeRegex(q.toLowerCase())}`) })
    .limit(10)
    .sort({ followerCount: -1 });
  res.json({ users: users.map(publicUser) });
});

router.get('/suggestions', async (req, res) => {
  const following = await Follow.find({ follower: req.user._id }).distinct('following');
  const users = await User.find({ _id: { $nin: [...following, req.user._id] } })
    .sort({ followerCount: -1, _id: -1 })
    .limit(5);
  res.json({ users: users.map(publicUser) });
});

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
  bio: z.string().trim().max(160).optional(),
});

router.patch('/me', async (req, res) => {
  const data = parse(profileSchema, req.body);
  const user = await User.findByIdAndUpdate(req.user._id, { $set: data }, { returnDocument: 'after' });
  res.json({ user: selfUser(user) });
});

router.post('/me/avatar', upload.single('image'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Image required');
  const name = await saveImage(req.file.buffer, { square: true });
  const old = await User.findByIdAndUpdate(req.user._id, { avatar: name }); // returns the previous doc by default
  await deleteImage(old?.avatar);
  const user = await User.findById(req.user._id);
  res.json({ user: selfUser(user) });
});

router.get('/:username', async (req, res) => {
  const username = parse(usernameParam, req.params.username).toLowerCase();
  const user = await User.findOne({ username });
  if (!user) throw new HttpError(404, 'User not found');
  const isFollowing = !!(await Follow.exists({ follower: req.user._id, following: user._id }));
  res.json({ user: publicUser(user), isFollowing, isMe: String(user._id) === String(req.user._id) });
});

async function findTarget(req) {
  const username = parse(usernameParam, req.params.username).toLowerCase();
  const target = await User.findOne({ username });
  if (!target) throw new HttpError(404, 'User not found');
  if (String(target._id) === String(req.user._id)) throw new HttpError(400, 'You cannot follow yourself');
  return target;
}

router.post('/:username/follow', async (req, res) => {
  const target = await findTarget(req);
  // upsert makes this idempotent; counters change only when a row was really created.
  const r = await Follow.updateOne(
    { follower: req.user._id, following: target._id },
    { $setOnInsert: { follower: req.user._id, following: target._id } },
    { upsert: true },
  );
  if (r.upsertedCount === 1) {
    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $inc: { followingCount: 1 } }),
      User.updateOne({ _id: target._id }, { $inc: { followerCount: 1 } }),
    ]);
    await notify(req.app, { recipient: target._id, actor: req.user, type: 'follow' });
  }
  const fresh = await User.findById(target._id);
  res.json({ user: publicUser(fresh), isFollowing: true });
});

router.delete('/:username/follow', async (req, res) => {
  const target = await findTarget(req);
  const r = await Follow.deleteOne({ follower: req.user._id, following: target._id });
  if (r.deletedCount === 1) {
    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $inc: { followingCount: -1 } }),
      User.updateOne({ _id: target._id }, { $inc: { followerCount: -1 } }),
    ]);
  }
  const fresh = await User.findById(target._id);
  res.json({ user: publicUser(fresh), isFollowing: false });
});

export default router;
