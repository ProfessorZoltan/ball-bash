// Versus arenas: four rooms for two or three robots, every robot for itself.
// Each is walled so a charge always has something to bank off, and each
// plays differently: open tiers round a pillar, a black hole over a pit that
// bends every shot, a foundry of lifts, a crusher and a laser over a channel
// of molten metal, and a container yard with springs up two stacks and a
// gantry between them. Each wears the look and the music of one of the
// campaign's levels.
//
// An arena is a blueprint in the shape levels.js makes (the game, the
// renderer and the art read it the same way), plus `spawns` (where robots
// start and come back after a hit or a fall: { p, yaw }) and `spots` (where
// a power-up can appear). Its `route` is a tour: a loop through every spawn
// and every spot, flown by the autopilot from each spawn in the tests, which
// proves every one can be reached from every other. DOM-free.
import { World } from './world.js';
import { standAt } from './player.js';
import { LEVEL_DEFS } from './levels.js';
import { THEMES } from './levels.js';

const T = 1; // wall thickness, m

/** Put an arena together, in world coordinates: x and z across, y up, the floor at 0. */
class ArenaBuilder {
  constructor(def) {
    this.def = def;
    this.world = new World();
    this.route = [];
    this.spawns = [];
    this.spots = [];
    this.props = [];
  }

  box(min, max, role, props = {}) {
    return this.world.box(min, max, { role, ...props });
  }

  /** A ramp rising along x or z (dir +1: up toward +axis). */
  ramp(min, max, axis, dir, role = 'ramp', props = {}) {
    return this.world.ramp(min, max, axis, dir, { role, ...props });
  }

  /** The walls round a W by D room, H tall, and a roof unless it is open to the sky. */
  walls(W, D, H, roof = true) {
    const w = W / 2;
    const d = D / 2;
    this.box([-w - T, -14, -d - T], [-w, H, d + T], 'arenaWall');
    this.box([w, -14, -d - T], [w + T, H, d + T], 'arenaWall');
    this.box([-w, -14, -d - T], [w, H, -d], 'arenaWall');
    this.box([-w, -14, d], [w, H, d + T], 'arenaWall');
    if (roof) this.box([-w - T, H, -d - T], [w + T, H + 1, d + T], 'roof');
    this.size = { W, D, H };
  }

  /** A slab of floor with its top at y. */
  floor(x0, z0, x1, z1, y = 0, role = 'arena') {
    return this.box([x0, y - 2, z0], [x1, y, z1], role);
  }

  /** A spawn at floor height y, facing the middle of the room. */
  spawn(x, y, z) {
    const p = standAt(x, y, z);
    this.spawns.push({ p, yaw: Math.atan2(-x, -z) });
    return p;
  }

  spot(x, y, z) {
    const p = [x, y + 0.9, z];
    this.spots.push(p);
    return p;
  }

  go(x, y, z, run = false) {
    this.route.push({ a: 'go', to: standAt(x, y, z), run });
  }

  step(s) {
    this.route.push(s);
  }

  finish() {
    const L = LEVEL_DEFS.find((l) => l.key === this.def.look);
    const theme = THEMES[L.key];
    const W = this.world;
    W.floorY = this.def.floorY ?? 0;
    return {
      id: `vs-${this.def.id}`,
      versus: true,
      title: this.def.title,
      blurb: this.def.blurb,
      world: W,
      route: this.route,
      enemies: [],
      pickups: [],
      checkpoints: [],
      props: this.props,
      signs: [],
      lines: [],
      links: [],
      sections: [],
      ambushes: [],
      secrets: 0,
      floorY: W.floorY,
      theme: { ...theme, roles: { ...theme.roles } },
      def: L,
      humanity: L.humanity,
      track: L.key,
      spawns: this.spawns,
      spots: this.spots,
      spawn: this.spawns[0],
      arena: null,
      size: this.size,
    };
  }
}

/** A pit's bottom out of reach: fall that far and it is a fall. */
function pitBottom(b, x0, z0, x1, z1, y) {
  b.box([x0, y - 2, z0], [x1, y, z1], 'trim', { noSafe: true, noPortal: true });
  b.world.hazards.push({ min: [x0, y, z0], max: [x1, y + 3, z1], kind: 'fall' });
}

