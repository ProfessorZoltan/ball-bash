// The robot: an upright capsule that runs, jumps and falls like Super Mario
// Bros. 3, against Deflector's segment geometry. DOM-free.
//
// Ground is any surface whose normal points up by at least MOVE.walkable; the
// robot is lifted straight out of it, never slid sideways, which is what lets
// it stand on a slope or at the very lip of a ledge. Walls push it out along
// their normal and take the velocity that went into them. A thin platform is
// only a floor, and only from above.
import { capsuleVsCapsule } from '../../src/physics.js';
import { wellsAccel, swallowingWell } from '../../src/gamestate.js';
import { ROBOT, MOVE, ROBOT_PULL } from './config.js';
import { segmentsNear } from './world.js';
import { bodyMouth, openedSegments, openPortals, throughPortal, exitVelocity, isFloorEnd, WORM, PORTAL } from './wormholes.js';

const approach = (v, target, d) => (v < target ? Math.min(target, v + d) : Math.max(target, v - d));

export class Robot {
  constructor(x, y) {
    this.r = ROBOT.r;
    this.half = ROBOT.half;
    this.slot = 0;
    this.spawn(x, y);
    this.aim = 0; // where the blaster points, radians (0 right, positive down)
    this.facing = 1;
  }

  /** Put the robot down at (x, y), its feet on whatever is there, at rest. */
  spawn(x, y) {
    this.x = x;
    this.y = y;
    this.prevX = x;
    this.prevY = y;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.ground = null;
    this.groundMover = null;
    this.coyote = 0;
    this.buffer = 0;
    this.rising = false;
    this.dropHold = 0;
    this.dropping = 0;
    this.portalGrace = 0;
    this.lastMouth = null;
    this.warped = false;
    this.safe = { x, y };
    this.safeT = 0;
    this.airT = 0;
    this.landed = 0; // the landing squash, 1 down to 0
    this.flare = 0; // the pack's flare from a jump, 1 down to 0
    this.takeoff = null; // where the last jump left the ground: its flare's ring spreads there
    this.pulseSeen = new Set();
  }

  get top() {
    return this.y - this.half - this.r;
  }

  get bottom() {
    return this.y + this.half + this.r;
  }

  /** The pivot the blaster turns on. */
  get shoulder() {
    return { x: this.x, y: this.y + ROBOT.shoulder };
  }
}

/** How hard a jump leaves the ground at this running speed: a walking jump, a running one, and everything between. */
export function jumpSpeed(vx) {
  const k = Math.max(0, Math.min(1, (Math.abs(vx) - MOVE.walk) / (MOVE.run - MOVE.walk)));
  return MOVE.jump + (MOVE.runJump - MOVE.jump) * k;
}

/**
 * One physics step for the robot. `it` is the intent: mx (-1..1), run, jump
 * (held), jumpPressed, down. `hooks` hears about what happens: jump(),
 * land(speed), hurt(reason, point), spring(s), pulse(), warp(from, to),
 * fell(), swallowed(well).
 */
