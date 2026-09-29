// Ways through that are a choice. A locked room to the side whose fight is
// harder than any on the way, and worth it; a fork, a safe low road through
// a guarded trench beside a quick high one over the drop with a prize on it;
// a vault whose door stays open a few seconds after its switch, too few to
// run there, enough to step through a wormhole you put ready; and a ledge
// past any jump that a black hole's pull carries you to. The level's own
// route takes the safe way and none of the prizes; each risky way is
// written as a detour (build.js) the tests fly. DOM-free.
import { standAt } from './player.js';

function mark(b, type, z0, z1, extra = {}) {
  b.sections.push({ type, from: b.P(0, 0, z0), to: b.P(0, 0, z1), h: b.cur.h, ...extra });
}

const pickSide = (b, o) => o.side || (b.r() < 0.5 ? -1 : 1);

/** A risky way's prize: a shield or a cell as it is, a power-up as a stash that fills it to the top. */
function prize(b, kind, x, y, z) {
  const plain = kind === 'shield' || kind === 'cell';
  b.pickup(kind, x, y, z, plain ? { route: true } : { stash: true, route: true });
}

function sbox(b, side, x0, x1, y0, y1, z0, z1, props) {
  const a = side * x0;
  const c = side * x1;
  return b.box([Math.min(a, c), y0, z0], [Math.max(a, c), y1, z1], props);
}

/** The bottom of an open drop over part of the way: the void, or in an enclosed level a trench with something nasty in it. */
function drop(b, x0, x1, z0, z1, y = 0) {
  const d = b.def.trench;
  if (!d) return;
  b.box([x0, y - d.depth - 2, z0], [x1, y - d.depth, z1], { role: 'floor', noSafe: true });
  const [min, max] = b.aabb([x0, y - d.depth, z0], [x1, y - d.depth + 0.8, z1]);
  b.world.hazards.push({ min, max, kind: d.kind || 'spikes', trench: true });
}

/** Barriers along one edge of an open level's way, from z0 to z1 at x. */
function rail(b, x, dir, z0, z1) {
  const R = b.def.rails;
  if (!R) return;
  const a = x;
  const c = x + dir * R.w;
  b.box([Math.min(a, c), 0, z0], [Math.max(a, c), R.h, z1], { role: R.role || 'trim', noPortal: true });
}

/** An enclosed level's walls and roof for a stretch wider than its way, closed off where it meets the way before and after. */
function hall(b, X, L) {
  if (!b.roof) return;
  const H = b.roof;
  const w = b.W / 2;
  b.box([-X - 1, -2, 0], [-X, H, L], { role: 'wall' });
  b.box([X, -2, 0], [X + 1, H, L], { role: 'wall' });
  b.box([-X - 1, H, 0], [X + 1, H + 1, L], { role: 'roof' });
  for (const z of [0, L]) {
    const z0 = z === 0 ? -0.5 : L;
    b.box([-X, -2, z0], [-w, H, z0 + 0.5], { role: 'wall' });
    b.box([w, -2, z0], [X, H, z0 + 0.5], { role: 'wall' });
  }
  const lamp = b.def.lamp || '#e8f2ff';
  for (let z = 1.5; z + 1.6 < L; z += 5) b.box([-0.35, H - 0.08, z], [0.35, H, z + 1.6], { mat: 'lamp', color: lamp, glow: 0.6, noPortal: true, passCharges: true });
}

