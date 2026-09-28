// The robot's body in the third game: an upright capsule you look out of. It
// walks and runs, jumps high with the button held and hops with a tap, is
// carried by what it stands on, walks up anything a stair's height, and goes
// through wormholes. The same step runs in the game, in the tests and in the
// autopilot that proves every level can be crossed. DOM-free.
import { ROBOT, MOVE, ROBOT_PULL, PIT_DEPTH } from './config.js';
import { clamp, dot, madd } from './math.js';
import { topAt } from './collide.js';
import { portalRobot } from './wormholes.js';

export class Robot {
  constructor(p = [0, 0.9, 0], yaw = 0) {
    this.r = ROBOT.r;
    this.half = ROBOT.half;
    this.eye = ROBOT.eye;
    this.spawn(p, yaw);
  }

  /** Put the robot down at p (its feet on whatever is under p's centre height), facing yaw. */
  spawn(p, yaw = this.yaw || 0) {
    this.pos = [...p];
    this.vel = [0, 0, 0];
    this.yaw = yaw;
    this.pitch = 0;
    this.onGround = false;
    this.ground = null;
    this.groundN = [0, 1, 0];
    this.coyote = 0;
    this.buffer = 0;
    this.air = 0;
    this.jumped = false;
    this.flung = false;
    this.mouth = null;
    this.safe = [...p];
    this.safeYaw = yaw;
    this.safeT = 0;
    this.stride = 0;
    this.invuln = 0;
    this.frozen = 0;
    this.bob = 0; // the view's walking sway, a phase
    // Each time the robot is put somewhere or turned by something other than its
    // own look (a wormhole, a respawn), this counts one more: a guest's look made
    // before then is not laid over the new one (netplay.js).
    this.turns = (this.turns || 0) + 1;
  }

  get feet() {
    return this.pos[1] - this.half - this.r;
  }

  eyePos() {
    return [this.pos[0], this.pos[1] + this.eye, this.pos[2]];
  }
}

/** Where the robot's feet land it for a spawn point on a floor at height y. */
export function standAt(x, y, z) {
  return [x, y + ROBOT.half + ROBOT.r + 0.001, z];
}

/** Is this something the robot can be put back on after a fall: firm, still and lasting? */
function firm(s) {
  return !(s.move || s.crush || s.blink || s.crate || s.cover || s.door || s.dynamic || s.enemy || s.noSafe || s.spring);
}

function approach2(vx, vz, tx, tz, rate) {
  const dx = tx - vx;
  const dz = tz - vz;
  const d = Math.hypot(dx, dz);
  if (d <= rate) return [tx, tz];
  return [vx + (dx / d) * rate, vz + (dz / d) * rate];
}

/**
 * One physics step. `it` is the intent: mx (strafe, right positive) and mz
 * (forward), run, jump (held) and jumpPress (this step). `ends` are the open
 * wormhole ends. Returns what happened, as events.
 */
