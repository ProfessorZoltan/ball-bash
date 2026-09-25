// Multiplayer in real browsers: a host and one or two guests, each in its own
// page, meeting through the LAN relay of server.js (?relay=local). The host
// makes a room, the guests join it by its code, and a co-op level or a
// versus map is played for a few seconds with the robots walking, jumping and
// firing. Each page is screenshotted, and the guests' view of the game is
// checked against the host's.
//
// Usage: node sequel/tools/multi.mjs [coop|versus] [players] [level or map] [out dir]
import { chromium, serve, watchErrors } from '../../tools/browser.mjs';

const mode = process.argv[2] || 'coop';
const count = Number(process.argv[3] || 2);
const what = process.argv[4] || (mode === 'versus' ? 'crossfire' : '1');
const out = process.argv[5] || 'out';

const { url, stop } = await serve();
const browser = await chromium.launch();
const errs = [];
const pages = [];
for (let i = 0; i < count; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watchErrors(page, errs, `[${i ? `guest ${i}` : 'host'}] `);
  await page.goto(`${url}sequel/?relay=local`);
  await page.waitForFunction(() => window.__defector);
  pages.push(page);
}
const [host, ...guests] = pages;
await host.evaluate(() => window.__defector.host('Ada'));
await host.waitForFunction(() => window.__defector.room && window.__defector.room.code);
const code = await host.evaluate(() => window.__defector.room.code);
const names = ['Bram', 'Cleo'];
for (const [i, g] of guests.entries()) {
  await g.evaluate(([c, n]) => window.__defector.join(c, n), [code, names[i]]);
  await g.waitForFunction(() => window.__defector.room && window.__defector.room.players.length > 0 && window.__defector.state === 'room');
}
await host.waitForFunction((n) => window.__defector.room.players.length === n, count);
await host.screenshot({ path: `${out}/multi-room-host.png` });
if (guests[0]) await guests[0].screenshot({ path: `${out}/multi-room-guest.png` });
const pick = mode === 'versus' ? { mode: 'versus', map: what, shields: 5 } : { mode: 'coop', level: Number(what) };
await host.evaluate((p) => {
  window.__defector.pick(p);
  window.__defector.startMatch();
}, pick);
for (const p of pages) await p.waitForFunction(() => window.__defector.state === 'play' && window.__defector.game);
// Everyone walks right, jumps now and then, and fires.
const hold = async (p, keys, ms) => {
  for (const k of keys) await p.keyboard.down(k);
  await p.waitForTimeout(ms);
  for (const k of keys) await p.keyboard.up(k);
};
for (const p of pages) await p.mouse.move(900, 300);
await Promise.all(pages.map(async (p, i) => {
  await p.waitForTimeout(mode === 'versus' ? 2600 : 600);
  for (let k = 0; k < 4; k++) {
    await hold(p, [i % 2 ? 'a' : 'd'], 500);
    await hold(p, [' '], 200);
    await p.mouse.down();
    await p.mouse.up();
  }
}));
await Promise.all(pages.map((p) => p.waitForTimeout(1500)));
// How each host queue is doing (how many steps it holds, how often it ran dry).
console.log('host queues', JSON.stringify(await host.evaluate(() => [...window.__defector.mp.link.queues].map(([slot, q]) => ({ slot, depth: q.depth, buffer: q.buffer, ...q.stats })))));
for (const [i, p] of pages.entries()) await p.screenshot({ path: `${out}/multi-${mode}-${i ? `guest${i}` : 'host'}.png` });
// Where each page has every robot.
const views = [];
for (const p of pages) views.push(await p.evaluate(() => ({ local: window.__defector.game.local, robots: window.__defector.game.players.map((q) => ({ x: Math.round(q.bot.x), y: Math.round(q.bot.y), pool: q.pool, out: q.out })), enemies: window.__defector.game.enemies.length, time: window.__defector.game.time.toFixed(1) })));
console.log(JSON.stringify(views, null, 1));
const hostRobots = views[0].robots;
for (const [i, v] of views.entries()) {
  if (!i) continue;
  const me = v.robots[v.local];
  const theirs = hostRobots[v.local];
  console.log(`guest ${i}: its own robot at ${me.x},${me.y}, the host has it at ${theirs.x},${theirs.y}`);
}
console.log(errs.length ? errs.join('\n') : 'no page errors');
await browser.close();
await stop();
