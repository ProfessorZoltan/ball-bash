// The ways through that are a choice: a fork whose high road is quick, with
// a prize on it and nothing under it; a locked room whose fight is worse
// than any on the way; a vault whose door shuts too soon for anyone to run
// to it; a ledge only a black hole's pull carries you to. The level's own
// way takes the safe road and none of their prizes (levels.test.js); each
// risky way is flown here to its prize and back, and each fails the obvious
// way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_DEFS, level } from '../src/levels.js';
import { Game } from '../src/game.js';
import { flyDetour } from '../tools/secrets.mjs';
import { Autopilot } from '../tools/autopilot.mjs';
import { standAt } from '../src/player.js';
import { PHYSICS_DT, BLASTER, ROBOT } from '../src/config.js';

const KINDS = ['fork', 'gauntlet', 'rush', 'slingshot'];

/** A section's own frame: x across the way (toward b.R), z along it. To the world, and back. */
function frame(sec) {
  const d = [sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]];
  const n = Math.hypot(d[0], d[1]);
  const F = [d[0] / n, 0, d[1] / n];
  const R = [-F[2], 0, F[0]];
  const o = sec.from;
  return {
    P: (x, y, z) => [o[0] + R[0] * x + F[0] * z, o[1] + y, o[2] + R[2] * x + F[2] * z],
    local: (p) => [(p[0] - o[0]) * R[0] + (p[2] - o[2]) * R[2], p[1] - o[1], (p[0] - o[0]) * F[0] + (p[2] - o[2]) * F[2]],
  };
}

function run(g, ap, limit, each) {
  for (let t = 0; t < limit && !ap.done && !ap.failed; t += PHYSICS_DT) {
    g.step(PHYSICS_DT, ap.intent());
    if (each) each();
  }
}

test('every level has a risky way through, and from the fourth on two or more of different kinds, each written down and none a secret', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const kinds = bp.sections.map((s) => s.type).filter((t) => KINDS.includes(t));
    assert.ok(kinds.length >= (L.id >= 4 ? 2 : 1), `${L.title}: ${kinds.join(', ')}`);
    if (L.id >= 4) assert.ok(new Set(kinds).size >= 2, `${L.title}: ${kinds.join(', ')}`);
    assert.equal(bp.detours.filter((d) => d.secret === false).length, kinds.length, `${L.title}: a way for each`);
  }
});

test('every risky way is flown with the robot\'s own physics to its prize and back to the way, no shield lost', () => {
  for (const L of LEVEL_DEFS) {
    level(L.id, { noEnemies: true }).detours.forEach((d, k) => {
      if (d.secret !== false) return;
      const r = flyDetour(L.id, k);
      assert.ok(r.ok, `${L.title}, ${r.kind}: ${r.why}`);
    });
  }
});

test('a locked room shuts only on whoever walks in, and opens with its prize when the last of its waves falls', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const secs = bp.sections.filter((s) => s.type === 'gauntlet');
    for (const sec of secs) {
      const g = new Game(level(L.id), { invulnerable: true });
      const a = g.ambushes.find((x) => x.optional && x.doors.includes(sec.door));
      const door = g.world.solids.find((s) => s.door && s.door.id === sec.door);
      // More machines than any fight on the way.
      const size = (x) => x.waves.reduce((n, w) => n + w.length, 0);
      for (const other of g.ambushes.filter((x) => !x.optional)) assert.ok(size(a) > size(other), `${L.title}: ${size(a)} machines, and ${size(other)} on the way`);
      // Walked past, on the way: it stays open.
      const { P } = frame(sec);
      g.bot.spawn(standAt(...P(0, 0, 7.5)), 0);
      for (let t = 0; t < 1; t += PHYSICS_DT) g.step(PHYSICS_DT, {});
      assert.equal(a.state, 'wait', `${L.title}: nobody has to go in`);
      assert.equal(door.door.open, true);
      // Walked in: it shuts, and the waves come.
      g.bot.spawn(standAt(...P(sec.side * (bp.def.width / 2 + 3), 0, 7.5)), 0);
      g.step(PHYSICS_DT, {});
      assert.equal(a.state, 'fight');
      assert.equal(door.door.open, false);
      let waves = 0;
      for (let i = 0; i < 20 && a.state !== 'done'; i++) {
        g.step(PHYSICS_DT, {});
        if (a.foes.length && a.foes.some((e) => !e.dead)) {
          waves++;
          assert.equal(door.door.open, false, `${L.title}: shut through wave ${waves}`);
          for (const e of a.foes) e.dead = true;
        }
      }
      assert.equal(waves, 3, `${L.title}: three waves`);
      assert.equal(door.door.open, true, `${L.title}: open when the last falls`);
      assert.ok(g.pickups.some((p) => p.dropped && !p.taken && Math.hypot(p.pos[0] - a.dropAt[0], p.pos[2] - a.dropAt[2]) < 1), `${L.title}: the prize drops`);
    }
  }
});

