// Vector's multiplayer, the part with no page in it: what goes over the wire
// and what each end does with it. The connection itself is Deflector's relay
// client (src/net.js); Vector's messages all start with 'vx', so a Vector room
// never reads a Deflector or a Defector one.
//
// It works the way Defector's does. The host runs the one real game; a guest
// sends its inputs, the host plays them, and the host sends everyone
// snapshots. So that a guest never waits a round trip to see its own robot
// move or turn:
//
//  - Each guest frame is one input record, [seq, steps, mx, mz, bits, yaw,
//    pitch, turns], for exactly the physics steps it covered; every message
//    repeats the last six, so a lost one costs nothing. The host keeps them
//    in a queue like a jitter buffer (Deflector's input queue, in Vector's
//    shape) and plays each for exactly those steps. When the queue runs dry
//    the robot waits where it is rather than being guessed at.
//  - The look travels with the inputs, and the guest's own look is always its
//    own: the host lays a record's look on the robot only while the robot
//    has turned (a wormhole, a respawn: Robot.turns) as often as the guest
//    had seen when it made the record, so a look made before a wormhole
//    turned the robot is never laid over the turned one.
//  - The guest predicts its own robot: it steps it itself with the same
//    physics, against its own copy of the level on the same clock. Each
//    snapshot says how far through the guest's records the host has got (the
//    ack) and where the robot was then; the guest puts its robot there and
//    plays again what the host has not played yet. What is left of the
//    difference is faded out on screen over a moment, not jumped.
//  - Everything else (the other robots, enemies, charges, the boss) the guest
//    shows as it was NET.interp ago, between the two snapshots either side
//    of then. What the guest's own robot stands on or goes through (doors,
//    broken crates, ice, everyone's wormhole ends) it takes from the newest.
//  - What happened (sounds, flashes, lines spoken) is sent too, each in
//    several snapshots in a row, and played by the guest once, as the moment
//    it belongs to is shown; its own robot's are played as soon as they come.
//  - Every match in a room has its own number, carried by every input and
//    snapshot, and each end drops any that are for another match.
import { PHYSICS_DT, POWERUPS, PICKS, BLASTER, PLAYERS } from './config.js';
import { MIN_BUFFER, MAX_BUFFER, BUFFER_GROWTH, CALM_STEPS, CATCH_UP_OVER, TRIM_OVER, REDUNDANCY, splitAck } from '../../src/inputqueue.js';
import { stepRobot } from './player.js';
import { makeEnd, refreshEnd } from './wormholes.js';
import { Enemy } from './enemies.js';
import { makeBoss } from './bosses.js';

export const NET = {
  version: 1, // bumped when a message changes shape: a room refuses a guest from another version
  snapHz: 30, // snapshots a second
  sendHz: 60, // input messages a second, whatever the display runs at
  interp: 0.1, // seconds behind the newest snapshot that a guest shows everything but its own robot
  logKeep: 0.3, // seconds an event is repeated in snapshots, in case one is lost
  smooth: 0.1, // seconds a correction to a guest's own robot takes to fade on screen
  snapOver: 4, // m: a correction bigger than this (a respawn, a wormhole) is a jump, not faded
};

/** Vector's own message types. */
export const MSG = {
  hello: 'vxHello', // guest → host: { v, name }
  room: 'vxRoom', // host → all: the room as it stands { v, players, pick, playing }
  no: 'vxNo', // host → guest: refused { to, why }
  start: 'vxStart', // host → all: a match starts { match, mode, level | map, roster, shields, checkpoint }
  input: 'vxIn', // guest → host: { m, r: records }
  snap: 'vxS', // host → all: a snapshot
  end: 'vxEnd', // host → all: the level or match is over { result }
  back: 'vxBack', // host → all: back to the room
};

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const far = (a, b, d) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > d;
/** The shorter way round from one angle to another. */
const lerpAngle = (a, b, k) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};
const KINDS = ['std', ...POWERUPS.map((p) => p.id)];

// ---------------------------------------------------------------- intents

