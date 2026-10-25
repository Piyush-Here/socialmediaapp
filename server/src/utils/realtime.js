import { Notification } from '../models/index.js';
import { publicNotification } from './serialize.js';

export const userRoom = (id) => `user:${id}`;

export function emitToUser(app, userId, event, payload) {
  const io = app.get('io');
  if (io) io.to(userRoom(userId)).emit(event, payload);
}

/** Creates a notification (never for your own actions) and pushes it live. */
export async function notify(app, { recipient, actor, type, post = null }) {
  if (String(recipient) === String(actor._id ?? actor)) return;
  const n = await Notification.create({ recipient, actor: actor._id ?? actor, type, post });
  await n.populate('actor', 'username displayName avatar');
  emitToUser(app, recipient, 'notification:new', publicNotification(n));
}
