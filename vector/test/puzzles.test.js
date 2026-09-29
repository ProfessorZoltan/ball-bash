// A puzzle is only a puzzle if the obvious way fails. Each kind is built on
// its own and tried the wrong way: walked at, jumped at full run, shot at
// from everywhere with no wormhole open, or with its black hole taken away.
// The autopilot (levels.test.js) proves the right way works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Builder } from '../src/build.js';
import { SECTIONS } from '../src/sections.js';
import { PUZZLES } from '../src/puzzles.js';
import { Game } from '../src/game.js';
import { stepRobot, standAt } from '../src/player.js';
import { guideLine } from '../src/blaster.js';
import { lookDir, yawPitch, sub } from '../src/math.js';
import { PHYSICS_DT } from '../src/config.js';
import { fly } from '../tools/autopilot.mjs';

const DT = PHYSICS_DT;

function mini(type, o = {}, def = {}) {
  const b = new Builder({ seed: 7, width: 8, roster: [], ...def });
  SECTIONS.start(b, {});
  const at = b.route.length;
  (SECTIONS[type] || PUZZLES[type])(b, o);
  SECTIONS.run(b, { foes: 0 });
  const bp = b.finish();
  bp.spawn = b.spawn;
  bp.theme = { real: 0, sky: ['#000', '#000', '#000'], roles: {} };
  bp.arena = null;
  bp.def = { key: 'test' };
  return { bp, sec: bp.sections[1], at };
}

/** How far along the section's way a robot got (its own frame's z). */
function along(sec, p) {
  const d = [p[0] - sec.from[0], p[2] - sec.from[2]];
  const L = Math.hypot(sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]);
  return (d[0] * (sec.to[0] - sec.from[0]) + d[1] * (sec.to[2] - sec.from[2])) / L;
}

/** Run at the obstacle along the way, jumping at the edge, and see how far the robot gets. */
function charge(bp, sec, from, seconds = 6) {
  const g = new Game(bp, { invulnerable: true });
  g.bot.spawn(from, Math.atan2(sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]));
  let best = -Infinity;
  let fell = false;
  for (let t = 0; t < seconds; t += DT) {
    const ev = stepRobot(g.bot, { mz: 1, run: true, jump: true, jumpPress: g.bot.onGround }, g.world, DT, []);
    if (ev.some((e) => e.s === 'fall')) {
      fell = true;
      break;
    }
    if (g.bot.onGround) best = Math.max(best, along(sec, g.bot.pos));
  }
  return { best, fell };
}

test('a bulkhead cannot be walked or jumped under: its slot is lower than the robot', () => {
  const { bp, sec } = mini('bulkhead', { gapH: 1.3, thick: 2 });
  const r = charge(bp, sec, standAt(...sec.from));
  assert.ok(r.best < 9.5, `got to ${r.best.toFixed(1)} m, past the wall's face at 9`);
});

test('a chasm and a launch cannot be jumped, even at a full run from the lip', () => {
  // The launch's wedge stands in the middle of the way: its run is down the open lane beside it.
  for (const [type, o, lip, side] of [['chasm', { gap: 12 }, 7, 0], ['launch', { gap: 10 }, 16, 3]]) {
    const { bp, sec } = mini(type, o);
    const d = [sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]];
    const L = Math.hypot(...d);
    const right = [-d[1] / L, d[0] / L];
    const start = standAt(sec.from[0] + right[0] * side, sec.from[1], sec.from[2] + right[1] * side);
    const r = charge(bp, sec, start);
    assert.ok(r.best > lip - 3, `${type}: the run got past the wedge to the lip (${r.best.toFixed(1)})`);
    assert.ok(r.fell || r.best < lip + 0.5, `${type}: the robot got across (${r.best.toFixed(1)})`);
  }
});