const RUN = 1;
const JUMP = 2;
const JUMP_PRESS = 4;
const FIRE = 8;
const FIRE_PRESS = 16;
const WORM0 = 32;
const WORM1 = 64;
const CYCLE = 128;
const CYCLE_BACK = 256;
const PICK_SHIFT = 9; // three bits from here: 0 for no pick, else 1 + its place in PICKS
const PICK_MASK = 7 << PICK_SHIFT;
/** The bits that are presses: they belong to the first step of a record only. */
export const PRESSES = JUMP_PRESS | FIRE_PRESS | WORM0 | WORM1 | CYCLE | CYCLE_BACK | PICK_MASK;

/** An intent as [mx, mz, bits, yaw, pitch, turns]. */
export function packIntent(it) {
  let b = 0;
  if (it.run) b |= RUN;
  if (it.jump) b |= JUMP;
  if (it.jumpPress) b |= JUMP_PRESS;
  if (it.fire) b |= FIRE;
  if (it.firePress) b |= FIRE_PRESS;
  if (it.worm && it.worm[0]) b |= WORM0;
  if (it.worm && it.worm[1]) b |= WORM1;
  if (it.cycle > 0) b |= CYCLE;
  if (it.cycle < 0) b |= CYCLE_BACK;
  if (it.pick != null && it.pick >= 0 && it.pick < PICKS.length) b |= (it.pick + 1) << PICK_SHIFT;
  const yaw = Number.isFinite(it.yaw) ? r4(it.yaw) : null;
  return [r3(+it.mx || 0), r3(+it.mz || 0), b, yaw, yaw == null ? 0 : r4(it.pitch || 0), it.turns ?? null];
}

export function unpackIntent(mx, mz, b, yaw, pitch, turns) {
  const pick = (b & PICK_MASK) >> PICK_SHIFT;
  return {
    mx,
    mz,
    run: !!(b & RUN),
    jump: !!(b & JUMP),
    jumpPress: !!(b & JUMP_PRESS),
    fire: !!(b & FIRE),
    firePress: !!(b & FIRE_PRESS),
    worm: [!!(b & WORM0), !!(b & WORM1)],
    cycle: b & CYCLE ? 1 : b & CYCLE_BACK ? -1 : 0,
    pick: pick ? pick - 1 : null,
    yaw,
    pitch,
    turns,
  };
}

/** Step `i` of a record: the presses only on the first. */
export function recordStep(rec, i) {
  return unpackIntent(rec[2], rec[3], i === 0 ? rec[4] : rec[4] & ~PRESSES, rec[5], rec[6], rec[7]);
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
    const [mx, mz, bits, yaw, pitch, turns] = packIntent(it);
    const b = bits | this.carry;
    if (!steps) {
      this.carry = b & PRESSES;
      return null;
    }
    this.carry = 0;
    const rec = [++this.seq, steps, mx, mz, b, yaw, pitch, turns];
    this.recent.push(rec);
    if (this.recent.length > REDUNDANCY) this.recent.shift();
    return rec;
  }

  message() {
    return { t: MSG.input, m: this.match, r: this.recent.slice() };
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
        if (h.used === 0) this.latch |= h.rec[4] & PRESSES;
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
      const extra = unpackIntent(0, 0, this.latch, null, 0, null);
      it.jumpPress ||= extra.jumpPress;
      it.firePress ||= extra.firePress;
      it.cycle ||= extra.cycle;
      if (it.pick == null) it.pick = extra.pick;
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
 * Plain data from an object: numbers (rounded to 0.001), booleans, strings
 * and nulls, and arrays and plain objects of them, a few levels deep.
 * Anything else (a class instance, a function, a Set) is left out.
 */
export function plain(v, depth = 0) {
  if (v == null) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v > 0 ? 1e12 : v < 0 ? -1e12 : 0;
  if (t === 'boolean' || t === 'string') return v;
  if (t !== 'object' || depth > 3) return undefined;
  if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1) ?? null);
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

const ENEMY_SKIP = new Set(['spec', 'home', 'to', 'mouth', 'ice', 'orbit', 'drops', 'cool', 'seenT', 'dir', 'speed', 'gravity', 'sight', 'shootEvery', 'stompable', 'maxHp', 'aim']);
const BOSS_SKIP = new Set(['A', 'game', 'c']);

/** What a solid is called in a snapshot: its build number, or an ice block by its enemy (negative), or null. */
function solidRef(s) {
  if (!s) return null;
  if (s.nid != null) return s.nid;
  if (s.ice) return -s.ice.id;
  return null;
}

