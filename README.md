# 🎬 غرفتنا (Ghurfatna)

Watch a **cinemana.shabakaty.com** video **in perfect sync** with a friend — with **the site's real subtitles as toggleable CC** — plus **live chat** on the side. Rave/Teleparty-style, as a plain website.

Two people open the same room link. One presses play/pause/seek → it happens for both. Everyone chats live in a sidebar.

---

## How it works (important: cinemana is network-restricted)

Cinemana is only reachable **from a specific country / ISP**. A cloud host (Render, Vercel, etc.) sits outside that network and **cannot reach cinemana at all**. So this app is built the only way that works:

- **Each viewer's browser** fetches the video + subtitles directly from cinemana, over their own connection.
- **The server only relays** play/pause/seek events and chat messages. It never touches cinemana, so it can be hosted anywhere.

Both viewers must be on the network where cinemana works (and not on a VPN). Each browser resolves its **own** stream URL — necessary anyway, since cinemana's URLs are signed/expiring and typically IP-bound. That's why the app syncs the video **ID**, not the URL.

Paste a **cinemana movie/episode link** (or just the numeric ID). The browser calls cinemana's API for the best MP4 plus the subtitle list, plays it in a clean HTML5 player, and attaches subtitles as **CC tracks** (blob URLs, so no CORS problems). Play / pause / seek then sync exactly for both people.

### If subtitles (or the API) are blocked by CORS
Cinemana's API may refuse direct browser requests. The app degrades gracefully:

1. Press **🔍 Test** in the room — it reports exactly what's reachable.
2. Use **💬 Add subtitle file** to load a `.srt`/`.vtt` from your PC (always works).
3. Or grab the direct `.mp4` (F12 → Network → Media on cinemana) and paste that with **🔄 Change**.