test('no end opens across a launch\'s gap from its near side, from anywhere on it, the wedge included; its face and the floor still take one', () => {
  const { bp, sec } = mini('launch', { gap: 10 });
  const g = new Game(bp, { invulnerable: true });
  const d = [sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]];
  const L = Math.hypot(...d);
  const f = [d[0] / L, d[1] / L];
  const right = [-f[1], f[0]];
  const at = (x, y, z) => [sec.from[0] + right[0] * x + f[0] * z, sec.from[1] + y, sec.from[2] + right[1] * x + f[1] * z];
  const lip = 16;
  const across = (p) => (p[0] - sec.from[0]) * f[0] + (p[2] - sec.from[2]) * f[1] > lip + 0.05;
  let tries = 0;
  // Standing all over the near side, and on top of the wedge's high end, aiming at the far floor, walls and pit.
  const stands = [];
  for (const x of [-3, -1.5, 0, 1.5, 3]) for (const z of [1, 4, 12, 14.5, 15.6]) stands.push(at(x, 0.91, z));
  stands.push(at(0, 2.4 + 0.91, 6.3), at(1.5, 2.4 + 0.91, 6.3));
  const targets = [];
  for (const x of [-3.5, -2, 0, 2, 3.5]) for (const z of [lip + 1, lip + 5, lip + 10, lip + 13, lip + 20, lip + 26]) for (const y of [-4, 0, 1, 3]) targets.push(at(x, y, z));
  for (const p of stands) {
    g.bot.spawn(p, 0);
    const eye = g.bot.eyePos();
    for (const q of targets) {
      const dir = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]];
      const n = Math.hypot(...dir);
      g.bot.yaw = Math.atan2(dir[0], dir[2]);
      g.bot.pitch = Math.asin(dir[1] / n);
      const e = g.openEnd(0);
      tries++;
      assert.ok(!e || !across(e.c), `an end opened across the gap, at ${e && e.c.map((v) => v.toFixed(1))}, from ${p.map((v) => v.toFixed(1))}`);
      g.closeEnd(0, g.me, true);
    }
  }
  assert.ok(tries > 3000);
  // The launch itself: standing at the lip, looking back, an end opens on the wedge's face and one at the robot's feet.
  const link = bp.links.find((k) => k.kind === 'launch');
  g.bot.spawn(at(0, 0.91, lip - 0.9), 0);
  const aim = (p) => {
    const eye = g.bot.eyePos();
    const dir = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
    g.bot.yaw = Math.atan2(dir[0], dir[2]);
    g.bot.pitch = Math.asin(dir[1] / Math.hypot(...dir));
  };
  aim(link.face);
  const face = g.openEnd(0);
  aim(link.near);
  const feet = g.openEnd(1);
  assert.ok(face && face.ramp && face.n[1] > 0.5, 'the face takes an end, looking up and out over the gap');
  assert.ok(feet && feet.kind === 'floor', 'and the floor at the lip takes the other');
});

test('with the wormholes, each puzzle is crossed', () => {
  for (const type of ['bulkhead', 'chasm', 'launch', 'vault', 'orbit', ...Object.keys(PUZZLES)]) {
    const { bp } = mini(type);
    const g = new Game(bp, { shields: Infinity, maxShields: Infinity, noWaves: true });
    const r = flyGame(g);
    assert.ok(r.ok, `${type}: ${r.why}`);
  }
});

function flyGame(g) {
  // The autopilot's own loop, on a hand-built blueprint.
  return fly(null, { game: g });
}

/** Fire from many places along the way, in every direction, with no wormhole open: does any shot flip the switch? */
function anyShot(bp, sec, n = 900, sw = bp.world.switches[0]) {
  const g = new Game(bp, { invulnerable: true });
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const k = (i % 9) / 8;
    const p = [sec.from[0] + (sec.to[0] - sec.from[0]) * k * 0.7, sec.from[1] + 0.9, sec.from[2] + (sec.to[2] - sec.from[2]) * k * 0.7];
    g.bot.spawn(p, 0);
    const yaw = ((i * 137.5) % 360) * (Math.PI / 180);
    const pitch = (((i * 61) % 170) - 85) * (Math.PI / 180);
    const dir = lookDir(yaw, pitch);
    const gl = guideLine(g.world, [], g.muzzle(dir), dir, 'std', 3);
    if (gl.end && gl.end.solid && gl.end.solid.switchRef === sw) hits++;
  }
  return hits;
}

