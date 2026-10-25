# Quick live demo without a VPS or domain (single service)

**Status: written from general knowledge of these platforms; Untested outline; check each platform’s current free-tier terms. Free-tier terms change often, so check them before relying on this.**

Vercel/Netlify host static sites and short serverless functions. This app needs a **long-running Node process** (WebSockets) and a database, so the backend can't run there. Use a host that runs a normal Node server. The pieces:

| Piece | Free-ish option |
|---|---|
| Node server (API + built React app) | Render, Railway, Fly.io, Koyeb ... (pick one whose current free tier allows web services and WebSockets) |
| MongoDB | MongoDB Atlas free cluster (M0) |
| Email | none needed for a demo (see below) |

## Steps (Render-style PaaS)

1. **Atlas:** create a free cluster → Database Access: create a user → Network Access: allow the platform's outbound IPs (free PaaS IPs change, so many people temporarily allow `0.0.0.0/0`; that is a real security trade-off, so use a strong DB password and a throwaway database) → copy the `mongodb+srv://...` connection string and add a database name (`.../socialapp`).
2. Push the repo to GitHub, create a **Web Service** from it.
3. Build command:
   ```
   cd client && npm ci && npm run build && cd ../server && npm ci --omit=dev
   ```
   Start command: `cd server && npm start`
4. Environment variables:

   | Name | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `MONGODB_URI` | your Atlas string |
   | `JWT_SECRET` | output of `openssl rand -hex 48` (or any random 48+ char string) |
   | `CLIENT_DIR` | `../client/dist` (relative to `server/`) |
   | `ALLOW_NO_SMTP` | `true` (demo only: emails are logged, not sent) |
   | `REQUIRE_EMAIL_VERIFICATION` | `false` (nobody can receive a verification email in a no-SMTP demo) |
   | `TRUST_PROXY` | `1` (adjust if the platform puts more than one proxy in front; wrong values make all users share one rate-limit bucket) |
   | `UPLOADS_DIR` | leave default |

5. Open the service URL. Register, post, chat from two browsers/profiles.

## Know the limits of a free demo

- **Cold starts:** free instances usually sleep after inactivity; the first visit can take a minute. Open it yourself right before sharing the link.
- **Uploaded images disappear** on restart/redeploy (ephemeral disk). Fine for a demo; for real use attach a persistent disk or move images to object storage.
- **Password reset doesn't work** without SMTP (the demo flags above turn emails into log lines).
- Free tiers can change or vanish. For something durable, the Docker Compose setup on a small VPS is the intended deployment.
