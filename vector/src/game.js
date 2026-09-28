// One level being played: the robot, its blaster and wormholes, the enemies,
// the boss, the pickups and the clockwork, advanced one physics step at a
// time. It never touches the page: main.js feeds it intents and plays what it
// says happened (Game.events) as sound and light. The tests and the tools
// run it headless.
import { BLASTER, POWER, POWERUPS, PICKS, ROBOT, MOVE, PICKUP, WORM, BOSS_INTRO } from './config.js';
import { Robot } from './player.js';
import { stepRobot } from './player.js';
import { makeCharge, stepCharge } from './blaster.js';
import { sightLine, placeEnd, refreshEnd, ejectFrom } from './wormholes.js';
import { Enemy, stepEnemy, chargeMeets, freeze } from './enemies.js';
import { makeBoss } from './bosses.js';
import { add, sub, scale, norm, dot, len, dist, madd, lookDir, camBasis, rotAxis, reflect, clamp } from './math.js';

export const END_COLORS = ['#e6fbff', '#3c96be'];

export class Game {
  /**
   * `bp` is a built level (levels.js). opts: shields, maxShields, checkpoint
   * (an index to start from), ammo, loaded, stats, invulnerable (the tools).
   */
  constructor(bp, opts = {}) {
    this.bp = bp;
    this.world = bp.world;
    this.time = 0;
    this.events = [];
    this.state = 'play'; // play, down, cleared
    this.maxShields = opts.maxShields ?? 5;
    this.shields = opts.shields ?? this.maxShields;
    this.checkpoint = opts.checkpoint ?? -1;
    const start = this.checkpoint >= 0 && bp.checkpoints[this.checkpoint] ? bp.checkpoints[this.checkpoint] : bp.spawn;
    this.bot = new Robot(start.p, start.yaw);
    this.charges = [];
    this.shots = [];
    this.ends = [null, null];
    this.ammo = { ...Object.fromEntries(POWERUPS.map((p) => [p.id, 0])), ...(opts.ammo || {}) };
    this.loaded = opts.loaded || 'std';
    this.cooldown = 0;
    this.wantFire = false;
    this.stats = opts.stats || { shots: 0, kills: 0, secrets: 0, lost: 0, time: 0 };
    this.invulnerable = !!opts.invulnerable;
    this.enemies = (bp.enemies || []).map((s) => new Enemy(s));
    this.pickups = (bp.pickups || []).map((p, i) => ({ ...p, id: i, taken: false, pos: [...p.p] }));
    this.ambushes = (bp.ambushes || []).map((a) => ({ ...a, state: 'wait', wave: -1 }));
    this.noWaves = !!opts.noWaves;
    this.boss = null;
    this.bossIntro = 0;
    this.phase = 'level'; // level, boss, exit
    this.sign = null;
    this.say = null; // a line being spoken: { who, text, t }
    this.said = new Set();
    this.lastHurt = -9;
    this.flash = 0;
    // A level that starts at a checkpoint past some doors has them open.
    for (const s of this.world.solids) if (s.door && s.door.startOpen) s.door.open = true;
  }

  emit(e) {
    this.events.push(e);
  }

  get openEnds() {
    return this.ends.filter(Boolean);
  }

  // ------------------------------------------------------------------ step

  step(dt, it = {}) {
    if (this.state !== 'play') return;
    const W = this.world;
    const bot = this.bot;
    this.time += dt;
    this.stats.time += dt;
    W.step(dt, (s) => this.inDoor(s));
    this.stepEnds();

    // The robot.
    const ev = stepRobot(bot, it, W, dt, this.openEnds);
    for (const e of ev) this.onRobot(e);
    this.stomps();

    // The blaster and the ends.
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (it.cycle) this.cycle(it.cycle);
    if (it.pick != null) this.load(PICKS[it.pick]);
    if (it.firePress) this.wantFire = true;
    if ((this.wantFire || it.fire) && this.cooldown <= 0 && bot.frozen <= 0) {
      this.wantFire = false;
      this.fire();
    }
    if (it.worm) {
      if (it.worm[0]) this.openEnd(0);
      if (it.worm[1]) this.openEnd(1);
    }

    this.stepCharges(dt);
    this.stepEnemies(dt);
    if (this.boss) this.stepBoss(dt);
    this.stepPickups();
    this.stepHazards();
    this.stepTriggers();
    this.stepAmbushes();
  }

