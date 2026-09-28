// Vector: the page. The state machine (title, the story, a level's card,
// play, pause, out of shields, cleared, the ending), the fixed-step loop, the
// HUD and the menus. With the renderer, the art and the input it is the only
// part of the third game that touches the page: the game itself (game.js)
// never does.
import { PHYSICS_DT, DIFFICULTIES, DEFAULT_DIFFICULTY, GAME_MARK, GAME_VERSION, VECTOR_NAME, VECTOR_TAGLINE, VECTOR_LIT, STORE, POWERUPS, PICKS, BLASTER, MOVE, BOSS_INTRO } from './config.js';
import { LEVEL_DEFS, level, levelDef } from './levels.js';
import { BOSSES } from './bosses.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Art } from './art.js';
import { FX } from './fx.js';
import { Input } from './input.js';
import { VectorAudio } from './audio.js';
import { VECTOR_TRACKS } from './tracks.js';
import { STORY } from './story.js';
import { lerp, clamp, dist, sub, dot, camBasis } from './math.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
let renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  document.body.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#eee;background:#05030f;height:100%">Vector needs WebGL2, and this browser could not start it: ${String(err.message).replace(/</g, '&lt;')}</div>`;
  throw err;
}
const art = new Art(renderer);
const fx = new FX();
const input = new Input(canvas);
input.attachTouch($('touch'));
const audio = new VectorAudio();

// ---------------------------------------------------------------- storage

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (_) {
    return fallback;
  }
}

function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // Storage can be off (a private window); the game plays on without it.
  }
}

const settings = { difficulty: DEFAULT_DIFFICULTY, muted: false, quality: 'auto', aimLine: true, sens: 1, invert: false, autoRun: false, ...load(STORE.settings, {}) };
let run = load(STORE.run, null); // the campaign in progress, if any
const cleared = new Set(load(STORE.cleared, []));
const best = load(STORE.best, {});

function saveSettings() {
  save(STORE.settings, settings);
}

// Auto quality: High until the frame rate stays under 40 for three seconds of
// play, then Low for the rest of the session.
let autoLow = false;
let slowSeconds = 0;

function applySettings() {
  input.sens = settings.sens;
  input.invert = settings.invert;
  input.autoRun = settings.autoRun;
  renderer.quality = settings.quality === 'low' || (settings.quality === 'auto' && autoLow) ? 'low' : 'high';
  renderer.resize();
}
applySettings();

function difficulty() {
  return DIFFICULTIES.find((d) => d.id === settings.difficulty) || DIFFICULTIES.find((d) => d.id === DEFAULT_DIFFICULTY);
}

// ------------------------------------------------------------------ state

let state = 'title'; // title, story, card, play, paused, down, cleared, done
let game = null;
let bp = null;
let mode = 'single'; // 'campaign' or 'single'
let levelId = 1;
let acc = 0;
let last = 0;
let pending = null; // presses not yet given to a physics step
let prevPos = null; // where the robot was a step ago, for drawing between steps
let sayUntil = 0;
let lastBoss = false;
let frames = { n: 0, t: 0, fps: 0 };

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function markHtml() {
  return [...GAME_MARK].map((ch, i) => `<span class="g${VECTOR_LIT.includes(i) || i >= 14 ? ' lit' : ''}">${ch.replace('<', '&lt;').replace('>', '&gt;')}</span>`).join('');
}

// ------------------------------------------------------------------ music

function playMusic(key) {
  const t = VECTOR_TRACKS[key];
  if (!t || !audio.ready) return;
  if (audio.track && audio.track.title === t.title) return;
  audio.playTrack(t);
}

async function unlockAudio() {
  try {
    await audio.init();
    audio.setMuted(settings.muted);
  } catch (_) {
    // No sound is not a reason to stop the game.
  }
}

/** A cue from the game, placed in space: panned toward where it happened, quieter far off. */
function cue(e) {
  if (!audio.ready) return;
  if (e.at && !e.me && game) {
    const b = game.bot;
    const d = sub(e.at, b.pos);
    const L = Math.hypot(d[0], d[1], d[2]);
    const B = camBasis(b.yaw, 0);
    e.pan = clamp(dot(d, B.right) / Math.max(1, L), -1, 1) * 0.8;
    e.vol = clamp(1 - L / 60, 0, 1);
    if (e.vol <= 0.02) return;
  }
  try {
    audio.cue(e);
  } catch (_) {
    // A sound that fails is only a sound.
  }
}

