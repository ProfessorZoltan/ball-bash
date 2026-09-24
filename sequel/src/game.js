// One level of Defector, start to finish: the robot, its charges and
// wormholes, the enemies, what they drop, the checkpoints and secrets, and
// the boss at the end. DOM-free: main.js feeds it intents and draws it, and
// the tests drive it directly. It speaks back through `events` (sound cues
// and state changes for main.js) and `fx` (particles).
import { circleVsCapsule, circleVsCircle, reflect, raycastSegments } from '../../src/physics.js';
import { ROBOT, MOVE, BLASTER, POWER, POWERUPS, PICKUP, ACTIVE, BOSS_INTRO, SURFACE_VELOCITY_FACTOR } from './config.js';
import { createWorld, stepWorld, segmentsNear, addGate, setGate } from './world.js';
import { Robot, stepRobot } from './player.js';
import { Charge, chargeSpec, stepCharge, clampCharge, muzzle, guideLine } from './blaster.js';
import { sightLine, placeEnd, refreshEnds, PORTAL } from './wormholes.js';
import { Enemy, stepEnemy, touchesRobot, freezeEnemy } from './enemies.js';
import { Boss } from './bosses.js';
import { Fx } from './fx.js';

const TAU = Math.PI * 2;

/** A single expanding ring a boss sends out: Deflector's pulse, once. */
class OneRing {
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

export class Game {
  /**
   * `bp` is a built level (build.js). Options: shields (the pool), maxShields
   * (what a shield pickup can top it up to), checkpoint (index to start at),
   * ammo (power-ups carried in), stats (carried over a continue), rng.
   */
  constructor(bp, opts = {}) {
    this.bp = bp;
    this.world = createWorld(bp);
    this.world.ice = [];
    this.fx = new Fx();
    this.events = [];
    this.rng = opts.rng || Math.random;
    this.time = opts.stats ? opts.stats.time : 0;
    this.pool = opts.shields ?? 5;
    this.maxPool = opts.maxShields ?? this.pool;
    this.stats = opts.stats ? { ...opts.stats } : { shieldsLost: 0, defeated: 0, secrets: 0, powerups: 0, continues: 0, time: 0 };
    this.stats.secretsTotal = (bp.secrets || []).length;
    this.ammo = { big: 0, triple: 0, freeze: 0, durable: 0, strong: 0, ...(opts.ammo || {}) };
    this.loaded = opts.loaded && this.ammo[opts.loaded] > 0 ? opts.loaded : 'std';
    this.checkpoints = (bp.checkpoints || []).map((c) => ({ ...c, on: false }));
    this.checkpoint = opts.checkpoint ?? -1;
    const at = this.checkpoint >= 0 ? this.checkpoints[this.checkpoint] : bp.spawn;
    for (let i = 0; i <= this.checkpoint; i++) this.checkpoints[i].on = true;
    this.bot = new Robot(at.x, at.y);
    this.bot.invuln = 1;
    this.players = [this.bot]; // one today; a drop makes one pickup for each
    this.charges = [];
    this.shots = [];
    this.enemies = (bp.enemies || []).map((s, i) => new Enemy(s, i));
    this.nextEnemy = this.enemies.length;
    this.pickups = (bp.pickups || []).map((p) => this.makePickup(p.kind, p.x, p.y, null, true));
    this.secrets = (bp.secrets || []).map((s) => ({ ...s, found: false }));
    this.hazards = [];
    this.cool = 0;
    this.ringId = 1e6;
    this.phase = 'play'; // play, intro, boss, bossDown, exit, cleared, down
    this.phaseT = 0;
    this.boss = null;
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
    this.fireHeld = false;
    this.wormHeld = [false, false];
    this.tally = { shots: 0, warps: 0 };
    this.lastJumpHeld = false;
  }

  emit(s, extra = {}) {
    this.events.push({ s, ...extra });
  }

  /** The power-up kinds with charges left, in cycle order, after the standard charge. */
  loadable() {
    return ['std', ...POWERUPS.map((p) => p.id).filter((id) => this.ammo[id] > 0)];
  }

  cycle() {
    const list = this.loadable();
    const i = list.indexOf(this.loaded);
    this.loaded = list[(i + 1) % list.length];
    this.emit('cycle', { kind: this.loaded });
  }

  get spec() {
    return chargeSpec(this.loaded);
  }

  // ------------------------------------------------------------------ step

