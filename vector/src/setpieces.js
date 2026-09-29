// One hand-built stretch in every level, found nowhere else: the grid
// heaving like a sea, a wire tree to climb, the render farm's conveyors, a
// foundry's pours, a freeway interchange, a billboard's lights, a train, a
// harbour crane, a chairlift and a workbench seen from the size of a pencil.
// Each is built for its own level's look, writes how it is crossed, and
// draws on its own random numbers (levels.js). DOM-free.
import { standAt } from './player.js';

function mark(b, type, z0, z1, extra = {}) {
  b.sections.push({ type, from: b.P(0, 0, z0), to: b.P(0, 0, z1), h: b.cur.h, ...extra });
}

/** A pit's bottom: the void, or in an enclosed level a trench with something nasty in it. */
function pit(b, z0, z1, y = 0, x0 = -b.W / 2, x1 = b.W / 2) {
  const d = b.def.trench;
  if (!d) return;
  b.box([x0, y - d.depth - 2, z0], [x1, y - d.depth, z1], { role: 'floor', noSafe: true });
  const [min, max] = b.aabb([x0, y - d.depth, z0], [x1, y - d.depth + 0.8, z1]);
  b.world.hazards.push({ min, max, kind: d.kind || 'spikes', trench: true });
}

/** Walls either side, x0 to x1, and in an enclosed level a roof H up, over z0 to z1. */
function hallOf(b, x0, x1, z0, z1, H, lo = -2) {
  b.box([x0 - 1, lo, z0], [x0, H, z1], { role: 'wall' });
  b.box([x1, lo, z0], [x1 + 1, H, z1], { role: 'wall' });
  if (b.roof) {
    b.box([x0 - 1, H, z0], [x1 + 1, H + 1, z1], { role: 'roof' });
    const lamp = b.def.lamp || '#e8f2ff';
    for (let z = z0 + 1.5; z + 1.6 < z1; z += 5) b.box([(x0 + x1) / 2 - 0.35, H - 0.08, z], [(x0 + x1) / 2 + 0.35, H, z + 1.6], { mat: 'lamp', color: lamp, glow: 0.6, noPortal: true, passCharges: true });
  }
}

/** Where a taller stretch meets the halls either side: a lintel down to theirs. */
function lintels(b, L, H, y0 = 0, y1 = 0) {
  if (!b.roof) return;
  const w = b.W / 2;
  if (y0 + b.roof < H) b.box([-w - 1, y0 + b.roof, -1], [w + 1, H, 0], { role: 'wall' });
  if (y1 + b.roof < H) b.box([-w - 1, y1 + b.roof, L], [w + 1, H, L + 1], { role: 'wall' });
}

