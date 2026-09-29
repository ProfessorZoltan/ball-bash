// Secrets that take finding. Each is a stretch of the way like any other
// (sections.js) with something off to the side of it: a crawlspace under a
// floor panel, a cache hung under a beam, a hollow in a gate you only see
// once you have gone through and turned round, a wall the grid never
// finished, three small targets that open a wall between them, and a way
// off the map, up through a skylight or onto a tower. A panel is cracked
// where it means to be found, or wears what it is set in (`hidden`), when
// only its sound gives it away: a shot on it knocks hollow, and near it
// there is a hum. Each writes the way to its prize as a detour (build.js),
// which the tests fly with the robot's own physics; the way through the
// level never takes it. DOM-free.
import { standAt } from './player.js';

function mark(b, type, z0, z1, extra = {}) {
  b.sections.push({ type, from: b.P(0, 0, z0), to: b.P(0, 0, z1), h: b.cur.h, ...extra });
}

const pickSide = (b, o) => o.side || (b.r() < 0.5 ? -1 : 1);
const pickPrize = (b, o) => o.prize || b.r.pick(['big', 'triple', 'strong', 'durable', 'freeze']);

/** A box given on one side of the way: x0 and x1 measured out from the middle toward `side`. */
function sbox(b, side, x0, x1, y0, y1, z0, z1, props) {
  const a = side * x0;
  const c = side * x1;
  return b.box([Math.min(a, c), y0, z0], [Math.max(a, c), y1, z1], props);
}

/** A secret's panel: cracked where it is meant to be seen, or wearing the look of what it is set in. */
function panel(b, min, max, look, o, extra = {}) {
  const hidden = !!o.hidden;
  return b.box(min, max, { role: hidden ? look : 'cover', ...(hidden ? {} : { mat: 'cracked' }), cover: true, secret: true, hp: hidden ? 2 : 4, noPortal: true, ...extra });
}

/** An open level's low barriers along a stretch the floor laid in pieces (or along one side only). */
function rails(b, z0, z1, only = null) {
  const R = b.def.rails;
  if (!R) return;
  const w = b.W / 2;
  for (const sd of only ? [only] : [-1, 1]) b.box([sd > 0 ? w : -w - R.w, 0, z0], [sd > 0 ? w + R.w : -w, R.h, z1], { role: R.role || 'trim', noPortal: true });
}

/** The floor across z0..z1 but for a square hole from x0 to x1. */
function stripAround(b, z0, z1, x0, x1) {
  const w = b.W / 2;
  if (x0 > -w + 0.01) b.floor(z0, z1, 0, { w: x0 + w, x: (x0 - w) / 2 });
  if (x1 < w - 0.01) b.floor(z0, z1, 0, { w: w - x1, x: (x1 + w) / 2 });
  rails(b, z0, z1);
}

/** Lamps down the middle of a roof built in pieces, as sides() hangs them. */
function lamps(b, z0, z1, H) {
  const lamp = b.def.lamp || '#e8f2ff';
  for (let z = z0 + 1.5; z + 1.6 < z1; z += 5) b.box([-0.35, H - 0.08, z], [0.35, H, z + 1.6], { mat: 'lamp', color: lamp, glow: 0.6, noPortal: true, passCharges: true });
}

