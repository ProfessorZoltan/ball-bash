// Central tunables. Change the working title here.
export const GAME_TITLE = 'BALL BASH';
export const GAME_TAGLINE = 'Deflect. Bank. Blindside.';

export const PHYSICS_DT = 1 / 240; // fixed physics step (seconds)

export const BALL = {
  radius: 11,
  minSpeed: 150, // px/s - the ball never stalls below this
  maxSpeed: 1500, // px/s - hard cap so it can never tunnel through a wall
  trailLength: 22,
};

// How much of a moving surface's velocity transfers to the ball.
// 1.0 is the physically exact result for an infinitely massive moving wall.
export const SURFACE_VELOCITY_FACTOR = 1.0;

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
  lives: 1, // one body hit ends the level
  invulnTime: 1.0, // seconds of immunity after being hit (only matters if lives > 1)
};

export const COUNTDOWN_SECONDS = 3;
