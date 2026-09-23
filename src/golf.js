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

/**
 * A fount, a white hole: a small solid core whose field pushes instead of
 * pulls. A line that passes it bends outward, and one sent straight at it is
 * turned back before it gets there.
 */
function fount(x, y, extra = {}) {
  return { x, y, r: 22, range: 170, pull: -40000, drag: 0, solid: true, fount: true, ...extra };
}

/** A turning cage: `count` solid bars on a ring of `radius` round (x, y), a gap between each, turning once every `period` seconds. */
function cage(x, y, { radius = 80, count = 2, length = 150, thick = 6, period = 12, angle = 0 } = {}) {
  return { type: 'orbiter', x, y, radius, count, length, thick, omega: (Math.PI * 2) / period, angle };
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

/**
 * A pair whose mouths circle something: `a` and `b` are each an orbit
 * { cx, cy, R, period, phase } (a negative period turns the other way) or a
 * fixed point { x, y }. The orbits run on the level's clock from the moment
 * the hole opens, like a stone on a rail, so where a mouth will be is a
 * matter of when you launch. `extra` takes { oneWay } like any pair.
 */
function orbitingWarp(a, b, r = 36, color = null, extra = {}) {
  const orbit = (o) => o.R !== undefined;
  const at = (o) => (orbit(o) ? [o.cx + Math.cos(o.phase || 0) * o.R, o.cy + Math.sin(o.phase || 0) * o.R] : [o.x, o.y]);
  return warp(...at(a), ...at(b), r, color, { orbitA: orbit(a) ? a : null, orbitB: orbit(b) ? b : null, ...extra });
}

/**
 * A flat pair: two slots set in wall faces. `a` and `b` are { x, y, face }:
 * the slot's centre on its wall, and the way the face looks out into the
 * room, in degrees. The charge goes into one face and out of the other,
 * turned by the angle between them (warpCharge), at the same place across the
 * slot and the same speed. `half` is half a slot's width.
 */
function slots(a, b, { half = 48, color = null, oneWay = false } = {}) {
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y, r: half, color, oneWay, flat: true, half, aAngle: (a.face * Math.PI) / 180, bAngle: (b.face * Math.PI) / 180 };
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
  fount: '#fff1b8', // a white hole
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
    // The arcade's pieces, on the Far Course. Glass (an obstacle with
    // `glass: true`) that only a charge at `breakSpeed` breaks, and that stays
    // broken until the next launch; doors a switch node holds open for its
    // `holdOpen` seconds; and floor emitters, whose rings shove the charge.
    glass: { breakSpeed: 1000, speedKeep: 0.85, regrow: 1e9, ...(spec.glass || {}) },
    doors: spec.doors || [],
    nodes: spec.nodes || [],
    emitters: spec.emitters || [],
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
  hole({
    id: 'g13',
    hole: 13,
    par: 3,
    title: 'Lockstep',
    track: 'lockstep',
    intro: 'The wall is sealed, and both mouths are moving. One circles a maw on this side, the other circles the cup on the far side, and they turn together: wherever the first stands on its maw, the second stands in the same place on the cup. Go into the first heading for the maw\'s heart and you come out of the second heading for the cup\'s. Aim at the maw, and launch as the mouth swings round into your line. Miss it, and the maw is where that line was going.',
    record: 'Two mouths that keep time with each other and with nothing else. The void set them turning at the same moment, and in all the time since, neither has gained a step.',
    sunk: 'Into the black hole\'s line, out on the cup\'s. The mouths never missed a step; the launch had to.',
    boundary: ROOM,
    tee: { x: 200, y: 450, angle: -0.35 },
    obstacles: [
      rect(840, 450, 24, 780), // the wall, sealed: only the mouths cross it
    ],
    wells: [maw(540, 450, { r: 40, range: 300, pull: 52000 })],
    cup: cup(1240, 450),
    // In step: the same period and phase, so each mouth sits at the same angle on its own body.
    wormholes: [orbitingWarp({ cx: 540, cy: 450, R: 150, period: 7, phase: 0 }, { cx: 1240, cy: 450, R: 175, period: 7, phase: 0 })],
  }),
  hole({
    id: 'g14',
    hole: 14,
    par: 4,
    title: 'Syncopation',
    track: 'syncopation',
    flightSeconds: 8,
    intro: 'Lockstep again, with two things in the way. A fount stands between you and the maw: a white hole, which pushes where a maw pulls, so the straight line comes back at you and every other line bends out round it. And the cup turns in a cage of two bars with a gap between each, on a clock of its own: the mouths go round every eight seconds, the cage every twelve. The mouth still carries your heading from the maw across to the cup, but it is only a sink if the fount bent you into that heading and a gap is facing you when you come out. Watch both clocks, and the ghost of your last flight.',
    record: 'The mouths keep time with each other and the cage keeps time with nothing. Three turns of the mouths to two of the cage, and the void has never once let both land on the same beat for long.',
    sunk: 'Round the fount, through the mouth, and in through the gap. Two clocks, and the launch was on both of them.',
    boundary: ROOM,
    tee: { x: 190, y: 450, angle: 0 }, // straight at the fount: the one line that is certain to come back
    obstacles: [
      rect(840, 450, 24, 780), // the wall, sealed: only the mouths cross it
    ],
    wells: [
      maw(560, 450, { r: 40, range: 300, pull: 52000 }),
      fount(350, 450), // on the line from the tee to the maw's heart
      // Two small maws above and below the cup take what the cage turns away.
      maw(1240, 120, { r: 30, range: 130, pull: 40000 }),
      maw(1240, 780, { r: 30, range: 130, pull: 40000 }),
    ],
    // The cup's reach stops short of where the mouth sets you down, so the heading has to be right on its own.
    cup: cup(1240, 450, { range: 100 }),
    movers: [cage(1240, 450, { radius: 80, count: 2, length: 150, thick: 6, period: 12 })],
    wormholes: [orbitingWarp({ cx: 560, cy: 450, R: 150, period: 8, phase: 0 }, { cx: 1240, cy: 450, R: 175, period: 8, phase: 0 })],
  }),
  hole({
    id: 'g15',
    hole: 15,
    par: 4,
    title: 'Lenses',
    track: 'lenses',
    open: true,
    width: 20000,
    height: 20000,
    view: SCREEN,
    area: { x: 9000, y: 9000, w: 3600, h: 2000 },
    flightSeconds: 12,
    intro: 'Open space again, and the void has put up founts. Two of them side by side make a lens: whatever goes between them is bent toward one point, and the lens in front of the tee bends every line through it toward the same point, which leads nowhere. The cup sits behind a second lens, beyond a stone. Find the line the first lens does not take. A maw is not only a hazard: pass close enough to its edge without crossing it and it turns you as hard as any stone. Nothing out here stops a line that misses.',
    record: 'The founts came after the stones, and nobody asked them to stand in pairs. They did anyway, and the void has been focusing its own light ever since.',
    sunk: "Under the lens, round the maw's edge, round the stone, and through the second lens. Four bends, and not one wall.",
    boundary: room(20000, 20000),
    tee: { x: 9300, y: 10600, angle: -0.27 }, // straight through the first lens: the obvious line, and it goes nowhere
    wells: [
      fount(9950, 10280, { range: 190 }),
      fount(9950, 10560, { range: 190 }),
      maw(10500, 10800, { r: 44, range: 360, pull: 60000 }),
      planet(10807, 10448, { r: 60, range: 520, pull: 90500 }),
      fount(11266, 9426, { range: 190 }),
      fount(11554, 9426, { range: 190 }),
      maw(12350, 10050, { r: 40, range: 340, pull: 56000 }),
    ],
    cup: cup(11410, 9136),
  }),
  hole({
    id: 'g16',
    hole: 16,
    par: 5,
    title: 'Rendezvous',
    track: 'rendezvous',
    width: 3200,
    height: 1800,
    view: SCREEN,
    flightSeconds: 24,
    noBareLine: true,
    intro: 'A body big enough to park on, and the way on is a mouth that circles it further out, on a clock of its own. The tee sets you on a low orbit. Burn along your flight and you climb; the top of the climb comes a little over a third of a lap later, and the mouth has to be there when you arrive. A maw rides a rail between the two orbits the other way round, and whatever meets it on the way up is gone. The mouth only lets go at its far end: from there, steer in.',
    record: 'The mouth was set turning so that nothing could simply aim at it. What wanted to get through learned to wait for it instead.',
    sunk: 'Parked, climbed, met, and steered. The void keeps a timetable, and you kept to it.',
    boundary: room(3200, 1800),
    tee: { x: 620, y: 1100, angle: -Math.PI / 2 },
    wells: [
      planet(900, 1100, { r: 90, range: 900, pull: 184900 }),
      maw(900, 1100, { r: 26, range: 66, pull: 40000, rail: { cx: 900, cy: 1100, R: 385, period: -7, phase: 0 } }),
    ],
    cup: cup(2900, 500),
    // The way in circles the body well outside the parking orbit; the way out only lets go.
    wormholes: [orbitingWarp({ cx: 900, cy: 1100, R: 490, period: 11, phase: 3 }, { x: 2500, y: 500 }, 36, null, { oneWay: true })],
  }),
  hole({
    id: 'g17',
    hole: 17,
    par: 4,
    title: 'Heavy Water',
    track: 'heavywater',
    width: 1600,
    height: 2700,
    view: SCREEN,
    maxBallSpeed: 440,
    flightSeconds: 12,
    intro: 'Three screens down, and the charge is heavy again: nothing hurries it, and the slower a thing moves the harder a stone turns it. Two floors with no gaps in them; only the mouths go down. The gold mouth takes you to the middle floor, where a stone swings the slow charge round into the rose mouth, and the rose mouth sits in a turning cage. Its far end is on the bottom floor, and it keeps the heading the stone gave you. Aim the gold, and time the cage.',
    record: 'The deep end of the course, where charges sink rather than fly. The stone on the middle floor has turned more of them than any other body out here, because every one of them arrives slowly.',
    sunk: 'Gold, the stone, the cage, rose, and down. Slowly, the whole way.',
    boundary: room(1600, 2700),
    tee: { x: 300, y: 250, angle: 0 },
    obstacles: [
      rect(800, 900, 1480, 24), // the first floor, sealed
      rect(800, 1800, 1480, 24), // the second floor, sealed
    ],
    movers: [cage(1330, 1640, { radius: 70, count: 2, length: 120, thick: 6, period: 5 })],
    wells: [
      maw(1250, 760, { r: 36, range: 200, pull: 50000 }), // takes what rattles round the top floor
      planet(760, 1560, { r: 50, range: 420, pull: 45000 }),
      maw(1150, 2560, { r: 40, range: 260, pull: 50000 }),
    ],
    cup: cup(900, 2390),
    wormholes: [warp(1200, 500, 250, 1150, 36, GOLD), warp(1330, 1640, 400, 2000)],
  }),
  hole({
    id: 'g18',
    hole: 18,
    par: 6,
    title: 'Grand Tour',
    track: 'finale',
    width: 3200,
    height: 1800,
    view: SCREEN,
    flightSeconds: 30,
    fuel: 8,
    noBareLine: true,
    intro: 'The last hole is all of them. A gate with a bar turning in it between you and the second screen. A stone and a maw to go between, which pull opposite ways and forgive nothing. A mouth up by the ceiling that sets you down on the orbit of a body two screens away, a maw riding a rail outside that orbit, and the cup in a turning cage with a maw above it and below. The orbit is where you catch your breath: ride it until the cage and the maw on the rail both let you through, then burn. Eight pulses, and the map on P.',
    record: 'Nobody built the last hole. It is what was left when every other hole had been laid out: all the pieces that were too hard to put anywhere else.',
    sunk: 'Through the gate, between the two, up and through, round, and in. The course is played.',
    boundary: room(3200, 1800),
    tee: { x: 250, y: 450, angle: 0 },
    obstacles: [
      rect(1600, 225, 24, 330), // the wall between the top two screens, above the gate
      rect(1600, 705, 24, 390), // and below it: the gate is y 390..510
      rect(1600, 900, 3080, 24), // the floor between top and bottom, sealed
    ],
    movers: [
      { type: 'spinner', x: 1600, y: 450, length: 110, thick: 8, omega: 1.3, angle: 0 },
      cage(2400, 1350, { radius: 80, count: 2, length: 150, thick: 6, period: 12 }),
    ],
    wells: [
      maw(800, 790, { r: 36, range: 200, pull: 50000 }), // takes what rattles round the tee's screen
      planet(2250, 230, { r: 50, range: 330, pull: 50000 }), // the saddle: a stone above the line,
      maw(2250, 660, { r: 40, range: 280, pull: 56000 }), // and a maw below it
      planet(800, 1350, { r: 90, range: 560, pull: 184900 }),
      maw(800, 1350, { r: 26, range: 80, pull: 40000, rail: { cx: 800, cy: 1350, R: 450, period: -9, phase: 0 } }),
      maw(2400, 1030, { r: 30, range: 130, pull: 40000 }),
      maw(2400, 1670, { r: 30, range: 130, pull: 40000 }),
      maw(2980, 1180, { r: 40, range: 260, pull: 56000 }), // overshoots
      maw(2980, 1560, { r: 40, range: 260, pull: 56000 }),
    ],
    cup: cup(2400, 1350, { range: 100 }),
    wormholes: [warp(2700, 150, 620, 1110, 36, null, { oneWay: true })],
  }),
];

