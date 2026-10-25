// REST load test. Run with k6 (see docs/LOADTEST.md).
//   k6 run -e BASE_URL=http://localhost:4000 -e USERS=200 loadtest/k6-api.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:4000';
const USERS = Number(__ENV.USERS || 200); // must not exceed what scripts/seed.js created
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus', // VU = one simulated user looping through the journey below
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  // Pass/fail targets. These are YOUR service-level objectives; tune them to what you consider acceptable.
  thresholds: {
    http_req_failed: ['rate<0.01'], // < 1% errors
    http_req_duration: ['p(95)<800'], // 95% of requests under 800 ms
    'http_req_duration{name:feed}': ['p(95)<500'],
  },
};

export default function () {
  // k6 keeps a cookie jar per VU, so logging in on the first iteration authenticates all later requests.
  if (__ITER === 0) {
    const id = ((__VU - 1) % USERS) + 1;
    const res = http.post(
      `${BASE}/api/auth/login`,
      JSON.stringify({ identifier: `load${id}`, password: 'LoadTest123!' }),
      { headers: JSON_HEADERS, tags: { name: 'login' } },
    );
    if (!check(res, { 'login 200': (r) => r.status === 200 })) { sleep(5); return; }
  }

  // Every page load: feed + badge counts (what the SPA does on navigation).
  const feed = http.get(`${BASE}/api/posts/feed?limit=20`, { tags: { name: 'feed' } });
  check(feed, { 'feed 200': (r) => r.status === 200 });
  http.get(`${BASE}/api/notifications/unread-count`, { tags: { name: 'unread-count' } });
  http.get(`${BASE}/api/conversations/unread-count`, { tags: { name: 'unread-count' } });

  const posts = feed.status === 200 ? feed.json('posts') : [];
  const roll = Math.random();

  if (posts.length && roll < 0.5) {
    const p = posts[Math.floor(Math.random() * posts.length)];
    http.post(`${BASE}/api/posts/${p.id}/like`, null, { tags: { name: 'like' } });
  }
  if (posts.length && roll > 0.8 && roll <= 0.9) {
    const p = posts[Math.floor(Math.random() * posts.length)];
    http.post(`${BASE}/api/posts/${p.id}/comments`, JSON.stringify({ text: 'load test comment' }), { headers: JSON_HEADERS, tags: { name: 'comment' } });
  }
  if (roll > 0.9) {
    http.post(`${BASE}/api/posts`, JSON.stringify({ text: `load test post ${Date.now()}` }), { headers: JSON_HEADERS, tags: { name: 'create-post' } });
  }
  if (roll > 0.5 && roll <= 0.6) {
    const other = 1 + Math.floor(Math.random() * USERS);
    http.get(`${BASE}/api/users/load${other}`, { tags: { name: 'profile' } });
    http.get(`${BASE}/api/posts/user/load${other}`, { tags: { name: 'profile-posts' } });
  }

  sleep(1 + Math.random() * 2); // think time: real users pause between actions
}