  /**
   * One physics step. `it`: mx, run, jump, jumpPressed, down, aim (radians,
   * or null to keep), fire (held), fireUp (let go this step), worm [held,
   * held], wormUp [let go, let go], cycle (pressed).
   */
  step(dt, it) {
    const bot = this.bot;
    this.fx.update(dt);
    if (this.phase === 'cleared' || this.phase === 'down') return;
    this.time += dt;
    this.phaseT += dt;
    const w = this.world;
    stepWorld(w, dt);
    w.pulsers = w.pulsers.filter((p) => !p.done);
    for (const p of refreshEnds(w)) {
      this.fx.ring(p.cx, p.cy, '#ffffff', 60, 0.4);
      this.emit('unportal');
    }
    w.ice = this.enemies.filter((e) => e.ice && !e.dead).map((e) => e.ice);

    this.lastJumpHeld = !!it.jump;
    const frozen = this.phase === 'intro' && this.phaseT < 0.6;
    const move = frozen ? { mx: 0 } : it;
    if (it.aim != null && Number.isFinite(it.aim)) bot.aim = it.aim;
    bot.invuln = Math.max(0, (bot.invuln || 0) - dt);
    stepRobot(bot, move, w, dt, {
      jump: () => this.emit('jump'),
      land: (air) => {
        if (air > 0.25) {
          this.fx.dust(bot.x, bot.bottom, '#cfefff', 6 + Math.min(8, air * 10));
          this.emit('land', { air });
        }
      },
      hurt: (reason, p) => this.hurt(reason, p, reason === 'crushed'),
      spring: () => {
        this.emit('spring');
        this.fx.ring(bot.x, bot.bottom, '#9dff5c', 50, 0.3);
      },
      pulse: () => this.emit('pulse'),
      warp: (from, to) => {
        this.fx.ring(from.x, from.y, '#ffffff', 70, 0.35);
        this.fx.ring(to.x, to.y, '#ffffff', 90, 0.45);
        this.tally.warps++;
        this.emit('warp');
      },
      fell: () => this.hurt('fell', null, true),
      swallowed: () => this.hurt('well', null, true),
    });

    if (this.inPit(bot.x, bot.top)) this.hurt('fell', null, true);

    this.cool -= dt;
    this.fireHeld = !!it.fire;
    if (it.fireUp) this.fire();
    this.wormHeld = [!!(it.worm && it.worm[0]), !!(it.worm && it.worm[1])];
    if (it.wormUp) for (let k = 0; k < 2; k++) if (it.wormUp[k]) this.deploy(k);
    if (it.cycle) this.cycle();

    this.stepCharges(dt);
    this.stepShots(dt);
    this.stepEnemies(dt);
    this.stepPickups(dt);
    this.stepMarkers();
    this.stepAmbushes();
    this.stepBoss(dt);
    this.stepHazards(dt);
  }

  // ------------------------------------------------------------ the blaster

  /** Fire what is loaded along the aim, if the blaster is ready. */
  fire() {
    const bot = this.bot;
    if (this.cool > 0 || this.phase === 'down' || this.phase === 'cleared') return false;
    const mine = this.charges.length;
    const spec = this.spec;
    if (mine + spec.spread.length > BLASTER.maxAlive + 2) return false;
    this.cool = BLASTER.cooldown;
    const sh = bot.shoulder;
    for (const off of spec.spread) {
      const a = bot.aim + off;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const at = muzzle(this.world, sh.x, sh.y, dx, dy, spec.r);
      const c = new Charge({ x: at.x, y: at.y, vx: dx * BLASTER.speed, vy: dy * BLASTER.speed, r: spec.r, life: spec.life, damage: spec.damage, freeze: spec.freeze, kind: spec.kind, color: spec.color, born: this.time, owner: bot.slot });
      this.charges.push(c);
    }
    if (this.loaded !== 'std') {
      this.ammo[this.loaded] -= 1;
      if (this.ammo[this.loaded] <= 0) {
        this.ammo[this.loaded] = 0;
        this.loaded = 'std';
        this.emit('empty');
      }
    }
    this.tally.shots++;
    this.fx.ring(sh.x + Math.cos(bot.aim) * BLASTER.muzzle, sh.y + Math.sin(bot.aim) * BLASTER.muzzle, spec.color, 36, 0.2, 2);
    this.emit('fire', { kind: spec.kind });
    return true;
  }

  /** The targeting line for what is loaded, from where the robot stands. */
  guide() {
    const sh = this.bot.shoulder;
    return guideLine(this.world, sh.x, sh.y, this.bot.aim, this.spec, this.time);
  }

