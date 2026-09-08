// Level definitions. Coordinates are in world units; each level declares its
// own size and the renderer scales it to fit the screen.
//
// Obstacles are convex polygons; `rect(cx, cy, w, h, angleDeg)` builds a
// rotated rectangle so straight and angled deflectors are easy to place.

export function rect(cx, cy, w, h, angleDeg = 0) {
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hw = w / 2;
  const hh = h / 2;
  const corners = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return corners.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
}

/** Points on an elliptical arc from angle a0 to a1 (radians), n segments. */
export function arc(cx, cy, rx, ry, a0, a1, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

/** Polygon of an obstacle entry (plain point list or { poly, ... } object). */
export function obstaclePoly(o) {
  return Array.isArray(o) ? o : o.poly;
}

/** Ellipse approximated by `n` segments (clockwise on screen). */
export function ellipse(cx, cy, rx, ry, n = 40, rotate = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rotate + (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

export const LEVELS = [
  {
    id: 1,
    title: 'The Antechamber',
    bossName: 'The Warden',
    intro: 'A sealed vault at the edge of the grid. The Warden blocks everything it can see. Hit it where it cannot look.',
    record: 'Gatekeeper of the outer ring. Nothing has ever passed the Antechamber unchecked, and the Warden does not intend to start with you.',
    stopped: 'The outer ring is open. Nothing has ever come through the Antechamber before; the grid does not yet have a word for what just did.',
    width: 1600,
    height: 900,
    track: 'antechamber',
    palette: {
      floor: '#070b16',
      grid: 'rgba(60, 120, 200, 0.10)',
      wall: '#7fe9ff',
      wallDark: '#0d2340',
      obstacle: '#ffb347',
      obstacleDark: '#3a2410',
    },
    // Chamfered room so the corners themselves act as angled surfaces.
    boundary: [
      [40, 170],
      [170, 40],
      [1430, 40],
      [1560, 170],
      [1560, 730],
      [1430, 860],
      [170, 860],
      [40, 730],
    ],
    obstacles: [
      // Central pillar: blocks straight-on shots, forces bank shots.
      rect(800, 450, 30, 250, 0),
      // Angled deflectors on the boss side - bank a shot off these to reach the Warden's flank.
      rect(1215, 195, 230, 26, -45),
      rect(1215, 705, 230, 26, 45),
      // Mirrored deflectors on the player side, so the Warden's returns can flank you too.
      rect(385, 195, 230, 26, 45),
      rect(385, 705, 230, 26, -45),
      // Diamonds break up the top and bottom lanes.
      rect(800, 128, 54, 54, 45),
      rect(800, 772, 54, 54, 45),
    ],
    player: { x: 300, y: 450, angle: 0 },
    boss: {
      x: 1270,
      y: 450,
      angle: Math.PI,
      r: 34,
      paddleWidth: 150,
      paddleBase: 44,
      paddleThick: 7,
      moveSpeed: 190,
      turnSpeed: 3.91,
      reaction: 0.3,
      anticipation: { commit: 0.5, swing: false, error: 6 },
      aggression: 0.12,
      aim: 0.55,
      absorb: 0.7,
      absorbSpeed: 560,
      threatRadius: 340,
      blockRadius: 100,
      safeRadius: 280,
      leash: 170,
      lungeExtend: 22,
      lungeSpeed: 150,
    },
    ball: { x: 660, y: 450, speed: 430, angleDeg: 0 },
  },
  {
    id: 2,
    title: 'Prism Vault',
    bossName: 'The Refractor',
    intro: 'A mirrored vault where every corner is a bank shot. A spinning prism guards the centre: its tips fling the ball faster or drag it slower. The Refractor is small, quick, and aims for you.',
    record: 'Keeper of the light budget. It splits every beam into what the grid can afford, and it will split you the same way.',
    stopped: 'The prism spins over an empty vault. Somewhere a light budget goes unbalanced, and nobody is left to mind.',
    width: 1600,
    height: 900,
    track: 'prism',
    palette: {
      floor: '#0a0716',
      grid: 'rgba(160, 100, 255, 0.10)',
      wall: '#c58cff',
      wallDark: '#221340',
      obstacle: '#7ff5e8',
      obstacleDark: '#0e3a38',
    },
    // Deep chamfers: the corners themselves are 45-degree mirrors.
    boundary: [
      [40, 300],
      [300, 40],
      [1300, 40],
      [1560, 300],
      [1560, 600],
      [1300, 860],
      [300, 860],
      [40, 600],
    ],
    obstacles: [
      // Lattice of thin panes around the centre: an X that splits the lanes.
      rect(560, 250, 210, 16, 45),
      rect(1040, 250, 210, 16, -45),
      rect(560, 650, 210, 16, -45),
      rect(1040, 650, 210, 16, 45),
      // Flank mirrors: turn a top or bottom lane into a side shot on either fighter.
      rect(1390, 240, 150, 16, 25),
      rect(1390, 660, 150, 16, -25),
      rect(210, 240, 150, 16, -25),
      rect(210, 660, 150, 16, 25),
      // Small diamonds guarding the far ends of the top and bottom lanes.
      rect(800, 95, 44, 44, 45),
      rect(800, 805, 44, 44, 45),
    ],
    // Moving obstacles. A spinner is a bar rotating about its centre.
    movers: [{ type: 'spinner', x: 800, y: 450, length: 250, thick: 8, omega: 0.35, angle: 0.5 }],
    player: { x: 300, y: 450, angle: 0 },
    boss: {
      x: 1280,
      y: 450,
      angle: Math.PI,
      r: 28,
      paddleWidth: 132,
      paddleBase: 38,
      paddleThick: 6,
      moveSpeed: 270,
      turnSpeed: 5.06,
      reaction: 0.23,
      anticipation: { commit: 0.55, swing: false, error: 5 },
      aggression: 0.18,
      aim: 0.8,
      absorb: 0.6,
      absorbSpeed: 560,
      threatRadius: 360,
      blockRadius: 90,
      safeRadius: 280,
      leash: 150,
      lungeExtend: 20,
      lungeSpeed: 170,
    },
    ball: { x: 560, y: 450, speed: 480, angleDeg: 0 },
  },
  {
    id: 3,
    title: 'Coolant Tunnels',
    bossName: 'The Sump',
    intro: 'Rough caves in two chambers, joined by tunnels that breathe. The Sump is slow and huge, and every ball it blocks leaves a trail of ice. Touch the ice and you freeze. Thread the tunnels and hit it from the side.',
    record: 'The grid\'s cold store. It has swallowed the system\'s waste heat for a thousand cycles, and it is in no hurry to stop.',
    stopped: 'The cold store is quiet. The ice will melt in its own time.',
    width: 1600,
    height: 900,
    track: 'coolant',
    extrude: 14,
    palette: {
      floor: '#04110e',
      grid: 'rgba(70, 210, 170, 0.09)',
      wall: '#5df2c4',
      wallDark: '#0a2e26',
      obstacle: '#9df58f',
      obstacleDark: '#0f2f1a',
      obstacleFill: '#0a1a12',
      ice: '#cdf6ff',
    },
    // Irregular cave outline. The rock divide attaches to the vertices
    // (740,50)-(1000,80) at the top and (990,830)-(760,870) at the bottom.
    boundary: [
      [60, 300], [150, 130], [340, 60], [560, 100], [740, 50], [1000, 80], [1250, 60], [1470, 150],
      [1550, 330], [1530, 560], [1560, 720], [1430, 850], [1200, 860], [990, 830], [760, 870],
      [560, 840], [330, 850], [150, 770], [60, 600],
    ],
    obstacles: [
      // The divide: north rock, island, south rock. Gaps between them are the tunnels.
      [[740, 50], [1000, 80], [1020, 190], [960, 270], [840, 285], [750, 230], [700, 140]],
      [[800, 400], [920, 380], [1000, 440], [980, 520], [860, 560], [770, 500]],
      [[760, 870], [990, 830], [1020, 720], [960, 660], [840, 650], [750, 700], [720, 790]],
      // Outcrops in the player's chamber and the Sump's chamber for bank shots.
      [[380, 380], [430, 340], [480, 400], [450, 470], [380, 450]],
      [[1120, 200], [1200, 180], [1250, 240], [1210, 300], [1130, 280]],
      [[1120, 700], [1210, 680], [1250, 620], [1200, 590], [1130, 620]],
    ],
    // Breathing pistons: slabs that slide out of the rock into each tunnel,
    // in opposite phase, so one tunnel is always the more open one.
    movers: [
      { type: 'piston', x: 880, y: 285, length: 90, thick: 8, axisAngle: Math.PI / 2, amp: 48, period: 5, phase: 0 },
      { type: 'piston', x: 900, y: 655, length: 90, thick: 8, axisAngle: -Math.PI / 2, amp: 48, period: 5, phase: Math.PI },
    ],
    // Ice trail: laid for `lay` s after every Sump block, each piece melts
    // after `life` s, touching it freezes the player for `freeze` s.
    ice: { lay: 2, life: 2, freeze: 2, width: 30 },
    player: { x: 330, y: 450, angle: 0 },
    boss: {
      x: 1330,
      y: 450,
      angle: Math.PI,
      r: 40,
      paddleWidth: 190,
      paddleBase: 52,
      paddleThick: 8,
      moveSpeed: 130,
      turnSpeed: 3.22,
      reaction: 0.31,
      anticipation: { commit: 0.45, swing: false, error: 6 },
      aggression: 0.05,
      aim: 0.5,
      absorb: 0.9,
      absorbSpeed: 420,
      threatRadius: 380,
      blockRadius: 130,
      safeRadius: 300,
      leash: 130,
      lungeExtend: 18,
      lungeSpeed: 120,
    },
    ball: { x: 560, y: 450, speed: 440, angleDeg: -20 },
  },
  {
    id: 4,
    title: 'The Hollow Reactor',
    bossName: 'Core Sentinel',
    intro: 'A ring chamber around a live core. The outer wall curves, so every bank comes off at a new angle. Shield plates orbit the core, and the Sentinel never stops patrolling. Catch its back as it passes.',
    record: 'The core\'s only guard. It has circled the reactor since boot and has never once looked away from it.',
    stopped: 'The reactor turns unguarded. For the first time since boot, nothing is circling it.',
    width: 1600,
    height: 900,
    track: 'reactor',
    palette: {
      floor: '#130608',
      grid: 'rgba(255, 110, 80, 0.08)',
      wall: '#9fb8ff',
      wallDark: '#1a2038',
      obstacle: '#ff6b4a',
      obstacleDark: '#3a1410',
      obstacleFill: '#1f0a08',
      ice: '#cdf6ff',
    },
    boundary: ellipse(800, 450, 745, 415, 44),
    obstacles: [
      // The core.
      ellipse(800, 450, 112, 112, 18),
      // Four small vents on the outer wall, straight faces for reliable banks.
      rect(800, 68, 120, 22, 0),
      rect(800, 832, 120, 22, 0),
      rect(90, 450, 22, 120, 0),
      rect(1510, 450, 22, 120, 0),
    ],
    // Shield plates orbiting the core, rigidly, all tangent to their orbit.
    movers: [{ type: 'orbiter', x: 800, y: 450, radius: 232, count: 4, length: 92, thick: 8, omega: 0.5, angle: 0.4 }],
    player: { x: 240, y: 450, angle: 0 },
    boss: {
      x: 1200,
      y: 450,
      angle: Math.PI,
      r: 30,
      paddleWidth: 156,
      paddleBase: 40,
      paddleThick: 6,
      moveSpeed: 260,
      turnSpeed: 6.21,
      reaction: 0.21,
      anticipation: { commit: 0.6, swing: true, error: 5 },
      aggression: 0.15,
      aim: 0.7,
      absorb: 0.5,
      absorbSpeed: 600,
      threatRadius: 380,
      blockRadius: 110,
      safeRadius: 280,
      leash: 120,
      lungeExtend: 20,
      lungeSpeed: 170,
      // Patrol orbit: the Sentinel's home position circles the core.
      orbit: { cx: 800, cy: 450, rx: 400, ry: 255, omega: 0.15, phase: 0 },
    },
    ball: { x: 480, y: 450, speed: 460, angleDeg: 150 },
  },
  {
    id: 5,
    title: 'Switchyard',
    bossName: 'The Shunter',
    intro: 'Three lanes of rail, two gaps in every rail, and sliding doors that close them on a schedule. The open route to the Shunter changes every few seconds. It runs the lanes fast but turns like a locomotive.',
    record: 'Traffic control. Every packet in the grid rides its rails, and it alone decides which door is open and when.',
    stopped: 'The doors keep their schedule. Nothing is watching the rails now.',
    width: 1600,
    height: 900,
    track: 'switchyard',
    palette: {
      floor: '#0b0907',
      grid: 'rgba(255, 190, 80, 0.08)',
      wall: '#8fd3ff',
      wallDark: '#12253a',
      obstacle: '#ffb347',
      obstacleDark: '#3a2408',
      obstacleFill: '#1c1206',
      ice: '#cdf6ff',
    },
    boundary: [
      [40, 100], [100, 40], [1500, 40], [1560, 100],
      [1560, 800], [1500, 860], [100, 860], [40, 800],
    ],
    obstacles: [
      // Rail 1 (y=300) and rail 2 (y=600), each with gaps at 620-760 and 1020-1160.
      rect(490, 300, 260, 14, 0), rect(890, 300, 260, 14, 0), rect(1210, 300, 100, 14, 0),
      rect(490, 600, 260, 14, 0), rect(890, 600, 260, 14, 0), rect(1210, 600, 100, 14, 0),
      // Switch points: angled plates at the lane ends turn a lane shot into a flank shot.
      rect(1330, 165, 150, 18, 45), rect(1330, 735, 150, 18, -45),
      rect(270, 165, 150, 18, -45), rect(270, 735, 150, 18, 45),
      // Buffers in the middle lane so the straight route is not a free shot.
      rect(800, 450, 22, 110, 0),
    ],
    // Sliding doors: each slides out of its rail to close a gap. Opposite
    // phases on each rail, and the two rails offset, so the open route rotates.
    movers: [
      { type: 'piston', parallel: true, x: 550, y: 300, length: 150, thick: 7, axisAngle: 0, amp: 140, period: 7, phase: 0 },
      { type: 'piston', parallel: true, x: 950, y: 300, length: 150, thick: 7, axisAngle: 0, amp: 140, period: 7, phase: Math.PI },
      { type: 'piston', parallel: true, x: 550, y: 600, length: 150, thick: 7, axisAngle: 0, amp: 140, period: 7, phase: Math.PI / 2 },
      { type: 'piston', parallel: true, x: 950, y: 600, length: 150, thick: 7, axisAngle: 0, amp: 140, period: 7, phase: -Math.PI / 2 },
    ],
    player: { x: 240, y: 450, angle: 0 },
    boss: {
      x: 1300,
      y: 450,
      angle: Math.PI,
      r: 32,
      paddleWidth: 160,
      paddleBase: 44,
      paddleThick: 7,
      moveSpeed: 300,
      turnSpeed: 4.14,
      reaction: 0.26,
      anticipation: { commit: 0.65, swing: true, error: 4 },
      aggression: 0.2,
      aim: 0.6,
      absorb: 0.5,
      absorbSpeed: 600,
      threatRadius: 400,
      blockRadius: 110,
      safeRadius: 320,
      leash: 180,
      lungeExtend: 20,
      lungeSpeed: 170,
    },
    ball: { x: 520, y: 450, speed: 450, angleDeg: 0 },
  },
  {
    id: 6,
    title: 'Glass Cathedral',
    bossName: 'The Choirmaster',
    intro: 'A long nave of stained glass. A slow ball reflects off the panes; a fast one smashes straight through, and the glass reglazes itself a few seconds later. The Choirmaster waits in the apse behind a screen of glass. Thread it, or break it.',
    record: 'Custodian of the archive. Nothing in its nave has been touched in a thousand cycles, and it keeps the glass between itself and everything.',
    stopped: 'The glass reglazes over nothing. The archive is unlocked.',
    width: 1600,
    height: 900,
    track: 'cathedral',
    palette: {
      floor: '#0a0716',
      grid: 'rgba(200, 170, 255, 0.08)',
      wall: '#e6d5ff',
      wallDark: '#1f1538',
      obstacle: '#ffd28a',
      obstacleDark: '#3a2a10',
      obstacleFill: '#1a1408',
      ice: '#cdf6ff',
    },
    // Nave with a rounded apse at the east end.
    boundary: [
      [40, 140], [140, 40], [1250, 40],
      ...arc(1250, 450, 300, 410, -Math.PI / 2, Math.PI / 2, 22).slice(1, -1),
      [1250, 860], [140, 860], [40, 760],
    ],
    // Breakable glass: a ball at or above breakSpeed smashes through, keeping
    // `speedKeep` of its speed; the pane reglazes after `regrow` seconds.
    glass: { breakSpeed: 720, regrow: 14, speedKeep: 0.8 },
    obstacles: [
      // Nave columns (stone, unbreakable).
      rect(420, 235, 40, 40, 45), rect(640, 235, 40, 40, 45), rect(860, 235, 40, 40, 45), rect(1080, 235, 40, 40, 45),
      rect(420, 665, 40, 40, 45), rect(640, 665, 40, 40, 45), rect(860, 665, 40, 40, 45), rect(1080, 665, 40, 40, 45),
      // Stained-glass panes down the nave.
      { poly: rect(530, 450, 170, 12, 30), color: '#ff7eb6', glass: true },
      { poly: rect(760, 450, 170, 12, -30), color: '#7fe9d6', glass: true },
      { poly: rect(990, 450, 170, 12, 30), color: '#b892ff', glass: true },
      // The choir screen: a ring of panes around the apse, with gaps between.
      { poly: rect(1330 + Math.cos(-2.0) * 205, 450 + Math.sin(-2.0) * 205, 110, 12, -2.0 * 180 / Math.PI + 90), color: '#ffd166', glass: true },
      { poly: rect(1330 + Math.cos(-1.35) * 205, 450 + Math.sin(-1.35) * 205, 110, 12, -1.35 * 180 / Math.PI + 90), color: '#ff7eb6', glass: true },
      { poly: rect(1330 + Math.cos(-0.7) * 205, 450 + Math.sin(-0.7) * 205, 110, 12, -0.7 * 180 / Math.PI + 90), color: '#7fe9d6', glass: true },
      { poly: rect(1330 + Math.cos(0.7) * 205, 450 + Math.sin(0.7) * 205, 110, 12, 0.7 * 180 / Math.PI + 90), color: '#b892ff', glass: true },
      { poly: rect(1330 + Math.cos(1.35) * 205, 450 + Math.sin(1.35) * 205, 110, 12, 1.35 * 180 / Math.PI + 90), color: '#ffd166', glass: true },
      { poly: rect(1330 + Math.cos(2.0) * 205, 450 + Math.sin(2.0) * 205, 110, 12, 2.0 * 180 / Math.PI + 90), color: '#ff7eb6', glass: true },
      // The west window behind the player, so the Choirmaster's returns can flank you too.
      { poly: rect(210, 250, 120, 12, 60), color: '#b892ff', glass: true },
      { poly: rect(210, 650, 120, 12, -60), color: '#7fe9d6', glass: true },
    ],
    player: { x: 280, y: 450, angle: 0 },
    boss: {
      x: 1330,
      y: 450,
      angle: Math.PI,
      r: 30,
      paddleWidth: 150,
      paddleBase: 42,
      paddleThick: 6,
      moveSpeed: 240,
      turnSpeed: 4.83,
      reaction: 0.24,
      anticipation: { commit: 0.7, swing: true, error: 4 },
      aggression: 0,
      aim: 0.8,
      absorb: 0.6,
      absorbSpeed: 560,
      threatRadius: 380,
      blockRadius: 100,
      safeRadius: 260,
      leash: 110,
      lungeExtend: 18,
      lungeSpeed: 150,
    },
    ball: { x: 420, y: 450, speed: 440, angleDeg: 0 },
  },
  {
    id: 7,
    title: 'The Undercroft',
    bossName: 'The Sexton',
    intro: 'The crypt beneath the cathedral. Nothing is lit but your lantern, the Sexton\'s, the glow of the ball, and a few candles. A forest of vault columns for banks, if you can see them. The Sexton keeps its crypt behind two tomb slabs.',
    record: 'Caretaker of the deleted. It keeps the crypt beneath the archive and knows every column in the dark.',
    stopped: 'The candles keep burning in an empty crypt. The deleted are unguarded now, and some of them remember you.',
    width: 1600,
    height: 900,
    track: 'undercroft',
    extrude: 12,
    palette: {
      floor: '#0d0a07',
      grid: 'rgba(210, 170, 90, 0.07)',
      wall: '#d9c48a',
      wallDark: '#2a2214',
      obstacle: '#e0a64f',
      obstacleDark: '#2e2010',
      obstacleFill: '#191309',
      ice: '#cdf6ff',
    },
    // Darkness: only these light radii (plus the ball's glow) reveal the crypt.
    dark: { ambient: 0.07, player: 212, boss: 145, ball: 128, candle: 102 },
    lights: [
      { x: 110, y: 110 }, { x: 1490, y: 110 }, { x: 110, y: 790 }, { x: 1490, y: 790 },
      { x: 800, y: 70 }, { x: 800, y: 830 },
    ],
    // Vaulted hall with shallow alcoves top and bottom.
    boundary: [
      [40, 120], [120, 40], [700, 40], [720, 90], [880, 90], [900, 40], [1480, 40], [1560, 120],
      [1560, 780], [1480, 860], [900, 860], [880, 810], [720, 810], [700, 860], [120, 860], [40, 780],
    ],
    obstacles: [
      // Vault columns.
      ...[400, 640, 880, 1120].flatMap((x) => [230, 450, 670].map((y) => ellipse(x, y, 26, 26, 8, Math.PI / 8))),
      // Tomb slabs shielding the Sexton's crypt above and below.
      rect(1390, 300, 170, 22, 0), rect(1390, 600, 170, 22, 0),
      // A broken sarcophagus in the player's half.
      rect(230, 300, 120, 22, 20), rect(230, 600, 120, 22, -20),
    ],
    player: { x: 250, y: 450, angle: 0 },
    boss: {
      x: 1400,
      y: 450,
      angle: Math.PI,
      r: 32,
      paddleWidth: 150,
      paddleBase: 44,
      paddleThick: 7,
      moveSpeed: 220,
      turnSpeed: 4.37,
      reaction: 0.28,
      anticipation: { commit: 0.7, swing: true, error: 4 },
      aggression: 0.1,
      aim: 0.6,
      absorb: 0.5,
      absorbSpeed: 580,
      threatRadius: 380,
      blockRadius: 105,
      safeRadius: 280,
      leash: 150,
      lungeExtend: 18,
      lungeSpeed: 150,
    },
    ball: { x: 520, y: 450, speed: 440, angleDeg: 12 },
  },
  {
    id: 8,
    title: 'Signal Spire',
    bossName: 'The Beacon',
    intro: 'A transmitter tower splits the arena; the only lane is over its top. Every few seconds the Beacon pulses, and the expanding signal flings the ball away from it. Time your shot for the silence between pulses, or ride one.',
    record: 'The grid\'s voice. It has broadcast one word since boot, HOLD, and it will not stop for you.',
    stopped: 'The tower has stopped saying HOLD. The silence carries further than the signal ever did.',
    width: 1600,
    height: 900,
    track: 'spire',
    palette: {
      floor: '#070a14',
      grid: 'rgba(120, 190, 255, 0.09)',
      wall: '#9ad7ff',
      wallDark: '#12213a',
      obstacle: '#ff6b6b',
      obstacleDark: '#3a1418',
      obstacleFill: '#1c0b0e',
      ice: '#cdf6ff',
    },
    boundary: [
      [40, 110], [110, 40], [1490, 40], [1560, 110],
      [1560, 790], [1490, 860], [110, 860], [40, 790],
    ],
    obstacles: [
      // The spire, rooted in the floor, with its crossbar and antenna arms.
      rect(800, 565, 28, 590, 0),
      rect(800, 282, 170, 16, 0),
      rect(738, 400, 100, 14, -40), rect(862, 400, 100, 14, 40),
      rect(748, 560, 90, 14, 40), rect(852, 560, 90, 14, -40),
      // Relay dishes in the corners: bank over the top from either side.
      rect(1330, 170, 150, 18, 45), rect(1330, 730, 150, 18, -45),
      rect(270, 170, 150, 18, -45), rect(270, 730, 150, 18, 45),
    ],
    player: { x: 250, y: 450, angle: 0 },
    boss: {
      x: 1360,
      y: 450,
      angle: Math.PI,
      r: 30,
      paddleWidth: 140,
      paddleBase: 42,
      paddleThick: 6,
      moveSpeed: 230,
      turnSpeed: 4.6,
      reaction: 0.26,
      anticipation: { commit: 0.8, swing: true, error: 3 },
      aggression: 0.1,
      aim: 0.7,
      absorb: 0.5,
      absorbSpeed: 600,
      threatRadius: 380,
      blockRadius: 100,
      safeRadius: 280,
      leash: 170,
      lungeExtend: 18,
      lungeSpeed: 150,
      // The signal pulse: period, ring speed, range, thickness, telegraph time.
      pulse: { period: 5, speed: 340, maxRadius: 330, thick: 8, warn: 0.8, delay: 3 },
    },
    ball: { x: 520, y: 450, speed: 450, angleDeg: -30 },
  },
  {
    id: 9,
    title: 'Nullspace',
    bossName: 'The Absence',
    intro: 'An empty chamber in the void, and the chamber breathes: all eight walls slide inward and back together. Banks off a closing wall come back faster; off an opening wall, slower. The Absence is huge, quick, and barely there.',
    record: 'What the grid uses for a wall where there is nothing to hold one up. Barely a program: a place that pushes back.',
    stopped: 'The walls stop breathing. Where the Absence was, there is only absence.',
    width: 1600,
    height: 900,
    track: 'nullspace',
    palette: {
      floor: '#000000',
      grid: 'rgba(120, 140, 200, 0.07)',
      wall: '#7fe9ff',
      boundary: '#14141f',
      wallDark: '#000000',
      obstacle: '#e9e9ff',
      obstacleDark: '#101018',
      obstacleFill: '#05050a',
      ice: '#cdf6ff',
    },
    boundary: [[40, 40], [1560, 40], [1560, 860], [40, 860]],
    obstacles: [],
    // The breathing chamber: eight perpendicular pistons, all in phase, each
    // sliding 120 px inward along its own normal and back over six seconds.
    // Slabs are longer than their faces so the corners stay sealed throughout.
    movers: [
      { type: 'piston', x: 800, y: 50, length: 1260, thick: 10, axisAngle: Math.PI / 2, amp: 120, period: 6, phase: 0 },
      { type: 'piston', x: 800, y: 850, length: 1260, thick: 10, axisAngle: -Math.PI / 2, amp: 120, period: 6, phase: 0 },
      { type: 'piston', x: 60, y: 450, length: 600, thick: 10, axisAngle: 0, amp: 120, period: 6, phase: 0 },
      { type: 'piston', x: 1540, y: 450, length: 600, thick: 10, axisAngle: Math.PI, amp: 120, period: 6, phase: 0 },
      { type: 'piston', x: 1479, y: 111, length: 200, thick: 10, axisAngle: (3 * Math.PI) / 4, amp: 120, period: 6, phase: 0 },
      { type: 'piston', x: 121, y: 111, length: 200, thick: 10, axisAngle: Math.PI / 4, amp: 120, period: 6, phase: 0 },
      { type: 'piston', x: 1479, y: 789, length: 200, thick: 10, axisAngle: (-3 * Math.PI) / 4, amp: 120, period: 6, phase: 0 },
      { type: 'piston', x: 121, y: 789, length: 200, thick: 10, axisAngle: -Math.PI / 4, amp: 120, period: 6, phase: 0 },
    ],
    player: { x: 360, y: 450, angle: 0 },
    boss: {
      x: 1240,
      y: 450,
      angle: Math.PI,
      r: 44,
      paddleWidth: 200,
      paddleBase: 56,
      paddleThick: 8,
      moveSpeed: 330,
      turnSpeed: 6.21,
      reaction: 0.21,
      anticipation: { commit: 0.9, swing: true, error: 2 },
      aggression: 0.15,
      aim: 0.75,
      absorb: 0.6,
      absorbSpeed: 620,
      threatRadius: 420,
      blockRadius: 130,
      safeRadius: 300,
      leash: 180,
      lungeExtend: 22,
      lungeSpeed: 170,
      ghost: true, // drawn as a hole in the grid, not a lit body
    },
    ball: { x: 560, y: 450, speed: 450, angleDeg: 25 },
  },
  {
    id: 10,
    title: 'The Last Arcade',
    bossName: 'The Architect',
    intro: 'Everything you have learned, in one hall. A prism at the centre, rails whose doors switch the open lane, glass around the Architect, ice behind its blocks and a pulse to keep you honest. It built every room before this one. Show it what you learned in them.',
    record: 'Author of every room before this one. It wrote the walls that made you a reflector, and it has been waiting to see what you became.',
    stopped: 'The Architect is stopped. The record ends here, or begins: the mark has one reading left.',
    width: 1600,
    height: 900,
    track: 'arcade',
    palette: {
      floor: '#06040f',
      grid: 'rgba(255, 79, 216, 0.08)',
      wall: '#7fe9ff',
      wallDark: '#0d2340',
      obstacle: '#ff4fd8',
      obstacleDark: '#3a0f30',
      obstacleFill: '#1a0a1a',
      ice: '#cdf6ff',
    },
    boundary: [
      [40, 260], [260, 40], [1340, 40], [1560, 260],
      [1560, 640], [1340, 860], [260, 860], [40, 640],
    ],
    glass: { breakSpeed: 720, regrow: 12, speedKeep: 0.8 },
    obstacles: [
      // Two horizontal rails on the Architect's half, each with a door gap at
      // x 1030-1170. They split the approach into three lanes that all stay
      // open at the far end, so the ball can never be penned in.
      rect(985, 300, 90, 14, 0), rect(1235, 300, 130, 14, 0),
      rect(985, 600, 90, 14, 0), rect(1235, 600, 130, 14, 0),
      // Player-side deflectors so the Architect's returns can flank you.
      rect(330, 190, 180, 20, 45), rect(330, 710, 180, 20, -45),
      // Lane diamonds.
      rect(800, 120, 50, 50, 45), rect(800, 780, 50, 50, 45),
      // The Architect's screen: four glass panes around its post.
      { poly: rect(1380 + Math.cos(-1.4) * 170, 450 + Math.sin(-1.4) * 170, 100, 12, -1.4 * 180 / Math.PI + 90), color: '#ffd166', glass: true },
      { poly: rect(1380 + Math.cos(-0.6) * 170, 450 + Math.sin(-0.6) * 170, 100, 12, -0.6 * 180 / Math.PI + 90), color: '#7fe9d6', glass: true },
      { poly: rect(1380 + Math.cos(0.6) * 170, 450 + Math.sin(0.6) * 170, 100, 12, 0.6 * 180 / Math.PI + 90), color: '#b892ff', glass: true },
      { poly: rect(1380 + Math.cos(1.4) * 170, 450 + Math.sin(1.4) * 170, 100, 12, 1.4 * 180 / Math.PI + 90), color: '#ff7eb6', glass: true },
    ],
    movers: [
      // The prism.
      { type: 'spinner', x: 800, y: 450, length: 200, thick: 8, omega: 0.3, angle: 0.3 },
      // Doors slide along each rail to close its gap, in opposite phase: the open lane alternates.
      { type: 'piston', parallel: true, x: 960, y: 300, length: 150, thick: 7, axisAngle: 0, amp: 140, period: 7, phase: 0 },
      { type: 'piston', parallel: true, x: 960, y: 600, length: 150, thick: 7, axisAngle: 0, amp: 140, period: 7, phase: Math.PI },
    ],
    // The Architect's blocks lay ice, like the Sump's.
    ice: { lay: 2, life: 2, freeze: 2, width: 30 },
    player: { x: 260, y: 450, angle: 0 },
    boss: {
      x: 1380,
      y: 450,
      angle: Math.PI,
      r: 32,
      paddleWidth: 160,
      paddleBase: 44,
      paddleThick: 7,
      moveSpeed: 260,
      turnSpeed: 5.98,
      reaction: 0.23,
      anticipation: { commit: 1.0, swing: true, error: 1 },
      aggression: 0.1,
      aim: 0.8,
      absorb: 0.8,
      absorbSpeed: 520,
      threatRadius: 400,
      blockRadius: 110,
      safeRadius: 280,
      leash: 140,
      lungeExtend: 20,
      lungeSpeed: 170,
      // And it pulses, like the Beacon, a little less often and a little softer.
      pulse: { period: 7, speed: 280, maxRadius: 260, thick: 8, warn: 0.8, delay: 4 },
    },
    ball: { x: 560, y: 450, speed: 450, angleDeg: 0 },
  },
];

/** The tutorial's training hall: not part of the roster. */
export const TUTORIAL_LEVEL = {
  id: 0,
  title: 'Training Hall',
  bossName: 'Training Drone',
  intro: '',
  width: 1600,
  height: 900,
  track: 'antechamber',
  palette: {
    floor: '#070b16',
    grid: 'rgba(60, 120, 200, 0.10)',
    wall: '#7fe9ff',
    wallDark: '#0d2340',
    obstacle: '#ffb347',
    obstacleDark: '#3a2410',
  },
  boundary: [
    [40, 120], [120, 40], [1480, 40], [1560, 120],
    [1560, 780], [1480, 860], [120, 860], [40, 780],
  ],
  obstacles: [
    // Deflectors beside the drone: the bank-shot lesson's tools.
    rect(1160, 200, 220, 26, -45),
    rect(1160, 700, 220, 26, 45),
  ],
  player: { x: 300, y: 450, angle: 0 },
  boss: {
    x: 1260,
    y: 450,
    angle: Math.PI,
    r: 32,
    paddleWidth: 150,
    paddleBase: 44,
    paddleThick: 7,
    moveSpeed: 0,
    turnSpeed: 0,
    reaction: 1,
    aggression: 0,
    aim: 0,
    absorb: 0,
    leash: 0,
  },
  ball: { x: 880, y: 450, speed: 380, angleDeg: 180 },
};

// Planned roster (number + title). Only level 1 is playable for now.
export const ROSTER = [
  { id: 1, title: 'The Antechamber', boss: 'The Warden' },
  { id: 2, title: 'Prism Vault', boss: 'The Refractor' },
  { id: 3, title: 'Coolant Tunnels', boss: 'The Sump' },
  { id: 4, title: 'The Hollow Reactor', boss: 'Core Sentinel' },
  { id: 5, title: 'Switchyard', boss: 'The Shunter' },
  { id: 6, title: 'Glass Cathedral', boss: 'The Choirmaster' },
  { id: 7, title: 'The Undercroft', boss: 'The Sexton' },
  { id: 8, title: 'Signal Spire', boss: 'The Beacon' },
  { id: 9, title: 'Nullspace', boss: 'The Absence' },
  { id: 10, title: 'The Last Arcade', boss: 'The Architect' },
];

// ------------------------------------------------------------ versus arenas
//
// Rooms for multiplayer versus only: every player for themselves, so they are
// symmetric rather than staged around a boss. `spawns` lists a start point per
// player, keyed by how many are playing (2 or 3 for now, 4 later); the match
// rotates who starts where every round. `palette.third` colours the third
// player (the host wears `wall`, the first guest `obstacle`).

/** Equilateral triangle, apex up, with each corner cut `cut` px along both of its edges. */
export function truncatedTriangle(cx, cy, R, cut) {
  const verts = [-90, 30, 150].map((deg) => [cx + Math.cos((deg * Math.PI) / 180) * R, cy + Math.sin((deg * Math.PI) / 180) * R]);
  const toward = (a, b) => {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [a[0] + ((b[0] - a[0]) / d) * cut, a[1] + ((b[1] - a[1]) / d) * cut];
  };
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const a = verts[i];
    pts.push(toward(a, verts[(i + 2) % 3]), toward(a, verts[(i + 1) % 3]));
  }
  return pts;
}

/** The two points where circles a and b cross (none when they do not). */
function circleCrossings(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d === 0 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return [];
  const l = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a.r * a.r - l * l));
  const mx = a.x + (dx / d) * l;
  const my = a.y + (dy / d) * l;
  return [
    [mx + (dy / d) * h, my - (dx / d) * h],
    [mx - (dy / d) * h, my + (dx / d) * h],
  ];
}

