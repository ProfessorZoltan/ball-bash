// Touch play, the sums only: what a thumb on the move stick means, and which
// way a drag from one of the right-hand pads points. DOM-free, so the tests
// hold it to its numbers; input.js reads the touches and asks these.
//
// The left thumb has a stick that sits wherever it lands. Tilted, it walks;
// pushed nearly all the way, it runs; pushed up (within 50 degrees of straight
// up), it jumps, and held up the jump goes higher, as a held button does;
// held down, it drops through a thin platform. The right thumb has the fire
// pad and the two wormhole pads: drag from one to aim (the blaster points the
// way the drag goes), and let go to fire or to open that end where the aim
// line lands. A tap does it along the aim as it is.

export const TOUCH = {
  stick: 64, // px: the move stick's reach
  dead: 0.2, // of the reach: a thumb resting on the stick does nothing
  run: 0.82, // of the reach: pushed this far, the robot runs
  lift: 0.5, // of the reach: pushed up this far, it jumps
  cone: Math.cos((50 * Math.PI) / 180), // how near straight up (or down) counts as up (or down)
  drop: 0.55, // of the reach: held down this far, it drops through a thin platform
  padDead: 14, // px a drag from a pad goes before it aims: less is a tap
};

/**
 * The move stick's thumb `dx`, `dy` px from where it landed: { mx, run, jump,
 * down }. `mx` is -1 to 1, past the dead zone; the rest are held or not.
 */
export function stickIntent(dx, dy, reach = TOUCH.stick) {
  const d = Math.hypot(dx, dy);
  const m = Math.min(1, d / reach);
  if (m < TOUCH.dead) return { mx: 0, run: false, jump: false, down: false };
  const ux = dx / d;
  const uy = dy / d;
  // Walking takes the push's sideways part, from nothing at the dead zone's edge to full at the reach.
  const along = Math.min(1, (m - TOUCH.dead) / (1 - TOUCH.dead) + 0.15) * ux;
  const mx = Math.abs(along) < 0.12 ? 0 : Math.max(-1, Math.min(1, along));
  return {
    mx,
    run: m >= TOUCH.run && Math.abs(ux) > 0.5,
    jump: m >= TOUCH.lift && -uy >= TOUCH.cone,
    down: m >= TOUCH.drop && uy >= TOUCH.cone,
  };
}

/** Which way a drag of `dx`, `dy` px from a pad points (radians, 0 right, down positive), or null while it is still a tap. */
export function padAim(dx, dy) {
  return Math.hypot(dx, dy) < TOUCH.padDead ? null : Math.atan2(dy, dx);
}
