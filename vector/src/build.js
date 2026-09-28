// How a level is built: a list of sections laid end to end along a path that
// can turn (a gap, a climb, a pit with a black hole under it, a wall with a
// low gap only a wormhole gets you under), each written in its own frame
// (x to the right, y up, z along the way) and turned into the world by the
// path's heading, which is always a quarter turn, so every box stays square
// to the axes. Each section also writes down how it is crossed, as steps for
// the autopilot (autopilot.js), which flies them with the robot's own physics
// in the tests: that is the proof that every level can be crossed.
// DOM-free.
import { World } from './world.js';
import { rng, add, sub, scale, norm, dot, len } from './math.js';
import { standAt } from './player.js';
import { ROBOT, WORM, JUMP } from './config.js';

const EYE = ROBOT.half + ROBOT.r + ROBOT.eye; // feet to eye: 1.52 m
const FEET = ROBOT.half + ROBOT.r; // feet to centre

export class Builder {
  constructor(def) {
    this.def = def;
    this.world = new World();
    this.r = rng(def.seed || 1);
    this.cur = { p: [0, 0, 0], h: 0 };
    this.W = def.width || 8; // the path's width
    this.route = [];
    this.enemies = [];
    this.pickups = [];
    this.checkpoints = [];
    this.props = [];
    this.signs = [];
    this.lines = [];
    this.links = []; // the puzzles: each a record of what beats it
    this.sections = [];
    this.ambushes = [];
    this.secrets = 0;
    this.doorId = 1;
    this.minY = 0;
    this.roof = def.roof || 0; // enclosed levels: walls and a roof this high over the path
    this.difficulty = 0; // 0 at the start of the run, 1 at its end
  }

  // ------------------------------------------------------------ frames

  get F() {
    const a = (this.cur.h * Math.PI) / 2;
    return [Math.round(Math.sin(a)), 0, Math.round(Math.cos(a))];
  }

  get R() {
    const a = (this.cur.h * Math.PI) / 2;
    return [-Math.round(Math.cos(a)), 0, Math.round(Math.sin(a))];
  }

  get yaw() {
    return (this.cur.h * Math.PI) / 2;
  }

  /** A point in the section's frame, in the world. */
  P(x, y, z) {
    const o = this.cur.p;
    const F = this.F;
    const R = this.R;
    return [o[0] + R[0] * x + F[0] * z, o[1] + y, o[2] + R[2] * x + F[2] * z];
  }

  /** A direction in the section's frame, in the world. */
  D(x, y, z) {
    const F = this.F;
    const R = this.R;
    return norm([R[0] * x + F[0] * z, y, R[2] * x + F[2] * z]);
  }