function endState(e) {
  if (!e) return null;
  return [e.c, e.n, e.u, e.v, solidRef(e.host), e.hostOff, e.near ? 1 : 0];
}

const P = 1; // where a robot's state starts after its slot, in the list robotState makes

/** A robot's whole state, enough for a guest to carry on its physics from exactly there. */
function robotState(pl) {
  const b = pl.bot;
  const flags = (b.onGround ? 1 : 0) | (b.jumped ? 2 : 0) | (b.flung ? 4 : 0) | (pl.out ? 8 : 0) | (pl.wantFire ? 16 : 0);
  return [
    pl.slot,
    b.pos,
    b.vel,
    r4(b.yaw),
    r4(b.pitch),
    flags,
    solidRef(b.ground),
    b.groundN,
    b.coyote,
    b.buffer,
    b.air,
    r3(b.invuln),
    r3(b.frozen),
    b.stride,
    b.turns,
    b.mouth ? [b.mouth.owner ?? 0, b.mouth.which ?? 0] : null,
    pl.shields === Infinity ? -1 : pl.shields,
    pl.maxShields === Infinity ? -1 : pl.maxShields,
    KINDS.indexOf(pl.loaded),
    KINDS.slice(1).map((k) => pl.ammo[k] || 0),
    r3(pl.cooldown),
    [pl.stats.shots, pl.stats.kills, pl.stats.lost, pl.stats.hits, pl.stats.falls, pl.stats.powerups],
  ];
}

/**
 * The host's side: the queue of each guest's inputs, what happened since the
 * last snapshot, and the snapshots themselves.
 */
export class HostLink {
  constructor(game, match = 0) {
    this.game = game;
    this.match = match;
    this.n = 0;
    this.queues = new Map(); // slot → HostQueue
    this.log = []; // [id, time, event]
    this.logId = 0;
    this.gone = []; // [enemy id, time it went]
    this.known = new Set(game.enemies.map((e) => e.id));
    this.doors = game.world.solids.filter((s) => s.door);
    this.breakable = game.world.solids.filter((s) => s.crate || s.cover);
  }

  queue(slot) {
    if (!this.queues.has(slot)) this.queues.set(slot, new HostQueue());
    return this.queues.get(slot);
  }

