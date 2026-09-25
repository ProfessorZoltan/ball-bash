// One level of Defector, start to finish: the robots, their charges and
// wormholes, the enemies, what they drop, the checkpoints and secrets, and
// the boss at the end; or, in versus, an arena and the robots against each
// other. DOM-free: main.js feeds it intents and draws it, and the tests drive
// it directly. It speaks back through `events` (sound cues and state changes
// for main.js) and `fx` (particles).
//
// There are one to three players. Each has a robot, a shield pool, the
// power-ups they have picked up, a blaster that cools on its own and a
// wormhole pair of their own (world.portals[slot]); everything else, the
// level and all that is in it, they share. Alone, the game is exactly the
// campaign it always was, and `bot`, `pool`, `ammo` and the rest still read
// the one player.
import { circleVsCapsule, circleVsCircle, capsuleVsCapsule, reflect, raycastSegments } from '../../src/physics.js';
import { ROBOT, MOVE, BLASTER, POWER, POWERUPS, PICKUP, ACTIVE, BOSS_INTRO, SURFACE_VELOCITY_FACTOR, SCREEN, PLAYERS, COOP, VERSUS } from './config.js';
import { createWorld, stepWorld, segmentsNear, addGate, setGate, makeWell } from './world.js';
import { Robot, stepRobot, firmGround } from './player.js';
import { Charge, chargeSpec, stepCharge, clampCharge, muzzle, guideLine } from './blaster.js';
import { sightLine, placeEnd, refreshEnds, ejectFrom, endsLeftBehind, PORTAL } from './wormholes.js';
import { Enemy, stepEnemy, touchesRobot, freezeEnemy } from './enemies.js';
import { Boss } from './bosses.js';
import { Fx } from './fx.js';

const TAU = Math.PI * 2;

/** A single expanding ring a boss sends out: Deflector's pulse, once. */
export class OneRing {
  constructor(x, y, { speed = 320, maxRadius = 600, color = '#ffffff' }, id) {
    this.x = x;
    this.y = y;
    this.sx = x;
    this.sy = y;
    this.radius = 4;
    this.speed = speed;
    this.maxRadius = maxRadius;
    this.color = color;
    this.thick = 8;
    this.nextAt = id; // what the robot remembers it by, so one ring throws it once
    this.done = false;
    this.oneShot = true;
  }

  update(dt) {
    this.radius += this.speed * dt;
    if (this.radius >= this.maxRadius) this.done = true;
  }

  ring() {
    return this.done ? null : { x: this.x, y: this.y, r: this.radius, thick: this.thick };
  }

  countdown() {
    return Infinity;
  }

  surfaceVelocityAt(px, py) {
    const dx = px - this.x;
    const dy = py - this.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: (dx / d) * this.speed, y: (dy / d) * this.speed };
  }
}

/** Power-ups a 'random' drop picks from, each as likely as the others; a shield now and then. */
function randomDrop(rng) {
  if (rng() < 0.12) return 'shield';
  return POWERUPS[Math.floor(rng() * POWERUPS.length)].id;
}

/** A robot with nothing pressed. */
export const IDLE = Object.freeze({ mx: 0 });

/** One player: their robot, and everything that is theirs alone. */
export class Player {
  constructor(slot, x, y, o = {}) {
    this.slot = slot;
    this.bot = new Robot(x, y);
    this.bot.slot = slot;
    this.bot.invuln = 1;
    this.name = o.name || PLAYERS[slot].name;
    this.color = PLAYERS[slot].color;
    this.pool = o.shields ?? 5;
    this.maxPool = o.maxShields ?? this.pool;
    this.ammo = { big: 0, triple: 0, freeze: 0, durable: 0, strong: 0, ...(o.ammo || {}) };
    this.loaded = o.loaded && this.ammo[o.loaded] > 0 ? o.loaded : 'std';
    this.cool = 0;
    this.firePending = 0; // a press that came while the blaster was still cooling: it fires the moment it can
    this.lastJumpHeld = false;
    this.out = false; // no shields left: out until a teammate brings them back (co-op), or for the match (versus)
    this.frozen = 0; // versus: seconds a Frost charge still holds the robot
    this.view = null; // where this player's screen is ({ x, y, hw, hh }), when their client says
    this.stats = { shieldsLost: 0, hits: 0, falls: 0, powerups: 0 };
  }

  /** What firing with this player's load makes. A standard charge is in the player's own colour. */
  get spec() {
    const s = chargeSpec(this.loaded);
    if (this.loaded === 'std') s.color = PLAYERS[this.slot].charge;
    return s;
  }
}

export class Game {
  /**
   * `bp` is a built level (build.js), or an arena map (maps.js) for versus.
   * Options: mode ('solo', 'coop' or 'versus'), players (how many, or a list
   * of { name }), local (the slot this client plays, whose robot `bot` is),
   * shields (each player's pool), maxShields (what a shield pickup can top it
   * up to), checkpoint (index to start at), ammo and loaded (power-ups held
   * by the first player, kept over a continue in the same level; `kit` gives
   * each player theirs), stats (carried over a continue), rng.
   */
  constructor(bp, opts = {}) {
    this.bp = bp;
    this.mode = opts.mode || 'solo';
    this.world = createWorld(bp);
    this.world.ice = [];
    this.fx = new Fx();
    this.events = [];
    this.rng = opts.rng || Math.random;
    this.time = opts.stats ? opts.stats.time : 0;
    this.stats = opts.stats ? { ...opts.stats } : { shieldsLost: 0, defeated: 0, secrets: 0, powerups: 0, continues: 0, time: 0 };
    this.stats.secretsTotal = (bp.secrets || []).length;
    this.checkpoints = (bp.checkpoints || []).map((c) => ({ ...c, on: false }));
    this.checkpoint = opts.checkpoint ?? -1;
    // A checkpoint this level does not have (a save from an older build of it) starts the level over.
    if (!(this.checkpoint < this.checkpoints.length)) this.checkpoint = -1;
    const at = this.checkpoint >= 0 ? this.checkpoints[this.checkpoint] : bp.spawn;
    for (let i = 0; i <= this.checkpoint; i++) this.checkpoints[i].on = true;
    const roster = Array.isArray(opts.players) ? opts.players : Array.from({ length: opts.players || 1 }, () => ({}));
    this.players = roster.map((r, slot) => {
      const kit = (opts.kit && opts.kit[slot]) || (slot === 0 ? { ammo: opts.ammo, loaded: opts.loaded } : {});
      const spot = this.mode === 'versus' ? bp.spawns[slot % bp.spawns.length] : this.besideSpot(at, slot);
      const pl = new Player(slot, spot.x, spot.y, { name: r.name, shields: opts.shields, maxShields: opts.maxShields, ammo: kit.ammo, loaded: kit.loaded });
      this.world.portals[slot] = this.world.portals[slot] || [null, null];
      this.faceAway(pl.bot);
      return pl;
    });
    this.local = Math.min(opts.local ?? 0, this.players.length - 1);
    this.charges = [];
    this.shots = [];
    this.enemies = (bp.enemies || []).map((s, i) => new Enemy(s, i));
    this.nextEnemy = this.enemies.length;
    this.pickupId = 1;
    this.pickups = (bp.pickups || []).map((p) => this.makePickup(p.kind, p.x, p.y, null, true));
    this.secrets = (bp.secrets || []).map((s) => ({ ...s, found: false }));
    this.hazards = [];
    this.ringId = 1e6;
    this.phase = this.mode === 'versus' ? 'ready' : 'play'; // ready (versus), play, intro, boss, bossDown, exit, cleared, down, over (versus)
    this.phaseT = 0;
    this.boss = null;
    this.bossEye = null; // the robot the boss is watching, and until when
    this.bossEyeUntil = 0;
    this.exit = null;
    this.arena = bp.arena || null;
    if (this.arena) {
      const A = this.arena;
      this.gate = addGate(this.world, A.x0, A.floor - A.door, A.floor);
    }
    // Rooms that lock until their waves are beaten.
    this.ambushes = (bp.ambushes || []).map((a) => ({
      ...a,
      state: 'idle',
      wave: -1,
      gates: [addGate(this.world, a.x0 + 10, a.top, a.floor), addGate(this.world, a.x1 - 10, a.top, a.floor)],
      live: [],
    }));
    this.pits = bp.pits || [];
    this.tally = { shots: 0, warps: 0 };
    this.winner = null; // versus: the slot left standing (null for a draw)
    this.nextPower = this.mode === 'versus' ? this.powerDelay() : Infinity;
  }

