// Defector's multiplayer, the part with no page in it: what goes over the
// wire and what each end does with it. The connection itself is Deflector's
// relay client (src/net.js); Defector's messages all start with 'dx', so a
// Defector room and a Deflector room never read each other's.
//
// The host runs the one real game. A guest sends its inputs, the host plays
// them, and the host sends everyone snapshots of the game. So that a guest
// never waits a round trip to see its own robot move:
//
//  - Each guest frame is one input record, [seq, steps, mx, bits, aim], for
//    exactly the physics steps it covered; every message repeats the last
//    six, so a lost one costs nothing. The host keeps them in a queue like
//    a jitter buffer (HostQueue, Deflector's InputQueue in Defector's
//    shape) and plays each for exactly those steps. When the queue runs dry
//    the robot waits where it is rather than being guessed at.
//  - The guest predicts its own robot: it steps it itself with the same
//    physics the host will use. Each snapshot says how far through the
//    guest's records the host has got (the ack), and where the robot was
//    then; the guest puts its robot there and plays again what the host has
//    not played yet. What is left of the difference is smoothed away on
//    screen over a moment, not jumped.
//  - Everything else (the other robots, enemies, charges, the boss) the
//    guest shows as it was NET.interp ago, between the two snapshots either
//    side of then, so it moves smoothly whatever the network does. What the
//    guest's own robot stands on or goes through (doors, crates, wormholes,
//    ice, falling platforms) it takes from the newest snapshot.
//  - Sounds and particles are sent too, each once in several snapshots in
//    a row, and played by the guest as the moment they belong to is shown.
//  - Every match in a room has its own number, and inputs and snapshots
//    carry it. The last of one match's messages can still be on their way
//    when the next starts, and each end drops any that are not for the match
//    it is playing: a guest's records start from 1 again, and a host queue
//    that took an old one numbered in the hundreds would take every new one
//    as older still, and the robot would never move.
import { PHYSICS_DT, POWERUPS } from './config.js';
import { MIN_BUFFER, MAX_BUFFER, BUFFER_GROWTH, CALM_STEPS, CATCH_UP_OVER, TRIM_OVER, REDUNDANCY, splitAck } from '../../src/inputqueue.js';
import { Enemy, iceBlock } from './enemies.js';
import { Boss } from './bosses.js';
import { Charge } from './blaster.js';
import { segId, segById, makeWell, setGate, tickWells } from './world.js';
import { stepRobot } from './player.js';
import { OneRing } from './game.js';
import { PORTAL } from './wormholes.js';

export const NET = {
  version: 1, // bumped when a message changes shape: a room refuses a guest from another version
  snapHz: 30, // snapshots a second
  sendHz: 60, // input messages a second, whatever the display runs at
  interp: 0.1, // seconds behind the newest snapshot that a guest shows everything but its own robot
  logKeep: 0.3, // seconds a sound or particle is repeated in snapshots, in case one is lost
  smooth: 0.1, // seconds a correction to a guest's own robot takes to fade on screen
  snapOver: 160, // px: a correction bigger than this (a respawn, a wormhole) is a jump, not smoothed
};

/** Defector's own message types. */
export const MSG = {
  hello: 'dxHello', // guest → host: { v, name }
  room: 'dxRoom', // host → all: the room as it stands { v, players, pick }
  no: 'dxNo', // host → guest: refused { why }
  start: 'dxStart', // host → all: a match or level starts { mode, level | map, players, shields, ... }
  input: 'dxIn', // guest → host: { r: records, v: view }
  snap: 'dxS', // host → all: a snapshot
  end: 'dxEnd', // host → all: the level or match is over { result }
  back: 'dxBack', // host → all: back to the room
};

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const lerp = (a, b, k) => a + (b - a) * k;
const KINDS = ['std', ...POWERUPS.map((p) => p.id)];

// ---------------------------------------------------------------- intents

const RUN = 1;
const JUMP = 2;
const JUMPED = 4; // jumpPressed
const DOWN = 8;
const FIRE = 16;
const CYCLE = 32;
const WORM0 = 64;
const WORM1 = 128;
/** The bits that are presses: they belong to the first step of a record only. */
export const PRESSES = JUMPED | FIRE | CYCLE | WORM0 | WORM1;

/** An intent as [mx, bits, aim]. */
export function packIntent(it) {
  let b = 0;
  if (it.run) b |= RUN;
  if (it.jump) b |= JUMP;
  if (it.jumpPressed) b |= JUMPED;
  if (it.down) b |= DOWN;
  if (it.fire) b |= FIRE;
  if (it.cycle) b |= CYCLE;
  if (it.worm && it.worm[0]) b |= WORM0;
  if (it.worm && it.worm[1]) b |= WORM1;
  return [r3(+it.mx || 0), b, it.aim == null || !Number.isFinite(it.aim) ? null : Math.round(it.aim * 1e4) / 1e4];
}

