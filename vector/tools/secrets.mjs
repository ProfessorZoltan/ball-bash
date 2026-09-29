// The secrets: each level's detours (build.js), flown one by one with the
// robot's own physics from where each starts, to see its prize taken with
// no shield lost; and the level's own way through, which must take none.
//
//   node vector/tools/secrets.mjs 3        level 3's secrets
//   node vector/tools/secrets.mjs all      every level's
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { PHYSICS_DT } from '../src/config.js';
import { Autopilot } from './autopilot.mjs';

/**
 * Fly detour k of level id. A secret's must find it (one secret); a risky
 * way's must take its prize and come back to the way. A locked room's fight
 * is fought with its waves on and the robot untouchable, as the level test
 * fights the ambush rooms. Returns { ok, why, kind, time }.
 */
export function flyDetour(id, k, opts = {}) {
  const bp = level(id, { noEnemies: true });
  const fight = !!bp.detours[k].fight;
  const g = new Game(bp, { shields: Infinity, maxShields: Infinity, noWaves: !fight, invulnerable: fight });
  const d = bp.detours[k];
  g.bot.spawn(d.start, d.yaw);
  const ap = new Autopilot(g, d.route);
  let hurts = 0;
  let t = 0;
  const why = [];
  while (!ap.done && !ap.failed && t < (opts.limit || 90)) {
    const it = ap.intent();
    g.events.length = 0;
    g.step(PHYSICS_DT, it);
    for (const e of g.events) {
      if (e.s === 'hurt') {
        hurts++;
        why.push(`${e.why} at step ${ap.i} ${g.bot.pos.map((v) => v.toFixed(1))}`);
      }
    }
    t += PHYSICS_DT;
  }
  if (!ap.done && !ap.failed) ap.fail('ran out of time');
  const found = g.stats.secrets;
  const took = g.pickups.filter((p) => p.taken).length;
  const got = d.secret === false ? took >= 1 && found === 0 : found === 1;
  const ok = ap.done && !ap.failed && hurts === 0 && got;
  return { ok, kind: d.kind, time: t, found, took, secret: d.secret !== false, why: ap.failed || (hurts ? why.join('; ') : !got ? `${found} secrets found, ${took} prizes taken` : ''), game: g };
}

if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2] || 'all';
  const ids = arg === 'all' ? LEVEL_DEFS.map((l) => l.id) : arg.split(',').map(Number);
  for (const id of ids) {
    const n = level(id, { noEnemies: true }).detours.length;
    for (let k = 0; k < n; k++) {
      const r = flyDetour(id, k);
      console.log(`level ${id} ${r.kind}: ${r.ok ? (r.secret ? 'found' : 'taken') : 'FAILED'} in ${r.time.toFixed(1)} s${r.why ? ` — ${r.why}` : ''}`);
    }
  }
}
