// Game bootstrap: state machine, fixed-step physics loop, collision dispatch,
// HUD/overlay wiring. Everything heavy lives in the modules it imports.
import { GAME_MARK, GAME_NAME, GAME_TAGLINE, GAME_VERSION, MARK_READINGS, PHYSICS_DT, BALL, PLAYER, SURFACE_VELOCITY_FACTOR, COUNTDOWN_SECONDS, DIFFICULTIES, DEFAULT_DIFFICULTY, COOP, RELAY_PROTOCOL } from './config.js';
import { BallHistory, bossIntent, moverSegmentsAt } from './ai.js';
import { LEVELS, VERSUS_LEVELS, ROSTER, TUTORIAL_LEVEL } from './levels.js';
import { SEQUENCE, VERSUS_CONDUITS, levelLabel, shortId, campaignNextIndex } from './conduits.js';
import { LORE } from './lore.js';
import { createGameState, rebuildWalls as rebuildWallsState, bodyHitCounts, tickCamp, versusSpawns, rotateSpawns, versusColors, VERSUS_IDS, nodeAccepts, objectiveDone, constrainToRail, wellField, wellDrag, wellSwallows, dronePhased } from './gamestate.js';
import { NetClient, relayConfig, saveRelay } from './net.js';
import { buildSnapshot, applySnapshot } from './netstate.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Effects } from './fx.js';
import { AudioEngine } from './audio/engine.js';
import { TRACKS } from './audio/tracks.js';
import { circleVsCircle, circleVsCapsule, pointInPolygon, resolveCircleVsSegments, predictPath, predictCurvedPath } from './physics.js';
import { advanceBall, separateFightersFromBall, fightersTouch, advanceShot, Shot } from './sim.js';
import { clamp, rand, wrapAngle } from './vec.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas, (sx, sy) => renderer.screenToWorld(sx, sy));
const audio = new AudioEngine();

let state = 'title'; // title | countdown | playing | paused | cleared | failed | jukebox
let game = null;
let levelIndex = 0;
let acc = 0;
let last = performance.now();
let simTime = 0;
let countdown = 0;
let countdownTick = 0;
let endTimer = 0;
let endShown = false;
let guideFrame = 0;
let fps = 60;

// ------------------------------------------------------------------ setup

function buildGame(def, pvp = false, rules = { ownBallLoss: ownBallLoss() }, coop = false, spawns = null) {
  const g = createGameState(def, { pvp, coop, rules, spawns });
  const bossHits = g.coop ? g.humans.length * COOP.bossHitsPerHuman : 1;
  return {
    ...g,
    fx: new Effects(),
    history: new BallHistory(),
    lives: Infinity, // shields left (set from the difficulty or the campaign in startLevel)
    maxLives: Infinity,
    difficulty: null,
    shieldsLost: 0,
    lastLoss: null, // { reason, slot, at } while the ball re-serves after a lost shield (or a boss hit in co-op)
    bossHits, // body hits the boss can still take
    maxBossHits: bossHits,
    time: 0,
    topSpeed: 0,
    paddleHits: 0,
    guidePath: null,
    drops: 0, // frames this level that took far longer than the display's refresh interval
    lossReason: null, // 'hit' | 'camp' | 'touch' once the level is lost
  };
}

function startLevel(index) {
  if (net.mode === 'host' && net.coop) return coopStartLevel(index);
  levelIndex = index;
  const def = SEQUENCE[index];
  $('tutor').hidden = true;
  resetFrameWatch();
  game = buildGame(def);
  const diff = campaign ? difficultyById(campaign.difficulty) : difficultySetting();
  game.difficulty = diff;
  game.maxLives = diff.shields;
  game.lives = campaign ? campaign.shields : diff.shields;
  renderer.setLevel(def);
  renderer.resize();
  simTime = 0;
  acc = 0;
  countdown = COUNTDOWN_SECONDS;
  countdownTick = COUNTDOWN_SECONDS + 1;
  endTimer = 0;
  endShown = false;
  state = 'countdown';
  input.clearPresses();
  hideOverlay();
  setInGame(true);
  $('hud').hidden = false;
  $('hud-level').textContent = `${levelLabel(def).toUpperCase()} · ${def.title.toUpperCase()}`;
  $('hud-boss').textContent = def.bossName.toUpperCase();
  $('hud-track').textContent = TRACKS[def.track].title;
  audio.playTrack(TRACKS[def.track]);
}

function launchBall() {
  const def = game.def;
  const a = ((def.ball.angleDeg + rand(-14, 14)) * Math.PI) / 180;
  game.ball.launch(def.ball.x, def.ball.y, a, def.ball.speed);
  game.ball.banked = false;
  // Vent and turret clocks run from the launch, not from the countdown.
  for (const v of game.vents) v.nextAt = simTime + v.delay;
  for (const t of game.turrets) t.nextAt = simTime + t.delay;
  game.shots.length = 0;
  // A phasing drone is solid from the serve.
  for (const d of game.drones) if (d.phasing) d.phaseAt = simTime;
  // Floor emitters keep time from the launch too, so the turrets stay on their beat after a re-serve.
  for (const e of game.emitters) {
    e.pulser.t = 0;
    e.pulser.nextAt = e.delay;
    e.pulser.active = false;
  }
  game.history.reset();
  game.history.push(simTime, game.ball);
  for (const f of game.fighters) f.resetCamp();
  state = 'playing';
  $('countdown').hidden = true;
  audio.sfxCount(true);
  netEvent({ e: 'count', f: 1 });
}

function showCountdown(tick) {
  $('countdown').hidden = false;
  $('countdown').textContent = String(tick);
  audio.sfxCount(false);
}

function respawnBall() {
  const def = game.def;
  game.ball.launch(def.ball.x, def.ball.y, (def.ball.angleDeg * Math.PI) / 180, def.ball.speed);
  game.history.reset();
}

// ---------------------------------------------------------------- physics

function step(dt) {
  const g = game;
  simTime += dt;
  g.time = simTime;
  g.ball.markRender();
  for (const f of g.fighters) f.markRender();

  for (const m of g.movers) m.update(dt);

  // Intents by slot. a = the host's human (the left spawn), b = the AI boss
  // or, in versus, the rival human, c = the co-op ally. Whichever slot is
  // yours gets your input; a remote human gets its latest intent; the boss
  // gets its brain.
  const me = localFighter();
  const local = me ? input.intent(me) : ZERO_INTENT; // an eliminated host still runs the match
  const intents = { a: ZERO_INTENT, b: ZERO_INTENT, c: ZERO_INTENT, d: ZERO_INTENT };
  if (g.pvp) {
    // Every player for themselves: the host is seat a, guests c and d.
    for (const f of g.humans) intents[f.slot] = f.slot === net.localSlot ? local : net.remoteIntents[f.slot] || ZERO_INTENT;
  } else if (g.tutorial) {
    intents.a = local; // the training drone never moves
  } else {
    intents.a = local; // the host's human (only the host simulates)
    for (const f of g.allies) intents[f.slot] = net.remoteIntents[f.slot] || ZERO_INTENT;
    for (const d of g.drones) intents[d.slot] = state === 'playing' && !d.down ? bossIntent(d, g.history, g.humans, g.walls, dt, simTime, g.movers) : ZERO_INTENT;
  }
  // Movement is locked until the ball launches; aiming is allowed.
  if (state === 'countdown') for (const k of Object.keys(intents)) intents[k] = { ...intents[k], mx: 0, my: 0, lunge: false };

  for (const f of g.humans) {
    const wasIdle = f.lungeState === 'idle';
    f.update(dt, intents[f.slot]);
    if (wasIdle && f.lungeState === 'out') onWhack();
    if (g.well && state === 'playing') wellDrag(g.well, f, dt);
    resolveCircleVsSegments(f, g.walls);
    pushOutOfMovers(f);
  }

  // The AI enemies: the level's boss (with its patrol and abilities) or a
  // conduit's drones. A downed drone sits out the rest of the level.
  if (!g.pvp) {
    for (const d of g.drones) {
      if (d.down) continue;
      if (d.phasing) d.phased = state === 'playing' && dronePhased(d.phasing, simTime - (d.phaseAt || 0)); // a shadow is only there part of the time, and solid through every countdown
      if (d.rail) d.home = { x: d.x, y: d.y }; // a cart's home is wherever it is: the rail is its leash
      if (!g.tutorial && state === 'playing') {
        d.updateOrbit(dt);
        if (d.pulser) {
          d.pulser.update(dt, d.x, d.y);
          if (d.pulser.emitted) pulseFx(d.x, d.y);
        }
      }
      const wasIdle = d.lungeState === 'idle';
      d.update(dt, intents[d.slot] || ZERO_INTENT);
      if (wasIdle && d.lungeState === 'out') onWhack();
      if (d.rail) constrainToRail(d, d.rail);
      resolveCircleVsSegments(d, g.walls);
      pushOutOfMovers(d);
      if (d.rail) constrainToRail(d, d.rail);
    }
  }

  const active = activeFighters();
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) separateCircles(active[i], active[j]);
  for (const f of g.fighters) f.finalizeStep(dt);
  // Lantern drones show their light only while standing still or just after a block.
  for (const d of g.drones) if (d.lantern) d.glow = !d.down && (Math.hypot(d.svx, d.svy) < 20 || d.hitFlash > 0);

  // Contact rule: touching an enemy, shield or body, costs a shield. No
  // waiting at its side for the ball to arrive.
  if (state === 'playing' && !g.pvp && !g.tutorial && !g.ball.held) {
    outer: for (const f of g.humans) {
      if (f.invuln > 0) continue;
      for (const d of g.drones) {
        if (d.down || d.phased) continue;
        const c = fightersTouch(f, d);
        if (c) {
          onTouched(f, c);
          break outer;
        }
      }
    }
  }

  // The well: a player dragged over the horizon loses a shield and starts over at their spawn.
  if (state === 'playing' && g.well && !g.tutorial) {
    for (const f of g.humans) {
      if (f.invuln > 0 || !wellSwallows(g.well, f.x, f.y, f.r)) continue;
      onFell(f);
      break;
    }
  }

  if (!g.ball.held) {
    moveBall(dt);
    if (state === 'playing') {
      separateFightersFromBall(g.ball, activeFighters());
      g.history.push(simTime, g.ball);
    }
  }

  if (g.emitters.length && state === 'playing') {
    for (const e of g.emitters) {
      e.pulser.update(dt, e.x, e.y);
      if (e.pulser.emitted) pulseFx(e.x, e.y);
    }
  }
  if (g.turrets.length && state === 'playing') stepShots(dt);

  if (g.ice) {
    // Coolant vents drip on their own clocks while the ball is in play.
    if (state === 'playing') {
      for (const v of g.vents) {
        if (simTime < v.nextAt) continue;
        v.nextAt += v.period;
        ventDrip(v);
      }
    }
    g.ice.update(simTime, g.ball);
    for (const f of g.humans) if (g.ice.affect(f, f.slot)) onPlayerFrozen(f);
  }

  if (g.panes.length) updateGlass();

  // Keep-moving rule: human players only, never in the tutorial.
  if (state === 'playing' && !g.ball.held && !g.tutorial) {
    for (const f of g.humans) {
      if (state !== 'playing') break;
      campStep(f, f.slot, dt);
    }
  }
}

/** Everyone still in play: downed drones are out of the physics, and so is a drone while it is phased. */
function activeFighters() {
  return game.fighters.filter((f) => !f.down && !f.phased);
}

/** A pulse left its emitter (a boss or a floor emitter). */
function pulseFx(x, y) {
  const g = game;
  audio.sfxPulse();
  g.fx.ring(x, y, g.def.palette.obstacle, 80, 0.3);
  netEvent({ e: 'pulse', x, y });
}

/** Turrets fire on their clocks; every shot flies, deflects off shields, and stops on a body or a wall. */
function stepShots(dt) {
  const g = game;
  for (const t of g.turrets) {
    if (t.down || simTime < t.nextAt) continue;
    t.nextAt += t.period;
    fireTurret(t);
  }
  const active = activeFighters();
  for (let i = g.shots.length - 1; i >= 0; i--) {
    const shot = g.shots[i];
    if (simTime - shot.born > g.turrets[shot.turret].life) {
      g.shots.splice(i, 1);
      continue;
    }
    const hit = advanceShot(shot, g.walls, active, dt, g.movers);
    if (!hit) continue;
    if (hit.kind === 'paddle') {
      shot.deflected = true;
      shot.born = simTime; // a fresh life after a deflection
      paddleFx(hit.f, hit.h.cx, hit.h.cy, hit.h.nx, hit.h.ny, 0.4, false);
      netEvent({ e: 'paddle', s: hit.f.slot, x: hit.h.cx, y: hit.h.cy, nx: hit.h.nx, ny: hit.h.ny, st: 0.4, d: 0 });
      continue;
    }
    g.shots.splice(i, 1);
    if (hit.kind === 'body') {
      if (hit.f.kind === 'player') onShotHit(hit.f, hit.h);
      else shotFx(shot.x, shot.y);
      continue;
    }
    // A wall, a mover, or a turret: a deflected shot into a live turret knocks it out.
    const t = hit.seg.turret;
    if (t && shot.deflected && !t.down) turretDown(t);
    else shotFx(shot.x, shot.y);
    netEvent({ e: 'shotfx', x: shot.x, y: shot.y });
  }
}

/** Aim at the nearest human, leading it a little, and loose a shot. */
function fireTurret(t) {
  const g = game;
  let target = null;
  let best = Infinity;
  for (const f of g.humans) {
    const d = Math.hypot(f.x - t.x, f.y - t.y);
    if (d < best) {
      best = d;
      target = f;
    }
  }
  if (!target) return;
  const lead = Math.min(0.5, best / t.speed) * 0.5;
  const ax = target.x + target.svx * lead - t.x;
  const ay = target.y + target.svy * lead - t.y;
  const len = Math.hypot(ax, ay) || 1;
  t.aim = Math.atan2(ay, ax);
  const start = t.r + 10;
  g.shots.push(new Shot(t.x + (ax / len) * start, t.y + (ay / len) * start, (ax / len) * t.speed, (ay / len) * t.speed, 8, simTime, t.i));
  fireFx(t);
  netEvent({ e: 'fire', i: t.i });
}

function fireFx(t) {
  const g = game;
  const color = g.def.palette.shot || '#ff9f6a';
  g.fx.ring(t.x, t.y, color, 60, 0.3);
  g.fx.burst(t.x + Math.cos(t.aim) * t.r, t.y + Math.sin(t.aim) * t.r, Math.cos(t.aim), Math.sin(t.aim), 8, color, 220, 0.6, 0.4);
  audio.sfxPulse();
}

function shotFx(x, y) {
  const g = game;
  g.fx.burst(x, y, 0, 0, 10, g.def.palette.shot || '#ff9f6a', 180, Math.PI, 0.4);
}

