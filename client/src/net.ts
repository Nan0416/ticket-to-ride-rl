// WebSocket connection with automatic reconnect + session resume.
import type { ClientMsg, ServerMsg } from '../../shared/protocol.ts';

const TOKEN_KEY = 'rockyway.token';

export type ConnState = 'connecting' | 'open' | 'closed';

export class Net {
  private ws: WebSocket | null = null;
  private queue: ClientMsg[] = [];
  private retry = 0;
  private listeners: ((m: ServerMsg) => void)[] = [];
  private stateListeners: ((s: ConnState) => void)[] = [];
  state: ConnState = 'connecting';

  constructor(private url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
    this.connect();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.ws?.readyState !== WebSocket.OPEN) this.connect();
    });
  }

  /** Per-tab session token (sessionStorage) so several tabs can play as different players. */
  get token(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }
  set token(t: string | null) {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  onMessage(cb: (m: ServerMsg) => void) {
    this.listeners.push(cb);
  }
  onState(cb: (s: ConnState) => void) {
    this.stateListeners.push(cb);
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  private setState(s: ConnState) {
    this.state = s;
    for (const cb of this.stateListeners) cb(s);
  }

  private connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setState('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setState('open');
      const token = this.token;
      if (token) ws.send(JSON.stringify({ t: 'resume', token } satisfies ClientMsg));
      const pending = this.queue;
      this.queue = [];
      for (const m of pending) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const cb of this.listeners) cb(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setState('closed');
      const delay = Math.min(5000, 400 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }
}
