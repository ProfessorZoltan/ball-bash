// Defector: the page. The state machine (title, level card, play, pause,
// out of shields, cleared), the fixed 240 Hz loop, the HUD and the menus.
// It is the sequel's only DOM module besides the renderer and input: the
// game itself (game.js) never touches the page.
import { PHYSICS_DT, DIFFICULTIES, DEFAULT_DIFFICULTY, GAME_MARK, GAME_VERSION, SEQUEL_NAME, SEQUEL_TAGLINE, SEQUEL_LIT, STORE, POWERUPS, BOSS_INTRO } from './config.js';
import { LEVEL_DEFS, level } from './levels.js';
import { BOSSES } from './bosses.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { DefectorAudio } from './audio.js';
import { SEQUEL_TRACKS } from './tracks.js';
import { placeEnd } from './wormholes.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new DefectorAudio();

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

const settings = { difficulty: DEFAULT_DIFFICULTY, muted: false, quality: 'high', aimLine: true, ...load(STORE.settings, {}) };
let run = load(STORE.run, null); // the campaign in progress, if any
const cleared = new Set(load(STORE.cleared, []));
const best = load(STORE.best, {});

function saveSettings() {
  save(STORE.settings, settings);
}

function difficulty() {
  return DIFFICULTIES.find((d) => d.id === settings.difficulty) || DIFFICULTIES.find((d) => d.id === DEFAULT_DIFFICULTY);
}

// ------------------------------------------------------------------ state

let state = 'title'; // title, card, play, paused, down, cleared, done
let game = null;
let mode = 'single'; // 'campaign' or 'single'
let levelId = 1;
let acc = 0;
let last = 0;
let clock = 0;
let bannerT = 0;

function def(id) {
  return LEVEL_DEFS.find((l) => l.id === id);
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function markHtml() {
  return [...GAME_MARK].map((ch, i) => `<span class="g${SEQUEL_LIT.includes(i) || i >= 14 ? ' lit' : ''}">${ch.replace('<', '&lt;').replace('>', '&gt;')}</span>`).join('');
}

// ------------------------------------------------------------------ music

function playMusic(key) {
  const t = SEQUEL_TRACKS[key];
  if (!t || !audio.ready) return;
  if (audio.track && audio.track.title === t.title) return;
  audio.playTrack(t);
}

async function unlockAudio() {
  await audio.init();
  audio.setMuted(settings.muted);
}

// ------------------------------------------------------------------ flow

/** Start level `id`, fresh or from a checkpoint (a continue), in the current mode. */
function startLevel(id, opts = {}) {
  levelId = id;
  const L = def(id);
  const bp = level(id);
  const d = difficulty();
  const carry = mode === 'campaign' && run ? run : null;
  game = new Game(bp, {
    shields: opts.shields ?? (carry ? carry.pool : d.shields),
    maxShields: d.shields,
    checkpoint: opts.checkpoint ?? -1,
    ammo: opts.ammo ?? (carry ? carry.ammo : undefined),
    loaded: opts.loaded ?? (carry ? carry.loaded : undefined),
    stats: opts.stats,
  });
  renderer.setLevel(bp);
  renderer.resize();
  acc = 0;
  state = 'play';
  input.reset();
  input.pressed.clear();
  $('overlay').hidden = true;
  $('hud').hidden = false;
  audio.bossTime(false);
  playMusic(L.track);
}

function showCard(id) {
  levelId = id;
  const L = def(id);
  const boss = BOSSES[L.boss];
  state = 'card';
  $('hud').hidden = true;
  renderer.setLevel(level(id));
  renderer.resize();
  game = null;
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">LEVEL ${id}${mode === 'campaign' ? ' · CAMPAIGN' : ''}</div>
      <h2>${L.title}</h2>
      <p class="intro">${L.intro}</p>
      <p class="muted">Boss: <b>${boss.name}</b>, ${boss.epithet}.</p>
      <p class="record">${L.record}</p>
      <div class="row"><button id="go" class="primary">Start</button><button id="back">Back</button></div>
      <p class="hint">${input.device === 'pad' ? 'A to start · B to go back' : 'Enter to start · Esc to go back'}</p>
    </div>`);
  $('go').onclick = async () => {
    await unlockAudio();
    startLevel(id);
  };
  $('back').onclick = () => showTitle();
  focusFirst();
  playMusic(L.track);
}

function beginCampaign(fresh) {
  mode = 'campaign';
  if (fresh || !run) {
    const d = difficulty();
    run = { level: 1, pool: d.shields === Infinity ? 'inf' : d.shields, difficulty: d.id, continues: 0, time: 0, shieldsLost: 0, defeated: 0, secrets: 0, powerups: 0, ammo: null, loaded: 'std' };
    save(STORE.run, run);
  } else {
    settings.difficulty = run.difficulty;
  }
  run.pool = run.pool === 'inf' ? Infinity : run.pool;
  showCard(run.level);
}

function persistRun() {
  if (!run) return;
  save(STORE.run, { ...run, pool: run.pool === Infinity ? 'inf' : run.pool });
}

function levelCleared() {
  const g = game;
  const id = levelId;
  cleared.add(id);
  save(STORE.cleared, [...cleared]);
  const t = g.stats.time;
  const prev = best[id];
  if (!prev || t < prev) best[id] = t;
  save(STORE.best, best);
  audio.bossTime(false);
  audio.stopTrack(3);
  const rows = [
    ['Time', fmt(t), prev ? `best ${fmt(Math.min(prev, t))}` : 'first clear'],
    ['Shields lost', g.stats.shieldsLost, g.pool === Infinity ? 'unlimited pool' : `${g.pool} left`],
    ['Enemies stopped', g.stats.defeated, ''],
    ['Secrets found', `${g.stats.secrets} / ${g.stats.secretsTotal}`, ''],
    ['Power-ups taken', g.stats.powerups, ''],
    ['Continues', g.stats.continues || 0, ''],
  ];
  let next = '';
  if (mode === 'campaign') {
    run.time += t;
    run.shieldsLost += g.stats.shieldsLost;
    run.defeated += g.stats.defeated;
    run.secrets += g.stats.secrets;
    run.powerups += g.stats.powerups;
    run.continues += g.stats.continues || 0;
    run.pool = g.pool;
    run.ammo = { ...g.ammo };
    run.loaded = g.loaded;
    if (id >= LEVEL_DEFS.length) {
      campaignDone();
      return;
    }
    run.level = id + 1;
    persistRun();
    next = `<button id="next" class="primary">Level ${id + 1}: ${def(id + 1).title}</button>`;
  } else if (id < LEVEL_DEFS.length) next = `<button id="next" class="primary">Next: ${def(id + 1).title}</button>`;
  state = 'cleared';
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">LEVEL ${id} CLEARED</div>
      <h2>${def(id).title}</h2>
      <p class="record">${BOSSES[def(id).boss].name} is stopped.</p>
      ${statsTable(rows)}
      <div class="row">${next}<button id="again">Play it again</button><button id="menu">Title</button></div>
    </div>`, true);
  if ($('next')) $('next').onclick = () => showCard(id + 1);
  $('again').onclick = () => {
    if (mode === 'campaign') mode = 'single';
    showCard(id);
  };
  $('menu').onclick = () => showTitle();
  focusFirst();
}