// ------------------------------------------------------------------ flow

/** Start level `id`, fresh or from a checkpoint (a continue), in the current mode. */
function startLevel(id, opts = {}) {
  levelId = id;
  const L = levelDef(id);
  bp = level(id);
  const d = difficulty();
  const carry = mode === 'campaign' && run ? run : null;
  game = new Game(bp, {
    shields: opts.shields ?? (carry ? carry.pool : d.shields),
    maxShields: opts.maxShields ?? d.shields,
    checkpoint: opts.checkpoint ?? -1,
    ammo: opts.ammo,
    loaded: opts.loaded,
    stats: opts.stats,
    invulnerable: opts.invulnerable,
  });
  renderer.setLevel(bp, game.world);
  renderer.resize();
  fx.clear();
  acc = 0;
  pending = null;
  prevPos = [...game.bot.pos];
  lastBoss = false;
  state = 'play';
  input.reset();
  overlay(null);
  $('hud').hidden = false;
  $('crosshair').hidden = false;
  document.body.classList.add('playing');
  audio.setHumanity?.(L.humanity);
  playMusic(L.key);
  audio.bossTime?.(false);
  banner(`LEVEL ${id}`, L.title, L.brief, L.humanity > 0.85);
  input.lock();
  hud();
}

function showCard(id) {
  state = 'card';
  levelId = id;
  const L = levelDef(id);
  if (!game || game.bp.id !== id) {
    bp = level(id);
    game = new Game(bp, { shields: 1, maxShields: 1 });
    renderer.setLevel(bp, game.world);
  }
  const boss = BOSSES[L.boss];
  const human = L.humanity > 0.85;
  overlay(`
    <div class="panel narrow ${human ? 'paper' : ''}">
      <div class="eyebrow">LEVEL ${id} · ${L.tier.toUpperCase()}</div>
      <h2>${L.title}</h2>
      <p class="intro">${L.brief}</p>
      <p class="record">${L.record}</p>
      <p class="small muted">At its end: <b>${boss.name}</b>, ${boss.title.toLowerCase()}.</p>
      <div class="row"><button id="go" class="primary">Begin</button><button id="menu">Title</button></div>
      <div class="hint">${device() === 'touch' ? 'Left thumb moves; drag on the right to look.' : 'Click to take the mouse. Esc gives it back and pauses.'}</div>
    </div>`, true);
  $('go').onclick = async () => {
    await unlockAudio();
    startLevel(id, mode === 'campaign' && run && run.level === id && run.checkpoint != null ? { checkpoint: run.checkpoint } : {});
  };
  $('menu').onclick = () => showTitle();
  focusFirst();
}

function showPrologue() {
  state = 'story';
  const P = STORY.prologue;
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">${P.eyebrow}</div>
      <h2>${P.title}</h2>
      <div class="story">${P.paras.map((p) => `<p>${p}</p>`).join('')}</div>
      <div class="row"><button id="go" class="primary">${P.begin}</button></div>
    </div>`);
  $('go').onclick = () => showCard(1);
  focusFirst();
}

function beginCampaign(fresh) {
  mode = 'campaign';
  if (fresh || !run) {
    run = { level: 1, pool: difficulty().shields, difficulty: difficulty().id, time: 0, lost: 0, kills: 0, secrets: 0 };
    persistRun();
    showPrologue();
    return;
  }
  settings.difficulty = run.difficulty;
  showCard(run.level);
}

function persistRun() {
  save(STORE.run, run ? { ...run, pool: Number.isFinite(run.pool) ? run.pool : 'inf' } : null);
}

function loadRun() {
  if (run && run.pool === 'inf') run.pool = Infinity;
}
loadRun();

function statsTable(rows) {
  return `<table class="stats"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
}

