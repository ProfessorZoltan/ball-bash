// The autopilot: it plays a level the way its sections wrote down (each
// section's route, build.js), with the robot's own physics and nothing else.
// It looks, walks, runs, jumps, waits for platforms and gates, opens
// wormholes where it is told to aim, and shoots switches (searching for the
// shot when a black hole is in the way). A level it crosses without losing a
// shield is a level a player can cross. The tests fly every level with it.
//
//   node vector/tools/autopilot.mjs 3        fly level 3 and report
//   node vector/tools/autopilot.mjs all      every level
import { Game } from '../src/game.js';
import { level, LEVEL_DEFS } from '../src/levels.js';
import { PHYSICS_DT, ROBOT, MOVE, BLASTER } from '../src/config.js';
import { sub, norm, len, dot, lookDir, yawPitch, add, dist, scale, rng } from '../src/math.js';
import { guideLine, makeCharge, stepCharge } from '../src/blaster.js';
import { crusherOffset } from '../src/world.js';

const DT = PHYSICS_DT;

const flatDist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export class Autopilot {
  /** `route` flies something other than the level's own way: a secret's detour (build.js). */
  constructor(game, route = game.bp.route) {
    this.g = game;
    this.route = route;
    this.i = 0;
    this.s = {}; // the current step's own state
    this.t = 0;
    this.log = [];
    this.failed = null;
    this.done = false;
    this.r = rng(7);
  }

  fail(why) {
    this.failed = `step ${this.i} (${this.route[this.i] && this.route[this.i].a}): ${why}`;
  }

  next() {
    this.i++;
    this.s = {};
    this.t = 0;
    if (this.i >= this.route.length) this.done = true;
  }

  /** Face a point (yaw only, or yaw and pitch from the eye). */
  face(p, pitch = false) {
    const b = this.g.bot;
    const d = sub(p, pitch ? b.eyePos() : b.pos);
    const yp = yawPitch(pitch ? d : [d[0], 0, d[2]]);
    b.yaw = yp.yaw;
    b.pitch = pitch ? yp.pitch : 0;
  }

  /** Steer toward p on the ground: an intent, and whether it has arrived. */
  steer(p, run = false, tol = 0.3) {
    const b = this.g.bot;
    const d = flatDist(b.pos, p);
    if (d < tol) return { it: { mx: 0, mz: 0 }, there: true };
    this.face(p);
    // On a conveyor there is no easing off: it would carry the robot back.
    if (b.onGround && b.ground && b.ground.belt) return { it: { mx: 0, mz: 1, run: true }, there: false };
    // Ease off close in, so it stops where it was sent.
    const hs = Math.hypot(b.vel[0], b.vel[2]);
    const stop = (hs * hs) / (2 * MOVE.friction) + 0.1;
    const mz = d < stop ? 0 : d < 1.5 ? Math.max(0.35, d / 1.5) : 1;
    return { it: { mx: 0, mz, run: run && d > 3 }, there: false };
  }


  /** A jump: back up for a run-up if it needs one, run, leave at the take-off point, steer down onto the landing. */
  jump(st, S) {
    const b = this.g.bot;
    const dir = norm([st.to[0] - st.from[0], 0, st.to[2] - st.from[2]]);
    if (!S.phase) {
      // Where to start the run-up from: well back for a running jump, a step back for a walking one, none from a standstill.
      const back = st.stand ? 0 : st.run ? 7 : 1.2;
      const along = dot(sub(b.pos, st.from), dir);
      S.phase = along > -back + 0.3 || flatDist(b.pos, add(st.from, [dir[0] * -back, 0, dir[2] * -back])) > 1.5 ? 'back' : 'run';
      S.start = add(st.from, [dir[0] * -back, 0, dir[2] * -back]);
      S.start[1] = st.from[1];
    }
    if (this.t > 20) {
      this.fail(`jump never finished (${S.phase})`);
      return {};
    }
    if (S.phase === 'back') {
      const r = this.steer(S.start, false, 0.25);
      if (r.there && b.onGround && Math.hypot(b.vel[0], b.vel[2]) < 0.8) S.phase = 'run';
      return r.it;
    }
    if (S.phase === 'run') {
      this.face(st.to);
      const along = dot(sub(b.pos, st.from), dir);
      if (along >= 0 && b.onGround) {
        S.phase = 'air';
        S.air = 0;
        return { mz: 1, run: st.run, jump: true, jumpPress: true };
      }
      if (!b.onGround && along < -0.2) {
        this.fail('fell before the take-off');
        return {};
      }
      if (!b.onGround) {
        S.phase = 'air';
        S.air = 0;
        return { mz: 1, run: st.run, jump: true, jumpPress: true };
      }
      return { mz: 1, run: st.run };
    }
    // In the air: steer at the landing, jump held.
    S.air += DT;
    const d = flatDist(b.pos, st.to);
    if (S.air > 0.05 && b.onGround) {
      if (Math.abs(b.pos[1] - st.to[1]) < 0.7 && d < 3.2) this.next();
      else this.fail(`landed wrong: ${b.pos.map((v) => v.toFixed(2))} for ${st.to.map((v) => v.toFixed(2))}`);
      return {};
    }
    if (S.air > 4) {
      this.fail('never landed');
      return {};
    }
    return { ...airSteer(b, st.to), run: st.run, jump: true };
  }

  /** The intent for this step, the look set on the robot directly. */
  intent() {
    const g = this.g;
    const b = g.bot;
    this.t += DT;
    if (this.done || this.failed) return {};
    const st = this.route[this.i];
    const S = this.s;
    switch (st.a) {
      case 'go': {
        if (this.t > 20) {
          this.fail(`never got to ${st.to.map((v) => v.toFixed(1))}, at ${b.pos.map((v) => v.toFixed(1))}`);
          return {};
        }
        const r = this.steer(st.to, st.run);
        if (r.there && b.onGround) this.next();
        return r.it;
      }
      case 'jump':
        return this.jump(st, S);
      case 'waitFor': {
        const s = g.world.solids.find((x) => x.id === st.solid);
        const c = centre(s);
        this.face(c);
        // Board it as it arrives (or waits) at the stop, never as it leaves.
        const toward = dot(s.vel || [0, 0, 0], sub(st.near, c)) >= -0.02;
        if (dist(c, st.near) < st.tol && toward) this.next();
        if (this.t > 30) this.fail('the platform never came');
        return {};
      }
      case 'ride': {
        const s = g.world.solids.find((x) => x.id === st.solid);
        const c = centre(s);
        const off = st.off || [0, 0, 0];
        const top = [c[0] + off[0], s.max[1] + ROBOT.half + ROBOT.r, c[2] + off[2]];
        if (this.t > 30) this.fail('never got off the platform');
        const r = this.steer(top, false, 0.25);
        if (b.onGround && b.ground === s && flatDist(c, st.until) < st.tol && Math.abs(c[1] - st.until[1]) < 0.6) this.next();
        if (!S.boarded && b.ground === s) S.boarded = true;
        if (S.boarded && !b.onGround && b.vel[1] < -6) this.fail('fell off the platform');
        return r.it;
      }
      case 'portal': {
        if (!S.phase) S.phase = 'walk';
        if (this.t > 25) {
          this.fail(`wormhole step stuck in ${S.phase}`);
          return {};
        }
        if (S.phase === 'walk') {
          const r = this.steer(st.from, false, 0.3);
          if (r.there && b.onGround && Math.hypot(b.vel[0], b.vel[2]) < 0.4) {
            S.phase = 'aim';
            S.k = 0;
            S.wait = 0;
          }
          return r.it;
        }
        if (S.phase === 'aim') {
          const aim = st.aims[S.k];
          let at = aim.at;
          if (aim.solid != null) {
            // On something that moves: the middle of its top (and off it by `off`), once it is low enough to see.
            const s = g.world.solids.find((x) => x.id === aim.solid);
            const c = centre(s);
            const off = aim.off || [0, 0, 0];
            at = [c[0] + off[0], s.max[1], c[2] + off[2]];
            if (aim.below != null && at[1] > aim.below) {
              if (this.t > 20) this.fail('it never came low enough to see');
              return {};
            }
          }
          this.face(at, true);
          S.wait += DT;
          if (S.wait < 0.05) return {};
          const worm = [false, false];
          worm[aim.which] = true;
          S.wait = 0;
          S.k++;
          if (S.k >= st.aims.length) S.phase = 'check';
          return { worm };
        }
        if (S.phase === 'check') {
          // A guest in multiplayer sees its ends a round trip after the press: give them a moment.
          S.wait += DT;
          for (const a of st.aims) {
            const e = g.ends[a.which];
            if (!e) {
              if (S.wait < 1) return {};
              this.fail(`end ${a.which} did not open at ${a.at ? a.at.map((v) => v.toFixed(1)) : `solid ${a.solid}`}`);
              return {};
            }
          }
          b.pitch = 0;
          S.phase = st.enter ? 'enter' : 'out';
          S.warps = g.warps || 0;
          S.et = 0;
          if (!st.enter) this.next();
          return {};
        }
        if (S.phase === 'enter') {
          S.et += DT;
          if ((g.warps || 0) > S.warps) {
            this.next();
            return {};
          }
          if (S.et > 5) this.fail('walked onto the end and never went through');
          const r = this.steer(st.enter, false, 0.05);
          return { ...r.it, mz: Math.max(0.5, r.it.mz) };
        }
        return {};
      }
      case 'spring': {
        // Walk onto the pad; once it throws, steer at the ledge.
        if (!S.left) {
          if (!b.onGround && b.vel[1] > 4) S.left = true;
          if (this.t > 8) this.fail('the spring never threw');
          return this.steer(st.pad, false, 0.05).it;
        }
        if (b.onGround) {
          if (flatDist(b.pos, st.to) < 5 && Math.abs(b.pos[1] - st.to[1]) < 0.8) this.next();
          else this.fail(`came down off the spring at ${b.pos.map((v) => v.toFixed(1))}`);
          return {};
        }
        if (this.t > 8) this.fail('never came down');
        return { ...airSteer(b, st.to), jump: true };
      }
      case 'settle': {
        if (b.onGround && Math.hypot(b.vel[0], b.vel[2]) < 0.6) this.next();
        if (this.t > 4) this.fail('never settled');
        return {};
      }
      case 'fly': {
        // Thrown (a launch, a spring): steer at the landing with jump held.
        if (!S.left) {
          if (!b.onGround) S.left = true;
          if (this.t > 3) this.fail('never thrown');
          return {};
        }
        if (b.onGround) {
          if (flatDist(b.pos, st.to) < 5 && Math.abs(b.pos[1] - st.to[1]) < 0.8) this.next();
          else this.fail(`came down at ${b.pos.map((v) => v.toFixed(1))}, not ${st.to.map((v) => v.toFixed(1))}`);
          return {};
        }
        if (this.t > 6) this.fail('never came down');
        return { ...airSteer(b, st.to), jump: true };
      }
      case 'updraft': {
        if (this.t > 15) {
          this.fail('the updraft never carried it up');
          return {};
        }
        if (!S.up) {
          if (b.feet > st.to[1] - FEETUP + 0.9) S.up = true;
          const r = this.steer(st.in, false, 0.3);
          return { ...r.it, jump: true };
        }
        if (b.onGround && this.t > 0.3) {
          if (Math.abs(b.pos[1] - st.to[1]) < 0.7) this.next();
          else this.fail('fell out of the updraft');
          return {};
        }
        const r = this.steer(st.to, false, 0.3);
        return { ...r.it, jump: true };
      }
      case 'shoot': {
        const sw = g.world.switches.find((x) => x.id === st.sw);
        if (sw.on) {
          this.next();
          return {};
        }
        if (this.t > 20) {
          this.fail('the switch never came on');
          return {};
        }
        if (!S.phase) S.phase = 'walk';
        if (S.phase === 'walk') {
          const r = this.steer(st.from, false, 0.3);
          if (r.there && b.onGround && Math.hypot(b.vel[0], b.vel[2]) < 0.3) {
            S.phase = 'aim';
            S.tries = 0;
          }
          return r.it;
        }
        if (S.phase === 'aim') {
          if (st.search) {
            const shot = searchShot(g, sw, st.near);
            if (!shot) {
              this.fail('no shot found');
              return {};
            }
            b.yaw = shot.yaw;
            b.pitch = shot.pitch;
          } else {
            let at = st.at;
            if (at === 'end1') {
              const e = g.ends[1];
              if (!e) {
                this.fail('no end to fire into');
                return {};
              }
              at = add(e.c, [0, 0, 0]);
              at = [e.c[0], b.eyePos()[1], e.c[2]];
            }
            this.face(at, true);
          }
          S.phase = 'fire';
          S.ft = 0;
          return {};
        }
        if (S.phase === 'fire') {
          S.phase = 'watch';
          S.ft = 0;
          S.tries++;
          return { firePress: true };
        }
        S.ft += DT;
        if (S.ft > 3) {
          if (S.tries > 3) this.fail('three shots and the switch still off');
          S.phase = 'aim';
        }
        return {};
      }
      case 'gate': {
        const h = g.world.hazards.find((x) => x.id === st.hazard);
        const L = h.laser;
        const u = (((g.world.time + L.phase) % L.period) + L.period) % L.period;
        if (!S.go) {
          this.face(st.to);
          if (u >= L.on + 0.05 && L.period - u > 0.9) S.go = true;
          if (this.t > 12) this.fail('the gate never went dark');
          return {};
        }
        const r = this.steer(st.to, true, 0.4);
        if (r.there) this.next();
        if (this.t > 15) this.fail('stuck at a gate');
        return { ...r.it, run: true, mz: r.there ? 0 : 1 };
      }
      case 'crush': {
        const s = g.world.solids.find((x) => x.id === st.solid);
        const c = s.crush;
        const u = (((g.world.time + (c.phase || 0)) % c.period) + c.period) % c.period / c.period;
        if (!S.go) {
          this.face(st.to);
          if (u < 0.05 && crusherOffset(c, g.world.time)[1] === 0) S.go = true;
          if (this.t > 12) this.fail('the crusher never rose');
          return {};
        }
        const r = this.steer(st.to, true, 0.4);
        if (r.there) this.next();
        if (this.t > 15) this.fail('stuck at a crusher');
        return { ...r.it, run: true, mz: r.there ? 0 : 1 };
      }
      case 'hop': {
        // A blinking platform: wait on the edge for it to light, then jump.
        const s = g.world.solids.find((x) => x.id === st.solid);
        const bl = s.blink;
        const u = (((g.world.time + bl.phase) % bl.period) + bl.period) % bl.period;
        if (!S.phase) S.phase = 'wait';
        if (S.phase === 'wait') {
          const r = this.steer(st.from, false, 0.3);
          // Go when it is lit and will stay lit long enough to land on and jump on from.
          if (r.there && !s.hidden && bl.off - u > 1.5 && b.onGround) S.phase = 'run';
          if (this.t > 15) this.fail('the platform never lit');
          return r.it;
        }
        return this.jump({ ...st, run: false }, S);
      }
      case 'clear': {
        const a = g.ambushes.find((x) => x.state === 'fight');
        if (!a) {
          if (g.ambushes.some((x) => x.state === 'done') || this.t > 1) this.next();
          return {};
        }
        if (this.t > 120) {
          this.fail('the ambush never ended');
          return {};
        }
        // Fight: the nearest machine it has a shot at, banks included; if none, move on round the room.
        S.aimT = (S.aimT || 0) - DT;
        if (S.aimT <= 0 && g.cooldown <= 0 && g.mine() < BLASTER.maxAlive) {
          S.aimT = 0.15;
          // A guest in multiplayer has no list of the wave: it fights what it sees in the room.
          const inRoom = (e) => e.pos[0] >= a.min[0] && e.pos[0] <= a.max[0] && e.pos[2] >= a.min[2] && e.pos[2] <= a.max[2];
          const foes = (a.foes || g.enemies.filter(inRoom)).filter((e) => !e.dead && e.frozen <= 0).sort((p, q) => dist(p.pos, b.pos) - dist(q.pos, b.pos));
          for (const e of foes.slice(0, 3)) {
            const shot = shotAt(g, e, this.r);
            if (shot) {
              b.yaw = shot.yaw;
              b.pitch = shot.pitch;
              return { firePress: true };
            }
          }
          S.wander = null;
        }
        if (!S.wander || flatDist(b.pos, S.wander) < 0.8) {
          const c = a.dropAt;
          const ang = this.r() * Math.PI * 2;
          S.wander = [c[0] + Math.cos(ang) * 5, b.pos[1], c[2] + Math.sin(ang) * 5];
        }
        return this.steer(S.wander, true, 0.5).it;
      }
      case 'break': {
        // A panel (a secret's cover, a crate) shot until it gives: from a spot, at a point on it.
        const s = g.world.solids.find((x) => x.id === st.solid);
        if (!s || s.gone) {
          this.next();
          return {};
        }
        if (this.t > 20) {
          this.fail('the panel never broke');
          return {};
        }
        if (!S.there) {
          const r = this.steer(st.from, false, 0.3);
          if (r.there && b.onGround && Math.hypot(b.vel[0], b.vel[2]) < 0.3) S.there = true;
          return r.it;
        }
        this.face(st.at, true);
        S.wait = (S.wait || 0) + DT;
        if (S.wait > 0.08 && g.cooldown <= 0) {
          S.wait = 0;
          return { firePress: true };
        }
        return {};
      }
      case 'take': {
        // The nearest prize still there, near a point: walk (or fall) onto it. One taken on the way there counts.
        const near = g.pickups.filter((q) => dist(q.pos, st.near) < 4);
        const p = near.filter((q) => !q.taken).sort((x, y) => dist(x.pos, st.near) - dist(y.pos, st.near))[0];
        if (!p) {
          if (S.had || near.some((q) => q.taken)) this.next();
          else if (this.t > 3) this.fail(`no prize near ${st.near.map((v) => v.toFixed(1))}`);
          return {};
        }
        S.had = true;
        if (this.t > 20) {
          this.fail('never reached the prize');
          return {};
        }
        // Walked up against something low (a block in a locked room): hop onto it.
        const it = this.steer(p.pos, false, 0.05).it;
        S.stuck = b.onGround && Math.hypot(b.vel[0], b.vel[2]) < 0.5 && flatDist(b.pos, p.pos) > 1 ? (S.stuck || 0) + DT : 0;
        if (S.stuck > 0.4) {
          S.stuck = 0;
          return { ...it, jump: true, jumpPress: true };
        }
        return { ...it, jump: !b.onGround };
      }
      case 'drop': {
        // Off an edge and down onto a spot: walk at it, and once falling, steer at it.
        if (this.t > 10) {
          this.fail('never came down where it was going');
          return {};
        }
        if (b.onGround && S.left) {
          if (flatDist(b.pos, st.to) < 1.2 && Math.abs(b.pos[1] - st.to[1]) < 0.8) this.next();
          else this.fail(`came down at ${b.pos.map((v) => v.toFixed(1))}, not ${st.to.map((v) => v.toFixed(1))}`);
          return {};
        }
        if (!b.onGround) S.left = true;
        if (S.left) return airSteer(b, st.to);
        return { ...this.steer(st.to, false, 0.05).it, mz: 1 };
      }
      case 'fling': {
        // Off an edge, down into a wormhole end, and out of its twin, thrown: steer at the end while
        // falling, and at the landing once through.
        if (this.t > 12) {
          this.fail('never came down from the fling');
          return {};
        }
        if (S.warps == null) S.warps = g.warps || 0;
        const through = (g.warps || 0) > S.warps;
        if (through && b.onGround) {
          if (flatDist(b.pos, st.to) < 5 && Math.abs(b.pos[1] - st.to[1]) < 0.8) this.next();
          else this.fail(`flung down at ${b.pos.map((v) => v.toFixed(1))}, not ${st.to.map((v) => v.toFixed(1))}`);
          return {};
        }
        if (through) return { ...airSteer(b, st.to), jump: true };
        if (!b.onGround) S.left = true;
        if (S.left && b.onGround) {
          this.fail(`landed at ${b.pos.map((v) => v.toFixed(1))} and never went into the end`);
          return {};
        }
        if (S.left) return airSteer(b, st.into);
        return { ...this.steer(st.into, false, 0.05).it, mz: 1 };
      }
      case 'onto': {
        // Up out of an end and down onto a moving platform, clear of the end's mouth.
        const s = g.world.solids.find((x) => x.id === st.solid);
        const c = centre(s);
        const off = st.off || [0, 0, 0];
        const spot = [c[0] + off[0], s.max[1] + ROBOT.half + ROBOT.r, c[2] + off[2]];
        if (b.onGround && b.ground === s) {
          this.next();
          return {};
        }
        if (this.t > 6) {
          this.fail(`never came down on the platform, at ${b.pos.map((v) => v.toFixed(1))}`);
          return {};
        }
        if (b.onGround) return this.steer(spot, false, 0.05).it;
        return airSteer(b, spot);
      }
      case 'leap': {
        // Already on the move (a conveyor under it): run on at the landing and jump at the edge.
        const dir = norm([st.to[0] - st.edge[0], 0, st.to[2] - st.edge[2]]);
        if (this.t > 10) {
          this.fail('never leapt');
          return {};
        }
        if (!S.air) {
          this.face(st.to);
          const along = dot(sub(b.pos, st.edge), dir);
          if (along >= 0 && b.onGround) {
            S.air = true;
            return { mz: 1, run: true, jump: true, jumpPress: true };
          }
          if (!b.onGround && along < -0.3) this.fail('fell before the edge');
          return { mz: 1, run: true };
        }
        if (b.onGround && !S.up) {
          if (Math.abs(b.pos[1] - st.to[1]) < 0.7 && flatDist(b.pos, st.to) < 3.2) this.next();
          else this.fail(`leapt to ${b.pos.map((v) => v.toFixed(2))}, not ${st.to.map((v) => v.toFixed(2))}`);
          return {};
        }
        S.up = !b.onGround ? false : S.up;
        return { ...airSteer(b, st.to), run: true, jump: true };
      }
      case 'enter': {
        // Onto a wormhole end already open, and through it.
        if (S.warps == null) S.warps = g.warps || 0;
        if ((g.warps || 0) > S.warps) {
          this.next();
          return {};
        }
        if (this.t > 6) {
          this.fail('walked onto the end and never went through');
          return {};
        }
        const r = this.steer(st.at, false, 0.05);
        return { ...r.it, mz: Math.max(0.5, r.it.mz) };
      }
      case 'wait': {
        if (this.t >= st.t) this.next();
        return {};
      }
      case 'boss':
        this.done = true;
        return {};
      default:
        this.fail(`unknown step ${st.a}`);
        return {};
    }
  }
}