test('a vault\'s switch is hit straight only from the near end of its hall, and from there nobody outruns its door', () => {
  let n = 0;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id, { noEnemies: true });
    for (const sec of bp.sections.filter((s) => s.type === 'rush')) {
      n++;
      const { P, local } = frame(sec);
      const w = bp.def.width / 2;
      const [zd0, zd1] = sec.doorAt;
      const sw = bp.world.switches.find((x) => x.id === sec.sw);
      const s = sw.solid;
      // Its middle and its corners, a little in.
      const marks = [sw.p];
      for (const i of [0.1, 0.9]) for (const j of [0.1, 0.9]) for (const k of [0.1, 0.9]) marks.push([0, 1, 2].map((a, n) => s.min[a] + (s.max[a] - s.min[a]) * [i, j, k][n]));
      // Every spot in the hall, stood or at the top of a jump, the switch can be hit from.
      let best = null;
      for (let z = 0.5; z < zd0; z += 1) {
        for (let x = -w + 0.5; x <= w - 0.5; x += 1) {
          for (const up of [ROBOT.eye, 1.5, 2.5, 3.2]) {
            const feet = P(x, 0, z);
            const eye = [feet[0], feet[1] + 0.9 + up, feet[2]];
            const seen = marks.some((m) => {
              const d = [m[0] - eye[0], m[1] - eye[1], m[2] - eye[2]];
              const len = Math.hypot(...d);
              const h = bp.world.raycast(eye, d.map((v) => v / len), len + 0.2);
              return h && h.solid === s;
            });
            if (seen && (!best || z > best.z)) best = { x, z, len: Math.hypot(sw.p[0] - eye[0], sw.p[1] - eye[1], sw.p[2] - eye[2]) };
          }
        }
      }
      assert.ok(best, `${L.title}: the switch is seen from somewhere`);
      assert.ok(best.z < 8, `${L.title}: seen from ${best.z} m down the hall`);
      // From the nearest of them, flat out for the door the moment the charge leaves: along the wall, and in.
      const g = new Game(bp, { noWaves: true, invulnerable: true });
      g.bot.spawn(standAt(...P(best.x, 0, best.z)), 0);
      const gsw = g.world.switches.find((x) => x.id === sec.sw);
      const door = g.world.solids.find((x) => x.door && x.door.id === sec.door);
      const zm = (zd0 + zd1) / 2;
      const flipAt = best.len / BLASTER.speed;
      let inside = false;
      let shot = false;
      for (let t = 0; t < 8; t += PHYSICS_DT) {
        if (!shot && t >= flipAt) {
          g.flip(gsw);
          shot = true;
        }
        const [, , z] = local(g.bot.pos);
        const to = z < zd0 - 1.2 ? P(sec.side * (w - 0.7), 0, zm) : P(sec.side * (w + 3), 0, zm);
        g.bot.yaw = Math.atan2(to[0] - g.bot.pos[0], to[2] - g.bot.pos[2]);
        g.step(PHYSICS_DT, { mz: 1, run: true });
        if (local(g.bot.pos)[0] * sec.side > w + 0.6) inside = true;
      }
      assert.ok(!inside, `${L.title}: ran into the vault from ${best.z} m`);
      assert.equal(door.door.open, false, `${L.title}: the door shut in front of the robot`);
    }
  }
  assert.ok(n >= 5, 'vaults to run at');
});

test('without its black hole, no running jump from anywhere along the way reaches a slingshot\'s island; with it, one from the edge does', () => {
  let n = 0;
  for (const L of LEVEL_DEFS) {
    const bp0 = level(L.id, { noEnemies: true });
    for (const [si, sec] of bp0.sections.entries()) {
      if (sec.type !== 'slingshot') continue;
      n++;
      const { P, local } = frame(sec);
      const w = bp0.def.width / 2;
      const [I0, I1] = sec.island;
      const onIsland = (g) => {
        const [x, , z] = local(g.bot.pos);
        return g.bot.onGround && x * sec.side > I0 - 0.5 && x * sec.side < I1 + 0.5 && Math.abs(z - sec.zc) < 3.5;
      };
      const leap = (off, z0, to) => {
        const bp = level(L.id, { noEnemies: true });
        const hole = bp.world.wells.find((x) => Math.hypot(x.p[0] - sec.hole[0], x.p[2] - sec.hole[2]) < 0.1);
        hole.off = off;
        const g = new Game(bp, { noWaves: true, invulnerable: true });
        const from = standAt(...P(sec.side * (w - 0.1), 0, z0));
        g.bot.spawn(standAt(...P(0, 0, z0)), 0);
        const ap = new Autopilot(g, [{ a: 'jump', from, to: standAt(...P(sec.side * to[0], 0, to[1])), run: true }]);
        let landed = false;
        run(g, ap, 12, () => {
          if (onIsland(g)) landed = true;
        });
        return landed;
      };
      // Along the whole edge, at the island's nearest point and its middle.
      // (A run-up is 7 m back along the jump, so the ends of the stretch are left to the sections either side.)
      for (let z = 4; z <= 18; z += 1.5) {
        const zt = Math.max(sec.zc - 2.5, Math.min(sec.zc + 2.5, z));
        for (const to of [[I0 + 0.6, zt], [(I0 + I1) / 2, sec.zc]]) assert.ok(!leap(true, z, to), `${L.title} (section ${si}): made it with no hole, from ${z} m`);
      }
      for (const z of [sec.zc - 1.5, sec.zc, sec.zc + 1.5]) assert.ok(leap(false, z, [I0 + 2, sec.zc]), `${L.title}: the hole carries a jump from ${z} m`);
    }
  }
  assert.ok(n >= 3, 'slingshots to leap at');
});
