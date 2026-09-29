// How everything that moves looks, drawn from the renderer's few shapes each
// frame: the machines (the grid's polyhedra in the first level; drones, dogs,
// cranes and clockwork later), the bosses, charges, pickups, the aim line and
// the blaster in your hand. A machine's look is its roster name; how it
// moves is enemies.js's business.
import { modelYPR, model, add, sub, scale, norm, cross, rotY, lookDir, camBasis, dist, len } from './math.js';
import { POWERUPS, BLASTER, WORM, PICKUP, PLAYERS } from './config.js';
import { guideLine } from './blaster.js';
import { sightLine, placeEnd, beamPath } from './wormholes.js';
import { FINISHES } from './records.js';

const TAU = Math.PI * 2;
const PCOL = Object.fromEntries(POWERUPS.map((p) => [p.id, p.color]));
PCOL.std = '#dffbff';

export class Art {
  constructor(renderer) {
    this.r = renderer;
    this.t = 0;
  }

  d(shape, p, yaw, pitch, roll, s, col, o) {
    this.r.draw(shape, modelYPR(p, yaw, pitch, roll, s), col, o);
  }

  /** A part of a machine, placed in its own frame (x left, y up, z forward). */
  part(e, shape, lx, ly, lz, sx, sy, sz, col, o = {}, rot = null) {
    const p = add(e.pos, rotY([lx, ly, lz], e.yaw));
    this.r.draw(shape, modelYPR(p, e.yaw + (rot ? rot[0] : 0), rot ? rot[1] : 0, rot ? rot[2] : 0, [sx, sy, sz]), col, o);
  }

  // ------------------------------------------------------------ the frame

  /** Everything in the game this frame. `view` carries the camera, the time and the settings. */
  frame(game, fx, view) {
    this.t = view.time;
    const g = game;
    for (const e of g.enemies) if (!e.dead && (e.awake || dist(e.pos, g.bot.pos) < 90)) this.enemy(e, g);
    for (const c of g.charges) this.charge(c, false, view);
    for (const c of g.shots) this.charge(c, true, view);
    for (const p of g.pickups) if (!p.taken) this.pickup(p);
    for (const w of g.world.wells) this.well(w);
    for (const h of g.world.hazards) this.hazard(h);
    for (const f of g.world.fans) this.fan(f);
    for (const w of g.world.wards) this.ward(w);
    for (const bm of g.world.beams) this.beam(bm, g);
    for (const s of g.world.belts) this.belt(s);
    for (const t of g.world.tethers) this.tether(t, g);
    this.checkpoints(g);
    if (g.boss) this.boss(g.boss, g);
    // Every robot: your own only through a wormhole, everyone else's always, flickering after a hit.
    for (const pl of g.players) {
      if (pl.out) continue;
      const mine = pl.slot === g.local;
      if (!mine && pl.bot.invuln > 0 && Math.sin(this.t * 40) > 0.3) continue;
      this.robotBody(pl.bot, PLAYERS[pl.slot], mine);
    }
    // The aim line and where a wormhole end would open, from the eye.
    if (view.aimLine && g.state === 'play') this.aim(g, view);
    for (const q of fx.parts) this.r.point(q.p, q.size * Math.min(1, q.t / q.life * 2), q.col, Math.min(1, q.t / q.life * 1.6));
    for (const r of fx.rings) this.r.draw('ring', model(r.p, [1, 0, 0], [0, 1, 0], [0, 0, 1], [r.r * 2, 0.6, r.r * 2]), r.col, { glow: 2, alpha: Math.max(0, r.t / r.life) * 0.8 });
    for (const w of fx.weather) this.r.point([w[0], w[1], w[2]], view.weather === 'rain' ? 0.03 : 0.07, view.weather === 'rain' ? '#9ab0d0' : '#ffffff', view.weather === 'rain' ? 0.35 : 0.8);
  }

  // ------------------------------------------------------------ machines

  enemy(e, g) {
    const t = this.t + e.id;
    let col = e.color || '#ff4fd8';
    if (e.flash > 0) col = '#ffffff';
    const o = { mat: 'panel', glow: 0.25 };
    const folded = e.folded;
    const passes = folded ? [0, 1] : [0];
    for (const pass of passes) {
      const saved = e.pos;
      if (pass === 1) {
        // Folded: only half here, drawn twice and out of step with itself.
        e.pos = add(saved, [Math.sin(t * 7) * 0.18, Math.cos(t * 5) * 0.12, Math.cos(t * 6) * 0.18]);
      }
      const alpha = folded ? 0.55 + 0.3 * Math.sin(t * 13 + pass * 2) : 1;
      this.look(e, col, { ...o, alpha }, t);
      e.pos = saved;
    }
    if (e.frozen > 0) this.d('box', e.pos, 0.3, 0, 0, [e.r * 2.15, e.r * 2.15, e.r * 2.15], '#bfefff', { mat: 'glass', alpha: 0.55, glow: 0.3 });
    if (e.shield) {
      // A Deflector shield before it, turning to meet the robot.
      const f = [Math.sin(e.yaw), 0, Math.cos(e.yaw)];
      const p = add(e.pos, add(scale(f, e.r + 0.35), [0, 0.2, 0]));
      this.d('box', p, e.yaw, 0, 0, [1.5, 1.9, 0.12], '#9fe8ff', { glow: 1.2, alpha: 0.75 });
    }
  }

