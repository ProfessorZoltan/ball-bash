// Snapshots of the host's game state for the guest to mirror, and the
// inverse. Everything is rounded to keep the JSON small; positions to 0.1 px.
import { rebuildWalls } from './gamestate.js';
import { wrapAngle } from './vec.js';

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function fighterState(f) {
  return [r1(f.x), r1(f.y), r3(f.angle), r1(f.paddleOffset), r1(f.frozen), f.lungeState === 'out' ? 1 : 0, r1(f.hitFlash), r1(f.invuln), r1(f.campTimer), f.down ? 1 : 0, f.glow ? 1 : 0, f.phased ? 1 : 0, f.charged ? 1 : 0, r1(f.chargeAt)];
}

export function applyFighter(f, a) {
  f.x = a[0];
  f.y = a[1];
  f.angle = a[2];
  f.paddleOffset = a[3];
  f.frozen = a[4];
  f.lungeState = a[5] ? 'out' : 'idle';
  f.hitFlash = a[6];
  f.invuln = a[7];
  f.campTimer = a[8] || 0;
  f.down = !!a[9];
  f.glow = !!a[10];
  f.phased = !!a[11];
  f.charged = !!a[12];
  f.chargeAt = a[13] || 0;
}

export function moverState(m) {
  return m.kind === 'piston' ? r3(m.t) : r3(m.angle);
}

export function applyMover(m, v) {
  if (m.kind === 'piston') m.t = v;
  else m.angle = v;
}

/**
 * meta: { st, cd, sc, rd, hs, w } (state, countdown, scores, round, host
 * slot, last winner). `includeIce` sends the ice trail (send it at a lower
 * rate than the rest, it is the bulkiest part).
 */
export function buildSnapshot(g, meta, events = [], includeIce = true) {
  const b = g.ball;
  const s = {
    t: 's',
    ...meta,
    time: r3(g.time || 0), // to the millisecond: a guest interpolates between two of these
    ball: [r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.held ? 1 : 0],
    f: g.fighters.map(fighterState),
    mv: g.movers.map(moverState),
  };
  if (g.panes.length) s.pn = g.panes.map((p) => (p.broken ? r1(p.regrowAt) : -1));
  if (g.nodes && g.nodes.length) s.nd = g.nodes.map((n) => (n.lit ? 1 : 0));
  if (g.doors && g.doors.length) s.dr = g.doors.map((d) => (d.closed ? 1 : 0));
  const pulsers = (g.drones || []).filter((d) => d.pulser).map((d) => d.pulser).concat((g.emitters || []).map((e) => e.pulser));
  if (pulsers.length) s.pu = pulsers.map((p) => [r1(p.t), r1(p.nextAt), p.active ? 1 : 0, r1(p.radius || 0), r1(p.x), r1(p.y)]);
  if (g.turrets && g.turrets.length) s.tu = g.turrets.map((t) => [t.down ? 1 : 0, r3(t.aim)]);
  if ((g.turrets && g.turrets.length) || g.volley) {
    s.pj = g.shots.map((p) => [r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.deflected ? 1 : 0, p.owner || '', r1(p.r)]);
  }
  if (includeIce && g.ice) s.ice = { u: r1(g.ice.layUntil), o: g.ice.owner, p: g.ice.points.map((p) => [r1(p.x), r1(p.y), r1(p.t)]), q: g.ice.patches.map((p) => [r1(p.x), r1(p.y), p.r, r1(p.t)]) };
  if (events.length) s.ev = events;
  return s;
}

/**
 * The two buffered snapshots either side of host time `t`, and how far
 * between them it falls. `buffer` is [{ time, s }] in arrival order. Null
 * when `t` is not bracketed: before the first, or past the newest.
 */
export function bracket(buffer, t) {
  for (let i = buffer.length - 1; i >= 1; i--) {
    const a = buffer[i - 1];
    const b = buffer[i];
    if (a.time <= t && t <= b.time) {
      const span = b.time - a.time;
      return { a, b, u: span > 1e-6 ? (t - a.time) / span : 1 };
    }
  }
  return null;
}

/**
 * Set the view of a mirror to a point `u` of the way from snapshot `a` to
 * snapshot `b`: the ball, every fighter but `skipSlot` (the guest's own,
 * which it predicts), the moving parts and the charges. Everything that is
 * not a position (shields, state, who is down) comes from the newest
 * snapshot through applySnapshot; this only decides where things are drawn.
 */
