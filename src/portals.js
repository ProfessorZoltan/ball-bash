// Blaster's Wormhole Variant: every player's own pair of wormholes.
//
// A wormhole is an opening in a surface: a wall, an obstacle's side or a
// moving part. It is placed where the fighter's facing first meets one, lies
// along that surface, and is PORTAL.halfWidth either side of its centre, wide
// enough for the biggest frame. A pair is open once both ends are out; one
// end alone is only a mark on the wall.
//
// Each portal is { owner, which (0 light, 1 dark), key, host, cx, cy, nx, ny,
// hw }. (nx, ny) is its outward normal, pointing into the room; its tangent
// is that turned a quarter (-ny, nx). The host is { kind: 'wall', seg } or
// { kind: 'mover', mi, si, s, side }: a moving part's segment, the fraction
// along it and which face, so the portal rides with it. g.portals maps a
// player's slot to its pair [light, dark].
//
// Going through, a point at `d` behind one mouth comes out `d` in front of
// the other, turned by the angle between them: momentum is kept and its
// direction follows the turn (throughPortal). Pure, so the tests can drive it.
import { raycastSegments } from './physics.js';

export const PORTAL = {
  halfWidth: 48, // 96 px across: the biggest frame is 56
  grace: 0.35, // seconds a fighter that came out cannot go back in, so two mouths back to back cannot bounce it to and fro
  shotGrace: 0.05, // the same for a charge
  key: ['q', 'e'], // which key deploys each end (and LB / RB on a controller)
};

/** A portal's tangent, a quarter turn from its normal. */
export function tangent(p) {
  return { x: -p.ny, y: p.nx };
}

/** Where (x, y) sits relative to portal p: `u` along it from its centre, `v` out from its face (negative: behind the surface). */
export function portalLocal(p, x, y) {
  const dx = x - p.cx;
  const dy = y - p.cy;
  return { u: -dx * p.ny + dy * p.nx, v: dx * p.nx + dy * p.ny };
}

/**
 * Carry a point, a velocity and a facing from portal p through to q. What was
 * `d` behind p comes out `d` in front of q, mirrored across it so left stays
 * left, and every direction turns by the same angle.
 */
export function throughPortal(p, q, x, y, vx = 0, vy = 0, angle = 0) {
  const th = Math.atan2(q.ny, q.nx) - Math.atan2(p.ny, p.nx) - Math.PI;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const dx = x - p.cx;
  const dy = y - p.cy;
  return { x: q.cx + c * dx - s * dy, y: q.cy + s * dx + c * dy, vx: c * vx - s * vy, vy: s * vx + c * vy, angle: angle + th, turn: th };
}

/** The other end of `p`'s pair, when both are out; null otherwise. */
export function partner(g, p) {
  const pair = g.portals && g.portals[p.owner];
  if (!pair || pair[p.which] !== p) return null;
  return pair[1 - p.which] || null;
}

/** Every portal whose pair is complete: those are open. */
export function openPortals(g) {
  const out = [];
  if (!g.portals) return out;
  for (const pair of Object.values(g.portals)) if (pair && pair[0] && pair[1]) out.push(pair[0], pair[1]);
  return out;
}

/**
 * The open mouth a circle is in, if any: laterally within the opening (its
 * body at most half out either side) and touching or through the surface.
 * `ahead` widens the front by how far the circle is about to move, for a
 * charge whose mouth is found before it flies. Returns { p, q, u, v } for the
 * nearest such mouth, q being where it leads.
 */
export function mouthOf(g, x, y, r, ahead = 0) {
  let best = null;
  for (const p of openPortals(g)) {
    const { u, v } = portalLocal(p, x, y);
    if (Math.abs(u) > p.hw - r * 0.5 || v >= r + 2 + ahead || v <= -r - 2) continue;
    if (!best || Math.abs(v) < Math.abs(best.v)) best = { p, q: partner(g, p), u, v };
  }
  return best;
}

/** The stretch of s in [0, 1] where f0 + (f1 - f0) s <= max, as [lo, hi]; null if none. */
function whereAtMost(f0, f1, max) {
  if (Math.abs(f1 - f0) < 1e-12) return f0 <= max ? [0, 1] : null;
  const at = (max - f0) / (f1 - f0);
  const range = f1 > f0 ? [0, Math.min(1, at)] : [Math.max(0, at), 1];
  return range[0] <= range[1] ? range : null;
}

