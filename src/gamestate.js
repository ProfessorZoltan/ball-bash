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
export function createGameState(def, { pvp = false } = {}) {
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
  const g = { def, staticWalls, panes, walls: [], player, boss, movers, ice, ball, pvp };
  rebuildWalls(g);
  return g;
}

/** Recompute the active wall list (static walls plus unbroken glass). */
export function rebuildWalls(g) {
  g.walls = g.staticWalls.concat(...g.panes.filter((p) => !p.broken).map((p) => p.segs));
}
