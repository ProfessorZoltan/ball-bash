// One level being played, or one versus match: the robots, their blasters and
// wormholes, the enemies, the boss, the pickups and the clockwork, advanced
// one physics step at a time. It never touches the page: main.js feeds it
// intents and plays what it says happened (Game.events) as sound and light.
// The tests and the tools run it headless.
//
// Alone, there is one robot. In co-op two or three robots cross a level
// together, each on its own shields; in versus they meet in an arena
// (maps.js), every robot for itself. Every robot has its own blaster and its
// own pair of wormhole ends, and anything can go through anyone's ends.
import { BLASTER, POWER, POWERUPS, PICKS, ROBOT, MOVE, PICKUP, WORM, BOSS_INTRO, PLAYERS, COOP, VERSUS } from './config.js';
import { Robot, stepRobot } from './player.js';
import { makeCharge, stepCharge } from './blaster.js';
import { sightLine, placeEnd, refreshEnd, ejectFrom } from './wormholes.js';
import { Enemy, stepEnemy, chargeMeets, freeze } from './enemies.js';
import { makeBoss } from './bosses.js';
import { add, sub, scale, norm, dot, len, dist, madd, lookDir, camBasis, rotAxis, reflect, clamp } from './math.js';

/** The first robot's ends: light and dark. Each player's are in PLAYERS. */
export const END_COLORS = PLAYERS[0].ends;

/** A robot with nothing pressed. */
export const IDLE = Object.freeze({});

/** One player: their robot, and everything that is theirs alone. */
export class Player {
  constructor(slot, at, o = {}) {
    this.slot = slot;
    this.bot = new Robot(at.p, at.yaw);
    this.bot.slot = slot;
    this.name = o.name || PLAYERS[slot].name;
    this.color = PLAYERS[slot].color;
    this.maxShields = o.maxShields ?? 5;
    this.shields = o.shields ?? this.maxShields;
    this.ammo = { ...Object.fromEntries(POWERUPS.map((p) => [p.id, 0])), ...(o.ammo || {}) };
    this.loaded = o.loaded && (o.loaded === 'std' || this.ammo[o.loaded] > 0) ? o.loaded : 'std';
    this.cooldown = 0;
    this.wantFire = false;
    this.flash = 0; // the blaster's kick, a moment after each shot
    this.ends = [null, null];
    this.out = false; // no shields left: out until a teammate brings them back (co-op), or for the match (versus)
    this.stats = { shots: 0, kills: 0, lost: 0, hits: 0, falls: 0, powerups: 0 };
  }
}

export class Game {
  /**
   * `bp` is a built level (levels.js), or an arena (maps.js) for versus.
   * opts: mode ('solo', 'coop' or 'versus'), players (how many, or a list of
   * { name }), local (the slot this client plays, whose robot `bot` is),
   * shields and maxShields (each robot's), checkpoint (an index to start
   * from), ammo and loaded (the first robot's power-ups, kept over a
   * continue; `kit` gives each robot theirs), stats, invulnerable (the
   * tools), noWaves, rng.
   */
  constructor(bp, opts = {}) {
    this.bp = bp;
    this.mode = opts.mode || 'solo';
    this.world = bp.world;
    this.time = 0;
    this.phaseT = 0;
    this.events = [];
    this.rng = opts.rng || Math.random;
    this.state = 'play'; // play, down, cleared, over (versus)
    this.checkpoint = opts.checkpoint ?? -1;
    if (!(this.checkpoint < (bp.checkpoints || []).length)) this.checkpoint = -1;
    this.stats = opts.stats || { shots: 0, kills: 0, secrets: 0, lost: 0, time: 0 };
    this.invulnerable = !!opts.invulnerable;
    // Every solid the level was built with has a number, the same on every
    // machine that builds it: how a snapshot names what a robot stands on.
    this.world.solids.forEach((s, i) => {
      if (s.nid == null) s.nid = i;
    });
    const start = this.checkpoint >= 0 ? bp.checkpoints[this.checkpoint] : bp.spawn;
    const roster = Array.isArray(opts.players) ? opts.players : Array.from({ length: opts.players || 1 }, () => ({}));
    this.players = roster.map((r, slot) => {
      const kit = (opts.kit && opts.kit[slot]) || (slot === 0 ? { ammo: opts.ammo, loaded: opts.loaded } : {});
      const at = this.mode === 'versus' ? bp.spawns[slot % bp.spawns.length] : this.besideSpot(start, slot);
      return new Player(slot, at, { name: r.name, shields: opts.shields, maxShields: opts.maxShields, ammo: kit.ammo, loaded: kit.loaded });
    });
    this.local = Math.min(opts.local ?? 0, this.players.length - 1);
    this.charges = [];
    this.shots = [];
    // Enemies are numbered in the order the level lists them, and those that come later (a wave, a boss's
    // helpers) from 10000, so a host and its guests call every enemy by the same number.
    this.enemies = (bp.enemies || []).map((s, i) => {
      const e = new Enemy(s);
      e.id = i + 1;
      return e;
    });
    this.nextEnemy = 10000;
    this.pickups = (bp.pickups || []).map((p, i) => ({ ...p, id: i, taken: false, pos: [...p.p] }));
    this.pickupId = 1000;
    this.found = new Set(); // the secrets taken, each once
    this.ambushes = (bp.ambushes || []).map((a) => ({ ...a, state: 'wait', wave: -1 }));
    this.noWaves = !!opts.noWaves;
    this.boss = null;
    this.bossIntro = 0;
    this.bossEye = null; // the player the boss is watching, and until when
    this.bossEyeUntil = 0;
    this.phase = this.mode === 'versus' ? 'ready' : 'level'; // level, boss, exit; ready and fight in versus
    this.winner = null; // versus: the slot left standing (null for a draw)
    this.nextPower = this.mode === 'versus' ? this.powerDelay() : Infinity;
    this.sign = null;
    this.say = null; // a line being spoken: { who, text, t }
    this.said = new Set();
    this.lastHurt = -9;
    this.warps = 0;
    // A level that starts at a checkpoint past some doors has them open.
    for (const s of this.world.solids) if (s.door && s.door.startOpen) s.door.open = true;
  }

