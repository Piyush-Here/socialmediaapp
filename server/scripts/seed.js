// Creates a throwaway data set for load testing.
//   MONGODB_URI=mongodb://127.0.0.1:27017/socialapp_load node scripts/seed.js [users=200]
// Users: load1..loadN, password "LoadTest123!", email-verified. Each follows 20 others and has 10 posts.
// SAFETY: it DROPS the target database first, so it refuses unless the database name contains "load".
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { Follow, Post, User } from '../src/models/index.js';

const N = Number(process.argv[2]) || 200;
const FOLLOWS_PER_USER = Math.min(20, N - 1);
const POSTS_PER_USER = 10;
const PASSWORD = 'LoadTest123!';

await mongoose.connect(config.mongoUri);
const dbName = mongoose.connection.name;
if (!dbName.includes('load')) {
  console.error(`Refusing to seed "${dbName}": the database name must contain "load" (this script drops it).`);
  process.exit(1);
}
console.log(`Seeding ${N} users into "${dbName}" (dropping it first)...`);
await mongoose.connection.dropDatabase();
await mongoose.syncIndexes();

// One hash reused for every user: same cost (12) as real signups, but we only pay for it once.
const passwordHash = bcrypt.hashSync(PASSWORD, 12);
const users = await User.insertMany(
  Array.from({ length: N }, (_, i) => ({
    username: `load${i + 1}`,
    email: `load${i + 1}@load.test`,
    passwordHash,
    displayName: `Load User ${i + 1}`,
    emailVerified: true,
  })),
);

const followers = new Map(users.map((u) => [String(u._id), 0]));
const follows = [];
for (const u of users) {
  const picked = new Set();
  while (picked.size < FOLLOWS_PER_USER) {
    const other = users[Math.floor(Math.random() * N)];
    if (other._id.equals(u._id)) continue;
    picked.add(other);
  }
  for (const o of picked) {
    follows.push({ follower: u._id, following: o._id });
    followers.set(String(o._id), followers.get(String(o._id)) + 1);
  }
}
await Follow.insertMany(follows);
await User.bulkWrite(
  users.map((u) => ({
    updateOne: { filter: { _id: u._id }, update: { $set: { followingCount: FOLLOWS_PER_USER, followerCount: followers.get(String(u._id)) } } },
  })),
);

const posts = [];
for (let j = 1; j <= POSTS_PER_USER; j++) {
  for (const u of users) posts.push({ author: u._id, text: `Seed post ${j} by ${u.username}` });
}
await Post.insertMany(posts); // inserted round-robin so ObjectIds interleave authors, like a real timeline

console.log(`Done: ${users.length} users, ${follows.length} follows, ${posts.length} posts. Login: load1..load${N} / ${PASSWORD}`);
await mongoose.disconnect();
