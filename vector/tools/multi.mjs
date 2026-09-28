// Multiplayer in real browsers: a host and one or two guests, each in its own
// page, meeting through the LAN relay of server.js (?relay=local). The host
// makes a room, the guests join it by its code, and a co-op level or a
// versus arena is played for a few seconds with the robots walking, turning,
// jumping and firing. Each page is screenshotted, and each guest's own robot
// is checked against where the host has it.
//
//   node vector/tools/multi.mjs [coop|versus] [players] [level or arena] [out dir]
//   node vector/tools/multi.mjs versus 2 foundry out/
//
// WebGL runs in software (SwiftShader), so the pages are small and slow; the
// netcode does not mind, which is part of what this shows.
import { chromium, serve, watchErrors } from '../../tools/browser.mjs';
import fs from 'node:fs';

const mode = process.argv[2] || 'coop';
const count = Number(process.argv[3] || 2);
const what = process.argv[4] || (mode === 'versus' ? 'crossfire' : '1');
const out = process.argv[5] || 'out';
fs.mkdirSync(out, { recursive: true });

const { url, stop } = await serve();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const pages = [];
for (let i = 0; i < count; i++) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  watchErrors(page, errs, `[${i ? `guest ${i}` : 'host'}] `);
  await page.goto(`${url}vector/?relay=local`);
  await page.waitForFunction(() => window.__vector);
  await page.evaluate(() => (window.__vector.renderer.quality = 'low'));
  pages.push(page);
}
const [host, ...guests] = pages;
await host.evaluate(() => window.__vector.host('Ada'));
await host.waitForFunction(() => window.__vector.room && window.__vector.room.code, null, { timeout: 20000 });
const code = await host.evaluate(() => window.__vector.room.code);
const names = ['Bram', 'Cleo'];
for (const [i, g] of guests.entries()) {
  await g.evaluate(([c, n]) => window.__vector.join(c, n), [code, names[i]]);
  await g.waitForFunction(() => window.__vector.room && window.__vector.room.players.length > 0 && window.__vector.state === 'room', null, { timeout: 20000 });
}
await host.waitForFunction((n) => window.__vector.room.players.length === n, count, { timeout: 20000 });
await host.screenshot({ path: `${out}/multi-room-host.png`, timeout: 90000 });
if (guests[0]) await guests[0].screenshot({ path: `${out}/multi-room-guest.png`, timeout: 90000 });
const pick = mode === 'versus' ? { mode: 'versus', map: what, shields: 5 } : { mode: 'coop', level: Number(what) };
await host.evaluate((p) => {
  window.__vector.pick(p);
  window.__vector.startMatch();
}, pick);
for (const p of pages) await p.waitForFunction(() => window.__vector.state === 'play' && window.__vector.game && window.__vector.mp, null, { timeout: 30000 });
// A headless page cannot capture the mouse; say it has, so a click fires.
for (const p of pages) await p.evaluate(() => (window.__vector.input.locked = true));
const hold = async (p, keys, ms) => {
  for (const k of keys) await p.keyboard.down(k);
  await p.waitForTimeout(ms);
  for (const k of keys) await p.keyboard.up(k);
};
// Versus holds every robot through its countdown: wait for the fight.
if (mode === 'versus') for (const p of pages) await p.waitForFunction(() => window.__vector.game.phase === 'fight', null, { timeout: 60000 });
await Promise.all(pages.map(async (p, i) => {
  await p.waitForTimeout(300);
  for (let k = 0; k < 4; k++) {
    await hold(p, ['w', i % 2 ? 'a' : 'd'], 1200);
    await p.mouse.move(320 + (i % 2 ? -60 : 60), 180);
    await hold(p, [' '], 200);
    await p.mouse.click(320, 180);
  }
}));
await Promise.all(pages.map((p) => p.waitForTimeout(2500)));
console.log('host queues', JSON.stringify(await host.evaluate(() => [...window.__vector.mp.link.queues].map(([slot, q]) => ({ slot, depth: q.depth, buffer: q.buffer, ...q.stats })))));
for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/multi-${mode}-${i ? `guest${i}` : 'host'}.png`, timeout: 90000 });
// Where each page has every robot, and whether the guests saw the host's charges.
const views = [];
for (const p of pages) views.push(await p.evaluate(() => {
  const g = window.__vector.game;
  return { local: g.local, robots: g.players.map((q) => ({ at: q.bot.pos.map((v) => +v.toFixed(2)), shields: q.shields, out: q.out, shots: q.stats.shots })), time: g.time.toFixed(1), fps: document.getElementById('hud-fps').textContent };
}));
console.log(JSON.stringify(views));
let bad = errs.length;
for (const [i, v] of views.entries()) {
  if (!i) continue;
  const me = v.robots[v.local].at;
  const theirs = views[0].robots[v.local].at;
  const d = Math.hypot(me[0] - theirs[0], me[1] - theirs[1], me[2] - theirs[2]);
  console.log(`guest ${i}: its own robot at ${me.join(', ')}, the host has it at ${theirs.join(', ')} (${d.toFixed(2)} m apart)`);
  if (d > 0.5) bad++;
}
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
await stop();
process.exit(bad ? 1 : 0);