  // The one player a single-player game, the HUD and the camera mean: this client's own.
  get me() {
    return this.players[this.local];
  }
  get bot() {
    return this.me.bot;
  }
  get pool() {
    return this.me.pool;
  }
  set pool(v) {
    this.me.pool = v;
  }
  get maxPool() {
    return this.me.maxPool;
  }
  get ammo() {
    return this.me.ammo;
  }
  set ammo(v) {
    this.me.ammo = v;
  }
  get loaded() {
    return this.me.loaded;
  }
  set loaded(v) {
    this.me.loaded = v;
  }
  get cool() {
    return this.me.cool;
  }
  set cool(v) {
    this.me.cool = v;
  }
  get view() {
    return this.me.view;
  }
  set view(v) {
    this.me.view = v;
  }
  get spec() {
    return this.me.spec;
  }
  get multi() {
    return this.players.length > 1;
  }

  /** The players still in. */
  live() {
    return this.players.filter((p) => !p.out);
  }

  /** Where the robot of `slot` is put down next to a spot: side by side, on the ground, never over a drop. */
  besideSpot(at, slot) {
    const offs = [0, COOP.spread, -COOP.spread];
    const dx = offs[slot % offs.length];
    if (!dx) return { x: at.x, y: at.y };
    const x = at.x + dx;
    const reach = ROBOT.half + ROBOT.r + 12;
    const segs = segmentsNear(this.world, x - ROBOT.r, at.y - reach, x + ROBOT.r, at.y + reach, { movers: false });
    const floor = raycastSegments(x, at.y - 20, 0, 1, segs, reach + 20);
    const walls = segmentsNear(this.world, Math.min(at.x, x) - ROBOT.r, at.y - ROBOT.half, Math.max(at.x, x) + ROBOT.r, at.y + ROBOT.half, { movers: false, oneWay: false });
    const blocked = raycastSegments(at.x, at.y, Math.sign(dx), 0, walls, Math.abs(dx) + ROBOT.r);
    return floor && floor.seg.ny < -0.6 && !blocked ? { x, y: at.y } : { x: at.x, y: at.y };
  }

  /**
   * Which way a robot put down at (x, y) should face: away from the nearer
   * side of the room, so it starts looking into it rather than at a wall. A
   * versus map's sides are its walls; in a level, whatever wall stands within
   * half a screen either side. With neither nearer (or none), right: the way
   * a level goes.
   */
  facingAt(x, y) {
    const V = this.bp.view;
    let left;
    let right;
    if (V) {
      left = x - V.x0;
      right = V.x1 - x;
    } else {
      const reach = SCREEN.w / 2;
      const segs = segmentsNear(this.world, x - reach, y - 4, x + reach, y + 4, { oneWay: false, movers: false });
      const l = raycastSegments(x, y, -1, 0, segs, reach);
      const r = raycastSegments(x, y, 1, 0, segs, reach);
      left = l ? l.t : Infinity;
      right = r ? r.t : Infinity;
    }
    return right < left - 1 ? -1 : 1;
  }

  /** A robot just put down faces away from the nearer side of the room, its blaster with it. */
  faceAway(bot) {
    const dir = this.facingAt(bot.x, bot.y);
    bot.facing = dir;
    bot.aim = dir > 0 ? 0 : Math.PI;
  }

  /** The living player nearest (x, y), and how far away across and down; null with nobody in. */
  nearest(x, y) {
    let best = null;
    for (const p of this.players) {
      if (p.out) continue;
      const dx = Math.abs(p.bot.x - x);
      const dy = Math.abs(p.bot.y - y);
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { p, dx, dy, d };
    }
    return best;
  }

  /** The robot a boss is after: the nearest, looked for again every so often; always the one robot alone. */
  bossTarget() {
    if (!this.multi) return this.bot;
    const e = this.bossEye;
    if (e && !e.out && this.time < this.bossEyeUntil) return e.bot;
    const b = this.boss;
    const n = b ? this.nearest(b.x, b.y) : null;
    this.bossEye = n ? n.p : this.me;
    this.bossEyeUntil = this.time + COOP.retarget;
    return this.bossEye.bot;
  }

  /** The robot this client's camera follows: its own, or, while it is out, the nearest teammate still in. */
  focus() {
    const me = this.me;
    if (!me.out || this.mode === 'solo') return me.bot;
    const n = this.nearest(me.bot.x, me.bot.y);
    return n ? n.p.bot : me.bot;
  }

  emit(s, extra = {}) {
    this.events.push({ s, ...extra });
  }

  /** The power-up kinds with charges left, in cycle order, after the standard charge. */
  loadable(pl = this.me) {
    return ['std', ...POWERUPS.map((p) => p.id).filter((id) => pl.ammo[id] > 0)];
  }

  /** The next kind held (`dir` -1: the one before), round to the standard charge and on. */
  cycle(pl = this.me, dir = 1) {
    const list = this.loadable(pl);
    const i = list.indexOf(pl.loaded);
    pl.loaded = list[(i + (dir < 0 ? -1 : 1) + list.length) % list.length];
    this.emit('cycle', { kind: pl.loaded, slot: pl.slot });
  }

  /** Load one kind straight away (1 to 6 on the keyboard): the standard charge, or a power-up with charges left. */
  load(kind, pl = this.me) {
    if (kind !== 'std' && !(pl.ammo[kind] > 0)) {
      this.emit('dry', { slot: pl.slot });
      return false;
    }
    if (pl.loaded !== kind) {
      pl.loaded = kind;
      this.emit('cycle', { kind, slot: pl.slot });
    }
    return true;
  }

  // ------------------------------------------------------------------ step

  /** Has the level or match ended (nothing moves any more)? */
  ended() {
    return this.phase === 'cleared' || this.phase === 'down' || this.phase === 'over';
  }

  /**
   * One physics step. `it` is the intent of the one player, or a list with
   * one for each player in slot order. An intent: mx, run, jump, jumpPressed,
   * down, aim (radians, or null to keep), fire (pressed this step), worm
   * [light end pressed, dark end pressed], cycle (1 for the next power-up,
   * -1 for the one before), pick (a kind to load straight away). In a list, a
   * missing intent is a robot with nothing pressed; null holds the robot
   * where it is for this step (a guest whose inputs are late); and a list of
   * intents plays each in turn (a guest catching up).
   */
  step(dt, it) {
    const its = Array.isArray(it) ? it : [it];
    this.fx.update(dt);
    if (this.ended()) return;
    this.time += dt;
    this.phaseT += dt;
    const w = this.world;
    stepWorld(w, dt);
    w.pulsers = w.pulsers.filter((p) => !p.done);
    for (const p of refreshEnds(w)) {
      this.ejectAll(p);
      this.fx.ring(p.cx, p.cy, '#ffffff', 60, 0.4);
      this.emit('unportal');
    }
    w.ice = this.enemies.filter((e) => e.ice && !e.dead).map((e) => e.ice);

    // A flicker and a freeze run on the game's clock, for a robot waiting on a guest's late inputs too.
    for (const pl of this.players) {
      if (pl.out) continue;
      pl.bot.invuln = Math.max(0, (pl.bot.invuln || 0) - dt);
      pl.frozen = Math.max(0, pl.frozen - dt);
    }
    this.players.forEach((pl, i) => {
      if (pl.out) return;
      const pi = its[i] === undefined ? IDLE : its[i];
      if (pi === null) return;
      for (const x of Array.isArray(pi) ? pi : [pi]) if (!pl.out) this.stepPlayer(pl, x || IDLE, dt);
    });

    this.stepCharges(dt);
    this.stepSwitches(dt);
    this.stepShots(dt);
    this.stepEnemies(dt);
    this.stepPickups(dt);
    this.stepMarkers();
    this.stepAmbushes();
    this.stepBoss(dt);
    this.stepHazards(dt);
    if (this.mode === 'versus') this.stepVersus(dt);
  }

