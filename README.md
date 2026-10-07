# Sky Shards

A voxel race across floating islands. Everyone online plays the same daily world, sees other runners as ghosts, and competes on a daily leaderboard.

- Hold left mouse to mine (cracks, chips, per-block hardness), right mouse to place
- Clouds are your bridges and melt 20 s after placing
- Each crystal shard gives +12 clouds; the void costs 4
- Nickname, live "online" list, ghosts with name tags, Today / All time leaderboard
- Share-on-X button and a preview card (`public/og.png`) for links on Twitter

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

## Deploy on Render (free)

1. Push this folder to a new GitHub repository.
2. On render.com: **New → Web Service**, pick the repository.
3. Settings: Runtime **Node**, Build command `npm install`, Start command `npm start`, Instance type **Free**.
4. Deploy. Your link will look like `https://sky-shards-xxxx.onrender.com`.

### Keep the leaderboard between restarts

Render's free disk is wiped on every deploy and restart, so by default the leaderboard resets then. To keep it, create a free Redis database at upstash.com and add two environment variables to the Render service:

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

### Notes

- Free Render services sleep after 15 minutes without visitors; the first visit after that takes about 30–60 seconds to wake.
- The server rejects runs under 20 seconds or faster than the real time since the run started. Nicknames are cleaned and a short blocklist of slurs is applied (edit `BLOCK` in `server.js`).