export const SETPIECES = {
  /**
   * The Fold (the Edge of the Grid). Thirty metres where the grid has come
   * loose from itself: its floor, in strips, heaves in a long swell rolling
   * toward you, still at either end and a man's height at its crest. It
   * never tilts a step further than a stair, so it is walked; but it moves.
   */
  fold(b, o = {}) {
    const w = b.W / 2;
    const n = 24;
    const step = 1;
    const z0 = 3;
    const L = z0 + n * step + 3;
    const A = o.swell || 1.5;
    b.floor(0, z0);
    b.floor(z0 + n * step, L);
    for (let i = 0; i < n; i++) {
      const z = z0 + i * step;
      const a = A * Math.sin((Math.PI * (i + 0.5)) / n);
      b.box([-w, -0.6, z], [w, 0, z + step], { role: 'plat', move: { to: [0, a, 0], period: 4.5, phase: i * 0.04 } });
    }
    b.sides(0, L, 0, b.roof ? b.roof + A : 0);
    b.dress(0, L);
    mark(b, 'fold', 0, L);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * The Wire Tree (Wireframe Wilds). A gulf, and in it a tree of wire, its
   * trunk rising from nowhere. Branches spiral up round it, each swaying on
   * its own; the highest reaches out over the gulf to the far side, 8 m up.
   */
  wiretree(b, o = {}) {
    const A = 6;
    const tz0 = 10;
    const tz1 = 13;
    const top = 8.4;
    const L = 36;
    b.floor(0, A);
    pit(b, A, 30, 0);
    const wire = { mat: 'wire', color: b.def.accent || '#3dff9a', glow: 0.35 };
    b.box([-1.5, -12, tz0], [1.5, top + 5, tz1], { role: 'wall', ...wire });
    // Six branches round it, each a jump up from the one before, swaying.
    const at = [[0, 8.4], [2.9, 11.5], [0, 14.6], [-2.9, 11.5], [0, 8.4], [2.9, 11.5]];
    const out = [[0, -1], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 0]];
    const br = [];
    for (let i = 0; i < 6; i++) {
      const [x, z] = at[i];
      const y = 1.2 * (i + 1);
      const s = b.box([x - 1.3, y - 0.4, z - 1.3], [x + 1.3, y, z + 1.3], { role: 'plat', ...wire, move: { to: b.D(out[i][0], 0, out[i][1]).map((v) => v * 0.5), period: 3 + i * 0.35, phase: i * 0.2 } });
      br.push(s);
      // The limb it hangs from, back to the trunk.
      b.box([Math.min(x, 0) - 0.2, y - 0.3, Math.min(z, 11.5) - 0.2], [Math.max(x, 0) + 0.2, y - 0.1, Math.max(z, 11.5) + 0.2], { role: 'trim', ...wire, noPortal: true });
    }
    // The long branch out over the gulf, and the far side.
    b.box([-1, top - 0.4, tz1], [1, top, 30], { role: 'plat', ...wire });
    b.floor(30, L, top);
    b.dress(0, L);
    mark(b, 'wiretree', 0, L, { top });
    b.go(0, 0, A - 0.8);
    let from = [0, 0, A - 0.5];
    for (let i = 0; i < 6; i++) {
      const [x, z] = at[i];
      const y = 1.2 * (i + 1);
      b.jump(from[0], from[1], from[2], x, y, z, false);
      from = [x + out[(i + 1) % 6][0] * 0.6, y, z + out[(i + 1) % 6][1] * 0.6];
    }
    b.jump(2.9, 7.2, 12.2, 0, top, 14.5, false);
    b.go(0, top, 29);
    b.go(0, top, L - 1);
    b.advance(L, top);
  },

  /**
   * The Render Queue (Render Farm). The hall's floor is three conveyors,
   * gaps of live trench between them: the first carries you back, the
   * second toward a trench along its edge, the third back again and faster.
   */
  queue(b, o = {}) {
    const w = b.W / 2;
    const L = 44;
    b.floor(0, 4);
    b.floor(38, L);
    const belt = (x0, x1, z0, z1, dir, speed) => {
      const s = b.box([x0, -2, z0], [x1, 0, z1], { role: 'belt', mat: 'metal', color: '#2a3140', belt: dir, noPortal: true });
      s.vel = b.D(...dir).map((v) => v * speed);
      b.world.belts.push(s);
      return s;
    };
    belt(-w, w, 4, 16, [0, 0, -1], 3);
    pit(b, 16, 17.8);
    // The second pushes toward a strip of trench along its left.
    belt(-w + 1.6, w, 17.8, 28, [-1, 0, 0], 2.2);
    pit(b, 17.8, 28, 0, -w, -w + 1.6);
    pit(b, 28, 29.8);
    belt(-w, w, 29.8, 38, [0, 0, -1], 4.2);
    b.sides(0, L);
    b.dress(0, L);
    mark(b, 'queue', 0, L);
    b.go(0, 0, 3.5);
    b.step({ a: 'leap', edge: b.P(0, 0, 15.6), to: standAt(...b.P(0, 0, 19.4)) });
    b.go(1.5, 0, 22, true);
    b.step({ a: 'leap', edge: b.P(1.5, 0, 27.6), to: standAt(...b.P(1, 0, 31.6)) });
    b.go(0, 0, 38.5, true);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * The Pour (The Foundry). A bridge over the melt, and over the bridge
   * three crucibles that tip in turn, each pouring a stream of metal across
   * it for a moment and swinging back.
   */
  pour(b, o = {}) {
    const L = 36;
    const H = b.roof || 11;
    b.floor(0, 5);
    b.floor(31, L);
    pit(b, 5, 31);
    b.box([-1.8, -0.6, 5], [1.8, 0, 31], { role: 'plat', mat: 'metal', color: '#4a4440' });
    b.sides(0, L);
    const pours = [];
    for (let i = 0; i < 3; i++) {
      const z = 11 + i * 7;
      // The crucible, hung from the roof, its lip glowing.
      b.box([-1.4, H - 4, z - 1.2], [1.4, H - 2.2, z + 1.2], { role: 'trim', mat: 'metal', color: '#3a3430', noPortal: true });
      b.box([-1.2, H - 2.25, z - 1], [1.2, H - 2.15, z + 1], { mat: 'lamp', color: '#ff8a1a', glow: 1.4, noPortal: true, passCharges: true });
      for (const x of [-1.1, 1.1]) b.box([x - 0.08, H - 2.2, z - 0.08], [x + 0.08, H, z + 0.08], { role: 'trim', mat: 'metal', color: '#2a2622', noPortal: true, passCharges: true });
      const [min, max] = b.aabb([-1.6, 0, z - 0.8], [1.6, H - 4, z + 0.8]);
      const id = `pour${b.sections.length}_${i}`;
      b.world.hazards.push({ min, max, kind: 'laser', laser: { period: 4 + i * 0.7, on: 1.6, phase: -i * 1.3 }, id, color: '#ff8a1a', stream: true });
      pours.push({ id, z });
    }
    b.dress(0, L);
    mark(b, 'pour', 0, L);
    for (const p of pours) {
      b.go(0, 0, p.z - 2.6);
      b.step({ a: 'gate', hazard: p.id, to: b.P(0, 0.9, p.z + 2.6) });
    }
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * The Interchange (Night Freeway). The road winds up three switchback
   * ramps, each over the one before, to a flyover 9 m up, lamps along its
   * edges and the city far below.
   */
  interchange(b, o = {}) {
    const L = 22;
    const P = { role: 'trim', noPortal: true };
    const lamp = b.def.accent || '#ffd36a';
    b.floor(0, 2, 0, { noRails: true });
    // First ramp up along the left, 0 to 3.
    b.ramp([-6, 0, 2], [-2, 3, 14], 'z', 1, { role: 'ramp' });
    b.box([-6, 1, 14], [6, 3, 18], { role: 'floor' });
    // Second back along the middle, 3 to 6, onto a landing over the way in.
    b.ramp([-2, 3, 3], [2, 6, 14], 'z', -1, { role: 'ramp' });
    b.box([-2, 4, -1], [6, 6, 3], { role: 'floor' });
    // Third up along the right, 6 to 9, and the flyover on from it.
    b.ramp([2, 6, 3], [6, 9, 14], 'z', 1, { role: 'ramp' });
    b.box([2, 7, 14], [6, 9, L], { role: 'floor' });
    // Kerbs on the outer edges, lamps on posts.
    b.box([6, 6, -1], [6.4, 10.2, L], P);
    b.box([-6.4, 3, 18], [6.4, 4.2, 18.4], P);
    for (const [x, y, z] of [[-6.2, 0, 6], [-6.2, 3, 16], [6.2, 6, 1], [6.2, 9, 12], [6.2, 9, 20]]) {
      b.box([x - 0.1, y, z - 0.1], [x + 0.1, y + 3.2, z + 0.1], { role: 'trim', mat: 'metal', color: '#3a4048', noPortal: true, passCharges: true });
      b.box([x - 0.25, y + 3.2, z - 0.25], [x + 0.25, y + 3.4, z + 0.25], { mat: 'lamp', color: lamp, glow: 1.6, noPortal: true, passCharges: true });
    }
    // Piers under the ramps.
    for (const [x, z, h] of [[-4, 10, 1.7], [0, 8, 4.3], [4, 10, 7.6], [4, 19, 7]]) b.box([x - 0.5, -12, z - 0.5], [x + 0.5, h, z + 0.5], { role: 'wall', mat: 'concrete', color: '#5a5a5e' });
    const W = b.W;
    b.W = 12;
    b.dress(0, L);
    b.W = W;
    mark(b, 'interchange', 0, L, { top: 9 });
    b.go(-4, 0, 1.5);
    b.go(-4, 3, 15);
    b.go(0, 3, 15.5);
    b.go(0, 6, 2);
    b.go(4, 6, 1.5);
    b.go(4, 9, 15);
    b.go(4, 9, L - 1);
    b.cur.p = b.P(4, 9, L);
  },

  /**
   * The Billboard (Rain City). The way ends at the back of a giant
   * billboard, the last one in the city still lit; its ledges light and go
   * dark with its sign, and the way on is up them (the last stays lit) to
   * the catwalk and through the gap at its top.
   */
  billboard(b, o = {}) {
    const Z = 16;
    const top = 9.8;
    const L = Z + 10;
    const lit = b.def.accent || '#ff4fd8';
    // A square before it as wide as the board, a parapet each side.
    b.floor(0, Z, 0, { w: 16, noRails: true });
    for (const x of [-8.4, 8]) b.box([x, 0, 0], [x + 0.4, 1.1, Z], { role: 'trim', noPortal: true });
    // The board: its face toward you, lit, and the gap at its top right to go through.
    const face = { mat: 'lamp', color: lit, glow: 0.9, role: 'wall' };
    const g0 = 5.8;
    b.box([-8, 0, Z], [8, top, Z + 0.6], face);
    b.box([-8, top, Z], [g0, 14, Z + 0.6], face);
    b.box([g0, top + 3.2, Z], [8, 14, Z + 0.6], face);
    // What it says: bars of another colour across its face.
    const bar = { mat: 'lamp', color: '#7fe9ff', glow: 1.2, noPortal: true, passCharges: true, ghost: true };
    for (const [x0, x1, y] of [[-6.5, -1, 11.5], [-7, -2.5, 12.6], [0, 5, 11.9], [-7.5, 7.5, 0.3]]) b.box([x0, y, Z - 0.05], [x1, y + 0.5, Z], bar);
    // The ledges, up across its face corner to corner, lit with it in a wave; the last, at the top, stays lit.
    const at = [];
    for (let i = 0; i < 7; i++) at.push([-6.9 + 2.3 * i, 1.4 * (i + 1)]);
    const ledges = at.map(([x, y], i) => b.box([x - 1, y - 0.4, Z - 1.6], [x + 1, y, Z], i < at.length - 1 ? { role: 'blink', blink: { period: 4.4, on: 0, off: 4.4 * 0.62, phase: -i * 1.25 } } : { role: 'plat', mat: 'metal', color: '#3a3440' }));
    // The roof beyond it.
    b.box([-8, top - 2, Z + 0.6], [8, top, L], { role: 'floor' });
    b.dress(0, L);
    mark(b, 'billboard', 0, L, { top });
    b.go(at[0][0], 0, Z - 3);
    let from = [at[0][0], 0, Z - 2.4];
    for (let i = 0; i < at.length; i++) {
      const [x, y] = at[i];
      if (i === at.length - 1) b.jump(from[0], from[1], from[2], x, y, Z - 0.8, false);
      else b.step({ a: 'hop', solid: ledges[i].id, from: standAt(...b.P(from[0], from[1], from[2])), to: standAt(...b.P(x, y, Z - 0.8)) });
      from = [x + 0.8, y, Z - 0.8];
    }
    b.go((g0 + 8) / 2, top, Z - 0.8);
    b.go((g0 + 8) / 2, top, Z + 2);
    b.go(0, top, L - 1);
    b.advance(L, top);
  },

  /**
   * The Train (Underline). A station platform and a track bed of live rail;
   * a two-car train runs between this platform and the next, its roof level
   * with them. Board it as it pulls in, and ride.
   */
  train(b, o = {}) {
    const P0 = 8;
    const P1 = 42;
    const L = P1 + 8;
    const car = 8;
    const gap = 0.4;
    const len = 2 * car + gap;
    b.floor(0, P0);
    b.floor(P1, L);
    pit(b, P0, P1);
    b.sides(0, L);
    const travel = P1 - P0 - len;
    // It stops at each platform a while.
    const move = { to: b.D(0, 0, 1).map((v) => v * travel), period: o.period || 16, phase: 0, hold: 0.3 };
    const body = { mat: 'metal', color: '#c8b890', move };
    let roof = null;
    for (let k = 0; k < 2; k++) {
      const z = P0 + k * (car + gap);
      const r = b.box([-1.6, -3, z], [1.6, 0, z + car], { role: 'plat', ...body });
      if (!roof) roof = r;
      for (const x of [-1.62, 1.6]) b.box([x, -2.2, z + 0.6], [x + 0.02, -1.2, z + car - 0.6], { mat: 'lamp', color: '#fff0d0', glow: 1, noPortal: true, passCharges: true, move });
    }
    b.dress(0, L);
    mark(b, 'train', 0, L, { train: roof.id });
    b.go(0, 0, P0 - 1.5);
    b.step({ a: 'waitFor', solid: roof.id, near: b.P(0, -1.5, P0 + car / 2), tol: 0.35 });
    b.step({ a: 'ride', solid: roof.id, until: b.P(0, -1.5, P0 + car / 2 + travel), tol: 0.4 });
    b.go(0, 0, P1 + 2);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * The Crane (Harbour at Dawn). Between two quays, open water, and a crane
   * on a tower in the middle of it slewing a container round and round at
   * quay height. Step on as it swings past, and off at the far quay.
   */
  crane(b, o = {}) {
    const Q0 = 10;
    const Q1 = 26;
    const L = Q1 + 10;
    const r = 6.5;
    const cz = (Q0 + Q1) / 2;
    b.floor(0, Q0);
    b.floor(Q1, L);
    pit(b, Q0, Q1);
    const tower = b.box([-0.7, -12, cz - 0.7], [0.7, 12, cz + 0.7], { role: 'wall', mat: 'metal', color: '#e0703a' });
    b.box([-1.4, 12, cz - 1.4], [1.4, 13.4, cz + 1.4], { role: 'trim', mat: 'metal', color: '#e0703a', noPortal: true });
    const move = { orbit: { r, axes: [b.D(0, 0, -1), b.D(1, 0, 0)] }, period: o.period || 18, phase: 0 };
    const box = b.box([-1.5, -2.4, Q0], [1.5, 0, Q0 + 3], { role: 'plat', mat: 'container', color: '#3a6a9a', move });
    b.world.tethers.push({ from: b.P(0, 13, cz), solid: box.id });
    b.dress(0, L);
    mark(b, 'crane', 0, L, { box: box.id, tower: tower.id });
    b.go(0, 0, Q0 - 1.2);
    b.step({ a: 'waitFor', solid: box.id, near: b.P(0, -1.2, Q0 + 1.5), tol: 0.35 });
    b.step({ a: 'ride', solid: box.id, until: b.P(0, -1.2, Q1 - 1.5), tol: 0.5 });
    b.go(0, 0, Q1 + 2);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * The Chairlift (Pine Ridge). A valley too wide to cross, and over it a
   * pair of cable cars, one going up as the other comes down, from this
   * station to one 12 m higher on the far side.
   */
  chairlift(b, o = {}) {
    const S0 = 8;
    const S1 = 40;
    const up = 12;
    const L = S1 + 8;
    b.floor(0, S0);
    b.floor(S1, L, up);
    pit(b, S0, S1);
    const run = S1 - S0 - 2.8;
    const cars = [];
    for (const [x, phase] of [[-1.6, 0], [1.6, 0.5]]) {
      const move = { to: b.D(0, 0, 1).map((v, i) => (i === 1 ? up : v * run)), period: o.period || 20, phase, hold: 0.2 };
      const car = b.box([x - 1.2, -0.3, S0 + 0.3], [x + 1.2, 0, S0 + 2.7], { role: 'plat', mat: 'wood', color: '#8a4a2a', move });
      // Its rail, on the side away from the other line.
      const rx = x < 0 ? x - 1.2 : x + 1.05;
      b.box([rx, 0, S0 + 0.3], [rx + 0.15, 1, S0 + 2.7], { role: 'trim', mat: 'wood', color: '#6a3a22', noPortal: true, move });
      b.world.tethers.push({ solid: car.id, up: 3.2 });
      cars.push(car);
      // The cable over its line.
      b.world.tethers.push({ from: b.P(x, 3.2, S0 + 1.5), to: b.P(x, 3.2 + up, S0 + 1.5 + run), w: 0.06 });
    }
    // The pylons that carry the cables, between the two lines, and their arms over them.
    for (const k of [0.33, 0.66]) {
      const z = S0 + 1.5 + run * k;
      const y = 3.2 + up * k;
      b.box([-0.3, -14, z - 0.3], [0.3, y + 0.5, z + 0.3], { role: 'wall', mat: 'metal', color: '#4a4e56' });
      b.box([-2.2, y + 0.2, z - 0.2], [2.2, y + 0.5, z + 0.2], { role: 'trim', mat: 'metal', color: '#4a4e56', noPortal: true });
    }
    b.dress(0, L);
    mark(b, 'chairlift', 0, L, { up, car: cars[0].id });
    b.go(-1.6, 0, S0 - 1.2);
    b.step({ a: 'waitFor', solid: cars[0].id, near: b.P(-1.6, -0.15, S0 + 1.5), tol: 0.35 });
    b.step({ a: 'ride', solid: cars[0].id, until: b.P(-1.6, up - 0.15, S0 + 1.5 + run), tol: 0.4 });
    b.go(-1.6, up, S1 + 2);
    b.go(0, up, L - 1);
    b.advance(L, up);
  },

  /**
   * The Workbench (The Workshop). Seen from the height of a pencil: a
   * stack of books to climb, the desk top, a ruler laid across to the
   * shelf beyond it, and a row of pencils to hop along to the far side.
   */
  workbench(b, o = {}) {
    const w = b.W / 2;
    const D = 5; // the desk top
    const L = 44;
    const H = b.roof ? b.roof + 3 : 0;
    b.floor(0, 4);
    if (b.roof) hallOf(b, -w, w, 0, L, H);
    lintels(b, L, H, 0, D);
    // The books, a stair of them.
    const books = [['#8a2a2a', 4, 8, 1.2], ['#2a4a8a', 8.4, 11, 2.3], ['#2a6a3a', 11.4, 13.6, 3.5]];
    for (const [c, z0, z1, y] of books) {
      b.box([-w, y - 1.1, z0], [w - 1, y, z1], { role: 'plat', mat: 'panel', color: c });
      b.box([-w + 0.1, y - 1, z1 - 0.05], [w - 1.1, y - 0.1, z1], { mat: 'panel', color: '#efe6d0', noPortal: true, passCharges: true });
    }
    b.box([-w, -2, 4], [w, 0.1, 13.6], { role: 'floor' });
    // The desk, and the gap past its edge down to the floor.
    b.box([-w, -2, 13.6], [w, D, 22], { role: 'floor', mat: 'wood', color: '#6b4a2e' });
    pit(b, 22, 32, D);
    // The ruler across to the shelf: a metre wide, its marks along it.
    b.box([-0.6, D - 0.2, 21.5], [0.6, D, 32.5], { role: 'plat', mat: 'wood', color: '#d8c49a' });
    for (let z = 22; z < 32; z += 1) b.box([-0.6, D, z], [-0.1 - (Math.round(z) % 5 === 0 ? 0.3 : 0), D + 0.01, z + 0.05], { mat: 'panel', color: '#2a2218', noPortal: true, passCharges: true });
    b.box([-w, D - 1.2, 32], [w, D, 35], { role: 'floor', mat: 'wood', color: '#5a3a22' });
    // The pencils, lying across a second gap, a hop apart.
    pit(b, 35, 42, D);
    const pencils = [];
    for (let i = 0; i < 3; i++) {
      const z = 36.2 + i * 2;
      pencils.push(z);
      b.box([-w, D - 0.5, z - 0.35], [w - 1.2, D, z + 0.35], { role: 'plat', mat: 'panel', color: '#e8b83a' });
      b.box([w - 1.2, D - 0.45, z - 0.3], [w - 0.4, D - 0.05, z + 0.3], { mat: 'panel', color: '#d88a9a', noPortal: true });
    }
    b.floor(42, L, D);
    // The lamp over it all.
    b.box([w - 2, D + 5.5, 26], [w - 0.5, D + 5.8, 30], { mat: 'lamp', color: '#ffe0b0', glow: 1.4, noPortal: true, passCharges: true });
    b.dress(0, L);
    mark(b, 'workbench', 0, L, { top: D });
    b.go(-1, 0, 3.5);
    b.jump(-1, 0, 3.6, -1, 1.2, 5.5, false);
    b.jump(-1, 1.2, 7.6, -1, 2.3, 9.6, false);
    b.jump(-1, 2.3, 10.6, -1, 3.5, 12.4, false);
    b.jump(-1, 3.5, 13.2, -1, D, 15, false);
    b.go(0, D, 20.5);
    b.go(0, D, 33.5);
    b.jump(-1, D, 34.6, -1, D, pencils[0], false);
    // From one pencil to the next from a standstill: there is no room for a run-up on one.
    let z = pencils[0];
    for (const p of [...pencils.slice(1), 43]) {
      b.step({ a: 'jump', from: standAt(...b.P(-1, D, z)), to: standAt(...b.P(-1, D, p)), run: false, stand: true });
      z = p;
    }
    b.go(0, D, L - 1);
    b.advance(L, D);
  },
};