const FEETUP = 0;

/**
 * A shot at a machine: straight at where it will be first, then a spray of
 * aims, each flown ahead with the charge's own physics; one counts when it
 * reaches the machine clear of any shield it carries (a bank off a wall
 * comes at a guard from the side).
 */
export function shotAt(g, e, r = Math.random) {
  const b = g.bot;
  const eye = b.eyePos();
  const lead = add(e.pos, scale(e.vel, dist(eye, e.pos) / BLASTER.speed));
  const base = yawPitch(sub(lead, eye));
  const cands = [[base.yaw, base.pitch]];
  for (let i = 0; i < 70; i++) cands.push([base.yaw + (r() - 0.5) * 2.4, base.pitch + (r() - 0.5) * 0.6]);
  for (const [yaw, pitch] of cands) {
    const dir = lookDir(yaw, pitch);
    const c = makeCharge(g.muzzle(dir), dir, 'std', 'test');
    c.trail = null;
    for (let t = 0; t < 1.3 && !c.dead; t += DT) {
      stepCharge(c, g.world, g.openEnds, DT, (s) => (s.crate || s.cover || s.switchRef ? 'stop' : null));
      const at = add(e.pos, scale(e.vel, t));
      if (dist(c.pos, at) < e.r + c.r) {
        if (e.folded && !c.portaled) break;
        if (e.shield) {
          const face = [Math.sin(e.yaw), 0, Math.cos(e.yaw)];
          if (dot(face, norm(sub(c.pos, at))) > 0.3) break;
        }
        return { yaw, pitch };
      }
    }
  }
  return null;
}