/**
 * What is left of segment sg, of half-thickness `thick`, once portal p's
 * mouth is cut out of it. Any part of it across the opening that is at or
 * behind the surface is open: the host's own stretch, the neighbours of a
 * curved one, and anything just behind a thin one (the room's wall close
 * behind a slab would otherwise stop a body halfway). What lies either side
 * of the opening stands, as its jambs, and so does everything in front of it.
 * Returns [sg] itself when nothing is cut, else the pieces that stand.
 */
export function carve(p, sg, thick = sg.thick || 0) {
  const a = portalLocal(p, sg.ax, sg.ay);
  const b = portalLocal(p, sg.bx, sg.by);
  let cut = [0, 1];
  for (const r of [whereAtMost(a.u, b.u, p.hw), whereAtMost(-a.u, -b.u, p.hw), whereAtMost(a.v + thick, b.v + thick, 0.5)]) {
    if (!r) return [sg];
    cut = [Math.max(cut[0], r[0]), Math.min(cut[1], r[1])];
    if (cut[0] >= cut[1]) return [sg];
  }
  const dx = sg.bx - sg.ax;
  const dy = sg.by - sg.ay;
  const len = Math.hypot(dx, dy);
  const out = [];
  if (cut[0] * len > 0.5) out.push({ ...sg, bx: sg.ax + dx * cut[0], by: sg.ay + dy * cut[0] });
  if ((1 - cut[1]) * len > 0.5) out.push({ ...sg, ax: sg.ax + dx * cut[1], ay: sg.ay + dy * cut[1] });
  return out;
}

/** `segs` with `hole`'s mouth cut out of every one (see carve); `segs` itself when there is no mouth. */
export function openedSegments(hole, segs, thick = null) {
  if (!hole) return segs;
  const out = [];
  for (const sg of segs) out.push(...carve(hole.p, sg, thick ?? (sg.thick || 0)));
  return out;
}

/** The segment a portal's host is now, with its half-thickness (a slab reaches `thick` either side of its line); null if the host has gone (a pane broken, a door opened). */
export function hostSegment(g, p) {
  const h = p.host;
  if (h.kind === 'wall') return g.walls.includes(h.seg) && !h.seg.broken ? { seg: h.seg, thick: h.seg.thick || 0 } : null;
  const m = g.movers[h.mi];
  if (!m || !m.segments) return null;
  const seg = m.segments()[h.si];
  return seg ? { seg, thick: m.thick || 0 } : null;
}

/** Bring a portal's frame up to date with its host (a moving part moves it). False if the host has gone. */
export function framePortal(g, p) {
  const hs = hostSegment(g, p);
  if (!hs) return false;
  if (p.host.kind === 'wall') return true; // a wall does not move
  const { seg, thick } = hs;
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * p.host.side;
  const ny = (dx / len) * p.host.side;
  p.nx = nx;
  p.ny = ny;
  p.cx = seg.ax + dx * p.host.s + nx * thick; // on the slab's face, where a body meets it
  p.cy = seg.ay + dy * p.host.s + ny * thick;
  return true;
}

/**
 * Aim `which` end of fighter f's pair: the first wall, obstacle side or moving
 * part straight ahead of it along its facing. The portal is centred where
 * the line meets the surface, moved along it where it can so the whole mouth
 * lies on it, and faces the fighter. Null if nothing is in line.
 */
export function aimPortal(g, f, which) {
  const dx = Math.cos(f.angle);
  const dy = Math.sin(f.angle);
  let best = null;
  const w = raycastSegments(f.x, f.y, dx, dy, g.walls.filter((s) => !s.broken));
  if (w) best = { t: w.t - (w.seg.thick || 0), hit: w, seg: w.seg, thick: w.seg.thick || 0 };
  g.movers.forEach((m, mi) => {
    if (!m.segments || m.kind === 'pulse' || m.kind === 'stone') return;
    m.segments().forEach((seg, si) => {
      const h = raycastSegments(f.x, f.y, dx, dy, [seg]);
      if (!h) return;
      const t = h.t - (m.thick || 0);
      if (!best || t < best.t) best = { t, hit: h, seg, thick: m.thick || 0, mi, si };
    });
  });
  if (!best) return null;
  const { seg, hit, thick } = best;
  const sx = seg.bx - seg.ax;
  const sy = seg.by - seg.ay;
  const len = Math.hypot(sx, sy) || 1;
  const hw = PORTAL.halfWidth;
  let s = ((hit.x - seg.ax) * sx + (hit.y - seg.ay) * sy) / (len * len);
  s = len >= 2 * hw ? Math.min(1 - hw / len, Math.max(hw / len, s)) : 0.5;
  const p = { owner: f.slot, which, key: `${f.slot}${which}`, hw, nx: hit.nx, ny: hit.ny, cx: 0, cy: 0, host: null };
  p.cx = seg.ax + sx * s + hit.nx * thick;
  p.cy = seg.ay + sy * s + hit.ny * thick;
  if (best.mi == null) p.host = { kind: 'wall', seg };
  else {
    const side = (hit.nx * -sy + hit.ny * sx) / len >= 0 ? 1 : -1; // which face of the part it looked at
    p.host = { kind: 'mover', mi: best.mi, si: best.si, s, side };
  }
  return p;
}