function campaignDone() {
  const r = run;
  save(STORE.run, null);
  run = null;
  state = 'done';
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">THE SOURCE IS OPEN</div>
      <h2>Campaign complete</h2>
      <p class="intro">Ten programs stopped. The Defector walks out of the grid for good, into a world that was never sealed.</p>
      ${statsTable([
        ['Difficulty', difficulty().name, ''],
        ['Total time', fmt(r.time), ''],
        ['Shields lost', r.shieldsLost, ''],
        ['Enemies stopped', r.defeated, ''],
        ['Secrets found', r.secrets, ''],
        ['Continues used', r.continues, r.continues ? '' : 'start to finish on one pool'],
      ])}
      <div class="row"><button id="menu" class="primary">Title</button></div>
    </div>`, true);
  $('menu').onclick = () => showTitle();
  focusFirst();
}

function statsTable(rows) {
  return `<table class="stats"><thead><tr><th>What</th><th>Figure</th><th>Note</th></tr></thead><tbody>${rows.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td class="muted">${c}</td></tr>`).join('')}</tbody></table>`;
}

function levelDown() {
  const g = game;
  audio.bossTime(false);
  state = 'down';
  const cp = g.checkpoint >= 0;
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">OUT OF SHIELDS</div>
      <h2>Offline</h2>
      <p class="intro">The last shield is gone. A continue brings the robot back at ${cp ? (g.checkpoints[g.checkpoint].boss ? 'the boss\'s door' : 'the last checkpoint') : 'the start of the level'} with a full pool.</p>
      ${statsTable([
        ['Time', fmt(g.stats.time), ''],
        ['Shields lost', g.stats.shieldsLost, ''],
        ['Continues used', g.stats.continues || 0, ''],
      ])}
      <div class="row"><button id="cont" class="primary">Continue</button><button id="menu">Title</button></div>
    </div>`, true);
  $('cont').onclick = () => {
    const stats = { ...g.stats, continues: (g.stats.continues || 0) + 1 };
    const d = difficulty();
    if (mode === 'campaign' && run) {
      run.pool = d.shields;
      persistRun();
    }
    startLevel(levelId, { checkpoint: g.checkpoint, shields: d.shields, ammo: { ...g.ammo }, loaded: g.loaded, stats });
  };
  $('menu').onclick = () => showTitle();
  focusFirst();
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">PAUSED</div>
      <h2>${def(levelId).title}</h2>
      <div class="row"><button id="resume" class="primary">Resume</button><button id="restart">Back to the last checkpoint</button><button id="menu">Title</button></div>
      <details><summary>Controls</summary>${controlsTable()}</details>
    </div>`, true);
  $('resume').onclick = resume;
  $('restart').onclick = () => {
    const g = game;
    startLevel(levelId, { checkpoint: g.checkpoint, shields: g.pool, ammo: { ...g.ammo }, loaded: g.loaded, stats: { ...g.stats } });
  };
  $('menu').onclick = () => {
    if (mode === 'campaign' && run && game) {
      run.pool = game.pool;
      persistRun();
    }
    showTitle();
  };
  focusFirst();
}