export const MAPS = [
  {
    id: 'crossfire',
    title: 'Crossfire',
    look: 'edge',
    blurb: 'A pillar in the middle of the grid, a tier in each corner up a ramp, and posts hung from the roof to bank off. Nowhere to hide for long.',
    build(b) {
      const H = 12;
      b.walls(44, 44, H);
      b.floor(-22, -22, 22, 22);
      b.box([-2, 0, -2], [2, H, 2], 'trim');
      // A tier in each corner, 2.4 m up, and a ramp up to it along the wall.
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x0 = sx > 0 ? 13 : -22;
          const z0 = sz > 0 ? 13 : -22;
          b.box([x0, 0, z0], [x0 + 9, 2.4, z0 + 9], 'plat');
          const rz0 = sz > 0 ? 19 : -22;
          if (sx > 0) b.ramp([5, 0, rz0], [13, 2.4, rz0 + 3], 'x', 1);
          else b.ramp([-13, 0, rz0], [-5, 2.4, rz0 + 3], 'x', -1);
        }
      }
      // Low walls round the pillar, and posts hung from the roof.
      for (const [x, z, sx, sz] of [[-9, 0, 1, 3], [9, 0, 1, 3], [0, -9, 3, 1], [0, 9, 3, 1]]) b.box([x - sx / 2, 0, z - sz / 2], [x + sx / 2, 1.2, z + sz / 2], 'plat');
      for (const [x, z] of [[-9, -9], [9, -9], [-9, 9], [9, 9]]) b.box([x - 0.6, 7, z - 0.6], [x + 0.6, H, z + 0.6], 'trim');
      b.spawn(17.5, 2.4, 17.5);
      b.spawn(-17.5, 2.4, 17.5);
      b.spawn(-17.5, 2.4, -17.5);
      b.spawn(17.5, 2.4, -17.5);
      b.spot(0, 0, 14);
      b.spot(-14, 0, 0);
      b.spot(0, 0, -14);
      b.spot(14, 0, 0);
      // The tour: round the room, up each tier by its ramp and off it by its edge.
      b.go(13.8, 2.4, 20.5);
      b.go(4.5, 0, 20.5);
      b.go(0, 0, 14);
      b.go(-4.5, 0, 20.5);
      b.go(-13.8, 2.4, 20.5);
      b.go(-17.5, 2.4, 17.5);
      b.go(-17.5, 0, 9);
      b.go(-14, 0, 0);
      b.go(-3, 0, -14);
      b.go(-4.5, 0, -20.5);
      b.go(-13.8, 2.4, -20.5);
      b.go(-17.5, 2.4, -17.5);
      b.go(-17.5, 0, -9);
      b.go(0, 0, -14);
      b.go(3, 0, -14);
      b.go(4.5, 0, -20.5);
      b.go(13.8, 2.4, -20.5);
      b.go(17.5, 2.4, -17.5);
      b.go(17.5, 0, -9);
      b.go(14, 0, 0);
      b.go(3, 0, 14);
      b.go(4.5, 0, 20.5);
      b.go(13.8, 2.4, 20.5);
      b.go(17.5, 2.4, 17.5);
    },
  },
  {
    id: 'horizon',
    title: 'Event Horizon',
    look: 'wilds',
    blurb: 'A black hole hangs over a pit in the middle: every shot past it bends, and a robot that jumps too near is taken. One bridge crosses under it; springs throw you up to the corners.',
    floorY: -12,
    build(b) {
      const H = 14;
      b.walls(48, 48, H);
      // The floor, round a pit 18 m across.
      b.floor(-24, -24, 24, -9);
      b.floor(-24, 9, 24, 24);
      b.floor(-24, -9, -9, 9);
      b.floor(9, -9, 24, 9);
      for (const [x0, z0, x1, z1] of [[-9, -9, 9, -8.9], [-9, 8.9, 9, 9], [-9, -9, -8.9, 9], [8.9, -9, 9, 9]]) b.box([x0, -12, z0], [x1, -2, z1], 'wall', { noPortal: true });
      pitBottom(b, -9, -9, 9, 9, -12);
      // One bridge across, under the hole.
      b.box([-9, -0.6, -1.25], [9, 0, 1.25], 'plat');
      b.world.wells.push({ p: [0, 7, 0], pull: 2600, reach: 15, horizon: 0.9 });
      // Islands north and south, each up a ramp.
      b.box([-5, 0, 15], [5, 2.4, 21], 'plat');
      b.ramp([-13, 0, 16], [-5, 2.4, 19], 'x', 1);
      b.box([-5, 0, -21], [5, 2.4, -15], 'plat');
      b.ramp([5, 0, -19], [13, 2.4, -16], 'x', -1);
      // The corners, high, each with a spring at its foot.
      const spring = Math.sqrt(2 * 20 * (3.2 + 1.8));
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x0 = sx > 0 ? 16 : -24;
          const z0 = sz > 0 ? 16 : -24;
          b.box([x0, 0, z0], [x0 + 8, 3.2, z0 + 8], 'plat');
          b.box([sx * 14 - 1, 0, sz * 14 - 1], [sx * 14 + 1, 0.35, sz * 14 + 1], 'spring', { spring });
        }
      }
      b.spawn(20, 3.2, 20);
      b.spawn(-20, 3.2, 20);
      b.spawn(-20, 3.2, -20);
      b.spawn(20, 3.2, -20);
      b.spot(0, 2.4, 18);
      b.spot(0, 0, 0);
      b.spot(0, 2.4, -18);
      b.spot(-18, 0, 0);
      b.spot(18, 0, 0);
      const up = (sx, sz) => b.step({ a: 'spring', pad: standAt(sx * 14, 0.35, sz * 14), to: standAt(sx * 19, 3.2, sz * 19) });
      // From the north-east corner: off it, round to the north island, down to the bridge and across.
      b.go(13, 0, 22, false);
      b.go(-14, 0, 22.5);
      b.go(-13.6, 0, 17.5);
      b.go(-4.6, 2.4, 17.5);
      b.go(0, 2.4, 18);
      b.go(0, 0, 12.5);
      b.go(-11.5, 0, 11.5);
      b.go(-12.5, 0, 0);
      b.go(-9.5, 0, 0);
      b.go(0, 0, 0);
      b.go(9.5, 0, 0);
      b.go(18, 0, 0);
      b.go(12.5, 0, -12);
      up(1, -1);
      b.go(20, 3.2, -20);
      b.go(13, 0, -22);
      b.go(13.6, 0, -17.5);
      b.go(4.6, 2.4, -17.5);
      b.go(0, 2.4, -18);
      b.go(-8, 0, -18);
      b.go(-11.5, 0, -11.5);
      up(-1, -1);
      b.go(-20, 3.2, -20);
      b.go(-20, 0, -13);
      b.go(-18, 0, 0);
      b.go(-11.5, 0, 11.5);
      up(-1, 1);
      b.go(-20, 3.2, 20);
      b.go(-20, 0, 12);
      b.go(-11.5, 0, 11.5);
      b.go(11.5, 0, 11.5);
      up(1, 1);
      b.go(20, 3.2, 20);
    },
  },
  {
    id: 'foundry',
    title: 'Foundry Floor',
    look: 'foundry',
    blurb: 'A channel of molten metal down the middle, two bridges over it (one under a crusher), and catwalks up the long walls by a lift and a ramp, one of them across a laser gate.',
    build(b) {
      const H = 13;
      b.walls(48, 36, H);
      // The floor either side of the channel.
      b.floor(-24, -18, -3, 18);
      b.floor(3, -18, 24, 18);
      b.box([-3, -3.5, -18], [3, -1.5, 18], 'trim', { color: '#ff7a1a', mat: 'plain', glow: 1.4, noSafe: true, noPortal: true });
      b.world.hazards.push({ min: [-3, -1.5, -18], max: [3, -0.2, 18], kind: 'molten' });
      for (const x of [-3, 3]) b.box([x < 0 ? -3.1 : 3, -3.5, -18], [x < 0 ? -3 : 3.1, -2, 18], 'wall', { noPortal: true });
      // The bridges: one open, one under a crusher.
      b.box([-3, -0.6, 10], [3, 0, 13], 'plat');
      b.box([-3, -0.6, -13], [3, 0, -10], 'plat');
      const crusher = b.box([-3, 5, -13.2], [3, 6.2, -9.8], 'crusher', { crush: { period: 3.4, drop: 4.98, phase: 0 } });
      // The north catwalk: up a lift at its west end, down a ramp at its east, a laser gate across it.
      b.box([-20, 4.4, 14], [12, 5, 18], 'plat');
      b.ramp([12, 0, 14], [21, 5, 18], 'x', -1);
      const liftN = b.box([-23.4, -0.6, 14.2], [-20.2, 0, 17.8], 'plat', { move: { to: [0, 5, 0], period: 7, phase: 0 } });
      b.world.hazards.push({ min: [-0.1, 5, 14], max: [0.1, 7.2, 18], kind: 'laser', laser: { period: 3.2, on: 1.2, phase: 0 }, id: 'vs-foundry-laser' });
      b.box([-0.3, 7.2, 14], [0.3, 8, 18], 'trim');
      // The south catwalk: up a ramp at its west end, down a lift at its east.
      b.box([-12, 4.4, -18], [20, 5, -14], 'plat');
      b.ramp([-21, 0, -18], [-12, 5, -14], 'x', 1);
      const liftS = b.box([20.2, -0.6, -17.8], [23.4, 0, -14.2], 'plat', { move: { to: [0, 5, 0], period: 7, phase: 0.5 } });
      // Cover on the floor.
      for (const [x, z] of [[-12, -4], [12, 4], [-16, 6], [16, -6]]) b.box([x - 1.5, 0, z - 0.6], [x + 1.5, 1.3, z + 0.6], 'plat');
      b.spawn(-20, 0, -6);
      b.spawn(20, 0, 6);
      b.spawn(-15, 5, 16);
      b.spawn(15, 5, -16);
      b.spot(0, 0, 11.5);
      b.spot(-12, 0, 2);
      b.spot(12, 0, -2);
      b.spot(6, 5, 16);
      b.spot(-6, 5, -16);
      // The tour: from the west floor up the south ramp, along the south catwalk, down its lift...
      b.go(-22.5, 0, -12);
      b.go(-22, 0, -16);
      b.go(-11.6, 5, -16);
      b.go(-6, 5, -16);
      b.go(15, 5, -16);
      b.go(19.4, 5, -16);
      b.step({ a: 'waitFor', solid: liftS.id, near: [21.8, 4.7, -16], tol: 0.35 });
      b.step({ a: 'ride', solid: liftS.id, until: [21.8, -0.3, -16], tol: 0.3 });
      b.go(21.8, 0, -11);
      b.go(20, 0, 6);
      b.go(12, 0, -2);
      b.go(4, 0, -11.5);
      b.step({ a: 'crush', solid: crusher.id, to: standAt(-4.5, 0, -11.5) });
      b.go(-12, 0, 2);
      b.go(-8, 0, 11.5);
      b.go(0, 0, 11.5);
      b.go(8, 0, 11.5);
      // ...then up the north ramp, along the catwalk through the gate, and down its lift.
      b.go(22.3, 0, 11);
      b.go(22, 0, 16);
      b.go(11.6, 5, 16);
      b.go(6, 5, 16);
      b.go(2, 5, 16);
      b.step({ a: 'gate', hazard: 'vs-foundry-laser', to: standAt(-2.5, 5, 16) });
      b.go(-15, 5, 16);
      b.go(-19.4, 5, 16);
      b.step({ a: 'waitFor', solid: liftN.id, near: [-21.8, 4.7, 16], tol: 0.35 });
      b.step({ a: 'ride', solid: liftN.id, until: [-21.8, -0.3, 16], tol: 0.3 });
      b.go(-21.8, 0, 10);
      b.go(-20, 0, -6);
    },
  },
  {
    id: 'yard',
    title: 'Container Yard',
    look: 'harbour',
    blurb: 'Open to the sky. A channel of harbour water down the middle, two container stacks either side with springs up them, and a gantry between their tops, over the water.',
    build(b) {
      b.walls(48, 40, 10, false);
      b.floor(-24, -20, -3, 20);
      b.floor(3, -20, 24, 20);
      b.box([-3, -4, -20], [3, -1.6, 20], 'trim', { noSafe: true, noPortal: true });
      b.box([-3, -1.6, -20], [3, -1.35, 20], 'trim', { mat: 'water', color: '#3a7aa0', passCharges: true, ghost: true, noPortal: true });
      b.world.hazards.push({ min: [-3, -1.6, -20], max: [3, -0.3, 20], kind: 'water' });
      // Two bridges over the water.
      b.box([-3, -0.6, 11], [3, 0, 14], 'plat');
      b.box([-3, -0.6, -14], [3, 0, -11], 'plat');
      // The stacks, two containers high, a spring at each one's outer foot, and the gantry between their tops.
      for (const sx of [-1, 1]) {
        const x0 = sx > 0 ? 10 : -16;
        b.box([x0, 0, -3], [x0 + 6, 2.6, 3], 'crate0');
        b.box([x0, 2.6, -3], [x0 + 6, 5.2, 3], 'crate0', { color: sx > 0 ? '#2e6ab8' : '#d8a030' });
        b.box([sx * 18 - 1, 0, -1], [sx * 18 + 1, 0.35, 1], 'spring', { spring: Math.sqrt(2 * 20 * (5.2 + 1.8)) });
      }
      b.box([-10, 4.6, -1.2], [10, 5.2, 1.2], 'plat');
      // Cover: single containers about the yard.
      for (const [x, z, sx, sz] of [[-10, 11, 6, 2.5], [10, -11, 6, 2.5], [-15, -10, 2.5, 6], [15, 10, 2.5, 6]]) b.box([x - sx / 2, 0, z - sz / 2], [x + sx / 2, 2.6, z + sz / 2], 'crate0');
      b.spawn(-20, 0, -15);
      b.spawn(20, 0, 15);
      b.spawn(20, 0, -15);
      b.spawn(-20, 0, 15);
      b.spot(-13, 5.2, 0);
      b.spot(0, 5.2, 0);
      b.spot(13, 5.2, 0);
      b.spot(0, 0, 12.5);
      b.spot(0, 0, -12.5);
      const up = (sx) => b.step({ a: 'spring', pad: standAt(sx * 18, 0.35, 0), to: standAt(sx * 14, 5.2, 0) });
      // The tour: up the west stack, across the gantry, off the east stack, over both bridges, and up the east stack by its spring.
      b.go(-20, 0, -6);
      b.go(-20, 0, 0);
      up(-1);
      b.go(-13, 5.2, 0);
      b.go(-9.5, 5.2, 0);
      b.go(0, 5.2, 0);
      b.go(9.5, 5.2, 0);
      b.go(13, 5.2, 0);
      b.go(13, 0, 6);
      b.go(18.5, 0, 5);
      b.go(20, 0, 15);
      b.go(8, 0, 14);
      b.go(0, 0, 12.5);
      b.go(-6, 0, 12.5);
      b.go(-10, 0, 14.2);
      b.go(-20, 0, 15);
      b.go(-20, 0, 6);
      b.go(-20, 0, -6);
      b.go(-20, 0, -15);
      b.go(-6, 0, -13.5);
      b.go(0, 0, -12.5);
      b.go(5.5, 0, -13.5);
      b.go(20, 0, -15);
      b.go(20, 0, -6);
      up(1);
      b.go(13, 0, -6);
      b.go(5, 0, -7);
      b.go(5, 0, -13.5);
      b.go(0, 0, -12.5);
      b.go(-6, 0, -13.5);
      b.go(-20, 0, -15);
    },
  },
];

/** Build an arena by its id. */
export function arenaMap(id) {
  const def = MAPS.find((m) => m.id === id) || MAPS[0];
  const b = new ArenaBuilder(def);
  def.build(b);
  return b.finish();
}
