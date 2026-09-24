// Screenshots of Defector from the real game in headless Chromium: a few
// places along a level, or its boss fight a few seconds in.
//
//   node sequel/tools/shots.mjs level 3 out/          three views along level 3
//   node sequel/tools/shots.mjs boss 3 out/           level 3's boss, 4 s into the fight
//   node sequel/tools/shots.mjs title out/            the title screen
//
// Uses the game at DEFLECTOR_URL, or one on port 8099, or starts server.js
// there (tools/browser.mjs). The robot is made untouchable for the shots.
import { chromium, serve, watchErrors } from '../../tools/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [what = 'title', a = '1', b = 'shots'] = process.argv.slice(2);
const out = what === 'title' ? a : b;
fs.mkdirSync(out, { recursive: true });
const { url, stop } = await serve();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
watchErrors(page, errs);
await page.goto(`${url}sequel/`);
await page.waitForTimeout(800);
if (what === 'title') {
  await page.screenshot({ path: path.join(out, 'title.png') });
} else {
  const id = Number(a);
  await page.evaluate((l) => window.__defector.startLevel(l, { shields: Infinity }), id);
  await page.waitForTimeout(300);
  if (what === 'level') {
    const spots = await page.evaluate(() => {
      const g = window.__defector.game;
      const secs = g.bp.sections.filter((s) => s.type !== 'checkpoint');
      return [0.12, 0.45, 0.8].map((u) => {
        const s = secs[Math.floor(u * (secs.length - 1))];
        return { x: s.x0 + 60, y: s.y0 - 31 };
      });
    });
    for (let i = 0; i < spots.length; i++) {
      await page.evaluate((p) => {
        const g = window.__defector.game;
        g.bot.spawn(p.x, p.y);
        g.bot.invuln = 1e9;
        window.__defector.renderer.cam.set = false;
      }, spots[i]);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(out, `level${id}-${i + 1}.png`) });
    }
  } else if (what === 'boss') {
    await page.evaluate(() => {
      const g = window.__defector.game;
      const A = g.arena;
      g.bot.spawn(A.x0 + 160, A.floor - 31);
      g.bot.invuln = 1e9;
      window.__defector.renderer.cam.set = false;
    });
    await page.waitForTimeout(Number(process.env.WAIT || 5200));
    await page.evaluate(() => (window.__defector.game.bot.invuln = 1e9));
    await page.screenshot({ path: path.join(out, `boss${id}.png`) });
  }
}
console.log(errs.join('\n') || 'no errors');
await browser.close();
stop();