  // The one player a single-player game, the HUD and the camera mean: this client's own.
  get me() {
    return this.players[this.local];
  }
  get bot() {
    return this.me.bot;
  }
  get shields() {
    return this.me.shields;
  }
  set shields(v) {
    this.me.shields = v;
  }
  get maxShields() {
    return this.me.maxShields;
  }
  get ammo() {
    return this.me.ammo;
  }
  get loaded() {
    return this.me.loaded;
  }
  set loaded(v) {
    this.me.loaded = v;
  }
  get cooldown() {
    return this.me.cooldown;
  }
  get flash() {
    return this.me.flash;
  }
  get ends() {
    return this.me.ends;
  }
  get multi() {
    return this.players.length > 1;
  }

  /** Every open end, everyone's: anything can go through any of them. */
  get openEnds() {
    const list = [];
    for (const pl of this.players) for (const e of pl.ends) if (e) list.push(e);
    return list;
  }

  /** The players still in. */
  live() {
    return this.players.filter((p) => !p.out);
  }

  emit(e) {
    this.events.push(e);
  }

  /** Where the robot of `slot` is put down by a spot: side by side across the way it faces, on firm ground. */
  besideSpot(at, slot) {
    const offs = [0, COOP.spread, -COOP.spread];
    const k = offs[slot % offs.length];
    if (!k) return { p: [...at.p], yaw: at.yaw };
    const right = [-Math.cos(at.yaw), 0, Math.sin(at.yaw)];
    const p = madd(at.p, right, k);
    const r = ROBOT.r;
    const floor = this.world.raycast(p, [0, -1, 0], ROBOT.half + r + 1.5);
    const wall = this.world.raycast(at.p, scale(right, Math.sign(k)), Math.abs(k) + r);
    if (floor && floor.n[1] > 0.6 && !wall && this.world.capsuleFree(p, ROBOT.half, r)) return { p, yaw: at.yaw };
    return { p: [...at.p], yaw: at.yaw };
  }

  /** The live player nearest p, and how far; null with nobody in. */
  nearest(p) {
    let best = null;
    for (const pl of this.players) {
      if (pl.out) continue;
      const d = dist(pl.bot.pos, p);
      if (!best || d < best.d) best = { pl, d };
    }
    return best;
  }

  /** The robot the boss is after: the one robot alone; with a team, the nearest, looked for again every so often. */
  get target() {
    if (!this.multi) return this.bot;
    const e = this.bossEye;
    if (e && !e.out && this.time < this.bossEyeUntil) return e.bot;
    const n = this.boss ? this.nearest(this.boss.pos) : null;
    this.bossEye = n ? n.pl : this.me;
    this.bossEyeUntil = this.time + COOP.retarget;
    return this.bossEye.bot;
  }

  // ------------------------------------------------------------------ step

  /**
   * One physics step. `it` is the one player's intent, or a list with one
   * for each player in slot order. An intent: mx, mz, run, jump (held),
   * jumpPress, fire (held), firePress, worm [light, dark] (pressed), cycle,
   * pick, and in multiplayer the look it was made with (yaw, pitch, turns).
   * In a list, a missing intent is a robot with nothing pressed; null holds
   * the robot where it is for this step (a guest whose inputs are late); and
   * a list of intents plays each in turn (a guest catching up).
   */
  step(dt, it = {}) {
    if (this.state !== 'play') return;
    const its = Array.isArray(it) ? it : [it];
    const W = this.world;
    this.time += dt;
    this.phaseT += dt;
    this.stats.time += dt;
    W.step(dt, (s) => this.inDoor(s));
    this.stepEnds();

    this.players.forEach((pl, i) => {
      if (pl.out) return;
      pl.cooldown = Math.max(0, pl.cooldown - dt);
      pl.flash = Math.max(0, pl.flash - dt);
      const pi = its[i] === undefined ? IDLE : its[i];
      if (pi === null) return;
      for (const x of Array.isArray(pi) ? pi : [pi]) if (!pl.out) this.stepPlayer(pl, x || IDLE, dt);
    });

    this.stepCharges(dt);
    this.stepEnemies(dt);
    if (this.boss) this.stepBoss(dt);
    this.stepPickups();
    this.stepHazards();
    this.stepTriggers();
    this.stepAmbushes();
    if (this.mode === 'versus') this.stepVersus();
  }

  /** Is every robot held where it is: a versus countdown? (A Frost charge holds one: bot.frozen.) */
  held() {
    return this.phase === 'ready';
  }

  /** One player's robot for one step: its look, moving, the blaster and the ends. */
  stepPlayer(pl, it, dt) {
    const bot = pl.bot;
    // A guest's look comes with its inputs; one made before the robot last turned (a
    // wormhole, a respawn) is left for the robot's own until the guest has caught up.
    if (it.yaw != null && Number.isFinite(it.yaw) && (it.turns == null || it.turns === bot.turns)) {
      bot.yaw = it.yaw;
      bot.pitch = clamp(it.pitch || 0, -MOVE.lookMax, MOVE.lookMax);
    }
    const held = this.held();
    const ev = stepRobot(bot, held ? IDLE : it, this.world, dt, this.openEnds);
    for (const e of ev) this.onRobot(e, pl);
    if (pl.out) return;
    this.stomps(pl);
    if (held || bot.frozen > 0) return;
    if (it.cycle) this.cycle(it.cycle, pl);
    if (it.pick != null) this.load(PICKS[it.pick], pl);
    if (it.firePress) pl.wantFire = true;
    if ((pl.wantFire || it.fire) && pl.cooldown <= 0) {
      pl.wantFire = false;
      this.fire(pl);
    }
    if (it.worm) {
      if (it.worm[0]) this.openEnd(0, pl);
      if (it.worm[1]) this.openEnd(1, pl);
    }
  }

