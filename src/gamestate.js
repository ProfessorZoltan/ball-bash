// DOM-free construction of a level's live objects, shared by the game, the
// multiplayer guest mirror and the tests.
import { Ball, Fighter, Boss, createMover } from './entities.js';
import { IceTrail } from './ice.js';
import { polygonEdges, pointInPolygon, closestPointOnSegment } from './physics.js';
import { obstaclePoly } from './levels.js';
import { BALL, PLAYER, COOP } from './config.js';

function playerStats(def, spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    r: PLAYER.radius,
    paddleWidth: PLAYER.paddleWidth,
    paddleBase: PLAYER.paddleOffset,
    paddleThick: PLAYER.paddleThick,
    moveSpeed: PLAYER.moveSpeed,
    turnSpeed: PLAYER.turnSpeed,
    lungeExtend: PLAYER.lungeExtend,
    lungeSpeed: PLAYER.lungeSpeed,
    retractPull: PLAYER.retractPull,
  };
}

/**
 * Build the physical state of a level: walls, glass panes, fighters, movers,
 * ice and the ball. With `pvp` the second slot is a human-stat fighter at the
 * boss spawn instead of the AI boss (no abilities, no patrol).
 */
/** Default match rules. ownBallLoss: a body hit counts even when that fighter's own shield was the last to touch the ball. */
export const DEFAULT_RULES = Object.freeze({ ownBallLoss: true });

/**
 * Does a ball touching `fighter`'s body count (a loss, or a point for the
 * other side)? With ownBallLoss off, the ball you sent last just bounces off
 * you until the other shield touches it. Applies to AI bosses the same way.
 */
export function bodyHitCounts(ball, fighter, rules = DEFAULT_RULES) {
  if (!rules || rules.ownBallLoss !== false) return true;
  return ball.lastTeam !== fighter.team;
}

/**
 * Where the co-op ally spawns: near the host's spawn, inside the room, clear
 * of walls, obstacles and movers. Levels may set `ally: { x, y }` to override.
 */
export function findAllySpawn(def, movers = [], taken = []) {
  if (def.ally && !taken.length) return { ...def.player, ...def.ally };
  const p = def.player;
  const r = PLAYER.radius + 14;
  const walls = polygonEdges(def.boundary).concat(...def.obstacles.map((o) => polygonEdges(obstaclePoly(o))));
  const clear = (x, y) => {
    if (!pointInPolygon(x, y, def.boundary)) return false;
    for (const o of def.obstacles) if (pointInPolygon(x, y, obstaclePoly(o))) return false;
    for (const s of walls) {
      const c = closestPointOnSegment(x, y, s.ax, s.ay, s.bx, s.by);
      if (Math.hypot(c.x - x, c.y - y) < r) return false;
    }
    for (const m of movers) if (Math.hypot(m.x - x, m.y - y) < (m.reach || 0) + r + 10) return false;
    if (Math.hypot(def.boss.x - x, def.boss.y - y) < 260) return false;
    for (const t of taken) if (Math.hypot(t.x - x, t.y - y) < 2 * PLAYER.radius + 12) return false;
    return true;
  };
  const offsets = [[0, 130], [0, -130], [0, 190], [0, -190], [-90, 100], [-90, -100], [90, 100], [90, -100], [-130, 0], [130, 0], [0, 250], [0, -250], [-130, 180], [-130, -180], [130, 180], [130, -180]];
  for (const [dx, dy] of offsets) if (clear(p.x + dx, p.y + dy)) return { ...p, x: p.x + dx, y: p.y + dy };
  return { ...p, x: p.x, y: p.y + 60 * (taken.length + 1) }; // last resort: the physics pushes them apart
}

/**
 * Keep-moving rule for human players: advance `f`'s stand-still clock by dt.
 * Moving a full body diameter (net displacement from the anchor, so turning
 * in place or jittering does not count) resets it; being frozen pauses it.
 * Returns true when the clock runs out, which is a loss for that player.
 */
