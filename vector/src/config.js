// Vector's tunables. The third game is first person and in metres, so the
// movement and the reach are new; the shields, the difficulty and the mark are
// Deflector's own, imported so the three games can never drift apart.
import { DIFFICULTIES, DEFAULT_DIFFICULTY, GAME_MARK, GAME_VERSION } from '../../src/config.js';

export { DIFFICULTIES, DEFAULT_DIFFICULTY, GAME_MARK, GAME_VERSION };

export const VECTOR_NAME = 'Vector';
export const VECTOR_TAGLINE = 'Step out. Look up. Choose.';
// Glyph indices of GAME_MARK lit for the last reading, VECTOR (MARK_READINGS in src/config.js);
// ECTOR, from index 14, is always lit.
export const VECTOR_LIT = [12];

// Everything Vector keeps in the browser lives under its own prefix, so a
// save of one game can never be read as another's.
export const STORE = {
  settings: 'vector.settings',
  run: 'vector.run',
  cleared: 'vector.cleared',
  best: 'vector.best',
  name: 'vector.name', // the name shown over your robot in multiplayer
  room: 'vector.room', // what the host last picked for a room
};

/** The physics runs in whole steps of this, whatever the display's rate. */
export const PHYSICS_DT = 1 / 120;

/** Down, in m/s² for a thrown thing; the robot has its own (MOVE). */
export const GRAVITY = 32;

/**
 * The robot. Its body is an upright capsule: a segment `half` either side of
 * its centre, `r` thick, so it stands 2 * (half + r) = 1.8 m tall and 0.8 m
 * wide, and it sees from `eye` above its centre.
 */
export const ROBOT = {
  r: 0.4,
  half: 0.5,
  eye: 0.62,
  invuln: 1.6, // seconds of flicker after losing a shield
  knock: 7, // m/s the robot is thrown back by a hit
  color: '#7fe9ff',
  trim: '#ffb347',
};

/**
 * Movement, tuned the way Defector's is: a held jump rises 2.2 m walking and
 * 2.7 m running, letting go early swaps to a heavier gravity so a tap is a hop
 * and a hold is a leap, and the air steers nearly as well as the ground.
 * A walking jump carries about 5 m on the level and a running one about 8;
 * the levels keep their gaps well inside that (JUMP below).
 */
export const MOVE = {
  walk: 6, // m/s
  run: 9,
  accel: 55, // m/s² speeding up on the ground
  friction: 42, // m/s² slowing with nothing held on the ground
  airAccel: 24,
  airDrag: 0.6, // m/s² with nothing held in the air: momentum mostly carries
  jump: 9.4, // m/s up from a standing jump: 2.2 m at gUp
  runJump: 10.4, // m/s up at full run: 2.7 m
  gUp: 20, // m/s² rising with jump held
  gCut: 52, // rising after jump is let go
  gFall: 32, // falling
  maxFall: 36, // m/s: 0.3 m a physics step, under the body's radius
  coyote: 0.1, // seconds after running off a ledge that a jump still counts
  buffer: 0.14, // seconds a jump pressed just before landing is kept
  stepUp: 0.45, // m: a ledge this low is walked up, like a stair
  snap: 0.35, // m the robot follows the ground down instead of flying off a slope
  walkable: 0.64, // a surface whose normal points up at least this much is ground
  stomp: 9, // m/s up off an enemy you land on
  lookMax: 1.5, // radians the view pitches up or down, at most
};

/** What the levels may ask of a jump, well inside MOVE's reach. */
export const JUMP = {
  walkGap: 3.6, // m across, landing level
  runGap: 6.5,
  rise: 1.7, // m up onto a ledge
  runRise: 2.2,
};

/** The blaster: Deflector's charge, fired from the hip in three dimensions. */
export const BLASTER = {
  speed: 24, // m/s
  maxSpeed: 40,
  radius: 0.16,
  life: 3, // seconds
  cooldown: 0.22,
  maxAlive: 6, // your charges in the air at once, and no more
  muzzle: 0.55, // m ahead of the eye that a charge forms at
  drop: 0.22, // m below the eye, and to the right, that the gun hangs
  side: 0.22,
  damage: 1,
  guide: 1.4, // seconds of flight the aim line shows
};

/**
 * Power-ups, alternate charges for the blaster, as in Defector. Each pickup
 * loads `ammo` charges of its kind, up to `maxAmmo`; the wheel, R or LT cycles
 * which is loaded (1 to 6 pick one), and an empty one falls back to the
 * standard charge.
 */