  aabb(a, b) {
    const p = this.P(...a);
    const q = this.P(...b);
    return [[Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])], [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])]];
  }

  box(a, b, props = {}) {
    const [min, max] = this.aabb(a, b);
    return this.world.box(min, max, props);
  }

  /** A ramp climbing along local z (dir +1 forward) or local x (dir +1 to the right). */
  ramp(a, b, axis, dir, props = {}) {
    const [min, max] = this.aabb(a, b);
    let wAxis;
    let wDir;
    if (axis === 'z') {
      const F = this.F;
      wAxis = F[0] !== 0 ? 'x' : 'z';
      wDir = dir * (F[0] || F[2]);
    } else {
      const R = this.R;
      wAxis = R[0] !== 0 ? 'x' : 'z';
      wDir = dir * (R[0] || R[2]);
    }
    return this.world.ramp(min, max, wAxis, wDir, props);
  }

  /** A floor slab from z0 to z1 at height y, the path's width (or w), its top a floor. */
  floor(z0, z1, y = 0, props = {}) {
    const w = props.w || this.W;
    const x0 = props.x != null ? props.x - w / 2 : -w / 2;
    const s = this.box([x0, y - (props.thick || 2), z0], [x0 + w, y, z1], { role: 'floor', ...props });
    this.minY = Math.min(this.minY, this.cur.p[1] + y);
    // An open level's road has barriers along its edges (low enough to jump).
    const R = this.def.rails;
    if (R && !props.w && props.x == null && !props.noRails && z1 - z0 > 2) {
      for (const sd of [-1, 1]) this.box([sd > 0 ? w / 2 : -w / 2 - R.w, y, z0], [sd > 0 ? w / 2 + R.w : -w / 2, y + R.h, z1], { role: R.role || 'trim', noPortal: true });
    }
    return s;
  }

  /** Walls either side (and a roof, in an enclosed level) from z0 to z1. */
  sides(z0, z1, y = 0, h = null, o = {}) {
    const H = h || this.roof || 0;
    if (!H) return;
    const w = this.W / 2;
    if (!o.noLeft) this.box([-w - 1, y - 2, z0], [-w, y + H, z1], { role: 'wall' });
    if (!o.noRight) this.box([w, y - 2, z0], [w + 1, y + H, z1], { role: 'wall' });
    if (this.roof && !o.noRoof) {
      this.box([-w - 1, y + H, z0], [w + 1, y + H + 1, z1], { role: 'roof' });
      // Lamps down the middle of the roof, every few metres.
      const lamp = this.def.lamp || '#e8f2ff';
      for (let z = z0 + 1.5; z + 1.6 < z1; z += 5) this.box([-0.35, y + H - 0.08, z], [0.35, y + H, z + 1.6], { mat: 'lamp', color: lamp, glow: 0.6, noPortal: true, passCharges: true });
      this.wallDress(z0, z1, y, o);
    }
  }

  /** Against the walls of an enclosed level: rack fronts, furnaces, tiles, shelves. */
  wallDress(z0, z1, y, o = {}) {
    const D = this.def.wallDecor;
    if (!D || !D.length) return;
    const w = this.W / 2;
    for (let z = z0 + 2 + this.r() * 2; z + 1.5 < z1; z += 3.2 + this.r() * 2.5) {
      for (const sd of [-1, 1]) {
        if ((sd < 0 && o.noLeft) || (sd > 0 && o.noRight)) continue;
        if (this.r() < 0.25) continue;
        const d = this.r.pick(D);
        const depth = d.depth || 0.3;
        this.prop(d.kind, sd * (w - depth / 2), y + (d.dy || 0), z, { ...d, yaw: sd > 0 ? Math.PI / 2 : -Math.PI / 2, seed: Math.floor(this.r() * 1e6) });
        // Solid, though unseen: you cannot walk through a rack, and no end opens behind one.
        if (depth > 0.1) this.box([sd > 0 ? w - depth : -w, y, z - 0.6], [sd > 0 ? w : -w + depth, y + 2.3, z + 0.6], { invisible: true, noPortal: true, role: 'trim' });
      }
    }
  }

  /** Move the cursor along the path: forward dz, up dy. */
  advance(dz, dy = 0) {
    const F = this.F;
    this.cur.p = [this.cur.p[0] + F[0] * dz, this.cur.p[1] + dy, this.cur.p[2] + F[2] * dz];
  }

  // ------------------------------------------------------------- routes

  step(s) {
    this.route.push(s);
  }

  /** Walk (or run) to a point on the floor at local (x, y, z). */
  go(x, y, z, run = false) {
    this.step({ a: 'go', to: standAt(...this.P(x, y, z)), run });
  }

  /** A jump from local (x, y0, z0) to (x2, y1, z1): run up, leave at the first point, land on the second. */
  jump(x, y0, z0, x2, y1, z1, run = true) {
    this.step({ a: 'jump', from: standAt(...this.P(x, y0, z0)), to: standAt(...this.P(x2, y1, z1)), run });
  }

  enemy(spec) {
    const p = spec.p;
    const s = { ...spec, p: this.P(...p) };
    if (spec.to) s.to = this.P(...spec.to);
    s.yaw = this.yaw + (spec.yaw || 0);
    this.enemies.push(s);
  }

  pickup(kind, x, y, z, o = {}) {
    this.pickups.push({ kind: kind === 'shield' ? 'shield' : 'power', power: kind === 'shield' ? null : kind, p: this.P(x, y + 0.9, z), ...o });
  }

  prop(kind, x, y, z, o = {}) {
    this.props.push({ kind, p: this.P(x, y, z), yaw: this.yaw + (o.yaw || 0), ...o });
  }

  sign(x, y, z, text, reach = 7) {
    this.signs.push({ p: this.P(x, y, z), text, reach });
  }

  line(z0, z1, who, text, name) {
    const [min, max] = this.aabb([-this.W, -2, z0], [this.W, 8, z1]);
    this.lines.push({ min, max, who, text, name });
  }

  checkpoint(z) {
    const [min, max] = this.aabb([-this.W / 2, -1, z - 1], [this.W / 2, 5, z + 1]);
    this.checkpoints.push({ p: standAt(...this.P(0, 0, z)), yaw: this.yaw, min, max });
    this.box([-1.2, 0, z - 1.2], [1.2, 0.08, z + 1.2], { mat: 'panel', color: this.def.accent || '#9dff5c', glow: 0.15, role: 'pad' });
  }

  /** A roster pick: one of the level's enemies, by the way it moves. */
  foe(moves) {
    const R = this.def.roster.filter((f) => moves.includes(f.move));
    if (!R.length) return null;
    return this.r.pick(R);
  }

  /** Put an enemy of the level's own over (or on) a stretch, if the level has one that moves that way. */
  guard(kind, x, y, z, o = {}) {
    const f = this.foe(kind === 'air' ? ['flier', 'zigzag', 'circler', 'gunner', 'diver'] : kind === 'ground' ? ['walker', 'chaser', 'hopper', 'trundle', 'lancer'] : [kind]);
    if (!f) return;
    this.enemy({ ...f, ...o, p: [x, y, z] });
  }

  // ----------------------------------------------------------- dressing

  /** Scenery either side of a stretch, from the level's own list. */
  dress(z0, z1, y = 0) {
    const D = this.def.decor;
    if (!D || !D.length) return;
    const every = this.def.decorEvery || 9;
    for (let z = z0 + this.r() * every; z < z1; z += every * (0.7 + this.r() * 0.6)) {
      for (const side of [-1, 1]) {
        if (this.r() < 0.35) continue;
        const d = this.r.pick(D);
        const off = this.W / 2 + (d.off || 3) + this.r() * (d.spread ?? 6);
        this.prop(d.kind, side * off, y + (d.dy || 0), z, { ...d, yaw: this.r() * Math.PI * 2, seed: Math.floor(this.r() * 1e6) });
      }
    }
  }

  // ------------------------------------------------------------- finish

  finish() {
    const W = this.world;
    W.floorY = this.minY;
    return {
      world: W,
      route: this.route,
      enemies: this.enemies,
      pickups: this.pickups,
      checkpoints: this.checkpoints,
      props: this.props,
      signs: this.signs,
      lines: this.lines,
      links: this.links,
      sections: this.sections,
      ambushes: this.ambushes,
      secrets: this.secrets,
      floorY: this.minY,
    };
  }
}

export { EYE, FEET, WORM, JUMP, add, sub, scale, dot, len };
