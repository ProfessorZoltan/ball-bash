// Wormhole puzzles of more than one step, on the way: each needs two ends
// put in the right places in the right order, and something else besides (a
// fall, a platform, a black hole, a switch that uncovers the next, a beam).
// Each is built so the obvious way fails, and the tests try it
// (puzzles.test.js); each writes its answer as the autopilot's steps and
// records itself in b.links. DOM-free.
import { standAt } from './player.js';

function mark(b, type, z0, z1, extra = {}) {
  b.sections.push({ type, from: b.P(0, 0, z0), to: b.P(0, 0, z1), h: b.cur.h, ...extra });
}

/** A pit's bottom: the void, or in an enclosed level a trench with something nasty in it. */
function pit(b, z0, z1, y = 0) {
  const d = b.def.trench;
  if (!d) return;
  b.box([-b.W / 2, y - d.depth - 2, z0], [b.W / 2, y - d.depth, z1], { role: 'floor', noSafe: true });
  const [min, max] = b.aabb([-b.W / 2, y - d.depth, z0], [b.W / 2, y - d.depth + 0.8, z1]);
  b.world.hazards.push({ min, max, kind: d.kind || 'spikes', trench: true });
}

/**
 * Walls either side, and in an enclosed level a roof H up with a lintel at
 * each end down to the halls either side: a stretch taller than the rest.
 */
function tall(b, L, H, y0 = 0, y1 = 0) {
  if (!b.roof) return;
  const w = b.W / 2;
  const lo = Math.min(y0, y1) - 8;
  b.box([-w - 1, lo, 0], [-w, H, L], { role: 'wall' });
  b.box([w, lo, 0], [w + 1, H, L], { role: 'wall' });
  b.box([-w - 1, H, 0], [w + 1, H + 1, L], { role: 'roof' });
  if (y0 + b.roof < H) b.box([-w - 1, y0 + b.roof, -1], [w + 1, H, 0], { role: 'wall' });
  if (y1 + b.roof < H) b.box([-w - 1, y1 + b.roof, L], [w + 1, H, L + 1], { role: 'wall' });
  const lamp = b.def.lamp || '#e8f2ff';
  for (let z = 1.5; z + 1.6 < L; z += 5) b.box([-0.35, H - 0.08, z], [0.35, H, z + 1.6], { mat: 'lamp', color: lamp, glow: 0.6, noPortal: true, passCharges: true });
}

/** A gap no end opens across from its near side: the shimmer at its lip (wormholes.js, warded). */
function ward(b, z, g) {
  const lip = b.P(0, 0, z);
  b.world.wards.push({ c: lip, n: b.D(0, 0, 1), r: b.D(1, 0, 0), hw: b.W / 2 + 1.5, lo: lip[1] - 40, hi: lip[1] + 60, gap: g, look: b.def.accent || '#c9a2ff' });
}

