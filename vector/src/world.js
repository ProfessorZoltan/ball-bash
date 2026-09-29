// The level as the physics sees it: its solids (kept in a grid so a query only
// looks near where it asks), the parts that move on a clock (platforms, doors,
// blinking floors, crushers, laser gates), and the fields and volumes that act
// on whatever passes (black holes, fans, hazards). DOM-free.
import { box, ramp, translate, capsuleVs, sphereVs, rayVs, overlaps } from './collide.js';
import { dot, sub, len, scale } from './math.js';

const CELL = 8; // m: the grid's cells, in plan

export class World {
  constructor() {
    this.solids = []; // everything, in the order it was added
    this.cells = new Map(); // "cx,cz" -> static solids touching that cell
    this.dynamic = []; // solids that move, open, blink or break: few, and always checked
    this.wells = []; // black (and white) holes: { p, pull, reach, horizon, white }
    this.fans = []; // updrafts: { min, max, lift }
    this.hazards = []; // volumes that cost a shield: { min, max, kind, laser? }
    this.switches = []; // { id, p, n, r, doors: [ids], timer, on, t }
    this.belts = []; // conveyors: still solids whose top carries what stands on it (their vel), drawn moving
    this.tethers = []; // cables, drawn only: from a point to a point, or to (or up from) a moving solid
    this.beams = []; // beams of light, each from p along dir, through wormholes, onto a receiver (wormholes.js, beamPath)
    this.wards = []; // a launch's gap: no end opens across it from its near side (wormholes.js, warded)
    this.time = 0;
    this.stamp = 0;
  }

  // ---------------------------------------------------------------- building

  add(s) {
    this.solids.push(s);
    if (s.move || s.door || s.blink || s.crate || s.cover || s.crush || s.dynamic || s.glitch) {
      s.base = [...s.min];
      s.off = [0, 0, 0];
      this.dynamic.push(s);
    } else {
      this.index(s);
    }
    return s;
  }

  box(min, max, props) {
    return this.add(box(min, max, props));
  }

  ramp(min, max, axis, dir, props) {
    return this.add(ramp(min, max, axis, dir, props));
  }