  /**
   * Ambush rooms: walking in locks both doors, and wave after wave comes;
   * when the last falls, the doors open (and sometimes something drops). A
   * team goes in together: whoever is still outside when the doors shut is
   * brought in beside the one who walked in.
   */
  stepAmbushes() {
    const W = this.world;
    const doors = (a, open) => {
      for (const s of W.solids) if (s.door && a.doors.includes(s.door.id)) s.door.open = open;
    };
    const inside = (a, b) => b.pos[0] >= a.min[0] && b.pos[0] <= a.max[0] && b.pos[1] >= a.min[1] && b.pos[1] <= a.max[1] && b.pos[2] >= a.min[2] && b.pos[2] <= a.max[2];
    for (const a of this.ambushes) {
      if (a.state === 'done') continue;
      if (a.state === 'wait') {
        const pl = this.live().find((p) => inside(a, p.bot));
        if (!pl) continue;
        a.state = 'fight';
        a.wave = -1;
        a.foes = [];
        doors(a, false);
        for (const q of this.live()) {
          if (q === pl || inside(a, q.bot)) continue;
          this.bringTo(q, { p: pl.bot.pos, yaw: pl.bot.yaw });
        }
        this.emit({ s: 'lock', at: [...pl.bot.pos] });
      }
      if (a.state === 'fight') {
        if (a.foes.some((e) => !e.dead)) continue;
        a.wave++;
        const waves = this.noWaves ? [] : a.waves;
        const at = [(a.min[0] + a.max[0]) / 2, a.min[1] + 1, (a.min[2] + a.max[2]) / 2];
        if (a.wave >= waves.length) {
          a.state = 'done';
          doors(a, true);
          if (a.drop) this.dropAt(a.dropAt, a.drop, false, !!a.stash);
          this.emit({ s: 'unlock', at });
          continue;
        }
        a.foes = waves[a.wave].map((spec) => {
          const e = this.addEnemy(new Enemy(spec));
          e.awake = true;
          return e;
        });
        this.emit({ s: 'wave', at });
      }
    }
  }

  /** A new enemy (a wave, a boss's helper), numbered so every machine in a match calls it the same. */
  addEnemy(e) {
    e.id = this.nextEnemy++;
    this.enemies.push(e);
    return e;
  }

  /** Put a player's robot down beside a spot, as the team is brought together. */
  bringTo(pl, at) {
    const s = this.besideSpot(at, pl.slot);
    for (const end of this.openEnds) ejectFrom(end, pl.bot);
    const inv = pl.bot.invuln;
    pl.bot.spawn(s.p, s.yaw);
    pl.bot.invuln = Math.max(inv, 1);
    this.emit({ s: 'brought', slot: pl.slot, at: pl.bot.eyePos() });
  }

  /** Would a door closing now come down on a robot? Then it waits. */
  inDoor(s) {
    const base = s.base[1];
    for (const pl of this.players) {
      if (pl.out) continue;
      const b = pl.bot;
      const r = b.r + 0.05;
      const lo = b.pos[1] - b.half - b.r;
      const hi = b.pos[1] + b.half + b.r;
      if (b.pos[0] > s.min[0] - r && b.pos[0] < s.max[0] + r && b.pos[2] > s.min[2] - r && b.pos[2] < s.max[2] + r && hi > base && lo < s.min[1] + 0.1) return true;
    }
    return false;
  }

  onRobot(e, pl) {
    const bot = pl.bot;
    const slot = pl.slot;
    if (e.s === 'fall') {
      pl.stats.falls++;
      if (this.hurt('fall', pl) !== 'moved') this.putBack(pl);
    } else if (e.s === 'crushed') {
      if (this.hurt('crush', pl) !== 'moved') this.putBack(pl);
    } else if (e.s === 'warp') {
      this.warps++;
      this.emit({ s: 'warp', at: bot.eyePos(), slot });
    } else {
      this.emit({ ...e, slot, at: e.at || bot.eyePos() });
    }
  }

  /** Back on the last firm ground it stood on, or the last checkpoint if that has gone; in versus, a spawn. */
  putBack(pl = this.me) {
    if (this.mode === 'versus') {
      this.respawn(pl);
      return;
    }
    const b = pl.bot;
    let p = b.safe;
    let yaw = b.safeYaw;
    const below = this.world.raycast([p[0], p[1], p[2]], [0, -1, 0], b.half + b.r + 0.4);
    if (!below || !this.world.capsuleFree(p, b.half, b.r)) {
      const c = this.checkpoint >= 0 ? this.bp.checkpoints[this.checkpoint] : this.bp.spawn;
      const s = this.besideSpot(c, pl.slot);
      p = s.p;
      yaw = s.yaw;
    }
    const inv = b.invuln;
    b.spawn(p, yaw);
    b.invuln = Math.max(inv, ROBOT.invuln);
    for (const end of this.openEnds) ejectFrom(end, b);
  }

