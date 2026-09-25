// Defector: secrets, and how well each level hides them. The first levels
// show them plainly; from the third a cover is cracked ground painted like
// the rest, the hollow behind it painted over as solid until it breaks, and
// the cracks are fainter the further into the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_DEFS, level } from '../src/levels.js';
import { Game } from '../src/game.js';
import { Charge } from '../src/blaster.js';
import { BLASTER, SCREEN, TILE } from '../src/config.js';
import { placeEnd } from '../src/wormholes.js';

const DT = 1 / 240;
const T = TILE;
const inside = (r, x, y) => x >= r.x0 - 10 && x <= r.x1 + 10 && y >= r.y0 - 10 && y <= r.y1 + 10;
const covers = (bp) => bp.crates.filter((c) => c.kind === 'cracked' || (c.kind === 'crate' && bp.secrets.some((s) => c.x >= s.x0 - T && c.x <= s.x1 && c.y >= s.y0 - 3 * T && c.y <= s.y1)));

test('secrets hide better the further into the game: crates at first, then cracks that fade to a hairline', () => {
  let last = 0;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const cracked = bp.crates.filter((c) => c.kind === 'cracked');
    if (L.id <= 2) assert.equal(cracked.length, 0, `${L.title} shows its secrets plainly`);
    else assert.ok(cracked.length >= 1, `${L.title} hides a secret under cracked ground`);
    for (const c of cracked) assert.equal(c.subtle, L.hide, 'as faintly as the level hides things');
    assert.ok(L.hide >= last, 'and never more plainly than the level before');
    last = L.hide;
  }
  assert.equal(LEVEL_DEFS[LEVEL_DEFS.length - 1].hide, 3, 'by the end, a hairline');
});

test('behind a cracked cover the hollow is painted over as solid, prize and all, until the cover breaks', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    for (const s of bp.secrets) {
      const prizes = bp.pickups.filter((p) => inside(s, p.x, p.y));
      const cover = bp.crates.findIndex((c) => c.kind === 'cracked' && c.x >= s.x0 - T && c.x <= s.x1 && c.y >= s.y0 - 3 * T && c.y <= s.y1);
      if (cover < 0) continue;
      const veil = bp.veils.find((v) => v.until === cover);
      assert.ok(veil, `${L.title}: the hollow at ${Math.round(s.x0)} is painted over`);
      for (const p of prizes) assert.ok(p.x > veil.x && p.x < veil.x + veil.w && p.y > veil.y && p.y < veil.y + veil.h, `${L.title}: the prize at ${Math.round(p.x)} is out of sight`);
    }
  }
});

test('every covered secret breaks under fire, and what is behind it can be found and taken', () => {
  let n = 0;
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    bp.secrets.forEach((sec, si) => {
      const g = new Game(bp, { shields: Infinity });
      const cover = g.world.crates.find((c) => covers(bp).some((k) => k.x === c.x && k.y === c.y) && c.x >= sec.x0 - T && c.x <= sec.x1);
      if (!cover) return;
      n++;
      for (const e of g.enemies) e.dead = true;
      const prizes = () => g.pickups.filter((p) => !p.taken && inside(sec, p.x, p.y)).length;
      const before = prizes();
      const top = cover.face === 'top';
      for (let k = 0; k < 5 && !cover.broken; k++) {
        g.charges.push(new Charge({ x: top ? cover.x + cover.w / 2 : cover.x - 60, y: top ? cover.y - 60 : cover.y + cover.h / 2, vx: top ? 0 : BLASTER.speed, vy: top ? BLASTER.speed : 0, born: g.time }));
        for (let i = 0; i < 60; i++) g.step(DT, { mx: 0 });
      }
      assert.ok(cover.broken, `${L.title}: the cover at ${Math.round(cover.x)} broke`);
      g.bot.spawn(top ? cover.x + cover.w / 2 : cover.x - 30, top ? cover.y - 40 : cover.y + cover.h - 31);
      g.bot.invuln = 1e9;
      for (let i = 0; i < 240 * 3.5; i++) g.step(DT, { mx: top ? (i % 120 < 60 ? 1 : -1) : 1 });
      assert.ok(g.secrets[si].found, `${L.title}: the secret at ${Math.round(sec.x0)} counted`);
      assert.equal(prizes(), 0, `${L.title}: all ${before} of its prizes taken`);
    });
  }
  assert.ok(n >= 20, `${n} covered secrets in the game`);
});

test('every loft\'s wall is in sight from the loft\'s own floor, and a wormhole puts the robot up there', () => {
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    for (const sec of bp.sections.filter((s) => s.type === 'secret' && s.p.kind === 'loft')) {
      const lx = sec.x0 + 10 * T;
      const wall = lx + 6 * T;
      let ok = false;
      for (let sx = lx - 2 * T; sx >= sec.x0 + T && !ok; sx -= T) {
        const g = new Game(bp, { shields: Infinity });
        for (const e of g.enemies) e.dead = true;
        const bot = g.bot;
        bot.spawn(sx, sec.y0 - 31);
        bot.invuln = 1e9;
        for (let i = 0; i < 60; i++) g.step(DT, { mx: 0 });
        let aim = null;
        for (let a = -Math.PI / 2 + 0.05; a < -0.05 && aim == null; a += 0.002) {
          bot.aim = a;
          const p = placeEnd(g.world, g.sight(), 1);
          if (p && p.nx < -0.9 && Math.abs(p.cx - wall) < 6) aim = a;
        }
        if (aim == null) continue;
        assert.ok(lx - sx < SCREEN.w / 2, 'from somewhere the wall is on screen');
        g.step(DT, { mx: 0, aim, worm: [false, true] });
        for (let i = 0; i < 10; i++) g.step(DT, { mx: 0, aim });
        g.step(DT, { mx: 0, aim: Math.PI / 2, worm: [true, false] });
        for (let i = 0; i < 240 * 2; i++) g.step(DT, { mx: 0 });
        ok = bot.onGround && bot.y < sec.y0 - 5 * T && bot.x > lx && bot.x < wall;
      }
      assert.ok(ok, `${L.title}: the loft at ${Math.round(lx)} could not be reached`);
    }
  }
});

test('later, a sky ledge is above the top of the screen, and its spring still gets you there', () => {
  for (const L of LEVEL_DEFS.filter((l) => l.hide >= 2)) {
    const bp = level(L.id);
    for (const sec of bp.sections.filter((s) => s.type === 'secret' && s.p.kind === 'sky')) {
      const ledge = bp.oneWays.find((o) => o.x0 >= sec.x0 && o.x1 <= sec.x1 + 1);
      assert.ok(sec.y0 - ledge.y > SCREEN.h / 2, `${L.title}: the ledge is ${Math.round(sec.y0 - ledge.y)} px up, out of sight from the ground`);
      const g = new Game(bp, { shields: Infinity });
      const bot = g.bot;
      bot.spawn(sec.x0 + 4 * T, sec.y0 - 60);
      bot.invuln = 1e9;
      let up = false;
      for (let i = 0; i < 240 * 3 && !up; i++) {
        g.step(DT, { mx: bot.vy < 0 && bot.y < sec.y0 - 200 ? 1 : 0, jump: true });
        up = bot.onGround && Math.abs(bot.y + 30.5 - ledge.y) < 4;
      }
      assert.ok(up, `${L.title}: the spring reaches the ledge`);
    }
  }
});
