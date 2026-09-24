// Canvas 2D renderer for Defector: a psychedelic sky, two parallax layers of
// the level's own skyline, Tron-edged ground cached in tiles, and everything
// that moves drawn over it. Neon on dark, like Deflector, with more of the
// real world (and some whimsy) behind it.
import { portalHue, mix } from '../../src/color.js';
import { openPortals } from '../../src/portals.js';
import { ROBOT } from './config.js';
import { seeded } from './build.js';
import { drawRobot, drawEnemy, drawBoss, drawProp, drawPickup, drawCheckpoint, drawSign, drawExit, withAlpha } from './art.js';

const TAU = Math.PI * 2;
const TILE_PX = 512; // world px per cached terrain tile
const MAX_TILES = 80;
const VIEW_H = 720; // world px the screen is tall, outside an arena
const STRIP_W = 2400; // screen px of a parallax strip before it repeats

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1280;
    this.h = 720;
    this.dpr = 1;
    this.base = 1;
    this.scale = 1;
    this.cam = { x: 0, y: 0 };
    this.bp = null;
    this.tiles = new Map();
    this.low = false;
    this.time = 0;
    this.stars = [];
  }

  setQuality(low) {
    this.low = !!low;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.low ? 1 : 2);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.base = Math.min(this.h / VIEW_H, this.w / 1000);
    this.scale = this.scale && this.bp ? this.scale : this.base;
    this.tiles.clear();
    this.tileScale = 0;
    if (this.bp) this.buildStrips();
  }

  /** A new level: its solids indexed for the tiles, and its skyline drawn into strips. */
  setLevel(bp) {
    this.bp = bp;
    this.theme = bp.theme;
    this.tiles.clear();
    this.solidIndex = new Map();
    bp.solids.forEach((s) => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of s.pts) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      s.bbox = { x0, y0, x1, y1 };
      for (let ix = Math.floor((x0 - 40) / TILE_PX); ix <= Math.floor((x1 + 40) / TILE_PX); ix++) {
        for (let iy = Math.floor((y0 - 40) / TILE_PX); iy <= Math.floor((y1 + 40) / TILE_PX); iy++) {
          const k = `${ix},${iy}`;
          if (!this.solidIndex.has(k)) this.solidIndex.set(k, []);
          this.solidIndex.get(k).push(s);
        }
      }
    });
    this.thinIndex = bp.oneWays;
    const rng = seeded((bp.id || 1) * 131);
    this.stars = Array.from({ length: 140 }, () => ({ x: rng(), y: rng() * 0.6, r: 0.5 + rng() * 1.4, tw: rng() * TAU }));
    this.floaters = Array.from({ length: 7 }, () => ({ x: rng(), y: 0.1 + rng() * 0.45, s: 0.6 + rng() * 0.8, ph: rng() * TAU, hue: rng() }));
    this.cam = { x: bp.spawn.x, y: bp.spawn.y - 60 };
    this.scale = this.base;
    this.buildStrips();
  }

  worldToScreen(x, y) {
    return { x: (x - this.cam.x) * this.scale + this.w / 2, y: (y - this.cam.y) * this.scale + this.h / 2 };
  }

  screenToWorld(sx, sy) {
    return { x: (sx - this.w / 2) / this.scale + this.cam.x, y: (sy - this.h / 2) / this.scale + this.cam.y };
  }

  /** Move the camera toward where it should be: ahead of the robot, or holding the arena whole. */
  updateCamera(game, alpha, dt) {
    const bp = this.bp;
    const bot = game.bot;
    const bx = lerp(bot.prevX, bot.x, alpha);
    const by = lerp(bot.prevY, bot.y, alpha);
    let tx = bx + Math.cos(bot.aim) * 90 + clamp(bot.vx * 0.3, -160, 160);
    let ty = by - 50 + clamp(bot.vy * 0.12, -60, 120);
    let scale = this.base;
    const A = bp.arena;
    const inArena = A && ['intro', 'boss', 'bossDown', 'exit'].includes(game.phase) && bx > A.x0 - 40 && bx < A.x1 && by > A.top - 100 && by < A.floor + 60;
    if (inArena) {
      tx = (A.x0 + A.x1) / 2;
      ty = (A.top + A.floor) / 2 - 10;
      scale = Math.min(this.h / (A.h + 110), this.w / (A.w + 80));
    }
    const k = 1 - Math.exp(-dt * (inArena ? 3 : 5));
    const ky = 1 - Math.exp(-dt * (bot.vy > 600 ? 9 : 4));
    if (!this.cam.set || bot.warped) {
      this.cam.x = tx;
      this.cam.y = ty;
      this.cam.set = true;
    } else {
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * (inArena ? k : ky);
    }
    this.scale += (scale - this.scale) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.scale - scale) < 0.001) this.scale = scale;
    // Keep the view inside the level.
    const halfW = this.w / 2 / this.scale;
    const halfH = this.h / 2 / this.scale;
    this.cam.x = clamp(this.cam.x, halfW - 200, bp.width - halfW + 200);
    this.cam.y = clamp(this.cam.y, bp.top + halfH, bp.height - halfH);
  }

  /** Point the camera somewhere directly (the title screen's slow pan). */
  lookAt(x, y) {
    this.cam.x = x;
    this.cam.y = y;
    this.cam.set = true;
    this.scale = this.base;
  }

  // -------------------------------------------------------------- frame

  /**
   * Draw a frame. `ui` carries what the renderer cannot see in the game:
   * guide (the targeting line), sight (a wormhole's aim line and which end),
   * device ('kb' or 'pad', for the signs), paused.
   */
  frame(game, alpha, time, ui = {}) {
    this.time = time;
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawSky(ctx, time);
    this.drawStrips(ctx);
    const fx = game ? game.fx : null;
    const shake = fx && fx.shake > 0 ? fx.shake : 0;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    const s = this.scale;
    const ox = this.w / 2 - this.cam.x * s + sx;
    const oy = this.h / 2 - this.cam.y * s + sy;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    const view = this.viewRect();
    this.drawGrid(ctx, view);
    if (game) this.drawBackDeco(ctx, view, time);
    this.drawTerrain(ctx, view);
    if (!game) return;
    this.drawWorldThings(ctx, game, view, time, alpha, ui);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (game.bp.dark || (game.arena && game.arena.dark && game.phase !== 'play')) this.drawDark(ctx, game, alpha);
    if (this.theme.rain) this.drawRain(ctx, time);
    if (fx && fx.flash > 0) {
      ctx.fillStyle = withAlpha(fx.flashColor, fx.flash * 0.35);
      ctx.fillRect(0, 0, this.w, this.h);
    }
    this.drawVignette(ctx);
  }

  viewRect() {
    const s = this.scale;
    return { x0: this.cam.x - this.w / 2 / s - 60, x1: this.cam.x + this.w / 2 / s + 60, y0: this.cam.y - this.h / 2 / s - 60, y1: this.cam.y + this.h / 2 / s + 60 };
  }

  // ---------------------------------------------------------------- sky

  drawSky(ctx, t) {
    const th = this.theme;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.55, th.sky[1]);
    g.addColorStop(1, th.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    // A slow tide of colour washing across the sky: the psychedelic part.
    const hx = this.w * (0.5 + Math.sin(t * 0.05) * 0.4);
    const wash = ctx.createRadialGradient(hx, this.h * 0.35, 0, hx, this.h * 0.35, this.w * 0.7);
    wash.addColorStop(0, withAlpha(th.edge2, 0.16 + Math.sin(t * 0.3) * 0.05));
    wash.addColorStop(1, withAlpha(th.edge2, 0));
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, this.w, this.h);
    // Stars, twinkling, in the upper sky.
    const px = (this.cam.x * 0.01) % this.w;
    for (const st of this.stars) {
      const a = 0.35 + 0.35 * Math.sin(t * 1.3 + st.tw);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      const x = (((st.x * this.w - px) % this.w) + this.w) % this.w;
      ctx.fillRect(x, st.y * this.h, st.r, st.r);
    }
    // The sun, or moon, or planet: banded rings breathing round a disc, and rays turning behind it.
    const cx = this.w * 0.72 - ((this.cam.x * 0.02) % 200);
    const cy = this.h * 0.24 + clamp(this.cam.y * 0.02, -40, 40);
    const R = Math.min(this.w, this.h) * 0.09;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.03);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(TAU / 12);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(this.w, -40);
      ctx.lineTo(this.w, 40);
      ctx.closePath();
      ctx.fillStyle = withAlpha(i % 2 ? th.sun : th.edge2, 0.035);
      ctx.fill();
    }
    ctx.restore();
    for (let i = 5; i >= 1; i--) {
      const rr = R * (1 + i * 0.35 + Math.sin(t * 0.8 - i) * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, TAU);
      ctx.strokeStyle = withAlpha(i % 2 ? th.sun : th.edge2, 0.08 + 0.03 * Math.sin(t + i));
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    const disc = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    disc.addColorStop(0, '#ffffff');
    disc.addColorStop(0.35, th.sun);
    disc.addColorStop(1, withAlpha(th.sun, 0.2));
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    // Horizontal bands across it, like an eighties sunset.
    ctx.fillStyle = withAlpha(th.sky[1], 0.55);
    for (let i = 0; i < 4; i++) ctx.fillRect(cx - R, cy + R * (0.2 + i * 0.2), R * 2, R * (0.04 + i * 0.03));
    // Whimsy: soft shapes drifting across the sky, each its own colour.
    for (const f of this.floaters) {
      const x = ((((f.x * this.w * 1.6 + t * 12 * f.s - this.cam.x * 0.05) % (this.w * 1.6)) + this.w * 1.6) % (this.w * 1.6)) - this.w * 0.3;
      const y = f.y * this.h + Math.sin(t * 0.6 + f.ph) * 10;
      const col = f.hue < 0.5 ? th.edge : th.edge2;
      drawFloater(ctx, th.far, x, y, 18 * f.s, col, t + f.ph);
    }
  }

  /** Two strips of skyline, drawn once for the level and slid at their own parallax. */
  buildStrips() {
    const th = this.theme;
    const h = Math.ceil(this.h);
    const make = (layer) => {
      const c = document.createElement('canvas');
      c.width = STRIP_W;
      c.height = h;
      const g = c.getContext('2d');
      const rng = seeded((this.bp.id || 1) * 977 + layer * 31);
      drawSkyline(g, th, th.far, layer, STRIP_W, h, rng);
      return c;
    };
    this.strips = [make(0), make(1)];
  }

  drawStrips(ctx) {
    if (!this.strips) return;
    const factors = [0.08, 0.22];
    this.strips.forEach((c, i) => {
      const f = factors[i];
      const off = ((this.cam.x * f) % STRIP_W + STRIP_W) % STRIP_W;
      const dy = clamp(-(this.cam.y - (this.bp.spawn.y - 60)) * f * 0.6, -this.h * 0.25, this.h * 0.35);
      for (let x = -off; x < this.w; x += STRIP_W) ctx.drawImage(c, x, dy);
    });
  }

  // --------------------------------------------------------------- grid

  drawGrid(ctx, v) {
    const step = 80;
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    for (let x = Math.floor(v.x0 / step) * step; x < v.x1; x += step) {
      ctx.moveTo(x, v.y0);
      ctx.lineTo(x, v.y1);
    }
    for (let y = Math.floor(v.y0 / step) * step; y < v.y1; y += step) {
      ctx.moveTo(v.x0, y);
      ctx.lineTo(v.x1, y);
    }
    ctx.stroke();
  }

  // ------------------------------------------------------------ terrain

  drawTerrain(ctx, v) {
    const s = this.scale;
    if (Math.abs(this.tileScale - s) > 0.02) {
      this.tiles.clear();
      this.tileScale = s;
    }
    const ts = this.tileScale;
    for (let ix = Math.floor(v.x0 / TILE_PX); ix <= Math.floor(v.x1 / TILE_PX); ix++) {
      for (let iy = Math.floor(v.y0 / TILE_PX); iy <= Math.floor(v.y1 / TILE_PX); iy++) {
        const k = `${ix},${iy}`;
        let tile = this.tiles.get(k);
        if (!tile) {
          tile = this.renderTile(ix, iy, ts);
          this.tiles.set(k, tile);
          if (this.tiles.size > MAX_TILES) this.tiles.delete(this.tiles.keys().next().value);
        } else {
          this.tiles.delete(k);
          this.tiles.set(k, tile);
        }
        if (tile.empty) continue;
        ctx.drawImage(tile.canvas, ix * TILE_PX, iy * TILE_PX, TILE_PX, TILE_PX);
      }
    }
  }

  renderTile(ix, iy, ts) {
    const list = this.solidIndex.get(`${ix},${iy}`) || [];
    const x0 = ix * TILE_PX;
    const y0 = iy * TILE_PX;
    const thins = this.thinIndex.filter((p) => p.x1 > x0 - 20 && p.x0 < x0 + TILE_PX + 20 && p.y > y0 - 20 && p.y < y0 + TILE_PX + 20);
    if (!list.length && !thins.length) return { empty: true };
    const px = Math.ceil(TILE_PX * ts * this.dpr);
    const c = document.createElement('canvas');
    c.width = px;
    c.height = px;
    const g = c.getContext('2d');
    const k = (ts * this.dpr);
    g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
    g.beginPath();
    g.rect(x0, y0, TILE_PX, TILE_PX);
    g.clip();
    const th = this.theme;
    for (const sd of list) drawSolid(g, sd, th, this.low);
    for (const p of thins) drawThin(g, p, th, this.low);
    return { canvas: c, empty: false };
  }

  // ---------------------------------------------------------- the world

  drawBackDeco(ctx, v, t) {
    const bp = this.bp;
    for (const d of bp.deco) {
      if (d.layer !== 'back' || d.x < v.x0 - 200 || d.x > v.x1 + 200 || d.y < v.y0 - 100 || d.y > v.y1 + 600) continue;
      drawProp(ctx, d, this.theme, t, false);
    }
  }

  drawWorldThings(ctx, game, v, t, alpha, ui) {
    const bp = this.bp;
    const w = game.world;
    const th = this.theme;
    const within = (x, y, m = 120) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;

    // Pits: a glow from far below.
    for (const p of bp.pits) {
      if (p.x1 < v.x0 || p.x0 > v.x1) continue;
      const g = ctx.createLinearGradient(0, p.y - 300, 0, p.y + 200);
      g.addColorStop(0, withAlpha(th.edge2, 0));
      g.addColorStop(1, withAlpha(th.edge2, 0.18));
      ctx.fillStyle = g;
      ctx.fillRect(p.x0, p.y - 300, p.x1 - p.x0, 700);
    }
    // Signs and checkpoints.
    for (const sg of bp.signs) if (within(sg.x, sg.y)) drawSign(ctx, sg, th, ui.device || 'kb', game.bot);
    for (const c of game.checkpoints) if (!c.hidden && within(c.x, c.y)) drawCheckpoint(ctx, c, th, t);
    // Wells: a black hole's disc and its reach; a white hole's glare.
    for (const wl of w.wells) if (within(wl.x, wl.y, wl.range)) drawWell(ctx, wl, t);
    // Pulse rings.
    for (const p of w.pulsers) {
      if (!p.oneShot && within(p.sx, p.sy, 60)) {
        const warn = p.countdown() < p.warn;
        ctx.fillStyle = withAlpha(th.edge2, warn ? 0.8 : 0.35);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 12 + (warn ? Math.sin(t * 30) * 3 : 0), Math.PI, TAU);
        ctx.fill();
      }
      const r = p.ring();
      if (r) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, TAU);
        ctx.strokeStyle = withAlpha(p.color || th.edge2, 0.75 * (1 - r.r / (p.maxRadius + 1)) + 0.15);
        ctx.lineWidth = r.thick;
        glow(ctx, p.color || th.edge2, 16, this.low);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    // Lasers.
    for (const l of w.lasers) {
      if (!within(l.x, (l.y0 + l.y1) / 2, 400)) continue;
      ctx.fillStyle = withAlpha('#ff5c7a', 0.9);
      ctx.fillRect(l.x - 10, l.y0 - 6, 20, 10);
      ctx.fillRect(l.x - 10, l.y1 - 4, 20, 6);
      if (l.on) {
        ctx.strokeStyle = '#ffd0da';
        ctx.lineWidth = 5;
        glow(ctx, '#ff5c7a', 18, this.low);
        ctx.beginPath();
        ctx.moveTo(l.x, l.y0);
        ctx.lineTo(l.x, l.y1);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (l.warn) {
        ctx.strokeStyle = withAlpha('#ff5c7a', 0.35 + 0.25 * Math.sin(t * 40));
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.moveTo(l.x, l.y0);
        ctx.lineTo(l.x, l.y1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Moving platforms, crushers and blinking platforms.
    for (const m of w.movers) {
      if (!within(m.x + m.w / 2, m.y, m.w + 200)) continue;
      drawMover(ctx, m, th, t, this.low);
    }
    // Springs.
    for (const sp of w.springs) {
      if (!within(sp.x, sp.y)) continue;
      const sq = sp.squash;
      ctx.fillStyle = '#1a2a12';
      ctx.fillRect(sp.x, sp.y, sp.w, 14);
      ctx.strokeStyle = '#9dff5c';
      ctx.lineWidth = 2;
      glow(ctx, '#9dff5c', 10, this.low);
      ctx.beginPath();
      const top = sp.y - 10 + sq * 8;
      for (let i = 0; i <= 6; i++) ctx.lineTo(sp.x + 8 + ((sp.w - 16) * i) / 6, i % 2 ? top + 8 : top);
      ctx.stroke();
      ctx.fillStyle = '#9dff5c';
      ctx.fillRect(sp.x + 4, top - 4, sp.w - 8, 5);
      ctx.shadowBlur = 0;
    }
    // Crates and glass.
    for (const c of w.crates) {
      if (c.broken || !within(c.x, c.y)) continue;
      drawCrate(ctx, c, th, this.low);
    }
    // Gates (an ambush room's doors, the arena's).
    for (const gt of w.gates) {
      if (!gt.closed || !within(gt.x, gt.y1)) continue;
      ctx.fillStyle = withAlpha('#ff4fd8', 0.25);
      ctx.fillRect(gt.x - 10, gt.y0, 20, gt.y1 - gt.y0);
      ctx.strokeStyle = '#ff4fd8';
      ctx.lineWidth = 2;
      glow(ctx, '#ff4fd8', 12, this.low);
      for (let y = gt.y0 + 10; y < gt.y1; y += 22) {
        ctx.beginPath();
        ctx.moveTo(gt.x - 10, y);
        ctx.lineTo(gt.x + 10, y + 11);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    // Wormholes.
    for (const p of openPortals(w).concat(Object.values(w.portals).flatMap((pair) => (pair && !(pair[0] && pair[1]) ? pair.filter(Boolean) : [])))) drawPortal(ctx, p, game, t, this.low);
    // Pickups.
    for (const p of game.pickups) if (within(p.x, p.y)) drawPickup(ctx, p, t, this.low);
    // The exit beacon.
    if (game.exit) drawExit(ctx, game.exit, t);
    // Boss hazards.
    for (const h of game.hazards) drawHazard(ctx, h, t, this.low);
    // Enemies.
    for (const e of game.enemies) {
      if (e.dead || !within(e.x, e.y)) continue;
      drawEnemy(ctx, e, t, alpha, this.low);
    }
    // The boss.
    if (game.boss && !game.boss.dead) drawBoss(ctx, game.boss, t, alpha, game.phase, this.low);
    // Enemy shots.
    for (const c of game.shots) {
      if (!within(c.x, c.y)) continue;
      drawShot(ctx, c, t, alpha, this.low);
    }
    // Aim lines, under the robot.
    if (ui.guide) drawGuide(ctx, ui.guide, game.spec.color, this.scale);
    if (ui.sight) drawSight(ctx, ui.sight, t, this.scale);
    // The robot.
    if (game.phase !== 'down') drawRobot(ctx, game.bot, t, alpha, { loaded: game.loaded, low: this.low, charging: game.cool > 0 });
    // Charges.
    for (const c of game.charges) drawCharge(ctx, c, t, alpha, this.low);
    // Front scenery.
    for (const d of bp.deco) {
      if (d.layer !== 'front' || d.x < v.x0 - 200 || d.x > v.x1 + 200 || d.y < v.y0 - 100 || d.y > v.y1 + 600) continue;
      drawProp(ctx, d, th, t, true);
    }
    // Particles and words.
    drawFx(ctx, game.fx, this.low);
  }

  // ----------------------------------------------------------- overlays

  /** Dark levels: everything black but what glows (Deflector's Undercroft, at half resolution). */
  drawDark(ctx, game, alpha) {
    const scale = 0.5;
    const W = Math.ceil(this.w * scale);
    const H = Math.ceil(this.h * scale);
    if (!this.dark || this.dark.width !== W || this.dark.height !== H) {
      this.dark = document.createElement('canvas');
      this.dark.width = W;
      this.dark.height = H;
    }
    const d = this.dark.getContext('2d');
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    d.fillStyle = 'rgba(0, 2, 8, 0.84)'; // dark, but the neon edges still show: a jump has to be seen to be fair
    d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r) => {
      const p = this.worldToScreen(x, y);
      const sx = p.x * scale;
      const sy = p.y * scale;
      const rr = r * this.scale * scale;
      if (sx < -rr || sy < -rr || sx > W + rr || sy > H + rr) return;
      const g = d.createRadialGradient(sx, sy, 0, sx, sy, rr);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.75)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.beginPath();
      d.arc(sx, sy, rr, 0, TAU);
      d.fill();
    };
    const bot = game.bot;
    hole(lerp(bot.prevX, bot.x, alpha), lerp(bot.prevY, bot.y, alpha), 330);
    for (const c of game.charges) hole(c.x, c.y, 110 + c.r * 2);
    for (const c of game.shots) hole(c.x, c.y, 60);
    for (const p of game.pickups) hole(p.x, p.y, 80);
    for (const c of game.checkpoints) if (!c.hidden) hole(c.x, c.y - 40, c.on ? 200 : 90);
    for (const p of openPortals(game.world)) hole(p.cx, p.cy, 140);
    for (const w of game.world.wells) if (w.fount) hole(w.x, w.y, 200);
    for (const e of game.enemies) if (!e.dead && (e.kind === 'wisp' || e.kind === 'drifter' || e.kind === 'urchin')) hole(e.x, e.y, 90);
    if (game.boss && !game.boss.dead) hole(game.boss.x, game.boss.y, 240);
    if (game.exit) hole(game.exit.x, game.exit.y, 240);
    for (const sg of game.bp.signs) hole(sg.x, sg.y - 60, 120);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.dark, 0, 0, this.w, this.h);
    ctx.restore();
  }

  drawRain(ctx, t) {
    ctx.strokeStyle = 'rgba(180, 210, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const n = 90;
    for (let i = 0; i < n; i++) {
      const x = ((i * 137.5 + t * 90 - this.cam.x * 0.6) % (this.w + 100) + this.w + 100) % (this.w + 100) - 50;
      const y = ((i * 97.3 + t * 700) % (this.h + 60)) - 30;
      ctx.moveTo(x, y);
      ctx.lineTo(x - 6, y + 18);
    }
    ctx.stroke();
  }

  drawVignette(ctx) {
    const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.45, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }
}

// ---------------------------------------------------------------- helpers

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function glow(ctx, color, blur, low) {
  if (low) return;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

/** A solid: dark fill with the theme's circuitry in it, and a neon edge. */
function drawSolid(g, sd, th, low) {
  const pts = sd.pts;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  const kind = sd.kind;
  if (kind === 'spikes') {
    const b = sd.bbox;
    g.fillStyle = '#2a0710';
    g.fill();
    g.beginPath();
    for (let x = b.x0; x < b.x1; x += 14) {
      g.moveTo(x, b.y1);
      g.lineTo(x + 7, b.y0 - 10);
      g.lineTo(x + 14, b.y1);
    }
    g.fillStyle = '#ff5c7a';
    if (!low) {
      g.shadowColor = '#ff5c7a';
      g.shadowBlur = 10;
    }
    g.fill();
    g.shadowBlur = 0;
    return;
  }
  if (kind === 'spring') return;
  if (kind === 'bulkhead') {
    // A bulkhead: hazard-striped, so it reads as a wall nothing climbs or breaks.
    const b = sd.bbox;
    g.fillStyle = mix(th.ground, '#ffb347', 0.1);
    g.fill();
    g.save();
    g.clip();
    g.strokeStyle = 'rgba(255, 179, 71, 0.22)';
    g.lineWidth = 10;
    g.beginPath();
    for (let y = b.y0 - (b.x1 - b.x0); y < b.y1; y += 36) {
      g.moveTo(b.x0, y);
      g.lineTo(b.x1, y + (b.x1 - b.x0));
    }
    g.stroke();
    g.restore();
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.strokeStyle = '#ffb347';
    g.lineWidth = 3;
    if (!low) {
      g.shadowColor = '#ffb347';
      g.shadowBlur = 12;
    }
    g.stroke();
    g.shadowBlur = 0;
    return;
  }
  const fill = kind === 'block' ? mix(th.ground, th.edge2, 0.12) : kind === 'arena' ? mix(th.ground, '#ffffff', 0.05) : th.ground;
  g.fillStyle = fill;
  g.fill();
  // Circuit traces inside: a grid of faint lines and a few bright nodes.
  g.save();
  g.clip();
  const b = sd.bbox;
  g.strokeStyle = withAlpha(kind === 'block' ? th.edge2 : th.edge, 0.07);
  g.lineWidth = 1;
  g.beginPath();
  for (let x = Math.floor(b.x0 / 40) * 40; x < b.x1; x += 40) {
    g.moveTo(x, b.y0);
    g.lineTo(x, Math.min(b.y1, b.y0 + 2400));
  }
  for (let y = Math.floor(b.y0 / 40) * 40; y < Math.min(b.y1, b.y0 + 2400); y += 40) {
    g.moveTo(b.x0, y);
    g.lineTo(b.x1, y);
  }
  g.stroke();
  // A band of colour just under the surface, fading down.
  const top = b.y0;
  const grad = g.createLinearGradient(0, top, 0, top + 160);
  grad.addColorStop(0, withAlpha(th.edge, 0.16));
  grad.addColorStop(1, withAlpha(th.edge, 0));
  g.fillStyle = grad;
  g.fillRect(b.x0, top, b.x1 - b.x0, 160);
  g.restore();
  // The edge: the outline again (restore() brings back the clip, not the path).
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.strokeStyle = kind === 'block' ? th.edge2 : th.edge;
  g.lineWidth = 2.5;
  if (!low) {
    g.shadowColor = g.strokeStyle;
    g.shadowBlur = 12;
  }
  g.stroke();
  g.shadowBlur = 0;
  // Walkable tops get a bright line of their own.
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1 || Math.abs(dy) / len > 0.8) continue;
    // Only faces pointing up: probe just above the middle.
    const mx = (a[0] + c[0]) / 2;
    const my = (a[1] + c[1]) / 2;
    if (!insidePoly(mx, my - 2, pts) && insidePoly(mx, my + 2, pts)) {
      g.moveTo(a[0], a[1] + 1.5);
      g.lineTo(c[0], c[1] + 1.5);
    }
  }
  g.stroke();
}

function insidePoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function drawThin(g, p, th, low) {
  g.fillStyle = withAlpha(th.edge2, 0.18);
  g.fillRect(p.x0, p.y, p.x1 - p.x0, 10);
  g.strokeStyle = th.edge2;
  g.lineWidth = 3;
  if (!low) {
    g.shadowColor = th.edge2;
    g.shadowBlur = 10;
  }
  g.beginPath();
  g.moveTo(p.x0, p.y);
  g.lineTo(p.x1, p.y);
  g.stroke();
  g.shadowBlur = 0;
  g.setLineDash([4, 6]);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(p.x0 + 4, p.y + 10);
  g.lineTo(p.x1 - 4, p.y + 10);
  g.stroke();
  g.setLineDash([]);
}

function drawMover(ctx, m, th, t, low) {
  if (m.kind === 'phase') {
    const fade = m.present ? Math.min(1, m.phaseLeft / 0.6) : 0;
    const blink = m.present && m.phaseLeft < 0.8 ? 0.5 + 0.5 * Math.sin(t * 30) : 1;
    ctx.globalAlpha = m.present ? 0.35 + 0.65 * blink * Math.max(0.3, fade) : 0.18;
    ctx.strokeStyle = th.edge;
    ctx.setLineDash(m.present ? [] : [5, 6]);
    ctx.lineWidth = 2;
    ctx.fillStyle = withAlpha(th.edge, m.present ? 0.25 : 0.05);
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }
  const shaking = m.path.type === 'fall' && m.fallT >= 0 && m.fallT < (m.path.delay ?? 0.5);
  if (shaking) {
    ctx.save();
    ctx.translate((Math.random() - 0.5) * 3, 0);
  }
  const crusher = m.kind === 'crusher';
  const col = crusher ? '#ff5c7a' : m.path.type === 'fall' ? '#ffb347' : th.edge2;
  if (crusher) {
    // The rod it hangs from.
    ctx.strokeStyle = withAlpha('#ffffff', 0.25);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(m.x + m.w / 2, m.by - 10);
    ctx.lineTo(m.x + m.w / 2, m.y);
    ctx.stroke();
  }
  ctx.fillStyle = crusher ? '#2a0a14' : m.oneWay ? withAlpha(col, 0.2) : mix(th.ground, col, 0.15);
  ctx.fillRect(m.x, m.y, m.w, m.oneWay ? 10 : m.h);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  glow(ctx, col, 12, low);
  if (m.oneWay) {
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x + m.w, m.y);
    ctx.stroke();
  } else ctx.strokeRect(m.x, m.y, m.w, m.h);
  ctx.shadowBlur = 0;
  if (crusher) {
    ctx.fillStyle = '#ff5c7a';
    ctx.beginPath();
    for (let x = m.x; x < m.x + m.w; x += 12) {
      ctx.moveTo(x, m.y + m.h);
      ctx.lineTo(x + 6, m.y + m.h + 8);
      ctx.lineTo(x + 12, m.y + m.h);
    }
    ctx.fill();
  } else if (!m.oneWay) {
    // Little thrusters underneath.
    ctx.fillStyle = withAlpha(col, 0.5 + 0.3 * Math.sin(t * 20));
    ctx.fillRect(m.x + 8, m.y + m.h, 10, 4 + Math.random() * 3);
    ctx.fillRect(m.x + m.w - 18, m.y + m.h, 10, 4 + Math.random() * 3);
  }
  if (shaking) ctx.restore();
}

