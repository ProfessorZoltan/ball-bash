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
import { LEVELS, rect, ellipse, arc } from './levels.js';
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

CONDUITS.push({
  id: 3.5,
  after: 3,
  conduit: true,
  title: 'Orbit Deck',
  bossName: 'Understudy',
  intro: 'A ring around a dead core, two shield plates circling it, and turrets in the wall that throw slow fire at whatever moves. The core only counts when the ball gets through the gap. Catch a turret\'s shot on your shield and send it home.',
  record: 'The Reactor keeps its spares on the Orbit Deck: plates that learned to circle, turrets that learned to lead a target, and an understudy walking the Sentinel\'s rounds.',
  stopped: 'The core is lit and both turrets are dark. The Reactor\'s spares are spent; the real thing waits inside.',
  width: 1600,
  height: 900,
  track: 'reactor',
  maxBallSpeed: CONDUIT_MAX_SPEED,
  palette: {
    floor: '#080810',
    grid: 'rgba(160, 180, 255, 0.08)',
    wall: '#9fb8ff',
    wallDark: '#1a2040',
    obstacle: '#ff6b4a',
    obstacleDark: '#3a1a10',
    node: '#7080a8',
    nodeLit: '#7dffc4',
    turret: '#ffb347',
    shot: '#ff9f6a',
  },
  boundary: ellipse(800, 450, 745, 415, 44),
  obstacles: [],
  // Two plates on a tight, quick orbit around the core: the gap comes round every couple of seconds.
  movers: [{ type: 'orbiter', x: 800, y: 450, radius: 140, count: 2, length: 120, thick: 8, omega: 0.9, angle: 0.4 }],
  nodes: [{ x: 800, y: 450, r: 30, kind: 'plain' }],
  // Turrets in the far wall, upper and lower right, so their fire crosses the core's gap.
  turrets: [
    { x: 1348, y: 194, period: 4, delay: 3.5, speed: 260, life: 6 },
    { x: 1348, y: 706, period: 4, delay: 5.5, speed: 260, life: 6 },
  ],
  // The Sentinel's understudy walks the same patrol, smaller and slower, and only blocks.
  drones: [
    sentry(1200, 450, Math.PI, {
      r: 26,
      moveSpeed: 150,
      turnSpeed: 3,
      leash: 120,
      threatRadius: 300,
      blockRadius: 90,
      orbit: { cx: 800, cy: 450, rx: 420, ry: 250, omega: 0.18, phase: 0 },
    }),
  ],
  objective: { turrets: true },
  player: { x: 260, y: 450, angle: 0 },
  ball: { x: 480, y: 450, speed: 400, angleDeg: 0 },
});

CONDUITS.push({
  id: 4.5,
  after: 4,
  conduit: true,
  title: 'Signal Box',
  bossName: 'Shunter cart',
  intro: 'Three yards in a row, a shut door between each, and a switch that opens the next one. Two shunter carts run the rails across the yards and block whatever crosses. Set the route, one accurate shot at a time, then send the ball home.',
  record: 'The Signal Box sets the Switchyard\'s routes. Its carts are the Shunter\'s rolling stock: no engine of their own, just a rail and a grudge.',
  stopped: 'The route is set and the exit is lit. The Switchyard\'s doors will not wait for a switch.',
  width: 1600,
  height: 900,
  track: 'switchyard',
  maxBallSpeed: CONDUIT_MAX_SPEED,
  palette: {
    floor: '#0a0a0e',
    grid: 'rgba(255, 200, 120, 0.07)',
    wall: '#ffd166',
    wallDark: '#3a2e10',
    obstacle: '#7fe9ff',
    obstacleDark: '#0d2a40',
    node: '#8a7a5a',
    nodeLit: '#7dffc4',
    door: '#ff8c42',
    doorDark: '#3a1e0c',
    rail: '#c9b27a',
  },
  boundary: [
    [60, 140],
    [140, 60],
    [1460, 60],
    [1540, 140],
    [1540, 760],
    [1460, 840],
    [140, 840],
    [60, 760],
  ],
  obstacles: [
    // Two yard walls with a doorway in the middle of each, and the stub that closes off the exit bay.
    rect(560, 220, 24, 320, 0),
    rect(560, 680, 24, 320, 0),
    rect(1060, 220, 24, 320, 0),
    rect(1060, 680, 24, 320, 0),
    rect(1380, 720, 20, 240, 0),
  ],
  // Doors start shut; each switch flips one. The exit bay's door lies across its top.
  doors: [rect(560, 450, 24, 140, 0), rect(1060, 450, 24, 140, 0), rect(1465, 600, 150, 20, 0)],
  nodes: [
    { x: 480, y: 160, kind: 'switch', toggles: [0] },
    { x: 1000, y: 740, kind: 'switch', toggles: [1] },
    { x: 1480, y: 160, kind: 'switch', toggles: [2] },
    { x: 1465, y: 730, kind: 'plain' },
  ],
  drones: [
    sentry(810, 450, Math.PI, cart({ ax: 810, ay: 160, bx: 810, by: 740 })),
    sentry(1300, 450, Math.PI, cart({ ax: 1300, ay: 160, bx: 1300, by: 740 })),
  ],
  player: { x: 200, y: 450, angle: 0 },
  ball: { x: 330, y: 450, speed: 400, angleDeg: 0 },
});

