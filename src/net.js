// Client side of the relay: connect to the online relay if one is configured,
// otherwise to the LAN server that served the page; create or join a room,
// then exchange messages with the other player.
import { DEFAULT_RELAY } from './config.js';

const RELAY_KEY = 'deflector.relay';
const PROBE_TIMEOUT = 4000; // ms to wait for a relay's /health

/**
 * Public STUN servers, free to use: they only tell each browser the address
 * the internet sees it at, so two players can reach each other directly.
 * There is no TURN server (that would cost money): where a network allows no
 * direct link, play simply stays on the relay.
 */
export const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }];
/** A channel with this much still waiting to go out is congested: send the next message by the relay instead. */
const DIRECT_BACKLOG = 64 * 1024;

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

/**
 * A running picture of one link: its round trip, smoothed, and its jitter,
 * the typical swing of a sample away from that mean. Jitter is what a player
 * feels; the mean is what they see in the HUD.
 */
export class LinkStats {
  constructor(alpha = 0.2) {
    this.alpha = alpha;
    this.mean = 0;
    this.jitter = 0;
    this.samples = 0;
  }

  add(rtt) {
    if (!Number.isFinite(rtt) || rtt < 0) return;
    if (this.samples === 0) this.mean = rtt;
    else {
      this.jitter += (Math.abs(rtt - this.mean) - this.jitter) * this.alpha;
      this.mean += (rtt - this.mean) * this.alpha;
    }
    this.samples++;
  }

  /** "84 ms ±6", or a dash before anything has been measured. */
  get label() {
    return this.samples ? `${Math.round(this.mean)} ms ±${Math.round(this.jitter)}` : '—';
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
    this.rtt = 0; // the latest round trip to a peer, ms
    this.links = {}; // round trips to each peer by id, as LinkStats: a host sees every guest, a guest sees the host
    this.relay = new LinkStats(); // this client's own leg: the round trip to the relay itself
    // Direct links (WebRTC data channels), by peer id: a host has one per
    // guest, a guest one to the host. Unordered and never resent, so a lost
    // packet costs only itself, where on the relay's TCP it holds up every
    // packet behind it. The relay carries the handshake and anything that
    // must arrive; snapshots, inputs and pings take the direct link when it
    // is open.
    this.rtc = {};
    this.allowDirect = true;
  }

  /** Is there an open direct link to `id` (a guest id, or 'a' for the host)? */
  directOpen(id) {
    const r = this.rtc[id];
    return !!(this.allowDirect && r && r.ch && r.ch.readyState === 'open');
  }

  /** Turn direct links on or off. Off closes them (play carries on through the relay); on asks for them again. */
  setDirect(on) {
    this.allowDirect = !!on;
    if (!on) {
      for (const id of Object.keys(this.rtc)) this.closeDirect(id);
      return;
    }
    if (this.role === 'host') for (const p of this.peers) this.offerTo(p.id);
    else if (this.role === 'guest') this.send({ t: 'rtc', id: this.id, want: 1 });
  }

  closeDirect(id) {
    const r = this.rtc[id];
    if (!r) return;
    delete this.rtc[id];
    try {
      if (r.ch) r.ch.close();
      r.pc.close();
    } catch (_) {
      // already closed
    }
  }