/**
 * Steering in the air: the horizontal velocity that would bring it down on
 * the target when it falls to the target's height, and a push toward it.
 * The yaw stays on the target; the push goes by strafe as well as forward.
 */
function airSteer(b, to) {
  const dy = b.pos[1] - to[1];
  const vy = b.vel[1];
  const g = vy > 0 ? MOVE.gUp : MOVE.gFall;
  const disc = vy * vy + 2 * g * dy;
  const t = disc > 0 ? Math.max(0.12, (vy + Math.sqrt(disc)) / g) : 0.12;
  const want = [(to[0] - b.pos[0]) / t, 0, (to[2] - b.pos[2]) / t];
  const dx = want[0] - b.vel[0];
  const dz = want[2] - b.vel[2];
  const m = Math.hypot(dx, dz);
  if (Math.hypot(to[0] - b.pos[0], to[2] - b.pos[2]) > 0.8) b.yaw = Math.atan2(to[0] - b.pos[0], to[2] - b.pos[2]);
  b.pitch = 0;
  if (m < 0.25) return { mx: 0, mz: 0 };
  const k = Math.min(1, m / 1.5);
  const fx = Math.sin(b.yaw);
  const fz = Math.cos(b.yaw);
  return { mz: ((dx * fx + dz * fz) / m) * k, mx: ((dx * -fz + dz * fx) / m) * k };
}