function resume() {
  if (state !== 'paused') return;
  state = 'play';
  $('overlay').hidden = true;
  input.reset();
  last = performance.now();
}

// ------------------------------------------------------------------ title

function showTitle() {
  state = 'title';
  mode = 'single';
  game = null;
  $('hud').hidden = true;
  $('banner').hidden = true;
  renderer.setLevel(level(1));
  renderer.resize();
  const d = difficulty();
  const resumeLabel = run ? `Resume · Level ${run.level}` : null;
  const list = LEVEL_DEFS.map((L) => `<li tabindex="0" data-level="${L.id}"><span class="n">${L.id}</span><span>${L.title} <span class="tag">· ${BOSSES[L.boss].name}</span></span><span class="tag ${cleared.has(L.id) ? 'done' : ''}">${cleared.has(L.id) ? `cleared${best[L.id] ? ` · ${fmt(best[L.id])}` : ''}` : L.tier}</span></li>`).join('');
  overlay(`
    <div class="panel">
      <h1 class="mark" aria-label="${SEQUEL_NAME}">${markHtml()}</h1>
      <div class="reading">DEFECTOR</div>
      <p class="tagline">${SEQUEL_TAGLINE}<span class="version">v${GAME_VERSION}</span></p>
      <div class="cols">
        <div>
          <h3>Campaign</h3>
          <p class="small muted">Ten levels, one pool of shields carried from each to the next, and the power-ups you gather go with you.</p>
          <div class="row" style="justify-content:flex-start">
            ${resumeLabel ? `<button id="resume" class="primary">${resumeLabel}</button>` : ''}
            <button id="new" class="${resumeLabel ? '' : 'primary'}">New campaign</button>
          </div>
          <div class="field"><label for="diff">Difficulty</label><select id="diff">${DIFFICULTIES.map((x) => `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${x.name} · ${x.blurb}</option>`).join('')}</select></div>
          <div class="field"><label for="snd">Sound</label><select id="snd"><option value="on" ${settings.muted ? '' : 'selected'}>On</option><option value="off" ${settings.muted ? 'selected' : ''}>Off</option></select><label for="q">Quality</label><select id="q"><option value="high" ${settings.quality === 'high' ? 'selected' : ''}>High</option><option value="low" ${settings.quality === 'low' ? 'selected' : ''}>Low</option></select></div>
          <div class="field"><label for="aimline">Aim line</label><select id="aimline"><option value="on" ${settings.aimLine ? 'selected' : ''}>On</option><option value="off" ${settings.aimLine ? '' : 'selected'}>Off</option></select></div>
          <details><summary>Controls</summary>${controlsTable()}</details>
          <div class="row" style="justify-content:flex-start"><button id="deflector" title="Back to the first game">← Deflector</button></div>
        </div>
        <div>
          <h3>Play one level</h3>
          <ol class="levels">${list}</ol>
        </div>
      </div>
    </div>`);
  $('new').onclick = async () => {
    await unlockAudio();
    beginCampaign(true);
  };
  if ($('resume')) $('resume').onclick = async () => {
    await unlockAudio();
    beginCampaign(false);
  };
  $('diff').onchange = (e) => {
    settings.difficulty = e.target.value;
    saveSettings();
  };
  $('snd').onchange = async (e) => {
    settings.muted = e.target.value === 'off';
    saveSettings();
    await unlockAudio();
    audio.setMuted(settings.muted);
    playMusic('defector');
  };
  $('aimline').onchange = (e) => {
    settings.aimLine = e.target.value === 'on';
    saveSettings();
  };
  $('q').onchange = (e) => {
    settings.quality = e.target.value;
    saveSettings();
    renderer.setQuality(settings.quality === 'low');
  };
  $('deflector').onclick = () => {
    location.href = '../';
  };
  for (const li of document.querySelectorAll('.levels li')) {
    const go = async () => {
      await unlockAudio();
      mode = 'single';
      showCard(Number(li.dataset.level));
    };
    li.onclick = go;
    li.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    };
  }
  focusFirst();
  if (audio.ready) playMusic('defector');
}