export const ROUTES = {
  /**
   * A slingshot. Off to one side, an island a metre past any running jump,
   * and a black hole hung over its far edge: a running jump from the way's
   * edge is pulled on, over the gap, onto it; jump on the island, and the
   * hole takes you. Nothing on the island takes a wormhole end. The way back
   * is a platform that shuttles from the island to over the way, 3 m up:
   * step off it and drop down; from the way, it is out of reach.
   */
  slingshot(b, o = {}) {
    const L = 22;
    const w = b.W / 2;
    const side = pickSide(b, o);
    const gap = o.gap || 9;
    const I0 = w + gap;
    const I1 = I0 + 5;
    const zc = 11;
    b.floor(0, L, 0, { noRails: true });
    // No rail on the island's side: a rail's end is a step up to leap from.
    rail(b, -side * w, -side, 0, L);
    // The island, and nothing on it an end will open on.
    sbox(b, side, I0, I1, -2, 0, zc - 3, zc + 3, { role: 'plat', noPortal: true });
    drop(b, Math.min(side * w, side * (I1 + 4)), Math.max(side * w, side * (I1 + 4)), zc - 6, zc + 6);
    // Its reach runs back over the way, so the pull is there all through the jump.
    const hole = b.P(side * (I1 + (o.beyond ?? 0)), o.lift ?? 4, zc);
    b.world.wells.push({ p: hole, pull: o.pull || 2000, reach: o.reach || 22, horizon: 0.8 });
    // The way back: from the island's near edge to over the way's edge, 3 m up.
    const R = b.R;
    const plat = sbox(b, side, I0 - 2.4, I0, -0.4, 0, zc - 1.2, zc + 1.2, { role: 'plat', noPortal: true, move: { to: [R[0] * -side * gap, 3, R[2] * -side * gap], period: 7, phase: 0 } });
    prize(b, o.prize || 'triple', side * (I0 + 2.5), 0, zc);
    b.dress(0, L);
    mark(b, 'slingshot', 0, L, { side, hole, plat: plat.id, island: [I0, I1], zc });
    b.go(0, 0, L - 1);
    b.detour('slingshot', 0, 0, zc, () => {
      b.jump(side * (w - 0.3), 0, zc, side * (I0 + 2), 0, zc, true);
      b.step({ a: 'take', near: b.P(side * (I0 + 2.5), 0.9, zc) });
      const island = b.P(side * (I0 - 1.2), 0, zc);
      b.step({ a: 'waitFor', solid: plat.id, near: [island[0], island[1] - 0.2, island[2]], tol: 0.3 });
      b.go(side * (I0 - 1.2), 0, zc);
      const over = b.P(side * (w - 1.2), 3, zc);
      b.step({ a: 'ride', solid: plat.id, until: [over[0], over[1] - 0.2, over[2]], tol: 0.4 });
      b.step({ a: 'drop', to: standAt(...b.P(side * (w - 3), 0, zc)) });
      b.go(0, 0, L - 1);
    });
    b.detours[b.detours.length - 1].secret = false;
    b.advance(L);
  },

  /**
   * A locked room to the side, a red lamp over its door. Step in and it
   * shuts: three waves, more machines than any fight on the way, and when
   * the last falls the door opens and the prize drops (a shield cell, or a
   * stash). The way goes on past it; nobody has to go in.
   */
  gauntlet(b, o = {}) {
    const L = 16;
    const w = b.W / 2;
    const side = pickSide(b, o);
    const H = b.roof || 6;
    const X0 = w + 0.5;
    const X1 = w + 12.5;
    b.floor(0, L, 0, { noRails: true });
    rail(b, -side * w, -side, 0, L);
    b.sides(0, L, 0, null, side > 0 ? { noRight: true } : { noLeft: true });
    const id = b.doorId++;
    sbox(b, side, w, w + 0.5, -2, H, 0, 6, { role: 'wall' });
    sbox(b, side, w, w + 0.5, -2, H, 9, L, { role: 'wall' });
    sbox(b, side, w, w + 0.5, 3.4, H, 6, 9, { role: 'wall' });
    sbox(b, side, w + 0.05, w + 0.45, 0, 3.4, 6.05, 8.95, { role: 'door', door: { id, lift: 3.3, speed: 6, open: true, at: 1 } });
    // The warning: a red lamp over the door.
    sbox(b, side, w - 0.12, w, 3.7, 4, 6, 9, { mat: 'lamp', color: '#ff3050', glow: 1.2, noPortal: true, passCharges: true });
    // The room.
    sbox(b, side, X0, X1, -2, 0, 1.5, 13.5, { role: 'floor' });
    sbox(b, side, X1, X1 + 0.5, -2, H, 1, 14, { role: 'wall' });
    sbox(b, side, X0, X1, -2, H, 1, 1.5, { role: 'wall' });
    sbox(b, side, X0, X1, -2, H, 13.5, 14, { role: 'wall' });
    sbox(b, side, X0, X1 + 0.5, H, H + 0.5, 1, 14, { role: 'roof' });
    sbox(b, side, X0 + 3, X0 + 5, 0, 1.6, 3.5, 5.5, { role: 'plat' });
    sbox(b, side, X1 - 5, X1 - 3, 0, 1.6, 9.5, 11.5, { role: 'plat' });
    sbox(b, side, X0 + 6, X0 + 7.5, 0, 2.4, 10, 12.5, { role: 'plat' });
    const ia = side * (X0 + 0.6);
    const ib = side * (X1 - 0.6);
    const [min, max] = b.aabb([Math.min(ia, ib), -1, 2], [Math.max(ia, ib), 5, 13]);
    const waves = [];
    for (let i = 0; i < 3; i++) {
      const wave = [];
      const n = 4 + i;
      for (let j = 0; j < n; j++) {
        // Machines a plain charge touches, as in every locked room.
        const f = b.foe(j % 2 ? ['flier', 'zigzag', 'gunner', 'circler'] : ['walker', 'chaser', 'hopper', 'lancer', 'trundle'], { solid: true }) || b.foe(['walker'], { solid: true });
        if (!f) continue;
        const a = (j / n) * Math.PI * 2;
        const air = ['flier', 'zigzag', 'gunner', 'circler', 'diver'].includes(f.move);
        wave.push({ ...f, p: b.P(side * (X0 + 6 + Math.cos(a) * 4), air ? 3.5 : 0.8, 7.5 + Math.sin(a) * 4), yaw: b.yaw });
      }
      waves.push(wave);
    }
    const gift = o.prize || 'cell';
    const dropAt = b.P(side * (X0 + 6), 1, 7.5);
    b.ambushes.push({ min, max, doors: [id], waves, drop: gift, stash: gift !== 'cell' && gift !== 'shield', dropAt, optional: true });
    b.dress(0, L);
    mark(b, 'gauntlet', 0, L, { side, door: id });
    b.go(0, 0, L - 1);
    b.detour('gauntlet', 0, 0, 3, () => {
      b.go(side * (w - 1), 0, 7.5);
      b.go(side * (X0 + 3), 0, 7.5);
      b.step({ a: 'clear' });
      b.step({ a: 'take', near: dropAt });
      b.go(side * (w - 1), 0, 7.5);
      b.go(0, 0, L - 1);
    });
    const d = b.detours[b.detours.length - 1];
    d.secret = false;
    d.fight = true;
    b.advance(L);
  },

  /**
   * A fork. The way splits in two for a stretch and meets again: a safe low
   * road down a ramp into a trench (machines keep it) and back up, and a
   * high road straight over the drop, quicker, with a prize halfway along it
   * and nothing to catch you. The high road is narrow beams that jog, floors
   * that blink in a wave, or a beam through laser gates (`risk`).
   */
  fork(b, o = {}) {
    const side = pickSide(b, o);
    const risk = o.risk || 'beam';
    const X = 6.5;
    const xs = -side * 4.5;
    const xr = side * 4.5;
    const E0 = 5;
    const size = 3;
    const gap = 1.2;
    const n = 5;
    const E1 = risk === 'blink' ? E0 + 1.2 + n * (size + gap) : 29;
    const L = E1 + 5;
    b.floor(0, E0, 0, { w: 2 * X });
    b.floor(E1, L, 0, { w: 2 * X });
    for (const sd of [-1, 1]) {
      rail(b, sd * X, sd, 0, E0);
      rail(b, sd * X, sd, E1, L);
    }
    hall(b, X, L);
    // The low road.
    b.ramp([xs - 2, -2.5, E0], [xs + 2, 0, E0 + 6], 'z', -1, { role: 'ramp' });
    b.box([xs - 2, -4.5, E0 + 6], [xs + 2, -2.5, E1 - 6], { role: 'floor' });
    b.ramp([xs - 2, -2.5, E1 - 6], [xs + 2, 0, E1], 'z', 1, { role: 'ramp' });
    b.box([xs - 2.5, -4.5, E0], [xs - 2, 0, E1], { role: 'wall' });
    b.box([xs + 2, -4.5, E0], [xs + 2.5, 0, E1], { role: 'wall' });
    b.box([xs - 2, -4.6, E0], [xs + 2, -4.5, E1], { role: 'floor' });
    rail(b, -side * X, -side, E0, E1);
    b.guard('ground', xs, -2.5, (E0 + E1) / 2 - 3);
    b.guard('ground', xs, -2.5, (E0 + E1) / 2 + 3);
    // Under the high road, nothing but the drop.
    const va = side > 0 ? xs + 2.5 : -X;
    const vb = side > 0 ? X : xs - 2.5;
    drop(b, va, vb, E0, E1);
    const kind = o.prize || 'shield';
    const route = [];
    if (risk === 'beam') {
      // Narrow beams, a metre wide, that jog in toward the middle and back.
      const xj = xr - side * 2.5;
      const beam = (xa, xb, z0, z1) => b.box([Math.min(xa, xb) - 0.5, -0.6, z0], [Math.max(xa, xb) + 0.5, 0, z1], { role: 'plat' });
      beam(xr, xr, E0, 12);
      beam(xr, xj, 11, 12);
      beam(xj, xj, 11, 20);
      beam(xj, xr, 19, 20);
      beam(xr, xr, 19, E1);
      prize(b, kind, xj, 0, 15.5);
      route.push(() => {
        b.go(xr, 0, E0 - 0.5);
        b.go(xr, 0, 11.5);
        b.go(xj, 0, 11.5);
        b.go(xj, 0, 19.5);
        b.go(xr, 0, 19.5);
        b.step({ a: 'take', near: b.P(xj, 0.9, 15.5) });
        b.go(xr, 0, E1 + 1);
      });
    } else if (risk === 'blink') {
      const period = 4.4;
      const z0 = E0 + 1.2;
      const plats = [];
      for (let i = 0; i < n; i++) {
        const z = z0 + i * (size + gap);
        const p = b.box([xr - size / 2, -0.6, z], [xr + size / 2, 0, z + size], { role: 'blink', blink: { period, on: 0, off: period * 0.62, phase: -i * 1.25 } });
        plats.push({ id: p.id, z });
      }
      prize(b, kind, xr, 0.6, plats[2].z + size / 2);
      route.push(() => {
        let pz = E0 - 0.5;
        for (const p of plats) {
          b.step({ a: 'hop', solid: p.id, from: standAt(...b.P(xr, 0, pz)), to: standAt(...b.P(xr, 0, p.z + size / 2)) });
          pz = p.z + size - 0.5;
        }
        b.jump(xr, 0, pz, xr, 0, E1 + 1.5, false);
      });
    } else {
      // A beam through laser gates.
      b.box([xr - 0.7, -0.6, E0], [xr + 0.7, 0, E1], { role: 'plat' });
      const gates = [];
      for (let i = 0; i < 2; i++) {
        const z = 11 + i * 9;
        const [min, max] = b.aabb([xr - 0.9, 0, z - 0.15], [xr + 0.9, 3.2, z + 0.15]);
        const hz = { min, max, kind: 'laser', laser: { period: 2.6, on: 1.2, phase: -i * 0.9 }, id: `fork${b.sections.length}_${i}` };
        b.world.hazards.push(hz);
        gates.push({ id: hz.id, z });
        for (const sd of [-1, 1]) b.box([xr + sd * 0.9 - 0.15, 0, z - 0.3], [xr + sd * 0.9 + 0.15, 3.4, z + 0.3], { role: 'trim' });
      }
      prize(b, kind, xr, 0, 15.5);
      route.push(() => {
        b.go(xr, 0, E0 - 0.5);
        for (const g of gates) {
          b.go(xr, 0, g.z - 2.2);
          b.step({ a: 'gate', hazard: g.id, to: standAt(...b.P(xr, 0, g.z + 2.2)) });
          if (g === gates[0]) b.step({ a: 'take', near: b.P(xr, 0.9, 15.5) });
        }
        b.go(xr, 0, E1 + 1);
      });
    }
    b.dress(0, L);
    mark(b, 'fork', 0, L, { side, risk });
    // The level's own way takes the low road.
    b.go(xs, 0, E0 - 1);
    b.go(xs, -2.5, E0 + 7);
    b.go(xs, -2.5, E1 - 7);
    b.go(xs, 0, E1 + 1);
    b.go(0, 0, L - 1);
    b.detour('fork', 0, 0, 2, () => {
      route[0]();
      b.go(0, 0, L - 1);
    });
    b.detours[b.detours.length - 1].secret = false;
    b.advance(L);
  },

  /**
   * A vault at the far end of a long hall, its door opened by a switch at the
   * near end, and shut again 2.6 s later. The switch sits in a booth, a stub
   * of wall past it hiding it from the rest of the hall, so it is shot from
   * the near end: nobody runs 34 m in that. Put a pair of wormhole ends
   * ready, one on the face of the buttress just past the door and one a few
   * steps on, shoot the switch, and step through.
   */
  rush(b, o = {}) {
    const L = 46;
    const w = b.W / 2;
    const side = pickSide(b, o);
    const H = b.roof || 5;
    const zd0 = 39.5;
    const zd1 = 42;
    b.floor(0, L, 0, { noRails: true });
    if (b.roof) b.sides(0, L, 0, null, side > 0 ? { noRight: true } : { noLeft: true });
    else sbox(b, -side, w, w + 0.5, -2, H, 0, L, { role: 'wall' });
    sbox(b, side, w, w + 0.5, -2, H, 0, zd0, { role: 'wall' });
    sbox(b, side, w, w + 0.5, -2, H, zd1, L, { role: 'wall' });
    sbox(b, side, w, w + 0.5, 3.4, H, zd0, zd1, { role: 'wall' });
    // A buttress just past the door, its face toward the hall's near end: where an end waits.
    sbox(b, side, w - 1.8, w, 0, 3.2, zd1 + 0.5, zd1 + 2.5, { role: 'wall' });
    const id = b.doorId++;
    sbox(b, side, w + 0.05, w + 0.45, 0, 3.4, zd0 + 0.05, zd1 - 0.05, { role: 'door', door: { id, lift: 3.3, speed: 9, open: false, at: 0 } });
    // The vault.
    sbox(b, side, w + 0.5, w + 5.5, -2, 0, zd0 - 1, zd1 + 1, { role: 'floor' });
    sbox(b, side, w + 5.5, w + 6, -2, 3.8, zd0 - 1.5, zd1 + 1.5, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 5.5, -2, 3.8, zd0 - 1.5, zd0 - 1, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 5.5, -2, 3.8, zd1 + 1, zd1 + 1.5, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 6, 3.8, 4.3, zd0 - 1.5, zd1 + 1.5, { role: 'roof' });
    // The switch, on the wall at the near end, in its booth.
    sbox(b, side, w - 2.6, w, 0, H, 2.8, 3.3, { role: 'wall' });
    const sw = { id: b.doorId++, p: null, doors: [id], timer: o.timer || 2.6, on: false };
    const s = sbox(b, side, w - 0.2, w, 1.6, 2.4, 1.2, 2, { role: 'switch', switchRef: sw, dynamic: true, noPortal: true });
    sw.p = [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
    sw.solid = s;
    b.world.switches.push(sw);
    // And one on the vault's back wall, to let you out.
    const zm = (zd0 + zd1) / 2;
    const out = { id: b.doorId++, p: null, doors: [id], timer: sw.timer, on: false };
    const so = sbox(b, side, w + 5.3, w + 5.5, 1.6, 2.4, zm - 0.4, zm + 0.4, { role: 'switch', switchRef: out, dynamic: true, noPortal: true });
    out.p = [(so.min[0] + so.max[0]) / 2, (so.min[1] + so.max[1]) / 2, (so.min[2] + so.max[2]) / 2];
    out.solid = so;
    b.world.switches.push(out);
    const vx = side * (w + 3);
    prize(b, o.prize || 'cell', vx, 0, zm);
    b.dress(0, L);
    mark(b, 'rush', 0, L, { side, door: id, sw: sw.id, out: out.id, doorAt: [zd0, zd1] });
    b.go(0, 0, L - 1);
    const at = b.P(side * (w - 0.9), 1.3, zd1 + 0.5);
    const near = b.P(0, 0, 5);
    b.detour('rush', 0, 0, 1, () => {
      b.step({ a: 'portal', from: standAt(...b.P(0, 0, 1.6)), aims: [{ which: 0, at }, { which: 1, at: near }] });
      b.step({ a: 'shoot', sw: sw.id, from: standAt(...b.P(0, 0, 1.6)), at: sw.p });
      b.step({ a: 'enter', at: near });
      b.go(side * (w - 1), 0, zm);
      b.go(vx, 0, zm);
      b.step({ a: 'take', near: b.P(vx, 0.9, zm) });
      b.step({ a: 'shoot', sw: out.id, from: standAt(...b.P(vx, 0, zm)), at: out.p });
      b.go(side * (w - 1), 0, zm);
      // Round the buttress, back to the way.
      b.go(-side, 0, zm);
      b.go(0, 0, L - 1);
    });
    b.detours[b.detours.length - 1].secret = false;
    b.advance(L);
  },
};
