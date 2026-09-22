// Latency compensation for a remote player's shield.
//
// A guest sees the ball where it was some time ago: half a round trip old
// when it left the host, plus the guest's own render buffer. When they put
// their shield in its path they are playing the ball they see. Every input a
// guest sends says which host time its view was showing, so the host knows
// exactly how far back that ball was: it rewinds the ball to then and asks
// whether the shield, where the guest has it now, would have met it; if so
// the host plays that contact and brings the ball forward again. Pure, so the
// tests can drive it.
import { circleVsCapsule } from './physics.js';

/** The most lag the host will honour: past this a connection is a problem, not a viewpoint. */
export const MAX_LAG = 0.4;

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
 * How far back to rewind for a guest whose view showed host time `vt` (null
 * when they asked for no compensation): now minus that, or 0 when it is too
 * little to matter, from the future (a new round's clock), or further back
 * than the host will honour. Never clamped: a rewind to a moment the guest
 * did not see would be a guess.
 */
export function viewLag(now, vt) {
  if (vt == null || !Number.isFinite(vt)) return 0;
  const lag = now - vt;
  if (!(lag >= 0.02) || lag > MAX_LAG) return 0;
  return lag;
}
