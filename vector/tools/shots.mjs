// Screenshots of Vector from the real game in headless Chromium: a few places
// along a level, its boss a few seconds in, the title screen, or a pair of
// wormholes seen through.
//
//   node vector/tools/shots.mjs level 4 out/     three views along level 4
//   node vector/tools/shots.mjs boss 4 out/      level 4's boss, 5 s into the fight
//   node vector/tools/shots.mjs portal 1 out/    a pair of ends opened, and the view through one
//   node vector/tools/shots.mjs title out/       the title screen
//   node vector/tools/shots.mjs compare 8 out/   a view of level 8 at High quality (shadows, bloom) and at Medium (neither)
//   node vector/tools/shots.mjs lens 6 out/      level 6's black holes, each from where its section starts, at High,
//                                                Medium (both bend the picture round it) and Low (which does not)
//   node vector/tools/shots.mjs secrets 4 out/   each of level 4's new secrets as a player first meets it: from where
//                                                its way starts, looking at what hides it
//   node vector/tools/shots.mjs routes 4 out/    each of level 4's risky ways from where it starts, looking at its door
//                                                or its prize
//   node vector/tools/shots.mjs puzzles 4 out/   each of level 4's puzzles of several steps from where its answer
//                                                starts, looking at the first thing it aims at
//   node vector/tools/shots.mjs rooms 4 out/     each of level 4's rooms from its doorway, and its set piece from
//                                                where it starts, looking in
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
  } else if (what === 'secrets' || what === 'routes') {
    const n = await page.evaluate(() => window.__vector.game.bp.detours.length);
    for (let i = 0; i < n; i++) {
      const kind = await page.evaluate(([k, routes]) => {
        const g = window.__vector.game;
        const d = g.bp.detours[k];
        if ((d.secret === false) !== routes) return null;
        if (routes) {
          // A risky way: its door, or else its prize.
          const sec = g.bp.sections.filter((s) => s.type === d.kind)[g.bp.detours.slice(0, k).filter((x) => x.kind === d.kind).length];
          const door = sec.door != null && g.world.solids.find((x) => x.door && x.door.id === sec.door);
          const mid = [(sec.from[0] + sec.to[0]) / 2, sec.from[1], (sec.from[2] + sec.to[2]) / 2];
          const far = (q) => Math.hypot(q.pos[0] - mid[0], q.pos[2] - mid[2]);
          const prize = g.pickups.filter((q) => q.route).sort((u, v) => far(u) - far(v))[0];
          const c = door ? [(door.min[0] + door.max[0]) / 2, (door.min[1] + door.max[1]) / 2, (door.min[2] + door.max[2]) / 2] : prize.pos;
          g.bot.spawn(d.start, d.yaw);
          g.bot.vel = [0, 0, 0];
          const e = g.bot.eyePos();
          const v = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
          g.bot.yaw = Math.atan2(v[0], v[2]);
          g.bot.pitch = Math.max(-0.5, Math.min(0.5, Math.atan2(v[1], Math.hypot(v[0], v[2]))));
          return d.kind;
        }
        const sec = g.bp.sections.filter((s) => s.type === d.kind)[g.bp.detours.slice(0, k).filter((x) => x.kind === d.kind).length];
        const id = sec.cover ?? sec.ghost ?? sec.crate;
        const s = id != null ? g.world.solids.find((x) => x.id === id) : g.world.solids.find((x) => x.door && x.door.id === sec.door);
        g.bot.spawn(d.start, d.yaw);
        g.bot.vel = [0, 0, 0];
        const e = g.bot.eyePos();
        const c = [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
        const v = [c[0] - e[0], c[1] - e[1], c[2] - e[2]];
        g.bot.yaw = Math.atan2(v[0], v[2]);
        g.bot.pitch = Math.max(-1.3, Math.min(1.3, Math.atan2(v[1], Math.hypot(v[0], v[2]))));
        return d.kind;
      }, [i, what === 'routes']);
      if (!kind) continue;
      await page.waitForTimeout(900);
      await shot(`${what === 'routes' ? 'route' : 'secret'}${id}-${i + 1}-${kind}.png`);
    }
  } else if (what === 'rooms') {
    const kinds = ['hall', 'yard', 'gallery', 'fold', 'wiretree', 'queue', 'pour', 'interchange', 'billboard', 'train', 'crane', 'chairlift', 'workbench'];
    const n = await page.evaluate((k) => window.__vector.game.bp.sections.filter((s) => k.includes(s.type)).length, kinds);
    for (let i = 0; i < n; i++) {
      const kind = await page.evaluate(([k, ks]) => {
        const g = window.__vector.game;
        const sec = g.bp.sections.filter((s) => ks.includes(s.type))[k];
        const d = [sec.to[0] - sec.from[0], sec.to[2] - sec.from[2]];
        const L = Math.hypot(...d);
        const f = [d[0] / L, d[1] / L];
        // A step back from its start, looking along it and up at what is tallest in it.
        g.bot.spawn([sec.from[0] - f[0] * 1.5, sec.from[1] + 0.91, sec.from[2] - f[1] * 1.5], Math.atan2(f[0], f[1]));
        g.bot.vel = [0, 0, 0];
        const up = sec.top || sec.up || 0;
        g.bot.pitch = Math.atan2(up * 0.6, Math.min(L, 24) * 0.6);
        return sec.type;
      }, [i, kinds]);
      await page.waitForTimeout(900);
      await shot(`room${id}-${i + 1}-${kind}.png`);
    }
  } else if (what === 'puzzles') {
    const kinds = ['fling', 'hoist', 'bend', 'relay', 'beam'];
    const n = await page.evaluate((k) => window.__vector.game.bp.sections.filter((s) => k.includes(s.type)).length, kinds);
    for (let i = 0; i < n; i++) {
      const kind = await page.evaluate(([k, ks]) => {
        const g = window.__vector.game;
        const sec = g.bp.sections.filter((s) => ks.includes(s.type))[k];
        // The first step of its answer that is taken standing somewhere and aiming at something.
        const st = g.bp.route.slice(sec.route[0], sec.route[1]).find((x) => x.from && (x.aims || x.at));
        const aim = st.aims ? st.aims.find((a) => a.solid != null) || st.aims[0] : null;
        let at = aim ? aim.at : st.at;
        if (!at) {
          const s = g.world.solids.find((x) => x.id === aim.solid);
          at = [(s.min[0] + s.max[0]) / 2, s.max[1], (s.min[2] + s.max[2]) / 2];
        }
        g.bot.spawn(st.from, 0);
        g.bot.vel = [0, 0, 0];
        const e = g.bot.eyePos();
        const v = [at[0] - e[0], at[1] - e[1], at[2] - e[2]];
        g.bot.yaw = Math.atan2(v[0], v[2]);
        g.bot.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(v[1], Math.hypot(v[0], v[2]))));
        return sec.type;
      }, [i, kinds]);
      await page.waitForTimeout(900);
      await shot(`puzzle${id}-${i + 1}-${kind}.png`);
    }
  } else if (what === 'lens') {
    const holes = await page.evaluate(() => window.__vector.game.world.wells.length);
    for (let i = 0; i < holes; i++) {
      // From somewhere on the way that sees the hole clear, 3.5 to 14 m off, with the level close behind it
      // (a bend shows in what it bends), looking a little to one side of it so the ring and the shadow both show.
      await page.evaluate((k) => {
        const g = window.__vector.game;
        const w = g.world.wells[k];
        let best = null;
        for (const s of g.bp.sections) {
          for (let t = 0; t <= 1; t += 0.05) {
            const f = [s.from[0] + (s.to[0] - s.from[0]) * t, s.from[1] + (s.to[1] - s.from[1]) * t, s.from[2] + (s.to[2] - s.from[2]) * t];
            const e = [f[0], f[1] + 1.52, f[2]];
            const d = [w.p[0] - e[0], w.p[1] - e[1], w.p[2] - e[2]];
            const L = Math.hypot(...d);
            const flat = Math.hypot(d[0], d[2]);
            if (flat < 3.5 || flat > 14) continue;
            const dir = d.map((v) => v / L);
            const hit = g.world.raycast(e, dir, L + 60, { glass: 'through' });
            if (hit && hit.t < L - w.horizon) continue;
            const behind = hit ? hit.t - L : 60;
            if (behind < 3) continue;
            if (!best || behind < best.behind) best = { f, behind };
          }
        }
        const f = best ? best.f : g.bp.sections[0].from;
        g.bot.spawn([f[0], f[1] + 0.91, f[2]], 0);
        g.bot.vel = [0, 0, 0];
        const e = g.bot.eyePos();
        const d = [w.p[0] - e[0], w.p[1] - e[1], w.p[2] - e[2]];
        g.bot.yaw = Math.atan2(d[0], d[2]) + 0.1;
        g.bot.pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      }, i);
      for (const q of ['high', 'medium', 'low']) {
        await page.evaluate((qq) => {
          const r = window.__vector.renderer;
          r.quality = qq;
          r.resize();
        }, q);
        await page.waitForTimeout(900);
        const info = await page.evaluate(() => window.__vector.renderer.info());
        console.log(`hole ${i + 1}`, q, JSON.stringify(info.drawn));
        await shot(`lens${id}-${i + 1}-${q}.png`);
      }
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
