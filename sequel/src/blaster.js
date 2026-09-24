// The blaster's charge. It is Deflector's Blaster charge, carried by a robot:
// it leaves at the middle of the ball's speed range, lives three seconds,
// and turns off every wall exactly as the ball does (the speed it arrived
// with, mirrored), while a moving part lends it its motion by the same
// SURFACE_VELOCITY_FACTOR. A gravity well bends it and its horizon takes it,
// and a wormhole's mouth lets it through. DOM-free.
import { circleVsCapsule, reflect } from '../../src/physics.js';
import { wellsAccel, swallowingWell } from '../../src/gamestate.js';
import { mouthOf, portalLocal, throughPortal, openedSegments, openPortals, PORTAL } from '../../src/portals.js';
import { BLASTER, POWER, SURFACE_VELOCITY_FACTOR, POWERUPS } from './config.js';
import { segmentsNear } from './world.js';

export class Charge {
  constructor(o) {
    this.x = o.x;
    this.y = o.y;
    this.prevX = o.x;
    this.prevY = o.y;
    this.vx = o.vx;
    this.vy = o.vy;
    this.r = o.r ?? BLASTER.radius;
    this.born = o.born ?? 0;
    this.life = o.life ?? BLASTER.life;
    this.damage = o.damage ?? BLASTER.damage;
    this.freeze = !!o.freeze;
    this.kind = o.kind || 'std';
    this.color = o.color || '#dffbff';
    this.hostile = !!o.hostile; // an enemy's shot: it hurts the robot, not them
    this.bounce = o.bounce !== false; // walls turn it back; an enemy shot that does not bounce ends on the wall
    this.owner = o.owner ?? 0;
    this.portalUntil = 0;
    this.warps = 0;
    this.bounces = 0;
    this.dead = false;
    this.warped = false;
  }

  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
}

/** What firing the blaster with `kind` loaded makes: its size, life, damage and how many leave at once. */
export function chargeSpec(kind) {
  const pu = POWERUPS.find((p) => p.id === kind);
  return {
    kind: kind || 'std',
    r: kind === 'big' ? BLASTER.radius * POWER.bigScale : BLASTER.radius,
    life: kind === 'durable' ? POWER.durableLife : BLASTER.life,
    damage: kind === 'strong' ? POWER.strongDamage : BLASTER.damage,
    freeze: kind === 'freeze',
    spread: kind === 'triple' ? [-POWER.tripleSpread, 0, POWER.tripleSpread] : [0],
    color: pu ? pu.color : '#dffbff',
  };
}

/**
 * Hold a charge between the ball's floor and cap. A charge stopped dead (a
 * surface retreating at exactly its speed) leaves along the contact normal
 * at the floor speed, as Deflector's does.
 */
export function clampCharge(c, nx = 0, ny = 0) {
  const s = Math.hypot(c.vx, c.vy);
  if (s < 1e-6) {
    const n = Math.hypot(nx, ny);
    c.vx = n > 1e-6 ? (nx / n) * BLASTER.minSpeed : BLASTER.minSpeed;
    c.vy = n > 1e-6 ? (ny / n) * BLASTER.minSpeed : 0;
    return;
  }
  const k = Math.min(BLASTER.maxSpeed, Math.max(BLASTER.minSpeed, s));
  if (k === s) return;
  c.vx *= k / s;
  c.vy *= k / s;
}

/**
 * Where a charge fired from the shoulder along (dx, dy) is formed: `out`
 * along the barrel unless a surface is nearer, in which case it forms on
 * this side of it and bounces, rather than beyond it (Deflector's
 * chargeMuzzle, without the shield).
 */
export function muzzle(world, sx, sy, dx, dy, r, out = BLASTER.muzzle) {
  const STEP = 3;
  let x = sx;
  let y = sy;
  const segs = segmentsNear(world, sx - out - r, sy - out - r, sx + out + r, sy + out + r, { oneWay: false });
  for (let d = 0; d < out; d += STEP) {
    const nx = x + dx * Math.min(STEP, out - d);
    const ny = y + dy * Math.min(STEP, out - d);
    if (segs.some((s) => circleVsCapsule(nx, ny, r, s.ax, s.ay, s.bx, s.by, s.thick || 0))) break;
    x = nx;
    y = ny;
  }
  return { x, y };
}

/**
 * One step of one charge. `hooks.crate(crate, charge)` is told when it meets
 * a crate (and the charge is spent); `hooks.bounce(charge, h, seg)` on every
 * ricochet; `hooks.warp(charge, from, to)` through a wormhole;
 * `hooks.swallow(charge, well)` at a horizon. Returns false once the charge
 * is done (its life is up, it is spent or it has left the level).
 */