/** A shot reached a human's body: one shield, like a ball. */
function onShotHit(p, h) {
  if (p.invuln > 0) return;
  p.invuln = PLAYER.invulnTime;
  playerHitFx(p, h.cx, h.cy, h.nx, h.ny);
  netEvent({ e: 'shield', s: p.slot, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
  if (game.pvp) pvpLoss(p, 'shot');
  else loseShield('shot', p);
}

function turretDown(t) {
  const g = game;
  t.down = true;
  turretFx(t);
  netEvent({ e: 'turret', i: t.i });
  if (objectiveDone(g)) conduitCleared();
}

function turretFx(t) {
  const g = game;
  const color = g.def.palette.turret || g.def.palette.obstacle;
  g.fx.burst(t.x, t.y, 0, 0, 40, color, 360, Math.PI, 0.9);
  g.fx.ring(t.x, t.y, '#ffffff', 160, 0.5);
  g.fx.addShake(10);
  audio.sfxBossHit();
}

/** A vent dropped a patch of ice. */
function ventDrip(v) {
  const g = game;
  g.ice.addPatch(v.x, v.y, v.r, simTime);
  ventFx(v);
  netEvent({ e: 'vent', i: v.i });
}

function ventFx(v) {
  const g = game;
  const color = g.def.palette.ice || '#cdf6ff';
  g.fx.ring(v.x, v.y, color, v.r * 2, 0.5);
  g.fx.burst(v.x, v.y, 0, -1, 14, color, 160, Math.PI, 0.6);
  audio.sfxIce();
}

function campStep(f, slot, dt) {
  const before = PLAYER.campSeconds - f.campTimer;
  const out = tickCamp(f, dt);
  if (f === localFighter()) campTick(before, PLAYER.campSeconds - f.campTimer);
  if (out) onCamped(f, slot);
}

/** One countdown tick per second while the keep-moving warning is showing. */
function campTick(leftBefore, leftNow) {
  if (leftNow > PLAYER.campWarn || leftNow >= leftBefore) return;
  if (Math.ceil(leftNow) !== Math.ceil(leftBefore)) audio.sfxCount(false);
}

/** A human player touched the boss (body or shield, theirs or its): that costs a shield. */
function onTouched(f, c) {
  // The grace covers the countdown, during which nobody can step away.
  f.invuln = COUNTDOWN_SECONDS + PLAYER.invulnTime;
  touchFx(f, c.x, c.y);
  netEvent({ e: 'touch', s: f.slot, x: c.x, y: c.y });
  loseShield('touch', f);
}

function touchFx(f, x, y) {
  const g = game;
  f.hitFlash = 0.5;
  g.fx.burst(x, y, 0, 0, 24, '#ff4d6d', 260, 1.4, 0.5);
  g.fx.ring(x, y, '#ff4d6d', 120, 0.5);
  g.fx.ring(f.x, f.y, '#ffffff', 70, 0.35);
  g.fx.addShake(8);
  audio.sfxPlayerHit();
}

/** The well took a human player: that costs a shield, and they start over at their spawn, out of its reach. */
function onFell(f) {
  fellFx(f);
  netEvent({ e: 'fell', s: f.slot });
  if (game.pvp) {
    pvpLoss(f, 'well'); // the round ends and everyone is reseated
    return;
  }
  f.x = f.spawn.x;
  f.y = f.spawn.y;
  f.angle = f.spawn.angle;
  f.vx = 0;
  f.vy = 0;
  f.prevX = f.x;
  f.prevY = f.y;
  f.markRender(); // no interpolated streak from the well to the spawn
  f.resetCamp();
  f.invuln = COUNTDOWN_SECONDS + PLAYER.invulnTime;
  loseShield('well', f);
}

function fellFx(f) {
  const g = game;
  const w = g.well;
  f.hitFlash = 0.5;
  g.fx.ring(w.x, w.y, '#ff4d6d', 170, 0.6);
  g.fx.ring(w.x, w.y, '#ffffff', 90, 0.4);
  g.fx.burst(w.x, w.y, 0, 0, 30, f.color, 220, Math.PI, 0.6);
  g.fx.addShake(10);
  audio.sfxSwallow();
  audio.sfxPlayerHit();
}

/** The ball crossed the horizon: the well keeps it and the serve starts over. No shield is lost. */
function swallowBall() {
  swallowFx();
  netEvent({ e: 'swallow' });
  reserve('swallow', null);
}

function swallowFx() {
  const g = game;
  const w = g.well;
  g.fx.ring(w.x, w.y, g.def.palette.well || '#b49cff', 150, 0.5);
  g.fx.ring(w.x, w.y, '#ffffff', 60, 0.3);
  g.fx.burst(w.x, w.y, 0, 0, 20, '#ffffff', 160, Math.PI, 0.4);
  g.fx.addShake(6);
  audio.sfxSwallow();
}

/** The well's pull on the ball at (x, y), for the guide. */
function wellAccel(x, y) {
  const w = game.well;
  const p = wellField(w, x, y);
  return p ? { ax: p.ux * w.pull * p.k, ay: p.uy * w.pull * p.k } : null;
}

/** A human player stood within a body length of one spot for too long: that is a loss. */
function onCamped(f, slot) {
  const g = game;
  campFx(f);
  netEvent({ e: 'camp', s: slot });
  if (g.pvp) {
    pvpLoss(f, 'camp');
    return;
  }
  loseShield('camp', f);
}

function campFx(f) {
  const g = game;
  f.hitFlash = 1;
  g.fx.ring(f.x, f.y, '#ff4d6d', 160, 0.6);
  g.fx.ring(f.x, f.y, '#ffffff', 90, 0.4);
  g.fx.burst(f.x, f.y, 1, 0, 40, '#ff4d6d', 320, Math.PI, 0.7);
  g.fx.addShake(12);
  audio.sfxPlayerHit();
}

function onWhack() {
  audio.sfxWhack();
  netEvent({ e: 'whack' });
}

/** Reglaze broken panes whose time is up and nothing is standing in them. */
function updateGlass() {
  const g = game;
  let changed = false;
  for (const pane of g.panes) {
    if (!pane.broken || simTime < pane.regrowAt) continue;
    const blocked = [g.ball, ...activeFighters()].some((c) =>
      pane.segs.some((sg) => circleVsCapsule(c.x, c.y, c.r + 4, sg.ax, sg.ay, sg.bx, sg.by, 0)),
    );
    if (blocked) {
      pane.regrowAt = simTime + 0.5;
      continue;
    }
    pane.broken = false;
    for (const sg of pane.segs) sg.broken = false;
    const c = paneCentre(pane);
    g.fx.ring(c.x, c.y, pane.color, 70, 0.5);
    audio.sfxReglaze();
    netEvent({ e: 'reglaze', i: g.panes.indexOf(pane) });
    changed = true;
  }
  if (changed) rebuildWalls();
}

function paneCentre(pane) {
  let x = 0;
  let y = 0;
  for (const p of pane.poly) {
    x += p[0];
    y += p[1];
  }
  return { x: x / pane.poly.length, y: y / pane.poly.length };
}

function rebuildWalls() {
  rebuildWallsState(game);
}

function shatter(pane, h, before) {
  const g = game;
  const glass = g.def.glass;
  pane.broken = true;
  pane.regrowAt = simTime + glass.regrow;
  for (const sg of pane.segs) sg.broken = true;
  // The ball keeps going through the gap, a little slower.
  g.ball.vx = before.vx * glass.speedKeep;
  g.ball.vy = before.vy * glass.speedKeep;
  shatterFx(pane, h.cx, h.cy, h.nx, h.ny);
  netEvent({ e: 'shatter', i: g.panes.indexOf(pane), x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
  rebuildWalls();
  guideFrame = 0;
}

function shatterFx(pane, x, y, nx, ny) {
  const g = game;
  g.fx.burst(x, y, -nx, -ny, 26, pane.color, 380, 1.3, 0.7);
  g.fx.burst(x, y, nx, ny, 12, '#ffffff', 220, 1.2, 0.5);
  g.fx.ring(x, y, pane.color, 90, 0.4);
  g.fx.addShake(6);
  audio.sfxShatter();
}

function onPlayerFrozen(f) {
  freezeFx(f);
  netEvent({ e: 'freeze', s: f.slot });
}

function freezeFx(f) {
  const g = game;
  audio.sfxFreeze();
  g.fx.ring(f.x, f.y, g.def.palette.ice || '#cdf6ff', 90, 0.5);
  g.fx.burst(f.x, f.y, 0, -1, 18, '#ffffff', 120, Math.PI, 0.7);
  g.fx.addShake(4);
}

function pushOutOfMovers(f) {
  for (const m of game.movers) {
    const segs = m.segments().map((sg) => ({ ...sg, thick: m.thick }));
    resolveCircleVsSegments(f, segs);
  }
}

function separateCircles(a, b) {
  const h = circleVsCircle(a.x, a.y, a.r, b.x, b.y, b.r);
  if (!h) return;
  a.x += h.nx * h.depth * 0.5;
  a.y += h.ny * h.depth * 0.5;
  b.x -= h.nx * h.depth * 0.5;
  b.y -= h.ny * h.depth * 0.5;
}

function moveBall(dt) {
  const g = game;
  const b = g.ball;
  if (g.well) {
    const p = wellField(g.well, b.x, b.y);
    if (p) {
      b.vx += p.ux * g.well.pull * p.k * dt;
      b.vy += p.uy * g.well.pull * p.k * dt;
    }
  }
  const active = activeFighters();
  const pulsers = g.drones.filter((d) => d.pulser && !d.down).map((d) => d.pulser).concat(g.emitters.map((e) => e.pulser));
  const stopped = advanceBall(
    b,
    g.walls,
    active,
    dt,
    SURFACE_VELOCITY_FACTOR,
    {
      onWall: onWallBounce,
      onPaddle: onPaddleHit,
      onMover: onMoverHit,
      onBody: (f, h) => {
        if (g.tutorial) return tutorialBody(f, h);
        if (!bodyHitCounts(g.ball, f, g.rules)) {
          ownBallBounce(f, h);
          return false;
        }
        if (g.pvp) {
          onPvpHit(f, h);
          return true;
        }
        if (f.kind === 'boss') return g.def.conduit ? onDroneHit(f, h) : onBossHit(h);
        onPlayerHit(f, h);
        return false;
      },
    },
    pulsers.length ? g.movers.concat(pulsers) : g.movers,
    g.solidPolys,
  );
  if (stopped) return;

  b.clampSpeed(BALL.minSpeed, g.maxSpeed);
  if (b.speed > g.topSpeed) g.topSpeed = b.speed;
  if (g.well && state === 'playing' && wellSwallows(g.well, b.x, b.y)) {
    swallowBall();
    return;
  }

  // Safety net: the arena is sealed, but if numerical trouble ever pushed the
  // ball through a wall, put it back in play rather than losing it.
  if (!pointInPolygon(b.x, b.y, g.def.boundary)) respawnBall();
}

function speedNorm(s) {
  const max = game ? game.maxSpeed : BALL.maxSpeed;
  return clamp((s - BALL.minSpeed) / (max - BALL.minSpeed), 0, 1);
}

function onWallBounce(h, seg, before) {
  const g = game;
  if (seg.kind === 'node') return onNodeHit(seg.node, h, before);
  g.ball.banked = true;
  if (seg.kind === 'glass' && before && !seg.pane.broken && !seg.pane.unbreakable) {
    const speed = Math.hypot(before.vx, before.vy);
    if (speed >= (seg.pane.breakSpeed || g.def.glass.breakSpeed)) {
      shatter(seg.pane, h, before);
      return;
    }
  }
  const n = speedNorm(g.ball.speed);
  const color = seg.kind === 'glass' ? seg.pane.color : seg.kind === 'obstacle' ? g.def.palette.obstacle : g.def.palette.wall;
  wallFx(h.cx, h.cy, h.nx, h.ny, n, color);
  netEvent({ e: 'wall', x: h.cx, y: h.cy, nx: h.nx, ny: h.ny, n, c: color });
  g.ball.lastHitBy = 'wall';
  guideFrame = 0;
}

function wallFx(x, y, nx, ny, n, color) {
  audio.sfxWall(n);
  game.fx.burst(x, y, nx, ny, 4 + Math.floor(n * 8), color, 160 + 300 * n, 1.1, 0.35);
}

/** The ball touched a conduit node: light it if the node's condition holds. */
function onNodeHit(node, h, before) {
  const g = game;
  const color = node.lit ? g.def.palette.nodeLit || '#7dffc4' : g.def.palette.node || '#6e7fa8';
  const n = speedNorm(g.ball.speed);
  g.ball.lastHitBy = 'wall';
  guideFrame = 0;
  if (node.kind === 'switch') {
    // A switch flips its doors on every touch (with a moment's grace against double taps).
    wallFx(h.cx, h.cy, h.nx, h.ny, n, color);
    if (simTime - (node.flippedAt || -9) < 0.4) return;
    node.flippedAt = simTime;
    flipSwitch(node);
    netEvent({ e: 'switch', i: node.i });
    return;
  }
  // A node may wait on others (the exit behind the candles).
  const waiting = node.requires && node.requires.some((i) => g.nodes[i] && !g.nodes[i].lit);
  if (node.lit || waiting || !nodeAccepts(node, h, before, g.ball)) {
    // Already lit, or the shot did not qualify: an ordinary bounce.
    wallFx(h.cx, h.cy, h.nx, h.ny, n, color);
    netEvent({ e: 'wall', x: h.cx, y: h.cy, nx: h.nx, ny: h.ny, n, c: color });
    if (!node.lit) refusedFx(node);
    return;
  }
  node.lit = true;
  nodeFx(node, h);
  netEvent({ e: 'node', i: node.i, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
  if (objectiveDone(g)) conduitCleared();
}

/** Toggle a switch node and every door it is wired to. */
function flipSwitch(node) {
  const g = game;
  node.lit = !node.lit;
  for (const i of node.toggles || []) if (g.doors[i]) g.doors[i].closed = !g.doors[i].closed;
  rebuildWallsState(g);
  guideFrame = 0;
  const color = node.lit ? g.def.palette.nodeLit || '#7dffc4' : g.def.palette.node || '#6e7fa8';
  g.fx.ring(node.x, node.y, color, 90, 0.4);
  for (const i of node.toggles || []) {
    const d = g.doors[i];
    if (!d) continue;
    const cx = d.poly.reduce((s, p) => s + p[0], 0) / d.poly.length;
    const cy = d.poly.reduce((s, p) => s + p[1], 0) / d.poly.length;
    g.fx.ring(cx, cy, g.def.palette.door || g.def.palette.obstacle, 70, 0.35);
  }
  audio.sfxCount(true);
}

function nodeFx(node, h) {
  const g = game;
  const color = g.def.palette.nodeLit || '#7dffc4';
  g.fx.burst(h.cx, h.cy, h.nx, h.ny, 30, color, 320, Math.PI, 0.7);
  g.fx.ring(node.x, node.y, color, 150, 0.6);
  g.fx.ring(node.x, node.y, '#ffffff', 70, 0.35);
  g.fx.addShake(5);
  audio.sfxBossHit();
}

/** A node that turned the ball away: a dim flicker so the player knows the shot did not qualify. */
function refusedFx(node) {
  game.fx.ring(node.x, node.y, '#ff4d6d', 60, 0.3);
}

/** Every node lit (and every drone down, when asked): the conduit is cleared. */
function conduitCleared() {
  const g = game;
  state = 'cleared';
  g.ball.held = true;
  audio.stopTrack(2.5);
  endTimer = 1.6;
}

/** A body hit on a conduit drone knocks it out of the level; it may be the objective. */
function onDroneHit(f, h) {
  const g = game;
  hitFx(f, h.cx, h.cy, h.nx, h.ny);
  netEvent({ e: 'hit', s: f.slot, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
  f.down = true;
  f.hitFlash = 3;
  if (objectiveDone(g)) {
    conduitCleared();
    return true;
  }
  return false;
}

function onMoverHit(m, h, before) {
  const g = game;
  g.ball.banked = true;
  const after = g.ball.speed;
  const delta = after - before;
  const strength = clamp(Math.abs(delta) / 400, 0, 1);
  moverFx(m.kind, h.cx, h.cy, h.nx, h.ny, strength, Math.abs(delta) > 120);
  netEvent({ e: 'mover', k: m.kind, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny, s: strength, d: Math.abs(delta) > 120 ? 1 : 0 });
  g.ball.lastHitBy = 'mover';
  guideFrame = 0;
}

function moverFx(kind, x, y, nx, ny, strength, big) {
  const g = game;
  if (kind === 'pulse') audio.sfxPing(strength);
  else audio.sfxPaddle(strength * 0.7, true);
  g.fx.burst(x, y, nx, ny, 6 + Math.floor(strength * 12), g.def.palette.obstacle, 180 + 360 * strength, 1, 0.4);
  if (big) g.fx.ring(x, y, g.def.palette.obstacle, 50 + 100 * strength, 0.35);
}

function onPaddleHit(f, h, before) {
  const g = game;
  const after = g.ball.speed;
  const delta = after - before;
  const strength = clamp(Math.abs(delta) / 400, 0, 1);
  const isBoss = f.kind === 'boss';
  paddleFx(f, h.cx, h.cy, h.nx, h.ny, strength, delta > 100);
  g.ball.lastHitBy = f.kind;
  g.ball.lastPaddle = f.kind;
  g.ball.lastTeam = f.team;
  g.ball.banked = false;
  if (!isBoss) g.paddleHits++;
  if (g.tutorial && !isBoss) tutorialPaddle(before, after);
  // The ice trail follows the boss's blocks; in PvP, either player's.
  let iced = 0;
  if (g.ice && (isBoss || g.pvp)) {
    g.ice.start(simTime, f.slot);
    audio.sfxIce();
    iced = 1;
  }
  netEvent({ e: 'paddle', s: f.slot, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny, st: strength, d: delta > 100 ? 1 : 0, ice: iced });
  guideFrame = 0;
}

function paddleFx(f, x, y, nx, ny, strength, big) {
  if (f.lantern) f.hitFlash = Math.max(f.hitFlash, 1.4); // a lantern drone's block shows its light for a moment
  const g = game;
  audio.sfxPaddle(strength, f.kind === 'boss');
  g.fx.burst(x, y, nx, ny, 8 + Math.floor(strength * 16), f.color, 200 + 400 * strength, 0.9, 0.45);
  if (big) {
    g.fx.addShake(3 + strength * 7);
    g.fx.ring(x, y, f.color, 60 + 120 * strength, 0.4);
  }
}

/** The ball touched the body of the fighter who last hit it, and the rules say that is safe: bounce, no loss. */
function ownBallBounce(f, h) {
  bodyBounceFx(f, h.cx, h.cy, h.nx, h.ny);
  netEvent({ e: 'body', s: f.slot, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
}

function bodyBounceFx(f, x, y, nx, ny) {
  f.hitFlash = Math.max(f.hitFlash, 0.25);
  game.fx.burst(x, y, nx, ny, 10, f.color, 220, 1.2, 0.4);
  game.fx.ring(f.x, f.y, f.color, 70, 0.3);
  audio.sfxPaddle(0.25, true);
}

/** A body hit on the boss. Returns true (stop the ball) when the level is won; in co-op the boss can take more than one. */
function onBossHit(h) {
  const g = game;
  g.bossHits--;
  hitFx(g.boss, h.cx, h.cy, h.nx, h.ny);
  netEvent({ e: 'hit', s: 'b', x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
  if (g.bossHits > 0) {
    reserve('boss', 'b');
    return true;
  }
  state = 'cleared';
  g.ball.held = true;
  g.boss.hitFlash = 5;
  audio.stopTrack(2.5);
  endTimer = 1.6;
  return true;
}

function onPlayerHit(p, h) {
  if (p.invuln > 0) return;
  p.invuln = PLAYER.invulnTime;
  playerHitFx(p, h.cx, h.cy, h.nx, h.ny);
  netEvent({ e: 'shield', s: p.slot, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
  loseShield('hit', p);
}

function playerHitFx(p, x, y, nx, ny) {
  const g = game;
  p.hitFlash = 0.3;
  g.fx.burst(x, y, nx, ny, 30, '#ff4d6d', 320, 1.6, 0.6);
  g.fx.ring(p.x, p.y, '#ff4d6d', 140, 0.5);
  g.fx.addShake(12);
  audio.sfxPlayerHit();
}

/**
 * A body hit or standing still costs one shield. With shields left the ball
 * re-serves behind a fresh countdown; with none, the level is lost (and with
 * it the campaign, whose pool this is).
 */
function loseShield(reason, who = game.player) {
  const g = game;
  if (g.lives !== Infinity) g.lives--;
  g.shieldsLost++;
  if (campaign) {
    campaign.shields = g.lives;
    campaign.lost++;
    saveCampaign();
  }
  if (g.lives <= 0) {
    g.lossReason = reason;
    g.lastLoss = { reason, slot: who.slot, at: g.time };
    state = 'failed';
    g.ball.held = true;
    audio.stopTrack(1.5);
    endTimer = 1.2;
    return;
  }
  reserve(reason, who.slot);
}

/** Hold the ball at its serve point and run a fresh countdown; `reason` and `slot` feed the HUD notice. */
function reserve(reason, slot) {
  const g = game;
  const def = g.def;
  g.ball.held = true;
  g.ball.x = def.ball.x;
  g.ball.y = def.ball.y;
  g.ball.vx = 0;
  g.ball.vy = 0;
  g.ball.trail.length = 0;
  g.shots.length = 0;
  g.history.reset();
  g.guidePath = null;
  g.lastLoss = { reason, slot, at: g.time };
  countdown = COUNTDOWN_SECONDS;
  countdownTick = COUNTDOWN_SECONDS + 1;
  state = 'countdown';
}

// ----------------------------------------------------------------- frames

function frame(now) {
  input.pollGamepad();
  if (state === 'title') {
    const el = $('pad-state');
    if (el) el.textContent = input.pad.connected ? `· detected: ${input.pad.id.slice(0, 40)}` : '· none detected yet (press any button on it)';
  }
  const rawDt = (now - last) / 1000;
  const dt = Math.min(rawDt, 0.05);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  let alpha = 1; // how far through the current physics step this frame is drawn

  if (game && state !== 'title' && state !== 'paused') {
    const guest = net.mode === 'guest';
    if (state === 'playing') watchFrameTime(rawDt);
    if (guest) guestApply(now);
    acc += dt;
    const simulate = !guest && (state === 'countdown' || state === 'playing');
    const predict = guest && (state === 'countdown' || state === 'playing');
    while (acc >= PHYSICS_DT) {
      if (simulate) step(PHYSICS_DT);
      else if (predict) guestStep(PHYSICS_DT);
      acc -= PHYSICS_DT;
    }
    if (simulate || predict) alpha = acc / PHYSICS_DT;
    game.fx.update(dt);
    if (state === 'countdown' && !guest) {
      countdown -= dt;
      const tick = Math.ceil(countdown);
      if (tick !== countdownTick) {
        countdownTick = tick;
        if (tick > 0) {
          showCountdown(tick);
          netEvent({ e: 'count', f: 0 });
        }
      }
      if (countdown <= 0) launchBall();
    }
    if (game.tutorial && state === 'playing') tutorialTick(dt);
    if (state === 'roundEnd' && net.mode === 'host') {
      endTimer -= dt;
      if (endTimer <= 0) {
        if (survivors().length <= 1) {
          state = 'matchEnd';
          showNetMatchEnd();
        } else startNetRound();
      }
    }
    if (state === 'playing') {
      audio.setBallSpeed(game.ball.speed, game.def.ball.speed, BALL.minSpeed, game.maxSpeed);
      if (guideFrame-- <= 0) {
        guideFrame = 6;
        if (game.def.noGuide) {
          game.guidePath = null;
          guideFrame = 60;
        }
        const seeThrough = !game.def.noGuide && game.def.glass && game.ball.speed >= game.def.glass.breakSpeed;
        let guideWalls = seeThrough ? game.walls.filter((w) => w.kind !== 'glass' || w.pane.unbreakable || (w.pane.breakSpeed && game.ball.speed < w.pane.breakSpeed)) : game.walls;
        if (game.movers.length) {
          guideWalls = guideWalls.concat(moverSegmentsAt(game.movers, game.ball.x, game.ball.y, game.ball.vx, game.ball.vy));
        }
        if (game.def.noGuide) {
          // nothing: the guide is off
        } else if (game.well) {
          game.guidePath = predictCurvedPath(game.ball.x, game.ball.y, game.ball.vx, game.ball.vy, guideWalls, wellAccel, { bounces: 1, maxDist: 900, radius: game.ball.r, speed: [BALL.minSpeed, game.maxSpeed], stop: (x, y) => wellSwallows(game.well, x, y) });
        } else game.guidePath = predictPath(game.ball.x, game.ball.y, game.ball.vx, game.ball.vy, guideWalls, 1, 900, game.ball.r);
      }
    }
    if (!guest && (state === 'cleared' || state === 'failed') && !endShown) {
      endTimer -= dt;
      if (endTimer <= 0) {
        endShown = true;
        if (state === 'cleared') showCleared();
        else showFailed();
      }
    }
    updateHud();
    if (net.mode === 'host') hostSend();
    else if (net.mode === 'guest') guestSend();
  }

  if (state === 'jukebox') {
    jukeboxTick(now / 1000);
    renderer.drawJukebox(audio.playhead(), jukebox.palette, now / 1000);
  } else {
    drawWorld(now / 1000, alpha);
  }
  handleGlobalKeys();
  requestAnimationFrame(frame);
}

/**
 * Draw the world `alpha` of the way from the previous physics step to the
 * current one. Physics runs in whole 240 Hz steps, so without this a frame
 * on a 144 Hz or 75 Hz display alternates between one and two steps of ball
 * travel and judders even at a perfect frame rate. The interpolated values
 * are swapped in for the draw and restored afterwards.
 */
function drawWorld(nowSec, alpha) {
  const g = game;
  if (!g || !(alpha > 0 && alpha < 1)) {
    if (g && state === 'playing') g.ball.pushTrail(BALL.trailLength);
    const me = net.mode === 'guest' && (net.smooth.x || net.smooth.y) ? localFighter() : null;
    if (me) {
      me.x += net.smooth.x;
      me.y += net.smooth.y;
    }
    try {
      renderer.draw(g, state, nowSec, input.joystick);
    } finally {
      if (me) {
        me.x -= net.smooth.x;
        me.y -= net.smooth.y;
      }
    }
    return;
  }
  const b = g.ball;
  const fs = g.fighters;
  const bx = b.x;
  const by = b.y;
  const saved = fs.map((f) => [f.x, f.y, f.angle, f.paddleOffset]);
  const smoothed = net.mode === 'guest' && (net.smooth.x || net.smooth.y) ? localFighter() : null;
  if (!b.held) {
    b.x = b.rx + (bx - b.rx) * alpha;
    b.y = b.ry + (by - b.ry) * alpha;
  }
  for (const f of fs) {
    f.x = f.rx + (f.x - f.rx) * alpha;
    f.y = f.ry + (f.y - f.ry) * alpha;
    f.angle = f.rAngle + wrapAngle(f.angle - f.rAngle) * alpha;
    f.paddleOffset = f.rPaddle + (f.paddleOffset - f.rPaddle) * alpha;
  }
  if (smoothed) {
    smoothed.x += net.smooth.x;
    smoothed.y += net.smooth.y;
  }
  try {
    if (state === 'playing') b.pushTrail(BALL.trailLength);
    renderer.draw(g, state, nowSec, input.joystick);
  } finally {
    b.x = bx;
    b.y = by;
    fs.forEach((f, i) => {
      [f.x, f.y, f.angle, f.paddleOffset] = saved[i];
    });
  }
}

// ---------------------------------------------------------- frame health

// A frame is "dropped" when it took much longer than the display's refresh
// interval (estimated as the median of recent frames). Drops are counted per
// level for the HUD. On the Auto quality setting the renderer steps down to
// low quality for the rest of the session when a window of frames is either
// jittery (8% or more dropped) or uniformly slow (a median below 42 fps, which
// no display's refresh rate explains).
const FRAME_WINDOW = 90;
const SLOW_MEDIAN = 1 / 42;
const perf = { ring: new Array(FRAME_WINDOW).fill(1 / 60), i: 0, filled: false, refresh: 1 / 60, windowDrops: 0, sinceLevel: 0 };

function resetFrameWatch() {
  perf.i = 0;
  perf.filled = false;
  perf.windowDrops = 0;
  perf.sinceLevel = 0;
}

function watchFrameTime(dt) {
  perf.sinceLevel += dt;
  if (dt <= 0 || dt > 0.25) return; // a tab switch or a hitch, not a frame
  perf.ring[perf.i] = dt;
  perf.i = (perf.i + 1) % FRAME_WINDOW;
  if (perf.filled && perf.sinceLevel > 2 && dt > perf.refresh * 1.6) {
    game.drops++;
    perf.windowDrops++;
  }
  if (perf.i === 0) {
    const sorted = [...perf.ring].sort((a, b) => a - b);
    perf.refresh = sorted[FRAME_WINDOW >> 1];
    const settled = perf.filled && perf.sinceLevel > 2;
    if (settled && qualitySetting() === 'auto' && !autoLow && (perf.windowDrops >= FRAME_WINDOW * 0.08 || perf.refresh > SLOW_MEDIAN)) {
      autoLow = true;
      applyQuality();
    }
    perf.filled = true;
    perf.windowDrops = 0;
  }
}

// ----------------------------------------------------------------- jukebox

const TRACK_KEYS = Object.keys(TRACKS);
const jukebox = {
  queue: [], // track keys in play order
  index: -1, // position in the queue of the track now playing
  length: 90, // seconds each track runs before the queue advances
  tempo: 100, // percent of the track's own BPM
  startedAt: 0,
  switching: null, // timeout handle during a fade to the next track
  playing: false,
  palette: null,
};

function trackLevel(key) {
  return LEVELS.find((l) => l.track === key) || null;
}

async function openJukebox() {
  await audio.init();
  state = 'jukebox';
  setInGame(false);
  stopMarkAnimation();
  $('hud').hidden = true;
  if (jukebox.queue.length === 0) jukebox.queue = [...TRACK_KEYS];
  renderJukebox();
  if (!jukebox.playing) jukeboxPlay(0);
}

function leaveJukebox() {
  jukeboxStop();
  goToMenu();
}

function jukeboxPlay(index) {
  if (jukebox.switching) {
    clearTimeout(jukebox.switching);
    jukebox.switching = null;
  }
  if (jukebox.queue.length === 0) return;
  jukebox.index = ((index % jukebox.queue.length) + jukebox.queue.length) % jukebox.queue.length;
  const key = jukebox.queue[jukebox.index];
  const level = trackLevel(key);
  jukebox.palette = level ? level.palette : null;
  jukebox.tempo = 100; // every track starts at its own default BPM
  audio.playTrack(TRACKS[key]);
  audio.setTempoScale(1);
  audio.setIntensity(0.55);
  jukebox.startedAt = performance.now() / 1000;
  jukebox.playing = true;
  renderJukebox();
}

function jukeboxNext() {
  if (!jukebox.playing || jukebox.switching) return;
  // Fade the current track out, then start the next one in the queue.
  audio.stopTrack(1.2);
  jukebox.switching = setTimeout(() => {
    jukebox.switching = null;
    jukeboxPlay(jukebox.index + 1);
  }, 1250);
}

function jukeboxStop() {
  if (jukebox.switching) clearTimeout(jukebox.switching);
  jukebox.switching = null;
  audio.stopTrack(0.6);
  jukebox.playing = false; // keep `index` so Play resumes the same track
}

function jukeboxTick(now) {
  if (!jukebox.playing) return;
  const elapsed = now - jukebox.startedAt;
  if (elapsed >= jukebox.length && !jukebox.switching) jukeboxNext();
  const ph = audio.playhead();
  const bar = $('jb-progress');
  if (bar) bar.style.width = `${clamp(elapsed / jukebox.length, 0, 1) * 100}%`;
  setText('jb-time', `${formatTime(Math.min(elapsed, jukebox.length))} / ${formatTime(jukebox.length)}`);
  setText('jb-bpm', ph ? `${Math.round(ph.bpm)} BPM` : '');
  setText('jb-section', ph ? `${ph.section.toUpperCase()} · bar ${ph.barIn + 1}/${ph.sectionBars}` : jukebox.switching ? 'NEXT TRACK…' : '');
}

function renderJukebox() {
  const nowKey = jukebox.playing && jukebox.index >= 0 ? jukebox.queue[jukebox.index] : null;
  const library = TRACK_KEYS.map((key) => {
    const t = TRACKS[key];
    const lv = trackLevel(key);
    const inQueue = jukebox.queue.includes(key);
    return `<li class="jb-row ${key === nowKey ? 'now' : ''}">
      <span class="jb-num">${lv ? String(lv.id).padStart(2, '0') : '--'}</span>
      <span class="jb-title">${t.title}<small>${t.key} · ${t.bpm} BPM</small></span>
      <span class="jb-actions"><button data-play="${key}" title="Play now">▶</button><button data-add="${key}" ${inQueue ? 'disabled' : ''} title="Add to queue">+</button></span>
    </li>`;
  }).join('');
  const queue = jukebox.queue.map((key, i) => {
    const t = TRACKS[key];
    return `<li class="jb-row ${i === jukebox.index && jukebox.playing ? 'now' : ''}">
      <span class="jb-num">${i + 1}</span>
      <span class="jb-title">${t.title}</span>
      <span class="jb-actions"><button data-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button><button data-down="${i}" ${i === jukebox.queue.length - 1 ? 'disabled' : ''} title="Move down">↓</button><button data-remove="${i}" title="Remove">×</button></span>
    </li>`;
  }).join('');
  const now = nowKey ? TRACKS[nowKey] : null;
  showOverlay(`
    <div class="eyebrow">SOUNDTRACK</div>
    <h1>${now ? now.title : 'Nothing playing'}</h1>
    <div class="jb-now">
      <div class="jb-meta"><span id="jb-section"></span><span id="jb-bpm"></span><span id="jb-time"></span></div>
      <div class="bar jb-bar"><div id="jb-progress"></div></div>
    </div>
    <div class="jb-sliders">
      <label>Tempo <input id="jb-tempo" type="range" min="60" max="160" step="1" value="${jukebox.tempo}" /> <span id="jb-tempo-val">${jukebox.tempo}%</span></label>
      <label>Each track plays for <input id="jb-length" type="range" min="20" max="300" step="5" value="${jukebox.length}" /> <span id="jb-length-val">${formatTime(jukebox.length)}</span></label>
    </div>
    <div class="columns jb-columns">
      <div><h3>Tracks</h3><ul class="jb-list">${library}</ul></div>
      <div><h3>Play order</h3><ul class="jb-list">${queue || '<li class="muted small">Queue is empty. Add tracks from the left.</li>'}</ul></div>
    </div>
    <div class="row">
      <button id="jb-toggle" class="primary">${jukebox.playing ? 'Stop' : 'Play'}</button>
      <button id="jb-next" ${jukebox.playing ? '' : 'disabled'}>Next [N]</button>
      <button id="jb-reset">Reset order</button>
      <button id="btn-menu">Main menu [Esc]</button>
    </div>
  `);
  const o = $('overlay');
  o.querySelectorAll('[data-play]').forEach((b) => (b.onclick = () => {
    const key = b.dataset.play;
    if (!jukebox.queue.includes(key)) jukebox.queue.push(key);
    jukeboxPlay(jukebox.queue.indexOf(key));
  }));
  o.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
    jukebox.queue.push(b.dataset.add);
    renderJukebox();
  }));
  o.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => moveInQueue(Number(b.dataset.up), -1)));
  o.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => moveInQueue(Number(b.dataset.down), 1)));
  o.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.remove);
    const wasNow = i === jukebox.index;
    jukebox.queue.splice(i, 1);
    if (i < jukebox.index) jukebox.index--;
    if (wasNow) {
      if (jukebox.queue.length) jukeboxPlay(jukebox.index);
      else jukeboxStop();
    }
    renderJukebox();
  }));
  $('jb-tempo').oninput = (e) => {
    jukebox.tempo = Number(e.target.value);
    audio.setTempoScale(jukebox.tempo / 100);
    audio.setIntensity(clamp(0.55 + (jukebox.tempo - 100) / 120, 0.2, 1));
    setText('jb-tempo-val', `${jukebox.tempo}%`);
  };
  $('jb-length').oninput = (e) => {
    jukebox.length = Number(e.target.value);
    setText('jb-length-val', formatTime(jukebox.length));
  };
  $('jb-toggle').onclick = () => {
    if (jukebox.playing) {
      jukeboxStop();
      renderJukebox();
    } else jukeboxPlay(Math.max(0, jukebox.index));
  };
  $('jb-next').onclick = jukeboxNext;
  $('jb-reset').onclick = () => {
    jukebox.queue = [...TRACK_KEYS];
    jukebox.index = jukebox.playing ? jukebox.queue.indexOf(nowKey) : -1;
    renderJukebox();
  };
  $('btn-menu').onclick = leaveJukebox;
}

function moveInQueue(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= jukebox.queue.length) return;
  [jukebox.queue[i], jukebox.queue[j]] = [jukebox.queue[j], jukebox.queue[i]];
  if (jukebox.index === i) jukebox.index = j;
  else if (jukebox.index === j) jukebox.index = i;
  renderJukebox();
}

function handleGlobalKeys() {
  if (input.consumePress('m')) {
    audio.setMuted(!audio.muted);
    $('hud-mute').textContent = audio.muted ? 'MUTED [M]' : 'SOUND ON [M]';
  }
  if (input.consumePress('p') || input.consumePress('Escape')) {
    if (net.mode) leaveMatch();
    else if (state === 'playing') pause();
    else if (state === 'paused') resume();
    else if (state === 'jukebox') leaveJukebox();
  }
  if (state === 'jukebox' && input.consumePress('n')) jukeboxNext();
  if (input.consumePress('r') && game && state !== 'title' && !net.mode) {
    if (game.tutorial) tutorialServe('Re-served.');
    else startLevel(levelIndex);
  }
  if (input.consumePress('f')) toggleFullscreen();
  if (input.consumePress('Enter') && !net.mode) {
    if (state === 'title') begin();
    else if (state === 'cleared') {
      const nextIdx = nextAfter(levelIndex);
      startLevel(nextIdx >= 0 ? nextIdx : levelIndex);
    } else if (state === 'failed') startLevel(levelIndex);
    else if (state === 'paused') resume();
  }
}

function pause() {
  state = 'paused';
  setInGame(false);
  if (audio.ctx) audio.ctx.suspend();
  showOverlay(`
    <h1>PAUSED</h1>
    <p class="muted">Level ${game.def.id} · ${game.def.title}</p>
    <div class="row"><button id="btn-resume" class="primary">Resume</button><button id="btn-restart">Restart level</button><button id="btn-menu">Main menu</button>${fullscreenHint()}</div>
  `);
  $('btn-resume').onclick = resume;
  $('btn-restart').onclick = () => startLevel(levelIndex);
  $('btn-menu').onclick = goToMenu;
  $('btn-full')?.addEventListener('click', toggleFullscreen);
}

function resume() {
  hideOverlay();
  setInGame(true);
  if (audio.ctx) audio.ctx.resume();
  last = performance.now();
  state = 'playing';
}

/** Leave the current level (from pause or an end screen) and show the title. */
function goToMenu() {
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  audio.stopTrack(0.6);
  netReset();
  campaign = null;
  $('tutor').hidden = true;
  game = null;
  showTitle();
}

/** Touch controls are only shown while a level is actually being played. */
function setInGame(on) {
  document.body.classList.toggle('in-game', on);
}

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_DESKTOP = /\bElectron\//.test(navigator.userAgent); // the desktop app (desktop/), which brings its own LAN server
const STANDALONE = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function canFullscreen() {
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

async function toggleFullscreen() {
  const doc = document;
  const el = doc.documentElement;
  try {
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      await (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen());
    } else {
      await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen());
      // Phones: keep the game in landscape while fullscreen (best effort).
      screen.orientation?.lock?.('landscape').catch(() => {});
    }
  } catch (err) {
    console.warn('Fullscreen unavailable:', err);
  }
}

function fullscreenHint() {
  if (canFullscreen()) return '<button id="btn-full" title="Toggle fullscreen (F)">Fullscreen</button>';
  if (IS_IOS && !STANDALONE) return '<p class="small muted">For full screen on iPhone: Share → Add to Home Screen, then open it from there.</p>';
  return '';
}

// -------------------------------------------------------------------- HUD

const hudCache = {};
function setText(id, text) {
  if (hudCache[id] === text) return;
  hudCache[id] = text;
  $(id).textContent = text;
}

function setHtml(id, html) {
  if (hudCache[id] === html) return;
  hudCache[id] = html;
  $(id).innerHTML = html;
}

/** A name or number in that player's colour (PvP HUD and overlays). */
/** "◆◆◇" for a conduit's nodes, plus the drones still standing when they are part of the job. */
function objectiveText(g) {
  const targets = g.nodes.filter((n) => n.kind !== 'switch');
  const switches = g.nodes.filter((n) => n.kind === 'switch');
  const lit = targets.filter((n) => n.lit).length;
  let text = targets.length ? '◆'.repeat(lit) + '◇'.repeat(targets.length - lit) : '';
  if (switches.length) text += `${text ? ' · ' : ''}ROUTE ${switches.map((n) => (n.lit ? '▮' : '▯')).join('')}`;
  if (g.objective.drones) {
    const up = g.drones.filter((d) => !d.down).length;
    text += `${text ? ' · ' : ''}${up} DRONE${up === 1 ? '' : 'S'} UP`;
  }
  if (g.objective.turrets) {
    const up = g.turrets.filter((t) => !t.down).length;
    text += `${text ? ' · ' : ''}${up} TURRET${up === 1 ? '' : 'S'} UP`;
  }
  return text;
}

function tint(who, text) {
  const c = net.colors[who] || 'inherit';
  return `<span style="color:${c}">${text}</span>`;
}

function updateHud() {
  const g = game;
  setText('hud-time', formatTime(g.time));
  if (g.pvp) {
    setText('hud-lives-label', 'SHIELDS');
    setHtml('hud-lives', net.players.map((p) => tint(p.id, shieldPips(p.id))).join(' <span class="label">·</span> '));
    setText('hud-boss-label', 'MATCH');
    setHtml('hud-boss', `${net.players.map((p) => tint(p.id, esc(p.name).toUpperCase())).join(' <span class="label">VS</span> ')} · LAST ONE STANDING`);
    setText('hud-level', `ROUND ${net.round} · ${g.def.title.toUpperCase()}`);
  } else {
    setText('hud-lives-label', 'SHIELDS');
    setText('hud-boss-label', 'BOSS');
    setText('hud-lives', g.lives === Infinity ? '∞' : '◆'.repeat(Math.max(0, g.lives)) + '◇'.repeat(Math.max(0, g.maxLives - g.lives)));
    if (g.def.conduit) {
      setText('hud-boss-label', g.nodes.length ? 'NODES' : g.objective.turrets ? 'TURRETS' : 'DRONES');
      setText('hud-boss', objectiveText(g));
    } else if (g.coop) setText('hud-boss', `${g.def.bossName.toUpperCase()} ${'◆'.repeat(Math.max(0, g.bossHits))}${'◇'.repeat(Math.max(0, g.maxBossHits - g.bossHits))}`);
  }
  const mode = campaign ? campaign.mode : g.coop && net.coopCampaign ? net.coopMode : null;
  const tags = [g.coop ? `CO-OP · ${[net.names.host, ...net.roster.map((r) => r.name)].join(' & ').toUpperCase()}` : '', mode ? `${mode.toUpperCase()} CAMPAIGN` : '', g.difficulty ? g.difficulty.name.toUpperCase() : '', g.rules.ownBallLoss ? '' : 'SAFE OWN BALL', g.def.conduit ? 'HALF SPEED' : '', g.def.noGuide ? 'NO GUIDE' : ''].filter(Boolean);
  setText('hud-rule', tags.map((t) => `· ${t}`).join(' '));
  const s = g.ball.held && state !== 'cleared' ? 0 : g.ball.speed;
  setText('hud-speed', `${Math.round(s)} px/s`);
  $('hud-speed-bar').style.transform = `scaleX(${speedNorm(s).toFixed(3)})`;
  setText('hud-bpm', audio.currentBpm ? `♪ ${Math.round(audio.currentBpm)} BPM` : '♪');
  const health = `${Math.round(fps)} FPS${g.drops ? ` · ${g.drops} DROPPED` : ''}${renderer.low ? ` · LOW Q${autoLow && qualitySetting() === 'auto' ? ' (AUTO)' : ''}` : ''}`;
  const padTag = input.pad.connected ? ' · 🎮' : '';
  setText('hud-fps', (net.mode ? `${health} · ${Math.round(net.client.rtt)} MS` : health) + padTag);
  const me = localFighter(); // null while watching a versus match you were eliminated from
  const frozen = !!me && me.frozen > 0;
  const campLeft = me ? PLAYER.campSeconds - me.campTimer : Infinity;
  const camping = !!me && state === 'playing' && !g.tutorial && me.campTimer > 0 && campLeft <= PLAYER.campWarn;
  let status = frozen ? `FROZEN ${me.frozen.toFixed(1)}` : camping ? `MOVE · ${Math.max(0, campLeft).toFixed(1)}` : !me && g.pvp ? 'OUT · WATCHING' : '';
  const lost = g.lastLoss && state === 'countdown' && g.time - g.lastLoss.at < 4 ? g.lastLoss : null;
  if (lost && lost.slot === 'b') status = `BOSS HIT · ${g.bossHits} MORE TO GO`;
  else if (lost && lost.reason === 'swallow') status = 'THE WELL TOOK THE BALL';
  else if (lost) {
    const who = g.coop ? `${(fighterBySlot(lost.slot) || me || g.player).name.replace(/ \(you\)$/, '').toUpperCase()} ` : '';
    status = `${who}${lost.reason === 'camp' ? 'STOOD STILL' : lost.reason === 'touch' ? 'TOUCHED THE BOSS' : lost.reason === 'shot' ? 'SHOT' : lost.reason === 'well' ? 'FELL INTO THE WELL' : 'HIT'} · ${g.lives === Infinity ? 'UNLIMITED SHIELDS' : `${g.lives} SHIELD${g.lives === 1 ? '' : 'S'} LEFT`}`;
  }
  const last = g.pvp && state === 'roundEnd' && net.last ? net.last : null;
  if (last) {
    const how = last.reason === 'camp' ? 'STOOD STILL' : last.reason === 'own' ? 'OWN BALL' : last.reason === 'shot' ? 'SHOT BY A TURRET' : last.reason === 'well' ? 'FELL INTO THE WELL' : `HIT BY ${playerName(last.by)}`;
    const left = net.shields[last.id] || 0;
    status = `${playerName(last.id)} ${how} · ${last.out ? 'ELIMINATED' : `${left} SHIELD${left === 1 ? '' : 'S'} LEFT`}`.toUpperCase();
  }
  setText('hud-status', status);
  $('hud-status').style.color = last ? net.colors[last.id] : camping ? '#ff4d6d' : '';
  $('hud-status').classList.toggle('on', frozen || camping || !!lost || state === 'roundEnd' || (!me && g.pvp));
}

function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// --------------------------------------------------------------- overlays

function showOverlay(html) {
  const o = $('overlay');
  o.innerHTML = `<div class="panel">${html}</div>`;
  o.hidden = false;
}

function hideOverlay() {
  $('overlay').hidden = true;
  stopMarkAnimation();
}

// ------------------------------------------------------------------ lore

const CLEARED_KEY = 'deflector.cleared';

/** Ids of the levels this browser has cleared (the record's STOPPED residents). */
function clearedIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLEARED_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(Number) : []);
  } catch (_) {
    return new Set();
  }
}

