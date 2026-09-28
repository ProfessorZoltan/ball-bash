// Can a boss be beaten? The real game, the real boss, and a robot that
// cannot be hurt, walking round the arena and firing only shots it has
// checked will reach a core: each aim is flown ahead with the charge's own
// physics (stepCharge) against the arena and the boss's parts as they stand,
// led by where the boss is going, bank shots and wormholes included. It
// proves the core can be reached, not that a person will find the shot.
// With wormholes allowed, the Gantry's cab is opened the way a player would:
// one end on its back wall, seen through the glass, the other on the nearest
// wall, and a shot fired level into it.
//
//   node vector/tools/fight.mjs 3            fight level 3's boss
//   node vector/tools/fight.mjs all          every boss
//   node vector/tools/fight.mjs 8 noportals  the Gantry without wormholes
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { makeCharge, stepCharge } from '../src/blaster.js';
import { PHYSICS_DT, BLASTER } from '../src/config.js';
import { sub, add, dot, cross, norm, len, dist, lookDir, yawPitch, madd, scale, rng } from '../src/math.js';
import { sightLine, placeEnd } from '../src/wormholes.js';

const DT = PHYSICS_DT;

/** Does a charge fired from the robot's muzzle along `dir` reach a core before anything else? Returns the time, or null. */
export function shotReaches(g, dir, seconds = 1.6) {
  const B = g.boss;
  const c = makeCharge(g.muzzle(dir), dir, 'std', 'test');
  c.trail = null;
  const bv = B.vel || [0, 0, 0];
  for (let t = 0; t < seconds; t += DT) {
    stepCharge(c, g.world, g.openEnds, DT, (s) => (s.crate || s.cover || s.switchRef ? 'stop' : null));
    if (c.dead) return null;
    const lead = scale(bv, t);
    if (B.glass && dist(c.pos, add(B.glass.p, lead)) < B.glass.r + c.r) return null;
    for (const p of B.parts) {
      if (p.off) continue;
      const pp = add(p.p, lead);
      if (p.type === 'plate') {
        const d = sub(c.pos, pp);
        const v = cross(p.n, p.u);
        if (Math.abs(dot(d, p.n)) < c.r + 0.15 && Math.abs(dot(d, p.u)) < p.a + c.r && Math.abs(dot(d, v)) < p.b + c.r) return null;
      } else if (p.type === 'box') {
        const d = sub(c.pos, pp);
        if (Math.abs(d[0]) < p.h[0] + c.r && Math.abs(d[1]) < p.h[1] + c.r && Math.abs(d[2]) < p.h[2] + c.r) return null;
      } else if (dist(c.pos, pp) < (p.r || 1) + c.r) {
        return p.type === 'core' ? t : null;
      }
    }
  }
  return null;
}

/** Look for a shot: straight at each core first, led, then a spray of banks and wormhole shots. */
export function findShot(g, r, tries = 120) {
  const b = g.bot;
  const eye = b.eyePos();
  const cores = g.boss.parts.filter((p) => p.type === 'core' && !p.off);
  const cands = [];
  for (const cp of cores) {
    const t = dist(eye, cp.p) / BLASTER.speed;
    const aim = add(cp.p, scale(g.boss.vel || [0, 0, 0], t));
    const yp = yawPitch(sub(aim, eye));
    cands.push([yp.yaw, yp.pitch]);
    for (let i = 0; i < 12; i++) cands.push([yp.yaw + (r() - 0.5) * 0.25, yp.pitch + (r() - 0.5) * 0.25]);
  }
  for (const e of g.openEnds) {
    // Into our own end, level and a little either way.
    const yp = yawPitch(sub(e.c, eye));
    for (let i = 0; i < 20; i++) cands.push([yp.yaw + (r() - 0.5) * 0.3, yp.pitch + (r() - 0.5) * 0.3]);
  }
  while (cands.length < tries) cands.push([r() * Math.PI * 2, (r() - 0.25) * 1.5]);
  let best = null;
  for (const [yaw, pitch] of cands) {
    const t = shotReaches(g, lookDir(yaw, pitch));
    if (t != null && (!best || t < best.t)) best = { yaw, pitch, t };
    if (best && best.t < 0.6) break;
  }
  return best;
}

/**
 * Fight level `id`'s boss. Returns { ok, time, hp, why }. opts.portals false
 * forbids wormholes; opts.limit is the game time allowed, in seconds.
 */
