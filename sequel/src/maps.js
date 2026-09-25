// Versus maps: six arenas for two or three robots, every robot for itself.
// Each is one screen-and-a-bit, seen whole, walled and roofed so a charge
// always has something to bank off, and each plays differently: open tiers,
// moving decks over a drop, a black hole that bends every shot, two tall
// spires with springs, a glass house you can see and shoot into but not walk
// through, and a foundry of blinking floors, crushers and lasers. Each wears
// the look and the music of one of the campaign's levels.
//
// A map is a blueprint in the shape build.js makes (createWorld, the game and
// the renderer read it the same way), plus `spawns` (where robots start and
// come back after a fall) and `spots` (the platforms a power-up can appear
// on). DOM-free.
import { TILE } from './config.js';
import { box } from './world.js';
import { LEVEL_DEFS } from './levels.js';

const T = TILE;
const TOP = -800; // the underside of the roof; the floor is at 0
const PIT = 420; // how far down a pit is before it takes you

/** Put a map together, a piece at a time. */
class MapBuilder {
  constructor(def) {
    const L = LEVEL_DEFS.find((l) => l.id === def.look);
    this.W = def.w ?? 2000;
    this.top = def.top ?? TOP;
    this.bp = {
      id: `vs-${def.id}`,
      title: def.title,
      theme: L.theme,
      track: L.track,
      dark: false,
      versus: true,
      solids: [],
      oneWays: [],
      movers: [],
      crates: [],
      enemies: [],
      pickups: [],
      springs: [],
      wells: [],
      pulses: [],
      lasers: [],
      checkpoints: [],
      secrets: [],
      deco: [],
      pits: [],
      ambushes: [],
      spikes: [],
      signs: [],
      sections: [],
      portalLinks: [],
      doors: [],
      veils: [],
      switches: [],
      spawns: [],
      spots: [],
      arena: null,
    };
    this.seed = def.id.length * 7919;
  }

  /** The walls, the roof and the edges of the world. */
  frame() {
    const { W, top, bp } = this;
    bp.solids.push({ pts: box(-240, top - 240, 240, 240 - top + 1000), kind: 'ground' });
    bp.solids.push({ pts: box(W, top - 240, 240, 240 - top + 1000), kind: 'ground' });
    bp.solids.push({ pts: box(0, top - 240, W, 240), kind: 'ground' });
    bp.width = W;
    bp.height = 1000;
    bp.top = top - 400;
    bp.view = { x0: 0, x1: W, top, floor: 0 };
    bp.spawn = bp.spawns[0] || { x: 140, y: -40 };
    return bp;
  }

  /** Solid ground with its top at y, from x0 to x1. */
  ground(x0, x1, y = 0) {
    this.bp.solids.push({ pts: box(x0, y, x1 - x0, 1000 - y), kind: 'ground' });
  }

  /** A bottomless drop between x0 and x1. */
  pit(x0, x1) {
    this.bp.pits.push({ x0, x1, y: PIT });
  }

  /** A solid block; its top is a place to stand (and a spot for a power-up unless `spot` is false). */
  block(x, y, w, h, spot = true, kind = 'block') {
    this.bp.solids.push({ pts: box(x, y, w, h), kind });
    if (spot) this.spot(x + w / 2, y);
  }

  /** A thin platform: jump up through it, land on it. */
  ledge(x0, x1, y, spot = true) {
    this.bp.oneWays.push({ x0, x1, y });
    if (spot) this.spot((x0 + x1) / 2, y);
  }

  /** A pane of armoured glass: solid to robots and charges, but a wormhole's sight goes through. */
  glass(x, y, w, h) {
    this.bp.solids.push({ pts: box(x, y, w, h), kind: 'window' });
  }

  /** A moving platform. */
  mover(x, y, w, path, o = {}) {
    this.bp.movers.push({ x, y, w, h: o.h ?? 18, oneWay: !!o.oneWay, kind: o.kind, path });
  }

  /** A spring pad on the floor at x (its left edge), with its top at y. */
  spring(x, y = 0, power = 1150) {
    const rec = { x, y: y - 14, w: 2 * T, power, squash: 0 };
    const s = { pts: box(x, y - 14, 2 * T, 14), kind: 'spring', spring: rec };
    this.bp.solids.push(s);
    this.bp.springs.push(rec);
  }

  /** A strip of spikes sunk a tile into the floor between x0 and x1 (the floor either side is at 0). */
  spikes(x0, x1) {
    this.ground(x0, x1, T);
    this.bp.solids.push({ pts: box(x0, T * 0.55, x1 - x0, T * 0.45), kind: 'spikes' });
    this.bp.spikes.push({ x0, x1, y: T * 0.55 });
  }