test('a vault\'s switch is sealed: no shot from the way reaches it without a wormhole', () => {
  const { bp, sec } = mini('vault');
  assert.equal(anyShot(bp, sec), 0);
});

test('an orbit\'s switch is out of every straight line: without its black hole, no shot reaches it', () => {
  const { bp, sec } = mini('orbit');
  bp.world.wells.length = 0;
  assert.equal(anyShot(bp, sec), 0);
});

test('a door stays shut until its switch is shot', () => {
  const { bp, sec } = mini('switchdoor');
  const r = charge(bp, sec, standAt(...sec.from));
  assert.ok(r.best < 10.5, `walked through a shut door (${r.best.toFixed(1)})`);
});

test('the same full-run charge does clear an ordinary running gap, so the tests above are not vacuous', () => {
  const { bp, sec } = mini('gap', { gap: 5.5, run: true });
  const r = charge(bp, sec, standAt(...sec.from));
  assert.ok(r.best > 14, `fell short of an ordinary gap (${r.best.toFixed(1)})`);
});

// ------------------------------------------------ puzzles of several steps

/** A section's own frame: x across the way, z along it. */
function frame(sec) {
  const d = [sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]];
  const n = Math.hypot(...d);
  const F = [d[0] / n, 0, d[1] / n];
  const R = [-F[2], 0, F[0]];
  const o = sec.from;
  return {
    P: (x, y, z) => [o[0] + R[0] * x + F[0] * z, o[1] + y, o[2] + R[2] * x + F[2] * z],
    local: (p) => [(p[0] - o[0]) * R[0] + (p[2] - o[2]) * R[2], p[1] - o[1], (p[0] - o[0]) * F[0] + (p[2] - o[2]) * F[2]],
  };
}

/** Look from where the robot stands at p and open end `which`: the end, or null. */
function endAt(g, which, p) {
  const eye = g.bot.eyePos();
  const yp = yawPitch(sub(p, eye));
  g.bot.yaw = yp.yaw;
  g.bot.pitch = yp.pitch;
  return g.openEnd(which);
}

/** Step the robot with one intent a while, calling `each` after every step. */
function hold(g, it, seconds, each) {
  for (let t = 0; t < seconds; t += DT) {
    g.step(DT, typeof it === 'function' ? it() : it);
    if (each && each()) return;
  }
}

test('a fling\'s gap is jumped neither from the way nor off the board at the top of its tower', () => {
  const { bp, sec } = mini('fling');
  const { P, local } = frame(sec);
  const far = sec.lip + sec.gap;
  // Flat out along the open lane, jumping at the lip.
  const r = charge(bp, sec, standAt(...P(2, 0, 1)));
  assert.ok(r.fell || r.best < sec.lip + 0.5, `ran and jumped to ${r.best.toFixed(1)}`);
  // Flat out from the back of the tower's top, along the board, off its end.
  const [tx0, tx1, T0] = sec.tower;
  const g = new Game(bp, { invulnerable: true, noWaves: true });
  g.bot.spawn(standAt(...P((tx0 + tx1) / 2, sec.top, T0 + 0.5)), Math.atan2(sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]));
  let best = -Infinity;
  hold(g, () => ({ mz: 1, run: true, jump: true, jumpPress: g.bot.onGround }), 4, () => {
    if (g.bot.onGround) best = Math.max(best, local(g.bot.pos)[2]);
  });
  assert.ok(best < far, `came down at ${best.toFixed(1)}, the far side is at ${far}`);
});

