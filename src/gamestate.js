// DOM-free construction of a level's live objects, shared by the game, the
// multiplayer guest mirror and the tests.
import { Ball, Fighter, Boss, createMover } from './entities.js';
import { IceTrail } from './ice.js';
import { polygonEdges } from './physics.js';
import { obstaclePoly } from './levels.js';
import { BALL, PLAYER } from './config.js';

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
  return ball.lastPaddle !== fighter.kind;
}

export function createGameState(def, { pvp = false, rules = DEFAULT_RULES } = {}) {
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
  const player = new Fighter({ ...playerStats(def, def.player), name: 'You', kind: 'player', color: def.palette.wall });
  const boss = pvp
    ? new Fighter({ ...playerStats(def, def.boss), name: 'Rival', kind: 'boss', color: def.palette.obstacle })
    : new Boss({ ...def.boss, name: def.bossName, color: def.palette.obstacle });
  const movers = (def.movers || []).map(createMover);
  const ice = def.ice ? new IceTrail(def.ice) : null;
  const ball = new Ball(BALL.radius);
  ball.x = def.ball.x;
  ball.y = def.ball.y;
  ball.held = true;
  const staticPolys = def.obstacles.filter((o) => !o.glass).map(obstaclePoly);
  const g = { def, staticWalls, staticPolys, panes, walls: [], solidPolys: [], player, boss, movers, ice, ball, pvp, rules: { ...DEFAULT_RULES, ...rules } };
  rebuildWalls(g);
  return g;
}

/** Recompute the active wall list (static walls plus unbroken glass). */
export function rebuildWalls(g) {
  const whole = g.panes.filter((p) => !p.broken);
  g.walls = g.staticWalls.concat(...whole.map((p) => p.segs));
  g.solidPolys = g.staticPolys.concat(whole.map((p) => p.poly));
}
