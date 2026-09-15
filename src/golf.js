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
  fineTurn: 0.12, // the turn's share while S is held: a tap of a frame moves the aim under half a degree
  flightSeconds: 9, // a flight this long is spent; the shot is over (a hole may set its own)
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

/**
 * A wormhole pair. The charge enters either mouth and leaves the other on the
 * same heading. A hole with more than one pair colours each, and a mouth
 * leads to the one in its own colour.
 */
function warp(ax, ay, bx, by, r = 36, color = null, extra = {}) {
  return { ax, ay, bx, by, r, color, ...extra };
}

/**
 * Two equal solid bodies circling each other: each rides a rail round their
 * common centre, half a turn apart, once every `period` seconds.
 */
function binary(cx, cy, R, period, body = {}) {
  const one = (phase) => planet(cx + Math.cos(phase) * R, cy + Math.sin(phase) * R, { ...body, rail: { cx, cy, R, period, phase } });
  return [one(0), one(Math.PI)];
}

/** A pair whose far mouth only lets go: nothing that reaches it is taken back. For a mouth that sits on an orbit. */
function oneWay(ax, ay, bx, by, r = 36, color = null) {
  return warp(ax, ay, bx, by, r, color, { oneWay: true });
}

/** The second pair's colour on a hole that has two. The first wears the palette's. */
const GOLD = '#ffd23f';

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
 * the tests need no special case. `tee` is where the charge rests and leaves
 * from; the launcher stands a muzzle's length behind it and turns around it,
 * so the aim is set with the charge as the pivot. `par` is what the hole is
 * worth.
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
    // A hole bigger than one screen says how much of itself the screen shows
    // at once, in world units; the camera does the rest.
    view: spec.view || null,
    // Open space: no walls drawn and none the charge could reach inside its
    // clock; `area` is the part of it the map shows.
    open: !!spec.open,
    area: spec.area || null,
    track: spec.track,
    maxBallSpeed: spec.maxBallSpeed || GOLF.maxSpeed,
    fuel: spec.fuel === undefined ? GOLF.fuel : spec.fuel,
    // A hole no line from the tee can sink without the gauge: the tests hold it to that.
    noBareLine: !!spec.noBareLine,
    // How long a flight may run before it is spent. A hole built round an
    // orbit needs more than one built round a bank shot.
    flightSeconds: spec.flightSeconds || GOLF.flightSeconds,
    palette: { ...VOID_PALETTE, ...(spec.palette || {}) },
    boundary: spec.boundary,
    obstacles: spec.obstacles || [],
    movers: spec.movers || [],
    wells: (spec.wells || []).concat([spec.cup]),
    cup: spec.cup,
    wormholes: spec.wormholes || [],
    tee: { x: tee.x, y: tee.y, angle },
    // The level shape the rest of the game reads. The state builder seats the
    // launcher behind the tee (its distance depends on the frame it wears).
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

/** A chamfered room of any size, with the same 60 px margin and 80 px corners as ROOM. */
function room(w, h) {
  return [
    [60, 140],
    [140, 60],
    [w - 140, 60],
    [w - 60, 140],
    [w - 60, h - 140],
    [w - 140, h - 60],
    [140, h - 60],
    [60, h - 140],
  ];
}

/** The window every hole bigger than a screen shows at once: one arena's worth. */
const SCREEN = { w: 1600, h: 900 };