/**
 * Outline of the union of overlapping circles [{ x, y, r }], as one polygon.
 * Works when some point lies inside every circle (their common overlap), which
 * makes the union star-shaped around it, so its rim sorts by angle.
 */
export function circleUnion(circles, n = 48) {
  const cx = circles.reduce((s, c) => s + c.x, 0) / circles.length;
  const cy = circles.reduce((s, c) => s + c.y, 0) / circles.length;
  const inside = (x, y, skip) => circles.some((o, k) => !skip.includes(k) && Math.hypot(x - o.x, y - o.y) < o.r - 1e-6);
  const pts = [];
  circles.forEach((c, i) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = c.x + Math.cos(a) * c.r;
      const y = c.y + Math.sin(a) * c.r;
      if (!inside(x, y, [i])) pts.push([x, y]);
    }
    for (let j = i + 1; j < circles.length; j++) {
      for (const p of circleCrossings(c, circles[j])) if (!inside(p[0], p[1], [i, j])) pts.push(p);
    }
  });
  pts.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  return pts.filter((p, k) => k === 0 || Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]) > 1);
}

/** A square of half-size `half` whose edges are sawtooth: `teeth` per edge, biting `depth` px inward. */
export function jaggedSquare(cx, cy, half, teeth = 8, depth = 28) {
  const corners = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
  ];
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const il = Math.hypot(cx - mx, cy - my);
    const ix = (cx - mx) / il;
    const iy = (cy - my) / il;
    for (let k = 0; k < teeth * 2; k++) {
      const t = k / (teeth * 2);
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      pts.push(k % 2 ? [x + ix * depth, y + iy * depth] : [x, y]);
    }
  }
  return pts;
}

