# subtitle-proxy

A 200-line Node service that the Cloudflare Worker calls instead of hitting
YouTube directly. Exists because YouTube heavily rate-limits Cloudflare's
shared IP space, but is happy to serve any other host (your laptop, a Render
free-tier dyno, a NAS — anywhere with a residential or unflagged IP).

## What it does

Three endpoints, all returning JSON. The two POST endpoints require
`Authorization: Bearer <PROXY_TOKEN>` when the env var is set.

| Method | Path                | Body / Query             | Returns                                   |
|--------|---------------------|--------------------------|-------------------------------------------|
| GET    | `/healthz`          | —                        | `{ ok, uptime }`                          |
| POST   | `/youtube/meta`     | `{ videoId }`            | `{ title, durationSec, thumbnail, captionTracks }` |
| POST   | `/youtube/captions` | `{ baseUrl }`            | `{ lines: [{ start, dur, text }] }`       |

No dependencies — Node 18+ has native `fetch`. Run with `npm start`.

## Deploying to Render (free tier)

1. Push this directory to a GitHub repo (or use the parent monorepo with the
   "Root Directory" field set to `subtitle-proxy`).
2. On Render → New → Web Service → connect the repo.
3. Settings:
   - **Environment**: `Node`
   - **Build Command**: `pip install --user --break-system-packages -U yt-dlp && npm install`
     - This installs yt-dlp into `~/.local/bin` (on PATH by default). `-U`
       keeps it current since YouTube breaks yt-dlp every few weeks — Render
       auto-redeploys on each git push, which re-runs this and pulls latest.
     - `--break-system-packages` is needed on Ubuntu 23+ (PEP 668).
   - **Start Command**: `npm start`
   - **Region**: pick one close to YouTube's edge (Oregon works well)
4. Add environment variable:
   - `PROXY_TOKEN` = some long random string (e.g. `openssl rand -hex 24`)
5. Deploy. Note the URL — looks like `https://subtitle-proxy-XXXX.onrender.com`.

Free-tier dynos sleep after 15 minutes of inactivity; the first request after
sleep takes ~30 seconds to cold-start. Subsequent requests are fast.

## Wiring it to the Cloudflare Worker

Two values to set on the Worker:

```
# wrangler.toml [vars]
SUBTITLE_PROXY_URL = "https://subtitle-proxy-XXXX.onrender.com"

# wrangler secret put SUBTITLE_PROXY_TOKEN
# (paste the same string you used for PROXY_TOKEN on Render)
```

After redeploying the Worker, podcast imports use the proxy for YouTube
fetches. The manual subtitle-upload path stays as a fallback.

## Running locally for development

Prereq: `yt-dlp` must be installed (Python module):

```
pip3 install --user -U yt-dlp     # or: brew install yt-dlp
python3 -m yt_dlp --version       # sanity check
```

Then:

```
cd subtitle-proxy
PROXY_TOKEN=devtoken npm start
# → subtitle-proxy listening on :3001
```

```
curl -X POST http://localhost:3001/youtube/meta \
  -H "Authorization: Bearer devtoken" \
  -H "Content-Type: application/json" \
  -d '{"videoId":"dQw4w9WgXcQ"}'
```
