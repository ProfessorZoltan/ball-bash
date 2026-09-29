// Rooms instead of corridors: stretches where the way opens out wider than
// itself, with things in them to go round, over and between, machines spread
// through them, and a way out that is never straight ahead. A pillared hall,
// a yard of crates, a gallery with a balcony the way leaves by. Each writes
// its route round what is in it, and moves the way on from its door, off to
// one side (or up). A room draws on its own random numbers (levels.js).
// DOM-free.

function mark(b, type, z0, z1, extra = {}) {
  b.sections.push({ type, from: b.P(0, 0, z0), to: b.P(0, 0, z1), h: b.cur.h, ...extra });
}

const pickSide = (b, o) => o.side || (b.r() < 0.5 ? -1 : 1);

/**
 * A room's shell: a floor S wide and D deep; in an enclosed level walls, a
 * roof `lift` higher than the halls' and a lintel over each doorway down to
 * theirs; in an open one a parapet round it. The doorway in is at z = 0 in
 * the middle; the way out at z = D, centred on xo, dy up.
 */
function shell(b, S, D, xo, dy = 0, lift = 2) {
  const w = b.W / 2;
  const h = S / 2;
  // A wall beside a doorway flush with the room's side has no width: leave it out.
  const piece = (a, c, props) => {
    if (c[0] - a[0] > 1e-6) b.box(a, c, props);
  };
  b.floor(0, D, 0, { w: S, noRails: true });
  if (b.roof) {
    const H = b.roof + Math.max(lift, dy + 2);
    b.box([-h - 1, -2, 0], [-h, H, D], { role: 'wall' });
    b.box([h, -2, 0], [h + 1, H, D], { role: 'wall' });
    b.box([-h - 1, H, -0.5], [h + 1, H + 1, D + 0.5], { role: 'roof' });
    b.box([-h, -2, -0.5], [-w, H, 0], { role: 'wall' });
    b.box([w, -2, -0.5], [h, H, 0], { role: 'wall' });
    b.box([-w, b.roof, -0.5], [w, H, 0], { role: 'wall' });
    piece([-h, -2, D], [xo - w, H, D + 0.5], { role: 'wall' });
    piece([xo + w, -2, D], [h, H, D + 0.5], { role: 'wall' });
    if (dy + b.roof < H) b.box([xo - w, dy + b.roof, D], [xo + w, H, D + 0.5], { role: 'wall' });
    // A way out that leaves high has wall under it, up to its floor.
    if (dy) b.box([xo - w, -2, D], [xo + w, dy, D + 0.5], { role: 'wall' });
    const lamp = b.def.lamp || '#e8f2ff';
    for (const x of [-h / 2, h / 2]) for (let z = 3; z + 1.6 < D; z += 6) b.box([x - 0.35, H - 0.08, z], [x + 0.35, H, z + 1.6], { mat: 'lamp', color: lamp, glow: 0.6, noPortal: true, passCharges: true });
    return H;
  }
  // Open: a parapet round the edge, gaps at the doorways.
  const P = { role: 'trim', noPortal: true };
  const ph = 1.1;
  b.box([-h - 0.4, 0, 0], [-h, ph, D], P);
  b.box([h, 0, 0], [h + 0.4, ph, D], P);
  b.box([-h - 0.4, 0, -0.4], [-w, ph, 0], P);
  b.box([w, 0, -0.4], [h + 0.4, ph, 0], P);
  if (!dy) {
    piece([-h - 0.4, 0, D], [xo - w, ph, D + 0.4], P);
    piece([xo + w, 0, D], [h + 0.4, ph, D + 0.4], P);
  } else b.box([-h - 0.4, 0, D], [h + 0.4, ph, D + 0.4], P);
  return 0;
}

/** Scenery round a room, set out past its walls rather than the way's. */
function dressRoom(b, S, D) {
  const W = b.W;
  b.W = S;
  b.dress(0, D);
  b.W = W;
}

/** Machines spread through a room, over the floor and in the air, `n` of them. */
function spread(b, n, spots) {
  for (let i = 0; i < n && i < spots.length; i++) {
    const [x, z, air] = spots[i];
    if (air) b.guard('air', x, 3 + b.r() * 1.5, z, { to: [-x, 3.5, z + 3] });
    else b.guard('ground', x, 0.7, z, { to: [x + (x < 0 ? 4 : -4), 0.7, z] });
  }
}

/** Move the way on from a room's door: off to one side, and up if it leaves high. */
function leave(b, xo, dy, D) {
  b.cur.p = b.P(xo, dy, D);
}