  /**
   * Ambush rooms: walking in locks both doors, and wave after wave comes;
   * when the last falls, the doors open (and sometimes something drops).
   */
  stepAmbushes() {
    const b = this.bot;
    const W = this.world;
    const doors = (a, open) => {
      for (const s of W.solids) if (s.door && a.doors.includes(s.door.id)) s.door.open = open;
    };
    for (const a of this.ambushes) {
      if (a.state === 'done') continue;
      const inside = b.pos[0] >= a.min[0] && b.pos[0] <= a.max[0] && b.pos[1] >= a.min[1] && b.pos[1] <= a.max[1] && b.pos[2] >= a.min[2] && b.pos[2] <= a.max[2];
      if (a.state === 'wait') {
        if (!inside) continue;
        a.state = 'fight';
        a.wave = -1;
        a.foes = [];
        doors(a, false);
        this.emit({ s: 'lock', at: [...b.pos] });
      }
      if (a.state === 'fight') {
        if (a.foes.some((e) => !e.dead)) continue;
        a.wave++;
        const waves = this.noWaves ? [] : a.waves;
        if (a.wave >= waves.length) {
          a.state = 'done';
          doors(a, true);
          if (a.drop) this.dropAt(a.dropAt, a.drop);
          this.emit({ s: 'unlock', at: [...b.pos] });
          continue;
        }
        a.foes = waves[a.wave].map((spec) => {
          const e = new Enemy(spec);
          e.awake = true;
          this.enemies.push(e);
          return e;
        });
        this.emit({ s: 'wave', at: [...b.pos] });
      }
    }
  }

  /** Would a door closing now come down on the robot? Then it waits. */
  inDoor(s) {
    const b = this.bot;
    const r = b.r + 0.05;
    const lo = b.pos[1] - b.half - b.r;
    const hi = b.pos[1] + b.half + b.r;
    const base = s.base[1];
    return b.pos[0] > s.min[0] - r && b.pos[0] < s.max[0] + r && b.pos[2] > s.min[2] - r && b.pos[2] < s.max[2] + r && hi > base && lo < s.min[1] + 0.1;
  }

  onRobot(e) {
    const bot = this.bot;
    if (e.s === 'fall') {
      this.hurt('fall');
      this.putBack();
    } else if (e.s === 'crushed') {
      this.hurt('crush');
      this.putBack();
    } else if (e.s === 'warp') {
      this.warps = (this.warps || 0) + 1;
      this.emit({ s: 'warp', at: bot.eyePos(), me: true });
    } else {
      if (e.s === 'jump' || e.s === 'land' || e.s === 'step' || e.s === 'spring') e.me = true;
      this.emit(e);
    }
  }

  /** Back on the last firm ground it stood on, or the last checkpoint if that has gone. */
  putBack() {
    const b = this.bot;
    let p = b.safe;
    let yaw = b.safeYaw;
    const below = this.world.raycast([p[0], p[1], p[2]], [0, -1, 0], b.half + b.r + 0.4);
    if (!below || !this.world.capsuleFree(p, b.half, b.r)) {
      const c = this.checkpoint >= 0 ? this.bp.checkpoints[this.checkpoint] : this.bp.spawn;
      p = c.p;
      yaw = c.yaw;
    }
    const inv = b.invuln;
    b.spawn(p, yaw);
    b.invuln = Math.max(inv, ROBOT.invuln);
    for (const end of this.openEnds) ejectFrom(end, b);
  }

  /** A shield lost (unless the robot is still flickering from the last). */
  hurt(why) {
    const b = this.bot;
    if (this.invulnerable || b.invuln > 0) return;
    this.shields = Math.max(0, this.shields - 1);
    this.stats.lost++;
    b.invuln = ROBOT.invuln;
    this.lastHurt = this.time;
    this.emit({ s: 'hurt', why, me: true });
    if (this.shields <= 0) {
      this.state = 'down';
      this.emit({ s: 'down', me: true });
    }
  }

  // --------------------------------------------------------------- blaster

  cycle(dir) {
    const have = PICKS.filter((k) => k === 'std' || this.ammo[k] > 0);
    let i = have.indexOf(this.loaded);
    i = (i + (dir > 0 ? 1 : -1) + have.length) % have.length;
    this.loaded = have[i];
    this.emit({ s: 'cycle', me: true });
  }

