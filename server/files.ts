import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { CUSTOM_PREFIX, validateScenario, type ScenarioDef } from '../src/engine/scenario';
import { SaveError, describeSave, parseSave } from '../src/ui/savegame';

/**
 * The page's way to the project's folders: `saves/` for saved games and `scenarios/` for scenarios of its own. A web page cannot write to a
 * folder by itself, so the host program (and the dev server) do it for the page. Only a page on the same computer may use it: players who
 * join over the network must never be able to write files on the host's disk.
 *
 *   GET  /api/files                  what is in both folders
 *   GET  /api/saves/<name>.json      one saved game          PUT: keeps one (it has to be a save of this game)
 *   GET  /api/scenarios/<name>.json  one scenario            PUT: keeps one (it has to be a scenario this game can play)
 */
export interface FileDirs {
  saves: string;
  scenarios: string;
}

export const defaultDirs = (): FileDirs => ({ saves: resolve('saves'), scenarios: resolve('scenarios') });

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$/;
const LIMIT = 20_000_000;

/** The addresses of this computer, to tell its own page from a player's page on the network. */
function localAddresses(): Set<string> {
  const out = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      out.add(a.address);
      out.add(`::ffff:${a.address}`);
    }
  }
  return out;
}

/** Does the request come from a page on this computer, opened at an address of this computer (not by a page somewhere else that a browser here was talked into opening)? */
function isLocal(req: IncomingMessage): boolean {
  const here = localAddresses();
  if (!here.has(req.socket.remoteAddress ?? '')) return false;
  const host = (req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return host === '' || here.has(host);
}

function reply(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > LIMIT) {
        fail(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

function listDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => NAME.test(n));
}

/** What the menu lists: every saved game with its description, every scenario with its name. Files that cannot be read are listed with the reason. */
function listing(dirs: FileDirs): unknown {
  const saves = listDir(dirs.saves).map((name) => {
    const path = join(dirs.saves, name);
    const info = statSync(path);
    if (info.size > 5_000_000) return { name, size: info.size, modified: info.mtimeMs, error: 'The file is too large to be a save.' };
    try {
      const save = parseSave(readFileSync(path, 'utf8'));
      return { name, size: info.size, modified: info.mtimeMs, savedAt: save.savedAt, description: describeSave(save), human: save.meta.human };
    } catch (e) {
      return { name, size: info.size, modified: info.mtimeMs, error: e instanceof SaveError ? e.message : 'The file couldn’t be read.' };
    }
  });
  const scenarios = listDir(dirs.scenarios).map((name) => {
    const path = join(dirs.scenarios, name);
    try {
      const def = JSON.parse(readFileSync(path, 'utf8'));
      const error = validateScenario(def);
      return error ? { name, error } : { name, title: String(def.name) };
    } catch {
      return { name, error: 'This isn’t a scenario file (it isn’t valid JSON).' };
    }
  });
  return { saves, scenarios };
}

/** Handles a request for the file API; false when the request is not for it. */
export function handleFileApi(req: IncomingMessage, res: ServerResponse, dirs: FileDirs = defaultDirs()): boolean {
  const url = new URL(req.url ?? '/', 'http://host');
  if (!url.pathname.startsWith('/api/')) return false;
  if (!isLocal(req)) {
    reply(res, 403, { error: 'Only a page on the host’s own computer may use the folders.' });
    return true;
  }
  const method = req.method ?? 'GET';
  // a page of another site cannot add this header without the browser asking first: it keeps other sites from writing files here
  if (method !== 'GET' && req.headers['x-warriors'] !== '1') {
    reply(res, 403, { error: 'Not a request of the game’s own page.' });
    return true;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[1] === 'files' && method === 'GET') {
    mkdirSync(dirs.saves, { recursive: true });
    mkdirSync(dirs.scenarios, { recursive: true });
    reply(res, 200, listing(dirs));
    return true;
  }
  const kind = parts[1];
  const name = parts[2] ? decodeURIComponent(parts[2]) : '';
  const dir = kind === 'saves' ? dirs.saves : kind === 'scenarios' ? dirs.scenarios : null;
  if (parts.length !== 3 || !dir || !NAME.test(name)) {
    reply(res, 404, { error: 'Not found.' });
    return true;
  }
  const path = join(dir, name);
  if (method === 'GET') {
    if (!existsSync(path)) reply(res, 404, { error: 'That file doesn’t exist.' });
    else reply(res, 200, readFileSync(path, 'utf8'));
    return true;
  }
  if (method === 'PUT') {
    void readBody(req).then((text) => {
      let error: string | null = null;
      try {
        if (kind === 'saves') parseSave(text);
        else error = validateScenario(JSON.parse(text));
      } catch (e) {
        error = e instanceof SaveError ? e.message : 'The file isn’t valid.';
      }
      if (error) return reply(res, 400, { error });
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, text);
      reply(res, 200, { name });
    }).catch(() => reply(res, 413, { error: 'The file is too large.' }));
    return true;
  }
  reply(res, 405, { error: 'Not allowed.' });
  return true;
}

/** The scenarios of the player's own that this game can play, by id (`custom-<file name>`): the host makes them known before it starts a game from one. */
export function loadScenarioDefs(dir: string): Record<string, ScenarioDef> {
  const out: Record<string, ScenarioDef> = {};
  for (const name of listDir(dir)) {
    try {
      const def = JSON.parse(readFileSync(join(dir, name), 'utf8')) as ScenarioDef;
      if (!validateScenario(def)) out[`${CUSTOM_PREFIX}${name.replace(/\.json$/, '')}`] = def;
    } catch {
      /* a file that can't be read is left out */
    }
  }
  return out;
}
