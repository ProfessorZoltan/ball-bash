// Screenshots of Vector from the real game in headless Chromium: a few places
// along a level, its boss a few seconds in, the title screen, or a pair of
// wormholes seen through.
//
//   node vector/tools/shots.mjs level 4 out/     three views along level 4
//   node vector/tools/shots.mjs boss 4 out/      level 4's boss, 5 s into the fight
//   node vector/tools/shots.mjs portal 1 out/    a pair of ends opened, and the view through one
//   node vector/tools/shots.mjs title out/       the title screen
//   node vector/tools/shots.mjs compare 8 out/   a view of level 8 at High quality (shadows, bloom) and at Medium (neither)
//
// Uses the game at DEFLECTOR_URL, or one on port 8099, or starts server.js
// there (tools/browser.mjs). WebGL runs in software (SwiftShader), so a frame
// is slow; the robot is made untouchable for the shots. Quality is held at
// High (QUALITY=medium or low for the others): Auto would step down on so slow a machine.
import { chromium, serve, watchErrors } from '../../tools/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [what = 'title', a = '1', b = 'shots'] = process.argv.slice(2);
const out = what === 'title' ? a : b;
fs.mkdirSync(out, { recursive: true });
const { url, stop } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
watchErrors(page, errs);
const quality = process.env.QUALITY || 'high';
await page.addInitScript((q) => {
  try {
    localStorage.setItem('vector.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('vector.settings') || '{}'), quality: q }));
  } catch (_) {
    // no storage: Auto it is
  }
}, quality);
await page.goto(`${url}vector/`);
await page.waitForTimeout(1200);
const shot = (name) => page.screenshot({ path: path.join(out, name), timeout: 90000 });
if (what === 'title') {
  await shot('title.png');
} else {
  const id = Number(a);
  await page.evaluate((l) => window.__vector.startLevel(l, { invulnerable: true }), id);
  await page.waitForTimeout(500);
  if (what === 'level') {
    for (const u of [0.15, 0.45, 0.75]) {
      await page.evaluate((k) => {
        const g = window.__vector.game;
        const secs = g.bp.sections.filter((s) => s.type !== 'turn' && s.type !== 'checkpoint');
        const s = secs[Math.floor(k * (secs.length - 1))];
        g.bot.spawn([s.from[0], s.from[1] + 0.91, s.from[2]], Math.atan2(s.to[0] - s.from[0], s.to[2] - s.from[2]));
      }, u);
      await page.waitForTimeout(900);
      await shot(`level${id}-${Math.round(u * 100)}.png`);
    }
  } else if (what === 'boss') {
    await page.evaluate(() => {
      const g = window.__vector.game;
      const A = g.bp.arena;
      g.bot.spawn(A.spawn, A.yaw);
      g.startBoss();
    });
    await page.waitForTimeout(Number(process.env.WAIT || 5000));
    await page.evaluate(() => {
      const g = window.__vector.game;
      const B = g.boss;
      const e = g.bot.eyePos();
      const d = [B.pos[0] - e[0], B.pos[1] + 1 - e[1], B.pos[2] - e[2]];
      g.bot.yaw = Math.atan2(d[0], d[2]);
      g.bot.pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
    });
    await page.waitForTimeout(400);
    await shot(`boss${id}.png`);
  } else if (what === 'compare') {
    // A third of the way in, looking along the way: once with High quality's extras, once without (Medium).
    await page.evaluate(() => {
      const g = window.__vector.game;
      const secs = g.bp.sections.filter((s) => s.type !== 'turn' && s.type !== 'checkpoint');
      const s = secs[Math.floor(secs.length * 0.35)];
      g.bot.spawn([s.from[0], s.from[1] + 0.91, s.from[2]], Math.atan2(s.to[0] - s.from[0], s.to[2] - s.from[2]));
    });
    for (const q of ['high', 'medium']) {
      await page.evaluate((qq) => {
        const r = window.__vector.renderer;
        r.quality = qq;
        r.resize();
      }, q);
      await page.waitForTimeout(900);
      const info = await page.evaluate(() => window.__vector.renderer.info());
      console.log(q, JSON.stringify({ fx: info.fx, drawn: info.drawn, casters: info.casters }));
      await shot(`compare${id}-${q}.png`);
    }
  } else if (what === 'portal') {
    await page.evaluate(() => {
      const g = window.__vector.game;
      // A few steps in: one end on the wall to the left, one to the right (or, in the
      // open, on the floor ahead and further ahead), then look at the first.
      const y0 = g.bot.yaw;
      g.bot.spawn([g.bot.pos[0] + Math.sin(y0) * 6, g.bot.pos[1], g.bot.pos[2] + Math.cos(y0) * 6], y0);
      g.bot.yaw = y0 + Math.PI / 2;
      g.bot.pitch = 0;
      let a = g.openEnd(0);
      g.bot.yaw = y0 - Math.PI / 2;
      let b = g.openEnd(1);
      if (!a || !b) {
        g.bot.yaw = y0;
        g.bot.pitch = -0.5;
        a = g.openEnd(0);
        g.bot.pitch = -0.2;
        b = g.openEnd(1);
      }
      g.bot.yaw = y0 + (g.ends[0] && g.ends[0].kind === 'wall' ? 1.0 : 0);
      g.bot.pitch = -0.15;
    });
    await page.waitForTimeout(900);
    await shot(`portal${id}.png`);
  }
}
console.log(errs.join('\n') || 'no errors');
await browser.close();
stop();