function levelCleared() {
  const id = levelId;
  const s = game.stats;
  cleared.add(id);
  save(STORE.cleared, [...cleared]);
  if (!best[id] || s.time < best[id]) {
    best[id] = s.time;
    save(STORE.best, best);
  }
  input.unlock();
  document.body.classList.remove('playing');
  $('crosshair').hidden = true;
  const rows = [
    ['Time', fmt(s.time)],
    ['Shields lost', s.lost],
    ['Machines stopped', s.kills],
    ['Secrets', `${s.secrets} of ${bp.secrets}`],
  ];
  let next = '';
  if (mode === 'campaign' && run) {
    run.time += s.time;
    run.lost += s.lost;
    run.kills += s.kills;
    run.secrets += s.secrets;
    run.pool = game.shields;
    run.checkpoint = null;
    if (id >= LEVEL_DEFS.length) {
      showEnding();
      return;
    }
    run.level = id + 1;
    persistRun();
    next = `<button id="next" class="primary">Level ${id + 1}: ${levelDef(id + 1).title}</button>`;
  } else if (id < LEVEL_DEFS.length) next = `<button id="next" class="primary">Next: ${levelDef(id + 1).title}</button>`;
  else next = `<button id="ending" class="primary">The ending</button>`;
  state = 'cleared';
  const note = STORY.cleared[id - 1];
  overlay(`
    <div class="panel narrow ${levelDef(id).humanity > 0.6 ? 'paper' : ''}">
      <div class="eyebrow">LEVEL ${id} CLEARED</div>
      <h2>${levelDef(id).title}</h2>
      <p class="record">${BOSSES[levelDef(id).boss].name} is stopped.</p>
      ${note ? `<p class="record">${note}</p>` : ''}
      ${statsTable(rows)}
      <div class="row">${next}<button id="again">Play it again</button><button id="menu">Title</button></div>
    </div>`);
  if ($('next')) $('next').onclick = () => showCard(id + 1);
  if ($('ending')) $('ending').onclick = () => showEnding();
  $('again').onclick = () => {
    if (mode === 'campaign') mode = 'single';
    showCard(id);
  };
  $('menu').onclick = () => showTitle();
  focusFirst();
}

function showEnding() {
  state = 'done';
  const r = mode === 'campaign' ? run : null;
  save(STORE.run, null);
  run = null;
  input.unlock();
  $('hud').hidden = true;
  $('crosshair').hidden = true;
  document.body.classList.remove('playing');
  playMusic('ending');
  const E = STORY.ending;
  overlay(`
    <div class="panel narrow paper">
      <div class="eyebrow">${E.eyebrow}</div>
      <h2 style="font-family:var(--book)">${E.title}</h2>
      <div class="story">${E.paras.map((p) => `<p>${p}</p>`).join('')}</div>
      <h1 class="mark" aria-label="${VECTOR_NAME}">${markHtml()}</h1>
      <p class="record" style="text-align:center">${E.record}</p>
      ${r ? statsTable([['Difficulty', DIFFICULTIES.find((d) => d.id === r.difficulty).name], ['Total time', fmt(r.time)], ['Shields lost', r.lost], ['Machines stopped', r.kills], ['Secrets', r.secrets]]) : ''}
      <div class="row"><button id="menu" class="primary">Title</button></div>
    </div>`, 'dawn');
  $('menu').onclick = () => showTitle();
  focusFirst();
}

