// The level builder. A level is written as a list of sections, left to
// right, each a small set piece with a few numbers (in tiles): a gap three
// wide, a climb of nine, a pit with a black hole in it. The builder lays
// them end to end along a cursor (where the floor is) and turns them into a
// blueprint: solid ground, thin platforms, moving parts, crates, wells,
// enemies, pickups, checkpoints, secrets and the boss's arena. DOM-free.
//
// Ground is drawn as a profile: the floor's top edge, step by step, closed
// down to the level's bottom. A gap ends one profile and starts another, and
// the pit between them has a kill line a little below the lower floor.
import { TILE } from './config.js';
import { KINDS } from './enemies.js';
import { BOSSES } from './bosses.js';
import { box } from './world.js';

const T = TILE;

/**
 * What the robot can be asked to do, in tiles (see MOVE in config.js: a
 * walking jump rises 4.5 tiles and carries 4.6; a running one rises 5.5 and
 * carries 8.4). A section that needs more than the walking figure is marked
 * `run`, and the tests hold every section to these.
 */
export const LIMITS = {
  gapWalk: 4,
  gapRun: 6.5,
  rise: 4, // the most the floor steps up without a spring or platforms
  riseRun: 5,
  platGap: 3, // vertical spacing on a climb
};

/** A small seeded generator, so a level built twice is the same level. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Builder {
  constructor(def) {
    this.def = def;
    this.x = 0;
    this.y = def.floor ?? 0;
    this.rng = seeded(def.seed ?? def.id * 7919 + 17);
    this.runs = [];
    this.run = null;
    this.bp = {
      id: def.id,
      title: def.title,
      theme: def.theme,
      track: def.track,
      solids: [],
      oneWays: [],
      movers: [],
      crates: [],
      enemies: [],
      pickups: [],
      springs: [],
      wells: [],
      pulses: [],
      lasers: [],
      checkpoints: [],
      secrets: [],
      deco: [],
      pits: [],
      ambushes: [],
      spikes: [],
      signs: [],
      sections: [],
      portalLinks: [], // the puzzles, where only a wormhole or a switch gets you across: { from, to, kind }
      doors: [], // shut until a switch opens them: { id, x, y0, y1 }
      switches: [], // a charge flips one: { x, y, doors: [id], hold? }
    };
    this.minY = this.y;
    this.maxY = this.y;
    this.startRun();
  }

  get r() {
    return this.rng();
  }

  pick(list) {
    return list[Math.floor(this.rng() * list.length)];
  }

  note() {
    this.minY = Math.min(this.minY, this.y);
    this.maxY = Math.max(this.maxY, this.y);
  }

  startRun() {
    this.run = { pts: [[this.x, this.y]] };
    this.runs.push(this.run);
  }

  endRun() {
    this.run = null;
  }

  /** Walk the floor on for `tiles`. */
  flat(tiles) {
    this.x += tiles * T;
    this.run.pts.push([this.x, this.y]);
    this.note();
  }

  /** Step the floor up (negative: down) by `tiles`, a sheer face. */
  rise(tiles) {
    this.y -= tiles * T;
    this.run.pts.push([this.x, this.y]);
    this.note();
  }

  /** A slope over `tiles`, climbing `up`. */
  slope(tiles, up) {
    this.x += tiles * T;
    this.y -= up * T;
    this.run.pts.push([this.x, this.y]);
    this.note();
  }

  /** A pit `tiles` wide; the floor resumes `up` tiles higher (negative: lower). */
  gap(tiles, up = 0) {
    const x0 = this.x;
    const y0 = this.y;
    this.endRun();
    this.x += tiles * T;
    this.y -= up * T;
    this.bp.pits.push({ x0, x1: this.x, y: Math.max(y0, this.y) + 420 });
    this.note();
    this.startRun();
  }

  /** A solid block, x and y in px, w and h in px. */
  solid(x, y, w, h, kind = 'block', extra = {}) {
    const s = { pts: box(x, y, w, h), kind, ...extra };
    this.bp.solids.push(s);
    this.minY = Math.min(this.minY, y);
    return s;
  }

  /** A door from y0 to y1 at x, shut until a switch opens it. Returns its id. */
  door(x, y0, y1) {
    const id = this.bp.doors.length;
    this.bp.doors.push({ id, x, y0, y1 });
    return id;
  }

  /** A bed of spikes `len` tiles long sunk a tile into the floor, from here. */
  spikeBed(len) {
    const x0 = this.x;
    this.rise(-1);
    this.flat(len);
    this.rise(1);
    this.solid(x0, this.y + T * 0.55, len * T, T * 0.45, 'spikes');
    this.bp.spikes.push({ x0, x1: x0 + len * T, y: this.y + T * 0.55 });
  }

  thin(x0, x1, y) {
    this.bp.oneWays.push({ x0, x1, y });
    this.minY = Math.min(this.minY, y);
  }

  /** The top of the ground at x, from the floor profiles laid so far (the highest, if several), or null over a pit. */
  floorAt(x) {
    let best = null;
    for (const run of this.runs) {
      const pts = run.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        if (bx - ax < 1 || x < ax || x > bx) continue;
        const y = ay + ((by - ay) * (x - ax)) / (bx - ax);
        if (best == null || y < best) best = y;
      }
    }
    return best;
  }

  /** An enemy standing on the floor at px x (or `up` tiles above it, for fliers). */
  enemy(kind, x, opts = {}) {
    const k = KINDS[kind];
    const size = opts.size ?? 1;
    const r = k.r * size;
    const grounded = ['walk', 'run', 'jump', 'still'].includes(opts.move || k.move) && !opts.up;
    const floorY = this.floorAt(x) ?? opts.floorY ?? this.y;
    let y = grounded ? floorY - r - 1 : floorY - (opts.up ?? 3) * T;
    // A flier that would start inside a block (a brick row, a roof) is moved down, then up, until it is clear.
    if (!grounded) {
      const free = (yy) => !this.bp.solids.some((sd) => circleInPoly(x, yy, r + 4, sd.pts)) && !this.bp.crates.some((c) => x + r > c.x && x - r < c.x + c.w && yy + r > c.y && yy - r < c.y + c.h);
      let tries = 0;
      const y0 = y;
      while (!free(y) && y < floorY - r - 4 && tries++ < 100) y += 8;
      if (!free(y)) {
        y = y0;
        for (tries = 0; !free(y) && tries < 100; tries++) y -= 8;
      }
    }
    this.bp.enemies.push({ kind, x, y, ...opts, up: undefined, floorY: undefined });
  }

  /** Enemies written as [kind, dx tiles, up tiles?, opts?] from section start x0. */
  enemies(list, x0, floorY = this.y) {
    for (const e of list || []) {
      const [kind, dx, up, opts] = e;
      this.enemy(kind, x0 + dx * T, { ...(opts || {}), up: up || undefined, floorY });
    }
  }

  pickup(kind, x, y) {
    this.bp.pickups.push({ kind, x, y });
  }

  crate(x, y, w, h, drop = null, hp = 2, kind = 'crate') {
    this.bp.crates.push({ x, y, w, h, drop, hp, kind });
  }

  /** Scenery along a stretch of floor, from the theme's own props. */
  decorate(x0, x1, y) {
    const props = (this.def.theme && this.def.theme.props) || [];
    if (!props.length) return;
    let x = x0 + T * (0.5 + this.r * 1.5);
    while (x < x1 - 3 * T) {
      const kind = this.pick(props);
      this.bp.deco.push({ kind, x, y, s: 0.8 + this.r * 0.5, seed: Math.floor(this.r * 1e6), layer: this.r < 0.3 ? 'front' : 'back' });
      x += T * (2.5 + this.r * 4);
    }
  }

  finish() {
    const bp = this.bp;
    const bottom = this.maxY + 900;
    for (const run of this.runs) {
      const pts = run.pts;
      if (pts.length < 2) continue;
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (last[0] - first[0] < 1) continue;
      const poly = [...pts, [last[0], bottom], [first[0], bottom]];
      bp.solids.push({ pts: dedupe(poly), kind: 'ground' });
    }
    // A wall at each end of the world.
    bp.solids.push({ pts: box(-400, this.minY - 1600, 400, bottom - this.minY + 1600), kind: 'ground' });
    bp.width = this.x;
    bp.height = bottom;
    bp.top = this.minY - 900;
    return bp;
  }
}