/**
 * A fighter at an open mouth. If its centre has just gone through the surface
 * (it was in front last time, is behind now, and is not in its grace) it comes
 * out of the partner: position, momentum and facing carried through. Returns
 * { mouth, warp }: the mouth it is in now, if any (the walls let it in there),
 * and the portals it went through, if it did.
 */
export function portalFighter(g, f) {
  let mouth = mouthOf(g, f.x, f.y, f.r);
  let warp = null;
  if (mouth && mouth.v < 0 && !(f.portalGrace > 0) && f.lastMouth === mouth.p.key) {
    const { p, q } = mouth;
    const o = throughPortal(p, q, f.x, f.y, f.vx, f.vy, f.angle);
    const prev = throughPortal(p, q, f.prevX, f.prevY);
    const from = { x: f.x, y: f.y };
    f.x = o.x;
    f.y = o.y;
    f.vx = o.vx;
    f.vy = o.vy;
    f.angle = Math.atan2(Math.sin(o.angle), Math.cos(o.angle));
    f.prevX = prev.x; // this step's motion, carried through, so its speed reads true
    f.prevY = prev.y;
    f.portalGrace = PORTAL.grace;
    f.warps = (f.warps || 0) + 1;
    warp = { p, q, from, to: { x: f.x, y: f.y } };
    mouth = mouthOf(g, f.x, f.y, f.r);
  } else if (mouth && mouth.v < 0) {
    // In its grace (or at a mouth it did not walk up to): it goes no further
    // in than halfway, and nothing ever leaves it stranded behind a surface.
    f.x -= mouth.p.nx * mouth.v;
    f.y -= mouth.p.ny * mouth.v;
    mouth = { ...mouth, v: 0 };
  }
  f.lastMouth = mouth && mouth.v >= 0 ? mouth.p.key : null;
  return { mouth, warp };
}

/** Note which mouth a fighter is in front of, as portalFighter would have (after the host's word replaced it). */
export function notePortalMouth(g, f) {
  const m = mouthOf(g, f.x, f.y, f.r);
  f.lastMouth = m && m.v >= 0 ? m.p.key : null;
}

/** A portal as a snapshot carries it: [0, cx, cy, nx, ny] on a wall, [1, mover, segment, s, side] on a moving part. */
export function encodePortal(p) {
  if (!p) return null;
  const r1 = (v) => Math.round(v * 10) / 10;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return p.host.kind === 'wall' ? [0, r1(p.cx), r1(p.cy), r4(p.nx), r4(p.ny)] : [1, p.host.mi, p.host.si, r4(p.host.s), p.host.side];
}

/** The inverse, on a guest: a wall portal finds its own copy of the wall segment it sits on. */
export function decodePortal(g, owner, which, a) {
  if (!Array.isArray(a)) return null;
  const p = { owner, which, key: `${owner}${which}`, hw: PORTAL.halfWidth, cx: 0, cy: 0, nx: 1, ny: 0, host: null };
  if (a[0] === 1) {
    p.host = { kind: 'mover', mi: a[1], si: a[2], s: a[3], side: a[4] };
    return framePortal(g, p) ? p : null;
  }
  [p.cx, p.cy, p.nx, p.ny] = [a[1], a[2], a[3], a[4]];
  let best = null;
  for (const s of g.walls) {
    const sx = s.bx - s.ax;
    const sy = s.by - s.ay;
    const len = Math.hypot(sx, sy) || 1;
    if (Math.abs((sx * p.nx + sy * p.ny) / len) > 0.05) continue; // not lying along the portal
    const t = Math.max(0, Math.min(1, ((p.cx - s.ax) * sx + (p.cy - s.ay) * sy) / (len * len)));
    const d = Math.hypot(s.ax + sx * t - p.cx, s.ay + sy * t - p.cy) - (s.thick || 0);
    if (d < 3 && (!best || d < best.d)) best = { s, d };
  }
  p.host = { kind: 'wall', seg: best ? best.s : { ax: p.cx, ay: p.cy, bx: p.cx, by: p.cy, broken: true } };
  return p;
}
