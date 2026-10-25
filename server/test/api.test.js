// Integration tests. Uses TEST_MONGODB_URI if set (e.g. a local mongod), otherwise mongodb-memory-server.
process.env.NODE_ENV = 'test';
import { fileURLToPath } from 'node:url';
process.env.UPLOADS_DIR = fileURLToPath(new URL('./.uploads', import.meta.url));

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { io as ioc } from 'socket.io-client';
import request from 'supertest';

const { createApp } = await import('../src/app.js');
const { attachSocket } = await import('../src/socket.js');
const { outbox } = await import('../src/utils/mailer.js');
const { config } = await import('../src/config.js');

let mem, server, base, app;
before(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    mem = await MongoMemoryServer.create();
    uri = mem.getUri();
  }
  await mongoose.connect(uri, { dbName: `socialapp_test_${Date.now()}` });
  await mongoose.syncIndexes();
  app = createApp();
  server = http.createServer(app);
  attachSocket(server, app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  app.get('io')?.close();
  await mem?.stop();
});

async function signup(username) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ username, email: `${username}@x.com`, password: 'password123' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { agent, user: res.body.user, cookie: res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ') };
}

describe('auth', () => {
  test('register sets httpOnly cookie, never returns hash', async () => {
    const res = await request(app).post('/api/auth/register').send({ username: 'Alice_1', email: 'alice@x.com', password: 'password123' });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.username, 'alice_1');
    assert.equal(res.body.user.passwordHash, undefined);
    assert.match(res.headers['set-cookie'][0], /HttpOnly/i);
  });
  test('duplicate -> 409, weak password / bad username / object injection -> 400', async () => {
    await signup('dupe');
    const dup = await request(app).post('/api/auth/register').send({ username: 'dupe', email: 'other@x.com', password: 'password123' });
    assert.equal(dup.status, 409);
    for (const body of [
      { username: 'bob', email: 'b@x.com', password: 'short' },
      { username: 'a b', email: 'b@x.com', password: 'password123' },
      { username: 'bob', email: 'b@x.com', password: { $gt: '' } },
    ]) assert.equal((await request(app).post('/api/auth/register').send(body)).status, 400);
  });
  test('login ok by email and username; wrong password and operator injection fail', async () => {
    await signup('logan');
    assert.equal((await request(app).post('/api/auth/login').send({ identifier: 'logan@x.com', password: 'password123' })).status, 200);
    assert.equal((await request(app).post('/api/auth/login').send({ identifier: 'LOGAN', password: 'password123' })).status, 200);
    assert.equal((await request(app).post('/api/auth/login').send({ identifier: 'logan', password: 'nope' })).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ identifier: { $ne: '' }, password: { $ne: '' } })).status, 400);
  });
  test('protected routes need auth; logout clears session', async () => {
    assert.equal((await request(app).get('/api/posts/feed')).status, 401);
    const { agent } = await signup('lou');
    assert.equal((await agent.get('/api/auth/me')).status, 200);
    await agent.post('/api/auth/logout');
    assert.equal((await agent.get('/api/auth/me')).status, 401);
  });
});