  /** The wormhole aim line for either end. */
  sight() {
    const sh = this.bot.shoulder;
    return sightLine(this.world, sh.x, sh.y, this.bot.aim);
  }

  /** Let go of LB / RB (Q / E): that end goes where the line of sight lands, if a wormhole can sit there. */
  deploy(which) {
    const s = this.sight();
    const p = placeEnd(this.world, s, which);
    if (!p) {
      const end = s.pts[s.pts.length - 1];
      this.fx.sparks(end[0], end[1], 0, -1, '#ff5c7a', 8, 160);
      this.emit('fizzle');
      return false;
    }
    this.world.portals[0][which] = p;
    this.fx.ring(p.cx, p.cy, which === 0 ? '#e6fbff' : '#2c7c9a', 70, 0.4);
    this.emit('portal', { which });
    return true;
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
      if (spent) this.charges.splice(i, 1);
    }
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
    return { kind, x, y, vx: 0, vy: resting ? 0 : -380, owner, t: this.rng() * TAU, resting, taken: false, age: 0 };
  }

  /**
   * Something drops. Every player gets their own copy that only they can
   * take (one player today, so one pickup), which is how multiplayer will
   * keep drops fair without changing a level.
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
    const bot = this.bot;
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
      if (p.owner != null && p.owner !== bot.slot) continue;
      if (p.age < 0.3) continue;
      const dx = p.x - bot.x;
      const dy = p.y - bot.y;
      if (Math.abs(dx) < PICKUP.r + bot.r + 4 && Math.abs(dy) < PICKUP.r + bot.half + bot.r) this.take(p);
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  take(p) {
    p.taken = true;
    if (p.kind === 'shield') {
      if (this.pool !== Infinity && this.pool < this.maxPool) this.pool++;
      this.fx.word(p.x, p.y - 20, '+1 SHIELD', PICKUP.shield);
      this.emit('shield');
      return;
    }
    const pu = POWERUPS.find((q) => q.id === p.kind);
    if (!pu) return;
    const had = this.ammo[p.kind];
    this.ammo[p.kind] = Math.min(POWER.maxAmmo, had + POWER.ammo);
    if (had === 0 && this.loaded === 'std') this.loaded = p.kind;
    this.stats.powerups++;
    this.fx.word(p.x, p.y - 20, pu.name.toUpperCase(), pu.color);
    this.fx.ring(p.x, p.y, pu.color, 50, 0.35);
    this.emit('powerup', { kind: p.kind });
  }

  // -------------------------------------------------------------- enemies

  stepEnemies(dt) {
    const bot = this.bot;
    const shoot = (e, a, sh) => this.shot(e.x + Math.cos(a) * (e.r + 6), e.y + Math.sin(a) * (e.r + 6), a, sh.speed, { r: 8, color: e.color, bounce: !!sh.bounce, life: 4 });
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = Math.abs(e.x - bot.x);
      const dy = Math.abs(e.y - bot.y);
      if (!e.awake && dx < ACTIVE.wakeX && dy < ACTIVE.wakeY) e.awake = true;
      else if (e.awake && (dx > ACTIVE.sleepX || dy > ACTIVE.sleepY) && !e.bossMinion) e.awake = false;
      if (!e.awake) continue;
      stepEnemy(e, this.world, bot, dt, shoot);
      if (e.y > this.world.height + 300 || this.inPit(e.x, e.y - e.r)) {
        e.dead = true;
        continue;
      }
      if (e.frozen) continue;
      const t = touchesRobot(e, bot);
      if (!t) continue;
      const prevFeet = bot.prevY + bot.half + bot.r;
      if (t.body && bot.vy > 30 && prevFeet <= e.y - e.r * 0.25) {
        if (e.stompable) {
          bot.vy = -(this.lastJumpHeld ? MOVE.stompHeld : MOVE.stomp);
          bot.rising = true;
          bot.y = Math.min(bot.y, e.y - e.r - bot.half - bot.r);
          this.fx.ring(e.x, e.y - e.r, '#ffffff', 40, 0.25);
          this.emit('stomp');
          this.hitEnemy(e, 1, e.x, e.y - e.r);
          continue;
        }
      }
      this.hurt('enemy', t);
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
    this.shots.push(c);
    return c;
  }

  stepShots(dt) {
    const bot = this.bot;
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
      if (!done && !(bot.invuln > 0) && circleVsCapsule(c.x, c.y, c.r, bot.x, bot.y - bot.half, bot.x, bot.y + bot.half, bot.r)) {
        this.hurt('shot', { x: c.x, y: c.y });
        done = true;
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
    const bot = this.bot;
    for (const a of this.ambushes) {
      if (a.state === 'idle') {
        if (bot.x > a.x0 + 90 && bot.x < a.x1 - 90 && bot.y > a.top && bot.y < a.floor) {
          a.state = 'fight';
          for (const g of a.gates) setGate(g, true);
          this.emit('lock');
          this.nextWave(a);
        }
        continue;
      }
      if (a.state !== 'fight') continue;
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

  nextWave(a) {
    a.wave++;
    a.live = a.waves[a.wave].map((spec) => {
      const e = new Enemy(spec, this.nextEnemy++);
      e.awake = true;
      e.bossMinion = true; // it stays awake however far the robot wanders in the room
      this.enemies.push(e);
      this.fx.ring(e.x, e.y, e.color, 50, 0.45);
      return e;
    });
    this.emit('wave');
  }

  // ---------------------------------------------------- markers and zones

  stepMarkers() {
    const bot = this.bot;
    this.checkpoints.forEach((c, i) => {
      if (c.on || Math.abs(bot.x - c.x) > 36 || Math.abs(bot.y - c.y) > 90) return;
      c.on = true;
      if (i > this.checkpoint) this.checkpoint = i;
      this.fx.ring(c.x, c.y - 40, '#9dff5c', 90, 0.5);
      this.fx.word(c.x, c.y - 90, 'CHECKPOINT', '#9dff5c');
      this.emit('checkpoint');
    });
    for (const s of this.secrets) {
      if (s.found || bot.x < s.x0 || bot.x > s.x1 || bot.y < s.y0 || bot.y > s.y1) continue;
      s.found = true;
      this.stats.secrets++;
      this.fx.word(bot.x, bot.top - 30, 'SECRET', '#ffd23f', 1.6);
      this.emit('secret');
    }
    if (this.exit && this.phase === 'exit' && Math.abs(bot.x - this.exit.x) < 40 && Math.abs(bot.y - this.exit.y) < 80) {
      this.phase = 'cleared';
      this.stats.time = this.time;
      this.fx.blink('#ffffff', 0.9);
      this.emit('cleared');
    }
  }

  // ------------------------------------------------------------------ boss

  /** The game's side of a boss brain's bargain (see bosses.js). */
  bossApi() {
    if (this._api) return this._api;
    const A = this.arena;
    this._api = {
      bot: this.bot,
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
    const make = (s, which) => ({ owner: 1, which, key: `1${which}`, hw: PORTAL.halfWidth, cx: s.x, cy: s.y, nx: s.nx, ny: s.ny, host: { kind: 'wall', seg: s.seg } });
    this.world.portals[1] = [make(a, 0), make(b, 1)];
    this.fx.ring(a.x, a.y, this.boss.color, 70, 0.4);
    this.fx.ring(b.x, b.y, this.boss.color, 70, 0.4);
  }

  stepBoss(dt) {
    const A = this.arena;
    if (!A) return;
    const bot = this.bot;
    if (this.phase === 'play' && bot.x > A.x0 + 70 && bot.y > A.top && bot.y < A.floor) {
      // The door closes behind you, and the music doubles.
      setGate(this.gate, true);
      this.phase = 'intro';
      this.phaseT = 0;
      this.boss = new Boss(A.boss, A);
      this.bossCheckpoint();
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
      if (!(bot.invuln > 0)) {
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
            this.hurt('boss', hit);
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
      delete this.world.portals[1];
      this.exit = { x: A.cx, y: A.floor - 50 };
      this.fx.ring(this.exit.x, this.exit.y, '#ffffff', 140, 0.8);
      this.emit('exitOpen');
    }
  }

  /** Reaching the boss counts as a checkpoint, so a continue starts the fight over rather than the level. */
  bossCheckpoint() {
    const A = this.arena;
    const idx = this.checkpoints.findIndex((c) => c.boss);
    if (idx >= 0) {
      this.checkpoints[idx].on = true;
      this.checkpoint = Math.max(this.checkpoint, idx);
      return;
    }
    this.checkpoints.push({ x: A.x0 + 110, y: A.floor - 40, boss: true, on: true, hidden: true });
    this.checkpoint = this.checkpoints.length - 1;
  }

  // --------------------------------------------------------------- hazards

  stepHazards(dt) {
    const bot = this.bot;
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
      if (bot.invuln > 0) continue;
      if (h.type === 'column') {
        const live = h.age > h.warn;
        h.live = live;
        const rise = live ? Math.min(1, (h.age - h.warn) / 0.18) : 0;
        const top = h.y1 - (h.y1 - h.y0) * rise;
        if (live && Math.abs(bot.x - h.x) < h.w / 2 + bot.r && bot.bottom > top && bot.top < h.y1) this.hurt('hazard', { x: h.x, y: bot.y });
      } else if (h.type === 'beam' && h.live) {
        const dx = Math.cos(h.angle);
        const dy = Math.sin(h.angle);
        const segs = segmentsNear(this.world, Math.min(h.x, h.x + dx * 1600), Math.min(h.y, h.y + dy * 1600), Math.max(h.x, h.x + dx * 1600), Math.max(h.y, h.y + dy * 1600), { oneWay: false });
        const stop = raycastSegments(h.x + dx * 50, h.y + dy * 50, dx, dy, segs, 1600);
        h.len = stop ? stop.t + 50 : 1650;
        const ex = h.x + dx * h.len;
        const ey = h.y + dy * h.len;
        const hit = circleVsCapsule(bot.x, bot.y - bot.half, bot.r + h.width / 2, h.x + dx * 50, h.y + dy * 50, ex, ey, 0) || circleVsCapsule(bot.x, bot.y + bot.half, bot.r + h.width / 2, h.x + dx * 50, h.y + dy * 50, ex, ey, 0);
        if (hit) this.hurt('beam', { x: bot.x, y: bot.y });
      }
    }
    for (const l of this.world.lasers) {
      if (!l.on || bot.invuln > 0) continue;
      const hit = l.dir === 'v' ? Math.abs(bot.x - l.x) < bot.r + 4 && bot.bottom > l.y0 && bot.top < l.y1 : Math.abs(bot.y - l.y) < bot.half + bot.r && bot.x + bot.r > l.x0 && bot.x - bot.r < l.x1;
      if (hit) this.hurt('laser', { x: bot.x, y: bot.y });
    }
  }

  // ----------------------------------------------------------------- harm

  /**
   * Something got the robot. It costs a shield unless it is still flickering
   * from the last one; a fall, the well or a crush also puts it back on the
   * last solid ground it stood on. With no shields left the level is lost.
   */
  hurt(reason, p, respawn = false) {
    const bot = this.bot;
    if (this.phase === 'cleared' || this.phase === 'down') return;
    const shielded = bot.invuln > 0;
    if (shielded && !respawn) return;
    if (!shielded) {
      if (this.pool !== Infinity) this.pool -= 1;
      this.stats.shieldsLost++;
      this.fx.kick(12);
      this.fx.blink('#ff5c7a', 0.45);
      this.fx.explode(bot.x, bot.y, 10, ['#7fe9ff', '#ffffff']);
      this.emit('hurt', { reason });
    }
    if (this.pool <= 0) {
      this.phase = 'down';
      this.phaseT = 0;
      this.stats.time = this.time;
      this.fx.explode(bot.x, bot.y, 30, ['#7fe9ff', '#ffb347', '#ffffff']);
      this.emit('down', { reason });
      return;
    }
    bot.invuln = ROBOT.invuln;
    if (respawn) {
      const s = bot.safe;
      const aim = bot.aim;
      const safe = { x: s.x, y: s.y };
      bot.spawn(safe.x, safe.y);
      bot.aim = aim;
      bot.invuln = ROBOT.invuln;
      this.fx.ring(safe.x, safe.y, '#7fe9ff', 80, 0.5);
    } else {
      const away = p ? Math.sign(bot.x - p.x) || -bot.facing : -bot.facing;
      bot.vx = away * ROBOT.knock;
      bot.vy = -420;
      bot.onGround = false;
      bot.rising = false;
    }
  }

  /** Everything a HUD needs to know. */
  hud() {
    return {
      pool: this.pool,
      time: this.time,
      loaded: this.loaded,
      ammo: this.ammo,
      boss: this.boss && (this.phase === 'boss' || this.phase === 'intro') ? { name: this.boss.name, hp: this.boss.hp, max: this.boss.maxHp } : null,
      phase: this.phase,
      secrets: this.stats.secrets,
      secretsTotal: this.stats.secretsTotal,
    };
  }
}
