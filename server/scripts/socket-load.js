// Measures real-time chat delivery under load: N pairs of users, each pair exchanges messages over REST + Socket.io.
//   node scripts/socket-load.js [baseUrl=http://localhost:4000] [pairs=50] [messagesPerPair=20]
// Needs seeded users (scripts/seed.js with at least 2*pairs users) and RATE_LIMIT_DISABLED=true on the server.
import { io } from 'socket.io-client';

const base = (process.argv[2] || 'http://localhost:4000').replace(/\/$/, '');
const pairs = Number(process.argv[3]) || 50;
const perPair = Number(process.argv[4]) || 20;
const PASSWORD = 'LoadTest123!';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : NaN);

async function login(n) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: `load${n}`, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login load${n} failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { user } = await res.json();
  return { cookie, id: user.id, n };
}
const api = (cookie, path, body) =>
  fetch(`${base}/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx]); }
  }));
  return results;
}

console.log(`Logging in ${pairs * 2} users (bcrypt is slow on purpose, so this takes a while)...`);
const t0 = Date.now();
const sessions = await pool(Array.from({ length: pairs * 2 }, (_, i) => i + 1), 8, login);
console.log(`Logged in in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const latencies = [];
const sendTimes = [];
let sent = 0, delivered = 0, failed = 0, connectErrors = 0;
const sockets = [];

function connect(session) {
  return new Promise((resolve) => {
    const s = io(base, { extraHeaders: { cookie: session.cookie }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', () => { connectErrors++; resolve(null); });
    sockets.push(s);
  });
}

async function runPair(i) {
  const a = sessions[2 * i], b = sessions[2 * i + 1];
  const sockB = await connect(b);
  if (!sockB) return;
  sockB.on('message:new', (m) => {
    if (m.sender === b.id || !m.text.startsWith('lt:')) return;
    latencies.push(Date.now() - Number(m.text.split(':')[1]));
    delivered++;
  });
  const convRes = await api(a.cookie, '/conversations', { username: `load${b.n}` });
  if (!convRes.ok) { failed += perPair; return; }
  const { conversation } = await convRes.json();
  for (let k = 0; k < perPair; k++) {
    const start = Date.now();
    const r = await api(a.cookie, `/conversations/${conversation.id}/messages`, { text: `lt:${start}:${k}` });
    sendTimes.push(Date.now() - start);
    r.ok ? sent++ : failed++;
    await sleep(300 + Math.random() * 700); // think time between messages
  }
}

console.log(`Running ${pairs} pairs x ${perPair} messages...`);
const t1 = Date.now();
await Promise.all(Array.from({ length: pairs }, (_, i) => runPair(i)));
await sleep(3000); // let in-flight deliveries land
const secs = (Date.now() - t1) / 1000;

latencies.sort((x, y) => x - y);
sendTimes.sort((x, y) => x - y);
const ms = (v) => (Number.isNaN(v) ? 'n/a' : `${v} ms`);
console.log('\n=== Result ===');
console.log(`sockets connected : ${sockets.filter((s) => s.connected).length} listening sockets (connect errors: ${connectErrors})`);
console.log(`messages          : sent ${sent}, delivered ${delivered}, failed ${failed}, lost ${sent - delivered}`);
console.log(`throughput        : ${(sent / secs).toFixed(1)} msg/s over ${secs.toFixed(0)}s`);
console.log(`REST send time    : p50 ${ms(pct(sendTimes, 50))}  p95 ${ms(pct(sendTimes, 95))}  p99 ${ms(pct(sendTimes, 99))}`);
console.log(`end-to-end delivery (send -> socket event): p50 ${ms(pct(latencies, 50))}  p95 ${ms(pct(latencies, 95))}  p99 ${ms(pct(latencies, 99))}  max ${ms(latencies[latencies.length - 1])}`);
sockets.forEach((s) => s.close());
process.exit(0);