export function stepRobot(bot, it, world, dt, hooks = {}) {
  bot.prevX = bot.x;
  bot.prevY = bot.y;
  bot.warped = false;
  bot.coyote -= dt;
  bot.buffer -= dt;
  bot.portalGrace -= dt;
  bot.dropping -= dt;
  bot.landed = Math.max(0, bot.landed - dt * 5);
  bot.flare = Math.max(0, bot.flare - dt * 2.5);
  if (it.jumpPressed) bot.buffer = MOVE.buffer;

  // A platform carries what stands on it: its whole motion this step.
  const gm = bot.onGround ? bot.groundMover : null;
  if (gm) {
    bot.x += gm.dx;
    bot.y += gm.dy;
    if (gm.path && gm.path.type === 'fall') gm.stoodOn = true;
  }

  // A black hole's pull. On the ground the sideways part goes in before the feet
  // do their work, so they hold against it the way they hold a standstill:
  // a robot standing at a pit's lip stays put, and walks away straining.
  const pull = world.wells.length ? wellsAccel(world.wells, bot.x, bot.y) : null;
  const held = !!pull && bot.onGround;
  if (held) bot.vx += pull.ax * ROBOT_PULL * dt;

  // Walking and running.
  const mx = Math.abs(it.mx) < 0.15 ? 0 : it.mx;
  const top = it.run ? MOVE.run : MOVE.walk;
  const target = mx * top;
  if (bot.onGround) {
    if (!mx) bot.vx = approach(bot.vx, 0, MOVE.friction * dt);
    else if (Math.sign(mx) !== Math.sign(bot.vx) && Math.abs(bot.vx) > 10) bot.vx = approach(bot.vx, target, MOVE.skid * dt);
    else if (Math.abs(bot.vx) > Math.abs(target)) bot.vx = approach(bot.vx, target, MOVE.friction * dt);
    else bot.vx = approach(bot.vx, target, (it.run ? MOVE.runAccel : MOVE.accel) * dt);
  } else {
    if (!mx) bot.vx = approach(bot.vx, 0, MOVE.airDrag * dt);
    else if (Math.sign(mx) !== Math.sign(bot.vx) && Math.abs(bot.vx) > 10) bot.vx = approach(bot.vx, target, MOVE.airSkid * dt);
    else if (Math.abs(bot.vx) < Math.abs(target)) bot.vx = approach(bot.vx, target, MOVE.airAccel * dt);
    else bot.vx = approach(bot.vx, target, MOVE.airDrag * dt); // flung faster than it can run: it keeps most of it
  }
  if (mx) bot.facing = Math.sign(mx);

  // Down on a thin platform, held a moment (or with jump), drops through it.
  const onThin = bot.onGround && bot.ground && bot.ground.oneWay;
  if (onThin && it.down) {
    bot.dropHold += dt;
    if (bot.dropHold >= MOVE.dropThrough || it.jumpPressed) {
      bot.dropping = 0.25;
      bot.onGround = false;
      bot.buffer = 0;
      bot.dropHold = 0;
    }
  } else bot.dropHold = 0;

  // Jumping: from the ground, or a moment after leaving it.
  if (bot.buffer > 0 && (bot.onGround || bot.coyote > 0)) {
    bot.vy = -jumpSpeed(bot.vx);
    if (gm) {
      bot.vx += gm.vx * 0.6; // a moving platform lends the jump some of its motion
      bot.vy += Math.min(0, gm.vy);
    }
    bot.onGround = false;
    bot.coyote = 0;
    bot.buffer = 0;
    bot.rising = true;
    bot.airT = 0;
    bot.flare = 1;
    bot.takeoff = { x: bot.x, y: bot.bottom };
    if (hooks.jump) hooks.jump();
  }

  // Gravity, with Mario's two weights: light while jump is held on the way up.
  if (!it.jump) bot.rising = false;
  const g = bot.vy < 0 ? (bot.rising ? MOVE.gUp : MOVE.gCut) : MOVE.gFall;
  bot.vy += g * dt;
  if (pull) {
    if (!held) bot.vx += pull.ax * ROBOT_PULL * dt; // in the air nothing holds it
    bot.vy += pull.ay * ROBOT_PULL * dt;
  }
  pulsePush(bot, world, hooks);
  if (bot.vy > MOVE.maxFall) bot.vy = MOVE.maxFall;

  const wasGround = bot.onGround;
  bot.x += bot.vx * dt;
  bot.y += bot.vy * dt;
  collide(bot, world, hooks);

  // Down a slope, or off the back of a step, the robot follows the ground instead of launching.
  if (wasGround && !bot.onGround && bot.vy >= 0 && bot.dropping <= 0) {
    const y0 = bot.y;
    const vy0 = bot.vy;
    bot.y += MOVE.snap;
    collide(bot, world, {}, true);
    if (!bot.onGround) {
      bot.y = y0;
      bot.vy = vy0;
    }
  }

  if (bot.onGround) {
    if (!wasGround) {
      bot.landed = Math.min(1, bot.airT * 2);
      if (hooks.land) hooks.land(bot.airT);
    }
    bot.coyote = MOVE.coyote;
    bot.airT = 0;
    const g0 = bot.ground;
    if (g0 && g0.solid && g0.solid.spring && bot.vy >= 0) {
      // A spring pad: launched, higher still with jump held.
      const sp = g0.solid.spring;
      bot.vy = -(it.jump ? sp.power * 1.18 : sp.power);
      bot.onGround = false;
      bot.rising = true;
      sp.squash = 1;
      if (hooks.spring) hooks.spring(sp);
    }
  } else {
    bot.airT += dt;
  }

  // Remember the last solid, still ground it stood on: a fall is survived from there.
  const underCrusher = world.movers.some((m) => m.kind === 'crusher' && bot.x > m.bx - 40 && bot.x < m.bx + m.w + 40 && bot.y > m.by);
  if (bot.onGround && !bot.groundMover && firmGround(bot.ground) && !underCrusher) {
    bot.safeT += dt;
    if (bot.safeT > 0.25) bot.safe = { x: bot.x, y: bot.y };
  } else bot.safeT = 0;

  portalStep(bot, world, hooks);

  if (world.wells.length) {
    const took = swallowingWell(world.wells, bot.x, bot.y, bot.r * 2);
    if (took && hooks.swallowed) hooks.swallowed(took);
  }
  if (bot.top > world.height + 80 && hooks.fell) hooks.fell();
}

