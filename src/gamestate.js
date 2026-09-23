// DOM-free construction of a level's live objects, shared by the game, the
// multiplayer guest mirror and the tests.
import { colorDistance } from './color.js';
import { Ball, Fighter, Boss, Pulser, createMover } from './entities.js';
import { IceTrail } from './ice.js';
import { polygonEdges, pointInPolygon, closestPointOnSegment } from './physics.js';
import { angleDiff } from './vec.js';
import { obstaclePoly, ellipse } from './levels.js';
import { BALL, PLAYER, COOP } from './config.js';
import { GOLF } from './golf.js';
import { frameStats, STANDARD, MAX_HULL } from './frames.js';

/** A human fighter's stats: where they start, and the frame they wear. */
function playerStats(def, spawn, cells) {
  const f = frameStats(cells || STANDARD);
  return {
    x: spawn.x,
    y: spawn.y,
    angle: spawn.angle,
    r: f.radius,
    paddleWidth: f.paddleWidth,
    paddleBase: f.paddleBase,
    paddleThick: f.paddleThick,
    moveSpeed: f.moveSpeed,
    turnSpeed: f.turnSpeed,
    lungeExtend: f.lungeExtend,
    lungeSpeed: f.lungeSpeed,
    retractPull: f.retractPull,
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
  const r = MAX_HULL + 14; // room for the widest hull any frame can wear
  const walls = polygonEdges(def.boundary).concat(...def.obstacles.map((o) => polygonEdges(obstaclePoly(o))));
  const clear = (x, y) => {
    if (!pointInPolygon(x, y, def.boundary)) return false;
    for (const o of def.obstacles) if (pointInPolygon(x, y, obstaclePoly(o))) return false;
    for (const s of walls) {
      const c = closestPointOnSegment(x, y, s.ax, s.ay, s.bx, s.by);
      if (Math.hypot(c.x - x, c.y - y) < r) return false;
    }
    for (const m of movers) if (Math.hypot(m.x - x, m.y - y) < (m.reach || 0) + r + 10) return false;
    for (const b of enemySpecs(def)) if (Math.hypot(b.x - x, b.y - y) < 260) return false;
    for (const t of taken) if (Math.hypot(t.x - x, t.y - y) < 2 * MAX_HULL + 12) return false;
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

/** The AI enemies a level describes: its drones, or its one boss. */
export function enemySpecs(def) {
  return def.drones && def.drones.length ? def.drones : [def.boss];
}

/** Slots for AI enemies: the boss's own, then letters no human uses. */
export const DRONE_SLOTS = ['b', 'e', 'f', 'g', 'h'];

/**
 * Does a ball touching a node light it? `h` is the contact (normal from the
 * node toward the ball), `before` the ball's velocity before the bounce.
 */
export function nodeAccepts(node, h, before, ball) {
  const speed = before ? Math.hypot(before.vx, before.vy) : ball.speed;
  if (node.minSpeed && speed < node.minSpeed) return false;
  switch (node.kind) {
    case 'ricochet':
      return !!ball.banked;
    case 'hooded': {
      const arc = ((node.arc || 100) * Math.PI) / 360;
      return Math.abs(angleDiff(Math.atan2(h.ny, h.nx), node.open || 0)) <= arc;
    }
    case 'fast':
      return speed >= (node.minSpeed || 0);
    default:
      return true;
  }
}

/** Keep a rail-bound drone on its rail: snap to the nearest point and drop the sideways velocity. */
export function constrainToRail(f, rail) {
  const c = closestPointOnSegment(f.x, f.y, rail.ax, rail.ay, rail.bx, rail.by);
  f.x = c.x;
  f.y = c.y;
  const dx = rail.bx - rail.ax;
  const dy = rail.by - rail.ay;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const along = f.vx * ux + f.vy * uy;
  f.vx = ux * along || 0; // `|| 0` turns a -0 into 0
  f.vy = uy * along || 0;
}

/**
 * The gravity well's field at (x, y): null beyond its reach, otherwise the
 * unit direction toward the well, the distance, and `k`, the strength in
 * 1/px: a 1/d fall-off that fades to nothing over the outer third of the
 * reach. The ball accelerates by `well.pull * k` px/s²; a player is dragged
 * `well.drag * k` px/s.
 */
export function wellField(well, x, y) {
  const dx = well.x - x;
  const dy = well.y - y;
  const d = Math.hypot(dx, dy);
  if (d >= well.range || d < 1e-6) return null;
  const fade = Math.min(1, (well.range - d) / (well.range * 0.3));
  return { ux: dx / d, uy: dy / d, d, k: fade / Math.max(d, well.r) };
}

/** Drag a fighter toward the well for one step. Drones are of the void and never call this. */
export function wellDrag(well, f, dt) {
  const p = wellField(well, f.x, f.y);
  if (!p) return;
  const v = well.drag * p.k;
  f.x += p.ux * v * dt;
  f.y += p.uy * v * dt;
}

/** Has a body of radius `r` at (x, y) crossed the horizon? The ball counts by its centre, a fighter by half its body. */
export function wellSwallows(well, x, y, r = 0) {
  return Math.hypot(well.x - x, well.y - y) < well.r + r * 0.5;
}

/**
 * The combined pull of every gravity body at (x, y), in px/s², or null where
 * there is none. A hole on the golf course carries several; a level carries
 * one or none, and the sum is the same answer it always gave.
 */
export function wellsAccel(wells, x, y) {
  let ax = 0;
  let ay = 0;
  for (const w of wells) {
    const p = wellField(w, x, y);
    if (!p) continue;
    ax += p.ux * w.pull * p.k;
    ay += p.uy * w.pull * p.k;
  }
  return ax || ay ? { ax, ay } : null;
}

/** The first body whose horizon has (x, y) inside it, or null. A solid body has no horizon: its surface is a wall. */
export function swallowingWell(wells, x, y, r = 0) {
  for (const w of wells) if (!w.solid && wellSwallows(w, x, y, r)) return w;
  return null;
}

/** Drag a fighter toward every well that reaches them. */
export function wellsDrag(wells, f, dt) {
  for (const w of wells) if (w.drag) wellDrag(w, f, dt);
}

/** Every gravity body a level declares: its single `well`, or a hole's list (the cup last). */
export function levelWells(def) {
  const list = def.wells && def.wells.length ? def.wells : def.well ? [def.well] : [];
  return list.map((w) => ({
    x: w.x,
    y: w.y,
    r: w.r || 40,
    range: w.range || 400,
    pull: w.pull || 60000,
    drag: w.drag === undefined ? 45000 : w.drag,
    solid: !!w.solid,
    hazard: !!w.hazard,
    cup: def.cup ? w === def.cup : false,
    // A body on a rail: it circles (cx, cy) at R, once every `period` seconds, from `phase`.
    rail: w.rail ? { cx: w.rail.cx, cy: w.rail.cy, R: w.rail.R, period: w.rail.period, phase: w.rail.phase || 0 } : null,
  }));
}

/**
 * A solid body on a rail, as a mover: the physics sees a disc of wall
 * segments that moves with the body and lends the ball its speed, exactly as
 * a spinner's bar does. The body's field moves with it since the well's x and
 * y are the ones being driven. Runs from the start of the level, so a launch
 * is timed against it.
 */
export class StoneMover {
  constructor(well) {
    this.well = well;
    this.kind = 'stone';
    this.thick = 0;
    this.t = 0;
    this.angle = 0;
    this.omega = (Math.PI * 2) / well.rail.period;
    this.set(0);
  }

  set(t) {
    const r = this.well.rail;
    this.angle = r.phase + this.omega * t;
    this.well.x = r.cx + Math.cos(this.angle) * r.R;
    this.well.y = r.cy + Math.sin(this.angle) * r.R;
  }

  update(dt) {
    this.t += dt;
    this.set(this.t);
  }

  get x() {
    return this.well.x;
  }

  get y() {
    return this.well.y;
  }

  polygon() {
    return ellipse(this.well.x, this.well.y, this.well.r, this.well.r, 22);
  }

  segments() {
    const segs = polygonEdges(this.polygon(), 'planet');
    for (const sg of segs) sg.well = this.well;
    return segs;
  }

  /** The body's own velocity along its rail; every point of it moves alike. */
  surfaceVelocityAt() {
    const r = this.well.rail;
    return { x: -Math.sin(this.angle) * r.R * this.omega, y: Math.cos(this.angle) * r.R * this.omega };
  }
}

/** The solid outlines the ball is kept out of this step: the static ones, and every moving body's where it is now. */
export function solidPolysNow(g) {
  const moving = g.movers.filter((m) => m.polygon);
  return moving.length ? g.solidPolys.concat(moving.map((m) => m.polygon())) : g.solidPolys;
}

/** A phasing drone's clock: solid for `on` seconds, then intangible for `off`, from the start of the level. */
export function dronePhased(phasing, t) {
  const cycle = phasing.on + phasing.off;
  const at = (((t + (phasing.offset || 0)) % cycle) + cycle) % cycle;
  return at >= phasing.on;
}

/** A conduit is cleared when every node is lit and, if the objective asks, every drone is down. Switches are controls, not targets. */
export function objectiveDone(g) {
  // Versus and Blaster on a conduit's arena have no objective: a turret knocked out or a node lit there is scenery, not the end of the match.
  if (!g.def.conduit || g.pvp) return false;
  if (g.nodes.some((n) => n.kind !== 'switch' && !n.lit)) return false;
  if (g.objective.drones && g.drones.some((d) => !d.down)) return false;
  if (g.objective.turrets && g.turrets.some((t) => !t.down)) return false;
  return true;
}

/** How far behind the charge the launcher's centre sits: its shield, the muzzle gap and the charge's own radius. */
export function launcherReach(f) {
  return f.paddleBase + f.paddleThick / 2 + GOLF.muzzle + BALL.radius;
}

/**
 * Put the launcher behind the tee along its aim, so the charge resting on the
 * tee is the pivot: turning the frame swings the body round the charge and
 * the charge stays where it is.
 */
export function seatLauncher(f, tee) {
  const d = launcherReach(f);
  f.x = tee.x - Math.cos(f.angle) * d;
  f.y = tee.y - Math.sin(f.angle) * d;
  f.prevX = f.x;
  f.prevY = f.y;
}

/** Player ids in versus, in seating order: the host, then the guests by relay id. */
export const VERSUS_IDS = ['a', 'c', 'd'];

/**
 * Where `n` versus players start in `def`. Versus arenas list spawns per player
 * count; a campaign level uses its player and boss spawns (a conduit has only
 * the player's); any seat still missing goes to a fair clear spot.
 */
export function versusSpawns(def, n) {
  let list = def.spawns;
  if (list && !Array.isArray(list)) list = list[n] || list[Math.max(...Object.keys(list).map(Number))];
  const out = list ? list.slice(0, n).map((s) => ({ x: s.x, y: s.y, angle: s.angle })) : [{ x: def.player.x, y: def.player.y, angle: def.player.angle }];
  if (!list && def.boss) out.push({ x: def.boss.x, y: def.boss.y, angle: def.boss.angle });
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
  const r = MAX_HULL;
  const walls = polygonEdges(def.boundary).concat(...def.obstacles.map((o) => polygonEdges(obstaclePoly(o))));
  // Everywhere a mover gets to over one cycle, as segments (a long piston
  // sweeps a strip, not the disc its reach would suggest).
  const swept = [];
  const anchor = def.boss || def.player;
  (def.movers || []).forEach((spec, i) => {
    const m = createMover(spec);
    const period = m.period || 6;
    for (let k = 0; k < 24; k++) {
      m.update(period / 24, anchor.x, anchor.y);
      for (const sg of m.segments()) swept.push({ ...sg, thick: (m.thick || 0) + 8 });
    }
  });
  const clearance = (x, y) => {
    if (!pointInPolygon(x, y, def.boundary)) return -1;
    for (const o of def.obstacles) if (pointInPolygon(x, y, obstaclePoly(o))) return -1;
    // Nobody starts in a gravity well's reach.
    if (def.well && Math.hypot(def.well.x - x, def.well.y - y) < (def.well.range || 400)) return -1;
    let d = Infinity;
    for (const t of def.turrets || []) d = Math.min(d, Math.hypot(t.x - x, t.y - y) - (t.r || 22));
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

/** Event Horizon: how far a returned ball is kept from walls and moving parts, and from every fighter. */
export const RETURN_CLEAR = 36;
export const RETURN_FROM_FIGHTERS = 220;

/**
 * Where a ball the well took comes back (Event Horizon): a random spot in the
 * room, outside every well's pull, clear of walls, solids, moving parts and
 * fighters. Preferably one where the course it keeps (vx, vy) does not point
 * back at the well it fell into, so it is not taken again at once. Null when
 * no sample qualifies. `rand` is Math.random unless a test supplies one.
 */
export function wellReturnSpot(g, vx, vy, rand = Math.random) {
  const pts = g.def.boundary;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const r = g.ball.r;
  const segs = g.walls.concat(...g.movers.filter((m) => m.segments).map((m) => m.segments().map((sg) => ({ ...sg, thick: m.thick || 0 }))));
  const speed = Math.hypot(vx, vy) || 1;
  const away = [];
  const any = [];
  for (let i = 0; i < 120; i++) {
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    if (!pointInPolygon(x, y, pts)) continue;
    if (g.solidPolys.some((poly) => pointInPolygon(x, y, poly))) continue;
    if (segs.some((s) => {
      const q = closestPointOnSegment(x, y, s.ax, s.ay, s.bx, s.by);
      return Math.hypot(x - q.x, y - q.y) < r + RETURN_CLEAR + (s.thick || 0);
    })) continue;
    if (g.wells.some((w) => Math.hypot(x - w.x, y - w.y) < (w.range || w.r * 4))) continue;
    if (g.fighters.some((f) => !f.down && Math.hypot(x - f.x, y - f.y) < RETURN_FROM_FIGHTERS)) continue;
    const spot = { x, y };
    any.push(spot);
    const w = g.wells.reduce((best, c) => (!best || Math.hypot(x - c.x, y - c.y) < Math.hypot(x - best.x, y - best.y) ? c : best), null);
    const dx = w ? w.x - x : 0;
    const dy = w ? w.y - y : 0;
    const toward = w ? (vx * dx + vy * dy) / (speed * (Math.hypot(dx, dy) || 1)) : -1;
    if (toward < 0.5) away.push(spot); // not heading within 60 degrees of the well
  }
  const from = away.length ? away : any;
  return from.length ? from[Math.floor(rand() * from.length) % from.length] : null;
}

/** Colours a player can wear in versus, in order of preference after the level's own third colour. */
export const PLAYER_COLORS = ['#ff4fd8', '#ffb347', '#9dff5c', '#4d8dff', '#ffd23f', '#b98cff', '#ff4040', '#5ce1ff', '#ffffff'];
/** Two colours closer than this (on colorDistance's scale) are too alike to tell apart at a glance. */
export const COLOR_APART = 110;

/**
 * The seats' colours in versus. None is the level's wall or obstacle colour,
 * or close to it: a player's wormholes sit in those surfaces and must stand
 * out from them, and a fighter against a wall of its own colour is hard to
 * read anyway. The level's own third colour comes first where it qualifies,
 * then a fixed list, each at least COLOR_APART from the others. Should a
 * level's colours rule out too many, the players' distance from each other is
 * relaxed first and their distance from the walls last.
 */
export function versusColors(def) {
  const avoid = [def.palette.wall, def.palette.obstacle].filter(Boolean);
  const pool = [def.palette.third, COOP.allyColors[1], ...PLAYER_COLORS].filter(Boolean);
  for (const [fromWalls, fromEachOther] of [[COLOR_APART, COLOR_APART], [COLOR_APART, 70], [80, 50], [0, 0]]) {
    const out = [];
    for (const c of pool) {
      if (out.includes(c)) continue;
      if (avoid.some((a) => colorDistance(a, c) < fromWalls)) continue;
      if (out.some((o) => colorDistance(o, c) < fromEachOther)) continue;
      out.push(c);
      if (out.length === 3) return out;
    }
  }
  return PLAYER_COLORS.slice(0, 3);
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
export function createGameState(def, { pvp = false, coop = false, volley = false, portals = false, rules = DEFAULT_RULES, spawns = null, frames = null, maxSpeed = null } = {}) {
  const frameFor = (slot) => (frames && frames[slot]) || STANDARD;
  const allyCount = coop === true ? 1 : Math.max(0, Math.min(COOP.maxAllies, Number(coop) || 0));
  const pvpCount = pvp === true ? 2 : Math.max(0, Math.min(VERSUS_IDS.length, Number(pvp) || 0));
  pvp = pvpCount > 0;
  const staticWalls = polygonEdges(def.boundary, 'wall');
  const panes = [];
  for (const o of def.obstacles) {
    if (o.glass) {
      // A pane may be unbreakable (it reflects at any speed) or carry its own break speed.
      const pane = { poly: o.poly, color: o.color, broken: false, regrowAt: 0, unbreakable: !!o.unbreakable, breakSpeed: o.breakSpeed || null, segs: polygonEdges(o.poly, 'glass') };
      for (const sg of pane.segs) sg.pane = pane;
      panes.push(pane);
    } else {
      staticWalls.push(...polygonEdges(obstaclePoly(o), 'obstacle'));
    }
  }
  // Nodes (conduit targets) are small solid discs the ball bounces off; the
  // wall segments remember their node so a bounce can light it. Versus strips
  // a conduit to its hazards: no nodes, no doors (only a switch node would
  // ever open one) and no drones; turrets, emitters, vents, glass and the
  // well stay.
  const nodes = (pvp ? [] : def.nodes || []).map((n, i) => ({ ...n, i, r: n.r || 24, lit: false }));
  const nodePolys = nodes.map((n) => ellipse(n.x, n.y, n.r, n.r, 16));
  nodes.forEach((n, i) => {
    const segs = polygonEdges(nodePolys[i], 'node');
    for (const sg of segs) sg.node = n;
    staticWalls.push(...segs);
  });
  // Doors: slabs a switch node opens and closes; closed ones are walls (see rebuildWalls).
  const doors = (pvp ? [] : def.doors || []).map((d, i) => {
    const poly = obstaclePoly(d);
    const door = { poly, closed: d.open !== true, i, segs: polygonEdges(poly, 'door') };
    for (const sg of door.segs) sg.door = door;
    return door;
  });
  // Emitters: the Beacon's pulse, planted in the floor at fixed points.
  const emitters = (def.emitters || []).map((e, i) => ({ x: e.x, y: e.y, i, delay: e.delay === undefined ? 2 : e.delay, pulser: new Pulser(e) }));
  // Turrets sit in the wall as solid discs; a deflected shot into one knocks it out.
  const turrets = (def.turrets || []).map((t, i) => ({ x: t.x, y: t.y, r: t.r || 22, period: t.period || 4, delay: t.delay || 1, speed: t.speed || 260, life: t.life || 6, i, nextAt: t.delay || 1, down: false, aim: t.aim || 0 }));
  const turretPolys = turrets.map((t) => ellipse(t.x, t.y, t.r, t.r, 14));
  turrets.forEach((t, i) => {
    const segs = polygonEdges(turretPolys[i], 'turret');
    for (const sg of segs) sg.turret = t;
    staticWalls.push(...segs);
  });
  // Gravity bodies. A solid one (a golf hole's planet) is a wall as well as a
  // field: its surface bounces the ball while its pull bends everything near.
  const wells = levelWells(def);
  const wellPolys = [];
  for (const w of wells) {
    if (!w.solid || w.rail) continue;
    const poly = ellipse(w.x, w.y, w.r, w.r, 22);
    const segs = polygonEdges(poly, 'planet');
    for (const sg of segs) sg.well = w;
    staticWalls.push(...segs);
    wellPolys.push(poly);
  }
  // A solid body on a rail is a mover, not a wall.
  const movers = (def.movers || []).map(createMover).concat(wells.filter((w) => w.solid && w.rail).map((w) => new StoneMover(w)));
  let player;
  let boss;
  let fighters;
  const allies = [];
  let drones = [];
  if (def.golf) {
    // A hole has no opponent. The one human is the launcher: it stands on the
    // tee, turns to aim and never moves, whatever frame it wears.
    player = new Fighter({ ...playerStats(def, def.player, frameFor('a')), moveSpeed: 0, name: 'You', kind: 'player', slot: 'a', team: 'us', color: def.palette.wall });
    seatLauncher(player, def.tee);
    boss = null;
    fighters = [player];
  } else if (pvp) {
    // Every player for themselves: each human is its own team, seated at the
    // spawns in order (the host first). `boss` stays an alias for the second
    // seat so shared code has something to point at.
    // A seat may name its player (`id`) and colour, as when survivors of an
    // elimination match are reseated; otherwise seats go to a, c, d in order.
    const seats = spawns || versusSpawns(def, pvpCount);
    const colors = versusColors(def);
    const rivals = seats.slice(0, pvpCount).map((seat, i) => {
      const id = seat.id || VERSUS_IDS[i];
      return new Fighter({ ...playerStats(def, seat, frameFor(id)), name: i === 0 ? 'You' : `Rival ${i}`, kind: 'player', slot: id, team: id, color: seat.color || colors[VERSUS_IDS.indexOf(id)] || colors[i] });
    });
    player = rivals[0];
    boss = rivals[1];
    fighters = rivals;
  } else {
    player = new Fighter({ ...playerStats(def, def.player, frameFor('a')), name: 'You', kind: 'player', slot: 'a', team: 'us', color: def.palette.wall });
    // One boss, or a conduit's drones (the first doubles as `boss` for code that wants one).
    drones = enemySpecs(def).map((spec, i) => new Boss({ ...spec, name: i === 0 ? def.bossName : `${def.bossName} ${i + 1}`, color: def.palette.obstacle, slot: DRONE_SLOTS[i], team: 'boss' }));
    boss = drones[0];
    const taken = [];
    for (let i = 0; i < allyCount; i++) {
      const spawn = findAllySpawn(def, movers, taken);
      taken.push(spawn);
      allies.push(new Fighter({ ...playerStats(def, spawn, frameFor('cd'[i])), name: `Ally ${i + 1}`, kind: 'player', slot: 'cd'[i], team: 'us', color: COOP.allyColors[i] }));
    }
    fighters = [player, ...allies, ...drones];
  }
  const ally = allies[0] || null;
  const humans = pvp ? fighters.slice() : [player, ...allies];
  // Where each human started: the well puts a player it swallows back there.
  for (const f of humans) f.spawn = { x: f.x, y: f.y, angle: f.angle };
  // Blaster: everyone starts the round armed.
  for (const f of humans) {
    f.charged = !!volley;
    f.chargeAt = 0;
  }
  for (const d of drones) if (d.phasing) d.phased = dronePhased(d.phasing, 0);
  // `well` is the one body a level carries, kept for everything written before
  // a hole could carry several; `wells` is the list the physics reads.
  const well = def.well ? wells[0] : null;
  // Wormholes: paired mouths that hand the charge on at the heading it arrived with.
  const wormholes = (def.wormholes || []).map((w, i) => ({ ax: w.ax, ay: w.ay, bx: w.bx, by: w.by, r: w.r || 36, color: w.color || null, oneWay: !!w.oneWay, i }));
  const ice = def.ice ? new IceTrail(def.ice) : null;
  // Coolant vents: each drops a patch of ice every `period` seconds, the first after `delay`.
  const vents = (def.vents || []).map((v, i) => ({ x: v.x, y: v.y, r: v.r || 48, period: v.period || 7, delay: v.delay || 0, i, nextAt: v.delay || 0 }));
  const ball = new Ball(BALL.radius);
  ball.x = def.ball.x;
  ball.y = def.ball.y;
  ball.held = true;
  const staticPolys = def.obstacles.filter((o) => !o.glass).map(obstaclePoly).concat(nodePolys, turretPolys, wellPolys);
  const objective = { nodes: nodes.length, drones: def.objective && def.objective.drones ? drones.length : 0, turrets: def.objective && def.objective.turrets && !pvp ? turrets.length : 0 };
  // The frame each human seat wears, so the HUD and the tests can read it back.
  const wornFrames = {};
  for (const f of humans) wornFrames[f.slot] = frameFor(f.slot);
  const g = { def, staticWalls, staticPolys, panes, doors, walls: [], solidPolys: [], player, ally, allies, boss, drones, nodes, turrets, emitters, shots: [], objective, fighters, humans, movers, ice, vents, well, wells, wormholes, golf: null, frames: wornFrames, ball, volley: !!volley && pvp, portals: portals && volley && pvp ? {} : null, maxSpeed: maxSpeed || def.maxBallSpeed || BALL.maxSpeed, pvp, players: pvpCount, coop: !pvp && allyCount > 0, rules: { ...DEFAULT_RULES, ...rules } };
  rebuildWalls(g);
  return g;
}

/** Recompute the active wall list (static walls plus unbroken glass). */
export function rebuildWalls(g) {
  const whole = g.panes.filter((p) => !p.broken);
  const shut = (g.doors || []).filter((d) => d.closed);
  g.walls = g.staticWalls.concat(...whole.map((p) => p.segs), ...shut.map((d) => d.segs));
  g.solidPolys = g.staticPolys.concat(whole.map((p) => p.poly), shut.map((d) => d.poly));
}
