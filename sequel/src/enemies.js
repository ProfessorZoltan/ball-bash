// Enemies: what they are, how they move, and what they do to the robot.
// DOM-free. Six ways of moving (walking, running, flying straight, flying
// zig-zag, swooping and jumping), any size, any toughness; some shoot, some
// carry a Deflector shield that turns a charge away, some can be stomped.
// Every one of them goes through the robot's wormholes as the robot does.
// A folded enemy is only half in this world: a charge passes through it
// unless the charge has itself been through a wormhole.
import { circleVsCapsule, raycastSegments } from '../../src/physics.js';
import { mouthOf, throughPortal, openPortals, openedSegments, PORTAL } from '../../src/portals.js';
import { segmentsNear, solidEdges, box } from './world.js';
import { POWER } from './config.js';
import { exitVelocity } from './wormholes.js';

const TAU = Math.PI * 2;

/**
 * The roster. `r` is the body's radius at size 1; a placement may scale it
 * with `size`, which scales toughness too unless it sets `hp`. `stomp`: it
 * can be jumped on. `spiky`: landing on it hurts. `shoot`: it fires slow
 * shots ({ period, speed, range, count, spread, bounce }). `shield`: a
 * Deflector shield of width `w` that turns toward the robot.
 */
export const KINDS = {
  skitter: { name: 'Skitter', move: 'walk', r: 16, hp: 1, speed: 70, stomp: true, color: '#ff5c7a', look: 'beetle' },
  trundle: { name: 'Trundle', move: 'walk', r: 30, hp: 4, speed: 42, stomp: true, color: '#ff8d4d', look: 'beetle' },
  burr: { name: 'Burr', move: 'walk', r: 17, hp: 2, speed: 55, spiky: true, color: '#ffd23f', look: 'burr' },
  dasher: { name: 'Dasher', move: 'run', r: 18, hp: 2, speed: 300, stomp: true, color: '#ffb347', look: 'hound' },
  drifter: { name: 'Drifter', move: 'fly', r: 19, hp: 1, speed: 80, color: '#c9a2ff', look: 'jelly' },
  flitter: { name: 'Flitter', move: 'zigzag', r: 14, hp: 1, speed: 120, color: '#5ce1ff', look: 'moth' },
  swooper: { name: 'Swooper', move: 'swoop', r: 20, hp: 2, speed: 480, color: '#ff4fd8', look: 'kite' },
  hopper: { name: 'Hopper', move: 'jump', r: 18, hp: 2, speed: 170, jump: 640, stomp: true, color: '#9dff5c', look: 'frog' },
  boing: { name: 'Boing', move: 'jump', r: 30, hp: 5, speed: 120, jump: 760, stomp: true, color: '#7dffc0', look: 'frog' },
  sentry: { name: 'Sentry', move: 'still', r: 22, hp: 3, color: '#ffb347', look: 'turret', shoot: { period: 2.4, speed: 300, range: 720 } },
  lancer: { name: 'Lancer', move: 'walk', r: 20, hp: 3, speed: 50, color: '#7fe9ff', look: 'knight', shield: { w: 64, turn: 2.2 } },
  gunner: { name: 'Gunner', move: 'fly', r: 20, hp: 2, speed: 70, color: '#ff7eb6', look: 'saucer', shoot: { period: 2.8, speed: 280, range: 640 } },
  moth: { name: 'Lampmoth', move: 'zigzag', r: 22, hp: 3, speed: 90, color: '#ffe27a', look: 'moth', shoot: { period: 3.2, speed: 240, range: 600, count: 3, spread: 0.35 } },
  crab: { name: 'Clacker', move: 'run', r: 24, hp: 3, speed: 240, stomp: true, color: '#ff6a4d', look: 'crab' },
  wisp: { name: 'Wisp', move: 'swoop', r: 14, hp: 1, speed: 520, color: '#aef6ff', look: 'kite' },
  urchin: { name: 'Urchin', move: 'fly', r: 22, hp: 3, speed: 60, spiky: true, color: '#ff9df5', look: 'burr' },
  wraith: { name: 'Wraith', move: 'zigzag', r: 20, hp: 2, speed: 100, folded: true, color: '#b6a4ff', look: 'wraith' },
  echo: { name: 'Echo', move: 'walk', r: 18, hp: 2, speed: 80, folded: true, color: '#7ff0ff', look: 'beetle' },
  shade: { name: 'Shade', move: 'swoop', r: 22, hp: 3, speed: 440, folded: true, color: '#d0a8ff', look: 'kite' },
};

