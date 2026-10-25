import { imageUrl } from './images.js';

export const AUTHOR_FIELDS = 'username displayName avatar';

export const publicUser = (u) => ({
  id: String(u._id),
  username: u.username,
  displayName: u.displayName,
  bio: u.bio ?? '',
  avatar: imageUrl(u.avatar),
  followerCount: u.followerCount ?? 0,
  followingCount: u.followingCount ?? 0,
  createdAt: u.createdAt,
});

// Returned only to the account owner.
export const selfUser = (u) => ({ ...publicUser(u), email: u.email, emailVerified: !!u.emailVerified });

export const miniUser = (u) => ({
  id: String(u._id),
  username: u.username,
  displayName: u.displayName,
  avatar: imageUrl(u.avatar),
});

export const publicPost = (p, likedIds = new Set()) => ({
  id: String(p._id),
  author: miniUser(p.author),
  text: p.text,
  image: imageUrl(p.image),
  likeCount: p.likeCount,
  commentCount: p.commentCount,
  likedByMe: likedIds.has(String(p._id)),
  createdAt: p.createdAt,
});

export const publicComment = (c) => ({
  id: String(c._id),
  post: String(c.post),
  author: miniUser(c.author),
  text: c.text,
  createdAt: c.createdAt,
});

export const publicNotification = (n) => ({
  id: String(n._id),
  type: n.type,
  actor: miniUser(n.actor),
  post: n.post ? String(n.post) : null,
  read: n.read,
  createdAt: n.createdAt,
});

export const publicMessage = (m) => ({
  id: String(m._id),
  conversation: String(m.conversation),
  sender: String(m.sender),
  text: m.text,
  readAt: m.readAt,
  createdAt: m.createdAt,
});