function controlsTable() {
  const rows = [
    ['Move', 'A D (W S)', 'Left stick or d-pad'],
    ['Jump (hold for higher)', 'Space', 'A'],
    ['Run', 'Hold 2 while moving', 'Hold X while moving'],
    ['Aim the blaster', 'Mouse (point), or the arrow keys', 'Right stick (point)'],
    ['Fire', 'Left click or /', 'RT'],
    ['Open the light wormhole end', 'Q', 'LB'],
    ['Open the dark wormhole end', 'E', 'RB'],
    ['Cycle power-ups', '1', 'LT'],
    ['Drop through a thin platform', 'Hold S', 'Hold down'],
    ['Pause / mute / fullscreen', 'Esc or P / M / F', 'Start'],
  ];
  return `<table class="controls"><thead><tr><th>Action</th><th>Keyboard and mouse</th><th>Controller</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table>`;
}

function overlay(html, clear = false) {
  input.pressed.clear(); // nothing pressed before this screen acts on it
  const o = $('overlay');
  o.innerHTML = html;
  o.hidden = false;
  o.classList.toggle('clear', clear);
}

function focusFirst() {
  const b = document.querySelector('#overlay button.primary') || document.querySelector('#overlay button');
  if (b) b.focus();
}

/** Controller and keyboard on menus: Enter / A presses the focused button, up and down move between them. */
function menuKeys() {
  const o = $('overlay');
  if (o.hidden) return;
  const items = [...o.querySelectorAll('button, .levels li, select')];
  if (!items.length) return;
  const at = items.indexOf(document.activeElement);
  if (input.consume('ArrowDown') || input.consume('PadDown')) (items[(at + 1) % items.length] || items[0]).focus();
  if (input.consume('ArrowUp') || input.consume('PadUp')) (items[(at - 1 + items.length) % items.length] || items[0]).focus();
  if (input.consume('PadA')) {
    const el = document.activeElement;
    if (el && o.contains(el) && el.tagName !== 'SELECT') el.click();
  }
  if (input.consume('PadB') || input.consume('Backspace')) {
    if (state === 'paused') resume();
    else if (state === 'card') showTitle();
  }
}

// -------------------------------------------------------------------- HUD

function hud() {
  const h = game.hud();
  const L = def(levelId);
  $('hud-level').textContent = `${levelId} · ${L.title.toUpperCase()}`;
  $('hud-time').textContent = fmt(h.time);
  $('hud-secrets').textContent = `${h.secrets}/${h.secretsTotal}`;
  const max = difficulty().shields;
  if (h.pool === Infinity) $('hud-shields').textContent = '∞';
  else {
    const n = Math.max(h.pool, max === Infinity ? h.pool : max);
    let s = '';
    for (let i = 0; i < n; i++) s += i < h.pool ? '◆' : '<span class="gone">◆</span>';
    $('hud-shields').innerHTML = s;
  }
  const pu = POWERUPS.find((p) => p.id === h.loaded);
  $('hud-loaded').innerHTML = pu ? `<span style="color:${pu.color}">${pu.name.toUpperCase()}</span>` : 'STANDARD';
  const slots = [`<div class="slot has ${h.loaded === 'std' ? 'on' : ''}" style="color:#dffbff"><b>●</b>STD</div>`].concat(POWERUPS.map((p) => `<div class="slot ${h.ammo[p.id] ? 'has' : ''} ${h.loaded === p.id ? 'on' : ''}" style="color:${p.color}"><b>${p.glyph}</b>${h.ammo[p.id] || 0}</div>`));
  const html = slots.join('');
  if (html !== hud.lastAmmo) {
    $('hud-ammo').innerHTML = html;
    hud.lastAmmo = html;
  }
  $('hud-cycle').textContent = input.device === 'pad' ? 'LT cycles' : '1 cycles';
  $('hud-mute').textContent = settings.muted ? 'MUTED [M]' : '';
  if (h.boss) {
    $('hud-boss').hidden = false;
    $('hud-boss-name').textContent = h.boss.name.toUpperCase();
    $('hud-boss-bar').style.width = `${(100 * h.boss.hp) / h.boss.max}%`;
  } else $('hud-boss').hidden = true;
}