  /** The looks, from the grid's shapes to the Creator's clockwork. */
  look(e, col, o, t) {
    const r = e.r;
    const P = (...a) => this.part(e, ...a);
    const metal = { mat: 'metal', alpha: o.alpha };
    const glow = (k) => ({ glow: k, alpha: o.alpha });
    const walk = Math.sin(t * 9) * (Math.hypot(e.vel[0], e.vel[2]) > 0.3 ? 1 : 0.1);
    switch (e.look) {
      case 'glyph':
        this.d('tetra', e.pos, t * 1.3, t * 0.7, 0, [r * 2.4, r * 2.4, r * 2.4], col, { ...o, mat: 'wire', glow: 0.4 });
        this.d('ball', e.pos, 0, 0, 0, [r * 0.6, r * 0.6, r * 0.6], '#ffffff', glow(2));
        break;
      case 'spark':
        this.d('ico', e.pos, t * 2, t * 1.4, 0, [r * 2, r * 2, r * 2], col, { ...o, mat: 'wire', glow: 0.6 });
        break;
      case 'cubelet': {
        const roll = (t * 3) % (Math.PI / 2);
        this.d('box', add(e.pos, [0, Math.abs(Math.sin(roll * 2)) * 0.1, 0]), e.yaw, roll, 0, [r * 1.7, r * 1.7, r * 1.7], col, o);
        this.d('ball', e.pos, 0, 0, 0, [r * 0.5, r * 0.5, r * 0.5], '#ffffff', glow(2));
        break;
      }
      case 'prism':
        this.d('octa', e.pos, t * 0.8, 0, 0, [r * 2, r * 2.8, r * 2], col, o);
        P('ball', 0, 0, r * 0.7, r * 0.5, r * 0.5, r * 0.5, '#ffffff', glow(2.5));
        break;
      case 'wirehound':
      case 'dog':
      case 'hunter': {
        const wire = e.look === 'wirehound';
        const m = wire ? { mat: 'wire', glow: 0.35, alpha: o.alpha } : metal;
        P('box', 0, 0.15, 0, r * 1.1, r * 0.7, r * 2, col, m);
        P('box', 0, 0.45, r * 1.15, r * 0.6, r * 0.5, r * 0.7, col, m);
        P('ball', 0, 0.5, r * 1.5, 0.12, 0.12, 0.12, wire ? '#ffffff' : '#ff4040', glow(2));
        for (const [lx, lz, ph] of [[0.35, 0.7, 0], [-0.35, 0.7, Math.PI], [0.35, -0.7, Math.PI], [-0.35, -0.7, 0]]) {
          const sw = Math.sin(t * 10 + ph) * 0.5 * walk;
          P('box', lx * r, -0.35, lz * r, 0.12, r * 1.1, 0.14, wire ? col : '#3a3e44', m, [0, sw, 0]);
        }
        if (e.look === 'hunter') {
          // Antlers of bent pipe.
          P('box', 0.25, 1.0, r * 1.1, 0.06, 0.7, 0.06, col, metal, [0, 0, 0.5]);
          P('box', -0.25, 1.0, r * 1.1, 0.06, 0.7, 0.06, col, metal, [0, 0, -0.5]);
        }
        break;
      }
      case 'wirebird':
      case 'gull':
      case 'hawk':
      case 'cuckoo': {
        const wire = e.look === 'wirebird';
        const m = wire ? { mat: 'wire', glow: 0.35, alpha: o.alpha } : e.look === 'cuckoo' ? { mat: 'wood', alpha: o.alpha } : metal;
        const flap = Math.sin(t * (e.state === 'dive' ? 20 : 9)) * 0.7;
        P('octa', 0, 0, 0, r * 0.9, r * 0.8, r * 2, col, m);
        P('box', r * 0.9, 0.1, 0, r * 1.6, 0.05, r * 0.8, col, m, [0, 0, flap]);
        P('box', -r * 0.9, 0.1, 0, r * 1.6, 0.05, r * 0.8, col, m, [0, 0, -flap]);
        P('cone', 0, 0.05, r * 1.05, 0.12, 0.3, 0.12, '#ffb347', { alpha: o.alpha }, [0, Math.PI / 2, 0]);
        break;
      }
      case 'wiretoad':
      case 'sparkbot':
      case 'tintoy': {
        const squash = e.onGround ? 0.85 : 1.1;
        if (e.look === 'tintoy') {
          P('box', 0, 0, 0, r * 1.4, r * 1.6 * squash, r * 1.2, col, metal);
          P('box', 0, r * 1.2, 0, r * 0.9, r * 0.7, r * 0.9, '#c8c8d0', metal);
          P('cyl', 0, r * 1.9, 0, 0.05, 0.5, 0.05, '#c8c8d0', metal);
          P('ball', 0, r * 2.2, 0, 0.12, 0.12, 0.12, '#ffe066', glow(2));
          P('ball', 0.15, r * 1.25, r * 0.46, 0.1, 0.1, 0.1, '#ffffff', glow(1.5));
          P('ball', -0.15, r * 1.25, r * 0.46, 0.1, 0.1, 0.1, '#ffffff', glow(1.5));
        } else {
          this.d('ico', e.pos, e.yaw, 0, 0, [r * 2, r * 1.6 * squash, r * 2], col, e.look === 'wiretoad' ? { mat: 'wire', glow: 0.35, alpha: o.alpha } : { ...metal, glow: 0.3 });
          P('ball', 0, 0.1, r * 0.8, r * 0.35, r * 0.35, r * 0.35, e.look === 'sparkbot' ? '#ffd23f' : '#ffffff', glow(2));
        }
        break;
      }
      case 'drone':
      case 'patrol':
      case 'secdrone':
      case 'quad': {
        const big = e.look === 'quad' ? 1.3 : 1;
        P('box', 0, 0, 0, r * 1.2 * big, r * 0.5, r * 1.2 * big, e.look === 'drone' ? '#3a4452' : '#e8e8e8', metal);
        for (const [ax, az] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          P('box', ax * r * 0.8 * big, 0.05, az * r * 0.8 * big, r * 0.7, 0.06, 0.08, '#2a2e34', metal, [Math.PI / 4 * ax * az, 0, 0]);
          P('cyl', ax * r * 1.1 * big, 0.12, az * r * 1.1 * big, r * 0.9, 0.02, r * 0.9, col, { glow: 0.5, alpha: 0.5 * o.alpha });
        }
        const light = e.look === 'patrol' ? (Math.sin(t * 10) > 0 ? '#ff3030' : '#3060ff') : e.look === 'secdrone' ? '#fff0c8' : col;
        P('ball', 0, -r * 0.3, r * 0.55, r * 0.3, r * 0.3, r * 0.3, light, glow(2.5));
        break;
      }
      case 'crawler':
      case 'rat': {
        const n = e.look === 'rat' ? 3 : 5;
        for (let i = 0; i < n; i++) {
          const sw = Math.sin(t * 8 - i * 0.9) * 0.18;
          P('sphere', sw, -r * 0.3, -i * r * 0.7, r * (1 - i * 0.12), r * 0.8, r, i === 0 ? col : '#4a5058', metal);
        }
        P('ball', 0.12, -r * 0.1, r * 0.45, 0.08, 0.08, 0.08, '#ff4040', glow(2));
        P('ball', -0.12, -r * 0.1, r * 0.45, 0.08, 0.08, 0.08, '#ff4040', glow(2));
        break;
      }
      case 'camturret':
      case 'trafficcam':
      case 'searchlight':
      case 'sentry':
      case 'arm': {
        P('cyl', 0, -r * 1.1, 0, 0.14, 1.2, 0.14, '#3a3e44', metal);
        P('box', 0, 0, 0, r * 1.1, r * 0.9, r * 1.8, e.look === 'sentry' ? '#dfe6ec' : '#c8ccd2', metal);
        P('cyl', 0, 0, r * 1.0, r * 0.7, r * 0.5, r * 0.7, '#20242a', metal, [0, Math.PI / 2, 0]);
        P('ball', 0, 0, r * 1.25, r * 0.35, r * 0.35, r * 0.35, e.look === 'searchlight' ? '#fff0c8' : col, glow(3));
        if (e.look === 'searchlight' && e.seen) this.r.light(add(e.pos, [0, 0, 0]), '#fff0c8', 8);
        break;
      }
      case 'sweeper':
      case 'forklift': {
        if (e.look === 'forklift') {
          P('box', 0, 0, 0, r * 1.6, r * 1.1, r * 2.2, col, metal);
          P('box', 0, r * 1.1, -r * 0.3, r * 1.4, r * 1, r * 1.2, '#20242a', { mat: 'glass', alpha: o.alpha });
          P('box', 0, r * 0.3, r * 1.3, r * 1.2, r * 2, 0.1, '#3a3e44', metal);
          P('box', 0.3, -r * 0.6, r * 1.8, 0.1, 0.06, r, '#8a8a8a', metal);
          P('box', -0.3, -r * 0.6, r * 1.8, 0.1, 0.06, r, '#8a8a8a', metal);
        } else {
          P('cyl', 0, -r * 0.3, 0, r * 2, r * 0.7, r * 2, col, metal);
          P('cyl', 0, -r * 0.75, r * 0.7, r * 0.6, 0.1, r * 0.6, '#e8d8a0', { glow: 0.2, alpha: o.alpha }, [t * 6, 0, 0]);
          P('ball', 0, 0.1, r * 0.8, 0.1, 0.1, 0.1, '#9dff5c', glow(2));
        }
        break;
      }
      case 'welder': {
        P('box', 0, 0.2, 0, r * 1.3, r * 1.2, r * 1.1, col, metal);
        P('box', 0, r * 0.9, r * 0.2, r * 0.7, r * 0.5, r * 0.6, '#3a3e44', metal);
        P('box', 0.35, -r * 0.6, 0, 0.14, r * 0.9, 0.14, '#3a3e44', metal, [0, walk * 0.5, 0]);
        P('box', -0.35, -r * 0.6, 0, 0.14, r * 0.9, 0.14, '#3a3e44', metal, [0, -walk * 0.5, 0]);
        P('box', 0.45, 0.4, r * 0.9, 0.08, 0.08, r * 0.9, '#6a6e74', metal);
        const arc = 0.5 + 0.5 * Math.sin(t * 40);
        P('ball', 0.45, 0.4, r * 1.45, 0.08 + arc * 0.08, 0.08 + arc * 0.08, 0.08 + arc * 0.08, '#dff6ff', glow(4));
        if (arc > 0.7) this.r.light(add(e.pos, [0, 0.5, 0]), '#9fdcff', 5);
        break;
      }
      case 'guard': {
        P('box', 0, 0.35, 0, r * 1.2, r * 1.3, r * 0.8, col, metal);
        P('box', 0, r * 1.45, 0, r * 0.6, r * 0.55, r * 0.6, '#2a2e34', metal);
        P('box', 0, r * 1.45, r * 0.28, r * 0.5, 0.08, 0.05, '#ff3030', glow(2));
        P('box', 0.3, -r * 0.7, 0, 0.18, r * 1.2, 0.18, '#3a3e44', metal, [0, walk * 0.4, 0]);
        P('box', -0.3, -r * 0.7, 0, 0.18, r * 1.2, 0.18, '#3a3e44', metal, [0, -walk * 0.4, 0]);
        break;
      }
      case 'bike': {
        P('cyl', 0, -r * 0.4, r * 0.7, r * 1.1, 0.15, r * 1.1, '#15171c', metal, [0, 0, Math.PI / 2]);
        P('cyl', 0, -r * 0.4, -r * 0.7, r * 1.1, 0.15, r * 1.1, '#15171c', metal, [0, 0, Math.PI / 2]);
        P('box', 0, 0.05, 0, r * 0.5, r * 0.6, r * 1.8, col, metal);
        P('ball', 0, 0.15, r * 1.0, 0.12, 0.12, 0.12, '#fff6d8', glow(3));
        break;
      }
      case 'crab': {
        P('sphere', 0, 0, 0, r * 2, r * 0.9, r * 1.4, col, metal);
        for (let i = 0; i < 3; i++) {
          for (const sd of [1, -1]) {
            const sw = Math.sin(t * 12 + i + (sd > 0 ? 0 : 1.5)) * 0.3;
            P('box', sd * r * 1.1, -r * 0.35, (i - 1) * r * 0.5, r * 0.9, 0.08, 0.08, '#8a6a30', metal, [0, 0, sd * (0.5 + sw)]);
          }
        }
        P('box', 0.4, 0.1, r * 0.9, 0.3, 0.15, 0.4, col, metal);
        P('box', -0.4, 0.1, r * 0.9, 0.3, 0.15, 0.4, col, metal);
        break;
      }
      case 'buoy':
        P('cyl', 0, -0.2, 0, r * 1.6, r * 1.2, r * 1.6, col, metal);
        P('cone', 0, r * 0.7, 0, r * 0.9, r * 0.8, r * 0.9, '#e8e8e8', metal);
        P('ball', 0, r * 1.2, 0, 0.14, 0.14, 0.14, Math.sin(t * 4) > 0 ? '#ffe066' : '#553300', glow(3));
        break;
      case 'automaton': {
        const brass = '#b8903a';
        P('box', 0, 0.2, 0, r * 1.1, r * 1.3, r * 0.8, brass, metal);
        P('sphere', 0, r * 1.3, 0, r * 0.7, r * 0.7, r * 0.7, '#d8b050', metal);
        P('ball', 0.1, r * 1.35, r * 0.3, 0.07, 0.07, 0.07, '#ffe0a0', glow(2));
        P('ball', -0.1, r * 1.35, r * 0.3, 0.07, 0.07, 0.07, '#ffe0a0', glow(2));
        P('box', 0, 0.35, -r * 0.55, 0.3, 0.08, 0.08, brass, metal, [0, 0, t * 3]);
        P('box', 0.28, -r * 0.7, 0, 0.14, r * 1.1, 0.14, '#6a4a22', metal, [0, walk * 0.4, 0]);
        P('box', -0.28, -r * 0.7, 0, 0.14, r * 1.1, 0.14, '#6a4a22', metal, [0, -walk * 0.4, 0]);
        break;
      }
      case 'orrery':
        this.d('sphere', e.pos, 0, 0, 0, [r * 0.9, r * 0.9, r * 0.9], '#ffd08a', glow(1.2));
        this.d('torus', e.pos, t, 0.6, 0, [r * 2.4, r * 2.4, r * 2.4], col, metal);
        this.d('torus', e.pos, -t * 0.7, 1.4, 0.4, [r * 1.9, r * 1.9, r * 1.9], col, metal);
        break;
      default:
        this.d('sphere', e.pos, 0, 0, 0, [r * 2, r * 2, r * 2], col, o);
    }
  }

