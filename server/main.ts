import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { gzip } from 'node:zlib';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameHost, type Outgoing } from '../src/net/host';
import { DEFAULT_PORT, PROTOCOL, type ClientMessage } from '../src/net/protocol';
import { parseSave, serialise } from '../src/ui/savegame';
import { registerCustomScenarios } from '../src/engine/scenario';
import { handleFileApi, loadScenarioDefs } from './files';
import { startTunnel, type Tunnel } from './tunnel';

/**
 * The host of a network game: serves the page (the built `dist/` folder) and runs one game for two players over WebSockets.
 *   npm run host                      builds the page, then hosts on port 8787
 *   npm run host:internet             the same, and opens a tunnel (needs cloudflared) so that a player anywhere can join with the link it prints
 *   npm run serve -- --port 9000      hosts without building, on another port
 *   npm run serve -- --load saves/autosave.json     carries on with a saved game (the page can also load one from its menu)
 *   --saves <folder> and --scenarios <folder>        where the page keeps saved games and scenarios (saves/ and scenarios/ by default)
 */
function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const port = Number(option('port') ?? process.env.PORT ?? DEFAULT_PORT);
const distDir = resolve(option('dist') ?? 'dist');
const savesDir = resolve(option('saves') ?? 'saves');
const scenariosDir = resolve(option('scenarios') ?? 'scenarios');
const loadPath = option('load');
const internet = process.argv.includes('--internet');
/** The addresses to offer another player: where the page is on the home network, and (with --internet) on the internet. */
const links = { tunnel: null as string | null, tunnelProblem: null as string | null };
const lanAddresses = (): string[] =>
  Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a!.address}:${port}`);

mkdirSync(savesDir, { recursive: true });
const stamp = (): string => new Date().toLocaleTimeString();
const log = (text: string): void => console.log(`[${stamp()}] ${text}`);

let loaded;
if (loadPath) {
  try {
    loaded = parseSave(readFileSync(resolve(loadPath), 'utf8'));
    log(`Loaded the saved game from ${loadPath}.`);
  } catch (e) {
    console.error(`Could not load ${loadPath}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

