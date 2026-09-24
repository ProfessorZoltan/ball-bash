// Can a boss be beaten? The real game (game.js), the real boss, and a robot
// that cannot be hurt, standing at places round the arena and firing only
// shots it has checked will reach the core: each aim is flown with the
// charge's own physics (stepCharge) against the arena and the boss's parts
// as they stand (led by where they are going), bank shots, wormholes and
// all. It proves the core can be reached, not that a person will find the
// shot. With wormholes allowed, when no shot is on it opens a pair: one end
// in the roof over its head, the other in the floor beside it.
//
// Usage: node sequel/tools/fight.mjs [level id] [noportals]
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { Charge, chargeSpec, stepCharge, clampCharge } from '../src/blaster.js';
import { BLASTER, SURFACE_VELOCITY_FACTOR } from '../src/config.js';
import { circleVsCapsule, circleVsCircle, reflect } from '../../src/physics.js';
import { seeded } from '../src/build.js';
import { sightLine, placeEnd } from '../src/wormholes.js';

const DT = 1 / 240;
const AIM_DT = 1 / 120;

/** Fly a charge along `angle` from (x, y) and say whether it reaches the core first, and when. */
export function shotReaches(game, x, y, angle, seconds = 1.4) {
  const b = game.boss;
  const spec = chargeSpec('std');
  const c = new Charge({ x, y, vx: Math.cos(angle) * BLASTER.speed, vy: Math.sin(angle) * BLASTER.speed, r: spec.r, born: 0, life: seconds + 1 });
  const folded = !!b.def.folded;
  for (let t = 0; t < seconds; t += AIM_DT) {
    if (!stepCharge(c, game.world, AIM_DT, t, {})) return null;
    if (folded && !(c.warps > 0)) continue; // it passes through, unfolded
    // The boss is led: where it will be when the charge gets there, if it keeps going.
    const lx = (b.vx || 0) * t;
    const ly = (b.vy || 0) * t;
    for (const p of b.parts) {
      if (p.type === 'plate') {
        // Turned on by as far as it will have turned, too.
        const a = (p.omega || 0) * t;
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        const px = p.pivot ? p.pivot.x : 0;
        const py = p.pivot ? p.pivot.y : 0;
        const rot = (x, y) => [px + (x - px) * cs - (y - py) * sn, py + (x - px) * sn + (y - py) * cs];
        const [ax, ay] = rot(p.seg.ax, p.seg.ay);
        const [bx, by] = rot(p.seg.bx, p.seg.by);
        const s = { ax, ay, bx, by };
        const h = circleVsCapsule(c.x - lx, c.y - ly, c.r, s.ax, s.ay, s.bx, s.by, p.thick, c.vx, c.vy);
        if (h) {
          c.x += h.nx * h.depth;
          c.y += h.ny * h.depth;
          const sv = p.velAt(h.cx, h.cy);
          reflect(c, h.nx, h.ny, sv.x, sv.y, 1, SURFACE_VELOCITY_FACTOR);
          clampCharge(c, h.nx, h.ny);
        }
        continue;
      }
      const h = circleVsCircle(c.x, c.y, c.r, p.x + lx, p.y + ly, p.r);
      if (!h) continue;
      if (p.type === 'core') return t;
      c.x += h.nx * h.depth;
      c.y += h.ny * h.depth;
      reflect(c, h.nx, h.ny, 0, 0);
    }
  }
  return null;
}

/** Places to stand in the arena: along the floor, and on its platforms. */
function standingSpots(game) {
  const A = game.arena;
  const spots = [];
  for (let x = A.x0 + 80; x < A.x1 - 60; x += 140) spots.push({ x, y: A.floor - 31 });
  for (const o of game.bp.oneWays) if (o.x0 >= A.x0 && o.x1 <= A.x1 && o.y > A.top) spots.push({ x: (o.x0 + o.x1) / 2, y: o.y - 31 });
  for (const s of game.bp.solids) {
    const b = s.pts;
    if (s.kind !== 'block') continue;
    const x0 = Math.min(...b.map((p) => p[0]));
    const x1 = Math.max(...b.map((p) => p[0]));
    const y0 = Math.min(...b.map((p) => p[1]));
    if (x0 >= A.x0 && x1 <= A.x1 && y0 > A.top) spots.push({ x: (x0 + x1) / 2, y: y0 - 31 });
  }
  return spots;
}

/** Open a pair from where the robot stands: the light end straight up, the dark end in the floor a little ahead. */
function openPair(game, rng) {
  const bot = game.bot;
  const sh = bot.shoulder;
  const up = placeEnd(game.world, sightLine(game.world, sh.x, sh.y, -Math.PI / 2 + (rng() - 0.5) * 0.3), 0);
  const side = rng() < 0.5 ? 1 : -1;
  const down = placeEnd(game.world, sightLine(game.world, sh.x, sh.y, Math.PI / 2 - side * (0.9 + rng() * 0.3)), 1);
  if (!up || !down) return false;
  game.world.portals[0] = [up, down];
  return true;
}

/** Fight the boss of level `id`. Returns { beaten, seconds, shots, hits }. */
export function fight(id, { limit = 240, angles = 40, seed = 7, portals = true } = {}) {
  const rng = seeded(seed);
  const game = new Game(level(id), { shields: Infinity, rng });
  const A = game.arena;
  const bot = game.bot;
  bot.spawn(A.x0 + 160, A.floor - 31);
  const spots = standingSpots(game);
  let spot = spots[0];
  let aim = 0;
  let found = false;
  let lastAim = -1;
  let lastMove = 0;
  let shots = 0;
  let hits = 0;
  const idle = { mx: 0, aim: null };
  const start = game.time;
  for (let i = 0; i < limit / DT; i++) {
    bot.invuln = 1e9;
    const now = game.time - start;
    if (game.phase === 'boss') {
      if (now - lastAim > 0.35) {
        lastAim = now;
        found = false;
        const sh = bot.shoulder;
        const off = rng() * ((Math.PI * 2) / angles);
        let bestT = Infinity;
        for (let k = 0; k < angles; k++) {
          const a = off + (k / angles) * Math.PI * 2;
          const t = shotReaches(game, sh.x, sh.y, a);
          if (t != null && t < bestT) {
            bestT = t;
            aim = a;
            found = true;
          }
        }
        if (!found && now - lastMove > 1.5) {
          spot = spots[Math.floor(rng() * spots.length)];
          bot.spawn(spot.x, spot.y);
          lastMove = now;
          if (portals && rng() < 0.7) openPair(game, rng);
        }
      }
      const before = game.boss.hp;
      const fire = found && game.cool <= 0;
      game.step(DT, { ...idle, aim, fire });
      if (fire) {
        shots++;
        found = false;
      }
      if (game.boss.hp < before) hits++;
    } else game.step(DT, idle);
    game.events.length = 0;
    if (game.phase === 'bossDown' || game.phase === 'exit') return { beaten: true, seconds: now, shots, hits };
  }
  return { beaten: false, seconds: limit, shots, hits, hp: game.boss && game.boss.hp };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] && process.argv[2] !== 'all' ? [Number(process.argv[2])] : LEVEL_DEFS.map((l) => l.id);
  const portals = process.argv[3] !== 'noportals';
  for (const id of ids) {
    const t0 = performance.now();
    const r = fight(id, { portals });
    console.log(`${id} ${LEVEL_DEFS[id - 1].boss.padEnd(14)} ${r.beaten ? 'beaten' : 'NOT BEATEN'} in ${r.seconds.toFixed(1)} s, ${r.shots} shots, ${r.hits} hits${r.hp != null ? `, hp left ${r.hp}` : ''} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