/** A shunter cart: bound to a rail, quick along it, and there to block. */
function cart(rail) {
  return { rail, moveSpeed: 150, turnSpeed: 3, leash: 600, threatRadius: 420, blockRadius: 90, safeRadius: 0, reaction: 0.28, anticipation: { commit: 0.4, swing: false, error: 7 } };
}

CONDUITS.push({
  id: 5.5,
  after: 5,
  conduit: true,
  title: 'Reliquary',
  bossName: 'Chorister',
  intro: 'A short nave ending in an apse walled off by three panes of stained glass. Only the amber pane breaks, and only to a hard strike; the others turn any ball away. Break it, then reach the relic behind it before the glass heals. Two choristers drift the nave and block.',
  record: 'The Reliquary keeps what the Cathedral will not show. Three panes, one of them honest, and a pair of choristers who sing the glass back together.',
  stopped: 'The relic is lit and the amber pane lies in pieces. The Cathedral has heard the glass break; it will not be surprised twice.',
  width: 1600,
  height: 900,
  track: 'cathedral',
  maxBallSpeed: CONDUIT_MAX_SPEED,
  palette: {
    floor: '#0b0814',
    grid: 'rgba(200, 160, 255, 0.07)',
    wall: '#d8c8ff',
    wallDark: '#2a1e4a',
    obstacle: '#b892ff',
    obstacleDark: '#2a1a40',
    node: '#7a6a9a',
    nodeLit: '#ffd98a',
  },
  // The nave (x 60 to 1300) opens into a rounded apse on the right.
  boundary: [
    [60, 280],
    [140, 200],
    [1300, 200],
    ...arc(1300, 450, 240, 250, -Math.PI / 2, Math.PI / 2, 16).slice(1, -1),
    [1300, 700],
    [140, 700],
    [60, 620],
  ],
  // Columns down the nave for banks, and the three panes across the apse mouth.
  obstacles: [
    rect(560, 300, 40, 40, 45),
    rect(560, 600, 40, 40, 45),
    rect(920, 300, 40, 40, 45),
    rect(920, 600, 40, 40, 45),
    { poly: rect(1300, 283, 16, 167, 0), color: '#7fb2ff', glass: true, unbreakable: true },
    { poly: rect(1300, 450, 16, 167, 0), color: '#ffc46b', glass: true },
    { poly: rect(1300, 617, 16, 167, 0), color: '#c58bff', glass: true, unbreakable: true },
  ],
  // Under the half-speed cap only a clean strike reaches 600; the pane heals four seconds later.
  glass: { breakSpeed: 600, regrow: 4, speedKeep: 0.8 },
  nodes: [{ x: 1470, y: 450, r: 26, kind: 'plain' }],
  drones: [
    sentry(800, 330, Math.PI, chorister({ cx: 800, cy: 450, rx: 300, ry: 130, omega: 0.28, phase: 0 })),
    sentry(800, 570, Math.PI, chorister({ cx: 800, cy: 450, rx: 300, ry: 130, omega: 0.28, phase: Math.PI })),
  ],
  player: { x: 260, y: 450, angle: 0 },
  ball: { x: 460, y: 450, speed: 400, angleDeg: 0 },
});

/** A chorister: drifts a slow loop across the nave and blocks what it can reach. */
function chorister(orbit) {
  return { r: 24, paddleWidth: 100, moveSpeed: 130, turnSpeed: 3, leash: 140, threatRadius: 320, blockRadius: 90, safeRadius: 0, reaction: 0.3, orbit, anticipation: { commit: 0.3, swing: false, error: 8 } };
}