describe('social graph, posts, likes, comments, notifications', () => {
  test('full flow', async () => {
    const a = await signup('flow_a');
    const b = await signup('flow_b');

    assert.equal((await a.agent.post('/api/users/flow_a/follow')).status, 400); // self
    const f1 = await a.agent.post('/api/users/flow_b/follow');
    const f2 = await a.agent.post('/api/users/flow_b/follow'); // idempotent
    assert.equal(f1.body.user.followerCount, 1);
    assert.equal(f2.body.user.followerCount, 1);

    const p = await b.agent.post('/api/posts').field('text', 'hello world');
    assert.equal(p.status, 201);
    const postId = p.body.post.id;

    const feed = await a.agent.get('/api/posts/feed');
    assert.deepEqual(feed.body.posts.map((x) => x.id), [postId]);

    const l1 = await a.agent.post(`/api/posts/${postId}/like`);
    const l2 = await a.agent.post(`/api/posts/${postId}/like`);
    assert.equal(l1.body.likeCount, 1);
    assert.equal(l2.body.likeCount, 1);
    assert.equal((await a.agent.get(`/api/posts/${postId}`)).body.post.likedByMe, true);

    assert.equal((await a.agent.post(`/api/posts/${postId}/comments`).send({ text: '   ' })).status, 400);
    assert.equal((await a.agent.post(`/api/posts/${postId}/comments`).send({ text: 'nice' })).status, 201);
    assert.equal((await a.agent.get(`/api/posts/${postId}/comments`)).body.comments.length, 1);

    const notes = (await b.agent.get('/api/notifications')).body.notifications;
    assert.deepEqual(notes.map((n) => n.type).sort(), ['comment', 'follow', 'like']);
    assert.equal((await b.agent.get('/api/notifications/unread-count')).body.count, 3);
    await b.agent.post('/api/notifications/read-all');
    assert.equal((await b.agent.get('/api/notifications/unread-count')).body.count, 0);

    assert.equal((await a.agent.delete(`/api/posts/${postId}`)).status, 403); // not owner
    assert.equal((await a.agent.delete(`/api/posts/${postId}/like`)).body.likeCount, 0);
    assert.equal((await b.agent.delete(`/api/posts/${postId}`)).status, 200);
    assert.equal((await a.agent.get(`/api/posts/${postId}`)).status, 404);
  });

  test('pagination returns every post exactly once', async () => {
    const u = await signup('pager');
    for (let i = 0; i < 5; i++) await u.agent.post('/api/posts').field('text', `p${i}`);
    const seen = [];
    let cursor;
    do {
      const r = await u.agent.get('/api/posts/feed').query({ limit: 2, ...(cursor && { cursor }) });
      seen.push(...r.body.posts.map((p) => p.text));
      cursor = r.body.nextCursor;
    } while (cursor);
    assert.deepEqual(seen, ['p4', 'p3', 'p2', 'p1', 'p0']);
  });

  test('image upload is re-encoded to webp; non-images rejected', async () => {
    const u = await signup('imguser');
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#f00' } }).png().toBuffer();
    const ok = await u.agent.post('/api/posts').attach('image', png, { filename: 'x.png', contentType: 'image/png' });
    assert.equal(ok.status, 201);
    assert.match(ok.body.post.image, /^\/uploads\/[a-f0-9]{32}\.webp$/);
    const served = await request(app).get(ok.body.post.image);
    assert.equal(served.status, 200);
    const fake = await u.agent.post('/api/posts').attach('image', Buffer.from('<script>alert(1)</script>'), { filename: 'x.png', contentType: 'image/png' });
    assert.equal(fake.status, 400);
    const wrongType = await u.agent.post('/api/posts').attach('image', Buffer.from('x'), { filename: 'x.svg', contentType: 'image/svg+xml' });
    assert.equal(wrongType.status, 400);
    assert.equal((await u.agent.post('/api/posts').field('text', '')).status, 400);
  });
});

describe('chat + realtime', () => {
  test('message persists, is pushed over socket to recipient, unread/read works', async () => {
    const a = await signup('chat_a');
    const b = await signup('chat_b');
    const c = await signup('chat_c');

    const sock = ioc(base, { extraHeaders: { cookie: b.cookie }, transports: ['websocket'] });
    await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); });
    const got = new Promise((res) => sock.once('message:new', res));

    const convo = await a.agent.post('/api/conversations').send({ username: 'chat_b' });
    const again = await b.agent.post('/api/conversations').send({ username: 'chat_a' });
    assert.equal(convo.body.conversation.id, again.body.conversation.id); // one convo per pair
    const id = convo.body.conversation.id;

    assert.equal((await a.agent.post(`/api/conversations/${id}/messages`).send({ text: 'hi b' })).status, 201);
    assert.equal((await got).text, 'hi b');

    assert.equal((await b.agent.get('/api/conversations')).body.conversations[0].unread, 1);
    await b.agent.post(`/api/conversations/${id}/read`);
    assert.equal((await b.agent.get('/api/conversations')).body.conversations[0].unread, 0);

    // outsider cannot read or write
    assert.equal((await c.agent.get(`/api/conversations/${id}/messages`)).status, 404);
    assert.equal((await c.agent.post(`/api/conversations/${id}/messages`).send({ text: 'x' })).status, 404);
    sock.close();
  });

  test('socket rejects unauthenticated and cross-origin handshakes', async () => {
    const anon = ioc(base, { transports: ['websocket'], reconnection: false });
    const err = await new Promise((res) => anon.on('connect_error', res));
    assert.match(err.message, /unauthorized/);
    anon.close();

    const u = await signup('xorigin');
    const evil = ioc(base, { extraHeaders: { cookie: u.cookie, origin: 'https://evil.example' }, transports: ['websocket'], reconnection: false });
    await new Promise((res) => evil.on('connect_error', res));
    assert.equal(evil.connected, false);
    evil.close();
  });
});