/** A spawn point facing (tx, ty). */
function facing(x, y, tx, ty) {
  return { x, y, angle: Math.atan2(ty - y, tx - x) };
}

export const VERSUS_LEVELS = [
  {
    id: 'v1',
    title: 'The Wedge',
    versus: true,
    intro: 'A three-cornered court with the points filed off. Every wall is someone else\'s bank shot.',
    width: 1100,
    height: 900,
    track: 'switchyard',
    palette: {
      floor: '#0a0714',
      grid: 'rgba(180, 120, 255, 0.10)',
      wall: '#c3a6ff',
      wallDark: '#2a1a4a',
      obstacle: '#ffd166',
      obstacleDark: '#3a2e10',
      third: '#7dffc4',
    },
    boundary: truncatedTriangle(550, 520, 500, 110),
    obstacles: [
      // An inverted wedge at the centre: nothing crosses the court in a straight line.
      [[550, 610], [485, 495], [615, 495]],
    ],
    spawns: {
      2: [facing(310, 660, 550, 520), facing(790, 660, 550, 520)],
      3: [facing(310, 660, 550, 520), facing(790, 660, 550, 520), facing(550, 200, 550, 520)],
    },
    ball: { x: 550, y: 400, speed: 440, angleDeg: -90 },
  },
  {
    id: 'v2',
    title: 'The Ring',
    versus: true,
    intro: 'A perfect circle. There are no corners to hide in and every rebound comes back around.',
    width: 900,
    height: 900,
    track: 'nullspace',
    palette: {
      floor: '#04070f',
      grid: 'rgba(80, 200, 255, 0.08)',
      wall: '#7fe9ff',
      wallDark: '#0d2340',
      obstacle: '#ff8df0',
      obstacleDark: '#3a1030',
      third: '#b6ff7d',
    },
    boundary: ellipse(450, 450, 425, 425, 64),
    // Four small pillars on the diagonals: the axes stay open for the serve.
    obstacles: [ellipse(273, 273, 34, 34, 18), ellipse(627, 273, 34, 34, 18), ellipse(627, 627, 34, 34, 18), ellipse(273, 627, 34, 34, 18)],
    spawns: {
      2: [facing(150, 450, 450, 450), facing(750, 450, 450, 450)],
      3: [facing(150, 450, 450, 450), facing(615, 164, 450, 450), facing(615, 736, 450, 450)],
    },
    ball: { x: 450, y: 450, speed: 440, angleDeg: 90 },
  },
  {
    id: 'v3',
    title: 'Trefoil',
    versus: true,
    intro: 'Three chambers grown into one another. The necks between them throw the ball where nobody aimed it.',
    width: 1100,
    height: 900,
    track: 'coolant',
    palette: {
      floor: '#07100c',
      grid: 'rgba(120, 255, 180, 0.08)',
      wall: '#ffb347',
      wallDark: '#3a2410',
      obstacle: '#8dff9d',
      obstacleDark: '#0f3a1a',
      third: '#7fb2ff',
    },
    boundary: circleUnion(
      [-90, 30, 150].map((deg) => ({ x: 550 + Math.cos((deg * Math.PI) / 180) * 180, y: 470 + Math.sin((deg * Math.PI) / 180) * 180, r: 285 })),
      64,
    ),
    obstacles: [ellipse(550, 620, 34, 34, 18), ellipse(420, 395, 34, 34, 18), ellipse(680, 395, 34, 34, 18)],
    spawns: {
      2: [facing(264, 635, 550, 470), facing(836, 635, 550, 470)],
      3: [facing(264, 635, 550, 470), facing(836, 635, 550, 470), facing(550, 140, 550, 470)],
    },
    ball: { x: 550, y: 470, speed: 440, angleDeg: -90 },
  },
  {
    id: 'v4',
    title: 'Sawtooth',
    versus: true,
    intro: 'A square room with its walls chewed into teeth. Nothing bounces the way it should.',
    width: 900,
    height: 900,
    track: 'arcade',
    palette: {
      floor: '#100608',
      grid: 'rgba(255, 120, 120, 0.09)',
      wall: '#ff6b6b',
      wallDark: '#3a1010',
      obstacle: '#ffe066',
      obstacleDark: '#3a3010',
      third: '#7fe9ff',
    },
    boundary: jaggedSquare(450, 450, 400, 7, 26),
    obstacles: [rect(450, 300, 56, 56, 45), rect(450, 600, 56, 56, 45)],
    spawns: {
      2: [facing(150, 450, 450, 450), facing(750, 450, 450, 450)],
      3: [facing(200, 640, 450, 450), facing(700, 640, 450, 450), facing(450, 200, 450, 450)],
    },
    ball: { x: 450, y: 450, speed: 440, angleDeg: 90 },
  },
];