function levelDown() {
  state = 'down';
  input.unlock();
  document.body.classList.remove('playing');
  $('crosshair').hidden = true;
  const cp = game.checkpoint;
  if (mode === 'campaign' && run) {
    run.checkpoint = cp;
    persistRun();
  }
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">OUT OF SHIELDS</div>
      <h2>${levelDef(levelId).title}</h2>
      <p class="record">${STORY.failed(levelDef(levelId).title)}</p>
      <div class="row">
        <button id="cont" class="primary">Continue${cp >= 0 ? ' from the checkpoint' : ''}</button>
        <button id="restart">Start the level again</button>
        <button id="menu">Title</button>
      </div>
    </div>`);
  const keep = { ammo: game.ammo, loaded: game.loaded, stats: { ...game.stats } };
  $('cont').onclick = () => {
    if (mode === 'campaign' && run) run.pool = difficulty().shields;
    startLevel(levelId, { checkpoint: cp, shields: difficulty().shields, ...keep });
  };
  $('restart').onclick = () => {
    if (mode === 'campaign' && run) run.pool = difficulty().shields;
    startLevel(levelId, { shields: difficulty().shields });
  };
  $('menu').onclick = () => showTitle();
  focusFirst();
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  input.unlock();
  document.body.classList.remove('playing');
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">PAUSED</div>
      <h2>${levelDef(levelId).title}</h2>
      ${settingsHtml(true)}
      <div class="row"><button id="resume" class="primary">Resume</button><button id="restart">Restart the level</button><button id="menu">Title</button></div>
      <details><summary>Controls</summary>${controlsTable()}</details>
    </div>`, 'clear');
  wireSettings();
  $('resume').onclick = () => resume();
  $('restart').onclick = () => startLevel(levelId);
  $('menu').onclick = () => {
    if (mode === 'campaign' && run) {
      run.checkpoint = game.checkpoint;
      persistRun();
    }
    showTitle();
  };
  focusFirst();
}

function resume() {
  if (state !== 'paused') return;
  state = 'play';
  overlay(null);
  document.body.classList.add('playing');
  input.reset();
  input.lock();
  last = performance.now();
}

// ------------------------------------------------------------------ title

function settingsHtml(short = false) {
  const q = settings.quality;
  return `
    ${short ? '' : `<div class="field"><label for="diff">Difficulty</label><select id="diff">${DIFFICULTIES.map((x) => `<option value="${x.id}" ${x.id === difficulty().id ? 'selected' : ''}>${x.name} · ${x.blurb}</option>`).join('')}</select></div>`}
    <div class="field"><label for="snd">Sound</label><select id="snd"><option value="on" ${settings.muted ? '' : 'selected'}>On</option><option value="off" ${settings.muted ? 'selected' : ''}>Off</option></select>
      <label for="q">Quality</label><select id="q"><option value="auto" ${q === 'auto' ? 'selected' : ''}>Auto${autoLow ? ' (low)' : ''}</option><option value="high" ${q === 'high' ? 'selected' : ''}>High</option><option value="low" ${q === 'low' ? 'selected' : ''}>Low</option></select></div>
    <div class="field"><label for="sens">Mouse</label><input id="sens" type="range" min="0.3" max="3" step="0.05" value="${settings.sens}" /><label for="inv">Look</label><select id="inv"><option value="no" ${settings.invert ? '' : 'selected'}>Normal</option><option value="yes" ${settings.invert ? 'selected' : ''}>Inverted</option></select></div>
    <div class="field"><label for="aimline">Aim line</label><select id="aimline"><option value="on" ${settings.aimLine ? 'selected' : ''}>On</option><option value="off" ${settings.aimLine ? '' : 'selected'}>Off</option></select>
      <label for="runmode">Run</label><select id="runmode"><option value="hold" ${settings.autoRun ? '' : 'selected'}>Hold Shift</option><option value="auto" ${settings.autoRun ? 'selected' : ''}>By default</option></select></div>`;
}

function wireSettings() {
  const on = (id, fn) => {
    const el = $(id);
    if (el) el.onchange = fn;
  };
  on('diff', (e) => {
    settings.difficulty = e.target.value;
    saveSettings();
  });
  on('snd', async (e) => {
    settings.muted = e.target.value === 'off';
    saveSettings();
    await unlockAudio();
    audio.setMuted(settings.muted);
    if (state === 'title') playMusic('vector');
  });
  on('q', (e) => {
    settings.quality = e.target.value;
    saveSettings();
    applySettings();
  });
  const sens = $('sens');
  if (sens) sens.oninput = (e) => {
    settings.sens = Number(e.target.value);
    saveSettings();
    applySettings();
  };
  on('inv', (e) => {
    settings.invert = e.target.value === 'yes';
    saveSettings();
    applySettings();
  });
  on('aimline', (e) => {
    settings.aimLine = e.target.value === 'on';
    saveSettings();
  });
  on('runmode', (e) => {
    settings.autoRun = e.target.value === 'auto';
    saveSettings();
    applySettings();
  });
}

