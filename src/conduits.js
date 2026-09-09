// Conduits: the code that carries you from one level to the next. Smaller,
// sparer rooms between the ten levels, each built from a fragment of the level
// it leads to, with the ball capped at half speed so aim matters more than
// reaction. There is no boss to kill: a conduit is cleared when its objective
// is done, usually a set of nodes lit by the ball.
//
// Node kinds (see nodeAccepts in gamestate.js):
//   plain      any touch lights it
//   ricochet   only a ball that bounced off a wall since its last shield touch
//   hooded     only a ball arriving from the node's open side (`open` radians,
//              `arc` degrees wide)
//   fast       only a ball at or above `minSpeed`
//
// Drones are Boss-brained enemies; `objective.drones` makes downing them part
// of the objective (otherwise they are obstacles that can be knocked out).
import { LEVELS, rect } from './levels.js';
import { BALL } from './config.js';

export const CONDUIT_MAX_SPEED = BALL.maxSpeed / 2;

/** The drone shared by the early conduits: it holds a spot and turns to block, nothing more. */
function sentry(x, y, angle, extra = {}) {
  return {
    x,
    y,
    angle,
    r: 26,
    paddleWidth: 110,
    paddleBase: 38,
    paddleThick: 6,
    moveSpeed: 0,
    turnSpeed: 3.2,
    reaction: 0.3,
    anticipation: { commit: 0.3, swing: false, error: 8 },
    aggression: 0,
    aim: 0.3,
    absorb: 0,
    absorbSpeed: 500,
    threatRadius: 320,
    blockRadius: 100,
    safeRadius: 0,
    leash: 0,
    lungeExtend: 16,
    lungeSpeed: 120,
    ...extra,
  };
}

export const CONDUITS = [
  {
    id: 1.5,
    after: 1,
    conduit: true,
    title: 'Lens Gallery',
    bossName: 'Sentry',
    intro: 'A narrow gallery on the way to the Vault, with one small prism spinning at its heart. Three nodes wait in the corners, and no straight line reaches the ones that count. Light them all.',
    record: 'The gallery is where the Vault tests what comes toward it. A lens, three nodes, and a sentry that only knows how to turn.',
    stopped: 'The gallery is lit. The Vault knows you are coming, and that you can bend a shot.',
    width: 1400,
    height: 800,
    track: 'prism',
    maxBallSpeed: CONDUIT_MAX_SPEED,
    palette: {
      floor: '#070a18',
      grid: 'rgba(120, 180, 255, 0.10)',
      wall: '#9fd8ff',
      wallDark: '#102a48',
      obstacle: '#ffd98a',
      obstacleDark: '#3a2e10',
      node: '#6e7fa8',
      nodeLit: '#7dffc4',
    },
    boundary: [
      [60, 140],
      [140, 60],
      [1260, 60],
      [1340, 140],
      [1340, 660],
      [1260, 740],
      [140, 740],
      [60, 660],
    ],
    obstacles: [
      // Mirror plates: the banks that reach the nodes.
      rect(470, 250, 150, 20, 35),
      rect(470, 550, 150, 20, -35),
      rect(1020, 560, 150, 20, -30),
      // A short screen keeps the hooded node's open side off the straight lane.
      rect(900, 300, 20, 150, 0),
    ],
    movers: [{ type: 'spinner', x: 700, y: 400, length: 150, thick: 8, omega: 0.4, angle: 0.2 }],
    nodes: [
      { x: 700, y: 130, kind: 'plain' },
      { x: 1180, y: 640, kind: 'ricochet' },
      { x: 1010, y: 210, kind: 'hooded', open: 0, arc: 110 },
    ],
    drones: [sentry(1200, 210, Math.PI)],
    player: { x: 260, y: 400, angle: 0 },
    ball: { x: 480, y: 400, speed: 400, angleDeg: 0 },
  },
];

/** Every playable room in campaign order: each level, then the conduit that follows it. */
export const SEQUENCE = LEVELS.flatMap((lvl) => [lvl, ...CONDUITS.filter((c) => c.after === lvl.id)]);

/** "Level 3" or "Conduit 3½". */
export function levelLabel(def) {
  return def.conduit ? `Conduit ${shortId(def)}` : `Level ${def.id}`;
}

/** "03" for a level, "3½" for the conduit after it. */
export function shortId(def) {
  return def.conduit ? `${Math.floor(def.id)}½` : String(def.id).padStart(2, '0');
}

/**
 * The next stop in a campaign after SEQUENCE[index]: the following room in
 * full mode, the following level in short mode. -1 when the campaign is over.
 */
export function campaignNextIndex(index, mode = 'short') {
  for (let i = index + 1; i < SEQUENCE.length; i++) {
    if (mode === 'full' || !SEQUENCE[i].conduit) return i;
  }
  return -1;
}