  /** One player's robot for one step: moving, falling, the blaster and the wormholes. */
  stepPlayer(pl, it, dt) {
    const bot = pl.bot;
    const w = this.world;
    pl.lastJumpHeld = !!it.jump;
    const held = (this.phase === 'intro' && this.phaseT < 0.6) || this.phase === 'ready' || pl.frozen > 0;
    const move = held ? { mx: 0 } : it;
    if (it.aim != null && Number.isFinite(it.aim)) bot.aim = it.aim;
    const slot = pl.slot;
    // What the robot's own movement makes (dust, a spring's ring, a wormhole's flash) is marked as its
    // own, so a guest predicting its robot, which makes these itself, is not shown them twice.
    const own = (fn) => (...a) => {
      this.fx.who = slot;
      fn(...a);
      this.fx.who = null;
    };
    stepRobot(bot, move, w, dt, {
      jump: () => this.emit('jump', { slot }),
      land: own((air) => {
        if (air > 0.25) {
          this.fx.dust(bot.x, bot.bottom, '#cfefff', 6 + Math.min(8, air * 10));
          this.emit('land', { air, slot });
        }
      }),
      hurt: (reason, p) => this.hurt(reason, p, reason === 'crushed', pl),
      spring: own(() => {
        this.emit('spring', { slot });
        this.fx.ring(bot.x, bot.bottom, '#9dff5c', 50, 0.3);
      }),
      pulse: () => this.emit('pulse', { slot }),
      warp: own((from, to) => {
        this.fx.ring(from.x, from.y, '#ffffff', 70, 0.35);
        this.fx.ring(to.x, to.y, '#ffffff', 90, 0.45);
        this.tally.warps++;
        this.emit('warp', { slot });
      }),
      fell: () => this.hurt('fell', null, true, pl),
      swallowed: () => this.hurt('well', null, true, pl),
    });

    if (pl.out) return;
    if (this.inPit(bot.x, bot.top)) this.hurt('fell', null, true, pl);
    if (pl.out) return;

    for (const k of endsLeftBehind(w, bot.x, bot.y, slot)) this.closeEnd(k, pl);

    pl.cool -= dt;
    if (held && this.phase !== 'intro') return; // held fast, it cannot fire or open an end either
    if (it.fire) {
      // A press during the cooldown is kept, not lost. One with six already out is refused, audibly.
      if (this.roomFor(pl.spec, pl)) pl.firePending = BLASTER.cooldown + 0.05;
      else this.emit('dry', { slot });
    }
    if (pl.firePending > 0) {
      if (this.fire(pl)) pl.firePending = 0;
      else pl.firePending -= dt;
    }
    if (it.worm) for (let k = 0; k < 2; k++) if (it.worm[k]) this.deploy(k, pl);
    if (it.cycle) this.cycle(pl, it.cycle);
    if (it.pick) this.load(it.pick, pl);
  }

  // ------------------------------------------------------------ the blaster

  /** Fire what is loaded along the aim, if the blaster is ready. */
  fire(pl = this.me) {
    const bot = pl.bot;
    if (pl.cool > 0 || this.ended() || pl.out) return false;
    const spec = pl.spec;
    if (!this.roomFor(spec, pl)) return false;
    pl.cool = BLASTER.cooldown;
    const sh = bot.shoulder;
    for (const off of spec.spread) {
      const a = bot.aim + off;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const at = muzzle(this.world, sh.x, sh.y, dx, dy, spec.r);
      const c = new Charge({ x: at.x, y: at.y, vx: dx * BLASTER.speed, vy: dy * BLASTER.speed, r: spec.r, life: spec.life, damage: spec.damage, freeze: spec.freeze, kind: spec.kind, color: spec.color, born: this.time, owner: bot.slot });
      c.id = this.pickupId++;
      this.charges.push(c);
    }
    if (pl.loaded !== 'std') {
      pl.ammo[pl.loaded] -= 1;
      if (pl.ammo[pl.loaded] <= 0) {
        pl.ammo[pl.loaded] = 0;
        pl.loaded = 'std';
        this.emit('empty', { slot: pl.slot });
      }
    }
    this.tally.shots++;
    this.fx.ring(sh.x + Math.cos(bot.aim) * BLASTER.muzzle, sh.y + Math.sin(bot.aim) * BLASTER.muzzle, spec.color, 36, 0.2, 2);
    this.emit('fire', { kind: spec.kind, slot: pl.slot });
    return true;
  }

  /** Is there room in the air for a volley of `spec`? A whole volley or none: a trident needs three free. Six each. */
  roomFor(spec, pl = this.me) {
    let n = 0;
    for (const c of this.charges) if (c.owner === pl.slot) n++;
    return n + spec.spread.length <= BLASTER.maxAlive;
  }

  /** How many of this player's charges are in the air. */
  chargesOf(pl = this.me) {
    let n = 0;
    for (const c of this.charges) if (c.owner === pl.slot) n++;
    return n;
  }

  /** The targeting line for what is loaded, from where the robot stands. */
  guide(pl = this.me) {
    const sh = pl.bot.shoulder;
    return guideLine(this.world, sh.x, sh.y, pl.bot.aim, pl.spec, this.time);
  }

  /** The wormhole aim line for either end. */
  sight(pl = this.me) {
    const sh = pl.bot.shoulder;
    return sightLine(this.world, sh.x, sh.y, pl.bot.aim);
  }

  /** Let go of LB / RB (Q / E): that end goes where the line of sight lands, if a wormhole can sit there. */
  deploy(which, pl = this.me) {
    const s = this.sight(pl);
    const p = placeEnd(this.world, s, which, pl.slot);
    if (!p) {
      const end = s.pts[s.pts.length - 1];
      this.fx.sparks(end[0], end[1], 0, -1, '#ff5c7a', 8, 160);
      this.emit('fizzle', { slot: pl.slot });
      return false;
    }
    const pair = this.world.portals[pl.slot];
    const old = pair[which];
    if (old) this.ejectAll(old); // whatever was halfway into the end being moved is put back out
    pair[which] = p;
    this.fx.ring(p.cx, p.cy, which === 0 ? '#e6fbff' : '#2c7c9a', 70, 0.4);
    this.emit('portal', { which, slot: pl.slot });
    return true;
  }

  /** Close a player's end `which` (both with `which` left out), putting back whatever was sunk in it. */
  closeEnd(which, pl = this.me) {
    const pair = this.world.portals[pl.slot];
    let closed = false;
    for (const k of which == null ? [0, 1] : [which]) {
      const p = pair[k];
      if (!p) continue;
      this.ejectAll(p);
      pair[k] = null;
      this.fx.ring(p.cx, p.cy, '#ffffff', 60, 0.4);
      closed = true;
    }
    if (closed) this.emit('unportal');
    return closed;
  }

  /** Close every player's ends. */
  closeAllEnds() {
    for (const pl of this.players) this.closeEnd(null, pl);
  }

  /**
   * Is (x, y) on a screen: this client's, or any other player's still in?
   * Without a camera (the tests and tools, or a client that has not said)
   * a screen is one round the robot, framed as the camera frames it.
   */
  inView(x, y) {
    for (const pl of this.players) {
      if (pl.out) continue;
      const b = pl.bot;
      const v = pl.view ?? { x: b.x + b.facing * 60, y: b.y - 50, hw: SCREEN.w / 2, hh: SCREEN.h / 2 };
      if (Math.abs(x - v.x) <= v.hw && Math.abs(y - v.y) <= v.hh) return true;
    }
    return false;
  }

  /**
   * A charge of yours that touches a switch flips it, and is spent. Only a
   * switch on screen, though: a stray shot at something else must not open a
   * door far ahead that the player never saw open.
   */
  chargeVsSwitches(c) {
    for (const sw of this.world.switches) {
      if (sw.on || Math.hypot(c.x - sw.x, c.y - sw.y) > sw.r + c.r || !this.inView(sw.x, sw.y)) continue;
      c.dead = true;
      this.fx.sparks(sw.x, sw.y, 0, -1, '#9dff5c', 10, 200);
      this.flipSwitch(sw);
      return;
    }
  }

  /** A switch goes on: its doors open (for `hold` seconds, if it has one). */
  flipSwitch(sw) {
    sw.on = true;
    sw.flash = 1;
    sw.t = sw.hold || 0;
    for (const d of this.world.doors) if (sw.doors.includes(d.id)) setGate(d, false);
    this.fx.ring(sw.x, sw.y, '#9dff5c', 60, 0.4);
    this.emit('switch');
  }