export const COURSE = [
  hole({
    id: 'g1',
    hole: 1,
    par: 2,
    title: 'Slip Orbit',
    track: 'slip',
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
    track: 'narrows',
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
    track: 'maw',
    intro: 'The middle of this hole is a hole. Its reach covers everything between you and the cup, and nothing that crosses the horizon comes out. Two stones sit off to the sides for you to bank off or swing around, and a bar turns in the mouth of the last chamber. Go round, and time the bar.',
    record: 'The maw was here before the course was laid out. The course was laid out around it, which is a polite way of saying nobody could move it.',
    sunk: 'Round the maw and past the bar. The void keeps the charge and, for once, gives something back.',
    boundary: ROOM,
    tee: { x: 210, y: 735, angle: -0.55 },
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
  hole({
    id: 'g4',
    hole: 4,
    par: 3,
    title: 'Aftermouth',
    track: 'aftermouth',
    intro: 'The wall is back, and so are the mouths, and this time the far one faces a maw. Whatever line takes you in comes out pointed at it. A stone stands beside the far mouth, and the slower you pass a stone the harder it turns you: burn against your own flight before the mouth, come out crawling, and let the stone swing you up to the cup.',
    record: 'The second pair of mouths the void kept. Every charge that went through them at speed went into the maw; the ones that went through slowly are the ones that came back.',
    sunk: 'Out of the mouth at a crawl, round the stone, and up. Speed was the whole mistake.',
    boundary: ROOM,
    tee: { x: 200, y: 450, angle: 0 },
    obstacles: [
      rect(840, 450, 24, 780), // the wall, sealed
    ],
    wells: [planet(1150, 400, { r: 46, range: 340, pull: 52000 }), maw(1400, 610, { r: 40, range: 260, pull: 56000 })],
    cup: cup(1330, 150),
    wormholes: [warp(600, 450, 1000, 610)],
  }),
  hole({
    id: 'g5',
    hole: 5,
    par: 3,
    title: 'Carom',
    track: 'carom',
    intro: 'One mouth, one wall, and a maw sitting exactly where a straight line into the mouth would put you out. The mouth keeps whatever heading you give it, so give it a different one: bank off the plate first, and come into the mouth on a line that leaves the far side pointing at the cup.',
    record: 'The maw behind the far mouth has taken more charges than any other body on the course. Every one of them was sent straight.',
    sunk: 'Off the plate, into the mouth, and out on the line you chose. The maw saw nothing.',
    boundary: ROOM,
    tee: { x: 220, y: 700, angle: -0.2 },
    obstacles: [
      rect(840, 450, 24, 780), // the wall, sealed
      rect(420, 330, 240, 18, -15.5), // the plate: the bank that sets the heading
    ],
    wells: [maw(1330, 370, { r: 40, range: 280, pull: 56000 })],
    cup: cup(1380, 760),
    wormholes: [warp(640, 460, 1000, 560)],
  }),
  hole({
    id: 'g6',
    hole: 6,
    par: 4,
    title: 'Long Orbit',
    track: 'orbit',
    flightSeconds: 18,
    intro: 'A body big enough to hold you. Launched across its face at the tee\'s speed the charge neither falls in nor gets away: it goes round, and keeps going round. The cup sits in a pocket that only opens toward the body, so ride the orbit until the pocket comes round, then burn outward and let go.',
    record: 'The largest thing on the course, and the only hole with nothing to hit. Everything here is a matter of when.',
    sunk: 'Round, and round, and out. The void lets go of very little, and it let go of that.',
    boundary: ROOM,
    tee: { x: 514, y: 386, angle: -1.351 },
    obstacles: [
      // The pocket: a floor under the cup and a wall to its left, so the only way in faces the body.
      rect(1435, 300, 210, 18),
      rect(1330, 130, 20, 140),
      rect(1330, 400, 20, 200), // a fin under the floor: nothing gets in from below
    ],
    wells: [planet(800, 450, { r: 90, range: 600, pull: 184900 })],
    cup: cup(1420, 170),
  }),
  hole({
    id: 'g7',
    hole: 7,
    par: 3,
    title: 'Matched Pair',
    track: 'pair',
    intro: 'Two pairs of mouths, coloured so you can tell them apart: a mouth leads to the one in its own colour and nowhere else. The gold pair drops you into a sealed box on this side of the wall. The rose pair is what gets you out of it, and across. Come into the gold mouth on the one line that leaves the box pointed at the rose mouth, and the rose mouth leaves the far side pointed at the cup. Three mouths, one line.',
    record: 'The void kept two pairs on one hole once, and coloured them so it could tell them apart. It is not known whether that was for the void\'s benefit or ours.',
    sunk: 'Gold, then rose, then down. Read in the right order, the hole is one line.',
    boundary: ROOM,
    tee: { x: 200, y: 450, angle: 0.15 },
    obstacles: [
      rect(840, 450, 24, 780), // the wall, sealed
      // The box: sealed on every side. The gold pair is the only way in and the rose pair the only way out.
      rect(510, 520, 440, 16),
      rect(510, 760, 440, 16),
      rect(298, 640, 16, 256),
      rect(722, 640, 16, 256),
      rect(1180, 260, 220, 18, 28), // a plate on the far side, for a line off the rose mouth that comes out too high
    ],
    wells: [maw(1300, 730, { r: 40, range: 250, pull: 56000 })],
    cup: cup(1350, 426),
    wormholes: [warp(560, 250, 380, 700, 36, GOLD), warp(620, 567, 1000, 620)],
  }),
  hole({
    id: 'g8',
    hole: 8,
    par: 4,
    title: 'Relay',
    track: 'relay',
    width: 3200,
    height: 900,
    view: SCREEN,
    flightSeconds: 22,
    noBareLine: true,
    intro: 'The first hole longer than the screen: the map on P shows all of it, and the window follows the charge. A wall with one narrow gap in it, a mouth beyond the gap, and a second wall the mouth is the only way past. The far mouth sets you down on the orbit of a body at the far end, tangent to it if you came in level. Ride the orbit round to the pocket, and burn out.',
    record: 'Four things in a line, and each of them only lets through what the one before it sent straight. The void calls that a relay. So does anyone who has tried it.',
    sunk: 'Through the gap, through the mouth, round the body, and out. One line, and then one burn.',
    boundary: room(3200, 900),
    tee: { x: 200, y: 450, angle: 0.2 },
    obstacles: [
      // The first wall: a gap 110 px wide, a little below the middle.
      rect(900, 245, 24, 370),
      rect(900, 690, 24, 300),
      // The second wall: sealed. Only the mouth crosses it.
      rect(1700, 450, 24, 780),
      // The pocket at the far end, open toward the body.
      rect(3050, 340, 180, 18),
      rect(3050, 560, 180, 18),
    ],
    wells: [planet(2450, 450, { r: 90, range: 600, pull: 184900 })],
    cup: cup(3040, 450),
    // The far mouth sets the charge down a mouth's width beyond itself, on the
    // top of the orbit; it only lets go, or the next lap would take the charge back.
    wormholes: [oneWay(1300, 500, 2397, 150)],
  }),
  hole({
    id: 'g9',
    hole: 9,
    par: 5,
    title: 'Twin Bodies',
    track: 'twins',
    width: 3200,
    height: 1800,
    view: SCREEN,
    flightSeconds: 30,
    fuel: 8,
    intro: 'Two bodies, each big enough to hold an orbit, and the cup in a pocket beyond the second. You start on the first body\'s orbit. Somewhere on it there is a moment to burn that lifts you out of one field and drops you into the other; ride the second body round until the pocket comes by, and burn again. Eight pulses, two burns, and the map on P to plan them with.',
    record: 'The void kept two bodies close enough that a charge could belong to either. Most that have tried to change their mind about which have ended up belonging to neither.',
    sunk: 'One orbit, a burn, a second orbit, a burn. The longest hole on the course, and the only one that is all timing.',
    boundary: room(3200, 1800),
    tee: { x: 600, y: 1250, angle: -Math.PI / 2 },
    noBareLine: true,
    obstacles: [
      // A wall from the ceiling to below the second body's orbit: the corner the
      // cup sits in is entered from underneath, which the second orbit gives.
      rect(2700, 380, 24, 640),
    ],
    wells: [planet(900, 1250, { r: 90, range: 600, pull: 184900 }), planet(2300, 550, { r: 90, range: 600, pull: 184900 })],
    // The longest hole gathers a rough approach: the cup reaches further and pulls harder than any other.
    cup: cup(2960, 250, { range: 240, pull: 72000 }),
  }),
  // ------------------------------------------------------------ the back nine
  hole({
    id: 'g10',
    hole: 10,
    par: 3,
    title: 'The Deep',
    track: 'deep',
    open: true,
    width: 20000,
    height: 20000,
    view: SCREEN,
    area: { x: 9000, y: 9250, w: 3100, h: 1500 },
    flightSeconds: 12,
    intro: 'No walls. Nothing out here to bank off, nothing to stop a line that misses: a stray charge goes on into the dark until the clock takes it. Two stones, a maw, and the cup past them. Every line is the whole line.',
    record: 'The void does have walls, somewhere. No charge has flown far enough in its own time to find one, and the course does not expect that to change.',
    sunk: 'Nothing held it, nothing turned it back, and it went down anyway. That was all aim.',
    boundary: room(20000, 20000),
    tee: { x: 9400, y: 10000, angle: 0.1 },
    wells: [planet(10250, 9760, { r: 60, range: 460, pull: 66000 }), planet(10950, 9430, { r: 48, range: 380, pull: 50000 }), maw(10800, 10440, { r: 44, range: 360, pull: 60000 })],
    cup: cup(11500, 9820),
  }),
  hole({
    id: 'g11',
    hole: 11,
    par: 2,
    title: 'The Long Way',
    track: 'longway',
    width: 4800,
    height: 900,
    view: SCREEN,
    maxBallSpeed: 440,
    flightSeconds: 10.4,
    intro: 'Three screens of open floor between the tee and the cup, and a heavy charge: out here nothing can push it past the speed it leaves at, so a pulse can turn it but never hurry it. A straight line makes the cup with the clock all but spent, if nothing on the way bends it wrong. The mouth up by the tee is a shortcut, and comes with the time to fix what it does to your line.',
    record: 'The long way is faster than it looks and slower than it needs to be. The mouth was cut later, by someone who had run out of clock one time too many.',
    sunk: 'Down, one way or the other. The clock never says which.',
    boundary: room(4800, 900),
    tee: { x: 200, y: 450, angle: 0 },
    obstacles: [
      rect(3550, 130, 260, 18, -20), // a plate near the far end, for a line that comes in high
    ],
    // The stones sit a little off the straight line and bend it a little: the
    // line that makes the cup is not quite the line that points at it.
    wells: [planet(1500, 210, { r: 50, range: 420, pull: 10000 }), planet(2800, 690, { r: 50, range: 420, pull: 10000 }), maw(2200, 790, { r: 36, range: 220, pull: 50000 })],
    cup: cup(4550, 450),
    wormholes: [warp(700, 150, 3900, 700)],
  }),
  hole({
    id: 'g12',
    hole: 12,
    par: 3,
    title: 'Binary',
    track: 'binary',
    flightSeconds: 14,
    intro: 'Two stones of one size, circling each other. They were turning before you got here and they will be turning after; the line to the cup runs straight through the middle of them, and whether the middle is open or a stone is standing in it is a matter of when you launch. Watch a turn, and choose your moment.',
    record: 'The only things on the course that move on their own. The void set them going and forgot to stop them, or never meant to.',
    sunk: 'Through the pair, between one stone and the next, and down. Timing is aim too.',
    boundary: ROOM,
    tee: { x: 200, y: 450, angle: 0 },
    wells: binary(800, 450, 220, 16, { r: 56, range: 380, pull: 56000 }).concat([maw(1500, 450, { r: 36, range: 150, pull: 50000 })]),
    // A miss is not handed back by the wall behind the cup: the maw there takes it.
    cup: cup(1330, 450),
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
