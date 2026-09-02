/**
 * The player can only warn about a lost connection if it can tell a lost
 * connection apart from a queue that simply finished. Both used to arrive as
 * close code 1006, because the server returned from the WebSocket endpoint
 * without ever performing the closing handshake. This proves they now differ:
 *
 *   queue finished -> 1000, wasClean (server closes explicitly)
 *   server killed  -> 1006, not clean (no close frame ever sent)
 *
 * Requires: ffmpeg, and a Python with the server deps (fastapi/uvicorn/opencv).
 *   Override the interpreter with ASCIL_PY (e.g. ASCIL_PY=.venv/bin/python).
 *
 * Usage: node test/test_close_code.js
 */
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
if (typeof WebSocket === 'undefined') {
  global.WebSocket = require('ws');
}

const PY = process.env.ASCIL_PY || 'python3';
const REPO = path.dirname(__dirname);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.on('connect', () => { sock.destroy(); resolve(); });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error('server did not start'));
        else setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

// stdin must stay OPEN: the server runs an interactive command loop on the main
// thread (uvicorn is a daemon thread), and EOF on stdin kills it.
async function startServer(clip, port) {
  const server = spawn(PY, ['stream_server.py', clip, '--mode', '2', '--vol', '0',
    '--cols', '80', '--no-thumbnails', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: REPO, stdio: ['pipe', 'ignore', 'ignore'] });
  server.on('error', (e) => { throw e; });
  await waitForPort(port, 15000);
  return server;
}

// Resolve with the CloseEvent the browser player would see. onFirstFrame runs
// once the stream is actually flowing, so a kill lands mid-stream.
function awaitClose(port, timeoutMs, onFirstFrame) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?codec=adaptive`);
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      reject(new Error(`no close event within ${timeoutMs}ms`));
    }, timeoutMs);
    let fired = false;
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string' || fired || !onFirstFrame) return;
      fired = true;
      onFirstFrame();
    };
    ws.onerror = () => {};  // an abrupt drop errors first, then closes
    ws.onclose = (ev) => {
      clearTimeout(timer);
      resolve({ code: ev.code, wasClean: ev.wasClean });
    };
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ascil-close-'));
  const shortClip = path.join(tmp, 'short.mp4');
  const longClip = path.join(tmp, 'long.mp4');
  let finished = null, killed = null;
  try {
    // Frames are paced in real time, so the short clip bounds how long the
    // finished-queue case takes, and the long one guarantees the kill is mid-stream.
    for (const [file, duration] of [[shortClip, 2], [longClip, 30]]) {
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', `testsrc=size=160x120:rate=24:duration=${duration}`,
        '-pix_fmt', 'yuv420p', file,
      ], { stdio: 'ignore' });
    }

    const portA = await freePort();
    finished = await startServer(shortClip, portA);
    const onQueueEnd = await awaitClose(portA, 30000, null);

    const portB = await freePort();
    killed = await startServer(longClip, portB);
    const onKill = await awaitClose(portB, 30000, () => killed.kill('SIGKILL'));

    const checks = [
      ['finished queue closes cleanly', onQueueEnd.wasClean, `wasClean=${onQueueEnd.wasClean}`],
      ['finished queue reports code 1000', onQueueEnd.code === 1000, `code=${onQueueEnd.code}`],
      ['killed server does not look clean', !onKill.wasClean, `wasClean=${onKill.wasClean}`],
      ['killed server reports code 1006', onKill.code === 1006, `code=${onKill.code}`],
      ['the two cases are distinguishable', onQueueEnd.code !== onKill.code,
        `both=${onKill.code}`],
    ];

    let failed = 0;
    for (const [name, ok, why] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + why}`);
      if (!ok) failed++;
    }
    console.log(`\nqueue finished: ${JSON.stringify(onQueueEnd)}  |  ` +
      `server killed: ${JSON.stringify(onKill)}`);
    console.log(`${checks.length - failed}/${checks.length} passed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    for (const s of [finished, killed]) if (s) s.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('ERROR', e); process.exit(2); });
