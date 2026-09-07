// Central tunables.
// The written mark is a small grammar: <R/D> pick one, (L) optional, and the
// slash inside the square brackets chooses between the whole left branch and
// V. It reads as REFLECTOR, DEFLECTOR, DEFECTOR or VECTOR. The spoken name
// (page title, store listing, home-screen icon) is Deflector.
export const GAME_MARK = '[<R/D>EF(L)/V]ECTOR';
export const GAME_NAME = 'Deflector';
export const GAME_TAGLINE = 'Reflect. Deflect. Defect.';
export const GAME_VERSION = '0.1.0-alpha'; // shown on the title screen; bump on each release

// Glyph indices of GAME_MARK lit for each reading; ECTOR is always lit.
export const MARK_READINGS = [
  { name: 'REFLECTOR', lit: [2, 6, 7, 9] },
  { name: 'DEFLECTOR', lit: [4, 6, 7, 9] },
  { name: 'DEFECTOR', lit: [4, 6, 7] },
  { name: 'VECTOR', lit: [12] },
];

export const PHYSICS_DT = 1 / 240; // fixed physics step (seconds)

export const BALL = {
  radius: 11,
  minSpeed: 150, // px/s - the ball never stalls below this
  maxSpeed: 1500, // px/s - hard cap so it can never tunnel through a wall
  trailLength: 22,
};

// How much of a moving surface's velocity transfers to the ball.
// 1.0 is the physically exact result for an infinitely massive moving wall.
// `toward` applies when the surface is closing on the ball (it speeds the
// ball up), `away` when it is retreating (it slows the ball down).
export const SURFACE_VELOCITY_FACTOR = { toward: 0.7, away: 1.0 };

export const PLAYER = {
  radius: 22,
  paddleWidth: 116,
  paddleOffset: 36,
  paddleThick: 6,
  moveSpeed: 430, // px/s
  turnSpeed: 7.0, // rad/s
  lungeExtend: 26, // px the paddle thrusts outward on a whack
  lungeSpeed: 260, // px/s of paddle travel during a whack
  retractPull: 16, // px the paddle pulls in while holding S
  // Keep-moving rule (human players only): cover a full body diameter within
  // campSeconds or lose; the HUD and a ring warn for the last campWarn seconds.
  campDistance: 44, // px, 2 x radius
  campSeconds: 8,
  campWarn: 2,
  invulnTime: 1.0, // seconds of immunity after being hit (only matters if lives > 1)
};

export const COUNTDOWN_SECONDS = 3;

// Difficulty is a shield pool: every body hit (or standing still) costs one
// shield and the ball re-serves; with none left the level, or the whole
// campaign, is lost. In a campaign the pool persists from level to level.
export const DIFFICULTIES = [
  { id: 'easy', name: 'Easy', shields: Infinity, blurb: 'unlimited shields' },
  { id: 'normal', name: 'Normal', shields: 5, blurb: '5 shields' },
  { id: 'hard', name: 'Hard', shields: 3, blurb: '3 shields' },
  { id: 'punishing', name: 'Punishing', shields: 1, blurb: '1 shield' },
];
export const DEFAULT_DIFFICULTY = 'normal';