  /**
   * Something got a player's robot: a shield lost (a Hammer's charge takes
   * two), unless it is still flickering from the last. In versus a lost
   * shield puts it back at the spawn furthest from everyone else. With none
   * left it is out: alone, the level is lost. Returns 'moved' if the robot
   * was put somewhere else (a respawn, or out), so the caller leaves it be.
   */
  hurt(why, pl = this.me, amount = 1) {
    const b = pl.bot;
    if (pl.out || this.state !== 'play') return 'moved';
    if (this.invulnerable || b.invuln > 0) return null;
    pl.shields = Math.max(0, pl.shields - amount);
    this.stats.lost++;
    pl.stats.lost++;
    b.invuln = ROBOT.invuln;
    this.lastHurt = this.time;
    this.emit({ s: 'hurt', why, slot: pl.slot, at: b.eyePos() });
    if (pl.shields <= 0) {
      this.knockOut(pl, why);
      return 'moved';
    }
    if (this.mode === 'versus') {
      this.respawn(pl);
      return 'moved';
    }
    return null;
  }

  /**
   * A player's last shield is gone. Alone, that is the level lost. In co-op
   * they are out until a teammate reaches a checkpoint or the boss, and the
   * level is lost only when the whole team is out; in versus they are out
   * of the match, and the last one standing wins it.
   */
  knockOut(pl, why) {
    this.emit({ s: 'down', why, slot: pl.slot, at: pl.bot.eyePos() });
    if (this.mode === 'solo') {
      this.state = 'down';
      return;
    }
    pl.out = true;
    pl.bot.frozen = 0;
    this.closeEnd(0, pl, true);
    this.closeEnd(1, pl, true);
    this.charges = this.charges.filter((c) => c.owner !== pl.slot);
    this.emit({ s: 'out', slot: pl.slot, name: pl.name });
    const live = this.live();
    if (this.mode === 'coop' && !live.length) {
      this.state = 'down';
    } else if (this.mode === 'versus' && live.length <= 1) {
      this.state = 'over';
      this.winner = live.length ? live[0].slot : null;
      this.emit({ s: 'over', winner: this.winner });
    }
  }

  /** Co-op: a teammate has reached a checkpoint (or the boss), so everyone out comes back there with COOP.revive shields. */
  revive(at) {
    if (this.mode !== 'coop') return;
    for (const pl of this.players) {
      if (!pl.out) continue;
      pl.out = false;
      pl.shields = Math.min(pl.maxShields, COOP.revive);
      const s = this.besideSpot(at, pl.slot);
      pl.bot.spawn(s.p, s.yaw);
      pl.bot.invuln = ROBOT.invuln;
      this.emit({ s: 'revive', slot: pl.slot, name: pl.name, at: pl.bot.eyePos() });
    }
  }

  // --------------------------------------------------------------- blaster

  cycle(dir, pl = this.me) {
    const have = PICKS.filter((k) => k === 'std' || pl.ammo[k] > 0);
    let i = have.indexOf(pl.loaded);
    i = (i + (dir > 0 ? 1 : -1) + have.length) % have.length;
    pl.loaded = have[i];
    this.emit({ s: 'cycle', slot: pl.slot });
  }

  load(k, pl = this.me) {
    if (!k || (k !== 'std' && !(pl.ammo[k] > 0))) return;
    if (pl.loaded !== k) {
      pl.loaded = k;
      this.emit({ s: 'cycle', slot: pl.slot });
    }
  }

  /** A player's charges in the air. */
  mine(pl = this.me) {
    let n = 0;
    for (const c of this.charges) if (c.owner === pl.slot) n++;
    return n;
  }

  /** Where a shot leaves: just ahead of the eye, never inside a wall that close. */
  muzzle(dir, pl = this.me) {
    const eye = pl.bot.eyePos();
    const h = this.world.raycast(eye, dir, BLASTER.muzzle + BLASTER.radius * 3);
    const d = h ? Math.max(0.05, h.t - BLASTER.radius * 1.5) : BLASTER.muzzle;
    return madd(eye, dir, d);
  }

  fire(pl = this.me) {
    const b = pl.bot;
    const kind = pl.loaded;
    const n = kind === 'triple' ? 3 : 1;
    if (this.mine(pl) + n > BLASTER.maxAlive) {
      this.emit({ s: 'dry', slot: pl.slot });
      pl.cooldown = 0.12;
      return false;
    }
    const dir = lookDir(b.yaw, b.pitch);
    const up = camBasis(b.yaw, b.pitch).up;
    const dirs = n === 1 ? [dir] : [-1, 0, 1].map((k) => rotAxis(dir, up, k * POWER.tripleSpread));
    // With more than one robot about, a standard charge is its owner's colour.
    const color = kind === 'std' && this.multi ? PLAYERS[pl.slot].charge : undefined;
    for (const d of dirs) {
      const c = makeCharge(this.muzzle(d, pl), d, kind, pl.slot, { color });
      this.charges.push(c);
    }
    if (kind !== 'std') {
      pl.ammo[kind]--;
      if (pl.ammo[kind] <= 0) {
        pl.loaded = 'std';
        this.emit({ s: 'empty', slot: pl.slot });
      }
    }
    pl.cooldown = BLASTER.cooldown;
    pl.flash = 0.06;
    this.stats.shots++;
    pl.stats.shots++;
    this.emit({ s: 'fire', kind, slot: pl.slot, at: b.eyePos() });
    return true;
  }

  /** Aim one of a player's ends along their line of sight and open it where it lands. */
  openEnd(which, pl = this.me) {
    const b = pl.bot;
    const look = lookDir(b.yaw, b.pitch);
    const eye = b.eyePos();
    const sl = sightLine(this.world, eye, look);
    const twin = pl.ends[1 - which];
    const { end, why } = placeEnd(this.world, sl.hit, look, twin, eye);
    if (!end) {
      this.emit({ s: 'fizzle', why, at: sl.hit ? sl.hit.p : null, slot: pl.slot });
      return null;
    }
    const old = pl.ends[which];
    if (old) for (const q of this.players) ejectFrom(old, q.bot);
    end.which = which;
    end.owner = pl.slot;
    end.color = PLAYERS[pl.slot].ends[which];
    pl.ends[which] = end;
    this.link(pl);
    this.emit({ s: 'portal', which, at: end.c, slot: pl.slot });
    return end;
  }