test('no end opens across a fling\'s gap from its near side, the tower\'s top included', () => {
  const { bp, sec } = mini('fling');
  const { P, local } = frame(sec);
  const g = new Game(bp, { invulnerable: true, noWaves: true });
  const [tx0, tx1, T0, T1] = sec.tower;
  const stands = [P(2, 0, 2), P(0, 0, sec.lip - 1), P(3, 0, sec.lip - 0.6), P((tx0 + tx1) / 2, sec.top, T0 + 1), P((tx0 + tx1) / 2, sec.top, T1 + 2)];
  let tries = 0;
  for (const p of stands) {
    for (const x of [-3, 0, 3]) {
      for (const dz of [1, 4, 8, 12]) {
        for (const y of [sec.rise - 3, sec.rise, sec.rise + 2]) {
          g.bot.spawn(standAt(...p), 0);
          const e = endAt(g, 0, P(x, y, sec.lip + sec.gap + dz));
          tries++;
          assert.ok(!e || local(e.c)[2] < sec.lip + 0.05, `an end opened across, at ${e && local(e.c).map((v) => v.toFixed(1))}`);
          g.closeEnd(0, g.me, true);
        }
      }
    }
  }
  assert.ok(tries > 150);
});

test('walked or dropped into from a jump\'s height, a fling\'s ends only put you down short of the lip: it takes the fall', () => {
  const { bp, sec } = mini('fling');
  const { P, local } = frame(sec);
  const link = bp.links.find((k) => k.kind === 'fling');
  for (const drop of [false, true]) {
    const g = new Game(bp, { invulnerable: true, noWaves: true });
    g.bot.spawn(standAt(...P(1, 0, sec.lip - 1.5)), Math.PI);
    assert.ok(endAt(g, 0, link.face) && endAt(g, 1, link.floor), 'the ends open');
    // Walked onto the floor end from a few metres on, or let fall into it from the top of a running jump.
    const lf = local(link.floor);
    if (drop) g.bot.spawn([link.floor[0], link.floor[1] + 0.91 + 2.7, link.floor[2]], 0);
    else g.bot.spawn(standAt(...P(lf[0], 0, lf[2] + 3)), 0);
    const aim = link.floor;
    let best = -Infinity;
    let warped = false;
    hold(g, () => {
      g.bot.yaw = Math.atan2(aim[0] - g.bot.pos[0], aim[2] - g.bot.pos[2]);
      return drop || warped ? {} : { mz: 1 };
    }, 5, () => {
      if (g.events.some((e) => e.s === 'warp')) warped = true;
      if (g.bot.onGround && warped) best = Math.max(best, local(g.bot.pos)[2]);
    });
    assert.ok(warped, `${drop ? 'dropped' : 'walked'} into the end`);
    assert.ok(best < sec.lip + 0.5, `${drop ? 'dropped' : 'walked'} in and came down at ${best.toFixed(1)}`);
  }
});

test('a hoist is boarded by no jump, at any moment of its travel, and nothing across its shaft takes an end but it', () => {
  const { bp, sec } = mini('hoist');
  const { P, local } = frame(sec);
  const hoist = bp.world.solids.find((s) => s.id === sec.hoist);
  for (let t0 = 0; t0 < 10; t0 += 1.25) {
    const g = new Game(bp, { invulnerable: true, noWaves: true });
    hold(g, {}, t0);
    g.bot.spawn(standAt(...P(0, 0, sec.lip - 8)), Math.atan2(sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]));
    let on = false;
    hold(g, () => ({ mz: 1, run: true, jump: true, jumpPress: g.bot.onGround }), 3, () => {
      if (g.bot.onGround && (g.bot.ground === hoist || local(g.bot.pos)[2] > sec.lip + 1)) on = true;
    });
    assert.ok(!on, `a jump boarded it ${t0} s in`);
  }
  // From the near side, with the platform low and high: an end opens on it, or nowhere across.
  for (const t0 of [0, 5]) {
    const g = new Game(bp, { invulnerable: true, noWaves: true });
    hold(g, {}, t0);
    for (const x of [-3, 0, 3]) {
      for (const [y, z] of [[-4, sec.lip + sec.gap - 1], [0, sec.lip + sec.gap - 1], [sec.h - 1, sec.lip + sec.gap + 0.1], [sec.h + 1, sec.lip + sec.gap + 4], [sec.h + 3, sec.lip + sec.gap + 10]]) {
        g.bot.spawn(standAt(...P(0, 0, sec.lip - 1)), 0);
        const e = endAt(g, 0, P(x, y, z));
        assert.ok(!e || e.host === hoist || local(e.c)[2] < sec.lip + 0.05, `an end opened across, on ${e && e.host.role} at ${e && local(e.c).map((v) => v.toFixed(1))}`);
        g.closeEnd(0, g.me, true);
      }
    }
  }
});

