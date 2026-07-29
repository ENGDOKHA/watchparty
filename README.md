# 🎬 Cinema Watch Party

Watch a **cinemana.shabakaty.com** video **in perfect sync** with a friend — with **the site's real subtitles as toggleable CC** — plus **live chat** on the side. Rave/Teleparty-style, as a plain website.

Two people open the same room link. One presses play/pause/seek → it happens for both. Everyone chats live in a sidebar.

---

## How it works (cinemana mode — the main one)

Paste a **cinemana movie/episode link** (or just the numeric ID) into the room. The server calls cinemana's public API to get:

- the **direct MP4 stream** (highest quality available), and
- the **subtitle files** (`.srt`/`.vtt`) that cinemana ships for that title.

It plays the MP4 in a clean HTML5 player and loads those subtitles as **CC tracks** (turn them on with the player's CC button). Because it's our own player driving a plain video file, play / pause / seek sync **automatically and exactly** for both people — and you still get cinemana's subtitles.

> The browser can't call cinemana's API directly (cross-origin), so the Node server does it and also converts `.srt → .vtt` on the fly and serves the subtitles same-origin. Subtitle CC therefore needs the app to be running/deployed (it won't work opening the HTML files directly).

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
