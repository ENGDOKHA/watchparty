// Boots the server, connects two clients, verifies sync + chat relay + catch-up.
const { spawn } = require('child_process');
const WebSocket = require('ws');

const srv = spawn('node', ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '3999' } });
srv.stdout.on('data', d => process.stdout.write('[srv] ' + d));
srv.stderr.on('data', d => process.stderr.write('[srv-err] ' + d));

const results = { syncRelayed: false, chatRelayed: false, catchUp: false };

// Wait until the server logs that it is listening, then run the checks.
srv.stdout.on('data', d => { if (String(d).includes('running')) start(); });
let started = false;
function start() {
  if (started) return; started = true;
  const a = new WebSocket('ws://localhost:3999/?room=test&name=Ali');
  const b = new WebSocket('ws://localhost:3999/?room=test&name=Sara');

  b.on('message', d => {
    const m = JSON.parse(d);
    if (m.type === 'sync' && m.action === 'play' && m.time === 5) results.syncRelayed = true;
    if (m.type === 'chat' && m.text === 'hi there') results.chatRelayed = true;
  });

  a.on('open', () => setTimeout(() => {
    a.send(JSON.stringify({ type: 'load', mode: 'cinemana', cinemanaId: '25006' }));
    a.send(JSON.stringify({ type: 'sync', action: 'play', time: 5, paused: false, mode: 'cinemana', cinemanaId: '25006' }));
    a.send(JSON.stringify({ type: 'chat', text: 'hi there' }));

    // Late joiner should receive current cinemana state in its welcome.
    setTimeout(() => {
      const c = new WebSocket('ws://localhost:3999/?room=test&name=Late');
      c.on('message', d => {
        const m = JSON.parse(d);
        if (m.type === 'welcome' && m.state && m.state.cinemanaId === '25006' && m.state.mode === 'cinemana') results.catchUp = true;
      });
    }, 400);
  }, 400));

  setTimeout(() => {
    console.log('RESULTS:', JSON.stringify(results));
    const ok = results.syncRelayed && results.chatRelayed && results.catchUp;
    console.log(ok ? 'ALL PASS ✅' : 'FAIL ❌');
    srv.kill();
    process.exit(ok ? 0 : 1);
  }, 2500);
}
// Fallback in case the log line was missed (cold start can be slow).
setTimeout(start, 9000);
