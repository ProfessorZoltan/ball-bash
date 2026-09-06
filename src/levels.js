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
      turnSpeed: 3.4,
      reaction: 0.34,
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
      turnSpeed: 4.4,
      reaction: 0.26,
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
      turnSpeed: 2.8,
      reaction: 0.36,
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
      turnSpeed: 5.4,
      reaction: 0.24,
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
      turnSpeed: 3.6,
      reaction: 0.3,
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
];

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