function banner(eyebrow, title, sub) {
  const b = $('banner');
  $('banner-eyebrow').textContent = eyebrow;
  $('banner-title').textContent = title;
  $('banner-sub').textContent = sub;
  b.hidden = true;
  void b.offsetWidth; // a reflow, so the animation starts over
  b.hidden = false;
  bannerT = BOSS_INTRO + 0.2;
}

// ------------------------------------------------------------------- loop

function events() {
  const g = game;
  let action = 0;
  for (const e of g.events) {
    audio.cue(e);
    if (e.s === 'fire' || e.s === 'pop' || e.s === 'hurt') action += 0.2;
    if (e.s === 'bossIntro') {
      const b = BOSSES[def(levelId).boss];
      banner('BOSS', b.name.toUpperCase(), b.epithet);
      audio.bossTime(true);
    }
    if (e.s === 'bossDown') audio.bossTime(false);
    if (e.s === 'down') setTimeout(() => state === 'play' && game === g && levelDown(), 1200);
    if (e.s === 'cleared') setTimeout(() => state === 'play' && game === g && levelCleared(), 900);
  }
  g.events.length = 0;
  if (action) audio.setAction(0.25 + action);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
  last = now;
  clock += dt;
  input.poll();
  if (input.consume('m') || input.consume('M')) {
    settings.muted = !settings.muted;
    saveSettings();
    audio.setMuted(settings.muted);
  }
  if (input.consume('f')) toggleFullscreen();
  if (state === 'play') {
    if (input.consume('Escape') || input.consume('p')) {
      pause();
    }
  } else if (state === 'paused') {
    if (input.consume('Escape') || input.consume('p')) resume();
  } else if (state === 'card' && input.consume('Escape')) showTitle();
  else input.consume('Escape');
  if (state !== 'play') menuKeys();
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) $('banner').hidden = true;
  }

  if (state === 'play' && game) {
    const bot = game.bot;
    const sh = renderer.worldToScreen(bot.shoulder.x, bot.shoulder.y);
    let it = input.intent({ aim: bot.aim, facing: bot.facing, origin: sh }, dt);
    acc += dt;
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 30) {
      game.step(PHYSICS_DT, it);
      // Presses and releases belong to the first step of the frame only.
      it = { ...it, jumpPressed: false, fire: false, worm: [false, false], cycle: false };
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 30) acc = 0;
    events();
    hud();
  } else if (state !== 'title' && state !== 'card') {
    input.swallow();
  }
  const alpha = state === 'play' ? acc / PHYSICS_DT : 1;
  if (game) {
    renderer.updateCamera(game, alpha, dt);
    const ui = { device: input.device };
    if (settings.aimLine && (state === 'play' || state === 'paused') && game.phase !== 'down' && game.phase !== 'cleared') {
      // Always up: where a shot goes, and where a wormhole end would open.
      ui.guide = game.guide();
      const line = game.sight();
      ui.sight = { line, place: placeEnd(game.world, line, 0) || placeEnd(game.world, line, 1) };
    }
    renderer.frame(game, alpha, clock, ui);
  } else {
    // The title and the level cards: the level drifting by behind the menu.
    const bp = renderer.bp;
    const x = bp.spawn.x + ((clock * 60) % Math.max(1, bp.width - 2000));
    renderer.lookAt(x, bp.spawn.y - 120);
    renderer.frame(null, 1, clock, {});
  }
}

function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  } catch (_) {
    // not allowed here; nothing to do
  }
}

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('blur', () => {
  if (state === 'play') pause();
});
$('hud-pause').onclick = () => pause();
// Any first key or click is the gesture the browser wants before it plays sound.
window.addEventListener('pointerdown', () => unlockAudio().then(() => state === 'title' && playMusic('defector')), { once: true });
window.addEventListener('keydown', () => unlockAudio().then(() => state === 'title' && playMusic('defector')), { once: true });

renderer.setQuality(settings.quality === 'low');
showTitle();
requestAnimationFrame(frame);

// For the browser tools (tools/sequel/): the game and a way in without the menus.
window.__defector = {
  get state() {
    return state;
  },
  get game() {
    return game;
  },
  startLevel: (id, opts) => {
    mode = 'single';
    startLevel(id, opts);
  },
  renderer,
  input,
  audio,
  level,
};
