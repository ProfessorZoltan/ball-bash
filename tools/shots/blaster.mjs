// node tools/shots/blaster.mjs [arena = Event Horizon] [out dir = .]
// Staged screenshots of a Blaster match with the Wormhole Variant: three players (Ann hosts, Bo and Cy
// join) in three headless pages on the LAN relay, each fighter's two wormhole ends placed by plan, then
// everyone fires and the frame freezes as Ann's shot comes out of her dark end. Writes
//   <arena>-set.png            the ends placed, everyone facing where the plan says
//   <arena>-through-host.png   and -through-bo, -through-cy: the shot through the wormhole, from each seat
//   lobby.png                  with LOBBY=1: the host's lobby before the start
//   <arena>-straddle-*.png     with STRADDLE=<slot>: that fighter halfway through its own wormhole
//
// The plan (PLAN, JSON; built in for Event Horizon and Trefoil) is in arena coordinates, by slot
// (a Ann, c Bo, d Cy):
//   { ends: [[slot, [x, y] light end aimed at, [x, y] dark end aimed at]],
//     facing: [[slot, x, y]], fire: [slots] }
// Each end is shot where the fighter faces, so an end lands on the first wall along that line.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, serve, watchErrors } from '../browser.mjs';

const PLANS = {
  'Event Horizon': { ends: [['a', [320, 0], [1100, 900]], ['c', [1000, 0], [1600, 230]], ['d', [1400, 900], [600, 0]]], facing: [['a', 320, 0], ['c', 320, 450], ['d', 1200, 230]], fire: ['a', 'c', 'd'] },
  Trefoil: { ends: [['a', [670, 395], [1300, 860]], ['c', [930, 395], [1600, 500]], ['d', [800, 0], [800, 620]]], facing: [['a', 670, 395], ['c', 512, 634], ['d', 512, 634]], fire: ['a', 'c', 'd'] },
};
const [ARENA = 'Event Horizon', dir = '.'] = process.argv.slice(2);
const PLAN = process.env.PLAN ? JSON.parse(process.env.PLAN) : PLANS[ARENA];
if (!PLAN) throw new Error(`no plan for ${ARENA}: set PLAN (built in: ${Object.keys(PLANS).join(', ')})`);
const tag = ARENA.replace(/\W+/g, '').toLowerCase();
const shot = (name) => path.join(dir, name);
mkdirSync(dir, { recursive: true });

