import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireVerified } from '../middleware/auth.js';
import { Comment, Follow, Like, Notification, Post, User } from '../models/index.js';
import { HttpError, objectId, parse } from '../utils/errors.js';
import { deleteImage, saveImage, upload } from '../utils/images.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { notify } from '../utils/realtime.js';
import { AUTHOR_FIELDS, publicComment, publicPost } from '../utils/serialize.js';

const router = Router();
router.use(requireAuth);

async function withLikes(posts, userId) {
  const liked = await Like.find({ user: userId, post: { $in: posts.map((p) => p._id) } }).distinct('post');
  const set = new Set(liked.map(String));
  return posts.map((p) => publicPost(p, set));
}

async function listPosts(req, res, authorFilter) {
  const page = pageParams(req.query);
  const { items, nextCursor } = await paginate(
    (cursorFilter, take) =>
      Post.find({ ...authorFilter, ...cursorFilter }).sort({ _id: -1 }).limit(take).populate('author', AUTHOR_FIELDS),
    page,
  );
  res.json({ posts: await withLikes(items, req.user._id), nextCursor });
}

router.get('/feed', async (req, res) => {
  const following = await Follow.find({ follower: req.user._id }).distinct('following');
  await listPosts(req, res, { author: { $in: [...following, req.user._id] } });
});

router.get('/user/:username', async (req, res) => {
  const user = await User.findOne({ username: String(req.params.username).toLowerCase() });
  if (!user) throw new HttpError(404, 'User not found');
  await listPosts(req, res, { author: user._id });
});

const createSchema = z.object({ text: z.string().trim().max(500).default('') });

router.post('/', requireVerified, upload.single('image'), async (req, res) => {
  const { text } = parse(createSchema, { text: req.body?.text });
  if (!text && !req.file) throw new HttpError(400, 'A post needs text or an image');
  const image = req.file ? await saveImage(req.file.buffer) : null;
  let post;
  try {
    post = await Post.create({ author: req.user._id, text, image });
  } catch (err) {
    await deleteImage(image);
    throw err;
  }
  await post.populate('author', AUTHOR_FIELDS);
  res.status(201).json({ post: publicPost(post) });
});

async function loadPost(id) {
  const post = await Post.findById(parse(objectId, id)).populate('author', AUTHOR_FIELDS);
  if (!post) throw new HttpError(404, 'Post not found');
  return post;
}

router.get('/:id', async (req, res) => {
  const post = await loadPost(req.params.id);
  const [out] = await withLikes([post], req.user._id);
  res.json({ post: out });
});

router.delete('/:id', async (req, res) => {
  const post = await loadPost(req.params.id);
  if (String(post.author._id) !== String(req.user._id)) throw new HttpError(403, 'Not your post');
  await Promise.all([
    Post.deleteOne({ _id: post._id }),
    Comment.deleteMany({ post: post._id }),
    Like.deleteMany({ post: post._id }),
    Notification.deleteMany({ post: post._id }),
    deleteImage(post.image),
  ]);
  res.json({ ok: true });
});

router.post('/:id/like', async (req, res) => {
  const post = await loadPost(req.params.id);
  const r = await Like.updateOne(
    { user: req.user._id, post: post._id },
    { $setOnInsert: { user: req.user._id, post: post._id } },
    { upsert: true },
  );
  if (r.upsertedCount === 1) {
    await Post.updateOne({ _id: post._id }, { $inc: { likeCount: 1 } });
    await notify(req.app, { recipient: post.author._id, actor: req.user, type: 'like', post: post._id });
  }
  const fresh = await Post.findById(post._id);
  res.json({ likeCount: fresh.likeCount, likedByMe: true });
});

router.delete('/:id/like', async (req, res) => {
  const post = await loadPost(req.params.id);
  const r = await Like.deleteOne({ user: req.user._id, post: post._id });
  if (r.deletedCount === 1) await Post.updateOne({ _id: post._id }, { $inc: { likeCount: -1 } });
  const fresh = await Post.findById(post._id);
  res.json({ likeCount: fresh.likeCount, likedByMe: false });
});

router.get('/:id/comments', async (req, res) => {
  const post = await loadPost(req.params.id);
  const page = pageParams(req.query);
  const { items, nextCursor } = await paginate(
    (cursorFilter, take) =>
      Comment.find({ post: post._id, ...cursorFilter }).sort({ _id: 1 }).limit(take).populate('author', AUTHOR_FIELDS),
    page,
    'asc',
  );
  res.json({ comments: items.map(publicComment), nextCursor });
});

const commentSchema = z.object({ text: z.string().trim().min(1, 'Comment cannot be empty').max(300) });

router.post('/:id/comments', requireVerified, async (req, res) => {
  const post = await loadPost(req.params.id);
  const { text } = parse(commentSchema, req.body);
  const comment = await Comment.create({ post: post._id, author: req.user._id, text });
  await Post.updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });
  await comment.populate('author', AUTHOR_FIELDS);
  await notify(req.app, { recipient: post.author._id, actor: req.user, type: 'comment', post: post._id });
  res.status(201).json({ comment: publicComment(comment) });
});

router.delete('/:id/comments/:commentId', async (req, res) => {
  const post = await loadPost(req.params.id);
  const comment = await Comment.findOne({ _id: parse(objectId, req.params.commentId), post: post._id });
  if (!comment) throw new HttpError(404, 'Comment not found');
  if (String(comment.author) !== String(req.user._id)) throw new HttpError(403, 'You can only delete your own comments');
  await Comment.deleteOne({ _id: comment._id });
  await Post.updateOne({ _id: post._id }, { $inc: { commentCount: -1 } });
  res.json({ ok: true });
});

export default router;
