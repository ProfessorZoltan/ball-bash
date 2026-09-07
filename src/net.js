// Client side of the relay: connect to the online relay if one is configured,
// otherwise to the LAN server that served the page; create or join a room,
// then exchange messages with the other player.
import { DEFAULT_RELAY } from './config.js';

const RELAY_KEY = 'deflector.relay';
const PROBE_TIMEOUT = 4000; // ms to wait for a relay's /health

// Set by available() when the configured relay did not answer but the page's
// own server did (the desktop app, or npm start): play goes through that
// server until the relay setting is changed again.
let originFallback = false;

/**
 * The configured relay, or null for the page's own server. Order: the
 * ?relay= query parameter, the address saved in this browser, DEFAULT_RELAY.
 * Returns { ws, http, label } with the WebSocket and HTTP base URLs. An
 * address without a scheme is secure (wss) unless it is a LAN-style host: an
 * IP address, localhost, or a bare machine name, as when a friend hosts from
 * the desktop app and shares "192.168.1.20:27411".
 */
export function relayConfig() {
  if (originFallback) return null;
  let raw = '';
  try {
    raw = new URLSearchParams(location.search).get('relay') || localStorage.getItem(RELAY_KEY) || DEFAULT_RELAY || '';
  } catch (_) {
    raw = DEFAULT_RELAY || '';
  }
  raw = String(raw).trim();
  if (!raw) return null;
  if (/^(local|lan|origin)$/i.test(raw)) return null; // the page's own server, even when a default relay is configured
  const m = raw.match(/^(?:(wss?|https?):\/\/)?([^/\s]+)/i);
  if (!m) return null;
  const host = m[2];
  const lanHost = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|[^.:]+)(:\d+)?$/i.test(host);
  const proto = (m[1] || (lanHost ? 'ws' : 'wss')).toLowerCase();
  const secure = proto === 'wss' || proto === 'https';
  return { ws: `${secure ? 'wss' : 'ws'}://${host}/ws`, http: `${secure ? 'https' : 'http'}://${host}`, label: host };
}

/** Save (or with an empty string, clear) the relay address for this browser. */
export function saveRelay(address) {
  originFallback = false;
  try {
    if (String(address || '').trim()) localStorage.setItem(RELAY_KEY, String(address).trim());
    else localStorage.removeItem(RELAY_KEY);
  } catch (_) {
    // storage unavailable; the choice lasts for this page load only
  }
}

/** GET a JSON status URL; null when it does not answer in time. */
async function probe(url) {
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(PROBE_TIMEOUT) : undefined;
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.role = null;
    this.code = null;
    this.id = null; // 'a' as host, 'c' or 'd' as a guest
    this.peerName = null;
    this.peers = []; // guests in the room other than this client: [{ id, name }]
    this.rtt = 0;
  }

  /**
   * Is a relay reachable? The configured online relay's /health, or else the
   * LAN server's /lan (which a static host does not have). Resolves to
   * { online, relay, addresses, port, rooms } or null.
   */
  static async available() {
    originFallback = false;
    const relay = relayConfig();
    const info = await probe(relay ? `${relay.http}/health` : '/lan');
    if (info) return { ...info, online: !!relay, relay };
    if (!relay) return null;
    // The relay is out of reach (offline, or a stale address): fall back to
    // the page's own server when there is one, so LAN play still works.
    const local = await probe('/lan');
    if (!local) return null;
    originFallback = true;
    return { ...local, online: false, relay: null, unreachable: relay.label };
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
        this.id = 'a';
        this.code = msg.code;
        this.peers = [];
        break;
      case 'joined':
        this.role = 'guest';
        this.id = msg.id || 'c';
        this.code = msg.code;
        this.peerName = msg.peerName;
        this.peers = Array.isArray(msg.peers) ? msg.peers : [];
        break;
      case 'peer':
        this.peerName = msg.name;
        if (!this.peers.some((p) => p.id === (msg.id || 'c'))) this.peers.push({ id: msg.id || 'c', name: msg.name });
        break;
      case 'peer-left':
        this.peers = this.peers.filter((p) => p.id !== msg.id);
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
    this.id = null;
    this.code = null;
    this.peerName = null;
    this.peers = [];
  }

  close() {
    if (this.ws) this.ws.close();
    this.ws = null;
    this.connected = false;
  }
}
