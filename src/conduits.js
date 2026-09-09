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

CONDUITS.push({
  id: 2.5,
  after: 2,
  conduit: true,
  title: 'Condensers',
  bossName: 'Sump-ling',
  intro: 'Two chambers joined by one tunnel that breathes. Coolant vents in the floor drip ice on their own clocks, and the two sump-lings across the tunnel leave ice behind every block. Knock both out before the floor runs out.',
  record: 'Condensers feed the Tunnels their cold. The sump-lings are what the Sump was before it grew: small, slow, and never far from a puddle of ice.',
  stopped: 'Both sump-lings are down and the vents run dry. The Tunnels ahead will be colder still.',
  width: 1600,
  height: 900,
  track: 'coolant',
  maxBallSpeed: CONDUIT_MAX_SPEED,
  palette: {
    floor: '#050d10',
    grid: 'rgba(120, 255, 220, 0.08)',
    wall: '#8fe8d8',
    wallDark: '#0c3a34',
    obstacle: '#ffb347',
    obstacleDark: '#3a2410',
    ice: '#cdf6ff',
  },
  // A dumbbell: two chambers and the one tunnel between them (y 380 to 520).
  boundary: [
    [60, 160],
    [140, 80],
    [600, 80],
    [680, 160],
    [680, 380],
    [920, 380],
    [920, 160],
    [1000, 80],
    [1460, 80],
    [1540, 160],
    [1540, 740],
    [1460, 820],
    [1000, 820],
    [920, 740],
    [920, 520],
    [680, 520],
    [680, 740],
    [600, 820],
    [140, 820],
    [60, 740],
  ],
  obstacles: [
    // A pillar for the sump-lings to hide behind, and two diamonds on the player's side.
    rect(1230, 450, 26, 220, 0),
    rect(370, 260, 50, 50, 45),
    rect(370, 640, 50, 50, 45),
  ],
  // The tunnel door: a slab that slides down out of the rock to close the tunnel, then back.
  movers: [{ type: 'piston', parallel: true, x: 800, y: 300, length: 150, thick: 10, axisAngle: Math.PI / 2, amp: 150, period: 6, phase: 0 }],
  ice: { lay: 1.6, life: 2.5, freeze: 1.5, width: 30, patchLife: 5 },
  vents: [
    { x: 250, y: 250, period: 7, delay: 2 },
    { x: 250, y: 650, period: 7, delay: 4.3 },
    { x: 560, y: 300, period: 7, delay: 6.6 },
    { x: 1100, y: 450, period: 7, delay: 3 },
    { x: 1400, y: 280, period: 7, delay: 5.5 },
    { x: 1400, y: 620, period: 7, delay: 1 },
  ],
  drones: [sentry(1300, 300, Math.PI, sumpling()), sentry(1300, 600, Math.PI, sumpling())],
  objective: { drones: true },
  player: { x: 300, y: 450, angle: 0 },
  ball: { x: 520, y: 450, speed: 400, angleDeg: 0 },
});

/** The Sump's little cousins: slow, wide, and inclined to soak a fast ball up rather than return it. */
function sumpling() {
  return { r: 30, paddleWidth: 120, paddleBase: 40, paddleThick: 7, moveSpeed: 90, turnSpeed: 2.6, reaction: 0.34, aggression: 0.1, aim: 0.4, absorb: 0.5, absorbSpeed: 480, leash: 150, threatRadius: 340, blockRadius: 100, safeRadius: 200, anticipation: { commit: 0.3, swing: false, error: 9 } };
}

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