/** Fire a fan of shots into end 1 from where the robot stands: how many reach the switch? */
function fanThrough(g, sw, near, spread = 1, step = 0.03) {
  const eye = g.bot.eyePos();
  const base = yawPitch(sub(near, eye));
  let hits = 0;
  for (let dy = -spread; dy <= spread; dy += step) {
    for (let dp = -0.6; dp <= 0.9; dp += step) {
      const dir = lookDir(base.yaw + dy, Math.max(-1.4, Math.min(1.4, base.pitch + dp)));
      const gl = guideLine(g.world, g.openEnds, g.muzzle(dir), dir, 'std', 3);
      if (gl.end && gl.end.solid && gl.end.solid.switchRef === sw) hits++;
    }
  }
  return hits;
}

test('a bend\'s switch takes no shot without a wormhole; with its ends but not its black hole, none through them either', () => {
  const { bp, sec } = mini('bend');
  const link = bp.links.find((k) => k.kind === 'bend');
  const sw = bp.world.switches.find((x) => x.id === link.sw);
  assert.equal(anyShot(bp, sec, 900, sw), 0);
  const { P } = frame(sec);
  const g = new Game(bp, { invulnerable: true, noWaves: true });
  g.bot.spawn(standAt(...P(0, 0, 6.5)), 0);
  assert.ok(endAt(g, 0, link.back) && endAt(g, 1, link.across), 'the ends open');
  g.bot.spawn(standAt(...P(-2, 0, 8)), 0);
  const on = fanThrough(g, sw, link.across);
  bp.world.wells[0].off = true;
  const off = fanThrough(g, sw, link.across);
  assert.ok(on >= 5, `with the hole, ${on} shots through the ends reach it`);
  assert.equal(off, 0, 'without it, none');
});

test('in a bend\'s chamber an end opens only on the near part of its back wall', () => {
  const { bp, sec } = mini('bend');
  const { P, local } = frame(sec);
  const link = bp.links.find((k) => k.kind === 'bend');
  const g = new Game(bp, { invulnerable: true, noWaves: true });
  const back = local(link.back);
  let opened = 0;
  for (const [sx, sz] of [[0, 4], [-2, 8], [2, 14], [0, 20]]) {
    for (const x of [5.5, 7, 9, 11.4]) {
      for (const y of [-2, 0.5, 2, 4, 6.5]) {
        for (const z of [4, 8, 12, 15, 18]) {
          g.bot.spawn(standAt(...P(sx, 0, sz)), 0);
          const e = endAt(g, 0, P(x, y, z));
          if (e && local(e.c)[0] > 4.1) {
            opened++;
            assert.ok(Math.abs(local(e.c)[0] - back[0]) < 0.05 && local(e.c)[2] < 11, `an end opened in the chamber at ${local(e.c).map((v) => v.toFixed(1))}`);
          }
          g.closeEnd(0, g.me, true);
        }
      }
    }
  }
  assert.ok(opened > 5, 'and there it does');
});

