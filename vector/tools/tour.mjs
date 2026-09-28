// An arena's tour, flown by the autopilot from one of its spawns: round the
// loop the arena wrote down (maps.js) until it is back where it started,
// with the robot's own physics. Every spawn and every power-up spot it
// stands on is counted; a tour that reaches them all from every spawn, and
// loses no shield, is an arena where everyone can get everywhere.
//
//   node vector/tools/tour.mjs            every arena, from every spawn
//   node vector/tools/tour.mjs foundry    one arena
import { Game } from '../src/game.js';
import { MAPS, arenaMap } from '../src/maps.js';
import { PHYSICS_DT } from '../src/config.js';
import { Autopilot } from './autopilot.mjs';

const near = (p, b) => Math.hypot(p[0] - b.pos[0], p[2] - b.pos[2]) < 1.3 && Math.abs(p[1] - b.pos[1]) < 1;

/** Fly arena `id`'s tour from spawn `si`. Returns { ok, why, time, hurts, missed }. */
export function tour(id, si = 0) {
  const bp = arenaMap(id);
  const g = new Game(bp, { shields: Infinity, maxShields: Infinity });
  const sp = bp.spawns[si];
  g.bot.spawn(sp.p, sp.yaw);
  // The loop starts and ends at the first spawn; from another, it starts just after the step that reaches it.
  const route = bp.route;
  const k = si === 0 ? route.length - 1 : route.findIndex((st) => st.to && near(st.to, { pos: sp.p }));
  if (k < 0) return { ok: false, why: `the tour never comes to spawn ${si}`, missed: [], hurts: 0, time: 0 };
  const ap = new Autopilot(g);
  ap.route = [...route.slice(k + 1), ...route.slice(0, k + 1)];
  const want = [...bp.spawns.map((s) => s.p), ...bp.spots];
  const seen = new Set();
  const hurts = [];
  let t = 0;
  while (!ap.done && !ap.failed && t < 300) {
    const it = ap.intent();
    g.events.length = 0;
    g.step(PHYSICS_DT, it);
    for (const e of g.events) if (e.s === 'hurt') hurts.push(`${e.why} at step ${ap.i}`);
    if (g.bot.onGround) want.forEach((p, i) => near(p, g.bot) && seen.add(i));
    t += PHYSICS_DT;
  }
  if (!ap.done && !ap.failed) ap.fail('ran out of time');
  const missed = want.filter((p, i) => !seen.has(i));
  const why = ap.failed || (hurts.length ? `${hurts.length} shields lost: ${hurts.slice(0, 3).join('; ')}` : missed.length ? `never reached ${missed.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' | ')}` : '');
  return { ok: !why, why, time: t, hurts: hurts.length, missed };
}

if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] ? process.argv[2].split(',') : MAPS.map((m) => m.id);
  for (const id of ids) {
    const n = arenaMap(id).spawns.length;
    for (let si = 0; si < n; si++) {
      const r = tour(id, si);
      console.log(`${id} from spawn ${si}: ${r.ok ? 'toured' : 'FAILED'} in ${r.time.toFixed(0)} s of play${r.why ? ` — ${r.why}` : ''}`);
    }
  }
}