export function stepRobot(bot, it, world, dt, ends = []) {
  const ev = [];
  if (bot.invuln > 0) bot.invuln -= dt;
  const held = bot.frozen > 0;
  if (held) bot.frozen -= dt;

  // Carried by what it stands on.
  const g0 = bot.ground;
  if (g0 && !g0.gone && !g0.hidden && g0.vel) {
    bot.pos = madd(bot.pos, g0.vel, dt);
  }

  // Where it wants to go, in the plane.
  const sy = Math.sin(bot.yaw);
  const cy = Math.cos(bot.yaw);
  const mx = held ? 0 : it.mx || 0;
  const mz = held ? 0 : it.mz || 0;
  let wx = sy * mz - cy * mx;
  let wz = cy * mz + sy * mx;
  let mag = Math.hypot(wx, wz);
  if (mag > 1) {
    wx /= mag;
    wz /= mag;
    mag = 1;
  }
  const top = it.run ? MOVE.run : MOVE.walk;
  if (bot.onGround) {
    const rate = (mag > 0.01 ? MOVE.accel : MOVE.friction) * dt;
    [bot.vel[0], bot.vel[2]] = approach2(bot.vel[0], bot.vel[2], wx * top, wz * top, rate);
  } else if (mag > 0.01) {
    // In the air a push adds speed the way it points, up to the top speed, and never
    // takes away what a jump, a spring or a wormhole gave.
    const dirx = wx / mag;
    const dirz = wz / mag;
    const cur = bot.vel[0] * dirx + bot.vel[2] * dirz;
    const add = top * mag - cur;
    if (add > 0) {
      const a = Math.min(add, MOVE.airAccel * dt);
      bot.vel[0] += dirx * a;
      bot.vel[2] += dirz * a;
    }
  } else {
    [bot.vel[0], bot.vel[2]] = approach2(bot.vel[0], bot.vel[2], 0, 0, MOVE.airDrag * dt);
  }

  // Jumping: a press is kept a moment (the buffer), and a ledge just left still counts (coyote time).
  if (it.jumpPress && !held) bot.buffer = MOVE.buffer;
  else bot.buffer = Math.max(0, bot.buffer - dt);
  if (bot.onGround) bot.coyote = MOVE.coyote;
  else bot.coyote = Math.max(0, bot.coyote - dt);
  if (bot.buffer > 0 && bot.coyote > 0) {
    const hs = Math.hypot(bot.vel[0], bot.vel[2]);
    const k = clamp((hs - MOVE.walk) / (MOVE.run - MOVE.walk), 0, 1);
    let vy = MOVE.jump + (MOVE.runJump - MOVE.jump) * k;
    // Off a moving platform, its motion comes along.
    const gv = bot.ground && bot.ground.vel ? bot.ground.vel : [0, 0, 0];
    bot.vel[0] += gv[0];
    bot.vel[2] += gv[2];
    vy += Math.max(0, gv[1]);
    bot.vel[1] = vy;
    bot.onGround = false;
    bot.ground = null;
    bot.coyote = 0;
    bot.buffer = 0;
    bot.jumped = true;
    bot.flung = false;
    ev.push({ s: 'jump' });
  }

  // Gravity: light rising with jump held (or thrown), heavy once it is let go, heavier falling.
  let g;
  if (bot.vel[1] > 0) g = bot.flung ? MOVE.gUp : bot.jumped && !it.jump ? MOVE.gCut : MOVE.gUp;
  else {
    g = MOVE.gFall;
    bot.jumped = false;
    bot.flung = false;
  }
  bot.vel[1] -= g * dt;
  const f = world.field(bot.pos, ROBOT_PULL);
  if (bot.onGround) {
    // Its feet hold against the sideways part of a black hole's pull.
    bot.vel[1] += Math.min(0, f[1]) * dt;
  } else {
    bot.vel = madd(bot.vel, f, dt);
  }
  bot.vel[1] += world.lift(bot.pos) * dt;
  if (bot.vel[1] < -MOVE.maxFall) bot.vel[1] = -MOVE.maxFall;

  // Move, then through any wormhole, then out of whatever it went into.
  const wasGround = bot.onGround;
  bot.pos = madd(bot.pos, bot.vel, dt);
  const warp = portalRobot(bot, ends, dt);
  if (warp) {
    bot.turns++;
    ev.push({ s: 'warp', from: warp.from, to: warp.to });
  }
  bot.onGround = false;
  bot.ground = null;
  resolve(bot, world, ev, wasGround);

  // Down a slope or a low step: follow the ground rather than fly off it.
  if (!bot.onGround && wasGround && bot.vel[1] <= 0 && !bot.jumped && !warp) {
    const was = [...bot.pos];
    bot.pos[1] -= MOVE.snap;
    let hit = false;
    world.capsuleContacts(bot.pos, bot.half, bot.r, skipFor(bot), (s, h) => {
      if (h.n[1] >= MOVE.walkable) hit = true;
    });
    if (hit) resolve(bot, world, ev, true);
    else bot.pos = was;
  }

  if (bot.onGround) {
    if (bot.air > 0.12) ev.push({ s: 'land', air: bot.air });
    bot.air = 0;
    const s = bot.ground;
    if (s && s.spring && bot.vel[1] <= 0.01) {
      bot.vel[1] = s.spring;
      bot.onGround = false;
      bot.ground = null;
      bot.flung = true;
      bot.jumped = false;
      ev.push({ s: 'spring', at: [...bot.pos] });
    } else {
      const hs = Math.hypot(bot.vel[0], bot.vel[2]);
      bot.stride += hs * dt;
      bot.bob += hs * dt * 2.6;
      if (bot.stride > 1.9) {
        bot.stride = 0;
        ev.push({ s: 'step', surface: s && s.mat, role: s && s.role });
      }
      // Remember firm ground to come back to after a fall.
      if (s && firm(s) && !bot.mouth) {
        const m = 0.25;
        if (bot.pos[0] > s.min[0] + m && bot.pos[0] < s.max[0] - m && bot.pos[2] > s.min[2] + m && bot.pos[2] < s.max[2] - m) {
          bot.safeT += dt;
          if (bot.safeT > 0.2) {
            bot.safe = [...bot.pos];
            bot.safeYaw = bot.yaw;
            bot.safeT = 0;
          }
        }
      }
    }
  } else {
    bot.air += dt;
  }

  if (world.floorY !== undefined && bot.pos[1] < world.floorY - PIT_DEPTH) ev.push({ s: 'fall' });
  return ev;
}