  /** A peer connection toward `id`, its handshake going through the relay. */
  newPeer(id) {
    this.closeDirect(id);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const r = { pc, ch: null, pending: [], ready: false };
    this.rtc[id] = r;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(this.role === 'host' ? { t: 'rtc', to: id, c: e.candidate } : { t: 'rtc', id: this.id, c: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.rtc[id] === r) this.closeDirect(id);
      }
    };
    return r;
  }

  wireChannel(id, ch) {
    const r = this.rtc[id];
    if (!r) return;
    r.ch = ch;
    ch.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (_) {
        return;
      }
      this.dispatch(msg, id);
    };
    ch.onclose = () => {
      if (this.rtc[id] === r) this.closeDirect(id);
    };
  }

  /** Host: offer a direct link to guest `id`. */
  async offerTo(id) {
    if (!this.allowDirect || typeof RTCPeerConnection === 'undefined' || !id) return;
    try {
      const r = this.newPeer(id);
      this.wireChannel(id, r.pc.createDataChannel('play', { ordered: false, maxRetransmits: 0 }));
      await r.pc.setLocalDescription(await r.pc.createOffer());
      this.send({ t: 'rtc', to: id, sdp: r.pc.localDescription });
    } catch (_) {
      this.closeDirect(id);
    }
  }

  /** The handshake, carried by the relay. */
  async onRtc(msg) {
    if (typeof RTCPeerConnection === 'undefined') return;
    try {
      if (this.role === 'host') {
        const id = msg.id;
        if (msg.want) return this.offerTo(id);
        const r = this.rtc[id];
        if (!r) return;
        if (msg.sdp) {
          await r.pc.setRemoteDescription(msg.sdp);
          r.ready = true;
          for (const c of r.pending.splice(0)) await r.pc.addIceCandidate(c);
        } else if (msg.c) {
          if (r.ready) await r.pc.addIceCandidate(msg.c);
          else r.pending.push(msg.c);
        }
        return;
      }
      if (msg.to !== this.id) return; // the relay sends the host's handshakes to every guest
      if (msg.sdp && msg.sdp.type === 'offer') {
        if (!this.allowDirect) return;
        const r = this.newPeer('a');
        r.pc.ondatachannel = (e) => this.wireChannel('a', e.channel);
        await r.pc.setRemoteDescription(msg.sdp);
        r.ready = true;
        for (const c of r.pending.splice(0)) await r.pc.addIceCandidate(c);
        await r.pc.setLocalDescription(await r.pc.createAnswer());
        this.send({ t: 'rtc', id: this.id, sdp: r.pc.localDescription });
      } else if (msg.c) {
        const r = this.rtc.a;
        if (!r) return;
        if (r.ready) await r.pc.addIceCandidate(msg.c);
        else r.pending.push(msg.c);
      }
    } catch (_) {
      // A handshake that fails leaves play on the relay, which is where it already is.
    }
  }

  /** Send over the direct link to `id` if it is open and not backed up. True if it went. */
  sendDirect(id, obj) {
    if (!this.directOpen(id)) return false;
    const ch = this.rtc[id].ch;
    if (ch.bufferedAmount > DIRECT_BACKLOG) return false;
    try {
      ch.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * A message that can be lost (it is sent again, or superseded, soon):
   * snapshots and inputs. A guest sends it to the host directly if it can.
   * A host sends it directly to every guest it can and, if any guest has no
   * direct link, once through the relay too (which hands it to every guest;
   * a guest with both drops the second copy). Returns how it went: 'direct',
   * 'relay' or 'both'.
   */
  sendFast(obj) {
    const data = JSON.stringify(obj);
    if (this.role !== 'host') {
      if (this.sendDirect('a', data)) return 'direct';
      this.send(data);
      return 'relay';
    }
    let relayed = false;
    let direct = false;
    for (const p of this.peers) {
      if (this.sendDirect(p.id, data)) direct = true;
      else relayed = true;
    }
    if (relayed || !this.peers.length) this.send(data);
    return direct && relayed ? 'both' : direct ? 'direct' : 'relay';
  }

  /** The stats for the peer `id`, made on first use. */
  link(id) {
    if (!this.links[id]) this.links[id] = new LinkStats();
    return this.links[id];
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

  /**
   * Open the socket. `opts.create` for a host making a room, `opts.room` for
   * a guest joining one: the online relay gives every room its own object and
   * finds it from the address (the LAN server ignores both).
   */
  connect(opts = {}) {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const relay = relayConfig();
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const base = relay ? relay.ws : `${proto}://${location.host}/ws`;
      const query = opts.create ? '?create=1' : opts.room ? `?room=${encodeURIComponent(String(opts.room).toUpperCase())}` : '';
      const ws = new WebSocket(base + query);
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

  /** A message from the relay, or from the direct link to `via`. */
  dispatch(msg, via = null) {
    // A host with some guests on the relay sends pings there too: a guest with its own direct link answers only the direct one.
    if (!via && msg.t === 'ping' && this.role === 'guest' && this.directOpen('a')) return;
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
        // A host offers every guest a direct link as they arrive.
        if (this.role === 'host') this.offerTo(msg.id || 'c');
        break;
      case 'peer-left':
        this.peers = this.peers.filter((p) => p.id !== msg.id);
        if (this.role === 'host') this.closeDirect(msg.id);
        else if (msg.id === 'a') this.closeDirect('a');
        break;
      case 'rtc':
        this.onRtc(msg);
        return;
      case 'ping': {
        // Answered the way it came, so the round trip measured is the path play takes.
        const pong = { t: 'pong', ts: msg.ts, id: this.id };
        if (!(via && this.sendDirect(via, pong))) this.send(pong);
        return;
      }
      case 'pong': {
        this.rtt = performance.now() - msg.ts;
        this.link(msg.id || (this.role === 'host' ? 'c' : 'a')).add(this.rtt);
        return;
      }
      case 'rpong':
        // The relay answered for itself: this is our own leg alone.
        this.relay.add(performance.now() - msg.ts);
        return;
      default:
        break;
    }
    this.emit(msg.t, msg);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }

  create(name) {
    this.send({ t: 'create', name });
  }

  join(code, name) {
    this.send({ t: 'join', code, name });
  }

  /** Ping the peers (directly where there is a link, else through the relay), and the relay itself. */
  ping() {
    const ts = performance.now();
    this.sendFast({ t: 'ping', ts });
    this.send({ t: 'rping', ts });
  }

  leave() {
    this.send({ t: 'leave' });
    for (const id of Object.keys(this.rtc)) this.closeDirect(id);
    this.links = {};
    this.role = null;
    this.id = null;
    this.code = null;
    this.peerName = null;
    this.peers = [];
  }

  close() {
    for (const id of Object.keys(this.rtc)) this.closeDirect(id);
    if (this.ws) this.ws.close();
    this.ws = null;
    this.connected = false;
  }
}
