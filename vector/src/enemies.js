// Enemies: the Creator's machines, from the grid's polyhedra in the first
// level to clockwork in the last. What they look like is the level's (its
// roster names a look for each); how they move is one of a few ways, as in
// Defector: walk, chase, hop, fly a line, circle, zig-zag, dive, stand and
// shoot. Each is a ball in the world's physics, so it stands on floors, turns
// at ledges, is frozen into a block to stand on, and goes through wormholes.
// DOM-free.
import { ACTIVE, POWER } from './config.js';
import { dot, len, madd, norm, sub, add, scale, dist, clamp } from './math.js';
import { portalSphere } from './wormholes.js';
import { makeCharge } from './blaster.js';

/**
 * The ways of moving, and their defaults: speed (m/s), toughness, radius (m),
 * whether a stomp from above ends it, whether it shoots.
 */
export const MOVES = {
  walker: { speed: 2.4, hp: 1, r: 0.55, stomp: true, gravity: true },
  trundle: { speed: 1.4, hp: 4, r: 0.95, stomp: true, gravity: true },
  chaser: { speed: 5.2, hp: 2, r: 0.55, stomp: true, gravity: true, sight: 20 },
  hopper: { speed: 3.5, hp: 2, r: 0.6, stomp: true, gravity: true, sight: 18 },
  flier: { speed: 3, hp: 1, r: 0.5, stomp: false },
  circler: { speed: 2.5, hp: 2, r: 0.5, stomp: false },
  zigzag: { speed: 3.2, hp: 1, r: 0.45, stomp: false, sight: 22 },
  diver: { speed: 11, hp: 2, r: 0.55, stomp: false, sight: 16 },
  turret: { speed: 0, hp: 3, r: 0.65, stomp: false, shoots: 1.8, sight: 30 },
  gunner: { speed: 2.5, hp: 2, r: 0.55, stomp: false, shoots: 2.4, sight: 26 },
  lancer: { speed: 2, hp: 3, r: 0.6, stomp: false, gravity: true, shield: true, sight: 22 },
};

let nextId = 1;

export class Enemy {
  /** `spec`: { move, look, p, to (the far end of a patrol), hp, r, speed, folded, shoots, spiky, color } */
  constructor(spec) {
    const M = MOVES[spec.move] || MOVES.walker;
    this.id = nextId++;
    this.spec = spec;
    this.move = spec.move;
    this.look = spec.look || spec.move;
    this.home = [...spec.p];
    this.pos = [...spec.p];
    this.vel = [0, 0, 0];
    this.to = spec.to ? [...spec.to] : null;
    this.r = spec.r ?? M.r;
    this.hp = spec.hp ?? M.hp;
    this.maxHp = this.hp;
    this.speed = spec.speed ?? M.speed;
    this.gravity = !!M.gravity;
    this.stompable = (spec.stomp ?? M.stomp) && !spec.spiky;
    this.shootEvery = spec.shoots ?? M.shoots ?? 0;
    this.sight = spec.sight ?? M.sight ?? 18;
    this.shield = !!(spec.shield ?? M.shield);
    this.folded = !!spec.folded;
    this.color = spec.color;
    this.yaw = spec.yaw ?? 0;
    this.dir = 1; // along its patrol
    this.t = Math.random() * 3;
    this.cool = 0.5 + Math.random() * this.shootEvery;
    this.awake = false;
    this.frozen = 0;
    this.dead = false;
    this.onGround = false;
    this.seen = false;
    this.seenT = 0;
    this.state = 'idle';
    this.flash = 0;
    this.mouth = null;
    this.drops = spec.drops || null;
    this.orbit = spec.orbit || null;
    this.phase = Math.random() * Math.PI * 2;
    this.ice = null; // a frozen enemy is a block to stand on
  }
}