function skipFor(bot) {
  const host = bot.mouth && bot.mouth.host;
  return (s) => s === host || s.ghostFor === bot || (bot.passThrough && bot.passThrough(s));
}

/**
 * Push the robot out of everything it is in, deepest first. Ground (a surface
 * facing up enough) pushes straight up, so it never creeps down a slope; a wall
 * a stair's height is stepped up; a roof stops a jump.
 */
function resolve(bot, world, ev, wasGround) {
  const skip = skipFor(bot);
  for (let iter = 0; iter < 6; iter++) {
    let best = null;
    world.capsuleContacts(bot.pos, bot.half, bot.r, skip, (s, h) => {
      if (!best || h.depth > best.h.depth) best = { s, h };
    });
    if (!best) break;
    const { s, h } = best;
    const n = h.n;
    if (n[1] >= MOVE.walkable) {
      bot.pos[1] += Math.min(h.depth / n[1], h.depth * 2 + 0.02);
      if (bot.vel[1] < 0 || (s.vel && bot.vel[1] < s.vel[1])) bot.vel[1] = 0;
      bot.onGround = true;
      bot.ground = s;
      bot.groundN = n;
      continue;
    }
    if (n[1] <= -0.5) {
      // Something over its head: a roof, or a crusher coming down.
      if (bot.onGround && s.vel && s.vel[1] < -0.2) ev.push({ s: 'crushed', by: s });
      bot.pos = madd(bot.pos, n, h.depth);
      if (bot.vel[1] > 0) bot.vel[1] = 0;
      bot.jumped = false;
      bot.flung = false;
      continue;
    }
    // A wall. A stair's height is walked up.
    if (wasGround || bot.onGround) {
      const top = topAt(s, bot.pos[0] - n[0] * bot.r, bot.pos[2] - n[2] * bot.r);
      const rise = top - bot.feet;
      if (rise > 0 && rise <= MOVE.stepUp) {
        const up = [bot.pos[0], bot.pos[1] + rise + 0.01, bot.pos[2]];
        if (world.capsuleFree(up, bot.half, bot.r, skip)) {
          bot.pos = up;
          if (bot.vel[1] < 0) bot.vel[1] = 0;
          bot.onGround = true;
          bot.ground = s;
          continue;
        }
      }
    }
    bot.pos = madd(bot.pos, n, h.depth);
    const vn = dot(bot.vel, n);
    if (vn < 0) bot.vel = madd(bot.vel, n, -vn);
  }
}
