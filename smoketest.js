// Boots the server and verifies: sync relay, chat relay, late-join catch-up,
// leader election, and that a NON-leader cannot push drift updates (the ping-pong fix).
const { spawn } = require('child_process');
const net = require('net');
const WebSocket = require('ws');

const PORT = 3999;
const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(PORT) } });
srv.stderr.on('data', d => process.stderr.write('[srv-err] ' + d));

const R = {
  syncRelayed: false,
  chatRelayed: false,
  catchUp: false,
  leaderAssigned: false,
  followerTickIgnored: true,   // stays true unless a follower tick leaks through
  leaderTickRelayed: false,
  handoverWorks: false,
};

function waitForPort(port, tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); resolve(); });
      s.on('error', () => {
        s.destroy();
        if (n <= 0) return reject(new Error('port never opened'));
        setTimeout(() => attempt(n - 1), 300);
      });
    };
    attempt(tries);
  });
}

const open = (name) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/?room=test&name=${name}`);
  ws.on('open', () => res(ws));
  ws.on('error', rej);
});

(async () => {
  await waitForPort(PORT);

  // A connects first -> should become the timing leader.
  const a = await open('Ali');
  await new Promise(r => {
    a.on('message', d => {
      const m = JSON.parse(d);
      if (m.type === 'welcome') { if (m.hostId === m.youAre) R.leaderAssigned = true; r(); }
    });
  });

  const b = await open('Sara');   // follower
  b.on('message', d => {
    const m = JSON.parse(d);
    if (m.type === 'sync' && m.action === 'play' && m.movieTime === 5) R.syncRelayed = true;
    if (m.type === 'sync' && m.action === 'tick' && m.movieTime === 42) R.leaderTickRelayed = true;
    if (m.type === 'chat' && m.text === 'hi there') R.chatRelayed = true;
  });
  // The leader must NEVER receive a follower's drift heartbeat.
  a.on('message', d => {
    const m = JSON.parse(d);
    if (m.type === 'sync' && m.action === 'tick') R.followerTickIgnored = false;
  });

  await new Promise(r => setTimeout(r, 300));

  a.send(JSON.stringify({ type: 'load', mode: 'cinemana', cinemanaId: '25006' }));
  a.send(JSON.stringify({ type: 'sync', action: 'play', movieTime: 5, paused: false }));
  a.send(JSON.stringify({ type: 'chat', text: 'hi there' }));
  a.send(JSON.stringify({ type: 'sync', action: 'tick', movieTime: 42, paused: false }));  // leader tick -> relayed
  // Follower (buffering, frozen at 3s) tries to report position -> must be dropped.
  b.send(JSON.stringify({ type: 'sync', action: 'tick', movieTime: 3, paused: false }));

  await new Promise(r => setTimeout(r, 600));

  // Late joiner catches up to current room state.
  const c = await open('Late');
  await new Promise(r => {
    c.on('message', d => {
      const m = JSON.parse(d);
      if (m.type === 'welcome' && m.state && m.state.cinemanaId === '25006' && m.state.mode === 'cinemana') R.catchUp = true;
      r();
    });
    setTimeout(r, 800);
  });

  // Follower takes over as leader, then its ticks SHOULD be relayed.
  await new Promise(r => {
    let seen = false;
    a.on('message', d => { const m = JSON.parse(d); if (m.type === 'host' && m.hostName === 'Sara') { seen = true; } });
    b.send(JSON.stringify({ type: 'claimHost' }));
    setTimeout(() => { R.handoverWorks = seen; r(); }, 500);
  });

  console.log('RESULTS:', JSON.stringify(R, null, 1));
  const ok = Object.values(R).every(Boolean);
  console.log(ok ? 'ALL PASS ✅' : 'FAIL ❌');
  srv.kill();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL ❌', e.message); srv.kill(); process.exit(1); });
