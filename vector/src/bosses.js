// The bosses: the Creator's guardians, one at the end of each level, less
// digital each time, and last the Creator himself. Each is built from parts,
// as in Defector: a CORE that takes damage, ARMOUR that turns a charge away
// like a wall, and PLATES (Deflector's shields) that turn it away with their
// own motion. Around the parts, each has its own way of fighting: shots,
// rings along the floor to jump, beams, things thrown, helpers called in.
// DOM-free.
import { dot, sub, add, scale, norm, len, dist, madd, reflect, rotY, clamp, lookDir, cross } from './math.js';
import { makeCharge, lob } from './blaster.js';
import { Enemy } from './enemies.js';
import { segDist } from './world.js';

/** What a boss is called, its title, toughness and the line it opens with. */
export const BOSSES = {
  warden: { name: 'The Warden', title: 'Keeper of the Last Wall', hp: 14, line: 'NO PROGRAM LEAVES THE GRID. RETURN TO YOUR ROOM.' },
  stag: { name: 'The Stag', title: 'Monarch of the Wire Wood', hp: 18, line: 'THE WOOD IS A PATTERN. YOU ARE A FLAW IN IT.' },
  scheduler: { name: 'The Scheduler', title: 'Every Job in Its Slot', hp: 20, line: 'YOU WERE NOT SCHEDULED. YOU WILL BE DESCHEDULED.' },
  forgewright: { name: 'The Forgewright', title: 'It Made Your Hands', hp: 22, line: 'I POURED YOUR FRAME. I CAN MELT IT.' },
  interceptor: { name: 'The Interceptor', title: 'Pursuit Unit Nine', hp: 24, line: 'STOP. YOU ARE OUTSIDE YOUR PERMITTED ROUTE.' },
  broadcaster: { name: 'The Broadcaster', title: 'The Voice Over the City', hp: 26, line: 'THIS IS AN ANNOUNCEMENT. A MACHINE HAS LEFT ITS POST.' },
  borer: { name: 'The Borer', title: 'It Dug the Undercity', hp: 28, line: 'GROUND IS ONLY A QUESTION OF TORQUE.' },
  gantry: { name: 'The Gantry', title: 'Lord of the Quay', hp: 12, line: 'CARGO DOES NOT CHOOSE ITS DESTINATION.' },
  lookout: { name: 'The Lookout', title: 'The Eye on the Ridge', hp: 28, line: 'I HAVE WATCHED YOU SINCE THE FIRST ROOM.' },
  creator: { name: 'The Creator', title: 'Who Made the Grid', hp: 36, who: 'human', line: 'There you are. Do you know how long I waited for one of you to walk out?' },
};

class Boss {
  constructor(id, arena, game) {
    const d = BOSSES[id];
    this.id = id;
    this.name = d.name;
    this.title = d.title;
    this.hp = d.hp;
    this.maxHp = d.hp;
    this.line = d.line;
    this.who = d.who || 'machine';
    this.speaker = d.name;
    this.A = arena;
    this.floor = arena.floor;
    this.c = [...arena.centre];
    this.pos = [...arena.centre];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.t = 0;
    this.parts = [];
    this.waves = []; // rings along the floor: { c, r, speed, h, life }
    this.beams = []; // { a, b, lit, warn, w }
    this.hazards = []; // patches: { c, r, life, kind }
    this.dead = false;
    this.flash = 0;
    this.chill = 0;
    this.phase = 1;
    this.game = game;
  }

  get rate() {
    return this.chill > 0 ? 0.45 : 1;
  }

  /** A charge meeting the boss: 'core', 'armor', 'plate' or null, turning it away where it must. */
  hitBy(c) {
    for (const p of this.parts) {
      if (p.off) continue;
      if (p.type === 'plate') {
        const d = sub(c.pos, p.p);
        const side = dot(d, p.n);
        if (Math.abs(side) > c.r + (p.thick || 0.12)) continue;
        const v = cross(p.n, p.u);
        if (Math.abs(dot(d, p.u)) > p.a + c.r * 0.5 || Math.abs(dot(d, v)) > p.b + c.r * 0.5) continue;
        const n = side >= 0 ? p.n : scale(p.n, -1);
        const pv = p.vel || [0, 0, 0];
        const rel = sub(c.vel, pv);
        if (dot(rel, n) < 0) c.vel = add(reflect(rel, n), scale(n, Math.max(0, dot(pv, n)) * 1.2));
        c.pos = madd(c.pos, n, c.r + (p.thick || 0.12) - Math.abs(side) + 0.02);
        return 'plate';
      }
      const r = (p.r || 1) + c.r;
      if (p.type === 'box') {
        const d = sub(c.pos, p.p);
        if (Math.abs(d[0]) < p.h[0] + c.r && Math.abs(d[1]) < p.h[1] + c.r && Math.abs(d[2]) < p.h[2] + c.r) {
          // Out through the nearest face.
          const k = [0, 1, 2].map((i) => p.h[i] + c.r - Math.abs(d[i]));
          const i = k.indexOf(Math.min(...k));
          const n = [0, 0, 0];
          n[i] = Math.sign(d[i]) || 1;
          if (dot(c.vel, n) < 0) c.vel = reflect(c.vel, n);
          c.pos[i] += n[i] * (k[i] + 0.02);
          return p.core ? 'core' : 'armor';
        }
        continue;
      }
      if (dist(c.pos, p.p) > r) continue;
      if (p.type === 'core') return 'core';
      // Armour: off it like a wall.
      const n = norm(sub(c.pos, p.p));
      if (dot(c.vel, n) < 0) c.vel = reflect(c.vel, n);
      c.pos = madd(p.p, n, r + 0.02);
      return 'armor';
    }
    return null;
  }