function markCleared(id) {
  try {
    const ids = clearedIds();
    ids.add(id);
    localStorage.setItem(CLEARED_KEY, JSON.stringify([...ids].sort((a, b) => a - b)));
  } catch (_) {
    // storage unavailable; the record just will not remember
  }
}

/** The Record: the backstory told through the mark's four readings, then the resident dossier. */
function showRecord() {
  state = 'title';
  setInGame(false);
  stopMarkAnimation();
  $('hud').hidden = true;
  const done = clearedIds();
  const chapters = LORE.chapters
    .map((c) => `<section class="chapter"><div class="mark mark-sm" aria-label="${c.reading}">${markHtml(c.reading)}</div><p>${c.text}</p></section>`)
    .join('');
  const residents = ROSTER.map((r) => {
    const lvl = LEVELS.find((l) => l.id === r.id);
    const stopped = done.has(r.id);
    return `<li class="${stopped ? 'stopped' : 'active'}">
      <div class="res-head"><span class="res-num">${String(r.id).padStart(2, '0')}</span><b>${r.boss}</b><span class="muted">· ${r.title}</span><span class="res-status">${stopped ? LORE.status.stopped : LORE.status.active}</span></div>
      ${lvl && lvl.record ? `<p>${lvl.record}</p>` : ''}
    </li>`;
  }).join('');
  showOverlay(`
    <div class="eyebrow">THE RECORD</div>
    <h1>${LORE.title}</h1>
    <div class="record">
      ${chapters}
      <h3>${LORE.residentsHeading}</h3>
      <ol class="residents">${residents}</ol>
      <p class="small muted">${LORE.footer}</p>
    </div>
    <div class="row"><button id="btn-start" class="primary">Start</button><button id="btn-menu">Back</button></div>
  `);
  $('btn-start').onclick = begin;
  $('btn-menu').onclick = showTitle;
}