  // ------------------------------------------------------------ bosses

  boss(B, g) {
    const t = this.t;
    const hurt = B.flash > 0;
    const coreCol = hurt ? '#ffffff' : B.dead ? '#333333' : '#ffe066';
    const plateCol = '#9fe8ff';
    const partsDraw = (armCol, armMat = 'metal') => {
      for (const p of B.parts) {
        if (p.off) continue;
        if (p.type === 'plate') {
          const v = cross(p.n, p.u);
          this.r.draw('box', model(p.p, p.u, v, p.n, [p.a * 2, p.b * 2, 0.24]), plateCol, { glow: 1.1, alpha: 0.82 });
        } else if (p.type === 'core') {
          const k = 1 + Math.sin(t * 6) * 0.06;
          this.d('sphere', p.p, 0, 0, 0, [p.r * 2 * k, p.r * 2 * k, p.r * 2 * k], coreCol, { glow: B.dead ? 0 : 2.4 });
          if (!B.dead) this.r.light(p.p, '#ffd070', 8);
        } else if (p.type === 'box') {
          this.d('box', p.p, 0, 0, 0, [p.h[0] * 2, p.h[1] * 2, p.h[2] * 2], armCol, { mat: armMat });
        } else if (!p.hidden) {
          this.d('sphere', p.p, B.yaw, 0, 0, [p.r * 2, p.r * 2, p.r * 2], armCol, { mat: armMat });
        }
      }
    };
    const at = (x, y, z) => add(B.pos, rotY([x, y, z], B.yaw));
    switch (B.id) {
      case 'warden':
        this.d('box', B.pos, t * 0.4, t * 0.3, 0, [1.4, 1.4, 1.4], '#7f5cff', { mat: 'wire', glow: 0.5 });
        partsDraw('#7f5cff', 'panel');
        break;
      case 'echo':
        // The Warden as the grid remembers it: two cages, turning against each other, in the Echo's red.
        this.d('box', B.pos, t * 0.7, t * 0.5, 0, [1.4, 1.4, 1.4], '#ff3a6a', { mat: 'wire', glow: 0.7 });
        this.d('box', B.pos, -t * 0.5, 0.6, t * 0.3, [1.9, 1.9, 1.9], '#ff9a3a', { mat: 'wire', glow: 0.4 });
        partsDraw('#ff3a6a', 'panel');
        break;
      case 'stag': {
        const col = '#3dff9a';
        const m = { mat: 'wire', glow: 0.4 };
        const gait = Math.sin(t * (B.state === 'charge' ? 14 : 4));
        this.d('box', at(0, 2.8, 0.2), B.yaw, 0, 0, [2, 1.8, 4.2], col, m);
        this.d('box', at(0, 4.2, 2.1), B.yaw, -0.5, 0, [0.9, 1.6, 0.9], col, m);
        this.d('box', at(0, 4.9, 2.7), B.yaw, 0.2, 0, [0.9, 0.8, 1.4], col, m);
        for (const [lx, lz, ph] of [[0.7, 1.6, 0], [-0.7, 1.6, Math.PI], [0.7, -1.4, Math.PI], [-0.7, -1.4, 0]]) this.d('box', at(lx, 1, lz), B.yaw, gait * 0.4 * (ph ? -1 : 1), 0, [0.3, 2.2, 0.3], col, m);
        partsDraw(col, 'wire');
        // The antlers: branching wire over the plate.
        for (const sd of [1, -1]) {
          this.d('box', at(sd * 1.1, 6, 2.4), B.yaw, 0, sd * 0.6, [0.12, 2.2, 0.12], '#b8ff6a', { glow: 1.5 });
          this.d('box', at(sd * 1.9, 6.8, 2.4), B.yaw, 0, sd * 1.2, [0.1, 1.2, 0.1], '#b8ff6a', { glow: 1.5 });
        }
        break;
      }
      case 'scheduler': {
        const A = B.A;
        // The rail across the roof, and the gantry on it.
        this.d('box', [B.pos[0], A.roof - 0.4, (A.min[2] + A.max[2]) / 2], 0, 0, 0, [0.6, 0.4, A.max[2] - A.min[2]], '#4a5566', { mat: 'metal' });
        this.d('box', [B.pos[0], A.roof - 1.3, B.pos[2]], 0, 0, 0, [0.4, 1.8, 0.4], '#6a7788', { mat: 'metal' });
        partsDraw('#5a6678');
        this.d('ball', add(B.pos, [0, -1.4, 0.75]), 0, 0, 0, [0.35, 0.35, 0.35], '#ff3030', { glow: 3 });
        break;
      }
      case 'forgewright':
        this.d('box', at(0, 1, 0), B.yaw, 0, 0, [3.2, 2, 2.2], '#4a4440', { mat: 'metal' });
        this.d('box', at(2.2, 3.6, 0.8), B.yaw, 0, Math.sin(t * 2) * 0.6, [0.6, 2.6, 0.6], '#6a6460', { mat: 'metal' });
        this.d('box', at(2.2, 5, 1.5), B.yaw, 0, 0, [1.4, 0.8, 0.8], '#3a3430', { mat: 'metal' });
        partsDraw('#7a6a58');
        this.r.light(at(0, 2.6, -1.7), '#ff7a2a', 9);
        break;
      case 'interceptor':
        this.d('box', at(0, 0, 0), B.yaw, 0, 0, [2.2, 0.8, 5], '#1c2030', { mat: 'metal' });
        this.d('box', at(0, 0.6, -0.4), B.yaw, 0, 0, [1.8, 0.6, 2.2], '#101418', { mat: 'glass' });
        this.d('box', at(0.7, 0.1, 2.5), B.yaw, 0, 0, [0.4, 0.2, 0.05], Math.sin(t * 10) > 0 ? '#ff3030' : '#3060ff', { glow: 3 });
        this.d('box', at(-0.7, 0.1, 2.5), B.yaw, 0, 0, [0.4, 0.2, 0.05], Math.sin(t * 10) > 0 ? '#3060ff' : '#ff3030', { glow: 3 });
        partsDraw('#2a2e3c');
        break;
      case 'broadcaster':
        this.d('cyl', [B.pos[0], B.floor + 4, B.pos[2]], 0, 0, 0, [0.5, 8, 0.5], '#8a8a90', { mat: 'metal' });
        this.d('torus', B.pos, t, 0, 0, [2.8, 2.8, 2.8], '#ff4fd8', { glow: 1.2 });
        for (const p of B.parts) {
          if (p.type !== 'plate') continue;
          const v = cross(p.n, p.u);
          // Each screen shows static, and sometimes the robot's own colours.
          this.r.draw('box', model(p.p, p.u, v, p.n, [p.a * 2, p.b * 2, 0.2]), Math.sin(t * 3 + p.p[0]) > 0.6 ? '#7fe9ff' : '#ff4fd8', { mat: 'screen', glow: 0.4 });
        }
        partsDraw('#6a6a70');
        break;
      case 'borer':
        this.d('cyl', at(0, 0, 0.2), B.yaw, Math.PI / 2, 0, [4, 4.6, 4], '#8a6a2a', { mat: 'metal' });
        this.d('cyl', at(0, 0, 2.6), B.yaw, Math.PI / 2, t * 4, [4.6, 0.4, 4.6], '#5a5a60', { mat: 'metal' });
        partsDraw('#6a5a3a');
        break;
      case 'gantry':
        if (B.spreader) {
          this.d('box', [B.spreader[0], B.spreader[1] + 5, B.spreader[2]], 0, 0, 0, [0.06, 10, 0.06], '#2a2a2a', {});
          this.d('box', B.spreader, 0, 0, 0, [3, 0.6, 1.4], '#d8a030', { mat: 'metal' });
        }
        partsDraw('#d8a030');
        break;
      case 'lookout':
        this.d('box', [B.pos[0], B.floor + 2.5, B.pos[2]], 0, 0, 0, [0.8, 5, 0.8], '#dfe6ec', { mat: 'metal' });
        this.d('cone', at(0, 0.4, 1.0), B.yaw, -Math.PI / 2, 0, [4.8, 1.2, 4.8], '#eef2f6', { mat: 'metal' });
        this.d('box', at(0, 0.4, 2.2), B.yaw, 0, 0, [0.12, 0.12, 2.2], '#8a8a8a', { mat: 'metal' });
        partsDraw('#c8ccd2');
        this.r.light(at(0, 0.4, 3.4), '#dff6ff', 9);
        break;
      case 'creator': {
        // The loom: a great ring of screens and brass arms, the man in the middle behind glass.
        // A slender ring above his head and one below, and an arm out to each cell.
        this.d('ring', add(B.pos, [0, 1.6, 0]), B.spin, 0, 0, [10.4, 10.4, 10.4], '#b8903a', { mat: 'metal' });
        this.d('ring', add(B.pos, [0, -1.6, 0]), -B.spin, 0, 0, [10.4, 10.4, 10.4], '#8a6a2a', { mat: 'metal' });
        for (const p of B.parts) {
          if (p.type !== 'core') continue;
          const d = sub(p.p, B.pos);
          const L = len(d);
          const z = norm(d);
          const x = norm(cross([0, 1, 0], z));
          this.r.draw('box', model(add(B.pos, scale(d, 0.5)), x, cross(z, x), z, [0.12, 0.12, L]), '#b8903a', { mat: 'metal' });
        }
        for (let i = 0; i < 12; i++) {
          const a = B.spin * 0.5 + (i * TAU) / 12;
          const p = add(B.pos, [Math.sin(a) * 7.5, 2.2 + Math.sin(t + i) * 0.2, Math.cos(a) * 7.5]);
          this.d('box', p, a, 0, 0, [1.6, 1, 0.08], i % 3 === 0 ? '#7fe9ff' : '#ffd08a', { mat: 'screen', glow: 0.3 });
        }
        this.creator(B);
        partsDraw('#b8903a');
        if (B.glass) this.d('sphere', B.glass.p, 0, 0, 0, [B.glass.r * 2, B.glass.r * 2, B.glass.r * 2], '#bfefff', { mat: 'glass', alpha: 0.3 });
        break;
      }
      default:
        partsDraw('#888888');
    }
    for (const w of B.waves) this.r.draw('ring', model([w.c[0], w.c[1] + 0.35, w.c[2]], [1, 0, 0], [0, 1, 0], [0, 0, 1], [w.r * 2, w.h * 6, w.r * 2]), '#ff4fd8', { glow: 2, alpha: Math.min(1, w.life) * 0.85 });
    for (const bm of B.beams) {
      const mid = scale(add(bm.a, bm.b), 0.5);
      const d = sub(bm.b, bm.a);
      const L = len(d);
      const z = norm(d);
      const x = norm(cross([0, 1, 0], z));
      const y = cross(z, x);
      const w = bm.lit ? bm.w * 2 : 0.05;
      this.r.draw('box', model(mid, x, y, z, [w, w, L]), bm.lit ? '#ff3050' : '#ff9aa8', { glow: bm.lit ? 3 : 1, alpha: bm.lit ? 0.9 : 0.4 + 0.3 * Math.sin(t * 30) });
    }
    for (const z of B.hazards) {
      const warn = z.warn > 0;
      const col = z.kind === 'mine' ? '#ff3030' : '#ff7a1a';
      this.d('cyl', [z.c[0], z.c[1] + 0.03, z.c[2]], 0, 0, 0, [z.r * 2, 0.06, z.r * 2], col, { glow: warn ? 0.5 : 2.5, alpha: warn ? 0.35 + 0.3 * Math.sin(t * 20) : 0.9 });
      if (!warn && z.kind !== 'mine') this.r.light([z.c[0], z.c[1] + 0.5, z.c[2]], '#ff6a1a', z.r * 3);
    }
  }

