// Can a level be crossed? A search over everything the robot can stand on,
// flown with the robot's own physics (stepRobot), so what it proves is what
// a player can do: from each place it can stand, jump at walking and at
// running speed, a hop and a full leap, left and right, and walk off either
// end; wherever that lands is somewhere else it can stand. The level can be
// crossed when the boss's arena is among them.
//
// What the search takes as given, so it is a little kinder than play:
//  - a run-up: a jump at running speed is tried from anywhere on a surface;
//  - timing: a moving platform is somewhere to stand at eight points of its
//    path, a blinking one is always there, a crusher is up and a laser off;
//  - crates, glass and the doors of an ambush room are shot or opened;
//  - a wormhole puzzle (a bulkhead, a chasm) is solved: the search does not
//    open wormholes itself, so each puzzle is a link from its near floor to
//    its far one (bp.portalLinks), and the wormhole tests fly every kind of
//    puzzle for real. With `links: false` the search has no wormholes at all,
//    which is how a test proves a puzzle cannot be walked round;
//  - a door a switch opens is open when the puzzles are taken as solved
//    (solve.mjs proves every switch can be flipped from before its door),
//    and shut with `links: false`.
// Wells, white holes and springs are flown for real.
//
// Usage: node sequel/tools/reach.mjs [level id]
import { createWorld, Platform, segmentsNear, setGate } from '../src/world.js';
import { capsuleVsCapsule } from '../../src/physics.js';
import { Robot, stepRobot } from '../src/player.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { MOVE } from '../src/config.js';

const DT = 1 / 120;

/** The world as the search sees it: movers turned into ghost thin tops, crates gone, doors open or shut. */
export function searchWorld(bp, openDoors = true) {
  const w = createWorld({ ...bp, crates: [], movers: [] });
  if (openDoors) for (const d of w.doors) setGate(d, false);
  const extra = [];
  for (const m of bp.movers || []) {
    const p = new Platform(m);
    if (m.kind === 'crusher') continue;
    const phases = p.path.type === 'line' || p.path.type === 'circle' ? 8 : 1;
    for (let k = 0; k < phases; k++) {
      const t = (k / phases) * (p.path.period || 1);
      p.place(t);
      extra.push({ x0: p.x, x1: p.x + p.w, y: p.y });
    }
  }
  for (const e of extra) {
    const s = { ax: e.x0, ay: e.y, bx: e.x1, by: e.y, nx: 0, ny: -1, len: e.x1 - e.x0, thick: 0, oneWay: true, portal: false, kind: 'ghost' };
    w.oneWays.push(s);
    w.grid.insert(s);
  }
  return w;
}

/** Everything the robot can stand on: walkable faces of solids, thin tops, ghost platforms. */
function surfaces(w) {
  const out = [];
  for (const s of w.walls) {
    if (s.ny > -MOVE.walkable || s.kind === 'spikes' || s.kind === 'gate') continue;
    if (Math.hypot(s.bx - s.ax, s.by - s.ay) < 8) continue;
    out.push(s);
  }
  for (const s of w.oneWays) out.push(s);
  return out;
}

function inPit(bp, x, y) {
  for (const p of bp.pits) if (x > p.x0 && x < p.x1 && y > p.y) return true;
  return false;
}

/**
 * Fly one action from standing at (x, y): `dir`, `speed` (px/s at takeoff),
 * `hold` (seconds jump is held; 0 walks off instead of jumping). Returns the
 * surface it lands on and where, or null if it falls, is swallowed or lands
 * nowhere new within the time.
 */