export const POWERUPS = [
  { id: 'big', name: 'Titan', blurb: 'a charge three times the size; it carries on through what it breaks', color: '#ffb347', glyph: '●' },
  { id: 'triple', name: 'Trident', blurb: 'three charges, fanned two degrees apart', color: '#9dff5c', glyph: '⋔' },
  { id: 'freeze', name: 'Frost', blurb: 'freezes what it hits for five seconds', color: '#8fdcff', glyph: '❄' },
  { id: 'durable', name: 'Longwave', blurb: 'lives six seconds instead of three', color: '#c9a2ff', glyph: '∿' },
  { id: 'strong', name: 'Hammer', blurb: 'double damage', color: '#ff5c7a', glyph: '✦' },
];
export const PICKS = ['std', ...POWERUPS.map((p) => p.id)];

export const POWER = {
  ammo: 15,
  maxAmmo: 45,
  bigScale: 3,
  tripleSpread: (2 * Math.PI) / 180,
  freeze: 5,
  bossChill: 2.5,
  bossChillRate: 0.45,
  durableLife: 6,
  strongDamage: 2,
};

/**
 * Wormholes. An end is a stadium-shaped mouth `2a` wide and `2b` tall, wide
 * enough that the 0.8 m robot walks into one without threading a needle, and
 * it reaches as far as Defector's two screens, in metres.
 */
export const WORM = {
  a: 0.8, // half-width
  b: 1.2, // half-height
  maxLen: 64, // m along the line of sight, bends and all
  minExit: 3, // m/s: nothing hangs in a mouth
  floorExit: 7.5, // m/s up out of a floor end, enough to lift the robot clear
  launch: 18, // m/s along a launch ramp's face
  funnel: 5, // m/s² pulling a robot that is heading into a mouth onto its middle line
  leftBehind: 110, // m: an end this far from the robot closes, once the robot has been near it
};

/** Things lying about. */
export const PICKUP = { r: 0.35, bob: 0.12, reach: 1.1 };

/** How far from the robot things wake up and go back to sleep. */
export const ACTIVE = { wake: 42, sleep: 70 };

/** Black holes pull the robot this share as hard as they pull a charge: it is heavier. */
export const ROBOT_PULL = 0.4;

/** Seconds the boss is introduced before it moves. */
export const BOSS_INTRO = 2.6;

/** A fall below the level's floor by this much is a fall into a pit. */
export const PIT_DEPTH = 14;

/**
 * Multiplayer's robots, one colour each for the whole match: the robot's body,
 * the name over it, its standard charge, and its pair of wormhole ends (a
 * light and a dark of its own colour), so every charge and every end says
 * whose it is. The first is the robot of the campaign.
 */
export const PLAYERS = [
  { name: 'Cyan', color: '#7fe9ff', trim: '#ffb347', charge: '#dffbff', ends: ['#e6fbff', '#3c96be'] },
  { name: 'Rose', color: '#ff8ad8', trim: '#ffe066', charge: '#ffd6f3', ends: ['#ffe3f6', '#b0467f'] },
  { name: 'Lime', color: '#b8ff6a', trim: '#ff9f43', charge: '#ecffcf', ends: ['#f1ffd9', '#5f9a26'] },
];
export const MAX_PLAYERS = PLAYERS.length;

/** Co-op: each robot on its own shields; one that runs out is out until a teammate reaches a checkpoint or the boss. */
export const COOP = {
  revive: 1, // shields a robot comes back with
  spread: 1.5, // m between robots put down side by side
  retarget: 2.5, // seconds a boss keeps its eye on one robot before it looks for the nearest again
};

/** Versus: every robot for itself, in an arena (maps.js). */
export const VERSUS = {
  shields: 5, // each, unless the host picks otherwise
  shieldChoices: [3, 5, 7],
  powerMin: 30, // seconds between power-ups appearing: at least
  powerMax: 60, // and at most
  powerCap: 3, // lying about at once, and no more
  fair: 0.5, // a power-up appears where the nearest robot is at least this share as far as the next nearest
  frozen: 2, // seconds a Frost charge holds a robot
  ready: 2.4, // seconds of countdown before a match starts, every robot held on its spawn
  hammer: 2, // shields a Hammer charge takes
};
