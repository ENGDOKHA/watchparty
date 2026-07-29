// غرفتنا (Ghurfatna) — sync + chat relay server, with a cinemana resolver.
// Express serves the UI and proxies cinemana's API (streams + subtitles);
// ws relays play/pause/seek and chat between everyone in a room.
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const CINEMANA_BASE = 'https://cinemana.shabakaty.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ---------- cinemana helpers ----------
// fetch with a timeout so a slow/blocking upstream can't hang the request forever.
async function fetchTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function cineFetch(pathname) {
  const res = await fetchTimeout(`${CINEMANA_BASE}${pathname}`, {
    headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*' },
  });
  if (!res.ok) throw new Error(`cinemana ${pathname} -> HTTP ${res.status}`);
  return res;
}

// Pick the highest-resolution mp4 from the transcoded list.
function pickBest(qualities) {
  if (!Array.isArray(qualities) || !qualities.length) return null;
  const resNum = (q) => {
    const m = String(q?.resolution || q?.name || '').match(/(\d+)/);
    return m ? Number(m[1]) : -1;
  };
  return [...qualities].filter(q => q?.videoUrl).sort((a, b) => resNum(a) - resNum(b)).pop() || null;
}

// Resolve a cinemana video id -> { title, videoUrl, subtitles:[{lang,url}] }
async function resolveCinemana(id) {
  const [infoRes, filesRes, subsRes] = await Promise.allSettled([
    cineFetch(`/api/android/allVideoInfo/id/${id}`),
    cineFetch(`/api/android/transcoddedFiles/id/${id}`),
    cineFetch(`/api/android/translationFiles/id/${id}`),
  ]);

  let title = `Video ${id}`;
  if (infoRes.status === 'fulfilled') {
    try { const i = await infoRes.value.json(); title = (i.en_title || i.ar_title || i.other_title || title).trim(); } catch {}
  }

  let qualities = [];
  if (filesRes.status === 'fulfilled') { try { qualities = await filesRes.value.json(); } catch {} }
  const best = pickBest(qualities);
  if (!best) throw new Error('No playable video found for this id.');

  let subtitles = [];
  if (subsRes.status === 'fulfilled') {
    try {
      const s = await subsRes.value.json();
      const tracks = Array.isArray(s?.translations) ? s.translations : (Array.isArray(s) ? s : []);
      subtitles = tracks
        .map(t => ({ lang: (t.name || t.type || 'sub').toString(), url: t.file || t.url }))
        .filter(t => t.url && !/defaultImages\/loading\.gif/i.test(t.url));
    } catch {}
  }

  return { id: String(id), title, videoUrl: best.videoUrl, quality: best.name || best.resolution || '', subtitles };
}

// Convert SRT text to WebVTT so the browser <track> can render it.
function srtToVtt(srt) {
  let body = srt.replace(/\r+/g, '').replace(/^﻿/, '');
  // timestamps: 00:00:01,000 --> 00:00:04,000  =>  ...01.000 --> ...04.000
  body = body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return 'WEBVTT\n\n' + body;
}

// ---------- API routes ----------
app.get('/api/cinemana/:id', async (req, res) => {
  try {
    const data = await resolveCinemana(req.params.id.replace(/\D/g, ''));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Health + debug endpoints (plain text so they're easy to check from anywhere).
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.get('/debug/cinemana/:id', async (req, res) => {
  const id = req.params.id.replace(/\D/g, '');
  try {
    const data = await resolveCinemana(id);
    res.type('text').send(
      `OK id=${id}\ntitle=${data.title}\nvideoUrl=${data.videoUrl ? 'yes' : 'no'}\n` +
      `quality=${data.quality}\nsubtitles=${data.subtitles.length}\n` +
      data.subtitles.map(s => ' - ' + s.lang).join('\n')
    );
  } catch (e) {
    res.status(502).type('text').send('CINEMANA FETCH FAILED from this server:\n' + e.message);
  }
});

// Proxy + normalize a subtitle file to VTT, served same-origin (avoids CORS on <track>).
app.get('/api/sub', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).send('bad url');
  try {
    const r = await fetchTimeout(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) return res.status(502).send('sub fetch failed');
    let text = await r.text();
    if (!/^﻿?WEBVTT/.test(text)) text = srtToVtt(text); // convert if it isn't already VTT
    res.set('Content-Type', 'text/vtt; charset=utf-8');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(text);
  } catch (e) {
    res.status(502).send('sub error');
  }
});

// /r/<roomId> serves the room page.
app.get('/r/:roomId', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'room.html')));

