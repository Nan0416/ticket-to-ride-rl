// Rocky Way game server: WebSocket endpoint at /ws, plus static hosting of the
// built client (dist/) when running in production mode.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { detach, handleMessage, stats, sweepIdleRooms } from './rooms.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(import.meta.dirname, '../dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/lan') {
    // LAN addresses so the lobby can show a link phones on the same Wi-Fi can open
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((n) => n && n.family === 'IPv4' && !n.internal)
      .map((n) => n!.address);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ addresses }));
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ...stats() }));
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('Rocky Way server is running. In development, open the Vite client at http://localhost:5173');
  }
  // static files with SPA fallback
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);
  ws.on('message', (data) => handleMessage(ws, data.toString()));
  ws.on('close', () => {
    clearInterval(heartbeat);
    detach(ws);
  });
  ws.on('error', () => ws.close());
});

setInterval(sweepIdleRooms, 10 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Rocky Way server listening on http://localhost:${PORT} (ws: /ws)`);
});