### Other inputs it accepts
- A **direct `.mp4` / `.m3u8` URL** → same automatic sync (no subtitles unless the stream has them).
- Any **other page URL** → falls back to embedding it in a frame + chat with manual **"play now / pause now"** ping buttons. (Auto-sync isn't possible for a third-party site's own player — that's a browser security limit, and the reason Teleparty/Rave are extensions.)

---

## Run it locally (test on your computer)

Requires Node.js 18+.

```bash
cd watchparty
npm install
npm start
```

Open **http://localhost:3000**. To let a friend on another network join, use a tunnel:

```bash
npx localtunnel --port 3000     # or: ngrok http 3000
```

Share the `https://…` URL it prints.

---

## Deploy free (Render — recommended)

1. Push this `watchparty` folder to a **GitHub** repo.
2. Go to **render.com** → **New → Web Service** → connect your repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Deploy. Render gives you a public `https://your-app.onrender.com` URL. WebSockets work out of the box.

> The free tier sleeps after inactivity and takes ~30s to wake on the first visit — normal for free hosting.

**Other free options that also work:** Railway, Glitch, Fly.io, Cyclic. Any host that runs a Node process and allows WebSockets is fine.

---

## How to use

1. Open the site, enter your name, paste a **cinemana link** (or video ID / `.mp4` URL), hit **Start**.
2. Click **🔗 Copy invite** and send the link to your friend.
3. When they open it, you're in the same room — the video + subtitles load for both of you, play/pause/seek stay synced, chat away. Turn subtitles on with the **CC** button.

---

## Per-viewer settings (independent for each person)

These never affect the other person — only the shared timeline is synced:

| Control | What it does |
|---|---|
| **Quality** dropdown | Each viewer picks their own resolution (or Auto = best). Switching holds your position and doesn't send a seek, so the other person sees nothing. Your choice is remembered for the next video too. |
| **Align** (−1s / +1s / Match now) | Corrects an offset between two different copies of the same movie. |
| **💬 Subtitle file** | Loads a local `.srt`/`.vtt` as CC, just for you. |
| **⏱ Take lead** | Become the timing leader. |

## Watching from two different sites

Each person pastes their own link and clicks **"Just for me (different site)"**. Only play/pause/seek/time is shared. If the copies don't start at the same frame, get to the same moment and press **Match now** once.

## How the sync stays stable

The old naive approach oscillates: one person buffers, broadcasts a frozen position, the other jumps back, that jump echoes back, and both rubber-band. Fixes, all in `public/sync-logic.js` (unit-tested):

- **One timing leader.** Only the leader's drift heartbeats are authoritative; the server drops everyone else's. Play/pause/seek still work from either side.
- **Stalls are never broadcast**, so a buffering viewer can't drag anyone backwards.
- **Skip forward on recovery** — after buffering you jump ahead to rejoin the group instead of resuming where you froze (capped at 90s).
- **Deadband + easing.** Drift under 0.35s is ignored; up to 2.5s is smoothed out with a ±5% playback-speed nudge; only bigger gaps cause a jump, and never more than once every 4s.
- **Sequence numbers** drop stale/out-of-order messages.

## Other sites (albox etc.)

Paste any site's **watch-page URL** and the server fetches that page and digs the real
`.mp4`/`.m3u8` out of the HTML (the browser can't — cross-origin). If it finds one, it plays
it with full sync. Order of attempts:

1. Cinemana link/ID → cinemana API (in your browser).
2. A direct `.mp4`/`.m3u8` → played immediately (`.m3u8` via hls.js).
3. Any other page → `GET /api/resolve` scrapes it for a stream link.
4. Nothing found → the page is embedded, with instructions for grabbing the link by hand.

Note that a page ID (e.g. `/show/play/1041177`) usually maps to an opaque file name
(`/episodes/<uuid>.mp4`) that **cannot be computed** — it has to be read from the page or API.
If the host's file URL has no token/expiry in it, it works for both viewers and can be shared
with "Load for everyone".

Subtitles for such files: use **🌐 Subs from cinemana** to borrow cinemana's subtitle track for
the same movie, then align it with the **Subs ±0.5s** buttons.

### Shared subtitles (when only one of you can reach the subtitle source)

Subtitles are **relayed through the room**. Whoever can fetch a subtitle (or loads a `.srt` from
their PC) automatically shares the file with everyone else, and late joiners receive it on connect.
So if only one viewer can reach cinemana, they get the subtitles and the other viewer still sees
them. Each person keeps their own **Subs ±0.5s** timing, since their copy of the video may differ.

Limits: up to 6 tracks per room, 600 KB each; cleared when a new movie is loaded for everyone.

## API endpoints (used internally)

- `GET /api/cinemana/:id` → `{ title, videoUrl, quality, subtitles:[{lang,url}] }`
- `GET /api/sub?url=<subtitleUrl>` → the subtitle normalized to WebVTT, served same-origin
- `GET /api/resolve?url=<pageUrl>` → `{ streams:[...] }` scraped from that page
- `GET /debug/cinemana/:id`, `GET /healthz` → diagnostics

---

## Files

```
watchparty/
├── server.js          # Express + WebSocket relay + cinemana resolver + subtitle proxy
├── package.json
├── public/
│   ├── index.html     # Create/join a room
│   ├── room.html      # Player (CC + quality), live chat, sync
│   └── sync-logic.js  # Pure sync/quality math, shared with the tests
├── smoketest.js       # Server test: relay, catch-up, leader rules
├── unittest.js        # Logic test: drift, offsets, stalls, quality, SRT→VTT
├── push.bat           # One-click: copy files, commit, push (Windows)
└── README.md
```

Run the tests any time: `node unittest.js` (37 checks) and `node smoketest.js` (7 checks) — both print ✅.

---

## Notes & limits

- Designed for **2 people**, but the room code works for more (everyone in a room stays synced).
- No accounts, no database — rooms live in memory and clear when empty.
- Respect the source site's terms of service and only stream content you're allowed to.