let lastPhase = '';
const host = new GameHost({
  load: loaded,
  onChange: (save) => {
    writeFileSync(join(savesDir, 'autosave.json'), serialise(save));
    if (save.game.phase === 'over' && lastPhase !== 'over') {
      writeFileSync(join(savesDir, `finished-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), serialise(save));
    }
    lastPhase = save.game.phase;
  },
});

// ---------------------------------------------------------------- the page

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
};

/** What shrinks well on the way (the 3D models are a few tens of megabytes, mostly meshes: about a quarter of it compressed). PNG, WebP and MP3 are already compressed. */
const SQUEEZABLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.map', '.glb', '.wav']);
const squeezed = new Map<string, { stamp: number; body: Buffer }>();

/** A file of the page that Vite named after its content (index-BldLbSZR.js): it never changes, so the browser may keep it for good. */
const HASHED = /-[A-Za-z0-9_-]{8}\.(js|css)$/;

/** Sends a file of the page: the browser keeps what it has already got (it asks again only whether the file changed), and the big ones travel compressed. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  const info = statSync(file);
  const ext = extname(file).toLowerCase();
  const etag = `W/"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    etag,
    'last-modified': info.mtime.toUTCString(),
    // the page itself is looked at again every time (so a new version shows at once); pictures, sounds, models and data are kept for ten minutes
    'cache-control': ext === '.html' ? 'no-cache' : HASHED.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=600',
    vary: 'accept-encoding',
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  const accepts = /gzip/.test(String(req.headers['accept-encoding'] ?? ''));
  if (!accepts || !SQUEEZABLE.has(ext) || info.size < 1024) {
    res.writeHead(200, { ...headers, 'content-length': String(info.size) });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
    return;
  }
  const send = (body: Buffer): void => {
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': String(body.length) });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const kept = squeezed.get(file);
  if (kept && kept.stamp === info.mtimeMs) {
    send(kept.body);
    return;
  }
  gzip(readFileSync(file), { level: 6 }, (error, body) => {
    if (error) {
      res.writeHead(500).end();
      return;
    }
    squeezed.set(file, { stamp: info.mtimeMs, body });
    send(body);
  });
}

function serve(req: IncomingMessage, res: ServerResponse): void {
  if (handleFileApi(req, res, { saves: savesDir, scenarios: scenariosDir })) return;
  const url = new URL(req.url ?? '/', 'http://host');
  if (url.pathname === '/net-info') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ service: 'star-warriors-host', protocol: PROTOCOL, internet: links.tunnel, internetProblem: links.tunnelProblem, internetStarting: internet && !links.tunnel && !links.tunnelProblem, lan: lanAddresses() }));
    return;
  }
  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = resolve(distDir, relative || 'index.html');
  // never leave the page's folder
  if (file !== distDir && !file.startsWith(distDir + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    if (!existsSync(distDir)) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('The page has not been built yet: run "npm run host" (or "npm run build") first.');
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    }
    return;
  }
  sendFile(req, res, file);
}

// ---------------------------------------------------------------- the game

let tunnel: Tunnel | null = null;
const server = createServer(serve);
const sockets = new Map<number, WebSocket>();
const alive = new WeakSet<WebSocket>();
let nextId = 1;

const send = (out: Outgoing[]): void => {
  for (const { to, msg } of out) {
    const socket = sockets.get(to);
    if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    // a fatal message is the last the page will hear
    if (socket && msg.type === 'error' && msg.fatal) setTimeout(() => socket.close(), 200);
  }
};

const wss = new WebSocketServer({
  server,
  path: '/play',
  maxPayload: 2_000_000,
  // every update carries the whole game, log included (a quarter of a megabyte in a big battle): compressed, with what the last message said remembered, it is a few kilobytes
  perMessageDeflate: { threshold: 1024, zlibDeflateOptions: { level: 4 } },
});
wss.on('connection', (socket, request) => {
  const id = nextId++;
  sockets.set(id, socket);
  alive.add(socket);
  host.connect(id);
  log(`Connection ${id} from ${request.socket.remoteAddress}.`);
  socket.on('pong', () => alive.add(socket));
  socket.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      return;
    }
    // a game may be made from a scenario of the player's own: they are read again whenever a game is created
    if (msg.type === 'create') registerCustomScenarios(loadScenarioDefs(scenariosDir));
    send(host.receive(id, msg));
    if (msg.type === 'join' || msg.type === 'create') log(host.describe());
  });
  socket.on('close', () => {
    sockets.delete(id);
    send(host.disconnect(id));
    log(`Connection ${id} closed. ${host.describe()}`);
  });
  socket.on('error', () => socket.terminate());
});

// connections that went quiet without closing (a laptop that fell asleep) are dropped, so the side can be taken back
setInterval(() => {
  for (const socket of wss.clients) {
    if (!alive.has(socket)) {
      socket.terminate();
      continue;
    }
    alive.delete(socket);
    socket.ping();
  }
}, 20_000).unref();

server.listen(port, '0.0.0.0', () => {
  log(`Warriors of the Stars host is running on port ${port}.`);
  if (!existsSync(distDir)) log('Note: the page has not been built yet. Run "npm run build", or start with "npm run host".');
  log(`  On this computer:      http://localhost:${port}`);
  for (const address of lanAddresses()) log(`  Same network:          ${address}`);
  if (internet) {
    log('  Opening the tunnel to the internet…');
    tunnel = startTunnel(
      port,
      (url) => {
        links.tunnel = url;
        links.tunnelProblem = null;
        log(`  Over the internet:     ${url}/?join   <- send this link to the other player`);
      },
      (text) => {
        links.tunnel = null;
        links.tunnelProblem = text;
        log(`  ${text}`);
      },
    );
    process.on('exit', () => tunnel?.stop());
    process.on('SIGINT', () => process.exit(0));
  } else {
    log('  (To let a player anywhere join: npm run host:internet)');
  }
  log(host.describe());
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Start the host with another port: npm run serve -- --port ${port + 1}` : e.message);
  process.exit(1);
});