export function tickCamp(f, dt, { distance = PLAYER.campDistance, seconds = PLAYER.campSeconds } = {}) {
  if (f.frozen > 0) return false;
  if (Math.hypot(f.x - f.campX, f.y - f.campY) >= distance) {
    f.resetCamp();
    return false;
  }
  f.campTimer += dt;
  return f.campTimer >= seconds;
}

/** Player ids in versus, in seating order: the host, then the guests by relay id. */
export const VERSUS_IDS = ['a', 'c', 'd'];

/**
 * Where `n` versus players start in `def`. Versus arenas list spawns per player
 * count; a campaign level uses its player and boss spawns and, for a third
 * player, a clear spot near the first.
 */
export function versusSpawns(def, n) {
  let list = def.spawns;
  if (list && !Array.isArray(list)) list = list[n] || list[Math.max(...Object.keys(list).map(Number))];
  if (list) return list.slice(0, n).map((s) => ({ x: s.x, y: s.y, angle: s.angle }));
  const out = [
    { x: def.player.x, y: def.player.y, angle: def.player.angle },
    { x: def.boss.x, y: def.boss.y, angle: def.boss.angle },
  ];
  const movers = (def.movers || []).map(createMover);
  while (out.length < n) out.push(findVersusSpawn(def, movers, out));
  return out;
}

/**
 * A fair extra seat in a campaign level: the most open spot that is as far
 * from every seat already taken as possible, and about equally far from each,
 * clear of walls, obstacles and movers, facing the serve point.
 */
