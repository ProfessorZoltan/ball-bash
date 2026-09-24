// node tools/golf/plot.mjs <hole id | draft.mjs> <out.png> ['<flights JSON>']
// The hole as a plan, every field ring and moving part drawn, with flights over it:
//   [{ a: launch°, T: launch moment, rel, maxT, color, pulses: [{ at, a° } | { at, toward } | { at, steer }] }]
// A flight is coloured by how it ended (green cup, red maw, magenta horizon, orange out, grey spent) unless
// it names a colour, and one line per flight is printed: the end, time, bounces, top speed, closest pass, events.
import { chromium } from '../browser.mjs';
import { obstaclePoly } from '../../src/levels.js';
import { createGameState } from '../../src/gamestate.js';
import { fly, holeArg, R } from './fly.mjs';

const [arg, out, fl] = process.argv.slice(2);
if (!out) throw new Error('usage: plot.mjs <hole id | draft.mjs> <out.png> [flights JSON]');
const def = await holeArg(arg);
const flights = JSON.parse(fl || '[]');
const g = createGameState(def, {});
const box = def.area || { x: 0, y: 0, w: def.width, h: def.height };
const col = { cup: '#3f3', maw: '#f44', spent: '#888', out: '#fa0', horizon: '#f0f' };
const W = Math.min(1800, Math.max(900, box.w / 2));
const S = box.w / W;
const pts = (poly) => poly.map((p) => p.join(',')).join(' ');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.w} ${box.h}" width="${W}" style="background:#050810">`;
if (!def.open) svg += `<polygon points="${pts(def.boundary)}" fill="#0b1224" stroke="#8fd4ff" stroke-width="${2 * S}"/>`;
for (const o of def.obstacles) if (!o.glass) svg += `<polygon points="${pts(obstaclePoly(o))}" fill="#2a1a46" stroke="#c9a3ff" stroke-width="${1.5 * S}"/>`;
for (const p of g.panes) svg += `<polygon points="${pts(p.poly)}" fill="${p.color}" fill-opacity="0.35" stroke="${p.color}" stroke-width="${1.5 * S}"/>`;
for (const d of g.doors) svg += `<polygon points="${pts(d.poly)}" fill="#3a1a12" stroke="#ff9d6b" stroke-width="${1.5 * S}" ${d.closed ? '' : `stroke-dasharray="${4 * S} ${4 * S}"`}/>`;
for (const n of g.nodes) svg += `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="#0a0e1e" stroke="#7dffc4" stroke-width="${2 * S}"/>`;
for (const e of g.emitters) svg += `<circle cx="${e.x}" cy="${e.y}" r="${e.pulser.maxRadius}" fill="none" stroke="#ff8df0" stroke-opacity="0.4" stroke-dasharray="${3 * S} ${5 * S}" stroke-width="${S}"/><circle cx="${e.x}" cy="${e.y}" r="18" fill="none" stroke="#ff8df0" stroke-width="${2 * S}"/>`;
for (const w of g.wells) {
  const c = w.cup ? '#7dffc4' : w.fount ? '#fff1b8' : w.solid ? '#ffb347' : '#b49cff';
  svg += `<circle cx="${w.x}" cy="${w.y}" r="${w.range}" fill="none" stroke="${c}" stroke-opacity="0.35" stroke-dasharray="${6 * S} ${8 * S}" stroke-width="${S}"/>`;
  svg += `<circle cx="${w.x}" cy="${w.y}" r="${w.r}" fill="${w.solid ? c : '#000'}" fill-opacity="${w.solid ? (w.phasing ? 0.2 : 0.5) : 1}" stroke="${c}" stroke-width="${1.5 * S}" ${w.phasing ? `stroke-dasharray="${4 * S} ${3 * S}"` : ''}/>`;
  if (w.breath) svg += `<circle cx="${w.x}" cy="${w.y}" r="${w.range * 0.45}" fill="none" stroke="${c}" stroke-opacity="0.6" stroke-dasharray="${2 * S} ${4 * S}" stroke-width="${S}"/>`;
  if (w.rail) svg += `<circle cx="${w.rail.cx}" cy="${w.rail.cy}" r="${w.rail.R}" fill="none" stroke="${c}" stroke-opacity="0.5" stroke-dasharray="${2 * S} ${6 * S}" stroke-width="${S}"/>`;
}
for (const w of g.wormholes) {
  const c = w.color || '#ff8df0';
  if (w.flat) {
    for (const [x, y, f] of [[w.ax, w.ay, w.aAngle], [w.bx, w.by, w.bAngle]]) {
      const ux = -Math.sin(f) * w.half;
      const uy = Math.cos(f) * w.half;
      svg += `<line x1="${x - ux}" y1="${y - uy}" x2="${x + ux}" y2="${y + uy}" stroke="${c}" stroke-width="${5 * S}"/><line x1="${x}" y1="${y}" x2="${x + Math.cos(f) * 30}" y2="${y + Math.sin(f) * 30}" stroke="${c}" stroke-width="${2 * S}"/>`;
    }
    continue;
  }
  for (const o of [w.orbitA, w.orbitB]) if (o) svg += `<circle cx="${o.cx}" cy="${o.cy}" r="${o.R}" fill="none" stroke="${c}" stroke-opacity="0.5" stroke-dasharray="${2 * S} ${6 * S}" stroke-width="${S}"/>`;
  // The near mouth solid, the far one dashed.
  svg += `<circle cx="${w.ax}" cy="${w.ay}" r="${w.r}" fill="none" stroke="${c}" stroke-width="${2 * S}"/><circle cx="${w.bx}" cy="${w.by}" r="${w.r}" fill="none" stroke="${c}" stroke-width="${2 * S}" stroke-dasharray="${4 * S} ${3 * S}"/>`;
}
for (const m of g.movers) if (m.kind !== 'stone') for (const s of m.segments()) svg += `<line x1="${s.ax}" y1="${s.ay}" x2="${s.bx}" y2="${s.by}" stroke="#c9a3ff" stroke-width="${2 * (m.thick || 4)}"/>`;
svg += `<circle cx="${def.tee.x}" cy="${def.tee.y}" r="${14 * S}" fill="none" stroke="#8fd4ff" stroke-width="${2 * S}"/>`;
const res = [];
for (const f of flights) {
  const pulses = (f.pulses || []).map((p) => ({ at: p.at, a: (p.a || 0) * R, toward: p.toward, steer: p.steer }));
  const r = fly(def, f.a * R, { maxT: f.maxT, launchAt: f.T || 0, rel: !!f.rel, pulses, trace: true });
  res.push(`${f.a}@${f.T || 0}${f.pulses ? `+${f.pulses.length}p` : ''}: ${r.end} t${r.t.toFixed(2)} b${r.bounces} top${Math.round(r.topSpeed)} closest${Math.round(r.closest)} ${r.events.map((e) => `${e.e}@${e.t.toFixed(2)}${e.v ? `:${e.v}` : ''}`).join(' ')}`);
  let d = '';
  let pen = false;
  for (const pt of r.path) {
    if (!pt) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${pt[0].toFixed(0)},${pt[1].toFixed(0)} `;
    pen = true;
  }
  svg += `<path d="${d}" fill="none" stroke="${f.color || col[r.end]}" stroke-opacity="0.85" stroke-width="${1.5 * S}"/>`;
}
svg += '</svg>';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Math.round(W), height: Math.round((W * box.h) / box.w) } });
await p.setContent(`<body style="margin:0;background:#050810">${svg}</body>`);
await p.screenshot({ path: out });
await b.close();
if (res.length) console.log(res.join('\n'));
console.log(`wrote ${out}`);