/** Does a circle overlap a polygon (its inside, or within r of an edge)? */
function circleInPoly(x, y, r, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xi - xj;
    const dy = yi - yj;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - xj) * dx + (y - yj) * dy) / l2));
    if (Math.hypot(xj + dx * t - x, yj + dy * t - y) < r) return true;
  }
  return inside;
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) out.push(p);
  }
  // Drop points that lie on a straight line between their neighbours.
  const clean = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length];
    const b = out[i];
    const c = out[(i + 1) % out.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 0.01) clean.push(b);
  }
  return clean;
}

// ---------------------------------------------------------------- sections
// Each takes the builder and its numbers and leaves the cursor at the far
// end, on the floor. Enemy lists are [kind, dx, up?, opts?] in tiles from
// the section's start.

export const SECTIONS = {
  /** Floor. */
  flat(b, p) {
    const x0 = b.x;
    const len = p.len ?? 8;
    b.flat(len);
    if (p.deco !== false) b.decorate(x0, b.x, b.y);
    b.enemies(p.e, x0);
    for (const c of p.crates || []) {
      const [dx, up, w, h, drop, hp] = c;
      b.crate(x0 + dx * T, b.y - (up + h) * T, w * T, h * T, drop ?? null, hp ?? 2);
    }
    for (const k of p.items || []) b.pickup(k[0], x0 + k[1] * T, b.y - (k[2] ?? 1) * T);
    if (p.sign) b.bp.signs.push({ x: x0 + (p.sign.dx ?? 2) * T, y: b.y, text: p.sign.text });
  },

  /** A pit, and the floor again `up` tiles higher on the far side. */
  gap(b, p) {
    const x0 = b.x;
    b.flat(p.run ?? 2);
    b.gap(p.w ?? 3, p.up ?? 0);
    b.flat(p.land ?? 3);
    b.enemies(p.e, x0);
  },

  /** A sheer step up or down, and floor after it. */
  step(b, p) {
    const x0 = b.x;
    b.flat(p.run ?? 2);
    b.rise(p.up ?? 2);
    b.flat(p.len ?? 4);
    b.decorate(b.x - (p.len ?? 4) * T, b.x, b.y);
    b.enemies(p.e, x0);
  },

  /** A slope. */
  slope(b, p) {
    const x0 = b.x;
    b.flat(1);
    b.slope(p.len ?? 6, p.up ?? 2);
    b.flat(p.after ?? 2);
    b.enemies(p.e, x0);
  },

  /** A flight of stairs: `n` steps of `rise` tiles every `tread` tiles (a negative rise goes down). */
  stairs(b, p) {
    const x0 = b.x;
    const n = p.n ?? 4;
    for (let i = 0; i < n; i++) {
      b.flat(p.tread ?? 2);
      b.rise(p.rise ?? 1);
    }
    b.flat(p.after ?? 3);
    b.enemies(p.e, x0);
  },

  /** Pillars standing up out of the floor, to hop over. */
  pillars(b, p) {
    const x0 = b.x;
    const hs = p.h || [2, 3, 2];
    for (const h of hs) {
      b.flat(p.space ?? 4);
      b.rise(h);
      b.flat(p.w ?? 2);
      b.rise(-h);
    }
    b.flat(p.space ?? 4);
    b.decorate(x0, b.x, b.y);
    b.enemies(p.e, x0);
  },

  /** Floating blocks and crates over a stretch of floor: [dx, up, w, h, 'crate'|'block', drop, hp]. */
  blocks(b, p) {
    const x0 = b.x;
    b.flat(p.len ?? 10);
    for (const k of p.list || []) {
      const [dx, up, w, h, kind, drop, hp] = k;
      const x = x0 + dx * T;
      const y = b.y - (up + h) * T;
      if (kind === 'crate') b.crate(x, y, w * T, h * T, drop ?? null, hp ?? 2);
      else if (kind === 'thin') b.thin(x, x + w * T, y);
      else b.solid(x, y, w * T, h * T, 'block');
    }
    b.decorate(x0, b.x, b.y);
    b.enemies(p.e, x0);
  },

  /** A pit with platforms over it: [dx, up, len, 'thin'?] from the pit's near edge. */
  plats(b, p) {
    b.flat(p.run ?? 2);
    const x0 = b.x;
    const floorY = b.y;
    for (const k of p.list || []) {
      const [dx, up, len, thin] = k;
      const x = x0 + dx * T;
      const y = floorY - up * T;
      if (thin) b.thin(x, x + len * T, y);
      else b.solid(x, y, len * T, T * 0.6, 'block');
    }
    b.gap(p.w ?? 8, p.up ?? 0);
    b.flat(p.land ?? 3);
    b.enemies(p.e, x0, floorY);
  },

  /** A pit crossed by a moving platform: path 'h', 'v', 'circle' or 'fall'. */
  mover(b, p) {
    b.flat(p.run ?? 2);
    const x0 = b.x;
    const floorY = b.y;
    const w = p.w ?? 9;
    const len = (p.len ?? 3) * T;
    const path = p.path || 'h';
    const period = p.period ?? 5;
    if (path === 'h') {
      b.bp.movers.push({ x: x0 + T * 0.5, y: floorY, w: len, h: 18, oneWay: !!p.thin, path: { type: 'line', dx: w * T - len - T, dy: 0, period, phase: p.phase ?? 0 } });
    } else if (path === 'v') {
      // Up and down in the middle of the pit, from the floor to `rise` above it.
      const rise = p.rise ?? 4;
      b.bp.movers.push({ x: x0 + (w * T - len) / 2, y: floorY - rise * T, w: len, h: 18, oneWay: !!p.thin, path: { type: 'line', dx: 0, dy: rise * T + 40, period, phase: p.phase ?? 0 } });
    } else if (path === 'circle') {
      const R = p.R ?? 2.2;
      b.bp.movers.push({ x: x0 + (w * T) / 2 - len / 2, y: floorY - T, w: len, h: 18, oneWay: true, path: { type: 'circle', R: R * T, period, phase: p.phase ?? 0 } });
    } else if (path === 'fall') {
      const n = p.n ?? 3;
      const span = (w * T) / n;
      for (let i = 0; i < n; i++) b.bp.movers.push({ x: x0 + span * i + (span - len) / 2, y: floorY - (p.upAt ? p.upAt[i] ?? 0 : 0) * T, w: len, h: 18, path: { type: 'fall', delay: p.delay ?? 0.45 } });
    }
    b.gap(w, p.up ?? 0);
    b.flat(p.land ?? 3);
    b.enemies(p.e, x0, floorY);
  },

  /** Crushers: slabs that slam down from a low roof and climb back. */
  crushers(b, p) {
    const x0 = b.x;
    const n = p.n ?? 3;
    const space = p.space ?? 5;
    const roof = (p.roof ?? 5) * T;
    b.flat(n * space + 2);
    b.solid(x0, b.y - roof - 200, b.x - x0, 200, 'block');
    for (let i = 0; i < n; i++) {
      const x = x0 + (1.5 + i * space) * T;
      b.bp.movers.push({ x, y: b.y - roof, w: 2 * T, h: T * 0.8, kind: 'crusher', danger: true, path: { type: 'crush', dy: roof - T * 0.8 - 2, period: p.period ?? 3, phase: i * (p.stagger ?? 0.33), hold: 0.35, down: 0.08 } });
    }
    b.enemies(p.e, x0);
  },

  /** A low roof over the floor. */
  tunnel(b, p) {
    const x0 = b.x;
    const len = p.len ?? 12;
    const h = (p.h ?? 3.5) * T;
    b.flat(len);
    b.solid(x0, b.y - h - 240, len * T, 240, 'block');
    b.enemies(p.e, x0);
  },

  /** Up a cliff `up` tiles high by thin ledges zig-zagging up its face. */
  climb(b, p) {
    const x0 = b.x;
    const up = p.up ?? 9;
    const width = p.width ?? 8;
    b.flat(width);
    const floorY = b.y;
    const n = Math.ceil(up / LIMITS.platGap) - 1;
    for (let i = 1; i <= n; i++) {
      const y = floorY - i * (up / (n + 1)) * T;
      const left = i % 2 === 1;
      const lx = left ? x0 + T * 0.5 : x0 + (width - 3.5) * T;
      b.thin(lx, lx + 3 * T, y);
    }
    b.rise(up);
    b.flat(p.after ?? 3);
    b.enemies(p.e, x0, floorY);
  },

  /** Down a drop `down` tiles, past a couple of ledges. */
  drop(b, p) {
    const x0 = b.x;
    b.flat(p.run ?? 2);
    const top = b.y;
    b.rise(-(p.down ?? 6));
    b.flat(p.after ?? 5);
    if (p.ledges !== false) b.thin(x0 + (p.run ?? 2) * T + T * 0.5, x0 + (p.run ?? 2) * T + T * 3, top + (p.down ?? 6) * T * 0.5);
    b.enemies(p.e, x0);
  },

  /** A trench of spikes to jump, `len` tiles long, with thin ledges over a long one. */
  spikes(b, p) {
    b.flat(p.run ?? 2);
    const x0 = b.x;
    const len = p.len ?? 3;
    b.rise(-1);
    b.flat(len);
    b.rise(1);
    b.solid(x0, b.y + T * 0.55, len * T, T * 0.45, 'spikes');
    b.bp.spikes.push({ x0, x1: x0 + len * T, y: b.y + T * 0.55 });
    for (const k of p.list || []) b.thin(x0 + k[0] * T, x0 + (k[0] + k[2]) * T, b.y - k[1] * T);
    b.flat(p.land ?? 3);
    b.enemies(p.e, x0);
  },

  /**
   * A pit with a black hole in it that bends every jump across, and its
   * moons: fliers ([kind, opts]) that circle it deep in its pull, so a shot
   * at one bends. A moon stays in the pit, under the stepping stones and
   * clear of the walls, so it never meets a jump across.
   */
  well(b, p) {
    b.flat(p.run ?? 3);
    const x0 = b.x;
    const w = p.w ?? 7;
    const floorY = b.y;
    const hole = { x: x0 + (w * T) / 2, y: floorY + (p.depth ?? 2.5) * T, r: p.r ?? 24, range: (p.range ?? 9) * T, pull: p.pull ?? 360000 };
    b.bp.wells.push(hole);
    for (const k of p.list || []) b.thin(x0 + k[0] * T, x0 + (k[0] + k[2]) * T, floorY - k[1] * T);
    const lid = Math.min(floorY, ...(p.list || []).map((k) => floorY - k[1] * T)); // the highest a moon may reach
    (p.moons || []).forEach(([kind, opts = {}], i) => {
      const r = KINDS[kind].r;
      const rx = (w * T) / 2 - r - 10;
      const ry = Math.min(rx, hole.y - lid - r - 14); // spines and wings are drawn past the body: room for them too
      if (Math.min(rx, ry) < hole.r + r + 20) return; // no room to circle clear of the horizon
      const orbit = { cx: hole.x, cy: hole.y, rx, ry, period: p.moonPeriod ?? 5.5, a: -Math.PI / 2 + i * Math.PI, dir: 1 };
      b.bp.enemies.push({ kind, x: hole.x + Math.cos(orbit.a) * rx, y: hole.y + Math.sin(orbit.a) * ry, move: 'fly', orbit, drop: opts.drop ?? null });
    });
    b.gap(w, p.up ?? 0);
    b.flat(p.land ?? 3);
    b.enemies(p.e, x0, floorY);
  },

  /** A white hole in a pit: it pushes up, a lift made of nothing. */
  fount(b, p) {
    b.flat(p.run ?? 3);
    const x0 = b.x;
    const w = p.w ?? 8;
    const floorY = b.y;
    b.bp.wells.push({ x: x0 + (w * T) / 2, y: floorY + (p.depth ?? 2) * T, r: 20, range: (p.range ?? 10) * T, pull: -(p.push ?? 900000), fount: true });
    b.gap(w, p.up ?? 0);
    b.flat(p.land ?? 3);
    b.enemies(p.e, x0, floorY);
  },

  /** A pulse emitter in the floor: rings that throw you (and your charges) outward. */
  pulse(b, p) {
    const x0 = b.x;
    const len = p.len ?? 12;
    b.flat(len);
    b.bp.pulses.push({ x: x0 + (len * T) / 2, y: b.y - 10, period: p.period ?? 3.2, speed: p.speed ?? 300, maxRadius: (p.radius ?? 7) * T, delay: p.delay ?? 1 });
    b.enemies(p.e, x0);
  },

  /** A spring pad at the foot of a wall too high to jump. */
  spring(b, p) {
    const x0 = b.x;
    b.flat(p.run ?? 4);
    const sx = b.x - 2.5 * T;
    const s = b.solid(sx, b.y - 14, 2 * T, 14, 'spring');
    const rec = { x: sx, y: b.y - 14, w: 2 * T, power: p.power ?? 1150, squash: 0 };
    s.spring = rec;
    b.bp.springs.push(rec);
    b.rise(p.up ?? 7);
    b.flat(p.after ?? 4);
    b.enemies(p.e, x0);
  },

  /** Platforms that are there, then not, across a pit. */
  phase(b, p) {
    b.flat(p.run ?? 2);
    const x0 = b.x;
    const floorY = b.y;
    const n = p.n ?? 3;
    const w = p.w ?? 11;
    const span = (w * T) / n;
    for (let i = 0; i < n; i++) {
      b.bp.movers.push({ x: x0 + span * i + (span - 2.5 * T) / 2, y: floorY - (p.up ?? 1) * T * ((i % 2) + 0.5), w: 2.5 * T, h: 18, kind: 'phase', path: { type: 'phase', on: p.on ?? 2.4, off: p.off ?? 1.2, offset: i * (p.stagger ?? 1.2) } });
    }
    b.gap(w, p.upEnd ?? 0);
    b.flat(p.land ?? 3);
    b.enemies(p.e, x0, floorY);
  },

  /** Panes of glass across the way: shoot them out. */
  glass(b, p) {
    const x0 = b.x;
    const n = p.n ?? 2;
    const len = p.len ?? 10;
    b.flat(len);
    b.solid(x0, b.y - (p.roof ?? 4) * T - 200, len * T, 200, 'block');
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 1) * len * T) / (n + 1);
      b.crate(x - 8, b.y - (p.roof ?? 4) * T, 16, (p.roof ?? 4) * T, p.drop && i === n - 1 ? p.drop : null, p.hp ?? 2, 'glass');
    }
    b.enemies(p.e, x0);
  },

  /** A laser across the way, on a clock: run through while it is off. */
  laser(b, p) {
    const x0 = b.x;
    const len = p.len ?? 8;
    b.flat(len);
    const roof = (p.roof ?? 5) * T;
    b.solid(x0, b.y - roof - 200, len * T, 200, 'block');
    const n = p.n ?? 1;
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 1) * len * T) / (n + 1);
      b.bp.lasers.push({ dir: 'v', x, y0: b.y - roof, y1: b.y, period: p.period ?? 3, on: p.on ?? 1.4, offset: i * (p.stagger ?? 1) });
    }
    b.enemies(p.e, x0);
  },

  /** A room that shuts behind you until its waves are beaten. */
  ambush(b, p) {
    const x0 = b.x;
    const len = p.len ?? 22;
    const roof = (p.roof ?? 8) * T;
    b.flat(len);
    const floorY = b.y;
    b.solid(x0, floorY - roof - 200, len * T, 200, 'block');
    for (const k of p.list || []) b.thin(x0 + k[0] * T, x0 + (k[0] + k[2]) * T, floorY - k[1] * T);
    const waves = (p.waves || []).map((wave) =>
      wave.map(([kind, dx, up, opts]) => {
        const k = KINDS[kind];
        const grounded = ['walk', 'run', 'jump', 'still'].includes(k.move) && !up;
        return { kind, x: x0 + dx * T, y: grounded ? floorY - k.r - 1 : floorY - (up ?? 3) * T, ...(p.folded ? { folded: true } : {}), ...(opts || {}) };
      }),
    );
    b.bp.ambushes.push({ x0, x1: x0 + len * T, top: floorY - roof, floor: floorY, waves, drop: p.drop ?? null });
    b.flat(1);
  },

  checkpoint(b) {
    b.flat(2);
    b.bp.checkpoints.push({ x: b.x - T, y: b.y - 40 });
    b.flat(2);
  },

  /**
   * A secret. 'loft': a ledge out of jumping reach with a wall behind it, got
   * to by wormhole. 'cellar': a room under a crate in the floor. 'sky': a
   * run of thin ledges above a spring nobody needs to use.
   */
  secret(b, p) {
    const x0 = b.x;
    const kind = p.kind || 'loft';
    const reward = p.reward || ['random'];
    if (kind === 'loft') {
      b.flat(12);
      const up = p.up ?? 8;
      const lx = x0 + 3 * T;
      const ly = b.y - up * T;
      b.solid(lx, ly, 6 * T, T, 'block');
      b.solid(lx + 6 * T, ly - 5 * T, T, 6 * T, 'block');
      reward.forEach((k, i) => b.pickup(k, lx + (1.5 + i * 1.5) * T, ly - T * 0.8));
      b.bp.secrets.push({ x0: lx, x1: lx + 6 * T, y0: ly - 3 * T, y1: ly });
    } else if (kind === 'cellar') {
      b.flat(4);
      const cx = b.x;
      const floorY = b.y;
      b.endRun();
      b.x += 3 * T;
      b.startRun();
      b.crate(cx, floorY, 3 * T, T, null, 2, 'crate');
      // The room below: its floor, and room to walk sideways under the ground.
      const depth = 3.5 * T;
      b.solid(cx, floorY + depth, 3 * T, 900, 'ground');
      reward.forEach((k, i) => b.pickup(k, cx + (0.7 + i * 0.8) * T, floorY + depth - T * 0.7));
      b.bp.secrets.push({ x0: cx, x1: cx + 3 * T, y0: floorY + T, y1: floorY + depth });
      b.flat(5);
    } else if (kind === 'sky') {
      b.flat(3);
      const sx = b.x;
      const s = b.solid(sx, b.y - 14, 2 * T, 14, 'spring');
      const rec = { x: sx, y: b.y - 14, w: 2 * T, power: 1250, squash: 0 };
      s.spring = rec;
      b.bp.springs.push(rec);
      b.flat(10);
      const hy = b.y - 9 * T;
      b.thin(sx + 3 * T, sx + 9 * T, hy);
      reward.forEach((k, i) => b.pickup(k, sx + (4 + i * 1.5) * T, hy - T * 0.8));
      b.bp.secrets.push({ x0: sx + 3 * T, x1: sx + 9 * T, y0: hy - 3 * T, y1: hy });
    }
  },

  /**
   * A bulkhead: a wall from the floor to well above any jump, with a gap
   * under it too low for the robot and just tall enough to see (and shoot)
   * under. Beyond it, a pillar's face. The only way through is a wormhole:
   * one end on that face, seen under the bulkhead, the other this side.
   */
  bulkhead(b, p) {
    const x0 = b.x;
    b.flat(p.run ?? 6);
    const wx = b.x;
    const floorY = b.y;
    const gap = (p.gap ?? 1.3) * T; // 52 px: easy to see and shoot under, and still short of the robot's 60
    const tall = (p.tall ?? 11) * T;
    b.flat(2);
    b.solid(wx, floorY - tall, 2 * T, tall - gap, 'bulkhead');
    b.flat(p.room ?? 6);
    const px = b.x;
    b.rise(p.pillar ?? 3);
    b.flat(2);
    b.rise(-(p.pillar ?? 3));
    b.flat(p.after ?? 4);
    b.bp.portalLinks.push({ kind: 'bulkhead', from: { x: wx - 60, y: floorY }, to: { x: wx + 2 * T + 60, y: floorY }, wall: wx, face: px });
    b.enemies(p.e, x0);
  },

  /**
   * A chasm no jump crosses, with a wall on the far side facing back across
   * it: a wormhole end on that wall, the other in the floor at your feet,
   * and you step out on the far side.
   */
  chasm(b, p) {
    const x0 = b.x;
    b.flat(p.run ?? 4);
    const near = b.x;
    const floorY = b.y;
    b.gap(p.w ?? 14, 0);
    const far = b.x;
    b.flat(p.land ?? 7);
    const wall = b.x;
    b.rise(p.up ?? 4);
    b.flat(p.after ?? 4);
    b.bp.portalLinks.push({ kind: 'chasm', from: { x: near - 60, y: floorY }, to: { x: far + 80, y: floorY }, wall });
    b.enemies(p.e, x0, floorY);
  },

  /**
   * A tower: an enclosed shaft `up` tiles high, entered through a doorway at
   * its foot and left at the top to the right. Thin ledges zig-zag up it at
   * the robot's jump spacing, the last one by the top; a lift rides up the
   * middle if `lift`. What lives in it is placed by height (`e`: [kind, dx, up]).
   */
  tower(b, p) {
    const x0 = b.x;
    const up = p.up ?? 16;
    const width = p.width ?? 9;
    const floorY = b.y;
    b.flat(width);
    const top = floorY - up * T;
    // The wall on the left, over the doorway and on up past the top: the only way on is up.
    b.solid(x0 - T, top - 6 * T, T, (up + 2.5) * T, 'block');
    const n = Math.ceil(up / LIMITS.platGap) - 1;
    for (let i = 1; i <= n; i++) {
      const y = floorY - i * (up / (n + 1)) * T;
      const col = (n - i) % 3; // counted from the top: right, middle, left, right...
      const lx = col === 0 ? x0 + (width - 3.5) * T : col === 1 ? x0 + (width / 2 - 1.5) * T : x0 + T * 0.5;
      b.thin(lx, lx + 3 * T, y);
    }
    if (p.lift) b.bp.movers.push({ x: x0 + (width / 2 - 1.25) * T, y: top + 2 * T, w: 2.5 * T, h: 18, oneWay: true, path: { type: 'line', dx: 0, dy: (up - 4) * T, period: p.lift, phase: 0 } });
    b.rise(up);
    b.flat(p.after ?? 4);
    b.enemies(p.e, x0, floorY);
  },

  /**
   * A shaft: the floor gives way to a drop `down` tiles deep between two
   * walls, past ledges on alternate sides, and out at the foot to the right.
   * The far wall stands high over the lip, so the only way on is down.
   * What lives in it is placed by height above the foot.
   */
  shaft(b, p) {
    b.flat(p.run ?? 3);
    const x0 = b.x;
    const floorY = b.y;
    const down = p.down ?? 14;
    const width = p.width ?? 8;
    b.rise(-down);
    const foot = b.y;
    b.flat(width);
    const wx = b.x;
    b.solid(wx, floorY - 8 * T, 2 * T, (down + 4.5) * T, 'block');
    const n = Math.floor(down / 4);
    for (let i = 1; i <= n; i++) {
      const y = floorY + i * (down / (n + 1)) * T;
      const lx = i % 2 ? x0 : x0 + (width - 3) * T;
      b.thin(lx, lx + 3 * T, y);
    }
    b.flat(2 + (p.after ?? 4));
    b.enemies(p.e, x0, foot);
  },

  /**
   * A skylight: a cave whose far wall is a cliff no jump climbs, with a hole
   * in its roof at the far end. Through the hole, from the cave floor, a
   * step's face is in sight on the level above: a wormhole end on it, the
   * other in the floor at your feet, and you come out up there. A wall over
   * the cave's mouth keeps that face out of sight from outside.
   */
  skylight(b, p) {
    b.flat(p.run ?? 4);
    const xc = b.x;
    const floorY = b.y;
    const cave = p.cave ?? 16;
    const hole = p.hole ?? 3;
    const up = p.up ?? 7;
    b.flat(cave);
    b.solid(xc, floorY - up * T, (cave - hole) * T, T, 'block'); // the roof, flush with the floor above
    b.solid(xc, floorY - (up + 6) * T, T, 6 * T, 'block'); // the wall over the mouth
    b.rise(up);
    b.flat(p.land ?? 3);
    const face = b.x;
    b.rise(p.step ?? 3);
    b.flat(p.after ?? 4);
    b.bp.portalLinks.push({ kind: 'skylight', from: { x: xc + 3 * T, y: floorY }, to: { x: face - 40, y: floorY - up * T }, stand: xc + 3 * T, wall: face });
    b.enemies(p.e, xc, floorY);
  },

  /**
   * A vault: a door shut across a corridor under a low roof, and the switch
   * that opens it sealed in a glass box on the floor before it. You can see
   * in; no charge can get in. One wormhole end on the vault's back wall, seen
   * through the glass, the other on the roof over your head: fire up into it,
   * and the charge comes out in the vault, straight at the switch.
   */
  vault(b, p) {
    b.flat(p.run ?? 2);
    const x0 = b.x;
    const floorY = b.y;
    const roof = 5.5 * T;
    b.flat(p.stand ?? 6);
    const vx = b.x; // the glass front
    b.flat(5); // half a tile of glass, three and a half inside, a tile of back wall
    const dx = b.x + T;
    b.flat(3 + (p.after ?? 4));
    b.solid(x0, floorY - roof - T, dx + 2 * T - x0, T, 'block');
    b.solid(vx, floorY - 3.5 * T, 0.5 * T, 3.5 * T, 'window');
    b.solid(vx + 0.5 * T, floorY - 3.5 * T, 4.5 * T, 0.5 * T, 'block'); // the lid, over the back wall too
    b.solid(vx + 4 * T, floorY - 3 * T, T, 3 * T, 'block'); // the back wall: its face is the vault's inside, no more
    const id = b.door(dx, floorY - roof, floorY);
    b.bp.switches.push({ x: vx + 2.25 * T, y: floorY - 1.5 * T, doors: [id] });
    b.bp.portalLinks.push({ kind: 'vault', from: { x: vx - 2 * T, y: floorY }, to: { x: dx + 2 * T, y: floorY }, stand: vx - 2 * T, wall: vx + 4 * T, door: id });
    b.enemies(p.e, x0);
  },

  /**
   * A chimney: a door across a corridor under a low roof, and its switch at
   * the top of a narrow chimney in the roof, over a bed of spikes. No straight
   * line from anywhere you can stand reaches it; a charge banked into the
   * chimney bounces up it to the switch.
   */
  chimney(b, p) {
    b.flat(p.run ?? 2);
    const x0 = b.x;
    const floorY = b.y;
    const roof = 5 * T;
    b.flat(p.stand ?? 5);
    const sx = b.x;
    b.spikeBed(4);
    const cx = sx + 2 * T;
    b.flat(4);
    const dx = b.x;
    b.flat(2 + (p.after ?? 4));
    const half = 0.75 * T;
    b.solid(x0, floorY - roof - T, cx - half - x0, T, 'block');
    b.solid(cx + half, floorY - roof - T, dx + 2 * T - cx - half, T, 'block');
    b.solid(cx - half - 0.5 * T, floorY - roof - 5 * T, 0.5 * T, 4 * T, 'block');
    b.solid(cx + half, floorY - roof - 5 * T, 0.5 * T, 4 * T, 'block');
    b.solid(cx - half - 0.5 * T, floorY - roof - 5.5 * T, 2 * half + T, 0.5 * T, 'block');
    const id = b.door(dx, floorY - roof, floorY);
    b.bp.switches.push({ x: cx, y: floorY - roof - 5 * T + 20, doors: [id] });
    b.bp.portalLinks.push({ kind: 'chimney', from: { x: sx - 2 * T, y: floorY }, to: { x: dx + 2 * T, y: floorY }, stands: [sx - 2 * T, sx - T, sx, sx + 4 * T, sx + 5 * T, sx + 6 * T], aim: [-Math.PI + 0.2, -0.2], door: id });
    b.enemies(p.e, x0);
  },

  /**
   * An orbit: a wall too tall to jump with a door at its foot, the door's
   * switch on the floor of a pocket behind it, and a black hole hanging high
   * over the pocket. The pocket is walled on both sides and open only to the
   * sky, so no straight shot reaches the switch, and no bank either (a wall
   * never turns a rising charge downward); a charge fired up past the hole
   * comes round it and down into the pocket.
   */
  orbit(b, p) {
    b.flat(p.run ?? 10);
    const floorY = b.y;
    const wx = b.x;
    const behind = p.behind ?? 8;
    b.flat(behind);
    b.flat(p.after ?? 4);
    b.solid(wx - 0.5 * T, floorY - 8 * T, T, 4.5 * T, 'block'); // the wall over the doorway
    b.solid(wx + behind * T, floorY - 12 * T, T, 8.5 * T, 'block'); // the pocket's far wall, hung over the way on
    const id = b.door(wx, floorY - 3.5 * T, floorY);
    const w = p.hole || { dx: 2, up: 9, range: 5, pull: 700000 };
    b.bp.wells.push({ x: wx + w.dx * T, y: floorY - w.up * T, r: 22, range: w.range * T, pull: w.pull });
    b.bp.switches.push({ x: wx + (p.at ?? 4) * T, y: floorY - 18, doors: [id] });
    b.bp.portalLinks.push({ kind: 'orbit', from: { x: wx - 3 * T, y: floorY }, to: { x: wx + 2 * T, y: floorY }, stands: [wx - 9 * T, wx - 7 * T, wx - 5 * T, wx - 3 * T, wx - 1.5 * T], aim: [-Math.PI / 2 - 0.2, -0.15], door: id });
    b.enemies(p.e, wx - (p.run ?? 10) * T, floorY);
  },

  /**
   * A door across the way under a low roof, and its switch in plain sight on
   * the roof `at` tiles before it: shoot it. With `hold`, the door only stays
   * open that many seconds: shoot, then run.
   */
  switchdoor(b, p) {
    b.flat(p.run ?? 2);
    const x0 = b.x;
    const floorY = b.y;
    const roof = 5 * T;
    b.flat(p.stand ?? 8);
    const dx = b.x;
    b.flat(2 + (p.after ?? 4));
    b.solid(x0, floorY - roof - T, dx + 2 * T - x0, T, 'block');
    const id = b.door(dx, floorY - roof, floorY);
    const at = p.at ?? 3;
    b.bp.switches.push({ x: dx - at * T, y: floorY - roof + 22, doors: [id], hold: p.hold });
    const near = [dx - (at + 4) * T, dx - (at + 2) * T].filter((x) => x > x0 + T);
    b.bp.portalLinks.push({ kind: 'switch', from: { x: dx - 5 * T, y: floorY }, to: { x: dx + 2 * T, y: floorY }, stands: near.length ? near : [x0 + 2 * T], aim: [-Math.PI + 0.1, -0.1], door: id });
    b.enemies(p.e, x0);
  },

  /**
   * A long run of blinking platforms over a pit, in patterns: first a wave
   * that travels across (each appears a beat after the one before), then a
   * rest on a pillar, then pairs that trade places, each lighting as the
   * other is about to go.
   */
  phaseRun(b, p) {
    b.flat(p.run ?? 3);
    const x0 = b.x;
    const floorY = b.y;
    const step = 3 * T;
    const wave = p.wave ?? 6;
    const pairs = p.pairs ?? 6;
    const on = p.on ?? 2.4;
    const off = p.off ?? 1.2;
    const plat = (x, up, offset) => b.bp.movers.push({ x, y: floorY - up * T, w: 2.5 * T, h: 18, kind: 'phase', path: { type: 'phase', on, off, offset } });
    let x = x0 + T;
    for (let i = 0; i < wave; i++, x += step) plat(x, i % 2 ? 1.5 : 0.5, -i * (p.beat ?? 0.5));
    const pillar = x;
    b.solid(pillar, floorY, 2.5 * T, 14 * T, 'block');
    x += step;
    for (let i = 0; i < pairs; i++, x += step) plat(x, 0.5 + (i % 3) * 0.5, i % 2 ? -(on + off) / 2 : 0);
    b.gap((x - x0) / T + 0.5, 0);
    b.flat(p.land ?? 4);
    b.enemies(p.e, x0, floorY);
  },

  /** A sign: a line of text on a post, for the early levels to teach with. */
  sign(b, p) {
    b.flat(p.len ?? 3);
    b.bp.signs.push({ x: b.x - T * 1.5, y: b.y, text: p.text });
  },
};