  /** A timed switch runs down and shuts its doors again, never on a robot. */
  stepSwitches(dt) {
    for (const sw of this.world.switches) {
      sw.flash = Math.max(0, sw.flash - dt * 2);
      if (!sw.on || !sw.hold) continue;
      sw.t -= dt;
      if (sw.t > 0) continue;
      const doors = this.world.doors.filter((d) => sw.doors.includes(d.id));
      if (doors.some((d) => this.players.some(({ bot, out }) => !out && Math.abs(bot.x - d.x) < bot.r + 12 && bot.bottom > d.y0 && bot.top < d.y1))) {
        sw.t = 0.05;
        continue;
      }
      sw.on = false;
      for (const d of doors) setGate(d, true);
      this.emit('lock');
    }
  }

  /** An end is going: any robot or enemy sunk in its mouth is put back in front of its surface. */
  ejectAll(p) {
    for (const pl of this.players) if (!pl.out) ejectFrom(p, pl.bot);
    for (const e of this.enemies) if (!e.dead && !e.frozen) ejectFrom(p, e);
  }

  stepCharges(dt) {
    const w = this.world;
    for (let i = this.charges.length - 1; i >= 0; i--) {
      const c = this.charges[i];
      const alive = stepCharge(c, w, dt, this.time, {
        crate: (crate) => this.hitCrate(crate, c),
        bounce: (ch, h) => {
          this.fx.sparks(ch.x - h.nx * ch.r, ch.y - h.ny * ch.r, h.nx, h.ny, ch.color, 5, 180);
          this.emit('ricochet', { speed: ch.speed });
        },
        warp: (ch, from, to) => {
          this.fx.ring(from.x, from.y, ch.color, 40, 0.25);
          this.fx.ring(to.x, to.y, ch.color, 40, 0.25);
        },
        swallow: (ch, well) => {
          this.fx.ring(well.x, well.y, '#b49cff', 60, 0.4);
          this.emit('swallow');
        },
        ice: (e, ch) => {
          this.damageEnemy(e, ch);
          return true;
        },
      });
      if (alive && !c.dead) this.chargeVsSwitches(c);
      if (!alive || c.dead) {
        if (alive === false) this.fx.sparks(c.x, c.y, 0, -1, c.color, 4, 80, 3, 0.25);
        this.charges.splice(i, 1);
        continue;
      }
      // Enemies: a shield turns it away, a body takes it.
      let spent = false;
      for (const e of this.enemies) {
        if (e.dead || !e.awake || e.frozen) continue;
        if (e.folded && !(c.warps > 0)) continue; // it passes through what is folded
        const s = e.shieldSegment();
        if (s) {
          const h = circleVsCapsule(c.x, c.y, c.r, s.ax, s.ay, s.bx, s.by, s.thick, c.vx, c.vy);
          if (h) {
            c.x += h.nx * h.depth;
            c.y += h.ny * h.depth;
            const sv = e.shieldVelocityAt(h.cx, h.cy);
            if (reflect(c, h.nx, h.ny, sv.x, sv.y, 1, SURFACE_VELOCITY_FACTOR)) {
              clampCharge(c, h.nx, h.ny);
              this.fx.sparks(h.cx, h.cy, h.nx, h.ny, e.color, 8, 220);
              this.emit('deflect');
            }
            continue;
          }
        }
        if (circleVsCircle(c.x, c.y, c.r, e.x, e.y, e.r)) {
          const killed = this.damageEnemy(e, c);
          if (!(killed && c.kind === 'big')) {
            spent = true;
            break;
          }
        }
      }
      if (!spent) spent = this.chargeVsBoss(c);
      if (!spent) {
        for (let j = this.shots.length - 1; j >= 0; j--) {
          const s = this.shots[j];
          if (circleVsCircle(c.x, c.y, c.r, s.x, s.y, s.r)) {
            this.fx.sparks(s.x, s.y, 0, -1, s.color, 6, 160, 3);
            this.shots.splice(j, 1);
            this.emit('pop');
            if (c.kind !== 'big') spent = true;
            break;
          }
        }
      }
      if (!spent && this.mode === 'versus') spent = this.chargeVsRobots(c);
      if (spent) this.charges.splice(i, 1);
    }
  }

  /**
   * Versus: another robot's charge costs a shield (a Hammer's two), and a
   * Frost one holds the robot fast instead. Your own go through you, and so
   * does anything while you flicker. Returns true if the charge is spent.
   */
  chargeVsRobots(c) {
    for (const pl of this.players) {
      if (pl.out || pl.slot === c.owner) continue;
      const b = pl.bot;
      if (!circleVsCapsule(c.x, c.y, c.r, b.x, b.y - b.half, b.x, b.y + b.half, b.r)) continue;
      if (b.invuln > 0 || (c.freeze && pl.frozen > 0)) continue;
      const by = this.players.find((q) => q.slot === c.owner);
      if (c.freeze) {
        pl.frozen = VERSUS.frozen;
        b.vx = 0;
        this.fx.ring(b.x, b.y, '#8fdcff', 60, 0.4);
        this.emit('freeze', { slot: pl.slot });
      } else {
        if (by) by.stats.hits += 1;
        this.hurt('shot', { x: c.x, y: c.y }, false, pl, c.damage);
      }
      return c.kind !== 'big';
    }
    return false;
  }

  /** A charge against the boss: a plate turns it, armour bounces it, the core takes it. Returns true if the charge is spent. */
  chargeVsBoss(c) {
    const b = this.boss;
    if (!b || b.dead || this.phase !== 'boss') return false;
    if (b.def.folded && !(c.warps > 0)) return false; // a folded boss is only touched by what has been folded too
    for (const p of b.parts) {
      if (p.type !== 'plate') continue;
      const s = p.seg;
      const h = circleVsCapsule(c.x, c.y, c.r, s.ax, s.ay, s.bx, s.by, p.thick, c.vx, c.vy);
      if (!h) continue;
      c.x += h.nx * h.depth;
      c.y += h.ny * h.depth;
      const sv = p.velAt(h.cx, h.cy);
      if (reflect(c, h.nx, h.ny, sv.x, sv.y, 1, SURFACE_VELOCITY_FACTOR)) {
        clampCharge(c, h.nx, h.ny);
        this.fx.sparks(h.cx, h.cy, h.nx, h.ny, b.color, 8, 240);
        this.emit('deflect');
      }
      return false;
    }
    for (const p of b.parts) {
      if (p.type === 'plate') continue;
      const h = circleVsCircle(c.x, c.y, c.r, p.x, p.y, p.r);
      if (!h) continue;
      if (p.type === 'core') {
        this.damageBoss(c, h);
        return true;
      }
      c.x += h.nx * h.depth;
      c.y += h.ny * h.depth;
      if (reflect(c, h.nx, h.ny, b.vx, b.vy, 1, SURFACE_VELOCITY_FACTOR)) {
        clampCharge(c, h.nx, h.ny);
        this.fx.sparks(c.x - h.nx * c.r, c.y - h.ny * c.r, h.nx, h.ny, '#9aa7c7', 6, 200);
        this.emit('armor');
      }
      return false;
    }
    return false;
  }

  damageBoss(c, h) {
    const b = this.boss;
    if (c.freeze) {
      b.chill = POWER.bossChill;
      this.fx.ring(b.x, b.y, '#8fdcff', b.r * 2, 0.4);
      this.emit('freeze');
      return;
    }
    b.hp -= c.damage;
    b.flash = 0.12;
    this.fx.sparks(h.cx, h.cy, -h.nx, -h.ny, b.color, 10, 260);
    this.emit('bossHit');
    if (b.hp <= 0) {
      b.hp = 0;
      b.dead = true;
      this.phase = 'bossDown';
      this.phaseT = 0;
      this.fx.explode(b.x, b.y, b.r * 1.6, [b.color, '#ffffff', '#ffb347']);
      for (const p of b.parts) if (p.type !== 'plate') this.fx.explode(p.x, p.y, p.r, [b.color, '#ffffff']);
      this.fx.kick(24);
      this.fx.blink('#ffffff', 0.8);
      this.shots.length = 0;
      this.hazards.length = 0;
      this.world.wells = this.world.wells.filter((w) => !w.charted); // what a boss made goes with it
      for (const e of this.enemies) if (!e.dead && e.bossMinion) this.defeat(e);
      this.emit('bossDown');
    }
  }

  /** Damage (or freeze) an enemy with a charge. Returns true if it is defeated. */
  damageEnemy(e, c) {
    if (c.freeze) {
      freezeEnemy(e);
      this.fx.ring(e.x, e.y, '#8fdcff', e.r * 2, 0.35);
      this.emit('freeze');
      return false;
    }
    return this.hitEnemy(e, c.damage, c.x, c.y);
  }