export class Enemy {
  constructor(spec, id = 0) {
    const k = KINDS[spec.kind];
    if (!k) throw new Error(`no enemy kind ${spec.kind}`);
    const size = spec.size ?? 1;
    this.id = id;
    this.kind = spec.kind;
    this.k = k;
    this.move = spec.move || k.move;
    this.r = Math.round(k.r * size);
    this.hp = spec.hp ?? Math.max(1, Math.round(k.hp * (size > 1 ? size * size : 1)));
    this.maxHp = this.hp;
    this.speed = (spec.speed ?? k.speed) * (size > 1.4 ? 0.8 : 1);
    this.color = spec.color || k.color;
    this.x = spec.x;
    this.y = spec.y;
    this.hx = spec.x; // home: where it patrols from
    this.hy = spec.y;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.dir = spec.dir ?? -1;
    this.range = spec.range ?? (this.move === 'fly' ? 220 : this.move === 'zigzag' ? 260 : 0);
    this.axis = spec.axis || 'x'; // a straight flier's line: across, or up and down
    this.drop = spec.drop ?? null; // a power-up id, 'shield', or 'random'
    this.onGround = false;
    this.frozen = 0;
    this.flash = 0;
    this.dead = false;
    this.awake = false;
    this.t = Math.random() * 3;
    this.state = 'idle';
    this.timer = spec.delay ?? 0.4 + Math.random() * 0.8;
    this.shootT = spec.shootDelay ?? 1 + Math.random() * 1.5;
    this.shield = k.shield ? { w: k.shield.w * size, turn: k.shield.turn, angle: this.dir < 0 ? Math.PI : 0, omega: 0 } : null;
    this.ice = null; // the block it is frozen into: something to stand on
    this.swoop = null;
    this.ceiling = !!spec.ceiling; // a turret hung upside down
    this.folded = !!(spec.folded ?? k.folded); // only a charge that has been through a wormhole touches it
    this.portalGrace = 0;
    this.lastMouth = null;
    this.warped = false;
  }

  get stompable() {
    return !!this.k.stomp && !this.k.spiky && !this.folded;
  }

  /** The shield as a segment, or null. */
  shieldSegment() {
    const s = this.shield;
    if (!s) return null;
    const off = this.r + 9;
    const cx = this.x + Math.cos(s.angle) * off;
    const cy = this.y + Math.sin(s.angle) * off;
    const tx = -Math.sin(s.angle) * (s.w / 2);
    const ty = Math.cos(s.angle) * (s.w / 2);
    return { ax: cx - tx, ay: cy - ty, bx: cx + tx, by: cy + ty, thick: 4 };
  }

  /** How fast a point on the shield is moving (its turn), for the bounce. */
  shieldVelocityAt(px, py) {
    const w = this.shield ? this.shield.omega : 0;
    return { x: this.vx - w * (py - this.y), y: this.vy + w * (px - this.x) };
  }
}

/** Freeze an enemy solid for POWER.freeze seconds: it stops, it is harmless, and it is a block to stand on. */
export function freezeEnemy(e) {
  e.frozen = POWER.freeze;
  e.vx = 0;
  e.vy = 0;
  e.swoop = null;
  const s = e.r * 2 + 4;
  const x0 = e.x - s / 2;
  const y0 = e.y - s / 2;
  const segs = solidEdges(box(x0, y0, s, s), { kind: 'ice', portal: false });
  const blk = { x0, y0, x1: x0 + s, y1: y0 + s, segs, enemy: e };
  for (const sg of segs) sg.ice = blk;
  e.ice = blk;
}

