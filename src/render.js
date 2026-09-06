// Canvas 2D renderer. Neon-on-dark look with a slight 2.5D extrusion on the
// walls to give the "slightly off-centre top-down" feel.
import { BALL } from './config.js';
import { clamp, lerp } from './vec.js';

const WALL_HEIGHT = 9; // px of extrusion under each wall face

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
    this.level = null;
    this.staticLayer = null;
  }

  setLevel(level) {
    this.level = level;
    this.staticLayer = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const lw = this.level ? this.level.width : 1600;
    const lh = this.level ? this.level.height : 900;
    const scale = Math.min(w / lw, h / lh);
    this.view = { scale, ox: (w - lw * scale) / 2, oy: (h - lh * scale) / 2, w, h, dpr };
    this.staticLayer = null;
  }

  /**
   * Floor, obstacles and the glowing boundary never change during a level, and
   * their glow (shadowBlur) is the most expensive thing to draw, so render them
   * once into an offscreen canvas and blit it every frame.
   */
  buildStaticLayer() {
    const v = this.view;
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#03050c';
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, v.ox * v.dpr, v.oy * v.dpr);
    const live = this.ctx;
    this.ctx = ctx;
    this.drawFloor(this.level);
    const orbit = this.level.boss && this.level.boss.orbit;
    if (orbit) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(orbit.cx, orbit.cy, orbit.rx, orbit.ry, 0, 0, Math.PI * 2);
      ctx.setLineDash([4, 12]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.stroke();
      ctx.restore();
    }
    this.drawObstacles(this.level);
    this.drawBoundary(this.level);
    this.ctx = live;
    this.staticLayer = off;
  }

  screenToWorld(sx, sy) {
    const v = this.view;
    return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale };
  }

  draw(game, state, time, joystick = null) {
    const ctx = this.ctx;
    const v = this.view;
    const level = this.level;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!level || !game) {
      ctx.fillStyle = '#03050c';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    let shx = 0;
    let shy = 0;
    if (game.fx.shake > 0) {
      shx = (Math.random() - 0.5) * game.fx.shake;
      shy = (Math.random() - 0.5) * game.fx.shake;
    }
    if (!this.staticLayer) this.buildStaticLayer();
    if (shx || shy) {
      ctx.fillStyle = '#03050c';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.drawImage(this.staticLayer, shx * v.dpr, shy * v.dpr);
    ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, (v.ox + shx) * v.dpr, (v.oy + shy) * v.dpr);

    this.drawPredictedPath(game);
    if (game.panes && game.panes.length) this.drawGlass(game.panes, game, time);
    if (game.ice) this.drawIce(game.ice, level.palette.ice || '#cdf6ff', time);
    for (const m of game.movers || []) this.drawMover(m, level.palette.obstacle);
    this.drawRings(game.fx);
    this.drawFighter(game.boss, time, level.palette.obstacle);
    this.drawFighter(game.player, time, level.palette.wall);
    this.drawBall(game.ball, state);
    this.drawParticles(game.fx);

    if (game.fx.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(game.fx.flash, 0, 1) * 0.6})`;
      ctx.fillRect(-50, -50, level.width + 100, level.height + 100);
    }

    if (joystick && joystick.active) this.drawJoystick(joystick, level.palette.wall);
  }

  /** Jukebox visual: a beat-pulsing ring and a 16-step lamp row. */
  drawJukebox(ph, palette, time) {
    const ctx = this.ctx;
    const v = this.view;
    const a = (palette && palette.wall) || '#7fe9ff';
    const b = (palette && palette.obstacle) || '#ffb347';
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.fillStyle = (palette && palette.floor) || '#03050c';
    ctx.fillRect(0, 0, v.w, v.h);
    if (!ph) return;
    const cx = v.w / 2;
    const cy = v.h / 2;
    const kick = Math.max(0, 1 - ph.kickAge / 0.35);
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 4; i++) {
      const r = 140 + i * 90 + kick * 30 * (1 - i * 0.2);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 2 + kick * 3;
      ctx.strokeStyle = i % 2 ? b : a;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 20 * kick;
      ctx.stroke();
    }
    ctx.restore();
    // Step lamps along the bottom.
    const w = Math.min(v.w - 80, 720);
    const x0 = cx - w / 2;
    const y = v.h - 48;
    for (let i = 0; i < 16; i++) {
      const lit = i === ph.s16;
      ctx.beginPath();
      ctx.arc(x0 + (i + 0.5) * (w / 16), y, lit ? 9 : 5, 0, Math.PI * 2);
      ctx.fillStyle = lit ? '#ffffff' : i % 4 === 0 ? a : 'rgba(255,255,255,0.18)';
      ctx.shadowColor = a;
      ctx.shadowBlur = lit ? 18 : 0;
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  /** Touch joystick, drawn in screen space on top of everything. */
  drawJoystick(j, color) {
    const ctx = this.ctx;
    const v = this.view;
    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(j.ox, j.oy, j.radius, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(j.ox, j.oy);
    ctx.lineTo(j.ox + j.dx, j.oy + j.dy);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(j.ox + j.dx, j.oy + j.dy, 22, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.restore();
  }

  drawFloor(level) {
    const ctx = this.ctx;
    const p = level.palette;
    ctx.save();
    ctx.beginPath();
    polyPath(ctx, level.boundary);
    ctx.clip();
    const g = ctx.createRadialGradient(level.width / 2, level.height / 2, 80, level.width / 2, level.height / 2, level.width * 0.7);
    g.addColorStop(0, '#0c1428');
    g.addColorStop(1, p.floor);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, level.width, level.height);
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= level.width; x += 50) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, level.height);
    }
    for (let y = 0; y <= level.height; y += 50) {
      ctx.moveTo(0, y);
      ctx.lineTo(level.width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawBoundary(level) {
    const ctx = this.ctx;
    const p = level.palette;
    // Thick dark rim outside the play area, then the neon edge.
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.beginPath();
    polyPath(ctx, level.boundary);
    ctx.lineWidth = 26;
    ctx.strokeStyle = p.wallDark;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.wall;
    ctx.shadowColor = p.wall;
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.restore();
  }

  drawObstacles(level) {
    const ctx = this.ctx;
    const p = level.palette;
    const height = level.extrude ?? WALL_HEIGHT;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const o of level.obstacles) {
      if (o.glass) continue; // glass is dynamic; drawn every frame
      const poly = Array.isArray(o) ? o : o.poly;
      // Side faces (extrusion) first.
      ctx.fillStyle = p.obstacleDark;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(b[0], b[1] + height);
        ctx.lineTo(a[0], a[1] + height);
        ctx.closePath();
        ctx.fill();
      }
      // Top face.
      ctx.beginPath();
      polyPath(ctx, poly);
      ctx.fillStyle = p.obstacleFill || '#1a1206';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = p.obstacle;
      ctx.shadowColor = p.obstacle;
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  /** Stained-glass panes: translucent when whole, a faint frame when broken. */
  drawGlass(panes, game, time) {
    const ctx = this.ctx;
    const glass = game.def.glass;
    const hot = glass && game.ball.speed >= glass.breakSpeed;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const pane of panes) {
      ctx.beginPath();
      polyPath(ctx, pane.poly);
      if (pane.broken) {
        const left = Math.max(0, pane.regrowAt - (game.time || 0));
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = pane.color;
        ctx.globalAlpha = 0.25 + 0.25 * Math.max(0, 1 - left / (glass ? glass.regrow : 1));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = pane.color;
      ctx.globalAlpha = 0.28;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = hot ? 3 : 2;
      ctx.strokeStyle = hot ? '#ffffff' : pane.color;
      ctx.shadowColor = pane.color;
      ctx.shadowBlur = hot ? 22 + 6 * Math.sin(time * 12) : 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Glass highlight.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Ice trail: a frosted ribbon that melts from the tail. */
  drawIce(ice, color, time) {
    const pts = ice.points;
    if (pts.length < 2) return;
    const ctx = this.ctx;
    const now = ice.points[pts.length - 1].t;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const age = now - pts[i].t;
      const a = clamp(1 - age / ice.life, 0, 1);
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.lineWidth = ice.width;
      ctx.strokeStyle = `rgba(205, 246, 255, ${0.16 + 0.22 * a})`;
      ctx.stroke();
      ctx.lineWidth = ice.width * 0.35;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 + 0.35 * a})`;
      ctx.stroke();
    }
    // Frost crystals along the trail.
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    for (let i = 0; i < pts.length; i += 4) {
      const pt = pts[i];
      const a = clamp(1 - (now - pt.t) / ice.life, 0, 1);
      if (a <= 0) continue;
      const r = 4 + 6 * a;
      const rot = (pt.x + pt.y) * 0.05 + time;
      for (let k = 0; k < 3; k++) {
        const ang = rot + (k * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(pt.x - Math.cos(ang) * r, pt.y - Math.sin(ang) * r);
        ctx.lineTo(pt.x + Math.cos(ang) * r, pt.y + Math.sin(ang) * r);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawMover(m, color) {
    if (m.kind === 'piston') return this.drawPiston(m, color);
    if (m.kind === 'orbiter') return this.drawOrbiter(m, color);
    const ctx = this.ctx;
    const [seg] = m.segments();
    ctx.save();
    ctx.lineCap = 'round';
    // Extruded shadow, then the glowing bar, then a bright core and the pivot.
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay + WALL_HEIGHT);
    ctx.lineTo(seg.bx, seg.by + WALL_HEIGHT);
    ctx.lineWidth = m.thick * 2 + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.lineWidth = m.thick * 2;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.thick + 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a14';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    // Spin direction hint.
    ctx.beginPath();
    const dir = Math.sign(m.omega) || 1;
    ctx.arc(m.x, m.y, m.thick + 12, m.angle + 0.3 * dir, m.angle + 1.6 * dir, dir < 0);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.restore();
  }

  drawOrbiter(m, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    // Faint orbit track.
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
    ctx.setLineDash([3, 9]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
    ctx.setLineDash([]);
    for (const seg of m.segments()) {
      ctx.beginPath();
      ctx.moveTo(seg.ax, seg.ay + WALL_HEIGHT);
      ctx.lineTo(seg.bx, seg.by + WALL_HEIGHT);
      ctx.lineWidth = m.thick * 2 + 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(seg.ax, seg.ay);
      ctx.lineTo(seg.bx, seg.by);
      ctx.lineWidth = m.thick * 2;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(seg.ax, seg.ay);
      ctx.lineTo(seg.bx, seg.by);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPiston(m, color) {
    const ctx = this.ctx;
    const [seg] = m.segments();
    const cx = (seg.ax + seg.bx) / 2;
    const cy = (seg.ay + seg.by) / 2;
    ctx.save();
    ctx.lineCap = 'round';
    if (!m.parallel) {
      // Rod from the rock face to the slab.
      ctx.beginPath();
      ctx.moveTo(m.baseX - m.ax * m.thick, m.baseY - m.ay * m.thick);
      ctx.lineTo(cx, cy);
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#26443a';
      ctx.stroke();
    }
    // Slab shadow, glow, core.
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay + WALL_HEIGHT);
    ctx.lineTo(seg.bx, seg.by + WALL_HEIGHT);
    ctx.lineWidth = m.thick * 2 + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.lineWidth = m.thick * 2;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }

  drawPredictedPath(game) {
    // Faint guide line showing where the ball is heading (first leg only).
    const ctx = this.ctx;
    const path = game.guidePath;
    if (!path || path.length === 0) return;
    ctx.save();
    ctx.setLineDash([6, 10]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.18)';
    ctx.beginPath();
    ctx.moveTo(path[0].ax, path[0].ay);
    for (const seg of path) ctx.lineTo(seg.bx, seg.by);
    ctx.stroke();
    ctx.restore();
  }

  drawFighter(f, time, color) {
    const ctx = this.ctx;
    const seg = f.paddleSegment();
    const flash = f.hitFlash > 0;
    const blink = f.invuln > 0 && Math.floor(time * 12) % 2 === 0;
    const frozen = f.frozen > 0;
    if (frozen) color = '#cdf6ff';
    ctx.save();
    ctx.globalAlpha = blink ? 0.45 : 1;
    if (frozen) {
      // Ice shell: a hexagon of frost around the body.
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = time * 0.6 + (k * Math.PI) / 3;
        const rr = f.r + 12;
        const x = f.x + Math.cos(a) * rr;
        const y = f.y + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(205, 246, 255, 0.18)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = '#cdf6ff';
      ctx.shadowBlur = 20;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Body shadow (extrusion) and body.
    ctx.beginPath();
    ctx.arc(f.x, f.y + 6, f.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fill();
    const g = ctx.createRadialGradient(f.x - f.r * 0.3, f.y - f.r * 0.3, 2, f.x, f.y, f.r);
    g.addColorStop(0, flash ? '#ffffff' : '#ffffffcc');
    g.addColorStop(0.35, flash ? '#ffffff' : color);
    g.addColorStop(1, flash ? color : '#101828');
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.stroke();

    // Facing notch.
    const fx = Math.cos(f.angle);
    const fy = Math.sin(f.angle);
    ctx.beginPath();
    ctx.moveTo(f.x + fx * (f.r - 4), f.y + fy * (f.r - 4));
    ctx.lineTo(f.x + fx * (f.r + 6), f.y + fy * (f.r + 6));
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Paddle shield.
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.lineWidth = f.paddleThick * 2 + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.lineWidth = f.paddleThick * 2;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = f.lungeState === 'out' ? 30 : 16;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Name label.
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(f.name.toUpperCase(), f.x, f.y + f.r + 22);
    ctx.restore();
  }

  drawBall(ball, state) {
    const ctx = this.ctx;
    const t = clamp((ball.speed - BALL.minSpeed) / (BALL.maxSpeed - BALL.minSpeed), 0, 1);
    const hue = lerp(190, 320, t);
    const color = `hsl(${hue}, 100%, ${lerp(65, 75, t)}%)`;

    // Trail.
    const tr = ball.trail;
    if (tr.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        const k = i / tr.length;
        ctx.beginPath();
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
        ctx.lineTo(tr[i].x, tr[i].y);
        ctx.lineWidth = ball.r * 1.6 * k;
        ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${0.35 * k})`;
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 18 + 30 * t;
    const g = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, ball.r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, color);
    g.addColorStop(1, `hsla(${hue}, 100%, 60%, 0.6)`);
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    if (ball.held && state === 'countdown') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.r + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawParticles(fx) {
    const ctx = this.ctx;
    ctx.save();
    for (const p of fx.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawRings(fx) {
    const ctx = this.ctx;
    ctx.save();
    for (const r of fx.rings) {
      const k = 1 - r.life / r.maxLife;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.maxR * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function polyPath(ctx, poly) {
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
}