export const PUZZLES = {
  /**
   * A fling. The way ends at a lip over a gap no jump crosses, and no end
   * opens across it. Back from the lip stands a tower, a lift up its back
   * and a board out from its top; the upper part of its face looks out over
   * the gap. Go to the lip and turn back: one end on the face, one on the
   * floor under the board. Ride up, out along the board, and step off. Fourteen metres of fall go in at the
   * floor and come out of the face, flat and fast, across the gap. Walked
   * into, the same pair drops you at the lip.
   */
  fling(b, o = {}) {
    const w = b.W / 2;
    const HT = o.h || 14; // the tower's top
    const T0 = 3;
    const T1 = 9; // the tower's face, looking along the way
    const A = o.lip || 15; // the lip
    const g = o.gap || 13;
    const rise = o.rise ?? -2;
    const L = A + g + 12;
    b.floor(0, A);
    b.floor(A + g, L, rise);
    pit(b, A, A + g, Math.min(0, rise));
    tall(b, L, HT + 5, 0, rise);
    // The tower, on the left; its lower face (the plinth) takes no end, so an end on it is well up.
    const tx0 = -w;
    const tx1 = -w + 3;
    const tx = (tx0 + tx1) / 2;
    b.box([tx0, -2, T0], [tx1, HT, T1 - 0.1], { role: 'wall' });
    b.box([tx0, 0, T1 - 0.1], [tx1, 5, T1], { role: 'trim', noPortal: true });
    const face = b.box([tx0, 5, T1 - 0.1], [tx1, HT - 0.4, T1], { role: 'wall' });
    b.box([tx0, HT - 0.4, T1 - 0.1], [tx1, HT, T1], { role: 'trim', noPortal: true });
    // A board out from the top, to step off: from its end the floor below is in plain sight.
    b.box([tx - 0.6, HT - 0.3, T1], [tx + 0.6, HT, T1 + 2.5], { role: 'plat', noPortal: true });
    // The lift, against the tower's back, out of the way's own path.
    b.box([tx0, -2, T0 - 3.6], [tx1, -0.7, T0], { role: 'floor' });
    const lift = b.box([tx0 + 0.1, -0.6, T0 - 3.4], [tx1 - 0.1, 0, T0 - 0.2], { role: 'plat', move: { to: [0, HT, 0], period: o.period || 9, phase: 0 } });
    ward(b, A, g);
    const at = b.P((tx0 + tx1) / 2, 8, T1);
    const floorAt = b.P(tx, 0, T1 + 3.3);
    b.dress(0, L);
    mark(b, 'fling', 0, L, { lip: A, gap: g, rise, top: HT, face: face.id, tower: [tx0, tx1, T0, T1] });
    b.links.push({ kind: 'fling', face: at, floor: floorAt, lift: lift.id });
    // To the lip, and back at the tower: one end on its face, one on the floor under the board.
    b.go(0, 0, A - 1.5);
    b.step({ a: 'portal', from: standAt(...b.P(0, 0, A - 1.5)), aims: [{ which: 0, at }, { which: 1, at: floorAt }] });
    // Up the lift, onto the top, out along the board, and off.
    b.go(tx + 3, 0, T0 - 1.8);
    b.step({ a: 'waitFor', solid: lift.id, near: b.P(tx, -0.3, T0 - 1.8), tol: 0.35 });
    b.step({ a: 'ride', solid: lift.id, until: b.P(tx, HT - 0.3, T0 - 1.8), tol: 0.3 });
    b.go(tx, HT, T0 + 2);
    b.go(tx, HT, T1 + 1.6);
    b.step({ a: 'fling', into: floorAt, to: standAt(...b.P(0, rise, A + g + 4)) });
    b.go(0, rise, L - 1);
    b.advance(L, rise);
  },

  /**
   * A hoist nobody can board. Across a shaft, a ledge 6 m up, its cliff and
   * everything past it taking no end; in the shaft, 12 m out, a platform that
   * rises from deep in it to the ledge and sinks again, never near enough to
   * jump to. An end on the platform goes with it: one on its top while it is
   * low enough to see, one at your feet, and step in. You come up out of the
   * platform wherever it is, and ride it up to the ledge.
   */
  hoist(b, o = {}) {
    const w = b.W / 2;
    const A = 10;
    const g = o.gap || 16.5;
    const HL = o.h || 6;
    // Deep in the shaft, but clear of a trench's bottom; even there, past a running jump down onto it.
    const low = b.def.trench ? -b.def.trench.depth + 1.5 : -7;
    const L = A + g + 12;
    b.floor(0, A);
    pit(b, A, A + g, 0);
    tall(b, L, HL + b.roof, 0, HL);
    // The ledge and its cliff, down into the shaft: nothing there takes an end.
    b.box([-w, low - 3, A + g], [w, HL, A + g + 1], { role: 'wall', noPortal: true });
    b.floor(A + g + 1, L, HL);
    if (b.roof) {
      // Over the shaft the walls take no end either: nothing to come out of beside the platform.
      b.box([-w - 0.05, low - 3, A], [-w, HL + b.roof, A + g], { role: 'trim', noPortal: true });
      b.box([w, low - 3, A], [w + 0.05, HL + b.roof, A + g], { role: 'trim', noPortal: true });
    }
    ward(b, A + g, g);
    const P = 3.6;
    const pz0 = A + g - 0.3 - P;
    const hoist = b.box([-P / 2, low - 0.6, pz0], [P / 2, low, pz0 + P], { role: 'plat', move: { to: [0, HL - low, 0], period: o.period || 10, phase: 0 } });
    b.dress(0, L);
    mark(b, 'hoist', 0, L, { gap: g, h: HL, lip: A, hoist: hoist.id });
    const feet = b.P(0, 0, A - 3.4);
    b.links.push({ kind: 'hoist', hoist: hoist.id, feet });
    // Its top's left half for the end, its right half to stand on.
    const endOff = b.D(-1, 0, 0).map((v) => v * 0.85);
    const standOff = b.D(1, 0, 0).map((v) => v * 0.95);
    b.go(0, 0, A - 1.6);
    b.step({ a: 'portal', from: standAt(...b.P(0, 0, A - 1.6)), aims: [{ which: 1, at: feet }, { which: 0, solid: hoist.id, off: endOff, below: b.P(0, 0, 0)[1] }] });
    b.step({ a: 'enter', at: feet });
    b.step({ a: 'onto', solid: hoist.id, off: standOff });
    b.step({ a: 'ride', solid: hoist.id, off: standOff, until: b.P(0, HL - 0.3, pz0 + P / 2), tol: 0.4 });
    b.go(0.95, HL, A + g + 2);
    b.go(0, HL, L - 1);
    b.advance(L, HL);
  },

  /**
   * Through, then round. A chamber beside the way behind armoured glass: a
   * pit in its floor with the door's switch at the bottom, and a black hole
   * over the pit. Nothing in there takes an end but the near half of its back wall,
   * and its other walls and its roof soak a charge up rather than turn it, so
   * nothing banks in. One end on the back wall, one on the wall across the
   * way; fire into yours at a slant and the charge comes out of the back
   * wall across the pit, and the hole brings it round and down onto the switch.
   */
  bend(b, o = {}) {
    const w = b.W / 2;
    const L = 30;
    const dz = 24;
    const H = b.roof || 9;
    const X0 = w;
    const X1 = w + 7.5;
    const Z0 = 3;
    const Z1 = 19;
    const CH = 7;
    b.floor(0, L, 0, { noRails: true });
    const soak = { role: 'wall', noPortal: true, stopsCharges: true, mat: 'panel', color: '#23262e' };
    // The wall across the way, for your end; the way's right side walled past the chamber.
    b.box([-w - 1, -2, 0], [-w, H, L], { role: 'wall' });
    b.box([w, -2, 0], [w + 1, H, Z0], { role: 'wall' });
    b.box([w, -2, Z1], [w + 1, H, L], { role: 'wall' });
    if (b.roof) {
      b.box([-w - 1, H, 0], [X1 + 1, H + 1, L], { role: 'roof' });
      b.box([X0, CH, Z0], [X1 + 1, H, Z0 + 0.5], { role: 'wall' });
      b.box([X0, CH, Z1 - 0.5], [X1 + 1, H, Z1], { role: 'wall' });
      b.box([X0, CH + 0.5, Z0], [X0 + 0.5, H, Z1], { role: 'wall' });
    }
    // The chamber: glass to the way, soaking walls, floor and roof, and a back wall half of which takes an end.
    const px0 = X0 + 1.5;
    const px1 = X0 + 6;
    const pz0 = 11;
    const pz1 = 17;
    const PD = o.depth || 3;
    b.box([X0, -2, Z0], [X1, 0, pz0], { ...soak, role: 'floor' });
    b.box([X0, -2, pz1], [X1, 0, Z1], { ...soak, role: 'floor' });
    b.box([X0, -2, pz0], [px0, 0, pz1], { ...soak, role: 'floor' });
    b.box([px1, -2, pz0], [X1, 0, pz1], { ...soak, role: 'floor' });
    b.box([X0, 0, Z0], [X0 + 0.2, CH, Z1], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    b.box([X0, CH, Z0], [X1 + 1, CH + 0.5, Z1], { ...soak, role: 'roof' });
    b.box([X0, 0, Z0 - 0.5], [X1 + 1, CH, Z0], soak);
    b.box([X0, 0, Z1], [X1 + 1, CH, Z1 + 0.5], soak);
    const zb = 11;
    b.box([X1, -2, Z0], [X1 + 1, CH, zb], { role: 'wall' });
    b.box([X1, -2, zb], [X1 + 1, CH, Z1], soak);
    // The pit in its floor, the switch at the bottom, and the hole down in it: what passes low over the pit is pulled in.
    b.box([px0, -PD - 1, pz0], [px1, -PD, pz1], { ...soak, role: 'floor' });
    const id = b.doorId++;
    const sw = { id, p: null, doors: [id], timer: 0, on: false };
    const swS = b.box([px0 + 0.3, -PD, pz0 + 0.3], [px1 - 0.3, -PD + 0.3, pz1 - 0.3], { role: 'switch', switchRef: sw, dynamic: true, noPortal: true });
    sw.p = [(swS.min[0] + swS.max[0]) / 2, swS.max[1], (swS.min[2] + swS.max[2]) / 2];
    sw.solid = swS;
    b.world.switches.push(sw);
    const hole = b.P((px0 + px1) / 2, -1.5, (pz0 + pz1) / 2);
    b.world.wells.push({ p: hole, pull: o.pull || 1100, reach: 4, horizon: 0.5 });
    // The door.
    b.box([-w - 1, 0, dz], [-2, H, dz + 1], { role: 'wall' });
    b.box([2, 0, dz], [w + 1, H, dz + 1], { role: 'wall' });
    b.box([-2, 3.4, dz], [2, H, dz + 1], { role: 'wall' });
    b.box([-2, 0, dz + 0.1], [2, 3.4, dz + 0.9], { role: 'door', door: { id, lift: 3.3, speed: 5, open: false, at: 0 } });
    const back = b.P(X1, 1.8, 8.5);
    const across = b.P(-w, 1.5, 11);
    const stand = b.P(0, 0, 6.5);
    mark(b, 'bend', 0, L, { door: id });
    b.links.push({ kind: 'bend', sw: sw.id, back, across, hole });
    b.go(0, 0, 6.5);
    b.step({ a: 'portal', from: standAt(...stand), aims: [{ which: 0, at: back }, { which: 1, at: across }] });
    b.step({ a: 'shoot', from: standAt(...b.P(-2, 0, 8)), search: true, near: across, sw: sw.id });
    b.go(0, 0, dz + 3);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * A relay: each switch opens the way to the next. A gap no jump crosses,
   * and a bridge hung high over it. Beside the way, a sealed room; high on the wall
   * across, an amber switch that lifts a shutter in the room's front for a
   * few seconds. Through the opening you see the room's back wall, and
   * nothing else: its switch is on the inside of its front wall, under the
   * sill, and everything in there soaks a charge up. Shoot the amber switch;
   * while the shutter is up, one end on the back wall; one on the wall across
   * the way; fire into yours and the charge comes out at the room's switch,
   * and the bridge comes down.
   */
  relay(b, o = {}) {
    const w = b.W / 2;
    const G0 = 22;
    const G1 = G0 + (o.gap || 10);
    const L = G1 + 8;
    const H = b.roof || 9;
    b.floor(0, G0, 0, { noRails: true });
    b.floor(G1, L, 0, { noRails: true });
    pit(b, G0, G1, 0);
    const soak = { role: 'wall', noPortal: true, stopsCharges: true, mat: 'panel', color: '#23262e' };
    // The wall across the way, for your end and the amber switch.
    b.box([-w - 1, -2, 0], [-w, H, L], { role: 'wall' });
    if (b.roof) b.box([-w - 1, H, 0], [w + 7.5, H + 1, L], { role: 'roof' });
    // The room: its front along the way's right edge, 0.6 thick, an opening in it at 2 to 4 m under a shutter.
    const R0 = 6;
    const R1 = 16;
    const X0 = w;
    const X1 = w + 6;
    const RH = 5;
    const oz0 = 9;
    const oz1 = 13;
    b.box([w, -2, 0], [w + 0.6, H, R0], { role: 'wall' });
    b.box([w, -2, R1], [w + 0.6, H, L], { role: 'wall' });
    b.box([X0, -2, R0], [X0 + 0.6, 2, R1], { role: 'wall', noPortal: true });
    b.box([X0, 4, R0], [X0 + 0.6, H, R1], { role: 'wall', noPortal: true });
    b.box([X0, 2, R0], [X0 + 0.6, 4, oz0], { role: 'wall', noPortal: true });
    b.box([X0, 2, oz1], [X0 + 0.6, 4, R1], { role: 'wall', noPortal: true });
    const shut = b.doorId++;
    b.box([X0 + 0.1, 2, oz0 + 0.05], [X0 + 0.5, 4, oz1 - 0.05], { role: 'door', door: { id: shut, lift: 2.1, speed: 6, open: false, at: 0 } });
    // Inside: soaking floor, roof, ends and the front's inner face; the back wall takes an end but no charge turns off it.
    b.box([X0 + 0.6, -2, R0], [X1, 0, R1], { ...soak, role: 'floor' });
    b.box([X0 + 0.6, RH, R0], [X1 + 1, RH + 0.5, R1], { ...soak, role: 'roof' });
    b.box([X0 + 0.6, 0, R0 - 0.5], [X1 + 1, RH, R0], soak);
    b.box([X0 + 0.6, 0, R1], [X1 + 1, RH, R1 + 0.5], soak);
    b.box([X0 + 0.6, 0, R0], [X0 + 0.65, 1.8, R1], soak);
    b.box([X0 + 0.6, 1.8, R0], [X0 + 0.9, 4, oz0], soak);
    b.box([X0 + 0.6, 1.8, oz1], [X0 + 0.9, 4, R1], soak);
    b.box([X1, -2, R0], [X1 + 1, RH, R1], { role: 'wall', stopsCharges: true });
    // Its switch, low on the inside of the front, under the opening.
    const bridge = b.doorId++;
    const sw2 = { id: b.doorId++, p: null, doors: [bridge], timer: 0, on: false };
    const s2 = b.box([X0 + 0.65, 0.6, 9.9], [X0 + 0.85, 1.5, 12.1], { role: 'switch', switchRef: sw2, dynamic: true, noPortal: true });
    sw2.p = [(s2.min[0] + s2.max[0]) / 2, (s2.min[1] + s2.max[1]) / 2, (s2.min[2] + s2.max[2]) / 2];
    sw2.solid = s2;
    b.world.switches.push(sw2);
    // The amber switch, high on the wall across, and the shutter up for a few seconds.
    const sw1 = { id: b.doorId++, p: null, doors: [shut], timer: o.timer || 9, on: false };
    const s1 = b.box([-w, 4.6, 16.6], [-w + 0.2, 5.4, 17.4], { role: 'switch', switchRef: sw1, dynamic: true, noPortal: true });
    sw1.p = [(s1.min[0] + s1.max[0]) / 2, (s1.min[1] + s1.max[1]) / 2, (s1.min[2] + s1.max[2]) / 2];
    sw1.solid = s1;
    b.world.switches.push(sw1);
    // The bridge, hung high over the gap until the room's switch lets it down: nothing to land on below.
    b.box([-1.6, 6.2, G0], [1.6, 6.5, G1], { role: 'door', mat: 'metal', door: { id: bridge, lift: 6.5, speed: 4, open: false, at: 0, down: true } });
    b.dress(0, L);
    const back = b.P(X1, 3, 11);
    const across = b.P(-w, 1.5, 8.5);
    const stand = b.P(0, 0, 11);
    mark(b, 'relay', 0, L, { gap: G1 - G0, lip: G0, shutter: shut, bridge, sw1: sw1.id, sw2: sw2.id });
    b.links.push({ kind: 'relay', sw1: sw1.id, sw2: sw2.id, back, across });
    b.go(0, 0, 11);
    b.step({ a: 'shoot', from: standAt(...stand), at: sw1.p, sw: sw1.id });
    b.step({ a: 'portal', from: standAt(...stand), aims: [{ which: 0, at: back }, { which: 1, at: across }] });
    b.step({ a: 'shoot', from: standAt(...b.P(0.5, 0, 8.5)), search: true, near: across, sw: sw2.id });
    b.step({ a: 'wait', t: 1.5 });
    b.go(0, 0, G0 + 1);
    b.go(0, 0, G1 + 1);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * A beam. From a lamp low on the wall a beam of light runs straight across
   * the way into the other wall. The door at the end opens to light: a lens
   * beside it, dark. Between them, a pillar, its back to the door. Walk past
   * it and turn round: one end where the beam meets the wall, the other on
   * the pillar's back, and the beam goes in at one and out of the other,
   * down the hall onto the lens. A charge does nothing to it.
   */
  beam(b, o = {}) {
    const w = b.W / 2;
    const L = 32;
    const dz = 26;
    const H = b.roof || 7;
    b.floor(0, L, 0, { noRails: true });
    b.box([-w - 1, -2, 0], [-w, H, L], { role: 'wall' });
    b.box([w, -2, 0], [w + 1, H, L], { role: 'wall' });
    if (b.roof) b.box([-w - 1, H, 0], [w + 1, H + 1, L], { role: 'roof' });
    // The lamp, and its beam across the way.
    const bz = 6;
    const by = 1.9;
    b.box([-w, by - 0.35, bz - 0.35], [-w + 0.4, by + 0.35, bz + 0.35], { mat: 'metal', color: '#3a4048', role: 'trim', noPortal: true });
    const lens = b.def.accent || '#ff5a4a';
    b.box([-w + 0.4, by - 0.12, bz - 0.12], [-w + 0.5, by + 0.12, bz + 0.12], { mat: 'lamp', color: lens, glow: 2, noPortal: true, passCharges: true });
    b.world.beams.push({ p: b.P(-w + 0.55, by, bz), dir: b.D(1, 0, 0), color: lens });
    // The pillar, its back to the door.
    const px0 = w - 3.2;
    const px1 = w - 0.6;
    b.box([px0, 0, 12], [px1, H, 14], { role: 'wall' });
    // The door wall: the door on the left, the lens on the right.
    const id = b.doorId++;
    const sw = { id: b.doorId++, p: null, doors: [id], timer: 0, on: false };
    b.box([-w - 1, 0, dz], [-w + 0.5, H, dz + 1], { role: 'wall' });
    b.box([-w + 3.5, 0, dz], [w + 1, H, dz + 1], { role: 'wall' });
    b.box([-w + 0.5, 3.4, dz], [-w + 3.5, H, dz + 1], { role: 'wall' });
    b.box([-w + 0.5, 0, dz + 0.1], [-w + 3.5, 3.4, dz + 0.9], { role: 'door', door: { id, lift: 3.3, speed: 5, open: false, at: 0 } });
    const rx0 = px0 + 0.1;
    const rx1 = px1 - 0.1;
    const rec = b.box([rx0, 0.9, dz - 0.15], [rx1, 3.6, dz], { mat: 'glass', color: lens, glow: 0.3, role: 'trim', receiver: sw, dynamic: true, noPortal: true });
    sw.p = [(rec.min[0] + rec.max[0]) / 2, (rec.min[1] + rec.max[1]) / 2, (rec.min[2] + rec.max[2]) / 2];
    sw.solid = rec;
    b.world.switches.push(sw);
    b.dress(0, L);
    const spot = b.P(w, by, bz);
    const back = b.P((px0 + px1) / 2, by, 14);
    mark(b, 'beam', 0, L, { door: id, sw: sw.id });
    b.links.push({ kind: 'beam', sw: sw.id, spot, back });
    b.go(-2, 0, 17);
    b.step({ a: 'portal', from: standAt(...b.P(-2, 0, 17)), aims: [{ which: 0, at: spot }, { which: 1, at: back }] });
    b.step({ a: 'wait', t: 1.5 });
    b.go(-w + 2, 0, dz - 1.5);
    b.go(-w + 2, 0, dz + 2.5);
    b.go(0, 0, L - 1);
    b.advance(L);
  },
};
