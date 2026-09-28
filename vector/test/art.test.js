// The art draws every machine and every boss without a hitch: each look in
// every level's roster, frozen and flashing, and each boss a few seconds
// into its fight, the aim line and the blaster in hand, against a renderer
// that only counts what it is asked to draw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Art } from '../src/art.js';
import { FX } from '../src/fx.js';
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { Enemy } from '../src/enemies.js';

function counter() {
  const c = { draws: 0, bad: 0 };
  c.r = {
    draw: (shape, m) => {
      c.draws++;
      for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) c.bad++;
    },
    point: (p) => {
      if (!p.every(Number.isFinite)) c.bad++;
    },
    light() {},
  };
  return c;
}

test('every machine in every roster draws, frozen or flashing, with nothing but numbers', () => {
  const c = counter();
  const art = new Art(c.r);
  for (const L of LEVEL_DEFS) {
    const g = new Game(level(L.id), { invulnerable: true });
    for (const f of L.roster) {
      const before = c.draws;
      const e = new Enemy({ ...f, p: [...g.bot.pos] });
      e.awake = true;
      e.flash = 0.1;
      e.frozen = f.move === 'walker' ? 1 : 0;
      art.t = 1.3;
      art.enemy(e, g);
      assert.ok(c.draws > before, `${L.title}: ${f.look} draws something`);
    }
  }
  assert.equal(c.bad, 0);
});

test('every boss draws a few seconds into its fight, with the aim line and the blaster in hand', () => {
  const c = counter();
  const art = new Art(c.r);
  const fx = new FX();
  for (const L of LEVEL_DEFS) {
    const bp = level(L.id);
    const g = new Game(bp, { invulnerable: true });
    g.bot.spawn(bp.arena.spawn, bp.arena.yaw);
    g.startBoss();
    for (let i = 0; i < 700; i++) g.step(1 / 120, {});
    const before = c.draws;
    art.lastEye = g.bot.eyePos();
    art.frame(g, fx, { time: 7, aimLine: true, eye: g.bot.eyePos() });
    art.viewmodel(c.r, g);
    assert.ok(c.draws - before > 10, `${g.boss.name} is drawn`);
  }
  assert.equal(c.bad, 0);
});