/**
 * Move a round body one step and settle it against the level. Ground is a
 * surface facing up; thin platforms hold it from above. Sets onGround, and
 * `bumped` to the wall normal it ran into, if any.
 */
function moveBody(e, world, dt, gravity) {
  if (gravity) e.vy = Math.min(900, e.vy + gravity * dt);
  const prevBottom = e.y + e.r;
  // At a wormhole's mouth the surface is open to it, as it is to the robot.
  const open = openPortals(world).length > 0;
  const hole = open ? mouthOf(world, e.x, e.y, e.r, Math.hypot(e.vx, e.vy) * dt) : null;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  e.onGround = false;
  e.bumped = null;
  let segs = segmentsNear(world, e.x - e.r - 8, e.y - e.r - 8, e.x + e.r + 8, e.y + e.r + 8);
  if (hole) segs = openedSegments(hole, segs);
  for (let it = 0; it < 3; it++) {
    let any = false;
    for (const s of segs) {
      if (s.oneWay && (e.vy < 0 || prevBottom > s.ay + 3 || !gravity)) continue;
      const h = circleVsCapsule(e.x, e.y, e.r, s.ax, s.ay, s.bx, s.by, s.thick || 0, e.vx, e.vy);
      if (!h) continue;
      if (s.oneWay && h.ny > -0.5) continue;
      any = true;
      if (h.ny < -0.6) {
        e.y += h.depth / h.ny;
        if (e.vy > 0) e.vy = 0;
        e.onGround = true;
        if (s.mover) {
          e.x += s.mover.dx;
          e.y += s.mover.dy;
        }
      } else {
        e.x += h.nx * h.depth;
        e.y += h.ny * h.depth;
        const vn = e.vx * h.nx + e.vy * h.ny;
        if (vn < 0) {
          e.vx -= vn * h.nx;
          e.vy -= vn * h.ny;
        }
        if (Math.abs(h.nx) > 0.6) e.bumped = h;
      }
    }
    if (!any) break;
  }
  if (open) portalEnemy(e, world);
}

/**
 * An enemy at an open mouth: the moment its centre goes through the surface
 * (having come up to it, out of its grace) it comes out of the other end,
 * turned by the angle between them, exactly as the robot does. Whatever it
 * was patrolling, it patrols from there now.
 */
export function portalEnemy(e, world) {
  let mouth = mouthOf(world, e.x, e.y, e.r);
  if (mouth && mouth.v < 0 && !(e.portalGrace > 0) && e.lastMouth === mouth.p.key && mouth.q) {
    const o = throughPortal(mouth.p, mouth.q, e.x, e.y, e.vx, e.vy);
    const v = exitVelocity(mouth.q, o.vx, o.vy);
    e.x = o.x;
    e.y = o.y;
    e.vx = v.vx;
    e.vy = v.vy;
    e.prevX = e.x;
    e.prevY = e.y;
    e.hx = e.x;
    e.hy = e.y;
    e.swoop = null;
    if (Math.abs(e.vx) > 1) e.dir = Math.sign(e.vx);
    e.portalGrace = PORTAL.grace;
    e.warped = true;
    e.warps = (e.warps || 0) + 1;
    mouth = mouthOf(world, e.x, e.y, e.r);
  } else if (mouth && mouth.v < 0) {
    e.x -= mouth.p.nx * mouth.v;
    e.y -= mouth.p.ny * mouth.v;
    mouth = { ...mouth, v: 0 };
  }
  e.lastMouth = mouth && mouth.v >= 0 ? mouth.p.key : null;
}

/** Is there ground just ahead of a walker's front foot? */
function groundAhead(e, world, dir) {
  const px = e.x + dir * (e.r + 4);
  const segs = segmentsNear(world, px - 4, e.y, px + 4, e.y + e.r + 40);
  return !!raycastSegments(px, e.y, 0, 1, segs, e.r + 28);
}