/**
 * The arena at the end: a closed room W x H with the boss's own furniture,
 * entered through a door that shuts once you are in.
 */
function arena(b, id) {
  const def = BOSSES[id];
  const A = def.arena;
  b.flat(6);
  // A boss that only a wormhole beats says so at its door.
  if (def.hint) b.bp.signs.push({ x: b.x - 3 * T, y: b.y, text: def.hint });
  const x0 = b.x;
  const floor = b.y;
  const top = floor - A.h;
  const x1 = x0 + A.w;
  const door = 5 * T;
  b.flat(A.w / T);
  // Roof, the wall over the door, and the far wall.
  b.solid(x0 - 40, top - 300, A.w + 80, 300, 'arena');
  b.solid(x0 - 40, top, 40, A.h - door, 'arena');
  b.solid(x1, top - 300, 400, A.h + 300, 'arena');
  const at = (x, y) => [x0 + x, top + y];
  for (const [x, y, w, h] of A.solids || []) {
    const [ax, ay] = at(x, y);
    b.solid(ax, ay, w, h, 'block');
  }
  for (const o of A.oneWays || []) b.thin(x0 + o.x0, x0 + o.x1, top + o.y);
  for (const m of A.movers || []) b.bp.movers.push({ ...m, x: x0 + m.x, y: top + m.y });
  for (const w of A.wells || []) b.bp.wells.push({ ...w, x: x0 + w.x, y: top + w.y });
  for (const s of A.springs || []) {
    const sx = x0 + s.x;
    const sol = b.solid(sx, floor - 14, s.w, 14, 'spring');
    const rec = { x: sx, y: floor - 14, w: s.w, power: s.power, squash: 0 };
    sol.spring = rec;
    b.bp.springs.push(rec);
  }
  b.bp.arena = { boss: id, x0, x1, top, floor, door, cx: (x0 + x1) / 2, cy: (top + floor) / 2, w: A.w, h: A.h, dark: !!def.dark };
  // Just inside the door: the checkpoint a continue at the boss starts from, straight back into the fight.
  b.bp.checkpoints.push({ x: x0 + 110, y: floor - 40, boss: true, hidden: true });
  b.x = x1 + 400;
  b.run.pts.push([b.x, floor]);
  b.minY = Math.min(b.minY, top - 300);
}

