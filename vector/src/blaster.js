// The blaster's charge in three dimensions: Deflector's ball, fired. It flies
// straight, turns off walls at the speed it arrived (and takes a moving
// part's motion), bends round black holes, is taken by a horizon, and goes
// through wormholes. The aim line is this same flight flown ahead, so every
// bounce it shows is real. DOM-free.
import { BLASTER, POWER, GRAVITY, PHYSICS_DT } from './config.js';
import { dot, len, madd, scale, sub, add, norm } from './math.js';
import { portalSphere } from './wormholes.js';

let nextId = 1;

/** A charge: where, which way, how big, how long it lives, and what it does when it lands. */
export function makeCharge(pos, dir, kind = 'std', owner = 'bot', opts = {}) {
  const big = kind === 'big';
  const speed = opts.speed || BLASTER.speed;
  return {
    id: nextId++,
    pos: [...pos],
    prev: [...pos],
    vel: scale(norm(dir), speed),
    r: (opts.r || BLASTER.radius) * (big ? POWER.bigScale : 1),
    life: kind === 'durable' ? POWER.durableLife : opts.life || BLASTER.life,
    age: 0,
    kind,
    owner,
    damage: kind === 'strong' ? POWER.strongDamage : opts.damage || BLASTER.damage,
    portaled: false,
    bounces: 0,
    dead: false,
    color: opts.color,
    drop: opts.drop || 0, // m/s² it falls, for lobbed things; a charge flies level
    trail: [],
  };
}

/**
 * One step of a charge's flight. `hit(s, n, c)` is asked about each solid it
 * meets: return 'stop' if it ends there (a crate, a switch), anything else to
 * bounce. Returns events: ricochet, warp, swallow, expire.
 */
export function stepCharge(c, world, ends, dt, hit = null) {
  const ev = [];
  c.age += dt;
  c.life -= dt;
  if (c.life <= 0) {
    c.dead = true;
    ev.push({ s: 'expire', at: [...c.pos] });
    return ev;
  }
  c.prev = [...c.pos];
  const a = world.field(c.pos);
  c.vel = madd(c.vel, a, dt);
  if (c.drop) c.vel[1] -= c.drop * dt;
  let sp = len(c.vel);
  if (sp > BLASTER.maxSpeed) {
    c.vel = scale(c.vel, BLASTER.maxSpeed / sp);
    sp = BLASTER.maxSpeed;
  }
  // Substeps, so a charge never crosses more than most of its own radius in one: it cannot skip a thin wall.
  const n = Math.max(1, Math.ceil((sp * dt) / (Math.min(c.r, 0.2) * 0.8)));
  const h = dt / n;
  for (let i = 0; i < n && !c.dead; i++) {
    c.pos = madd(c.pos, c.vel, h);
    const w = portalSphere(c, ends);
    if (w) {
      c.portaled = true;
      ev.push({ s: 'warp', from: w.from, to: w.to, at: [...c.pos] });
    }
    const host = c.mouth && c.mouth.host;
    let best = null;
    world.sphereContacts(c.pos, c.r, (s) => s === host || s.passCharges || (c.skip && c.skip(s)), (s, k) => {
      if (!best || k.depth > best.k.depth) best = { s, k };
    });
    if (best) {
      const { s, k } = best;
      const verdict = hit ? hit(s, k.n, c) : null;
      if (verdict === 'stop') {
        c.dead = true;
        ev.push({ s: 'stopped', at: [...c.pos], solid: s, n: k.n });
        break;
      }
      c.pos = madd(c.pos, k.n, k.depth + 1e-4);
      const sv = s.vel || [0, 0, 0];
      const rel = sub(c.vel, sv);
      const vn = dot(rel, k.n);
      if (vn < 0) {
        // Off the wall at the speed it arrived, plus what the wall was doing.
        const out = madd(rel, k.n, -2 * vn);
        c.vel = add(out, scale(k.n, Math.max(0, dot(sv, k.n))));
        c.bounces++;
        ev.push({ s: 'ricochet', at: [...c.pos], n: k.n, speed: Math.min(1, -vn / 30), solid: s });
      }
    }
    const well = world.horizon(c.pos, c.r * 0.5);
    if (well) {
      c.dead = true;
      ev.push({ s: 'swallow', at: [...c.pos], well });
    }
  }
  if (c.trail) {
    c.trail.push([...c.pos]);
    if (c.trail.length > 10) c.trail.shift();
  }
  return ev;
}

/**
 * The aim line: a charge flown ahead for `seconds` with the same physics,
 * stopping at the first thing it would end on. Returns the points, where it
 * ended, and whether it went through a wormhole.
 */
export function guideLine(world, ends, pos, dir, kind = 'std', seconds = BLASTER.guide, stopAt = null) {
  const c = makeCharge(pos, dir, kind, 'guide');
  c.trail = null;
  const pts = [[...pos]];
  // The game's own step: near a black hole a coarser one would drift from the real flight.
  const dt = PHYSICS_DT;
  let warps = 0;
  let end = null;
  for (let t = 0; t < seconds && !c.dead; t += dt) {
    const ev = stepCharge(c, world, ends, dt, (s) => (s.crate || s.cover || s.switchRef || s.stopsCharges ? 'stop' : null));
    for (const e of ev) {
      if (e.s === 'warp') {
        warps++;
        pts.push(null); // a break in the line where it jumps
      }
      if (e.s === 'stopped' || e.s === 'swallow') end = e;
    }
    if (stopAt && stopAt(c)) {
      end = { s: 'target', at: [...c.pos] };
      c.dead = true;
    }
    pts.push([...c.pos]);
  }
  return { pts, end, warps, charge: c };
}

/** Something thrown in an arc (a boss's lob): a charge that falls. */
export function lob(pos, vel, owner = 'enemy', opts = {}) {
  const c = makeCharge(pos, vel, 'std', owner, { ...opts, speed: len(vel), drop: GRAVITY * (opts.g ?? 0.6) });
  return c;
}
