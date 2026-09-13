// Central tunables.
// The written mark is a small grammar: <R/D> pick one, (L) optional, and the
// slash inside the square brackets chooses between the whole left branch and
// V. It reads as REFLECTOR, DEFLECTOR, DEFECTOR or VECTOR. The spoken name
// (page title, store listing, home-screen icon) is Deflector.
export const GAME_MARK = '[<R/D>EF(L)/V]ECTOR';
export const GAME_NAME = 'Deflector';
export const GAME_TAGLINE = 'Reflect. Deflect. Defect.';
export const GAME_VERSION = '0.9.0-alpha'; // shown on the title screen; bump on each release

// Online multiplayer relay. Leave empty to use the LAN server that served
// the page (npm start). After deploying relay/ to Cloudflare, put its address
// here, e.g. 'wss://deflector-relay.<your-subdomain>.workers.dev', and the
// static site (Vercel) gets online play. Players can also paste a relay
// address in the lobby, which is remembered in their browser, or open the
// game with ?relay=<address>.
export const DEFAULT_RELAY = 'wss://deflector-relay.deflector-relay.workers.dev';

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
  // Safety net: if no shield has touched the ball for this long it is brought
  // back to the serve point for free. Nothing in a real rally comes close, so
  // reaching it means the ball is somewhere it cannot be played from: sealed
  // behind glass or a door, or wedged in geometry.
  stuckSeconds: 20,
};

/**
 * Versus ball speed. The host picks a pace; it multiplies whatever cap the
 * arena would use in the campaign, so a normal arena's 1500 px/s and a
 * conduit's 750 both scale from their own baseline and Standard is exactly
 * the game as it plays elsewhere.
 *
 * The fastest setting is limited by the physics, not by taste: at 240 Hz a
 * ball must not cross more than its own radius in one step or it can pass
 * through a wall between two frames. That puts the hard ceiling at
 * radius / PHYSICS_DT = 2640 px/s, and SPEED_CEILING keeps a margin under it.
 */
export const SPEED_CEILING = 2250; // px/s: 9.4 px per step, 85% of the ball's radius

/**
 * Volley: a versus mode with no ball of its own. Every fighter carries a
 * charge in its own colour at the centre of its shield and fires it with the
 * thrust. A charge lives `life` seconds and the next one forms when it dies,
 * so a fighter has exactly one in the air at a time, and a charge in anyone
 * else's colour costs a shield on the body.
 */
export const VOLLEY = {
  life: 3, // seconds a fired charge lives, and so the reload after firing
  // The ball's own radius: a charge is held to the arena's ball cap, and at
  // that speed a body this size still cannot cross itself in one 240 Hz step.
  radius: 11,
  muzzle: 14, // px beyond the shield's face that a charge leaves from
  grace: 0.1, // seconds a charge ignores the shield that fired it
};

/** A charge flies at the middle of the arena's speed range. */
export function volleySpeed(maxSpeed = BALL.maxSpeed) {
  return Math.round((BALL.minSpeed + maxSpeed) / 2);
}

export const VERSUS_SPEEDS = [
  { id: 'strategic', name: 'Strategic', mult: 0.5, blurb: 'half pace: every shot is a decision' },
  { id: 'measured', name: 'Measured', mult: 0.75, blurb: 'a shade slower than the campaign' },
  { id: 'standard', name: 'Standard', mult: 1, blurb: 'the campaign\'s own limit' },
  { id: 'quick', name: 'Quick', mult: 1.25, blurb: 'faster than anything in the campaign' },
  { id: 'chaotic', name: 'Chaotic', mult: 1.5, blurb: 'as fast as the physics allows' },
];
export const DEFAULT_VERSUS_SPEED = 'standard';

/** The cap a versus match runs at: the arena's own, scaled by the host's pace and held under the ceiling. */
export function versusMaxSpeed(def, id = DEFAULT_VERSUS_SPEED) {
  const pace = VERSUS_SPEEDS.find((s) => s.id === id) || VERSUS_SPEEDS.find((s) => s.id === DEFAULT_VERSUS_SPEED);
  const base = (def && def.maxBallSpeed) || BALL.maxSpeed;
  return Math.min(SPEED_CEILING, Math.max(BALL.minSpeed * 2, Math.round(base * pace.mult)));
}

// How much of a moving surface's velocity transfers to the ball.
// 1.0 is the physically exact result for an infinitely massive moving wall.
// `toward` applies when the surface is closing on the ball (it speeds the
// ball up), `away` when it is retreating (it slows the ball down).
export const SURFACE_VELOCITY_FACTOR = { toward: 0.7, away: 1.0 };

// The human fighter. `radius`, `paddleWidth`, `paddleOffset`, `moveSpeed` and
// `turnSpeed` are the standard frame's (Reflector's) values, kept here because
// the rest of the game measures itself against them; a frame overrides them
// (see src/frames.js). Everything else applies to every frame alike.
export const PLAYER = {
  radius: 22,
  paddleWidth: 116,
  paddleOffset: 36,
  paddleGap: 14, // px between the body's edge and the shield: the shield sits this far off any hull
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

// Co-op: two humans on one shield pool against the AI boss. Two shields cover
// far more lanes than one, so the boss takes this many body hits to go down.
export const COOP = {
  bossHitsPerHuman: 1, // the boss takes one body hit per human on the team (two humans: two hits)
  allyColors: ['#8dff9d', '#ff8df0'], // the second and third humans' colours in every arena
  maxAllies: 2,
};

// The relay protocol this build speaks; a relay reporting an older version in
// /health is out of date (redeploy relay/).
export const RELAY_PROTOCOL = 2;
