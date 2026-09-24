// node tools/golf/pin.mjs <hole id | draft.mjs> <launch°> <launch moment> '<pulses JSON>' [rel]
// Fly a route whose pulses are aimed as a player would ({at, a°} fixed, {at, a°} with `rel` relative to the
// travel, {at, toward: [x, y] | 'cup'}, {at, steer: [x, y] | 'cup'}); print the headings they were fired on,
// then fly those fixed headings a quarter degree and a frame either side.
import { fly, holeArg, R } from './fly.mjs';
const [arg, aS, TS, pl, relS] = process.argv.slice(2);
const def = await holeArg(arg);
const rel = relS === 'rel';
const pulses = JSON.parse(pl).map((p) => ({ at: p.at, a: (p.a || 0) * R, toward: p.toward, steer: p.steer }));
const r = fly(def, Number(aS) * R, { launchAt: Number(TS), pulses, rel });
const fixed = r.plan.map((p) => ({ at: p.at, a: Math.round(((p.used * 180) / Math.PI) * 10) / 10 }));
console.log(`${aS}° at ${TS} s: ${r.end} at ${r.t.toFixed(2)} s · pulses ${JSON.stringify(fixed)} · ${r.events.map((e) => `${e.e}@${e.t.toFixed(2)}`).join(' ')}`);
const F = 1 / 240;
const out = [];
for (const da of [-0.25, 0, 0.25]) for (const dT of [-F, 0, F]) {
  const T = Number(TS) + dT;
  if (T < 0) continue;
  const q = fly(def, (Number(aS) + da) * R, { launchAt: T, pulses: fixed.map((p) => ({ at: p.at, a: p.a * R })) });
  out.push(`${da}°/${Math.round(dT / F)}f:${q.end === 'cup' ? 'CUP' : q.end}`);
}
console.log(out.join(' '));
