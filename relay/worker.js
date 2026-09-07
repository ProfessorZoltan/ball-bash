// Deflector's online relay as a Cloudflare Worker with one Durable Object.
//
// It speaks exactly the protocol of the LAN relay in ../server.js: a client
// connects to /ws, sends {t:'create', name} or {t:'join', code, name}, and
// from then on every other message is forwarded verbatim to the other player
// in the room. /health answers with JSON so the game can tell the relay is up.
//
// One Durable Object instance ("main") holds every room. It uses the
// WebSocket Hibernation API, so an idle relay costs nothing: sockets stay
// open while the object sleeps, and the room index is rebuilt from each
// socket's attachment when it wakes.
//
// Deploy: npx wrangler deploy   (see README, "Online multiplayer")

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const stub = env.RELAY.get(env.RELAY.idFromName('main'));
    if (url.pathname === '/health' || url.pathname === '/lan') {
      const stats = await stub.fetch(new Request('https://relay/stats')).then((r) => r.json());
      return json({ ok: true, v: PROTOCOL, online: true, rooms: stats.rooms, addresses: [], port: null });
    }
    if (url.pathname === '/ws') {
      if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('Expected a WebSocket upgrade', { status: 426, headers: CORS });
      return stub.fetch(req);
    }
    return new Response('Deflector relay. The game connects to /ws; /health reports status.', { headers: { 'Content-Type': 'text/plain', ...CORS } });
  },
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_GUESTS = 2; // a host and up to two friends (three-player co-op)
const GUEST_IDS = ['c', 'd'];
const PROTOCOL = 2; // bumped when the relay protocol changes; the game warns about a stale relay

export class RelayRoom {
  constructor(state) {
    this.state = state;
    // code -> { host, hostName, guests: [{ ws, id, name }] }, rebuilt from socket attachments after a wake-up.
    this.rooms = new Map();
    for (const ws of state.getWebSockets()) {
      const a = this.attachment(ws);
      if (!a.room) continue;
      const room = this.rooms.get(a.room) || { code: a.room, host: null, hostName: '', guests: [] };
      if (a.role === 'host') {
        room.host = ws;
        room.hostName = a.name;
      } else room.guests.push({ ws, id: a.id, name: a.name });
      this.rooms.set(a.room, room);
    }
  }

  attachment(ws) {
    try {
      return ws.deserializeAttachment() || { room: null, role: null, id: null, name: '' };
    } catch (_) {
      return { room: null, role: null, id: null, name: '' };
    }
  }

  setAttachment(ws, a) {
    ws.serializeAttachment(a);
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/stats') return json({ rooms: this.rooms.size });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.setAttachment(server, { room: null, role: null, id: null, name: '' });
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, obj) {
    try {
      ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
    } catch (_) {
      // the socket is gone; its close event will tidy the room
    }
  }

  makeCode() {
    let code;
    do {
      const bytes = crypto.getRandomValues(new Uint8Array(4));
      code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  webSocketMessage(ws, message) {
    if (typeof message !== 'string') return;
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (_) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const a = this.attachment(ws);
    if (msg.t === 'create') {
      if (a.room) this.leaveRoom(ws);
      const code = this.makeCode();
      const name = String(msg.name || 'Host').slice(0, 16);
      this.rooms.set(code, { code, host: ws, hostName: name, guests: [] });
      this.setAttachment(ws, { room: code, role: 'host', id: 'a', name });
      this.send(ws, { t: 'created', code, v: PROTOCOL });
      return;
    }
    if (msg.t === 'join') {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = this.rooms.get(code);
      if (!room) return this.send(ws, { t: 'error', msg: `No room ${code}` });
      if (room.guests.length >= MAX_GUESTS) return this.send(ws, { t: 'error', msg: 'That room is full' });
      if (a.room) this.leaveRoom(ws);
      const name = String(msg.name || 'Guest').slice(0, 16);
      const id = GUEST_IDS.find((g) => !room.guests.some((x) => x.id === g));
      const peers = room.guests.map((g) => ({ id: g.id, name: g.name }));
      room.guests.push({ ws, id, name });
      this.setAttachment(ws, { room: code, role: 'guest', id, name });
      this.send(ws, { t: 'joined', code, id, peerName: room.hostName, peers, v: PROTOCOL });
      this.send(room.host, { t: 'peer', id, name });
      for (const g of room.guests) if (g.ws !== ws) this.send(g.ws, { t: 'peer', id, name });
      return;
    }
    if (msg.t === 'leave') {
      this.leaveRoom(ws);
      return;
    }
    // Everything else is relayed untouched: a guest's messages go to the host,
    // the host's to every guest.
    const room = a.room && this.rooms.get(a.room);
    if (!room) return;
    if (a.role === 'host') {
      for (const g of room.guests) this.send(g.ws, message);
    } else if (room.host) this.send(room.host, message);
  }

  webSocketClose(ws) {
    this.leaveRoom(ws);
  }

  webSocketError(ws) {
    this.leaveRoom(ws);
  }

  leaveRoom(ws) {
    const a = this.attachment(ws);
    const room = a.room && this.rooms.get(a.room);
    this.setAttachment(ws, { room: null, role: null, id: null, name: a.name });
    if (!room) return;
    if (a.role === 'host') {
      for (const g of room.guests) {
        this.send(g.ws, { t: 'peer-left', id: 'a', name: a.name });
        this.setAttachment(g.ws, { room: null, role: null, id: null, name: g.name });
      }
      this.rooms.delete(room.code);
    } else {
      room.guests = room.guests.filter((g) => g.ws !== ws);
      if (room.host) this.send(room.host, { t: 'peer-left', id: a.id, name: a.name });
      for (const g of room.guests) this.send(g.ws, { t: 'peer-left', id: a.id, name: a.name });
    }
  }
}
