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
