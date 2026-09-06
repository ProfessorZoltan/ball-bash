// Client side of the LAN relay: connect to the server that served the page,
// create or join a room, then exchange messages with the other player.

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

  /** Is this page served by the LAN server (as opposed to static hosting)? */
  static async available() {
    try {
      const res = await fetch('/lan', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
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
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true;
        resolve();
      };
      ws.onerror = () => {
        if (!this.connected) reject(new Error('Could not reach the LAN server'));
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