  /** The Creator himself: a man in a cradle, working the loom with both hands. */
  creator(B) {
    const t = this.t;
    const p = B.pos;
    const yaw = Math.atan2(this.lastEye ? this.lastEye[0] - p[0] : 0, this.lastEye ? this.lastEye[2] - p[2] : 1);
    const at = (x, y, z) => add(p, rotY([x, y, z], yaw));
    const skin = '#d8a888';
    const coat = '#5a4a3a';
    this.d('box', at(0, -0.1, 0), yaw, 0, 0, [0.55, 0.8, 0.3], coat, { mat: 'cloth' });
    this.d('sphere', at(0, 0.55, 0), yaw, 0, 0, [0.28, 0.34, 0.3], skin, { mat: 'plain' });
    this.d('sphere', at(0, 0.7, -0.02), yaw, 0, 0, [0.3, 0.16, 0.3], '#c8c8c8', { mat: 'cloth' });
    this.d('box', at(0.09, 0.57, 0.14), yaw, 0, 0, [0.1, 0.05, 0.02], '#b8903a', { glow: 0.5 });
    this.d('box', at(-0.09, 0.57, 0.14), yaw, 0, 0, [0.1, 0.05, 0.02], '#b8903a', { glow: 0.5 });
    const work = Math.sin(t * 3) * 0.4;
    this.d('box', at(0.35, 0.05, 0.2), yaw, work, 0.3, [0.12, 0.5, 0.12], coat, { mat: 'cloth' });
    this.d('box', at(-0.35, 0.05, 0.2), yaw, -work, -0.3, [0.12, 0.5, 0.12], coat, { mat: 'cloth' });
    this.d('box', at(0.15, -0.8, 0), yaw, 0, 0, [0.16, 0.8, 0.18], '#3a3430', { mat: 'cloth' });
    this.d('box', at(-0.15, -0.8, 0), yaw, 0, 0, [0.16, 0.8, 0.18], '#3a3430', { mat: 'cloth' });
    this.d('cyl', at(0, -1.35, 0), 0, 0, 0, [1.4, 0.2, 1.4], '#b8903a', { mat: 'metal' });
  }