function fly(w, bp, x, y, dir, speed, hold, start) {
  const bot = new Robot(x, y);
  bot.onGround = true;
  bot.ground = start;
  bot.vx = dir * speed;
  let lost = false;
  const hooks = { fell: () => (lost = true), swallowed: () => (lost = true), hurt: (why) => (why === 'spikes' || why === 'crushed' ? (lost = true) : null) };
  const run = speed > MOVE.walk + 1;
  let air = false;
  for (let i = 0; i < 2.6 / DT; i++) {
    const t = i * DT;
    const jump = hold > 0 && t < hold;
    stepRobot(bot, { mx: dir, run, jump, jumpPressed: hold > 0 && i === 0 }, w, DT, hooks);
    if (lost || inPit(bp, bot.x, bot.top)) return null;
    if (!bot.onGround) air = true;
    else if (air && bot.ground) return { seg: bot.ground, x: bot.x, y: bot.y };
    // Walking along without leaving the surface is not a move.
    if (hold === 0 && !air && t > 1.2) return null;
  }
  return null;
}

const PIECE = 80; // px: floors are searched in pieces this long, so a wall standing on one splits it

/** Does the robot's body fit standing at (x, top)? Thin tops never block; anything solid does. */
function fits(w, x, top) {
  const y = top - 30.5;
  const segs = segmentsNear(w, x - 20, y - 36, x + 20, y + 36, { oneWay: false });
  for (const s of segs) {
    const h = capsuleVsCapsule(x, y - 15, x, y + 15, 15, s.ax, s.ay, s.bx, s.by, s.thick || 0, x, y);
    if (h && h.depth > 2) return false;
  }
  return true;
}

/**
 * The places to stand: every surface cut into pieces of at most PIECE px,
 * each with its own left and right end, and whether the body fits there.
 */
function pieces(w, surfs) {
  const out = [];
  for (const s of surfs) {
    const l = s.ax <= s.bx ? { x: s.ax, y: s.ay } : { x: s.bx, y: s.by };
    const r = s.ax <= s.bx ? { x: s.bx, y: s.by } : { x: s.ax, y: s.ay };
    const n = Math.max(1, Math.ceil((r.x - l.x) / PIECE));
    for (let k = 0; k < n; k++) {
      const x0 = l.x + ((r.x - l.x) * k) / n;
      const x1 = l.x + ((r.x - l.x) * (k + 1)) / n;
      const at = (x) => l.y + ((r.y - l.y) * (x - l.x)) / (r.x - l.x || 1);
      const mid = (x0 + x1) / 2;
      out.push({ s, x0, x1, at, first: k === 0, last: k === n - 1, ok: fits(w, mid, at(mid)) });
    }
  }
  return out;
}