export function unpackIntent(mx, b, aim) {
  return { mx, run: !!(b & RUN), jump: !!(b & JUMP), jumpPressed: !!(b & JUMPED), down: !!(b & DOWN), fire: !!(b & FIRE), cycle: !!(b & CYCLE), worm: [!!(b & WORM0), !!(b & WORM1)], aim };
}

/** Step `i` of a record: the presses only on the first. */
export function recordStep(rec, i) {
  return unpackIntent(rec[2], i === 0 ? rec[3] : rec[3] & ~PRESSES, rec[4]);
}

/** A guest's inputs going out: one record a frame, the last few repeated in every message. */
export class GuestInputs {
  constructor(match = 0) {
    this.match = match;
    this.seq = 0;
    this.recent = [];
    this.carry = 0; // presses from a frame that covered no steps, kept for the next
  }

  /** This frame's record (null for a frame of no steps; its presses wait for the next). */
  record(it, steps) {
    const [mx, bits, aim] = packIntent(it);
    const b = bits | this.carry;
    if (!steps) {
      this.carry = b & PRESSES;
      return null;
    }
    this.carry = 0;
    const rec = [++this.seq, steps, mx, b, aim];
    this.recent.push(rec);
    if (this.recent.length > REDUNDANCY) this.recent.shift();
    return rec;
  }

  message(view) {
    return { t: MSG.input, m: this.match, r: this.recent.slice(), v: view ? [r1(view.x), r1(view.y), r1(view.hw), r1(view.hh)] : null };
  }
}

/**
 * One guest's records as the host plays them: in order, each for exactly
 * the steps it covered, with a cushion against uneven arrival that grows when
 * it runs dry and shrinks when calm (the rules of src/inputqueue.js).
 */
export class HostQueue {
  constructor() {
    this.lastSeq = 0;
    this.ack = 0;
    this.q = [];
    this.latch = 0; // presses in records trimmed away, kept for the next step played
    this.buffer = MIN_BUFFER;
    this.waiting = true;
    this.calm = 0;
    this.stats = { played: 0, waited: 0, starved: 0, caughtUp: 0, trimmed: 0 };
  }

  get depth() {
    let n = 0;
    for (const r of this.q) n += r.n - r.used;
    return n;
  }

  push(records) {
    if (!Array.isArray(records)) return 0;
    const fresh = records.filter((r) => Array.isArray(r) && r[0] > this.lastSeq).sort((a, b) => a[0] - b[0]);
    for (const r of fresh) {
      this.lastSeq = r[0];
      const n = Math.max(0, Math.min(16, r[1] | 0));
      if (!n) continue;
      this.q.push({ seq: r[0], n, used: 0, rec: r });
    }
    if (this.depth > this.buffer + TRIM_OVER) {
      while (this.depth > this.buffer) {
        const h = this.q[0];
        if (h.used === 0) this.latch |= h.rec[3] & PRESSES;
        this.used(h);
        this.stats.trimmed++;
      }
    }
    return fresh.length;
  }

  used(h) {
    h.used++;
    if (h.used >= h.n) {
      this.q.shift();
      this.ack = h.seq;
    }
  }

  playOne() {
    const h = this.q[0];
    const it = recordStep(h.rec, h.used);
    if (this.latch) {
      const extra = unpackIntent(0, this.latch, null);
      it.jumpPressed ||= extra.jumpPressed;
      it.fire ||= extra.fire;
      it.cycle ||= extra.cycle;
      it.worm = [it.worm[0] || extra.worm[0], it.worm[1] || extra.worm[1]];
      this.latch = 0;
    }
    this.used(h);
    this.stats.played++;
    return it;
  }

  /** What the guest's robot plays this host step: nothing (it waits), one step, or two (catching up). */
  next() {
    if (this.waiting) {
      if (this.depth < this.buffer) {
        this.stats.waited++;
        return [];
      }
      this.waiting = false;
    }
    if (!this.q.length) {
      this.waiting = true;
      this.buffer = Math.min(MAX_BUFFER, this.buffer + BUFFER_GROWTH);
      this.calm = 0;
      this.stats.starved++;
      this.stats.waited++;
      return [];
    }
    if (++this.calm >= CALM_STEPS) {
      this.calm = 0;
      this.buffer = Math.max(MIN_BUFFER, this.buffer - 1);
    }
    const out = [this.playOne()];
    if (this.q.length && this.depth > this.buffer + CATCH_UP_OVER) {
      out.push(this.playOne());
      this.stats.caughtUp++;
    }
    return out;
  }

  ackPair() {
    return [this.ack, this.q.length ? this.q[0].used : 0];
  }
}

// -------------------------------------------------------------- snapshots

/**
 * Plain data from an object: numbers (rounded to 0.01), booleans, strings
 * and nulls, and arrays and plain objects of them, a few levels deep.
 * Anything else (a class instance, a function, a Set) is left out.
 */