function controlsTable() {
  const rows = [
    ['Look', 'the mouse (click to capture it)', 'right stick', 'drag on the right half'],
    ['Move', 'W A S D', 'left stick', 'the stick under the left thumb'],
    ['Jump (hold for higher)', 'Space', 'A', 'JUMP'],
    ['Run', 'hold Shift', 'hold X, or hold the left stick in', 'push the stick all the way'],
    ['Fire', 'left click', 'RT', 'FIRE'],
    ['Light wormhole end', 'right click or Q', 'LB', '◐'],
    ['Dark wormhole end', 'E', 'RB', '◑'],
    ['Cycle power-ups', 'wheel or R', 'LT or Y', '⟳'],
    ['Load one straight away', '1 to 6', '', ''],
    ['Pause, mute, fullscreen', 'Esc or P, M, F', 'Start', '❚❚ and ⛶'],
  ];
  return `<table class="controls"><thead><tr><th>Action</th><th>Mouse and keyboard</th><th>Controller</th><th>Touch</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function showTitle() {
  state = 'title';
  mode = 'single';
  input.unlock();
  document.body.classList.remove('playing');
  $('hud').hidden = true;
  $('crosshair').hidden = true;
  $('banner').hidden = true;
  $('subtitle').hidden = true;
  $('hint').hidden = true;
  if (!game || game.bp.id !== 1) {
    bp = level(1);
    game = new Game(bp, { shields: 1, maxShields: 1 });
    renderer.setLevel(bp, game.world);
  }
  const resumeLabel = run ? `Resume · Level ${run.level}` : null;
  const list = LEVEL_DEFS.map((L) => `<li tabindex="0" data-level="${L.id}"><span class="n">${L.id}</span><span>${L.title} <span class="tag">· ${BOSSES[L.boss].name}</span></span><span class="tag ${cleared.has(L.id) ? 'done' : ''}">${cleared.has(L.id) ? `cleared${best[L.id] ? ` · ${fmt(best[L.id])}` : ''}` : L.tier}</span></li>`).join('');
  overlay(`
    <div class="panel">
      <h1 class="mark" aria-label="${VECTOR_NAME}">${markHtml()}</h1>
      <div class="reading">VECTOR</div>
      <p class="tagline">${VECTOR_TAGLINE}<span class="version">v${GAME_VERSION}</span></p>
      <div class="cols">
        <div>
          <h3>Campaign</h3>
          <p class="small muted">The third game: out of the grid and into the world, in first person. Ten levels, each more real than the last, and one pool of shields carried through them all.</p>
          <div class="row" style="justify-content:flex-start">
            ${resumeLabel ? `<button id="resume" class="primary">${resumeLabel}</button>` : ''}
            <button id="new" class="${resumeLabel ? '' : 'primary'}">New campaign</button>
          </div>
          ${settingsHtml()}
          <details><summary>Controls</summary>${controlsTable()}</details>
          <div class="row" style="justify-content:flex-start"><button id="deflector" title="Back to the first game">← Deflector</button><button id="defector" title="The second game">Defector</button><button id="full">${document.fullscreenElement ? 'Leave fullscreen' : 'Fullscreen'}</button></div>
        </div>
        <div>
          <h3>Play one level</h3>
          <ol class="levels">${list}</ol>
        </div>
      </div>
    </div>`);
  wireSettings();
  $('new').onclick = async () => {
    await unlockAudio();
    beginCampaign(true);
  };
  if ($('resume')) $('resume').onclick = async () => {
    await unlockAudio();
    beginCampaign(false);
  };
  $('deflector').onclick = () => (location.href = '../');
  $('defector').onclick = () => (location.href = '../sequel/');
  $('full').onclick = () => toggleFullscreen();
  for (const li of document.querySelectorAll('.levels li')) {
    const go = async () => {
      await unlockAudio();
      mode = 'single';
      showCard(Number(li.dataset.level));
    };
    li.onclick = go;
    li.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') go();
    };
  }
  playMusic('vector');
}

function device() {
  return input.device;
}

function overlay(html, cls = '') {
  const o = $('overlay');
  if (!html) {
    o.hidden = true;
    o.innerHTML = '';
    return;
  }
  o.className = cls === true ? 'clear' : cls || '';
  o.innerHTML = html;
  o.hidden = false;
}

function focusFirst() {
  const b = document.querySelector('#overlay button.primary') || document.querySelector('#overlay button');
  if (b) b.focus({ preventScroll: true });
}

function banner(eyebrow, title, sub, human = false) {
  const B = $('banner');
  $('banner-eyebrow').textContent = eyebrow;
  $('banner-title').textContent = title;
  $('banner-sub').textContent = sub || '';
  B.className = human ? 'human' : '';
  B.hidden = false;
  // Restart the animation.
  B.style.animation = 'none';
  void B.offsetWidth;
  B.style.animation = '';
  clearTimeout(banner.timer);
  banner.timer = setTimeout(() => (B.hidden = true), 3200);
}

// ------------------------------------------------------------------- HUD

const hudCache = {};

/** Set an element's text or markup only when it has changed: the HUD is redrawn every frame. */
function put(id, value, html = false) {
  if (hudCache[id] === value) return;
  hudCache[id] = value;
  if (html) $(id).innerHTML = value;
  else $(id).textContent = value;
}

function hud() {
  if (!game) return;
  const g = game;
  const L = levelDef(levelId);
  put('hud-level', `${levelId} · ${L.title}`);
  put('hud-time', fmt(g.stats.time));
  put('hud-secrets', `${g.stats.secrets}/${bp.secrets}`);
  const max = g.maxShields;
  put('hud-shields', Number.isFinite(max) ? Array.from({ length: max }, (_, i) => `<span class="${i < g.shields ? '' : 'gone'}">◆</span>`).join('') : '∞', true);
  const B = g.boss;
  $('hud-boss').hidden = !B || B.dead;
  if (B && !B.dead) {
    put('hud-boss-name', B.name.toUpperCase());
    $('hud-boss-bar').style.width = `${Math.max(0, (B.hp / B.maxHp) * 100)}%`;
  }
  const P = POWERUPS.find((p) => p.id === g.loaded);
  put('hud-loaded', P ? P.name.toUpperCase() : 'STANDARD');
  $('hud-loaded').style.color = P ? P.color : '';
  const free = BLASTER.maxAlive - g.mine();
  put('hud-charges', Array.from({ length: BLASTER.maxAlive }, (_, i) => `<span class="${i < free ? '' : 'gone'}">●</span>`).join(''), true);
  put('hud-ammo', PICKS.map((k, i) => {
    const p = POWERUPS.find((x) => x.id === k);
    const n = k === 'std' ? '∞' : g.ammo[k];
    return `<div class="slot ${g.loaded === k ? 'on' : ''} ${k === 'std' || g.ammo[k] ? 'has' : ''}" data-pick="${k}" style="color:${p ? p.color : '#dffbff'}"><i>${i + 1}</i><b>${p ? p.glyph : '•'}</b>${n}</div>`;
  }).join(''), true);
  put('hud-mute', settings.muted ? 'MUTED' : '');
  put('hud-fps', `${frames.fps} FPS`);
  $('crosshair').classList.toggle('cool', g.cooldown > 0.05);
  // Signs and what is said.
  const hint = $('hint');
  if (g.sign && state === 'play') {
    put('hint', g.sign.text);
    hint.hidden = false;
  } else hint.hidden = true;
}

$('hud-ammo').addEventListener('click', (e) => {
  const s = e.target.closest('[data-pick]');
  if (s && game) game.load(s.dataset.pick);
});
$('hud-pause').onclick = () => pause();
$('hud-full').onclick = () => toggleFullscreen();

function subtitle(who, text, name) {
  const S = $('subtitle');
  S.className = who === 'human' ? 'human' : '';
  $('subtitle-who').textContent = (name || (who === 'human' ? 'The Creator' : 'Machine')).toUpperCase();
  $('subtitle-text').textContent = text;
  S.hidden = false;
  let len = 3 + text.length / 16;
  try {
    const l = audio.speak?.(text, { who });
    if (typeof l === 'number') len = Math.max(len, l + 1);
  } catch (_) {
    // silent then
  }
  sayUntil = performance.now() + len * 1000;
}

// ---------------------------------------------------------------- events

function events() {
  const g = game;
  for (const e of g.events) {
    cue(e);
    switch (e.s) {
      case 'pop':
        fx.explode(e.at, e.r || 0.5, e.color || '#ffb347');
        break;
      case 'crate':
        fx.burst(e.at, e.cover ? '#c8c8c8' : '#ffb347', 30, 5, 0.8, 0.14);
        break;
      case 'ricochet':
        fx.sparks(e.at, e.n || [0, 1, 0], '#dffbff', 5);
        break;
      case 'spark':
        fx.sparks(e.at, e.n || [0, 1, 0], e.color || '#ffd070', 10);
        break;
      case 'hurt': {
        const d = $('damage');
        d.hidden = false;
        d.style.animation = 'none';
        void d.offsetWidth;
        d.style.animation = '';
        fx.shake = Math.max(fx.shake, 0.3);
        break;
      }
      case 'bossHit':
        fx.burst(e.at, '#ffe066', 16, 5, 0.5, 0.12);
        break;
      case 'bossDown':
        fx.explode(e.at, 2.2, '#ffe066');
        fx.shake = 0.8;
        audio.bossTime?.(false);
        banner(`${g.boss.name.toUpperCase()}`, 'Stopped', 'The way out is open.', levelDef(levelId).humanity > 0.85);
        break;
      case 'bossStart':
        banner(e.title.toUpperCase(), e.name, '', levelDef(levelId).humanity > 0.85);
        if (levelDef(levelId).key === 'workshop') playMusic('creator');
        else audio.bossTime?.(true);
        break;
      case 'checkpoint':
        fx.ring(e.at, '#9dff5c', 6);
        if (mode === 'campaign' && run) {
          run.checkpoint = g.checkpoint;
          persistRun();
        }
        break;
      case 'secret':
        banner('SECRET', 'Found', '');
        break;
      case 'warp':
        if (e.me) fx.shake = Math.max(fx.shake, 0.15);
        break;
      case 'portal':
        if (e.at) fx.ring(e.at, e.which ? '#3c96be' : '#e6fbff', 3, 0.4);
        break;
      case 'swallow':
        fx.burst(e.at, '#c9a2ff', 12, 2, 0.5, 0.1);
        break;
      case 'freeze':
        fx.burst(e.at, '#bfefff', 18, 3, 0.6, 0.1);
        break;
      case 'speak':
        subtitle(e.who, e.text, e.name);
        break;
      default:
        break;
    }
  }
  g.events.length = 0;
}

// ------------------------------------------------------------------ loop

const PRESS = ['jumpPress', 'firePress'];

function mergePress(a, b) {
  if (!a) return { ...b, worm: [...(b.worm || [false, false])] };
  for (const k of PRESS) a[k] = a[k] || b[k];
  a.worm = [a.worm[0] || b.worm[0], a.worm[1] || b.worm[1]];
  a.cycle = (a.cycle || 0) + (b.cycle || 0);
  if (b.pick != null) a.pick = b.pick;
  return a;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  frames.n++;
  frames.t += dt;
  if (frames.t >= 1) {
    frames.fps = Math.round(frames.n / frames.t);
    frames.n = 0;
    frames.t = 0;
    if (state === 'play' && settings.quality === 'auto' && !autoLow) {
      slowSeconds = frames.fps < 40 ? slowSeconds + 1 : 0;
      if (slowSeconds >= 3) {
        autoLow = true;
        applySettings();
      }
    }
  }
  menuKeys();
  const g = game;
  let cam;
  if (state === 'play' && g) {
    const it = input.intent(dt);
    if (it.pausePress) {
      pause();
      return;
    }
    // Looking answers the mouse at the display's rate, not the physics'.
    g.bot.yaw += it.look[0];
    g.bot.pitch = clamp(g.bot.pitch + it.look[1], -MOVE.lookMax, MOVE.lookMax);
    // A press goes to the first physics step after it, once; if a frame has no
    // step (a display faster than the physics), it waits for the next.
    pending = mergePress(pending, it);
    const hold = { ...it, jumpPress: false, firePress: false, worm: [false, false], cycle: 0, pick: null };
    acc += dt;
    while (acc >= PHYSICS_DT) {
      prevPos = [...g.bot.pos];
      g.step(PHYSICS_DT, pending ? { ...hold, ...pending } : hold);
      pending = null;
      acc -= PHYSICS_DT;
      if (g.state !== 'play') break;
    }
    events();
    if (g.boss && !lastBoss) lastBoss = true;
    if (g.state === 'down') levelDown();
    else if (g.state === 'cleared') levelCleared();
    audio.setAction?.(Math.min(0.6, g.enemies.filter((e) => e.awake && e.seen).length * 0.12));
    fx.step(dt);
    const k = acc / PHYSICS_DT;
    const pos = prevPos && dist(prevPos, g.bot.pos) < 2 ? lerp(prevPos, g.bot.pos, k) : g.bot.pos;
    const bob = g.bot.onGround ? Math.sin(g.bot.bob * 2) * 0.035 * Math.min(1, Math.hypot(g.bot.vel[0], g.bot.vel[2]) / 6) : 0;
    const shake = fx.shake > 0 ? [(Math.random() - 0.5) * fx.shake * 0.2, (Math.random() - 0.5) * fx.shake * 0.2] : [0, 0];
    cam = { eye: [pos[0], pos[1] + g.bot.eye + bob, pos[2]], yaw: g.bot.yaw + shake[0] * 0.1, pitch: g.bot.pitch + shake[1] * 0.1 };
    if (performance.now() > sayUntil) $('subtitle').hidden = true;
    hud();
  } else if (g) {
    // Behind a menu: the level drifts past, the camera turning slowly over it.
    fx.step(dt);
    const t = now / 1000;
    const s = g.bp.spawn;
    const yaw = s.yaw + Math.sin(t * 0.07) * 0.9;
    cam = { eye: [s.p[0], s.p[1] + 2.4 + Math.sin(t * 0.2) * 0.4, s.p[2]], yaw, pitch: -0.08 + Math.sin(t * 0.11) * 0.06 };
    if (state === 'paused') cam = { eye: [g.bot.pos[0], g.bot.pos[1] + g.bot.eye, g.bot.pos[2]], yaw: g.bot.yaw, pitch: g.bot.pitch };
    g.world.step(dt * 0.5);
  }
  if (!g || !cam) return;
  renderer.clearList();
  const weather = g.bp.theme.rain ? 'rain' : g.bp.def.key === 'ridge' ? 'snow' : null;
  fx.weatherStep(dt, cam.eye, weather, now / 1000);
  art.lastEye = cam.eye;
  art.frame(g, fx, { time: now / 1000, aimLine: settings.aimLine && state === 'play', eye: cam.eye, weather });
  renderer.frame(cam, g.openEnds, {
    time: now / 1000,
    viewmodel: state === 'play' || state === 'paused' ? (r) => art.viewmodel(r, g, { time: now / 1000 }) : null,
  });
}

// --------------------------------------------------------------- the keys

function menuKeys() {
  if (input.took('m') || input.took('M')) {
    settings.muted = !settings.muted;
    saveSettings();
    audio.setMuted(settings.muted);
  }
  if (input.took('f') || input.took('F')) toggleFullscreen();
  if (input.took('p') || input.took('P') || input.took('Escape')) {
    if (state === 'play') pause();
    else if (state === 'paused') resume();
  }
}

// When the mouse is let go (Esc in the browser), play pauses rather than going on blind.
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'play' && input.device !== 'touch') pause();
});
canvas.addEventListener('click', () => {
  if (state === 'play') input.lock();
});

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (_) {
    // Some browsers refuse; nothing else to do.
  }
}

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// For the tools: the state, the game, and a way to start any level.
window.__vector = {
  get state() {
    return state;
  },
  get game() {
    return game;
  },
  startLevel: (id, opts = {}) => {
    mode = 'single';
    startLevel(id, opts);
  },
  showTitle,
  showCard,
  showEnding,
  renderer,
  input,
  audio,
  art,
  fx,
  level,
  BOSS_INTRO,
};

showTitle();
requestAnimationFrame(frame);