export function lerpView(g, a, b, u, skipSlot = null) {
  const sa = a.s;
  const sb = b.s;
  const L = (x, y) => x + (y - x) * u;
  const ball = g.ball;
  ball.x = L(sa.ball[0], sb.ball[0]);
  ball.y = L(sa.ball[1], sb.ball[1]);
  for (let i = 0; i < g.fighters.length && i < sa.f.length && i < sb.f.length; i++) {
    const f = g.fighters[i];
    if (f.slot === skipSlot) continue;
    const fa = sa.f[i];
    const fb = sb.f[i];
    f.x = L(fa[0], fb[0]);
    f.y = L(fa[1], fb[1]);
    f.angle = fa[2] + wrapAngle(fb[2] - fa[2]) * u;
    f.paddleOffset = L(fa[3], fb[3]);
  }
  for (let i = 0; i < g.movers.length && i < sa.mv.length && i < sb.mv.length; i++) {
    const m = g.movers[i];
    if (m.kind === 'piston') m.t = L(sa.mv[i], sb.mv[i]);
    else if (m.kind !== 'stone') m.angle = sa.mv[i] + wrapAngle(sb.mv[i] - sa.mv[i]) * u;
  }
  if (sa.pj && sb.pj && sa.pj.length === sb.pj.length && g.shots.length === sb.pj.length) {
    for (let i = 0; i < g.shots.length; i++) {
      g.shots[i].x = L(sa.pj[i][0], sb.pj[i][0]);
      g.shots[i].y = L(sa.pj[i][1], sb.pj[i][1]);
    }
  }
}

/** Apply a snapshot to a mirror game state. Returns true if glass changed. */
export function applySnapshot(g, s) {
  const b = g.ball;
  b.x = s.ball[0];
  b.y = s.ball[1];
  b.vx = s.ball[2];
  b.vy = s.ball[3];
  b.held = !!s.ball[4];
  for (let i = 0; i < g.fighters.length && i < s.f.length; i++) applyFighter(g.fighters[i], s.f[i]);
  for (let i = 0; i < s.mv.length && i < g.movers.length; i++) applyMover(g.movers[i], s.mv[i]);
  let glassChanged = false;
  if (s.pn) {
    for (let i = 0; i < s.pn.length && i < g.panes.length; i++) {
      const pane = g.panes[i];
      const broken = s.pn[i] >= 0;
      if (pane.broken !== broken) {
        pane.broken = broken;
        for (const sg of pane.segs) sg.broken = broken;
        glassChanged = true;
      }
      pane.regrowAt = broken ? s.pn[i] : 0;
    }
    if (glassChanged) rebuildWalls(g);
  }
  if (s.nd && g.nodes) for (let i = 0; i < s.nd.length && i < g.nodes.length; i++) g.nodes[i].lit = !!s.nd[i];
  if (s.dr && g.doors) {
    let changed = false;
    for (let i = 0; i < s.dr.length && i < g.doors.length; i++) {
      const closed = !!s.dr[i];
      if (g.doors[i].closed !== closed) {
        g.doors[i].closed = closed;
        changed = true;
      }
    }
    if (changed) {
      rebuildWalls(g);
      glassChanged = true;
    }
  }
  if (s.pu) {
    const pulsers = (g.drones || []).filter((d) => d.pulser).map((d) => d.pulser).concat((g.emitters || []).map((e) => e.pulser));
    for (let i = 0; i < s.pu.length && i < pulsers.length; i++) {
      const p = pulsers[i];
      [p.t, p.nextAt] = [s.pu[i][0], s.pu[i][1]];
      p.active = !!s.pu[i][2];
      p.radius = s.pu[i][3];
      p.x = s.pu[i][4];
      p.y = s.pu[i][5];
    }
  }
  if (s.tu && g.turrets) {
    for (let i = 0; i < s.tu.length && i < g.turrets.length; i++) {
      g.turrets[i].down = !!s.tu[i][0];
      g.turrets[i].aim = s.tu[i][1];
    }
  }
  if (s.pj) g.shots = s.pj.map(([x, y, vx, vy, d, owner, r]) => ({ x, y, vx, vy, r: r || 8, deflected: !!d, owner: owner || null }));
  if (s.ice && g.ice) {
    g.ice.layUntil = s.ice.u;
    g.ice.owner = s.ice.o ?? null;
    g.ice.points = s.ice.p.map(([x, y, t]) => ({ x, y, t }));
    g.ice.patches = (s.ice.q || []).map(([x, y, r, t]) => ({ x, y, r, t }));
  }
  g.time = s.time;
  return glassChanged;
}
