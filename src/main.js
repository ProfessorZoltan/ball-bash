// Game bootstrap: state machine, fixed-step physics loop, collision dispatch,
// HUD/overlay wiring. Everything heavy lives in the modules it imports.
import { GAME_MARK, GAME_NAME, GAME_TAGLINE, MARK_READINGS, PHYSICS_DT, BALL, PLAYER, SURFACE_VELOCITY_FACTOR, COUNTDOWN_SECONDS } from './config.js';
import { BallHistory, bossIntent, moverSegmentsAt } from './ai.js';
import { LEVELS, ROSTER } from './levels.js';
import { createGameState, rebuildWalls as rebuildWallsState } from './gamestate.js';
import { NetClient } from './net.js';
import { buildSnapshot, applySnapshot } from './netstate.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Effects } from './fx.js';
import { AudioEngine } from './audio/engine.js';
import { TRACKS } from './audio/tracks.js';
import { circleVsCircle, circleVsCapsule, pointInPolygon, resolveCircleVsSegments, predictPath } from './physics.js';
import { advanceBall, separateFightersFromBall } from './sim.js';
import { clamp, rand } from './vec.js';

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

function buildGame(def, pvp = false) {
  const g = createGameState(def, { pvp });
  return {
    ...g,
    fx: new Effects(),
    history: new BallHistory(),
    lives: PLAYER.lives,
    time: 0,
    topSpeed: 0,
    paddleHits: 0,
    guidePath: null,
  };
}

function startLevel(index) {
  levelIndex = index;
  const def = LEVELS[index];
  game = buildGame(def);
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
  $('hud-level').textContent = `LEVEL ${def.id} · ${def.title.toUpperCase()}`;
  $('hud-boss').textContent = def.bossName.toUpperCase();
  $('hud-track').textContent = TRACKS[def.track].title;
  audio.playTrack(TRACKS[def.track]);
}

