/*
 * Builds the ready-to-play packages (the owner's decision: prebuilt downloads, no npm install for the player):
 *
 *   warriors-of-the-stars-<version>-windows.zip              start.bat (downloads Node.js into ./node when the computer has none)
 *   warriors-of-the-stars-<version>-windows-with-node.zip    the same with node.exe included: nothing to download at all
 *   warriors-of-the-stars-<version>-linux.tar.gz             start.sh (downloads Node.js into ./node when the computer has none)
 *   warriors-of-the-stars-<version>-macos.tar.gz             start.sh and start.command (double-click in Finder)
 *   SHA256SUMS.txt
 *
 * Every package holds the built page (dist/), the server as one file (server.cjs: server/main.ts bundled with its libraries by esbuild), the example scenario,
 * the rules and the credits. They are made in release/ (git-ignored).  Usage: node scripts/build-release.mjs [--version 1.0.0] [--skip-build]
 *
 * The Windows zips are made with the tar.exe of Windows 10 and newer; the tar.gz archives are written by the small tar writer below, so that start.sh and
 * start.command keep their executable bits whatever system the packages are built on.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { get } from 'node:https';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');
const stageDir = join(releaseDir, 'stage');
const cacheDir = join(releaseDir, 'cache');

/** The Node.js that the start scripts download, and that the Windows package carries: the LTS the game is developed on. */
const NODE_VERSION = '22.21.0';

const args = process.argv.slice(2);
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = option('version') ?? pkg.version;
const baseName = `warriors-of-the-stars-${version}`;

const log = (text) => console.log(text);
/** The tar that makes and opens zip files: the one that comes with Windows 10 and newer (a GNU tar on the PATH, as in Git Bash, cannot do zip files), else the one on the PATH (bsdtar). */
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe') : 'tar';

function run(command, commandArgs, options = {}) {
  const r = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && command === 'npx', ...options });
  if (r.status !== 0) throw new Error(`${command} ${commandArgs.join(' ')} failed`);
}