  /** A guest's message: its records into its queue. */
  input(slot, msg) {
    if ((msg.m ?? 0) !== this.match) return; // the last of another match's inputs
    this.queue(slot).push(msg.r);
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

  /** The game's events this frame (before the page clears them), for the guests to hear and see too. */
  events(list) {
    for (const e of list) this.log.push([++this.logId, this.game.time, plain(e)]);
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
    return {
      t: MSG.snap,
      m: this.match,
      n: ++this.n,
      tm: g.time,
      wt: w.time,
      st: g.state,
      ph: g.phase,
      pt: r3(g.phaseT),
      bi: r3(g.bossIntro),
      cp: g.checkpoint,
      wn: g.winner,
      pl: g.players.map(robotState),
      ak: acks,
      en: g.players.map((pl) => pl.ends.map(endState)),
      ch: g.charges.map((c) => [c.id, c.owner, c.pos.map(r3), c.vel.map(r2), c.r, KINDS.indexOf(c.kind), c.color || null, r2(c.age), c.portaled ? 1 : 0]),
      sh: g.shots.map((c) => [c.id, c.pos.map(r3), c.vel.map(r2), c.r, c.color || null, c.lobbed ? 1 : 0]),
      fo: g.enemies.filter((e) => e.awake || e.frozen > 0 || e.flash > 0).map((e) => ({ ...fields(e, ENEMY_SKIP), ic: e.ice ? [e.ice.min, e.ice.max] : null })),
      eg: this.gone.map(([id]) => id),
      pk: g.pickups.filter((p) => !p.taken).map((p) => [p.id, p.kind === 'shield' ? 's' : 'p', p.power || null, p.pos.map(r3), p.owner ?? null, p.secret ? 1 : 0]),
      dr: this.doors.map((s) => [s.door.open ? 1 : 0, r3(s.door.at)]),
      sw: w.switches.map((s) => [s.on ? 1 : 0, r2(s.left || 0)]),
      gs: this.breakable.filter((s) => s.gone).map((s) => s.nid),
      am: g.ambushes.map((a) => [a.state, a.wave]),
      bs: g.boss ? { k: g.boss.id, ...fields(g.boss, BOSS_SKIP) } : null,
      sa: g.say ? [g.say.who, g.say.text, g.say.name || null, r2(g.say.t)] : null,
      ss: plain(g.stats),
      lg: this.log.map(([id, , e]) => [id, e]),
    };
  }
}

// ------------------------------------------------------------------ guest

/** What a guest makes for its own robot as it predicts it, and so does not take from the host. */
const OWN_MOTION = new Set(['jump', 'land', 'step', 'spring', 'warp', 'fire']);

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
    this.early = new Set(); // our own events, played as soon as they came in rather than when shown
    this.t = null; // the world time our prediction has reached
    this.err = [0, 0, 0]; // what is left of a correction, still being faded out on screen
    this.enemies = new Map(game.enemies.map((e) => [e.id, e]));
    this.ice = new Map(); // enemy id → the ice block our robot can stand on
    this.doors = game.world.solids.filter((s) => s.door);
    this.breakable = game.world.solids.filter((s) => s.crate || s.cover);
    this.shown = null; // the snapshot on screen now
    this.corrections = [];
    this.first = true;
  }

  get me() {
    return this.game.players[this.slot];
  }

  /** A solid by its snapshot name. */
  solid(ref) {
    if (ref == null) return null;
    if (ref < 0) return this.ice.get(-ref) || null;
    return this.game.world.solids[ref] || null;
  }

  /** Our copy of the level's clockwork at world time t: two steps into it, so what moves has its speed. */
  worldAt(t) {
    const w = this.game.world;
    w.time = t - 2 * PHYSICS_DT;
    w.step(PHYSICS_DT);
    w.step(PHYSICS_DT);
    this.refreshEnds();
  }

  refreshEnds() {
    for (const pl of this.game.players) for (const e of pl.ends) if (e) refreshEnd(e);
  }

  /** One step of our own robot, as the host's Game.stepPlayer moves it. */
  stepOwn(it, dt, replay) {
    const g = this.game;
    const pl = this.me;
    const bot = pl.bot;
    if (pl.out || g.state !== 'play') return;
    if (it.yaw != null && (it.turns == null || it.turns === bot.turns)) {
      bot.yaw = it.yaw;
      bot.pitch = it.pitch;
    }
    const held = g.held();
    const ev = stepRobot(bot, held ? {} : it, g.world, dt, g.openEnds);
    pl.cooldown = Math.max(0, pl.cooldown - dt);
    pl.flash = Math.max(0, pl.flash - dt);
    if (replay) return;
    for (const e of ev) {
      if (e.s === 'warp') g.warps++;
      if (e.s === 'jump' || e.s === 'land' || e.s === 'step' || e.s === 'spring' || e.s === 'warp') g.emit({ s: e.s, slot: this.slot, air: e.air, surface: e.surface, role: e.role, at: bot.eyePos() });
    }
    // A shot is the host's to make, but its sound and the blaster's kick are ours at once.
    if (!held && bot.frozen <= 0 && (it.firePress || it.fire) && pl.cooldown <= 0 && g.mine(pl) < BLASTER.maxAlive) {
      pl.cooldown = BLASTER.cooldown;
      pl.flash = 0.06;
      g.emit({ s: 'fire', kind: pl.loaded, slot: this.slot, at: bot.eyePos() });
    }
  }

  /** A frame's record, predicted: each of its steps played now, and kept until the host has played it too. */
  predict(rec, dt = PHYSICS_DT) {
    for (let i = 0; i < rec[1]; i++) {
      const it = recordStep(rec, i);
      this.pending.push({ seq: rec[0], it });
      if (this.t == null) continue; // nothing to go on until the first snapshot: it replays these then
      this.t += dt;
      this.game.world.step(dt);
      this.refreshEnds();
      this.stepOwn(it, dt, false);
    }
  }

  /** A snapshot has come in, at local time `now` (seconds). */
  receive(s, now) {
    if ((s.m ?? 0) !== this.match) return false; // from another match: the one before, or the next, come early
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.n <= last.n) return false; // late, or a copy that came both ways
    s.at = now;
    s.foMap = new Map(s.fo.map((e) => [e.id, e]));
    this.snaps.push(s);
    while (this.snaps.length > 12) this.snaps.shift();
    const off = s.tm - now;
    if (this.offset == null || off > this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.02;
    this.applyNewest(s);
    this.reconcile(s);
    return true;
  }

  /** What our robot stands on and goes through, and every player's shields and power-ups: from the newest snapshot. */
  applyNewest(s) {
    const g = this.game;
    const w = g.world;
    g.time = s.tm;
    g.state = s.st;
    g.phase = s.ph;
    g.phaseT = s.pt;
    g.bossIntro = s.bi;
    g.winner = s.wn;
    restore(g.stats, s.ss);
    for (const a of s.pl) {
      const pl = g.players[a[0]];
      if (pl) this.applyPlayer(pl, a);
    }
    s.dr.forEach(([open, at], i) => {
      const d = this.doors[i];
      if (!d) return;
      d.door.open = !!open;
      d.door.at = at;
    });
    s.sw.forEach(([on, left], i) => {
      const sw = w.switches[i];
      if (!sw) return;
      sw.on = !!on;
      sw.left = left;
    });
    for (const nid of s.gs) {
      const b = w.solids[nid];
      if (b && !b.gone) w.remove(b);
    }
    // A frozen enemy is a block of ice to stand on.
    const iced = new Set();
    for (const e of s.fo) {
      if (!e.ic || !(e.frozen > 0)) continue;
      iced.add(e.id);
      let block = this.ice.get(e.id);
      if (!block) {
        block = w.box(e.ic[0], e.ic[1], { dynamic: true, mat: 'glass', color: '#bfefff', invisible: true, enemy: true, noSafe: true });
        block.ice = { id: e.id };
        this.ice.set(e.id, block);
      }
    }
    for (const [id, block] of this.ice) {
      if (iced.has(id)) continue;
      w.remove(block);
      this.ice.delete(id);
    }
    // Everyone's wormhole ends: anything goes through anyone's.
    s.en.forEach((pair, slot) => {
      const pl = g.players[slot];
      if (!pl) return;
      pair.forEach((a, which) => {
        const old = pl.ends[which];
        if (!a) {
          pl.ends[which] = null;
          return;
        }
        const host = this.solid(a[4]);
        const same = old && old.host === host && old.n[0] === a[1][0] && old.n[1] === a[1][1] && old.n[2] === a[1][2] && old.hostOff[0] === a[5][0] && old.hostOff[1] === a[5][1] && old.hostOff[2] === a[5][2] && old.c[0] === a[0][0] && old.c[1] === a[0][1] && old.c[2] === a[0][2];
        if (same) return;
        const e = makeEnd([...a[0]], a[1], a[2], a[3], host);
        e.hostOff = [...a[5]];
        e.near = !!a[6];
        e.which = which;
        e.owner = slot;
        e.color = PLAYERS[slot].ends[which];
        pl.ends[which] = e;
      });
      const [a, b] = pl.ends;
      if (a) a.twin = b || null;
      if (b) b.twin = a || null;
    });
    if (s.sa) g.say = { who: s.sa[0], text: s.sa[1], name: s.sa[2], t: s.sa[3] };
    // Our own events straight away (the rest wait for their moment on screen).
    for (const [id, e] of s.lg) {
      if (id <= this.seen || this.early.has(id)) continue;
      if (e.slot === this.slot && !OWN_MOTION.has(e.s)) {
        g.events.push(e);
        this.early.add(id);
      }
    }
  }

  /** A player's shields, power-ups and blaster from a snapshot; its body too, when `body` is set. */
  applyPlayer(pl, a, body = false) {
    pl.out = !!(a[5] & 8);
    pl.shields = a[16] === -1 ? Infinity : a[16];
    pl.maxShields = a[17] === -1 ? Infinity : a[17];
    pl.loaded = KINDS[a[18]] || 'std';
    KINDS.slice(1).forEach((k, i) => (pl.ammo[k] = a[19][i] || 0));
    [pl.stats.shots, pl.stats.kills, pl.stats.lost, pl.stats.hits, pl.stats.falls, pl.stats.powerups] = a[21];
    pl.bot.invuln = a[11];
    if (!body) return;
    const b = pl.bot;
    b.pos = [...a[1]];
    b.vel = [...a[2]];
    b.onGround = !!(a[5] & 1);
    b.jumped = !!(a[5] & 2);
    b.flung = !!(a[5] & 4);
    pl.wantFire = !!(a[5] & 16);
    b.ground = this.solid(a[6]);
    b.groundN = a[7];
    b.coyote = a[8];
    b.buffer = a[9];
    b.air = a[10];
    b.frozen = a[12];
    b.stride = a[13];
    b.turns = a[14];
    b.mouth = a[15] ? (this.game.players[a[15][0]] || { ends: [] }).ends[a[15][1]] || null : null;
    pl.cooldown = a[20];
  }

  /** Our robot to where the host had it, and our steps since played again on top. */
  reconcile(s) {
    const pl = this.me;
    const bot = pl.bot;
    const a = s.pl.find((p) => p[0] === this.slot);
    if (!a) return;
    const shown = [bot.pos[0] + this.err[0], bot.pos[1] + this.err[1], bot.pos[2] + this.err[2]];
    // Our look is ours: it goes back on after the replay, unless the robot was turned
    // (a wormhole, a respawn) where our prediction had not turned it.
    const look = { yaw: bot.yaw, pitch: bot.pitch, turns: bot.turns };
    const { keep, replay } = splitAck(this.pending, (s.ak && s.ak[this.slot]) || [0, 0]);
    this.pending = keep;
    this.worldAt(s.wt);
    this.applyPlayer(pl, a, true);
    const hostYaw = a[3];
    const hostPitch = a[4];
    bot.yaw = hostYaw;
    bot.pitch = hostPitch;
    let t = s.wt;
    for (const step of replay) {
      t += PHYSICS_DT;
      this.game.world.step(PHYSICS_DT);
      this.refreshEnds();
      this.stepOwn(step.it, PHYSICS_DT, true);
    }
    this.t = t;
    if (bot.turns === look.turns) {
      bot.yaw = look.yaw;
      bot.pitch = look.pitch;
    }
    // Whatever the correction moved, fade it out on screen rather than jump; a big one (a respawn) is a jump.
    const d = [shown[0] - bot.pos[0], shown[1] - bot.pos[1], shown[2] - bot.pos[2]];
    const moved = this.first ? 0 : Math.hypot(d[0] - this.err[0], d[1] - this.err[1], d[2] - this.err[2]);
    this.corrections.push(moved); // how far the host's word moved our robot (for the curious, and the tests)
    if (this.corrections.length > 600) this.corrections.shift();
    this.first = false;
    this.err = Math.hypot(...d) > NET.snapOver ? [0, 0, 0] : d;
  }

  /** Our own robot's on-screen offset while a correction fades (dt seconds since the last frame). */
  fade(dt) {
    const k = Math.exp(-dt / NET.smooth);
    for (let i = 0; i < 3; i++) {
      this.err[i] *= k;
      if (Math.abs(this.err[i]) < 0.002) this.err[i] = 0;
    }
    this.me.bot.drawOff = [...this.err];
  }

  /**
   * Everything but our robot as it was NET.interp ago: the snapshots either
   * side of then, positions between them, and their events played as they
   * come on screen. `now` is local seconds.
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
      // Every snapshot passed since last frame gives up its events now.
      for (const snap of this.snaps) if (snap.n <= b.n && (!this.shown || snap.n > this.shown.n)) this.play(snap);
      this.showState(b);
      this.shown = b;
    }
    this.place(a, b, k);
    this.game.updateSign();
  }

  /** A snapshot's events, those not yet seen. */
  play(s) {
    const g = this.game;
    for (const [id, e] of s.lg) {
      if (id <= this.seen) continue;
      this.seen = id;
      if (this.early.delete(id)) continue;
      if (e.slot === this.slot && OWN_MOTION.has(e.s)) continue;
      g.events.push(e);
    }
  }

  /** The things on screen (not our robot, not what it stands on) as a snapshot has them. */
  showState(s) {
    const g = this.game;
    for (const a of s.pl) {
      if (a[0] === this.slot) continue;
      const pl = g.players[a[0]];
      if (pl) this.applyPlayer(pl, a, true);
    }
    // Enemies: those that moved, as they are; those gone, gone; the rest (asleep) where they were.
    for (const id of s.eg) this.enemies.delete(id);
    for (const e of s.fo) {
      let mine = this.enemies.get(e.id);
      if (!mine) {
        mine = new Enemy({ move: e.move, look: e.look, p: e.pos, color: e.color, r: e.r, folded: e.folded });
        this.enemies.set(e.id, mine);
      }
      restore(mine, e);
      delete mine.ic;
    }
    g.enemies = [...this.enemies.values()].filter((e) => !e.dead);
    const byId = (list) => new Map(list.map((c) => [c.id, c]));
    const charges = byId(g.charges);
    g.charges = s.ch.map((a) => {
      const c = charges.get(a[0]) || { id: a[0], pos: [...a[2]], vel: [0, 0, 0], trail: [] };
      c.owner = a[1];
      c.vel = a[3];
      c.r = a[4];
      c.kind = KINDS[a[5]] || 'std';
      c.color = a[6] || undefined;
      c.age = a[7];
      c.portaled = !!a[8];
      return c;
    });
    const shots = byId(g.shots);
    g.shots = s.sh.map((a) => {
      const c = shots.get(a[0]) || { id: a[0], pos: [...a[1]], vel: [0, 0, 0], trail: [], age: 1 };
      c.vel = a[2];
      c.r = a[3];
      c.color = a[4] || undefined;
      c.lobbed = !!a[5];
      return c;
    });
    const pickups = byId(g.pickups);
    g.pickups = s.pk.map((a) => {
      const p = pickups.get(a[0]) || { id: a[0], taken: false };
      p.kind = a[1] === 's' ? 'shield' : 'power';
      p.power = a[2];
      p.pos = [...a[3]];
      p.p = p.pos;
      p.owner = a[4];
      p.secret = !!a[5];
      return p;
    });
    s.am.forEach(([state, wave], i) => {
      const am = g.ambushes[i];
      if (am) {
        am.state = state;
        am.wave = wave;
      }
    });
    g.checkpoint = s.cp;
    if (s.bs) {
      if (!g.boss || g.boss.id !== s.bs.k) g.boss = makeBoss(s.bs.k, g.bp.arena, g);
      const { k, ...rest } = s.bs;
      restore(g.boss, rest);
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
      const jump = far(pa[1], pb[1], NET.snapOver);
      pl.bot.pos = jump ? [...pb[1]] : lerp3(pa[1], pb[1], k);
      pl.bot.yaw = jump ? pb[3] : lerpAngle(pa[3], pb[3], k);
      pl.bot.pitch = jump ? pb[4] : lerp(pa[4], pb[4], k);
    }
    for (const e of g.enemies) {
      const ea = a.foMap.get(e.id);
      const eb = b.foMap.get(e.id);
      if (ea && eb && !far(ea.pos, eb.pos, NET.snapOver)) {
        e.pos = lerp3(ea.pos, eb.pos, k);
        e.yaw = lerpAngle(ea.yaw, eb.yaw, k);
      }
    }
    const between = (list, sa, sb, ip) => {
      const ma = new Map(sa.map((c) => [c[0], c]));
      const mb = new Map(sb.map((c) => [c[0], c]));
      for (const c of list) {
        const ca = ma.get(c.id);
        const cb = mb.get(c.id);
        if (ca && cb && !far(ca[ip], cb[ip], NET.snapOver)) c.pos = lerp3(ca[ip], cb[ip], k);
        else if (cb) c.pos = [...cb[ip]];
        if (c.trail) {
          c.trail.push([...c.pos]);
          if (c.trail.length > 10) c.trail.shift();
        }
      }
    };
    between(g.charges, a.ch, b.ch, 2);
    between(g.shots, a.sh, b.sh, 1);
    if (g.boss && a.bs && b.bs && a.bs.k === b.bs.k && a.bs.pos && b.bs.pos) {
      g.boss.pos = lerp3(a.bs.pos, b.bs.pos, k);
      if (a.bs.yaw != null && b.bs.yaw != null) g.boss.yaw = lerpAngle(a.bs.yaw, b.bs.yaw, k);
    }
  }
}