  index(s) {
    const x0 = Math.floor(s.min[0] / CELL);
    const x1 = Math.floor(s.max[0] / CELL);
    const z0 = Math.floor(s.min[2] / CELL);
    const z1 = Math.floor(s.max[2] / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = `${x},${z}`;
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(s);
      }
    }
  }

  /** Take a solid out (a crate or a cover broken, a trapdoor gone). */
  remove(s) {
    s.gone = true;
    const i = this.dynamic.indexOf(s);
    if (i >= 0) this.dynamic.splice(i, 1);
  }

  // ----------------------------------------------------------------- queries

  /** Every solid whose box meets [min, max], each once. */
  query(min, max, fn) {
    this.stamp++;
    const x0 = Math.floor(min[0] / CELL);
    const x1 = Math.floor(max[0] / CELL);
    const z0 = Math.floor(min[2] / CELL);
    const z1 = Math.floor(max[2] / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const list = this.cells.get(`${x},${z}`);
        if (!list) continue;
        for (const s of list) {
          if (s.seen === this.stamp || s.gone) continue;
          s.seen = this.stamp;
          if (overlaps(s, min, max)) fn(s);
        }
      }
    }
    for (const s of this.dynamic) {
      if (s.gone || s.hidden || s.seen === this.stamp) continue;
      s.seen = this.stamp;
      if (overlaps(s, min, max)) fn(s);
    }
  }

  /** Is this solid there to meet right now? A blinked-out floor is not; nor is anything `ghost`. */
  solidNow(s) {
    return !s.gone && !s.hidden && !s.ghost;
  }

  /**
   * The nearest solid along a ray. `opts.glass` 'through' lets the line of
   * sight pass armoured glass; `opts.skip(s)` passes over any solid it likes.
   */
  raycast(o, dir, maxT, opts = {}) {
    let best = null;
    const step = CELL;
    // Walk the ray in stretches of a cell, querying each stretch's box, so a long
    // sight line never gathers the whole level.
    for (let t0 = 0; t0 < maxT; t0 += step) {
      const t1 = Math.min(maxT, t0 + step);
      const a = [o[0] + dir[0] * t0, o[1] + dir[1] * t0, o[2] + dir[2] * t0];
      const b = [o[0] + dir[0] * t1, o[1] + dir[1] * t1, o[2] + dir[2] * t1];
      const pad = (opts.pad || 0) + 0.01;
      const min = [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.min(a[2], b[2]) - pad];
      const max = [Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, Math.max(a[2], b[2]) + pad];
      this.query(min, max, (s) => {
        if (!this.solidNow(s)) return;
        if (opts.glass === 'through' && s.glass) return;
        if (opts.thinThrough && s.thin) return;
        if (opts.skip && opts.skip(s)) return;
        const h = rayVs(s, o, dir, best ? best.t : maxT, opts.pad || 0);
        if (h && (!best || h.t < best.t)) best = h;
      });
      if (best && best.t <= t1) return best;
    }
    return best;
  }

  /** The deepest contact of an upright capsule with anything, skipping what `skip` names. */
  capsuleContacts(c, half, r, skip, fn) {
    const min = [c[0] - r, c[1] - half - r, c[2] - r];
    const max = [c[0] + r, c[1] + half + r, c[2] + r];
    this.query(min, max, (s) => {
      if (!this.solidNow(s) || (skip && skip(s))) return;
      const h = capsuleVs(s, c, half, r);
      if (h && h.depth > 1e-7) fn(s, h);
    });
  }

  sphereContacts(c, r, skip, fn) {
    const min = [c[0] - r, c[1] - r, c[2] - r];
    const max = [c[0] + r, c[1] + r, c[2] + r];
    this.query(min, max, (s) => {
      if (!this.solidNow(s) || (skip && skip(s))) return;
      const h = sphereVs(s, c, r);
      if (h && h.depth > 1e-7) fn(s, h);
    });
  }

  /** Is anything solid where a capsule would stand? */
  capsuleFree(c, half, r, skip) {
    let free = true;
    this.capsuleContacts(c, half, r, skip, () => (free = false));
    return free;
  }

  // ------------------------------------------------------------------- fields

  /**
   * The pull on a thing at p, in m/s², from every well within reach: a black
   * hole pulls in, a white hole pushes out, both fading to nothing at the edge
   * of their reach so there is no seam where a field starts.
   */
  field(p, share = 1) {
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const w of this.wells) {
      if (w.off) continue;
      const dx = w.p[0] - p[0];
      const dy = w.p[1] - p[1];
      const dz = w.p[2] - p[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > w.reach * w.reach) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const fade = 1 - d / w.reach;
      const a = ((w.pull * share) / Math.max(d2, 1.2)) * fade * (w.white ? -1 : 1);
      ax += (dx / d) * a;
      ay += (dy / d) * a;
      az += (dz / d) * a;
    }
    return [ax, ay, az];
  }

  /** The well whose horizon p is inside, if any. */
  horizon(p, r = 0) {
    for (const w of this.wells) {
      if (w.off || w.white) continue;
      const d = Math.hypot(w.p[0] - p[0], w.p[1] - p[1], w.p[2] - p[2]);
      if (d < w.horizon + r) return w;
    }
    return null;
  }

  lift(p) {
    let a = 0;
    for (const f of this.fans) {
      if (p[0] >= f.min[0] && p[0] <= f.max[0] && p[1] >= f.min[1] && p[1] <= f.max[1] && p[2] >= f.min[2] && p[2] <= f.max[2]) a += f.lift;
    }
    return a;
  }

  // ------------------------------------------------------------------- clock

  /**
   * Run the clockwork one step: platforms along their paths, doors toward
   * open or shut, floors blinking, crushers, laser gates. Each moving solid
   * keeps its velocity, so what stands on it is carried and a charge off it
   * takes its motion.
   */
  step(dt, blocker) {
    this.time += dt;
    const t = this.time;
    for (const s of this.dynamic) {
      if (s.gone) continue;
      let off = s.off;
      if (s.move) off = moverOffset(s.move, t);
      else if (s.crush) off = crusherOffset(s.crush, t);
      else if (s.door) {
        const d = s.door;
        const want = d.open ? 1 : 0;
        // A shutting door never comes down on the robot: it waits.
        if (want < d.at && blocker && blocker(s, d)) {
          // hold
        } else if (d.at !== want) {
          d.at = want > d.at ? Math.min(want, d.at + (d.speed * dt) / d.lift) : Math.max(want, d.at - (d.speed * dt) / d.lift);
        }
        // Most doors open upward; one that is `down` (a drawbridge) comes down to open.
        off = [0, (d.down ? -d.at : d.at) * d.lift, 0];
      }
      const delta = sub(off, s.off);
      if (delta[0] || delta[1] || delta[2]) {
        translate(s, delta);
        s.off = off;
      }
      s.vel = scale(delta, 1 / dt);
      if (s.blink) {
        const b = s.blink;
        const u = (((t + b.phase) % b.period) + b.period) % b.period;
        const on = u >= b.on && u < b.off;
        s.hidden = !on;
        // The last moments before it goes, it flickers: the warning.
        s.warn = on && b.off - u < 0.45;
      }
      if (s.glitch) {
        // A wall the grid forgot to finish: nothing there to stop you, and every few seconds it shows.
        const G = s.glitch;
        s.warn = (((t + G.phase) % G.period) + G.period) % G.period < G.show;
      }
    }
    for (const h of this.hazards) {
      if (!h.laser) continue;
      const L = h.laser;
      const u = (((t + L.phase) % L.period) + L.period) % L.period;
      h.lit = u < L.on;
      h.warn = !h.lit && L.period - u < 0.6;
    }
    for (const sw of this.switches) {
      if (sw.on && sw.timer) {
        sw.left -= dt;
        if (sw.left <= 0) this.setSwitch(sw, false);
      }
    }
  }

  /**
   * A switch on or off, and its doors with it. A switch in a group (targets)
   * opens its doors only once every switch in the group is on; a door two
   * switches open (a vault's, from either side) stays open while either is.
   * Returns whether any door was told to move.
   */
  setSwitch(sw, on) {
    sw.on = on;
    if (on && sw.timer) sw.left = sw.timer;
    const open = sw.group != null ? this.switches.filter((x) => x.group === sw.group).every((x) => x.on) : on;
    let moved = false;
    for (const s of this.solids) {
      if (!s.door || !sw.doors.includes(s.door.id)) continue;
      const want = open || (sw.group == null && this.switches.some((x) => x !== sw && x.on && x.group == null && x.doors.includes(s.door.id)));
      if (s.door.open === want) continue;
      s.door.open = want;
      moved = true;
    }
    return moved;
  }
}