test('a relay\'s bridge stays down until its last switch, and its gap is no jump', () => {
  const { bp, sec } = mini('relay');
  const r = charge(bp, sec, standAt(...sec.from), 8);
  assert.ok(r.fell || r.best < sec.lip + 0.5, `got to ${r.best.toFixed(1)}`);
});

test('a relay\'s room: no shot reaches its switch straight, shutter up or down, and no end opens in it while the shutter is down', () => {
  const { bp, sec } = mini('relay');
  const { P } = frame(sec);
  const link = bp.links.find((k) => k.kind === 'relay');
  const sw2 = bp.world.switches.find((x) => x.id === link.sw2);
  const sw1 = bp.world.switches.find((x) => x.id === link.sw1);
  assert.equal(anyShot(bp, sec, 900, sw2), 0, 'shutter down');
  const shutter = bp.world.solids.find((s) => s.door && s.door.id === sec.shutter);
  shutter.door.open = true;
  shutter.door.at = 1;
  bp.world.step(0);
  assert.equal(anyShot(bp, sec, 900, sw2), 0, 'shutter up');
  // Down: the back wall is hidden; up (its switch shot), an end opens on it.
  const g = new Game(mini('relay').bp, { invulnerable: true, noWaves: true });
  g.bot.spawn(standAt(...P(0, 0, 11)), 0);
  assert.equal(endAt(g, 0, link.back), null, 'no end while the shutter is down');
  g.flip(g.world.switches.find((x) => x.id === sw1.id));
  hold(g, {}, 1);
  assert.ok(endAt(g, 0, link.back), 'an end once it is up');
});

test('a relay\'s open shutter lets the eye into its room and no body: nobody gets in by jumping at it, or from the top of a jump right in it', () => {
  const { bp, sec } = mini('relay');
  const { P, local } = frame(sec);
  const w = 4;
  const inRoom = (p) => local(p)[0] > w + 0.6;
  const shutUp = () => {
    const g = new Game(mini('relay').bp, { invulnerable: true, noWaves: true });
    g.flip(g.world.switches.find((x) => x.id === sec.sw1));
    hold(g, {}, 0.6);
    return g;
  };
  // At full run and walking, from across the way and close by, jumping at every distance from the wall.
  for (const x0 of [-3, 0, 2]) {
    for (const z of [9.6, 11, 12.4]) {
      for (const at of [0.6, 1, 1.4, 1.8, 2.4]) {
        for (const run of [true, false]) {
          const g = shutUp();
          const to = P(w + 3, 0, z);
          g.bot.spawn(standAt(...P(x0, 0, z)), 0);
          let jumped = false;
          hold(g, () => {
            g.bot.yaw = Math.atan2(to[0] - g.bot.pos[0], to[2] - g.bot.pos[2]);
            const now = !jumped && local(g.bot.pos)[0] > w - at;
            if (now) jumped = true;
            return { mz: 1, run, jump: true, jumpPress: now };
          }, 2.5, () => inRoom(g.bot.pos));
          assert.ok(!inRoom(g.bot.pos), `got in from ${x0}, jumping ${at} m out${run ? ' at a run' : ''}`);
        }
      }
    }
  }
  // Set right in the opening, standing on the sill, and pushed on in.
  const g = shutUp();
  const [a, c] = [P(w, 0, 11), P(w + 3, 0, 11)];
  g.bot.spawn(standAt(...P(w + 0.1, 2, 11)), Math.atan2(c[0] - a[0], c[2] - a[2]));
  hold(g, { mz: 1, run: true, jump: true, jumpPress: true }, 1.5, () => inRoom(g.bot.pos));
  assert.ok(!inRoom(g.bot.pos), 'got past the glass');
  assert.ok(bp.world.solids.some((s) => s.glass), 'glass behind the shutter');
});