/** Is there a clear line from a to b (glass counts as clear to see, not to shoot)? */
export function sees(world, a, b, glass = true) {
  const d = sub(b, a);
  const L = len(d);
  if (L < 1e-3) return true;
  const h = world.raycast(a, scale(d, 1 / L), L - 0.3, glass ? { glass: 'through' } : {});
  return !h;
}

/**
 * One step for one enemy. `bot` is the robot it goes after (the nearest).
 * Returns events: shots fired, and so on. `shots` collects its charges.
 */
export function stepEnemy(e, world, bot, ends, dt, shots) {
  const ev = [];
  if (e.dead) return ev;
  const toBot = sub(bot.pos, e.pos);
  const d = len(toBot);
  // Asleep until the robot comes near; back to sleep once it is far past.
  if (!e.awake) {
    if (d < ACTIVE.wake) e.awake = true;
    else return ev;
  } else if (d > ACTIVE.sleep) {
    e.awake = false;
    return ev;
  }
  e.flash = Math.max(0, e.flash - dt);
  if (e.frozen > 0) {
    e.frozen -= dt;
    if (e.frozen <= 0) thaw(e, world);
    return ev;
  }
  e.t += dt;
  // Seeing the robot: checked a few times a second, not every step.
  e.seenT -= dt;
  if (e.seenT <= 0) {
    e.seenT = 0.25;
    e.seen = d < e.sight && sees(world, e.pos, bot.eyePos());
  }
  const flat = norm([toBot[0], 0, toBot[2]]);
  const M = e.move;
  let want = null; // a velocity it steers toward
  if (M === 'walker' || M === 'trundle' || M === 'lancer' || ((M === 'chaser' || M === 'hopper') && !e.seen)) {
    // Up and down its patrol; round at the ends, a wall or a ledge.
    const axis = e.to ? norm(sub([e.to[0], e.home[1], e.to[2]], e.home)) : [Math.sin(e.yaw), 0, Math.cos(e.yaw)];
    const span = e.to ? dist([e.to[0], 0, e.to[2]], [e.home[0], 0, e.home[2]]) : 6;
    const along = dot(sub(e.pos, e.home), axis);
    if (along > span && e.dir > 0) e.dir = -1;
    if (along < 0 && e.dir < 0) e.dir = 1;
    want = scale(axis, e.dir * e.speed);
    if (e.onGround && ledgeAhead(world, e, want)) {
      e.dir *= -1;
      want = scale(want, -1);
    }
    if (M === 'lancer' && e.seen) want = scale(flat, e.speed * 0.6);
  } else if (M === 'chaser') {
    want = scale(flat, e.speed);
    if (e.onGround && ledgeAhead(world, e, want)) want = [0, 0, 0];
  } else if (M === 'hopper') {
    want = [e.vel[0], 0, e.vel[2]];
    if (e.onGround) {
      want = [0, 0, 0];
      if (e.t > 1.3) {
        e.t = 0;
        const reach = Math.min(d, 7);
        const hv = scale(flat, reach / 1.0);
        if (!ledgeAhead(world, e, hv, 2.5)) {
          e.vel = [hv[0], 9.5, hv[2]];
          e.onGround = false;
          ev.push({ s: 'boing', at: [...e.pos] });
        }
      }
    }
  } else if (M === 'flier') {
    const a = e.home;
    const b = e.to || add(e.home, [0, 3, 0]);
    const span = dist(a, b);
    const k = (Math.sin((e.t * e.speed) / Math.max(1, span) * Math.PI) + 1) / 2;
    const target = add(a, scale(sub(b, a), k));
    want = scale(sub(target, e.pos), 4);
  } else if (M === 'circler') {
    const R = e.spec.radius || 3;
    const ang = e.phase + (e.t * e.speed) / R;
    const target = e.orbit ? add(e.orbit.c, [Math.cos(ang) * e.orbit.rx, Math.sin(ang * 2) * 0.4, Math.sin(ang) * e.orbit.rz]) : add(e.home, [Math.cos(ang) * R, Math.sin(ang * 2) * 0.5, Math.sin(ang) * R]);
    want = scale(sub(target, e.pos), 4);
  } else if (M === 'zigzag') {
    // Side to side, drifting toward the robot's height and a little toward it.
    const side = [-flat[2], 0, flat[0]];
    const sway = Math.sin(e.t * 2.4 + e.phase) * e.speed;
    const hy = clamp(bot.pos[1] + 0.5 - e.pos[1], -1.5, 1.5);
    const close = e.seen && d > 7 ? 1.2 : e.seen && d < 4 ? -1.5 : 0;
    const leash = sub(e.home, e.pos);
    const back = len(leash) > 10 ? scale(norm(leash), 2) : [0, 0, 0];
    want = add(add(scale(side, sway), [0, hy * 1.5, 0]), add(scale(flat, close), back));
  } else if (M === 'diver') {
    if (e.state === 'idle') {
      want = scale(sub(add(e.home, [0, Math.sin(e.t * 1.5) * 0.3, 0]), e.pos), 3);
      if (e.seen && d < e.sight && e.t > 1.5) {
        e.state = 'dive';
        e.aim = [...bot.pos];
        e.t = 0;
        ev.push({ s: 'rev', at: [...e.pos] });
      }
    } else if (e.state === 'dive') {
      const to = sub(e.aim, e.pos);
      want = scale(norm(to), e.speed);
      if (len(to) < 0.8 || e.t > 2.2) {
        e.state = 'climb';
        e.t = 0;
      }
    } else {
      want = scale(norm(sub(e.home, e.pos)), e.speed * 0.45);
      if (dist(e.home, e.pos) < 0.6 || e.t > 4) {
        e.state = 'idle';
        e.t = 0;
      }
    }
  } else if (M === 'turret') {
    want = [0, 0, 0];
  } else if (M === 'gunner') {
    const a = e.home;
    const b = e.to || add(e.home, [3, 0, 0]);
    const k = (Math.sin(e.t * 0.6) + 1) / 2;
    want = scale(sub(add(a, scale(sub(b, a), k)), e.pos), 3);
  }
  if (e.seen || M === 'turret') {
    const tgt = Math.atan2(toBot[0], toBot[2]);
    e.yaw += clamp(wrap(tgt - e.yaw), -3 * dt, 3 * dt);
  } else if (want && Math.hypot(want[0], want[2]) > 0.3) {
    e.yaw += clamp(wrap(Math.atan2(want[0], want[2]) - e.yaw), -6 * dt, 6 * dt);
  }

  // Motion: walkers accelerate along the ground and fall; fliers steer freely.
  if (e.gravity) {
    const acc = 14 * dt;
    e.vel[0] += clamp(want[0] - e.vel[0], -acc, acc);
    e.vel[2] += clamp(want[2] - e.vel[2], -acc, acc);
    e.vel[1] -= 30 * dt;
  } else if (want) {
    const acc = 10 * dt;
    for (let i = 0; i < 3; i++) e.vel[i] += clamp(want[i] - e.vel[i], -acc * Math.max(1, e.speed / 3), acc * Math.max(1, e.speed / 3));
  }
  const f = world.field(e.pos, 0.6);
  e.vel = madd(e.vel, f, dt);
  e.pos = madd(e.pos, e.vel, dt);
  const w = portalSphere(e, ends);
  if (w) {
    ev.push({ s: 'warp', at: [...e.pos], from: w.from, to: w.to });
    // Through a wormhole it forgets its beat and patrols where it came out.
    e.home = [...e.pos];
    e.to = null;
    e.orbit = null;
  }
  collide(e, world);
  if (world.horizon(e.pos, e.r)) {
    e.dead = true;
    ev.push({ s: 'swallow', at: [...e.pos], enemy: e });
  }
  if (world.floorY !== undefined && e.pos[1] < world.floorY - 16) e.dead = true;

  // Shooting: at the robot, when it can see it, every so often.
  if (e.shootEvery && e.seen) {
    e.cool -= dt;
    if (e.cool <= 0) {
      e.cool = e.shootEvery * (0.8 + Math.random() * 0.4);
      const from = add(e.pos, scale(norm(sub(bot.eyePos(), e.pos)), e.r + 0.25));
      const aim = norm(sub(add(bot.pos, scale(bot.vel, d / 13 * 0.5)), from));
      const n = e.spec.volley || 1;
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.12;
        const dir = [aim[0] * Math.cos(spread) - aim[2] * Math.sin(spread), aim[1], aim[0] * Math.sin(spread) + aim[2] * Math.cos(spread)];
        shots.push(makeCharge(from, dir, 'std', 'enemy', { speed: 13, r: 0.2, life: 4, color: e.spec.shotColor }));
      }
      ev.push({ s: 'shot', at: [...e.pos], kind: e.look });
    }
  }
  return ev;
}