export const SECRETS = {
  /**
   * A panel in the floor: shot through, it drops you into a crawlspace
   * under the way, a prize at its far end, and at the other end a hatch
   * over a spring that throws you back up.
   */
  crawl(b, o = {}) {
    const L = 20;
    const w = b.W / 2;
    const side = pickSide(b, o);
    const px = side * (w - 1.7);
    b.floor(0, 5);
    stripAround(b, 5, 7.4, px - 1.2, px + 1.2);
    b.floor(7.4, 14);
    stripAround(b, 14, 16.4, px - 1.2, px + 1.2);
    b.floor(16.4, L);
    const entry = panel(b, [px - 1.2, -0.4, 5], [px + 1.2, 0, 7.4], 'floor', o);
    // The way out looks like floor from above, and like a hatch from below.
    const hatch = b.box([px - 1.2, -0.4, 14], [px + 1.2, 0, 16.4], { role: 'floor', cover: true, hp: 2, noPortal: true });
    // The crawlspace, under the slabs.
    b.box([px - 1.6, -5.6, 4.6], [px + 1.6, -4.6, 17.4], { role: 'floor' });
    b.box([px - 2.2, -5.6, 4], [px - 1.6, -2, 18], { role: 'wall' });
    b.box([px + 1.6, -5.6, 4], [px + 2.2, -2, 18], { role: 'wall' });
    b.box([px - 1.6, -5.6, 4], [px + 1.6, -2, 4.6], { role: 'wall' });
    b.box([px - 1.6, -5.6, 17.4], [px + 1.6, -2, 18], { role: 'wall' });
    b.box([px - 0.3, -2.1, 9], [px + 0.3, -2, 12], { mat: 'lamp', color: b.def.accent || '#9dff5c', glow: 0.6, noPortal: true, passCharges: true });
    b.box([px - 0.8, -4.6, 14.4], [px + 0.8, -4.25, 16], { role: 'spring', spring: Math.sqrt(2 * 20 * (4.25 + 1.6)) });
    b.pickup(pickPrize(b, o), px, -4.6, 10.5, { secret: true });
    b.secrets++;
    b.sides(0, L);
    b.dress(0, L);
    mark(b, 'crawl', 0, L, { side, cover: entry.id });
    b.go(0, 0, L - 1);
    b.detour('crawl', 0, 0, 2, () => {
      b.step({ a: 'break', solid: entry.id, from: standAt(...b.P(px, 0, 2.4)), at: b.P(px, -0.2, 6.2) });
      b.go(px, -4.6, 7.5);
      b.step({ a: 'take', near: b.P(px, -3.7, 10.5) });
      b.step({ a: 'break', solid: hatch.id, from: standAt(...b.P(px, -4.6, 13.8)), at: b.P(px, -0.2, 15.6) });
      b.step({ a: 'spring', pad: standAt(...b.P(px, -4.25, 15.2)), to: standAt(...b.P(px, 0, 18.6)) });
    });
    b.advance(L);
  },

  /** A beam across the way, and hung under it something that sounds hollow: shot open, a prize falls out. */
  cache(b, o = {}) {
    const L = 14;
    const w = b.W / 2;
    const hb = b.roof ? Math.min(5.2, b.roof - 1.2) : 5.2;
    const z = 8;
    b.floor(0, L);
    b.sides(0, L);
    b.box([-w, hb, z - 0.6], [w, hb + 0.8, z + 0.6], { role: 'trim' });
    if (!b.roof) for (const sd of [-1, 1]) sbox(b, sd, w, w + 0.6, -2, hb + 0.8, z - 0.6, z + 0.6, { role: 'trim' });
    const cx = o.x ?? (b.r() < 0.5 ? -1 : 1) * (w - 1.6);
    const box = panel(b, [cx - 0.8, hb - 0.6, z - 0.5], [cx + 0.8, hb, z + 0.5], 'trim', o, { drop: pickPrize(b, o) });
    b.secrets++;
    b.dress(0, L);
    mark(b, 'cache', 0, L, { cover: box.id });
    b.go(0, 0, L - 1);
    b.detour('cache', 0, 0, 2, () => {
      b.step({ a: 'break', solid: box.id, from: standAt(...b.P(cx * 0.5, 0, 4)), at: b.P(cx, hb - 0.3, z) });
      b.step({ a: 'take', near: b.P(cx, 2, z) });
    });
    b.advance(L);
  },

  /**
   * A gate across the way, a doorway through the middle; in the block on
   * one side, a hollow whose panel faces the way on, so it is only seen by
   * turning round once through.
   */
  lookback(b, o = {}) {
    const L = 16;
    const w = b.W / 2;
    const side = pickSide(b, o);
    const hg = b.roof || 5;
    const g0 = 7;
    const g1 = 10;
    b.floor(0, L);
    b.sides(0, L);
    sbox(b, -side, 1.5, w, 0, hg, g0, g1, { role: 'wall' });
    b.box([-1.5, 3.4, g0], [1.5, hg, g1], { role: 'wall' });
    // The block with the hollow in it: round the hollow (2 to 3.7 out, 2.6 high, open to the far face).
    sbox(b, side, 1.5, 2, 0, hg, g0, g1, { role: 'wall' });
    sbox(b, side, 3.7, w, 0, hg, g0, g1, { role: 'wall' });
    sbox(b, side, 2, 3.7, 0, hg, g0, g0 + 0.4, { role: 'wall' });
    sbox(b, side, 2, 3.7, 2.6, hg, g0 + 0.4, g1, { role: 'wall' });
    const a = side * 2;
    const c = side * 3.7;
    const cov = panel(b, [Math.min(a, c), 0, g1 - 0.3], [Math.max(a, c), 2.6, g1], 'wall', o);
    const hx = side * 2.85;
    b.pickup(pickPrize(b, o), hx, 0, g0 + 1.4, { secret: true });
    b.secrets++;
    b.dress(0, L);
    mark(b, 'lookback', 0, L, { side, cover: cov.id });
    b.go(0, 0, L - 1);
    b.detour('lookback', 0, 0, 12.5, () => {
      b.step({ a: 'break', solid: cov.id, from: standAt(...b.P(hx, 0, 13.5)), at: b.P(hx, 1.3, g1 - 0.15) });
      b.go(hx, 0, g0 + 1.2);
      b.step({ a: 'take', near: b.P(hx, 0.9, g0 + 1.4) });
    });
    b.advance(L);
  },

  /**
   * A wall the grid never finished (the first levels only): a stretch of it
   * is nothing at all, and every few seconds it flickers. Walk through, and
   * there is a room behind it.
   */
  glitch(b, o = {}) {
    const L = 16;
    const w = b.W / 2;
    const side = pickSide(b, o);
    const hs = b.roof || 4;
    // No barrier on the wall's side: the wall is one, and the way into the room is through it.
    b.floor(0, L, 0, { noRails: true });
    rails(b, 0, L, -side);
    b.sides(0, L, 0, null, side > 0 ? { noRight: true } : { noLeft: true });
    sbox(b, side, w, w + 0.5, -2, hs, 0, 6.5, { role: 'wall' });
    sbox(b, side, w, w + 0.5, -2, hs, 9.5, L, { role: 'wall' });
    sbox(b, side, w, w + 0.5, 3, hs, 6.5, 9.5, { role: 'wall' });
    const ghost = sbox(b, side, w, w + 0.5, 0, 3, 6.5, 9.5, { role: 'wall', ghost: true, passCharges: true, noPortal: true, glitch: { period: 3.5 + b.r(), phase: b.r() * 4, show: 0.22 } });
    // The room behind.
    sbox(b, side, w + 0.5, w + 6, -2, 0, 5, 11, { role: 'floor' });
    sbox(b, side, w + 6, w + 6.5, -2, 3.4, 4.5, 11.5, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 6, -2, 3.4, 4.5, 5, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 6, -2, 3.4, 11, 11.5, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 6.5, 3.4, 3.9, 4.5, 11.5, { role: 'roof' });
    const rx = side * (w + 3.5);
    b.pickup(pickPrize(b, o), rx, 0, 8, { secret: true });
    b.secrets++;
    b.dress(0, L);
    mark(b, 'glitch', 0, L, { side, ghost: ghost.id });
    b.go(0, 0, L - 1);
    b.detour('glitch', 0, 0, 3, () => {
      b.go(side * (w - 1), 0, 8);
      b.go(rx, 0, 8);
      b.step({ a: 'take', near: b.P(rx, 0.9, 8) });
    });
    b.advance(L);
  },

  /**
   * Three small targets about a hall: one high on the far wall, one on the
   * back of a beam you have walked under, one low under a shelf. Hit all
   * three and a stretch of wall slides up on a room.
   */
  targets(b, o = {}) {
    const L = 22;
    const w = b.W / 2;
    const side = pickSide(b, o);
    const hw = b.roof || 5.2;
    b.floor(0, L, 0, { noRails: true }); // walls both sides, and a door in one
    if (b.roof) b.sides(0, L, 0, null, side > 0 ? { noRight: true } : { noLeft: true });
    else sbox(b, -side, w, w + 0.5, -2, hw, 0, L, { role: 'wall' });
    sbox(b, side, w, w + 0.5, -2, hw, 0, 13, { role: 'wall' });
    sbox(b, side, w, w + 0.5, -2, hw, 16, L, { role: 'wall' });
    sbox(b, side, w, w + 0.5, 3.4, hw, 13, 16, { role: 'wall' });
    const id = b.doorId++;
    sbox(b, side, w, w + 0.5, 0, 3.4, 13.05, 15.95, { role: 'wall', door: { id, lift: 3.3, speed: 4, open: false, at: 0 } });
    // The room.
    sbox(b, side, w + 0.5, w + 5.5, -2, 0, 12, 17, { role: 'floor' });
    sbox(b, side, w + 5.5, w + 6, -2, 3.8, 11.5, 17.5, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 5.5, -2, 3.8, 11.5, 12, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 5.5, -2, 3.8, 17, 17.5, { role: 'wall' });
    sbox(b, side, w + 0.5, w + 6, 3.8, 4.3, 11.5, 17.5, { role: 'roof' });
    // The beam over the way in, and the shelf.
    b.box([-w, 3.8, 0.4], [w, 4.4, 1], { role: 'trim' });
    sbox(b, side, w - 1.2, w, 0.9, 1.1, 8, 10, { role: 'trim' });
    const target = (sd, x0, x1, y0, y1, z0, z1) => {
      const sw = { id: b.doorId++, p: null, doors: [id], timer: 0, on: false, group: id };
      const s = sbox(b, sd, x0, x1, y0, y1, z0, z1, { role: 'switch', switchRef: sw, dynamic: true, noPortal: true });
      sw.p = [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
      sw.solid = s;
      b.world.switches.push(sw);
      return sw;
    };
    const high = target(-side, w - 0.15, w, 4.3, 4.7, 5.8, 6.2);
    const back = target(-side, 2.2, 2.6, 3.9, 4.3, 1, 1.2);
    const low = target(side, w - 0.2, w, 0.15, 0.55, 8.8, 9.2);
    const rx = side * (w + 3);
    b.pickup(pickPrize(b, o), rx, 0, 14.5, { secret: true });
    b.secrets++;
    b.dress(0, L);
    mark(b, 'targets', 0, L, { side, door: id, targets: [high.id, back.id, low.id] });
    b.go(0, 0, L - 1);
    b.detour('targets', 0, 0, 2, () => {
      b.step({ a: 'shoot', sw: high.id, from: standAt(...b.P(side * 1.5, 0, 3)), at: high.p });
      b.step({ a: 'shoot', sw: back.id, from: standAt(...b.P(0, 0, 6)), at: back.p });
      b.step({ a: 'shoot', sw: low.id, from: standAt(...b.P(-side * 2, 0, 9)), at: low.p });
      b.go(side * (w - 1), 0, 14.5);
      b.go(rx, 0, 14.5);
      b.step({ a: 'take', near: b.P(rx, 0.9, 14.5) });
    });
    b.advance(L);
  },

  /**
   * Off the map. Under a roof: a spring pad under a solid ceiling, which is
   * the clue; shoot the skylight over it open and the spring throws you out
   * onto the roof, a prize further along it, and back down the way you came.
   * In the open: a tower beside the way, a crate at its foot, and under the
   * crate a spring onto its top.
   */
  rooftop(b, o = {}) {
    const w = b.W / 2;
    const side = pickSide(b, o);
    if (b.roof) {
      const L = 18;
      const H = b.roof;
      const hx0 = side > 0 ? w - 3.2 : -w;
      const hx1 = side > 0 ? w : -w + 3.2;
      const hc = (hx0 + hx1) / 2;
      const pc = side * (w - 1.3);
      b.floor(0, L);
      b.sides(0, L, 0, null, { noRoof: true });
      b.wallDress(0, L, 0);
      b.box([-w - 1, H, 0], [w + 1, H + 1, 6.4], { role: 'roof' });
      b.box([-w - 1, H, 9.6], [w + 1, H + 1, L], { role: 'roof' });
      b.box([-w - 1, H, 6.4], [hx0, H + 1, 9.6], { role: 'roof' });
      b.box([hx1, H, 6.4], [w + 1, H + 1, 9.6], { role: 'roof' });
      lamps(b, 0, 6.4, H);
      lamps(b, 9.6, L, H);
      const sky = panel(b, [hx0, H, 6.4], [hx1, H + 1, 9.6], 'roof', o);
      b.box([pc - 0.8, 0, 7.2], [pc + 0.8, 0.35, 8.8], { role: 'spring', spring: Math.sqrt(2 * 20 * (H + 1 - 0.35 + 1.6)) });
      b.pickup(pickPrize(b, o), 0, H + 1, 15, { secret: true });
      b.secrets++;
      mark(b, 'rooftop', 0, L, { side, cover: sky.id });
      b.go(0, 0, L - 1);
      b.detour('rooftop', 0, 0, 2, () => {
        b.step({ a: 'break', solid: sky.id, from: standAt(...b.P(0, 0, 4)), at: b.P(hc, H + 0.1, 8) });
        b.step({ a: 'spring', pad: standAt(...b.P(pc, 0.35, 8)), to: standAt(...b.P(pc, H + 1, 11.4)) });
        b.step({ a: 'take', near: b.P(0, H + 1.9, 15) });
        b.go(pc, H + 1, 11);
        b.step({ a: 'drop', to: standAt(...b.P(side * (w - 2.7), 0, 8)) });
      });
      b.advance(L);
      return;
    }
    const L = 20;
    const ht = o.h || 6.5;
    const pc = side * (w - 1.2);
    const tx = side * (w + 2.4);
    b.floor(0, L);
    sbox(b, side, w + 0.4, w + 4.4, -2, ht, 2, L - 2, { role: 'wall' });
    b.box([pc - 0.8, 0, 3.2], [pc + 0.8, 0.35, 4.8], { role: 'spring', spring: Math.sqrt(2 * 20 * (ht - 0.35 + 1.6)) });
    const crate = b.box([pc - 0.7, 0.35, 3.3], [pc + 0.7, 1.75, 4.7], { role: 'crate0', crate: true, hp: 3 });
    b.pickup(pickPrize(b, o), tx, ht, L - 4, { secret: true });
    b.secrets++;
    b.dress(0, L);
    mark(b, 'rooftop', 0, L, { side, crate: crate.id });
    b.go(0, 0, L - 1);
    b.detour('rooftop', 0, 0, 1, () => {
      b.step({ a: 'break', solid: crate.id, from: standAt(...b.P(0, 0, 0.6)), at: b.P(pc, 1.05, 4) });
      b.step({ a: 'spring', pad: standAt(...b.P(pc, 0.35, 4)), to: standAt(...b.P(tx, ht, 7)) });
      b.step({ a: 'take', near: b.P(tx, ht + 0.9, L - 4) });
      b.step({ a: 'drop', to: standAt(...b.P(side * (w - 1.5), 0, L - 3)) });
    });
    b.advance(L);
  },
};