/** The piece under (x, y), or -1. */
function pieceAt(ps, x, y, tol = 60) {
  let best = -1;
  let bestD = tol;
  ps.forEach((p, i) => {
    if (x < p.x0 - 1 || x > p.x1 + 1) return;
    const d = Math.abs(p.at(x) - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * The search. Returns { ok, reached, furthest } where furthest is the
 * rightmost x it stood. With `from` it starts there instead of the spawn,
 * and with `targets` (points a robot's centre might stand at) it searches
 * everywhere it can get to and says which of them it reached: `hit`, one
 * true or false for each, and ok when every one was.
 */
export function reachability(bp, { log = false, links = true, from = null, targets = null } = {}) {
  const w = searchWorld(bp, links);
  const surfs = surfaces(w);
  const ps = pieces(w, surfs);
  const bySeg = new Map();
  ps.forEach((p, i) => {
    if (!bySeg.has(p.s)) bySeg.set(p.s, []);
    bySeg.get(p.s).push(i);
  });
  const A = bp.arena;
  const goal = (p) => !targets && A && p.x1 > A.x0 + 60 && p.at(p.x1) <= A.floor + 1 && p.at(p.x0) >= A.top;
  // Walking: a piece to the next along its surface, or across a bend to another surface, if the body fits where they meet.
  const walk = ps.map(() => []);
  const ends = new Map();
  const key = (x, y) => `${Math.round(x)},${Math.round(y)}`;
  ps.forEach((p, i) => {
    for (const [x, edge] of [[p.x0, p.first], [p.x1, p.last]]) {
      if (!edge) continue;
      const k = key(x, p.at(x));
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  for (const list of bySeg.values()) {
    for (let k = 0; k + 1 < list.length; k++) {
      const a = ps[list[k]];
      if (fits(w, a.x1, a.at(a.x1))) {
        walk[list[k]].push(list[k + 1]);
        walk[list[k + 1]].push(list[k]);
      }
    }
  }
  for (const [k, list] of ends) {
    const [x, y] = k.split(',').map(Number);
    if (!fits(w, x, y)) continue;
    for (const i of list) for (const j of list) if (i !== j) walk[i].push(j);
  }
  const origin = from || bp.spawn;
  const start = pieceAt(ps, origin.x, origin.y + 30, 20);
  if (start < 0) return { ok: false, reason: 'no surface under the spawn', reached: 0, furthest: origin.x };
  const jumps = new Map(); // wormhole puzzles: near floor to far floor
  if (links) {
    for (const l of bp.portalLinks || []) {
      const a = pieceAt(ps, l.from.x, l.from.y);
      const b = pieceAt(ps, l.to.x, l.to.y);
      if (a >= 0 && b >= 0) {
        if (!jumps.has(a)) jumps.set(a, []);
        jumps.get(a).push(b);
      }
    }
  }
  const seen = new Uint8Array(ps.length);
  const queue = [start];
  seen[start] = 1;
  let furthest = origin.x;
  let sims = 0;
  const actions = [];
  for (const dir of [1, -1]) {
    for (const speed of [MOVE.walk, MOVE.run]) for (const hold of [0.12, 1]) actions.push([dir, speed, hold]);
    actions.push([dir, MOVE.walk, 0]);
  }
  const count = () => seen.reduce((a, b) => a + b, 0);
  while (queue.length) {
    const i = queue.shift();
    const p = ps[i];
    furthest = Math.max(furthest, p.x1);
    if (goal(p)) return { ok: true, reached: count(), furthest, sims };
    const push = (j) => {
      if (j == null || j < 0 || seen[j] || !ps[j].ok) return;
      seen[j] = 1;
      queue.push(j);
    };
    for (const j of walk[i]) push(j);
    for (const j of jumps.get(i) || []) push(j);
    // Where to take off from: the middle, and an end of the surface if this piece holds one.
    const xs = [(p.x0 + p.x1) / 2];
    if (p.first) xs.push(Math.min(p.x1, p.x0 + 16));
    if (p.last) xs.push(Math.max(p.x0, p.x1 - 16));
    for (const x of xs) {
      if (!fits(w, x, p.at(x))) continue;
      const y = p.at(x) - 30.5;
      for (const [dir, speed, hold] of actions) {
        // Walking off only from the end of a surface, toward it.
        if (hold === 0 && !((dir > 0 && p.last && x > p.x1 - 17) || (dir < 0 && p.first && x < p.x0 + 17))) continue;
        sims++;
        const land = fly(w, bp, x, y, dir, speed, hold, p.s);
        if (land) push(pieceAt(ps, land.x, land.y + 30.5, 8));
      }
    }
  }
  if (targets) {
    const hit = targets.map((t) => {
      const j = pieceAt(ps, t.x, t.y + 30.5, 30);
      return j >= 0 && !!seen[j];
    });
    return { ok: hit.every(Boolean), hit, reached: count(), furthest, sims };
  }
  if (log) console.log('stuck: furthest', furthest);
  return { ok: false, reached: count(), furthest, sims };
}

// Run on its own: report every level (or one).
if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = process.argv[2] ? [Number(process.argv[2])] : LEVEL_DEFS.map((l) => l.id);
  for (const lid of ids) {
    const bp = level(lid);
    const t0 = performance.now();
    const r = reachability(bp);
    const sec = bp.sections.find((s) => s.x1 >= r.furthest && s.x0 <= r.furthest + 40);
    console.log(`${lid} ${r.ok ? 'crossable' : 'STUCK'} surfaces ${r.reached} sims ${r.sims} furthest ${Math.round(r.furthest)} / ${bp.arena.x0}${r.ok ? '' : ` near section ${sec ? `${sec.type} ${JSON.stringify(sec.p)}` : '?'}`} ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }
}
