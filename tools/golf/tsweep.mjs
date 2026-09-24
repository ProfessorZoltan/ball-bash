// node tools/golf/tsweep.mjs <hole id | draft.mjs> <degrees, comma-separated> [T0 = 0] [T1 = 9] [dT = 0.05]
// For fixed launch lines, the launch moments that sink bare (for holes with moving parts).
import { fly, holeArg, R } from './fly.mjs';
const [arg, degs, T0 = '0', T1 = '9', dT = '0.05'] = process.argv.slice(2);
const def = await holeArg(arg);
for (const d of degs.split(',').map(Number)) {
  const hits = [];
  for (let T = Number(T0); T < Number(T1); T += Number(dT)) if (fly(def, d * R, { launchAt: T }).end === 'cup') hits.push(T.toFixed(2));
  console.log(`${d}°: ${hits.length} moments sink: ${hits.join(' ')}`);
}