/** Downloads a file once (kept in release/cache). */
function download(url, file) {
  if (existsSync(file)) return Promise.resolve();
  mkdirSync(dirname(file), { recursive: true });
  return new Promise((done, fail) => {
    const fetch = (u) => get(u, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return fetch(res.headers.location);
      if (res.statusCode !== 200) return fail(new Error(`${u}: ${res.statusCode}`));
      const out = createWriteStream(`${file}.part`);
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          writeFileSync(file, readFileSync(`${file}.part`));
          rmSync(`${file}.part`);
          done();
        });
      });
      out.on('error', fail);
    }).on('error', fail);
    fetch(url);
  });
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The page and the server, in a folder with what every package holds. */
async function stageCommon() {
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  const common = join(stageDir, '_common');
  mkdirSync(common, { recursive: true });
  if (!args.includes('--skip-build')) run('npx', ['vite', 'build']);
  if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('dist/ has no page: run without --skip-build');
  cpSync(join(root, 'dist'), join(common, 'dist'), { recursive: true });
  // the server and the engine it runs, with ws, as one file for Node.js
  await build({
    entryPoints: [join(root, 'server/main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: join(common, 'server.cjs'),
    external: ['bufferutil', 'utf-8-validate'],
    define: { 'import.meta.env': '{}' },
    legalComments: 'none',
    logLevel: 'warning',
  });
  mkdirSync(join(common, 'scenarios'), { recursive: true });
  copyFileSync(join(root, 'scenarios', 'example-duel.json'), join(common, 'scenarios', 'example-duel.json'));
  copyFileSync(join(root, 'docs', 'RULES.md'), join(common, 'RULES.md'));
  copyFileSync(join(root, 'CREDITS.md'), join(common, 'CREDITS.md'));
  return common;
}

const fill = (text, extra = {}) => Object.entries({ NODE_VERSION, VERSION: version, ...extra }).reduce((t, [k, v]) => t.split(`@${k}@`).join(v), text);
const readTemplate = (name) => readFileSync(join(root, 'scripts', 'release', name), 'utf8');

/** A package folder: the common files, the start scripts for the system, the text on how to play. */
function stagePackage(common, name, files) {
  const dir = join(stageDir, name, name);
  mkdirSync(dir, { recursive: true });
  cpSync(common, dir, { recursive: true });
  for (const [target, text] of Object.entries(files)) writeFileSync(join(dir, target), text);
  return dir;
}

const windows = (text) => text.replace(/\r?\n/g, '\r\n');
const unix = (text) => text.replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- tar.gz with the modes we want

function tarHeader(path, size, mode, type) {
  const h = Buffer.alloc(512);
  let name = path;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const at = name.lastIndexOf('/', 155);
    if (at <= 0) throw new Error(`path too long: ${path}`);
    prefix = name.slice(0, at);
    name = name.slice(at + 1);
  }
  const put = (text, offset, length) => h.write(text, offset, length, 'ascii');
  const octal = (n, length) => `${n.toString(8).padStart(length - 1, '0')}\0`;
  put(name, 0, 100);
  put(octal(mode, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
  put('        ', 148, 8);
  put(type, 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const byte of h) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return h;
}

function writeTarGz(folder, topName, outFile, executable) {
  const chunks = [];
  const add = (full, rel) => {
    const stat = statSync(full);
    const path = `${topName}/${rel}`.split(sep).join('/');
    if (stat.isDirectory()) {
      chunks.push(tarHeader(`${path}/`, 0, 0o755, '5'));
      for (const entry of readdirSync(full).sort()) add(join(full, entry), join(rel, entry));
      return;
    }
    const data = readFileSync(full);
    chunks.push(tarHeader(path, data.length, executable.includes(rel.split(sep).join('/')) ? 0o755 : 0o644, '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  };
  chunks.push(tarHeader(`${topName}/`, 0, 0o755, '5'));
  for (const entry of readdirSync(folder).sort()) add(join(folder, entry), entry);
  chunks.push(Buffer.alloc(1024));
  writeFileSync(outFile, gzipSync(Buffer.concat(chunks), { level: 9 }));
}

function writeZip(parent, topName, outFile) {
  rmSync(outFile, { force: true });
  const r = spawnSync(tar, ['-a', '-c', '-f', outFile, '-C', parent, topName], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tar could not make the zip file (it needs the tar of Windows 10 or newer, or bsdtar)');
}

// ---------------------------------------------------------------- the packages

const common = await stageCommon();
const outputs = [];
mkdirSync(releaseDir, { recursive: true });

// Windows
const winFiles = {
  'start.bat': windows(fill(readTemplate('start.bat'))),
  'start-internet.bat': windows(readTemplate('start-internet.bat')),
  'get-node.ps1': windows(readTemplate('get-node.ps1')),
  'README-PLAY.txt': windows(fill(readTemplate('README-PLAY.txt'), { START: 'start.bat', SYSTEM: 'Windows', NETSTART: 'start-internet.bat', NETHELP: 'it is installed for you with winget' })),
};
{
  const name = `${baseName}-windows`;
  stagePackage(common, name, winFiles);
  const out = join(releaseDir, `${name}.zip`);
  writeZip(join(stageDir, name), name, out);
  outputs.push(out);
}

// Windows with Node.js included (the official node.exe, from the zip nodejs.org publishes, checked against its checksum)
{
  const zip = `node-v${NODE_VERSION}-win-x64.zip`;
  const zipFile = join(cacheDir, zip);
  log(`Fetching ${zip} ...`);
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/${zip}`, zipFile);
  const sums = join(cacheDir, `SHASUMS256-${NODE_VERSION}.txt`);
  await download(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`, sums);
  const want = readFileSync(sums, 'utf8').split('\n').find((l) => l.trim().endsWith(zip))?.split(/\s+/)[0];
  if (!want || want !== sha256(zipFile)) {
    rmSync(zipFile, { force: true });
    throw new Error(`${zip} does not match the checksum of nodejs.org: it was removed, run again`);
  }
  const name = `${baseName}-windows-with-node`;
  const dir = stagePackage(common, name, { ...winFiles, 'README-PLAY.txt': windows(fill(readTemplate('README-PLAY.txt'), { START: 'start.bat', SYSTEM: 'Windows (Node.js included)', NETSTART: 'start-internet.bat', NETHELP: 'it is installed for you with winget' })) });
  const unpacked = join(stageDir, 'node-unpacked');
  mkdirSync(unpacked, { recursive: true });
  const r = spawnSync(tar, ['-x', '-f', zipFile, '-C', unpacked], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('could not unpack the Node.js zip');
  const nodeRoot = join(unpacked, `node-v${NODE_VERSION}-win-x64`);
  mkdirSync(join(dir, 'node'), { recursive: true });
  copyFileSync(join(nodeRoot, 'node.exe'), join(dir, 'node', 'node.exe'));
  copyFileSync(join(nodeRoot, 'LICENSE'), join(dir, 'node', 'LICENSE'));
  const out = join(releaseDir, `${name}.zip`);
  writeZip(join(stageDir, name), name, out);
  outputs.push(out);
}

// Linux and macOS
for (const [system, scripts] of [['linux', ['start.sh', 'start-internet.sh']], ['macos', ['start.sh', 'start.command', 'start-internet.sh', 'start-internet.command']]]) {
  const name = `${baseName}-${system}`;
  const files = {
    'start.sh': unix(fill(readTemplate('start.sh'))),
    'README-PLAY.txt': unix(fill(readTemplate('README-PLAY.txt'), { START: system === 'macos' ? 'start.command (or start.sh)' : 'start.sh', SYSTEM: system === 'macos' ? 'macOS' : 'Linux', NETSTART: system === 'macos' ? 'start-internet.command' : 'start-internet.sh', NETHELP: system === 'macos' ? 'install it with: brew install cloudflared' : 'see github.com/cloudflare/cloudflared/releases' })),
  };
  files['start-internet.sh'] = unix(readTemplate('start-internet.sh'));
  if (system === 'macos') {
    files['start.command'] = unix(readTemplate('start.command'));
    files['start-internet.command'] = unix(readTemplate('start-internet.command'));
  }
  const dir = stagePackage(common, name, files);
  const out = join(releaseDir, `${name}.tar.gz`);
  writeTarGz(dir, name, out, scripts);
  outputs.push(out);
}

writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), outputs.map((f) => `${sha256(f)}  ${relative(releaseDir, f)}\n`).join(''));
for (const f of outputs) log(`${relative(root, f)}  ${(statSync(f).size / 1e6).toFixed(1)} MB`);
log('release/SHA256SUMS.txt written.');
