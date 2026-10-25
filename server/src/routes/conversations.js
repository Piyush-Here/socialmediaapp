import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireVerified } from '../middleware/auth.js';
import { Conversation, Message, User } from '../models/index.js';
import { HttpError, objectId, parse } from '../utils/errors.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { emitToUser } from '../utils/realtime.js';
import { AUTHOR_FIELDS, miniUser, publicMessage } from '../utils/serialize.js';

const router = Router();
router.use(requireAuth);

async function loadConversation(id, userId) {
  const convo = await Conversation.findById(parse(objectId, id));
  // 404 (not 403) so conversation ids can't be probed.
  if (!convo || !convo.participants.some((p) => String(p) === String(userId))) {
    throw new HttpError(404, 'Conversation not found');
  }
  return convo;
}

router.get('/', async (req, res) => {
  const convos = await Conversation.find({
    participants: req.user._id,
    $or: [{ 'lastMessage.text': { $exists: true } }, { initiator: req.user._id }],
  })
    .sort({ updatedAt: -1 })
    .limit(50)
    .populate('participants', AUTHOR_FIELDS);
  const unread = await Message.aggregate([
    { $match: { conversation: { $in: convos.map((c) => c._id) }, sender: { $ne: req.user._id }, readAt: null } },
    { $group: { _id: '$conversation', n: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((u) => [String(u._id), u.n]));
  res.json({
    conversations: convos.map((c) => ({
      id: String(c._id),
      other: miniUser(c.participants.find((p) => String(p._id) !== String(req.user._id))),
      lastMessage: c.lastMessage?.text
        ? { text: c.lastMessage.text, sender: String(c.lastMessage.sender), createdAt: c.lastMessage.createdAt }
        : null,
      unread: unreadMap.get(String(c._id)) ?? 0,
      updatedAt: c.updatedAt,
    })),
  });
});

router.get('/unread-count', async (req, res) => {
  const ids = await Conversation.find({ participants: req.user._id }).distinct('_id');
  const count = await Message.countDocuments({ conversation: { $in: ids }, sender: { $ne: req.user._id }, readAt: null });
  res.json({ count });
});

// Get-or-create the conversation with another user.
router.post('/', requireVerified, async (req, res) => {
  const { username } = parse(z.object({ username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/) }), req.body);
  const other = await User.findOne({ username: username.toLowerCase() });
  if (!other) throw new HttpError(404, 'User not found');
  if (String(other._id) === String(req.user._id)) throw new HttpError(400, 'You cannot message yourself');
  const ids = [String(req.user._id), String(other._id)].sort();
  const pairKey = ids.join('_');
  const convo = await Conversation.findOneAndUpdate(
    { pairKey },
    { $setOnInsert: { pairKey, initiator: req.user._id, participants: ids.map((i) => new mongoose.Types.ObjectId(i)) } },
    { upsert: true, returnDocument: 'after' },
  );
  res.json({ conversation: { id: String(convo._id), other: miniUser(other) } });
});

router.get('/:id/messages', async (req, res) => {
  const convo = await loadConversation(req.params.id, req.user._id);
  const page = pageParams(req.query);
  const { items, nextCursor } = await paginate(
    (cursorFilter, take) => Message.find({ conversation: convo._id, ...cursorFilter }).sort({ _id: -1 }).limit(take),
    page,
  );
  // Newest-first for paging; reversed so the client can render oldest -> newest.
  res.json({ messages: items.reverse().map(publicMessage), nextCursor });
});

const messageSchema = z.object({ text: z.string().trim().min(1, 'Message cannot be empty').max(2000) });

router.post('/:id/messages', requireVerified, async (req, res) => {
  const convo = await loadConversation(req.params.id, req.user._id);
  const { text } = parse(messageSchema, req.body);
  const msg = await Message.create({ conversation: convo._id, sender: req.user._id, text });
  convo.lastMessage = { text: text.slice(0, 200), sender: req.user._id, createdAt: msg.createdAt };
  await convo.save();
  const payload = publicMessage(msg);
  // Both participants' rooms: delivers to the recipient and to the sender's other tabs/devices.
  for (const p of convo.participants) emitToUser(req.app, p, 'message:new', payload);
  res.status(201).json({ message: payload });
});

router.post('/:id/read', async (req, res) => {
  const convo = await loadConversation(req.params.id, req.user._id);
  const r = await Message.updateMany(
    { conversation: convo._id, sender: { $ne: req.user._id }, readAt: null },
    { readAt: new Date() },
  );
  if (r.modifiedCount > 0) {
    const other = convo.participants.find((p) => String(p) !== String(req.user._id));
    emitToUser(req.app, other, 'message:read', { conversation: String(convo._id) });
  }
  res.json({ ok: true });
});

export default router;
