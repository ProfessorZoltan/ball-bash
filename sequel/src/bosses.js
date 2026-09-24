// The ten bosses. DOM-free.
//
// A boss is a body made of parts, rebuilt every step: `core` parts take
// damage, `armor` parts turn a charge away like a wall, and `plate` parts
// are Deflector shields, moving surfaces that turn a charge away with their
// own motion added. So most bosses are beaten the Deflector way, by banking
// a shot round what they hold up. Each one has its own arena (the room the
// level ends in, with its own platforms, wells and pulses), its own brain
// and its own size, speed, toughness and attacks.
//
// A brain gets `g`, the game's side of the bargain: g.bot (the robot),
// g.charges (the robot's, in the air), g.world, g.wells (the arena's own
// gravity bodies), g.shot(x, y, angle,
// speed, opts), g.spawn(enemySpec),
// g.hazard(h), g.addWell(spec), g.removeWell(well), g.fx, g.sound(name),
// g.enemyCount().
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angleTo = (b, p) => Math.atan2(p.y - b.y, p.x - b.x);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Ease the boss toward (tx, ty), no faster than `max`, turning its velocity at `acc`. */
function seek(b, tx, ty, max, acc, dt) {
  const dx = tx - b.x;
  const dy = ty - b.y;
  const d = Math.hypot(dx, dy);
  const want = Math.min(max, d * 3);
  const wx = d > 1 ? (dx / d) * want : 0;
  const wy = d > 1 ? (dy / d) * want : 0;
  const ax = wx - b.vx;
  const ay = wy - b.vy;
  const al = Math.hypot(ax, ay);
  const k = al > acc * dt ? (acc * dt) / al : 1;
  b.vx += ax * k;
  b.vy += ay * k;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

/** A plate (a shield) as a part: centred `off` from (cx, cy) along `angle`, `w` wide, turning at `omega`. */
function plate(cx, cy, angle, off, w, omega = 0, vx = 0, vy = 0, thick = 6) {
  const px = cx + Math.cos(angle) * off;
  const py = cy + Math.sin(angle) * off;
  const tx = -Math.sin(angle) * (w / 2);
  const ty = Math.cos(angle) * (w / 2);
  return {
    type: 'plate',
    seg: { ax: px - tx, ay: py - ty, bx: px + tx, by: py + ty },
    thick,
    pivot: { x: cx, y: cy }, // what it turns about, and how fast: enough to say where it will be
    omega,
    velAt: (x, y) => ({ x: vx - omega * (y - cy), y: vy + omega * (x - cx) }),
  };
}

/** Turn `cur` toward `want` by at most `rate * dt`. */
function turnToward(cur, want, rate, dt) {
  const d = wrap(want - cur);
  return cur + clamp(d, -rate * dt, rate * dt);
}

// ------------------------------------------------------------------ arenas
// Every arena is W x H inside, entered from the left at floor level. Its
// extras are drawn up in arena coordinates: (0, 0) is the top-left corner of
// the room and the floor is at y = H.
const W = 1280;
const H = 680;

export const BOSSES = {
  gardener: {
    name: 'The Gardener',
    epithet: 'keeper of the orchard lawns',
    color: '#9dff5c',
    hp: 14,
    r: 54,
    arena: {
      w: W,
      h: H,
      oneWays: [{ x0: 170, x1: 390, y: H - 190 }, { x0: 890, x1: 1110, y: H - 190 }, { x0: 520, x1: 760, y: H - 360 }],
    },
    init(b, A) {
      b.x = A.x1 - 200;
      b.y = A.floor - b.r;
      b.dir = -1;
      b.state = 'patrol';
      b.timer = 2.5;
      b.lobs = 0;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      b.y = A.floor - b.r;
      if (b.state === 'patrol') {
        b.vx = b.dir * 110;
        b.timer -= dt;
        if (b.timer <= 0) {
          b.lobs++;
          if (b.lobs % 3 === 0) {
            b.state = 'rev';
            b.timer = 0.9;
            b.dir = Math.sign(bot.x - b.x) || b.dir;
            g.sound('rev');
          } else {
            // Seed pods: three lobbed at where the robot is, and round it.
            for (let i = -1; i <= 1; i++) {
              const tx = bot.x + i * 120;
              const dx = tx - b.x;
              const vy = -620;
              const tFlight = 2 * 620 / 900;
              g.shot(b.x, b.y - b.r, 0, 0, { vx: dx / tFlight, vy, g: 900, maxBounces: 1, r: 12, color: '#c6ff7a', life: 4, look: 'seed', burst: 4 });
            }
            g.sound('lob');
            b.timer = 2.2;
          }
        }
      } else if (b.state === 'rev') {
        b.vx = 0;
        b.shake = 4;
        b.timer -= dt;
        if (b.timer <= 0) {
          b.state = 'charge';
          b.shake = 0;
        }
      } else if (b.state === 'charge') {
        b.vx = b.dir * 540;
      }
      b.x += b.vx * dt;
      const lo = A.x0 + b.r + 10;
      const hi = A.x1 - b.r - 10;
      if (b.x < lo || b.x > hi) {
        b.x = clamp(b.x, lo, hi);
        if (b.state === 'charge') {
          g.fx.kick(14);
          g.sound('thud');
          b.state = 'patrol';
          b.timer = 1.8;
        }
        b.dir = b.x <= lo ? 1 : -1;
      }
    },
    parts(b) {
      return [{ type: 'core', x: b.x, y: b.y, r: b.r }];
    },
  },

  moth: {
    name: 'The Lantern Moth',
    epithet: 'drawn to every light in the market',
    color: '#ffe27a',
    hp: 18,
    r: 40,
    arena: {
      w: W,
      h: H,
      oneWays: [{ x0: 120, x1: 330, y: H - 170 }, { x0: 950, x1: 1160, y: H - 170 }, { x0: 540, x1: 740, y: H - 300 }],
      movers: [{ x: 360, y: H - 440, w: 150, h: 18, oneWay: true, path: { type: 'line', dx: 420, dy: 0, period: 7 } }],
    },
    init(b, A) {
      b.x = A.cx;
      b.y = A.top + 150;
      b.t = 0;
      b.state = 'fly';
      b.dropT = 2;
      b.fanT = 4;
      b.diveT = 12;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      b.t += dt;
      if (b.state === 'fly') {
        // A figure of eight over the upper half of the market.
        const tx = A.cx + Math.sin(b.t * 0.55) * 470;
        const ty = A.top + 150 + Math.sin(b.t * 1.1) * 70;
        seek(b, tx, ty, 320, 700, dt);
        b.dropT -= dt;
        b.fanT -= dt;
        b.diveT -= dt;
        if (b.dropT <= 0) {
          b.dropT = 2.6;
          g.shot(b.x, b.y + b.r, Math.PI / 2, 110, { r: 14, g: 120, color: '#ffc36b', life: 6, bounce: false, look: 'lantern', burst: 6 });
          g.sound('lob');
        }
        if (b.fanT <= 0) {
          b.fanT = 4.2;
          const a = angleTo(b, bot);
          for (let i = -2; i <= 2; i++) g.shot(b.x, b.y, a + i * 0.2, 290, { r: 9, color: '#ffe27a', bounce: false });
          g.sound('fan');
        }
        if (b.diveT <= 0) {
          b.state = 'warn';
          b.timer = 0.8;
          b.diveFrom = { x: b.x, y: b.y };
          b.diveTo = { x: bot.x, y: Math.min(bot.y, A.floor - 70) };
          g.sound('rev');
        }
      } else if (b.state === 'warn') {
        b.vx *= 0.9;
        b.vy *= 0.9;
        b.shake = 3;
        b.timer -= dt;
        if (b.timer <= 0) {
          b.state = 'dive';
          b.s = 0;
          b.shake = 0;
          b.diveEnd = { x: b.diveFrom.x < A.cx ? A.x1 - 150 : A.x0 + 150, y: A.top + 160 };
        }
      } else if (b.state === 'dive') {
        b.s = Math.min(1, b.s + dt / 1.5);
        const s = b.s;
        // A quadratic sweep that passes through where the robot stood.
        const p0 = b.diveFrom;
        const p2 = b.diveEnd;
        const c = { x: 2 * b.diveTo.x - (p0.x + p2.x) / 2, y: 2 * b.diveTo.y - (p0.y + p2.y) / 2 };
        const nx = (1 - s) ** 2 * p0.x + 2 * (1 - s) * s * c.x + s * s * p2.x;
        const ny = (1 - s) ** 2 * p0.y + 2 * (1 - s) * s * c.y + s * s * p2.y;
        b.vx = (nx - b.x) / dt;
        b.vy = (ny - b.y) / dt;
        b.x = nx;
        b.y = Math.min(ny, A.floor - b.r);
        if (s >= 1) {
          b.state = 'fly';
          b.diveT = 11;
          b.t = Math.asin(clamp((b.x - A.cx) / 470, -1, 1)) / 0.55;
        }
      }
    },
    parts(b) {
      return [{ type: 'core', x: b.x, y: b.y, r: b.r }];
    },
  },

  conductor: {
    name: 'The Conductor',
    epithet: 'the last train on the loop, armoured underneath, its roof to the station\'s',
    color: '#ffb347',
    hp: 20,
    r: 34,
    portalOnly: true, // its only open side is against the roof: the way in is a wormhole in the roof
    hint: 'Its belly is armoured and its back is pressed to the roof. The roof takes a wormhole.',
    arena: {
      w: W,
      h: H,
      solids: [[60, H - 250, 220, 30], [W - 280, H - 250, 220, 30]],
    },
    init(b, A) {
      b.x = A.cx;
      b.y = A.top + 44;
      b.dir = 1;
      b.state = 'run';
      b.dropT = 1;
      b.stopT = 7;
      b.guard = Math.PI / 2;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      // The car runs flush under the roof. Armour covers it from below and at
      // both ends, and a guard plate hangs under that, turning to the robot:
      // nothing fired from the floor reaches the core, however it is banked.
      b.y = A.top + 44;
      if (b.state === 'run') {
        b.vx = b.dir * 210;
        b.x += b.vx * dt;
        if (b.x > A.x1 - 150 || b.x < A.x0 + 150) {
          b.x = clamp(b.x, A.x0 + 150, A.x1 - 150);
          b.dir = -b.dir;
        }
        b.dropT -= dt;
        if (b.dropT <= 0 && Math.abs(bot.x - b.x) < 260) {
          b.dropT = 0.9;
          for (const off of [-50, 50]) g.shot(b.x + off, b.y + 70, Math.PI / 2, 330, { r: 8, color: '#ffd9a0', bounce: false });
          g.sound('fan');
        }
        b.stopT -= dt;
        if (b.stopT <= 0) {
          b.state = 'station';
          b.timer = 2.4;
          b.vx = 0;
          b.volleys = 0;
        }
      } else if (b.state === 'station') {
        // It waits at a platform: the moment to line up a shot through the roof.
        b.timer -= dt;
        if (b.timer < 1.8 && b.volleys === 0) {
          b.volleys = 1;
          const a = angleTo(b, bot);
          for (let i = -2; i <= 2; i++) g.shot(b.x, b.y + 80, a + i * 0.28, 300, { r: 9, color: '#ffb347', life: 4, maxBounces: 3 });
          g.sound('fan');
        }
        if (b.timer <= 0) {
          b.state = 'run';
          b.stopT = 5 + Math.random() * 3;
        }
      }
      const want = angleTo(b, bot);
      const before = b.guard;
      b.guard = turnToward(b.guard, clamp(want, 0.35, Math.PI - 0.35), 1.6, dt);
      b.guardOmega = (b.guard - before) / dt;
    },
    parts(b) {
      const x = b.x;
      const y = b.y;
      return [
        { type: 'armor', x: x - 104, y, r: 28 },
        { type: 'armor', x: x + 104, y, r: 28 },
        { type: 'armor', x: x - 62, y: y + 8, r: 30 },
        { type: 'armor', x: x + 62, y: y + 8, r: 30 },
        { type: 'armor', x: x - 30, y: y + 30, r: 26 },
        { type: 'armor', x: x + 30, y: y + 30, r: 26 },
        { type: 'armor', x, y: y + 38, r: 26 },
        { type: 'core', x, y, r: b.r },
        plate(x, y, b.guard, 84, 150, b.guardOmega || 0, b.vx, 0, 7),
      ];
    },
  },

  keeper: {
    name: 'The Keeper',
    epithet: 'the lamp that turns over the tide',
    color: '#7fe9ff',
    hp: 22,
    r: 36,
    arena: {
      w: W,
      h: H,
      solids: [[150, H - 180, 180, 28], [W - 330, H - 180, 180, 28], [60, H - 380, 150, 26], [W - 210, H - 380, 150, 26], [W / 2 - 60, H - 150, 120, 150]],
      pulses: [],
    },
    init(b, A) {
      b.x = A.cx;
      b.y = A.floor - 400;
      b.spin = 0;
      b.beam = -Math.PI / 2;
      b.beamOn = 0;
      b.beamT = 3;
      b.pulseT = 4;
      b.spawnT = 6;
      b.sweep = 1;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      b.spin += 0.9 * dt;
      b.pulseT -= dt;
      if (b.pulseT <= 0) {
        b.pulseT = 5;
        g.ring(b.x, b.y, { speed: 300, maxRadius: 620, color: '#7fe9ff' });
      }
      // The beam: warned, then swept across the lower half, stopped by rock.
      b.beamT -= dt;
      if (b.beamOn <= 0 && b.beamT <= 0) {
        // It starts a little behind the robot and sweeps through where it stands.
        b.beamOn = 4.2;
        b.sweep = bot.x < b.x ? -1 : 1;
        b.beam = clamp(angleTo(b, bot) - b.sweep * 0.6, 0.05, Math.PI - 0.05);
        b.beamT = 7;
        g.sound('rev');
      }
      if (b.beamOn > 0) {
        b.beamOn -= dt;
        const live = b.beamOn < 3.4;
        if (live) b.beam += b.sweep * 0.32 * dt;
        b.beam = clamp(b.beam, 0.05, Math.PI - 0.05);
        g.hazard({ id: 'beam', type: 'beam', x: b.x, y: b.y, angle: b.beam, width: 10, live, color: '#bff6ff', ttl: 0.1 });
      }
      b.spawnT -= dt;
      if (b.spawnT <= 0) {
        b.spawnT = 9;
        if (g.enemyCount() < 3) {
          g.spawn({ kind: 'crab', x: A.x0 + 80, y: A.floor - 30, dir: 1 });
          g.spawn({ kind: 'crab', x: A.x1 - 80, y: A.floor - 30, dir: -1 });
        }
      }
    },
    parts(b) {
      const parts = [{ type: 'armor', x: b.x, y: b.y + 110, r: 40 }, { type: 'armor', x: b.x, y: b.y + 200, r: 46 }, { type: 'armor', x: b.x, y: b.y + 290, r: 52 }, { type: 'core', x: b.x, y: b.y, r: b.r }];
      for (let i = 0; i < 2; i++) parts.push(plate(b.x, b.y, b.spin + i * Math.PI, 70, 100, 0.9, 0, 0, 6));
      return parts;
    },
  },

  bloom: {
    name: 'The Bloom',
    epithet: 'the greenhouse grew it, and then it grew',
    color: '#ff7eb6',
    hp: 26,
    r: 46,
    arena: {
      w: W,
      h: H,
      springs: [{ x: 180, w: 80, power: 1150 }, { x: 560, w: 80, power: 1150 }],
      movers: [
        { x: 300, y: H - 360, w: 130, h: 18, oneWay: true, path: { type: 'line', dx: 0, dy: -160, period: 5 } },
        { x: 720, y: H - 320, w: 130, h: 18, oneWay: true, path: { type: 'line', dx: 0, dy: -200, period: 6, phase: 2 } },
      ],
    },
    init(b, A) {
      b.x = A.x1 - 230;
      b.y = A.floor - 430;
      b.open = 0; // 0 closed .. 1 open
      b.cycle = 0;
      b.spiral = 0;
      b.lashT = 4;
      b.shotT = 0;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      b.cycle = (b.cycle + dt) % 8;
      const want = b.cycle > 4.5 ? 1 : 0; // closed for 4.5 s, open for 3.5
      b.open += clamp(want - b.open, -dt * 2.5, dt * 2.5);
      b.sway = Math.sin(b.cycle * 0.8) * 16;
      b.x = A.x1 - 230 + b.sway;
      b.shotT -= dt;
      if (b.open < 0.2 && b.shotT <= 0) {
        b.shotT = 0.16;
        b.spiral += 0.47;
        g.shot(b.x, b.y, Math.PI * 0.55 + Math.sin(b.spiral) * 1.1, 230, { r: 8, color: '#ffc2dd', bounce: false, life: 4 });
      }
      b.lashT -= dt;
      if (b.lashT <= 0) {
        b.lashT = 4.6;
        const x = clamp(bot.x, A.x0 + 40, A.x1 - 40);
        g.hazard({ type: 'column', x, y0: A.floor - 300, y1: A.floor, w: 56, warn: 0.9, ttl: 1.8, color: '#7dff9a' });
        g.sound('rumble');
      }
    },
    parts(b) {
      const parts = [{ type: 'armor', x: b.x, y: b.y + 150, r: 26 }, { type: 'armor', x: b.x - 10, y: b.y + 260, r: 26 }, { type: 'armor', x: b.x, y: b.y + 370, r: 30 }];
      parts.push({ type: 'core', x: b.x, y: b.y, r: b.r });
      // Petals: five plates round the head, closed into a ring or opened out of the way.
      const spread = 0.55 + b.open * 0.9;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i - 2) * spread * 0.62;
        parts.push(plate(b.x, b.y, a, 62 + b.open * 28, 64 - b.open * 34, 0, 0, 0, 7));
      }
      return parts;
    },
  },

  astronomer: {
    name: 'The Astronomer',
    epithet: 'it reads every line you draw, and none of the curves',
    hint: 'Its lens turns to meet a shot coming straight at it. Bend one round a black hole, or bank it off a wall.',
    color: '#c9a2ff',
    hp: 28,
    r: 34,
    arena: {
      w: W,
      h: H,
      wells: [{ x: W / 2, y: H / 2 - 40, r: 28, range: 400, pull: 360000 }],
      oneWays: [{ x0: 110, x1: 300, y: H - 200 }, { x0: 980, x1: 1170, y: H - 200 }, { x0: 90, x1: 260, y: H - 400 }, { x0: 1020, x1: 1190, y: H - 400 }, { x0: 540, x1: 740, y: H - 110 }],
      // Where it can chart a hole: open air, at least 90 px from anywhere the robot can stand.
      chart: [[330, 380], [950, 380], [400, 560], [880, 560], [420, 160], [860, 160]],
    },
    init(b, A) {
      b.orbit = 0;
      b.x = A.cx + 300;
      b.y = A.cy - 40;
      b.shotT = 2;
      b.breathT = 9;
      b.chartT = 3;
      b.charted = [];
      b.guard = Math.PI;
      b.glance = 0;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      const well = g.wells[0];
      b.orbit += dt * 0.36;
      const R = 330 + Math.sin(b.orbit * 1.7) * 40;
      const tx = well.x + Math.cos(b.orbit) * R;
      const ty = well.y + Math.sin(b.orbit) * R * 0.62;
      seek(b, tx, ty, 260, 600, dt);
      b.shotT -= dt;
      if (b.shotT <= 0) {
        b.shotT = 2;
        const a = angleTo(b, bot);
        for (let i = -1; i <= 1; i++) g.shot(b.x, b.y, a + i * 0.16, 320, { r: 9, color: '#e7d6ff', life: 4, bounce: false });
        g.sound('fan');
      }
      // Every so often the hole draws in harder.
      b.breathT -= dt;
      if (b.breathT <= 0) {
        b.breathT = 11;
        b.breath = 3.5;
        g.sound('rumble');
      }
      if (b.breath > 0) {
        b.breath -= dt;
        well.pull = well.basePull * (b.breath > 3 ? 1 : 1.9);
      } else well.pull = well.basePull;
      // It charts new holes: each forms over 1.3 s (no pull yet, a ring closing in), lives 8 s, and collapses.
      // Never on top of the robot: the nearest charted spot at least 260 px from it, and clear of the others.
      b.chartT -= dt;
      if (b.chartT <= 0 && b.charted.length < 3) {
        b.chartT = 5;
        const free = b.def.arena.chart
          .map(([x, y]) => ({ x: A.x0 + x, y: A.top + y }))
          .filter((p) => Math.hypot(p.x - bot.x, p.y - bot.y) >= 260 && !b.charted.some((w) => Math.hypot(w.x - p.x, w.y - p.y) < 220));
        free.sort((p, q) => Math.hypot(p.x - bot.x, p.y - bot.y) - Math.hypot(q.x - bot.x, q.y - bot.y));
        if (free.length) {
          const w = g.addWell({ x: free[0].x, y: free[0].y, r: 20, range: 260, pull: 260000 });
          Object.assign(w, { charted: true, absent: true, forming: 0, life: 0 });
          b.charted.push(w);
          g.sound('rumble');
          // It looks where it charts, a moment: the lens swings off you.
          b.glance = 0.8;
          b.glanceAt = angleTo(b, w);
        }
      }
      for (const w of b.charted) {
        w.life += dt;
        w.forming = Math.min(1, w.life / 1.3);
        w.absent = w.life < 1.3 || w.life > 9.3;
        w.collapsing = w.life > 9.3 ? Math.min(1, (w.life - 9.3) / 0.6) : 0;
        if (w.life > 9.9) g.removeWell(w);
      }
      b.charted = b.charted.filter((w) => w.life <= 9.9);
      // Its lens is a shield, and it reads a charge's line: it turns to meet whichever of yours is
      // coming straight for it soonest. The line, not the curve: a charge bent round a hole, or
      // banked off a wall, arrives from where it was not looking. With nothing coming it watches you.
      let want = angleTo(b, bot);
      let soonest = 0.7; // seconds: what it sees coming
      for (const c of g.charges) {
        const sp2 = c.vx * c.vx + c.vy * c.vy;
        if (!sp2) continue;
        const t = ((b.x - c.x) * c.vx + (b.y - c.y) * c.vy) / sp2; // nearest to it along the line
        if (t <= 0 || t > soonest) continue;
        if (Math.hypot(c.x + c.vx * t - b.x, c.y + c.vy * t - b.y) > b.r + c.r + 12) continue;
        soonest = t;
        want = Math.atan2(-c.vy, -c.vx);
      }
      if (b.glance > 0) {
        b.glance -= dt;
        want = b.glanceAt;
      }
      const before = b.guard;
      b.guard = turnToward(b.guard, want, 3.2, dt);
      b.guardOmega = (b.guard - before) / dt;
    },
    parts(b) {
      return [{ type: 'core', x: b.x, y: b.y, r: b.r }, plate(b.x, b.y, b.guard, 54, 96, b.guardOmega || 0, b.vx, b.vy, 7)];
    },
  },

  ringmaster: {
    name: 'The Ringmaster',
    epithet: 'the show goes on without anyone watching',
    color: '#ff4fd8',
    hp: 30,
    r: 38,
    arena: {
      w: W,
      h: H,
      movers: [0, 1, 2, 3].map((i) => ({ x: W / 2 - 60, y: H / 2 - 20, w: 120, h: 16, oneWay: true, path: { type: 'circle', R: 170, period: 9, phase: (i * Math.PI) / 2 } })),
      oneWays: [{ x0: 60, x1: 240, y: H - 230 }, { x0: W - 240, x1: W - 60, y: H - 230 }],
    },
    init(b, A) {
      b.x = A.x1 - 160;
      b.y = A.floor - b.r;
      b.vx = 0;
      b.vy = 0;
      b.hopT = 1.2;
      b.cards = 0;
      b.juggleT = 3;
      b.confettiT = 8;
      b.onFloor = true;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      b.cards += dt * 1.7;
      if (b.onFloor) {
        b.hopT -= dt;
        if (b.hopT <= 0) {
          const tx = clamp(bot.x + (Math.random() - 0.5) * 300, A.x0 + 100, A.x1 - 100);
          const t = 1.1;
          b.vx = (tx - b.x) / t;
          b.vy = -1500 * t / 2;
          b.onFloor = false;
          g.sound('boing');
        }
      } else {
        b.vy += 1500 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.y >= A.floor - b.r) {
          b.y = A.floor - b.r;
          b.onFloor = true;
          b.vx = 0;
          b.vy = 0;
          b.hopT = 1.3;
          g.fx.kick(6);
          g.sound('thud');
        }
        b.x = clamp(b.x, A.x0 + b.r, A.x1 - b.r);
      }
      b.juggleT -= dt;
      if (b.juggleT <= 0) {
        b.juggleT = 3.4;
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + (i - 1) * 0.5 + (bot.x < b.x ? -0.3 : 0.3);
          g.shot(b.x, b.y - b.r, a, 420, { r: 12, color: ['#ff4fd8', '#ffd23f', '#5ce1ff'][i], g: 700, life: 5, maxBounces: 6, look: 'ball' });
        }
        g.sound('lob');
      }
      b.confettiT -= dt;
      if (b.confettiT <= 0) {
        b.confettiT = 8;
        for (let i = 0; i < 12; i++) g.shot(b.x, b.y, (i / 12) * TAU, 250, { r: 7, color: i % 2 ? '#ffd23f' : '#ff4fd8', bounce: false, life: 3 });
        g.sound('fan');
      }
    },
    parts(b) {
      const parts = [{ type: 'core', x: b.x, y: b.y, r: b.r }];
      for (let i = 0; i < 3; i++) parts.push(plate(b.x, b.y, b.cards + (i * TAU) / 3, 78, 72, 1.7, b.vx, b.vy, 6));
      return parts;
    },
  },

  angler: {
    name: 'The Angler',
    epithet: 'it carries the only light down here',
    color: '#aef6ff',
    hp: 32,
    r: 18,
    dark: true,
    arena: {
      w: W,
      h: H,
      wells: [{ x: 90, y: H - 70, r: 18, range: 240, pull: -260000, fount: true }, { x: W - 90, y: H - 70, r: 18, range: 240, pull: -260000, fount: true }],
      solids: [[300, H - 220, 160, 26], [W - 460, H - 220, 160, 26], [W / 2 - 90, H - 380, 180, 26]],
    },
    init(b, A) {
      b.bodyX = A.x1 - 300;
      b.bodyY = A.cy - 60;
      b.x = b.bodyX - 120;
      b.y = b.bodyY - 30;
      b.face = -1;
      b.t = 0;
      b.state = 'swim';
      b.lungeT = 6;
      b.bubbleT = 2.5;
      b.wispT = 10;
      b.bvx = 0;
      b.bvy = 0;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      b.t += dt;
      if (b.state === 'swim') {
        const tx = A.cx + Math.sin(b.t * 0.35) * 380;
        const ty = A.cy - 90 + Math.sin(b.t * 0.8) * 90;
        const body = { x: b.bodyX, y: b.bodyY, vx: b.bvx, vy: b.bvy };
        seek(body, tx, ty, 150, 200, dt);
        Object.assign(b, { bodyX: body.x, bodyY: body.y, bvx: body.vx, bvy: body.vy });
        b.face = bot.x < b.bodyX ? -1 : 1;
        b.lungeT -= dt;
        if (b.lungeT <= 0) {
          b.state = 'coil';
          b.timer = 0.9;
          b.target = { x: bot.x, y: bot.y };
          g.sound('rev');
        }
      } else if (b.state === 'coil') {
        b.timer -= dt;
        b.shake = 3;
        if (b.timer <= 0) {
          b.state = 'lunge';
          b.shake = 0;
          const dx = b.target.x - b.bodyX;
          const dy = b.target.y - b.bodyY;
          const d = Math.hypot(dx, dy) || 1;
          b.bvx = (dx / d) * 720;
          b.bvy = (dy / d) * 720;
          b.timer = Math.min(1.2, (d + 160) / 720);
        }
      } else if (b.state === 'lunge') {
        b.bodyX += b.bvx * dt;
        b.bodyY += b.bvy * dt;
        b.timer -= dt;
        if (b.timer <= 0 || b.bodyY > A.floor - 80 || b.bodyX < A.x0 + 80 || b.bodyX > A.x1 - 80) {
          b.state = 'swim';
          b.lungeT = 6.5;
          b.bvx *= 0.2;
          b.bvy *= 0.2;
        }
      }
      b.bodyX = clamp(b.bodyX, A.x0 + 80, A.x1 - 80);
      b.bodyY = clamp(b.bodyY, A.top + 80, A.floor - 80);
      // The lure hangs ahead on its stalk, swinging.
      b.x = b.bodyX + b.face * (118 + Math.sin(b.t * 2) * 8);
      b.y = b.bodyY - 64 + Math.cos(b.t * 1.6) * 10;
      b.bubbleT -= dt;
      if (b.bubbleT <= 0) {
        b.bubbleT = 2.2;
        const a = angleTo({ x: b.bodyX, y: b.bodyY }, bot);
        for (let i = 0; i < 3; i++) g.shot(b.bodyX + b.face * 60, b.bodyY + 10, a + (i - 1) * 0.25, 200, { r: 11, color: '#7fd8ff', bounce: false, life: 5, wave: 60, look: 'bubble' });
      }
      b.wispT -= dt;
      if (b.wispT <= 0) {
        b.wispT = 12;
        if (g.enemyCount() < 4) {
          g.spawn({ kind: 'wisp', x: b.bodyX, y: A.top + 90 });
          g.spawn({ kind: 'wisp', x: b.bodyX + 200 * -b.face, y: A.top + 120 });
        }
      }
    },
    parts(b) {
      return [
        { type: 'armor', x: b.bodyX, y: b.bodyY, r: 66 },
        { type: 'armor', x: b.bodyX - b.face * 80, y: b.bodyY + 6, r: 40 },
        { type: 'armor', x: b.bodyX - b.face * 128, y: b.bodyY + 10, r: 26 },
        { type: 'core', x: b.x, y: b.y, r: b.r },
      ];
    },
  },

  cartographer: {
    name: 'The Cartographer',
    epithet: 'it folds the city along its own creases, and itself with it',
    color: '#5ce1ff',
    hp: 34,
    r: 36,
    folded: true, // only a charge that has been through a wormhole (anyone's) touches it
    portalOnly: true,
    hint: 'The Cartographer is folded. Only a shot that has been through a wormhole can touch it: yours, or its own.',
    arena: {
      w: W,
      h: H,
      movers: [
        { x: 160, y: H - 210, w: 170, h: 20, path: { type: 'phase', on: 4, off: 2 } },
        { x: 950, y: H - 210, w: 170, h: 20, path: { type: 'phase', on: 4, off: 2, offset: 3 } },
        { x: 555, y: H - 330, w: 170, h: 20, path: { type: 'phase', on: 3, off: 3, offset: 1.5 } },
      ],
      wells: [{ x: 140, y: 110, r: 20, range: 260, pull: 300000 }, { x: W - 140, y: 110, r: 20, range: 260, pull: 300000 }],
    },
    init(b, A) {
      b.x = A.cx;
      b.y = A.top + 200;
      b.foldT = 3;
      b.state = 'hover';
      b.shotT = 2;
      b.t = 0;
      b.ends = null;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      b.t += dt;
      if (b.state === 'hover') {
        seek(b, b.home ? b.home.x : A.cx, (b.home ? b.home.y : A.top + 200) + Math.sin(b.t * 1.4) * 30, 200, 500, dt);
        b.shotT -= dt;
        if (b.shotT <= 0) {
          b.shotT = 2.1;
          const a = angleTo(b, bot);
          for (let i = -1; i <= 1; i++) g.shot(b.x, b.y, a + i * 0.12, 330, { r: 9, color: '#bff3ff', life: 4, maxBounces: 1 });
          g.sound('fan');
        }
        b.foldT -= dt;
        if (b.foldT <= 0) {
          // It lays down a pair of its own on two walls, and walks through.
          const spots = g.bossPortalSpots();
          if (spots.length >= 2) {
            const i = Math.floor(Math.random() * spots.length);
            let j = Math.floor(Math.random() * (spots.length - 1));
            if (j >= i) j++;
            g.bossPortals(spots[i], spots[j]);
            b.state = 'fold';
            b.timer = 1;
            b.from = spots[i];
            b.to = spots[j];
            g.sound('rev');
          }
          b.foldT = 6;
        }
      } else if (b.state === 'fold') {
        // Into its own near mouth; out of the far one; a volley back through behind it.
        b.timer -= dt;
        seek(b, b.from.x + b.from.nx * 60, b.from.y + b.from.ny * 60, 520, 1400, dt);
        b.phased = true;
        if (b.timer <= 0) {
          b.x = b.to.x + b.to.nx * 90;
          b.y = b.to.y + b.to.ny * 90;
          b.vx = 0;
          b.vy = 0;
          b.home = { x: clamp(b.x, A.x0 + 200, A.x1 - 200), y: clamp(b.y, A.top + 140, A.floor - 300) };
          b.phased = false;
          b.state = 'hover';
          for (let i = 0; i < 10; i++) g.shot(b.x, b.y, (i / 10) * TAU, 240, { r: 8, color: '#5ce1ff', bounce: false, life: 3 });
          const a = Math.atan2(-b.from.ny, -b.from.nx);
          for (let i = -2; i <= 2; i++) g.shot(b.from.x + b.from.nx * 150, b.from.y + b.from.ny * 150, a + i * 0.08, 360, { r: 9, color: '#bff3ff', life: 3 });
          g.sound('warp');
        }
      }
    },
    parts(b) {
      if (b.phased) return [{ type: 'armor', x: b.x, y: b.y, r: b.r }];
      return [{ type: 'core', x: b.x, y: b.y, r: b.r }];
    },
  },

  administrator: {
    name: 'The Administrator',
    epithet: 'the grid, looking back at you',
    color: '#ffffff',
    hp: 48,
    r: 50,
    arena: {
      w: W,
      h: H,
      oneWays: [{ x0: 90, x1: 290, y: H - 190 }, { x0: W - 290, x1: W - 90, y: H - 190 }, { x0: 90, x1: 250, y: H - 390 }, { x0: W - 250, x1: W - 90, y: H - 390 }, { x0: 540, x1: 740, y: H - 150 }],
      wells: [{ x: W / 2, y: H / 2 - 60, r: 24, range: 380, pull: 340000, dormant: true }],
    },
    init(b, A) {
      b.x = A.cx;
      b.y = A.top + 140;
      b.t = 0;
      b.phase = 1;
      b.spin = 0;
      b.shotT = 2;
      b.pulseT = 4;
      b.spiral = 0;
      b.dashT = 4;
      b.state = 'float';
      b.minionT = 5;
    },
    update(b, g, dt, A) {
      const bot = g.bot;
      const well = g.wells[0];
      b.t += dt;
      b.spin += dt * (b.phase === 1 ? 1.1 : 1.6);
      const frac = b.hp / b.maxHp;
      const phase = frac > 2 / 3 ? 1 : frac > 1 / 3 ? 2 : 3;
      if (phase !== b.phase) {
        b.phase = phase;
        g.fx.blink('#ffffff', 0.7);
        g.fx.kick(16);
        g.sound('phase');
        b.state = 'float';
      }
      if (well) well.absent = b.phase !== 2;
      if (b.phase === 1) {
        seek(b, A.cx + Math.sin(b.t * 0.5) * 380, A.top + 140 + Math.sin(b.t) * 30, 240, 500, dt);
        b.pulseT -= dt;
        if (b.pulseT <= 0) {
          b.pulseT = 4.5;
          g.ring(b.x, b.y, { speed: 320, maxRadius: 700, color: '#ffffff' });
        }
        b.shotT -= dt;
        if (b.shotT <= 0) {
          b.shotT = 1.9;
          const a = angleTo(b, bot);
          for (let i = -1; i <= 1; i++) g.shot(b.x, b.y, a + i * 0.2, 330, { r: 9, color: '#ffffff', bounce: false, life: 4 });
          g.sound('fan');
        }
      } else if (b.phase === 2) {
        const a = b.t * 0.5;
        seek(b, well.x + Math.cos(a) * 340, well.y + Math.sin(a) * 200, 300, 600, dt);
        b.shotT -= dt;
        if (b.shotT <= 0) {
          b.shotT = 0.22;
          b.spiral += 0.5;
          for (let k = 0; k < 2; k++) g.shot(b.x, b.y, b.spiral + k * Math.PI, 260, { r: 8, color: '#d0d8ff', bounce: false, life: 3 });
        }
      } else {
        if (b.state === 'float') {
          seek(b, A.cx + Math.sin(b.t * 0.9) * 420, A.top + 160, 360, 800, dt);
          b.dashT -= dt;
          if (b.dashT <= 0) {
            b.state = 'aim';
            b.timer = 0.7;
            b.target = { x: bot.x, y: bot.y };
            g.sound('rev');
          }
        } else if (b.state === 'aim') {
          b.vx *= 0.85;
          b.vy *= 0.85;
          b.shake = 4;
          b.timer -= dt;
          if (b.timer <= 0) {
            const dx = b.target.x - b.x;
            const dy = b.target.y - b.y;
            const d = Math.hypot(dx, dy) || 1;
            b.vx = (dx / d) * 820;
            b.vy = (dy / d) * 820;
            b.state = 'dash';
            b.shake = 0;
            b.timer = Math.min(1.1, (d + 120) / 820);
          }
        } else if (b.state === 'dash') {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.timer -= dt;
          if (b.timer <= 0 || b.y > A.floor - b.r || b.x < A.x0 + b.r || b.x > A.x1 - b.r) {
            b.x = clamp(b.x, A.x0 + b.r, A.x1 - b.r);
            b.y = clamp(b.y, A.top + b.r, A.floor - b.r);
            for (let i = 0; i < 14; i++) g.shot(b.x, b.y, (i / 14) * TAU, 280, { r: 8, color: '#ffffff', bounce: false, life: 3 });
            g.fx.kick(10);
            g.sound('thud');
            b.state = 'float';
            b.dashT = 2.6;
          }
        }
        b.minionT -= dt;
        if (b.minionT <= 0) {
          b.minionT = 9;
          if (g.enemyCount() < 4) {
            g.spawn({ kind: 'flitter', x: A.x0 + 120, y: A.top + 120 });
            g.spawn({ kind: 'flitter', x: A.x1 - 120, y: A.top + 120 });
          }
        }
      }
    },
    parts(b) {
      const parts = [{ type: 'core', x: b.x, y: b.y, r: b.r }];
      if (b.phase === 1) for (let i = 0; i < 4; i++) parts.push(plate(b.x, b.y, b.spin + (i * TAU) / 4, 92, 86, 1.1, b.vx, b.vy, 7));
      else if (b.phase === 2) for (let i = 0; i < 2; i++) parts.push(plate(b.x, b.y, b.spin + i * Math.PI, 86, 84, 1.6, b.vx, b.vy, 7));
      return parts;
    },
  },
};

/** A live boss: its brain from BOSSES, its health, and the arena it lives in. */
export class Boss {
  constructor(id, A) {
    const def = BOSSES[id];
    this.id = id;
    this.def = def;
    this.name = def.name;
    this.color = def.color;
    this.r = def.r;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.x = A.cx;
    this.y = A.cy;
    this.vx = 0;
    this.vy = 0;
    this.prevX = 0;
    this.prevY = 0;
    this.flash = 0;
    this.chill = 0;
    this.shake = 0;
    this.dead = false;
    this.A = A;
    def.init(this, A);
    this.prevX = this.x;
    this.prevY = this.y;
    this.parts = def.parts(this);
  }

  update(g, dt) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.flash = Math.max(0, this.flash - dt);
    const slow = this.chill > 0 ? 0.45 : 1;
    this.chill = Math.max(0, this.chill - dt);
    this.def.update(this, g, dt * slow, this.A);
    this.parts = this.def.parts(this);
  }
}

export const BOSS_ORDER = ['gardener', 'moth', 'conductor', 'keeper', 'bloom', 'astronomer', 'ringmaster', 'angler', 'cartographer', 'administrator'];