// ---------------------------------------------------------- the Far Course
//
// Eighteen more, for a player who has finished the first course: no hole on
// it gives itself away. The first six are the outer ring, each built on one
// idea the first course never asked of you; the middle six put two together;
// the inner six need the gauge to sink at all.

/** The minor-key void the Far Course is played in: the same bodies, a colder light. */
const FAR_PALETTE = {
  floor: '#03040b',
  grid: 'rgba(150, 120, 255, 0.06)',
  wall: '#a9b8ff',
  wallDark: '#12173a',
  obstacle: '#9fb4ff',
  obstacleDark: '#161c44',
  node: '#6e7fa8',
  nodeLit: '#7dffc4',
  door: '#ff9d6b',
  doorDark: '#3a1a12',
  emitter: '#ff8df0',
};

/** A Far Course hole: a hole with the Far Course's light, and its id and number. */
function farHole(spec) {
  return { ...hole({ ...spec, palette: { ...FAR_PALETTE, ...(spec.palette || {}) } }), course: 'far' };
}

export const FAR_COURSE = [
  farHole({
    id: 'f1',
    hole: 1,
    par: 3,
    title: 'Needle',
    track: 'needle',
    intro: 'The gauge is dry here: whatever the launch gives the charge is all it gets. One channel runs through the wall in front of the cup, a charge and a hair wide, and the stone below bends every line on its way there. Somewhere in the circle is the one that threads it, and fine aim finds it a hair at a time.',
    record: 'The Far Course opens on the narrowest thing in the void, and it was cut that way on purpose. Nothing out here has been made narrower since, though the course has had long enough to try.',
    sunk: 'Through the eye, and not a hair either side.',
    boundary: ROOM,
    fuel: 0,
    flightSeconds: 3.6,
    tee: { x: 180, y: 720, angle: -0.5 },
    wells: [
      planet(640, 600, { r: 60, range: 460, pull: 70000 }),
      maw(1040, 150, { r: 36, range: 220, pull: 50000 }),
    ],
    cup: cup(1440, 300, { range: 110 }),
    obstacles: [
      // The eye: one channel through a thick wall, a ball and a hair wide.
      rect(1250, 166, 160, 212, 0),
      rect(1250, 583, 160, 512, 0),
    ],
  }),
  farHole({
    id: 'f2',
    hole: 2,
    par: 4,
    title: 'Carousel',
    track: 'carousel',
    intro: 'The cup rides a rail round a stone, and a maw rides the same rail half a turn behind it. One gate lets you into the ring. The line through the gate is the easy part; the hard part is when. Launch so the cup comes round to meet you, and not the thing that follows it.',
    record: 'The rail was laid for the cup alone. The maw found it later, and took the only seat left.',
    sunk: 'Caught on the way round. The rider behind it waits another turn.',
    width: 3200,
    height: 900,
    view: SCREEN,
    boundary: room(3200, 900),
    flightSeconds: 8,
    tee: { x: 240, y: 450, angle: -0.25 },
    wells: [
      planet(2560, 420, { r: 70, range: 480, pull: 80000 }),
      // The rider behind the cup: the same rail, half a turn back.
      maw(2310, 420, { r: 34, range: 170, pull: 56000, rail: { cx: 2560, cy: 420, R: 250, period: 9, phase: Math.PI } }),
      planet(1250, 250, { r: 44, range: 300, pull: 40000 }),
      planet(1250, 650, { r: 44, range: 300, pull: 40000 }),
    ],
    cup: cup(2810, 420, { range: 100, rail: { cx: 2560, cy: 420, R: 250, period: 9, phase: 0 } }),
    obstacles: [
      // The carousel's fence, and its one gate.
      rect(2050, 330, 30, 540, 0),
      rect(2050, 789, 30, 98, 0),
    ],
  }),
  farHole({
    id: 'f3',
    hole: 3,
    par: 4,
    title: 'Glasshouse',
    track: 'glasshouse',
    intro: 'A floor of glass lies across the room, and the cup is above it. Glass this thick gives only to a charge moving a thousand a second or more, and the only thing out here that fast is a charge falling past the maw under the floor. Skim its edge, go up through the glass, then burn: you will be moving far too fast to stop on your own.',
    record: 'Every pane of the floor has been broken, one launch at a time, and the course puts every one of them back before the next.',
    sunk: 'Through the glass at full speed, and into the cup at none.',
    width: 1600,
    height: 1800,
    view: SCREEN,
    boundary: room(1600, 1800),
    fuel: 4,
    flightSeconds: 7,
    tee: { x: 300, y: 1600, angle: -1.2 },
    wells: [
      maw(800, 1060, { r: 36, range: 800, pull: 300000 }),
    ],
    cup: cup(1060, 600, { range: 110 }),
    obstacles: [
      // A floor of glass across the room, just above the maw: only the panes
      // nearest its horizon can be struck hard enough to break.
      { poly: rect(152.5, 900, 185, 16, 0), color: '#7fe9d6', glass: true },
      { poly: rect(337.5, 900, 185, 16, 0), color: '#b8fff0', glass: true },
      { poly: rect(522.5, 900, 185, 16, 0), color: '#7fe9d6', glass: true },
      { poly: rect(707.5, 900, 185, 16, 0), color: '#b8fff0', glass: true },
      { poly: rect(892.5, 900, 185, 16, 0), color: '#7fe9d6', glass: true },
      { poly: rect(1077.5, 900, 185, 16, 0), color: '#b8fff0', glass: true },
      { poly: rect(1262.5, 900, 185, 16, 0), color: '#7fe9d6', glass: true },
      { poly: rect(1447.5, 900, 185, 16, 0), color: '#b8fff0', glass: true },
    ],
  }),
  farHole({
    id: 'f4',
    hole: 4,
    par: 4,
    title: 'Switchback',
    track: 'switchback',
    intro: 'The cup\'s house has one door, and it is shut. The switch down the room opens it for four seconds and no longer. Bank off the switch and come straight back, and have the gauge ready: the door will not wait for a charge that wanders.',
    record: 'The door was hung before the switch was wired. For a long time the cup here was simply closed.',
    sunk: 'Out, back, and in before the door swung to.',
    width: 3200,
    height: 900,
    view: SCREEN,
    boundary: room(3200, 900),
    flightSeconds: 8,
    tee: { x: 1400, y: 720, angle: -0.1 },
    wells: [
      planet(1900, 640, { r: 50, range: 340, pull: 45000 }),
    ],
    cup: cup(820, 210, { range: 110 }),
    obstacles: [
      // The cup's house: shut on every side but one, and that side a door.
      rect(840, 380, 460, 24, 0),
      rect(610, 225, 24, 330, 0),
    ],
    doors: [rect(1060, 220, 24, 316, 0)],
    nodes: [{ x: 2350, y: 420, r: 56, kind: 'switch', toggles: [0], holdOpen: 4 }],
  }),
  farHole({
    id: 'f5',
    hole: 5,
    par: 5,
    title: 'Eclipse',
    track: 'eclipse',
    intro: 'Two stones stand between the tee and the cup, and neither is always there. Each keeps its own clock, drawn round it as a ring: there, then gone, then there again. A line that needs a stone to bend it needs it standing; a line through where one stood needs it gone. Read both clocks before you launch.',
    record: 'The two stones have been out of step since the course was laid. Once in a long while their clocks agree, and the whole hole goes dark.',
    sunk: 'Between the two clocks, while neither was looking.',
    open: true,
    width: 20000,
    height: 20000,
    view: SCREEN,
    area: { x: 9000, y: 9300, w: 3000, h: 1400 },
    flightSeconds: 10,
    boundary: room(20000, 20000),
    tee: { x: 9300, y: 10200, angle: -0.2 },
    wells: [
      planet(10200, 9900, { r: 64, range: 520, pull: 90000, phasing: { on: 5, off: 3, offset: 0 } }),
      planet(10900, 10250, { r: 64, range: 480, pull: 80000, phasing: { on: 3, off: 4, offset: 1.5 } }),
      maw(10750, 9560, { r: 40, range: 300, pull: 55000 }),
    ],
    cup: cup(11600, 9950),
  }),
  farHole({
    id: 'f6',
    hole: 6,
    par: 4,
    title: 'Breakers',
    track: 'breakers',
    intro: 'A great maw lies across the way, and nothing at launch speed gets past it. Just off the tee an emitter throws a ring every three seconds, faster than the charge. Let a ring catch you from behind and it throws you across; meet one head on and it throws you back where you came from.',
    record: 'The emitter was set here to keep the maw fed. It has been used the other way ever since.',
    sunk: 'Carried over on the break, and down on the far shore.',
    open: true,
    width: 20000,
    height: 20000,
    view: SCREEN,
    area: { x: 9000, y: 9300, w: 3800, h: 1400 },
    boundary: room(20000, 20000),
    flightSeconds: 9,
    tee: { x: 9300, y: 10000, angle: 0.25 },
    wells: [
      maw(10900, 10050, { r: 44, range: 700, pull: 130000 }),
    ],
    cup: cup(12400, 9900),
    emitters: [
      { x: 9750, y: 10000, period: 3, speed: 900, maxRadius: 380, thick: 8, warn: 0.8, delay: 1.5 },
    ],
  }),
  farHole({
    id: 'f7',
    hole: 7,
    par: 4,
    title: 'Periscope',
    track: 'periscope',
    intro: 'Four rooms sealed from each other, and three pairs of slots set in their walls. A slot hands the charge out of its partner\'s face turned by the angle between the two, a right angle every time here, so the line through all three is one line, folded. The stone by the tee bends it into the first. A degree off there is a wall by the third.',
    record: 'The slots were not cut to suit the rooms. They were cut where a line already ran, and the walls went up round them afterwards.',
    sunk: 'One line, folded three times, and it never touched a wall.',
    width: 1600,
    height: 1800,
    view: SCREEN,
    boundary: room(1600, 1800),
    flightSeconds: 12,
    tee: { x: 220, y: 1640, angle: -0.6 },
    wells: [
      planet(450, 1590, { r: 56, range: 420, pull: 60000 }),
      // The corner behind the tee: a bank off it would come round to the same slot.
      maw(135, 1655, { r: 28, range: 110, pull: 30000 }),
    ],
    cup: cup(505, 680, { range: 110 }),
    obstacles: [
      // Four chambers, sealed from each other: the only ways through are the slots.
      rect(800, 900, 1480, 24, 0),
      rect(800, 480, 24, 840, 0),
      rect(800, 1320, 24, 840, 0),
    ],
    wormholes: [
      slots({ x: 788, y: 1350, face: 180 }, { x: 1200, y: 1728, face: -90 }, { half: 32 }),
      slots({ x: 1056, y: 912, face: 90 }, { x: 1528, y: 450, face: 180 }, { half: 32, color: GOLD }),
      slots({ x: 812, y: 578, face: 0 }, { x: 400, y: 72, face: 90 }, { half: 32, color: '#7fe9ff' }),
    ],
  }),
  farHole({
    id: 'f8',
    hole: 8,
    par: 5,
    title: 'Tide',
    track: 'tide',
    intro: 'One body, and its pull breathes: it swells and fades on an eight-second clock, and the ring round it rises and falls with it. Park on its orbit and the orbit breathes too. The cup sits just past where the orbit reaches at the top of the tide. Ride the swell for a lap, then burn forward as it lifts you.',
    record: 'The Tide was the first body found out here that would not hold still. The hole was laid round the one thing it does reliably.',
    sunk: 'Carried out on the swell, and set down at the top of it.',
    open: true,
    width: 20000,
    height: 20000,
    view: SCREEN,
    area: { x: 8800, y: 9100, w: 2400, h: 1800 },
    boundary: room(20000, 20000),
    flightSeconds: 12,
    tee: { x: 9550, y: 10000, angle: -Math.PI / 2 },
    wells: [
      planet(10000, 10000, { r: 60, range: 1100, pull: 184900, breath: { period: 8, amp: 0.2 } }),
    ],
    cup: cup(10820, 10000, { range: 110 }),
  }),
  farHole({
    id: 'f9',
    hole: 9,
    par: 5,
    title: 'Glass Relay',
    track: 'glassrelay',
    intro: 'Three rooms in a row, and the only ways on are mouths that go one way. The second sits at a deep maw\'s edge, where a falling charge passes a thousand a second, and hands it on at that speed into the last room, into a wall of glass with the cup behind it. It comes through far too fast to stop on its own: one pulse the moment it breaks turns it down to the cup.',
    record: 'The relay was built to carry speed from one room to the next. Nobody has found it another use.',
    sunk: 'Taken at full speed off the maw\'s edge, and set down through the glass.',
    width: 4800,
    height: 900,
    view: SCREEN,
    boundary: room(4800, 900),
    flightSeconds: 6,
    tee: { x: 250, y: 450, angle: 0.2 },
    wells: [
      maw(2500, 560, { r: 40, range: 750, pull: 380000 }),
      // Past the cup, for a charge that comes through the glass too fast to stop.
      maw(4045, 765, { r: 40, range: 230, pull: 60000 }),
    ],
    cup: cup(3814, 605, { range: 110 }),
    obstacles: [
      // Three rooms in a row, sealed: the mouths are the only way on.
      rect(1600, 450, 24, 780, 0),
      rect(3200, 450, 24, 780, 0),
      // The last room is cut across by glass, the cup on the far side of it.
      { poly: rect(3778, 140, 217, 16, 139.0), color: '#7fe9d6', glass: true },
      { poly: rect(3617, 280, 217, 16, 139.0), color: '#b8fff0', glass: true },
      { poly: rect(3456, 420, 217, 16, 139.0), color: '#7fe9d6', glass: true },
      { poly: rect(3295, 560, 217, 16, 139.0), color: '#b8fff0', glass: true },
    ],
    wormholes: [
      oneWay(1300, 250, 1850, 250),
      oneWay(2625, 447, 3450, 160, 30, GOLD),
    ],
  }),
  farHole({
    id: 'f10',
    hole: 10,
    par: 5,
    title: 'The Eye',
    track: 'eye',
    intro: 'Three maws turn round the cup as a triangle, and from outside they pull like one body: park on an orbit round the whole eye. Inside is the calm centre, and three gaps that turn with the maws. A stone by the tee keeps you from flying straight in. Burn back from the orbit to fall through a gap as it comes round to face you.',
    record: 'Lagrange showed that three bodies can turn as a triangle for ever. The course took him at his word and put a cup in the middle.',
    sunk: 'In through the iris, and down the pupil.',
    open: true,
    width: 20000,
    height: 20000,
    view: SCREEN,
    area: { x: 8700, y: 9100, w: 2600, h: 1800 },
    boundary: room(20000, 20000),
    flightSeconds: 30,
    tee: { x: 9250, y: 10000, angle: -1.4 },
    // Three maws turning as a triangle round the cup. Each pulls a third as
    // hard as a body that holds an orbit, so from outside they hold one
    // together; inside, the gaps between them turn.
    wells: [
      // The lid: a small stone between the tee and the eye, so there is no straight way in.
      planet(9600, 10000, { r: 60, range: 170, pull: 8000 }),
      ...[0, 1, 2].map((k) => maw(10000 + 220, 10000, { r: 40, range: 1400, pull: 61633, rail: { cx: 10000, cy: 10000, R: 220, period: 10, phase: (k * 2 * Math.PI) / 3 } })),
    ],
    cup: cup(10000, 10000, { range: 110 }),
  }),
  farHole({
    id: 'f11',
    hole: 11,
    par: 5,
    title: 'Clockwork',
    track: 'clockwork',
    intro: 'Three cages in a row, the cup in the last, turning on clocks of six, nine and twelve seconds. The charge is heavy: nothing out here speeds it past what it left the tee at, so the gauge can only slow it. Launch early, and brake into each gap as it comes round.',
    record: 'The three clocks agree once every thirty-six seconds. The hole was laid so that you never have to wait that long, if you know how to wait.',
    sunk: 'Through all three gaps, and never hurried.',
    open: true,
    width: 20000,
    height: 20000,
    view: SCREEN,
    area: { x: 9000, y: 9400, w: 3000, h: 1200 },
    boundary: room(20000, 20000),
    flightSeconds: 20,
    // The heavy charge: nothing pushes it past the speed it leaves the tee at, so a pulse can only slow it.
    maxBallSpeed: 440,
    tee: { x: 9220, y: 10000, angle: 0.25 },
    wells: [],
    cup: cup(11700, 10000, { range: 80 }),
    movers: [
      cage(9900, 10000, { radius: 90, count: 2, length: 140, period: 6 }),
      cage(10800, 10000, { radius: 90, count: 2, length: 140, period: 9, angle: 1 }),
      cage(11700, 10000, { radius: 90, count: 2, length: 140, period: 12, angle: 2 }),
    ],
  }),
  farHole({
    id: 'f12',
    hole: 12,
    par: 5,
    title: 'Two Doors',
    track: 'twodoors',
    intro: 'The first switch opens the door out of this room for six seconds. Beyond it, the second switch opens the cup\'s door for five. Bank off the first and steer through, bank off the second and steer through again: one launch, two timers, and a gauge of eight to do the steering.',
    record: 'Two doors, each opened by the switch in the room before it. The course\'s locksmith never believed one charge could manage both.',
    sunk: 'Both doors on one launch, and neither swung shut on it.',
    width: 3200,
    height: 1800,
    view: SCREEN,
    boundary: room(3200, 1800),
    flightSeconds: 18,
    fuel: 8,
    tee: { x: 420, y: 1400, angle: -0.6 },
    wells: [],
    cup: cup(2310, 1370, { range: 110 }),
    obstacles: [
      // The tee's room on the left; the second switch's room top right; the cup's room below it.
      rect(1600, 180, 24, 240, 0),
      rect(1600, 1120, 24, 1240, 0),
      rect(1985, 900, 770, 24, 0),
      rect(2870, 900, 540, 24, 0),
    ],
    doors: [rect(1600, 400, 24, 204, 0), rect(2485, 900, 234, 24, 0)],
    nodes: [
      { x: 900, y: 620, r: 56, kind: 'switch', toggles: [0], holdOpen: 6 },
      { x: 2650, y: 380, r: 56, kind: 'switch', toggles: [1], holdOpen: 5 },
    ],
  }),
];

/** "Hole 2", for the HUD and the roster. */
export function holeLabel(def) {
  return `Hole ${def.hole}`;
}

/** The course's total par. */
export const COURSE_PAR = COURSE.reduce((n, h) => n + h.par, 0);

/** The Far Course's total par. */
export const FAR_COURSE_PAR = FAR_COURSE.reduce((n, h) => n + h.par, 0);

/** Both courses, by the id a round and the saved bests know them by. */
export const COURSES = {
  outer: { id: 'outer', name: 'The Outer Course', holes: COURSE, par: COURSE_PAR, blurb: 'Out past the last room the Architect drew. Tilt the frame to pick a line, thrust once to launch, and steer what is left with the ion gauge. Play the round, or pick a hole.' },
  far: { id: 'far', name: 'The Far Course', holes: FAR_COURSE, par: FAR_COURSE_PAR, blurb: 'Further out, where the light runs cold, and not one hole on it easy: glass, doors, beats, bodies that come and go, and cups that will not wait for you. Everything the first course taught, asked for all at once.' },
};

/** How a score reads against par: -1 under, level, +2 over. */
export function toPar(n) {
  if (n === 0) return 'level';
  return n > 0 ? `+${n}` : String(n);
}