// ---------- WebSocket sync + chat ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map(); // roomId -> { clients:Set, state, chat:[], hostId, seq }
let nextClientId = 1;

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      clients: new Set(),
      // movieTime = position on the SHARED timeline (each viewer maps it to their own copy)
      state: { mode: 'video', src: null, cinemanaId: null, movieTime: 0, paused: true, updatedAt: Date.now() },
      chat: [],
      hostId: null,   // the timing leader: only their drift reports are authoritative
      seq: 0,         // increments on every state change so clients can drop stale messages
    };
    rooms.set(roomId, room);
  }
  return room;
}
function broadcast(room, data, except) {
  const msg = JSON.stringify(data);
  for (const c of room.clients) if (c !== except && c.readyState === 1) c.send(msg);
}
function hostName(room) {
  for (const c of room.clients) if (c.clientId === room.hostId) return c.name;
  return null;
}
function announceHost(room) {
  broadcast(room, { type: 'host', hostId: room.hostId, hostName: hostName(room) });
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const roomId = (url.searchParams.get('room') || 'lobby').slice(0, 64);
  const name = (url.searchParams.get('name') || 'Guest').slice(0, 24);
  const room = getRoom(roomId);
  ws.roomId = roomId; ws.name = name; ws.clientId = nextClientId++;
  room.clients.add(ws);
  if (room.hostId === null) room.hostId = ws.clientId; // first person leads the timing

  ws.send(JSON.stringify({
    type: 'welcome', state: room.state, chat: room.chat, count: room.clients.size,
    youAre: ws.clientId, hostId: room.hostId, hostName: hostName(room), seq: room.seq,
  }));
  broadcast(room, { type: 'presence', count: room.clients.size, name, event: 'join' }, ws);
  announceHost(room);

  ws.on('message', (raw) => {
    let data; try { data = JSON.parse(raw); } catch { return; }
    switch (data.type) {
      case 'sync': {
        const intentional = data.action === 'play' || data.action === 'pause' || data.action === 'seek';
        // Drift heartbeats ('tick') are only trusted from the timing leader.
        // This is what stops the back-and-forth: a buffering follower can no longer
        // drag everyone else back to its frozen position.
        if (!intentional && ws.clientId !== room.hostId) return;

        room.state = {
          mode: data.mode ?? room.state.mode,
          src: data.src ?? room.state.src,
          cinemanaId: data.cinemanaId ?? room.state.cinemanaId,
          movieTime: typeof data.movieTime === 'number' ? data.movieTime : room.state.movieTime,
          paused: typeof data.paused === 'boolean' ? data.paused : room.state.paused,
          updatedAt: Date.now(),
        };
        room.seq++;
        broadcast(room, { type: 'sync', ...room.state, seq: room.seq, by: name, action: data.action }, ws);
        break;
      }
      case 'load': {
        room.state = {
          mode: data.mode || 'video', src: data.src || null, cinemanaId: data.cinemanaId || null,
          movieTime: 0, paused: true, updatedAt: Date.now(),
        };
        room.seq++;
        broadcast(room, { type: 'load', ...room.state, seq: room.seq, by: name });
        break;
      }
      case 'chat': {
        const entry = { name, text: String(data.text || '').slice(0, 500), t: Date.now() };
        if (!entry.text) return;
        room.chat.push(entry); if (room.chat.length > 100) room.chat.shift();
        broadcast(room, { type: 'chat', ...entry });
        break;
      }
      case 'claimHost': {
        room.hostId = ws.clientId;
        announceHost(room);
        broadcast(room, { type: 'chat', name: 'system', text: `${name} is now the timing leader.`, t: Date.now() });
        break;
      }
      // A viewer reports they are buffering — purely informational, never moves anyone.
      case 'buffering': broadcast(room, { type: 'buffering', by: name, active: !!data.active }, ws); break;
      case 'ping': broadcast(room, { type: 'ping', by: name, action: data.action }, ws); break;
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    broadcast(room, { type: 'presence', count: room.clients.size, name, event: 'leave' });
    if (room.hostId === ws.clientId) {
      const next = room.clients.values().next().value;
      room.hostId = next ? next.clientId : null;
      if (next) announceHost(room);
    }
    if (room.clients.size === 0) setTimeout(() => { if (room.clients.size === 0) rooms.delete(roomId); }, 5 * 60 * 1000);
  });
});

// Exported for unit tests; only listen when run directly.
module.exports = { srtToVtt, pickBest, resolveCinemana };
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`Ghurfatna running on http://localhost:${PORT}`));
}