const server = await serve();
const b = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const errs = [];
const open = async (who) => {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  watchErrors(p, errs, `${who}: `);
  // Headless reads as a slow machine, and the automatic quality would drop the glow.
  await p.addInitScript(() => {
    try {
      localStorage.setItem('deflector.quality', 'high');
    } catch {}
  });
  await p.goto(`${server.url}?relay=local`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  return p;
};
const host = await open('Ann');
const guests = [await open('Bo'), await open('Cy')];
await host.click('#btn-multi');
for (const g of guests) await g.click('#btn-multi');
await host.fill('#mp-name', 'Ann');
await host.click('#mp-host');
await host.waitForSelector('.mp-code');
const code = (await host.textContent('.mp-code')).trim();
for (const [i, name] of ['Bo', 'Cy'].entries()) {
  await guests[i].fill('#mp-name', name);
  await guests[i].fill('input[maxlength="4"]', code);
  await guests[i].click('#mp-join');
  await host.waitForTimeout(700);
}
await host.waitForSelector('#mp-start');
await host.waitForTimeout(600);
await host.selectOption('#mp-mode', 'volley'); // Blaster's internal name
await host.check('#mp-wormholes');
const arenas = await host.evaluate(() => [...document.querySelectorAll('#mp-level option')].map((o) => [o.value, o.textContent]));
const pick = arenas.find((a) => a[1].includes(ARENA));
if (!pick) throw new Error(`no arena ${ARENA}: ${arenas.map((a) => a[1]).join(', ')}`);
await host.selectOption('#mp-level', pick[0]);
await host.waitForTimeout(400);
if (process.env.LOBBY) await host.screenshot({ path: shot('lobby.png') });
await host.click('#mp-start');
const pages = { a: host, c: guests[0], d: guests[1] };
for (const p of Object.values(pages)) await p.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 20000 });
// No turrets, and nobody sent back to the middle for standing still while the stage is set.
await host.evaluate(() => {
  const g = window.__game.game;
  g.turrets.length = 0;
  setInterval(() => {
    for (const f of g.fighters) f.campTimer = 0;
  }, 300);
});
// The FPS and ping readout: three players on one headless machine drop frames a real screen would not.
for (const p of Object.values(pages)) await p.addStyleTag({ content: '#hud-fps { visibility: hidden; }' });
// Freezing: hold back the next animation frame so the canvas keeps the last one drawn.
for (const p of Object.values(pages)) {
  await p.evaluate(() => {
    const orig = window.requestAnimationFrame.bind(window);
    window.__origRaf = orig;
    window.requestAnimationFrame = (cb) => {
      if (window.__freeze) {
        window.__held = cb;
        return 0;
      }
      return orig(cb);
    };
  });
}
const freeze = async () => {
  for (const p of Object.values(pages)) await p.evaluate(() => (window.__freeze = true));
};
const thaw = async () => {
  for (const p of Object.values(pages)) {
    await p.evaluate(() => {
      window.__freeze = false;
      if (window.__held) {
        const cb = window.__held;
        window.__held = null;
        window.__origRaf(cb);
      }
    });
  }
};
const info = await host.evaluate(() => window.__game.game.fighters.map((f) => ({ slot: f.slot, at: [Math.round(f.x), Math.round(f.y)] })));
console.log('fighters', JSON.stringify(info));
const at = Object.fromEntries(info.map((f) => [f.slot, f.at]));
// Face a fighter on the host (the authority) and on its own page, then tap a key there.
const face = async (slot, deg) => {
  for (const p of [host, pages[slot]]) {
    await p.evaluate(([slot, deg]) => {
      const f = window.__game.game.fighters.find((x) => x.slot === slot);
      f.angle = (deg * Math.PI) / 180;
      f.omega = 0;
    }, [slot, deg]);
  }
};
const tap = async (slot, key) => {
  const p = pages[slot];
  await p.keyboard.down(key);
  await p.waitForTimeout(80);
  await p.keyboard.up(key);
  await p.waitForTimeout(250);
};
const aim = (slot, x, y) => (Math.atan2(y - at[slot][1], x - at[slot][0]) * 180) / Math.PI;
for (const [slot, light, dark] of PLAN.ends) {
  await face(slot, aim(slot, ...light));
  await tap(slot, 'q');
  await face(slot, aim(slot, ...dark));
  await tap(slot, 'e');
}
const ends = await host.evaluate(() => Object.fromEntries(Object.entries(window.__game.game.portals || {}).map(([k, pr]) => [k, pr.map((q) => (q ? [Math.round(q.cx), Math.round(q.cy)] : null))])));
console.log('ends', JSON.stringify(ends));
for (const [slot, x, y] of PLAN.facing) await face(slot, aim(slot, x, y));
await host.waitForTimeout(900);
await host.screenshot({ path: shot(`${tag}-set.png`) });
// A fighter halfway through its own wormhole: drawn going in at one end and coming out of the other.
// Before the shot, since a hit can end the round.
if (process.env.STRADDLE) {
  const slot = process.env.STRADDLE;
  const home = await host.evaluate((slot) => {
    const f = window.__game.game.fighters.find((x) => x.slot === slot);
    return [f.x, f.y, f.angle];
  }, slot);
  await host.evaluate((slot) => {
    const g = window.__game.game;
    const f = g.fighters.find((x) => x.slot === slot);
    const p = g.portals[slot][0];
    f.x = f.prevX = p.cx + p.nx * 4;
    f.y = f.prevY = p.cy + p.ny * 4;
    f.vx = f.vy = 0;
    f.angle = Math.atan2(-p.ny, -p.nx) + 0.6;
    f.lastMouth = null;
  }, slot);
  await host.waitForTimeout(350);
  await freeze();
  await host.screenshot({ path: shot(`${tag}-straddle-host.png`) });
  await pages[slot].screenshot({ path: shot(`${tag}-straddle-${slot}.png`) });
  await thaw();
  await host.waitForTimeout(600);
  await host.evaluate(([slot, x, y, a]) => {
    const f = window.__game.game.fighters.find((q) => q.slot === slot);
    f.x = f.prevX = x;
    f.y = f.prevY = y;
    f.vx = f.vy = 0;
    f.angle = a;
  }, [slot, ...home]);
  await host.waitForTimeout(900);
}
// The shot: freeze when Ann's charge has come out of her dark end, heading away from it.
await host.evaluate(() => {
  window.__watch = setInterval(() => {
    const g = window.__game.game;
    const pr = g.portals && g.portals.a;
    if (!pr || !pr[1]) return;
    const s = g.shots.find((x) => x.owner === 'a' && Math.hypot(x.x - pr[1].cx, x.y - pr[1].cy) < 90 && x.vx * pr[1].nx + x.vy * pr[1].ny > 0);
    if (s) {
      window.__freeze = true;
      clearInterval(window.__watch);
      window.__caught = { x: Math.round(s.x), y: Math.round(s.y) };
    }
  }, 2);
});
for (const [slot, x, y] of PLAN.facing) await face(slot, aim(slot, x, y));
const fire = async (slot) => {
  const p = pages[slot];
  await p.keyboard.down(' ');
  await p.waitForTimeout(60);
  await p.keyboard.up(' ');
};
await Promise.all(PLAN.fire.map(fire));
await host.waitForFunction(() => window.__caught, null, { timeout: 4000 }).catch(() => {});
await freeze();
const caught = await host.evaluate(() => window.__caught || null);
console.log(caught ? `caught Ann's shot at ${caught.x},${caught.y}` : "Ann's shot never came out of her dark end: the frames show wherever it got to");
await host.screenshot({ path: shot(`${tag}-through-host.png`) });
await pages.c.screenshot({ path: shot(`${tag}-through-bo.png`) });
await pages.d.screenshot({ path: shot(`${tag}-through-cy.png`) });
await thaw();
console.log(errs.length ? errs.join('\n') : 'no page errors');
await b.close();
server.stop();