  // ----------------------------------------------------- charges and things

  charge(c, enemy, view) {
    if (c.age < 0.02 && !enemy) return;
    const col = enemy ? c.color || '#ff5c4a' : c.color || PCOL[c.kind] || '#dffbff';
    this.d(enemy && c.lobbed ? 'ico' : 'ball', c.pos, this.t * 3, this.t * 2, 0, [c.r * 2, c.r * 2, c.r * 2], col, { glow: 2.8, mat: enemy && c.lobbed ? 'panel' : 0 });
    this.r.point(c.pos, c.r * 5, col, 0.55);
    if (c.trail) c.trail.forEach((p, i) => this.r.point(p, c.r * (0.8 + i * 0.12), col, (i / c.trail.length) * 0.45));
    if (!enemy || view.lights !== false) this.r.light(c.pos, col, enemy ? 3 : 4.5);
  }

  pickup(p) {
    const t = this.t + p.id;
    const pos = add(p.pos, [0, Math.sin(t * 2) * PICKUP.bob, 0]);
    if (p.kind === 'cell') {
      // A shield cell: a shield in gold, bigger, with two rings round it.
      this.d('box', pos, t * 1.2, 0, 0, [0.9, 1.05, 0.16], '#ffd36a', { glow: 1.8 });
      this.d('ring', pos, t * 1.5, Math.PI / 2, 0, [1.5, 1.5, 1.5], '#ffd36a', { glow: 2.4 });
      this.d('ring', pos, -t * 1.1, 0.6, 0, [1.8, 1.8, 1.8], '#fff2c8', { glow: 1.6, alpha: 0.7 });
      this.r.light(pos, '#ffd36a', 6);
      return;
    }
    if (p.kind === 'shield') {
      this.d('box', pos, t * 1.5, 0, 0, [0.7, 0.8, 0.12], '#7fe9ff', { glow: 1.4 });
      this.d('ring', pos, t * 1.5, Math.PI / 2, 0, [1.1, 1.1, 1.1], '#7fe9ff', { glow: 2 });
      this.r.light(pos, '#7fe9ff', 4);
      return;
    }
    const col = PCOL[p.power] || '#ffffff';
    const s = [0.5, 0.5, 0.5];
    if (p.power === 'big') this.d('sphere', pos, t, 0, 0, [0.7, 0.7, 0.7], col, { glow: 1.6 });
    else if (p.power === 'triple') for (let i = -1; i <= 1; i++) this.d('ball', add(pos, rotY([i * 0.3, 0, 0], t * 1.5)), 0, 0, 0, [0.28, 0.28, 0.28], col, { glow: 2 });
    else if (p.power === 'freeze') this.d('octa', pos, t * 1.5, 0, 0, [0.6, 0.8, 0.6], col, { mat: 'glass', glow: 1.4 });
    else if (p.power === 'durable') this.d('torus', pos, t * 1.5, Math.PI / 2, 0, [0.8, 0.8, 0.8], col, { glow: 2 });
    else this.d('box', pos, t * 1.5, 0.6, 0.6, s, col, { glow: 1.6 });
    this.d('ring', add(pos, [0, -0.55, 0]), t, 0, 0, [1, 1, 1], col, { glow: 2, alpha: 0.6 });
    this.r.light(pos, col, 3.5);
  }