export function fight(id, opts = {}) {
  const bp = level(id, { noEnemies: true });
  const g = new Game(bp, { invulnerable: true, shields: Infinity, maxShields: Infinity });
  const A = bp.arena;
  g.bot.spawn(A.spawn, A.yaw);
  g.startBoss();
  const r = rng(id * 97 + 5);
  const limit = opts.limit || 240;
  const portals = opts.portals !== false;
  let t = 0;
  let waypoint = null;
  let wayT = 0;
  let aimT = 0;
  let noShot = 0;
  let shot = null;
  const c = A.centre;
  const R = Math.min(A.max[0] - A.min[0], A.max[2] - A.min[2]) / 2;
  while (t < limit && !g.boss.dead) {
    const b = g.bot;
    const it = { mx: 0, mz: 0 };
    // Walk: from spot to spot round the arena, a new one every few seconds.
    wayT -= DT;
    if (!waypoint || wayT <= 0 || Math.hypot(b.pos[0] - waypoint[0], b.pos[2] - waypoint[2]) < 0.8) {
      const a = r() * Math.PI * 2;
      const k = 0.35 + r() * 0.45;
      waypoint = [c[0] + Math.cos(a) * R * k, b.pos[1], c[2] + Math.sin(a) * R * k];
      wayT = 2 + r() * 3;
    }
    const to = sub(waypoint, b.pos);
    const d = Math.hypot(to[0], to[2]);
    if (!shot && d > 0.5) {
      b.yaw = Math.atan2(to[0], to[2]);
      b.pitch = 0;
      it.mz = 1;
      it.run = true;
    }
    // Aim a few times a second, when a charge is free.
    aimT -= DT;
    if (g.bossIntro <= 0 && aimT <= 0 && g.cooldown <= 0 && g.mine() < BLASTER.maxAlive) {
      aimT = 0.12;
      shot = findShot(g, r);
      if (shot) {
        b.yaw = shot.yaw;
        b.pitch = shot.pitch;
        it.firePress = true;
        noShot = 0;
        shot = null;
      } else {
        noShot += 0.12;
        if (portals && id === 8 && noShot > 1 && !g.ends[0]) openCab(g);
      }
    }
    g.events.length = 0;
    g.step(DT, it);
    t += DT;
  }
  return { ok: g.boss.dead, time: t, hp: g.boss.hp, why: g.boss.dead ? '' : `still at ${g.boss.hp.toFixed(1)} of ${g.boss.maxHp} after ${t.toFixed(0)} s` };
}

/** The Gantry's cab: an end on its back wall through the glass, the other on the nearest wall, at eye height. */
function openCab(g) {
  const b = g.bot;
  const A = g.bp.arena;
  const back = add(A.cab, [0, 0, 0]);
  // The back wall is behind the core, away from the robot's side of the arena.
  const eye = b.eyePos();
  const toCab = norm(sub(back, eye));
  const hit = g.world.raycast(eye, toCab, 80, { glass: 'through' });
  if (!hit) return;
  let yp = yawPitch(toCab);
  b.yaw = yp.yaw;
  b.pitch = yp.pitch;
  const e0 = g.openEnd(0);
  if (!e0) return;
  // The nearest wall, level.
  let best = null;
  for (let k = 0; k < 16; k++) {
    const dir = lookDir((k / 16) * Math.PI * 2, 0);
    const h = g.world.raycast(eye, dir, 25);
    if (h && Math.abs(h.n[1]) < 0.3 && (!best || h.t < best.t)) {
      const end = placeEnd(g.world, sightLine(g.world, eye, dir).hit, dir, e0, eye).end;
      if (end) best = { t: h.t, dir };
    }
  }
  if (!best) return;
  yp = yawPitch(best.dir);
  b.yaw = yp.yaw;
  b.pitch = 0;
  g.openEnd(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2] || 'all';
  const portals = process.argv[3] !== 'noportals';
  const ids = arg === 'all' ? LEVEL_DEFS.map((l) => l.id) : arg.split(',').map(Number);
  for (const id of ids) {
    const t0 = Date.now();
    const res = fight(id, { portals });
    console.log(`level ${id} (${LEVEL_DEFS[id - 1].boss}): ${res.ok ? 'beaten' : 'NOT beaten'} in ${res.time.toFixed(1)} s of play (${Date.now() - t0} ms)${res.why ? ` — ${res.why}` : ''}`);
  }
}

export { len, madd };