function centre(s) {
  return [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];
}

/** A shot at a switch that a straight line cannot reach: fly the charge ahead over a fan of aims round the black hole. */
export function searchShot(g, sw, near) {
  const b = g.bot;
  const eye = b.eyePos();
  const base = yawPitch(sub(near, eye));
  let best = null;
  for (let dy = -0.9; dy <= 0.9; dy += 0.03) {
    for (let dp = -0.5; dp <= 0.7; dp += 0.03) {
      const yaw = base.yaw + dy;
      const pitch = Math.max(-1.4, Math.min(1.4, base.pitch + dp));
      const dir = lookDir(yaw, pitch);
      const muzzle = g.muzzle(dir);
      const gl = guideLine(g.world, g.openEnds, muzzle, dir, 'std', 3);
      if (gl.end && gl.end.s === 'stopped' && gl.end.solid && gl.end.solid.switchRef === sw) {
        const score = Math.abs(dy) + Math.abs(dp);
        if (!best || score < best.score) best = { yaw, pitch, score };
      }
    }
  }
  return best;
}

/**
 * Fly a level from its start (or a given checkpoint) to its boss's door.
 * Returns { ok, why, time, hurts, step }.
 */
export function fly(id, opts = {}) {
  let game = opts.game;
  if (!game) {
    const bp = level(id, { noEnemies: opts.enemies !== true });
    game = new Game(bp, { shields: Infinity, maxShields: Infinity, noWaves: opts.enemies !== true, invulnerable: !!opts.invulnerable });
  }
  const ap = new Autopilot(game);
  let hurts = 0;
  const limit = opts.limit || 60 * 40;
  let t = 0;
  const hurtLog = [];
  while (!ap.done && !ap.failed && t < limit) {
    const it = ap.intent();
    game.events.length = 0;
    game.step(DT, it);
    for (const e of game.events) {
      if (e.s === 'hurt') {
        hurts++;
        hurtLog.push(`${e.why} at step ${ap.i} (${ap.route[ap.i] && ap.route[ap.i].a}) ${game.bot.pos.map((v) => v.toFixed(1))}`);
      }
    }
    if (game.phase === 'boss') ap.done = true;
    t += DT;
  }
  if (!ap.done && !ap.failed) ap.fail('ran out of time');
  return { ok: ap.done && !ap.failed && hurts === 0, why: ap.failed || (hurts ? `${hurts} shields lost: ${hurtLog.slice(0, 3).join('; ')}` : ''), time: t, hurts, step: ap.i, steps: ap.route.length, game };
}

if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2] || 'all';
  const ids = arg === 'all' ? LEVEL_DEFS.map((l) => l.id) : arg.split(',').map(Number);
  for (const id of ids) {
    const t0 = Date.now();
    const r = fly(id);
    console.log(`level ${id}: ${r.ok ? 'crossed' : 'FAILED'} in ${r.time.toFixed(0)} s of play (${r.step}/${r.steps} steps, ${Date.now() - t0} ms)${r.why ? ` — ${r.why}` : ''}`);
  }
}

export { dist, len };
