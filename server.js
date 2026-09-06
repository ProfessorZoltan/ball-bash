// Zero-dependency static server plus a tiny WebSocket relay for LAN
// multiplayer. Usage: node server.js [port]
//
//   GET /            the game
//   GET /lan         JSON: this machine's LAN addresses and the port
//   WS  /ws          room relay: create / join a room, then every other
//                    message is forwarded verbatim to the other player
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/lan') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ addresses: lanAddresses(), port, rooms: rooms.size }));
    return;
  }
  let file = path.normalize(path.join(root, url === '/' ? 'index.html' : url));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
});

// ------------------------------------------------------------ WebSocket

/** Minimal RFC 6455 server-side connection: text frames, ping/pong, close. */
class WsConn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.closed = false;
    this.onmessage = null;
    this.onclose = null;
    socket.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      try {
        while (this.parseFrame()) {}
      } catch (e) {
        this.close();
      }
    });
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
    socket.on('end', () => this.finish());
  }

  parseFrame() {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return false;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return false;
      len = Number(b.readBigUInt64BE(2));
      off = 10;
    }
    if (len > 1 << 20) throw new Error('frame too large');
    let mask = null;
    if (masked) {
      if (b.length < off + 4) return false;
      mask = b.subarray(off, off + 4);
      off += 4;
    }
    if (b.length < off + len) return false;
    const payload = Buffer.from(b.subarray(off, off + len));
    if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(off + len);
    if (op === 0x0) {
      if (this.frag) {
        this.frag.parts.push(payload);
        if (fin) {
          const full = Buffer.concat(this.frag.parts);
          const type = this.frag.op;
          this.frag = null;
          if (type === 0x1 && this.onmessage) this.onmessage(full.toString('utf8'));
        }
      }
    } else if (op === 0x1 || op === 0x2) {
      if (!fin) this.frag = { op, parts: [payload] };
      else if (op === 0x1 && this.onmessage) this.onmessage(payload.toString('utf8'));
    } else if (op === 0x8) {
      this.close();
    } else if (op === 0x9) {
      this.sendFrame(0xa, payload);
    }
    return true;
  }

  sendFrame(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | op, len]);
    else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | op;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    this.socket.write(Buffer.concat([header, payload]));
  }

  send(text) {
    this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }

  close() {
    if (this.closed) return;
    try {
      this.sendFrame(0x8, Buffer.alloc(0));
    } catch (_) {
      // socket already gone
    }
    this.socket.end();
    this.finish();
  }

  finish() {
    if (this.closed) return;
    this.closed = true;
    if (this.onclose) this.onclose();
  }
}

// ----------------------------------------------------------------- rooms

const rooms = new Map(); // code -> { code, host, guest }
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function sendJson(conn, obj) {
  conn.send(JSON.stringify(obj));
}

function handleMessage(conn, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (_) {
    return;
  }
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'create') {
    if (conn.room) leaveRoom(conn);
    const code = makeCode();
    rooms.set(code, { code, host: conn, guest: null });
    conn.room = code;
    conn.role = 'host';
    conn.name = String(msg.name || 'Host').slice(0, 16);
    sendJson(conn, { t: 'created', code });
    return;
  }
  if (msg.t === 'join') {
    const code = String(msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return sendJson(conn, { t: 'error', msg: `No room ${code}` });
    if (room.guest) return sendJson(conn, { t: 'error', msg: 'That room is full' });
    if (conn.room) leaveRoom(conn);
    room.guest = conn;
    conn.room = code;
    conn.role = 'guest';
    conn.name = String(msg.name || 'Guest').slice(0, 16);
    sendJson(conn, { t: 'joined', code, peerName: room.host.name });
    sendJson(room.host, { t: 'peer', name: conn.name });
    return;
  }
  if (msg.t === 'leave') {
    leaveRoom(conn);
    return;
  }
  // Everything else is relayed to the other player untouched.
  const room = conn.room && rooms.get(conn.room);
  if (!room) return;
  const peer = conn.role === 'host' ? room.guest : room.host;
  if (peer && !peer.closed) peer.send(text);
}

function leaveRoom(conn) {
  const room = conn.room && rooms.get(conn.room);
  conn.room = null;
  if (!room) return;
  if (conn.role === 'host') {
    if (room.guest && !room.guest.closed) sendJson(room.guest, { t: 'peer-left' });
    if (room.guest) room.guest.room = null;
    rooms.delete(room.code);
  } else {
    room.guest = null;
    if (!room.host.closed) sendJson(room.host, { t: 'peer-left' });
  }
}

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const conn = new WsConn(socket);
  conn.room = null;
  conn.role = null;
  conn.name = '';
  conn.onmessage = (text) => handleMessage(conn, text);
  conn.onclose = () => leaveRoom(conn);
});

server.listen(port, () => {
  const lan = lanAddresses();
  console.log(`Deflector running at http://localhost:${port}`);
  for (const a of lan) console.log(`  LAN: http://${a}:${port}   (share this for multiplayer)`);
});
