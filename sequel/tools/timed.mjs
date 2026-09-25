// Can a stretch of blinking platforms be crossed in time? reach.mjs takes a
// blinking platform as always there; this search keeps the clock. From
// standing somewhere at time t, it waits (0.2 s at a time, as long as what
// it stands on stays), then jumps right at walking or running speed, a hop
// or a full leap, flown with the robot's own physics (stepRobot) while the
// platforms blink on their own clocks. Wherever it lands, at whatever time,
// is somewhere new to stand. It crosses when it stands on the far floor.
// It always goes on from the furthest place found so far, so a way across,
// if there is one, turns up long before the budget runs out.
//
// Usage: node sequel/tools/timed.mjs [level id]
import { createWorld, stepWorld } from '../src/world.js';
import { Robot, stepRobot } from '../src/player.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { MOVE } from '../src/config.js';

const DT = 1 / 120;
const WAIT = 0.2;

/** Every blinking platform's period, and one span they all repeat in (near enough: the longest, times two). */
function span(world) {
  let p = 1;
  for (const m of world.movers) if (m.path && m.path.type === 'phase') p = Math.max(p, m.path.on + m.path.off);
  return p;
}

/**
 * Search the section `sec` (from bp.sections) of `bp`: from its near floor to
 * its far floor over the pit in it. Returns { ok, states, sims, furthest }.
 */
export function crossTimed(bp, sec, { budget = 60000 } = {}) {
  const world = createWorld(bp);
  const pit = bp.pits.find((p) => p.x0 >= sec.x0 - 1 && p.x1 <= sec.x1 + 1);
  if (!pit) return { ok: false, reason: 'no pit in the section' };
  const P = span(world);
  const at = (t) => {
    world.t = t;
    for (const m of world.movers) m.update(0, t);
  };
  const fall = (bot) => bot.top > pit.y || (bot.x > pit.x0 && bot.x < pit.x1 && bot.y > pit.y - 300);
  let sims = 0;
  let furthest = pit.x0;
  const seen = new Set();
  const key = (s) => `${Math.round(s.x / 40)},${Math.round(s.y / 20)},${Math.round((((s.t % P) + P) % P) / WAIT)}`;
  const queue = [];
  const push = (s) => {
    const k = key(s);
    if (seen.has(k)) return;
    seen.add(k);
    // Kept in order of how far along it is: the furthest is taken next.
    let i = queue.length;
    while (i > 0 && queue[i - 1].x > s.x) i--;
    queue.splice(i, 0, s);
  };
  // The near floor: free to wait there as long as it likes, so every start time in a period.
  for (let t = 0; t < P; t += WAIT) push({ x: pit.x0 - 18, y: sec.y0 - 30.5, t, solid: true });
  const actions = [];
  for (const speed of [MOVE.walk, MOVE.run]) for (const hold of [0.12, 0.35, 1]) actions.push([speed, hold]);
  while (queue.length && sims < budget) {
    const s = queue.pop();
    // Wait where it stands, a beat at a time, while the ground holds.
    let bot = new Robot(s.x, s.y);
    bot.onGround = true;
    at(s.t);
    for (let w = 0; w <= P + 1e-9; w += WAIT) {
      const t0 = s.t + w;
      if (w > 0) {
        at(s.t + w - WAIT);
        for (let i = 0; i < WAIT / DT; i++) {
          stepWorld(world, DT);
          stepRobot(bot, { mx: 0 }, world, DT, {});
        }
        if (!bot.onGround || fall(bot)) break;
      }
      if (s.solid && w > 0) break; // on the near floor every start time is its own state already
      for (const [speed, hold] of actions) {
        sims++;
        at(t0);
        const b = new Robot(bot.x, bot.y);
        b.onGround = true;
        b.ground = bot.ground;
        b.vx = speed;
        let air = false;
        let landed = null;
        for (let i = 0; i < 2.4 / DT; i++) {
          stepWorld(world, DT);
          stepRobot(b, { mx: 1, run: speed > MOVE.walk, jump: i * DT < hold, jumpPressed: i === 0 }, world, DT, {});
          if (fall(b)) break;
          if (!b.onGround) air = true;
          else if (air) {
            landed = { x: b.x, y: b.y, t: world.t };
            break;
          }
        }
        if (!landed || landed.x < bot.x + 20) continue;
        furthest = Math.max(furthest, landed.x);
        if (landed.x > pit.x1 + 10 && landed.y < pit.y) return { ok: true, states: seen.size, sims, furthest };
        push(landed);
      }
    }
  }
  return { ok: false, states: seen.size, sims, furthest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] ? [Number(process.argv[2])] : LEVEL_DEFS.map((l) => l.id);
  for (const id of ids) {
    const bp = level(id);
    for (const sec of bp.sections.filter((s) => s.type === 'phaseRun' || s.type === 'phase')) {
      const t0 = performance.now();
      const r = crossTimed(bp, sec);
      console.log(`${id} ${sec.type.padEnd(8)} at ${Math.round(sec.x0)}: ${r.ok ? 'crossed' : `NOT CROSSED (furthest ${Math.round(r.furthest)})`} ${r.states} states, ${r.sims} jumps (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
    }
  }
}