  /** A hole, and all of it marked `hole`: the lens bends what is behind a hole, never the hole itself. */
  well(w) {
    const t = this.t;
    this.d('sphere', w.p, 0, 0, 0, [w.horizon * 2, w.horizon * 2, w.horizon * 2], '#000000', { hole: true });
    this.d('torus', w.p, t * 1.3, 0.35, 0, [w.horizon * 4, w.horizon * 4, w.horizon * 4], '#ff9a4a', { glow: 2.5, alpha: 0.85, hole: true });
    this.d('ring', w.p, -t * 0.8, 1.1, 0.4, [w.horizon * 5.5, w.horizon * 5.5, w.horizon * 5.5], '#c9a2ff', { glow: 2, alpha: 0.5, hole: true });
    // A few motes being drawn in.
    for (let i = 0; i < 14; i++) {
      const k = ((t * 0.4 + i / 14) % 1);
      const rr = w.horizon * (1.2 + (1 - k) * 5);
      const a = i * 2.4 + k * 6;
      this.r.point(add(w.p, [Math.cos(a) * rr, Math.sin(i) * rr * 0.25, Math.sin(a) * rr]), 0.08, '#ffd0a0', 0.8, true);
    }
  }

  hazard(h) {
    if (!h.laser) return;
    const t = this.t;
    const c = [(h.min[0] + h.max[0]) / 2, (h.min[1] + h.max[1]) / 2, (h.min[2] + h.max[2]) / 2];
    const sx = h.max[0] - h.min[0];
    const sy = h.max[1] - h.min[1];
    const sz = h.max[2] - h.min[2];
    const col = h.color || '#ff3050';
    if (h.stream) {
      // A pour: a thick stream while it runs, and a thin dribble as it tips and swings back.
      if (h.lit) {
        this.d('box', c, 0, 0, 0, [sx * 0.8, sy, sz * 0.8], col, { glow: 2.5, alpha: 0.95 });
        this.r.light([c[0], h.min[1] + 0.5, c[2]], col, 9);
      } else if (h.warn) this.d('box', c, 0, 0, 0, [0.12, sy, 0.12], col, { glow: 2, alpha: 0.8 });
      return;
    }
    if (h.lit) {
      this.d('box', c, 0, 0, 0, [Math.max(0.06, sx < 0.5 ? 0.08 : sx), sy, Math.max(0.06, sz < 0.5 ? 0.08 : sz)], col, { glow: 3, alpha: 0.75 });
      this.r.light(c, col, 6);
    } else if (h.warn && Math.sin(t * 40) > 0) {
      this.d('box', c, 0, 0, 0, [sx < 0.5 ? 0.03 : sx, sy, sz < 0.5 ? 0.03 : sz], '#ff9aa8', { glow: 1, alpha: 0.35 });
    }
  }

  /**
   * A beam of light, as it runs now through whatever ends are open (the same
   * path the game lights its receiver by), a glow where it lands, and its
   * receiver lit once it has been reached.
   */
  beam(bm, g) {
    const r = beamPath(g.world, g.openEnds, bm.p, bm.dir);
    const flick = 0.85 + 0.15 * Math.sin(this.t * 31);
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const p = r.pts[i];
      const q = r.pts[i + 1];
      if (!p || !q) continue;
      const d = sub(q, p);
      const l = len(d);
      if (l < 1e-3) continue;
      const along = scale(d, 1 / l);
      const side = norm(Math.abs(along[1]) > 0.95 ? cross(along, [1, 0, 0]) : cross(along, [0, 1, 0]));
      const up = cross(side, along);
      const mid = add(p, scale(d, 0.5));
      this.r.draw('box', model(mid, side, up, along, [0.05, 0.05, l]), '#ffffff', { glow: 3, alpha: 0.9 * flick });
      this.r.draw('box', model(mid, side, up, along, [0.16, 0.16, l]), bm.color, { glow: 2, alpha: 0.35 * flick });
    }
    const end = r.pts[r.pts.length - 1];
    if (end) {
      this.d('ball', end, 0, 0, 0, [0.22, 0.22, 0.22], bm.color, { glow: 3, alpha: 0.8 * flick });
      this.r.light(end, bm.color, 4);
    }
    for (const sw of g.world.switches) {
      const s = sw.solid;
      if (!s || !s.receiver || !sw.on) continue;
      const c = [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
      this.d('box', c, 0, 0, 0, [s.max[0] - s.min[0] + 0.04, s.max[1] - s.min[1] + 0.04, s.max[2] - s.min[2] + 0.04], bm.color, { glow: 2.5, alpha: 0.55 });
      this.r.light(c, bm.color, 7);
    }
  }

