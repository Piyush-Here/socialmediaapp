import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Notification } from '../models/index.js';
import { pageParams, paginate } from '../utils/pagination.js';
import { AUTHOR_FIELDS, publicNotification } from '../utils/serialize.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const page = pageParams(req.query);
  const { items, nextCursor } = await paginate(
    (cursorFilter, take) =>
      Notification.find({ recipient: req.user._id, ...cursorFilter })
        .sort({ _id: -1 })
        .limit(take)
        .populate('actor', AUTHOR_FIELDS),
    page,
  );
  res.json({ notifications: items.map(publicNotification), nextCursor });
});

router.get('/unread-count', async (req, res) => {
  const count = await Notification.countDocuments({ recipient: req.user._id, read: false });
  res.json({ count });
});

router.post('/read-all', async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, read: false }, { read: true });
  res.json({ ok: true });
});

export default router;