  /** A crusher hanging from a roof whose underside is at `roof`, over a floor at `floor`. */
  crusher(x, roof, floor, period = 3, phase = 0) {
    const h = T * 0.8;
    this.bp.movers.push({ x, y: roof, w: 2 * T, h, kind: 'crusher', danger: true, path: { type: 'crush', dy: floor - roof - h - 2, period, phase, hold: 0.35, down: 0.08 } });
  }

  /** A laser across a gap, straight up and down at x. */
  laser(x, y0, y1, period = 3, on = 1.2, offset = 0) {
    this.bp.lasers.push({ dir: 'v', x, y0, y1, period, on, offset });
  }

  /** A black hole (or, with a negative pull, a white hole's push). */
  well(x, y, o = {}) {
    this.bp.wells.push({ x, y, r: o.r ?? 24, range: o.range ?? 420, pull: o.pull ?? 360000, fount: !!o.fount });
  }

  /** A blinking platform: there for `on` seconds, gone for `off`. */
  blink(x, y, w, on, off, offset) {
    this.bp.movers.push({ x, y, w, h: 18, kind: 'phase', path: { type: 'phase', on, off, offset } });
  }

  /** Where a robot starts, standing on the surface at y. */
  spawn(x, y = 0) {
    this.bp.spawns.push({ x, y: y - 31 });
  }

  /** A place a power-up can appear, resting on the surface at y. */
  spot(x, y) {
    this.bp.spots.push({ x, y: y - 22 });
  }

  /** Scenery from the look's props along a floor, behind the play. */
  props(x0, x1, y = 0) {
    const kinds = this.bp.theme.props;
    let n = 0;
    for (let x = x0 + 60; x < x1 - 40; x += 3.5 * T) {
      this.seed = (this.seed * 16807) % 2147483647;
      const r = this.seed / 2147483647;
      this.bp.deco.push({ kind: kinds[n++ % kinds.length], x, y, s: 0.8 + r * 0.4, seed: this.seed, layer: 'back' });
    }
  }
}

/**
 * The six maps. Each `build` lays out the map on a MapBuilder; `look` is the
 * campaign level whose sky, colours, scenery and music it wears.
 */