  /** Close one of a player's ends (a boss's door shutting, its host gone, the player out). */
  closeEnd(which, pl = this.me, quiet = false) {
    const e = pl.ends[which];
    if (!e) return;
    for (const q of this.players) ejectFrom(e, q.bot);
    pl.ends[which] = null;
    this.link(pl);
    if (!quiet) this.emit({ s: 'unportal', which, at: e.c, slot: pl.slot });
  }

  link(pl) {
    const [a, b] = pl.ends;
    if (a) a.twin = b || null;
    if (b) b.twin = a || null;
  }

  stepEnds() {
    for (const pl of this.players) {
      for (let i = 0; i < 2; i++) {
        const e = pl.ends[i];
        if (!e) continue;
        if (!refreshEnd(e)) {
          this.closeEnd(i, pl);
          continue;
        }
        const d = dist(e.c, pl.bot.pos);
        if (d < 30) e.near = true;
        // An end left far behind closes, once its robot has been near it.
        if (e.near && d > WORM.leftBehind) this.closeEnd(i, pl);
      }
    }
  }

  // --------------------------------------------------------------- charges

  stepCharges(dt) {
    const W = this.world;
    const ends = this.openEnds;
    const hitSolid = (s, n, c) => {
      if (s.crate || s.cover) {
        this.damageBlock(s, c);
        return c.kind === 'big' && s.gone ? null : 'stop';
      }
      if (s.switchRef) {
        this.flip(s.switchRef);
        return 'stop';
      }
      if (s.stopsCharges) return 'stop';
      return null;
    };
    for (const c of this.charges) {
      const ev = stepCharge(c, W, ends, dt, hitSolid);
      for (const e of ev) {
        if (e.s === 'ricochet') {
          if (c.bounces < 30) this.emit({ s: 'ricochet', at: e.at, speed: e.speed, n: e.n });
          if (this.boss) this.boss.onRicochet?.(c, e, this);
        } else if (e.s === 'warp') this.emit({ s: 'warp', at: e.at });
        else if (e.s === 'swallow') this.emit({ s: 'swallow', at: e.at });
        else if (e.s === 'stopped') this.emit({ s: 'spark', at: e.at, n: e.n, color: c.color });
      }
      if (c.dead) continue;
      // Enemies and the boss.
      for (const en of this.enemies) {
        if (!en.awake || en.dead) continue;
        const m = chargeMeets(en, c);
        if (!m) continue;
        if (m === 'shield') {
          const n = norm(sub(c.pos, en.pos));
          c.vel = reflect(c.vel, n);
          c.pos = madd(en.pos, n, en.r + c.r + 0.02);
          this.emit({ s: 'deflect', at: [...c.pos] });
          continue;
        }
        this.hitEnemy(en, c);
        if (c.kind !== 'big' || !en.dead) {
          c.dead = true;
          break;
        }
      }
      if (!c.dead && this.boss && !this.boss.dead && this.bossIntro <= 0) {
        const r = this.boss.hitBy(c, this);
        if (r) {
          this.onBossHit(r, c);
        }
      }
      if (!c.dead && this.mode === 'versus') this.chargeVsRobots(c);
    }
    // Enemies' shots: the robots' charges knock them out of the air, and they cost a robot a shield.
    for (const s of this.shots) {
      const ev = stepCharge(s, W, ends, dt, (so) => (so.crate || so.cover || so.switchRef ? 'stop' : null));
      for (const e of ev) if (e.s === 'warp') this.emit({ s: 'warp', at: e.at });
      if (s.dead) continue;
      if (s.bounceLimit != null && s.bounces > s.bounceLimit) {
        s.dead = true;
        continue;
      }
      for (const c of this.charges) {
        if (!c.dead && dist(c.pos, s.pos) < c.r + s.r) {
          s.dead = true;
          if (c.kind !== 'big') c.dead = true;
          this.emit({ s: 'pop', at: [...s.pos], small: true });
          break;
        }
      }
      if (s.dead) continue;
      for (const pl of this.players) {
        if (pl.out || !this.touchesRobot(pl.bot, s.pos, s.r)) continue;
        s.dead = true;
        if (this.hurt('shot', pl) !== 'moved') this.knock(sub(pl.bot.pos, s.pos), pl);
        break;
      }
    }
    this.charges = this.charges.filter((c) => !c.dead);
    this.shots = this.shots.filter((c) => !c.dead);
  }

  /**
   * Versus: another robot's charge. It costs a shield (a Hammer's two) and
   * puts the robot back at a spawn; a Frost charge holds it fast instead.
   * A robot flickering from its last hit lets anything through. Your own
   * charges never hurt you.
   */
  chargeVsRobots(c) {
    if (this.phase === 'ready') return;
    for (const pl of this.players) {
      if (pl.out || pl.slot === c.owner || pl.bot.invuln > 0) continue;
      if (!this.touchesRobot(pl.bot, c.pos, c.r)) continue;
      const by = this.players[c.owner];
      if (by) by.stats.hits++;
      if (c.kind === 'freeze') {
        pl.bot.frozen = VERSUS.frozen;
        pl.bot.vel = [0, Math.min(0, pl.bot.vel[1]), 0];
        this.emit({ s: 'freeze', at: [...c.pos], slot: pl.slot });
      } else {
        this.emit({ s: 'hitRobot', at: [...c.pos], slot: pl.slot, by: c.owner });
        this.hurt('shot', pl, c.kind === 'strong' ? VERSUS.hammer : 1);
      }
      if (c.kind !== 'big') {
        c.dead = true;
        return;
      }
    }
  }

