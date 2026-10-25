import mongoose from 'mongoose';
const { Schema } = mongoose;
const ref = (model, extra = {}) => ({ type: Schema.Types.ObjectId, ref: model, ...extra });

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 40 },
    bio: { type: String, default: '', maxlength: 160 },
    avatar: { type: String, default: null },
    followerCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    emailVerified: { type: Boolean, default: false },
    // Sessions (JWTs) issued before this moment are rejected.
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
userSchema.index({ followerCount: -1 });

const postSchema = new Schema(
  {
    author: ref('User', { required: true }),
    text: { type: String, default: '', maxlength: 500 },
    image: { type: String, default: null },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
postSchema.index({ author: 1, _id: -1 });

const commentSchema = new Schema(
  {
    post: ref('Post', { required: true }),
    author: ref('User', { required: true }),
    text: { type: String, required: true, maxlength: 300 },
  },
  { timestamps: true },
);
commentSchema.index({ post: 1, _id: 1 });

// Likes and follows are their own collections (not arrays on User/Post) so that
// documents stay bounded and uniqueness is enforced by an index.
const likeSchema = new Schema({ user: ref('User', { required: true }), post: ref('Post', { required: true }) });
likeSchema.index({ user: 1, post: 1 }, { unique: true });
likeSchema.index({ post: 1 });

const followSchema = new Schema({
  follower: ref('User', { required: true }),
  following: ref('User', { required: true }),
});
followSchema.index({ follower: 1, following: 1 }, { unique: true });
followSchema.index({ following: 1 });

const notificationSchema = new Schema(
  {
    recipient: ref('User', { required: true }),
    actor: ref('User', { required: true }),
    type: { type: String, enum: ['like', 'comment', 'follow'], required: true },
    post: ref('Post', { default: null }),
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);
notificationSchema.index({ recipient: 1, _id: -1 });
notificationSchema.index({ recipient: 1, read: 1 });

const conversationSchema = new Schema(
  {
    participants: { type: [ref('User')], validate: (v) => v.length === 2 },
    // "<smallerId>_<largerId>" guarantees exactly one conversation per pair.
    pairKey: { type: String, required: true, unique: true },
    // Whoever opened the chat first sees it before any message exists; the other side only once a message is sent.
    initiator: ref('User', { required: true }),
    lastMessage: {
      text: String,
      sender: ref('User'),
      createdAt: Date,
    },
  },
  { timestamps: true },
);
conversationSchema.index({ participants: 1, updatedAt: -1 });

const messageSchema = new Schema(
  {
    conversation: ref('Conversation', { required: true }),
    sender: ref('User', { required: true }),
    text: { type: String, required: true, maxlength: 2000 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);
messageSchema.index({ conversation: 1, _id: -1 });
messageSchema.index({ conversation: 1, sender: 1, readAt: 1 });

// Single-use email links. Only a SHA-256 hash of the token is stored, so a database leak
// doesn't hand out working reset links. MongoDB's TTL monitor deletes expired rows.
const emailTokenSchema = new Schema(
  {
    user: ref('User', { required: true }),
    type: { type: String, enum: ['verify', 'reset'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
emailTokenSchema.index({ user: 1, type: 1 });

export const User = mongoose.model('User', userSchema);
export const EmailToken = mongoose.model('EmailToken', emailTokenSchema);
export const Post = mongoose.model('Post', postSchema);
export const Comment = mongoose.model('Comment', commentSchema);
export const Like = mongoose.model('Like', likeSchema);
export const Follow = mongoose.model('Follow', followSchema);
export const Notification = mongoose.model('Notification', notificationSchema);
export const Conversation = mongoose.model('Conversation', conversationSchema);
export const Message = mongoose.model('Message', messageSchema);
