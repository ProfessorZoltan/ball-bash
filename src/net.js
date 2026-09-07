// Client side of the relay: connect to the online relay if one is configured,
// otherwise to the LAN server that served the page; create or join a room,
// then exchange messages with the other player.
import { DEFAULT_RELAY } from './config.js';

const RELAY_KEY = 'deflector.relay';

/**
 * The configured relay, or null for the page's own server. Order: the
 * ?relay= query parameter, the address saved in this browser, DEFAULT_RELAY.
 * Returns { ws, http, label } with the WebSocket and HTTP base URLs.
 */
export function relayConfig() {
  let raw = '';
  try {
    raw = new URLSearchParams(location.search).get('relay') || localStorage.getItem(RELAY_KEY) || DEFAULT_RELAY || '';
  } catch (_) {
    raw = DEFAULT_RELAY || '';
  }
  raw = String(raw).trim();
  if (!raw) return null;
  const m = raw.match(/^(?:(wss?|https?):\/\/)?([^/\s]+)/i);
  if (!m) return null;
  const proto = (m[1] || 'wss').toLowerCase();
  const secure = proto === 'wss' || proto === 'https';
  const host = m[2];
  return { ws: `${secure ? 'wss' : 'ws'}://${host}/ws`, http: `${secure ? 'https' : 'http'}://${host}`, label: host };
}

/** Save (or with an empty string, clear) the relay address for this browser. */
export function saveRelay(address) {
  try {
    if (String(address || '').trim()) localStorage.setItem(RELAY_KEY, String(address).trim());
    else localStorage.removeItem(RELAY_KEY);
  } catch (_) {
    // storage unavailable; the choice lasts for this page load only
  }
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.role = null;
    this.code = null;
    this.peerName = null;
    this.rtt = 0;
  }

  /**
   * Is a relay reachable? The configured online relay's /health, or else the
   * LAN server's /lan (which a static host does not have). Resolves to
   * { online, relay, addresses, port, rooms } or null.
   */
  static async available() {
    const relay = relayConfig();
    try {
      const res = await fetch(relay ? `${relay.http}/health` : '/lan', { cache: 'no-store' });
      if (!res.ok) return null;
      const info = await res.json();
      return { ...info, online: !!relay, relay };
    } catch (_) {
      return null;
    }
  }

  on(type, fn) {
    this.handlers.set(type, fn);
  }

  emit(type, msg) {
    const fn = this.handlers.get(type);
    if (fn) fn(msg);
  }

  connect() {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const relay = relayConfig();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(relay ? relay.ws : `${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        resolve();
      };
      ws.onerror = () => {
        if (!this.connected) reject(new Error(relayConfig() ? 'Could not reach the relay' : 'Could not reach the LAN server'));
      };
      ws.onclose = () => {
        this.connected = false;
        this.emit('close');
      };
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch (_) {
          return;
        }
        this.dispatch(msg);
      };
    });
  }

  dispatch(msg) {
    switch (msg.t) {
      case 'created':
        this.role = 'host';
        this.code = msg.code;
        break;
      case 'joined':
        this.role = 'guest';
        this.code = msg.code;
        this.peerName = msg.peerName;
        break;
      case 'peer':
        this.peerName = msg.name;
        break;
      case 'ping':
        this.send({ t: 'pong', ts: msg.ts });
        return;
      case 'pong':
        this.rtt = performance.now() - msg.ts;
        return;
      default:
        break;
    }
    this.emit(msg.t, msg);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  create(name) {
    this.send({ t: 'create', name });
  }

  join(code, name) {
    this.send({ t: 'join', code, name });
  }

  ping() {
    this.send({ t: 'ping', ts: performance.now() });
  }

  leave() {
    this.send({ t: 'leave' });
    this.role = null;
    this.code = null;
    this.peerName = null;
  }

  close() {
    if (this.ws) this.ws.close();
    this.ws = null;
    this.connected = false;
  }
}