// ---------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForMail(to, subjectPart, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const m = [...outbox].reverse().find((x) => x.to === to && x.subject.includes(subjectPart));
    if (m) return m;
    await sleep(25);
  }
  throw new Error(`no "${subjectPart}" mail to ${to}`);
}
const tokenFrom = (mail) => mail.text.match(/token=([a-f0-9]{64})/)[1];

describe('comment deletion', () => {
  test('only the comment author can delete; post author and third parties cannot', async () => {
    const owner = await signup('cd_owner');
    const commenter = await signup('cd_commenter');
    const third = await signup('cd_third');
    const postId = (await owner.agent.post('/api/posts').field('text', 'hi')).body.post.id;
    const cid = (await commenter.agent.post(`/api/posts/${postId}/comments`).send({ text: 'mine' })).body.comment.id;

    assert.equal((await third.agent.delete(`/api/posts/${postId}/comments/${cid}`)).status, 403);
    assert.equal((await owner.agent.delete(`/api/posts/${postId}/comments/${cid}`)).status, 403);
    assert.equal((await owner.agent.get(`/api/posts/${postId}`)).body.post.commentCount, 1);
    assert.equal((await commenter.agent.delete(`/api/posts/${postId}/comments/${cid}`)).status, 200);
    assert.equal((await owner.agent.get(`/api/posts/${postId}`)).body.post.commentCount, 0);
    assert.equal((await commenter.agent.delete(`/api/posts/${postId}/comments/${cid}`)).status, 404);
  });
});