  /** Does a ball at p of radius r touch a robot's body? */
  touchesRobot(b, p, r) {
    const y = clamp(p[1], b.pos[1] - b.half, b.pos[1] + b.half);
    return Math.hypot(p[0] - b.pos[0], p[1] - y, p[2] - b.pos[2]) < r + b.r;
  }

  /** Does a ball touch this client's own robot? (What the tools ask.) */
  touchesBot(p, r) {
    return this.touchesRobot(this.bot, p, r);
  }

  knock(dir, pl = this.me) {
    const b = pl.bot;
    if (this.invulnerable) return;
    const d = norm([dir[0], 0, dir[2]]);
    b.vel = madd(b.vel, d, ROBOT.knock * 0.5);
    b.vel[1] = Math.max(b.vel[1], 3);
  }

  damageBlock(s, c) {
    s.hp = (s.hp ?? 3) - c.damage * (c.kind === 'big' ? 3 : 1);
    if (s.hp <= 0) {
      this.world.remove(s);
      this.emit({ s: 'crate', at: centre(s), cover: !!s.cover, nid: s.nid });
      if (s.drop) this.dropAt(centre(s), s.drop, s.secret ? `c${s.nid}` : false);
      if (s.cover && s.secret) this.emit({ s: 'secretOpen', at: centre(s) });
    } else this.emit({ s: s.secret ? 'hollow' : 'thunk', at: [...c.pos] }); // a secret sounds hollow: there is room behind it
  }

  /** Something drops: alone, one pickup; in co-op, one for each robot still in, only theirs to take. */
  dropAt(p, kind, secret = false, stash = false) {
    const owners = this.mode === 'coop' ? this.live().map((pl) => pl.slot) : [null];
    // A secret's prize dropped for each robot is still one secret (its key, the same on every play), found by whoever takes theirs first.
    const key = secret || false;
    owners.forEach((owner, i) => {
      const at = owners.length > 1 ? [p[0] + (i - (owners.length - 1) / 2) * 0.9, p[1], p[2]] : [...p];
      const plain = kind === 'shield' || kind === 'cell';
      this.pickups.push({ id: this.pickupId++, kind: plain ? kind : 'power', power: plain ? null : kind, p: [...at], pos: [...at], taken: false, dropped: true, vy: 4, owner, secret: key, stash: !plain && stash });
    });
  }

  flip(sw) {
    if (sw.on && !sw.timer) return;
    // A switch far from every robot takes no charge: a stray shot down a long hall never opens a door you have not reached.
    if (!this.live().some((pl) => dist(sw.p, pl.bot.pos) <= 70)) return;
    const moved = this.world.setSwitch(sw, true);
    this.emit({ s: 'switch', at: sw.p });
    if (moved) this.emit({ s: 'door', at: sw.p });
    // The last of a group of hidden targets: somewhere, a wall opens.
    if (moved && sw.group != null) this.emit({ s: 'secretOpen', at: sw.p });
  }

  hitEnemy(en, c) {
    if (c.kind === 'freeze') {
      freeze(en, this.world);
      this.emit({ s: 'freeze', at: [...en.pos] });
      return;
    }
    en.hp -= c.damage;
    en.flash = 0.12;
    if (en.hp <= 0) this.killEnemy(en, c.owner);
    else this.emit({ s: 'hit', at: [...en.pos] });
  }

  killEnemy(en, by = null) {
    en.dead = true;
    if (en.ice) {
      this.world.remove(en.ice);
      en.ice = null;
    }
    this.stats.kills++;
    const pl = by != null && this.players[by];
    if (pl) pl.stats.kills++;
    this.emit({ s: 'pop', at: [...en.pos], big: en.r > 0.8, r: en.r, look: en.look, color: en.color });
    if (en.drops) this.dropAt(en.pos, en.drops);
  }

  // --------------------------------------------------------------- enemies