test('whoever walks into a relay\'s room through its ends is let out onto the way by its switch, ends or no ends', () => {
  const { bp, sec } = mini('relay');
  const { P, local } = frame(sec);
  const w = 4;
  const link = bp.links.find((k) => k.kind === 'relay');
  const g = new Game(bp, { invulnerable: true, noWaves: true });
  const exit = g.world.solids.find((s) => s.door && s.door.id === sec.exit);
  const [ez0, ez1] = sec.exitAt;
  const ez = (ez0 + ez1) / 2;
  // Its door out is shut from the way until the switch is shot: walked at, nobody gets in.
  g.bot.spawn(standAt(...P(0, 0, ez)), 0);
  const door = P(w + 3, 0, ez);
  hold(g, () => {
    g.bot.yaw = Math.atan2(door[0] - g.bot.pos[0], door[2] - g.bot.pos[2]);
    return { mz: 1, run: true };
  }, 2);
  assert.equal(exit.door.open, false);
  assert.ok(local(g.bot.pos)[0] < w, 'walked in through the shut door');
  // In through the ends: the shutter up, one end on the back wall and one across the way, and walked into.
  g.bot.spawn(standAt(...P(0, 0, 11)), 0);
  g.flip(g.world.switches.find((x) => x.id === link.sw1));
  hold(g, {}, 0.6);
  assert.ok(endAt(g, 0, link.back) && endAt(g, 1, link.across), 'both ends open');
  hold(g, () => {
    g.bot.yaw = Math.atan2(link.across[0] - g.bot.pos[0], link.across[2] - g.bot.pos[2]);
    return { mz: 1 };
  }, 4, () => local(g.bot.pos)[0] > w + 0.6);
  assert.ok(local(g.bot.pos)[0] > w + 0.6, 'came out in the room');
  hold(g, {}, 1);
  // Both ends gone: nothing in there takes one but the back wall. The switch, shot close to.
  g.closeEnd(0);
  g.closeEnd(1);
  const sw2 = g.world.switches.find((x) => x.id === link.sw2);
  const yp = yawPitch(sub(sw2.p, g.bot.eyePos()));
  g.bot.yaw = yp.yaw;
  g.bot.pitch = yp.pitch;
  g.step(DT, { firePress: true });
  hold(g, {}, 1.5);
  assert.equal(sw2.on, true, 'the switch is lit');
  assert.equal(exit.door.open, true, 'and the door out is open');
  // Out through it, and on along the way.
  const inside = P(w + 2, 0, ez);
  const out = P(0, 0, ez);
  hold(g, () => {
    const to = local(g.bot.pos)[0] > w + 1.2 && Math.abs(local(g.bot.pos)[2] - ez) > 0.4 ? inside : out;
    g.bot.yaw = Math.atan2(to[0] - g.bot.pos[0], to[2] - g.bot.pos[2]);
    return { mz: 1 };
  }, 6, () => local(g.bot.pos)[0] < 0.5);
  assert.ok(local(g.bot.pos)[0] < 0.5 && g.bot.onGround, `back on the way at ${local(g.bot.pos).map((v) => v.toFixed(1))}`);
});

test('a beam without wormholes ends on the wall across the way, and no charge lights its lens', () => {
  const { bp, sec } = mini('beam');
  const link = bp.links.find((k) => k.kind === 'beam');
  const sw = bp.world.switches.find((x) => x.id === link.sw);
  const g = new Game(bp, { invulnerable: true, noWaves: true });
  const { P } = frame(sec);
  g.bot.spawn(standAt(...P(-2, 0, 17)), 0);
  hold(g, {}, 2);
  assert.equal(sw.on, false);
  // Charges straight at the lens, from all over the way.
  for (const [x, z] of [[-2, 17], [2, 20], [0, 24], [3, 16]]) {
    g.bot.spawn(standAt(...P(x, 0, z)), 0);
    const eye = g.bot.eyePos();
    const yp = yawPitch(sub(sw.p, eye));
    g.bot.yaw = yp.yaw;
    g.bot.pitch = yp.pitch;
    g.step(DT, { firePress: true });
    hold(g, {}, 1.5);
  }
  assert.equal(sw.on, false, 'a charge lit it');
});
