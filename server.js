#!/usr/bin/env node
// Detour — phone-controlled Premiere Pro screen.
// Zero dependencies: Node stdlib only. No install, no build step.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  DEFAULT_STATE, currentPct, currentElapsedMs, currentBattery, currentClock, clampPct,
} = require('./public/shared.js');

const ROOT = __dirname;
const START_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT = START_PORT + 10;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- state

let state = structuredClone(DEFAULT_STATE);
const clients = new Set();

function broadcast() {
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

// Freeze the live percentage into basePct, so later edits build on what's
// actually on screen rather than snapping back to an old value.
function settle(now = Date.now()) {
  state.render.basePct = currentPct(state.render, now);
  state.render.runningSince = now;
}

function settlePower(now = Date.now()) {
  state.power.basePct = currentBattery(state.power, now);
  state.power.runningSince = now;
}

// Starts the elapsed-time clock the first time the render is touched, same
// spot the old startedAt ??= now used to fire. A no-op once it's running.
function ensureElapsedRunning(now = Date.now()) {
  state.render.elapsedAnchorMs ??= now;
}

function apply(msg) {
  const now = Date.now();
  const r = state.render;
  const p = state.power;

  switch (msg.cmd) {
    case 'reset': {
      // The clock is a continuity setting for the whole shoot, not take state
      // — cue 1 resets before every take and must not wipe it.
      const keptClock = state.clock;
      state = structuredClone(DEFAULT_STATE);
      state.clock = keptClock;
      break;
    }

    case 'render.show':
      r.visible = !!msg.on;
      break;

    case 'render.set': // absolute jump
      r.basePct = clampPct(Number(msg.pct));
      r.runningSince = now;
      ensureElapsedRunning(now);
      break;

    case 'render.nudge':
      settle(now);
      r.basePct = clampPct(r.basePct + Number(msg.delta));
      break;

    case 'render.play':
      settle(now);
      r.paused = false;
      r.stalled = false;
      ensureElapsedRunning(now);
      break;

    case 'render.pause':
      settle(now);
      r.paused = true;
      break;

    case 'render.stall':
      settle(now);
      r.stalled = !!msg.on;
      if (r.stalled) ensureElapsedRunning(now);
      break;

    case 'render.elapsed.set': // jump the elapsed clock, then keep counting up
      r.elapsedMs = Math.max(0, Number(msg.secs) || 0) * 1000;
      r.elapsedAnchorMs = now;
      break;

    case 'render.rate':
      settle(now);
      r.rate = Math.max(0, Number(msg.rate));
      break;

    case 'render.filename':
      if (typeof msg.filename === 'string') r.filename = msg.filename.slice(0, 80);
      break;

    case 'battery':
      state.battery = ['none', 'banner', 'modal'].includes(msg.style) ? msg.style : 'none';
      break;

    case 'power.set': // absolute battery level
      p.basePct = clampPct(Number(msg.pct));
      p.runningSince = now;
      break;

    case 'power.drain':
      settlePower(now);
      p.draining = !!msg.on;
      if (msg.perMin != null) p.drainPerMin = Math.max(0, Number(msg.perMin));
      break;

    case 'power.rate':
      settlePower(now);
      p.drainPerMin = Math.max(0, Number(msg.perMin));
      break;

    case 'glitch.set':
      state.glitch.on = !!msg.on;
      if (msg.intensity != null) {
        state.glitch.intensity = Math.max(1, Math.min(3, Math.round(Number(msg.intensity))));
      }
      break;

    case 'glitch.burst':
      if (msg.intensity != null) {
        state.glitch.intensity = Math.max(1, Math.min(3, Math.round(Number(msg.intensity))));
      }
      state.glitch.burstUntil = now + Math.max(60, Math.min(10000, Number(msg.ms) || 420));
      break;

    case 'black':
      state.black = {
        on: !!msg.on,
        fadeMs: Math.max(0, Number(msg.fadeMs) || 0),
        wake: !!msg.wake,
      };
      break;

    case 'deadbattery':
      state.dead.untilMs = now + Math.max(300, Math.min(20000, Number(msg.ms) || 2600));
      break;

    case 'clock.set':
      state.clock.mode = 'custom';
      state.clock.setMs = Number(msg.ms);
      state.clock.baseMs = Number(msg.ms);
      state.clock.anchorMs = now;
      if (msg.running != null) state.clock.running = !!msg.running;
      break;

    case 'clock.reset': // jump back to the value that was typed
      if (state.clock.setMs == null) break;
      state.clock.mode = 'custom';
      state.clock.baseMs = state.clock.setMs;
      state.clock.anchorMs = now;
      break;

    case 'clock.run':
      // Freezing keeps whatever is on screen right now as the new base.
      state.clock.baseMs = currentClock(state.clock, now);
      state.clock.anchorMs = now;
      state.clock.running = !!msg.on;
      break;

    case 'clock.real':
      state.clock.mode = 'real';
      break;

    case 'bg':
      state.bg = msg.bg === 'image' ? 'image' : 'fake';
      break;

    case 'menubar':
      state.menubar = !!msg.on;
      break;

    default:
      return false;
  }
  return true;
}

// ---------------------------------------------------------------- http

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  // Path traversal guard — everything we serve lives under ROOT.
  if (pathname.includes('..')) {
    res.writeHead(400).end('Bad path');
    return;
  }

  if (req.method === 'POST' && pathname === '/cmd') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const cmds = Array.isArray(msg) ? msg : [msg];
        let changed = false;
        for (const c of cmds) changed = apply(c) || changed;
        if (changed) broadcast();
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end('Bad JSON');
      }
    });
    return;
  }

  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 1000\n\n`);
    res.write(`data: ${JSON.stringify(state)}\n\n`); // correct on frame one
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (pathname === '/' || pathname === '/control') {
    serveFile(res, path.join(ROOT, 'public', 'control.html'));
    return;
  }
  if (pathname === '/screen') {
    serveFile(res, path.join(ROOT, 'public', 'screen.html'));
    return;
  }

  // Static: /assets/* from assets/, everything else from public/.
  const rel = pathname.replace(/^\//, '');
  const dir = rel.startsWith('assets/') ? ROOT : path.join(ROOT, 'public');
  serveFile(res, path.join(dir, rel));
});

// Keep idle SSE connections from being reaped by the OS or a proxy.
setInterval(() => {
  for (const res of clients) {
    try {
      res.write(': ping\n\n');
    } catch {
      clients.delete(res);
    }
  }
}, 15000).unref();

// ---------------------------------------------------------------- boot

function lanIP() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return 'localhost';
}

function listen(port) {
  const onError = (err) => {
    if (err.code === 'EADDRINUSE' && port < MAX_PORT) {
      listen(port + 1);
    } else {
      console.error(`\n  Could not start server: ${err.message}\n`);
      process.exit(1);
    }
  };
  server.once('error', onError);
  server.listen(port, '0.0.0.0', () => {
    // Bound. Disarm the retry, or a late error would bind a second port
    // and leave two servers running with divergent state.
    server.removeListener('error', onError);
    const ip = lanIP();
    const line = '─'.repeat(52);
    console.log(`\n  ┌${line}┐`);
    console.log(`  │  ANTI — pantalla interactiva`.padEnd(55) + '│');
    console.log(`  ├${line}┤`);
    console.log(`  │  SCREEN  (this laptop)`.padEnd(55) + '│');
    console.log(`  │    http://localhost:${port}/screen`.padEnd(55) + '│');
    console.log(`  │`.padEnd(55) + '│');
    console.log(`  │  PHONE   (same Wi-Fi)`.padEnd(55) + '│');
    console.log(`  │    http://${ip}:${port}/control`.padEnd(55) + '│');
    console.log(`  └${line}┘`);
    console.log(`\n  Ctrl+C to stop.\n`);
  });
}

listen(START_PORT);
