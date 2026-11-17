import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';

/*
 * The way to the internet: a Cloudflare "quick tunnel" (the program `cloudflared`, free, no account). It gives the host a fresh https address
 * (https://some-words.trycloudflare.com) that leads to this computer's port, with WebSockets, and no router settings. The address is new every
 * time and nobody can guess it, so whoever has the link may join.
 */

/** Where the program may be: on the path, or where its Windows installer puts it. */
function candidates(): string[] {
  const list = ['cloudflared'];
  for (const dir of [process.env['ProgramFiles(x86)'], process.env['ProgramFiles']]) if (dir) list.push(`${dir}\\cloudflared\\cloudflared.exe`);
  list.push('/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared');
  return list.filter((c) => c === 'cloudflared' || existsSync(c));
}

export interface Tunnel {
  /** The address, once the tunnel is up. */
  url: string | null;
  stop(): void;
}

/**
 * Starts a tunnel to a local port. `onUrl` is told the address when it is known, `onProblem` what went wrong (the program is missing, or it stopped).
 */
export function startTunnel(port: number, onUrl: (url: string) => void, onProblem: (text: string) => void): Tunnel {
  const tunnel: Tunnel = { url: null, stop: () => undefined };
  const options = candidates();
  let child: ChildProcess | null = null;
  const attempt = (index: number): void => {
    const program = options[index];
    if (!program) {
      onProblem('cloudflared is not installed. Install it (Windows: winget install Cloudflare.cloudflared; Mac: brew install cloudflared), then start the host again.');
      return;
    }
    const process_ = spawn(program, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child = process_;
    let found = false;
    const read = (chunk: Buffer): void => {
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
      if (match && !found) {
        found = true;
        tunnel.url = match[0];
        onUrl(match[0]);
      }
    };
    process_.stdout?.on('data', read);
    process_.stderr?.on('data', read);
    process_.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') attempt(index + 1);
      else onProblem(`The tunnel could not be started: ${e.message}`);
    });
    process_.on('exit', (code) => {
      if (child === process_ && tunnel.url !== null) {
        tunnel.url = null;
        onProblem(`The tunnel has stopped (code ${code ?? '?'}). Players that are in the game are not affected, but nobody new can join over the internet: restart the host.`);
      }
    });
  };
  attempt(0);
  tunnel.stop = () => {
    const c = child;
    child = null;
    c?.kill();
  };
  return tunnel;
}