export function findVersusSpawn(def, movers = [], taken = []) {
  const r = PLAYER.radius;
  const walls = polygonEdges(def.boundary).concat(...def.obstacles.map((o) => polygonEdges(obstaclePoly(o))));
  // Everywhere a mover gets to over one cycle, as segments (a long piston
  // sweeps a strip, not the disc its reach would suggest).
  const swept = [];
  (def.movers || []).forEach((spec, i) => {
    const m = createMover(spec);
    const period = m.period || 6;
    for (let k = 0; k < 24; k++) {
      m.update(period / 24, def.boss.x, def.boss.y);
      for (const sg of m.segments()) swept.push({ ...sg, thick: (m.thick || 0) + 8 });
    }
  });
  const clearance = (x, y) => {
    if (!pointInPolygon(x, y, def.boundary)) return -1;
    for (const o of def.obstacles) if (pointInPolygon(x, y, obstaclePoly(o))) return -1;
    let d = Infinity;
    for (const sg of walls) {
      const c = closestPointOnSegment(x, y, sg.ax, sg.ay, sg.bx, sg.by);
      d = Math.min(d, Math.hypot(c.x - x, c.y - y));
    }
    for (const sg of swept) {
      const c = closestPointOnSegment(x, y, sg.ax, sg.ay, sg.bx, sg.by);
      d = Math.min(d, Math.hypot(c.x - x, c.y - y) - sg.thick);
    }
    return d;
  };
  let best = null;
  const step = 20;
  for (let y = step; y < def.height; y += step) {
    for (let x = step; x < def.width; x += step) {
      const clear = clearance(x, y);
      if (clear < r + 30) continue;
      const dists = taken.map((t) => Math.hypot(t.x - x, t.y - y));
      const near = Math.min(...dists);
      const spread = Math.max(...dists) - near;
      // Far from everyone, evenly so, with room around it.
      const score = near - spread * 0.5 + Math.min(clear, 120) * 0.5;
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (!best) return findAllySpawn(def, movers, taken);
  return { x: best.x, y: best.y, angle: Math.atan2(def.ball.y - best.y, def.ball.x - best.x) };
}

/** Versus colours by seat: the host wears the wall colour, the first guest the obstacle colour, the second the arena's third. */
export function versusColors(def) {
  return [def.palette.wall, def.palette.obstacle, def.palette.third || COOP.allyColors[1]];
}

/** The spawn order for a round: seat k takes spawn (k + round - 1) mod n, so everyone starts everywhere in turn. */
export function rotateSpawns(spawns, round) {
  const n = spawns.length;
  return spawns.map((_, k) => spawns[(k + round - 1 + n * 1000) % n]);
}

/**
 * `pvp`: false, or the number of humans (true means two) playing every player
 * for themselves; `spawns` overrides where they start (see versusSpawns).
 * `coop`: false, or the number of allies (true means one) playing beside the
 * host's human against the boss.
 */
export function createGameState(def, { pvp = false, coop = false, rules = DEFAULT_RULES, spawns = null } = {}) {
  const allyCount = coop === true ? 1 : Math.max(0, Math.min(COOP.maxAllies, Number(coop) || 0));
  const pvpCount = pvp === true ? 2 : Math.max(0, Math.min(VERSUS_IDS.length, Number(pvp) || 0));
  pvp = pvpCount > 0;
  const staticWalls = polygonEdges(def.boundary, 'wall');
  const panes = [];
  for (const o of def.obstacles) {
    if (o.glass) {
      const pane = { poly: o.poly, color: o.color, broken: false, regrowAt: 0, segs: polygonEdges(o.poly, 'glass') };
      for (const sg of pane.segs) sg.pane = pane;
      panes.push(pane);
    } else {
      staticWalls.push(...polygonEdges(obstaclePoly(o), 'obstacle'));
    }
  }
  const movers = (def.movers || []).map(createMover);
  let player;
  let boss;
  let fighters;
  const allies = [];
  if (pvp) {
    // Every player for themselves: each human is its own team, seated at the
    // spawns in order (the host first). `boss` stays an alias for the second
    // seat so shared code has something to point at.
    // A seat may name its player (`id`) and colour, as when survivors of an
    // elimination match are reseated; otherwise seats go to a, c, d in order.
    const seats = spawns || versusSpawns(def, pvpCount);
    const colors = versusColors(def);
    const rivals = seats.slice(0, pvpCount).map((seat, i) => {
      const id = seat.id || VERSUS_IDS[i];
      return new Fighter({ ...playerStats(def, seat), name: i === 0 ? 'You' : `Rival ${i}`, kind: 'player', slot: id, team: id, color: seat.color || colors[VERSUS_IDS.indexOf(id)] || colors[i] });
    });
    player = rivals[0];
    boss = rivals[1];
    fighters = rivals;
  } else {
    player = new Fighter({ ...playerStats(def, def.player), name: 'You', kind: 'player', slot: 'a', team: 'us', color: def.palette.wall });
    boss = new Boss({ ...def.boss, name: def.bossName, color: def.palette.obstacle, slot: 'b', team: 'boss' });
    const taken = [];
    for (let i = 0; i < allyCount; i++) {
      const spawn = findAllySpawn(def, movers, taken);
      taken.push(spawn);
      allies.push(new Fighter({ ...playerStats(def, spawn), name: `Ally ${i + 1}`, kind: 'player', slot: 'cd'[i], team: 'us', color: COOP.allyColors[i] }));
    }
    fighters = [player, ...allies, boss];
  }
  const ally = allies[0] || null;
  const humans = pvp ? fighters.slice() : [player, ...allies];
  const ice = def.ice ? new IceTrail(def.ice) : null;
  const ball = new Ball(BALL.radius);
  ball.x = def.ball.x;
  ball.y = def.ball.y;
  ball.held = true;
  const staticPolys = def.obstacles.filter((o) => !o.glass).map(obstaclePoly);
  const g = { def, staticWalls, staticPolys, panes, walls: [], solidPolys: [], player, ally, allies, boss, fighters, humans, movers, ice, ball, pvp, players: pvpCount, coop: !pvp && allyCount > 0, rules: { ...DEFAULT_RULES, ...rules } };
  rebuildWalls(g);
  return g;
}

/** Recompute the active wall list (static walls plus unbroken glass). */
export function rebuildWalls(g) {
  const whole = g.panes.filter((p) => !p.broken);
  g.walls = g.staticWalls.concat(...whole.map((p) => p.segs));
  g.solidPolys = g.staticPolys.concat(whole.map((p) => p.poly));
}