export const MAPS = [
  {
    id: 'crossfire',
    title: 'Crossfire',
    look: 1,
    blurb: 'Open tiers either side of a pillar, and roof posts to bank off. Nowhere to hide for long.',
    build(m) {
      m.ground(0, 2000);
      m.props(0, 2000);
      m.block(940, -160, 120, 160); // the pillar in the middle of the floor
      m.ledge(200, 480, -160);
      m.ledge(1520, 1800, -160);
      m.block(560, -300, 240, 40);
      m.block(1200, -300, 240, 40);
      m.ledge(120, 400, -460);
      m.ledge(1600, 1880, -460);
      m.block(860, -460, 280, 40);
      m.block(480, TOP, 80, 200, false); // posts hanging from the roof
      m.block(1440, TOP, 80, 200, false);
      m.spot(620, 0);
      m.spot(1380, 0);
      m.spawn(140);
      m.spawn(1860);
      m.spawn(1000, -460);
    },
  },
  {
    id: 'drift',
    title: 'Drift Yard',
    look: 2,
    blurb: 'A drop down the middle, crossed by decks that slide past each other and a lift up to a high perch.',
    build(m) {
      m.ground(0, 600);
      m.ground(1400, 2000);
      m.pit(600, 1400);
      m.props(0, 600);
      m.props(1400, 2000);
      m.mover(620, -20, 140, { type: 'line', dx: 640, dy: 0, period: 6, phase: 0 });
      m.mover(1240, -260, 140, { type: 'line', dx: -640, dy: 0, period: 6, phase: 0 });
      m.mover(930, -300, 140, { type: 'line', dx: 0, dy: -260, period: 5, phase: 0 });
      m.ledge(400, 560, -170);
      m.ledge(1440, 1600, -170);
      m.block(0, -330, 360, 40);
      m.block(1640, -330, 360, 40);
      m.ledge(860, 1140, -700);
      m.spot(300, 0);
      m.spot(1700, 0);
      m.spawn(140);
      m.spawn(1860);
      m.spawn(180, -330);
    },
  },
  {
    id: 'horizon',
    title: 'Event Horizon',
    look: 6,
    blurb: 'A black hole hangs in the middle. Every shot past it bends, and it swallows any robot that strays in.',
    build(m) {
      m.ground(0, 2000);
      m.props(0, 2000);
      m.well(1000, -380, { range: 440, pull: 380000 });
      m.ledge(380, 560, -150);
      m.ledge(1440, 1620, -150);
      m.block(160, -300, 240, 40);
      m.block(1600, -300, 240, 40);
      m.block(560, -450, 200, 40);
      m.block(1240, -450, 200, 40);
      m.block(860, -600, 280, 40);
      m.spot(1000, 0);
      m.spawn(140);
      m.spawn(1860);
      m.spawn(1000, -600);
    },
  },
  {
    id: 'spires',
    title: 'Twin Spires',
    look: 3,
    blurb: 'Two tall towers, springs at their feet and a bridge between their tops. Long walls for wormholes.',
    build(m) {
      m.ground(0, 2000);
      m.props(0, 380);
      m.props(1620, 2000);
      m.block(560, -560, 120, 560);
      m.block(1320, -560, 120, 560);
      m.ledge(680, 920, -560); // the bridge, open in the middle over a step down to the yard between the towers
      m.ledge(1080, 1320, -560);
      m.spring(380);
      m.spring(1540);
      m.ledge(440, 560, -300);
      m.ledge(320, 440, -440);
      m.ledge(1440, 1560, -300);
      m.ledge(1560, 1680, -440);
      m.ledge(700, 820, -150);
      m.ledge(1180, 1300, -150);
      m.ledge(840, 1160, -300);
      m.block(960, -430, 80, 30, false);
      m.ledge(0, 200, -600);
      m.ledge(1800, 2000, -600);
      m.spot(1000, 0);
      m.spawn(140);
      m.spawn(1860);
      m.spawn(800, -560);
    },
  },
  {
    id: 'glasshouse',
    title: 'Glasshouse',
    look: 5,
    blurb: 'A house of armoured glass in the middle: see in, open a wormhole past it, shoot in off the walls. Spikes either side.',
    build(m) {
      m.ground(0, 480);
      m.spikes(480, 600);
      m.ground(600, 1400);
      m.spikes(1400, 1520);
      m.ground(1520, 2000);
      m.props(0, 460);
      m.props(1540, 2000);
      m.glass(780, -420, 20, 340); // the house: two walls standing clear of the floor, and a roof
      m.glass(1200, -420, 20, 340);
      m.glass(780, -440, 440, 20);
      m.spot(1000, -440);
      m.block(920, -160, 160, 30);
      m.block(160, -150, 240, 40);
      m.ledge(40, 240, -300);
      m.block(440, -450, 240, 40);
      m.block(1600, -150, 240, 40);
      m.ledge(1760, 1960, -300);
      m.block(1320, -450, 240, 40);
      m.ledge(820, 1180, -600);
      m.spot(700, 0);
      m.spot(1300, 0);
      m.spawn(140);
      m.spawn(1860);
      m.spawn(1000);
    },
  },
  {
    id: 'foundry',
    title: 'Blink Foundry',
    look: 9,
    blurb: 'Floors that blink over a drop, crushers in the upper halls and lasers under them. Watch the clock.',
    build(m) {
      m.ground(0, 600);
      m.ground(1400, 2000);
      m.pit(600, 1400);
      m.props(0, 240);
      m.props(1760, 2000);
      // Across the drop, two sets of blinking floors either side of a steady island.
      m.blink(640, -40, 100, 2.4, 1.2, 0);
      m.blink(780, -40, 100, 2.4, 1.2, 1.2);
      m.block(940, -70, 120, 30);
      m.blink(1120, -40, 100, 2.4, 1.2, 1.2);
      m.blink(1260, -40, 100, 2.4, 1.2, 0);
      // The upper halls, each with a crusher, and a laser across the floor under each.
      m.block(0, -360, 520, 40, false);
      m.block(0, -600, 520, 40, false);
      m.block(1480, -360, 520, 40, false);
      m.block(1480, -600, 520, 40, false);
      m.spot(420, -360); // before the crusher, and past it at the end of the hall
      m.spot(60, -360);
      m.spot(1580, -360);
      m.spot(1940, -360);
      m.crusher(200, -560, -360, 3, 0);
      m.crusher(1720, -560, -360, 3, 0.5);
      m.laser(300, -320, 0, 3, 1.2, 0);
      m.laser(1700, -320, 0, 3, 1.2, 1.5);
      m.ledge(540, 640, -190);
      m.ledge(1360, 1460, -190);
      // Over the middle, a blinking walk to a steady top.
      m.blink(620, -400, 100, 2, 1, 0);
      m.blink(760, -440, 100, 2, 1, 1);
      m.blink(1140, -440, 100, 2, 1, 1);
      m.blink(1280, -400, 100, 2, 1, 0);
      m.block(900, -520, 200, 30);
      m.spot(420, 0);
      m.spot(1580, 0);
      m.spawn(140);
      m.spawn(1860);
      m.spawn(1000, -520);
    },
  },
];

const cache = new Map();

/** The built blueprint of map `id`, cached. */
export function arenaMap(id) {
  if (!cache.has(id)) {
    const def = MAPS.find((d) => d.id === id);
    if (!def) throw new Error(`No map ${id}`);
    const m = new MapBuilder(def);
    def.build(m);
    cache.set(id, m.frame());
  }
  return cache.get(id);
}