/** A moving platform's offset from where it was built, at time t. */
export function moverOffset(m, t) {
  const u = ((t + (m.phase || 0) * m.period) % m.period) / m.period;
  if (m.orbit) {
    // Round a wheel: in the plane of `a` and `b` (two unit axes), radius r.
    const ang = u * Math.PI * 2;
    const r = m.orbit.r;
    const [a, b] = m.orbit.axes;
    return [(Math.cos(ang) - 1) * r * a[0] + Math.sin(ang) * r * b[0], (Math.cos(ang) - 1) * r * a[1] + Math.sin(ang) * r * b[1], (Math.cos(ang) - 1) * r * a[2] + Math.sin(ang) * r * b[2]];
  }
  // To and fro, easing at each end; one that `hold`s stops at each end for that share of its period.
  let k = (1 - Math.cos(u * Math.PI * 2)) / 2;
  if (m.hold) {
    const h = m.hold / 2;
    const leg = 0.5 - h;
    if (u < h) k = 0;
    else if (u < 0.5) k = (1 - Math.cos((Math.PI * (u - h)) / leg)) / 2;
    else if (u < 0.5 + h) k = 1;
    else k = (1 + Math.cos((Math.PI * (u - 0.5 - h)) / leg)) / 2;
  }
  return [m.to[0] * k, m.to[1] * k, m.to[2] * k];
}

/** A crusher: up, a pause, a slam down, a pause, a slow climb. */
export function crusherOffset(c, t) {
  const u = (((t + (c.phase || 0)) % c.period) + c.period) % c.period / c.period;
  const drop = c.drop;
  if (u < 0.35) return [0, 0, 0]; // up, waiting
  if (u < 0.42) return [0, -drop * ((u - 0.35) / 0.07) ** 2, 0]; // the slam
  if (u < 0.6) return [0, -drop, 0]; // down
  return [0, -drop * (1 - (u - 0.6) / 0.4), 0]; // the climb back
}

/** How far a point is from a segment, for beams. */
export function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-9, dot(ab, ab))));
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}
