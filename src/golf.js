// Galactic Golf: the course beyond the arcade.
//
// Out past the last room the Architect drew there is nothing to deflect and
// nobody to beat. There is a tee, a charge, and a long fall. You tilt the
// frame to pick a line, thrust once to launch, and from then on the only say
// you have is the ion gauge: a handful of pulses that shove the charge
// sideways mid-flight. One launch per attempt, and the launches are counted.
//
// Three kinds of gravity body stand on a hole, and they are told apart by what
// happens when you reach one:
//
//   planet   solid. Its surface bounces the charge; its field bends anything
//            that passes. Bank off one, or slingshot round it.
//   maw      a black hole. Its horizon ends the shot, and the launch counts.
//   cup      the goal: a small black hole with a short, hard pull. Reach it
//            and the hole is done.
//
// Wormholes come in pairs and carry the charge through at the speed and
// heading it arrived with, which is the whole difficulty: the mouth decides
// where you come out, and your line decides where you go next.
import { rect } from './levels.js';

export const GOLF = {
  launchSpeed: 430, // px/s: every launch leaves the tee at exactly this speed
  maxSpeed: 1400, // px/s the field can wind a charge up to
  fuel: 6, // ion pulses per launch
  pulse: 125, // px/s a pulse adds along the held heading
  aimRay: 250, // px of the launch line shown at the tee: the first leg, and no more
  headTurn: 3.6, // rad/s the pulse heading swings during flight
  flightSeconds: 9, // a flight this long is spent; the shot is over
  muzzle: 16, // px beyond the shield's face the charge leaves from
  warpHold: 0.14, // seconds a warped charge ignores every wormhole mouth
  ghostStep: 1 / 30, // seconds between the points kept for the ghost of the last flight
  sinkPause: 1.2, // seconds the sunk charge is watched before the hole card
  missPause: 1.0, // seconds before the charge is back on the tee after a dead shot
};

/** A solid gravity body: the charge bounces off its surface and bends in its field. */
function planet(x, y, extra = {}) {
  return { x, y, r: 52, range: 400, pull: 56000, drag: 0, solid: true, ...extra };
}

/** A black hole with no prize in it: past the horizon the shot is over. */
function maw(x, y, extra = {}) {
  return { x, y, r: 40, range: 340, pull: 62000, drag: 0, hazard: true, ...extra };
}

/** The goal: a small horizon with a short, hard pull, so a near miss is still a sink. */
function cup(x, y, extra = {}) {
  return { x, y, r: 26, range: 125, pull: 48000, drag: 0, ...extra };
}

/** A wormhole pair. The charge enters either mouth and leaves the other on the same heading. */
function warp(ax, ay, bx, by, r = 36) {
  return { ax, ay, bx, by, r };
}

const VOID_PALETTE = {
  floor: '#04060f',
  grid: 'rgba(120, 150, 255, 0.07)',
  wall: '#8fd4ff',
  wallDark: '#0e2340',
  obstacle: '#c9a3ff',
  obstacleDark: '#2a1a46',
  well: '#b49cff', // a black hole's rings
  planet: '#ffb347', // a solid body's surface
  cup: '#7dffc4', // the goal
  warp: '#ff8df0', // wormhole mouths
};

/**
 * A hole, in the same shape as a level so the state builder, the renderer and
 * the tests need no special case. `tee` doubles as the player spawn and the
 * charge's rest position; `par` is what the hole is worth.
 */
function hole(spec) {
  const tee = spec.tee;
  const angle = tee.angle || 0;
  return {
    golf: true,
    id: spec.id,
    hole: spec.hole,
    par: spec.par,
    title: spec.title,
    bossName: 'The Cup',
    intro: spec.intro,
    record: spec.record,
    stopped: spec.sunk,
    width: spec.width || 1600,
    height: spec.height || 900,
    track: spec.track,
    maxBallSpeed: spec.maxBallSpeed || GOLF.maxSpeed,
    fuel: spec.fuel === undefined ? GOLF.fuel : spec.fuel,
    palette: { ...VOID_PALETTE, ...(spec.palette || {}) },
    boundary: spec.boundary,
    obstacles: spec.obstacles || [],
    movers: spec.movers || [],
    wells: (spec.wells || []).concat([spec.cup]),
    cup: spec.cup,
    wormholes: spec.wormholes || [],
    tee: { x: tee.x, y: tee.y, angle },
    // The level shape the rest of the game reads: the launcher stands at the
    // tee and never moves, and the charge rests there until it is launched.
    player: { x: tee.x, y: tee.y, angle },
    ball: { x: tee.x, y: tee.y, speed: spec.launchSpeed || GOLF.launchSpeed, angleDeg: (angle * 180) / Math.PI },
  };
}