  /** A conveyor: bars across its top, sliding the way it carries. */
  belt(s) {
    const v = s.vel;
    const sp = len(v);
    if (sp < 1e-3) return;
    const d = scale(v, 1 / sp);
    const across = [-d[2], 0, d[0]];
    const ext = [s.max[0] - s.min[0], s.max[2] - s.min[2]];
    const along = Math.abs(d[0]) * ext[0] + Math.abs(d[2]) * ext[1];
    const wide = Math.abs(across[0]) * ext[0] + Math.abs(across[2]) * ext[1];
    const c = [(s.min[0] + s.max[0]) / 2, s.max[1] + 0.01, (s.min[2] + s.max[2]) / 2];
    const gap = 1.2;
    const off = (this.t * sp) % gap;
    for (let k = -along / 2 + off; k < along / 2; k += gap) {
      this.r.draw('box', model(add(c, scale(d, k)), across, [0, 1, 0], d, [wide - 0.3, 0.02, 0.12]), '#ffd36a', { glow: 0.8, alpha: 0.6 });
    }
  }

  /** A cable: from a point to a point, or to a moving solid's top, or straight up from it. */
  tether(t, g) {
    const s = t.solid != null ? g.world.solids.find((x) => x.id === t.solid) : null;
    const top = s ? [(s.min[0] + s.max[0]) / 2, s.max[1], (s.min[2] + s.max[2]) / 2] : null;
    const p = t.from || top;
    const q = t.to || (t.up ? add(top, [0, t.up, 0]) : top);
    if (!p || !q) return;
    const d = sub(q, p);
    const l = len(d);
    if (l < 1e-3) return;
    const along = scale(d, 1 / l);
    const side = norm(Math.abs(along[1]) > 0.95 ? cross(along, [1, 0, 0]) : cross(along, [0, 1, 0]));
    const up = cross(side, along);
    this.r.draw('box', model(add(p, scale(d, 0.5)), side, up, along, [t.w || 0.07, t.w || 0.07, l]), t.color || '#2a2e36', { mat: 'metal' });
  }

  /**
   * A fan, so it reads as a way up: a grille with blades turning under it, a
   * faint column of air over it, and streaks rising through the column, fast
   * and bright at the bottom and fading at the top.
   */
  fan(f) {
    const t = this.t;
    const sx = f.max[0] - f.min[0];
    const sz = f.max[2] - f.min[2];
    const sy = f.max[1] - f.min[1];
    const c = [(f.min[0] + f.max[0]) / 2, f.min[1], (f.min[2] + f.max[2]) / 2];
    const r = Math.min(sx, sz) / 2;
    // The blades, under the grille, turning fast.
    for (let i = 0; i < 4; i++) {
      const a = t * 9 + (i * Math.PI) / 2;
      this.d('box', add(c, [Math.sin(a) * r * 0.45, 0.02, Math.cos(a) * r * 0.45]), a, 0, 0.35, [0.22, 0.03, r * 0.85], '#8a96a4', { mat: 'metal' });
    }
    this.d('cyl', add(c, [0, 0.03, 0]), 0, 0, 0, [0.35, 0.06, 0.35], '#c8d4e0', { mat: 'metal', glow: 0.3 });
    // The grille's bars across it, and a ring of light round the shaft.
    for (let i = 1; i < 6; i++) this.d('box', [f.min[0] + (sx * i) / 6, c[1] + 0.06, c[2]], 0, 0, 0, [0.05, 0.04, sz], '#2a3038', { mat: 'metal' });
    this.d('box', [c[0], c[1] + 0.1, c[2]], 0, 0, 0, [sx, 0.02, sz], '#bfe6ff', { glow: 1.2, alpha: 0.25 });
    // The column of rising air.
    this.d('box', [c[0], c[1] + sy / 2, c[2]], 0, 0, 0, [sx * 0.96, sy, sz * 0.96], '#bfe6ff', { glow: 0.8, alpha: 0.05 });
    for (let i = 0; i < 40; i++) {
      const k = (t * 0.9 + i / 40) % 1;
      const x = f.min[0] + 0.2 + ((i * 0.37) % 1) * (sx - 0.4);
      const z = f.min[2] + 0.2 + ((i * 0.61) % 1) * (sz - 0.4);
      const y = f.min[1] + k * sy;
      const a = 0.9 * (1 - k);
      this.r.point([x, y, z], 0.16, '#dff4ff', a);
      this.r.point([x, y - 0.35, z], 0.1, '#bfe6ff', a * 0.6);
      this.r.point([x, y - 0.7, z], 0.07, '#bfe6ff', a * 0.3);
    }
  }

  /**
   * A launch's ward: a faint shimmer hung over the gap's near lip, lines of
   * light drifting up it, a post either side. No end opens through it from
   * this side (wormholes.js, warded); the aim shows a red cross there too.
   */
  ward(w) {
    const t = this.t;
    const up = [0, 1, 0];
    const H = 7;
    const base = [w.c[0], w.c[1] - 2, w.c[2]];
    const mid = add(base, [0, H / 2, 0]);
    this.r.draw('box', model(mid, w.r, up, w.n, [w.hw * 2 - 3, H, 0.02]), w.look, { glow: 1, alpha: 0.05 });
    for (let i = 0; i < 6; i++) {
      const k = (t * 0.25 + i / 6) % 1;
      this.r.draw('box', model(add(base, [0, k * H, 0]), w.r, up, w.n, [w.hw * 2 - 3, 0.03, 0.02]), w.look, { glow: 2, alpha: 0.3 * Math.sin(k * Math.PI) });
    }
    for (const side of [-1, 1]) {
      const p = add(add(w.c, scale(w.r, side * (w.hw - 1.8))), [0, 1.2, 0]);
      this.d('box', p, Math.atan2(w.n[0], w.n[2]), 0, 0, [0.12, 2.4, 0.12], '#3a4048', { mat: 'metal' });
      this.d('ball', add(p, [0, 1.25, 0]), 0, 0, 0, [0.18, 0.18, 0.18], w.look, { glow: 2.5 });
    }
  }

  checkpoints(g) {
    g.bp.checkpoints.forEach((c, i) => {
      if (i <= g.checkpoint) return;
      const p = [c.p[0], c.p[1] + 1.2, c.p[2]];
      this.d('cyl', p, 0, 0, 0, [1.6, 4.5, 1.6], g.bp.def.accent || '#9dff5c', { glow: 1.5, alpha: 0.18 });
    });
    const A = g.bp.arena;
    if (A && g.phase === 'exit') {
      const e = [(A.exit.min[0] + A.exit.max[0]) / 2, A.floor + 3, (A.exit.min[2] + A.exit.max[2]) / 2];
      this.d('cyl', e, 0, 0, 0, [2.4, 6, 2.4], '#ffe066', { glow: 2, alpha: 0.25 });
    }
  }