export function plain(v, depth = 0) {
  if (v == null) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : v > 0 ? 1e12 : v < 0 ? -1e12 : 0;
  if (t === 'boolean' || t === 'string') return v;
  if (t !== 'object' || depth > 3) return undefined;
  if (Array.isArray(v)) return v.map((x) => (plain(x, depth + 1) ?? null));
  if (Object.getPrototypeOf(v) !== Object.prototype) return undefined;
  const o = {};
  for (const k of Object.keys(v)) {
    const p = plain(v[k], depth + 1);
    if (p !== undefined) o[k] = p;
  }
  return o;
}

/** An object's own fields as plain data, leaving out `skip`. */
function fields(obj, skip) {
  const o = {};
  for (const k of Object.keys(obj)) {
    if (skip.has(k)) continue;
    const p = plain(obj[k], 1);
    if (p !== undefined) o[k] = p;
  }
  return o;
}

/** Put plain fields back on an object (1e12 is Infinity again). */
function restore(obj, o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    obj[k] = v === 1e12 ? Infinity : v === -1e12 ? -Infinity : v;
  }
}

const ENEMY_SKIP = new Set(['k', 'ice', 'room', 'prevX', 'prevY']);
const BOSS_SKIP = new Set(['def', 'A', 'parts', 'prevX', 'prevY']);

/** A robot's whole state: enough for a guest to carry on its physics from exactly there. */
function robotState(pl) {
  const b = pl.bot;
  const flags = (b.onGround ? 1 : 0) | (b.rising ? 2 : 0) | (pl.out ? 4 : 0) | (b.warped ? 8 : 0);
  return [
    pl.slot,
    b.x,
    b.y,
    b.vx,
    b.vy,
    flags,
    b.aim,
    r3(b.invuln || 0),
    pl.pool === Infinity ? -1 : pl.pool,
    KINDS.indexOf(pl.loaded),
    KINDS.slice(1).map((k) => pl.ammo[k] || 0),
    r3(pl.cool),
    r3(pl.frozen),
    b.coyote,
    b.buffer,
    b.dropHold,
    b.dropping,
    b.portalGrace,
    b.lastMouth,
    null, // the ground, filled in by snapshot() (it needs the world)
    b.airT,
    r3(b.landed),
    r3(b.flare),
    b.takeoff ? [r1(b.takeoff.x), r1(b.takeoff.y)] : null,
    [b.safe.x, b.safe.y],
    b.safeT,
    [...b.pulseSeen],
    b.facing,
    [pl.stats.shieldsLost, pl.stats.hits, pl.stats.falls, pl.stats.powerups],
  ];
}

function applyRobot(pl, a, world, physics) {
  const b = pl.bot;
  pl.pool = a[8] === -1 ? Infinity : a[8];
  pl.loaded = KINDS[a[9]] || 'std';
  KINDS.slice(1).forEach((k, i) => (pl.ammo[k] = a[10][i] || 0));
  pl.cool = a[11];
  pl.frozen = a[12];
  pl.out = !!(a[5] & 4);
  b.invuln = a[7];
  [pl.stats.shieldsLost, pl.stats.hits, pl.stats.falls, pl.stats.powerups] = a[28];
  if (!physics) return;
  b.flare = a[22];
  b.takeoff = a[23] ? { x: a[23][0], y: a[23][1] } : null;
  b.x = a[1];
  b.y = a[2];
  b.vx = a[3];
  b.vy = a[4];
  b.onGround = !!(a[5] & 1);
  b.rising = !!(a[5] & 2);
  b.warped = !!(a[5] & 8);
  b.aim = a[6];
  b.coyote = a[13];
  b.buffer = a[14];
  b.dropHold = a[15];
  b.dropping = a[16];
  b.portalGrace = a[17];
  b.lastMouth = a[18];
  b.ground = segById(world, a[19]);
  b.groundMover = b.ground && b.ground.mover ? b.ground.mover : null;
  b.airT = a[20];
  b.landed = a[21];
  b.safe = { x: a[24][0], y: a[24][1] };
  b.safeT = a[25];
  b.pulseSeen = new Set(a[26]);
  b.facing = a[27];
}

function portalState(world, p) {
  if (!p) return null;
  const h = p.host;
  const host = h.kind === 'mover' ? ['m', h.m.index, h.si, r3(h.s), h.side] : ['w', segId(world, h.seg)];
  return [r2(p.cx), r2(p.cy), r3(p.nx), r3(p.ny), host, p.visited ? 1 : 0];
}