export const ROOMS = {
  /**
   * A hall of pillars, two rows of three down its length and a low dais
   * between them; the way out is in the far corner, and the machines keep to
   * the aisles and the air.
   */
  hall(b, o = {}) {
    const S = 22;
    const D = 24;
    const side = pickSide(b, o);
    const xo = side * (S / 2 - b.W / 2 - 1);
    const H = shell(b, S, D, xo);
    for (const x of [-5, 5]) for (const z of [6, 12, 18]) b.box([x - 1, 0, z - 1], [x + 1, H || 6, z + 1], { role: 'wall' });
    b.box([-3, 0, 10], [3, 0.4, 14], { role: 'plat', floorish: true });
    spread(b, o.foes ?? 3, [[-side * 8, 12], [side * 8, 9], [0, 16, true], [-side * 2.5, 20], [side * 2.5, 6, true]]);
    dressRoom(b, S, D);
    mark(b, 'hall', 0, D, { side, xo });
    b.go(0, 0, 3);
    b.go(side * 2.5, 0, 8);
    b.go(side * 2.5, 0, 21);
    b.go(xo, 0, D - 0.8);
    leave(b, xo, 0, D);
  },

  /**
   * A yard of crates, stacked in ones and twos to fight from and shoot
   * apart, a container along one side to climb onto, and a clear lane
   * through the middle to the far corner.
   */
  yard(b, o = {}) {
    const S = 24;
    const D = 22;
    const side = pickSide(b, o);
    const xo = side * (S / 2 - b.W / 2 - 1);
    shell(b, S, D, xo, 0, 1.5);
    // The container, on the side away from the way out.
    b.box([-side * 10.5, 0, 6], [-side * 7.5, 2.6, 16], { role: 'crate0', mat: 'container' });
    // Crates, clear of the lane (|x| under 2.5) and of the doorways.
    for (let i = 0; i < 9; i++) {
      const sx = b.r() < 0.5 ? -1 : 1;
      const x = sx * (3.5 + b.r() * 3.5);
      const z = 4 + b.r() * (D - 9);
      if (sx === -side && Math.abs(x) > 6.8 && z > 5 && z < 17) continue;
      const tall = b.r() < 0.35;
      b.box([x - 0.7, 0, z - 0.7], [x + 0.7, 1.4, z + 0.7], { role: 'crate0', crate: true, hp: 3 });
      if (tall) b.box([x - 0.6, 1.4, z - 0.6], [x + 0.6, 2.6, z + 0.6], { role: 'crate0', crate: true, hp: 3 });
    }
    spread(b, o.foes ?? 3, [[side * 6, 8], [-side * 5, 14], [0, 12, true], [side * 5, 17], [-side * 9, 11, true]]);
    dressRoom(b, S, D);
    mark(b, 'yard', 0, D, { side, xo });
    b.go(0, 0, 3);
    b.go(0, 0, D - 3);
    b.go(xo, 0, D - 0.8);
    leave(b, xo, 0, D);
  },

  /**
   * A gallery: a balcony 3.5 m up along one wall, a ramp up to it at the
   * near end, and the way out from the balcony at the far end; the floor
   * below goes on under it, and the machines hold both.
   */
  gallery(b, o = {}) {
    const S = 20;
    const D = 26;
    const side = pickSide(b, o);
    const up = 3.5;
    const h = S / 2;
    const xo = side * (h - b.W / 2);
    const b0 = side * (h - 6);
    const b1 = side * h;
    shell(b, S, D, xo, up, up + 2.5);
    // The ramp along the wall, and the balcony from its top to the far end.
    b.ramp([Math.min(b0, b1), 0, 2], [Math.max(b0, b1), up, 10], 'z', 1, { role: 'ramp' });
    b.box([Math.min(b0, b1), up - 0.5, 10], [Math.max(b0, b1), up, D], { role: 'plat' });
    // Its edge: a rail, so a machine below is shot over it, not walked off onto.
    const e = side * (h - 6);
    b.box([Math.min(e, e - side * 0.3), up, 12], [Math.max(e, e - side * 0.3), up + 0.9, D - 1], { role: 'trim', noPortal: true });
    if (!b.roof) {
      // Out in the open, the balcony's own parapet at the far end, round the way out.
      b.box([Math.min(b0, xo - side * b.W / 2), up, D], [Math.max(b0, xo - side * b.W / 2), up + 1.1, D + 0.4], { role: 'trim', noPortal: true });
    }
    spread(b, o.foes ?? 3, [[-side * 4, 10], [-side * 2, 18], [side * 7, 16], [0, 22, true], [-side * 6, 6, true]]);
    dressRoom(b, S, D);
    mark(b, 'gallery', 0, D, { side, xo, up });
    const bx = side * (h - 3);
    b.go(0, 0, 1.5);
    b.go(bx, 0, 1.5);
    b.go(bx, up, 11);
    b.go(xo, up, D - 0.8);
    leave(b, xo, up, D);
  },
};