  /**
   * A robot's body in its player's colours. Your own is drawn only in a
   * wormhole's view (through one, you may see yourself); everyone else's
   * always. A robot held by Frost is iced over.
   */
  robotBody(b, look = PLAYERS[0], mine = true) {
    const only = mine ? { onlyPortal: true } : {};
    const o = { ...only, mat: 'panel', glow: 0.3 };
    const col = b.frozen > 0 ? '#cfefff' : look.color;
    const yaw = b.yaw;
    const at = (x, y, z) => add(b.pos, rotY([x, y, z], yaw));
    this.d('box', at(0, 0.25, 0), yaw, 0, 0, [0.62, 0.8, 0.46], col, o);
    this.d('box', at(0, 0.82, 0.02), yaw, 0, 0, [0.5, 0.36, 0.42], col, o);
    this.d('box', at(0, 0.84, 0.22), yaw, 0, 0, [0.36, 0.1, 0.04], '#e8fdff', { ...only, glow: 2 });
    this.d('box', at(0.18, -0.45, 0), yaw, 0, 0, [0.14, 0.6, 0.14], col, o);
    this.d('box', at(-0.18, -0.45, 0), yaw, 0, 0, [0.14, 0.6, 0.14], col, o);
    this.d('ball', at(0, -0.85, 0), 0, 0, 0, [0.3, 0.1, 0.3], look.charge, { ...only, glow: 3 });
    // The blaster, pointing where the robot looks.
    const aim = lookDir(yaw, b.pitch || 0);
    this.d('box', add(at(-0.38, 0.35, 0), scale(aim, 0.25)), yaw, -(b.pitch || 0), 0, [0.14, 0.14, 0.6], look.trim, o);
    if (b.frozen > 0) this.d('box', b.pos, yaw, 0, 0, [1, 2, 1], '#bfefff', { ...only, mat: 'glass', alpha: 0.35, glow: 0.4 });
    if (!mine) this.r.light(at(0, 0.84, 0.3), look.color, 2.5);
  }

  // ------------------------------------------------------------ the aim

  aim(g, view) {
    const b = g.bot;
    const dir = lookDir(b.yaw, b.pitch);
    const gl = guideLine(g.world, g.openEnds, g.muzzle(dir), dir, g.loaded, 1.2);
    const col = PCOL[g.loaded] || '#dffbff';
    let k = 0;
    for (const p of gl.pts) {
      k++;
      if (!p || k < 6 || k % 5) continue;
      this.r.point(p, 0.05, col, 0.7);
    }
    // Where each end would open, if it can.
    const sl = sightLine(g.world, b.eyePos(), dir);
    this.lastSight = sl;
    if (!sl.hit) return;
    const { end } = placeEnd(g.world, sl.hit, dir, g.ends[0] || g.ends[1], b.eyePos());
    if (end) {
      this.r.draw('ring', model(add(end.c, scale(end.n, 0.03)), end.u, end.n, end.v, [WORM.a * 2, 1, WORM.b * 2]), '#ffffff', { glow: 1.5, alpha: 0.35 });
    } else {
      const p = add(sl.hit.p, scale(sl.hit.n, 0.03));
      const [u, v] = sl.hit.plane && sl.hit.plane.face ? [sl.hit.plane.face.u, sl.hit.plane.face.v] : [[1, 0, 0], [0, 1, 0]];
      const d1 = norm(add(u, v));
      const d2 = norm(sub(u, v));
      this.r.draw('box', model(p, d1, sl.hit.n, cross(d1, sl.hit.n), [0.5, 0.02, 0.06]), '#ff3050', { glow: 2, alpha: 0.8 });
      this.r.draw('box', model(p, d2, sl.hit.n, cross(d2, sl.hit.n), [0.5, 0.02, 0.06]), '#ff3050', { glow: 2, alpha: 0.8 });
    }
  }

  /** The blaster in your hand, drawn in the camera's own space after everything else (x right, y up, -z ahead). */
  viewmodel(r, g, view = {}) {
    const b = g.bot;
    const F = FINISHES[view.finish] || FINISHES.standard;
    const kick = g.flash > 0 ? g.flash * 1.6 : 0;
    const hs = Math.hypot(b.vel[0], b.vel[2]);
    const k = b.onGround ? Math.min(1, hs / 6) : 0;
    const sway = Math.sin(b.bob) * 0.008 * k;
    const bobY = Math.abs(Math.cos(b.bob)) * 0.006 * k;
    const base = [0.17 + sway, -0.17 - bobY, -0.56 + kick * 0.04];
    // The standard charge's colour: cyan alone, and each player's own with more than one robot about.
    const std = g.multi ? PLAYERS[g.local].color : '#4fd8ff';
    const col = g.loaded === 'std' ? std : PCOL[g.loaded] || std;
    const metal = { mat: 'metal' };
    // A part at (x, y, z) from the gun's middle, turned with its muzzle up by the kick.
    const P = (shape, x, y, z, sx, sy, sz, c, o = metal, pitch = 0) => r.draw(shape, modelYPR([base[0] + x, base[1] + y, base[2] + z], Math.PI, pitch + kick * 0.25, 0, [sx, sy, sz]), c, o);
    P('box', 0, 0, 0, 0.05, 0.05, 0.26, F.body);
    P('box', 0, -0.055, 0.1, 0.04, 0.09, 0.05, F.grip, metal, -0.3);
    P('cyl', 0, 0.005, -0.17, 0.045, 0.1, 0.045, F.barrel, metal, -Math.PI / 2);
    P('ball', 0, 0.005, -0.225, 0.035 + kick * 0.03, 0.035 + kick * 0.03, 0.035 + kick * 0.03, col, { glow: 3 + kick * 10 });
    P('box', 0, 0.027, -0.01, 0.012, 0.005, 0.18, col, { glow: 0.8 });
    // The two wormhole lamps on its side: lit while that end is open.
    const ends = PLAYERS[g.local || 0].ends;
    P('ball', -0.033, 0.012, 0.06, 0.016, 0.016, 0.016, g.ends[0] ? ends[0] : '#222831', { glow: g.ends[0] ? 3 : 0 });
    P('ball', -0.033, 0.012, 0.09, 0.016, 0.016, 0.016, g.ends[1] ? ends[1] : '#222831', { glow: g.ends[1] ? 3 : 0 });
    // The charges free: a row of pips along its top.
    const free = BLASTER.maxAlive - g.mine();
    for (let i = 0; i < BLASTER.maxAlive; i++) P('box', 0.02, 0.033, 0.11 - i * 0.022, 0.008, 0.006, 0.012, i < free ? col : '#222831', { glow: i < free ? 1 : 0 });
  }
}

export { camBasis };