  hitEnemy(e, dmg, x, y) {
    e.hp -= dmg;
    e.flash = 0.12;
    this.fx.sparks(x, y, x - e.x, y - e.y, e.color, 6, 200);
    if (e.hp <= 0) {
      this.defeat(e);
      return true;
    }
    this.emit('hit');
    return false;
  }

  /** An enemy is done: it bursts into a cloud twice its size, and maybe leaves something behind. */
  defeat(e) {
    e.dead = true;
    e.ice = null;
    this.fx.explode(e.x, e.y, e.r, [e.color, '#ffffff', e.color]);
    this.fx.kick(Math.min(10, 2 + e.r / 6));
    this.stats.defeated++;
    this.emit('pop', { big: e.r > 26 });
    if (e.drop) this.drop(e.drop, e.x, e.y);
  }

  hitCrate(crate, c) {
    crate.hp -= c.freeze ? 0 : c.damage;
    crate.flash = 0.12;
    this.fx.sparks(c.x, c.y, -c.vx, -c.vy, '#ffd9a0', 6, 180);
    if (crate.hp <= 0 && !crate.broken) {
      crate.broken = true;
      this.fx.explode(crate.x + crate.w / 2, crate.y + crate.h / 2, Math.max(crate.w, crate.h) / 2, ['#ffd9a0', '#ffb347', '#ffffff']);
      this.emit('crate');
      if (crate.drop) this.drop(crate.drop, crate.x + crate.w / 2, crate.y + crate.h / 2);
    } else this.emit('thunk');
  }

  // -------------------------------------------------------------- pickups

  makePickup(kind, x, y, owner = null, resting = false) {
    return { id: this.pickupId++, kind, x, y, vx: 0, vy: resting ? 0 : -380, owner, t: this.rng() * TAU, resting, taken: false, age: 0 };
  }

  /**
   * Something drops. Every player gets their own copy that only they can
   * take, which is how co-op keeps drops fair without changing a level.
   */
  drop(kind, x, y) {
    const k = kind === 'random' ? randomDrop(this.rng) : kind;
    for (const p of this.players) {
      const pk = this.makePickup(k, x, y, p.slot);
      pk.vx = (this.rng() - 0.5) * 120;
      this.pickups.push(pk);
    }
  }

