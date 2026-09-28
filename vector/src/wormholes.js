// Wormholes in three dimensions: Defector's pair, light end and dark end, now
// mouths on walls, floors, roofs and ramps. An end is aimed along the line of
// sight (bent by black holes exactly as a charge is), slid so the whole mouth
// lies on the surface it lands on, and whatever crosses one mouth comes out of
// the other turned by the angle between them, momentum kept. DOM-free.
import { WORM } from './config.js';
import { dot, sub, add, cross, norm, madd, len, scale, lookDir, yawPitch, clamp } from './math.js';
import { faceCoords } from './collide.js';

/** The corner radius of the mouth's rounded rectangle. */
export const CORNER = 0.45;

/**
 * Where the aim lands: the line of sight from `eye` along `dir`. Straight
 * lines away from every well; inside a well's reach it is flown step by step
 * like a charge, so it bends. At most `WORM.maxLen` long. Armoured glass lets
 * the line through; nothing else does.
 * Returns { hit, points } (hit is null where it runs out).
 */
export function sightLine(world, eye, dir, maxLen = WORM.maxLen) {
  const points = [eye];
  let p = eye;
  let d = norm(dir);
  let left = maxLen;
  const speed = 24;
  const dt = 1 / 120;
  let guard = 0;
  while (left > 0 && guard++ < 4000) {
    const near = world.wells.some((w) => !w.off && Math.hypot(w.p[0] - p[0], w.p[1] - p[1], w.p[2] - p[2]) < w.reach + 1);
    if (!near) {
      // Straight on to the next well's reach, or to the end.
      let run = left;
      for (const w of world.wells) {
        if (w.off) continue;
        const tc = dot(sub(w.p, p), d);
        if (tc <= 0) continue;
        const closest = len(sub(madd(p, d, tc), w.p));
        if (closest < w.reach) run = Math.min(run, Math.max(0.5, tc - Math.sqrt(Math.max(0, w.reach * w.reach - closest * closest))));
      }
      const h = world.raycast(p, d, run, { glass: 'through' });
      if (h) {
        points.push(h.p);
        return { hit: h, points };
      }
      p = madd(p, d, run);
      points.push(p);
      left -= run;
      continue;
    }
    // In a well's reach: a charge's flight, one step at a time.
    const a = world.field(p);
    const v = madd(scale(d, speed), a, dt);
    const sp = len(v);
    d = scale(v, 1 / sp);
    const stepLen = Math.min(left, speed * dt);
    const h = world.raycast(p, d, stepLen, { glass: 'through' });
    if (h) {
      points.push(h.p);
      return { hit: h, points };
    }
    if (world.horizon(p)) return { hit: null, points, swallowed: true };
    p = madd(p, d, stepLen);
    left -= stepLen;
    if (guard % 6 === 0) points.push(p);
  }
  points.push(p);
  return { hit: null, points };
}

/** Can this solid hold an end at all? */
export function holds(s) {
  return !(s.glass || s.noPortal || s.door || s.crate || s.cover || s.hazard || s.spring || s.enemy);
}

/**
 * An end placed where a sight line hit: centred there, turned (a wall's
 * mouth stands upright; a floor's or a roof's long axis lies the way the
 * robot looks), slid along the surface until the whole mouth lies on it, and
 * never over its twin. Returns the end, or null with a reason.
 */
export function placeEnd(world, hit, look, twin = null) {
  if (!hit) return { end: null, why: 'nothing in reach' };
  const s = hit.solid;
  const f = hit.plane && hit.plane.face;
  if (!holds(s) || !f) return { end: null, why: 'that takes no wormhole' };
  const n = hit.n;
  const a = WORM.a;
  const b = WORM.b;
  // The mouth's long axis, v, as nearly the way wanted as the face allows.
  const wants = [];
  if (Math.abs(n[1]) < 0.7) {
    // A wall (or a steep slope): upright.
    wants.push(norm(sub([0, 1, 0], scale(n, n[1]))));
  } else {
    const flat = sub(look, scale(n, dot(look, n)));
    if (len(flat) > 1e-3) wants.push(norm(flat));
  }
  // Failing that, along either of the face's own axes.
  const alongLook = (ax) => (dot(ax, look) >= 0 ? ax : scale(ax, -1));
  wants.push(alongLook(f.v), alongLook(f.u));
  for (const v of wants) {
    const u = norm(cross(v, n));
    // The mouth's reach along the face's axes.
    const eu = a * Math.abs(dot(u, f.u)) + b * Math.abs(dot(v, f.u));
    const ev = a * Math.abs(dot(u, f.v)) + b * Math.abs(dot(v, f.v));
    if (eu > f.hu + 1e-6 || ev > f.hv + 1e-6) continue;
    let [x, y] = faceCoords(f, hit.p);
    x = clamp(x, -f.hu + eu, f.hu - eu);
    y = clamp(y, -f.hv + ev, f.hv - ev);
    // A wall's mouth that would hang just off the foot of the wall comes down to
    // it, a doorway rather than a step: aimed at eye height, it opens on the floor.
    const vy = dot(f.v, [0, 1, 0]);
    if (Math.abs(n[1]) < 0.7 && Math.abs(vy) > 0.99) {
      const foot = vy > 0 ? -f.hv + ev : f.hv - ev;
      if (Math.abs(y - foot) < 0.75) y = foot;
    }
    let c = add(add(f.c, scale(f.u, x)), scale(f.v, y));
    // Never over the twin: slide away from it along the face, if there is room.
    if (twin && twin.host === s && dot(twin.n, n) > 0.99) {
      const gap = sub(c, twin.c);
      const need = 2 * Math.max(a, b) + 0.05;
      if (len(gap) < need) {
        const away = len(gap) > 1e-3 ? norm(gap) : f.u;
        const moved = madd(twin.c, away, need);
        const [mx, my] = faceCoords(f, moved);
        if (Math.abs(mx) > f.hu - eu + 1e-6 || Math.abs(my) > f.hv - ev + 1e-6) continue;
        c = moved;
      }
    }
    // Nothing may cover the mouth: a crate on the floor, a wall butted to the face.
    let covered = false;
    for (const [px, py] of [[0, 0], [a * 0.8, 0], [-a * 0.8, 0], [0, b * 0.8], [0, -b * 0.8]]) {
      const q = add(add(c, scale(u, px)), add(scale(v, py), scale(n, 0.06)));
      world.query(q, q, (o) => {
        if (o !== s && world.solidNow(o) && !o.thin && inside(o, q)) covered = true;
      });
    }
    if (covered) continue;
    return { end: makeEnd(c, n, u, v, s) };
  }
  return { end: null, why: 'too small for a mouth' };
}