/**
 * Ground a fall can be survived from: still, and there to stay. Not a crate or
 * glass (they break), a frozen enemy's ice (it thaws), spikes, a door, or
 * anything that moves or blinks.
 */
export function firmGround(s) {
  return !!s && !s.crate && !s.ice && !s.mover && !s.broken && s.kind !== 'ice' && s.kind !== 'spikes' && s.kind !== 'gate';
}

/** The segments the robot can touch this step, with a wormhole's mouth cut out of them when it stands in one. */
function nearby(bot, world, hole) {
  const pad = 24;
  let segs = segmentsNear(world, bot.x - bot.r - pad, bot.top - pad, bot.x + bot.r + pad, bot.bottom + pad);
  if (world.ice && world.ice.length) {
    for (const blk of world.ice) {
      if (blk.x1 < bot.x - 60 || blk.x0 > bot.x + 60 || blk.y1 < bot.top - 60 || blk.y0 > bot.bottom + 60) continue;
      segs = segs.concat(blk.segs);
    }
  }
  return hole ? openedSegments(hole, segs) : segs;
}

/**
 * Push the robot out of everything it overlaps. Ground lifts it straight up
 * (so it neither slides down a slope nor off a ledge it still covers), a
 * ceiling stops its rise, a wall stops what went into it. A thin platform
 * only counts from above: its top was at or below the robot's feet a step ago.
 */
function collide(bot, world, hooks, snapping = false) {
  const hole = openPortals(world).length ? bodyMouth(world, bot.x, bot.y, bot.r, bot.half, Math.abs(bot.vx) + Math.abs(bot.vy) > 0 ? 6 : 0) : null;
  const segs = nearby(bot, world, hole);
  const prevFeet = bot.prevY + bot.half + bot.r;
  bot.onGround = false;
  bot.ground = null;
  bot.groundMover = null;
  let hurt = null;
  for (let iter = 0; iter < 5; iter++) {
    let any = false;
    for (const s of segs) {
      if (s.oneWay) {
        if (bot.dropping > 0 || bot.vy < 0) continue;
        const lineY = s.ay - (s.mover ? s.mover.dy : 0);
        if (prevFeet > lineY + 3) continue;
      }
      const h = capsuleVsCapsule(bot.x, bot.y - bot.half, bot.x, bot.y + bot.half, bot.r, s.ax, s.ay, s.bx, s.by, s.thick || 0, bot.x, bot.y);
      if (!h) continue;
      if (s.oneWay && h.ny > -0.5) continue;
      any = true;
      if (h.ny <= -MOVE.walkable) {
        bot.y += h.depth / h.ny;
        const mv = s.mover;
        if (bot.vy > 0) bot.vy = 0; // a platform's own motion is carried as displacement, not velocity
        bot.onGround = true;
        bot.ground = s;
        bot.groundMover = mv || null;
      } else if (h.ny >= MOVE.walkable) {
        bot.x += h.nx * h.depth;
        bot.y += h.ny * h.depth;
        if (bot.vy < 0) bot.vy = 0;
        bot.rising = false;
      } else {
        bot.x += h.nx * h.depth;
        bot.y += h.ny * h.depth;
        const vn = bot.vx * h.nx + bot.vy * h.ny;
        if (vn < 0) {
          bot.vx -= vn * h.nx;
          bot.vy -= vn * h.ny;
        }
      }
      if (!snapping && (s.kind === 'spikes' || s.danger)) hurt = hurt || { reason: s.kind === 'spikes' ? 'spikes' : 'crushed', x: h.cx, y: h.cy };
    }
    if (!any) break;
  }
  if (snapping) return;
  // Still inside something after all that: a moving part has it against a wall.
  for (const s of segs) {
    if (s.oneWay) continue;
    const h = capsuleVsCapsule(bot.x, bot.y - bot.half, bot.x, bot.y + bot.half, bot.r, s.ax, s.ay, s.bx, s.by, s.thick || 0, bot.x, bot.y);
    if (h && h.depth > 6) {
      hurt = { reason: 'crushed', x: h.cx, y: h.cy };
      break;
    }
  }
  if (hurt && hooks.hurt) hooks.hurt(hurt.reason, hurt);
}

