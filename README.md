# 🎬 Cinema Watch Party

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

## API endpoints (used internally)

- `GET /api/cinemana/:id` → `{ title, videoUrl, quality, subtitles:[{lang,url}] }`
- `GET /api/sub?url=<subtitleUrl>` → the subtitle normalized to WebVTT, served same-origin

---

## Files

```
watchparty/
├── server.js          # Express + WebSocket relay + cinemana resolver + subtitle proxy
├── package.json
├── public/
│   ├── index.html     # Create/join a room
│   └── room.html      # Player (with CC), live chat, sync logic
├── smoketest.js       # Server test: sync + chat + late-join catch-up
├── unittest.js        # Logic test: SRT→VTT, quality pick, id parse, resolver (mocked)
└── README.md
```

Run the tests any time: `node unittest.js` and `node smoketest.js` (both print ✅).

---

## Notes & limits

- Designed for **2 people**, but the room code works for more (everyone in a room stays synced).
- No accounts, no database — rooms live in memory and clear when empty.
- Respect the source site's terms of service and only stream content you're allowed to.