  stepPickups(dt) {
    for (const p of this.pickups) {
      if (p.taken) continue;
      p.t += dt;
      p.age += dt;
      if (!p.resting) {
        p.vy = Math.min(700, p.vy + 1400 * dt);
        const nx = p.x + p.vx * dt;
        const ny = p.y + p.vy * dt;
        const segs = segmentsNear(this.world, Math.min(p.x, nx) - PICKUP.r, Math.min(p.y, ny) - PICKUP.r, Math.max(p.x, nx) + PICKUP.r, Math.max(p.y, ny) + PICKUP.r * 2);
        const down = p.vy > 0 ? raycastSegments(nx, p.y, 0, 1, segs, PICKUP.r + Math.max(1, p.vy * dt)) : null;
        const side = raycastSegments(p.x, p.y, Math.sign(p.vx) || 1, 0, segs, PICKUP.r + Math.abs(p.vx * dt));
        if (side) p.vx = -p.vx * 0.4;
        else p.x = nx;
        if (down && down.seg.ny < -0.5) {
          p.y = down.y - PICKUP.r - 6;
          p.resting = true;
          p.vy = 0;
          p.vx = 0;
        } else p.y = ny;
        if (p.y > this.world.height + 200) p.taken = true;
      }
      if (p.age < 0.3 || p.taken) continue;
      for (const pl of this.players) {
        if (pl.out || (p.owner != null && p.owner !== pl.slot)) continue;
        const bot = pl.bot;
        const dx = p.x - bot.x;
        const dy = p.y - bot.y;
        if (Math.abs(dx) < PICKUP.r + bot.r + 4 && Math.abs(dy) < PICKUP.r + bot.half + bot.r) {
          this.take(p, pl);
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  take(p, pl = this.me) {
    p.taken = true;
    if (p.kind === 'shield') {
      if (pl.pool !== Infinity && pl.pool < pl.maxPool) pl.pool++;
      this.fx.word(p.x, p.y - 20, '+1 SHIELD', PICKUP.shield);
      this.emit('shield', { slot: pl.slot });
      return;
    }
    const pu = POWERUPS.find((q) => q.id === p.kind);
    if (!pu) return;
    const had = pl.ammo[p.kind];
    pl.ammo[p.kind] = Math.min(POWER.maxAmmo, had + POWER.ammo);
    if (had === 0 && pl.loaded === 'std') pl.loaded = p.kind;
    this.stats.powerups++;
    pl.stats.powerups++;
    this.fx.word(p.x, p.y - 20, pu.name.toUpperCase(), pu.color);
    this.fx.ring(p.x, p.y, pu.color, 50, 0.35);
    this.emit('powerup', { kind: p.kind, slot: pl.slot });
  }

  // -------------------------------------------------------------- enemies

  stepEnemies(dt) {
    const shoot = (e, a, sh) => this.shot(e.x + Math.cos(a) * (e.r + 6), e.y + Math.sin(a) * (e.r + 6), a, sh.speed, { r: 8, color: e.color, bounce: !!sh.bounce, life: 4 });
    for (const e of this.enemies) {
      if (e.dead) continue;
      // Each goes after the robot nearest it, and wakes and sleeps by that one too.
      const n = this.nearest(e.x, e.y);
      if (!n) continue;
      if (!e.awake && n.dx < ACTIVE.wakeX && n.dy < ACTIVE.wakeY) e.awake = true;
      else if (e.awake && (n.dx > ACTIVE.sleepX || n.dy > ACTIVE.sleepY) && !e.bossMinion && !e.room) e.awake = false;
      if (!e.awake) continue;
      stepEnemy(e, this.world, n.p.bot, dt, shoot);
      if (e.y > this.world.height + 300 || this.inPit(e.x, e.y - e.r)) {
        e.dead = true;
        continue;
      }
      if (e.frozen) continue;
      for (const pl of this.players) {
        if (pl.out || e.dead) continue;
        const bot = pl.bot;
        const t = touchesRobot(e, bot);
        if (!t) continue;
        const prevFeet = bot.prevY + bot.half + bot.r;
        if (t.body && bot.vy > 30 && prevFeet <= e.y - e.r * 0.25 && e.stompable) {
          bot.vy = -(pl.lastJumpHeld ? MOVE.stompHeld : MOVE.stomp);
          bot.rising = true;
          bot.y = Math.min(bot.y, e.y - e.r - bot.half - bot.r);
          this.fx.ring(e.x, e.y - e.r, '#ffffff', 40, 0.25);
          this.emit('stomp', { slot: pl.slot });
          this.hitEnemy(e, 1, e.x, e.y - e.r);
          continue;
        }
        this.hurt('enemy', t, false, pl);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead || false);
  }

  /** Loose a hostile shot (an enemy's or the boss's). */
  shot(x, y, a, speed, o = {}) {
    const c = new Charge({
      x,
      y,
      vx: o.vx ?? Math.cos(a) * speed,
      vy: o.vy ?? Math.sin(a) * speed,
      r: o.r ?? 8,
      life: o.life ?? 4,
      color: o.color || '#ff9a9a',
      hostile: true,
      bounce: o.bounce ?? o.maxBounces != null,
      born: this.time,
    });
    c.g = o.g || 0;
    c.maxBounces = o.maxBounces ?? Infinity;
    c.wave = o.wave || 0;
    c.look = o.look || 'orb';
    c.burst = o.burst || 0;
    c.id = this.pickupId++;
    this.shots.push(c);
    return c;
  }

  stepShots(dt) {
    const w = this.world;
    const born = [];
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const c = this.shots[i];
      if (c.g) c.vy += c.g * dt;
      if (c.wave) {
        const s = c.speed || 1;
        const off = c.wave * 5 * Math.cos((this.time - c.born) * 5) * dt;
        c.x += (-c.vy / s) * off;
        c.y += (c.vx / s) * off;
      }
      let ended = false;
      const alive = stepCharge(c, w, dt, this.time, {
        crate: () => {},
        bounce: () => {
          if (!c.bounce) ended = true;
        },
        swallow: () => {},
      });
      let done = !alive || c.bounces > c.maxBounces || ended;
      for (const pl of this.players) {
        const bot = pl.bot;
        if (done || pl.out || bot.invuln > 0) continue;
        if (circleVsCapsule(c.x, c.y, c.r, bot.x, bot.y - bot.half, bot.x, bot.y + bot.half, bot.r)) {
          this.hurt('shot', { x: c.x, y: c.y }, false, pl);
          done = true;
        }
      }
      if (done) {
        if (c.burst) for (let k = 0; k < c.burst; k++) born.push([c.x, c.y - 4, -Math.PI / 2 + (k - (c.burst - 1) / 2) * 0.5, 240]);
        this.fx.sparks(c.x, c.y, 0, -1, c.color, 5, 120, 3, 0.25);
        this.shots.splice(i, 1);
      }
    }
    for (const [x, y, a, s] of born) this.shot(x, y, a, s, { r: 6, color: '#ffd9a0', g: 600, life: 1.6 });
  }

  /** Is (x, y) down a pit, below its kill line? */
  inPit(x, y) {
    for (const p of this.pits) if (x > p.x0 && x < p.x1 && y > p.y) return true;
    return false;
  }

  /** Ambush rooms: shut on the way in, a wave at a time, open again (with a reward) when the last falls. */
  stepAmbushes() {
    const live = this.live();
    for (const a of this.ambushes) {
      if (a.state === 'idle') {
        if (live.some(({ bot }) => bot.x > a.x0 + 90 && bot.x < a.x1 - 90 && bot.y > a.top && bot.y < a.floor)) {
          a.state = 'fight';
          for (const g of a.gates) setGate(g, true);
          this.emit('lock');
          this.nextWave(a);
        }
        continue;
      }
      if (a.state !== 'fight') continue;
      // Nobody left in a locked room with its waves not beaten (out through a wormhole), and no end
      // left inside to get back in by: it would be shut for good, so its doors open and it starts over.
      const inside = (x, y) => x >= a.x0 - 2 && x <= a.x1 + 2 && y >= a.top - 2 && y <= a.floor + 2;
      const endInside = this.players.some((pl) => this.world.portals[pl.slot].some((p) => p && inside(p.cx, p.cy)));
      if (!live.some(({ bot }) => inside(bot.x, bot.y)) && !endInside && a.live.some((e) => !e.dead)) {
        this.resetRoom(a);
        continue;
      }
      if (a.live.every((e) => e.dead)) {
        if (a.wave + 1 < a.waves.length) this.nextWave(a);
        else {
          a.state = 'done';
          for (const g of a.gates) setGate(g, false);
          if (a.drop) this.drop(a.drop, (a.x0 + a.x1) / 2, a.floor - 120);
          this.fx.word((a.x0 + a.x1) / 2, a.top + 80, 'CLEAR', '#9dff5c', 1.4);
          this.emit('unlock');
        }
      }
    }
  }

  /** A locked room starts over: what is left of its wave goes, its doors open, and it locks again when the robot comes back in. */
  resetRoom(a) {
    for (const e of a.live) if (!e.dead) this.fx.ring(e.x, e.y, e.color, 40, 0.3);
    this.enemies = this.enemies.filter((e) => e.room !== a);
    a.live = [];
    a.wave = -1;
    a.state = 'idle';
    for (const g of a.gates) setGate(g, false);
    this.emit('unlock');
  }

  nextWave(a) {
    a.wave++;
    a.live = a.waves[a.wave].map((spec) => {
      const e = new Enemy(spec, this.nextEnemy++);
      e.awake = true;
      e.room = a; // it stays awake however far the robot wanders in the room
      this.enemies.push(e);
      this.fx.ring(e.x, e.y, e.color, 50, 0.45);
      return e;
    });
    this.emit('wave');
  }

  // ---------------------------------------------------- markers and zones

  stepMarkers() {
    const live = this.live();
    this.checkpoints.forEach((c, i) => {
      if (c.on || !live.some(({ bot }) => Math.abs(bot.x - c.x) <= 36 && Math.abs(bot.y - c.y) <= 90)) return;
      c.on = true;
      if (i > this.checkpoint) this.checkpoint = i;
      this.fx.ring(c.x, c.y - 40, '#9dff5c', 90, 0.5);
      this.fx.word(c.x, c.y - 90, 'CHECKPOINT', '#9dff5c');
      this.emit('checkpoint');
      this.revive(c);
    });
    for (const s of this.secrets) {
      if (s.found) continue;
      const pl = live.find(({ bot }) => bot.x >= s.x0 && bot.x <= s.x1 && bot.y >= s.y0 && bot.y <= s.y1);
      if (!pl) continue;
      s.found = true;
      this.stats.secrets++;
      this.fx.word(pl.bot.x, pl.bot.top - 30, 'SECRET', '#ffd23f', 1.6);
      this.emit('secret');
    }
    if (this.exit && this.phase === 'exit' && live.some(({ bot }) => Math.abs(bot.x - this.exit.x) < 48 && Math.abs(bot.y - this.exit.y) < 90)) {
      this.phase = 'cleared';
      this.stats.time = this.time;
      this.fx.blink('#ffffff', 0.9);
      this.emit('cleared');
    }
  }

  /**
   * Co-op: a teammate has reached a checkpoint (or the boss), so everyone who
   * was out comes back there, with COOP.revive shields.
   */
  revive(at) {
    if (this.mode !== 'coop') return;
    for (const pl of this.players) {
      if (!pl.out) continue;
      const s = this.besideSpot(at, pl.slot);
      pl.out = false;
      pl.pool = COOP.revive;
      pl.frozen = 0;
      pl.bot.spawn(s.x, s.y);
      this.faceAway(pl.bot);
      pl.bot.invuln = ROBOT.invuln;
      this.fx.ring(s.x, s.y, pl.color, 90, 0.5);
      this.fx.word(s.x, s.y - 70, `${pl.name.toUpperCase()} IS BACK`, pl.color, 1.4);
      this.emit('revive', { slot: pl.slot });
    }
  }

  // ------------------------------------------------------------------ boss

  /** The game's side of a boss brain's bargain (see bosses.js). */
  bossApi() {
    if (this._api) return this._api;
    const A = this.arena;
    const game = this;
    this._api = {
      // The robot it is after: the one robot alone, or with a team the nearest, looked for again every few seconds.
      get bot() {
        return game.bossTarget();
      },
      get charges() {
        return game.charges;
      },
      world: this.world,
      wells: this.world.wells.filter((w) => w.x > A.x0 && w.x < A.x1 && w.y > A.top && w.y < A.floor),
      fx: this.fx,
      shot: (x, y, a, speed, o) => this.shot(x, y, a, speed, o),
      spawn: (spec) => {
        const e = new Enemy(spec, this.nextEnemy++);
        e.awake = true;
        e.bossMinion = true;
        this.enemies.push(e);
        this.fx.ring(e.x, e.y, e.color, 50, 0.4);
        return e;
      },
      hazard: (h) => {
        if (h.id) {
          const i = this.hazards.findIndex((z) => z.id === h.id);
          if (i >= 0) {
            this.hazards[i] = { ...this.hazards[i], ...h, age: this.hazards[i].age };
            return;
          }
        }
        this.hazards.push({ age: 0, ...h });
      },
      addWell: (spec) => {
        const w = makeWell(spec);
        this.world.wells.push(w);
        return w;
      },
      removeWell: (w) => {
        this.world.wells = this.world.wells.filter((x) => x !== w);
      },
      ring: (x, y, o) => {
        this.world.pulsers.push(new OneRing(x, y, o, this.ringId++));
        this.emit('pulse');
      },
      sound: (s) => this.emit(s),
      enemyCount: () => this.enemies.filter((e) => e.bossMinion && !e.dead).length,
      bossPortalSpots: () => this.bossPortalSpots(),
      bossPortals: (a, b) => this.bossPortals(a, b),
    };
    return this._api;
  }

  /** Places on the arena's walls and roof where a boss may open its own wormholes. */
  bossPortalSpots() {
    const A = this.arena;
    const spots = [
      { x: A.x0, y: A.top + 170, nx: 1, ny: 0 },
      { x: A.x1, y: A.top + 170, nx: -1, ny: 0 },
      { x: A.x1, y: A.floor - 110, nx: -1, ny: 0 },
      { x: A.cx - 360, y: A.top, nx: 0, ny: 1 },
      { x: A.cx + 360, y: A.top, nx: 0, ny: 1 },
    ];
    const out = [];
    for (const s of spots) {
      const segs = segmentsNear(this.world, s.x - 4, s.y - 4, s.x + 4, s.y + 4, { oneWay: false, movers: false });
      const seg = segs.find((g) => Math.abs(g.nx - s.nx) < 0.01 && Math.abs(g.ny - s.ny) < 0.01 && !g.broken);
      if (seg) out.push({ ...s, seg });
    }
    return out;
  }

  bossPortals(a, b) {
    const make = (s, which) => ({ owner: 'boss', which, key: `boss${which}`, hw: PORTAL.halfWidth, cx: s.x, cy: s.y, nx: s.nx, ny: s.ny, host: { kind: 'wall', seg: s.seg } });
    this.world.portals.boss = [make(a, 0), make(b, 1)];
    this.fx.ring(a.x, a.y, this.boss.color, 70, 0.4);
    this.fx.ring(b.x, b.y, this.boss.color, 70, 0.4);
  }

  stepBoss(dt) {
    const A = this.arena;
    if (!A) return;
    const inArena = (bot) => bot.x > A.x0 + 70 && bot.y > A.top && bot.y < A.floor;
    if (this.phase === 'play' && this.live().some(({ bot }) => inArena(bot))) {
      // The door closes behind you, and the music doubles. Every wormhole closes too: the fight starts clean.
      setGate(this.gate, true);
      this.closeAllEnds();
      this.phase = 'intro';
      this.phaseT = 0;
      this.boss = new Boss(A.boss, A);
      this.bossCheckpoint();
      // A team goes in together: anyone still outside is brought in by the door, and anyone out comes back.
      const door = { x: A.x0 + 130, y: A.floor - ROBOT.half - ROBOT.r - 0.5 };
      for (const pl of this.live()) {
        if (inArena(pl.bot)) continue;
        const s = this.besideSpot(door, pl.slot);
        pl.bot.spawn(s.x, s.y);
        this.faceAway(pl.bot);
        pl.bot.invuln = Math.max(pl.bot.invuln, 1);
        this.fx.ring(s.x, s.y, pl.color, 80, 0.5);
      }
      this.revive(door);
      this.emit('bossIntro', { name: this.boss.name });
      return;
    }
    if (this.phase === 'intro') {
      if (this.phaseT >= BOSS_INTRO) {
        this.phase = 'boss';
        this.phaseT = 0;
        this.emit('bossStart');
      }
      return;
    }
    if (this.phase === 'boss') {
      const b = this.boss;
      b.update(this.bossApi(), dt);
      for (const pl of this.players) {
        const bot = pl.bot;
        if (pl.out || bot.invuln > 0) continue;
        for (const p of b.parts) {
          let hit = null;
          if (p.type === 'plate') {
            const s = p.seg;
            for (let k = 0; k <= 4 && !hit; k++) {
              const px = s.ax + ((s.bx - s.ax) * k) / 4;
              const py = s.ay + ((s.by - s.ay) * k) / 4;
              if (circleVsCapsule(px, py, p.thick, bot.x, bot.y - bot.half, bot.x, bot.y + bot.half, bot.r)) hit = { x: px, y: py };
            }
          } else if (circleVsCapsule(p.x, p.y, p.r, bot.x, bot.y - bot.half, bot.x, bot.y + bot.half, bot.r)) hit = { x: p.x, y: p.y };
          if (hit) {
            this.hurt('boss', hit, false, pl);
            break;
          }
        }
      }
      return;
    }
    if (this.phase === 'bossDown' && this.phaseT > 2.4) {
      this.phase = 'exit';
      this.phaseT = 0;
      setGate(this.gate, false);
      delete this.world.portals.boss;
      this.exit = this.exitSpot();
      this.fx.ring(this.exit.x, this.exit.y, '#ffffff', 140, 0.8);
      this.emit('exitOpen');
    }
  }

  /**
   * Where the exit opens: on the arena floor, as near the middle as the room
   * allows, and never inside anything (an arena can have its own rock there,
   * as the Keeper's does): the first place from the middle outward, the door
   * side first, where the robot fits standing on the floor.
   */
  exitSpot() {
    const A = this.arena;
    const fits = (x) => {
      const y = A.floor - ROBOT.half - ROBOT.r - 0.5;
      const segs = segmentsNear(this.world, x - 60, y - 60, x + 60, A.floor + 4, { oneWay: false, movers: false });
      const clear = !segs.some((s) => {
        // The beacon is wider than the robot: a body 30 px bigger all round, still resting on the floor, must fit.
        const cy = y - 30;
        const h = capsuleVsCapsule(x, cy - ROBOT.half, x, cy + ROBOT.half, ROBOT.r + 30, s.ax, s.ay, s.bx, s.by, s.thick || 0, x, cy);
        return h && h.depth > 1;
      });
      const floor = raycastSegments(x, y, 0, 1, segs, ROBOT.half + ROBOT.r + 4);
      return clear && floor && floor.seg.ny < -0.6;
    };
    for (let d = 0; d < A.w / 2 - 80; d += 20) {
      for (const x of [A.cx - d, A.cx + d]) if (fits(x)) return { x, y: A.floor - 50 };
    }
    return { x: A.x0 + 200, y: A.floor - 50 };
  }

  /** Reaching the boss counts as a checkpoint, so a continue starts the fight over rather than the level. */
  bossCheckpoint() {
    const idx = this.checkpoints.findIndex((c) => c.boss);
    if (idx < 0) return;
    this.checkpoints[idx].on = true;
    this.checkpoint = Math.max(this.checkpoint, idx);
  }

  // --------------------------------------------------------------- hazards

  stepHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.age += dt;
      if (h.ttl != null && h.age > h.ttl && !h.id) {
        this.hazards.splice(i, 1);
        continue;
      }
      if (h.id && h.ttl != null) {
        h.ttl -= dt;
        if (h.ttl <= 0) {
          this.hazards.splice(i, 1);
          continue;
        }
      }
      if (h.type === 'column') {
        const live = h.age > h.warn;
        h.live = live;
        const rise = live ? Math.min(1, (h.age - h.warn) / 0.18) : 0;
        const top = h.y1 - (h.y1 - h.y0) * rise;
        for (const pl of this.players) {
          const bot = pl.bot;
          if (pl.out || bot.invuln > 0) continue;
          if (live && Math.abs(bot.x - h.x) < h.w / 2 + bot.r && bot.bottom > top && bot.top < h.y1) this.hurt('hazard', { x: h.x, y: bot.y }, false, pl);
        }
      } else if (h.type === 'beam' && h.live) {
        const dx = Math.cos(h.angle);
        const dy = Math.sin(h.angle);
        const segs = segmentsNear(this.world, Math.min(h.x, h.x + dx * 1600), Math.min(h.y, h.y + dy * 1600), Math.max(h.x, h.x + dx * 1600), Math.max(h.y, h.y + dy * 1600), { oneWay: false });
        const stop = raycastSegments(h.x + dx * 50, h.y + dy * 50, dx, dy, segs, 1600);
        h.len = stop ? stop.t + 50 : 1650;
        const ex = h.x + dx * h.len;
        const ey = h.y + dy * h.len;
        for (const pl of this.players) {
          const bot = pl.bot;
          if (pl.out || bot.invuln > 0) continue;
          const hit = circleVsCapsule(bot.x, bot.y - bot.half, bot.r + h.width / 2, h.x + dx * 50, h.y + dy * 50, ex, ey, 0) || circleVsCapsule(bot.x, bot.y + bot.half, bot.r + h.width / 2, h.x + dx * 50, h.y + dy * 50, ex, ey, 0);
          if (hit) this.hurt('beam', { x: bot.x, y: bot.y }, false, pl);
        }
      }
    }
    for (const l of this.world.lasers) {
      if (!l.on) continue;
      for (const pl of this.players) {
        const bot = pl.bot;
        if (pl.out || bot.invuln > 0) continue;
        const hit = l.dir === 'v' ? Math.abs(bot.x - l.x) < bot.r + 4 && bot.bottom > l.y0 && bot.top < l.y1 : Math.abs(bot.y - l.y) < bot.half + bot.r && bot.x + bot.r > l.x0 && bot.x - bot.r < l.x1;
        if (hit) this.hurt('laser', { x: bot.x, y: bot.y }, false, pl);
      }
    }
  }

  // ----------------------------------------------------------------- harm

  /**
   * Something got a player's robot. It costs a shield (`amount` of them)
   * unless it is still flickering from the last one; a fall, the well or a
   * crush also puts it back on the last solid ground it stood on (in versus,
   * at the spawn furthest from everyone else). With no shields left it is
   * out: alone, the level is lost.
   */
  hurt(reason, p, respawn = false, pl = this.me, amount = 1) {
    const bot = pl.bot;
    if (this.ended() || pl.out) return;
    const shielded = bot.invuln > 0;
    if (shielded && !respawn) return;
    if (!shielded) {
      if (pl.pool !== Infinity) pl.pool = Math.max(0, pl.pool - amount);
      this.stats.shieldsLost++;
      pl.stats.shieldsLost++;
      if (reason === 'fell' || reason === 'well') pl.stats.falls++;
      this.fx.kick(12);
      if (pl === this.me) this.fx.blink('#ff5c7a', 0.45);
      this.fx.explode(bot.x, bot.y, 10, [pl.color, '#ffffff']);
      this.emit('hurt', { reason, slot: pl.slot });
    }
    if (pl.pool <= 0) {
      this.knockOut(pl, reason);
      return;
    }
    bot.invuln = ROBOT.invuln;
    if (respawn) {
      const aim = bot.aim;
      const safe = this.mode === 'versus' ? this.spawnSpot(pl) : this.returnSpot(pl);
      bot.spawn(safe.x, safe.y);
      // Back at a versus spawn it is put down fresh; back on the ground it fell from, it keeps its aim.
      if (this.mode === 'versus') this.faceAway(bot);
      else bot.aim = aim;
      bot.invuln = ROBOT.invuln;
      pl.frozen = 0;
      this.fx.ring(safe.x, safe.y, pl.color, 80, 0.5);
    } else {
      const away = p ? Math.sign(bot.x - p.x) || -bot.facing : -bot.facing;
      bot.vx = away * ROBOT.knock;
      bot.vy = -420;
      bot.onGround = false;
      bot.rising = false;
    }
  }

  /**
   * A player's last shield is gone. Alone, that is the level lost. In co-op
   * they are out until a teammate reaches a checkpoint or the boss, and the
   * level is lost only when the whole team is out; in versus they are out
   * of the match, and the last one standing wins it.
   */
  knockOut(pl, reason) {
    const bot = pl.bot;
    this.fx.explode(bot.x, bot.y, 30, [pl.color, '#ffb347', '#ffffff']);
    if (this.mode === 'solo') {
      this.phase = 'down';
      this.phaseT = 0;
      this.stats.time = this.time;
      this.emit('down', { reason });
      return;
    }
    pl.out = true;
    pl.frozen = 0;
    this.closeEnd(null, pl);
    for (const c of this.charges) if (c.owner === pl.slot) c.dead = true;
    this.charges = this.charges.filter((c) => !c.dead);
    this.fx.word(bot.x, bot.top - 30, `${pl.name.toUpperCase()} IS OUT`, pl.color, 1.6);
    this.emit('out', { slot: pl.slot, reason });
    const live = this.live();
    if (this.mode === 'coop' && !live.length) {
      this.phase = 'down';
      this.phaseT = 0;
      this.stats.time = this.time;
      this.emit('down', { reason });
    } else if (this.mode === 'versus' && live.length <= 1) {
      this.phase = 'over';
      this.phaseT = 0;
      this.winner = live.length ? live[0].slot : null;
      this.stats.time = this.time;
      this.emit('over', { winner: this.winner });
    }
  }

  /**
   * Where a fall puts the robot back: the last safe spot it stood on, if there
   * is still firm ground under it; if not (the ground broke, or was never
   * meant to last), the last checkpoint. Never back over the pit.
   */
  returnSpot(pl = this.me) {
    const bot = pl.bot;
    const s = bot.safe;
    const reach = bot.half + bot.r + 8;
    const segs = segmentsNear(this.world, s.x - bot.r, s.y, s.x + bot.r, s.y + reach, { movers: false }).filter(firmGround);
    if (raycastSegments(s.x, s.y, 0, 1, segs, reach)) return { x: s.x, y: s.y };
    const c = this.checkpoint >= 0 ? this.checkpoints[this.checkpoint] : this.bp.spawn;
    return this.besideSpot(c, pl.slot);
  }

  // ---------------------------------------------------------------- versus

  /** Versus: the spawn furthest from every other robot still in (a fall, or the start). */
  spawnSpot(pl) {
    const others = this.players.filter((q) => q !== pl && !q.out);
    let best = this.bp.spawns[0];
    let far = -1;
    for (const s of this.bp.spawns) {
      const d = others.length ? Math.min(...others.map((q) => Math.hypot(q.bot.x - s.x, q.bot.y - s.y))) : 0;
      if (d > far) {
        far = d;
        best = s;
      }
    }
    return best;
  }

  /** Seconds until the next power-up: anywhere from VERSUS.powerMin to powerMax. */
  powerDelay() {
    return this.time + VERSUS.powerMin + this.rng() * (VERSUS.powerMax - VERSUS.powerMin);
  }

  /**
   * How fair a spot is for a power-up: the nearest robot's distance over the
   * next nearest's (1 is dead level, 0 is on top of someone). Needs two
   * robots still in; with one, anywhere is fair.
   */
  fairness(x, y) {
    const d = this.live()
      .map((p) => Math.hypot(p.bot.x - x, p.bot.y - y))
      .sort((a, b) => a - b);
    if (d.length < 2) return 1;
    return d[1] > 0 ? d[0] / d[1] : 1;
  }

  /**
   * Where the next power-up goes: a random one of the map's platform spots
   * where the nearest robot is no nearer than half as far as the next
   * nearest (VERSUS.fair), and not on top of one already lying there. If no
   * spot is fair (everyone bunched round one end), the fairest there is.
   */
  powerSpot() {
    const spots = (this.bp.spots || []).filter((s) => !this.pickups.some((p) => !p.taken && Math.hypot(p.x - s.x, p.y - s.y) < 80));
    if (!spots.length) return null;
    const fair = spots.filter((s) => this.fairness(s.x, s.y) >= VERSUS.fair);
    if (fair.length) return fair[Math.floor(this.rng() * fair.length)];
    return spots.reduce((a, b) => (this.fairness(b.x, b.y) > this.fairness(a.x, a.y) ? b : a));
  }

  /** Versus: the countdown, and a power-up now and then on a fair platform. */
  stepVersus() {
    if (this.phase === 'ready') {
      if (this.phaseT >= VERSUS.ready) {
        this.phase = 'play';
        this.phaseT = 0;
        this.emit('go');
      }
      return;
    }
    if (this.time < this.nextPower) return;
    this.nextPower = this.powerDelay();
    if (this.pickups.filter((p) => !p.taken).length >= VERSUS.powerCap) return;
    const s = this.powerSpot();
    if (!s) return;
    const kind = POWERUPS[Math.floor(this.rng() * POWERUPS.length)].id;
    const pk = this.makePickup(kind, s.x, s.y, null, true);
    this.pickups.push(pk);
    const pu = POWERUPS.find((q) => q.id === kind);
    this.fx.ring(s.x, s.y, pu.color, 90, 0.6);
    this.fx.word(s.x, s.y - 40, pu.name.toUpperCase(), pu.color, 1.2);
    this.emit('spawnPower', { kind });
  }

  /** Everything a HUD needs to know, for this client's own player, and a line for each of the others. */
  hud() {
    const me = this.me;
    return {
      pool: me.pool,
      time: this.time,
      loaded: me.loaded,
      ammo: me.ammo,
      charges: this.chargesOf(me),
      maxCharges: BLASTER.maxAlive,
      boss: this.boss && (this.phase === 'boss' || this.phase === 'intro') ? { name: this.boss.name, hp: this.boss.hp, max: this.boss.maxHp } : null,
      phase: this.phase,
      secrets: this.stats.secrets,
      secretsTotal: this.stats.secretsTotal,
      mode: this.mode,
      out: me.out,
      frozen: me.frozen,
      team: this.players.map((p) => ({ slot: p.slot, name: p.name, pool: p.pool, out: p.out, color: p.color, hits: p.stats.hits })),
    };
  }
}