  load(k) {
    if (!k || (k !== 'std' && !(this.ammo[k] > 0))) return;
    if (this.loaded !== k) {
      this.loaded = k;
      this.emit({ s: 'cycle', me: true });
    }
  }

  mine() {
    return this.charges.filter((c) => c.owner === 'bot').length;
  }

  /** Where a shot leaves: just ahead of the eye, never inside a wall that close. */
  muzzle(dir) {
    const eye = this.bot.eyePos();
    const h = this.world.raycast(eye, dir, BLASTER.muzzle + BLASTER.radius * 3);
    const d = h ? Math.max(0.05, h.t - BLASTER.radius * 1.5) : BLASTER.muzzle;
    return madd(eye, dir, d);
  }

  fire() {
    const b = this.bot;
    const kind = this.loaded;
    const n = kind === 'triple' ? 3 : 1;
    if (this.mine() + n > BLASTER.maxAlive) {
      this.emit({ s: 'dry', me: true });
      this.cooldown = 0.12;
      return false;
    }
    const dir = lookDir(b.yaw, b.pitch);
    const up = camBasis(b.yaw, b.pitch).up;
    const dirs = n === 1 ? [dir] : [-1, 0, 1].map((k) => rotAxis(dir, up, k * POWER.tripleSpread));
    for (const d of dirs) {
      const c = makeCharge(this.muzzle(d), d, kind, 'bot');
      this.charges.push(c);
    }
    if (kind !== 'std') {
      this.ammo[kind]--;
      if (this.ammo[kind] <= 0) {
        this.loaded = 'std';
        this.emit({ s: 'empty', me: true });
      }
    }
    this.cooldown = BLASTER.cooldown;
    this.stats.shots++;
    this.flash = 0.06;
    this.emit({ s: 'fire', kind, me: true });
    return true;
  }

  /** Aim an end along the line of sight and open it where it lands. */
  openEnd(which) {
    const b = this.bot;
    const look = lookDir(b.yaw, b.pitch);
    const sl = sightLine(this.world, b.eyePos(), look);
    const twin = this.ends[1 - which];
    const { end, why } = placeEnd(this.world, sl.hit, look, twin);
    if (!end) {
      this.emit({ s: 'fizzle', why, at: sl.hit ? sl.hit.p : null, me: true });
      return null;
    }
    const old = this.ends[which];
    if (old) ejectFrom(old, b);
    end.which = which;
    end.color = END_COLORS[which];
    this.ends[which] = end;
    this.link();
    this.emit({ s: 'portal', which, at: end.c, me: true });
    return end;
  }

  /** Close an end (a boss's door shutting, a host gone). */
  closeEnd(which, quiet = false) {
    const e = this.ends[which];
    if (!e) return;
    ejectFrom(e, this.bot);
    this.ends[which] = null;
    this.link();
    if (!quiet) this.emit({ s: 'unportal', which, at: e.c });
  }

  link() {
    const [a, b] = this.ends;
    if (a) a.twin = b || null;
    if (b) b.twin = a || null;
  }

  stepEnds() {
    for (let i = 0; i < 2; i++) {
      const e = this.ends[i];
      if (!e) continue;
      if (!refreshEnd(e)) {
        this.closeEnd(i);
        continue;
      }
      const d = dist(e.c, this.bot.pos);
      if (d < 30) e.near = true;
      // An end left far behind closes, once the robot has been near it.
      if (e.near && d > WORM.leftBehind) this.closeEnd(i);
    }
  }

  // --------------------------------------------------------------- charges

