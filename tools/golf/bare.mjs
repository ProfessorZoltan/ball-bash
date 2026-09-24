// node tools/golf/bare.mjs <hole id | draft.mjs> [T0 = 0] [T1 = 10] [dT = 1] [step° = 1]
// Bare launches over angles × launch moments: how they end, which wormhole pairs they reach, and every sink.
import { fly, holeArg, R } from './fly.mjs';
const [arg, T0 = '0', T1 = '10', dT = '1', stepS = '1'] = process.argv.slice(2);
const def = await holeArg(arg);
const ends = {};
const pairs = {};
const sinks = [];
let n = 0;
for (let T = Number(T0); T < Number(T1); T += Number(dT)) for (let a = -180; a < 180; a += Number(stepS)) {
  const r = fly(def, a * R, { launchAt: T });
  n++;
  ends[r.end] = (ends[r.end] || 0) + 1;
  for (const e of r.events) if (e.e === 'warp') pairs[e.pair] = (pairs[e.pair] || 0) + 1;
  if (r.end === 'cup') sinks.push(`${a}@${T}`);
}
console.log(`${n} flights ${JSON.stringify(ends)} warps by pair ${JSON.stringify(pairs)} sinks ${sinks.join(' ')}`);