CONDUITS.push({
  id: 6.5,
  after: 6,
  conduit: true,
  title: 'Lamplighter',
  bossName: 'Lantern',
  intro: 'The stair down to the crypt, unlit. Five candles stand dark around the columns; each one you strike lights its corner, and the way out only shows itself once the candles beside it burn. Two lanterns walk the dark and shutter their light while they move. No guide line here: shoot from what you remember.',
  record: 'The lamplighter went down before the Sexton and never came back up. The candles are its work. The lanterns were its company.',
  stopped: 'Every candle burns and the stair is lit. The Undercroft below is darker than this, and the Sexton keeps it that way.',
  width: 1600,
  height: 900,
  track: 'undercroft',
  maxBallSpeed: CONDUIT_MAX_SPEED,
  noGuide: true,
  palette: {
    floor: '#06060a',
    grid: 'rgba(200, 180, 140, 0.06)',
    wall: '#c8b8a0',
    wallDark: '#2a2418',
    obstacle: '#8a7a66',
    obstacleDark: '#1a1610',
    node: '#5a5040',
    nodeLit: '#ffd27a',
  },
  dark: { ambient: 0.06, player: 210, boss: 150, ball: 120, candle: 170, hidden: 26 },
  boundary: [
    [60, 140],
    [140, 60],
    [1460, 60],
    [1540, 140],
    [1540, 760],
    [1460, 840],
    [140, 840],
    [60, 760],
  ],
  // A forest of vault columns.
  obstacles: [
    rect(520, 260, 44, 44, 45),
    rect(520, 640, 44, 44, 45),
    rect(800, 300, 44, 44, 45),
    rect(800, 600, 44, 44, 45),
    rect(1080, 260, 44, 44, 45),
    rect(1080, 640, 44, 44, 45),
    rect(1300, 450, 44, 44, 45),
  ],
  nodes: [
    { x: 300, y: 160, r: 20, kind: 'candle' },
    { x: 300, y: 740, r: 20, kind: 'candle' },
    { x: 800, y: 450, r: 20, kind: 'candle' },
    { x: 1300, y: 160, r: 20, kind: 'candle' },
    { x: 1300, y: 740, r: 20, kind: 'candle' },
    // The way out: dark and deaf until the two candles beside it burn.
    { x: 1450, y: 450, r: 26, kind: 'plain', requires: [3, 4] },
  ],
  drones: [
    sentry(1000, 250, Math.PI, lantern({ cx: 1000, cy: 450, rx: 320, ry: 220, omega: 0.22, phase: 0 })),
    sentry(1000, 650, Math.PI, lantern({ cx: 1000, cy: 450, rx: 320, ry: 220, omega: 0.22, phase: Math.PI })),
  ],
  player: { x: 220, y: 450, angle: 0 },
  ball: { x: 420, y: 450, speed: 400, angleDeg: 0 },
});

/** A lantern: walks a loop in the dark with its light shuttered, and shows it only when it stands still or blocks. */
function lantern(orbit) {
  return { r: 24, paddleWidth: 100, moveSpeed: 120, turnSpeed: 3, leash: 140, threatRadius: 300, blockRadius: 90, safeRadius: 0, reaction: 0.3, orbit, lantern: true, anticipation: { commit: 0.3, swing: false, error: 8 } };
}

CONDUITS.push({
  id: 7.5,
  after: 7,
  conduit: true,
  title: 'Relay Mast',
  bossName: 'Relay',
  intro: 'A mast splits the room and the only lane is over its top. Two emitters in the floor pulse out of phase, and every ring flings the ball away from it: wait for the silence, or ride a ring over the mast. The turrets fire on the same beat. The receiver on the far side takes the ball from above and nowhere else.',
  record: 'The Relay Mast carries the Beacon\'s signal down the line. Two emitters keep its time, and the turrets learned the rhythm from them.',
  stopped: 'The receiver is lit and the mast is quiet. The Spire above has heard its own signal come back.',
  width: 1600,
  height: 900,
  track: 'spire',
  maxBallSpeed: CONDUIT_MAX_SPEED,
  palette: {
    floor: '#080c14',
    grid: 'rgba(255, 120, 200, 0.07)',
    wall: '#ff8df0',
    wallDark: '#3a1a34',
    obstacle: '#7fe9ff',
    obstacleDark: '#0d2a40',
    node: '#7a6a8a',
    nodeLit: '#7dffc4',
    turret: '#ffb347',
    shot: '#ff9f6a',
    emitter: '#ff8df0',
  },
  boundary: [
    [60, 140],
    [140, 60],
    [1460, 60],
    [1540, 140],
    [1540, 760],
    [1460, 840],
    [140, 840],
    [60, 760],
  ],
  // The mast: floor to two thirds of the way up, with a cap that widens it at the top.
  obstacles: [rect(800, 580, 40, 520, 0), rect(800, 330, 120, 24, 0)],
  // Two emitters, half a period apart, each with a turret that fires just after its pulse.
  emitters: [
    { x: 450, y: 640, period: 5, speed: 340, maxRadius: 330, thick: 8, warn: 0.8, delay: 5 },
    { x: 1150, y: 640, period: 5, speed: 340, maxRadius: 330, thick: 8, warn: 0.8, delay: 7.5 },
  ],
  turrets: [
    { x: 1348, y: 194, period: 5, delay: 5.4, speed: 260, life: 6 },
    { x: 1348, y: 706, period: 5, delay: 7.9, speed: 260, life: 6 },
  ],
  // The receiver takes the ball from above and to the left, the way a lob over the mast arrives.
  nodes: [{ x: 1420, y: 470, r: 28, kind: 'hooded', open: (-3 * Math.PI) / 4, arc: 120 }],
  drones: [sentry(1250, 360, Math.PI, { moveSpeed: 100, leash: 160, threatRadius: 320, blockRadius: 90 })],
  player: { x: 260, y: 450, angle: 0 },
  ball: { x: 460, y: 450, speed: 400, angleDeg: -35 },
});

