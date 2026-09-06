// Snapshots of the host's game state for the guest to mirror, and the
// inverse. Everything is rounded to keep the JSON small; positions to 0.1 px.
import { rebuildWalls } from './gamestate.js';

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;

export function fighterState(f) {
  return [r1(f.x), r1(f.y), r3(f.angle), r1(f.paddleOffset), r1(f.frozen), f.lungeState === 'out' ? 1 : 0, r1(f.hitFlash), r1(f.invuln)];
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
    time: r1(g.time || 0),
    ball: [r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), b.held ? 1 : 0],
    f: [fighterState(g.player), fighterState(g.boss)],
    mv: g.movers.map(moverState),
  };
  if (g.panes.length) s.pn = g.panes.map((p) => (p.broken ? r1(p.regrowAt) : -1));
  if (includeIce && g.ice) s.ice = { u: r1(g.ice.layUntil), p: g.ice.points.map((p) => [r1(p.x), r1(p.y), r1(p.t)]) };
  if (events.length) s.ev = events;
  return s;
}

/** Apply a snapshot to a mirror game state. Returns true if glass changed. */
export function applySnapshot(g, s) {
  const b = g.ball;
  b.x = s.ball[0];
  b.y = s.ball[1];
  b.vx = s.ball[2];
  b.vy = s.ball[3];
  b.held = !!s.ball[4];
  applyFighter(g.player, s.f[0]);
  applyFighter(g.boss, s.f[1]);
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
  if (s.ice && g.ice) {
    g.ice.layUntil = s.ice.u;
    g.ice.points = s.ice.p.map(([x, y, t]) => ({ x, y, t }));
  }
  g.time = s.time;
  return glassChanged;
}
