// Canvas 2D renderer. Neon-on-dark look with a slight 2.5D extrusion on the
// walls to give the "slightly off-centre top-down" feel.
import { BALL, PLAYER } from './config.js';
import { clamp, lerp } from './vec.js';
import { fitScale, cameraTarget, cameraOffset, easeCamera } from './camera.js';
import { mouthOf, throughPortal, tangent } from './portals.js';
import { portalHue } from './color.js';
import { railPath } from './gamestate.js';

/** Trace a body's rail into the current path: a circle, or the figure-eight (railPath). */
function traceRail(ctx, rail) {
  if (rail.shape !== 'eight') {
    ctx.arc(rail.cx, rail.cy, rail.R, 0, Math.PI * 2);
    return;
  }
  const pts = railPath(rail, 120);
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const q of pts) ctx.lineTo(q.x, q.y);
  ctx.closePath();
}

const WALL_HEIGHT = 9; // px of extrusion under each wall face

/** '#rrggbb' at an alpha, as an rgba() string. */
function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const DARK_SCALE = 0.5; // the darkness layer's resolution relative to the canvas
const STATIC_LAYER_PIXELS = 18e6; // the most pixels the static layer holds: a big world drops its density rather than its walls

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };
    this.level = null;
    this.staticLayer = null;
    this.scrolls = false; // the level is bigger than the window: the view follows a camera
    this.cam = null; // where the camera is, in world px, while a level scrolls
    this.camTime = 0;
    this.low = false; // low quality: pixel density capped at 1, no glow on moving things
    this.maxDpr = 2;
    this.darkScale = DARK_SCALE;
    this.darkSmooth = false; // nearest-neighbour upscale: the layer is soft gradients, and bilinear costs 4x more in software rendering
  }

  /** Quality switch. Call resize() afterwards so the canvas and cached layers follow. */
  setQuality(low) {
    this.low = !!low;
    this.maxDpr = low ? 1 : 2;
  }

  /** Glow radius for moving things: shadowBlur is the costliest canvas operation, so low quality turns it off. */
  blur(radius) {
    return this.low ? 0 : radius;
  }

  /** `maxSpeed` overrides the level's own cap, so the ball's colour ramp matches a versus match's pace. */
  setLevel(level, maxSpeed = null) {
    this.level = level;
    this.maxSpeed = maxSpeed || (level && level.maxBallSpeed) || BALL.maxSpeed;
    this.staticLayer = null;
    this.cam = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const lw = this.level ? this.level.width : 1600;
    const lh = this.level ? this.level.height : 900;
    // A level that declares a `view` is scaled to that window, not to itself,
    // and the camera carries the window over it.
    const vw = this.level && this.level.view ? this.level.view.w : lw;
    const vh = this.level && this.level.view ? this.level.view.h : lh;
    const scale = fitScale(w, h, vw, vh);
    this.scrolls = lw * scale > w + 0.5 || lh * scale > h + 0.5;
    const o = cameraOffset(this.cam || { x: lw / 2, y: lh / 2 }, { w: lw, h: lh }, w, h, scale);
    this.view = { scale, ox: o.ox, oy: o.oy, w, h, dpr };
    this.staticLayer = null;
    this.darkLayer = null;
  }

  /** Move the camera for this frame and set the view's offset from it. A level that fits the window never moves. */
  updateCamera(game, time) {
    if (!this.scrolls) return;
    const L = this.level;
    const v = this.view;
    const target = cameraTarget(game, L);
    const dt = this.camTime ? Math.min(0.1, time - this.camTime) : 0;
    this.camTime = time;
    this.cam = easeCamera(this.cam, target, dt);
    const o = cameraOffset(this.cam, { w: L.width, h: L.height }, v.w, v.h, v.scale);
    v.ox = o.ox;
    v.oy = o.oy;
  }

  /**
   * Floor, obstacles and the glowing boundary never change during a level, and
   * their glow (shadowBlur) is the most expensive thing to draw, so render them
   * once into an offscreen canvas and blit it every frame.
   */
  buildStaticLayer() {
    const v = this.view;
    const L = this.level;
    // The layer holds the whole world at the view's scale, so a scrolling
    // level blits a window of it each frame. Its pixel density drops on a
    // world too big to hold at full density.
    const ldpr = Math.min(v.dpr, Math.sqrt(STATIC_LAYER_PIXELS / (L.width * v.scale * L.height * v.scale)));
    const off = document.createElement('canvas');
    off.width = Math.ceil(L.width * v.scale * ldpr);
    off.height = Math.ceil(L.height * v.scale * ldpr);
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#03050c';
    ctx.fillRect(0, 0, off.width, off.height);
    ctx.setTransform(ldpr * v.scale, 0, 0, ldpr * v.scale, 0, 0);
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
    this.updateCamera(game, time);
    ctx.fillStyle = '#03050c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (level.open) {
      // Open space: no floor, no walls, only stars, and those at two depths so the window's drift shows.
      this.drawStars(shx, shy);
    } else {
      if (!this.staticLayer) this.buildStaticLayer();
      const L = this.staticLayer;
      ctx.drawImage(L, 0, 0, L.width, L.height, (v.ox + shx) * v.dpr, (v.oy + shy) * v.dpr, level.width * v.scale * v.dpr, level.height * v.scale * v.dpr);
    }
    ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, (v.ox + shx) * v.dpr, (v.oy + shy) * v.dpr);

    for (const w of game.wells || []) {
      if (w.absent) this.drawGhostBody(w, level.palette, time);
      else if (w.fount) this.drawFount(w, level.palette, time);
      else if (w.solid) this.drawPlanet(w, level.palette, time);
      else this.drawWell(w, level.palette, time);
      if (w.phasing) this.drawPhaseClock(w, level.palette, game.mouthTime || 0);
      if (w.breath) this.drawBreath(w, level.palette);
    }
    for (const w of game.wormholes || []) this.drawWormhole(w, level.palette, time);
    if (game.golf) this.drawGolfTraces(game, level.palette);
    this.drawPredictedPath(game);
    if (game.panes && game.panes.length) this.drawGlass(game.panes, game, time);
    if (game.vents && game.vents.length) this.drawVents(game.vents, level.palette.ice || '#cdf6ff', game.time || 0);
    if (game.ice) this.drawIce(game.ice, level.palette.ice || '#cdf6ff', time, ((game.fighters || []).find((f) => f.slot === game.ice.owner) || game.boss).color, game.time || 0);
    for (const m of game.movers || []) this.drawMover(m, level.palette.obstacle);
    if (game.portals) this.drawPortals(game, time);
    for (const d of game.drones || [game.boss]) if (d.pulser && !d.down) this.drawPulse(d, level.palette.obstacle, time);
    for (const e of game.emitters || []) {
      this.drawEmitter(e, level.palette);
      this.drawPulse(e, level.palette.obstacle, time);
    }
    if (game.doors && game.doors.length) this.drawDoors(game.doors, level.palette, time);
    for (const d of game.drones || []) if (d.rail) this.drawRail(d.rail, level.palette);
    if (game.nodes && game.nodes.length) this.drawNodes(game.nodes, level.palette, time, game.golf ? game.mouthTime : null);
    if (game.turrets && game.turrets.length) this.drawTurrets(game.turrets, level.palette, game.time || 0);
    if (game.shots && game.shots.length) this.drawShots(game.shots, level.palette, game.player ? game.player.color : '#ffffff', game.volley ? (slot) => (game.fighters.find((f) => f.slot === slot) || {}).color : null);
    if (game.volley) this.drawCharges(game.fighters || [], game.time || 0, time);
    this.drawRings(game.fx);
    for (const f of game.fighters || [game.boss, game.player]) {
      if (f.down) continue;
      // Partway through a wormhole: cut off at one mouth, coming out of the other.
      const m = game.portals ? mouthOf(game, f.x, f.y, f.r) : null;
      if (m && m.q && m.v < f.r) this.drawFighterThrough(f, m, time);
      else this.drawFighter(f, time, f.color);
    }
    if (!game.volley) this.drawBall(game.ball, state); // Blaster has no ball to draw
    if (game.golf) this.drawGolfAim(game, state, time);
    this.drawParticles(game.fx);

    if (level.dark) this.drawDarkness(game, level, state, time, shx, shy);

    if (game.fx.flash > 0) {
      ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, (v.ox + shx) * v.dpr, (v.oy + shy) * v.dpr);
      ctx.fillStyle = `rgba(255,255,255,${clamp(game.fx.flash, 0, 1) * 0.6})`;
      ctx.fillRect(-50, -50, level.width + 100, level.height + 100);
    }

    if (game.golf && state === 'paused') this.drawGolfMap(game, level, time);
    if (joystick && joystick.active) this.drawJoystick(joystick, (game.local && game.local.color) || game.player.color);
  }

  /**
   * A starfield for open space, drawn in screen space from a hash of the cell
   * each star sits in, so it is the same every frame and needs no storage.
   * Two layers: the far one scrolls at half the window's speed.
   */
  drawStars(shx, shy) {
    const ctx = this.ctx;
    const v = this.view;
    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    for (const [p, count, size, alpha] of [[0.45, 5, 1.1, 0.35], [1, 3, 1.8, 0.7]]) {
      const cell = 260;
      const ox = (v.ox + shx) * p;
      const oy = (v.oy + shy) * p;
      const x0 = Math.floor(-ox / cell) - 1;
      const x1 = Math.floor((v.w - ox) / cell) + 1;
      const y0 = Math.floor(-oy / cell) - 1;
      const y1 = Math.floor((v.h - oy) / cell) + 1;
      ctx.fillStyle = '#dfe8ff';
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          let h = (cx * 73856093) ^ (cy * 19349663) ^ Math.round(p * 1000);
          for (let i = 0; i < count; i++) {
            h = (h * 1103515245 + 12345) & 0x7fffffff;
            const fx = (h % 1000) / 1000;
            h = (h * 1103515245 + 12345) & 0x7fffffff;
            const fy = (h % 1000) / 1000;
            h = (h * 1103515245 + 12345) & 0x7fffffff;
            const fs = (h % 1000) / 1000;
            ctx.globalAlpha = alpha * (0.4 + 0.6 * fs);
            const r = size * (0.5 + fs);
            ctx.fillRect(cx * cell + fx * cell + ox - r / 2, cy * cell + fy * cell + oy - r / 2, r, r);
          }
        }
      }
    }
    ctx.restore();
  }

  /**
   * Darkness: a black layer with holes punched out around each light source
   * (lanterns, the ball's glow, candles), composited over the world.
   */
  drawDarkness(game, level, state, time, shx, shy) {
    const v = this.view;
    const d = level.dark;
    // The layer is soft light only, so it is rendered at half resolution and
    // scaled up: a quarter of the pixels to fill, punch and composite each frame.
    const S = this.darkScale;
    if (!this.darkLayer) {
      this.darkLayer = document.createElement('canvas');
      this.darkLayer.width = Math.ceil(this.canvas.width * S);
      this.darkLayer.height = Math.ceil(this.canvas.height * S);
    }
    const dc = this.darkLayer.getContext('2d');
    dc.setTransform(1, 0, 0, 1, 0, 0);
    // The crypt lights up when the level ends.
    const lifted = state === 'cleared' || state === 'failed';
    const ambient = lifted ? 0.7 : d.ambient;
    // Plain clear + fill: the 'copy' composite would do it in one pass but
    // takes Chrome's slow full-surface layer path.
    dc.globalCompositeOperation = 'source-over';
    dc.clearRect(0, 0, this.darkLayer.width, this.darkLayer.height);
    dc.fillStyle = `rgba(0,0,0,${1 - ambient})`;
    dc.fillRect(0, 0, this.darkLayer.width, this.darkLayer.height);
    dc.globalCompositeOperation = 'destination-out';
    dc.setTransform(v.dpr * v.scale * S, 0, 0, v.dpr * v.scale * S, (v.ox + shx) * v.dpr * S, (v.oy + shy) * v.dpr * S);
    const punch = (x, y, r, core = 0.5) => {
      const g = dc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(core, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      dc.fillStyle = g;
      dc.beginPath();
      dc.arc(x, y, r, 0, Math.PI * 2);
      dc.fill();
    };
    const flicker = (seed) => 1 + 0.06 * Math.sin(time * 9 + seed) + 0.04 * Math.sin(time * 23 + seed * 1.7);
    for (let i = 0; i < (level.lights || []).length; i++) {
      const l = level.lights[i];
      punch(l.x, l.y, (l.r || d.candle) * flicker(i * 3.1), 0.35);
    }
    for (const f of game.fighters || [game.player, game.boss]) {
      if (f.down) continue;
      const r = f.lantern ? (f.glow ? d.boss : d.hidden || 26) : f.kind === 'boss' ? d.boss : d.player;
      punch(f.x, f.y, r * flicker(f.slot === 'b' ? 1.9 : f.slot === 'c' ? 1.2 : 0.5), 0.5);
    }
    for (const n of game.nodes || []) if (n.kind === 'candle' && n.lit) punch(n.x, n.y, d.candle * flicker(n.i * 2.3), 0.35);
    if (!game.ball.held || state === 'countdown') {
      punch(game.ball.x, game.ball.y, d.ball + game.ball.speed * 0.07, 0.45);
    }
    for (const r of game.fx.rings) punch(r.x, r.y, r.maxR * 0.8, 0.3);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = this.darkSmooth;
    ctx.drawImage(this.darkLayer, 0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true;
    // Candle flames on top of the darkness. One small fill per flame: a glow
    // blur costs by the bounding box of what is drawn, so batching flames from
    // opposite corners into one path would blur the whole canvas.
    ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, (v.ox + shx) * v.dpr, (v.oy + shy) * v.dpr);
    const lights = (level.lights || []).concat((game.nodes || []).filter((n) => n.kind === 'candle' && n.lit).map((n) => ({ x: n.x, y: n.y - n.r * 0.2 })));
    ctx.fillStyle = '#fff1c0';
    ctx.shadowColor = '#ffc860';
    ctx.shadowBlur = this.blur(18);
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      ctx.beginPath();
      ctx.arc(l.x, l.y, 4 + 1.5 * flicker(i), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
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
      ctx.shadowBlur = this.blur(20 * kick);
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
      ctx.shadowBlur = this.blur(lit ? 18 : 0);
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
    ctx.shadowBlur = this.blur(14);
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
    const edge = p.boundary || p.wall;
    ctx.lineWidth = 3;
    ctx.strokeStyle = edge;
    ctx.shadowColor = edge;
    ctx.shadowBlur = p.boundary ? 0 : 18;
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
    ctx.save();
    ctx.lineJoin = 'round';
    for (const pane of panes) {
      const hot = glass && !pane.unbreakable && game.ball.speed >= (pane.breakSpeed || glass.breakSpeed);
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
      ctx.shadowBlur = this.blur(hot ? 22 + 6 * Math.sin(time * 12) : 12);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // Glass highlight.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();
      if (pane.unbreakable) {
        // Leaded glass: a heavy dark frame says this one never gives.
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(20, 16, 30, 0.85)';
        ctx.setLineDash([10, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  /** Ice trail: a frosted ribbon that melts from the tail. */
  /** Conduit nodes: dark discs that light up when the ball earns them. */
  drawNodes(nodes, palette, time, clock = null) {
    const ctx = this.ctx;
    const dim = palette.node || '#6e7fa8';
    const lit = palette.nodeLit || '#7dffc4';
    for (const n of nodes) {
      const color = n.lit ? lit : dim;
      ctx.save();
      ctx.translate(n.x, n.y);
      // body
      ctx.beginPath();
      ctx.arc(0, 0, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.lit ? 'rgba(125, 255, 196, 0.22)' : 'rgba(10, 14, 30, 0.9)';
      ctx.fill();
      ctx.lineWidth = n.lit ? 3 : 2;
      ctx.strokeStyle = color;
      if (n.kind === 'ricochet') ctx.setLineDash([6, 5]);
      ctx.shadowBlur = this.blur(n.lit ? 18 : 0);
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      if (n.kind === 'fast') {
        ctx.beginPath();
        ctx.arc(0, 0, n.r + 6, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (n.kind === 'candle') {
        // A wick: a short stroke up from the core, dark until lit.
        ctx.lineWidth = 3;
        ctx.strokeStyle = n.lit ? '#fff1c0' : color;
        ctx.beginPath();
        ctx.moveTo(0, n.r * 0.1);
        ctx.lineTo(0, -n.r * 0.45);
        ctx.stroke();
      }
      if (n.kind === 'switch') {
        // A lever across the disc: horizontal while off, tilted while on.
        ctx.rotate(n.lit ? -0.6 : 0);
        ctx.lineWidth = 4;
        ctx.strokeStyle = n.lit ? lit : palette.wall;
        ctx.beginPath();
        ctx.moveTo(-n.r * 0.7, 0);
        ctx.lineTo(n.r * 0.7, 0);
        ctx.stroke();
        ctx.rotate(n.lit ? 0.6 : 0);
        if (n.lit && clock !== null && n.litUntil !== undefined) {
          // On the course the doors stay open for a while: the ring is what is left of it.
          const left = Math.max(0, (n.litUntil - clock) / (n.holdOpen || 4));
          ctx.beginPath();
          ctx.arc(0, 0, n.r + 7, -Math.PI / 2, -Math.PI / 2 + left * Math.PI * 2);
          ctx.lineWidth = 3;
          ctx.strokeStyle = left < 0.25 ? '#ff6b6b' : lit;
          ctx.stroke();
        }
      }
      if (n.kind === 'hooded') {
        // The hood covers everything but the open arc.
        const half = (((n.arc || 100) * Math.PI) / 360);
        const open = n.open || 0;
        ctx.beginPath();
        ctx.arc(0, 0, n.r + 5, open + half, open - half + Math.PI * 2);
        ctx.lineWidth = 6;
        ctx.strokeStyle = n.lit ? color : palette.wall;
        ctx.stroke();
      }
      // core
      const pulse = n.lit ? 0.75 + 0.25 * Math.sin(time * 4 + n.i) : 0.35;
      ctx.beginPath();
      ctx.arc(0, 0, n.r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = pulse;
      ctx.fill();
      ctx.restore();
    }
  }

  /** A floor emitter: a small dish the pulse rings leave from. */
  /** The gravity well: a black horizon, an accretion of slowly turning rings, and a dotted mark of its reach. */
  drawWell(w, palette, time) {
    const ctx = this.ctx;
    const color = w.cup ? palette.cup || '#7dffc4' : palette.well || '#b49cff';
    ctx.save();
    if (w.rail) {
      // A maw on a rail: where it goes, as a stone's rail is drawn.
      ctx.setLineDash([2, 10]);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = color;
      ctx.beginPath();
      traceRail(ctx, w.rail);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.translate(w.x, w.y);
    ctx.strokeStyle = color;
    // Its reach: where the pull begins.
    ctx.setLineDash([3, 11]);
    ctx.lineDashOffset = -time * 10;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, w.range, 0, Math.PI * 2);
    ctx.stroke();
    // The halo: light bending in.
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const halo = ctx.createRadialGradient(0, 0, w.r, 0, 0, w.r * 3.4);
    halo.addColorStop(0, withAlpha(color, 0.38));
    halo.addColorStop(0.5, withAlpha(color, 0.1));
    halo.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, w.r * 3.4, 0, Math.PI * 2);
    ctx.fill();
    // Accretion rings, each turning at its own pace, the inner ones faster.
    for (let i = 0; i < 3; i++) {
      const rr = w.r * (1.55 + i * 0.75);
      ctx.setLineDash([rr * 0.5, rr * 0.3]);
      ctx.lineDashOffset = time * (i % 2 ? 40 : -70) / (1 + i * 0.6);
      ctx.globalAlpha = 0.38 - i * 0.1;
      ctx.lineWidth = 2 - i * 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The horizon.
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(0, 0, w.r, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.shadowColor = color;
    ctx.shadowBlur = this.blur(26);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    // The cup wears a reticle: four ticks square to the world, so no maw on
    // the course can be mistaken for the one that counts.
    if (w.cup) {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      const a = w.r + 9;
      const b = w.r + 20;
      for (let i = 0; i < 4; i++) {
        const t = (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(t) * a, Math.sin(t) * a);
        ctx.lineTo(Math.cos(t) * b, Math.sin(t) * b);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * A solid gravity body: a stone with a lit rim, its field marked by the same
   * dotted reach a black hole uses. The ball bounces off the surface, so the
   * surface is drawn as a surface and not as a hole.
   */
  /** A phasing body between its appearances: only a faint outline where it will stand, and where its reach will be. */
  drawGhostBody(w, palette, time) {
    const ctx = this.ctx;
    const color = w.fount ? palette.fount || '#fff1b8' : w.solid ? palette.planet || '#ffb347' : palette.well || '#b49cff';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 8]);
    ctx.lineDashOffset = -time * 6;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.1;
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A body that breathes: a ring that swells out from its surface as its pull
   * rises and falls back as it fades, and a dotted one where it reaches at the
   * top of its breath.
   */
  drawBreath(w, palette) {
    const b = w.breath;
    const f = Math.max(0, Math.min(1, (w.pull / w.basePull - (1 - b.amp)) / (2 * b.amp))); // 0 at the bottom of its breath, 1 at the top
    const color = w.solid ? palette.planet || '#ffb347' : palette.well || '#b49cff';
    const lo = w.r + 14;
    const hi = Math.max(lo + 20, w.range * 0.45);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([2, 8]);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(w.x, w.y, hi, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 2 + 2 * f;
    ctx.globalAlpha = 0.25 + 0.45 * f;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.blur(6 + 10 * f);
    ctx.beginPath();
    ctx.arc(w.x, w.y, lo + (hi - lo) * f, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A phasing body's clock: an arc just outside its surface. While it stands,
   * the arc is the time it has left and turns hot as it runs out; while it is
   * gone, the arc fills in toward its return.
   */
  drawPhaseClock(w, palette, t) {
    const ph = w.phasing;
    const cycle = ph.on + ph.off;
    const at = (((t + (ph.offset || 0)) % cycle) + cycle) % cycle;
    const frac = w.absent ? (at - ph.on) / ph.off : 1 - at / ph.on;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = w.absent ? 'rgba(255, 255, 255, 0.35)' : frac < 0.25 ? '#ff6b6b' : 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r + 9, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, frac) * Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawPlanet(w, palette, time) {
    const ctx = this.ctx;
    const color = palette.planet || palette.obstacle || '#ffb347';
    ctx.save();
    if (w.rail) {
      // The rail: where the body goes, and a tick at the centre it goes round.
      ctx.setLineDash([2, 10]);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = color;
      ctx.beginPath();
      traceRail(ctx, w.rail);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(w.rail.cx - 6, w.rail.cy);
      ctx.lineTo(w.rail.cx + 6, w.rail.cy);
      ctx.moveTo(w.rail.cx, w.rail.cy - 6);
      ctx.lineTo(w.rail.cx, w.rail.cy + 6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.translate(w.x, w.y);
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 11]);
    ctx.lineDashOffset = -time * 10;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(0, 0, w.range, 0, Math.PI * 2);
    ctx.stroke();
    // The field, closing in: two slow arcs between the reach and the surface.
    ctx.setLineDash([26, 34]);
    for (let i = 0; i < 2; i++) {
      const rr = w.r + (w.range - w.r) * (0.35 + i * 0.3);
      ctx.lineDashOffset = time * (i % 2 ? 22 : -30);
      ctx.globalAlpha = 0.16 - i * 0.05;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The stone.
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const body = ctx.createRadialGradient(-w.r * 0.35, -w.r * 0.35, w.r * 0.1, 0, 0, w.r);
    body.addColorStop(0, withAlpha(color, 0.5));
    body.addColorStop(0.65, withAlpha(color, 0.16));
    body.addColorStop(1, 'rgba(6, 8, 18, 0.95)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, w.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = this.blur(18);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A fount, a white hole: the opposite of a maw. A small solid core, bright
   * rather than black, and rings that run outward from it instead of in, so
   * the push reads as a push before anything has been sent near it.
   */
  drawFount(w, palette, time) {
    const ctx = this.ctx;
    const color = palette.fount || '#fff1b8';
    ctx.save();
    ctx.translate(w.x, w.y);
    // Its reach, dotted like every body's.
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 11]);
    ctx.lineDashOffset = time * 10;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(0, 0, w.range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Rings born at the core and fading as they spread to the edge of its reach.
    for (let i = 0; i < 4; i++) {
      const f = (time * 0.5 + i / 4) % 1;
      const rr = w.r + f * (w.range - w.r);
      ctx.globalAlpha = 0.45 * (1 - f);
      ctx.lineWidth = 2.5 - 1.5 * f;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The glow and the core.
    ctx.globalAlpha = 1;
    const halo = ctx.createRadialGradient(0, 0, w.r * 0.5, 0, 0, w.r * 3);
    halo.addColorStop(0, withAlpha(color, 0.55));
    halo.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, w.r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = color;
    ctx.shadowBlur = this.blur(24);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, w.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  /** A wormhole pair: two turning mouths and the faint thread between them. */
  drawWormhole(w, palette, time) {
    if (w.flat) return this.drawSlots(w, palette, time);
    const ctx = this.ctx;
    const color = w.color || palette.warp || '#ff8df0';
    ctx.save();
    // A mouth that circles something: its orbit, the way a stone's rail is drawn.
    for (const o of [w.orbitA, w.orbitB]) {
      if (!o) continue;
      ctx.setLineDash([4, 9]);
      ctx.lineDashOffset = (-time * 12 * o.period) / Math.abs(o.period); // the dots drift the way the mouth goes
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(o.cx, o.cy, o.R, 0, Math.PI * 2);
      ctx.stroke();
    }
    // The thread: which mouth leads where, without claiming a path.
    ctx.setLineDash([2, 16]);
    ctx.lineDashOffset = -time * 24;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(w.ax, w.ay);
    ctx.lineTo(w.bx, w.by);
    ctx.stroke();
    for (const [x, y, dir] of [[w.ax, w.ay, 1], [w.bx, w.by, -1]]) {
      ctx.save();
      ctx.translate(x, y);
      const exitOnly = w.oneWay && dir === -1;
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, w.r * 1.5);
      halo.addColorStop(0, withAlpha(color, 0.3));
      halo.addColorStop(1, withAlpha(color, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, w.r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      for (let i = 0; i < (exitOnly ? 1 : 3); i++) {
        const rr = w.r * (1 - i * 0.24);
        ctx.setLineDash([rr * 0.7, rr * 0.5]);
        ctx.lineDashOffset = dir * time * (30 + i * 26);
        ctx.globalAlpha = 0.75 - i * 0.18;
        ctx.lineWidth = 2 - i * 0.4;
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * A flat pair: each mouth a bright slot along its wall face, a glow thrown
   * out into the room the way the face looks, and a chevron in it pointing
   * out. The far end of a one-way pair only has the chevron.
   */
  drawSlots(w, palette, time) {
    const ctx = this.ctx;
    const color = w.color || palette.warp || '#ff8df0';
    ctx.save();
    ctx.setLineDash([2, 16]);
    ctx.lineDashOffset = -time * 24;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(w.ax, w.ay);
    ctx.lineTo(w.bx, w.by);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y, face, exit] of [[w.ax, w.ay, w.aAngle, false], [w.bx, w.by, w.bAngle, w.oneWay]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(face); // +x now points out of the face, into the room
      const glow = ctx.createLinearGradient(0, 0, w.half * 0.9, 0);
      glow.addColorStop(0, withAlpha(color, 0.38));
      glow.addColorStop(1, withAlpha(color, 0));
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.fillRect(0, -w.half, w.half * 0.9, w.half * 2);
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineWidth = exit ? 3 : 5;
      ctx.shadowColor = color;
      ctx.shadowBlur = this.blur(14);
      ctx.beginPath();
      ctx.moveTo(2, -w.half);
      ctx.lineTo(2, w.half);
      ctx.stroke();
      ctx.shadowBlur = 0;
      // The chevron: out of this face is the way the charge leaves it.
      const pulse = (time * 1.2 + (exit ? 0.5 : 0)) % 1;
      ctx.globalAlpha = 0.35 + 0.45 * (1 - pulse);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10 + pulse * 10, -10);
      ctx.lineTo(20 + pulse * 10, 0);
      ctx.lineTo(10 + pulse * 10, 10);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  /** The flight being flown, and the ghost of the one before it. */
  drawGolfTraces(game, palette) {
    const gf = game.golf;
    const ctx = this.ctx;
    const line = (pts, color, alpha, dash) => {
      if (!pts || pts.length < 2) return;
      ctx.save();
      ctx.setLineDash(dash);
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.beginPath();
      let pen = false;
      for (const p of pts) {
        // A warp marker breaks the line: the charge did not fly between these two points.
        if (p.warp) {
          pen = false;
          continue;
        }
        if (!pen) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        pen = true;
      }
      ctx.stroke();
      ctx.restore();
    };
    line(gf.ghost, palette.wall || '#8fd4ff', 0.16, [5, 9]);
    line(gf.trace, palette.wall || '#8fd4ff', 0.3, []);
  }

  /**
   * What the launcher is told: the line the charge leaves on (one leg, no
   * bounces and no field — the hole is not solved for you), and in flight the
   * heading the next ion pulse pushes along.
   */
  drawGolfAim(game, state, time) {
    const ctx = this.ctx;
    const gf = game.golf;
    const f = game.player;
    const color = f.color;
    if (gf.phase === 'aim') {
      // The charge rests at the muzzle while it is aimed, so the line starts where it is.
      const ax = game.ball.x;
      const ay = game.ball.y;
      const bx = ax + Math.cos(f.angle) * gf.ray;
      const by = ay + Math.sin(f.angle) * gf.ray;
      ctx.save();
      ctx.setLineDash([9, 7]);
      ctx.lineDashOffset = -time * 40;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      // The head of the line, so the direction reads at a glance.
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (const t of [2.5, -2.5]) {
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(f.angle + t) * 16, by + Math.sin(f.angle + t) * 16);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (gf.phase !== 'flight') return;
    const b = game.ball;
    const cx = Math.cos(gf.heading);
    const cy = Math.sin(gf.heading);
    const empty = gf.fuel <= 0;
    ctx.save();
    ctx.globalAlpha = empty ? 0.2 : 0.75;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(b.x + cx * (b.r + 4), b.y + cy * (b.r + 4));
    ctx.lineTo(b.x + cx * (b.r + 30), b.y + cy * (b.r + 30));
    for (const t of [2.5, -2.5]) {
      ctx.moveTo(b.x + cx * (b.r + 30), b.y + cy * (b.r + 30));
      ctx.lineTo(b.x + cx * (b.r + 30) + Math.cos(gf.heading + t) * 11, b.y + cy * (b.r + 30) + Math.sin(gf.heading + t) * 11);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The hole as a map, over a dimmed world: every gravity body named, the
   * wormhole mouths paired up and the tee marked. One screen holds a whole
   * hole today, so this is a legend rather than a second view of it.
   */
  drawGolfMap(game, level, time) {
    const ctx = this.ctx;
    const v = this.view;
    const p = level.palette;
    ctx.save();
    // A hole that fits the window is dimmed in place and labelled. One that
    // scrolls is drawn whole, fitted to the screen, with the window marked.
    let s = 1;
    if (this.scrolls) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(3, 5, 12, 0.88)';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      // An open hole has no edges worth showing: the map fits the part of space the hole is played in.
      const area = level.open && level.area ? level.area : { x: 0, y: 0, w: level.width, h: level.height };
      s = Math.min(v.w / area.w, v.h / area.h) * 0.9;
      const mx = (v.w - area.w * s) / 2 - area.x * s;
      const my = (v.h - area.h * s) / 2 - v.h * 0.04 - area.y * s;
      ctx.setTransform(v.dpr * s, 0, 0, v.dpr * s, mx * v.dpr, my * v.dpr);
      this.drawMapSchematic(game, level, time, s);
    } else {
      ctx.fillStyle = 'rgba(3, 5, 12, 0.55)';
      ctx.fillRect(-50, -50, level.width + 100, level.height + 100);
    }
    ctx.font = `600 ${15 / s}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Where each name went, so two never print over each other: a second of
    // the same name (two founts making a lens) is left to the first, and a
    // different one steps up clear of it.
    const placed = [];
    const lineH = 18 / s;
    const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 4 / s && Math.abs(a.y - b.y) < lineH;
    const text = (t, x, y) => {
      const box = { t, x, y, w: ctx.measureText(t).width };
      if (placed.some((q) => q.t === t && overlaps(q, box))) return;
      for (let k = 0; k < 6 && placed.some((q) => overlaps(q, box)); k++) box.y -= lineH;
      placed.push(box);
      ctx.fillText(t, box.x, box.y);
    };
    const label = (x, y, name, color, r) => {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2 / s;
      ctx.setLineDash([4 / s, 5 / s]);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.globalAlpha = 1;
      text(name, x, y - r - 14 / s);
    };
    for (const w of game.wells) {
      if (w.cup) label(w.x, w.y, 'THE CUP', p.cup || '#7dffc4', w.r + 26);
      else if (w.fount) label(w.x, w.y, 'FOUNT', p.fount || '#fff1b8', w.r + 22);
      else if (w.breath) label(w.x, w.y, 'BREATHING', p.planet || '#ffb347', w.r + 16);
      else if (w.solid) label(w.x, w.y, 'STONE', p.planet || '#ffb347', w.r + 16);
      else label(w.x, w.y, 'MAW', p.well || '#b49cff', w.r + 16);
    }
    // Each pair in its own colour, both mouths named for the pair: a mouth
    // works both ways, and leads only to the one that matches it.
    game.wormholes.forEach((w, i) => {
      const color = w.color || p.warp || '#ff8df0';
      const kind = w.flat ? 'SLOT' : 'MOUTH';
      const name = game.wormholes.length > 1 ? `${kind} ${String.fromCharCode(65 + i)}` : kind;
      // A one-way pair is the one case where IN and OUT are true.
      const nameA = w.oneWay ? `${name} · IN` : name;
      const nameB = w.oneWay ? `${name} · OUT` : name;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 8]);
      ctx.lineDashOffset = -time * 30;
      ctx.beginPath();
      ctx.moveTo(w.ax, w.ay);
      ctx.lineTo(w.bx, w.by);
      ctx.stroke();
      ctx.setLineDash([]);
      label(w.ax, w.ay, nameA, color, w.r + 12);
      label(w.bx, w.by, nameB, color, w.r + 12);
    });
    for (const n of game.nodes || []) if (n.kind === 'switch') label(n.x, n.y, 'SWITCH', p.nodeLit || '#7dffc4', n.r + 12);
    for (const d of game.doors || []) {
      const c = d.poly.reduce((a, q) => [a[0] + q[0] / d.poly.length, a[1] + q[1] / d.poly.length], [0, 0]);
      const half = Math.max(...d.poly.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])));
      label(c[0], c[1], 'DOOR', p.door || p.obstacle, half + 10);
    }
    for (const e of game.emitters || []) label(e.x, e.y, 'EMITTER', p.emitter || p.obstacle, 30);
    game.panes.forEach((pane, i) => {
      // One label for each kind of glass: the first pane that breaks, and the first that never does.
      if (game.panes.findIndex((q) => q.unbreakable === pane.unbreakable) !== i) return;
      const c = pane.poly.reduce((a, q) => [a[0] + q[0] / pane.poly.length, a[1] + q[1] / pane.poly.length], [0, 0]);
      ctx.fillStyle = pane.color;
      text(pane.unbreakable ? 'LEADED GLASS' : 'GLASS', c[0], c[1] - 30 / s);
    });
    label(level.tee.x, level.tee.y, 'TEE', p.wall || '#8fd4ff', 46);
    ctx.restore();
  }

  /**
   * The whole hole as a chart, drawn in world units under a fit-all transform
   * at scale `s`: the room, its walls, every body, the mouths, the tee, the
   * charge, the flight so far and its ghost, and the window the screen shows.
   */
  drawMapSchematic(game, level, time, s) {
    const ctx = this.ctx;
    const v = this.view;
    const p = level.palette;
    ctx.save();
    if (level.open) {
      // Nothing to draw but the reach of the map itself.
      const a = level.area;
      ctx.setLineDash([10 / s, 10 / s]);
      ctx.lineWidth = 1 / s;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.strokeRect(a.x, a.y, a.w, a.h);
      ctx.setLineDash([]);
    } else {
      ctx.beginPath();
      polyPath(ctx, level.boundary);
      ctx.fillStyle = 'rgba(12, 20, 40, 0.9)';
      ctx.fill();
      ctx.lineWidth = 3 / s;
      ctx.strokeStyle = p.wall;
      ctx.stroke();
    }
    for (const o of level.obstacles) {
      if (o.glass) continue; // drawn with the panes, as they stand now
      ctx.beginPath();
      polyPath(ctx, Array.isArray(o) ? o : o.poly);
      ctx.fillStyle = p.obstacleDark || '#2a1a46';
      ctx.fill();
      ctx.lineWidth = 2 / s;
      ctx.strokeStyle = p.obstacle;
      ctx.stroke();
    }
    for (const pane of game.panes || []) {
      ctx.beginPath();
      polyPath(ctx, pane.poly);
      ctx.strokeStyle = pane.color;
      ctx.lineWidth = 2 / s;
      if (pane.broken) ctx.setLineDash([4 / s, 6 / s]);
      else {
        ctx.fillStyle = withAlpha(pane.color, 0.3);
        ctx.fill();
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const d of game.doors || []) {
      ctx.beginPath();
      polyPath(ctx, d.poly);
      ctx.strokeStyle = p.door || p.obstacle;
      ctx.lineWidth = 2 / s;
      if (d.closed) {
        ctx.fillStyle = p.doorDark || p.obstacleDark || '#2a1a46';
        ctx.fill();
      } else ctx.setLineDash([6 / s, 8 / s]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const n of game.nodes || []) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.lit ? 'rgba(125, 255, 196, 0.35)' : 'rgba(10, 14, 30, 0.9)';
      ctx.fill();
      ctx.lineWidth = 2 / s;
      ctx.strokeStyle = n.lit ? p.nodeLit || '#7dffc4' : p.node || '#6e7fa8';
      ctx.stroke();
    }
    for (const e of game.emitters || []) {
      const color = p.emitter || p.obstacle;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 / s;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([3 / s, 7 / s]);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.pulser.maxRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const m of game.movers || []) {
      if (m.kind === 'stone') continue; // drawn as the body it is
      for (const sg of m.segments()) {
        ctx.beginPath();
        ctx.moveTo(sg.ax, sg.ay);
        ctx.lineTo(sg.bx, sg.by);
        ctx.lineWidth = (m.thick || 6) * 2;
        ctx.strokeStyle = p.obstacle;
        ctx.stroke();
      }
    }
    for (const w of game.wells) {
      const color = w.cup ? p.cup || '#7dffc4' : w.fount ? p.fount || '#fff1b8' : w.solid ? p.planet || '#ffb347' : p.well || '#b49cff';
      if (w.rail) {
        ctx.setLineDash([3 / s, 8 / s]);
        ctx.lineWidth = 1.5 / s;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        traceRail(ctx, w.rail);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([6 / s, 10 / s]);
      ctx.lineWidth = 1.5 / s;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
      ctx.fillStyle = w.solid ? withAlpha(color, 0.35) : '#000000';
      ctx.fill();
      ctx.lineWidth = 2 / s;
      ctx.stroke();
    }
    for (const w of game.wormholes) {
      const color = w.color || p.warp || '#ff8df0';
      ctx.strokeStyle = color;
      for (const o of [w.orbitA, w.orbitB]) {
        if (!o) continue;
        ctx.setLineDash([3 / s, 8 / s]);
        ctx.lineWidth = 1.5 / s;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(o.cx, o.cy, o.R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.lineWidth = 2 / s;
      if (w.flat) {
        ctx.lineWidth = 6 / s;
        for (const [x, y, face] of [[w.ax, w.ay, w.aAngle], [w.bx, w.by, w.bAngle]]) {
          const ux = -Math.sin(face) * w.half;
          const uy = Math.cos(face) * w.half;
          ctx.beginPath();
          ctx.moveTo(x - ux, y - uy);
          ctx.lineTo(x + ux, y + uy);
          ctx.stroke();
        }
        continue;
      }
      for (const [x, y] of [[w.ax, w.ay], [w.bx, w.by]]) {
        ctx.setLineDash([w.r * 0.5, w.r * 0.35]);
        ctx.beginPath();
        ctx.arc(x, y, w.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // The flight, and the ghost of the last one.
    const gf = game.golf;
    const line = (pts, alpha, dash) => {
      if (!pts || pts.length < 2) return;
      ctx.setLineDash(dash);
      ctx.lineWidth = 1.5 / s;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = p.wall;
      ctx.beginPath();
      let pen = false;
      for (const q of pts) {
        if (q.warp) {
          pen = false;
          continue;
        }
        if (!pen) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
        pen = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    };
    if (gf) {
      line(gf.ghost, 0.3, [6 / s, 8 / s]);
      line(gf.trace, 0.7, []);
    }
    // The launcher and the charge.
    const f = game.player;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fillStyle = withAlpha(f.color, 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(game.ball.x, game.ball.y, game.ball.r * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = f.color;
    ctx.shadowBlur = this.blur(12 / s);
    ctx.fill();
    ctx.shadowBlur = 0;
    // The window: what the screen is looking at right now.
    ctx.setLineDash([8 / s, 6 / s]);
    ctx.lineDashOffset = -time * 20;
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.strokeRect(-v.ox / v.scale, -v.oy / v.scale, v.w / v.scale, v.h / v.scale);
    ctx.restore();
  }

  /**
   * The charge each fighter carries in Blaster: an orb of its own colour at the
   * centre of the shield, with the reload closing round it while it is spent.
   * It is drawn only, never part of the physics.
   */
  drawCharges(fighters, now, time) {
    const ctx = this.ctx;
    for (const f of fighters) {
      if (f.down || f.kind !== 'player') continue;
      const fx = Math.cos(f.angle);
      const fy = Math.sin(f.angle);
      const x = f.x + fx * f.paddleOffset;
      const y = f.y + fy * f.paddleOffset;
      ctx.save();
      if (f.charged) {
        // Loaded, and meant to be read across the room: a bright core, a halo
        // that breathes, and two counter-turning ticks around it.
        const pulse = 1 + 0.12 * Math.sin(time * 6 + f.x * 0.05);
        const r = 12 * pulse;
        const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.6);
        halo.addColorStop(0, withAlpha(f.color, 0.55));
        halo.addColorStop(1, withAlpha(f.color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 0.85;
        for (let k = 0; k < 3; k++) {
          const a = time * 1.6 + (k * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(x, y, r + 6, a, a + 0.5);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = f.color;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = this.blur(26);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      } else {
        // Spent: a thin arc closing as the next charge forms. Deliberately
        // quiet, so loaded and empty are never mistaken for one another.
        const left = Math.max(0, (f.chargeAt || 0) - now);
        const k = 1 - Math.min(1, left / 3);
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(x, y, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawEmitter(e, palette) {
    const ctx = this.ctx;
    const color = palette.emitter || palette.obstacle;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(10, 8, 20, 0.9)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(18, 0);
    ctx.moveTo(0, -18);
    ctx.lineTo(0, 18);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.restore();
  }

  /** Doors: a solid slab while closed, a dashed outline while open. */
  drawDoors(doors, palette, time) {
    const ctx = this.ctx;
    const color = palette.door || palette.obstacle;
    for (const d of doors) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < d.poly.length; i++) {
        const p = d.poly[i];
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      if (d.closed) {
        ctx.fillStyle = palette.doorDark || palette.obstacleDark || '#222';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = color;
        ctx.shadowBlur = this.blur(12);
        ctx.shadowColor = color;
        ctx.stroke();
      } else {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(time * 3 + d.i);
        ctx.setLineDash([6, 8]);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** A cart's rail: a thin line with ties. */
  drawRail(rail, palette) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = palette.rail || palette.wall;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(rail.ax, rail.ay);
    ctx.lineTo(rail.bx, rail.by);
    ctx.stroke();
    const dx = rail.bx - rail.ax;
    const dy = rail.by - rail.ay;
    const l = Math.hypot(dx, dy) || 1;
    const px = -dy / l;
    const py = dx / l;
    ctx.lineWidth = 2;
    for (let t = 0; t <= l; t += 40) {
      const x = rail.ax + (dx / l) * t;
      const y = rail.ay + (dy / l) * t;
      ctx.beginPath();
      ctx.moveTo(x - px * 9, y - py * 9);
      ctx.lineTo(x + px * 9, y + py * 9);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Turrets: a disc in the wall with a barrel that tracks its target and glows as a shot comes due. */
  drawTurrets(turrets, palette, now) {
    const ctx = this.ctx;
    const color = palette.turret || palette.obstacle;
    for (const t of turrets) {
      const charge = t.down ? 0 : Math.max(0, 1 - Math.max(0, t.nextAt - now) / t.period);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.beginPath();
      ctx.arc(0, 0, t.r, 0, Math.PI * 2);
      ctx.fillStyle = t.down ? 'rgba(20, 16, 24, 0.95)' : 'rgba(30, 18, 12, 0.95)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = t.down ? 'rgba(120, 120, 140, 0.5)' : color;
      ctx.shadowBlur = this.blur(t.down ? 0 : 6 + 14 * charge);
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;
      // barrel
      ctx.rotate(t.aim);
      ctx.fillStyle = t.down ? 'rgba(120, 120, 140, 0.5)' : color;
      ctx.fillRect(t.r - 6, -5, 18, 10);
      if (!t.down) {
        ctx.beginPath();
        ctx.arc(t.r + 12, 0, 3 + 4 * charge, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 200, 140, ${0.3 + 0.7 * charge})`;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Energy shots: small hot orbs; one you have deflected wears your colour. */
  /** Turret shots wear the level's shot colour; a Blaster charge wears the colour of whoever threw it. */
  drawShots(shots, palette, ownColor, byOwner = null) {
    const ctx = this.ctx;
    const color = palette.shot || '#ff9f6a';
    for (const p of shots) {
      const c = (p.owner && byOwner && byOwner(p.owner)) || (p.deflected ? ownColor : color);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.shadowBlur = this.blur(16);
      ctx.shadowColor = c;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      // a short tail against its motion
      const sp = Math.hypot(p.vx, p.vy) || 1;
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = p.r * 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - (p.vx / sp) * 26, p.y - (p.vy / sp) * 26);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Coolant vents: a grate that charges up toward its next drip. */
  drawVents(vents, color, now) {
    const ctx = this.ctx;
    ctx.save();
    for (const v of vents) {
      const since = now - v.delay;
      const frac = since < 0 ? 0 : (since % v.period) / v.period; // 0 just after a drip, 1 at the next
      ctx.beginPath();
      ctx.arc(v.x, v.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8, 20, 24, 0.9)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.stroke();
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(v.x - 8, v.y + k * 5);
        ctx.lineTo(v.x + 8, v.y + k * 5);
        ctx.stroke();
      }
      // The charge ring swells as the drip comes due.
      ctx.globalAlpha = 0.15 + 0.55 * frac * frac;
      ctx.beginPath();
      ctx.arc(v.x, v.y, 14 + (v.r - 14) * frac, 0, Math.PI * 2);
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawIce(ice, color, time, ownerColor, simNow = 0) {
    const ctx = this.ctx;
    if (ice.patches && ice.patches.length) {
      ctx.save();
      for (const p of ice.patches) {
        const a = clamp(1 - (simNow - p.t) / ice.patchLife, 0, 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(205, 246, 255, ${0.12 + 0.2 * a})`;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.3 + 0.5 * a;
        ctx.stroke();
        // frost
        ctx.lineWidth = 1.5;
        const rot = (p.x + p.y) * 0.05 + time;
        for (let k = 0; k < 3; k++) {
          const ang = rot + (k * Math.PI) / 3;
          const r = p.r * 0.5 * a;
          ctx.beginPath();
          ctx.moveTo(p.x - Math.cos(ang) * r, p.y - Math.sin(ang) * r);
          ctx.lineTo(p.x + Math.cos(ang) * r, p.y + Math.sin(ang) * r);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    const pts = ice.points;
    if (pts.length < 2) return;
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
      // Core tinted with the colour of whoever laid it (their own ice is harmless to them).
      ctx.lineWidth = ice.width * 0.35;
      ctx.globalAlpha = 0.15 + 0.35 * a;
      ctx.strokeStyle = ownerColor || '#ffffff';
      ctx.stroke();
      ctx.globalAlpha = 1;
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
    if (m.kind === 'stone') return; // a body on a rail is drawn as the body it is
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
    ctx.shadowBlur = this.blur(16);
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

  /** The Beacon's signal: a charging glow, then an expanding ring. */
  drawPulse(boss, color, time) {
    const ctx = this.ctx;
    const p = boss.pulser;
    const cd = p.countdown();
    ctx.save();
    if (cd < p.warn && cd > 0) {
      const k = 1 - cd / p.warn;
      ctx.beginPath();
      ctx.arc(boss.x, boss.y, boss.r + 10 + 12 * k, 0, Math.PI * 2);
      ctx.lineWidth = 2 + 3 * k;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.3 + 0.6 * k * (0.6 + 0.4 * Math.sin(time * 40));
      ctx.shadowColor = color;
      ctx.shadowBlur = this.blur(20 * k);
      ctx.stroke();
    }
    const ring = p.ring();
    if (ring) {
      const k = ring.r / p.maxRadius;
      ctx.globalAlpha = 0.9 * (1 - k) + 0.1;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.lineWidth = ring.thick * 2;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = this.blur(24);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowBlur = 0;
      ctx.stroke();
    }
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
      ctx.shadowBlur = this.blur(14);
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
    ctx.shadowBlur = this.blur(14);
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

  /**
   * Blaster's wormholes: each end an opening along its surface in the
   * player's own colour, the light end and the dark end, glowing on the room
   * side. One end alone is dashed and dim: it leads nowhere yet.
   */
  drawPortals(game, time) {
    const ctx = this.ctx;
    for (const [slot, pair] of Object.entries(game.portals)) {
      if (!pair) continue;
      const f = (game.fighters || []).find((x) => x.slot === slot);
      const base = (f && f.color) || '#ffffff';
      const open = !!(pair[0] && pair[1]);
      for (let w = 0; w < 2; w++) {
        const p = pair[w];
        if (!p) continue;
        const color = portalHue(base, w);
        const t = tangent(p);
        const L = p.hw;
        const pulse = 0.75 + 0.25 * Math.sin(time * 4 + w * Math.PI);
        ctx.save();
        ctx.translate(p.cx, p.cy);
        ctx.rotate(Math.atan2(t.y, t.x)); // along the mouth is +x; the room side is -y
        // The glow: a pool of light on the room side, bloomed in the owner's own colour.
        ctx.shadowColor = base;
        ctx.shadowBlur = this.blur(open ? 28 : 12);
        ctx.globalAlpha = (open ? 0.5 : 0.18) * pulse;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(0, -8, L, open ? 16 : 11, 0, 0, Math.PI * 2);
        ctx.fill();
        // The rim along the surface; an end still waiting for its partner is dashed.
        ctx.shadowColor = color;
        ctx.shadowBlur = this.blur(open ? 16 : 6);
        ctx.globalAlpha = open ? 1 : 0.6;
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.lineWidth = open ? 8 : 4;
        if (!open) ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(-L, 0);
        ctx.lineTo(L, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        if (open) {
          // A live pair: a white-hot core, and sparks drifting across the mouth (inward at one end, outward at the other).
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-L * 0.8, 0);
          ctx.lineTo(L * 0.8, 0);
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          for (let k = 0; k < 4; k++) {
            const ph = (time * 0.45 + k / 4) % 1;
            const d = w === 0 ? ph : 1 - ph;
            ctx.globalAlpha = 0.7 * Math.sin(Math.PI * ph);
            ctx.beginPath();
            ctx.arc((k % 2 ? 1 : -1) * L * (0.15 + 0.6 * ((k * 0.37) % 1)), -3 - d * 16, 1.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }
  }

  /** A fighter partway into a mouth: the part still in the room here, and the part already through coming out of the other end. */
  drawFighterThrough(f, m, time) {
    const ctx = this.ctx;
    ctx.save();
    this.clipFront(m.p);
    this.drawFighter(f, time, f.color);
    ctx.restore();
    const o = throughPortal(m.p, m.q, f.x, f.y, 0, 0, f.angle);
    const saved = [f.x, f.y, f.angle];
    [f.x, f.y, f.angle] = [o.x, o.y, o.angle];
    ctx.save();
    this.clipFront(m.q);
    this.drawFighter(f, time, f.color);
    ctx.restore();
    [f.x, f.y, f.angle] = saved;
  }

  /** Clip to the room side of a mouth's surface. */
  clipFront(p) {
    const ctx = this.ctx;
    const t = tangent(p);
    const B = 5000;
    ctx.beginPath();
    ctx.moveTo(p.cx + t.x * B, p.cy + t.y * B);
    ctx.lineTo(p.cx - t.x * B, p.cy - t.y * B);
    ctx.lineTo(p.cx - t.x * B + p.nx * B, p.cy - t.y * B + p.ny * B);
    ctx.lineTo(p.cx + t.x * B + p.nx * B, p.cy + t.y * B + p.ny * B);
    ctx.closePath();
    ctx.clip();
  }

  drawFighter(f, time, color) {
    const ctx = this.ctx;
    const seg = f.paddleSegment();
    const flash = f.hitFlash > 0;
    const blink = f.invuln > 0 && Math.floor(time * 12) % 2 === 0;
    const frozen = f.frozen > 0;
    if (frozen) color = '#cdf6ff';
    ctx.save();
    ctx.globalAlpha = blink ? 0.45 : f.phased ? 0.28 : 1; // a phased drone is barely there
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
      ctx.shadowBlur = this.blur(20);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (f.ghost && !flash) {
      // The Absence: a hole in the grid with a faint, drifting rim.
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.setLineDash([3, 9]);
      ctx.lineDashOffset = -time * 18;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
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
      ctx.shadowBlur = this.blur(14);
      ctx.stroke();
    }

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
    ctx.shadowBlur = this.blur(f.lungeState === 'out' ? 30 : 16);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(seg.ax, seg.ay);
    ctx.lineTo(seg.bx, seg.by);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.stroke();

    // Keep-moving warning: a red ring closes in over the last seconds of standing still.
    const campLeft = PLAYER.campSeconds - f.campTimer;
    if (f.campTimer > 0 && campLeft <= PLAYER.campWarn) {
      const k = clamp(1 - campLeft / PLAYER.campWarn, 0, 1);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r + 30 - 22 * k, 0, Math.PI * 2);
      ctx.lineWidth = 2 + 2 * k;
      ctx.strokeStyle = `rgba(255, 77, 109, ${0.5 + 0.5 * Math.abs(Math.sin(time * 10))})`;
      ctx.shadowColor = '#ff4d6d';
      ctx.shadowBlur = this.blur(12);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Name label.
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(f.name.toUpperCase(), f.x, f.y + f.r + 22);
    ctx.restore();
  }

  drawBall(ball, state) {
    const ctx = this.ctx;
    const t = clamp((ball.speed - BALL.minSpeed) / ((this.maxSpeed || BALL.maxSpeed) - BALL.minSpeed), 0, 1);
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
    ctx.shadowBlur = this.blur(18 + 30 * t);
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
