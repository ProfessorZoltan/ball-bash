// A draft hole, to copy from: one body between the tee and the cup, and a maw
// behind the cup for any line that runs long. See draft.mjs.
import { farHole, planet, maw, cup, room, SCREEN } from './draft.mjs';

export const def = farHole({
  id: 'draft',
  hole: 19,
  par: 3,
  title: 'Draft',
  width: 3200,
  height: 1800,
  view: SCREEN,
  boundary: room(3200, 1800),
  tee: { x: 300, y: 900, angle: 0 },
  wells: [planet(1600, 900, { r: 70, range: 520, pull: 90000 }), maw(3000, 900)],
  cup: cup(2500, 600),
});