// --------------------------------------------------------------- settings

const OWN_BALL_KEY = 'deflector.ownBallLoss';
const DIFFICULTY_KEY = 'deflector.difficulty';

function difficultyById(id) {
  return DIFFICULTIES.find((d) => d.id === id) || null;
}

/** The chosen difficulty for new campaigns and single levels (default Normal). */
function difficultySetting() {
  try {
    return difficultyById(localStorage.getItem(DIFFICULTY_KEY)) || difficultyById(DEFAULT_DIFFICULTY);
  } catch (_) {
    return difficultyById(DEFAULT_DIFFICULTY);
  }
}

function setDifficultySetting(id) {
  try {
    localStorage.setItem(DIFFICULTY_KEY, id);
  } catch (_) {
    // storage unavailable; the choice lasts for this page load only
  }
}

function difficultySelectHtml() {
  const cur = difficultySetting().id;
  const opts = DIFFICULTIES.map((d) => `<option value="${d.id}" ${d.id === cur ? 'selected' : ''}>${d.name} · ${d.blurb}</option>`).join('');
  return `<div class="opt" title="A body hit or standing still costs a shield and the ball re-serves. In a campaign the shields last for all ten levels."><b>Difficulty</b><select id="opt-difficulty" class="sel">${opts}</select></div>`;
}

function bindDifficultySelect() {
  const el = $('opt-difficulty');
  if (el) el.onchange = () => setDifficultySetting(el.value);
}

const QUALITY_KEY = 'deflector.quality'; // 'auto' | 'high' | 'low'
let autoLow = false; // Auto quality has stepped down to low this session

function qualitySetting() {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    return q === 'high' || q === 'low' ? q : 'auto';
  } catch (_) {
    return 'auto';
  }
}

function setQualitySetting(q) {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch (_) {
    // storage unavailable; the choice lasts for this page load only
  }
  autoLow = false;
  applyQuality();
}

/** Point the renderer at the effective quality (the setting, or Auto's verdict) and rebuild the canvas if it changed. */
function applyQuality() {
  const q = qualitySetting();
  const low = q === 'low' || (q === 'auto' && autoLow);
  if (renderer.low === low) return;
  renderer.setQuality(low);
  renderer.resize();
}