/** A pulse ring overtaking the robot throws it outward at the ring's speed, once per ring. */
function pulsePush(bot, world, hooks) {
  for (const p of world.pulsers) {
    const ring = p.ring();
    if (!ring) continue;
    const dx = bot.x - ring.x;
    const dy = bot.y - ring.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = bot.r + bot.half * 0.6 + ring.thick;
    const id = `${world.pulsers.indexOf(p)}:${p.nextAt}`;
    if (Math.abs(d - ring.r) > reach || bot.pulseSeen.has(id)) continue;
    bot.pulseSeen.add(id);
    if (bot.pulseSeen.size > 32) bot.pulseSeen.delete(bot.pulseSeen.values().next().value);
    const ux = dx / d;
    const uy = dy / d;
    const along = bot.vx * ux + bot.vy * uy;
    const push = p.speed * 1.4;
    if (along < push) {
      bot.vx += (push - along) * ux;
      bot.vy += (push - along) * uy;
    }
    bot.onGround = false;
    bot.rising = false;
    if (hooks.pulse) hooks.pulse(p);
  }
}

/**
 * At an open mouth: the moment the robot's centre goes through the surface
 * (having walked up to it, and not in its grace) it comes out of the other
 * end, its velocity turned by the angle between them and never slower out
 * of the mouth than WORM.minExit. Gravity stays down: the robot stays upright.
 */
function portalStep(bot, world, hooks) {
  if (!openPortals(world).length) {
    bot.lastMouth = null;
    return;
  }
  let mouth = bodyMouth(world, bot.x, bot.y, bot.r, bot.half);
  if (mouth && mouth.v < 0 && !(bot.portalGrace > 0) && bot.lastMouth === mouth.p.key) {
    const { p, q } = mouth;
    const o = throughPortal(p, q, bot.x, bot.y, bot.vx, bot.vy);
    const from = { x: bot.x, y: bot.y };
    const v = exitVelocity(q, o.vx, o.vy, isFloorEnd(q) ? WORM.floorExit : WORM.minExit);
    // Floor to floor, the turn is half a circle and would send the robot back the way it came:
    // it keeps walking the way it was going instead, so it steps off the mouth it came out of.
    if (isFloorEnd(p) && isFloorEnd(q)) v.vx = bot.vx;
    bot.x = o.x;
    bot.y = o.y;
    bot.vx = v.vx;
    bot.vy = v.vy;
    bot.prevX = bot.x;
    bot.prevY = bot.y;
    bot.portalGrace = PORTAL.grace;
    bot.onGround = false;
    bot.rising = false;
    bot.warped = true;
    if (hooks.warp) hooks.warp(from, { x: bot.x, y: bot.y }, p, q);
    mouth = bodyMouth(world, bot.x, bot.y, bot.r, bot.half);
  } else if (mouth && mouth.v < 0) {
    // In its grace: no further in than halfway, and never stranded behind a surface.
    bot.x -= mouth.p.nx * mouth.v;
    bot.y -= mouth.p.ny * mouth.v;
    mouth = { ...mouth, v: 0 };
  }
  bot.lastMouth = mouth && mouth.v >= 0 ? mouth.p.key : null;
}