function applyPortal(world, owner, which, a, old) {
  if (!a) return null;
  const host = a[4][0] === 'm' ? { kind: 'mover', m: world.movers[a[4][1]], si: a[4][2], s: a[4][3], side: a[4][4] } : { kind: 'wall', seg: segById(world, a[4][1]) };
  if ((host.kind === 'wall' && !host.seg) || (host.kind === 'mover' && !host.m)) return null;
  const p = old && old.cx === a[0] && old.cy === a[1] ? old : { owner, which, key: `${owner}${which}`, hw: PORTAL.halfWidth, cx: 0, cy: 0, nx: 0, ny: 0 };
  p.cx = a[0];
  p.cy = a[1];
  p.nx = a[2];
  p.ny = a[3];
  p.host = host;
  p.visited = !!a[5];
  return p;
}

function wellState(w) {
  return [r1(w.x), r1(w.y), w.r, w.range, Math.round(w.pull), (w.solid ? 1 : 0) | (w.fount ? 2 : 0) | (w.hazard ? 4 : 0) | (w.absent ? 8 : 0) | (w.charted ? 16 : 0), r2(w.drag || 0)];
}

function pulserState(p) {
  if (p.oneShot) return ['r', r1(p.x), r1(p.y), r1(p.radius), p.speed, p.maxRadius, p.color, p.nextAt];
  return ['p', r3(p.t), r3(p.nextAt), p.active ? 1 : 0, r1(p.x), r1(p.y), r1(p.radius), p.sx ?? 0, p.sy ?? 0];
}

/**
 * The host's side: the queue of each guest's inputs, the particles and
 * sounds made since the last snapshot, and the snapshots themselves.
 */
export class HostLink {
  constructor(game, match = 0) {
    this.game = game;
    this.match = match;
    this.n = 0;
    this.queues = new Map(); // slot → HostQueue
    this.log = []; // [id, time, entry]
    this.logId = 0;
    this.gone = []; // [enemy id, time it went]
    this.known = new Set(game.enemies.map((e) => e.id));
    // Every particle the game makes is written down as it is made, so the guests make it too.
    const fx = game.fx;
    for (const name of ['explode', 'sparks', 'dust', 'ring', 'word', 'kick']) {
      const real = fx[name].bind(fx);
      fx[name] = (...args) => {
        this.note(['f', fx.who, name, plain(args)]);
        return real(...args);
      };
    }
  }

  note(entry) {
    this.log.push([++this.logId, this.game.time, entry]);
  }

  queue(slot) {
    if (!this.queues.has(slot)) this.queues.set(slot, new HostQueue());
    return this.queues.get(slot);
  }

  /** A guest's message: its records into its queue, and where its screen is. */
  input(slot, msg) {
    if ((msg.m ?? 0) !== this.match) return; // the last of another match's inputs
    this.queue(slot).push(msg.r);
    const pl = this.game.players[slot];
    if (pl && Array.isArray(msg.v)) pl.view = { x: msg.v[0], y: msg.v[1], hw: msg.v[2], hh: msg.v[3] };
  }

  /** The intents for one host step: the host's own, and each guest's from its queue (null to wait, a list to catch up). */
  intents(own) {
    return this.game.players.map((pl) => {
      if (pl.slot === this.game.local) return own;
      const q = this.queues.get(pl.slot);
      if (!q) return null;
      const n = q.next();
      return n.length === 0 ? null : n.length === 1 ? n[0] : n;
    });
  }

  /** The game's events this frame (before the page clears them), for the guests to hear too. */
  events(list) {
    for (const e of list) this.note(['e', plain(e)]);
  }

  snapshot() {
    const g = this.game;
    const w = g.world;
    const now = g.time;
    // Enemies that went since last time, remembered a while in case a snapshot is lost.
    const ids = new Set(g.enemies.map((e) => e.id));
    for (const id of this.known) if (!ids.has(id)) this.gone.push([id, now]);
    this.known = ids;
    this.gone = this.gone.filter(([, t]) => now - t < 1.5);
    this.log = this.log.filter(([, t]) => now - t <= NET.logKeep);
    const acks = {};
    for (const [slot, q] of this.queues) acks[slot] = q.ackPair();
    const pl = g.players.map((p) => {
      const a = robotState(p);
      a[19] = segId(w, p.bot.ground);
      return a;
    });
    const po = {};
    for (const [k, pair] of Object.entries(w.portals)) if (pair) po[k] = [portalState(w, pair[0]), portalState(w, pair[1])];
    return {
      t: MSG.snap,
      m: this.match,
      n: ++this.n,
      tm: g.time,
      wt: w.t,
      ph: g.phase,
      pt: r3(g.phaseT),
      pl,
      ak: acks,
      ch: g.charges.map((c) => [c.id, c.owner, r2(c.x), r2(c.y), r1(c.vx), r1(c.vy), c.r, KINDS.indexOf(c.kind), c.color, (c.freeze ? 1 : 0) | (c.warped ? 2 : 0), c.warps]),
      sh: g.shots.map((c) => [c.id, r2(c.x), r2(c.y), r1(c.vx), r1(c.vy), c.r, c.color, c.look || 'orb']),
      en: g.enemies.filter((e) => e.awake || e.frozen > 0 || e.flash > 0).map((e) => ({ ...fields(e, ENEMY_SKIP), ic: e.ice ? [e.ice.x0, e.ice.y0, e.ice.x1 - e.ice.x0] : null })),
      eg: this.gone.map(([id]) => id),
      pk: g.pickups.map((p) => [p.id, p.kind, r1(p.x), r1(p.y), p.owner, p.resting ? 1 : 0, r2(p.t)]),
      po,
      gt: w.gates.map((x) => (x.closed ? 1 : 0)).join(''),
      sw: w.switches.map((s) => [s.on ? 1 : 0, r2(s.t), r2(s.flash)]),
      cr: w.crates.map((c) => (c.broken ? -1 : c.hp)),
      mv: w.movers.filter((m) => m.path.type === 'fall').map((m) => [m.index, m.fallT, m.fallV, m.x, m.y]),
      wl: w.wells.map(wellState),
      pu: w.pulsers.map(pulserState),
      am: g.ambushes.map((a) => [a.state, a.wave]),
      cp: [g.checkpoint, g.checkpoints.map((c) => (c.on ? 1 : 0)).join('')],
      se: g.secrets.map((s) => (s.found ? 1 : 0)).join(''),
      bs: g.boss ? { id: g.boss.id, ...fields(g.boss, BOSS_SKIP) } : null,
      hz: g.hazards.map((h) => plain(h)),
      ex: g.exit,
      st: plain(g.stats),
      vs: g.mode === 'versus' ? [g.winner, r2(g.nextPower)] : null,
      lg: this.log.map(([id, , e]) => [id, ...e]),
    };
  }
}