/** Build a level definition into a blueprint (see createWorld in world.js). */
export function buildLevel(def) {
  const b = new Builder(def);
  b.flat(2);
  b.bp.spawn = { x: 3 * T, y: b.y - 40 };
  b.flat(4);
  for (const s of def.sections) {
    const [type, p] = Array.isArray(s) ? s : [s.type, s];
    const fn = SECTIONS[type];
    if (!fn) throw new Error(`unknown section ${type} in level ${def.id}`);
    const from = b.x;
    const floorFrom = b.y;
    fn(b, p || {});
    b.bp.sections.push({ type, x0: from, x1: b.x, y0: floorFrom, y1: b.y, p: p || {} });
  }
  arena(b, def.boss);
  const bp = b.finish();
  bp.dark = !!def.dark;
  bp.boss = def.boss;
  return bp;
}

/**
 * About how long a level takes a first-time player before its boss, in
 * seconds: the distance at a careful pace (2.6 tiles a second, Super Mario
 * Bros. 3's own), plus time for what is in the way. A guide for building
 * levels to the lengths the design asks for, not a measurement.
 */
export function estimateSeconds(bp) {
  const arenaW = bp.arena ? bp.arena.x1 - bp.arena.x0 + 600 : 0;
  let s = (bp.width - arenaW) / (2.6 * T);
  s += bp.enemies.length * 1.1;
  for (const sec of bp.sections) {
    s += Math.abs(sec.y1 - sec.y0) / (4 * T); // climbing and dropping
    if (['gap', 'plats', 'mover', 'well', 'fount', 'phase', 'spikes'].includes(sec.type)) s += 2.5;
    if (sec.type === 'mover' || sec.type === 'phase') s += 3;
    if (sec.type === 'crushers' || sec.type === 'laser') s += 4;
    if (sec.type === 'ambush') s += (sec.p.waves || []).reduce((n, w) => n + w.length * 2.2, 3);
    if (sec.type === 'glass') s += 2;
    if (sec.type === 'tower') s += (sec.p.up ?? 16) * 0.35; // ledge by ledge
    if (sec.type === 'shaft') s += 3;
    if (sec.type === 'phaseRun') s += 14;
    // Working a puzzle out, and then doing it.
    if (sec.type === 'skylight' || sec.type === 'vault') s += 14;
    if (sec.type === 'chimney' || sec.type === 'orbit') s += 10;
    if (sec.type === 'switchdoor') s += 4;
  }
  return s;
}
