// A level's live geometry: solid ground, thin platforms, moving parts,
// breakable crates, gravity wells and pulse emitters. DOM-free, so the tests
// build worlds from the same blueprints the game does.
//
// Every solid surface is a segment, exactly as in Deflector: the charge
// bounces off it with physics.js's reflect and a wormhole can sit on it. A
// level runs to tens of thousands of pixels, so the static segments live in
// a uniform grid and every query asks only for the cells it overlaps.
import { pointInPolygon } from '../../src/physics.js';
import { Pulser } from '../../src/entities.js';
import { TILE } from './config.js';

const TAU = Math.PI * 2;

/** A uniform grid over segments. Queries return each segment once, whichever cells it spans. */
export class SegGrid {
  constructor(cell = 160) {
    this.cell = cell;
    this.cells = new Map();
    this.stamp = 0;
  }

  key(ix, iy) {
    return (ix + 4096) * 16384 + (iy + 4096);
  }

  insert(s) {
    const c = this.cell;
    const pad = (s.thick || 0) + 1;
    const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) / c);
    const x1 = Math.floor((Math.max(s.ax, s.bx) + pad) / c);
    const y0 = Math.floor((Math.min(s.ay, s.by) - pad) / c);
    const y1 = Math.floor((Math.max(s.ay, s.by) + pad) / c);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = this.key(ix, iy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(s);
      }
    }
  }

  /** Every segment in a cell the box touches (a superset of those inside it). */
  query(x0, y0, x1, y1, out = []) {
    const c = this.cell;
    const stamp = ++this.stamp;
    const ix0 = Math.floor(x0 / c);
    const ix1 = Math.floor(x1 / c);
    const iy0 = Math.floor(y0 / c);
    const iy1 = Math.floor(y1 / c);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iy = iy0; iy <= iy1; iy++) {
        const list = this.cells.get(this.key(ix, iy));
        if (!list) continue;
        for (const s of list) {
          if (s._q === stamp) continue;
          s._q = stamp;
          out.push(s);
        }
      }
    }
    return out;
  }
}

/** The segments of a closed polygon, each with its outward normal (away from the solid). */
export function solidEdges(pts, props = {}) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    let nx = dy / len;
    let ny = -dx / len;
    const mx = (a[0] + b[0]) / 2 + nx * 0.75;
    const my = (a[1] + b[1]) / 2 + ny * 0.75;
    if (pointInPolygon(mx, my, pts)) {
      nx = -nx;
      ny = -ny;
    }
    out.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], nx, ny, len, thick: 0, broken: false, ...props });
  }
  return out;
}