export function stepCharge(c, world, dt, now, hooks = {}) {
  c.prevX = c.x;
  c.prevY = c.y;
  c.warped = false;
  if (now - c.born > c.life) return false;
  if (world.wells.length) {
    const a = wellsAccel(world.wells, c.x, c.y);
    if (a) {
      c.vx += a.ax * dt;
      c.vy += a.ay * dt;
      clampCharge(c);
    }
    const took = swallowingWell(world.wells, c.x, c.y);
    if (took) {
      if (hooks.swallow) hooks.swallow(c, took);
      return false;
    }
  }
  const hole = now >= c.portalUntil && openPortals(world).length ? mouthOf(world, c.x, c.y, c.r, c.speed * dt) : null;
  c.x += c.vx * dt;
  c.y += c.vy * dt;

  // Pulse rings are thin moving walls: they fling a charge outward as they do the ball.
  for (const p of world.pulsers) {
    const ring = p.ring();
    if (!ring) continue;
    const dx = c.x - ring.x;
    const dy = c.y - ring.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    const gap = d - ring.r;
    const reach = c.r + ring.thick;
    if (Math.abs(gap) >= reach) continue;
    const side = gap >= 0 ? 1 : -1;
    const nx = (side * dx) / d;
    const ny = (side * dy) / d;
    c.x += nx * (reach - Math.abs(gap));
    c.y += ny * (reach - Math.abs(gap));
    const sv = p.surfaceVelocityAt(c.x, c.y);
    reflect(c, nx, ny, sv.x, sv.y, 1, SURFACE_VELOCITY_FACTOR);
    clampCharge(c, nx, ny);
  }

  let segs = segmentsNear(world, c.x - c.r - 4, c.y - c.r - 4, c.x + c.r + 4, c.y + c.r + 4, { oneWay: false });
  if (world.ice && world.ice.length) for (const blk of world.ice) if (!(blk.x1 < c.x - 80 || blk.x0 > c.x + 80 || blk.y1 < c.y - 80 || blk.y0 > c.y + 80)) segs = segs.concat(blk.segs);
  if (hole) segs = openedSegments(hole, segs);
  let touched = false;
  for (let iter = 0; iter < 4; iter++) {
    let best = null;
    for (const s of segs) {
      const h = circleVsCapsule(c.x, c.y, c.r, s.ax, s.ay, s.bx, s.by, s.thick || 0, c.vx, c.vy);
      if (h && (!best || h.depth > best.h.depth)) best = { h, s };
    }
    if (!best) break;
    touched = true;
    const { h, s } = best;
    if (s.crate) {
      if (hooks.crate) hooks.crate(s.crate, c);
      return false;
    }
    if (s.ice && s.ice.enemy && hooks.ice) {
      if (hooks.ice(s.ice.enemy, c)) return false;
    }
    c.x += h.nx * h.depth;
    c.y += h.ny * h.depth;
    if (!c.bounce) {
      if (hooks.bounce) hooks.bounce(c, h, s);
      return false;
    }
    const sv = s.mover ? s.mover.surfaceVelocityAt() : { x: 0, y: 0 };
    if (reflect(c, h.nx, h.ny, sv.x, sv.y, 1, SURFACE_VELOCITY_FACTOR)) {
      clampCharge(c, h.nx, h.ny);
      c.bounces++;
      if (hooks.bounce) hooks.bounce(c, h, s);
    }
  }
  if (!touched && hole && hole.v >= 0 && portalLocal(hole.p, c.x, c.y).v < 0) {
    const o = throughPortal(hole.p, hole.q, c.x, c.y, c.vx, c.vy);
    const from = { x: c.x, y: c.y };
    c.x = o.x;
    c.y = o.y;
    c.vx = o.vx;
    c.vy = o.vy;
    c.prevX = c.x;
    c.prevY = c.y;
    c.portalUntil = now + PORTAL.shotGrace;
    c.warps++;
    c.warped = true;
    if (hooks.warp) hooks.warp(c, from, { x: c.x, y: c.y });
  }
  if (c.x < -300 || c.x > world.width + 300 || c.y < world.top - 600 || c.y > world.height + 300) return false;
  return true;
}

/**
 * The targeting line: the charge's flight for BLASTER.guide seconds, flown by
 * stepCharge itself on a copy, so every bounce, bend and wormhole it shows is
 * one the real charge will take (moving parts aside, which keep moving).
 * Returns a list of polylines, a new one after each wormhole.
 */
export function guideLine(world, x, y, angle, spec, now, seconds = BLASTER.guide) {
  const dt = 1 / 120;
  const lines = [];
  for (const off of spec.spread) {
    const a = angle + off;
    const c = new Charge({ x, y, vx: Math.cos(a) * BLASTER.speed, vy: Math.sin(a) * BLASTER.speed, r: spec.r, born: now, life: seconds + 1 });
    let line = [[x, y]];
    const legs = [line];
    for (let t = 0; t < seconds; t += dt) {
      const alive = stepCharge(c, world, dt, now + t, {});
      if (c.warped) {
        line = [[c.x, c.y]];
        legs.push(line);
      } else line.push([c.x, c.y]);
      if (!alive) break;
    }
    lines.push(legs);
  }
  return lines;
}