/** Can the enemy see the point (no solid wall between)? */
export function canSee(world, x, y, tx, ty) {
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const segs = segmentsNear(world, Math.min(x, tx), Math.min(y, ty), Math.max(x, tx), Math.max(y, ty), { oneWay: false, movers: false });
  return !raycastSegments(x, y, dx / d, dy / d, segs, d);
}

/**
 * One step of one enemy. `bot` is the robot (for who to chase and shoot);
 * `shoot(e, angle, spec)` looses a shot. Frozen enemies only thaw.
 */
export function stepEnemy(e, world, bot, dt, shoot) {
  e.prevX = e.x;
  e.prevY = e.y;
  e.warped = false;
  e.portalGrace -= dt;
  e.t += dt;
  e.flash = Math.max(0, e.flash - dt);
  if (e.frozen > 0) {
    e.frozen -= dt;
    if (e.frozen <= 0) {
      e.frozen = 0;
      e.ice = null;
    }
    return;
  }
  const dx = bot.x - e.x;
  const dy = bot.y - e.y;
  const adx = Math.abs(dx);
  e.aimAngle = Math.atan2(dy, dx);
  switch (e.move) {
    case 'walk': {
      e.vx = e.dir * e.speed;
      moveBody(e, world, dt, 2200);
      if (e.onGround && (e.bumped || !groundAhead(e, world, e.dir))) e.dir = -e.dir;
      else if (e.bumped) e.dir = -e.dir;
      break;
    }
    case 'run': {
      // Patrols at a trot; sees the robot on its own level and runs at it.
      const sees = adx < 560 && Math.abs(dy) < 150 && (e.state === 'charge' || Math.sign(dx) === e.dir || adx < 200);
      if (sees) {
        e.state = 'charge';
        e.timer = 1;
        e.dir = Math.sign(dx) || e.dir;
      } else if (e.state === 'charge') {
        e.timer -= dt;
        if (e.timer <= 0) e.state = 'idle';
      }
      const top = e.state === 'charge' ? e.speed : e.speed * 0.3;
      e.vx += Math.sign(e.dir * top - e.vx) * Math.min(Math.abs(e.dir * top - e.vx), 1400 * dt);
      moveBody(e, world, dt, 2200);
      if (e.onGround && (e.bumped || !groundAhead(e, world, e.dir))) {
        e.dir = -e.dir;
        e.vx = 0;
        if (e.state === 'charge') e.state = 'idle';
      }
      break;
    }
    case 'fly': {
      // A straight line there and back, across or up and down.
      if (e.axis === 'x') {
        e.vx = e.dir * e.speed;
        e.vy = (e.hy - e.y) * 2;
        if ((e.x - e.hx) * e.dir > e.range) e.dir = -e.dir;
      } else {
        e.vy = e.dir * e.speed;
        e.vx = (e.hx - e.x) * 2;
        if ((e.y - e.hy) * e.dir > e.range) e.dir = -e.dir;
      }
      moveBody(e, world, dt, 0);
      if (e.bumped) e.dir = -e.dir;
      break;
    }
    case 'zigzag': {
      // Across its patch in a zig-zag, its middle line drifting toward the robot's height.
      if ((e.x - e.hx) * e.dir > e.range) e.dir = -e.dir;
      const period = 1.1;
      const u = ((e.t / period) % 1 + 1) % 1;
      const tri = u < 0.5 ? u * 4 - 1 : 3 - u * 4;
      if (adx < 700) e.hy += Math.max(-40 * dt, Math.min(40 * dt, bot.y - 60 - e.hy));
      const ty = e.hy + tri * 46;
      e.vx = e.dir * e.speed;
      e.vy = (ty - e.y) * 8;
      moveBody(e, world, dt, 0);
      if (e.bumped) e.dir = -e.dir;
      break;
    }
    case 'swoop': {
      if (!e.swoop) {
        // On its perch, bobbing, until the robot passes below.
        e.vx = (e.hx - e.x) * 3;
        e.vy = (e.hy + Math.sin(e.t * 2.5) * 6 - e.y) * 3;
        e.timer -= dt;
        if (e.timer <= 0 && adx < 400 && dy > 50 && dy < 520) {
          const tx = bot.x;
          const ty = bot.y;
          const span = Math.max(160, Math.abs(tx - e.x) * 2);
          const dir = Math.sign(tx - e.x) || 1;
          const len = Math.hypot(span, (ty - e.y) * 2);
          e.swoop = { x0: e.x, y0: e.y, x1: e.x + dir * span, depth: ty - e.y, s: 0, dur: len / e.speed };
          e.dir = dir;
        }
        moveBody(e, world, dt, 0);
      } else {
        const sw = e.swoop;
        sw.s = Math.min(1, sw.s + dt / sw.dur);
        const nx = sw.x0 + (sw.x1 - sw.x0) * sw.s;
        const ny = sw.y0 + sw.depth * 4 * sw.s * (1 - sw.s);
        e.vx = (nx - e.x) / dt;
        e.vy = (ny - e.y) / dt;
        moveBody(e, world, dt, 0);
        if (sw.s >= 1 || e.bumped) {
          e.swoop = null;
          e.hx = e.x;
          e.hy = sw.y0;
          e.timer = 1.4;
        }
      }
      break;
    }
    case 'jump': {
      if (e.onGround) {
        e.vx = 0;
        e.timer -= dt;
        if (e.timer <= 0) {
          if (adx < 620) e.dir = Math.sign(dx) || e.dir;
          else if (!groundAhead(e, world, e.dir)) e.dir = -e.dir;
          e.vx = e.dir * e.speed;
          e.vy = -(e.k.jump || 640);
          e.timer = 0.7 + Math.random() * 0.6;
          e.onGround = false;
        }
      }
      moveBody(e, world, dt, e.onGround ? 2200 : 1900);
      if (e.bumped && !e.onGround) e.vx = -e.vx * 0.3;
      break;
    }
    case 'still':
    default:
      e.vx = 0;
      e.vy = 0;
      break;
  }
  if (e.shield) {
    const want = Math.atan2(dy, dx);
    let d = want - e.shield.angle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = Math.max(-e.shield.turn * dt, Math.min(e.shield.turn * dt, d));
    e.shield.angle += step;
    e.shield.omega = step / dt;
  }
  const sh = e.k.shoot;
  if (sh && shoot) {
    e.shootT -= dt;
    if (e.shootT <= 0) {
      e.shootT = sh.period;
      if (Math.hypot(dx, dy) < sh.range && canSee(world, e.x, e.y, bot.x, bot.y)) {
        const a = Math.atan2(dy, dx);
        const n = sh.count || 1;
        for (let i = 0; i < n; i++) shoot(e, a + (i - (n - 1) / 2) * (sh.spread || 0), sh);
      }
    }
  }
}

/** Does the robot's body (an upright capsule) touch this enemy's body or shield? */
export function touchesRobot(e, bot) {
  const h = circleVsCapsule(e.x, e.y, e.r, bot.x, bot.y - bot.half, bot.x, bot.y + bot.half, bot.r);
  if (h) return { x: e.x - h.nx * e.r, y: e.y - h.ny * e.r, body: true };
  const s = e.shieldSegment();
  if (s) {
    // Capsule against capsule: sample the shield's line against the robot's.
    for (let k = 0; k <= 4; k++) {
      const px = s.ax + ((s.bx - s.ax) * k) / 4;
      const py = s.ay + ((s.by - s.ay) * k) / 4;
      if (circleVsCapsule(px, py, s.thick, bot.x, bot.y - bot.half, bot.x, bot.y + bot.half, bot.r)) return { x: px, y: py, body: false };
    }
  }
  return null;
}

export { TAU };
