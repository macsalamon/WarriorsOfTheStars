import { DEFAULT_PORT, PROTOCOL, type ClientMessage, type ServerMessage } from './protocol';

export type LinkState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface NetHandlers {
  onMessage(msg: ServerMessage): void;
  onLink(state: LinkState, detail?: string): void;
}

const tokenKey = (address: string): string => `star-warriors.seat.${address}`;

/** The host's address as a WebSocket URL: "192.168.1.20" and "192.168.1.20:8787" both work. */
export function socketUrl(address: string): string {
  const clean = address.trim().replace(/^(https?|wss?):\/\//, '').replace(/\/.*$/, '');
  // a page opened over https comes through a tunnel or a proxy, which listens on the usual port: no port is added to its address
  const withPort = /:\d+$/.test(clean) || location.protocol === 'https:' ? clean : `${clean}:${DEFAULT_PORT}`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${withPort}/play`;
}

/** The addresses a host can give to another player. */
export interface HostLinks {
  /** Over the internet (a tunnel), when the host was started with it, or why it could not be. */
  internet: string | null;
  internetProblem: string | null;
  /** The host was started with a tunnel, which is not up yet (it takes a few seconds). */
  internetStarting: boolean;
  /** On the same network. */
  lan: string[];
}

/** Asks the page's own server for the links to give to another player; null when the page is not served by a host. */
export async function fetchHostLinks(): Promise<HostLinks | null> {
  try {
    const info = (await (await fetch('/net-info', { cache: 'no-store' })).json()) as { service?: string; internet?: string | null; internetProblem?: string | null; internetStarting?: boolean; lan?: string[] };
    if (info.service !== 'star-warriors-host') return null;
    return { internet: info.internet ?? null, internetProblem: info.internetProblem ?? null, internetStarting: info.internetStarting === true, lan: info.lan ?? [] };
  } catch {
    return null;
  }
}

/** Asks the page's own server whether it is a Warriors of the Stars host, and so which address to offer. */
export async function guessHostAddress(): Promise<string> {
  const fallback = `${location.hostname || 'localhost'}:${DEFAULT_PORT}`;
  try {
    const response = await fetch('/net-info', { cache: 'no-store' });
    const info = (await response.json()) as { service?: string };
    if (info.service === 'star-warriors-host') return location.host;
  } catch {
    /* the page is not served by a host */
  }
  return fallback;
}

/**
 * The page's line to the host. It joins with the seat token it was given last time, so after a dropped connection (or a
 * reloaded page) the host puts it back on its side; it tries again by itself until it is closed.
 */
export class NetClient {
  private socket: WebSocket | null = null;
  private closedByUs = false;
  private fatal = false;
  private attempts = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly key: string;
  private readonly url: string;

  constructor(private address: string, private handlers: NetHandlers) {
    this.key = tokenKey(address.trim());
    this.url = socketUrl(address);
  }

  connect(): void {
    this.handlers.onLink(this.attempts === 0 ? 'connecting' : 'reconnecting');
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.handlers.onLink('closed', 'The page can’t connect to that address.');
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempts = 0;
      this.handlers.onLink('open');
      this.send({ type: 'join', protocol: PROTOCOL, token: this.token() ?? undefined });
    };
    socket.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if ((msg.type === 'welcome' || msg.type === 'started') && msg.token) this.remember(msg.token);
      if (msg.type === 'error' && msg.fatal) this.fatal = true;
      this.handlers.onMessage(msg);
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.closedByUs || this.fatal) {
        this.handlers.onLink('closed');
        return;
      }
      this.attempts += 1;
      this.handlers.onLink('reconnecting');
      this.retry = setTimeout(() => this.connect(), Math.min(5000, 1000 * this.attempts));
    };
  }

  send(msg: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(msg));
    return true;
  }

  close(): void {
    this.closedByUs = true;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close();
  }

  /** Forget the seat, so the next connection asks for a new one. */
  forgetSeat(): void {
    try {
      sessionStorage.removeItem(this.key);
    } catch {
      /* storage can be blocked */
    }
  }

  private token(): string | null {
    try {
      return sessionStorage.getItem(this.key);
    } catch {
      return null;
    }
  }

  private remember(token: string): void {
    try {
      sessionStorage.setItem(this.key, token);
    } catch {
      /* storage can be blocked */
    }
  }
}