  stepEnemies(dt) {
    const live = this.live();
    if (!live.length) return;
    for (const en of this.enemies) {
      if (en.dead) continue;
      // Each goes after the robot nearest it, and wakes and sleeps by that one.
      const near = live.length === 1 ? live[0] : this.nearest(en.pos).pl;
      const ev = stepEnemy(en, this.world, near.bot, this.openEnds, dt, this.shots);
      for (const e of ev) this.emit(e);
      if (en.dead || !en.awake || en.frozen > 0) continue;
      // Touching it costs a shield (a stomp is dealt with first).
      for (const pl of live) {
        if (pl.out || !this.touchesRobot(pl.bot, en.pos, en.r * 0.9)) continue;
        if (this.hurt('touch', pl) !== 'moved') this.knock(sub(pl.bot.pos, en.pos), pl);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  /** Landing on an enemy from above ends it and bounces the robot up, if it can be stomped. */
  stomps(pl) {
    const b = pl.bot;
    if (b.vel[1] > -1) return;
    for (const en of this.enemies) {
      if (en.dead || !en.awake || en.frozen > 0) continue;
      const h = Math.hypot(en.pos[0] - b.pos[0], en.pos[2] - b.pos[2]);
      const feet = b.feet;
      if (h < en.r + 0.35 && feet > en.pos[1] && feet - (en.pos[1] + en.r) < 0.25) {
        if (en.stompable) {
          this.killEnemy(en, pl.slot);
          b.vel[1] = MOVE.stomp;
          b.flung = true;
          this.emit({ s: 'stomp', at: [...en.pos], slot: pl.slot });
        }
      }
    }
  }

  // ------------------------------------------------------------------ boss

  /** The fight starts: the door shuts behind the team, anyone outside is brought in, anyone out comes back. */
  startBoss() {
    const A = this.bp.arena;
    if (!A || this.boss) return;
    this.phase = 'boss';
    this.boss = makeBoss(A.boss, A, this);
    this.bossIntro = BOSS_INTRO;
    // The door shuts behind you, and every fight starts without wormholes.
    if (A.door) A.door.door.open = false;
    for (const pl of this.players) {
      this.closeEnd(0, pl, true);
      this.closeEnd(1, pl, true);
    }
    const inArena = (b) => b.pos[0] >= A.min[0] && b.pos[0] <= A.max[0] && b.pos[2] >= A.min[2] && b.pos[2] <= A.max[2] && b.pos[1] > A.floor - 1;
    const door = { p: A.spawn, yaw: A.yaw };
    for (const pl of this.live()) if (!inArena(pl.bot)) this.bringTo(pl, door);
    this.revive(door);
    for (const e of this.enemies) if (e.ice) this.world.remove(e.ice);
    this.enemies = [];
    this.shots = [];
    this.emit({ s: 'bossStart', name: this.boss.name, title: this.boss.title });
    if (this.boss.line) this.speak(this.boss.who || 'machine', this.boss.line, this.boss.speaker);
  }

  stepBoss(dt) {
    const B = this.boss;
    if (this.bossIntro > 0) {
      // Named and shown, but not yet moving: a step of no time poses its parts.
      this.bossIntro -= dt;
      B.step(this, 0);
      return;
    }
    if (B.dead) return;
    const ev = B.step(this, dt) || [];
    for (const e of ev) this.emit(e);
    // The boss's body.
    if (B.dead || !B.touches) return;
    for (const pl of this.live()) {
      if (!B.touches(pl.bot, this)) continue;
      if (this.hurt('boss', pl) !== 'moved') this.knock(sub(pl.bot.pos, B.pos), pl);
    }
  }

  onBossHit(r, c) {
    const B = this.boss;
    if (r === 'core') {
      if (c.kind === 'freeze') {
        B.chill = POWER.bossChill;
        this.emit({ s: 'freeze', at: [...c.pos] });
      } else {
        B.hp -= c.damage;
        B.flash = 0.15;
        this.emit({ s: 'bossHit', at: [...c.pos] });
      }
      if (c.kind !== 'big') c.dead = true;
      if (B.hp <= 0 && !B.dead) {
        B.dead = true;
        B.deadT = 0;
        this.phase = 'exit';
        this.shots = [];
        this.emit({ s: 'bossDown', at: [...B.pos], name: B.name });
        B.onDown?.(this);
        const A = this.bp.arena;
        if (A.exitDoor) A.exitDoor.door.open = true;
        this.emit({ s: 'exitOpen' });
      }
    } else if (r === 'armor') {
      this.emit({ s: 'armor', at: [...c.pos] });
    } else if (r === 'plate') {
      this.emit({ s: 'deflect', at: [...c.pos] });
    }
  }

  speak(who, text, name) {
    this.say = { who, text, name, t: this.time };
    this.emit({ s: 'speak', who, text, name });
  }

  // ------------------------------------------------------- pickups, hazards

  stepPickups() {
    for (const p of this.pickups) {
      if (p.taken) continue;
      if (p.dropped && p.vy !== undefined) {
        // A dropped pickup falls to the floor under it.
        p.vy -= 20 / 120;
        const down = this.world.raycast(p.pos, [0, -1, 0], 2);
        const floor = down ? down.p[1] + PICKUP.r + 0.3 : -Infinity;
        p.pos[1] = Math.max(floor, p.pos[1] + p.vy / 120);
        if (p.pos[1] <= floor) p.vy = 0;
      }
      for (const pl of this.players) {
        if (pl.out || (p.owner != null && p.owner !== pl.slot)) continue;
        const b = pl.bot;
        const d = Math.hypot(p.pos[0] - b.pos[0], (p.pos[1] - b.pos[1]) * 0.6, p.pos[2] - b.pos[2]);
        if (d > PICKUP.reach) continue;
        if (this.take(p, pl)) break;
      }
    }
  }

  /** A player takes a pickup, if it is any use to them. */
  take(p, pl) {
    if (p.kind === 'cell') {
      // A shield cell: one more shield to hold, for the rest of the run, and it comes full.
      if (Number.isFinite(pl.maxShields)) pl.maxShields += 1;
      pl.shields = Math.min(pl.maxShields, pl.shields + 1);
      p.taken = true;
      this.emit({ s: 'cell', at: p.pos, slot: pl.slot });
    } else if (p.kind === 'shield') {
      if (pl.shields >= pl.maxShields && Number.isFinite(pl.maxShields)) return false;
      pl.shields = Math.min(pl.maxShields, pl.shields + 1);
      p.taken = true;
      this.emit({ s: 'shield', at: p.pos, slot: pl.slot });
    } else {
      const k = p.power;
      const had = pl.ammo[k];
      // A stash fills it to the top.
      pl.ammo[k] = p.stash ? POWER.maxAmmo : Math.min(POWER.maxAmmo, pl.ammo[k] + POWER.ammo);
      if (!had && pl.loaded === 'std') pl.loaded = k;
      p.taken = true;
      pl.stats.powerups++;
      this.emit({ s: 'powerup', power: k, at: p.pos, slot: pl.slot });
    }
    // A secret's key is the same every time the level is built: the title keeps which of a level's were found.
    const key = p.secret === true ? `p${p.id}` : p.secret;
    if (key && !this.found.has(key)) {
      this.found.add(key);
      this.stats.secrets++;
      this.emit({ s: 'secret', slot: pl.slot, key });
    }
    return true;
  }

  stepHazards() {
    const W = this.world;
    for (const pl of this.players) {
      if (pl.out) continue;
      const b = pl.bot;
      for (const h of W.hazards) {
        if (h.laser && !h.lit) continue;
        if (h.off) continue;
        const lo = b.pos[1] - b.half - b.r;
        const hi = b.pos[1] + b.half + b.r;
        if (b.pos[0] + b.r < h.min[0] || b.pos[0] - b.r > h.max[0] || b.pos[2] + b.r < h.min[2] || b.pos[2] - b.r > h.max[2] || hi < h.min[1] || lo > h.max[1]) continue;
        // Anything at the bottom of something (a trench's rail, molten metal, water,
        // spikes) puts the robot back on firm ground; a laser gate throws it back.
        if (this.hurt(h.kind, pl) === 'moved') break;
        if (h.laser) this.knock(sub(b.pos, [(h.min[0] + h.max[0]) / 2, b.pos[1], (h.min[2] + h.max[2]) / 2]), pl);
        else this.putBack(pl);
        break;
      }
      if (pl.out) continue;
      if (W.horizon(b.pos, b.r)) {
        pl.stats.falls++;
        if (this.hurt('horizon', pl) !== 'moved') this.putBack(pl);
      }
    }
  }

  stepTriggers() {
    const live = this.live();
    const inBox = (t, b) => b.pos[0] >= t.min[0] && b.pos[0] <= t.max[0] && b.pos[1] >= t.min[1] && b.pos[1] <= t.max[1] && b.pos[2] >= t.min[2] && b.pos[2] <= t.max[2];
    const anyIn = (t) => live.find((pl) => inBox(t, pl.bot));
    (this.bp.checkpoints || []).forEach((c, i) => {
      if (i <= this.checkpoint) return;
      const pl = anyIn(c);
      if (!pl) return;
      this.checkpoint = i;
      this.emit({ s: 'checkpoint', at: c.p, slot: pl.slot });
      this.revive(c);
    });
    const A = this.bp.arena;
    if (A && !this.boss && anyIn(A.trigger)) this.startBoss();
    if (A && this.phase === 'exit' && this.boss && this.boss.dead) {
      const pl = anyIn(A.exit);
      if (pl) {
        this.state = 'cleared';
        this.emit({ s: 'cleared', slot: pl.slot });
      }
    }
    this.updateSign();
    for (const l of this.bp.lines || []) {
      if (this.said.has(l)) continue;
      if (anyIn(l)) {
        this.said.add(l);
        this.speak(l.who, l.text, l.name);
      }
    }
  }

  /** Signs: the nearest within reach of this client's robot is read out on screen. */
  updateSign() {
    this.sign = null;
    const b = this.bot;
    for (const s of this.bp.signs || []) {
      if (Math.hypot(s.p[0] - b.pos[0], s.p[2] - b.pos[2]) < (s.reach || 6) && Math.abs(s.p[1] - b.pos[1]) < 4) this.sign = s;
    }
  }

  // ---------------------------------------------------------------- versus

  /** Versus: back at the spawn furthest from every other robot still in, facing into the room. */
  respawn(pl) {
    const s = this.spawnSpot(pl);
    const inv = pl.bot.invuln;
    for (const end of this.openEnds) ejectFrom(end, pl.bot);
    pl.bot.spawn(s.p, s.yaw);
    pl.bot.invuln = Math.max(inv, ROBOT.invuln);
    this.emit({ s: 'respawn', slot: pl.slot, at: pl.bot.eyePos() });
  }

  spawnSpot(pl) {
    const others = this.players.filter((q) => q !== pl && !q.out);
    let best = this.bp.spawns[0];
    let far = -1;
    for (const s of this.bp.spawns) {
      const d = others.length ? Math.min(...others.map((q) => dist(q.bot.pos, s.p))) : 0;
      if (d > far) {
        far = d;
        best = s;
      }
    }
    return best;
  }

  /** When the next power-up appears: anywhere from VERSUS.powerMin to powerMax seconds on. */
  powerDelay() {
    return this.time + VERSUS.powerMin + this.rng() * (VERSUS.powerMax - VERSUS.powerMin);
  }

  /**
   * How fair a spot is for a power-up: the nearest robot's distance over the
   * next nearest's (1 is dead level, 0 is on top of someone). With one robot
   * in, anywhere is fair.
   */
  fairness(p) {
    const d = this.live()
      .map((pl) => dist(pl.bot.pos, p))
      .sort((a, b) => a - b);
    if (d.length < 2) return 1;
    return d[1] > 0 ? d[0] / d[1] : 1;
  }

  /** A random fair spot for the next power-up, not on one already lying there; the fairest if none is fair. */
  powerSpot() {
    const spots = (this.bp.spots || []).filter((s) => !this.pickups.some((p) => !p.taken && dist(p.pos, s) < 2));
    if (!spots.length) return null;
    const fair = spots.filter((s) => this.fairness(s) >= VERSUS.fair);
    if (fair.length) return fair[Math.floor(this.rng() * fair.length)];
    return spots.reduce((a, b) => (this.fairness(b) > this.fairness(a) ? b : a));
  }

  /** Versus: the countdown, and a power-up now and then on a fair platform. */
  stepVersus() {
    if (this.phase === 'ready') {
      if (this.phaseT >= VERSUS.ready) {
        this.phase = 'fight';
        this.phaseT = 0;
        this.emit({ s: 'go' });
      }
      return;
    }
    if (this.time < this.nextPower) return;
    this.nextPower = this.powerDelay();
    if (this.pickups.filter((p) => !p.taken).length >= VERSUS.powerCap) return;
    const s = this.powerSpot();
    if (!s) return;
    const kind = POWERUPS[Math.floor(this.rng() * POWERUPS.length)].id;
    this.pickups.push({ id: this.pickupId++, kind: 'power', power: kind, p: [...s], pos: [...s], taken: false });
    this.emit({ s: 'spawnPower', power: kind, at: [...s] });
  }
}

function centre(s) {
  return [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
}

export { dot, len, add, scale };