function qualitySelectHtml() {
  const q = qualitySetting();
  const opt = (v, label) => `<option value="${v}" ${q === v ? 'selected' : ''}>${label}</option>`;
  return `<div class="opt" title="Auto steps down to Low if frames keep stuttering. Low halves the pixel density and turns off the glow."><b>Quality</b><select id="opt-quality" class="sel">${opt('auto', 'Auto')}${opt('high', 'High')}${opt('low', 'Low')}</select></div>`;
}

function bindQualitySelect() {
  const el = $('opt-quality');
  if (el) el.onchange = () => setQualitySetting(el.value);
}

/** Rule: can a fighter lose to a ball its own shield was the last to touch? Default on. */
function ownBallLoss() {
  try {
    return localStorage.getItem(OWN_BALL_KEY) !== 'off';
  } catch (_) {
    return true;
  }
}

function setOwnBallLoss(on) {
  try {
    localStorage.setItem(OWN_BALL_KEY, on ? 'on' : 'off');
  } catch (_) {
    // storage unavailable; the choice lasts for this page load only
  }
}

function ownBallToggleHtml() {
  return `<label class="opt" title="Off: a ball your own shield touched last just bounces off you. Bosses play by the same rule."><input type="checkbox" id="opt-ownball" ${ownBallLoss() ? 'checked' : ''} /><b>Lose to a ball you last hit</b></label>`;
}

function bindOwnBallToggle() {
  const el = $('opt-ownball');
  if (el) el.onchange = () => setOwnBallLoss(el.checked);
}

// --------------------------------------------------------------- tutorial

const TUTORIAL_KEY = 'deflector.tutorial';
const COARSE = window.matchMedia('(pointer: coarse)').matches;

function tutorialDone() {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === 'done';
  } catch (_) {
    return false;
  }
}

function markTutorialDone() {
  try {
    localStorage.setItem(TUTORIAL_KEY, 'done');
  } catch (_) {
    // storage unavailable; the tutorial will simply offer itself again
  }
}

const TUTORIAL_STEPS = [
  {
    title: 'Move and aim',
    text: COARSE
      ? 'Touch anywhere and <b>drag</b> to move. The <b>⟲ ⟳</b> buttons turn you and your shield. Move a little and turn around.'
      : '<b>Arrow keys</b> move you (or hold the mouse). <b>A</b> and <b>D</b> turn you and your shield. Move a little and turn all the way around.',
  },
  {
    title: 'Block',
    text: 'A ball is coming. Your shield is the flat bar in front of you: put it in the ball\'s way. The dotted line shows where the ball is heading.',
  },
  {
    title: 'Whack',
    text: COARSE
      ? 'A shield <b>moving toward the ball</b> adds its speed. Tap <b>WHACK</b> as the ball lands, or swing with ⟲ ⟳. Send it back at least <b>120 px/s faster</b> than it came.'
      : 'A shield <b>moving toward the ball</b> adds its speed. Press <b>W</b> to thrust as the ball lands, or swing with <b>A</b>/<b>D</b> so a tip meets it. Send it back at least <b>120 px/s faster</b> than it came.',
  },
  {
    title: 'Bank shot',
    text: 'The drone\'s shield blocks anything head-on, and every boss does the same. Bounce the ball off a <b>wall or a deflector</b> so it arrives at the drone\'s <b>side or back</b>. Only a hit on the body counts.',
  },
  {
    title: 'You are ready',
    text: 'One hit on a boss\'s body wins the level. One hit on you costs a shield, and how many you get is the difficulty. Watch the boss\'s shield, use the walls, and whack when it matters.',
  },
];

function startTutorial(fromButton, next = null) {
  const def = TUTORIAL_LEVEL;
  $('tutor').hidden = false;
  resetFrameWatch();
  game = buildGame(def);
  game.tutorial = { step: 0, fromButton, next, moved: 0, turned: 0, blocks: 0, bestDelta: 0, sinceTouch: 0, drone: false, lastX: def.player.x, lastY: def.player.y, lastAngle: def.player.angle };
  game.boss.name = 'Training drone';
  renderer.setLevel(def);
  renderer.resize();
  simTime = 0;
  acc = 0;
  endTimer = 0;
  state = 'playing';
  input.clearPresses();
  hideOverlay();
  setInGame(true);
  $('hud').hidden = false;
  $('countdown').hidden = true;
  $('hud-level').textContent = 'TUTORIAL · TRAINING HALL';
  $('hud-boss').textContent = 'TRAINING DRONE';
  $('hud-track').textContent = TRACKS[def.track].title;
  audio.playTrack(TRACKS[def.track]);
  $('tutor-skip').onclick = () => finishTutorial(true);
  $('tutor-next').onclick = () => finishTutorial(false);
  tutorialShowStep();
}

function tutorialShowStep() {
  const t = game.tutorial;
  const st = TUTORIAL_STEPS[t.step];
  $('tutor-step').textContent = t.step < 4 ? `LESSON ${t.step + 1} OF 4` : 'TUTORIAL COMPLETE';
  $('tutor-title').textContent = st.title;
  $('tutor-text').innerHTML = st.text;
  $('tutor-progress').textContent = '';
  $('tutor-next').hidden = t.step < 4;
  $('tutor-skip').hidden = t.step >= 4;
  if (t.step === 1 || t.step === 2 || t.step === 3) tutorialServe();
  if (t.step === 4) {
    game.ball.held = true;
    game.boss.hitFlash = 2;
  }
}

function tutorialAdvance() {
  const t = game.tutorial;
  t.step++;
  audio.sfxCount(true);
  game.fx.ring(game.player.x, game.player.y, '#ffffff', 120, 0.5);
  tutorialShowStep();
}

/** Serve a slow ball from the middle of the hall toward the player. */
function tutorialServe(note = '') {
  const def = TUTORIAL_LEVEL;
  const t = game.tutorial;
  if (!t || t.step === 0 || t.step >= 4) return;
  game.ball.launch(def.ball.x, def.ball.y, ((def.ball.angleDeg + rand(-8, 8)) * Math.PI) / 180, def.ball.speed);
  game.history.reset();
  t.sinceTouch = 0;
  if (note) $('tutor-progress').textContent = note;
}

function tutorialTick(dt) {
  const t = game.tutorial;
  const p = game.player;
  if (t.step === 0) {
    t.moved += Math.hypot(p.x - t.lastX, p.y - t.lastY);
    t.turned += Math.abs(p.omega) * dt;
    t.lastX = p.x;
    t.lastY = p.y;
    const m = Math.min(1, t.moved / 150);
    const r = Math.min(1, t.turned / Math.PI);
    setText('tutor-progress', `MOVED ${Math.round(m * 100)}% · TURNED ${Math.round(r * 100)}%`);
    if (m >= 1 && r >= 1) tutorialAdvance();
    return;
  }
  if (t.step >= 1 && t.step <= 3) {
    t.sinceTouch += dt;
    if (t.sinceTouch > 14) tutorialServe('Re-served: a new ball is coming.');
  }
  if (t.step === 3) setText('tutor-progress', `BEST SPEED-UP ${Math.round(t.bestDelta)} / 120 PX/S`);
}

function tutorialPaddle(before, after) {
  const t = game.tutorial;
  t.sinceTouch = 0;
  t.blocks++;
  const delta = after - before;
  if (t.step === 1) {
    setText('tutor-progress', 'BLOCKED');
    setTimeout(() => {
      if (game && game.tutorial && game.tutorial.step === 1) tutorialAdvance();
    }, 700);
  } else if (t.step === 2) {
    t.bestDelta = Math.max(t.bestDelta, delta);
    if (delta >= 120) {
      setText('tutor-progress', `+${Math.round(delta)} PX/S. THAT IS A WHACK.`);
      setTimeout(() => {
        if (game && game.tutorial && game.tutorial.step === 2) tutorialAdvance();
      }, 900);
    } else {
      setText('tutor-progress', `+${Math.round(Math.max(0, delta))} PX/S · BEST ${Math.round(t.bestDelta)} / 120. MOVE THE SHIELD INTO THE BALL.`);
    }
  } else if (t.step === 3) {
    setText('tutor-progress', 'BLOCKED. NOW SEND IT INTO A WALL OR DEFLECTOR FIRST.');
  }
}

/** Body contact in the tutorial: nobody loses, the drone is the target. */
function tutorialBody(f, h) {
  const t = game.tutorial;
  if (f.kind === 'boss') {
    if (t.step === 3) {
      hitFx(f, h.cx, h.cy, h.nx, h.ny);
      tutorialAdvance();
      return true;
    }
    return false; // in earlier lessons the drone's body is just a wall
  }
  // The ball got past the player's shield: no penalty, a fresh serve.
  if (t.step >= 1 && t.step <= 3) {
    game.fx.ring(f.x, f.y, '#ff4d6d', 100, 0.4);
    audio.sfxPlayerHit();
    setText('tutor-progress', 'IT GOT PAST YOUR SHIELD. IN A REAL LEVEL THAT LOSES. NEW BALL COMING.');
    t.sinceTouch = 12.5; // re-serve shortly
  }
  return false;
}

function finishTutorial(skipped) {
  const t = game && game.tutorial;
  const fromButton = t && t.fromButton;
  const next = (t && t.next) || (() => startLevel(0));
  markTutorialDone();
  $('tutor').hidden = true;
  if (fromButton) goToMenu();
  else next();
  if (skipped && !fromButton) audio.sfxCount(false);
}

// ------------------------------------------------------------ multiplayer

const VERSUS_SHIELDS = [1, 2, 3, 5]; // choices in the lobby
const DEFAULT_VERSUS_SHIELDS = 3;
const ZERO_INTENT = { mx: 0, my: 0, turn: 0, lunge: false, retract: false };
let lanInfo = null;
const net = {
  colors: { host: '', guest: '' }, // fixed for the whole match, whatever side each player is on
  rules: null,
  reason: null, // why the last round ended: 'hit' | 'camp'
  coop: false, // two humans against the boss (host owns the campaign and the rules)
  coopCampaign: false, // guest-side: the host is running a campaign
  coopMode: 'short', // guest-side: that campaign's mode
  // Guest-side prediction of its own character: every input carries a
  // sequence number, the host acknowledges the latest it acted on in each
  // snapshot, and the guest replays the inputs after that on top of the
  // host's state. `smooth` is the leftover visual offset after a correction,
  // eased out so corrections do not pop.
  seq: 0,
  remoteSeqs: {}, // host: latest input sequence acted on, per guest id
  inputs: [], // guest: [{ seq, dt, intent }] not yet acknowledged by the host
  roster: [], // guests in the room: [{ id, name }] (host: everyone who joined; guest: the others)
  smooth: { x: 0, y: 0 },
  client: null,
  mode: null, // null | 'host' | 'guest'
  localSlot: 'a',
  remoteIntents: {}, // host: latest intent per guest id
  events: [],
  round: 0,
  players: [], // versus seats in order: [{ id, name }] (the host is 'a', guests keep their relay ids)
  shields: {}, // versus: shields left per player id; 0 means eliminated
  maxShields: DEFAULT_VERSUS_SHIELDS,
  out: {}, // versus: player id -> the round they were eliminated in
  last: null, // versus: the latest loss, { id, reason: 'hit' | 'own' | 'camp' | 'shot' | 'well', by, out }
  names: { host: 'Host', guest: 'Guest' },
  levelIndex: 0, // versus: index into VERSUS_ARENAS; co-op: index into LEVELS
  winner: null,
  pending: null, // latest snapshot not yet applied (guest)
  snapAt: 0,
  ballBase: null,
  lastPing: 0,
  frame: 0,
};

function netReset() {
  if (net.client) {
    net.client.leave();
    net.client.close();
  }
  net.client = null;
  net.mode = null;
  net.coop = false;
  net.coopCampaign = false;
  net.remoteIntents = {};
  net.seq = 0;
  net.remoteSeqs = {};
  net.roster = [];
  net.inputs = [];
  net.smooth = { x: 0, y: 0 };
  net.events = [];
  net.round = 0;
  net.players = [];
  net.shields = {};
  net.out = {};
  net.last = null;
  net.pending = null;
  net.ballBase = null;
}

/** Everything versus can be played on: its own arenas first, then the campaign levels. */
const VERSUS_ARENAS = VERSUS_LEVELS.concat(LEVELS, VERSUS_CONDUITS);

function versusLevel(index) {
  return VERSUS_ARENAS[index] || VERSUS_ARENAS[0];
}

function playerName(id) {
  const p = net.players.find((q) => q.id === id);
  return p ? p.name : id;
}

/** Versus players still holding shields, in seating order. */
function survivors() {
  return net.players.filter((p) => (net.shields[p.id] || 0) > 0);
}

function shieldPips(id) {
  const left = net.shields[id] || 0;
  if (left <= 0) return 'OUT';
  return '◆'.repeat(left) + '◇'.repeat(Math.max(0, net.maxShields - left));
}

function versusShieldsSetting() {
  try {
    const v = Number(localStorage.getItem('deflector.versusShields'));
    return VERSUS_SHIELDS.includes(v) ? v : DEFAULT_VERSUS_SHIELDS;
  } catch (_) {
    return DEFAULT_VERSUS_SHIELDS;
  }
}