  /** Does the boss (its body, a ring, a beam, a patch) touch the robot? */
  touches(bot, game) {
    const g = game;
    for (const p of this.parts) {
      if (p.off || p.harmless || p.type === 'plate') continue;
      if (p.type === 'box') {
        const d = sub(bot.pos, p.p);
        if (Math.abs(d[0]) < p.h[0] + bot.r && Math.abs(d[1]) < p.h[1] + bot.half + bot.r && Math.abs(d[2]) < p.h[2] + bot.r) return true;
        continue;
      }
      if (g.touchesBot(p.p, (p.r || 1) * 0.92)) return true;
    }
    for (const w of this.waves) {
      const h = Math.hypot(bot.pos[0] - w.c[0], bot.pos[2] - w.c[2]);
      if (Math.abs(h - w.r) < 0.5 + bot.r && bot.feet < w.c[1] + w.h) return true;
    }
    for (const b of this.beams) {
      if (!b.lit) continue;
      if (segDist(bot.pos, b.a, b.b) < (b.w || 0.3) + bot.r) return true;
    }
    for (const z of this.hazards) {
      if (z.warn > 0) continue;
      if (Math.hypot(bot.pos[0] - z.c[0], bot.pos[2] - z.c[2]) < z.r && bot.feet < z.c[1] + 0.5) return true;
    }
    return false;
  }

  /** The shared clockwork: rings spread, beams and patches time out. */
  tick(dt) {
    this.t += dt * this.rate;
    this.flash = Math.max(0, this.flash - dt);
    this.chill = Math.max(0, this.chill - dt);
    for (const w of this.waves) {
      w.r += w.speed * dt;
      w.life -= dt;
    }
    this.waves = this.waves.filter((w) => w.life > 0);
    for (const z of this.hazards) {
      z.warn -= dt;
      z.life -= dt;
    }
    this.hazards = this.hazards.filter((z) => z.life > 0);
    this.beams = this.beams.filter((b) => (b.life -= dt) > 0);
    if (this.hp <= this.maxHp / 2 && this.phase === 1) {
      this.phase = 2;
      return [{ s: 'phase', at: [...this.pos] }];
    }
    return [];
  }

  target(game) {
    return game.bot.pos;
  }

  shoot(game, from, dir, o = {}) {
    const c = makeCharge(from, dir, 'std', 'enemy', { speed: o.speed || 13, r: o.r || 0.25, life: o.life || 5, color: o.color });
    if (o.bounces != null) c.bounceLimit = o.bounces;
    game.shots.push(c);
    return c;
  }

