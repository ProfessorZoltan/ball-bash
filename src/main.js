// Game bootstrap: state machine, fixed-step physics loop, collision dispatch,
// HUD/overlay wiring. Everything heavy lives in the modules it imports.
import { GAME_MARK, GAME_NAME, GAME_TAGLINE, MARK_READINGS, PHYSICS_DT, BALL, PLAYER, SURFACE_VELOCITY_FACTOR, COUNTDOWN_SECONDS } from './config.js';
import { Ball, Fighter, Boss, createMover } from './entities.js';
import { IceTrail } from './ice.js';
import { BallHistory, bossIntent } from './ai.js';
import { LEVELS, ROSTER } from './levels.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Effects } from './fx.js';
import { AudioEngine } from './audio/engine.js';
import { TRACKS } from './audio/tracks.js';
import { circleVsCircle, polygonEdges, pointInPolygon, resolveCircleVsSegments, predictPath } from './physics.js';
import { advanceBall } from './sim.js';
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

function buildGame(def) {
  const walls = polygonEdges(def.boundary, 'wall');
  for (const poly of def.obstacles) walls.push(...polygonEdges(poly, 'obstacle'));
  const player = new Fighter({
    x: def.player.x,
    y: def.player.y,
    angle: def.player.angle,
    r: PLAYER.radius,
    paddleWidth: PLAYER.paddleWidth,
    paddleBase: PLAYER.paddleOffset,
    paddleThick: PLAYER.paddleThick,
    moveSpeed: PLAYER.moveSpeed,
    turnSpeed: PLAYER.turnSpeed,
    lungeExtend: PLAYER.lungeExtend,
    lungeSpeed: PLAYER.lungeSpeed,
    retractPull: PLAYER.retractPull,
    name: 'You',
    kind: 'player',
    color: def.palette.wall,
  });
  const boss = new Boss({ ...def.boss, name: def.bossName, color: def.palette.obstacle });
  const movers = (def.movers || []).map(createMover);
  const ice = def.ice ? new IceTrail(def.ice) : null;
  const ball = new Ball(BALL.radius);
  ball.x = def.ball.x;
  ball.y = def.ball.y;
  ball.held = true;
  return {
    def,
    walls,
    player,
    boss,
    movers,
    ice,
    ball,
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

  for (const m of g.movers) m.update(dt);

  // Player. Movement is locked until the ball launches; aiming is allowed.
  const pi = input.intent(g.player);
  if (state === 'countdown') {
    pi.mx = 0;
    pi.my = 0;
    pi.lunge = false;
  }
  const wasIdle = g.player.lungeState === 'idle';
  g.player.update(dt, pi);
  if (wasIdle && g.player.lungeState === 'out') audio.sfxWhack();
  resolveCircleVsSegments(g.player, g.walls);
  pushOutOfMovers(g.player);

  // Boss.
  if (state === 'playing') g.boss.updateOrbit(dt);
  const bi = state === 'playing' ? bossIntent(g.boss, g.history, g.player, g.walls, dt, simTime, g.movers) : { mx: 0, my: 0, turn: 0 };
  const bossWasIdle = g.boss.lungeState === 'idle';
  g.boss.update(dt, bi);
  if (bossWasIdle && g.boss.lungeState === 'out') audio.sfxWhack();
  resolveCircleVsSegments(g.boss, g.walls);
  pushOutOfMovers(g.boss);

  separateCircles(g.player, g.boss);
  g.player.finalizeStep(dt);
  g.boss.finalizeStep(dt);

  if (!g.ball.held) {
    moveBall(dt);
    if (state === 'playing') g.history.push(simTime, g.ball);
  }

  if (g.ice) {
    g.ice.update(simTime, g.ball);
    if (g.ice.affect(g.player)) onPlayerFrozen();
  }
}

function onPlayerFrozen() {
  const g = game;
  audio.sfxFreeze();
  g.fx.ring(g.player.x, g.player.y, g.def.palette.ice || '#cdf6ff', 90, 0.5);
  g.fx.burst(g.player.x, g.player.y, 0, -1, 18, '#ffffff', 120, Math.PI, 0.7);
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
        if (f.kind === 'boss') {
          onBossHit(h);
          return true;
        }
        onPlayerHit(h);
        return false;
      },
    },
    g.movers,
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

function onWallBounce(h, seg) {
  const g = game;
  const n = speedNorm(g.ball.speed);
  audio.sfxWall(n);
  const color = seg.kind === 'obstacle' ? g.def.palette.obstacle : g.def.palette.wall;
  g.fx.burst(h.cx, h.cy, h.nx, h.ny, 4 + Math.floor(n * 8), color, 160 + 300 * n, 1.1, 0.35);
  g.ball.lastHitBy = 'wall';
  guideFrame = 0;
}

