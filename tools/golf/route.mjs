// node tools/golf/route.mjs <hole id> <launch°> <launch moment> '<pulses JSON: [{ at, a° }]>' [out prefix]
// Fly a route in the real game in a headless browser, the way a player would: aim, wait for the moment,
// launch, and fire each pulse on its heading when the flight clock reaches it. Prints how the flight ended
// and when each pulse actually went (a frame late at most), and with a prefix saves <prefix>-start.png
// and <prefix>-end.png. The harness (fly.mjs) and the browser should agree; this is how to check they do.
import { chromium, serve, watchErrors } from '../browser.mjs';

const [id, aS, TS = '0', pl = '[]', prefix] = process.argv.slice(2);
if (!/^[gf]\d+$/.test(id || '') || aS === undefined) throw new Error("usage: route.mjs <g1…g18 | f1…f18> <launch°> [moment] ['[{\"at\":1,\"a\":90}]'] [out prefix]");
const route = { course: id[0] === 'f' ? 'far' : 'outer', idx: Number(id.slice(1)) - 1, angle: Number(aS), T: Number(TS), pulses: JSON.parse(pl) };
const server = await serve();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
const errs = [];
watchErrors(p, errs);
await p.goto(server.url, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__game);
await p.evaluate(([i, c]) => window.__game.startGolf(i, c), [route.idx, route.course]);
await p.waitForTimeout(700);
// The brief is up; P clears it and play starts.
await p.keyboard.press('p');
await p.waitForTimeout(300);
if (prefix) await p.screenshot({ path: `${prefix}-start.png` });
const res = await p.evaluate(async (r) => {
  const G = window.__game;
  const g = G.game;
  const frame = () => new Promise((ok) => requestAnimationFrame(ok));
  const aim = () => (g.player.angle = (r.angle * Math.PI) / 180);
  aim();
  while (g.mouthTime < r.T - 0.02) {
    aim();
    await frame();
  }
  aim();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
  const launchedAt = g.mouthTime;
  for (let k = 0; k < 6 && g.golf.phase !== 'flight'; k++) await frame();
  window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space' }));
  const fired = [];
  for (const pl of r.pulses) {
    while (g.golf.phase === 'flight' && g.golf.flightTime < pl.at - 0.008) await frame();
    g.golf.heading = (pl.a * Math.PI) / 180;
    G.golfPulse();
    fired.push(+g.golf.flightTime.toFixed(3));
  }
  const t0 = performance.now();
  while (g.golf.phase === 'flight' && performance.now() - t0 < 90000) await frame();
  return { hole: `${g.def.id} ${g.def.title}`, phase: g.golf.phase, launchedAt: +launchedAt.toFixed(3), fired, flight: +g.golf.flightTime.toFixed(2), fuelLeft: g.golf.fuel };
}, route);
await p.waitForTimeout(700);
if (prefix) await p.screenshot({ path: `${prefix}-end.png` });
console.log(JSON.stringify(res));
// The hole's clock starts when it opens, and the brief takes a moment to clear.
if (res.launchedAt > route.T + 0.05) console.log(`launched at ${res.launchedAt} s, not ${route.T}: on a hole with moving parts, give a later moment`);
console.log(errs.length ? errs.join('\n') : 'no page errors');
await b.close();
server.stop();