function esc(t) {
  return String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

function netEvent(ev) {
  if (net.mode === 'host') net.events.push(ev);
}

/** The fighter this device controls. */
function localFighter() {
  const g = game;
  if (!g) return null;
  if (g.pvp) return fighterBySlot(net.localSlot); // null once eliminated: this device only watches
  if (g.coop) return fighterBySlot(net.localSlot) || g.player;
  return g.player;
}

function fighterBySlot(slot) {
  const g = game;
  if (!g) return null;
  return (g.fighters || [g.player, g.boss]).find((f) => f.slot === slot) || null;
}

function savedName() {
  try {
    return localStorage.getItem('deflector.name') || '';
  } catch (_) {
    return '';
  }
}

function rememberName(name) {
  try {
    localStorage.setItem('deflector.name', name);
  } catch (_) {
    // storage unavailable; fine
  }
}

async function openLobby(prefillCode = '') {
  // Opened from a share link there has been no click yet, and browsers hold
  // audio until one: start it, but do not wait (the lobby's buttons retry).
  await Promise.race([audio.init(), new Promise((r) => setTimeout(r, 250))]);
  state = 'title';
  setInGame(false);
  stopMarkAnimation();
  $('hud').hidden = true;
  const online = lanInfo && lanInfo.online;
  // ?relay=local makes a friend's copy use this server even when it has an online relay configured
  const urls = lanInfo && !online ? lanInfo.addresses.map((a) => `http://${a}:${lanInfo.port}/?relay=local`) : [];
  const relay = relayConfig();
  showOverlay(`
    <div class="eyebrow">${online ? 'MULTIPLAYER · ONLINE' : 'MULTIPLAYER · SAME WI-FI'}</div>
    <h1>Up to three players, one room code</h1>
    <p class="small muted">${online ? `Both players open this page anywhere; the relay at <b>${relay.label}</b> connects you.` : `Both players open this page on the same network${urls.length ? `: <b>${urls.join('</b> or <b>')}</b>` : ''}.${urls.length ? ` A friend with the desktop app can instead enter <b>${lanInfo.addresses[0]}:${lanInfo.port}</b> under Relay below.` : ''}`} One hosts and gets a code, the others join with it. Versus is every player for themselves on its own arenas, last one standing; co-op is all of you against the boss.</p>
    <div class="row"><label class="mp-field">Your name <input id="mp-name" maxlength="16" value="${savedName().replace(/"/g, '')}" placeholder="Player" /></label></div>
    <div class="row">
      <button id="mp-host" class="primary">Host a match</button>
      <label class="mp-field">Code <input id="mp-code" maxlength="4" value="${prefillCode.replace(/[^A-Z0-9]/g, '')}" placeholder="XXXX" style="width:5em;text-transform:uppercase" /></label>
      <button id="mp-join">Join</button>
      <button id="btn-menu">Main menu</button>
    </div>
    <div id="mp-status" class="mp-status"></div>
    <details class="mp-adv"><summary>Relay</summary>
      <p class="small muted">For play over the internet, paste the address of a deployed relay (see the README); it is remembered in this browser. Enter <b>local</b> to use the server that serves this page instead (${IS_DESKTOP ? 'the app\'s built-in LAN server' : `LAN play with <code>npm start</code>`}), a friend's LAN address such as <b>192.168.1.20:27411</b> when they host from the desktop app, or leave it empty for the game's default.</p>
      <div class="row"><label class="mp-field">Relay <input id="mp-relay" maxlength="120" value="${relay ? relay.label.replace(/"/g, '') : ''}" placeholder="deflector-relay.example.workers.dev" style="width:20em" /></label><button id="mp-relay-set">Use</button></div>
    </details>
  `);
  if (lanInfo && lanInfo.unreachable) lobbyStatus(`<span class="small">The relay at <b>${lanInfo.unreachable}</b> did not answer, so this is same-network play through ${IS_DESKTOP ? 'the app\'s built-in server' : 'this page\'s server'}.</span>`);
  if (online && (lanInfo.v || 1) < RELAY_PROTOCOL) lobbyStatus(`<span class="mp-error">This relay is out of date (protocol ${lanInfo.v || 1}, the game needs ${RELAY_PROTOCOL}). Redeploy it: see "Online multiplayer" in the README.</span>`);
  $('btn-menu').onclick = goToMenu;
  $('mp-relay-set').onclick = async () => {
    saveRelay($('mp-relay').value);
    netReset();
    lanInfo = await NetClient.available();
    await openLobby();
    lobbyStatus(lanInfo ? `<span class="small">Relay: ${lanInfo.online ? `<b>${relayConfig().label}</b> · ${lanInfo.rooms} room${lanInfo.rooms === 1 ? '' : 's'} open` : 'this page\'s LAN server'}</span>` : '<span class="mp-error">That relay did not answer. Check the address (it needs /health to respond).</span>');
  };
  $('mp-host').onclick = () => hostRoom();
  $('mp-join').onclick = () => joinRoom($('mp-code').value);
  $('mp-code').onkeydown = (e) => {
    if (e.key === 'Enter') joinRoom($('mp-code').value);
  };
}

function lobbyStatus(html) {
  const el = $('mp-status');
  if (el) el.innerHTML = html;
}

function myName() {
  const el = $('mp-name');
  const name = ((el && el.value) || 'Player').trim().slice(0, 16) || 'Player';
  rememberName(name);
  return name;
}

async function connectClient() {
  if (net.client && net.client.connected) return net.client;
  const client = new NetClient();
  net.client = client;
  client.on('error', (m) => lobbyStatus(`<span class="mp-error">${m.msg}</span>`));
  client.on('peer-left', onPeerLeft);
  client.on('close', () => {
    if (net.mode) showNetNotice('Connection lost', 'The link to the other player dropped.');
  });
  client.on('setup', onSetup);
  client.on('result', onCoopResult);
  client.on('s', (msg) => {
    if (net.mode !== 'guest') return;
    if (msg.ev) for (const ev of msg.ev) playEvent(ev);
    net.pending = msg;
    net.snapAt = performance.now();
  });
  client.on('i', (msg) => {
    if (net.mode !== 'host') return;
    const id = msg.id || 'c';
    net.remoteIntents[id] = { mx: msg.mx, my: msg.my, turn: msg.turn, lunge: !!msg.lunge, retract: !!msg.retract };
    if (typeof msg.seq === 'number') net.remoteSeqs[id] = msg.seq;
  });
  await client.connect();
  return client;
}

async function hostRoom() {
  const name = myName();
  lobbyStatus('Connecting…');
  try {
    const client = await connectClient();
    client.on('created', (msg) => {
      net.names.host = name;
      const urls = lanInfo && lanInfo.online ? [`${location.origin}${location.pathname}?room=${msg.code}`] : lanInfo ? lanInfo.addresses.map((a) => `http://${a}:${lanInfo.port}/?relay=local&room=${msg.code}`) : [];
      lobbyStatus(`
        <div class="mp-code">${msg.code}</div>
        <p class="small">Share the code${urls.length ? `, or this link: <b>${urls.join('</b> / <b>')}</b>` : ''}.</p>
        <p class="small muted" id="mp-wait">Waiting for a friend to join…</p>
      `);
    });
    client.on('peer', (msg) => {
      if (net.mode) return; // a late joiner while a match runs: nothing to do until the lobby
      const id = msg.id || 'c';
      if (!net.roster.some((r) => r.id === id)) net.roster.push({ id, name: msg.name });
      renderHostLobby(client);
    });
    client.on('peer-left', (msg) => {
      if (net.mode) return onPeerLeft(msg); // a handler per type: in a match this is the match's notice
      net.roster = net.roster.filter((r) => r.id !== (msg && msg.id));
      renderHostLobby(client);
    });
    client.create(name);
  } catch (err) {
    lobbyStatus(`<span class="mp-error">${err.message}</span>`);
  }
}

/** Host: the lobby once at least one friend is in the room; re-rendered as people come and go. */
function renderHostLobby(client) {
  const coopOptions = SEQUENCE.map((l, i) => `<option value="${i}">${l.conduit ? `${shortId(l)} ${l.title}` : `${l.id}. ${l.title}`}</option>`).join('');
  const arenaOptions = `<optgroup label="Versus arenas">${VERSUS_LEVELS.map((l, i) => `<option value="${i}">${l.title}</option>`).join('')}</optgroup><optgroup label="Campaign levels">${LEVELS.map((l, i) => `<option value="${VERSUS_LEVELS.length + i}">${l.id}. ${l.title}</option>`).join('')}</optgroup><optgroup label="Conduits · hazards only, half speed">${VERSUS_CONDUITS.map((c, i) => `<option value="${VERSUS_LEVELS.length + LEVELS.length + i}">${shortId(c)} ${c.title}</option>`).join('')}</optgroup>`;
  const saved = loadCampaign();
  const diff = difficultySetting();
  if (!net.roster.length) {
    lobbyStatus(`
      <div class="mp-code">${client.code}</div>
      <p class="small muted" id="mp-wait">Waiting for a friend to join…</p>
    `);
    return;
  }
  const names = net.roster.map((r) => `<b>${esc(r.name)}</b>`).join(' and ');
  const many = net.roster.length > 1;
  const people = net.roster.length + 1;
  const prevMode = $('mp-mode') ? $('mp-mode').value : 'versus';
  {
      lobbyStatus(`
        <div class="mp-code">${client.code}</div>
        <p>${names} joined${net.roster.length < COOP.maxAllies ? ` · room for ${COOP.maxAllies - net.roster.length} more` : ' · the room is full'}.</p>
        <div class="row"><label class="mp-field">Mode <select id="mp-mode"><option value="versus">Versus · ${people} players, last one standing</option><option value="coop">Co-op · ${people} of you against the boss</option></select></label></div>
        <div class="row" id="mp-versus-opts"><label class="mp-field">Arena <select id="mp-level">${arenaOptions}</select></label><label class="mp-field">Shields each <select id="mp-shields">${VERSUS_SHIELDS.map((n) => `<option value="${n}" ${n === versusShieldsSetting() ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
        <p class="small muted" id="mp-versus-note">Every player for themselves. A body hit, an own ball or standing still costs that player a shield and resets everyone; with no shields left they are out. The last one standing wins.</p>
        <div class="row" id="mp-coop-opts" hidden>
          <label class="mp-field">Play <select id="mp-coop-play"><option value="level">One level</option><option value="campaign">New short campaign</option><option value="full">New full campaign (with conduits)</option>${saved ? `<option value="resume">Continue ${saved.mode} campaign · ${levelLabel(SEQUENCE[saved.levelIndex])}</option>` : ''}</select></label>
          <label class="mp-field">Level <select id="mp-coop-level">${coopOptions}</select></label>
        </div>
        <p class="small muted" id="mp-coop-note" hidden>Co-op shares one pool of shields (${diff.name}: ${diff.blurb}, set on the title screen) and the boss takes ${people * COOP.bossHitsPerHuman} hits.</p>
        <div class="row"><button id="mp-start" class="primary">Start match</button></div>
        <div class="row">${ownBallToggleHtml()}</div>
      `);
      bindOwnBallToggle();
      $('mp-mode').value = prevMode;
      const syncMode = () => {
        const coop = $('mp-mode').value === 'coop';
        $('mp-versus-opts').hidden = coop;
        $('mp-versus-note').hidden = coop;
        $('mp-coop-opts').hidden = !coop;
        $('mp-coop-note').hidden = !coop;
        $('mp-coop-level').parentElement.hidden = coop && $('mp-coop-play').value !== 'level';
      };
      $('mp-mode').onchange = syncMode;
      $('mp-coop-play').onchange = syncMode;
      syncMode();
      $('mp-start').onclick = () => {
        if ($('mp-mode').value !== 'coop') {
          const shields = Number($('mp-shields').value) || DEFAULT_VERSUS_SHIELDS;
          try {
            localStorage.setItem('deflector.versusShields', String(shields));
          } catch (_) {
            // storage unavailable: the choice lasts for this match
          }
          return startNetMatch(Number($('mp-level').value), shields);
        }
        const play = $('mp-coop-play').value;
        startCoop({ campaign: play !== 'level', resume: play === 'resume', mode: play === 'full' ? 'full' : 'short', levelIdx: Number($('mp-coop-level').value) });
      };
  }
}

async function joinRoom(code) {
  const name = myName();
  code = String(code || '').toUpperCase().trim();
  if (code.length !== 4) return lobbyStatus('<span class="mp-error">Enter the 4-letter room code.</span>');
  lobbyStatus('Connecting…');
  try {
    const client = await connectClient();
    const renderGuestLobby = () => {
      const others = client.peers.map((p) => `<b>${esc(p.name)}</b>`);
      lobbyStatus(`<div class="mp-code">${client.code}</div><p>Joined <b>${esc(net.names.host)}</b>'s room${others.length ? ` with ${others.join(' and ')}` : ''}. Waiting for ${esc(net.names.host)} to start…</p>`);
    };
    client.on('joined', (msg) => {
      net.names.guest = name;
      net.names.host = msg.peerName;
      renderGuestLobby();
    });
    client.on('peer', () => {
      if (!net.mode) renderGuestLobby();
    });
    client.on('peer-left', (msg) => {
      if (net.mode) return onPeerLeft(msg);
      if (msg && msg.id === 'a') lobbyStatus('<span class="mp-error">The host left the room.</span>');
      else renderGuestLobby();
    });
    client.join(code, name);
  } catch (err) {
    lobbyStatus(`<span class="mp-error">${err.message}</span>`);
  }
}

/** Host: begin a versus match on the chosen arena with everyone in the room. */
function startNetMatch(levelIdx, shields = net.maxShields) {
  net.mode = 'host';
  if (net.roster[0]) net.names.guest = net.roster[0].name;
  net.levelIndex = levelIdx;
  net.rules = { ownBallLoss: ownBallLoss() };
  net.round = 0;
  net.players = [{ id: 'a', name: net.names.host }].concat(net.roster.map((r) => ({ id: r.id, name: r.name })));
  net.maxShields = shields;
  net.shields = {};
  net.out = {};
  net.last = null;
  for (const p of net.players) net.shields[p.id] = shields;
  startNetRound();
}

/** Host: begin the next round (starting spots rotate each round). */
function startNetRound() {
  net.round++;
  net.localSlot = 'a';
  net.remoteIntents = {};
  net.events = [];
  net.client.send({ t: 'setup', level: net.levelIndex, round: net.round, shields: net.shields, max: net.maxShields, out: net.out, last: net.last, players: net.players, names: net.names, rules: net.rules });
  beginNetRound();
}

/** Guest: the host announced a round. */
function onSetup(msg) {
  net.mode = 'guest';
  if (msg.coop) {
    net.coop = true;
    net.coopCampaign = !!msg.campaign;
    net.coopMode = msg.mode || 'short';
    net.roster = Array.isArray(msg.roster) && msg.roster.length ? msg.roster : [{ id: 'c', name: msg.names.guest }];
    net.localSlot = net.client.id || 'c';
    net.levelIndex = msg.level;
    net.names = msg.names;
    net.rules = { ownBallLoss: !msg.rules || msg.rules.ownBallLoss !== false };
    net.pending = null;
    net.ballBase = null;
    campaign = null; // the host owns the campaign; this side mirrors it
    beginCoopLevel(difficultyById(msg.difficulty) || difficultySetting(), msg.shields);
    return;
  }
  net.levelIndex = msg.level;
  net.round = msg.round;
  net.names = msg.names;
  net.players = Array.isArray(msg.players) && msg.players.length ? msg.players : [{ id: 'a', name: msg.names.host }, { id: 'c', name: msg.names.guest }];
  net.maxShields = msg.max || DEFAULT_VERSUS_SHIELDS;
  net.shields = msg.shields || Object.fromEntries(net.players.map((p) => [p.id, net.maxShields]));
  net.out = msg.out || {};
  net.last = msg.last || null;
  net.rules = { ownBallLoss: !msg.rules || msg.rules.ownBallLoss !== false };
  net.localSlot = net.client.id || 'c';
  net.pending = null;
  net.ballBase = null;
  beginNetRound();
}

/** Both sides: build the arena for this round and start the countdown. */
function beginNetRound() {
  const def = versusLevel(net.levelIndex);
  const sameTrack = game && game.def === def && audio.track;
  const campaignIdx = LEVELS.indexOf(def);
  if (campaignIdx >= 0) levelIndex = campaignIdx;
  resetFrameWatch();
  // Seats are fixed for the match (the host is a, guests c and d, each with
  // one colour); eliminated players leave the arena and the survivors take
  // the spawn set for their number, rotating round by round.
  const alive = survivors();
  const n = alive.length;
  const colors = versusColors(def);
  net.colors = {};
  for (const p of net.players) net.colors[p.id] = colors[VERSUS_IDS.indexOf(p.id)] || colors[net.players.indexOf(p)];
  const seats = rotateSpawns(versusSpawns(def, n), net.round).map((sp, i) => ({ ...sp, id: alive[i].id, color: net.colors[alive[i].id] }));
  game = buildGame(def, n, net.rules, false, seats);
  for (const f of game.fighters) f.name = playerName(f.slot) + (net.localSlot === f.slot ? ' (you)' : '');
  game.local = localFighter();
  renderer.setLevel(def);
  renderer.resize();
  simTime = 0;
  acc = 0;
  countdown = COUNTDOWN_SECONDS;
  countdownTick = COUNTDOWN_SECONDS + 1;
  endTimer = 0;
  state = 'countdown';
  input.clearPresses();
  hideOverlay();
  setInGame(true);
  $('hud').hidden = false;
  $('countdown').hidden = true;
  $('hud-track').textContent = TRACKS[def.track].title;
  if (!sameTrack) audio.playTrack(TRACKS[def.track]);
}

// ---- co-op: two humans, one shield pool, the host's campaign

/** Host: start co-op from the lobby, on one level or on a (new or saved) campaign. */
function startCoop(opts) {
  net.mode = 'host';
  net.coop = true;
  net.localSlot = 'a';
  net.rules = { ownBallLoss: ownBallLoss() };
  net.round = 0;
  if (opts.campaign) {
    const saved = opts.resume ? loadCampaign() : null;
    const diff = saved ? difficultyById(saved.difficulty) : difficultySetting();
    campaign = saved ? { ...saved } : { difficulty: diff.id, shields: diff.shields, levelIndex: 0, time: 0, lost: 0, mode: opts.mode || 'short' };
    saveCampaign();
    coopStartLevel(campaign.levelIndex);
  } else {
    campaign = null;
    coopStartLevel(opts.levelIdx);
  }
}

/** Host: build a co-op level and tell the guest to build the same one. */
function coopStartLevel(index) {
  net.levelIndex = index;
  net.remoteIntents = {};
  net.events = [];
  if (net.roster[0]) net.names.guest = net.roster[0].name;
  const diff = campaign ? difficultyById(campaign.difficulty) : difficultySetting();
  const shields = campaign ? campaign.shields : diff.shields;
  net.client.send({ t: 'setup', coop: true, level: index, names: net.names, roster: net.roster, rules: net.rules, difficulty: diff.id, campaign: !!campaign, mode: campaign ? campaign.mode : null, shields: shields === Infinity ? 'inf' : shields });
  beginCoopLevel(diff, shields === Infinity ? 'inf' : shields);
}

/** Both sides: build the co-op arena (host human a, ally c, boss b) and start the countdown. */
function beginCoopLevel(diff, shields) {
  const def = SEQUENCE[net.levelIndex];
  const sameTrack = game && game.def === def && audio.track;
  levelIndex = net.levelIndex;
  resetFrameWatch();
  game = buildGame(def, false, net.rules, Math.max(1, net.roster.length));
  game.difficulty = diff;
  game.maxLives = diff.shields;
  game.lives = shields === 'inf' ? Infinity : Number(shields);
  game.player.name = net.names.host + (net.localSlot === 'a' ? ' (you)' : '');
  for (const f of game.allies) {
    const entry = net.roster.find((r) => r.id === f.slot);
    f.name = (entry ? entry.name : 'Ally') + (net.localSlot === f.slot ? ' (you)' : '');
  }
  net.colors = { host: def.palette.wall, guest: COOP.allyColors[0] };
  game.player.color = net.colors.host;
  game.local = localFighter();
  renderer.setLevel(def);
  renderer.resize();
  simTime = 0;
  acc = 0;
  countdown = COUNTDOWN_SECONDS;
  countdownTick = COUNTDOWN_SECONDS + 1;
  endTimer = 0;
  endShown = false;
  state = 'countdown';
  input.clearPresses();
  hideOverlay();
  setInGame(true);
  $('hud').hidden = false;
  $('countdown').hidden = true;
  $('hud-level').textContent = `${levelLabel(def).toUpperCase()} · ${def.title.toUpperCase()}`;
  $('hud-boss').textContent = def.bossName.toUpperCase();
  $('hud-track').textContent = TRACKS[def.track].title;
  if (!sameTrack) audio.playTrack(TRACKS[def.track]);
}

/** Host: mirror an end-of-level screen to the guest as plain text. */
function coopResult(kind, eyebrow, title, text, note = '') {
  if (net.mode === 'host' && net.coop && net.client) net.client.send({ t: 'result', kind, eyebrow, title, text, note });
}

/** Guest: the host reached an end-of-level screen; show it and wait for the host's choice. */
function onCoopResult(msg) {
  if (net.mode !== 'guest' || !net.coop) return;
  setInGame(false);
  const esc = (t) => String(t || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  showOverlay(`
    <div class="eyebrow">${esc(msg.eyebrow)}</div>
    <h1>${esc(msg.title)}</h1>
    <p class="muted">${esc(msg.text)}</p>
    ${msg.note ? `<p class="small muted record-note">${esc(msg.note)}</p>` : ''}
    <div class="row"><span class="small muted">Waiting for ${esc(net.names.host)} to choose what is next…</span><button id="btn-menu">Main menu</button></div>
  `);
  $('btn-menu').onclick = leaveMatch;
}

/** Host: a body was hit in versus; that player loses a shield. */
function onPvpHit(f, h) {
  hitFx(f, h.cx, h.cy, h.nx, h.ny);
  netEvent({ e: 'hit', s: f.slot, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
  const by = game.ball.lastTeam && game.ball.lastTeam !== f.team ? game.ball.lastTeam : null;
  pvpLoss(f, by ? 'hit' : 'own', by);
}

/**
 * Host: fighter `f` lost the round (a rival's ball, an own ball, standing
 * still): one shield gone, play stops and everyone is reseated. With no
 * shields left the player is out; the match ends when one remains.
 */
function pvpLoss(f, reason, by = null) {
  const g = game;
  net.shields[f.slot] = Math.max(0, (net.shields[f.slot] || 0) - 1);
  const out = net.shields[f.slot] === 0;
  if (out) net.out[f.slot] = net.round;
  net.last = { id: f.slot, reason, by, out };
  state = 'roundEnd';
  endTimer = 2.4;
  g.ball.held = true;
}

function hitFx(f, x, y, nx, ny) {
  const g = game;
  f.hitFlash = 3;
  g.fx.burst(x, y, nx, ny, 90, f.color, 500, Math.PI, 1.2);
  g.fx.burst(x, y, nx, ny, 40, '#ffffff', 300, Math.PI, 0.8);
  g.fx.ring(f.x, f.y, '#ffffff', 420, 0.9);
  g.fx.ring(f.x, f.y, f.color, 260, 0.6);
  g.fx.addShake(22);
  g.fx.flash = 1;
  audio.sfxBossHit();
}

/** Host: send the state of this frame to the guest. */
function hostSend() {
  net.frame++;
  const meta = { st: state, cd: countdown, sh: net.shields, ot: net.out, rd: net.round, ls: net.last, ak: net.remoteSeqs };
  if (net.coop) {
    meta.lv = game.lives === Infinity ? 'inf' : game.lives;
    meta.bh = game.bossHits;
    meta.ll = game.lastLoss ? [game.lastLoss.reason, game.lastLoss.slot, game.lastLoss.at] : null;
  }
  net.client.send(buildSnapshot(game, meta, net.events, net.frame % 4 === 0));
  net.events = [];
  pingMaybe();
}

/** Guest: send this frame's input to the host. */
function guestSend() {
  const f = localFighter();
  if (!f) return;
  const it = input.intent(f);
  net.seq++;
  net.client.send({ t: 'i', id: net.client.id || 'c', seq: net.seq, mx: +it.mx.toFixed(3), my: +it.my.toFixed(3), turn: it.turn, lunge: it.lunge ? 1 : 0, retract: it.retract ? 1 : 0 });
  pingMaybe();
}

function pingMaybe() {
  const now = performance.now();
  if (now - net.lastPing > 2000) {
    net.lastPing = now;
    net.client.ping();
  }
}

/** Guest: mirror the latest host snapshot, extrapolating the ball slightly. */
function guestApply(now) {
  const s = net.pending;
  if (s) {
    net.pending = null;
    const g = game;
    const wasState = state;
    const me = localFighter(); // null while watching after an elimination
    const leftBefore = me ? PLAYER.campSeconds - me.campTimer : 0;
    const predX = me ? me.x : 0;
    const predY = me ? me.y : 0;
    applySnapshot(g, s);
    for (const f of g.fighters) if (f !== me) f.markRender();
    if (me) guestReconcile(s.ak && typeof s.ak === 'object' ? s.ak[net.client.id || 'c'] : s.ak, predX, predY);
    if (me && state === 'playing') campTick(leftBefore, PLAYER.campSeconds - me.campTimer);
    net.ballBase = { x: g.ball.x, y: g.ball.y, vx: g.ball.vx, vy: g.ball.vy };
    if (s.sh) net.shields = s.sh;
    if (s.ot) net.out = s.ot;
    net.round = s.rd;
    net.last = s.ls || null;
    if (net.coop) {
      if (s.lv !== undefined) g.lives = s.lv === 'inf' ? Infinity : s.lv;
      if (s.bh !== undefined) g.bossHits = s.bh;
      g.lastLoss = s.ll ? { reason: s.ll[0], slot: s.ll[1], at: s.ll[2] } : null;
    }
    countdown = s.cd;
    state = s.st;
    if (state === 'countdown') {
      const tick = Math.ceil(countdown);
      if (tick > 0 && tick !== countdownTick) {
        countdownTick = tick;
        $('countdown').hidden = false;
        $('countdown').textContent = String(tick);
      }
    } else $('countdown').hidden = true;
    if (state === 'matchEnd' && wasState !== 'matchEnd') showNetMatchEnd();
    if (state === 'matchEnd' && wasState !== 'matchEnd') setInGame(false);
  }
  if (net.ballBase && state === 'playing') {
    const lag = Math.min((now - net.snapAt) / 1000, 0.06);
    game.ball.x = net.ballBase.x + net.ballBase.vx * lag;
    game.ball.y = net.ballBase.y + net.ballBase.vy * lag;
  }
  game.ball.markRender();
}

/** Guest: one physics step of its own character from its own input, remembered for reconciliation. */
function guestStep(dt) {
  const g = game;
  const me = localFighter();
  if (!me) return;
  let intent = input.intent(me);
  if (state === 'countdown') intent = { ...intent, mx: 0, my: 0, lunge: false };
  me.markRender();
  guestAdvance(me, dt, intent);
  net.inputs.push({ seq: net.seq, dt, intent });
  if (net.inputs.length > 480) net.inputs.splice(0, net.inputs.length - 480); // two seconds is plenty
  // Ease out the leftover from the last correction.
  const k = Math.exp(-dt / 0.08);
  net.smooth.x *= k;
  net.smooth.y *= k;
  if (Math.abs(net.smooth.x) < 0.05) net.smooth.x = 0;
  if (Math.abs(net.smooth.y) < 0.05) net.smooth.y = 0;
}

/** The part of a physics step that concerns one fighter and the static world. */
function guestAdvance(f, dt, intent) {
  const g = game;
  f.update(dt, intent);
  if (g.well && state === 'playing') wellDrag(g.well, f, dt);
  resolveCircleVsSegments(f, g.walls);
  pushOutOfMovers(f);
  f.finalizeStep(dt);
}

/**
 * Guest: the snapshot just put this character where the host has it, which
 * is where it was `ack` inputs ago. Replay the inputs the host has not yet
 * acted on so the character stays where the player expects it, and turn the
 * difference from the previous prediction into a visual offset that eases out.
 */
function guestReconcile(ack, predX, predY) {
  const me = localFighter();
  if (!me || typeof ack !== 'number') return;
  net.inputs = net.inputs.filter((p) => p.seq > ack);
  const frozenNow = me.frozen;
  for (const p of net.inputs) guestAdvance(me, p.dt, p.intent);
  me.frozen = frozenNow; // the host's word on freezes stands
  const ex = predX - me.x;
  const ey = predY - me.y;
  if (Math.hypot(ex, ey) < 40) {
    net.smooth.x += ex;
    net.smooth.y += ey;
  } else {
    net.smooth.x = 0; // a big correction (a hit, a teleport) just snaps
    net.smooth.y = 0;
  }
  me.markRender();
}

/** Guest: reproduce a host-side effect locally. */
function playEvent(ev) {
  const g = game;
  if (!g) return;
  switch (ev.e) {
    case 'wall':
      wallFx(ev.x, ev.y, ev.nx, ev.ny, ev.n, ev.c);
      break;
    case 'paddle': {
      const f = fighterBySlot(ev.s) || g.boss;
      paddleFx(f, ev.x, ev.y, ev.nx, ev.ny, ev.st, !!ev.d);
      if (ev.ice) audio.sfxIce();
      break;
    }
    case 'mover':
      moverFx(ev.k, ev.x, ev.y, ev.nx, ev.ny, ev.s, !!ev.d);
      break;
    case 'shatter':
      if (g.panes[ev.i]) shatterFx(g.panes[ev.i], ev.x, ev.y, ev.nx, ev.ny);
      break;
    case 'reglaze':
      if (g.panes[ev.i]) {
        const c = paneCentre(g.panes[ev.i]);
        g.fx.ring(c.x, c.y, g.panes[ev.i].color, 70, 0.5);
        audio.sfxReglaze();
      }
      break;
    case 'freeze':
      freezeFx(fighterBySlot(ev.s) || g.player);
      break;
    case 'whack':
      audio.sfxWhack();
      break;
    case 'count':
      audio.sfxCount(!!ev.f);
      break;
    case 'hit':
      hitFx(fighterBySlot(ev.s) || g.boss, ev.x, ev.y, ev.nx, ev.ny);
      break;
    case 'shield':
      playerHitFx(fighterBySlot(ev.s) || g.player, ev.x, ev.y, ev.nx, ev.ny);
      break;
    case 'body':
      bodyBounceFx(fighterBySlot(ev.s) || g.player, ev.x, ev.y, ev.nx, ev.ny);
      break;
    case 'camp':
      campFx(fighterBySlot(ev.s) || g.player);
      break;
    case 'vent': {
      const v = g.vents && g.vents[ev.i];
      if (v) ventFx(v);
      break;
    }
    case 'fire': {
      const t = g.turrets && g.turrets[ev.i];
      if (t) fireFx(t);
      break;
    }
    case 'turret': {
      const t = g.turrets && g.turrets[ev.i];
      if (t) {
        t.down = true;
        turretFx(t);
      }
      break;
    }
    case 'shotfx':
      shotFx(ev.x, ev.y);
      break;
    case 'pulse':
      audio.sfxPulse();
      g.fx.ring(ev.x, ev.y, g.def.palette.obstacle, 80, 0.3);
      break;
    case 'switch': {
      // The snapshot carries the door and switch states; this is just the flourish.
      const node = g.nodes && g.nodes[ev.i];
      if (node) {
        const color = g.def.palette.nodeLit || '#7dffc4';
        g.fx.ring(node.x, node.y, color, 90, 0.4);
        audio.sfxCount(true);
      }
      break;
    }
    case 'node': {
      const node = g.nodes && g.nodes[ev.i];
      if (node) {
        node.lit = true;
        nodeFx(node, { cx: ev.x, cy: ev.y, nx: ev.nx, ny: ev.ny });
      }
      break;
    }
    case 'touch':
      touchFx(fighterBySlot(ev.s) || g.player, ev.x, ev.y);
      break;
    case 'swallow':
      if (g.well) swallowFx();
      break;
    case 'fell':
      if (g.well) fellFx(fighterBySlot(ev.s) || g.player);
      break;
    default:
      break;
  }
}

function showNetMatchEnd() {
  setInGame(false);
  // Last one standing first, then the others by how long they lasted.
  const order = net.players.map((p) => p.id).sort((x, y) => (net.shields[y] || 0) - (net.shields[x] || 0) || (net.out[y] || 0) - (net.out[x] || 0));
  const winner = order[0];
  const you = winner === net.localSlot;
  const left = net.shields[winner] || 0;
  const fallen = order.slice(1).map((id) => `${tint(id, esc(playerName(id)))} out in round ${net.out[id] || net.round}`).join(' · ');
  showOverlay(`
    <div class="eyebrow">${you ? 'VICTORY' : 'DEFEAT'}</div>
    <h1>${tint(winner, esc(playerName(winner)))} is the last one standing</h1>
    <p class="muted">${left} shield${left === 1 ? '' : 's'} left${fallen ? ` · ${fallen}` : ''}</p>
    <p class="muted">${versusLevel(net.levelIndex).title} · ${net.round} rounds</p>
    <div class="row">
      ${net.mode === 'host' ? '<button id="btn-rematch" class="primary">Rematch</button>' : '<span class="small muted">Waiting for the host to start a rematch…</span>'}
      <button id="btn-menu">Main menu</button>
    </div>
  `);
  $('btn-menu').onclick = leaveMatch;
  if (net.mode === 'host') $('btn-rematch').onclick = () => startNetMatch(net.levelIndex);
}

function showNetNotice(title, text) {
  setInGame(false);
  showOverlay(`
    <h1>${title}</h1>
    <p class="muted">${text}</p>
    <div class="row"><button id="btn-menu" class="primary">Main menu</button></div>
  `);
  $('btn-menu').onclick = leaveMatch;
}

function onPeerLeft(msg) {
  if (!net.mode) return; // in the lobby the room handlers update the list
  const who = msg && msg.name ? msg.name : 'Your friend';
  showNetNotice(`${who} left`, msg && msg.id === 'a' ? 'The host disconnected, so the match is over.' : 'A player disconnected, so the match is over.');
}

function leaveMatch() {
  goToMenu();
}

// ---------------------------------------------------------- title mark

const PUNCT = new Set(['[', ']', '<', '>', '(', ')', '/']);

/** The mark as glyph spans. With a reading name, the glyphs of that reading (plus the shared ECTOR) come pre-lit and the rest dimmed. */
function markHtml(reading = null) {
  const r = reading && MARK_READINGS.find((m) => m.name === reading);
  const lit = r ? new Set([...r.lit, 14, 15, 16, 17, 18]) : null;
  return [...GAME_MARK]
    .map((ch, i) => `<span class="g ${PUNCT.has(ch) ? 'p' : 'l'}${lit ? (lit.has(i) ? ' lit' : ' dim') : ''}" data-i="${i}">${ch}</span>`)
    .join('');
}

let markTimer = null;

/**
 * Cycle the mark through its readings: the shared ECTOR stays lit while the
 * prefix letters flicker between REFLECTOR, DEFLECTOR, DEFECTOR and VECTOR,
 * returning to the full notation between passes.
 */
function startMarkAnimation() {
  stopMarkAnimation();
  const glyphs = [...document.querySelectorAll('.mark .g')];
  if (!glyphs.length) return;
  const tail = [14, 15, 16, 17, 18];
  const states = [null, ...MARK_READINGS, null];
  let step = 0;
  const apply = () => {
    const reading = states[step % states.length];
    const lit = reading ? new Set([...reading.lit, ...tail]) : null;
    for (const g of glyphs) {
      const i = Number(g.dataset.i);
      g.classList.toggle('full', !lit);
      g.classList.toggle('lit', !!lit && lit.has(i));
      g.classList.toggle('dim', !!lit && !lit.has(i));
    }
    step++;
  };
  apply();
  markTimer = setInterval(apply, 1500);
}

function stopMarkAnimation() {
  if (markTimer) clearInterval(markTimer);
  markTimer = null;
}

function showTitle() {
  state = 'title';
  setInGame(false);
  renderer.setLevel(SEQUENCE[levelIndex]);
  renderer.resize();
  $('hud').hidden = true;
  $('countdown').hidden = true;
  const def = SEQUENCE[levelIndex];
  const roster = SEQUENCE.map((r, idx) => {
    const cls = `${r.id === def.id ? 'now' : 'ready'}${r.conduit ? ' conduit' : ''}`;
    return `<li class="${cls}" data-level="${idx}" title="${r.conduit ? 'Conduit: half-speed aim test between levels' : ''}"><span>${shortId(r)}</span> ${r.title}</li>`;
  }).join('');
  showOverlay(`
    <h1 class="title mark" aria-label="${GAME_NAME}">${markHtml()}</h1>
    <p class="tagline">${GAME_TAGLINE}<span class="version" title="Version">v${GAME_VERSION}</span></p>
    <div class="top">
      <div>
        <div class="bulletin">
          <div class="eyebrow">${LORE.bulletin.eyebrow}</div>
          <p>${LORE.bulletin.text}</p>
          <p class="you"><span>${LORE.bulletin.you}</span><a id="btn-record" href="#record">${LORE.bulletin.link} ›</a></p>
        </div>
        <div class="level-card">
          <div class="eyebrow">${levelLabel(def).toUpperCase()}</div>
          <div class="level-title">${def.title}</div>
          <div class="muted">${def.conduit ? 'Aim test · half-speed ball' : `Boss: ${def.bossName}`}${clearedIds().has(def.id) ? ` · <span class="stopped">${def.conduit ? 'lit' : LORE.status.stopped.toLowerCase()}</span>` : ''}</div>
          <p class="intro">${def.intro}</p>
          ${def.record ? `<p class="record"><b>RECORD</b>${def.record}</p>` : ''}
        </div>
      </div>
      <div>
        <h3>Levels</h3>
        <ol class="roster">${roster}</ol>
      </div>
    </div>
    <div class="columns three">
      <div>
        <h3>Controls</h3>
        <ul class="controls">
          <li><b>Arrows</b>, <b>mouse</b> or <b>drag</b> — move</li>
          <li><b>A / D</b> — rotate (swing to whack)</li>
          <li><b>W</b> or <b>Space</b> — thrust the shield</li>
          <li><b>S</b> — pull the shield in (soft return)</li>
          <li><b>P</b> pause · <b>M</b> mute · <b>R</b> restart</li>
          <li><b>Controller</b>: left stick moves, right stick or <b>LT</b>/<b>RT</b> rotate, <b>A</b> thrusts, <b>X</b> pulls in, <b>Start</b> pauses <span id="pad-state" class="small muted">${input.pad.connected ? `· detected: ${input.pad.id.slice(0, 40)}` : '· none detected yet (press any button on it)'}</span></li>
        </ul>
      </div>
      <div>
        <h3>How to win</h3>
        <p class="small">The ball only counts when it hits a <b>body</b>. The boss's shield blocks its front: bank shots off walls and deflectors to hit its side or back. A hit on you costs a shield (the difficulty sets how many), and so does <b>standing still</b> within a body length for eight seconds or <b>touching the boss</b>, body or shield. A moving shield adds its speed to the ball; retreating removes it.</p>
      </div>
      <div>
        <h3>Rules</h3>
        ${difficultySelectHtml()}
        ${ownBallToggleHtml()}
        ${qualitySelectHtml()}
      </div>
    </div>
    <div class="row menu">${campaignButtonsHtml()}<button id="btn-start">${levelLabel(def)} only</button><button id="btn-tutorial">Tutorial</button><button id="btn-jukebox">Soundtrack</button><button id="btn-multi" title="${lanInfo && lanInfo.online ? 'Play online through the relay' : lanInfo ? 'Play on this Wi-Fi network' : 'Set a relay in the lobby, or run npm start on one PC and open its LAN address on both'}">${lanInfo && lanInfo.online ? 'Online match' : lanInfo ? 'LAN match' : 'Multiplayer'}</button>${fullscreenHint()}</div>
    ${lanInfo ? '' : IS_DESKTOP ? '<p class="small muted">Multiplayer is unavailable: neither the relay nor the app\'s own server answered.</p>' : '<p class="small muted">Multiplayer needs a relay: paste one in the lobby for online play, or run <code>npm start</code> on one PC and open its LAN address on both.</p>'}
  `);
  $('btn-start').onclick = begin;
  bindCampaignButtons();
  bindDifficultySelect();
  bindQualitySelect();
  $('btn-record').onclick = (e) => {
    e.preventDefault();
    showRecord();
  };
  bindOwnBallToggle();
  $('btn-tutorial').onclick = async () => {
    await audio.init();
    startTutorial(true);
  };
  $('btn-jukebox').onclick = openJukebox;
  $('btn-multi').onclick = () => openLobby();
  $('btn-full')?.addEventListener('click', toggleFullscreen);
  startMarkAnimation();
  for (const li of document.querySelectorAll('.roster li[data-level]')) {
    li.onclick = () => {
      levelIndex = Number(li.dataset.level);
      renderer.setLevel(SEQUENCE[levelIndex]);
      renderer.resize();
      showTitle();
    };
  }
}

async function begin() {
  await audio.init();
  campaign = null;
  if (!tutorialDone() && levelIndex === 0) startTutorial(false, () => startLevel(levelIndex));
  else startLevel(levelIndex);
}

// ---------------------------------------------------------------- campaign

// Campaign: the levels in order, on one shield pool. Progress is saved in the
// browser after every level and every lost shield, so it can be continued
// from the title screen.
const CAMPAIGN_KEY = 'deflector.campaign';
let campaign = null; // { difficulty, shields, levelIndex, time, lost } while a campaign is being played

function loadCampaign() {
  try {
    const c = JSON.parse(localStorage.getItem(CAMPAIGN_KEY) || 'null');
    if (!c || !difficultyById(c.difficulty)) return null;
    if (!c.mode) {
      // Saved before conduits existed: the index counted levels only.
      c.levelIndex = SEQUENCE.indexOf(LEVELS[c.levelIndex]);
      c.mode = 'short';
    }
    if (!SEQUENCE[c.levelIndex]) return null;
    return { ...c, shields: c.shields === 'inf' ? Infinity : Number(c.shields) };
  } catch (_) {
    return null;
  }
}

function saveCampaign() {
  if (!campaign) return;
  try {
    localStorage.setItem(CAMPAIGN_KEY, JSON.stringify({ ...campaign, shields: campaign.shields === Infinity ? 'inf' : campaign.shields }));
  } catch (_) {
    // storage unavailable; the campaign lasts for this page load only
  }
}

function clearCampaign() {
  try {
    localStorage.removeItem(CAMPAIGN_KEY);
  } catch (_) {
    // nothing to clear
  }
}

/**
 * Start (or, given a saved state, resume) a campaign; the tutorial runs first
 * for a first-time player. `mode` is 'short' (the ten levels) or 'full' (the
 * levels with the conduits between them).
 */
async function startCampaign(saved = null, mode = 'short') {
  await audio.init();
  const diff = saved ? difficultyById(saved.difficulty) : difficultySetting();
  campaign = saved ? { ...saved } : { difficulty: diff.id, shields: diff.shields, levelIndex: 0, time: 0, lost: 0, mode };
  saveCampaign();
  if (net.mode === 'host' && net.coop) return coopStartLevel(campaign.levelIndex);
  const go = () => startLevel(campaign.levelIndex);
  if (!tutorialDone()) startTutorial(false, go);
  else go();
}

function campaignButtonsHtml() {
  const saved = loadCampaign();
  const fresh = `<button id="btn-campaign" ${saved ? '' : 'class="primary"'} title="The ten levels in order">Short campaign</button><button id="btn-campaign-full" title="The ten levels with the nine conduits between them: half-speed aim tests">Full campaign</button>`;
  if (saved) {
    const lvl = SEQUENCE[saved.levelIndex];
    return `<button id="btn-continue" class="primary" title="Continue the saved ${saved.mode} campaign">Continue · ${levelLabel(lvl)}</button>${fresh}`;
  }
  return fresh;
}

function bindCampaignButtons() {
  const cont = $('btn-continue');
  if (cont) cont.onclick = () => startCampaign(loadCampaign());
  $('btn-campaign').onclick = () => startCampaign(null, 'short');
  $('btn-campaign-full').onclick = () => startCampaign(null, 'full');
}

/** The room after SEQUENCE[index]: the campaign's next stop, or simply the next room when playing alone. -1 at the end. */
function nextAfter(index) {
  if (campaign) return campaignNextIndex(index, campaign.mode);
  return index + 1 < SEQUENCE.length ? index + 1 : -1;
}

function showCampaignCleared(def, next, nextIdx, last) {
  campaign.time += game.time;
  const diff = difficultyById(campaign.difficulty);
  const shields = campaign.shields === Infinity ? 'unlimited' : `${campaign.shields} of ${diff.shields}`;
  if (last || nextIdx < 0) {
    clearCampaign();
    const done = { ...campaign };
    campaign = null;
    coopResult('campaign-complete', `${done.mode === 'full' ? 'FULL ' : ''}CAMPAIGN COMPLETE · ${diff.name.toUpperCase()}`, 'The arcade is yours', `${def.stopped || `${def.bossName} is down.`} Total time ${formatTime(done.time)}, shields lost ${done.lost}.`);
    showOverlay(`
      <div class="eyebrow">${done.mode === 'full' ? 'FULL ' : ''}CAMPAIGN COMPLETE · ${diff.name.toUpperCase()}</div>
      <h1>The arcade is yours</h1>
      <p class="muted">${def.stopped || `${def.bossName} is down.`}</p>
      <table class="stats">
        <tr><td>Difficulty</td><td>${diff.name}</td></tr>
        <tr><td>Total time</td><td>${formatTime(done.time)}</td></tr>
        <tr><td>Shields lost</td><td>${done.lost}</td></tr>
        <tr><td>Shields left</td><td>${shields}</td></tr>
      </table>
      <div class="row"><button id="btn-campaign" class="primary">New campaign</button><button id="btn-menu">Main menu</button></div>
    `);
    $('btn-campaign').onclick = () => startCampaign(null, done.mode || 'short');
    $('btn-menu').onclick = goToMenu;
    return;
  }
  campaign.levelIndex = nextIdx;
  saveCampaign();
  coopResult('campaign-cleared', clearedEyebrow(def), def.title, `${def.stopped || `${def.bossName} is down.`} Shields: ${shields}.`);
  showOverlay(`
    <div class="eyebrow">${clearedEyebrow(def)}</div>
    <h1>${def.title}</h1>
    <p class="muted">${def.stopped || `${def.bossName} is down.`}</p>
    <table class="stats">
      <tr><td>Time</td><td>${formatTime(game.time)}</td></tr>
      <tr><td>Top ball speed</td><td>${Math.round(game.topSpeed)} px/s</td></tr>
      <tr><td>Shields</td><td>${shields}</td></tr>
    </table>
    <div class="row"><button id="btn-next" class="primary">Continue · ${levelLabel(next)} · ${next.title}</button><button id="btn-menu">Main menu</button></div>
    <p class="small muted">Your campaign is saved; Main menu keeps it for later.</p>
  `);
  $('btn-next').onclick = () => startLevel(nextIdx);
  $('btn-menu').onclick = goToMenu;
}

function showCampaignOver(def) {
  const diff = difficultyById(campaign.difficulty);
  const reached = { ...campaign, time: campaign.time + game.time };
  clearCampaign();
  campaign = null;
  coopResult('campaign-over', 'CAMPAIGN OVER · NO SHIELDS LEFT', `${def.bossName} holds ${def.title}`, `You reached ${levelLabel(def).toLowerCase()} on ${diff.name} in ${formatTime(reached.time)}.`, LORE.failed(def.title));
  showOverlay(`
    <div class="eyebrow">CAMPAIGN OVER · NO SHIELDS LEFT</div>
    <h1>${def.bossName} holds ${def.title}</h1>
    <p class="muted">${game.lossReason === 'camp' ? `You stayed within a body length of one spot for ${PLAYER.campSeconds} seconds, and that cost the last shield.` : game.lossReason === 'touch' ? 'You touched the boss, and that cost the last shield.' : `That was the last of your ${diff.shields === Infinity ? '' : diff.shields + ' '}shields.`} You reached ${levelLabel(def).toLowerCase()} on ${diff.name} in ${formatTime(reached.time)}.</p>
    <p class="small muted record-note">${LORE.failed(def.title)}</p>
    <div class="row"><button id="btn-campaign" class="primary">Restart campaign</button><button id="btn-menu">Main menu</button></div>
  `);
  $('btn-campaign').onclick = () => startCampaign(null, reached.mode || 'short');
  $('btn-menu').onclick = goToMenu;
}

/** "LEVEL 3 CLEARED · THE SUMP STOPPED", or for a conduit "CONDUIT 3½ LIT". */
function clearedEyebrow(def) {
  return def.conduit ? `${levelLabel(def).toUpperCase()} LIT` : `${levelLabel(def).toUpperCase()} CLEARED · ${def.bossName.toUpperCase()} ${LORE.status.stopped}`;
}

function showCleared() {
  setInGame(false);
  const def = game.def;
  markCleared(def.id);
  const nextIdx = nextAfter(levelIndex);
  const next = nextIdx >= 0 ? SEQUENCE[nextIdx] : null;
  const last = !next;
  if (campaign) return showCampaignCleared(def, next, nextIdx, last);
  coopResult('cleared', last ? 'EVERY LEVEL CLEARED' : clearedEyebrow(def), last ? 'The arcade is yours' : def.title, def.stopped || `${def.bossName} is down.`);
  showOverlay(`
    <div class="eyebrow">${last ? 'EVERY LEVEL CLEARED' : clearedEyebrow(def)}</div>
    <h1>${last ? 'The arcade is yours' : def.title}</h1>
    <p class="muted">${def.stopped || `${def.bossName} is down.`}</p>
    <table class="stats">
      <tr><td>Time</td><td>${formatTime(game.time)}</td></tr>
      <tr><td>Top ball speed</td><td>${Math.round(game.topSpeed)} px/s</td></tr>
      <tr><td>Shield hits</td><td>${game.paddleHits}</td></tr>
    </table>
    <div class="row">
      <button id="btn-replay" class="primary">Play again</button>
      ${next ? `<button id="btn-next" class="primary">${levelLabel(next)} · ${next.title}</button>` : ''}
      <button id="btn-menu">Main menu</button>
    </div>
  `);
  $('btn-replay').onclick = () => startLevel(levelIndex);
  if (nextIdx >= 0) $('btn-next').onclick = () => startLevel(nextIdx);
  $('btn-menu').onclick = goToMenu;
}

/** The words for how a level was lost: the overlay's eyebrow and its explanation. */
function failWords() {
  const r = game.lossReason;
  if (r === 'camp') return { eyebrow: 'STOOD STILL', text: `You stayed within a body length of one spot for ${PLAYER.campSeconds} seconds. The grid does not allow hiding.` };
  if (r === 'touch') return { eyebrow: 'CONTACT', text: 'You touched the boss. Contact with its body or shield costs a shield; keep your distance and let the ball do the work.' };
  if (r === 'well') return { eyebrow: 'PULLED IN', text: 'The well took you. Inside the dotted ring everything drifts toward it, faster the closer you get; past the horizon nothing comes back.' };
  return { eyebrow: 'SHIELD DOWN', text: game.maxLives === 1 ? 'One hit is all it takes.' : `That was your last of ${game.maxLives} shields.` };
}

function showFailed() {
  setInGame(false);
  const def = game.def;
  if (campaign) return showCampaignOver(def);
  const words = failWords();
  coopResult('failed', words.eyebrow, `${def.bossName} holds ${def.title}`, `That was the last shield. You lasted ${formatTime(game.time)}.`, LORE.failed(def.title));
  showOverlay(`
    <div class="eyebrow">${words.eyebrow}</div>
    <h1>${def.bossName} holds ${def.title}</h1>
    <p class="muted">${words.text} You lasted ${formatTime(game.time)}.</p>
    <p class="small muted record-note">${LORE.failed(def.title)}</p>
    <div class="row"><button id="btn-retry" class="primary">Retry</button><button id="btn-menu">Main menu</button></div>
  `);
  $('btn-retry').onclick = () => startLevel(levelIndex);
  $('btn-menu').onclick = goToMenu;
}

// ------------------------------------------------------------------ boot

window.addEventListener('resize', () => renderer.resize());
$('hud-full').hidden = !canFullscreen();
$('hud-full').addEventListener('click', toggleFullscreen);
document.title = `${GAME_NAME} — ${GAME_TAGLINE}`;
for (const [id, name] of [['tb-left', 'left'], ['tb-right', 'right'], ['tb-whack', 'whack'], ['tb-retract', 'retract']]) {
  input.bindTouchButton($(id), name);
}
renderer.setLevel(SEQUENCE[levelIndex]);
applyQuality();
renderer.resize();
showTitle();
requestAnimationFrame(frame);
NetClient.available().then((info) => {
  lanInfo = info;
  if (state === 'title') showTitle();
  const code = new URLSearchParams(location.search).get('room');
  if (code) openLobby(code.toUpperCase());
});

// Expose for debugging / automated smoke tests.
window.__game = { get state() { return state; }, get game() { return game; }, get net() { return net; }, audio, renderer, input, startLevel };