function onMoverHit(m, h, before) {
  const g = game;
  const after = g.ball.speed;
  const delta = after - before;
  const strength = clamp(Math.abs(delta) / 400, 0, 1);
  audio.sfxPaddle(strength * 0.7, true);
  g.fx.burst(h.cx, h.cy, h.nx, h.ny, 6 + Math.floor(strength * 12), g.def.palette.obstacle, 180 + 360 * strength, 1, 0.4);
  if (Math.abs(delta) > 120) g.fx.ring(h.cx, h.cy, g.def.palette.obstacle, 50 + 100 * strength, 0.35);
  g.ball.lastHitBy = 'mover';
  guideFrame = 0;
}

function onPaddleHit(f, h, before) {
  const g = game;
  const after = g.ball.speed;
  const delta = after - before;
  const strength = clamp(Math.abs(delta) / 400, 0, 1);
  const isBoss = f.kind === 'boss';
  audio.sfxPaddle(strength, isBoss);
  g.fx.burst(h.cx, h.cy, h.nx, h.ny, 8 + Math.floor(strength * 16), f.color, 200 + 400 * strength, 0.9, 0.45);
  if (delta > 100) {
    g.fx.addShake(3 + strength * 7);
    g.fx.ring(h.cx, h.cy, f.color, 60 + 120 * strength, 0.4);
  }
  g.ball.lastHitBy = f.kind;
  if (!isBoss) g.paddleHits++;
  if (isBoss && g.ice) {
    g.ice.start(simTime);
    audio.sfxIce();
  }
  guideFrame = 0;
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
    acc += dt;
    const simulate = state === 'countdown' || state === 'playing';
    while (acc >= PHYSICS_DT) {
      if (simulate) step(PHYSICS_DT);
      acc -= PHYSICS_DT;
    }
    game.fx.update(dt);
    if (state === 'countdown') {
      countdown -= dt;
      const tick = Math.ceil(countdown);
      if (tick !== countdownTick) {
        countdownTick = tick;
        if (tick > 0) {
          $('countdown').hidden = false;
          $('countdown').textContent = String(tick);
          audio.sfxCount(false);
        }
      }
      if (countdown <= 0) launchBall();
    }
    if (state === 'playing') {
      game.time += dt;
      game.ball.pushTrail(BALL.trailLength);
      audio.setBallSpeed(game.ball.speed, game.def.ball.speed, BALL.minSpeed, BALL.maxSpeed);
      if (guideFrame-- <= 0) {
        guideFrame = 6;
        game.guidePath = predictPath(game.ball.x, game.ball.y, game.ball.vx, game.ball.vy, game.walls, 1, 900, game.ball.r);
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
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
    else if (state === 'jukebox') leaveJukebox();
  }
  if (state === 'jukebox' && input.consumePress('n')) jukeboxNext();
  if (input.consumePress('r') && game && state !== 'title') startLevel(levelIndex);
  if (input.consumePress('f')) toggleFullscreen();
  if (input.consumePress('Enter')) {
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
  setText('hud-lives', '◆'.repeat(Math.max(0, g.lives)) + '◇'.repeat(Math.max(0, PLAYER.lives - g.lives)));
  const s = g.ball.held && state !== 'cleared' ? 0 : g.ball.speed;
  setText('hud-speed', `${Math.round(s)} px/s`);
  $('hud-speed-bar').style.width = `${speedNorm(s) * 100}%`;
  setText('hud-bpm', audio.currentBpm ? `♪ ${Math.round(audio.currentBpm)} BPM` : '♪');
  setText('hud-fps', `${Math.round(fps)} FPS`);
  const frozen = g.player.frozen > 0;
  setText('hud-status', frozen ? `FROZEN ${g.player.frozen.toFixed(1)}` : '');
  $('hud-status').classList.toggle('on', frozen);
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
    <div class="row"><button id="btn-start" class="primary">Start · Sound on</button><button id="btn-jukebox">Soundtrack</button>${fullscreenHint()}</div>
  `);
  $('btn-start').onclick = begin;
  $('btn-jukebox').onclick = openJukebox;
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
  showOverlay(`
    <div class="eyebrow">LEVEL ${def.id} CLEARED</div>
    <h1>${def.title}</h1>
    <p class="muted">${def.bossName} is down.</p>
    <table class="stats">
      <tr><td>Time</td><td>${formatTime(game.time)}</td></tr>
      <tr><td>Top ball speed</td><td>${Math.round(game.topSpeed)} px/s</td></tr>
      <tr><td>Shield hits</td><td>${game.paddleHits}</td></tr>
    </table>
    <div class="row">
      <button id="btn-replay" class="primary">Play again</button>
      <button id="btn-next" ${nextIdx >= 0 ? 'class="primary"' : 'disabled'}>${next ? `Level ${next.id} · ${next.title}${nextIdx >= 0 ? '' : ' — coming soon'}` : 'More levels coming soon'}</button>
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

// Expose for debugging / automated smoke tests.
window.__game = { get state() { return state; }, get game() { return game; }, audio, startLevel };