// ------------------------------------------------------------------ guest

/** Motion a guest makes for itself, and so does not take from the host for its own robot. */
const OWN_MOTION = new Set(['jump', 'land', 'spring', 'warp', 'pulse']);

/**
 * The guest's side: its copy of the game (`game`, built from the same
 * blueprint), kept to the host's snapshots, with its own robot predicted.
 */
export class Mirror {
  constructor(game, slot, match = 0) {
    this.game = game;
    this.slot = slot;
    this.match = match;
    game.local = slot;
    this.snaps = [];
    this.offset = null; // host time less local time, as near as we can tell
    this.pending = []; // our predicted steps the host has not finished: { seq, it }
    this.seen = 0; // the newest log entry acted on
    this.early = new Set(); // our own sounds, played as soon as they came in rather than when shown
    this.t = null; // the world time our prediction has reached
    this.err = { x: 0, y: 0 }; // what is left of a correction, still being faded out on screen
    this.enemies = new Map(game.enemies.map((e) => [e.id, e]));
    this.shown = null; // the snapshot on screen now
    this.hooks = this.makeHooks();
    this.corrections = [];
    this.first = true;
  }

  get me() {
    return this.game.players[this.slot];
  }

  makeHooks() {
    const g = this.game;
    const slot = this.slot;
    const bot = () => this.me.bot;
    return {
      jump: () => g.emit('jump', { slot }),
      land: (air) => {
        if (air > 0.25) {
          g.fx.dust(bot().x, bot().bottom, '#cfefff', 6 + Math.min(8, air * 10));
          g.emit('land', { air, slot });
        }
      },
      spring: () => {
        g.emit('spring', { slot });
        g.fx.ring(bot().x, bot().bottom, '#9dff5c', 50, 0.3);
      },
      pulse: () => g.emit('pulse', { slot }),
      warp: (from, to) => {
        g.fx.ring(from.x, from.y, '#ffffff', 70, 0.35);
        g.fx.ring(to.x, to.y, '#ffffff', 90, 0.45);
        g.emit('warp', { slot });
      },
    };
  }

  /** The level's moving parts as they are at world time t (the platforms' step into t, so they carry what stands on them). */
  worldAt(t, dt) {
    const w = this.game.world;
    w.t = t;
    for (const m of w.movers) {
      if (m.path.type === 'fall') m.update(dt, t);
      else {
        m.place(t - dt);
        m.update(dt, t);
      }
    }
    tickWells(w.wells, t);
    for (const l of w.lasers) {
      const u = (((t + (l.offset || 0)) % l.period) + l.period) % l.period;
      l.warn = u >= l.period - l.lit - 0.6 && u < l.period - l.lit;
      l.on = u >= l.period - l.lit;
    }
    for (const s of w.springs) s.squash = Math.max(0, s.squash - dt * 4);
  }

  /** One step of our own robot, as the host's Game.stepPlayer moves it. */
  stepOwn(it, dt, replay) {
    const g = this.game;
    const pl = this.me;
    const bot = pl.bot;
    if (pl.out || g.ended()) return;
    const held = (g.phase === 'intro' && g.phaseT < 0.6) || g.phase === 'ready' || pl.frozen > 0;
    if (it.aim != null && Number.isFinite(it.aim)) bot.aim = it.aim;
    bot.invuln = Math.max(0, (bot.invuln || 0) - dt);
    stepRobot(bot, held ? { mx: 0 } : it, g.world, dt, replay ? {} : this.hooks);
  }

