// Latency compensation for a remote player's shield.
//
// A guest sees the ball where it was `lag` seconds ago: half a round trip
// old when it left the host, plus the guest's own render buffer. When they
// put their shield in its path they are playing the ball they see. The host
// rewinds the ball by that lag and asks whether the shield, where the guest
// has it now, would have met the ball then; if so the host plays that
// contact and brings the ball forward again. Pure, so the tests can drive it.
import { circleVsCapsule } from './physics.js';

/** The most lag the host will honour: past this a connection is a problem, not a viewpoint. */
export const MAX_LAG = 0.35;

/**
 * Would the ball, at `past` ({x, y, vx, vy}), be meeting `fighter`'s shield
 * where the shield is now? Returns the contact (as circleVsCapsule gives it)
 * or null. Only a ball closing on the shield counts, as in the live physics.
 */
export function rewoundContact(past, fighter, radius) {
  const seg = fighter.paddleSegment();
  const h = circleVsCapsule(past.x, past.y, radius, seg.ax, seg.ay, seg.bx, seg.by, fighter.paddleThick, past.vx, past.vy);
  if (!h) return null;
  const sv = fighter.surfaceVelocityAt(h.cx, h.cy);
  const closing = (past.vx - sv.x) * h.nx + (past.vy - sv.y) * h.ny;
  return closing < 0 ? h : null;
}

/**
 * The lag the host should rewind for a guest who reports `lagMs`: their own
 * estimate of how far behind the host their view runs, clamped to what is
 * reasonable. Anything under a physics step or two is not worth rewinding.
 */
export function usableLag(lagMs) {
  const s = Math.max(0, Number(lagMs) || 0) / 1000;
  if (s < 0.02) return 0;
  return Math.min(MAX_LAG, s);
}