function drawCrate(ctx, c, th, low) {
  const flash = c.flash > 0;
  if (c.kind === 'glass') {
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.6)' : 'rgba(160, 220, 255, 0.18)';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = '#bfe8ff';
    ctx.lineWidth = 2;
    glow(ctx, '#7fe9ff', 10, low);
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    for (let y = c.y + 20; y < c.y + c.h; y += 34) {
      ctx.moveTo(c.x + 2, y);
      ctx.lineTo(c.x + c.w - 2, y + 10);
    }
    ctx.stroke();
    if (c.hp < c.maxHp) {
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(c.x + c.w / 2, c.y + c.h * 0.3);
      ctx.lineTo(c.x + 2, c.y + c.h * 0.5);
      ctx.lineTo(c.x + c.w - 2, c.y + c.h * 0.65);
      ctx.stroke();
    }
    return;
  }
  ctx.fillStyle = flash ? '#fff4d6' : '#2a1a08';
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.strokeStyle = c.drop ? '#ffd23f' : '#ffb347';
  ctx.lineWidth = 2.5;
  glow(ctx, ctx.strokeStyle, 10, low);
  ctx.strokeRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c.x + 4, c.y + 4);
  ctx.lineTo(c.x + c.w - 4, c.y + c.h - 4);
  ctx.moveTo(c.x + c.w - 4, c.y + 4);
  ctx.lineTo(c.x + 4, c.y + c.h - 4);
  ctx.stroke();
  if (c.drop) {
    ctx.fillStyle = '#ffd23f';
    ctx.font = `bold ${Math.min(c.h, c.w) * 0.6}px Orbitron, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', c.x + c.w / 2, c.y + c.h / 2 + 1);
  }
  if (c.hp < c.maxHp) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c.x + c.w * 0.3, c.y);
    ctx.lineTo(c.x + c.w * 0.45, c.y + c.h * 0.5);
    ctx.lineTo(c.x + c.w * 0.35, c.y + c.h);
    ctx.stroke();
  }
}

function drawWell(ctx, w, t) {
  if (w.absent) {
    ctx.strokeStyle = 'rgba(180,156,255,0.15)';
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  if (w.fount) {
    const g = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, w.range);
    g.addColorStop(0, 'rgba(255, 244, 200, 0.55)');
    g.addColorStop(0.15, 'rgba(255, 241, 184, 0.18)');
    g.addColorStop(1, 'rgba(255, 241, 184, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.range, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff1b8';
    ctx.beginPath();
    ctx.arc(w.x, w.y, w.r, 0, TAU);
    ctx.fill();
    // Rings pushing outward.
    for (let i = 0; i < 3; i++) {
      const r = w.r + ((t * 60 + i * (w.range / 3)) % w.range);
      ctx.strokeStyle = `rgba(255, 241, 184, ${0.4 * (1 - r / w.range)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(w.x, w.y, r, 0, TAU);
      ctx.stroke();
    }
    return;
  }
  // Reach: a dotted ring, and rings falling inward.
  ctx.strokeStyle = 'rgba(180, 156, 255, 0.25)';
  ctx.setLineDash([3, 10]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(w.x, w.y, w.range, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 3; i++) {
    const r = w.range - ((t * 70 + i * (w.range / 3)) % (w.range - w.r));
    ctx.strokeStyle = `rgba(180, 156, 255, ${0.3 * (1 - r / w.range)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(w.x, w.y, r, 0, TAU);
    ctx.stroke();
  }
  // Accretion disc, swirling.
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.rotate(t * 1.5);
  for (let i = 0; i < 3; i++) {
    ctx.rotate(TAU / 3);
    ctx.strokeStyle = i % 2 ? 'rgba(255, 140, 220, 0.7)' : 'rgba(180, 156, 255, 0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, w.r * 2, w.r * 0.8, 0, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(w.x, w.y, w.r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#d7c8ff';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function portalColor(game, p) {
  if (p.owner === 1 && game.boss) return portalHue(game.boss.color.length === 7 ? game.boss.color : '#ffffff', p.which);
  return portalHue(ROBOT.color, p.which);
}

function drawPortal(ctx, p, game, t, low) {
  const col = portalColor(game, p);
  const open = !!(game.world.portals[p.owner] && game.world.portals[p.owner][0] && game.world.portals[p.owner][1]);
  const tx = -p.ny;
  const ty = p.nx;
  ctx.save();
  ctx.translate(p.cx, p.cy);
  ctx.rotate(Math.atan2(ty, tx));
  // The mouth: a lens of light lying along the surface, bulging out of it.
  const hw = p.hw;
  ctx.beginPath();
  ctx.ellipse(0, 0, hw, open ? 16 : 8, 0, 0, TAU);
  ctx.fillStyle = withAlpha(col, open ? 0.35 : 0.12);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = open ? 4 : 2;
  if (!open) ctx.setLineDash([6, 6]);
  if (!low) {
    ctx.shadowColor = col;
    ctx.shadowBlur = open ? 22 : 8;
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (open) {
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw * 0.8, 5, 0, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 5; i++) {
      const u = ((t * 0.7 + i / 5) % 1) * 2 - 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(u * hw * 0.9, -Math.sin((u + 1) * Math.PI) * 12, 2, 2);
    }
  }
  ctx.restore();
}

function drawHazard(ctx, h, t, low) {
  if (h.type === 'column') {
    const live = h.age > h.warn;
    const rise = live ? Math.min(1, (h.age - h.warn) / 0.18) : 0;
    if (!live) {
      ctx.fillStyle = withAlpha(h.color, 0.18 + 0.15 * Math.sin(t * 30));
      ctx.fillRect(h.x - h.w / 2, h.y1 - 10, h.w, 10);
      return;
    }
    const top = h.y1 - (h.y1 - h.y0) * rise;
    ctx.fillStyle = withAlpha(h.color, 0.35);
    ctx.fillRect(h.x - h.w / 2, top, h.w, h.y1 - top);
    ctx.strokeStyle = h.color;
    ctx.lineWidth = 3;
    glow(ctx, h.color, 14, low);
    ctx.beginPath();
    for (let y = h.y1; y > top; y -= 20) ctx.lineTo(h.x + Math.sin(y * 0.08 + t * 10) * h.w * 0.35, y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (h.type === 'beam') {
    const len = h.len || 1600;
    const dx = Math.cos(h.angle);
    const dy = Math.sin(h.angle);
    ctx.strokeStyle = h.live ? h.color : withAlpha(h.color, 0.35 + 0.2 * Math.sin(t * 35));
    ctx.lineWidth = h.live ? h.width : 2;
    if (!h.live) ctx.setLineDash([8, 10]);
    glow(ctx, h.color, h.live ? 24 : 6, low);
    ctx.beginPath();
    ctx.moveTo(h.x + dx * 50, h.y + dy * 50);
    ctx.lineTo(h.x + dx * len, h.y + dy * len);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    if (h.live) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = h.width * 0.3;
      ctx.beginPath();
      ctx.moveTo(h.x + dx * 50, h.y + dy * 50);
      ctx.lineTo(h.x + dx * len, h.y + dy * len);
      ctx.stroke();
    }
  }
}

function drawCharge(ctx, c, t, alpha, low) {
  const x = c.warped ? c.x : lerp(c.prevX, c.x, alpha);
  const y = c.warped ? c.y : lerp(c.prevY, c.y, alpha);
  // Tail along the velocity.
  const sp = Math.hypot(c.vx, c.vy) || 1;
  const tl = Math.min(60, sp * 0.05) + c.r;
  const g = ctx.createLinearGradient(x, y, x - (c.vx / sp) * tl, y - (c.vy / sp) * tl);
  g.addColorStop(0, withAlpha(c.color, 0.7));
  g.addColorStop(1, withAlpha(c.color, 0));
  ctx.strokeStyle = g;
  ctx.lineWidth = c.r * 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - (c.vx / sp) * tl, y - (c.vy / sp) * tl);
  ctx.stroke();
  ctx.lineCap = 'butt';
  if (!low) {
    ctx.shadowColor = c.color;
    ctx.shadowBlur = 18;
  }
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.arc(x, y, c.r, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, c.r * 0.55, 0, TAU);
  ctx.fill();
  // Three turning ticks, as Deflector's loaded charge has.
  ctx.strokeStyle = withAlpha(c.color, 0.8);
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const a = t * 6 + (i * TAU) / 3;
    ctx.beginPath();
    ctx.arc(x, y, c.r + 4, a, a + 0.6);
    ctx.stroke();
  }
  if (c.freeze) {
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3 + t * 2;
      ctx.moveTo(x + Math.cos(a) * c.r * 0.9, y + Math.sin(a) * c.r * 0.9);
      ctx.lineTo(x - Math.cos(a) * c.r * 0.9, y - Math.sin(a) * c.r * 0.9);
    }
    ctx.stroke();
  }
}

function drawShot(ctx, c, t, alpha, low) {
  const x = c.warped ? c.x : lerp(c.prevX, c.x, alpha);
  const y = c.warped ? c.y : lerp(c.prevY, c.y, alpha);
  if (!low) {
    ctx.shadowColor = c.color;
    ctx.shadowBlur = 12;
  }
  if (c.look === 'lantern') {
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath();
    ctx.ellipse(x, y, c.r * 0.8, c.r, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff1b8';
    ctx.fillRect(x - 2, y - c.r * 0.5, 4, c.r);
  } else if (c.look === 'seed') {
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(x, y, c.r, c.r * 0.7, t * 8, 0, TAU);
    ctx.fill();
  } else if (c.look === 'bubble') {
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, c.r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(x - c.r * 0.4, y - c.r * 0.5, 3, 3);
  } else {
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(x, y, c.r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, c.r * 0.45, 0, TAU);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

/** The targeting line: dotted, fading along its length, a ring where it bounces. */
function drawGuide(ctx, lines, color, scale) {
  for (const legs of lines) {
    let n = 0;
    let total = 0;
    for (const leg of legs) total += leg.length;
    for (const leg of legs) {
      for (let i = 0; i < leg.length; i += 2) {
        const a = 1 - n / Math.max(1, total);
        n += 2;
        if (i % 6) continue;
        ctx.fillStyle = withAlpha(color, 0.15 + 0.7 * a);
        ctx.beginPath();
        ctx.arc(leg[i][0], leg[i][1], 2.6 / Math.sqrt(scale), 0, TAU);
        ctx.fill();
      }
      const end = leg[leg.length - 1];
      if (end && legs.length > 1) {
        ctx.strokeStyle = withAlpha(color, 0.6);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(end[0], end[1], 8, 0, TAU);
        ctx.stroke();
      }
    }
  }
}

/** A wormhole's aim line: dashed in the end's own shade, and the end itself ghosted where it will land. */
function drawSight(ctx, s, t, scale) {
  const col = portalHue(ROBOT.color, s.which);
  const line = s.line;
  ctx.strokeStyle = withAlpha(col, 0.85);
  ctx.lineWidth = 2 / Math.sqrt(scale);
  ctx.setLineDash([10, 8]);
  ctx.lineDashOffset = -t * 60;
  ctx.beginPath();
  line.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  const end = line.pts[line.pts.length - 1];
  if (s.place) {
    const p = s.place;
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate(Math.atan2(p.nx, -p.ny));
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.55 + 0.35 * Math.sin(t * 10);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.hw, 10, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  } else if (end) {
    ctx.strokeStyle = '#ff5c7a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(end[0] - 9, end[1] - 9);
    ctx.lineTo(end[0] + 9, end[1] + 9);
    ctx.moveTo(end[0] + 9, end[1] - 9);
    ctx.lineTo(end[0] - 9, end[1] + 9);
    ctx.stroke();
  }
}

function drawFx(ctx, fx, low) {
  for (const p of fx.parts) {
    const a = 1 - p.age / p.life;
    ctx.fillStyle = withAlpha(p.color, a);
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  for (const r of fx.rings) {
    const u = r.age / r.life;
    ctx.strokeStyle = withAlpha(r.color, (1 - u) * 0.8);
    ctx.lineWidth = r.width * (1 - u) + 0.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.maxR * (0.2 + 0.8 * Math.sqrt(u)), 0, TAU);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const w of fx.words) {
    const a = Math.min(1, (1 - w.age / w.life) * 2);
    ctx.font = '700 18px Orbitron, sans-serif';
    ctx.fillStyle = withAlpha(w.color, a);
    if (!low) {
      ctx.shadowColor = w.color;
      ctx.shadowBlur = 10;
    }
    ctx.fillText(w.text, w.x, w.y);
    ctx.shadowBlur = 0;
  }
}

/** A drifting shape in the sky, each theme its own. */
function drawFloater(ctx, far, x, y, s, col, t) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  if (far === 'deep') {
    // A jellyfish drifting up.
    ctx.beginPath();
    ctx.arc(0, 0, s, Math.PI, TAU);
    ctx.stroke();
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.35, 0);
      ctx.quadraticCurveTo(i * s * 0.35 + Math.sin(t * 2 + i) * 6, s, i * s * 0.35, s * 1.8);
      ctx.stroke();
    }
  } else if (far === 'carnival' || far === 'orchard') {
    // A balloon on a string.
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.7, s * 0.9, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, s * 0.9);
    ctx.quadraticCurveTo(Math.sin(t) * 6, s * 1.6, 0, s * 2.4);
    ctx.stroke();
  } else if (far === 'sea' || far === 'market') {
    // A paper lantern or a gull.
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.quadraticCurveTo(-s * 0.5, -s * 0.6 * (1 + Math.sin(t * 3) * 0.3), 0, 0);
    ctx.quadraticCurveTo(s * 0.5, -s * 0.6 * (1 + Math.sin(t * 3) * 0.3), s, 0);
    ctx.stroke();
  } else {
    // A slow-turning geometric shape: the grid's own idea of a cloud.
    ctx.rotate(t * 0.2);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) ctx.lineTo(Math.cos((i * TAU) / 6) * s, Math.sin((i * TAU) / 6) * s);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * One strip of skyline. Layer 0 is the far one (paler, smaller), layer 1
 * the near one (darker, bigger). Real places, drawn in neon outline.
 */
function drawSkyline(g, th, far, layer, W, H, rng) {
  const base = H * (layer === 0 ? 0.62 : 0.74);
  const col = layer === 0 ? mix(th.sky[1], th.edge, 0.25) : mix(th.sky[1], '#000000', 0.45);
  const line = withAlpha(layer === 0 ? th.edge2 : th.edge, layer === 0 ? 0.35 : 0.55);
  g.lineWidth = layer === 0 ? 1.5 : 2;
  g.strokeStyle = line;
  g.fillStyle = col;
  const ground = () => {
    g.fillRect(0, base, W, H - base);
    g.beginPath();
    g.moveTo(0, base);
    g.lineTo(W, base);
    g.stroke();
  };
  const sc = layer === 0 ? 0.7 : 1.1;
  switch (far) {
    case 'orchard': {
      // Rolling hills, round trees in rows, a windmill turning somewhere.
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) g.lineTo(x, base - 30 * sc - Math.sin(x * 0.004 + layer) * 40 * sc - Math.sin(x * 0.011) * 16 * sc);
      g.lineTo(W, H);
      g.closePath();
      g.fill();
      g.stroke();
      for (let x = 30; x < W - 30; x += (60 + rng() * 60) * sc) {
        const y = base - 30 * sc - Math.sin(x * 0.004 + layer) * 40 * sc - Math.sin(x * 0.011) * 16 * sc;
        const r = (14 + rng() * 14) * sc;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y - r * 1.4);
        g.stroke();
        g.beginPath();
        g.arc(x, y - r * 2, r, 0, TAU);
        g.fill();
        g.stroke();
        if (rng() < 0.5) {
          g.fillStyle = withAlpha(th.accent, 0.8);
          g.beginPath();
          g.arc(x + r * 0.3, y - r * 2.2, 2.5, 0, TAU);
          g.fill();
          g.fillStyle = col;
        }
      }
      for (let k = 0; k < 3; k++) houseRow(g, rng() * W, base - 10, sc, th, rng);
      break;
    }
    case 'city':
    case 'folded': {
      ground();
      for (let x = 0; x < W; ) {
        const bw = (40 + rng() * 80) * sc;
        const bh = (80 + rng() * 220) * sc;
        g.fillRect(x, base - bh, bw, bh);
        g.strokeRect(x, base - bh, bw, bh);
        windows(g, x, base - bh, bw, bh, th, rng);
        if (rng() < 0.3) {
          g.beginPath();
          g.moveTo(x + bw / 2, base - bh);
          g.lineTo(x + bw / 2, base - bh - 30 * sc);
          g.stroke();
        }
        if (far === 'folded' && layer === 0) {
          // The same city hung upside down from the sky.
          const fh = bh * 0.8;
          g.fillRect(x, 0, bw, fh * 0.6);
          g.strokeRect(x, 0, bw, fh * 0.6);
          windows(g, x, 0, bw, fh * 0.6, th, rng);
        }
        x += bw + rng() * 12;
      }
      break;
    }
    case 'rails': {
      ground();
      for (let x = 0; x < W; ) {
        const bw = (50 + rng() * 90) * sc;
        const bh = (60 + rng() * 150) * sc;
        g.fillRect(x, base - bh, bw, bh);
        g.strokeRect(x, base - bh, bw, bh);
        windows(g, x, base - bh, bw, bh, th, rng);
        x += bw + (20 + rng() * 60) * sc;
      }
      // The elevated loop in front.
      const ty = base - 120 * sc;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, ty);
      g.lineTo(W, ty);
      g.stroke();
      for (let x = 40; x < W; x += 160 * sc) {
        g.beginPath();
        g.moveTo(x, ty);
        g.lineTo(x, base);
        g.stroke();
      }
      const trainX = rng() * (W - 400);
      g.fillRect(trainX, ty - 26 * sc, 380 * sc, 22 * sc);
      g.strokeRect(trainX, ty - 26 * sc, 380 * sc, 22 * sc);
      g.fillStyle = withAlpha(th.accent, 0.7);
      for (let x = trainX + 10; x < trainX + 370 * sc; x += 22 * sc) g.fillRect(x, ty - 22 * sc, 12 * sc, 8 * sc);
      break;
    }
    case 'sea': {
      g.fillStyle = mix(col, '#00ffe0', 0.06);
      g.fillRect(0, base, W, H - base);
      g.beginPath();
      g.moveTo(0, base);
      g.lineTo(W, base);
      g.stroke();
      for (let y = base + 12; y < H; y += 14 * sc) {
        g.globalAlpha = 0.3;
        g.beginPath();
        for (let x = 0; x < W; x += 30) g.lineTo(x, y + Math.sin(x * 0.03 + y) * 3);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.fillStyle = col;
      for (let k = 0; k < 4; k++) {
        const ix = rng() * W;
        const iw = (80 + rng() * 200) * sc;
        g.beginPath();
        g.ellipse(ix, base, iw, 30 * sc, 0, Math.PI, TAU);
        g.fill();
        g.stroke();
      }
      if (layer === 0) {
        const lx = W * 0.5;
        g.beginPath();
        g.moveTo(lx - 14, base);
        g.lineTo(lx - 8, base - 140);
        g.lineTo(lx + 8, base - 140);
        g.lineTo(lx + 14, base);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = withAlpha(th.accent, 0.9);
        g.beginPath();
        g.arc(lx, base - 150, 8, 0, TAU);
        g.fill();
      }
      break;
    }
    case 'dome': {
      ground();
      for (let x = 0; x < W; ) {
        const r = (60 + rng() * 110) * sc;
        g.beginPath();
        g.arc(x + r, base, r, Math.PI, TAU);
        g.fill();
        g.stroke();
        g.globalAlpha = 0.5;
        for (let i = 1; i < 5; i++) {
          g.beginPath();
          g.ellipse(x + r, base, r * (i / 5), r, 0, Math.PI, TAU);
          g.stroke();
        }
        g.globalAlpha = 1;
        x += r * 2 + rng() * 40;
      }
      for (let k = 0; k < 6; k++) {
        const x = rng() * W;
        const h = (100 + rng() * 120) * sc;
        g.beginPath();
        g.moveTo(x, base);
        g.quadraticCurveTo(x + 40 * sc, base - h * 0.6, x + 80 * sc * (rng() < 0.5 ? 1 : -1), base - h);
        g.stroke();
      }
      break;
    }
    case 'peaks': {
      g.beginPath();
      g.moveTo(0, H);
      let x = 0;
      while (x < W) {
        const w = (120 + rng() * 220) * sc;
        const h = (120 + rng() * 200) * sc;
        g.lineTo(x + w / 2, base - h);
        g.lineTo(x + w, base);
        x += w;
      }
      g.lineTo(W, H);
      g.closePath();
      g.fill();
      g.stroke();
      if (layer === 1) {
        for (let k = 0; k < 3; k++) {
          const dx = rng() * W;
          g.beginPath();
          g.arc(dx, base - 20, 26, Math.PI, TAU);
          g.fill();
          g.stroke();
          g.beginPath();
          g.moveTo(dx, base - 46);
          g.lineTo(dx + 30, base - 70);
          g.stroke();
        }
      }
      break;
    }
    case 'carnival': {
      ground();
      if (layer === 0) {
        const cx = W * 0.3;
        const R = 150;
        g.beginPath();
        g.arc(cx, base - R - 20, R, 0, TAU);
        g.stroke();
        for (let i = 0; i < 12; i++) {
          const a = (i * TAU) / 12;
          g.beginPath();
          g.moveTo(cx, base - R - 20);
          g.lineTo(cx + Math.cos(a) * R, base - R - 20 + Math.sin(a) * R);
          g.stroke();
          g.fillStyle = withAlpha(i % 2 ? th.accent : th.edge2, 0.8);
          g.fillRect(cx + Math.cos(a) * R - 6, base - R - 20 + Math.sin(a) * R, 12, 10);
        }
        g.beginPath();
        g.moveTo(cx - 60, base);
        g.lineTo(cx, base - R - 20);
        g.lineTo(cx + 60, base);
        g.stroke();
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(W * 0.55, base);
        for (let x = W * 0.55; x < W * 0.95; x += 20) g.lineTo(x, base - 80 - Math.sin(x * 0.02) * 60);
        g.stroke();
      }
      for (let k = 0; k < 5; k++) {
        const x = rng() * W;
        const w = (70 + rng() * 60) * sc;
        g.beginPath();
        g.moveTo(x, base);
        g.lineTo(x, base - w * 0.5);
        g.lineTo(x + w / 2, base - w);
        g.lineTo(x + w, base - w * 0.5);
        g.lineTo(x + w, base);
        g.fill();
        g.stroke();
      }
      break;
    }
    case 'deep': {
      g.fillStyle = col;
      g.fillRect(0, base, W, H - base);
      for (let k = 0; k < 16; k++) {
        const x = rng() * W;
        const h = (120 + rng() * 260) * sc;
        g.beginPath();
        g.moveTo(x, base);
        for (let y = 0; y < h; y += 16) g.lineTo(x + Math.sin(y * 0.05 + k) * 10 * sc, base - y);
        g.stroke();
      }
      if (layer === 0) {
        g.fillStyle = withAlpha('#aef6ff', 0.05);
        for (let k = 0; k < 6; k++) {
          const x = rng() * W;
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x + 60, 0);
          g.lineTo(x + 200, H);
          g.lineTo(x + 100, H);
          g.fill();
        }
      }
      break;
    }
    case 'source':
    default: {
      ground();
      // A tunnel of rings and floating monoliths: the grid showing through.
      if (layer === 0) {
        for (let i = 1; i < 9; i++) {
          g.globalAlpha = 0.5 - i * 0.04;
          g.strokeRect(W / 2 - i * 70, base - i * 45 - 60, i * 140, i * 90);
          g.strokeRect(W * 0.1 - i * 30, base - i * 20 - 80, i * 60, i * 40);
        }
        g.globalAlpha = 1;
      }
      for (let k = 0; k < 10; k++) {
        const x = rng() * W;
        const w = (20 + rng() * 40) * sc;
        const h = (60 + rng() * 200) * sc;
        g.fillRect(x, base - h, w, h);
        g.strokeRect(x, base - h, w, h);
      }
      break;
    }
  }
}

function windows(g, x, y, w, h, th, rng) {
  const fill = g.fillStyle;
  for (let wy = y + 8; wy < y + h - 8; wy += 14) {
    for (let wx = x + 6; wx < x + w - 8; wx += 12) {
      if (rng() < 0.35) continue;
      g.fillStyle = withAlpha(rng() < 0.7 ? th.accent : th.edge2, 0.25 + rng() * 0.5);
      g.fillRect(wx, wy, 5, 6);
    }
  }
  g.fillStyle = fill;
}

function houseRow(g, x, base, sc, th, rng) {
  for (let i = 0; i < 3; i++) {
    const w = (40 + rng() * 20) * sc;
    const h = (30 + rng() * 20) * sc;
    const hx = x + i * (w + 10);
    g.beginPath();
    g.moveTo(hx, base);
    g.lineTo(hx, base - h);
    g.lineTo(hx + w / 2, base - h - w * 0.4);
    g.lineTo(hx + w, base - h);
    g.lineTo(hx + w, base);
    g.closePath();
    g.fill();
    g.stroke();
    const f = g.fillStyle;
    g.fillStyle = withAlpha(th.accent, 0.85);
    g.fillRect(hx + w * 0.3, base - h * 0.7, w * 0.15, h * 0.25);
    g.fillRect(hx + w * 0.6, base - h * 0.7, w * 0.15, h * 0.25);
    g.fillStyle = f;
  }
}

