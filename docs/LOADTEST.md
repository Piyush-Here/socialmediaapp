# Load testing this app — a hands-on guide

Goal: find out how much traffic the API can take, where it breaks first, and prove any improvement with numbers.
You need no Docker for this; everything below runs on your machine. Commands are PowerShell.

## 1. The ideas (10 minutes of theory)

| Term | Meaning |
|---|---|
| **VU** (virtual user) | One simulated person looping through a realistic journey (log in, read feed, like, post...). |
| **Throughput** | Requests handled per second (`http_reqs` rate in k6). |
| **Latency percentiles** | `p50` = typical request. `p95` = 95% of requests were faster than this. `p99` = the slow tail. **Use p95/p99, not the average**: an average of 100 ms can hide a tail of 3 s that users actually feel. |
| **Error rate** | Share of failed requests (`http_req_failed`). Latency numbers are meaningless if half the requests failed fast. |
| **Think time** | The `sleep()` between actions. Without it, one VU hammers like 50 users and the test is unrealistic. |
| **Saturation** | The resource that runs out first: CPU of the Node process, CPU of MongoDB, RAM, event-loop delay, DB connections. |
| **The knee** | The load level where throughput stops growing and latency shoots up. That's your capacity. |

Test types (same script, different shape): **smoke** (1-2 VUs, does it work), **load** (expected traffic), **stress** (ramp until it breaks), **spike** (sudden jump), **soak** (moderate load for an hour+, finds leaks).

## 2. Setup (once)

1. Install k6: `winget install k6` (or download the installer from k6.io / use `docker run grafana/k6` once Docker works).
2. **Use a separate database.** The seed script refuses any database name not containing `load` because it drops the database.
3. Seed data (200 users, each following 20 others, 10 posts each):
   ```powershell
   cd server
   $env:MONGODB_URI="mongodb://127.0.0.1:27017/socialapp_load"
   node scripts/seed.js 200
   ```
4. Start the API **without** `--watch` (file watching adds noise) and with rate limits off. The per-IP limits would otherwise stop your single test machine within seconds:
   ```powershell
   $env:MONGODB_URI="mongodb://127.0.0.1:27017/socialapp_load"
   $env:RATE_LIMIT_DISABLED="true"
   npm start
   ```
   Never set `RATE_LIMIT_DISABLED` on a public server.

## 3. Run the REST test

From the repo root, in a second terminal:
```powershell
k6 run -e BASE_URL=http://localhost:4000 -e USERS=200 loadtest/k6-api.js
```
It ramps 0 → 20 → 50 → 100 VUs over 3 minutes. Open `loadtest/k6-api.js` and read it first: the journey, the probabilities, the `thresholds` (your pass/fail targets).

**Reading the k6 summary**
- `✓` / `✗` next to each threshold: did you meet your targets?
- `http_req_duration`: look at `med`, `p(95)`, `max`. Per-endpoint numbers appear under tags like `{name:feed}`.
- `http_req_failed`: must be ~0%. If not, find out why before reading anything else (check the API terminal for errors).
- `http_reqs`: total and per-second rate = throughput.
- `checks`: the `check()` assertions in the script.

**While it runs, watch the servers**, not just k6: Task Manager → Details → `node.exe` and `mongod.exe` CPU and memory. Whichever sits near 100% of a core is your bottleneck candidate. A Node process pinned at ~100% of one core means you're CPU-bound on the single event loop.

## 4. Find the knee (the actual experiment)

Edit `stages` and run the test repeatedly at fixed levels, e.g. 10, 25, 50, 100, 200 VUs (one `{ duration: '1m', target: N }` stage each, preceded by a short ramp). Record for each level:

| VUs | req/s | p50 | p95 | p99 | error % | node CPU | mongod CPU |
|---|---|---|---|---|---|---|---|

Throughput climbs, flattens, then p95 explodes. The VU count just before that is the capacity of **this setup on this machine**.

## 5. Real-time (Socket.io) test

k6 doesn't speak Socket.io, so there's a Node script (uses the same client library as the browser):
```powershell
cd server
node scripts/socket-load.js http://localhost:4000 50 20   # 50 pairs (100 users) x 20 messages
```
It prints sent / delivered / lost counts and end-to-end delivery latency (message POST → socket event on the other user). **Lost must be 0.** Increase the pair count until latency or losses degrade.

## 6. Make your numbers trustworthy

- Run each configuration **3 times**; discard the first (cold caches, JIT warm-up) or at least compare it with the others.
- Change **one thing at a time**, then re-run the identical test. That's how you attribute an improvement.
- k6, the API and MongoDB share one CPU here, so k6 steals capacity from the thing it measures. Treat results as *relative* (before vs after), and say so. Absolute numbers need a separate machine for the generator.
- Record the environment: CPU model/cores, RAM, Node version, dataset size (200 users / 2,000 posts is tiny), dev vs production mode.

## 7. Things worth investigating (hypotheses, not findings)

1. **Login cost.** Passwords use `bcryptjs` (pure JS, cost 12) which may hog the event loop. Write a second scenario where every iteration logs in, and compare throughput with the native `bcrypt` package.
2. **Feed query.** Each feed load runs `author $in [everyone you follow]`. Seed with more follows per user (edit `FOLLOWS_PER_USER`) and see how feed latency grows. In MongoDB shell: `db.posts.find({...}).explain('executionStats')` shows whether the index is used and how many documents are scanned.
3. **Slow queries.** `db.setProfilingLevel(1, { slowms: 50 })`, run the test, then `db.system.profile.find().sort({ts:-1}).limit(10)`.
4. **Single process.** Does a second API instance help? (It needs the Socket.io Redis adapter before realtime works across instances; REST alone would scale.)
5. **Connection pool.** The MongoDB driver pool size (`maxPoolSize`) is a tunable; check whether requests queue waiting for connections under load.