describe('profile + avatar', () => {
  test('edit name/bio with validation; avatar replaces and deletes the old file', async () => {
    const u = await signup('prof_user');
    const ok = await u.agent.patch('/api/users/me').send({ displayName: 'New Name', bio: 'hello there' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.bio, 'hello there');
    assert.equal(ok.body.user.emailVerified, false); // own-profile responses keep private fields
    assert.equal((await u.agent.patch('/api/users/me').send({ bio: 'x'.repeat(161) })).status, 400);
    assert.equal((await u.agent.patch('/api/users/me').send({ displayName: '' })).status, 400);

    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#00f' } }).png().toBuffer();
    const a1 = await u.agent.post('/api/users/me/avatar').attach('image', png, { filename: 'a.png', contentType: 'image/png' });
    assert.equal(a1.status, 200);
    const url1 = a1.body.user.avatar;
    assert.match(url1, /^\/uploads\/[a-f0-9]{32}\.webp$/);
    assert.equal((await request(app).get(url1)).status, 200);
    const a2 = await u.agent.post('/api/users/me/avatar').attach('image', png, { filename: 'a.png', contentType: 'image/png' });
    assert.notEqual(a2.body.user.avatar, url1);
    assert.equal((await request(app).get(url1)).status, 404); // old avatar removed from disk
    assert.equal((await u.agent.post('/api/users/me/avatar')).status, 400); // no file
  });
});

describe('message pagination', () => {
  test('pages walk the whole history once, each page oldest->newest', async () => {
    const a = await signup('mp_a');
    await signup('mp_b');
    const id = (await a.agent.post('/api/conversations').send({ username: 'mp_b' })).body.conversation.id;
    for (let i = 1; i <= 5; i++) {
      assert.equal((await a.agent.post(`/api/conversations/${id}/messages`).send({ text: `m${i}` })).status, 201);
    }
    const pages = [];
    let cursor;
    do {
      const r = await a.agent.get(`/api/conversations/${id}/messages`).query({ limit: 2, ...(cursor && { cursor }) });
      assert.equal(r.status, 200);
      pages.push(r.body.messages.map((m) => m.text));
      cursor = r.body.nextCursor;
    } while (cursor);
    assert.deepEqual(pages, [['m4', 'm5'], ['m2', 'm3'], ['m1']]);
  });
});

describe('email verification', () => {
  test('register sends a link; token verifies once; garbage/reused tokens fail', async () => {
    const u = await signup('ev_user');
    const mail = await waitForMail('ev_user@x.com', 'Verify');
    const token = tokenFrom(mail);
    assert.ok(mail.text.includes(`${config.appUrl}/verify-email?token=`));
    assert.equal((await u.agent.get('/api/auth/me')).body.user.emailVerified, false);

    assert.equal((await request(app).post('/api/auth/verify-email').send({ token: 'a'.repeat(64) })).status, 400);
    assert.equal((await request(app).post('/api/auth/verify-email').send({ token: { $ne: '' } })).status, 400);
    assert.equal((await request(app).post('/api/auth/verify-email').send({ token })).status, 200);
    assert.equal((await u.agent.get('/api/auth/me')).body.user.emailVerified, true);
    assert.equal((await request(app).post('/api/auth/verify-email').send({ token })).status, 400); // single use
  });

  test('resend is throttled and a no-op once verified', async () => {
    const u = await signup('ev_resend');
    await waitForMail('ev_resend@x.com', 'Verify');
    assert.equal((await u.agent.post('/api/auth/resend-verification')).status, 429); // just sent at signup
  });

  test('when enforced, unverified users cannot post/comment/message until verified', async () => {
    const other = await signup('ev_other');
    const u = await signup('ev_gate');
    config.requireEmailVerification = true;
    try {
      const blocked = await u.agent.post('/api/posts').field('text', 'nope');
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.code, 'EMAIL_NOT_VERIFIED');
      assert.equal((await u.agent.post('/api/conversations').send({ username: 'ev_other' })).status, 403);
      assert.equal((await u.agent.get('/api/posts/feed')).status, 200); // reading still works

      const token = tokenFrom(await waitForMail('ev_gate@x.com', 'Verify'));
      await request(app).post('/api/auth/verify-email').send({ token });
      assert.equal((await u.agent.post('/api/posts').field('text', 'now ok')).status, 201);
      assert.ok(other);
    } finally {
      config.requireEmailVerification = false;
    }
  });
});

describe('password reset', () => {
  test('full flow: generic response, single-use link, old password and old sessions die', async () => {
    const u = await signup('pr_user');
    await sleep(1100); // sessions are compared in whole seconds; make sure the old one predates the reset

    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@x.com' });
    const known = await request(app).post('/api/auth/forgot-password').send({ email: 'pr_user@x.com' });
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.body, known.body); // can't tell whether the account exists
    const mail = await waitForMail('pr_user@x.com', 'Reset');
    assert.equal(outbox.some((m) => m.to === 'nobody@x.com'), false);
    const token = tokenFrom(mail);

    // throttle: an immediate second request doesn't send another mail
    const before = outbox.length;
    await request(app).post('/api/auth/forgot-password').send({ email: 'pr_user@x.com' });
    await sleep(300);
    assert.equal(outbox.length, before);

    assert.equal((await request(app).post('/api/auth/reset-password').send({ token, password: 'short' })).status, 400);
    assert.equal((await request(app).post('/api/auth/reset-password').send({ token: 'b'.repeat(64), password: 'newpassword1' })).status, 400);
    assert.equal((await request(app).post('/api/auth/reset-password').send({ token, password: 'newpassword1' })).status, 200);
    assert.equal((await request(app).post('/api/auth/reset-password').send({ token, password: 'another-pass1' })).status, 400); // single use

    assert.equal((await request(app).post('/api/auth/login').send({ identifier: 'pr_user', password: 'password123' })).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ identifier: 'pr_user', password: 'newpassword1' })).status, 200);
    assert.equal((await u.agent.get('/api/auth/me')).status, 401); // session from before the reset is revoked
  });
});