  /** A frame's record, predicted: each of its steps played now, and kept until the host has played it too. */
  predict(rec, dt = PHYSICS_DT) {
    for (let i = 0; i < rec[1]; i++) {
      const it = recordStep(rec, i);
      this.pending.push({ seq: rec[0], it });
      if (this.t == null) continue; // nothing to go on until the first snapshot: it replays these then
      this.t += dt;
      this.worldAt(this.t, dt);
      this.stepOwn(it, dt, false);
      this.game.fx.update(dt);
    }
  }

  /** A snapshot has come in, at local time `now` (seconds). */
  receive(s, now) {
    if ((s.m ?? 0) !== this.match) return false; // from another match: the one before, or the next, come early
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.n <= last.n) return false; // late, or a copy that came both ways
    s.at = now;
    s.enMap = new Map(s.en.map((e) => [e.id, e]));
    this.snaps.push(s);
    while (this.snaps.length > 12) this.snaps.shift();
    const off = s.tm - now;
    if (this.offset == null || off > this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.02;
    this.applyNewest(s);
    this.reconcile(s);
    return true;
  }

  /** What our robot stands on and goes through, and our own player's shields and ammo: from the newest snapshot. */
  applyNewest(s) {
    const g = this.game;
    const w = g.world;
    g.time = s.tm;
    g.phase = s.ph;
    g.phaseT = s.pt;
    if (s.vs) {
      g.winner = s.vs[0];
      g.nextPower = s.vs[1];
    }
    restore(g.stats, s.st);
    for (const a of s.pl) {
      const pl = g.players.find((p) => p.slot === a[0]);
      if (pl) applyRobot(pl, a, w, false);
    }
    [...s.gt].forEach((c, i) => w.gates[i] && setGate(w.gates[i], c === '1'));
    s.cr.forEach((hp, i) => {
      const c = w.crates[i];
      if (!c) return;
      c.broken = hp < 0;
      if (hp >= 0) c.hp = hp;
    });
    for (const [i, fallT, fallV, x, y] of s.mv) {
      const m = w.movers[i];
      if (!m) continue;
      m.fallT = fallT;
      m.fallV = fallV;
      m.x = x;
      m.y = y;
      m.buildSegs();
    }
    // Wells: the level's own, plus any a boss has made.
    w.wells = s.wl.map((a, i) => {
      const old = w.wells[i];
      const well = old || makeWell({ x: a[0], y: a[1] });
      well.x = a[0];
      well.y = a[1];
      well.r = a[2];
      well.range = a[3];
      well.pull = a[4];
      well.solid = !!(a[5] & 1);
      well.fount = !!(a[5] & 2);
      well.hazard = !!(a[5] & 4);
      well.absent = !!(a[5] & 8);
      well.charted = !!(a[5] & 16);
      well.drag = a[6];
      return well;
    });
    w.pulsers = s.pu.map((a, i) => {
      if (a[0] === 'r') {
        const old = w.pulsers[i];
        const ring = old && old.oneShot && old.nextAt === a[7] ? old : new OneRing(a[1], a[2], { speed: a[4], maxRadius: a[5], color: a[6] }, a[7]);
        ring.radius = a[3];
        return ring;
      }
      const p = w.pulsers[i];
      if (p && !p.oneShot) {
        p.t = a[1];
        p.nextAt = a[2];
        p.active = !!a[3];
        p.x = a[4];
        p.y = a[5];
        p.radius = a[6];
      }
      return p;
    }).filter(Boolean);
    for (const [k, pair] of Object.entries(s.po)) {
      const old = w.portals[k] || [null, null];
      w.portals[k] = [applyPortal(w, k === 'boss' ? 'boss' : Number(k), 0, pair[0], old[0]), applyPortal(w, k === 'boss' ? 'boss' : Number(k), 1, pair[1], old[1])];
    }
    for (const k of Object.keys(w.portals)) if (!(k in s.po)) delete w.portals[k];
    // A frozen enemy is a block of ice to stand on.
    w.ice = s.en.filter((e) => e.ic && e.frozen > 0).map((e) => iceBlock({ id: e.id }, e.ic[0], e.ic[1], e.ic[2]));
    for (const e of s.en) {
      const mine = this.enemies.get(e.id);
      if (mine) mine.ice = e.ic && e.frozen > 0 ? w.ice.find((b) => b.enemy.id === e.id) : null;
    }
    // Our own sounds and flashes straight away (the rest wait for their moment on screen).
    for (const entry of s.lg) {
      if (entry[1] !== 'e' || entry[0] <= this.seen || this.early.has(entry[0])) continue;
      const e = entry[2];
      if (e.slot === this.slot && !OWN_MOTION.has(e.s)) {
        g.events.push(e);
        this.early.add(entry[0]);
        if (e.s === 'hurt') g.fx.blink('#ff5c7a', 0.45);
      }
    }
  }