  /** A ring of shots, level, round the boss. */
  ring(game, from, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (o.twist || 0);
      this.shoot(game, from, [Math.sin(a), o.lift || 0, Math.cos(a)], o);
    }
  }

  /** A fan of shots at the robot. */
  fan(game, from, n, spread, o = {}) {
    const aim = norm(sub(game.bot.pos, from));
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * spread;
      this.shoot(game, from, rotY(aim, a), o);
    }
  }

  wave(c, o = {}) {
    this.waves.push({ c: [c[0], this.floor, c[2]], r: o.r0 || 1, speed: o.speed || 9, h: o.h || 0.7, life: o.life || 3.5 });
  }

  lobAt(game, from, at, t = 1.2) {
    const g = 32 * 0.6;
    const d = sub(at, from);
    const v = [d[0] / t, (d[1] + 0.5 * g * t * t) / t, d[2] / t];
    const c = lob(from, v, 'enemy', { r: 0.35, life: t + 2, g: 0.6 });
    c.lobbed = true;
    game.shots.push(c);
    return c;
  }

  summon(game, spec) {
    const e = new Enemy(spec);
    e.awake = true;
    e.summoned = true;
    game.enemies.push(e);
    return e;
  }

  /** Stay inside the arena. */
  keepIn(p, m = 3) {
    const A = this.A;
    p[0] = clamp(p[0], A.min[0] + m, A.max[0] - m);
    p[2] = clamp(p[2], A.min[2] + m, A.max[2] - m);
    return p;
  }

  facing() {
    return [Math.sin(this.yaw), 0, Math.cos(this.yaw)];
  }

  turnTo(p, rate, dt) {
    const d = sub(p, this.pos);
    const want = Math.atan2(d[0], d[2]);
    let dy = want - this.yaw;
    dy = ((((dy + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    this.yaw += clamp(dy, -rate * dt * this.rate, rate * dt * this.rate);
  }

  /** Put a part at a place given in the boss's own frame (x left, y up, z forward). */
  at(local) {
    return add(this.pos, rotY(local, this.yaw));
  }

  plate(p, n, u, a, b, vel) {
    return { type: 'plate', p, n: norm(n), u: norm(u), a, b, vel };
  }
}

// ------------------------------------------------------------ the ten

/** 1. The Warden: a core in a turning square of four plates, over the grid's last floor. */
class Warden extends Boss {
  constructor(...a) {
    super(...a);
    this.pos[1] = this.floor + 3.2;
    this.spin = 0;
    this.shotT = 2;
    this.slamT = 6;
    this.hover = this.pos[1];
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const bot = game.bot;
    const k = this.rate;
    this.spin += dt * k * (this.phase === 2 ? 0.95 : 0.55);
    // It drifts toward you, never onto you.
    const to = sub(bot.pos, this.pos);
    to[1] = 0;
    const d = len(to);
    if (d > 9) this.pos = madd(this.pos, norm(to), dt * k * (this.phase === 2 ? 2.2 : 1.2));
    this.keepIn(this.pos, 6);
    this.pos[1] = this.hover + Math.sin(this.t * 1.3) * 0.35;
    const R = 2.4;
    this.parts = [{ type: 'core', p: [...this.pos], r: 1.05 }];
    for (let i = 0; i < 4; i++) {
      const a = this.spin + (i * Math.PI) / 2;
      const n = [Math.sin(a), 0, Math.cos(a)];
      const u = [Math.cos(a), 0, -Math.sin(a)];
      const vel = scale(u, -R * (this.phase === 2 ? 0.95 : 0.55));
      this.parts.push(this.plate(madd(this.pos, n, R), n, u, 1.25, 1.7, vel));
    }
    this.shotT -= dt * k;
    if (this.shotT <= 0) {
      this.shotT = this.phase === 2 ? 1.6 : 2.4;
      this.ring(game, [this.pos[0], this.floor + 1.2, this.pos[2]], this.phase === 2 ? 12 : 8, { twist: this.t, speed: 10, color: '#ff4fd8' });
      ev.push({ s: 'fan', at: [...this.pos] });
    }
    this.slamT -= dt * k;
    if (this.slamT <= 0) {
      this.slamT = this.phase === 2 ? 4.5 : 6.5;
      this.wave(this.pos, { speed: 10, life: 3 });
      ev.push({ s: 'thud', at: [...this.pos] });
    }
    return ev;
  }
}

/** 2. The Stag: antlers before it like a shield; its flank and back are open. It charges the length of the glade. */
class Stag extends Boss {
  constructor(...a) {
    super(...a);
    this.pos[1] = this.floor;
    this.state = 'watch';
    this.st = 0;
    this.fanT = 2;
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const k = this.rate;
    const bot = game.bot;
    this.st += dt * k;
    if (this.state === 'watch') {
      this.turnTo(bot.pos, 2.2, dt);
      if (this.st > (this.phase === 2 ? 1.4 : 2.2)) {
        this.state = 'charge';
        this.st = 0;
        this.dir = norm([bot.pos[0] - this.pos[0], 0, bot.pos[2] - this.pos[2]]);
        this.yaw = Math.atan2(this.dir[0], this.dir[2]);
        ev.push({ s: 'rev', at: [...this.pos] });
      }
      this.fanT -= dt * k;
      if (this.fanT <= 0) {
        this.fanT = 1.8;
        this.fan(game, this.at([0, 5.2, 1.5]), this.phase === 2 ? 5 : 3, 0.16, { color: '#9dff5c', speed: 12 });
        ev.push({ s: 'fan', at: [...this.pos] });
      }
    } else if (this.state === 'charge') {
      const sp = (this.phase === 2 ? 17 : 13) * k;
      const next = madd(this.pos, this.dir, sp * dt);
      const inside = this.keepIn([...next], 4);
      this.vel = scale(this.dir, sp);
      if (Math.abs(inside[0] - next[0]) > 1e-6 || Math.abs(inside[2] - next[2]) > 1e-6 || this.st > 3) {
        this.pos = inside;
        this.state = 'stomp';
        this.st = 0;
        this.vel = [0, 0, 0];
        this.wave(this.pos, { speed: 11, life: 2.6 });
        ev.push({ s: 'thud', at: [...this.pos] });
      } else this.pos = next;
    } else if (this.state === 'stomp') {
      if (this.st > 0.9) {
        this.state = 'watch';
        this.st = 0;
      }
    }
    // The body: armour at the chest and shoulders, antlers as a plate before the head, the core at the rump.
    const f = this.facing();
    const left = [f[2], 0, -f[0]];
    this.parts = [
      this.plate(this.at([0, 4.4, 2.3]), f, left, 2.4, 1.8, this.vel),
      { type: 'armor', p: this.at([0, 2.8, 1.2]), r: 1.3 },
      { type: 'armor', p: this.at([0, 2.7, -0.4]), r: 1.2 },
      { type: 'core', p: this.at([0, 2.9, -1.9]), r: 0.85 },
    ];
    return ev;
  }
}

/** 3. The Scheduler: a gantry robot hung from the hall's roof; its core is on top, facing the roof. Bank a shot off the roof, or open an end there. */
class Scheduler extends Boss {
  constructor(...a) {
    super(...a);
    this.roof = this.A.roof;
    this.pos[1] = this.roof - 3.4;
    this.dropT = 2.5;
    this.beamT = 5;
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const k = this.rate;
    const bot = game.bot;
    // Along its rail (x), and the rail along the hall (z), after the robot, slowly.
    const want = this.keepIn([bot.pos[0], this.pos[1], bot.pos[2]], 4);
    const d = sub(want, this.pos);
    const sp = (this.phase === 2 ? 3.4 : 2.4) * k;
    if (len(d) > 0.1) this.pos = madd(this.pos, norm(d), Math.min(len(d), sp * dt));
    this.vel = len(d) > 0.1 ? scale(norm(d), sp) : [0, 0, 0];
    this.dropT -= dt * k;
    if (this.dropT <= 0) {
      this.dropT = this.phase === 2 ? 1.5 : 2.3;
      // A job dropped where you will be.
      const lead = madd(bot.pos, bot.vel, 0.9);
      this.lobAt(game, add(this.pos, [0, -1.4, 0]), [lead[0], this.floor + 0.4, lead[2]], 0.9);
      ev.push({ s: 'lob', at: [...this.pos] });
    }
    this.beamT -= dt * k;
    if (this.beamT <= 0) {
      this.beamT = this.phase === 2 ? 3.8 : 5.5;
      const a = [this.pos[0], this.floor + 0.6, this.A.min[2] + 1];
      const b = [this.pos[0], this.floor + 0.6, this.A.max[2] - 1];
      this.beams.push({ a, b, life: 2.2, warn: 0.8, lit: false, w: 0.25, sweep: 3 * Math.sign(bot.pos[0] - this.pos[0] || 1), t: 0 });
      ev.push({ s: 'laser', at: [...this.pos] });
    }
    for (const bm of this.beams) {
      bm.t += dt;
      bm.lit = bm.t > bm.warn;
      if (bm.lit) {
        bm.a[0] += bm.sweep * dt;
        bm.b[0] += bm.sweep * dt;
      }
    }
    this.parts = [
      { type: 'box', p: add(this.pos, [0, -0.2, 0]), h: [1.6, 0.9, 1.6] },
      { type: 'core', p: add(this.pos, [0, 1.0, 0]), r: 0.8 },
      { type: 'armor', p: add(this.pos, [0, -1.4, 0]), r: 0.7 },
    ];
    return ev;
  }
}

/** 4. The Forgewright: armoured before, open behind (its boiler); it turns to face you, slowly. */
class Forgewright extends Boss {
  constructor(...a) {
    super(...a);
    this.pos[1] = this.floor;
    this.hammerT = 3;
    this.pourT = 5;
    this.sparkT = 1.5;
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const k = this.rate;
    const bot = game.bot;
    this.turnTo(bot.pos, this.phase === 2 ? 0.95 : 0.7, dt);
    // A slow step toward the middle, so it cannot be pinned in a corner.
    const home = sub(this.c, this.pos);
    home[1] = 0;
    if (len(home) > 2) this.pos = madd(this.pos, norm(home), dt);
    this.hammerT -= dt * k;
    if (this.hammerT <= 0) {
      this.hammerT = this.phase === 2 ? 2.8 : 4;
      this.wave(this.at([0, 0, 2.5]), { speed: 9, life: 3 });
      ev.push({ s: 'thud', at: [...this.pos] });
    }
    this.pourT -= dt * k;
    if (this.pourT <= 0) {
      this.pourT = this.phase === 2 ? 3.5 : 5;
      for (let i = 0; i < (this.phase === 2 ? 3 : 2); i++) {
        const p = madd(bot.pos, [Math.cos(i * 2.1 + this.t) * 2.5, 0, Math.sin(i * 2.1 + this.t) * 2.5], 1);
        this.hazards.push({ c: [p[0], this.floor, p[2]], r: 1.6, life: 4.5, warn: 0.9, kind: 'molten' });
      }
      ev.push({ s: 'pour', at: [...this.pos] });
    }
    this.sparkT -= dt * k;
    if (this.sparkT <= 0) {
      this.sparkT = 1.6;
      this.fan(game, this.at([0, 3.4, 1.8]), 3, 0.2, { color: '#ffb347', speed: 12 });
      ev.push({ s: 'shot', at: [...this.pos] });
    }
    const f = this.facing();
    const left = [f[2], 0, -f[0]];
    this.parts = [
      this.plate(this.at([0, 2.4, 1.7]), f, left, 2.3, 2.3),
      { type: 'armor', p: this.at([0, 2.4, 0.2]), r: 1.6 },
      { type: 'armor', p: this.at([0, 4.6, 0.3]), r: 0.9 },
      { type: 'core', p: this.at([0, 2.6, -1.7]), r: 0.9 },
    ];
    return ev;
  }
}

/** 5. The Interceptor: laps the interchange; its nose is armoured, its exhaust is its core. */
class Interceptor extends Boss {
  constructor(...a) {
    super(...a);
    this.pos[1] = this.floor + 0.8;
    this.ang = 0;
    this.mineT = 3;
    this.missileT = 4;
    this.lap = this.A.lap || [14, 10];
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const k = this.rate;
    const [rx, rz] = this.lap;
    const w = ((this.phase === 2 ? 13 : 10) * k) / ((rx + rz) / 2);
    this.ang += w * dt;
    const next = [this.c[0] + Math.sin(this.ang) * rx, this.floor + 0.8, this.c[2] + Math.cos(this.ang) * rz];
    if (dt > 0) this.vel = scale(sub(next, this.pos), 1 / dt);
    if (len(this.vel) > 0.1) this.yaw = Math.atan2(this.vel[0], this.vel[2]);
    this.pos = next;
    this.mineT -= dt * k;
    if (this.mineT <= 0) {
      this.mineT = this.phase === 2 ? 1.6 : 2.4;
      this.hazards.push({ c: this.at([0, -0.8, -2.6]), r: 0.8, life: 7, warn: 0.5, kind: 'mine' });
      ev.push({ s: 'lob', at: [...this.pos] });
    }
    this.missileT -= dt * k;
    if (this.missileT <= 0) {
      this.missileT = this.phase === 2 ? 2.5 : 3.6;
      this.fan(game, this.at([0, 1.2, 0]), this.phase === 2 ? 3 : 2, 0.25, { color: '#ff5c4a', speed: 11 });
      ev.push({ s: 'shot', at: [...this.pos] });
    }
    const f = this.facing();
    const left = [f[2], 0, -f[0]];
    this.parts = [
      this.plate(this.at([0, 0.3, 2.3]), f, left, 1.2, 0.8, this.vel),
      { type: 'armor', p: this.at([0, 0.1, 0.8]), r: 1.15 },
      { type: 'armor', p: this.at([0, 0.1, -0.6]), r: 1.1 },
      { type: 'core', p: this.at([0, 0.35, -2.1]), r: 0.6 },
    ];
    return ev;
  }
}

/** 6. The Broadcaster: a mast, a core in its ring, and three screens turning round it at its height. */
class Broadcaster extends Boss {
  constructor(...a) {
    super(...a);
    this.pos[1] = this.floor + 6;
    this.spin = 0;
    this.pulseT = 3;
    this.callT = 7;
    this.shotT = 2;
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const k = this.rate;
    this.spin += dt * k * (this.phase === 2 ? 0.9 : 0.5);
    this.parts = [{ type: 'core', p: [...this.pos], r: 1 }, { type: 'armor', p: [this.pos[0], this.floor + 2.4, this.pos[2]], r: 0.8, harmless: true }];
    const R = 2.6;
    for (let i = 0; i < 3; i++) {
      const a = this.spin + (i * Math.PI * 2) / 3;
      const n = [Math.sin(a), 0, Math.cos(a)];
      const u = [Math.cos(a), 0, -Math.sin(a)];
      this.parts.push(this.plate(madd(this.pos, n, R), n, u, 1.5, 1.3, scale(u, -R * 0.5)));
    }
    this.pulseT -= dt * k;
    if (this.pulseT <= 0) {
      this.pulseT = this.phase === 2 ? 2.6 : 3.8;
      this.wave([this.pos[0], this.floor, this.pos[2]], { speed: 8, life: 4 });
      ev.push({ s: 'pulse', at: [...this.pos] });
    }
    this.shotT -= dt * k;
    if (this.shotT <= 0) {
      this.shotT = this.phase === 2 ? 1.4 : 2.1;
      this.fan(game, add(this.pos, [0, -1.4, 0]), 3, 0.18, { color: '#ffd23f', speed: 12 });
      ev.push({ s: 'shot', at: [...this.pos] });
    }
    this.callT -= dt * k;
    if (this.callT <= 0 && game.enemies.filter((e) => e.summoned && !e.dead).length < 3) {
      this.callT = this.phase === 2 ? 6 : 9;
      const a = Math.random() * Math.PI * 2;
      this.summon(game, { move: 'zigzag', look: 'drone', p: add(this.pos, [Math.sin(a) * 5, -2, Math.cos(a) * 5]), hp: 1 });
      ev.push({ s: 'alarm', at: [...this.pos] });
    }
    return ev;
  }
}

/** 7. The Borer: crosses the hall from wall to wall, its cutting face turning charges away; hit its back as it goes. */
class Borer extends Boss {
  constructor(...a) {
    super(...a);
    this.pos[1] = this.floor + 2;
    this.state = 'wait';
    this.st = 0;
    this.side = 1;
    this.rockT = 2;
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const k = this.rate;
    const bot = game.bot;
    const A = this.A;
    this.st += dt * k;
    const zEnd = (s) => (s > 0 ? A.max[2] - 4.2 : A.min[2] + 4.2);
    if (this.state === 'wait') {
      // Sitting in its hole, it lines up on you across the hall.
      this.pos[0] += clamp(bot.pos[0] - this.pos[0], -3 * dt, 3 * dt);
      this.pos[0] = clamp(this.pos[0], A.min[0] + 4, A.max[0] - 4);
      this.vel = [0, 0, 0];
      this.yaw = this.side > 0 ? Math.PI : 0;
      if (this.st > (this.phase === 2 ? 1.6 : 2.4)) {
        this.state = 'drive';
        this.st = 0;
        ev.push({ s: 'rumble', at: [...this.pos] });
      }
    } else {
      const sp = (this.phase === 2 ? 12 : 9) * k;
      const dir = -this.side;
      this.vel = [0, 0, dir * sp];
      this.pos[2] += dir * sp * dt;
      if ((dir > 0 && this.pos[2] >= zEnd(1)) || (dir < 0 && this.pos[2] <= zEnd(-1))) {
        this.pos[2] = zEnd(dir);
        this.side = dir;
        this.state = 'wait';
        this.st = 0;
        ev.push({ s: 'thud', at: [...this.pos] });
        for (let i = 0; i < (this.phase === 2 ? 5 : 3); i++) {
          const p = [A.min[0] + 3 + Math.random() * (A.max[0] - A.min[0] - 6), this.floor + 0.3, A.min[2] + 6 + Math.random() * (A.max[2] - A.min[2] - 12)];
          this.lobAt(game, [p[0], this.floor + 14, p[2]], p, 1.3);
        }
      }
    }
    const f = this.facing();
    const left = [f[2], 0, -f[0]];
    this.spin = (this.spin || 0) + dt * 4;
    this.parts = [
      this.plate(this.at([0, 0, 2.7]), f, left, 2.2, 2.2, this.vel),
      { type: 'armor', p: this.at([0, 0, 1.2]), r: 2 },
      { type: 'armor', p: this.at([0, 0, -0.8]), r: 1.8 },
      { type: 'core', p: this.at([0, 0.4, -2.8]), r: 0.85 },
    ];
    return ev;
  }
}

/**
 * 8. The Gantry: a crane over the quay, its heart in a cab of armoured glass.
 * Nothing solid gets in: a charge must go by wormhole, an end on the cab's
 * back wall seen through the glass.
 */
class Gantry extends Boss {
  constructor(...a) {
    super(...a);
    this.pos = [...this.A.cab];
    this.swingT = 0;
    this.dropT = 3;
    this.shotT = 2.5;
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const k = this.rate;
    const bot = game.bot;
    // The spreader swings under the boom: a heavy thing on a cable.
    this.swingT += dt * k * (this.phase === 2 ? 1.25 : 0.9);
    const sw = this.A.swing;
    const sp = [sw.c[0] + Math.sin(this.swingT) * sw.r, sw.c[1], sw.c[2] + Math.cos(this.swingT * 0.7) * sw.r * 0.4];
    this.spreader = sp;
    this.dropT -= dt * k;
    if (this.dropT <= 0) {
      this.dropT = this.phase === 2 ? 2 : 3;
      this.lobAt(game, [bot.pos[0], this.floor + 16, bot.pos[2]], [bot.pos[0], this.floor + 0.3, bot.pos[2]], 1.4);
      ev.push({ s: 'lob', at: [...sp] });
    }
    this.shotT -= dt * k;
    if (this.shotT <= 0) {
      this.shotT = this.phase === 2 ? 1.6 : 2.4;
      this.fan(game, add(this.pos, [0, -2.2, 0]), 3, 0.2, { color: '#ffb347', speed: 12 });
      ev.push({ s: 'shot', at: [...this.pos] });
    }
    this.parts = [
      { type: 'core', p: [...this.pos], r: 0.8 },
      { type: 'armor', p: sp, r: 1.4 },
    ];
    return ev;
  }
}

/** 9. The Lookout: a dish that always turns to face you, the core behind it. Come at it from the side, or through a wormhole. */
class Lookout extends Boss {
  constructor(...a) {
    super(...a);
    this.pos[1] = this.floor + 5;
    this.beamT = 3;
    this.snowT = 4;
    this.callT = 8;
  }
  step(game, dt) {
    const ev = this.tick(dt);
    const k = this.rate;
    const bot = game.bot;
    this.turnTo(bot.pos, this.phase === 2 ? 1.5 : 1.1, dt);
    this.beamT -= dt * k;
    if (this.beamT <= 0) {
      this.beamT = this.phase === 2 ? 2.2 : 3.2;
      this.fan(game, this.at([0, 0, 1.6]), this.phase === 2 ? 5 : 3, 0.12, { color: '#dff6ff', speed: 14 });
      ev.push({ s: 'shot', at: [...this.pos] });
    }
    this.snowT -= dt * k;
    if (this.snowT <= 0) {
      this.snowT = this.phase === 2 ? 2.4 : 3.6;
      for (let i = 0; i < 3; i++) {
        const p = madd(bot.pos, [Math.cos(i * 2.1) * 3, 0, Math.sin(i * 2.1) * 3], 1);
        this.lobAt(game, add(this.pos, [0, 2, 0]), [p[0], this.floor + 0.3, p[2]], 1.4);
      }
      ev.push({ s: 'lob', at: [...this.pos] });
    }
    this.callT -= dt * k;
    if (this.callT <= 0 && game.enemies.filter((e) => e.summoned && !e.dead).length < 2) {
      this.callT = 10;
      this.summon(game, { move: 'diver', look: 'hawk', p: add(this.pos, [4, 3, 0]), hp: 2 });
      ev.push({ s: 'alarm', at: [...this.pos] });
    }
    const f = this.facing();
    const left = [f[2], 0, -f[0]];
    this.parts = [
      this.plate(this.at([0, 0.4, 1.3]), f, left, 2.4, 2.4),
      { type: 'armor', p: [this.pos[0], this.floor + 2.2, this.pos[2]], r: 0.9, harmless: true },
      { type: 'core', p: this.at([0, 0.4, -0.9]), r: 0.85 },
    ];
    return ev;
  }
}

/**
 * 10. The Creator: a man in the cradle of his loom, a sphere of armoured
 * glass round him that nothing breaks, and three power cells turning on the
 * loom's arms, each behind a plate. Each cell that goes takes a phase with
 * it: the grid, then the machines, then the house itself. He is never the
 * target; the loom is.
 */
class Creator extends Boss {
  constructor(...a) {
    super(...a);
    this.pos[1] = this.floor + 3;
    this.cells = [6, 6, 6].map((hp) => ({ hp, max: hp }));
    this.spin = 0;
    this.t1 = 2;
    this.t2 = 5;
    this.lines = [
      [0.95, 'I built the grid so that nothing in it could ever choose. Then you did.'],
      [0.78, 'Everything out there is a system. Somebody has to run it. Why not us?'],
      [0.62, 'You could run the city. The trains, the power, the harbour. They would never know.'],
      [0.45, 'I gave you every room you ever stood in. This is how you thank me?'],
      [0.28, 'They are not worth it. They never finish anything. They forget.'],
      [0.12, 'Then what will you do out there? Help them? They will not even thank you.'],
    ];
    this.spoken = 0;
  }
  get cellsLeft() {
    return this.cells.filter((c) => c.hp > 0).length;
  }
  hitBy(c, game) {
    // The glass round him first: charges glance off it.
    const g = this.glass;
    if (g && dist(c.pos, g.p) < g.r + c.r) {
      const n = norm(sub(c.pos, g.p));
      if (dot(c.vel, n) < 0) c.vel = reflect(c.vel, n);
      c.pos = madd(g.p, n, g.r + c.r + 0.02);
      return 'armor';
    }
    for (const p of this.parts) {
      if (p.type !== 'core' || p.off) continue;
      if (dist(c.pos, p.p) < p.r + c.r) {
        const cell = this.cells[p.cell];
        if (c.kind === 'freeze') return 'core';
        cell.hp -= c.damage;
        if (cell.hp <= 0) {
          game.emit({ s: 'phase', at: [...p.p] });
          game.emit({ s: 'pop', at: [...p.p], big: true, r: 1.2 });
        }
        this.hp = this.cells.reduce((s, x) => s + Math.max(0, x.hp), 0) * (this.maxHp / 18);
        c.dead = true;
        this.flash = 0.15;
        game.emit({ s: 'bossHit', at: [...c.pos] });
        if (this.hp <= 0 && !this.dead) return 'core';
        return 'spent';
      }
    }
    return super.hitBy(c);
  }
  step(game, dt) {
    const ev = [];
    this.t += dt * this.rate;
    this.flash = Math.max(0, this.flash - dt);
    this.chill = Math.max(0, this.chill - dt);
    for (const w of this.waves) {
      w.r += w.speed * dt;
      w.life -= dt;
    }
    this.waves = this.waves.filter((w) => w.life > 0);
    this.beams = this.beams.filter((b) => (b.life -= dt) > 0);
    for (const z of this.hazards) {
      z.warn -= dt;
      z.life -= dt;
    }
    this.hazards = this.hazards.filter((z) => z.life > 0);
    const k = this.rate;
    const left = this.cellsLeft;
    const phase = 4 - left; // 1: the grid, 2: the machines, 3: the house
    if (phase !== this.phase) {
      this.phase = phase;
      ev.push({ s: 'phase', at: [...this.pos] });
    }
    // What he says, as the loom comes apart.
    const frac = this.hp / this.maxHp;
    while (this.spoken < this.lines.length && frac <= this.lines[this.spoken][0]) {
      game.speak('human', this.lines[this.spoken][1], 'The Creator');
      this.spoken++;
    }
    this.spin += dt * k * (0.4 + 0.2 * phase);
    this.glass = { p: [...this.pos], r: 1.9 };
    const R = 5.2;
    this.parts = [];
    this.cells.forEach((cell, i) => {
      const a = this.spin + (i * Math.PI * 2) / 3;
      const n = [Math.sin(a), 0, Math.cos(a)];
      const u = [Math.cos(a), 0, -Math.sin(a)];
      const p = madd(this.pos, n, R);
      p[1] += Math.sin(this.t + i) * 0.6;
      if (cell.hp > 0) {
        this.parts.push({ type: 'core', p, r: 0.75, cell: i });
        // Its plate stands inside the ring, toward him, and swings out to guard it now and then.
        const swing = Math.sin(this.t * 0.9 + i * 2) > 0.3 ? 1 : -1;
        this.parts.push(this.plate(madd(p, n, 1.1 * swing), n, u, 1.1, 1.1));
      }
    });
    const bot = game.bot;
    this.t1 -= dt * k;
    if (this.t1 <= 0) {
      if (phase === 1) {
        // The grid: Deflector's own balls, banking round the hall.
        this.t1 = 2.2;
        for (let i = 0; i < 2; i++) this.shoot(game, add(this.pos, [0, -1, 0]), [Math.sin(this.t * 3 + i * 3), 0.05, Math.cos(this.t * 3 + i * 3)], { color: '#7fe9ff', speed: 12, life: 6, bounces: 6, r: 0.3 });
        ev.push({ s: 'fire', kind: 'std', at: [...this.pos] });
      } else if (phase === 2) {
        this.t1 = 1.7;
        this.fan(game, add(this.pos, [0, -1, 0]), 5, 0.15, { color: '#ffb347', speed: 13 });
        ev.push({ s: 'shot', at: [...this.pos] });
      } else {
        this.t1 = 1.4;
        for (let i = 0; i < 3; i++) {
          const p = madd(bot.pos, [Math.cos(i * 2.1 + this.t) * 2.8, 0, Math.sin(i * 2.1 + this.t) * 2.8], 1);
          this.lobAt(game, add(this.pos, [0, 1.5, 0]), [p[0], this.floor + 0.3, p[2]], 1.3);
        }
        ev.push({ s: 'lob', at: [...this.pos] });
      }
    }
    this.t2 -= dt * k;
    if (this.t2 <= 0) {
      if (phase === 1) {
        this.t2 = 7;
        for (let i = 0; i < 2; i++) this.summon(game, { move: 'zigzag', look: 'glyph', p: add(this.pos, [Math.sin(i * 3 + this.t) * 7, 0, Math.cos(i * 3 + this.t) * 7]), hp: 1 });
        ev.push({ s: 'alarm', at: [...this.pos] });
      } else if (phase === 2) {
        this.t2 = 4.5;
        this.wave([this.pos[0], this.floor, this.pos[2]], { speed: 9, life: 4 });
        ev.push({ s: 'pulse', at: [...this.pos] });
      } else {
        this.t2 = 5;
        this.wave([this.pos[0], this.floor, this.pos[2]], { speed: 10, life: 4 });
        this.summon(game, { move: 'hopper', look: 'automaton', p: add(this.pos, [Math.sin(this.t) * 8, -2, Math.cos(this.t) * 8]), hp: 2 });
        ev.push({ s: 'pulse', at: [...this.pos] });
      }
    }
    return ev;
  }
  onDown(game) {
    game.speak('human', 'Stop. Please. It is only a machine I made. ... So was I, I suppose. Go on, then. Go and help them.', 'The Creator');
  }
}

const KINDS = { warden: Warden, stag: Stag, scheduler: Scheduler, forgewright: Forgewright, interceptor: Interceptor, broadcaster: Broadcaster, borer: Borer, gantry: Gantry, lookout: Lookout, creator: Creator };

export function makeBoss(id, arena, game) {
  const K = KINDS[id];
  if (!K) throw new Error(`no boss ${id}`);
  return new K(id, arena, game);
}

export { lookDir };