  stepCharges(dt) {
    const W = this.world;
    const ends = this.openEnds;
    const hitSolid = (s, n, c) => {
      if (s.crate || s.cover) {
        if (c.owner === 'bot') this.damageBlock(s, c);
        return c.kind === 'big' && s.gone ? null : 'stop';
      }
      if (s.switchRef) {
        if (c.owner === 'bot') this.flip(s.switchRef);
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
    }
    // Enemies' shots: the robot's charges knock them out of the air, and they cost the robot a shield.
    for (const s of this.shots) {
      const ev = stepCharge(s, W, ends, dt, (so) => (so.crate || so.cover || so.switchRef ? 'stop' : null));
      for (const e of ev) if (e.s === 'warp') this.emit({ s: 'warp', at: e.at });
      if (s.dead) continue;
      if (s.bounceLimit != null && s.bounces > s.bounceLimit) {
        s.dead = true;
        continue;
      }
      for (const c of this.charges) {
        if (c.owner === 'bot' && !c.dead && dist(c.pos, s.pos) < c.r + s.r) {
          s.dead = true;
          if (c.kind !== 'big') c.dead = true;
          this.emit({ s: 'pop', at: [...s.pos], small: true });
          break;
        }
      }
      if (!s.dead && this.touchesBot(s.pos, s.r)) {
        s.dead = true;
        this.hurt('shot');
        this.knock(sub(this.bot.pos, s.pos));
      }
    }
    this.charges = this.charges.filter((c) => !c.dead);
    this.shots = this.shots.filter((c) => !c.dead);
  }

  touchesBot(p, r) {
    const b = this.bot;
    const y = clamp(p[1], b.pos[1] - b.half, b.pos[1] + b.half);
    return Math.hypot(p[0] - b.pos[0], p[1] - y, p[2] - b.pos[2]) < r + b.r;
  }

  knock(dir) {
    const b = this.bot;
    if (this.invulnerable) return;
    const d = norm([dir[0], 0, dir[2]]);
    b.vel = madd(b.vel, d, ROBOT.knock * 0.5);
    b.vel[1] = Math.max(b.vel[1], 3);
  }

  damageBlock(s, c) {
    s.hp = (s.hp ?? 3) - c.damage * (c.kind === 'big' ? 3 : 1);
    if (s.hp <= 0) {
      this.world.remove(s);
      this.emit({ s: 'crate', at: centre(s), cover: !!s.cover });
      if (s.drop) this.dropAt(centre(s), s.drop);
      if (s.cover && s.secret) this.emit({ s: 'secretOpen', at: centre(s) });
    } else this.emit({ s: 'thunk', at: [...c.pos] });
  }

  dropAt(p, kind) {
    this.pickups.push({ id: this.pickups.length, kind: kind === 'shield' ? 'shield' : 'power', power: kind === 'shield' ? null : kind, p: [...p], pos: [p[0], p[1], p[2]], taken: false, dropped: true, vy: 4 });
  }

  flip(sw) {
    if (sw.on && !sw.timer) return;
    // A switch far from the robot takes no charge: a stray shot down a long hall never opens a door you have not reached.
    if (dist(sw.p, this.bot.pos) > 70) return;
    this.world.setSwitch(sw, true);
    this.emit({ s: 'switch', at: sw.p });
    this.emit({ s: 'door', at: sw.p });
  }

  hitEnemy(en, c) {
    if (c.kind === 'freeze') {
      freeze(en, this.world);
      this.emit({ s: 'freeze', at: [...en.pos] });
      return;
    }
    en.hp -= c.damage;
    en.flash = 0.12;
    if (en.hp <= 0) this.killEnemy(en);
    else this.emit({ s: 'hit', at: [...en.pos] });
  }

  killEnemy(en) {
    en.dead = true;
    if (en.ice) {
      this.world.remove(en.ice);
      en.ice = null;
    }
    this.stats.kills++;
    this.emit({ s: 'pop', at: [...en.pos], big: en.r > 0.8, r: en.r, look: en.look, color: en.color });
    if (en.drops) this.dropAt(en.pos, en.drops);
  }

  // --------------------------------------------------------------- enemies

  stepEnemies(dt) {
    const bot = this.bot;
    for (const en of this.enemies) {
      if (en.dead) continue;
      const ev = stepEnemy(en, this.world, bot, this.openEnds, dt, this.shots);
      for (const e of ev) this.emit(e);
      if (en.dead || !en.awake || en.frozen > 0) continue;
      // Touching it costs a shield (a stomp is dealt with first).
      if (this.touchesBot(en.pos, en.r * 0.9)) {
        this.hurt('touch');
        this.knock(sub(bot.pos, en.pos));
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
  }

  /** Landing on an enemy from above ends it and bounces the robot up, if it can be stomped. */
  stomps() {
    const b = this.bot;
    if (b.vel[1] > -1) return;
    for (const en of this.enemies) {
      if (en.dead || !en.awake || en.frozen > 0) continue;
      const h = Math.hypot(en.pos[0] - b.pos[0], en.pos[2] - b.pos[2]);
      const feet = b.feet;
      if (h < en.r + 0.35 && feet > en.pos[1] && feet - (en.pos[1] + en.r) < 0.25) {
        if (en.stompable) {
          this.killEnemy(en);
          b.vel[1] = MOVE.stomp;
          b.flung = true;
          this.emit({ s: 'stomp', at: [...en.pos] });
        }
      }
    }
  }

  // ------------------------------------------------------------------ boss

  startBoss() {
    const A = this.bp.arena;
    if (!A || this.boss) return;
    this.phase = 'boss';
    this.boss = makeBoss(A.boss, A, this);
    this.bossIntro = BOSS_INTRO;
    // The door shuts behind you, and every fight starts without wormholes.
    if (A.door) A.door.door.open = false;
    this.closeEnd(0, true);
    this.closeEnd(1, true);
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
    if (!B.dead && B.touches && B.touches(this.bot, this)) {
      this.hurt('boss');
      this.knock(sub(this.bot.pos, B.pos));
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
        this.emit({ s: 'bossDown', at: [...B.pos] });
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
    const b = this.bot;
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
      const d = Math.hypot(p.pos[0] - b.pos[0], (p.pos[1] - b.pos[1]) * 0.6, p.pos[2] - b.pos[2]);
      if (d > PICKUP.reach) continue;
      if (p.kind === 'shield') {
        if (this.shields >= this.maxShields && Number.isFinite(this.maxShields)) continue;
        this.shields = Math.min(this.maxShields, this.shields + 1);
        p.taken = true;
        this.emit({ s: 'shield', at: p.pos, me: true });
      } else {
        const k = p.power;
        const had = this.ammo[k];
        this.ammo[k] = Math.min(POWER.maxAmmo, this.ammo[k] + POWER.ammo);
        if (!had && this.loaded === 'std') this.loaded = k;
        p.taken = true;
        this.emit({ s: 'powerup', power: k, at: p.pos, me: true });
      }
      if (p.secret) {
        this.stats.secrets++;
        this.emit({ s: 'secret', me: true });
      }
    }
  }

  stepHazards() {
    const b = this.bot;
    const W = this.world;
    for (const h of W.hazards) {
      if (h.laser && !h.lit) continue;
      if (h.off) continue;
      const lo = b.pos[1] - b.half - b.r;
      const hi = b.pos[1] + b.half + b.r;
      if (b.pos[0] + b.r < h.min[0] || b.pos[0] - b.r > h.max[0] || b.pos[2] + b.r < h.min[2] || b.pos[2] - b.r > h.max[2] || hi < h.min[1] || lo > h.max[1]) continue;
      this.hurt(h.kind);
      // Anything at the bottom of something (a trench's rail, molten metal, water,
      // spikes) puts the robot back on firm ground; a laser gate throws it back.
      if (h.laser) this.knock(sub(b.pos, [(h.min[0] + h.max[0]) / 2, b.pos[1], (h.min[2] + h.max[2]) / 2]));
      else this.putBack();
    }
    if (W.horizon(b.pos, b.r)) {
      this.hurt('horizon');
      this.putBack();
    }
  }

  stepTriggers() {
    const b = this.bot;
    const inBox = (t) => b.pos[0] >= t.min[0] && b.pos[0] <= t.max[0] && b.pos[1] >= t.min[1] && b.pos[1] <= t.max[1] && b.pos[2] >= t.min[2] && b.pos[2] <= t.max[2];
    this.bp.checkpoints.forEach((c, i) => {
      if (i > this.checkpoint && inBox(c)) {
        this.checkpoint = i;
        this.emit({ s: 'checkpoint', at: c.p, me: true });
      }
    });
    const A = this.bp.arena;
    if (A && !this.boss && inBox(A.trigger)) this.startBoss();
    if (A && this.phase === 'exit' && this.boss && this.boss.dead && inBox(A.exit)) {
      this.state = 'cleared';
      this.emit({ s: 'cleared', me: true });
    }
    // Signs: the nearest within reach is read out on screen.
    this.sign = null;
    for (const s of this.bp.signs || []) {
      if (Math.hypot(s.p[0] - b.pos[0], s.p[2] - b.pos[2]) < (s.reach || 6) && Math.abs(s.p[1] - b.pos[1]) < 4) this.sign = s;
    }
    for (const l of this.bp.lines || []) {
      if (this.said.has(l)) continue;
      if (inBox(l)) {
        this.said.add(l);
        this.speak(l.who, l.text, l.name);
      }
    }
  }
}

function centre(s) {
  return [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
}

export { dot, len, add, scale };
