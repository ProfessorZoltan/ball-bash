// Defector's tunables. The sequel is a platformer, so almost everything here
// is new, but the charge, the shields and the difficulty are Deflector's own,
// imported rather than copied so the two games can never drift apart.
import { BALL, VOLLEY, DIFFICULTIES, DEFAULT_DIFFICULTY, GAME_MARK, GAME_VERSION, PHYSICS_DT, SURFACE_VELOCITY_FACTOR, volleySpeed } from '../../src/config.js';

export { BALL, VOLLEY, DIFFICULTIES, DEFAULT_DIFFICULTY, GAME_MARK, GAME_VERSION, PHYSICS_DT, SURFACE_VELOCITY_FACTOR };

export const SEQUEL_NAME = 'Defector';
export const SEQUEL_TAGLINE = 'Run. Aim. Defect.';
// Glyph indices of GAME_MARK lit for the sequel's reading (MARK_READINGS in src/config.js).
export const SEQUEL_LIT = [4, 6, 7];

// Everything the sequel keeps in the browser lives under its own prefix, so
// a save of one game can never be read as the other's.
export const STORE = {
  settings: 'defector.settings',
  run: 'defector.run',
  cleared: 'defector.cleared',
  best: 'defector.best',
};

export const TILE = 40; // the grid levels are drafted on, in world px

/**
 * The robot. Its body is an upright capsule: a segment `half` either side of
 * its centre, `r` thick, so it stands 2 * (half + r) = 60 px tall and 30 wide,
 * a tile and a half by three quarters.
 */
export const ROBOT = {
  r: 15,
  half: 15,
  color: '#7fe9ff',
  trim: '#ffb347',
  shoulder: -8, // px from the body's centre to the pivot the blaster turns on
  invuln: 1.6, // seconds of flicker after losing a shield
  knock: 320, // px/s the robot is thrown back by a hit
};

/**
 * Movement, tuned to feel like Super Mario Bros. 3 at this scale: a walking
 * jump clears 4.5 tiles up and a running one 5.5; letting go of jump early
 * swaps to a heavier gravity, so a tap is a hop and a hold is a leap; and the
 * air steers nearly as well as the ground does.
 */
export const MOVE = {
  walk: 245, // px/s top speed walking
  run: 360, // px/s top speed with the run button held
  accel: 1050, // px/s² speeding up on the ground
  runAccel: 1250,
  skid: 2600, // px/s² pushing against your own momentum on the ground
  friction: 1500, // px/s² slowing with nothing held on the ground
  airAccel: 950,
  airSkid: 1400,
  airDrag: 60, // px/s² with nothing held in the air: momentum mostly carries
  jump: 735, // px/s up from a standing jump: 180 px (4.5 tiles) at gUp
  runJump: 812, // px/s up at full run: 220 px (5.5 tiles)
  gUp: 1500, // px/s² rising with jump held
  gCut: 4000, // px/s² rising after jump is let go
  gFall: 2800, // px/s² falling
  maxFall: 960, // px/s: 4 px a physics step, well under the body's radius
  coyote: 0.08, // seconds after running off a ledge that a jump still counts
  buffer: 0.12, // seconds a jump pressed just before landing is kept
  stomp: 520, // px/s up off an enemy you land on
  stompHeld: 780, // the same with jump held
  snap: 10, // px the robot follows the ground down a slope instead of flying off it
  dropThrough: 0.18, // seconds down is held on a thin platform before you fall through it
  walkable: 0.6, // a surface whose normal points up at least this much is ground
};

/** The blaster: Deflector's own charge (Blaster mode), fired by a robot. */
export const BLASTER = {
  speed: volleySpeed(BALL.maxSpeed), // 825 px/s, the middle of the ball's range
  minSpeed: BALL.minSpeed,
  maxSpeed: BALL.maxSpeed, // the ball's cap, which keeps a charge from crossing its own radius in a step
  radius: VOLLEY.radius,
  life: VOLLEY.life, // three seconds
  cooldown: 0.22, // seconds between shots
  maxAlive: 6, // your charges in the air at once, and no more: a boss room cannot be flooded to hide behind
  muzzle: 30, // px from the shoulder that a charge forms at
  damage: 1,
  guide: 1.6, // seconds of flight the targeting line shows
};

/**
 * Power-ups: alternate charges for the blaster. Each pickup loads `ammo`
 * charges of its kind, up to `maxAmmo`; LT or 1 cycles which is loaded, and
 * an empty one falls back to the standard charge.
 */
export const POWERUPS = [
  { id: 'big', name: 'Titan', blurb: 'a charge three times the size', color: '#ffb347', glyph: '●' },
  { id: 'triple', name: 'Trident', blurb: 'three charges, a degree apart', color: '#9dff5c', glyph: '⋔' },
  { id: 'freeze', name: 'Frost', blurb: 'freezes what it hits for five seconds', color: '#8fdcff', glyph: '❄' },
  { id: 'durable', name: 'Longwave', blurb: 'lives six seconds instead of three', color: '#c9a2ff', glyph: '∿' },
  { id: 'strong', name: 'Hammer', blurb: 'double damage', color: '#ff5c7a', glyph: '✦' },
];
export const POWER = {
  ammo: 15,
  maxAmmo: 45,
  bigScale: 3,
  tripleSpread: Math.PI / 180, // one degree between the three
  freeze: 5, // seconds an enemy stays frozen
  bossChill: 2.5, // seconds a boss is slowed instead
  bossChillRate: 0.45, // and how much of its speed it keeps
  durableLife: 6,
  strongDamage: 2,
};

/** Things lying about. */
export const PICKUP = {
  r: 16,
  bob: 5, // px of float
  shield: '#7fe9ff',
};

// How far from the robot things wake up and go back to sleep. Everything
// outside is frozen in place, the way a side-scroller has always done it.
export const ACTIVE = { wakeX: 1100, wakeY: 800, sleepX: 1900, sleepY: 1300 };

export const COUNTDOWN = 0; // the robot starts at once; a boss has its own entrance

/** The gravity wells pull the robot this share as hard as they pull a charge: it is heavier. */
export const ROBOT_PULL = 0.5;

/** Seconds the boss is introduced before it moves, and the music doubles. */
export const BOSS_INTRO = 2.4;