function inside(s, p) {
  for (const pl of s.planes) if (dot(pl.n, p) - pl.d > 0) return false;
  return true;
}

export function makeEnd(c, n, u, v, host) {
  const e = { c, n, u, v, a: WORM.a, b: WORM.b, host, hostOff: host && host.off ? [...host.off] : [0, 0, 0], near: false, age: 0 };
  // A floor faces up, a roof down; everything else is a wall, a ramp's face included.
  e.kind = n[1] > 0.7 ? 'floor' : n[1] < -0.7 ? 'roof' : 'wall';
  e.ramp = host && host.shape === 'ramp' && Math.abs(n[1]) > 0.05 && Math.abs(n[1]) < 0.999;
  return e;
}

/** An end on something that moves goes with it; on something gone or blinked out, it goes too. */
export function refreshEnd(e) {
  const h = e.host;
  if (!h) return true;
  if (h.gone || h.hidden) return false;
  if (h.off) {
    const d = sub(h.off, e.hostOff);
    if (d[0] || d[1] || d[2]) {
      e.c = add(e.c, d);
      e.hostOff = [...h.off];
    }
  }
  return true;
}

/** A point in an end's own frame: across (u), along (v), out (n). */
export function local(e, p) {
  const d = sub(p, e.c);
  return [dot(d, e.u), dot(d, e.v), dot(d, e.n)];
}

/** Is (x, y) inside the mouth, shrunk by m on every side? */
export function inMouth(e, x, y, m = 0) {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > e.a - m || ay > e.b - m) return false;
  const k = CORNER - m;
  if (k <= 0) return true;
  const dx = ax - (e.a - CORNER);
  const dy = ay - (e.b - CORNER);
  if (dx <= 0 || dy <= 0) return true;
  return dx * dx + dy * dy <= k * k;
}

/** A point carried through `from` and out of `to`. */
export function through(from, to, p) {
  const l = local(from, p);
  return add(to.c, add(add(scale(to.u, -l[0]), scale(to.v, l[1])), scale(to.n, -l[2])));
}

/** A direction (a velocity, a look) turned the way `through` turns a point. */
export function turn(from, to, d) {
  const l = [dot(d, from.u), dot(d, from.v), dot(d, from.n)];
  return add(add(scale(to.u, -l[0]), scale(to.v, l[1])), scale(to.n, -l[2]));
}

/**
 * The velocity out of an end: turned through, and then never slower than
 * WORM.minExit away from the mouth, and out of a floor at least WORM.floorExit
 * up, so nothing hangs half in a mouth. A robot out of a ramp's face is
 * thrown along the face (WORM.launch), up and across a gap no jump crosses.
 */
export function exitVelocity(from, to, v, robot = false) {
  let out = turn(from, to, v);
  const along = dot(out, to.n);
  const min = robot && to.kind === 'floor' ? WORM.floorExit : WORM.minExit;
  if (along < min) out = madd(out, to.n, min - along);
  if (robot && to.ramp) {
    // Thrown the way the ramp climbs, at 40 degrees, whatever it came in with.
    const up = sub([0, 1, 0], scale(to.n, to.n[1]));
    const hz = norm([up[0], 0, up[2]]);
    const sp = Math.max(WORM.launch, len(out));
    const el = (40 * Math.PI) / 180;
    out = [hz[0] * sp * Math.cos(el), sp * Math.sin(el), hz[2] * sp * Math.cos(el)];
  }
  return out;
}

