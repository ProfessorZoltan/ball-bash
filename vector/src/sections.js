// The sections a level is laid from, each in its own frame: x to the right,
// y up, z along the way, the floor at y = 0 where it starts. Each builds its
// solids, sets its enemies and pickups, writes how it is crossed (the
// autopilot's steps), and moves the cursor on to where the next one starts.
// DOM-free.
import { standAt } from './player.js';
import { ROBOT, WORM, JUMP } from './config.js';

const EYE = ROBOT.half + ROBOT.r + ROBOT.eye;

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
  if (d.kind === 'water' || d.kind === 'electric') b.box([-b.W / 2, y - d.depth, z0], [b.W / 2, y - d.depth + 0.25, z1], { mat: d.kind === 'water' ? 'water' : 'lamp', color: d.color || '#3aa0ff', glow: d.kind === 'electric' ? 0.5 : 0, passCharges: true, ghost: true, noPortal: true });
}

export const SECTIONS = {
  /** The spawn: a pad and a stretch to find your feet. */
  start(b, o = {}) {
    const L = o.len || 14;
    b.floor(-6, L);
    b.sides(-6, L);
    if (b.roof) b.box([-b.W / 2 - 1, -2, -7], [b.W / 2 + 1, b.roof, -6], { role: 'wall' });
    b.box([-1.5, 0, -1.5], [1.5, 0.08, 1.5], { mat: 'panel', color: b.def.accent || '#7fe9ff', glow: 0.15, role: 'pad' });
    b.spawn = { p: standAt(...b.P(0, 0.1, 0)), yaw: b.yaw };
    b.dress(-6, L);
    mark(b, 'start', 0, L);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /** A straight stretch, a foe or two on it. */
  run(b, o = {}) {
    const L = o.len || 16;
    b.floor(0, L);
    b.sides(0, L);
    const n = o.foes ?? 1;
    for (let i = 0; i < n; i++) {
      const z = 4 + ((L - 8) * (i + 0.5)) / n;
      if (b.r() < 0.6) b.guard('ground', -b.W / 4, 0.7, z, { to: [b.W / 4, 0.7, z] });
      else b.guard('air', 0, 2.8 + b.r() * 1.5, z, { to: [0, 3, Math.min(L - 2, z + 5)] });
    }
    b.dress(0, L);
    mark(b, 'run', 0, L);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /** A gap to jump: walking or running, level, up or down. */
  gap(b, o = {}) {
    const run = o.run ?? false;
    const g = o.gap ?? (run ? 5 : 3);
    const rise = o.rise ?? 0;
    const A = run ? 8 : 5;
    const land = o.land ?? 7;
    b.floor(0, A);
    b.floor(A + g, A + g + land, rise);
    b.sides(0, A + g + land, Math.min(0, rise), b.roof ? b.roof + Math.max(0, rise) : 0);
    pit(b, A, A + g, Math.min(0, rise));
    if (o.flier !== false && b.r() < 0.55) b.guard('air', b.W / 4, 3.5 + rise, A + g / 2, { to: [-b.W / 4, 3.5 + rise, A + g / 2] });
    b.dress(0, A + g + land, Math.min(0, rise));
    mark(b, 'gap', 0, A + g + land, { gap: g, rise, run });
    b.jump(0, 0, A - 0.45, 0, rise, A + g + 1.6, run);
    b.go(0, rise, A + g + land - 1);
    b.advance(A + g + land, rise);
  },

  /** Stepping stones over a drop, side to side. */
  stones(b, o = {}) {
    const n = o.n || 4;
    b.floor(0, 4);
    let z = 4;
    let y = 0;
    let x = 0;
    const size = o.size || 2.4;
    const stones = [];
    for (let i = 0; i < n; i++) {
      const g = 1.6 + b.r() * (o.hard ? 1.2 : 0.7);
      const dy = o.flat ? 0 : Math.round((b.r() - 0.4) * 2) * 0.5;
      const nx = Math.max(-b.W / 2 + size / 2, Math.min(b.W / 2 - size / 2, x + (b.r() < 0.5 ? -1 : 1) * (1 + b.r() * 1.5)));
      z += g;
      y = Math.max(-1, Math.min(2, y + dy));
      stones.push({ x: nx, y, z0: z, z1: z + size });
      b.box([nx - size / 2, y - 1.2, z], [nx + size / 2, y, z + size], { role: 'plat' });
      x = nx;
      z += size;
    }
    const g = 1.8;
    const end = z + g;
    const top = Math.max(0, y);
    b.floor(end, end + 6, top);
    b.sides(0, end + 6, -1, b.roof ? b.roof + 2 : 0);
    pit(b, 4, end, -1);
    if (b.r() < 0.6) b.guard('air', 0, 3.5, (4 + end) / 2, { to: [0, 4.5, (4 + end) / 2 + 3] });
    b.dress(0, end + 6);
    mark(b, 'stones', 0, end + 6);
    let px = 0;
    let py = 0;
    let pz = 3.6;
    for (const s of stones) {
      b.jump(px, py, pz, s.x, s.y, s.z0 + 1.0, false);
      px = s.x;
      py = s.y;
      pz = s.z1 - 0.5;
    }
    b.jump(px, py, pz, 0, top, end + 1.4, false);
    b.go(0, top, end + 5);
    b.advance(end + 6, top);
  },

  /** Blocks up, each a jump higher. */
  climb(b, o = {}) {
    const n = o.steps || 3;
    const rise = o.rise || 1.4;
    const depth = o.depth || 3.5;
    b.floor(0, 4);
    for (let i = 0; i < n; i++) b.box([-b.W / 2, -2, 4 + i * depth], [b.W / 2, (i + 1) * rise, 4 + (i + 1) * depth], { role: 'plat', floorish: true });
    const top = n * rise;
    const L = 4 + n * depth;
    b.floor(L, L + 5, top);
    b.sides(0, L + 5, 0, b.roof ? b.roof + top : 0);
    if (b.r() < 0.5) b.guard('ground', -b.W / 4, top + 0.7, L + 2.5, { to: [b.W / 4, top + 0.7, L + 2.5] });
    b.dress(0, L + 5);
    mark(b, 'climb', 0, L + 5);
    for (let i = 0; i < n; i++) b.jump(0, i * rise, 4 + i * depth - 0.5, 0, (i + 1) * rise, 4 + i * depth + 1.2, false);
    b.go(0, top, L + 4);
    b.advance(L + 5, top);
  },

  /** A ledge to drop from. */
  drop(b, o = {}) {
    const h = o.h || 3;
    b.floor(0, 5);
    b.floor(5, 12, -h);
    b.sides(0, 12, -h, b.roof ? b.roof + h : 0);
    b.dress(0, 12, -h);
    mark(b, 'drop', 0, 12);
    b.go(0, 0, 4.6);
    b.go(0, -h, 8);
    b.go(0, -h, 11);
    b.advance(12, -h);
  },

  /** A platform to ride across a pit too wide to jump. */
  mover(b, o = {}) {
    const g = o.gap || 14;
    const pw = 3.2;
    b.floor(0, 5);
    b.floor(5 + g, 11 + g);
    b.sides(0, 11 + g);
    pit(b, 5, 5 + g);
    const period = o.period || Math.max(5, g / 1.6);
    const plat = b.box([-pw / 2, -0.6, 5], [pw / 2, 0, 5 + pw], { role: 'plat', move: { to: b.D(0, 0, 1).map((v) => v * (g - pw)), period, phase: 0 } });
    if (b.r() < 0.6) b.guard('air', b.W / 3, 3.5, 5 + g / 2, { to: [-b.W / 3, 3.5, 5 + g / 2] });
    b.dress(0, 11 + g);
    mark(b, 'mover', 0, 11 + g);
    b.go(0, 0, 3.8);
    b.step({ a: 'waitFor', solid: plat.id, near: b.P(0, -0.3, 5 + pw / 2), tol: 0.35 });
    b.step({ a: 'ride', solid: plat.id, until: b.P(0, -0.3, 5 + g - pw / 2), tol: 0.4 });
    b.go(0, 0, 5 + g + 2.5);
    b.go(0, 0, 10 + g);
    b.advance(11 + g);
  },

  /** A lift up a cliff. */
  lift(b, o = {}) {
    const h = o.h || 7;
    b.floor(0, 5);
    b.box([-b.W / 2, -2, 8.5], [b.W / 2, h, 13], { role: 'wall' });
    b.floor(8.5, 16, h);
    b.box([-b.W / 2, -2, 5], [b.W / 2, -1.2, 8.5], { role: 'floor' });
    const lift = b.box([-1.6, -0.6, 5.2], [1.6, 0, 8.4], { role: 'plat', move: { to: [0, h, 0], period: o.period || 7, phase: 0 } });
    b.sides(0, 16, 0, b.roof ? b.roof + h : 0);
    b.dress(0, 16);
    mark(b, 'lift', 0, 16, { h });
    b.go(0, 0, 4);
    b.step({ a: 'waitFor', solid: lift.id, near: b.P(0, -0.3, 6.8), tol: 0.35 });
    b.step({ a: 'ride', solid: lift.id, until: b.P(0, h - 0.3, 6.8), tol: 0.3 });
    b.go(0, h, 11);
    b.go(0, h, 15);
    b.advance(16, h);
  },

  /** A tower: ledges up the inside of a shaft, round and round, a short jump apart. */
  tower(b, o = {}) {
    const H = o.h || 12;
    const S = 11; // inside size
    const z0 = 3;
    const cz = z0 + S / 2;
    b.floor(0, z0 + S + 1);
    // Walls round the shaft, a doorway at its foot.
    const wy = H + 6;
    b.box([-S / 2 - 1, -2, z0], [-S / 2, wy, z0 + S], { role: 'wall' });
    b.box([S / 2, -2, z0], [S / 2 + 1, wy, z0 + S], { role: 'wall' });
    b.box([-S / 2 - 1, 3.2, z0 - 1], [S / 2 + 1, wy, z0], { role: 'wall' });
    b.box([-S / 2 - 1, -2, z0 - 1], [-1.8, 3.2, z0], { role: 'wall' });
    b.box([1.8, -2, z0 - 1], [S / 2 + 1, 3.2, z0], { role: 'wall' });
    b.box([-S / 2 - 1, -2, z0 + S], [S / 2 + 1, H - 0.1, z0 + S + 1], { role: 'wall' });
    b.box([-S / 2 - 1, H + 3.4, z0 + S], [S / 2 + 1, wy, z0 + S + 1], { role: 'wall' });
    // Ledges on a spiral a sixth of a turn apart, the first on the far side (never
    // over the doorway), each 1 to 1.7 m above the last, and as many as brings the
    // last a sixth of a turn from the way out in the far wall.
    let n = Math.ceil(H / 1.7);
    while (![5, 1].includes((n - 2) % 6) || H / n > 1.7) n++;
    const R = 3.3;
    const ledges = [];
    for (let i = 1; i < n; i++) {
      const a = ((i - 1) * Math.PI) / 3;
      const x = R * Math.sin(a);
      const z = cz + R * Math.cos(a);
      const y = (i * H) / n;
      ledges.push({ x, y, z });
      b.box([x - 1.2, y - 0.4, z - 1.2], [x + 1.2, y, z + 1.2], { role: 'plat' });
    }
    // Out at the top, through the far wall.
    b.box([-1.8, H - 0.5, z0 + S - 2.5], [1.8, H, z0 + S + 1], { role: 'plat' });
    b.floor(z0 + S + 1, z0 + S + 8, H);
    b.sides(z0 + S + 1, z0 + S + 8, H);
    if (b.r() < 0.8) b.guard('air', 0, H / 2, cz, { to: [0, H - 1, cz] });
    mark(b, 'tower', 0, z0 + S + 8, { h: H });
    b.go(0, 0, z0 + 1.2);
    // From the floor, a step in from under the first ledge.
    const f = ledges[0];
    const toC = Math.hypot(f.x, f.z - cz) || 1;
    const fx = f.x - (f.x / toC) * 1.7;
    const fz = f.z - ((f.z - cz) / toC) * 1.7;
    b.go(fx * 0.5, 0, cz + (fz - cz) * 0.5);
    b.jump(fx, 0, fz, f.x, f.y, f.z, false);
    const hop = (p, q) => {
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      b.jump(p.x + (dx / d) * 0.8, p.y, p.z + (dz / d) * 0.8, q.x - (dx / d) * 0.5, q.y, q.z - (dz / d) * 0.5, false);
    };
    for (let i = 1; i < ledges.length; i++) hop(ledges[i - 1], ledges[i]);
    hop(ledges[ledges.length - 1], { x: 0, y: H, z: z0 + S - 1.2 });
    b.go(0, H, z0 + S + 3);
    b.go(0, H, z0 + S + 7);
    b.advance(z0 + S + 8, H);
  },

  /** A door that a switch in plain sight opens. Timed ones put the switch well back: shoot, then run. */
  switchdoor(b, o = {}) {
    const timed = o.timed || 0;
    const L = timed ? 30 : 16;
    const dz = timed ? 26 : 10;
    b.floor(0, L);
    b.sides(0, L);
    const H = b.roof || 9;
    const id = b.doorId++;
    b.box([-b.W / 2 - 1, 0, dz], [-2, H, dz + 1], { role: 'wall' });
    b.box([2, 0, dz], [b.W / 2 + 1, H, dz + 1], { role: 'wall' });
    b.box([-2, 3.4, dz], [2, H, dz + 1], { role: 'wall' });
    b.box([-2, 0, dz + 0.1], [2, 3.4, dz + 0.9], { role: 'door', door: { id, lift: 3.3, speed: 5, open: false, at: 0 } });
    // The switch: on the wall over the door, or (timed) on a post by the start.
    const sw = { id, p: null, doors: [id], timer: timed, on: false };
    let swS;
    if (timed) {
      swS = b.box([b.W / 2 - 0.9, 2.2, 3], [b.W / 2 - 0.1, 3.0, 3.8], { role: 'switch', switchRef: sw, dynamic: true });
      b.box([b.W / 2 - 0.9, 0, 3], [b.W / 2 - 0.1, 2.2, 3.8], { role: 'trim' });
    } else {
      swS = b.box([-0.5, 5, dz - 0.5], [0.5, 6, dz], { role: 'switch', switchRef: sw, dynamic: true });
    }
    sw.p = [(swS.min[0] + swS.max[0]) / 2, (swS.min[1] + swS.max[1]) / 2, (swS.min[2] + swS.max[2]) / 2];
    sw.solid = swS;
    b.world.switches.push(sw);
    b.dress(0, L);
    mark(b, 'switchdoor', 0, L, { timed });
    const stand = timed ? b.P(0, 0, 1.5) : b.P(0, 0, 4);
    b.step({ a: 'go', to: standAt(...stand) });
    b.step({ a: 'shoot', from: standAt(...stand), at: sw.p, sw: sw.id });
    b.step({ a: 'go', to: standAt(...b.P(0, 0, dz + 3)), run: !!timed });
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * A bulkhead: a wall across the way with a slot under it too low for the
   * robot, but not for the line of sight. One end on the floor beyond, seen
   * through the slot; the other at your feet.
   */
  bulkhead(b, o = {}) {
    const gapH = o.gapH || 1.25;
    const thick = o.thick || 2.5;
    const dz = 9;
    const L = dz + thick + 12;
    b.floor(0, L);
    b.sides(0, L);
    const H = b.roof || 10;
    b.box([-b.W / 2 - 1, gapH, dz], [b.W / 2 + 1, H, dz + thick], { role: 'wall' });
    b.box([-b.W / 2 - 1, -2, dz], [b.W / 2 + 1, 0, dz + thick], { role: 'floor' });
    const far = b.P(0, 0, dz + thick + 5);
    const near = b.P(0, 0, 5.2);
    b.dress(0, L);
    mark(b, 'bulkhead', 0, L, { gapH, thick });
    b.links.push({ kind: 'bulkhead', at: b.P(0, 0, dz), far, near });
    b.go(0, 0, 2.2);
    b.step({ a: 'portal', from: standAt(...b.P(0, 0, 2.2)), aims: [{ which: 0, at: far }, { which: 1, at: near }], enter: standAt(...near) });
    b.go(0, 0, dz + thick + 8);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /** A chasm no jump crosses, and past it a wall facing back across: one end on it, the other at your feet. */
  chasm(b, o = {}) {
    const g = o.gap || 13;
    const rise = o.rise || 0;
    const A = 7;
    b.floor(0, A);
    const fz = A + g;
    b.floor(fz, fz + 14, rise);
    b.sides(0, fz + 14, Math.min(0, rise), b.roof ? b.roof + Math.max(0, rise) : 0);
    pit(b, A, fz, Math.min(0, rise));
    // The wall, 3.5 m back from the far edge, the path going on round it.
    const wz = fz + 3.5;
    const wall = b.box([-2.2, rise, wz], [2.2, rise + 5, wz + 1.2], { role: 'wall' });
    const face = b.P(0, rise + 1.3, wz);
    const near = b.P(0, 0, A - 1.3);
    if (b.r() < 0.7) b.guard('air', 0, 4, A + g / 2, { to: [0, 5, A + g / 2 + 2] });
    b.dress(0, fz + 14);
    mark(b, 'chasm', 0, fz + 14, { gap: g, rise });
    b.links.push({ kind: 'chasm', wall: wall.id, face, near });
    b.go(0, 0, 2.5);
    b.step({ a: 'portal', from: standAt(...b.P(0, 0, 2.5)), aims: [{ which: 0, at: face }, { which: 1, at: near }], enter: standAt(...near) });
    b.step({ a: 'settle' });
    b.go(3, rise, wz - 1);
    b.go(3, rise, wz + 3);
    b.go(0, rise, fz + 12);
    b.advance(fz + 14, rise);
  },

  /**
   * A launch: a chasm past any running jump, and before it a ramp. One end on
   * the ramp's face, the other at your feet: out of the face you are thrown
   * across.
   */
  launch(b, o = {}) {
    const g = o.gap || 10;
    const rise = o.rise || 0;
    const A = 12;
    b.floor(0, A);
    // The ramp climbs toward the edge; its face looks back at you.
    const ramp = b.ramp([-2.2, 0, A - 4.2], [2.2, 2.2, A], 'z', 1, { role: 'ramp', launch: true });
    b.floor(A + g, A + g + 12, rise);
    b.sides(0, A + g + 12, Math.min(0, rise), b.roof ? b.roof + Math.max(0, rise) + 4 : 0);
    pit(b, A, A + g, Math.min(0, rise));
    const face = b.P(0, 1.1, A - 2.1);
    const near = b.P(0, 0, 3.6);
    b.dress(0, A + g + 12);
    mark(b, 'launch', 0, A + g + 12, { gap: g, rise });
    b.links.push({ kind: 'launch', ramp: ramp.id, face, near });
    b.go(0, 0, 1.2);
    b.step({ a: 'portal', from: standAt(...b.P(0, 0, 1.2)), aims: [{ which: 0, at: face }, { which: 1, at: near }], enter: standAt(...near) });
    b.step({ a: 'fly', to: standAt(...b.P(0, rise, A + g + 3)) });
    b.go(0, rise, A + g + 11);
    b.advance(A + g + 12, rise);
  },

  /**
   * A vault: a door that only a switch opens, the switch sealed in a box of
   * armoured glass to the side. You see in; nothing solid gets in. One end on
   * the vault's back wall, one on the wall across the way; fire into yours,
   * and the charge comes out in the vault, straight at the switch.
   */
  vault(b, o = {}) {
    const L = 24;
    const dz = 18;
    b.floor(0, L);
    const w = b.W / 2;
    const H = b.roof || 9;
    if (b.roof) b.box([-w - 1, H, 0], [w + 5, H + 1, L], { role: 'roof' });
    // The wall across the way (left), for the near end.
    b.box([-w - 1, -2, 0], [-w, H, L], { role: 'wall' });
    // The vault on the right: back wall, glass front and sides and top.
    const vz0 = 6;
    const vz1 = 11;
    b.box([w, -2, 0], [w + 5, 0, L], { role: 'floor' });
    b.box([w + 4, 0, vz0], [w + 5, 4, vz1], { role: 'wall' });
    b.box([w, 0, vz0], [w + 0.2, 4, vz1], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    b.box([w, 0, vz0 - 0.2], [w + 4, 4, vz0], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    b.box([w, 0, vz1], [w + 4, 4, vz1 + 0.2], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    b.box([w, 4, vz0 - 0.2], [w + 5, 4.2, vz1 + 0.2], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    // The rest of the right side walled, so there is no way round.
    b.box([w + 4, -2, 0], [w + 5, H, vz0], { role: 'wall' });
    b.box([w + 4, -2, vz1], [w + 5, H, L], { role: 'wall' });
    b.box([w, 4.2, vz0 - 0.2], [w + 4, H, vz0], { role: 'wall' });
    b.box([w, 4.2, vz1], [w + 4, H, vz1 + 0.2], { role: 'wall' });
    b.box([w, 0, 0], [w + 4, H, vz0 - 0.2], { role: 'wall' });
    b.box([w, 0, vz1 + 0.2], [w + 4, H, L], { role: 'wall' });
    const id = b.doorId++;
    const sw = { id, p: null, doors: [id], timer: 0, on: false };
    // The switch stands in the vault straight out from the middle of its back wall, so a
    // charge out of an end there meets it; the robot sees the wall past it at a slant.
    const swS = b.box([w + 1.5, 1, (vz0 + vz1) / 2 - 0.5], [w + 2.5, 2.1, (vz0 + vz1) / 2 + 0.5], { role: 'switch', switchRef: sw, dynamic: true });
    sw.p = [(swS.min[0] + swS.max[0]) / 2, (swS.min[1] + swS.max[1]) / 2, (swS.min[2] + swS.max[2]) / 2];
    sw.solid = swS;
    b.world.switches.push(sw);
    // The door.
    b.box([-w - 1, 0, dz], [-2, H, dz + 1], { role: 'wall' });
    b.box([2, 0, dz], [w + 1, H, dz + 1], { role: 'wall' });
    b.box([-2, 3.4, dz], [2, H, dz + 1], { role: 'wall' });
    b.box([-2, 0, dz + 0.1], [2, 3.4, dz + 0.9], { role: 'door', door: { id, lift: 3.3, speed: 5, open: false, at: 0 } });
    const cz = (vz0 + vz1) / 2;
    const back = b.P(w + 4, 1.6, cz);
    const across = b.P(-w, 1.5, cz - 4);
    const stand = b.P(0, 0, cz - 4);
    mark(b, 'vault', 0, L);
    b.links.push({ kind: 'vault', sw: sw.id, back, across });
    b.go(0, 0, cz - 4);
    b.step({ a: 'portal', from: standAt(...stand), aims: [{ which: 0, at: back }, { which: 1, at: across }] });
    b.step({ a: 'shoot', from: standAt(...stand), at: 'end1', sw: sw.id });
    b.go(0, 0, dz + 3);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /**
   * An orbit: the switch on the floor of a walled pocket open only to the
   * sky, a black hole hanging over it. No straight shot reaches it, and no
   * bank: fire up past the hole and it brings the charge round and down.
   */
  orbit(b, o = {}) {
    const L = 26;
    const dz = 20;
    const w = b.W / 2;
    b.floor(0, L);
    const H = 7;
    // The pocket, on the right, walled to H.
    const x0 = w + 0.5;
    const x1 = w + 6.5;
    const z0 = 7;
    const z1 = 13;
    if (b.roof) {
      // Indoors the hall rises over the pocket and the hole: a roof at 14 m, and
      // the right-hand wall open above the pocket's own.
      const R = 14;
      b.box([-w - 1, -2, 0], [-w, R, L], { role: 'wall' });
      b.box([w, -2, 0], [w + 1, R, z0 - 1], { role: 'wall' });
      b.box([w, -2, z1 + 1], [w + 1, R, L], { role: 'wall' });
      b.box([w, R - 0.01, z0 - 1], [x1 + 1, R + 1, z1 + 1], { role: 'roof' });
      b.box([x0, H, z0 - 1], [x1 + 1, R, z0], { role: 'wall' });
      b.box([x0, H, z1], [x1 + 1, R, z1 + 1], { role: 'wall' });
      b.box([x1, H, z0], [x1 + 1, R, z1], { role: 'wall' });
      b.box([-w - 1, R, 0], [w + 1, R + 1, L], { role: 'roof' });
    }
    b.box([w, -2, z0 - 1], [x1 + 1, 0, z1 + 1], { role: 'floor' });
    b.box([w, 0, z0 - 1], [x0, H, z1 + 1], { role: 'wall' });
    b.box([x1, 0, z0 - 1], [x1 + 1, H, z1 + 1], { role: 'wall' });
    b.box([x0, 0, z0 - 1], [x1, H, z0], { role: 'wall' });
    b.box([x0, 0, z1], [x1, H, z1 + 1], { role: 'wall' });
    const id = b.doorId++;
    const sw = { id, p: null, doors: [id], timer: 0, on: false };
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const half = o.pad || 1.75;
    const swS = b.box([cx - half, 0, cz - half], [cx + half, 0.4, cz + half], { role: 'switch', switchRef: sw, dynamic: true });
    sw.p = [(swS.min[0] + swS.max[0]) / 2, swS.max[1], (swS.min[2] + swS.max[2]) / 2];
    sw.solid = swS;
    b.world.switches.push(sw);
    // The hole hangs just over the pocket's near wall, a little above it: a shot fired
    // over it is pulled down into the pocket. About one aim in twelve of those that go
    // up and over lands on the switch, and the aim line shows the bend.
    const hole = b.P(cx + (o.holeX ?? -3), o.holeY || 9.5, cz);
    b.world.wells.push({ p: hole, pull: o.pull || 4000, reach: o.reach || 12, horizon: 0.7 });
    const DH = b.roof ? 14 : 12;
    b.box([-w - 1, 0, dz], [-2, DH, dz + 1], { role: 'wall' });
    b.box([2, 0, dz], [w + 1, DH, dz + 1], { role: 'wall' });
    b.box([-2, 3.4, dz], [2, DH, dz + 1], { role: 'wall' });
    b.box([-2, 0, dz + 0.1], [2, 3.4, dz + 0.9], { role: 'door', door: { id, lift: 3.3, speed: 5, open: false, at: 0 } });
    if (b.roof) {
      // Where the high hall meets the low ones either side, a lintel closes the gap.
      b.box([-w - 1, b.roof, -1], [w + 1, 14, 0], { role: 'wall' });
      b.box([-w - 1, b.roof, L], [w + 1, 14, L + 1], { role: 'wall' });
    }
    mark(b, 'orbit', 0, L);
    b.links.push({ kind: 'orbit', sw: sw.id, hole });
    const stand = b.P(-1, 0, cz - 2);
    b.go(-1, 0, cz - 2);
    b.step({ a: 'shoot', from: standAt(...stand), search: true, near: hole, sw: sw.id });
    b.go(0, 0, dz + 3);
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /** Laser gates on a clock: beams from floor to roof, lit for a while, then dark. Go while dark. */
  laser(b, o = {}) {
    const n = o.n || 2;
    const L = 8 + n * 7;
    b.floor(0, L);
    const H = b.roof || 6;
    b.sides(0, L, 0, H);
    const gates = [];
    for (let i = 0; i < n; i++) {
      const z = 6 + i * 7;
      const [min, max] = b.aabb([-b.W / 2, 0, z - 0.15], [b.W / 2, H, z + 0.15]);
      const period = o.period || 3;
      const on = o.on || 1.3;
      const hz = { min, max, kind: 'laser', laser: { period, on, phase: -i * 1.0 }, id: `laser${b.sections.length}_${i}` };
      b.world.hazards.push(hz);
      gates.push(hz.id);
      if (!b.roof) b.box([-b.W / 2 - 0.6, 0, z - 0.4], [b.W / 2 + 0.6, 0.3, z + 0.4], { role: 'trim' });
      b.box([-b.W / 2 - 0.8, H, z - 0.5], [b.W / 2 + 0.8, H + 0.6, z + 0.5], { role: 'trim' });
    }
    b.dress(0, L);
    mark(b, 'laser', 0, L, { n });
    for (let i = 0; i < n; i++) {
      const z = 6 + i * 7;
      b.go(0, 0, z - 2.2);
      b.step({ a: 'gate', hazard: gates[i], to: standAt(...b.P(0, 0, z + 2.2)) });
    }
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /** Crushers over the way, slamming on a clock. */
  crusher(b, o = {}) {
    const n = o.n || 2;
    const L = 8 + n * 6;
    b.floor(0, L);
    const H = b.roof || 7;
    b.sides(0, L, 0, H);
    const ids = [];
    for (let i = 0; i < n; i++) {
      const z = 6 + i * 6;
      const drop = H - 1.3;
      const c = b.box([-b.W / 2, H - 1.2, z - 1.4], [b.W / 2, H, z + 1.4], { role: 'crusher', crush: { period: o.period || 3.2, drop: drop - 0.02, phase: -i * 1.1 } });
      ids.push(c.id);
      if (!b.roof) {
        b.box([-b.W / 2 - 1, 0, z - 1.6], [-b.W / 2, H + 1, z + 1.6], { role: 'trim' });
        b.box([b.W / 2, 0, z - 1.6], [b.W / 2 + 1, H + 1, z + 1.6], { role: 'trim' });
        b.box([-b.W / 2 - 1, H, z - 1.6], [b.W / 2 + 1, H + 1, z + 1.6], { role: 'trim' });
      }
    }
    b.dress(0, L);
    mark(b, 'crusher', 0, L, { n });
    for (let i = 0; i < n; i++) {
      const z = 6 + i * 6;
      b.go(0, 0, z - 3);
      b.step({ a: 'crush', solid: ids[i], to: standAt(...b.P(0, 0, z + 2.6)) });
    }
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /** Floors that blink over a pit, one after another: a wave that travels across. */
  blink(b, o = {}) {
    const n = o.n || 5;
    const size = 3;
    const gap = 1.2;
    b.floor(0, 5);
    const z0 = 5 + gap;
    // The wave travels at a jumping pace: each floor lights 1.25 s after the one
    // before (a jump and a step) and stays 2.7 s, so there is always one ahead to
    // jump to and time to land.
    const period = o.period || 4.4;
    const plats = [];
    for (let i = 0; i < n; i++) {
      const z = z0 + i * (size + gap);
      const p = b.box([-size / 2, -0.6, z], [size / 2, 0, z + size], { role: 'blink', blink: { period, on: 0, off: period * 0.62, phase: -i * 1.25 } });
      plats.push({ id: p.id, z });
    }
    const end = z0 + n * (size + gap);
    b.floor(end, end + 6);
    b.sides(0, end + 6);
    pit(b, 5, end);
    b.dress(0, end + 6);
    mark(b, 'blink', 0, end + 6, { n });
    let pz = 4.5;
    for (const p of plats) {
      b.step({ a: 'hop', solid: p.id, from: standAt(...b.P(0, 0, pz)), to: standAt(...b.P(0, 0, p.z + size / 2)) });
      pz = p.z + size - 0.5;
    }
    b.jump(0, 0, pz, 0, 0, end + 1.5, false);
    b.go(0, 0, end + 5);
    b.advance(end + 6);
  },

  /** A spring before a cliff no jump climbs. */
  springs(b, o = {}) {
    const h = o.h || 6;
    b.floor(0, 8);
    b.box([-b.W / 2, -2, 8], [b.W / 2, h, 11], { role: 'wall' });
    b.floor(8, 18, h);
    b.box([-1.2, 0, 4.2], [1.2, 0.35, 6.6], { role: 'spring', spring: Math.sqrt(2 * 20 * (h + 1.6)) });
    b.sides(0, 18, 0, b.roof ? b.roof + h : 0);
    b.dress(0, 18);
    mark(b, 'springs', 0, 18, { h });
    b.go(0, 0, 2.5);
    b.step({ a: 'spring', pad: standAt(...b.P(0, 0.35, 5.4)), to: standAt(...b.P(0, h, 11.5)) });
    b.go(0, h, 17);
    b.advance(18, h);
  },

  /** A fan's updraft over a pit, up to a ledge. */
  fans(b, o = {}) {
    const h = o.h || 7;
    b.floor(0, 6);
    b.box([-2, -3.4, 6], [2, -3, 10], { role: 'trim', mat: 'metal', color: '#444a52' });
    const [min, max] = b.aabb([-2, -3, 6], [2, h + 4, 10]);
    b.world.fans.push({ min, max, lift: 44 });
    b.floor(10, 18, h);
    b.box([-b.W / 2, -2, 10], [b.W / 2, h - 2, 11], { role: 'wall' });
    b.sides(0, 18, -3, b.roof ? b.roof + h + 3 : 0);
    pit(b, 6, 10, -3);
    b.dress(0, 18);
    mark(b, 'fans', 0, 18, { h });
    b.go(0, 0, 5);
    b.step({ a: 'updraft', to: standAt(...b.P(0, h, 12)), in: standAt(...b.P(0, 0, 8)) });
    b.go(0, h, 17);
    b.advance(18, h);
  },

  /** A pit with a black hole in it: every jump over it bends, and a stepping stone over the hole. */
  wellpit(b, o = {}) {
    const g = o.gap || 9;
    b.floor(0, 7);
    b.floor(7 + g, 14 + g);
    b.sides(0, 14 + g);
    pit(b, 7, 7 + g);
    b.box([-1.3, -0.8, 7 + g / 2 - 1.3], [1.3, 0, 7 + g / 2 + 1.3], { role: 'plat', heavy: true });
    b.world.wells.push({ p: b.P(0, -3, 7 + g / 2), pull: o.pull || 330, reach: 11, horizon: 0.9 });
    b.dress(0, 14 + g);
    mark(b, 'wellpit', 0, 14 + g, { gap: g });
    b.jump(0, 0, 6.5, 0, 0, 7 + g / 2, false);
    b.jump(0, 0, 7 + g / 2 + 0.8, 0, 0, 7 + g + 1.8, false);
    b.go(0, 0, 13 + g);
    b.advance(14 + g);
  },

  /** A corner: a square landing, and the way goes on to the left or the right. */
  turn(b, o = {}) {
    const dir = o.dir || (b.r() < 0.5 ? -1 : 1);
    const W = b.W;
    b.floor(0, W, 0, { noRails: true });
    const R = b.def.rails;
    if (R) {
      // Barriers round the landing on the two sides the way does not go.
      b.box([-W / 2, 0, W], [W / 2, R.h, W + R.w], { role: R.role, noPortal: true });
      if (dir > 0) b.box([-W / 2 - R.w, 0, 0], [-W / 2, R.h, W + R.w], { role: R.role, noPortal: true });
      else b.box([W / 2, 0, 0], [W / 2 + R.w, R.h, W + R.w], { role: R.role, noPortal: true });
    }
    const H = b.roof;
    if (H) {
      // The walls of the landing: the far one, and the side the way does not go.
      b.box([-W / 2 - 1, -2, W], [W / 2 + 1, H, W + 1], { role: 'wall' });
      if (dir > 0) b.box([-W / 2 - 1, -2, 0], [-W / 2, H, W], { role: 'wall' });
      else b.box([W / 2, -2, 0], [W / 2 + 1, H, W], { role: 'wall' });
      b.box([-W / 2 - 1, H, 0], [W / 2 + 1, H + 1, W + 1], { role: 'roof' });
    }
    b.prop(b.def.cornerProp || 'none', 0, 0, W / 2);
    mark(b, 'turn', 0, W, { dir });
    b.go(0, 0, W / 2);
    b.cur.p = b.P((dir * W) / 2, 0, W / 2);
    b.cur.h = (b.cur.h + (dir > 0 ? 3 : 1)) % 4;
    b.go(0, 0, 1);
  },

  /** A checkpoint: a pad on a short stretch. */
  checkpoint(b) {
    b.floor(0, 8);
    b.sides(0, 8);
    b.checkpoint(4);
    mark(b, 'checkpoint', 0, 8);
    b.go(0, 0, 7);
    b.advance(8);
  },

  /**
   * An ambush: a room that locks when you are in it, until its waves are
   * beaten, both doors shut.
   */
  ambush(b, o = {}) {
    const S = o.size || 22;
    const w = S / 2;
    const H = b.roof || 7;
    b.floor(0, 4);
    b.floor(4, 4 + S, 0, { w: S });
    b.floor(4 + S, 10 + S);
    b.sides(0, 4);
    b.sides(4 + S, 10 + S);
    const id1 = b.doorId++;
    const id2 = b.doorId++;
    // The room's walls, with a doorway in each end.
    b.box([-w - 1, -2, 4], [-w, H, 4 + S], { role: 'wall' });
    b.box([w, -2, 4], [w + 1, H, 4 + S], { role: 'wall' });
    for (const [z, id] of [[4, id1], [4 + S - 1, id2]]) {
      b.box([-w - 1, -2, z], [-2, H, z + 1], { role: 'wall' });
      b.box([2, -2, z], [w + 1, H, z + 1], { role: 'wall' });
      b.box([-2, 3.4, z], [2, H, z + 1], { role: 'wall' });
      b.box([-2, 0, z + 0.1], [2, 3.4, z + 0.9], { role: 'door', door: { id, lift: 3.3, speed: 6, open: true, at: 1 } });
    }
    if (b.roof) b.box([-w - 1, H, 4], [w + 1, H + 1, 4 + S], { role: 'roof' });
    // Cover to fight from.
    b.box([-w + 3, 0, 4 + S / 2 - 1], [-w + 5, 1.6, 4 + S / 2 + 1], { role: 'plat' });
    b.box([w - 5, 0, 4 + S / 2 - 1], [w - 3, 1.6, 4 + S / 2 + 1], { role: 'plat' });
    b.box([3, 0, 4 + S * 0.7], [6, 2.4, 4 + S * 0.7 + 1.5], { role: 'plat' });
    const [min, max] = b.aabb([-w + 1, -1, 7], [w - 1, 5, 4 + S - 3]);
    const waves = [];
    const nW = o.waves || 2;
    for (let i = 0; i < nW; i++) {
      const wave = [];
      const n = 3 + i;
      for (let j = 0; j < n; j++) {
        const f = b.foe(j % 2 ? ['flier', 'zigzag', 'gunner', 'circler'] : ['walker', 'chaser', 'hopper', 'lancer', 'trundle']) || b.foe(['walker']);
        if (!f) continue;
        const a = (j / n) * Math.PI * 2;
        const air = ['flier', 'zigzag', 'gunner', 'circler', 'diver'].includes(f.move);
        const p = b.P(Math.cos(a) * (w - 3), air ? 3.5 : 0.8, 4 + S / 2 + Math.sin(a) * (S / 2 - 4));
        wave.push({ ...f, p, yaw: b.yaw });
      }
      waves.push(wave);
    }
    b.ambushes.push({ min, max, doors: [id1, id2], waves, drop: b.r() < 0.5 ? b.r.pick(['big', 'triple', 'strong', 'durable', 'freeze']) : null, dropAt: b.P(0, 1, 4 + S / 2) });
    mark(b, 'ambush', 0, 10 + S);
    b.go(0, 0, 4 + S / 2);
    b.step({ a: 'clear' });
    b.go(0, 0, 8 + S);
    b.advance(10 + S);
  },

  /** A secret to the side: a hollow behind a cracked panel in the wall, a prize in it. */
  secret(b, o = {}) {
    const L = 14;
    b.floor(0, L);
    const side = o.side || (b.r() < 0.5 ? -1 : 1);
    const w = b.W / 2;
    const H = b.roof || 6;
    // A wall on that side with a hollow in it.
    const xa = side > 0 ? w : -w - 5;
    const xb = side > 0 ? w + 5 : -w;
    b.box([xa, -2, 4], [xb, 0, 10], { role: 'floor' });
    b.box([side > 0 ? w + 4 : -w - 5, 0, 4], [side > 0 ? w + 5 : -w - 4, H, 10], { role: 'wall' });
    b.box([xa, 0, 3], [xb, H, 4], { role: 'wall' });
    b.box([xa, 0, 10], [xb, H, 11], { role: 'wall' });
    b.box([xa, 3, 4], [xb, H, 10], { role: 'wall' });
    b.box([xa, -2, 0], [xb, H, 3], { role: 'wall' });
    b.box([xa, -2, 11], [xb, H, L], { role: 'wall' });
    const cov = b.box([side > 0 ? w : -w - 0.4, 0, 4], [side > 0 ? w + 0.4 : -w, 3, 10], { role: 'cover', cover: true, secret: true, hp: 4, mat: 'cracked' });
    b.sides(0, L, 0, null, side > 0 ? { noRight: true } : { noLeft: true });
    b.pickup(o.prize || b.r.pick(['big', 'triple', 'strong', 'durable', 'freeze']), side * (w + 2.5), 0, 7, { secret: true });
    b.secrets++;
    mark(b, 'secret', 0, L, { cover: cov.id });
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /** A loft: a ledge high on a wall that only a wormhole puts you on, and a prize there. */
  loft(b, o = {}) {
    const L = 20;
    const h = o.h || 7;
    b.floor(0, L);
    const side = o.side || (b.r() < 0.5 ? -1 : 1);
    const w = b.W / 2;
    const x0 = side > 0 ? w : -w - 4;
    const x1 = side > 0 ? w + 4 : -w;
    b.box([x0, -2, 0], [x1, h, L], { role: 'wall' });
    b.box([side > 0 ? w + 3 : -w - 4, h, 6], [side > 0 ? w + 4 : -w - 3, h + 6, 14], { role: 'wall' });
    b.box([x0, h, 5], [x1, h + 6, 6], { role: 'wall' });
    b.box([x0, h, 14], [x1, h + 6, 15], { role: 'wall' });
    b.sides(0, L, 0, null, side > 0 ? { noRight: true } : { noLeft: true });
    b.pickup(o.prize || 'shield', side * (w + 1.5), h, 10, { secret: true });
    b.secrets++;
    mark(b, 'loft', 0, L, { h });
    b.go(0, 0, L - 1);
    b.advance(L);
  },

  /** The boss's arena: a door shuts behind you, and the exit opens when it falls. */
  arena(b, o = {}) {
    buildArena(b, o.boss, o);
  },
};

/** Each boss's room: its size, its cover, and what the fight needs. */
function buildArena(b, boss, o) {
  const S = o.size || 40;
  const w = S / 2;
  const H = o.height || b.roof || 14;
  const entry = 6;
  b.floor(0, entry);
  b.sides(0, entry, 0, Math.min(H, b.roof || 9));
  const z0 = entry;
  const z1 = entry + S;
  b.floor(z0, z1, 0, { w: S, role: 'arena' });
  const id = b.doorId++;
  const exitId = b.doorId++;
  const wall = (x0, x1, y0, y1, za, zb) => b.box([x0, y0, za], [x1, y1, zb], { role: 'arenaWall' });
  // The walls, a doorway at each end.
  wall(-w - 1, -w, -2, H, z0, z1);
  wall(w, w + 1, -2, H, z0, z1);
  for (const [z, did, open] of [[z0, id, true], [z1 - 1, exitId, false]]) {
    wall(-w - 1, -2, -2, H, z, z + 1);
    wall(2, w + 1, -2, H, z, z + 1);
    wall(-2, 2, 3.4, H, z, z + 1);
    b.box([-2, 0, z + 0.1], [2, 3.4, z + 0.9], { role: 'door', door: { id: did, lift: 3.3, speed: 6, open, at: open ? 1 : 0 } });
  }
  if (b.roof || o.roofed) b.box([-w - 1, H, z0], [w + 1, H + 1, z1], { role: 'roof', noPortal: !o.roofPortal });
  // Past the exit, a last stretch to walk out on.
  b.floor(z1, z1 + 8);
  b.sides(z1, z1 + 8, 0, Math.min(H, b.roof || 9));
  const doorS = b.world.solids.find((s) => s.door && s.door.id === id);
  const exitS = b.world.solids.find((s) => s.door && s.door.id === exitId);
  const [tmin, tmax] = b.aabb([-w + 1, -1, z0 + 2.5], [w - 1, H, z1 - 2]);
  const [emin, emax] = b.aabb([-3, -1, z1 + 1], [3, 5, z1 + 7]);
  const centre = b.P(0, 0, z0 + S / 2);
  const A = {
    boss,
    min: b.aabb([-w, 0, z0], [w, H, z1])[0],
    max: b.aabb([-w, 0, z0], [w, H, z1])[1],
    floor: b.cur.p[1],
    roof: b.cur.p[1] + H,
    centre,
    trigger: { min: tmin, max: tmax },
    exit: { min: emin, max: emax },
    door: doorS,
    exitDoor: exitS,
    spawn: standAt(...b.P(0, 0, z0 + 4)),
    yaw: b.yaw,
  };
  // What each fight needs.
  const cover = (x, z, sx, sy, sz, role = 'plat') => b.box([x - sx / 2, 0, z - sz / 2], [x + sx / 2, sy, z + sz / 2], { role });
  if (boss === 'warden') {
    for (const [x, z] of [[-10, 12], [10, 12], [-10, 30], [10, 30]]) cover(x, z0 + z - 6, 2, 3, 2);
  } else if (boss === 'stag') {
    for (const [x, z] of [[-13, 14], [13, 26], [-6, 32]]) cover(x, z0 + z - 6, 3, 1.5, 3);
  } else if (boss === 'scheduler') {
    for (const [x, z] of [[-12, 10], [12, 18], [-12, 26], [12, 32]]) cover(x, z0 + z - 4, 1.2, 2.2, 5, 'trim');
  } else if (boss === 'forgewright') {
    for (const [x, z] of [[-14, 8], [14, 8], [-14, 34], [14, 34]]) cover(x, z0 + z - 4, 3, 1.2, 3);
  } else if (boss === 'interceptor') {
    // An island in the middle of the lap, to stand on as it goes round.
    cover(0, z0 + S / 2, 8, 1.2, 6);
    A.lap = [w - 5, w - 5];
  } else if (boss === 'broadcaster') {
    for (const [x, z, h] of [[-12, 12, 3], [12, 12, 5], [-12, 28, 5], [12, 28, 3]]) cover(x, z0 + z - 4, 4, h, 4);
    b.box([-0.6, 0, z0 + S / 2 - 0.6], [0.6, 8, z0 + S / 2 + 0.6], { role: 'trim', passCharges: false });
  } else if (boss === 'borer') {
    // Ledges along the side walls, out of its way as it crosses.
    b.box([-w, 0, z0 + 4], [-w + 3, 2.4, z1 - 4], { role: 'plat' });
    b.box([w - 3, 0, z0 + 4], [w, 2.4, z1 - 4], { role: 'plat' });
  } else if (boss === 'gantry') {
    // The crane: legs, a boom, and its cab, glazed in armoured glass; the core inside.
    const cz = z0 + S * 0.7;
    const cabY = 11;
    for (const x of [-w + 3, w - 3]) b.box([x - 1, 0, cz - 1], [x + 1, cabY + 3, cz + 1], { role: 'trim' });
    b.box([-w + 2, cabY + 3, cz - 1.2], [w - 2, cabY + 4.5, cz + 1.2], { role: 'trim' });
    const cx = 4;
    // The cab: a back wall (to hold an end), glass on its front and sides and floor, a roof.
    b.box([cx - 2.5, cabY - 2.5, cz + 1.5], [cx + 2.5, cabY + 2.5, cz + 2.2], { role: 'wall' });
    b.box([cx - 2.5, cabY - 2.5, cz - 2.2], [cx + 2.5, cabY + 2.5, cz - 2], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    b.box([cx - 2.7, cabY - 2.5, cz - 2.2], [cx - 2.5, cabY + 2.5, cz + 2.2], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    b.box([cx + 2.5, cabY - 2.5, cz - 2.2], [cx + 2.7, cabY + 2.5, cz + 2.2], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    b.box([cx - 2.7, cabY - 2.7, cz - 2.2], [cx + 2.7, cabY - 2.5, cz + 2.2], { glass: true, mat: 'glass', color: '#9fe8ff', role: 'glass' });
    b.box([cx - 2.7, cabY + 2.5, cz - 2.2], [cx + 2.7, cabY + 3, cz + 2.2], { role: 'trim' });
    A.cab = b.P(cx, cabY, cz - 0.2);
    A.swing = { c: b.P(-4, 5, z0 + S * 0.45), r: 9 };
    // Container stacks to climb and hide behind.
    for (const [x, z, h] of [[-12, 10, 2.6], [12, 12, 5.2], [-12, 26, 5.2], [-4, 16, 2.6]]) cover(x, z0 + z, 6, h, 2.5, 'crate0');
  } else if (boss === 'lookout') {
    for (const [x, z, h] of [[-12, 8, 2], [12, 10, 3], [-13, 30, 3], [13, 28, 2], [0, 34, 1.5]]) cover(x, z0 + z, 4, h, 4, 'rock');
    b.box([-0.9, 0, z0 + S / 2 - 0.9], [0.9, 4, z0 + S / 2 + 0.9], { role: 'trim' });
  } else if (boss === 'creator') {
    for (const [x, z] of [[-14, 8], [14, 8], [-15, 20], [15, 20], [-14, 32], [14, 32]]) cover(x, z0 + z, 2.2, 2.2, 1, 'shelf');
  }
  b.arena = A;
  mark(b, 'arena', 0, z1 + 8, { boss });
  b.go(0, 0, z0 + 4);
  b.step({ a: 'boss' });
  b.go(0, 0, z1 + 4);
  b.advance(z1 + 8);
}

export { JUMP, WORM, EYE };
