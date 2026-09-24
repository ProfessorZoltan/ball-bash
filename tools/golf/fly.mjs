// One flight of the charge, as the game flies it (the same loop as golfFly in
// test/physics.test.js), with extras for design work: the path for plotting,
// an event log, and pulses a player would aim by eye.
//
// fly(def, angle, { pulses, launchAt, maxT, trace, rel, log }) → { end, t, closest, warps, bounces, events, topSpeed, x, y, vx, vy, path, plan }
//   pulses: { at, a }           a fixed heading (radians)
//           { at, a, rel }      with `rel` (option), a heading relative to the charge's travel (0 forward, π a retro burn)
//           { at, toward: [x, y] | 'cup' }  pointed at a mark from wherever the charge is
//           { at, steer: [x, y] | 'cup' }   pointed so the velocity swings onto the mark
//   plan[i].used is the heading each pulse was actually fired on, for writing a route down.
import { createGameState, wellsAccel, swallowingWell, solidPolysNow, tickOrbits, tickEmitters, paneBreaks, breakPane, golfSwitch, warpCharge } from '../../src/gamestate.js';
import { PHYSICS_DT, SURFACE_VELOCITY_FACTOR, BALL } from '../../src/config.js';
import { GOLF, FAR_COURSE, COURSE } from '../../src/golf.js';
import { advanceBall } from '../../src/sim.js';
import { pointInPolygon } from '../../src/physics.js';

export const R = Math.PI / 180;
/** A hole on either course by id ('g1'…'g18', 'f1'…'f18'). */
export const byId = (id) => FAR_COURSE.concat(COURSE).find((h) => h.id === id);
/** A hole by id, or the `def` a draft module exports (a path ending in .mjs). */
export async function holeArg(arg) {
  if (arg.endsWith('.mjs')) return (await import(new URL(arg, `file://${process.cwd()}/`).href)).def;
  const def = byId(arg);
  if (!def) throw new Error(`no hole ${arg}`);
  return def;
}

export function fly(def, angle, { pulses = [], maxT = null, launchAt = 0, trace = false, rel = false, log = false } = {}) {
  const g = createGameState(def, {});
  for (let k = 0; k < Math.round(launchAt / PHYSICS_DT); k++) {
    for (const m of g.movers) m.update(PHYSICS_DT);
    tickOrbits(g, PHYSICS_DT);
    tickEmitters(g, PHYSICS_DT);
  }
  const b = g.ball;
  b.launch(def.tee.x, def.tee.y, angle, def.ball.speed);
  const plan = pulses.map((p) => ({ ...p, done: false }));
  let warp = 0;
  let warps = 0;
  let bounces = 0;
  let closest = Infinity;
  let topSpeed = 0;
  const events = [];
  const path = trace ? [[b.x, b.y]] : null;
  let traceAt = 0;
  const cup = g.wells.find((w) => w.cup);
  const onWall = (h, seg, before) => {
    bounces++;
    if (seg.kind === 'node' && seg.node.kind === 'switch') {
      golfSwitch(g, seg.node, g.mouthTime);
      events.push({ t: g.mouthTime - launchAt, e: 'switch', i: seg.node.i });
    } else if (paneBreaks(g, seg, before)) {
      breakPane(g, seg.pane, before, g.mouthTime);
      events.push({ t: g.mouthTime - launchAt, e: 'glass', v: Math.round(Math.hypot(before.vx, before.vy)) });
    } else if (log) events.push({ t: g.mouthTime - launchAt, e: seg.kind, v: Math.round(Math.hypot(before.vx, before.vy)) });
  };
  const movers = g.emitters.length ? g.movers.concat(g.emitters.map((e) => e.pulser)) : g.movers;
  const end = (e, t) => ({ plan, end: e, t, closest, warps, bounces, events, topSpeed, x: b.x, y: b.y, vx: b.vx, vy: b.vy, path, g });
  let t = 0;
  for (; t < (maxT || def.flightSeconds); t += PHYSICS_DT) {
    for (const m of g.movers) m.update(PHYSICS_DT);
    tickOrbits(g, PHYSICS_DT);
    for (const p of plan) {
      if (p.done || t < p.at) continue;
      p.done = true;
      const mark = p.toward === 'cup' ? [cup.x, cup.y] : p.toward;
      const aim = p.steer === 'cup' ? [cup.x, cup.y] : p.steer;
      let a;
      if (aim) {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const d = Math.atan2(aim[1] - b.y, aim[0] - b.x);
        a = Math.atan2(Math.sin(d) * sp - b.vy, Math.cos(d) * sp - b.vx);
      } else a = mark ? Math.atan2(mark[1] - b.y, mark[0] - b.x) : rel || p.rel ? Math.atan2(b.vy, b.vx) + p.a : p.a;
      p.used = a;
      b.vx += Math.cos(a) * GOLF.pulse;
      b.vy += Math.sin(a) * GOLF.pulse;
      b.clampSpeed(BALL.minSpeed, g.maxSpeed);
    }
    const a = wellsAccel(g.wells, b.x, b.y);
    if (a) {
      b.vx += a.ax * PHYSICS_DT;
      b.vy += a.ay * PHYSICS_DT;
    }
    advanceBall(b, g.walls, [], PHYSICS_DT, SURFACE_VELOCITY_FACTOR, { onWall, onMover: (m) => { bounces++; if (log || m.kind === 'pulse') events.push({ t: g.mouthTime - launchAt, e: m.kind, v: Math.round(b.speed) }); } }, movers, solidPolysNow(g));
    b.clampSpeed(BALL.minSpeed, g.maxSpeed);
    topSpeed = Math.max(topSpeed, b.speed);
    closest = Math.min(closest, Math.hypot(b.x - cup.x, b.y - cup.y));
    if (trace && (traceAt -= PHYSICS_DT) <= 0) {
      traceAt = 1 / 30;
      path.push([b.x, b.y, b.speed]);
    }
    const took = swallowingWell(g.wells, b.x, b.y);
    if (took) return end(took.cup ? 'cup' : took.hazard ? 'maw' : 'horizon', t);
    if (!pointInPolygon(b.x, b.y, def.boundary)) return end('out', t);
    if (warp > 0) warp -= PHYSICS_DT;
    else {
      const hop = warpCharge(g);
      if (hop) {
        warp = GOLF.warpHold;
        warps++;
        events.push({ t: g.mouthTime - launchAt, e: 'warp', pair: hop.w.i ?? g.wormholes.indexOf(hop.w), h: Math.round((Math.atan2(b.vy, b.vx) * 180) / Math.PI) });
        if (trace) path.push(null, [b.x, b.y]);
      }
    }
    tickEmitters(g, PHYSICS_DT);
  }
  return end('spent', t);
}
