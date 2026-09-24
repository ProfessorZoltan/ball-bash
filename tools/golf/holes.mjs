// node tools/golf/holes.mjs <hole ids, comma-separated, or outer | far> [out dir = .]
// Screenshots from the real game: the course page, and for each hole its brief (<id>-brief.png)
// and the bare hole the P key shows (<id>-map.png). For checking a new hole's text, labels and look.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, serve, watchErrors } from '../browser.mjs';
import { COURSES } from '../../src/golf.js';

const [which, dir = '.'] = process.argv.slice(2);
if (!which) throw new Error('usage: holes.mjs <f13,f14 | outer | far> [out dir]');
const ids = COURSES[which] ? COURSES[which].holes.map((h) => h.id) : which.split(',');
mkdirSync(dir, { recursive: true });
const server = await serve();
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 860 } });
const errs = [];
watchErrors(p, errs);
await p.goto(server.url, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
await p.click('#btn-golf');
await p.waitForTimeout(400);
const course = COURSES[which] ? which : ids[0][0] === 'f' ? 'far' : 'outer';
await p.click(`.course-tabs [data-course="${course}"]`);
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(dir, `${course}-course.png`) });
for (const id of ids) {
  await p.evaluate(([i, c]) => window.__game.startGolf(i, c), [Number(id.slice(1)) - 1, id[0] === 'f' ? 'far' : 'outer']);
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(dir, `${id}-brief.png`) });
  // P clears the brief and play starts; a second P is the bare map.
  await p.keyboard.press('p');
  await p.waitForTimeout(400);
  await p.keyboard.press('p');
  await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(dir, `${id}-map.png`) });
}
console.log(`${ids.length} holes to ${dir}`);
console.log(errs.length ? errs.join('\n') : 'no page errors');
await b.close();
server.stop();
