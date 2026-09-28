// Plays levels in the real page, in headless Chromium: the page's own loop
// draws and sounds everything while the autopilot drives the robot (machines
// awake, the robot untouchable), then the boss is fought for a few seconds.
// It catches what only the page runs: the art for every machine and boss,
// the HUD, the menus, the sound cues. It reports errors and the frame rate.
//
//   node vector/tools/play.mjs 3        level 3
//   node vector/tools/play.mjs all      every level
//
// WebGL runs in software here, so this is slow: a level takes a few minutes.
import { chromium, serve, watchErrors } from '../../tools/browser.mjs';
import { LEVEL_DEFS } from '../src/levels.js';

const arg = process.argv[2] || 'all';
const ids = arg === 'all' ? LEVEL_DEFS.map((l) => l.id) : arg.split(',').map(Number);
const { url, stop } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  watchErrors(page, errs);
  await page.goto(`${url}vector/`);
  await page.waitForTimeout(800);
  await page.evaluate(async (id) => {
    const V = window.__vector;
    const { Autopilot } = await import('/vector/tools/autopilot.mjs');
    V.renderer.quality = 'low';
    await V.audio.init();
    V.startLevel(id, { invulnerable: true });
    const g = V.game;
    const ap = new Autopilot(g);
    window.__ap = ap;
    const step = g.step.bind(g);
    // Each physics step takes the autopilot's intent instead of the (idle) keyboard's.
    g.step = (dt) => step(dt, ap.done || ap.failed ? {} : ap.intent());
  }, id);
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 420000) {
    await page.waitForTimeout(3000);
    last = await page.evaluate(() => ({ phase: window.__vector.game.phase, i: window.__ap.i, n: window.__ap.route.length, failed: window.__ap.failed, t: window.__vector.game.time, fps: document.getElementById('hud-fps').textContent }));
    if (last.phase === 'boss' || last.failed) break;
  }
  if (last.phase === 'boss') await page.waitForTimeout(8000);
  const end = await page.evaluate(() => ({ state: window.__vector.state, phase: window.__vector.game.phase, boss: window.__vector.game.boss && window.__vector.game.boss.hp }));
  const ok = !errs.length && end.phase !== 'level';
  if (!ok) bad++;
  console.log(`level ${id}: ${ok ? 'ok' : 'PROBLEM'} — reached ${last.i}/${last.n} steps in ${last.t.toFixed(0)} s of play, ${last.fps}, ${end.phase}${last.failed ? `, autopilot: ${last.failed}` : ''}`);
  for (const e of errs.slice(0, 8)) console.log('   ', e);
  await page.close();
}
await browser.close();
stop();
process.exit(bad ? 1 : 0);