const ROOM = [
  [60, 140],
  [140, 60],
  [1460, 60],
  [1540, 140],
  [1540, 760],
  [1460, 840],
  [140, 840],
  [60, 760],
];

export const COURSE = [
  hole({
    id: 'g1',
    hole: 1,
    par: 2,
    title: 'Slip Orbit',
    track: 'nullspace',
    intro: 'One body stands between the tee and the cup, and it is solid: straight at it is straight back at you. Pass it high and its field pulls you down on the far side, so the line that sinks the cup is not the line that points at it. Aim off, and let the fall do the aiming.',
    record: 'The first hole the void ever kept. There is nothing here but a stone, a pull, and a hole in the floor behind them — and that is enough to take most of an afternoon.',
    sunk: 'Down in two, or down in nine: the void does not write which. It only writes that it went down.',
    boundary: ROOM,
    tee: { x: 210, y: 560, angle: -0.23 },
    wells: [planet(770, 430, { r: 60, range: 420, pull: 60000 })],
    cup: cup(1340, 300),
    obstacles: [
      // Angled plates: a shot that sails past comes back for another pass, and
      // one sent the wrong way does not simply retrace its own line.
      rect(1330, 760, 320, 18, -20),
      rect(430, 170, 260, 18, 18),
      rect(420, 760, 240, 18, -12),
    ],
  }),
  hole({
    id: 'g2',
    hole: 2,
    par: 3,
    title: 'The Narrows',
    track: 'spire',
    intro: 'A wall with no door in it, and one pair of mouths that ignores the wall. A wormhole gives back exactly the heading it was given, so the shot is decided before you reach it: come into the near mouth on the line you want out of the far one. The cup waits in a hook on the far side, and the hook only opens one way.',
    record: 'The wall was drawn first and the mouths were found later, which is the order most things out here happened in. Nothing has ever gone over the wall.',
    sunk: 'Through the wall without touching it. The hook lets go of very few.',
    boundary: ROOM,
    tee: { x: 200, y: 450, angle: -0.12 },
    obstacles: [
      // The wall: sealed, floor to ceiling. Only the mouths cross it.
      rect(840, 450, 24, 780),
      // The hook around the cup: a roof and a left wall, open from below.
      rect(1375, 150, 290, 20),
      rect(1240, 300, 20, 320),
    ],
    wells: [planet(1060, 430, { r: 44, range: 340, pull: 46000 }), maw(1140, 780, { r: 38, range: 300, pull: 60000 })],
    cup: cup(1400, 260),
    wormholes: [warp(600, 300, 1000, 640)],
  }),
  hole({
    id: 'g3',
    hole: 3,
    par: 3,
    title: 'The Maw',
    track: 'undercroft',
    intro: 'The middle of this hole is a hole. Its reach covers everything between you and the cup, and nothing that crosses the horizon comes out. Two stones sit off to the sides for you to bank off or swing around, and a bar turns in the mouth of the last chamber. Go round, and time the bar.',
    record: 'The maw was here before the course was laid out. The course was laid out around it, which is a polite way of saying nobody could move it.',
    sunk: 'Round the maw and past the bar. The void keeps the charge and, for once, gives something back.',
    boundary: ROOM,
    tee: { x: 200, y: 770, angle: -0.55 },
    wells: [maw(800, 450, { r: 44, range: 460, pull: 70000 }), planet(520, 210, { r: 42, range: 300, pull: 40000 }), planet(1010, 730, { r: 42, range: 300, pull: 40000 })],
    cup: cup(1400, 180),
    movers: [{ type: 'spinner', x: 1230, y: 330, length: 150, thick: 10, omega: 0.55, angle: 0.4 }],
    obstacles: [
      // The chamber the cup sits in: a floor under it and a stub above, so the
      // way in is the gap the bar turns through.
      rect(1385, 340, 280, 18),
      rect(1245, 125, 18, 120),
    ],
  }),
];

/** "Hole 2", for the HUD and the roster. */
export function holeLabel(def) {
  return `Hole ${def.hole}`;
}

/** The course's total par. */
export const COURSE_PAR = COURSE.reduce((n, h) => n + h.par, 0);

/** How a score reads against par: -1 under, level, +2 over. */
export function toPar(n) {
  if (n === 0) return 'level';
  return n > 0 ? `+${n}` : String(n);
}
