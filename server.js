/**
 * server.js — Rongali Bihu DFW programme server
 *
 * Replaces `npx serve` with a tiny Node-core HTTP server that:
 *   • Serves all static files (HTML, CSS, JS, images, audio) with range-request
 *     support so the dhol MP3 streams correctly on mobile/iOS Safari.
 *   • Holds an in-memory "control state" { music, banner } that admin.html
 *     can change via POST /control.
 *   • Broadcasts every state change via Server-Sent Events (GET /control-stream)
 *     so index.html on any device — laptop, phone, iPad — reacts instantly.
 *
 * No npm install required; uses only Node built-in modules.
 * Binds to 0.0.0.0 so phones/tablets on the same WiFi can connect.
 */

'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const os   = require('os');

const PORT = 5173;
const DIR  = __dirname;

/* ── In-memory control state ───────────────────────────────────────────────── */
let controlState = { music: 'stopped', banner: 'hidden' };
const sseClients = new Set();

function broadcast(state) {
  const msg = 'data: ' + JSON.stringify(state) + '\n\n';
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}

/* ── MIME map ──────────────────────────────────────────────────────────────── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
  '.mp4':  'video/mp4',
};

/* ── HTTP server ───────────────────────────────────────────────────────────── */
const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url);

  /* ── CORS preflight ─────────────────────────────────────────────────────── */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const cors = { 'Access-Control-Allow-Origin': '*' };

  /* ── SSE endpoint: real-time push to all display pages ─────────────────── */
  if (pathname === '/control-stream' && req.method === 'GET') {
    res.writeHead(200, {
      ...cors,
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no',   // prevent Nginx buffering if behind a proxy
    });
    res.flushHeaders();
    // Send current state immediately so the client syncs on connect / reconnect
    res.write('data: ' + JSON.stringify(controlState) + '\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  /* ── POST /control: admin sets music/banner state OR broadcasts a focus change */
  if (pathname === '/control' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const update = JSON.parse(body);

        // focus is transient — broadcast immediately but don't persist in controlState
        // so a server restart never accidentally clears focus state on clients
        if ('focus' in update) {
          broadcast({ focus: update.focus }); // { seqId, startedAt } to set; null to clear
          res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (update.music  !== undefined) controlState.music  = update.music;
        if (update.banner !== undefined) controlState.banner = update.banner;
        broadcast(controlState);
        res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, state: controlState }));
      } catch (_) {
        res.writeHead(400, cors);
        res.end('Bad JSON');
      }
    });
    return;
  }

  /* ── GET /control-state: one-shot state snapshot (used on reconnect) ─────── */
  if (pathname === '/control-state' && req.method === 'GET') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(controlState));
    return;
  }

  /* ── Directory image listing: GET /some/folder/?list=1 ────────────────── */
  if (req.method === 'GET' && req.url.includes('?list=1')) {
    const folderPath = path.join(DIR, decodeURIComponent(pathname.slice(1)));
    if (!folderPath.startsWith(DIR + path.sep)) {
      res.writeHead(403, cors); res.end('Forbidden'); return;
    }
    const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
    fs.readdir(folderPath, function (err, entries) {
      if (err) { res.writeHead(404, cors); res.end('[]'); return; }
      const images = entries.filter(function (f) {
        return IMAGE_EXTS.has(path.extname(f).toLowerCase());
      }).sort();
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(images));
    });
    return;
  }

  /* ── Static file serving with range-request support ───────────────────── */
  let filePath = path.join(DIR, pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1)));

  // Security: block path traversal
  if (!filePath.startsWith(DIR + path.sep) && filePath !== path.join(DIR, 'index.html')) {
    res.writeHead(403, cors);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, cors);
      res.end('Not found: ' + pathname);
      return;
    }

    const ext      = path.extname(filePath).toLowerCase();
    const mimeType = MIME[ext] || 'application/octet-stream';
    const range    = req.headers.range;

    if (range) {
      // Partial content — required for audio/video on iOS Safari and Chrome
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : stat.size - 1;
      const chunk = end - start + 1;
      res.writeHead(206, {
        ...cors,
        'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunk,
        'Content-Type':   mimeType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        ...cors,
        'Accept-Ranges':  'bytes',
        'Content-Length': stat.size,
        'Content-Type':   mimeType,
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

/* ── Start ─────────────────────────────────────────────────────────────────── */
server.listen(PORT, '0.0.0.0', () => {
  // Print local and LAN IP so you can type the address on phones/tablets
  const nets = os.networkInterfaces();
  let lanIP  = '';
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) { lanIP = cfg.address; break; }
    }
    if (lanIP) break;
  }

  console.log('\n🎉  Rongali Bihu DFW — Programme Server\n');
  console.log('  Local  (this laptop):  http://localhost:' + PORT);
  if (lanIP) {
    console.log('  Network (phones/iPad): http://' + lanIP + ':' + PORT);
    console.log('\n  ➜ On the display iPad/phone, open:');
    console.log('      http://' + lanIP + ':' + PORT + '/index.html');
    console.log('  ➜ Admin panel (this laptop):');
    console.log('      http://localhost:' + PORT + '/admin.html');
  }
  console.log('\n  Press Ctrl+C to stop.\n');
});
