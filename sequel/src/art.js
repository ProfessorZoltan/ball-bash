// Everything in Defector with a shape of its own, drawn in code: the robot,
// the enemies, the bosses, the scenery, the pickups and the signs. Each is a
// neon outline over a dark body, so it reads against any sky.
import { ROBOT, MOVE, POWERUPS, PICKUP } from './config.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

/** '#rrggbb' (or '#rgb') at an alpha, as an rgba() string. */
export function withAlpha(hex, a) {
  if (!hex || hex[0] !== '#') return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`;
}

function glow(ctx, color, blur, low) {
  if (low) return;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ------------------------------------------------------------------ robot

/**
 * A hover jet: a tapered flame from a nozzle at (x, y), `len` long, burning
 * `color` at `a`, bent `lean` px at its tip (it trails the way it is going).
 */
function jet(ctx, x, y, len, width, lean, color, a, low) {
  if (a <= 0.01) return;
  glow(ctx, withAlpha(color, a), 10, low);
  const g = ctx.createLinearGradient(x, y, x + lean, y + len);
  g.addColorStop(0, withAlpha('#ffffff', a));
  g.addColorStop(0.25, withAlpha(color, a));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - width, y);
  ctx.quadraticCurveTo(x - width * 0.6 + lean * 0.5, y + len * 0.6, x + lean, y + len);
  ctx.quadraticCurveTo(x + width * 0.6 + lean * 0.5, y + len * 0.6, x + width, y);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
}

/**
 * The Defector: a boxy robot fighter, visor lit, hovering a few px off the
 * ground on jets under its feet, legs a little bent; its blaster is on an
 * arm that turns all the way round. The jets burn one colour walking and
 * another running, and a jump throws a flare down from the pack. Flickers
 * while a lost shield's grace runs.
 */
export function drawRobot(ctx, b, t, alpha, o = {}) {
  // drawDX, drawDY: a multiplayer guest's correction to its own robot, fading out (netplay.js).
  const x = (b.warped ? b.x : lerp(b.prevX, b.x, alpha)) + (b.drawDX || 0);
  const y = (b.warped ? b.y : lerp(b.prevY, b.y, alpha)) + (b.drawDY || 0);
  if (b.invuln > 0 && b.invuln < 30 && Math.floor(t * 18) % 2 === 0) return;
  const col = o.color || ROBOT.color;
  const trim = o.trim || ROBOT.trim;
  const low = o.low;
  const face = Math.cos(b.aim) >= 0 ? 1 : -1;
  const squash = b.landed * 0.12;
  const onG = b.onGround;
  const speed = Math.abs(b.vx);
  const dir = Math.sign(b.vx) || b.facing;
  const walkK = Math.min(1, Math.max(0, (speed - 20) / 60));
  const runK = onG ? Math.min(1, Math.max(0, (speed - MOVE.walk - 5) / 40)) : 0;
  const bob = Math.sin(t * 3.4) * 1.2;
  // The jump's ring, spreading flat over the ground it left.
  if (b.flare > 0 && b.takeoff) {
    const k = 1 - b.flare;
    ctx.strokeStyle = withAlpha(trim, b.flare * 0.8);
    ctx.lineWidth = 2;
    glow(ctx, trim, 10, low);
    ctx.beginPath();
    ctx.ellipse(b.takeoff.x, b.takeoff.y, 10 + k * 40, 2 + k * 7, 0, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.save();
  ctx.translate(x, y + 30);
  ctx.scale(1 + squash, 1 - squash);
  ctx.translate(0, -30 + bob);
  // Legs: a little bent, the feet a few px off the ground over their jets; tucked up in the air.
  ctx.strokeStyle = col;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const feet = [];
  for (const side of [-1, 1]) {
    const trail = -dir * 2 * runK;
    let kx = side * 5 + face * 3 + trail * 0.5;
    let ky = 15.5;
    let fx = side * 5 + trail;
    let fy = 23;
    if (!onG) {
      kx = side * 6 + face * 4;
      ky = 14;
      fx = side * 6 - face;
      fy = b.vy > 0 ? 23 : 20;
    }
    glow(ctx, col, 8, low);
    ctx.beginPath();
    ctx.moveTo(side * 5, 8);
    ctx.lineTo(kx, ky);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.shadowBlur = 0;
    feet.push([fx, fy, side]);
  }
  // The jets: a low idle at a standstill, one colour walking, another running. In the air they only flicker.
  for (const [fx, fy, side] of feet) {
    const flick = 0.85 + 0.15 * Math.sin(t * 43 + side * 1.7);
    const a = onG ? 0.5 + 0.4 * Math.max(walkK, runK) : 0.3;
    const len = (onG ? 7 + 3 * walkK + 5 * runK : 6) * flick;
    const lean = -dir * (2 * walkK + 4 * runK);
    jet(ctx, fx, fy + 2, len, 3.2, lean, ROBOT.walkJet, a * (1 - runK), low);
    jet(ctx, fx, fy + 2, len, 3.6, lean, ROBOT.runJet, a * runK, low);
    if (onG) {
      // Their light on the floor under the robot.
      ctx.fillStyle = withAlpha(runK > 0.5 ? ROBOT.runJet : ROBOT.walkJet, a * 0.45);
      ctx.beginPath();
      ctx.ellipse(fx + lean, 30 - bob, 7 + 2 * runK, 1.6, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = trim;
    rr(ctx, fx - 5, fy - 1, 10, 4, 1.5);
    ctx.fill();
  }
  // The pack's flare: thrown down hard on a jump, and a flicker while it keeps rising.
  const px = -face * 20;
  const f = Math.max(b.flare, !onG && b.vy < -100 ? 0.18 : 0);
  if (f > 0) {
    const k = 1 - b.flare;
    jet(ctx, px, 5, (10 + 30 * f) * (0.9 + 0.1 * Math.sin(t * 50)), 2 + 3 * f, 0, trim, Math.min(1, f * 1.3), low);
    if (b.flare > 0) {
      // And a pulse off the nozzle, spreading as it drops away.
      ctx.strokeStyle = withAlpha(trim, b.flare);
      ctx.lineWidth = 1.5;
      glow(ctx, trim, 8, low);
      ctx.beginPath();
      ctx.ellipse(px, 8 + k * 16, 4 + k * 12, 1.5 + k * 3.5, 0, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
  // Body.
  rr(ctx, -14, -22, 28, 32, 6);
  ctx.fillStyle = '#0b1a2a';
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  glow(ctx, col, 12, low);
  ctx.stroke();
  ctx.shadowBlur = 0;
  // The pack on its back.
  rr(ctx, -face * 20 - 5, -18, 10, 22, 3);
  ctx.fillStyle = '#10243a';
  ctx.fill();
  ctx.strokeStyle = withAlpha(col, 0.7);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Chest light, in the colour of what is loaded.
  const pu = POWERUPS.find((p) => p.id === o.loaded);
  const chest = pu ? pu.color : trim;
  ctx.fillStyle = chest;
  glow(ctx, chest, 10, low);
  ctx.beginPath();
  ctx.arc(face * 3, -6, 3.5, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Head: a visor that looks where it aims.
  rr(ctx, -11, -36, 22, 15, 5);
  ctx.fillStyle = '#0b1a2a';
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = 2;
  ctx.stroke();
  const look = Math.sin(b.aim) * 2;
  ctx.fillStyle = '#e8fdff';
  glow(ctx, col, 10, low);
  ctx.fillRect(face > 0 ? -2 : -9, -31 + look, 11, 4);
  ctx.shadowBlur = 0;
  // Antenna.
  ctx.strokeStyle = withAlpha(col, 0.8);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-face * 5, -36);
  ctx.lineTo(-face * 8, -46);
  ctx.stroke();
  ctx.fillStyle = Math.sin(t * 4) > 0 ? trim : '#ffffff';
  ctx.beginPath();
  ctx.arc(-face * 8, -47, 2.2, 0, TAU);
  ctx.fill();
  ctx.restore();
  // Arm and blaster, drawn unsquashed from the shoulder along the aim.
  ctx.save();
  ctx.translate(x, y + ROBOT.shoulder + bob);
  ctx.rotate(b.aim);
  ctx.strokeStyle = col;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(12, 0);
  ctx.stroke();
  const flip = Math.cos(b.aim) < 0 ? -1 : 1;
  ctx.scale(1, flip);
  rr(ctx, 8, -5, 22, 10, 3);
  ctx.fillStyle = '#132b40';
  ctx.fill();
  ctx.strokeStyle = trim;
  ctx.lineWidth = 2;
  glow(ctx, trim, 8, low);
  ctx.stroke();
  ctx.fillRect(12, 5, 5, 6);
  ctx.shadowBlur = 0;
  ctx.fillStyle = o.charging ? withAlpha(chest, 0.35) : chest;
  glow(ctx, chest, 14, low);
  ctx.beginPath();
  ctx.arc(31, 0, 3.5, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
  // Versus: held fast in a block of ice by a Frost charge.
  if (o.frozen > 0) {
    ctx.save();
    ctx.fillStyle = withAlpha('#8fdcff', 0.28);
    ctx.strokeStyle = withAlpha('#e6fbff', 0.8);
    ctx.lineWidth = 2;
    glow(ctx, '#8fdcff', 12, low);
    rr(ctx, x - 26, y - 52, 52, 84, 6);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------- enemies

export function drawEnemy(ctx, e, t, alpha, low) {
  const x = lerp(e.prevX, e.x, alpha);
  const y = lerp(e.prevY, e.y, alpha);
  const r = e.r;
  const col = e.flash > 0 ? '#ffffff' : e.color;
  const dir = e.vx < -5 ? -1 : e.vx > 5 ? 1 : e.dir || 1;
  const tt = t + e.id * 0.37;
  if (e.folded && !e.frozen) {
    // Folded: only half here. Two faint copies, pulled apart, and a dashed outline that will not settle.
    const split = 3 + Math.sin(tt * 3) * 2;
    for (const [dx, c2] of [[-split, '#ff4fd8'], [split, '#5ce1ff']]) {
      ctx.save();
      ctx.translate(x + dx, y);
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 2;
      ctx.strokeStyle = c2;
      ctx.fillStyle = 'rgba(0,0,0,0)';
      enemyBody(ctx, e, r, c2, dir, tt);
      ctx.restore();
    }
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = col;
  ctx.fillStyle = '#12091c';
  if (e.folded && !e.frozen) {
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -tt * 20;
    ctx.globalAlpha = 0.85 + 0.15 * Math.sin(tt * 7);
    ctx.fillStyle = 'rgba(40, 20, 70, 0.55)';
  }
  glow(ctx, col, 10, low);
  enemyBody(ctx, e, r, col, dir, tt);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.restore();
  // Shield: a Deflector shield, bright, in front.
  const s = e.shieldSegment ? e.shieldSegment() : null;
  if (s && !e.frozen) {
    ctx.strokeStyle = '#e8fdff';
    ctx.lineWidth = s.thick * 2;
    ctx.lineCap = 'round';
    glow(ctx, e.color, 16, low);
    ctx.beginPath();
    ctx.moveTo(s.ax + (x - e.x), s.ay + (y - e.y));
    ctx.lineTo(s.bx + (x - e.x), s.by + (y - e.y));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineCap = 'butt';
  }
  // Toughness pips over anything that takes more than one hit.
  if (e.maxHp > 1 && e.hp < e.maxHp) {
    const w = Math.min(40, e.maxHp * 6);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - w / 2, y - r - 12, w, 4);
    ctx.fillStyle = e.color;
    ctx.fillRect(x - w / 2, y - r - 12, (w * e.hp) / e.maxHp, 4);
  }
  if (e.frozen) {
    const blk = e.ice;
    const thaw = e.frozen < 1 && Math.floor(t * 12) % 2 === 0;
    ctx.fillStyle = thaw ? 'rgba(200, 240, 255, 0.25)' : 'rgba(170, 225, 255, 0.45)';
    ctx.strokeStyle = '#dff6ff';
    ctx.lineWidth = 2;
    if (blk) {
      ctx.fillRect(blk.x0, blk.y0, blk.x1 - blk.x0, blk.y1 - blk.y0);
      ctx.strokeRect(blk.x0, blk.y0, blk.x1 - blk.x0, blk.y1 - blk.y0);
      ctx.beginPath();
      ctx.moveTo(blk.x0 + 6, blk.y0 + 6);
      ctx.lineTo(blk.x0 + 16, blk.y0 + 18);
      ctx.moveTo(blk.x1 - 10, blk.y0 + 4);
      ctx.lineTo(blk.x1 - 4, blk.y0 + 14);
      ctx.stroke();
    }
  }
}

/** An enemy's own shape, drawn about the origin (drawEnemy has moved there). */
function enemyBody(ctx, e, r, col, dir, tt) {
  const look = e.k.look;
  switch (look) {
    case 'beetle': {
      ctx.beginPath();
      ctx.ellipse(0, r * 0.1, r, r * 0.8, 0, Math.PI, TAU);
      ctx.lineTo(r, r * 0.4);
      ctx.lineTo(-r, r * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7);
      ctx.lineTo(0, r * 0.2);
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        const k = Math.sin(tt * 14 + i * 2) * 3;
        ctx.beginPath();
        ctx.moveTo(i * r * 0.5, r * 0.4);
        ctx.lineTo(i * r * 0.6 + k, r);
        ctx.stroke();
      }
      eye(ctx, dir * r * 0.75, -r * 0.1, r * 0.18);
      break;
    }
    case 'burr': {
      ctx.beginPath();
      const n = 10;
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * TAU + tt * (e.move === 'fly' ? 0.8 : 3) * dir;
        const rad = i % 2 ? r * 0.65 : r * 1.1;
        ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      eye(ctx, dir * r * 0.2, -r * 0.1, r * 0.2);
      break;
    }
    case 'hound': {
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.3);
      ctx.lineTo(-r * 0.8, -r * 0.4);
      ctx.lineTo(r * 0.5, -r * 0.5);
      ctx.lineTo(r * 1.1, -r * 0.1);
      ctx.lineTo(r * 1.1 * 0.9, r * 0.3);
      ctx.closePath();
      ctx.scale(dir, 1);
      ctx.fill();
      ctx.stroke();
      for (const lx of [-0.6, 0.6]) {
        const k = Math.sin(tt * 20 + lx * 3) * r * 0.35;
        ctx.beginPath();
        ctx.moveTo(lx * r, r * 0.3);
        ctx.lineTo(lx * r + k, r);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-r, -r * 0.2);
      ctx.lineTo(-r * 1.5, -r * 0.6 + Math.sin(tt * 10) * 4);
      ctx.stroke();
      eye(ctx, r * 0.7, -r * 0.2, r * 0.16);
      break;
    }
    case 'jelly': {
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI, TAU);
      ctx.quadraticCurveTo(r * 0.5, r * 0.3, 0, r * 0.15);
      ctx.quadraticCurveTo(-r * 0.5, r * 0.3, -r, 0);
      ctx.fill();
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * r * 0.35, r * 0.1);
        ctx.quadraticCurveTo(i * r * 0.35 + Math.sin(tt * 3 + i) * 6, r * 0.8, i * r * 0.4, r * 1.4);
        ctx.stroke();
      }
      eye(ctx, -r * 0.3, -r * 0.35, r * 0.13);
      eye(ctx, r * 0.3, -r * 0.35, r * 0.13);
      break;
    }
    case 'moth': {
      const flap = Math.abs(Math.sin(tt * 16));
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(s * r * 0.8, -r * 0.1, r * 0.9, r * (0.35 + flap * 0.5), s * 0.5, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.3, r * 0.75, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      if (e.kind === 'moth') {
        ctx.fillStyle = '#fff1b8';
        ctx.beginPath();
        ctx.arc(0, r * 0.4, r * 0.25, 0, TAU);
        ctx.fill();
      }
      eye(ctx, 0, -r * 0.45, r * 0.14);
      break;
    }
    case 'kite': {
      const swoop = e.swoop ? 1 : 0;
      const fold = swoop ? 0.5 : 1 + Math.sin(tt * 6) * 0.2;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.6);
      ctx.lineTo(r * 1.4 * fold, -r * 0.1);
      ctx.lineTo(0, r * 0.7);
      ctx.lineTo(-r * 1.4 * fold, -r * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, r * 0.7);
      ctx.quadraticCurveTo(Math.sin(tt * 5) * 8, r * 1.3, 0, r * 1.8);
      ctx.stroke();
      eye(ctx, -r * 0.25, -r * 0.1, r * 0.14);
      eye(ctx, r * 0.25, -r * 0.1, r * 0.14);
      break;
    }
    case 'frog': {
      const air = !e.onGround;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.15, r, r * (air ? 0.75 : 0.65), 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.45, -r * 0.45, r * 0.3, 0, TAU);
        ctx.fill();
        ctx.stroke();
        eye(ctx, s * r * 0.45, -r * 0.45, r * 0.14);
        ctx.beginPath();
        ctx.moveTo(s * r * 0.6, r * 0.6);
        ctx.lineTo(s * r * (air ? 1.2 : 0.9), r * (air ? 1.2 : 0.8));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.15);
      ctx.quadraticCurveTo(0, r * 0.45, r * 0.4, r * 0.15);
      ctx.stroke();
      break;
    }
    case 'turret': {
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI, TAU);
      ctx.lineTo(r, r * 0.9);
      ctx.lineTo(-r, r * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      const a = e.aimAngle ?? -Math.PI / 2;
      ctx.save();
      ctx.rotate(Math.atan2(Math.sin(a), Math.cos(a)));
      ctx.fillRect(r * 0.3, -4, r * 0.9, 8);
      ctx.strokeRect(r * 0.3, -4, r * 0.9, 8);
      ctx.restore();
      eye(ctx, 0, -r * 0.3, r * 0.2);
      break;
    }
    case 'wraith': {
      // A veil that trails, with two lights for eyes.
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r, Math.PI, TAU);
      for (let i = 0; i <= 6; i++) ctx.lineTo(r - (i * 2 * r) / 6, r * 0.7 + Math.sin(tt * 6 + i) * r * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      eye(ctx, -r * 0.35, -r * 0.3, r * 0.16);
      eye(ctx, r * 0.35, -r * 0.3, r * 0.16);
      break;
    }
    case 'knight': {
      rr(ctx, -r * 0.8, -r, r * 1.6, r * 1.9, r * 0.4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, -r * 0.2);
      ctx.lineTo(r * 0.8, -r * 0.2);
      ctx.stroke();
      eye(ctx, dir * r * 0.3, -r * 0.5, r * 0.15);
      break;
    }
    case 'saucer': {
      ctx.beginPath();
      ctx.ellipse(0, r * 0.1, r * 1.2, r * 0.4, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, Math.PI, TAU);
      ctx.fill();
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        ctx.fillStyle = Math.sin(tt * 8 + i) > 0 ? '#ffffff' : col;
        ctx.fillRect(i * r * 0.6 - 2, r * 0.25, 4, 4);
      }
      eye(ctx, 0, -r * 0.2, r * 0.15);
      break;
    }
    case 'crab': {
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      for (const s of [-1, 1]) {
        const snap = Math.sin(tt * 9 + s) * 0.3;
        ctx.beginPath();
        ctx.arc(s * r * 1.15, -r * 0.35, r * 0.35, s > 0 ? -0.6 + snap : Math.PI - 0.6 - snap, s > 0 ? 2.4 + snap : Math.PI + 2.4 - snap);
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(s * r * (0.3 + i * 0.25), r * 0.4);
          ctx.lineTo(s * r * (0.5 + i * 0.3), r * 0.95 + Math.sin(tt * 18 + i) * 2);
          ctx.stroke();
        }
      }
      eye(ctx, -r * 0.3, -r * 0.55, r * 0.14);
      eye(ctx, r * 0.3, -r * 0.55, r * 0.14);
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      eye(ctx, dir * r * 0.3, -r * 0.2, r * 0.18);
    }
  }
}

function eye(ctx, x, y, r) {
  const f = ctx.fillStyle;
  const sb = ctx.shadowBlur;
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(x + r * 0.25, y, r * 0.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f;
  ctx.shadowBlur = sb;
}

// ------------------------------------------------------------------ bosses

/**
 * A boss is drawn from its parts first, so what can be hit is always what
 * you see: plates bright, armour dark and hard-edged, the core glowing.
 * Each then gets its own dressing on top.
 */
export function drawBoss(ctx, b, t, alpha, phase, low) {
  const dx = lerp(b.prevX, b.x, alpha) - b.x + (b.shake ? (Math.random() - 0.5) * b.shake * 2 : 0);
  const dy = lerp(b.prevY, b.y, alpha) - b.y + (b.shake ? (Math.random() - 0.5) * b.shake * 2 : 0);
  const col = b.flash > 0 ? '#ffffff' : b.color;
  const chill = b.chill > 0;
  ctx.save();
  ctx.translate(dx, dy);
  if (phase === 'intro') ctx.globalAlpha = 0.4 + 0.6 * Math.min(1, t % 1);
  dressBehind(ctx, b, t, col, low);
  for (const p of b.parts) {
    if (p.type === 'armor') {
      ctx.fillStyle = '#0d0f1c';
      ctx.strokeStyle = withAlpha('#b9c4e8', 0.85);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = withAlpha('#b9c4e8', 0.25);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.65, 0, TAU);
      ctx.stroke();
    }
  }
  for (const p of b.parts) {
    if (p.type !== 'core') continue;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, col);
    g.addColorStop(1, withAlpha(col, 0.35));
    ctx.fillStyle = g;
    glow(ctx, col, 26, low);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = chill ? '#8fdcff' : '#ffffff';
    ctx.lineWidth = chill ? 4 : 2;
    ctx.stroke();
  }
  for (const p of b.parts) {
    if (p.type !== 'plate') continue;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = p.thick * 2;
    ctx.lineCap = 'round';
    glow(ctx, b.color, 18, low);
    ctx.beginPath();
    ctx.moveTo(p.seg.ax, p.seg.ay);
    ctx.lineTo(p.seg.bx, p.seg.by);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = p.thick * 0.8;
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  dressFront(ctx, b, t, col, low);
  ctx.restore();
}

function dressBehind(ctx, b, t, col, low) {
  switch (b.id) {
    case 'gardener': {
      // A mower: a hull round the core, wheels, and grass flung out behind.
      const r = b.r;
      ctx.fillStyle = '#0f2208';
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      glow(ctx, col, 12, low);
      rr(ctx, b.x - r * 1.3, b.y - r * 0.7, r * 2.6, r * 1.3, 14);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(b.x + s * r * 0.9, b.y + r * 0.65, r * 0.35, 0, TAU);
        ctx.fillStyle = '#081004';
        ctx.fill();
        ctx.stroke();
        const a = (b.x / (r * 0.35)) * (b.dir || 1);
        ctx.beginPath();
        ctx.moveTo(b.x + s * r * 0.9, b.y + r * 0.65);
        ctx.lineTo(b.x + s * r * 0.9 + Math.cos(a) * r * 0.3, b.y + r * 0.65 + Math.sin(a) * r * 0.3);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(b.x - (b.dir || 1) * r * 1.1, b.y - r * 0.6);
      ctx.lineTo(b.x - (b.dir || 1) * r * 1.8, b.y - r * 1.5);
      ctx.stroke();
      break;
    }
    case 'moth': {
      const flap = Math.abs(Math.sin(t * 7));
      for (const s of [-1, 1]) {
        ctx.fillStyle = withAlpha('#3a2a08', 0.9);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        glow(ctx, col, 14, low);
        ctx.beginPath();
        ctx.ellipse(b.x + s * b.r * 1.5, b.y - b.r * 0.2, b.r * 1.6, b.r * (0.6 + flap * 0.7), s * 0.5, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = withAlpha('#ffb347', 0.7);
        ctx.beginPath();
        ctx.arc(b.x + s * b.r * 1.6, b.y - b.r * 0.3, b.r * 0.35, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'conductor': {
      ctx.fillStyle = '#1c1204';
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      glow(ctx, col, 12, low);
      rr(ctx, b.x - 120, b.y - 42, 240, 84, 18);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = withAlpha('#ffe6b0', 0.8);
      for (let i = -3; i <= 3; i++) if (i !== 0) ctx.fillRect(b.x + i * 30 - 9, b.y - 28, 18, 16);
      ctx.strokeStyle = withAlpha('#ffffff', 0.3);
      ctx.beginPath();
      ctx.moveTo(b.A.x0, b.y - 60);
      ctx.lineTo(b.A.x1, b.y - 60);
      ctx.stroke();
      break;
    }
    case 'keeper': {
      ctx.fillStyle = '#081820';
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      glow(ctx, col, 10, low);
      ctx.beginPath();
      ctx.moveTo(b.x - 40, b.y + 60);
      ctx.lineTo(b.x - 66, b.A.floor);
      ctx.lineTo(b.x + 66, b.A.floor);
      ctx.lineTo(b.x + 40, b.y + 60);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = withAlpha('#ff9df5', 0.6);
      for (let y = b.y + 100; y < b.A.floor; y += 60) {
        ctx.beginPath();
        ctx.moveTo(b.x - 60, y);
        ctx.lineTo(b.x + 60, y + 20);
        ctx.stroke();
      }
      break;
    }
    case 'bloom': {
      ctx.strokeStyle = '#7dff9a';
      ctx.lineWidth = 10;
      glow(ctx, '#7dff9a', 12, low);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + 40);
      ctx.bezierCurveTo(b.x - 40, b.y + 180, b.x + 40, b.y + 300, b.x, b.A.floor);
      ctx.stroke();
      ctx.shadowBlur = 0;
      for (const s of [-1, 1]) {
        ctx.fillStyle = withAlpha('#1f6b2e', 0.9);
        ctx.beginPath();
        ctx.ellipse(b.x + s * 60, b.y + 260, 70, 22, s * 0.5, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'astronomer': {
      ctx.strokeStyle = withAlpha(col, 0.35);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 10]);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2.2, t, t + TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case 'ringmaster': {
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y + b.r + 18, 18, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.r);
      ctx.lineTo(b.x, b.y + b.r + 18);
      ctx.stroke();
      break;
    }
    case 'angler': {
      // The stalk from the head to the lure.
      ctx.strokeStyle = withAlpha('#aef6ff', 0.6);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.bodyX + b.face * 40, b.bodyY - 50);
      ctx.quadraticCurveTo(b.bodyX + b.face * 90, b.bodyY - 120, b.x, b.y);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.shadowBlur = 0;
}

function dressFront(ctx, b, t, col, low) {
  switch (b.id) {
    case 'gardener': {
      eye(ctx, b.x + (b.dir || 1) * b.r * 0.35, b.y - b.r * 0.2, 8);
      break;
    }
    case 'angler': {
      // Teeth and an eye on the body, which is all armour.
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i++) {
        const x = b.bodyX + b.face * (30 + i * 6);
        ctx.beginPath();
        ctx.moveTo(x, b.bodyY + 14);
        ctx.lineTo(x + 3 * b.face, b.bodyY + 26);
        ctx.lineTo(x + 6 * b.face, b.bodyY + 14);
        ctx.fill();
      }
      eye(ctx, b.bodyX + b.face * 24, b.bodyY - 22, 9);
      break;
    }
    case 'ringmaster': {
      ctx.fillStyle = '#12061c';
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.fillRect(b.x - 22, b.y - b.r - 44, 44, 40);
      ctx.strokeRect(b.x - 22, b.y - b.r - 44, 44, 40);
      ctx.fillRect(b.x - 34, b.y - b.r - 6, 68, 8);
      ctx.strokeRect(b.x - 34, b.y - b.r - 6, 68, 8);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(b.x - 22, b.y - b.r - 16, 44, 6);
      break;
    }
    case 'cartographer': {
      ctx.strokeStyle = withAlpha('#ffffff', 0.7);
      ctx.lineWidth = 1.2;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(b.x + i * 12, b.y - b.r * 0.8);
        ctx.lineTo(b.x + i * 12 + 6, b.y + b.r * 0.8);
        ctx.stroke();
      }
      break;
    }
    case 'administrator': {
      ctx.strokeStyle = withAlpha('#ffffff', 0.5);
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(t * (0.5 + i * 0.3) * (i % 2 ? -1 : 1));
        ctx.strokeRect(-b.r * (0.5 + i * 0.15), -b.r * (0.5 + i * 0.15), b.r * (1 + i * 0.3), b.r * (1 + i * 0.3));
        ctx.restore();
      }
      break;
    }
    default:
      break;
  }
}

// ----------------------------------------------------------------- scenery

/** A prop standing on the floor at (x, y): each theme's trees, lamps, stalls and oddities. */
export function drawProp(ctx, d, th, t, front) {
  const s = d.s * (front ? 1.1 : 1);
  const x = d.x;
  const y = d.y;
  const col = th.edge;
  const col2 = th.edge2;
  const acc = th.accent;
  const sway = Math.sin(t * 0.9 + d.seed) * 3;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.globalAlpha = front ? 0.55 : 0.8;
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(col, 0.8);
  ctx.fillStyle = withAlpha('#000000', 0.35);
  switch (d.kind) {
    case 'tree': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -60);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sway, -90, 34, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = withAlpha(col, 0.35);
      ctx.beginPath();
      ctx.moveTo(sway - 20, -90);
      ctx.lineTo(sway, -110);
      ctx.lineTo(sway + 20, -90);
      ctx.moveTo(sway, -110);
      ctx.lineTo(sway, -60);
      ctx.stroke();
      ctx.fillStyle = acc;
      for (let i = 0; i < 4; i++) {
        const a = d.seed + i * 1.7;
        ctx.beginPath();
        ctx.arc(sway + Math.cos(a) * 22, -90 + Math.sin(a) * 20, 4, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'bush': {
      ctx.beginPath();
      ctx.arc(-14, -14, 16, Math.PI, TAU);
      ctx.arc(8, -18, 20, Math.PI, TAU);
      ctx.arc(26, -12, 13, Math.PI, TAU);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'lamp': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -110);
      ctx.lineTo(18, -118);
      ctx.stroke();
      const g = ctx.createRadialGradient(18, -112, 0, 18, -112, 50);
      g.addColorStop(0, withAlpha(acc, 0.6));
      g.addColorStop(1, withAlpha(acc, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(18, -112, 50, 0, TAU);
      ctx.fill();
      ctx.fillStyle = acc;
      ctx.fillRect(12, -116, 12, 6);
      break;
    }
    case 'fence': {
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 14, 0);
        ctx.lineTo(i * 14, -30);
        ctx.lineTo(i * 14 + 4, -36);
        ctx.lineTo(i * 14 + 8, -30);
        ctx.lineTo(i * 14 + 8, 0);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-4, -20);
      ctx.lineTo(70, -20);
      ctx.stroke();
      break;
    }
    case 'house': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -60);
      ctx.lineTo(40, -95);
      ctx.lineTo(80, -60);
      ctx.lineTo(80, 0);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = withAlpha(acc, 0.8);
      ctx.fillRect(14, -48, 16, 16);
      ctx.fillRect(50, -48, 16, 16);
      ctx.strokeRect(34, -30, 14, 30);
      break;
    }
    case 'lantern': {
      ctx.beginPath();
      ctx.moveTo(-40, -150);
      ctx.quadraticCurveTo(0, -120, 40, -150);
      ctx.stroke();
      for (let i = -1; i <= 1; i++) {
        const lx = i * 24;
        const ly = -128 + Math.abs(i) * -6 + sway * 0.5;
        ctx.fillStyle = withAlpha(i ? col2 : acc, 0.85);
        ctx.beginPath();
        ctx.ellipse(lx, ly, 8, 11, 0, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'awning': {
      ctx.strokeRect(-40, -70, 80, 70);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = withAlpha(i % 2 ? col : col2, 0.7);
        ctx.beginPath();
        ctx.moveTo(-44 + i * 18, -90);
        ctx.lineTo(-26 + i * 18, -90);
        ctx.lineTo(-26 + i * 18, -76);
        ctx.quadraticCurveTo(-35 + i * 18, -68, -44 + i * 18, -76);
        ctx.fill();
      }
      ctx.fillStyle = withAlpha(acc, 0.6);
      ctx.fillRect(-30, -50, 60, 12);
      break;
    }
    case 'sign': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -70);
      ctx.stroke();
      ctx.strokeStyle = col2;
      ctx.lineWidth = 3;
      ctx.strokeRect(-30, -110, 60, 36);
      ctx.fillStyle = withAlpha(col2, 0.25 + 0.2 * Math.sin(t * 3 + d.seed));
      ctx.fillRect(-30, -110, 60, 36);
      ctx.fillStyle = withAlpha('#ffffff', 0.8);
      ctx.fillRect(-20, -96, 40, 4);
      break;
    }
    case 'vending': {
      ctx.fillRect(-18, -70, 36, 70);
      ctx.strokeRect(-18, -70, 36, 70);
      ctx.fillStyle = withAlpha(acc, 0.7);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ctx.fillRect(-14 + j * 14, -62 + i * 14, 10, 8);
      break;
    }
    case 'pylon': {
      ctx.beginPath();
      ctx.moveTo(-20, 0);
      ctx.lineTo(0, -170);
      ctx.lineTo(20, 0);
      ctx.moveTo(-30, -130);
      ctx.lineTo(30, -130);
      ctx.moveTo(-24, -100);
      ctx.lineTo(24, -100);
      ctx.moveTo(-14, -60);
      ctx.lineTo(10, -100);
      ctx.stroke();
      break;
    }
    case 'bench': {
      ctx.strokeRect(-30, -22, 60, 6);
      ctx.beginPath();
      ctx.moveTo(-24, -16);
      ctx.lineTo(-24, 0);
      ctx.moveTo(24, -16);
      ctx.lineTo(24, 0);
      ctx.moveTo(-30, -24);
      ctx.lineTo(-30, -40);
      ctx.lineTo(30, -40);
      ctx.stroke();
      break;
    }
    case 'rail': {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        ctx.moveTo(i * 16, 0);
        ctx.lineTo(i * 16, -26);
      }
      ctx.moveTo(-4, -26);
      ctx.lineTo(84, -26);
      ctx.stroke();
      break;
    }
    case 'palm': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(10, -70, sway, -130);
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.6;
        ctx.beginPath();
        ctx.moveTo(sway, -130);
        ctx.quadraticCurveTo(sway + Math.cos(a) * 40, -130 + Math.sin(a) * 40 - 10, sway + Math.cos(a) * 60, -130 + Math.sin(a) * 30 + 20);
        ctx.stroke();
      }
      break;
    }
    case 'shell': {
      ctx.beginPath();
      ctx.arc(0, -12, 14, Math.PI, TAU);
      ctx.fill();
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, -2);
        ctx.lineTo(i * 6, -24);
        ctx.stroke();
      }
      break;
    }
    case 'buoy': {
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(-8, -40);
      ctx.lineTo(8, -40);
      ctx.lineTo(14, 0);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = Math.sin(t * 2 + d.seed) > 0.6 ? '#ff5c7a' : withAlpha('#ff5c7a', 0.3);
      ctx.beginPath();
      ctx.arc(0, -46, 5, 0, TAU);
      ctx.fill();
      break;
    }
    case 'rock': {
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(-18, -22);
      ctx.lineTo(4, -30);
      ctx.lineTo(24, -14);
      ctx.lineTo(28, 0);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'mushroom': {
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-6, -60);
      ctx.lineTo(6, -60);
      ctx.lineTo(6, 0);
      ctx.stroke();
      ctx.fillStyle = withAlpha(col2, 0.55);
      ctx.beginPath();
      ctx.ellipse(sway * 0.5, -64, 40, 22, 0, Math.PI, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(sway * 0.5 + i * 16, -74 + Math.abs(i) * 4, 4, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'flower': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-10, -40, sway, -80);
      ctx.stroke();
      ctx.fillStyle = withAlpha(col2, 0.7);
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 + t * 0.3;
        ctx.beginPath();
        ctx.ellipse(sway + Math.cos(a) * 12, -80 + Math.sin(a) * 12, 10, 5, a, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = acc;
      ctx.beginPath();
      ctx.arc(sway, -80, 6, 0, TAU);
      ctx.fill();
      break;
    }
    case 'fern': {
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(i * 14, -40, i * 26 + sway, -50 + Math.abs(i) * 12);
        ctx.stroke();
      }
      break;
    }
    case 'sprinkler': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -14);
      ctx.stroke();
      ctx.strokeStyle = withAlpha('#aef6ff', 0.5);
      const a = Math.sin(t * 2 + d.seed) * 0.8;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.quadraticCurveTo(Math.sin(a) * 40, -60 - i * 6, Math.sin(a) * 70 + i * 6, -10);
        ctx.stroke();
      }
      break;
    }
    case 'telescope': {
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(0, -40);
      ctx.lineTo(14, 0);
      ctx.stroke();
      ctx.save();
      ctx.translate(0, -40);
      ctx.rotate(-0.7 + Math.sin(t * 0.2 + d.seed) * 0.2);
      ctx.fillRect(-10, -6, 60, 12);
      ctx.strokeRect(-10, -6, 60, 12);
      ctx.restore();
      break;
    }
    case 'dish': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -40);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -56, 34, 16, -0.4, 0, Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -56);
      ctx.lineTo(10, -80);
      ctx.stroke();
      break;
    }
    case 'crystal': {
      ctx.fillStyle = withAlpha(col2, 0.3);
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-14, -30);
      ctx.lineTo(-2, -58);
      ctx.lineTo(10, -34);
      ctx.lineTo(8, 0);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'tent': {
      ctx.beginPath();
      ctx.moveTo(-50, 0);
      ctx.lineTo(-50, -40);
      ctx.lineTo(0, -90);
      ctx.lineTo(50, -40);
      ctx.lineTo(50, 0);
      ctx.fill();
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        ctx.strokeStyle = withAlpha(i % 2 ? col : col2, 0.7);
        ctx.beginPath();
        ctx.moveTo(0, -90);
        ctx.lineTo(i * 25, -40);
        ctx.stroke();
      }
      ctx.fillStyle = acc;
      ctx.beginPath();
      ctx.moveTo(0, -90);
      ctx.lineTo(0, -110);
      ctx.lineTo(16, -104);
      ctx.lineTo(0, -98);
      ctx.fill();
      break;
    }
    case 'balloon': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(sway * 2, -40, sway, -90);
      ctx.stroke();
      ctx.fillStyle = withAlpha(d.seed % 2 ? col2 : acc, 0.7);
      ctx.beginPath();
      ctx.ellipse(sway, -110, 16, 20, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'booth': {
      ctx.fillRect(-36, -60, 72, 60);
      ctx.strokeRect(-36, -60, 72, 60);
      ctx.fillStyle = withAlpha(acc, 0.7);
      ctx.fillRect(-36, -76, 72, 16);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = Math.sin(t * 5 + i + d.seed) > 0 ? '#ffffff' : acc;
        ctx.beginPath();
        ctx.arc(-27 + i * 18, -68, 3, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'kelp': {
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 10, 0);
        for (let yy = 0; yy < 140; yy += 14) ctx.lineTo(k * 10 + Math.sin(yy * 0.06 + t + d.seed + k) * 10, -yy);
        ctx.stroke();
      }
      break;
    }
    case 'coral': {
      ctx.strokeStyle = withAlpha(col2, 0.8);
      const branch = (bx, by, a, len, depth) => {
        if (depth === 0) return;
        const ex = bx + Math.cos(a) * len;
        const ey = by + Math.sin(a) * len;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        branch(ex, ey, a - 0.45, len * 0.7, depth - 1);
        branch(ex, ey, a + 0.45, len * 0.7, depth - 1);
      };
      branch(0, 0, -Math.PI / 2, 26, 4);
      break;
    }
    case 'cable': {
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-60, 0);
      ctx.quadraticCurveTo(0, -30, 60, 0);
      ctx.stroke();
      ctx.fillStyle = Math.sin(t * 3 + d.seed) > 0 ? col : withAlpha(col, 0.2);
      ctx.beginPath();
      ctx.arc(0, -15, 4, 0, TAU);
      ctx.fill();
      break;
    }
    case 'vent': {
      ctx.strokeRect(-14, -12, 28, 12);
      ctx.fillStyle = withAlpha('#aef6ff', 0.4);
      for (let i = 0; i < 4; i++) {
        const yy = -12 - ((t * 40 + i * 20 + d.seed) % 80);
        ctx.beginPath();
        ctx.arc(Math.sin(yy * 0.1) * 5, yy, 3, 0, TAU);
        ctx.fill();
      }
      break;
    }
    case 'tower': {
      ctx.fillRect(-24, -150, 48, 150);
      ctx.strokeRect(-24, -150, 48, 150);
      ctx.fillStyle = withAlpha(acc, 0.6);
      for (let yy = -140; yy < -10; yy += 18) for (let xx = -18; xx < 18; xx += 12) if ((xx + yy + d.seed) % 3) ctx.fillRect(xx, yy, 6, 8);
      break;
    }
    case 'monolith': {
      ctx.fillStyle = '#000000';
      ctx.fillRect(-14, -120, 28, 120);
      ctx.strokeStyle = withAlpha('#ffffff', 0.6);
      ctx.strokeRect(-14, -120, 28, 120);
      ctx.fillStyle = withAlpha(col2, 0.5 + 0.4 * Math.sin(t * 2 + d.seed));
      ctx.fillRect(-2, -100, 4, 70);
      break;
    }
    case 'totem': {
      for (let i = 0; i < 3; i++) {
        ctx.strokeRect(-16, -30 - i * 30, 32, 28);
        eye(ctx, -6, -18 - i * 30, 3);
        eye(ctx, 6, -18 - i * 30, 3);
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

// ----------------------------------------------------------------- things

export function drawPickup(ctx, p, t, low) {
  const bob = Math.sin(p.t * 3) * PICKUP.bob;
  const x = p.x;
  const y = p.y + bob;
  if (p.kind === 'shield') {
    ctx.strokeStyle = PICKUP.shield;
    ctx.lineWidth = 3;
    glow(ctx, PICKUP.shield, 16, low);
    ctx.beginPath();
    ctx.moveTo(x, y - 16);
    ctx.lineTo(x + 13, y - 9);
    ctx.lineTo(x + 11, y + 6);
    ctx.lineTo(x, y + 16);
    ctx.lineTo(x - 11, y + 6);
    ctx.lineTo(x - 13, y - 9);
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = withAlpha(PICKUP.shield, 0.3);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 14px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+', x, y);
    return;
  }
  const pu = POWERUPS.find((q) => q.id === p.kind);
  if (!pu) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(p.t) * 0.2);
  ctx.strokeStyle = pu.color;
  ctx.lineWidth = 2.5;
  glow(ctx, pu.color, 18, low);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) ctx.lineTo(Math.cos((i * TAU) / 6) * PICKUP.r, Math.sin((i * TAU) / 6) * PICKUP.r);
  ctx.closePath();
  ctx.fillStyle = withAlpha(pu.color, 0.22);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 16px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pu.glyph, 0, 1);
  ctx.restore();
}

export function drawCheckpoint(ctx, c, th, t) {
  const on = c.on;
  const col = on ? '#9dff5c' : withAlpha('#ffffff', 0.5);
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y + 40);
  ctx.lineTo(c.x, c.y - 60);
  ctx.stroke();
  ctx.fillStyle = on ? withAlpha('#9dff5c', 0.7) : withAlpha('#ffffff', 0.25);
  ctx.beginPath();
  const wave = Math.sin(t * 4) * (on ? 5 : 2);
  ctx.moveTo(c.x, c.y - 60);
  ctx.quadraticCurveTo(c.x + 20, c.y - 56 + wave, c.x + 38, c.y - 50);
  ctx.lineTo(c.x, c.y - 36);
  ctx.fill();
  if (on) {
    const g = ctx.createRadialGradient(c.x, c.y - 50, 0, c.x, c.y - 50, 60);
    g.addColorStop(0, 'rgba(157,255,92,0.35)');
    g.addColorStop(1, 'rgba(157,255,92,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y - 50, 60, 0, TAU);
    ctx.fill();
  }
}

/** A sign on a post: the keyboard's words, or the controller's. */
export function drawSign(ctx, sg, th, device, bot) {
  const text = typeof sg.text === 'string' ? sg.text : device === 'pad' ? sg.text.pad : device === 'keys' ? sg.text.keys || sg.text.kb : sg.text.kb;
  const near = Math.abs(bot.x - sg.x) < 420;
  ctx.font = '600 14px Inter, sans-serif';
  const lines = wrap(ctx, text, 250);
  const h = lines.length * 18 + 16;
  const w = 270;
  const x = sg.x - w / 2;
  const y = sg.y - 90 - h;
  ctx.strokeStyle = withAlpha(th.edge, 0.8);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sg.x, sg.y);
  ctx.lineTo(sg.x, y + h);
  ctx.stroke();
  ctx.globalAlpha = near ? 1 : 0.55;
  ctx.fillStyle = 'rgba(4, 8, 20, 0.85)';
  rr(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = th.edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e8f4ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, sg.x, y + 9 + i * 18));
  ctx.globalAlpha = 1;
}

function wrap(ctx, text, width) {
  const words = text.split(' ');
  const out = [];
  let line = '';
  for (const w of words) {
    const tryLine = line ? `${line} ${w}` : w;
    if (ctx.measureText(tryLine).width > width && line) {
      out.push(line);
      line = w;
    } else line = tryLine;
  }
  if (line) out.push(line);
  return out;
}

export function drawExit(ctx, ex, t) {
  const g = ctx.createRadialGradient(ex.x, ex.y - 40, 0, ex.x, ex.y - 40, 120);
  g.addColorStop(0, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(ex.x, ex.y - 40, 120, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  for (let i = 0; i < 3; i++) {
    const r = 20 + ((t * 40 + i * 20) % 60);
    ctx.globalAlpha = 1 - r / 80;
    ctx.beginPath();
    ctx.ellipse(ex.x, ex.y - 40, r * 0.6, r, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 14px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('EXIT', ex.x, ex.y - 120);
}