/**
 * The robot and the ends, one step. While its body is in a mouth (lined up
 * with it and close), the wall, floor or roof the end sits on does not stop
 * it; a robot heading into a mouth is drawn onto its middle line, so walking
 * in never needs threading; and once its middle (or its eye, going up through
 * a roof) crosses the surface, it is carried out of the twin. Returns the
 * warp, if one happened: { from, to }.
 */
export function portalRobot(bot, ends, dt) {
  bot.mouth = null;
  let best = null;
  for (const e of ends) {
    if (!e.twin) continue;
    const l = local(e, bot.pos);
    if (l[2] < -1.6 || l[2] > bot.r + 0.9) continue;
    const vin = -dot(bot.vel, e.n);
    // Lined up: the body in the mouth, a little leniency round its rim.
    const mx = e.kind === 'wall' ? bot.r * 0.55 : 0.2;
    let fits = inMouth(e, l[0], l[1], mx);
    if (e.kind === 'wall') fits = Math.abs(l[0]) <= e.a - bot.r * 0.55 && Math.abs(l[1]) <= e.b - 0.35;
    if (!fits) {
      // Heading in and nearly lined up: drawn onto the middle.
      if (vin > 0.5 && l[2] < bot.r + 0.9 && inMouth(e, l[0], l[1], -0.35)) {
        const pull = WORM.funnel * dt * 10;
        const across = clamp(-l[0], -pull, pull);
        bot.pos = madd(bot.pos, e.u, across);
        if (e.kind !== 'wall') bot.pos = madd(bot.pos, e.v, clamp(-l[1], -pull, pull));
      }
      continue;
    }
    if (!best || Math.abs(l[2]) < Math.abs(best.l[2])) best = { e, l };
  }
  if (!best) return null;
  const { e, l } = best;
  bot.mouth = e;
  const eyeZ = dot(sub([bot.pos[0], bot.pos[1] + bot.eye, bot.pos[2]], e.c), e.n);
  if (l[2] >= 0 && eyeZ >= 0) return null;
  // Across: out of the twin.
  const to = e.twin;
  bot.pos = through(e, to, bot.pos);
  // Carried across whole: never left behind the far surface. Out of a floor, a
  // roof or a ramp, the whole upright body is set clear of the surface at once,
  // or a throw along a ramp would drag its feet up the slope.
  const clear = to.kind === 'wall' && !to.ramp ? 0.02 : bot.r + bot.half * Math.abs(to.n[1]) + 0.05;
  const lz = dot(sub(bot.pos, to.c), to.n);
  if (lz < clear) bot.pos = madd(bot.pos, to.n, clear - lz);
  bot.vel = exitVelocity(e, to, bot.vel, true);
  const look = turn(e, to, lookDir(bot.yaw, bot.pitch));
  const yp = yawPitch(look);
  if (Math.hypot(look[0], look[2]) > 0.45) bot.yaw = yp.yaw;
  else if (Math.hypot(bot.vel[0], bot.vel[2]) > 0.5) bot.yaw = Math.atan2(bot.vel[0], bot.vel[2]);
  else if (to.kind === 'wall') bot.yaw = Math.atan2(to.n[0], to.n[2]);
  bot.pitch = clamp(yp.pitch, -0.9, 0.9);
  bot.mouth = to;
  bot.flung = bot.vel[1] > 0;
  bot.ground = null;
  bot.onGround = false;
  return { from: e, to };
}

/**
 * A sphere (a charge, a shot) and the ends: is it in a mouth (its host does
 * not stop it), and has it crossed? Moves it through if so and returns the
 * pair.
 */
export function portalSphere(o, ends) {
  o.mouth = null;
  for (const e of ends) {
    if (!e.twin) continue;
    const l = local(e, o.pos);
    if (l[2] < -1 || l[2] > o.r + 0.4) continue;
    if (!inMouth(e, l[0], l[1], o.r * 0.6)) continue;
    o.mouth = e;
    if (l[2] >= 0) return null;
    const to = e.twin;
    o.pos = through(e, to, o.pos);
    const lz = dot(sub(o.pos, to.c), to.n);
    if (lz < 0.01) o.pos = madd(o.pos, to.n, 0.01 - lz);
    o.vel = exitVelocity(e, to, o.vel, false);
    o.mouth = to;
    return { from: e, to };
  }
  return null;
}

/** An end going (moved, closed, its surface gone): whatever was half in it is put back out in front. */
export function ejectFrom(e, bot) {
  if (bot.mouth !== e) return;
  const l = local(e, bot.pos);
  const need = bot.r + 0.05 + (e.kind === 'roof' ? bot.half + 0.4 : e.kind === 'floor' ? bot.half : 0);
  if (l[2] < need) bot.pos = madd(bot.pos, e.n, need - l[2]);
  if (dot(bot.vel, e.n) < 0) bot.vel = madd(bot.vel, e.n, -dot(bot.vel, e.n));
  bot.mouth = null;
}

