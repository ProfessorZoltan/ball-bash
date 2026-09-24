// node tools/golf/sweep.mjs <hole id | draft.mjs> [step° = 2] [launch moments, comma-separated = 0]
// Bare launches round the whole circle: how each ends, and which sink.
import { fly, holeArg, R } from './fly.mjs';
const [arg, stepS = '2', atS = '0'] = process.argv.slice(2);
const def = await holeArg(arg);
const step = Number(stepS);
let total = 0;
let sunk = 0;
for (const T of atS.split(',').map(Number)) {
  const sinks = [];
  const ends = {};
  for (let deg = -180; deg < 180; deg += step) {
    const r = fly(def, deg * R, { launchAt: T });
    ends[r.end] = (ends[r.end] || 0) + 1;
    total++;
    if (r.end === 'cup') {
      sinks.push(`${deg.toFixed(2)}(${r.t.toFixed(1)}s)`);
      sunk++;
    }
  }
  console.log(`T=${T}: ${JSON.stringify(ends)} sinks: ${sinks.join(' ')}`);
}
console.log(`bare share ${((100 * sunk) / total).toFixed(2)}% (${sunk}/${total})`);