CONDUITS.push({
  id: 8.5,
  after: 8,
  conduit: true,
  title: 'Event Horizon',
  bossName: 'Umbra',
  intro: 'A chamber at the edge of the void, and the void pulls. Inside the dotted ring everything drifts toward the well at the centre: the ball bends around it, you drift after it, and past the horizon nothing comes back. A shadow circles the well and is only there three seconds in five. Knock it out while it is, and light the node on the far side. The chamber breathes, top and bottom.',
  record: 'The well is what the grid found when it looked past its own edge: a place with no walls where every straight line still bends. The shadow circling it is a first draft of the Absence.',
  stopped: 'The shadow is gone and the node beyond the well is lit. Nullspace is what remains when even the well is taken away.',
  width: 1600,
  height: 900,
  track: 'nullspace',
  maxBallSpeed: CONDUIT_MAX_SPEED,
  palette: {
    floor: '#000000',
    grid: 'rgba(120, 140, 200, 0.07)',
    wall: '#7fe9ff',
    boundary: '#14141f',
    wallDark: '#000000',
    obstacle: '#e9e9ff',
    obstacleDark: '#101018',
    obstacleFill: '#05050a',
    node: '#4a4a6a',
    nodeLit: '#7dffc4',
    well: '#b49cff',
  },
  boundary: [[40, 40], [1560, 40], [1560, 860], [40, 860]],
  obstacles: [],
  // Two of the breathing walls Nullspace has eight of: the top and the bottom slide in 100 px and back over six seconds.
  movers: [
    { type: 'piston', x: 800, y: 50, length: 1520, thick: 10, axisAngle: Math.PI / 2, amp: 100, period: 6, phase: 0 },
    { type: 'piston', x: 800, y: 850, length: 1520, thick: 10, axisAngle: -Math.PI / 2, amp: 100, period: 6, phase: 0 },
  ],
  // The well: `r` is the horizon, `range` where the pull begins, `pull` the ball's acceleration and `drag` a player's drift, both over distance.
  well: { x: 800, y: 450, r: 40, range: 420, pull: 60000, drag: 45000 },
  // The node sits beyond the well's reach, straight across from the player: no straight shot gets there.
  nodes: [{ x: 1400, y: 450, r: 26, kind: 'plain' }],
  drones: [shadow()],
  objective: { drones: true },
  player: { x: 260, y: 450, angle: 0 },
  ball: { x: 460, y: 420, speed: 400, angleDeg: -30 },
});

/** The shadow: a first draft of the Absence. It circles the well and is solid three seconds in every five. */
function shadow() {
  return {
    x: 800,
    y: 220,
    angle: Math.PI / 2,
    r: 30,
    paddleWidth: 130,
    paddleBase: 42,
    paddleThick: 7,
    moveSpeed: 150,
    turnSpeed: 4,
    reaction: 0.3,
    anticipation: { commit: 0.4, swing: false, error: 8 },
    aggression: 0.1,
    aim: 0.4,
    absorb: 0,
    absorbSpeed: 500,
    threatRadius: 320,
    blockRadius: 100,
    safeRadius: 0,
    leash: 110,
    lungeExtend: 18,
    lungeSpeed: 130,
    orbit: { cx: 800, cy: 450, rx: 230, ry: 230, omega: 0.3, phase: -Math.PI / 2 },
    phasing: { on: 3, off: 2 },
    ghost: true,
  };
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