  /** Our robot to where the host had it, and our steps since played again on top. */
  reconcile(s) {
    const pl = this.me;
    const bot = pl.bot;
    const a = s.pl.find((p) => p[0] === this.slot);
    if (!a) return;
    const shownX = bot.x + this.err.x;
    const shownY = bot.y + this.err.y;
    const { keep, replay } = splitAck(this.pending, (s.ak && s.ak[this.slot]) || [0, 0]);
    this.pending = keep;
    applyRobot(pl, a, this.game.world, true);
    let t = s.wt;
    for (const step of replay) {
      t += PHYSICS_DT;
      this.worldAt(t, PHYSICS_DT);
      this.stepOwn(step.it, PHYSICS_DT, true);
    }
    if (this.t == null) this.worldAt(t, PHYSICS_DT);
    this.t = t;
    bot.prevX = bot.x;
    bot.prevY = bot.y;
    // Whatever the correction moved, fade it out on screen rather than jump; a big one (a respawn) is a jump.
    const dx = shownX - bot.x;
    const dy = shownY - bot.y;
    const was = this.first ? 0 : Math.hypot(dx - this.err.x, dy - this.err.y);
    this.corrections.push(was); // how far the host's word moved our robot (for the curious, and the tests)
    if (this.corrections.length > 600) this.corrections.shift();
    this.first = false;
    if (Math.hypot(dx, dy) > NET.snapOver) this.err = { x: 0, y: 0 };
    else this.err = { x: dx, y: dy };
  }

  /** Our own robot's on-screen offset while a correction fades (dt seconds since the last frame). */
  fade(dt) {
    const k = Math.exp(-dt / NET.smooth);
    this.err.x *= k;
    this.err.y *= k;
    if (Math.abs(this.err.x) < 0.05) this.err.x = 0;
    if (Math.abs(this.err.y) < 0.05) this.err.y = 0;
    const b = this.me.bot;
    b.drawDX = this.err.x;
    b.drawDY = this.err.y;
  }

  /**
   * Everything but our robot as it was NET.interp ago: the snapshots either
   * side of then, positions between them, and their sounds and particles
   * played as they come on screen. `now` is local seconds.
   */
  show(now) {
    if (!this.snaps.length || this.offset == null) return;
    const rt = now + this.offset - NET.interp;
    let a = this.snaps[0];
    let b = this.snaps[0];
    for (let i = this.snaps.length - 1; i > 0; i--) {
      if (this.snaps[i - 1].tm <= rt) {
        a = this.snaps[i - 1];
        b = this.snaps[i];
        break;
      }
    }
    if (rt >= this.snaps[this.snaps.length - 1].tm) a = b = this.snaps[this.snaps.length - 1];
    const k = b === a || b.tm === a.tm ? 1 : Math.max(0, Math.min(1, (rt - a.tm) / (b.tm - a.tm)));
    if (this.shown !== b) {
      // Every snapshot passed since last frame gives up its sounds and particles now.
      for (const snap of this.snaps) if (snap.n <= b.n && (!this.shown || snap.n > this.shown.n)) this.play(snap);
      this.showState(b);
      this.shown = b;
    }
    this.place(a, b, k);
  }

  /** A snapshot's sounds and particles, those not yet seen. */
  play(s) {
    const g = this.game;
    for (const entry of s.lg) {
      const [id, kind] = entry;
      if (id <= this.seen) continue;
      this.seen = id;
      if (this.early.delete(id)) continue;
      if (kind === 'e') {
        const e = entry[2];
        if (e.slot === this.slot) {
          if (OWN_MOTION.has(e.s)) continue;
        }
        g.events.push(e);
      } else if (kind === 'f') {
        const [, , who, name, args] = entry;
        if (who === this.slot) continue;
        if (typeof g.fx[name] === 'function') g.fx[name](...args);
      }
    }
  }