/** Drop the edges two solids share exactly: they are inside the ground, and a seam there would trip the robot. */
function dropSharedEdges(segs) {
  const r = (v) => Math.round(v * 2) / 2;
  const key = (s) => {
    const a = `${r(s.ax)},${r(s.ay)}`;
    const b = `${r(s.bx)},${r(s.by)}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const count = new Map();
  for (const s of segs) count.set(key(s), (count.get(key(s)) || 0) + 1);
  return segs.filter((s) => count.get(key(s)) === 1);
}

/** A rectangle's corners, clockwise from the top left. */
export function box(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/**
 * A moving platform: a rectangle on a path. Its edges are moving surfaces, so
 * it carries whoever stands on it and lends a charge its motion as a
 * Deflector mover does. `oneWay` platforms are only a top you land on.
 *
 * Paths: `line` (there and back along dx, dy), `circle` (radius R), `fall`
 * (drops `delay` seconds after it is stood on, and comes back), `crush`
 * (slams down dy fast and climbs back slowly) and `phase` (still, but only
 * there for `on` seconds of every `on + off`).
 */
export class Platform {
  constructor(def) {
    this.def = def;
    this.w = def.w;
    this.h = def.h || 20;
    this.bx = def.x; // the path's origin: the platform's top-left corner at rest
    this.by = def.y;
    this.path = def.path || { type: 'still' };
    this.oneWay = !!def.oneWay;
    this.portal = !def.oneWay && def.portal !== false;
    this.kind = def.kind || 'platform';
    this.danger = !!def.danger; // a crusher's underside hurts
    this.thick = 0;
    this.x = this.bx;
    this.y = this.by;
    this.vx = 0;
    this.vy = 0;
    this.dx = 0; // this step's motion, which carries a rider
    this.dy = 0;
    this.present = true;
    this.fallT = -1; // fall: seconds since it was stood on, or -1
    this.fallV = 0;
    this.stoodOn = false;
    this.segs = [];
    this.place(0);
  }

  offset(t) {
    const p = this.path;
    const ph = p.phase || 0;
    switch (p.type) {
      case 'line': {
        const k = 0.5 - 0.5 * Math.cos((TAU * t) / p.period + ph);
        return [p.dx * k, p.dy * k];
      }
      case 'circle': {
        const a = (TAU * t) / p.period + ph;
        return [Math.cos(a) * p.R, Math.sin(a) * p.R];
      }
      case 'crush': {
        // Down in the first `down` of the cycle, then a slow climb back.
        const u = (((t / p.period + ph) % 1) + 1) % 1;
        const hold = p.hold ?? 0.15;
        const down = p.down ?? 0.12;
        let k;
        if (u < hold) k = 0;
        else if (u < hold + down) k = ((u - hold) / down) ** 2;
        else if (u < hold + down + 0.12) k = 1;
        else k = 1 - (u - hold - down - 0.12) / (1 - hold - down - 0.12);
        return [0, p.dy * k];
      }
      default:
        return [0, 0];
    }
  }

  /** Put the platform where its path has it at level time t (fall platforms move themselves). */
  place(t) {
    const px = this.x;
    const py = this.y;
    if (this.path.type === 'fall') {
      // Nothing to do here; update() drives it.
    } else {
      const [ox, oy] = this.offset(t);
      this.x = this.bx + ox;
      this.y = this.by + oy;
    }
    if (this.path.type === 'phase') {
      const p = this.path;
      const u = (((t + (p.offset || 0)) % (p.on + p.off)) + (p.on + p.off)) % (p.on + p.off);
      this.present = u < p.on;
      this.phaseLeft = this.present ? p.on - u : p.on + p.off - u;
    }
    this.dx = this.x - px;
    this.dy = this.y - py;
    this.buildSegs();
  }

  buildSegs() {
    if (!this.present) {
      this.segs = [];
      return;
    }
    const { x, y, w, h } = this;
    if (this.oneWay) {
      this.segs = [{ ax: x, ay: y, bx: x + w, by: y, nx: 0, ny: -1, len: w, thick: 0, oneWay: true, mover: this, portal: false }];
      return;
    }
    const pts = box(x, y, w, h);
    const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    this.segs = pts.map((a, i) => {
      const b = pts[(i + 1) % 4];
      return { ax: a[0], ay: a[1], bx: b[0], by: b[1], nx: normals[i][0], ny: normals[i][1], len: i % 2 ? h : w, thick: 0, mover: this, portal: this.portal, danger: this.danger && i === 2 };
    });
  }

  update(dt, t) {
    if (this.path.type === 'fall') {
      const px = this.x;
      const py = this.y;
      if (this.fallT < 0 && this.stoodOn) this.fallT = 0;
      if (this.fallT >= 0) {
        this.fallT += dt;
        const delay = this.path.delay ?? 0.5;
        if (this.fallT > delay) {
          this.fallV = Math.min(900, this.fallV + 1800 * dt);
          this.y += this.fallV * dt;
        }
        if (this.fallT > delay + (this.path.back ?? 4)) {
          this.fallT = -1;
          this.fallV = 0;
          this.x = this.bx;
          this.y = this.by;
        }
      }
      this.dx = this.x - px;
      this.dy = this.y - py;
      this.vx = this.dx / dt;
      this.vy = this.dy / dt;
      this.buildSegs();
      this.stoodOn = false;
      return;
    }
    this.place(t);
    this.vx = this.dx / dt;
    this.vy = this.dy / dt;
    this.stoodOn = false;
  }

  segments() {
    return this.segs;
  }

  surfaceVelocityAt() {
    return { x: this.vx, y: this.vy };
  }

  /** The box it can sweep, for the grid-free mover test. */
  bounds() {
    return { x0: this.x - 2, y0: this.y - 2, x1: this.x + this.w + 2, y1: this.y + this.h + 2 };
  }
}

/**
 * A gravity body in the shape src/gamestate.js's wellsAccel and
 * swallowingWell read: a black hole (pull > 0) that takes whatever crosses
 * its horizon, or a white hole (a fount, pull < 0) with a solid core.
 */
export function makeWell(w) {
  return {
    x: w.x,
    y: w.y,
    r: w.r ?? 26,
    range: w.range ?? 380,
    pull: w.pull ?? 360000,
    drag: 0,
    solid: !!w.fount,
    fount: !!w.fount,
    hazard: !w.fount,
    absent: !!w.dormant, // a boss's well, shut until it opens it
    rail: w.rail ? { ...w.rail } : null, // { cx, cy, R, period, phase }: it circles
    breath: w.breath ? { ...w.breath } : null, // { period, amp }: its pull swells and fades
    basePull: w.pull ?? 360000,
  };
}

/** Where every well is, and how hard it pulls, at level time t. */
export function tickWells(wells, t) {
  for (const w of wells) {
    if (w.rail) {
      const a = (TAU * t) / w.rail.period + (w.rail.phase || 0);
      w.x = w.rail.cx + Math.cos(a) * w.rail.R;
      w.y = w.rail.cy + Math.sin(a) * w.rail.R;
    }
    if (w.breath) w.pull = w.basePull * (1 + w.breath.amp * Math.sin((TAU * t) / w.breath.period));
  }
}

/** A breakable crate: a few hits and it bursts, maybe dropping something. */
function makeBreakable(b, i) {
  const pts = box(b.x, b.y, b.w, b.h);
  const crate = { id: i, x: b.x, y: b.y, w: b.w, h: b.h, hp: b.hp ?? 2, maxHp: b.hp ?? 2, drop: b.drop || null, kind: b.kind || 'crate', broken: false, flash: 0, segs: null };
  crate.segs = solidEdges(pts, { kind: 'crate', portal: false, crate });
  return crate;
}

/**
 * Build a world from a level blueprint (see build.js). The blueprint is data;
 * this is everything that moves or can be hit, plus the grid.
 */
export function createWorld(bp) {
  const w = {
    bp,
    width: bp.width,
    height: bp.height,
    top: bp.top ?? -2000, // the highest anything in the level reaches, and some sky over it
    t: 0,
    grid: new SegGrid(160),
    walls: [],
    oneWays: [],
    movers: [],
    crates: [],
    wells: (bp.wells || []).map(makeWell),
    pulsers: [],
    springs: (bp.springs || []).map((s) => ({ ...s, squash: 0 })),
    spikes: (bp.spikes || []).map((s) => ({ ...s })),
    lasers: (bp.lasers || []).map((l) => ({ ...l, lit: l.on ?? 1.4, on: false })), // `lit`: seconds on in each period; `on`: is it now
    gates: [],
    portals: { 0: [null, null] }, // the robot's pair, the shape src/portals.js reads
  };
  let walls = [];
  for (const s of bp.solids || []) {
    // A window is armoured glass: solid to everything, but the line of sight goes through it.
    const window = s.kind === 'window';
    walls.push(...solidEdges(s.pts, { kind: s.kind || 'ground', portal: s.portal !== false && s.kind !== 'spikes' && !window, solid: s, window }));
  }
  walls = dropSharedEdges(walls);
  w.walls = walls;
  for (const p of bp.oneWays || []) {
    const s = { ax: p.x0, ay: p.y, bx: p.x1, by: p.y, nx: 0, ny: -1, len: p.x1 - p.x0, thick: 0, oneWay: true, portal: false, kind: 'oneway' };
    w.oneWays.push(s);
  }
  (bp.crates || []).forEach((b, i) => w.crates.push(makeBreakable(b, i)));
  for (const s of w.walls) w.grid.insert(s);
  for (const s of w.oneWays) w.grid.insert(s);
  for (const c of w.crates) for (const s of c.segs) w.grid.insert(s);
  for (const m of bp.movers || []) w.movers.push(new Platform(m));
  for (const p of bp.pulses || []) {
    const pu = new Pulser({ period: p.period ?? 4, speed: p.speed ?? 320, maxRadius: p.maxRadius ?? 300, warn: p.warn ?? 0.8, delay: p.delay ?? 1.5, thick: 8 });
    pu.sx = p.x;
    pu.sy = p.y;
    w.pulsers.push(pu);
  }
  // Doors, shut until a switch opens them; and the switches, which a charge of yours flips.
  w.doors = (bp.doors || []).map((d) => {
    const g = addGate(w, d.x, d.y0, d.y1);
    setGate(g, true);
    g.id = d.id;
    g.door = true;
    return g;
  });
  w.switches = (bp.switches || []).map((s) => ({ ...s, r: s.r ?? 16, on: false, t: 0, flash: 0 }));
  return w;
}

/** Add a wall (a boss arena's gate) after the world is built. Returns the segments, which close() and open() switch. */
export function addGate(world, x, y0, y1) {
  const pts = box(x - 10, y0, 20, y1 - y0);
  const segs = solidEdges(pts, { kind: 'gate', portal: false });
  const gate = { x, y0, y1, segs, closed: false };
  for (const s of segs) {
    s.broken = true; // open until the boss is met
    world.grid.insert(s);
  }
  world.gates.push(gate);
  return gate;
}

export function setGate(gate, closed) {
  gate.closed = closed;
  for (const s of gate.segs) s.broken = !closed;
}

/** Advance everything in the world that moves on its own. */
export function stepWorld(world, dt) {
  world.t += dt;
  const t = world.t;
  for (const m of world.movers) m.update(dt, t);
  tickWells(world.wells, t);
  for (const p of world.pulsers) p.update(dt, p.sx, p.sy);
  for (const s of world.springs) s.squash = Math.max(0, s.squash - dt * 4);
  for (const c of world.crates) c.flash = Math.max(0, c.flash - dt);
  for (const l of world.lasers) {
    const u = (((t + (l.offset || 0)) % l.period) + l.period) % l.period;
    l.warn = u >= l.period - l.lit - 0.6 && u < l.period - l.lit;
    l.on = u >= l.period - l.lit;
  }
}

/**
 * Every solid segment near a box: static walls and crates from the grid (a
 * broken crate or an open gate left out), and the moving parts whose bounds
 * reach it. One-way tops are included only with `oneWay`.
 */
export function segmentsNear(world, x0, y0, x1, y1, { oneWay = true, movers = true } = {}) {
  const found = world.grid.query(x0, y0, x1, y1);
  const out = [];
  for (const s of found) {
    if (s.broken) continue;
    if (s.crate && s.crate.broken) continue;
    if (s.oneWay && !oneWay) continue;
    out.push(s);
  }
  if (movers) {
    for (const m of world.movers) {
      if (!m.present) continue;
      const b = m.bounds();
      if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
      for (const s of m.segs) if (oneWay || !s.oneWay) out.push(s);
    }
  }
  return out;
}

export { TILE };