function launchBall() {
  const def = game.def;
  const a = ((def.ball.angleDeg + rand(-14, 14)) * Math.PI) / 180;
  game.ball.launch(def.ball.x, def.ball.y, a, def.ball.speed);
  game.history.reset();
  game.history.push(simTime, game.ball);
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

  for (const m of g.movers) m.update(dt);

  // Intents. Slot a is the left spawn (g.player), slot b the right (g.boss).
  // Single player: a = you, b = the AI. PvP: whichever slot is yours gets
  // your input and the other gets the remote player's latest intent.
  const local = input.intent(localFighter());
  let ia;
  let ib;
  if (g.pvp) {
    const remote = net.remoteIntent || ZERO_INTENT;
    ia = net.localSlot === 'a' ? local : remote;
    ib = net.localSlot === 'a' ? remote : local;
  } else {
    ia = local;
    ib = state === 'playing' ? bossIntent(g.boss, g.history, g.player, g.walls, dt, simTime, g.movers) : ZERO_INTENT;
  }
  // Movement is locked until the ball launches; aiming is allowed.
  if (state === 'countdown') {
    ia = { ...ia, mx: 0, my: 0, lunge: false };
    ib = { ...ib, mx: 0, my: 0, lunge: false };
  }

  const wasIdle = g.player.lungeState === 'idle';
  g.player.update(dt, ia);
  if (wasIdle && g.player.lungeState === 'out') onWhack();
  resolveCircleVsSegments(g.player, g.walls);
  pushOutOfMovers(g.player);

  // Slot b: the AI boss (with its patrol and abilities) or the rival human.
  if (!g.pvp && state === 'playing') {
    g.boss.updateOrbit(dt);
    if (g.boss.pulser) {
      g.boss.pulser.update(dt, g.boss.x, g.boss.y);
      if (g.boss.pulser.emitted) {
        audio.sfxPulse();
        g.fx.ring(g.boss.x, g.boss.y, g.def.palette.obstacle, 80, 0.3);
      }
    }
  }
  const bossWasIdle = g.boss.lungeState === 'idle';
  g.boss.update(dt, ib);
  if (bossWasIdle && g.boss.lungeState === 'out') onWhack();
  resolveCircleVsSegments(g.boss, g.walls);
  pushOutOfMovers(g.boss);

  separateCircles(g.player, g.boss);
  g.player.finalizeStep(dt);
  g.boss.finalizeStep(dt);

  if (!g.ball.held) {
    moveBall(dt);
    if (state === 'playing') {
      separateFightersFromBall(g.ball, [g.player, g.boss]);
      g.history.push(simTime, g.ball);
    }
  }

  if (g.ice) {
    g.ice.update(simTime, g.ball);
    if (g.ice.affect(g.player, 'a')) onPlayerFrozen(g.player);
    if (g.pvp && g.ice.affect(g.boss, 'b')) onPlayerFrozen(g.boss);
  }

  if (g.panes.length) updateGlass();
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
    const blocked = [g.ball, g.player, g.boss].some((c) =>
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
  netEvent({ e: 'freeze', s: f === game.player ? 'a' : 'b' });
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
  const stopped = advanceBall(
    b,
    g.walls,
    [g.player, g.boss],
    dt,
    SURFACE_VELOCITY_FACTOR,
    {
      onWall: onWallBounce,
      onPaddle: onPaddleHit,
      onMover: onMoverHit,
      onBody: (f, h) => {
        if (g.pvp) {
          onPvpHit(f, h);
          return true;
        }
        if (f.kind === 'boss') {
          onBossHit(h);
          return true;
        }
        onPlayerHit(h);
        return false;
      },
    },
    g.boss.pulser ? g.movers.concat([g.boss.pulser]) : g.movers,
  );
  if (stopped) return;

  b.clampSpeed(BALL.minSpeed, BALL.maxSpeed);
  if (b.speed > g.topSpeed) g.topSpeed = b.speed;

  // Safety net: the arena is sealed, but if numerical trouble ever pushed the
  // ball through a wall, put it back in play rather than losing it.
  if (!pointInPolygon(b.x, b.y, g.def.boundary)) respawnBall();
}

function speedNorm(s) {
  return clamp((s - BALL.minSpeed) / (BALL.maxSpeed - BALL.minSpeed), 0, 1);
}

function onWallBounce(h, seg, before) {
  const g = game;
  if (seg.kind === 'glass' && before && !seg.pane.broken) {
    const speed = Math.hypot(before.vx, before.vy);
    if (speed >= g.def.glass.breakSpeed) {
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

function onMoverHit(m, h, before) {
  const g = game;
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
  if (!isBoss) g.paddleHits++;
  // The ice trail follows the boss's blocks; in PvP, either player's.
  let iced = 0;
  if (g.ice && (isBoss || g.pvp)) {
    g.ice.start(simTime, isBoss ? 'b' : 'a');
    audio.sfxIce();
    iced = 1;
  }
  netEvent({ e: 'paddle', s: isBoss ? 'b' : 'a', x: h.cx, y: h.cy, nx: h.nx, ny: h.ny, st: strength, d: delta > 100 ? 1 : 0, ice: iced });
  guideFrame = 0;
}

function paddleFx(f, x, y, nx, ny, strength, big) {
  const g = game;
  audio.sfxPaddle(strength, f.kind === 'boss');
  g.fx.burst(x, y, nx, ny, 8 + Math.floor(strength * 16), f.color, 200 + 400 * strength, 0.9, 0.45);
  if (big) {
    g.fx.addShake(3 + strength * 7);
    g.fx.ring(x, y, f.color, 60 + 120 * strength, 0.4);
  }
}

function onBossHit(h) {
  const g = game;
  state = 'cleared';
  g.ball.held = true;
  g.boss.hitFlash = 5;
  g.fx.burst(h.cx, h.cy, h.nx, h.ny, 90, g.def.palette.obstacle, 500, Math.PI, 1.2);
  g.fx.burst(h.cx, h.cy, h.nx, h.ny, 40, '#ffffff', 300, Math.PI, 0.8);
  g.fx.ring(g.boss.x, g.boss.y, '#ffffff', 420, 0.9);
  g.fx.ring(g.boss.x, g.boss.y, g.def.palette.obstacle, 260, 0.6);
  g.fx.addShake(22);
  g.fx.flash = 1;
  audio.sfxBossHit();
  audio.stopTrack(2.5);
  endTimer = 1.6;
}

function onPlayerHit(h) {
  const g = game;
  const p = g.player;
  if (p.invuln > 0) return;
  g.lives--;
  p.invuln = PLAYER.invulnTime;
  p.hitFlash = 0.3;
  g.fx.burst(h.cx, h.cy, h.nx, h.ny, 30, '#ff4d6d', 320, 1.6, 0.6);
  g.fx.ring(p.x, p.y, '#ff4d6d', 140, 0.5);
  g.fx.addShake(12);
  audio.sfxPlayerHit();
  if (g.lives <= 0) {
    state = 'failed';
    g.ball.held = true;
    audio.stopTrack(1.5);
    endTimer = 1.2;
  }
}

// ----------------------------------------------------------------- frames

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;

  if (game && state !== 'title' && state !== 'paused') {
    const guest = net.mode === 'guest';
    if (guest) guestApply(now);
    acc += dt;
    const simulate = !guest && (state === 'countdown' || state === 'playing');
    while (acc >= PHYSICS_DT) {
      if (simulate) step(PHYSICS_DT);
      acc -= PHYSICS_DT;
    }
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
    if (state === 'roundEnd' && net.mode === 'host') {
      endTimer -= dt;
      if (endTimer <= 0) {
        if (net.scores.host >= WIN_SCORE || net.scores.guest >= WIN_SCORE) {
          state = 'matchEnd';
          showNetMatchEnd();
        } else startNetRound();
      }
    }
    if (state === 'playing') {
      game.ball.pushTrail(BALL.trailLength);
      audio.setBallSpeed(game.ball.speed, game.def.ball.speed, BALL.minSpeed, BALL.maxSpeed);
      if (guideFrame-- <= 0) {
        guideFrame = 6;
        const seeThrough = game.def.glass && game.ball.speed >= game.def.glass.breakSpeed;
        let guideWalls = seeThrough ? game.walls.filter((w) => w.kind !== 'glass') : game.walls;
        if (game.movers.length) {
          guideWalls = guideWalls.concat(moverSegmentsAt(game.movers, game.ball.x, game.ball.y, game.ball.vx, game.ball.vy));
        }
        game.guidePath = predictPath(game.ball.x, game.ball.y, game.ball.vx, game.ball.vy, guideWalls, 1, 900, game.ball.r);
      }
    }
    if ((state === 'cleared' || state === 'failed') && !endShown) {
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
    renderer.draw(game, state, now / 1000, input.joystick);
  }
  handleGlobalKeys();
  requestAnimationFrame(frame);
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
  if (input.consumePress('r') && game && state !== 'title' && !net.mode) startLevel(levelIndex);
  if (input.consumePress('f')) toggleFullscreen();
  if (input.consumePress('Enter') && !net.mode) {
    if (state === 'title') begin();
    else if (state === 'cleared') {
      const nextIdx = LEVELS.findIndex((l) => l.id === game.def.id + 1);
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
  game = null;
  showTitle();
}

/** Touch controls are only shown while a level is actually being played. */
function setInGame(on) {
  document.body.classList.toggle('in-game', on);
}

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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
  if (canFullscreen()) return '<button id="btn-full">Fullscreen [F]</button>';
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

function updateHud() {
  const g = game;
  setText('hud-time', formatTime(g.time));
  if (g.pvp) {
    setText('hud-lives-label', 'SCORE');
    setText('hud-lives', `${net.scores.host} – ${net.scores.guest}`);
    setText('hud-boss-label', 'MATCH');
    setText('hud-boss', `${net.names.host} vs ${net.names.guest} · first to ${WIN_SCORE}`.toUpperCase());
    setText('hud-level', `ROUND ${net.round} · ${g.def.title.toUpperCase()}`);
  } else {
    setText('hud-lives-label', 'SHIELD');
    setText('hud-boss-label', 'BOSS');
    setText('hud-lives', '◆'.repeat(Math.max(0, g.lives)) + '◇'.repeat(Math.max(0, PLAYER.lives - g.lives)));
  }
  const s = g.ball.held && state !== 'cleared' ? 0 : g.ball.speed;
  setText('hud-speed', `${Math.round(s)} px/s`);
  $('hud-speed-bar').style.width = `${speedNorm(s) * 100}%`;
  setText('hud-bpm', audio.currentBpm ? `♪ ${Math.round(audio.currentBpm)} BPM` : '♪');
  setText('hud-fps', net.mode ? `${Math.round(fps)} FPS · ${Math.round(net.client.rtt)} MS` : `${Math.round(fps)} FPS`);
  const me = localFighter();
  const frozen = me.frozen > 0;
  let status = frozen ? `FROZEN ${me.frozen.toFixed(1)}` : '';
  if (g.pvp && state === 'roundEnd' && net.winner) status = `POINT · ${net.names[net.winner]}`.toUpperCase();
  setText('hud-status', status);
  $('hud-status').classList.toggle('on', frozen || state === 'roundEnd');
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

// ------------------------------------------------------------ multiplayer

const WIN_SCORE = 3;
const ZERO_INTENT = { mx: 0, my: 0, turn: 0, lunge: false, retract: false };
let lanInfo = null;
const net = {
  client: null,
  mode: null, // null | 'host' | 'guest'
  localSlot: 'a',
  remoteIntent: null,
  events: [],
  round: 0,
  scores: { host: 0, guest: 0 },
  names: { host: 'Host', guest: 'Guest' },
  levelIndex: 0,
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
  net.remoteIntent = null;
  net.events = [];
  net.round = 0;
  net.scores = { host: 0, guest: 0 };
  net.winner = null;
  net.pending = null;
  net.ballBase = null;
}

function netEvent(ev) {
  if (net.mode === 'host') net.events.push(ev);
}

/** The fighter this device controls. */
function localFighter() {
  const g = game;
  if (!g) return null;
  return g.pvp && net.localSlot === 'b' ? g.boss : g.player;
}

/** Which player ('host' | 'guest') owns a slot this round. Sides swap each round. */
function slotOwner(slot) {
  const hostSlot = net.round % 2 === 1 ? 'a' : 'b';
  return slot === hostSlot ? 'host' : 'guest';
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
  await audio.init();
  state = 'title';
  setInGame(false);
  stopMarkAnimation();
  $('hud').hidden = true;
  const urls = lanInfo ? lanInfo.addresses.map((a) => `http://${a}:${lanInfo.port}/`) : [];
  showOverlay(`
    <div class="eyebrow">MULTIPLAYER · SAME WI-FI</div>
    <h1>Two friends, one room code</h1>
    <p class="small muted">Both players open this page on the same network${urls.length ? `: <b>${urls.join('</b> or <b>')}</b>` : ''}. One hosts and gets a code, the other joins with it. First to ${WIN_SCORE} points; sides swap every round.</p>
    <div class="row"><label class="mp-field">Your name <input id="mp-name" maxlength="16" value="${savedName().replace(/"/g, '')}" placeholder="Player" /></label></div>
    <div class="row">
      <button id="mp-host" class="primary">Host a match</button>
      <label class="mp-field">Code <input id="mp-code" maxlength="4" value="${prefillCode.replace(/[^A-Z0-9]/g, '')}" placeholder="XXXX" style="width:5em;text-transform:uppercase" /></label>
      <button id="mp-join">Join</button>
      <button id="btn-menu">Main menu</button>
    </div>
    <div id="mp-status" class="mp-status"></div>
  `);
  $('btn-menu').onclick = goToMenu;
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
  client.on('s', (msg) => {
    if (net.mode !== 'guest') return;
    if (msg.ev) for (const ev of msg.ev) playEvent(ev);
    net.pending = msg;
    net.snapAt = performance.now();
  });
  client.on('i', (msg) => {
    if (net.mode === 'host') net.remoteIntent = { mx: msg.mx, my: msg.my, turn: msg.turn, lunge: !!msg.lunge, retract: !!msg.retract };
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
      const urls = lanInfo ? lanInfo.addresses.map((a) => `http://${a}:${lanInfo.port}/?room=${msg.code}`) : [];
      lobbyStatus(`
        <div class="mp-code">${msg.code}</div>
        <p class="small">Share the code${urls.length ? `, or this link: <b>${urls.join('</b> / <b>')}</b>` : ''}.</p>
        <p class="small muted" id="mp-wait">Waiting for a friend to join…</p>
      `);
    });
    client.on('peer', (msg) => {
      net.names.guest = msg.name;
      const options = LEVELS.map((l, i) => `<option value="${i}">${l.id}. ${l.title}</option>`).join('');
      lobbyStatus(`
        <div class="mp-code">${client.code}</div>
        <p><b>${msg.name}</b> joined.</p>
        <div class="row"><label class="mp-field">Arena <select id="mp-level">${options}</select></label><button id="mp-start" class="primary">Start match</button></div>
      `);
      $('mp-start').onclick = () => startNetMatch(Number($('mp-level').value));
    });
    client.create(name);
  } catch (err) {
    lobbyStatus(`<span class="mp-error">${err.message}</span>`);
  }
}

async function joinRoom(code) {
  const name = myName();
  code = String(code || '').toUpperCase().trim();
  if (code.length !== 4) return lobbyStatus('<span class="mp-error">Enter the 4-letter room code.</span>');
  lobbyStatus('Connecting…');
  try {
    const client = await connectClient();
    client.on('joined', (msg) => {
      net.names.guest = name;
      net.names.host = msg.peerName;
      lobbyStatus(`<div class="mp-code">${msg.code}</div><p>Joined <b>${msg.peerName}</b>'s room. Waiting for them to start…</p>`);
    });
    client.join(code, name);
  } catch (err) {
    lobbyStatus(`<span class="mp-error">${err.message}</span>`);
  }
}

/** Host: begin a match on the chosen arena. */
function startNetMatch(levelIdx) {
  net.mode = 'host';
  net.levelIndex = levelIdx;
  net.round = 0;
  net.scores = { host: 0, guest: 0 };
  startNetRound();
}

/** Host: begin the next round (sides swap each round). */
function startNetRound() {
  net.round++;
  net.winner = null;
  net.localSlot = slotOwner('a') === 'host' ? 'a' : 'b';
  net.remoteIntent = null;
  net.events = [];
  net.client.send({ t: 'setup', level: net.levelIndex, round: net.round, scores: net.scores, names: net.names });
  beginNetRound();
}

/** Guest: the host announced a round. */
function onSetup(msg) {
  net.mode = 'guest';
  net.levelIndex = msg.level;
  net.round = msg.round;
  net.scores = msg.scores;
  net.names = msg.names;
  net.winner = null;
  net.localSlot = slotOwner('a') === 'guest' ? 'a' : 'b';
  net.pending = null;
  net.ballBase = null;
  beginNetRound();
}

/** Both sides: build the arena for this round and start the countdown. */
function beginNetRound() {
  const def = LEVELS[net.levelIndex];
  const sameTrack = game && game.def === def && audio.track;
  levelIndex = net.levelIndex;
  game = buildGame(def, true);
  const owners = { a: slotOwner('a'), b: slotOwner('b') };
  game.player.name = net.names[owners.a] + (net.localSlot === 'a' ? ' (you)' : '');
  game.boss.name = net.names[owners.b] + (net.localSlot === 'b' ? ' (you)' : '');
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

/** Host: a body was hit in PvP; the other player scores. */
function onPvpHit(f, h) {
  const g = game;
  const hitSlot = f === g.player ? 'a' : 'b';
  const scorer = slotOwner(hitSlot === 'a' ? 'b' : 'a');
  net.scores[scorer]++;
  net.winner = scorer;
  state = 'roundEnd';
  endTimer = 2.4;
  g.ball.held = true;
  hitFx(f, h.cx, h.cy, h.nx, h.ny);
  netEvent({ e: 'hit', s: hitSlot, x: h.cx, y: h.cy, nx: h.nx, ny: h.ny });
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
  const meta = { st: state, cd: countdown, sc: net.scores, rd: net.round, w: net.winner };
  net.client.send(buildSnapshot(game, meta, net.events, net.frame % 4 === 0));
  net.events = [];
  pingMaybe();
}

/** Guest: send this frame's input to the host. */
function guestSend() {
  const f = localFighter();
  if (!f) return;
  const it = input.intent(f);
  net.client.send({ t: 'i', mx: +it.mx.toFixed(3), my: +it.my.toFixed(3), turn: it.turn, lunge: it.lunge ? 1 : 0, retract: it.retract ? 1 : 0 });
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
    applySnapshot(g, s);
    net.ballBase = { x: g.ball.x, y: g.ball.y, vx: g.ball.vx, vy: g.ball.vy };
    net.scores = s.sc;
    net.round = s.rd;
    net.winner = s.w;
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
      const f = ev.s === 'a' ? g.player : g.boss;
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
      freezeFx(ev.s === 'a' ? g.player : g.boss);
      break;
    case 'whack':
      audio.sfxWhack();
      break;
    case 'count':
      audio.sfxCount(!!ev.f);
      break;
    case 'hit':
      hitFx(ev.s === 'a' ? g.player : g.boss, ev.x, ev.y, ev.nx, ev.ny);
      break;
    default:
      break;
  }
}

function showNetMatchEnd() {
  setInGame(false);
  const winner = net.scores.host >= WIN_SCORE ? 'host' : 'guest';
  const you = winner === net.mode;
  showOverlay(`
    <div class="eyebrow">${you ? 'VICTORY' : 'DEFEAT'}</div>
    <h1>${net.names[winner]} wins ${net.scores.host}–${net.scores.guest}</h1>
    <p class="muted">${LEVELS[net.levelIndex].title} · ${net.round} rounds</p>
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

function onPeerLeft() {
  if (net.mode) showNetNotice('Your friend left', 'The other player disconnected.');
  else lobbyStatus('<span class="mp-error">Your friend left the room.</span>');
}

function leaveMatch() {
  goToMenu();
}

// ---------------------------------------------------------- title mark

const PUNCT = new Set(['[', ']', '<', '>', '(', ')', '/']);

function markHtml() {
  return [...GAME_MARK]
    .map((ch, i) => `<span class="g ${PUNCT.has(ch) ? 'p' : 'l'}" data-i="${i}">${ch}</span>`)
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
  renderer.setLevel(LEVELS[levelIndex]);
  renderer.resize();
  $('hud').hidden = true;
  $('countdown').hidden = true;
  const def = LEVELS[levelIndex];
  const roster = ROSTER.map((r) => {
    const idx = LEVELS.findIndex((l) => l.id === r.id);
    const cls = r.id === def.id ? 'now' : idx >= 0 ? 'ready' : 'locked';
    return `<li class="${cls}" ${idx >= 0 ? `data-level="${idx}"` : ''}><span>${String(r.id).padStart(2, '0')}</span> ${r.title}</li>`;
  }).join('');
  showOverlay(`
    <h1 class="title mark" aria-label="${GAME_NAME}">${markHtml()}</h1>
    <p class="tagline">${GAME_TAGLINE}</p>
    <div class="level-card">
      <div class="eyebrow">LEVEL ${def.id}</div>
      <div class="level-title">${def.title}</div>
      <div class="muted">Boss: ${def.bossName}</div>
      <p class="intro">${def.intro}</p>
    </div>
    <div class="columns">
      <div>
        <h3>Controls</h3>
        <ul class="controls">
          <li><b>Arrow keys</b> or <b>hold mouse</b> — move. Touch: <b>touch anywhere and drag</b> to steer</li>
          <li><b>A / D</b> — rotate (swing the shield to whack)</li>
          <li><b>W</b> or <b>Space</b> — thrust the shield forward</li>
          <li><b>S</b> — pull the shield in (soften the return)</li>
          <li><b>P</b> pause · <b>M</b> mute · <b>R</b> restart</li>
        </ul>
        <h3>How to win</h3>
        <p class="small">The ball only counts when it hits a <b>body</b>. The boss's shield blocks its front, so bank shots off the walls and angled deflectors to strike from the side or behind. One hit on you and the level is lost. A moving or spinning shield adds its speed to the ball; retreating removes it. The soundtrack's tempo follows the ball.</p>
      </div>
      <div>
        <h3>Levels</h3>
        <ol class="roster">${roster}</ol>
      </div>
    </div>
    <div class="row"><button id="btn-start" class="primary">Start · Sound on</button><button id="btn-jukebox">Soundtrack</button><button id="btn-multi" ${lanInfo ? '' : 'disabled title="Run npm start on one PC and open its LAN address on both"'}>Multiplayer · LAN</button>${fullscreenHint()}</div>
    ${lanInfo ? '' : '<p class="small muted">Multiplayer needs the LAN server: run <code>npm start</code> on one PC and open its address on both.</p>'}
  `);
  $('btn-start').onclick = begin;
  $('btn-jukebox').onclick = openJukebox;
  $('btn-multi').onclick = () => openLobby();
  $('btn-full')?.addEventListener('click', toggleFullscreen);
  startMarkAnimation();
  for (const li of document.querySelectorAll('.roster li[data-level]')) {
    li.onclick = () => {
      levelIndex = Number(li.dataset.level);
      renderer.setLevel(LEVELS[levelIndex]);
      renderer.resize();
      showTitle();
    };
  }
}

async function begin() {
  await audio.init();
  startLevel(levelIndex);
}

function showCleared() {
  setInGame(false);
  const def = game.def;
  const next = ROSTER.find((r) => r.id === def.id + 1);
  const nextIdx = LEVELS.findIndex((l) => l.id === def.id + 1);
  const last = !next;
  showOverlay(`
    <div class="eyebrow">${last ? 'EVERY LEVEL CLEARED' : `LEVEL ${def.id} CLEARED`}</div>
    <h1>${last ? 'The arcade is yours' : def.title}</h1>
    <p class="muted">${last ? `${def.bossName} built every room before this one. You beat them all.` : `${def.bossName} is down.`}</p>
    <table class="stats">
      <tr><td>Time</td><td>${formatTime(game.time)}</td></tr>
      <tr><td>Top ball speed</td><td>${Math.round(game.topSpeed)} px/s</td></tr>
      <tr><td>Shield hits</td><td>${game.paddleHits}</td></tr>
    </table>
    <div class="row">
      <button id="btn-replay" class="primary">Play again</button>
      ${next ? `<button id="btn-next" ${nextIdx >= 0 ? 'class="primary"' : 'disabled'}>Level ${next.id} · ${next.title}${nextIdx >= 0 ? '' : ' — coming soon'}</button>` : ''}
      <button id="btn-menu">Main menu</button>
    </div>
  `);
  $('btn-replay').onclick = () => startLevel(levelIndex);
  if (nextIdx >= 0) $('btn-next').onclick = () => startLevel(nextIdx);
  $('btn-menu').onclick = goToMenu;
}

function showFailed() {
  setInGame(false);
  const def = game.def;
  showOverlay(`
    <div class="eyebrow">SHIELD DOWN</div>
    <h1>${def.bossName} holds ${def.title}</h1>
    <p class="muted">One hit is all it takes. You lasted ${formatTime(game.time)}.</p>
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
renderer.setLevel(LEVELS[levelIndex]);
renderer.resize();
showTitle();
requestAnimationFrame(frame);
NetClient.available().then((info) => {
  lanInfo = info;
  if (state === 'title') showTitle();
  const code = new URLSearchParams(location.search).get('room');
  if (info && code) openLobby(code.toUpperCase());
});

// Expose for debugging / automated smoke tests.
window.__game = { get state() { return state; }, get game() { return game; }, get net() { return net; }, audio, startLevel };