  /** The things on screen (not our robot, not what it stands on) as a snapshot has them. */
  showState(s) {
    const g = this.game;
    const w = g.world;
    for (const a of s.pl) {
      if (a[0] === this.slot) continue;
      const pl = g.players.find((p) => p.slot === a[0]);
      if (pl) applyRobot(pl, a, w, true);
    }
    // Enemies: those that moved, as they are; those gone, gone; the rest (asleep) where they were.
    for (const id of s.eg) this.enemies.delete(id);
    for (const e of s.en) {
      let mine = this.enemies.get(e.id);
      if (!mine) {
        mine = new Enemy({ kind: e.kind, x: e.x, y: e.y }, e.id);
        this.enemies.set(e.id, mine);
      }
      const ice = mine.ice;
      restore(mine, e);
      mine.ice = e.ic && e.frozen > 0 ? ice || w.ice.find((b) => b.enemy.id === e.id) || null : null;
      delete mine.ic;
    }
    g.enemies = [...this.enemies.values()].filter((e) => !e.dead);
    const byId = (list) => new Map(list.map((c) => [c.id, c]));
    const charges = byId(g.charges);
    g.charges = s.ch.map((a) => {
      const c = charges.get(a[0]) || new Charge({ x: a[2], y: a[3], vx: a[4], vy: a[5] });
      c.id = a[0];
      c.owner = a[1];
      c.vx = a[4];
      c.vy = a[5];
      c.r = a[6];
      c.kind = KINDS[a[7]] || 'std';
      c.color = a[8];
      c.freeze = !!(a[9] & 1);
      c.warped = !!(a[9] & 2);
      c.warps = a[10];
      return c;
    });
    const shots = byId(g.shots);
    g.shots = s.sh.map((a) => {
      const c = shots.get(a[0]) || new Charge({ x: a[1], y: a[2], vx: a[3], vy: a[4], hostile: true });
      c.id = a[0];
      c.vx = a[3];
      c.vy = a[4];
      c.r = a[5];
      c.color = a[6];
      c.look = a[7];
      return c;
    });
    const pickups = byId(g.pickups);
    g.pickups = s.pk.map((a) => {
      const p = pickups.get(a[0]) || { id: a[0], vx: 0, vy: 0, taken: false, age: 1 };
      p.kind = a[1];
      p.x = a[2];
      p.y = a[3];
      p.owner = a[4];
      p.resting = !!a[5];
      p.t = a[6];
      return p;
    });
    s.sw.forEach((a, i) => {
      const sw = w.switches[i];
      if (!sw) return;
      sw.on = !!a[0];
      sw.t = a[1];
      sw.flash = a[2];
    });
    s.am.forEach(([state, wave], i) => {
      const am = g.ambushes[i];
      if (am) {
        am.state = state;
        am.wave = wave;
      }
    });
    g.checkpoint = s.cp[0];
    [...s.cp[1]].forEach((c, i) => g.checkpoints[i] && (g.checkpoints[i].on = c === '1'));
    [...s.se].forEach((c, i) => g.secrets[i] && (g.secrets[i].found = c === '1'));
    g.exit = s.ex;
    g.hazards = s.hz;
    if (s.bs) {
      if (!g.boss || g.boss.id !== s.bs.id) g.boss = new Boss(s.bs.id, g.arena);
      restore(g.boss, s.bs);
      g.boss.parts = g.boss.def.parts(g.boss);
    } else g.boss = null;
  }

  /** Positions between two snapshots, k of the way from a to b. */
  place(a, b, k) {
    const g = this.game;
    for (const pl of g.players) {
      if (pl.slot === this.slot) continue;
      const pa = a.pl.find((p) => p[0] === pl.slot);
      const pb = b.pl.find((p) => p[0] === pl.slot);
      if (!pa || !pb) continue;
      const jump = Math.hypot(pb[1] - pa[1], pb[2] - pa[2]) > NET.snapOver;
      pl.bot.x = jump ? pb[1] : lerp(pa[1], pb[1], k);
      pl.bot.y = jump ? pb[2] : lerp(pa[2], pb[2], k);
      pl.bot.prevX = pl.bot.x;
      pl.bot.prevY = pl.bot.y;
    }
    for (const e of g.enemies) {
      const ea = a.enMap.get(e.id);
      const eb = b.enMap.get(e.id);
      if (ea && eb) {
        e.x = lerp(ea.x, eb.x, k);
        e.y = lerp(ea.y, eb.y, k);
      }
      e.prevX = e.x;
      e.prevY = e.y;
    }
    const between = (list, sa, sb, ix, iy) => {
      const ma = new Map(sa.map((c) => [c[0], c]));
      const mb = new Map(sb.map((c) => [c[0], c]));
      for (const c of list) {
        const ca = ma.get(c.id);
        const cb = mb.get(c.id);
        if (ca && cb && Math.hypot(cb[ix] - ca[ix], cb[iy] - ca[iy]) < NET.snapOver) {
          c.x = lerp(ca[ix], cb[ix], k);
          c.y = lerp(ca[iy], cb[iy], k);
        } else if (cb) {
          c.x = cb[ix];
          c.y = cb[iy];
        }
        c.prevX = c.x;
        c.prevY = c.y;
      }
    };
    between(g.charges, a.ch, b.ch, 2, 3);
    between(g.shots, a.sh, b.sh, 1, 2);
    if (g.boss && a.bs && b.bs && a.bs.id === b.bs.id) {
      g.boss.x = lerp(a.bs.x, b.bs.x, k);
      g.boss.y = lerp(a.bs.y, b.bs.y, k);
      g.boss.prevX = g.boss.x;
      g.boss.prevY = g.boss.y;
      g.boss.parts = g.boss.def.parts(g.boss);
    }
  }
}