function wrap(a) {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/** Would a step the way it is going leave the ground (or walk into a wall)? */
function ledgeAhead(world, e, v, drop = 1.2) {
  const sp = Math.hypot(v[0], v[2]);
  if (sp < 0.01) return false;
  const ahead = [e.pos[0] + (v[0] / sp) * (e.r + 0.35), e.pos[1], e.pos[2] + (v[2] / sp) * (e.r + 0.35)];
  const down = world.raycast(ahead, [0, -1, 0], e.r + drop);
  if (!down) return true;
  const wall = world.raycast(e.pos, [v[0] / sp, 0, v[2] / sp], e.r + 0.3);
  return !!wall;
}

function collide(e, world) {
  e.onGround = false;
  for (let i = 0; i < 4; i++) {
    let best = null;
    world.sphereContacts(e.pos, e.r, (s) => s === (e.mouth && e.mouth.host) || s.ice === e, (s, k) => {
      if (!best || k.depth > best.k.depth) best = { s, k };
    });
    if (!best) break;
    const { s, k } = best;
    e.pos = madd(e.pos, k.n, k.depth);
    const vn = dot(e.vel, k.n);
    if (vn < 0) e.vel = madd(e.vel, k.n, -vn);
    if (k.n[1] > 0.6) {
      e.onGround = true;
      if (s.vel) e.pos = madd(e.pos, s.vel, 1 / 120);
    }
  }
}

/** Frost: the enemy stops, is harmless, and is a block to stand on for five seconds. */
export function freeze(e, world, seconds = POWER.freeze) {
  e.frozen = seconds;
  e.vel = [0, 0, 0];
  if (!e.ice) {
    const r = e.r * 1.05;
    e.ice = world.box([e.pos[0] - r, e.pos[1] - r, e.pos[2] - r], [e.pos[0] + r, e.pos[1] + r, e.pos[2] + r], { dynamic: true, mat: 'glass', color: '#bfefff', invisible: true, enemy: true, noSafe: true });
    e.ice.ice = e;
  }
}

export function thaw(e, world) {
  e.frozen = 0;
  if (e.ice) {
    world.remove(e.ice);
    e.ice = null;
  }
}

/**
 * Does a charge touch an enemy? A folded one is only half here: a charge
 * passes through unless it has itself been through a wormhole. A lancer's
 * shield turns a charge that meets it from the front.
 */
export function chargeMeets(e, c) {
  if (e.dead) return null;
  const d = dist(e.pos, c.pos);
  if (d > e.r + c.r) return null;
  if (e.folded && !c.portaled) return null;
  if (e.shield && !e.frozen) {
    const face = [Math.sin(e.yaw), 0, Math.cos(e.yaw)];
    const from = norm(sub(c.pos, e.pos));
    if (dot(face, from) > 0.3) return 'shield';
  }
  return 'hit';
}

export { dist };
