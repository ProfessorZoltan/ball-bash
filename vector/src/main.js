// Vector: the page. The state machine (title, the story, a level's card,
// play, pause, out of shields, cleared, the ending), the fixed-step loop, the
// HUD and the menus. With the renderer, the art and the input it is the only
// part of the third game that touches the page: the game itself (game.js)
// never does.
import { PHYSICS_DT, DIFFICULTIES, DEFAULT_DIFFICULTY, GAME_MARK, GAME_VERSION, VECTOR_NAME, VECTOR_TAGLINE, VECTOR_LIT, STORE, POWERUPS, PICKS, BLASTER, MOVE, BOSS_INTRO, PLAYERS, MAX_PLAYERS, VERSUS } from './config.js';
import { LEVEL_DEFS, level, levelDef } from './levels.js';
import { MAPS, arenaMap } from './maps.js';
import { NET, MSG, HostLink, Mirror, GuestInputs } from './netplay.js';
import { NetClient, relayConfig, saveRelay } from '../../src/net.js';
import { BOSSES } from './bosses.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Art } from './art.js';
import { FX } from './fx.js';
import { Input } from './input.js';
import { VectorAudio } from './audio.js';
import { VECTOR_TRACKS } from './tracks.js';
import { STORY } from './story.js';
import { lerp, clamp, dist, sub, dot, add, scale, camBasis } from './math.js';

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

const settings = { difficulty: DEFAULT_DIFFICULTY, muted: false, music: 1, sfx: 1, quality: 'auto', aimLine: true, sens: 1, invert: false, autoRun: false, ...load(STORE.settings, {}) };
// The volumes wait on the engine until there is sound to set them on.
audio.setMusicVolume(settings.music);
audio.setSfxVolume(settings.sfx);
let run = load(STORE.run, null); // the campaign in progress, if any
const cleared = new Set(load(STORE.cleared, []));
const best = load(STORE.best, {});

function saveSettings() {
  save(STORE.settings, settings);
}

// Auto quality: High until the frame rate stays under 40 for three seconds of
// play, then Medium (no shadows, no bloom), and if it is still slow, Low for
// the rest of the session.
const QUALITIES = ['high', 'medium', 'low'];
let autoStep = 0; // how far Auto has stepped down: 0 High, 1 Medium, 2 Low
let slowSeconds = 0;

function applySettings() {
  input.sens = settings.sens;
  input.invert = settings.invert;
  input.autoRun = settings.autoRun;
  renderer.quality = settings.quality === 'auto' ? QUALITIES[autoStep] : QUALITIES.includes(settings.quality) ? settings.quality : 'high';
  renderer.resize();
}
applySettings();

function difficulty() {
  return DIFFICULTIES.find((d) => d.id === settings.difficulty) || DIFFICULTIES.find((d) => d.id === DEFAULT_DIFFICULTY);
}

// ------------------------------------------------------------------ state

let state = 'title'; // title, story, card, play, paused, down, cleared, done; room, mpmenu, mpend in multiplayer
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
let clickPick = null; // a power-up picked on the HUD with the mouse or a finger, for the next step

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

// What a footstep sounds like, by what the floor is made of.
const STEP_SURFACE = { grid: 'grid', panel: 'grid', wire: 'grid', screen: 'grid', lamp: 'grid', metal: 'metal', container: 'metal', hazard: 'metal', concrete: 'concrete', asphalt: 'concrete', brick: 'concrete', tile: 'concrete', rock: 'concrete', cracked: 'concrete', wood: 'wood', crate: 'wood', paper: 'wood', cloth: 'wood', grass: 'grass', leaf: 'grass', snow: 'snow', water: 'water', glass: 'metal' };

/** A cue from the game, placed in space: panned toward where it happened, quieter far off. */
function cue(e) {
  if (!audio.ready) return;
  // A boss's own moves that sound like something the audio already knows.
  if (e.s === 'pour') e = { ...e, s: 'rumble' };
  if (e.s === 'step') {
    const roles = (bp && bp.theme.roles) || {};
    const mat = e.surface || (roles[e.role] && roles[e.role].mat) || 'panel';
    e.surface = STEP_SURFACE[mat] || 'concrete';
  }
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
    ${volumeHtml()}
    <div class="field"><label for="snd">Sound</label><select id="snd"><option value="on" ${settings.muted ? '' : 'selected'}>On</option><option value="off" ${settings.muted ? 'selected' : ''}>Off</option></select>
      <label for="q">Quality</label><select id="q"><option value="auto" ${q === 'auto' ? 'selected' : ''}>Auto${autoStep ? ` (${QUALITIES[autoStep]})` : ''}</option><option value="high" ${q === 'high' ? 'selected' : ''}>High</option><option value="medium" ${q === 'medium' ? 'selected' : ''}>Medium</option><option value="low" ${q === 'low' ? 'selected' : ''}>Low</option></select></div>
    <div class="field"><label for="sens">Mouse</label><input id="sens" type="range" min="0.3" max="3" step="0.05" value="${settings.sens}" /><label for="inv">Look</label><select id="inv"><option value="no" ${settings.invert ? '' : 'selected'}>Normal</option><option value="yes" ${settings.invert ? 'selected' : ''}>Inverted</option></select></div>
    <div class="field"><label for="aimline">Aim line</label><select id="aimline"><option value="on" ${settings.aimLine ? 'selected' : ''}>On</option><option value="off" ${settings.aimLine ? '' : 'selected'}>Off</option></select>
      <label for="runmode">Run</label><select id="runmode"><option value="hold" ${settings.autoRun ? '' : 'selected'}>Hold Shift</option><option value="auto" ${settings.autoRun ? 'selected' : ''}>By default</option></select></div>`;
}

/** The music's volume and, separately, the sound effects', as two sliders: on the title, the pause screen and the room. */
function volumeHtml() {
  const pc = (v) => Math.round(v * 100);
  const row = (id, label, v) => `<div class="field vols"><label for="${id}">${label}</label><input id="${id}" type="range" min="0" max="100" step="1" value="${pc(v)}" /><span class="pc" id="${id}-pc">${pc(v)}%</span></div>`;
  return row('vol-music', 'Music', settings.music) + row('vol-sfx', 'Effects', settings.sfx);
}

function wireVolume() {
  const slider = (id, key, set) => {
    const el = $(id);
    if (!el) return;
    el.oninput = (e) => {
      settings[key] = Number(e.target.value) / 100;
      set(settings[key]);
      $(`${id}-pc`).textContent = `${e.target.value}%`;
    };
    el.onchange = () => saveSettings();
  };
  slider('vol-music', 'music', (v) => audio.setMusicVolume(v));
  slider('vol-sfx', 'sfx', (v) => audio.setSfxVolume(v));
  // Let go of the effects slider and hear how loud they are now.
  const sfx = $('vol-sfx');
  if (sfx) sfx.addEventListener('change', () => cue({ s: 'powerup', me: true }));
}

function wireSettings() {
  wireVolume();
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

function showTitle(note = '') {
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
          <div class="mp">
            <h3>Multiplayer</h3>
            <p class="small muted">Up to three, each on their own screen: co-op through the campaign's levels, each robot on its own shields, or versus in four arenas of their own.</p>
            <div class="field"><label for="mp-name">Your name</label><input id="mp-name" type="text" maxlength="16" value="${escapeHtml(myName())}" /></div>
            <div class="row" style="justify-content:flex-start">
              <button id="mp-host">Host a room</button>
              <input id="mp-code" class="code" type="text" maxlength="4" placeholder="CODE" aria-label="Room code" value="${escapeHtml(joinCode)}" />
              <button id="mp-join">Join</button>
            </div>
            <div id="mp-status" class="status">${escapeHtml(note)}</div>
            <details><summary>Relay</summary><div class="field"><label for="mp-relay">Address</label><input id="mp-relay" type="text" placeholder="the default, or 'local'" value="${escapeHtml(savedRelay())}" /></div><p class="hint">Friends on other networks meet through the online relay; on one Wi-Fi, open the game from <code>npm start</code> and put <code>local</code> here.</p></details>
          </div>
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
  const keepName = () => save(STORE.name, $('mp-name').value.trim().slice(0, 16));
  $('mp-name').onchange = keepName;
  $('mp-relay').onchange = (e) => saveRelay(e.target.value.trim());
  $('mp-host').onclick = async () => {
    keepName();
    await unlockAudio();
    openRoom(true);
  };
  $('mp-join').onclick = async () => {
    keepName();
    const code = $('mp-code').value.trim().toUpperCase();
    if (code.length !== 4) {
      $('mp-status').textContent = 'A room code is four letters.';
      return;
    }
    await unlockAudio();
    openRoom(false, code);
  };
  // Typing a name or a code is not playing: keys there are not the game's.
  $('mp-code').onkeydown = (e) => {
    if (e.key === 'Enter') $('mp-join').click();
    e.stopPropagation();
  };
  $('mp-name').onkeydown = (e) => e.stopPropagation();
  $('mp-relay').onkeydown = (e) => e.stopPropagation();
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
  if (g.mode === 'versus') {
    put('hud-level', `VERSUS · ${bp.title}`);
    put('hud-time', fmt(g.time));
  } else {
    const L = levelDef(levelId);
    put('hud-level', `${levelId} · ${L.title}${g.mode === 'coop' ? ' · CO-OP' : ''}`);
    put('hud-time', fmt(g.stats.time));
  }
  $('hud-secrets').hidden = $('hud-secrets-label').hidden = g.mode === 'versus';
  put('hud-secrets', `${g.stats.secrets}/${bp.secrets}`);
  // Everyone's shields, in their colours, under your own.
  put('hud-team', g.multi ? g.players.map((p) => `<span class="who ${p.out ? 'out' : ''}" style="color:${PLAYERS[p.slot].color}">${escapeHtml(p.name)} ${p.out ? 'OUT' : Number.isFinite(p.shields) ? '◆'.repeat(Math.min(p.shields, 9)) : '∞'}</span>`).join('') : '', true);
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
  // Through the next physics step, as a key would: in multiplayer the host's game is the one that loads it.
  if (s && game) clickPick = PICKS.indexOf(s.dataset.pick);
});
$('hud-pause').onclick = () => (mp ? mpMenu() : pause());
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

// ------------------------------------------------------------ multiplayer
//
// A room is a relay room (src/net.js) with Vector's own messages in it
// (netplay.js). It lasts until you leave it: a match ends back in the room,
// with the same people. The host picks the mode (co-op on a level, or versus
// in an arena) and starts; the host's page runs the one real game and the
// guests' pages mirror it, each predicting its own robot.

let net = null; // the connection, while in a room
let room = null; // { host, code, players: [{ slot, id, name }], pick, playing, match }
let mp = null; // the match being played: { host, msg, link | mirror and inputs, ... }
let joinCode = (new URLSearchParams(location.search).get('room') || '').toUpperCase().slice(0, 4);
let helloTimer = 0;

function escapeHtml(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function myName() {
  return String(load(STORE.name, '') || 'Player').slice(0, 16) || 'Player';
}

function savedRelay() {
  try {
    return localStorage.getItem('deflector.relay') || '';
  } catch (_) {
    return '';
  }
}

/** What the host last picked, or co-op on the first level. */
function defaultPick() {
  return { mode: 'coop', level: 1, difficulty: settings.difficulty, map: MAPS[0].id, shields: VERSUS.shields, ...load(STORE.room, {}) };
}

function mpStatus(text) {
  const el = $('mp-status');
  if (el) el.textContent = text;
}

/** Open the connection and make (host) or join (guest, with `code`) a room. */
async function openRoom(host, code = '') {
  if (net) return;
  mpStatus('Looking for the relay…');
  const info = await NetClient.available();
  if (!info) {
    mpStatus('No relay answers, so there is nowhere to meet. Check the relay address, or play on one Wi-Fi from npm start.');
    return;
  }
  const where = info.online ? `the online relay (${relayConfig()?.label || 'default'})` : "this machine's LAN server";
  mpStatus(`Connecting through ${where}…`);
  const n = new NetClient();
  try {
    await n.connect(host ? { create: true } : { room: code });
  } catch (e) {
    mpStatus(e.message || 'Could not connect.');
    return;
  }
  net = n;
  wireNet(n);
  if (host) n.create(myName());
  else n.join(code, myName());
}

function wireNet(n) {
  n.on('created', () => {
    room = { host: true, code: n.code, players: [{ slot: 0, id: 'a', name: myName() }], pick: defaultPick(), playing: false, match: 0 };
    showRoom();
  });
  n.on('joined', () => {
    room = { host: false, code: n.code, players: [], pick: null, playing: false };
    n.send({ t: MSG.hello, v: NET.version, id: n.id, name: myName() });
    clearTimeout(helloTimer);
    // A room whose host never answers is not a Vector room (or not this version of it).
    helloTimer = setTimeout(() => room && !room.players.length && leaveRoom('That room did not answer: it is not a Vector room, or its host is on another version.'), 5000);
    showRoom();
  });
  n.on('error', (m) => {
    if (!room) {
      leaveRoom(m.msg || 'The relay refused.');
      return;
    }
    banner('ROOM', 'Relay', m.msg || '');
  });
  n.on('close', () => net === n && leaveRoom('The connection closed.'));
  n.on('peer-left', (m) => {
    if (!room) return;
    if (!room.host) {
      if (m.id === 'a') leaveRoom('The host left, and the room with them.');
      return;
    }
    const gone = room.players.find((p) => p.id === m.id);
    if (!gone) return;
    room.players = room.players.filter((p) => p.id !== m.id);
    if (mp && game) {
      // In a match, their robot simply goes; out of one, everyone after them moves up a place.
      const pl = game.players[mp.slotOf.get(m.id)];
      if (pl && !pl.out) {
        pl.out = true;
        game.closeEnd(0, pl, true);
        game.closeEnd(1, pl, true);
        game.emit({ s: 'left', slot: pl.slot, name: pl.name });
      }
    } else room.players.forEach((p, i) => (p.slot = i));
    sendRoom();
    if (state === 'room') showRoom();
    else banner('ROOM', `${gone.name} left`, '');
  });
  n.on(MSG.hello, (m) => room && room.host && onHello(m));
  n.on(MSG.room, (m) => {
    if (!room || room.host) return;
    clearTimeout(helloTimer);
    room.players = m.players;
    room.pick = m.pick;
    room.playing = m.playing;
    if (state === 'room') showRoom();
  });
  n.on(MSG.no, (m) => room && !room.host && m.to === n.id && leaveRoom(m.why));
  n.on(MSG.start, (m) => room && !room.host && beginMatch(m));
  n.on(MSG.input, (m) => {
    if (!mp || !mp.host) return;
    const slot = mp.slotOf.get(m.id);
    if (slot != null) mp.link.input(slot, m);
  });
  n.on(MSG.snap, (m) => mp && !mp.host && mp.mirror.receive(m, performance.now() / 1000));
  n.on(MSG.end, (m) => room && !room.host && mp && showResult(m.result));
  n.on(MSG.back, () => room && !room.host && backToRoom());
}

/** Host: a guest has said hello. Into the room if there is a place and they are on this version. */
function onHello(m) {
  const refuse = (why) => net.send({ t: MSG.no, to: m.id, why });
  if (m.v !== NET.version) return refuse(`This room is on a different version of Vector (${GAME_VERSION}). Reload the page to get the same one.`);
  if (room.players.some((p) => p.id === m.id)) return sendRoom();
  if (room.players.length >= MAX_PLAYERS) return refuse('That room is full.');
  const used = new Set(room.players.map((p) => p.slot));
  const slot = [0, 1, 2].find((k) => !used.has(k));
  room.players.push({ slot, id: m.id, name: String(m.name || 'Player').slice(0, 16) });
  room.players.sort((a, b) => a.slot - b.slot);
  sendRoom();
  if (state === 'room') showRoom();
  else banner('ROOM', `${m.name || 'A player'} joined`, 'in the next match');
}

function sendRoom() {
  if (net && room && room.host) net.send({ t: MSG.room, v: NET.version, players: room.players, pick: room.pick, playing: !!mp });
}

/** Leave the room (and the match, if one is on) for the title, saying why. */
function leaveRoom(why = '') {
  clearTimeout(helloTimer);
  const n = net;
  net = null;
  room = null;
  mp = null;
  if (n) {
    try {
      n.leave();
      n.close();
    } catch (_) {
      // already gone
    }
  }
  audio.bossTime?.(false);
  game = null;
  showTitle(why);
}

/** The room: who is in it, and (for the host) what to play. */
function showRoom() {
  state = 'room';
  mp = null;
  input.unlock();
  document.body.classList.remove('playing');
  $('hud').hidden = true;
  $('crosshair').hidden = true;
  $('tags').innerHTML = '';
  const pick = room && room.pick;
  const want = pick && pick.mode === 'versus' ? `vs-${pick.map === 'random' ? MAPS[0].id : pick.map}` : (pick && pick.level) || 1;
  if (!game || game.bp.id !== want) {
    bp = pick && pick.mode === 'versus' ? arenaMap(pick.map === 'random' ? MAPS[0].id : pick.map) : level((pick && pick.level) || 1);
    game = new Game(bp, { shields: 1, maxShields: 1 });
    renderer.setLevel(bp, game.world);
  }
  renderer.resize();
  if (!room) return;
  const me = net && net.id;
  const list = [0, 1, 2]
    .map((k) => {
      const p = room.players.find((q) => q.slot === k);
      if (!p) return `<li class="empty"><span class="dot" style="color:${PLAYERS[k].color};opacity:0.25"></span><span>Waiting for a player…</span><span></span></li>`;
      const tags = [p.id === 'a' ? 'HOST' : '', p.id === me ? 'YOU' : ''].filter(Boolean).join(' · ');
      return `<li><span class="dot" style="color:${PLAYERS[k].color}"></span><span style="color:${PLAYERS[k].color}">${escapeHtml(p.name)}</span><span class="tag">${tags}</span></li>`;
    })
    .join('');
  const share = `${location.origin}${location.pathname}?room=${room.code}`;
  let picks = '';
  if (!pick) picks = '<p class="muted">Joining…</p>';
  else if (room.host) {
    const levels = LEVEL_DEFS.map((L) => `<option value="${L.id}" ${L.id === pick.level ? 'selected' : ''}>${L.id} · ${L.title}</option>`).join('');
    const diffs = DIFFICULTIES.map((x) => `<option value="${x.id}" ${x.id === pick.difficulty ? 'selected' : ''}>${x.name}</option>`).join('');
    const maps = [...MAPS.map((m) => `<option value="${m.id}" ${m.id === pick.map ? 'selected' : ''}>${m.title}</option>`), `<option value="random" ${pick.map === 'random' ? 'selected' : ''}>A different one each match</option>`].join('');
    const shields = VERSUS.shieldChoices.map((n) => `<option value="${n}" ${n === pick.shields ? 'selected' : ''}>${n}</option>`).join('');
    const map = MAPS.find((m) => m.id === pick.map);
    picks =
      `<div class="field"><label for="rp-mode">Mode</label><select id="rp-mode"><option value="coop" ${pick.mode === 'coop' ? 'selected' : ''}>Co-op · the campaign's levels, together</option><option value="versus" ${pick.mode === 'versus' ? 'selected' : ''}>Versus · every robot for itself</option></select></div>` +
      (pick.mode === 'coop'
        ? `<div class="field"><label for="rp-level">Level</label><select id="rp-level">${levels}</select></div><div class="field"><label for="rp-diff">Difficulty</label><select id="rp-diff">${diffs}</select></div><p class="blurb">Each robot has its own shields. One who runs out is out until a teammate reaches a checkpoint or the boss, then back with one shield.</p>`
        : `<div class="field"><label for="rp-map">Arena</label><select id="rp-map">${maps}</select></div>${map ? `<p class="blurb">${map.blurb}</p>` : ''}<div class="field"><label for="rp-shields">Shields</label><select id="rp-shields">${shields}</select></div><p class="blurb">Last robot with shields wins. A power-up appears every 30 to 60 seconds, never nearer one robot than half as far as the next.</p>`);
  } else {
    const L = LEVEL_DEFS.find((x) => x.id === pick.level);
    const map = MAPS.find((m) => m.id === pick.map);
    picks =
      pick.mode === 'coop'
        ? `<p><b>Co-op</b> · level ${pick.level}, ${escapeHtml(L ? L.title : '')} · ${escapeHtml((DIFFICULTIES.find((x) => x.id === pick.difficulty) || {}).name || '')}</p>`
        : `<p><b>Versus</b> · ${pick.map === 'random' ? 'a different arena each match' : escapeHtml(map ? map.title : '')} · ${pick.shields} shields each</p>`;
    picks += `<p class="muted">${room.playing ? 'A match is on: you are in the next one.' : 'Waiting for the host to start.'}</p>`;
  }
  const canStart = room.host && pick && (pick.mode === 'coop' || room.players.length >= 2);
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">MULTIPLAYER · ROOM</div>
      <div class="roomcode">${escapeHtml(room.code || '····')}</div>
      <div class="share">Share the code, or the link: <a href="${escapeHtml(share)}" target="_blank" rel="noopener">${escapeHtml(share)}</a></div>
      <ul class="roster">${list}</ul>
      <div class="picks">${picks}</div>
      ${volumeHtml()}
      <div class="row">${room.host ? `<button id="rp-start" class="primary" ${canStart ? '' : 'disabled'}>${pick && pick.mode === 'versus' && room.players.length < 2 ? 'Versus needs two' : 'Start'}</button>` : ''}<button id="rp-leave">Leave the room</button></div>
    </div>`);
  $('rp-leave').onclick = () => leaveRoom();
  wireVolume();
  if (room.host && pick) {
    const set = (k, v) => {
      room.pick = { ...room.pick, [k]: v };
      save(STORE.room, room.pick);
      sendRoom();
      showRoom();
    };
    $('rp-mode').onchange = (e) => set('mode', e.target.value);
    if ($('rp-level')) $('rp-level').onchange = (e) => set('level', Number(e.target.value));
    if ($('rp-diff')) $('rp-diff').onchange = (e) => set('difficulty', e.target.value);
    if ($('rp-map')) $('rp-map').onchange = (e) => set('map', e.target.value);
    if ($('rp-shields')) $('rp-shields').onchange = (e) => set('shields', Number(e.target.value));
    $('rp-start').onclick = () => startMatch();
  }
  focusFirst();
  playMusic('vector');
}

/** Host: start a match with everyone in the room, with the picks (and, for a continue, a checkpoint). */
function startMatch(extra = {}) {
  if (!room || !room.host) return;
  const pick = room.pick;
  const roster = room.players.slice().sort((a, b) => a.slot - b.slot).map((p, i) => ({ id: p.id, name: p.name, slot: i }));
  const d = DIFFICULTIES.find((x) => x.id === pick.difficulty) || difficulty();
  let map = null;
  if (pick.mode === 'versus') {
    map = extra.map || pick.map;
    if (map === 'random') {
      const others = MAPS.filter((m) => !mp || !mp.msg || m.id !== mp.msg.map);
      map = others[Math.floor(Math.random() * others.length)].id;
    }
  }
  const shields = pick.mode === 'versus' ? pick.shields : d.shields;
  room.match = (room.match || 0) + 1; // each match its own number: see netplay.js
  const msg = { t: MSG.start, v: NET.version, match: room.match, mode: pick.mode, level: pick.level, map, roster, shields: shields === Infinity ? -1 : shields, checkpoint: extra.checkpoint ?? -1 };
  net.send(msg);
  beginMatch(msg);
  sendRoom();
}

/** Everyone: a match starts. */
async function beginMatch(msg) {
  const meEntry = msg.roster.find((p) => p.id === net.id);
  if (!meEntry) {
    // Joined while it was on: this one goes on without us.
    room.playing = true;
    if (state !== 'room') showRoom();
    return;
  }
  await unlockAudio();
  bp = msg.mode === 'versus' ? arenaMap(msg.map) : level(msg.level);
  const shields = msg.shields === -1 ? Infinity : msg.shields;
  game = new Game(bp, { mode: msg.mode, players: msg.roster.map((p) => ({ name: p.name })), local: meEntry.slot, shields, maxShields: shields, checkpoint: msg.checkpoint });
  mp = { host: room.host, msg, slotOf: new Map(msg.roster.map((p) => [p.id, p.slot])), snapT: 0, sendT: 0, ended: false };
  if (mp.host) mp.link = new HostLink(game, msg.match);
  else {
    mp.mirror = new Mirror(game, meEntry.slot, msg.match);
    mp.inputs = new GuestInputs(msg.match);
  }
  room.playing = true;
  if (msg.mode === 'coop') levelId = msg.level;
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
  audio.setHumanity?.(bp.humanity);
  audio.bossTime?.(false);
  if (msg.mode === 'versus') {
    const m = MAPS.find((x) => x.id === msg.map);
    banner('VERSUS', m.title, `${msg.roster.length} robots · ${msg.shields === -1 ? '∞' : msg.shields} shields each`);
    playMusic(bp.track);
  } else {
    const L = levelDef(msg.level);
    banner(`CO-OP · LEVEL ${msg.level}`, L.title, msg.roster.map((p) => p.name).join(', '), L.humanity > 0.85);
    playMusic(L.key);
  }
  input.lock();
  hud();
}

/**
 * One frame of a match: the host steps the game and sends snapshots; a guest
 * predicts its own robot and sends its inputs. Returns the camera.
 */
function mpFrame(dt, now) {
  const g = game;
  const me = g.me;
  let it = input.intent(dt);
  if (state === 'play' && it.pausePress) {
    mpMenu();
    it = input.intent(0);
  }
  if (clickPick != null) {
    it.pick = clickPick;
    clickPick = null;
  }
  const playing = state === 'play' && !me.out && g.state === 'play';
  if (playing) {
    me.bot.yaw += it.look[0];
    me.bot.pitch = clamp(me.bot.pitch + it.look[1], -MOVE.lookMax, MOVE.lookMax);
    pending = mergePress(pending, it);
  }
  const hold = playing ? { ...it, jumpPress: false, firePress: false, worm: [false, false], cycle: 0, pick: null } : { mx: 0, mz: 0 };
  acc += dt;
  if (mp.host) {
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 30) {
      prevPos = [...me.bot.pos];
      g.step(PHYSICS_DT, mp.link.intents(pending ? { ...hold, ...pending } : hold));
      pending = null;
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 30) acc = 0;
    mp.link.events(g.events);
    mp.snapT += dt;
    if (mp.snapT >= 1 / NET.snapHz) {
      mp.snapT = Math.min(mp.snapT - 1 / NET.snapHz, 1 / NET.snapHz);
      net.sendFast(mp.link.snapshot());
    }
    if (!mp.ended && g.state !== 'play') {
      mp.ended = true;
      setTimeout(() => mp && game === g && hostEnd(), 1400);
    }
  } else {
    let steps = 0;
    while (acc >= PHYSICS_DT && steps < 30) {
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 30) acc = 0;
    // A long frame goes as several records: the host takes at most 16 steps in one.
    const look = { yaw: me.bot.yaw, pitch: me.bot.pitch, turns: me.bot.turns };
    let first = true;
    while (steps > 0 || first) {
      const n = Math.min(steps, 8);
      const x = first && pending ? { ...hold, ...pending } : hold;
      const rec = mp.inputs.record({ ...x, ...look }, n);
      if (rec) {
        prevPos = [...me.bot.pos];
        mp.mirror.predict(rec);
      }
      steps -= n;
      first = false;
    }
    pending = null;
    mp.sendT += dt;
    if (mp.sendT >= 1 / NET.sendHz) {
      mp.sendT = 0;
      const m = mp.inputs.message();
      m.id = net.id;
      net.sendFast(m);
    }
    mp.mirror.show(now / 1000);
    mp.mirror.fade(dt);
  }
  events();
  fx.step(dt);
  hud();
  if (performance.now() > sayUntil) $('subtitle').hidden = true;
  // The camera: your own robot's eye, or while you are out, the nearest teammate's.
  let b = me.bot;
  if (me.out) {
    const n = g.nearest(b.pos);
    if (n) b = n.pl.bot;
  }
  const off = b === me.bot && b.drawOff ? b.drawOff : [0, 0, 0];
  const k = mp.host ? acc / PHYSICS_DT : 1;
  const pos = b === me.bot && prevPos && dist(prevPos, b.pos) < 2 ? lerp(prevPos, b.pos, k) : b.pos;
  const bob = b.onGround ? Math.sin(b.bob * 2) * 0.035 * Math.min(1, Math.hypot(b.vel[0], b.vel[2]) / 6) : 0;
  const shake = fx.shake > 0 ? [(Math.random() - 0.5) * fx.shake * 0.2, (Math.random() - 0.5) * fx.shake * 0.2] : [0, 0];
  return { eye: [pos[0] + off[0], pos[1] + off[1] + b.eye + bob, pos[2] + off[2]], yaw: b.yaw + shake[0] * 0.1, pitch: b.pitch + shake[1] * 0.1 };
}

/** Names over the other robots, where they are on screen. */
function nameTags(cam) {
  const box = $('tags');
  if (!game || !game.multi || !cam) {
    if (box.innerHTML) box.innerHTML = '';
    return;
  }
  const B = camBasis(cam.yaw, cam.pitch);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  let html = '';
  for (const pl of game.players) {
    if (pl.slot === game.local || pl.out) continue;
    const p = [pl.bot.pos[0], pl.bot.pos[1] + 1.35, pl.bot.pos[2]];
    const d = sub(p, cam.eye);
    const z = dot(d, B.fwd);
    if (z < 0.5) continue;
    // Where the robot is seen, a black hole's lens and all.
    const uv = renderer.seenAt(p);
    if (!uv) continue;
    const x = uv[0] * w;
    const y = (1 - uv[1]) * h;
    if (x < -50 || x > w + 50 || y < -20 || y > h + 20) continue;
    const L = Math.hypot(...d);
    const shields = Number.isFinite(pl.shields) ? '◆'.repeat(Math.min(pl.shields, 9)) : '∞';
    html += `<div class="tag" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;color:${PLAYERS[pl.slot].color};opacity:${clamp(1.4 - L / 60, 0.35, 1).toFixed(2)}">${escapeHtml(pl.name)}<i>${shields}</i></div>`;
  }
  if (box.innerHTML !== html) box.innerHTML = html;
}

/** Host: the level or the match is over. Tell everyone how it went. */
function hostEnd() {
  const g = game;
  const rows = g.players.map((p) => ({ slot: p.slot, name: p.name, lost: p.stats.lost, falls: p.stats.falls, powerups: p.stats.powerups, kills: p.stats.kills, hits: p.stats.hits, out: p.out }));
  let result;
  if (g.mode === 'versus') result = { kind: 'over', mode: 'versus', map: mp.msg.map, winner: g.winner, time: g.time, rows };
  else if (g.state === 'cleared') result = { kind: 'cleared', mode: 'coop', level: mp.msg.level, time: g.stats.time, secrets: g.stats.secrets, secretsTotal: g.bp.secrets, kills: g.stats.kills, rows };
  else result = { kind: 'down', mode: 'coop', level: mp.msg.level, checkpoint: g.checkpoint, time: g.time, rows };
  net.send({ t: MSG.end, result });
  showResult(result);
}

/** The end of a match, on every screen; the host chooses what next. */
function showResult(r) {
  state = 'mpend';
  input.unlock();
  document.body.classList.remove('playing');
  $('crosshair').hidden = true;
  $('tags').innerHTML = '';
  audio.bossTime?.(false);
  const who = (slot) => r.rows.find((x) => x.slot === slot);
  const colored = (row) => `<span style="color:${PLAYERS[row.slot].color}">${escapeHtml(row.name)}</span>`;
  let head;
  let table;
  if (r.kind === 'over') {
    const w = r.winner == null ? null : who(r.winner);
    head = `<div class="eyebrow">VERSUS · ${escapeHtml((MAPS.find((m) => m.id === r.map) || {}).title || '')}</div><h2>${w ? `${colored(w)} wins` : 'A draw'}</h2>`;
    table = `<table class="stats"><thead><tr><th>Robot</th><th>Hits</th><th>Shields lost</th><th>Falls</th><th>Power-ups</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${colored(x)}</td><td>${x.hits}</td><td>${x.lost}</td><td>${x.falls}</td><td>${x.powerups}</td></tr>`).join('')}</tbody></table>`;
  } else {
    const L = levelDef(r.level);
    head = r.kind === 'cleared' ? `<div class="eyebrow">CO-OP · LEVEL ${r.level} CLEARED</div><h2>${escapeHtml(L.title)}</h2><p class="record">${BOSSES[L.boss].name} is stopped. ${fmt(r.time)}, ${r.secrets} of ${r.secretsTotal} secrets.</p>` : `<div class="eyebrow">CO-OP · OUT OF SHIELDS</div><h2>The whole team is out</h2><p class="intro">A continue brings everyone back at ${r.checkpoint >= 0 ? 'the last checkpoint' : 'the start of the level'} with full shields.</p>`;
    table = `<table class="stats"><thead><tr><th>Robot</th><th>Machines stopped</th><th>Shields lost</th><th>Falls</th><th>Power-ups</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${colored(x)}</td><td>${x.kills}</td><td>${x.lost}</td><td>${x.falls}</td><td>${x.powerups}</td></tr>`).join('')}</tbody></table>`;
  }
  let buttons = '';
  if (room && room.host) {
    if (r.kind === 'over') buttons = '<button id="re-again" class="primary">Rematch</button><button id="re-other">Another arena</button>';
    else if (r.kind === 'cleared') buttons = `${r.level < LEVEL_DEFS.length ? `<button id="re-next" class="primary">Level ${r.level + 1}: ${escapeHtml(levelDef(r.level + 1).title)}</button>` : ''}<button id="re-again" ${r.level < LEVEL_DEFS.length ? '' : 'class="primary"'}>Play it again</button>`;
    else buttons = '<button id="re-cont" class="primary">Continue</button>';
    buttons += '<button id="re-room">Back to the room</button>';
  } else buttons = '<button id="re-leave">Leave the room</button>';
  overlay(`
    <div class="panel narrow">
      ${head}
      ${table}
      ${room && room.host ? '' : '<p class="hint">The host chooses what happens next.</p>'}
      <div class="row">${buttons}</div>
    </div>`, true);
  if ($('re-again')) $('re-again').onclick = () => startMatch(r.kind === 'over' ? { map: r.map } : {});
  if ($('re-other')) $('re-other').onclick = () => startMatch({ map: 'random' });
  if ($('re-next')) $('re-next').onclick = () => {
    room.pick = { ...room.pick, level: r.level + 1 };
    save(STORE.room, room.pick);
    startMatch();
  };
  if ($('re-cont')) $('re-cont').onclick = () => startMatch({ checkpoint: r.checkpoint });
  if ($('re-room')) $('re-room').onclick = () => {
    net.send({ t: MSG.back });
    backToRoom();
  };
  if ($('re-leave')) $('re-leave').onclick = () => leaveRoom();
  focusFirst();
}

function backToRoom() {
  mp = null;
  if (room) {
    room.playing = false;
    // Anyone who left during the match leaves a gap: everyone after them moves up a place.
    if (room.host) room.players.forEach((p, i) => (p.slot = i));
  }
  sendRoom();
  showRoom();
}

/** Esc in a match: nobody can pause a game others are playing, so this is a menu over it, and it plays on. */
function mpMenu() {
  if (state !== 'play') return;
  state = 'mpmenu';
  input.unlock();
  document.body.classList.remove('playing');
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">MULTIPLAYER · THE MATCH PLAYS ON</div>
      <h2>${escapeHtml(game.mode === 'versus' ? (MAPS.find((m) => m.id === mp.msg.map) || {}).title || 'Versus' : levelDef(levelId).title)}</h2>
      ${settingsHtml(true)}
      <div class="row"><button id="mm-back" class="primary">Back to it</button>${room && room.host ? '<button id="mm-end">End the match (everyone back to the room)</button>' : ''}<button id="mm-leave">Leave the room</button></div>
      <details><summary>Controls</summary>${controlsTable()}</details>
    </div>`, 'clear');
  wireSettings();
  $('mm-back').onclick = () => mpBack();
  if ($('mm-end')) $('mm-end').onclick = () => {
    net.send({ t: MSG.back });
    backToRoom();
  };
  $('mm-leave').onclick = () => leaveRoom();
  focusFirst();
}

function mpBack() {
  if (state !== 'mpmenu') return;
  state = 'play';
  overlay(null);
  document.body.classList.add('playing');
  input.reset();
  input.lock();
}

// ---------------------------------------------------------------- events

function events() {
  const g = game;
  for (const e of g.events) {
    // Whose it was: this client's own robot's, or someone else's (or the world's).
    if (e.slot != null) e.me = e.slot === g.local;
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
        if (!e.me) break;
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
        if (mode === 'campaign' && run && !mp) {
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
        if (e.at) fx.ring(e.at, PLAYERS[e.slot ?? 0].ends[e.which ? 1 : 0], 3, 0.4);
        break;
      // Multiplayer.
      case 'out':
        banner(e.me ? 'OUT OF SHIELDS' : 'A ROBOT IS DOWN', `${e.name} is out`, g.mode === 'coop' ? 'Back at the next checkpoint a teammate reaches, or the boss.' : '');
        break;
      case 'revive':
        banner('BACK IN', `${e.name} is back`, 'with one shield');
        if (e.at) fx.ring(e.at, PLAYERS[e.slot].color, 5);
        break;
      case 'left':
        banner('ROOM', `${e.name} left`, '');
        break;
      case 'go':
        banner('VERSUS', 'Go', '');
        break;
      case 'respawn':
      case 'brought':
        if (e.at) fx.ring(e.at, PLAYERS[e.slot].color, 4);
        break;
      case 'hitRobot':
        fx.burst(e.at, PLAYERS[e.by ?? 0].charge, 16, 4, 0.5, 0.12);
        break;
      case 'spawnPower': {
        const P = POWERUPS.find((x) => x.id === e.power);
        if (e.at) fx.ring(e.at, P ? P.color : '#ffffff', 4);
        break;
      }
      case 'over': {
        const w = e.winner == null ? null : g.players[e.winner];
        banner('VERSUS', w ? `${w.name} wins` : 'A draw', '');
        break;
      }
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
    if (state === 'play' && settings.quality === 'auto' && autoStep < QUALITIES.length - 1) {
      slowSeconds = frames.fps < 40 ? slowSeconds + 1 : 0;
      if (slowSeconds >= 3) {
        autoStep++;
        slowSeconds = 0;
        applySettings();
      }
    }
  }
  menuKeys();
  const g = game;
  let cam;
  if ((state === 'play' || state === 'mpmenu') && mp && g) {
    cam = mpFrame(dt, now);
  } else if (state === 'play' && g) {
    const it = input.intent(dt);
    if (it.pausePress) {
      pause();
      return;
    }
    if (clickPick != null) {
      it.pick = clickPick;
      clickPick = null;
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
  const inPlay = (state === 'play' || state === 'mpmenu') && !g.me.out;
  art.frame(g, fx, { time: now / 1000, aimLine: settings.aimLine && state === 'play' && !g.me.out, eye: cam.eye, weather });
  renderer.frame(cam, g.openEnds, {
    time: now / 1000,
    viewmodel: inPlay || state === 'paused' ? (r) => art.viewmodel(r, g, { time: now / 1000 }) : null,
  });
  aimMark(g, cam);
  nameTags(mp && (state === 'play' || state === 'mpmenu') ? cam : null);
}

/**
 * The crosshair sits where what the eye looks straight at is seen: in the
 * middle, unless a black hole's lens has bent the picture there, when it
 * goes with the picture, so it is still on what a shot is aimed at.
 */
function aimMark(g, cam) {
  let dx = 0;
  let dy = 0;
  if (renderer.lenses.length) {
    const B = camBasis(cam.yaw, cam.pitch);
    const hit = g.world.raycast(cam.eye, B.fwd, 400, { glass: 'through' });
    const uv = renderer.seenAt(add(cam.eye, scale(B.fwd, hit ? hit.t : 400)));
    if (uv) {
      dx = (uv[0] - 0.5) * canvas.clientWidth;
      dy = (0.5 - uv[1]) * canvas.clientHeight;
    }
  }
  const t = Math.abs(dx) + Math.abs(dy) > 0.5 ? `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` : '';
  const el = $('crosshair');
  if (el.style.transform !== t) el.style.transform = t;
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
    if (state === 'play' && mp) mpMenu();
    else if (state === 'mpmenu') mpBack();
    else if (state === 'play') pause();
    else if (state === 'paused') resume();
  }
}

// When the mouse is let go (Esc in the browser), play pauses rather than going on blind.
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'play' && input.device !== 'touch') {
    if (mp) mpMenu();
    else pause();
  }
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
  if (document.hidden && !mp) pause();
});

// For the tools: the state, the game, and a way to start any level.
window.__vector = {
  get state() {
    return state;
  },
  audio,
  get game() {
    return game;
  },
  startLevel: (id, opts = {}) => {
    mode = 'single';
    startLevel(id, opts);
  },
  // Multiplayer, for the browser tools: make or join a room, pick, start.
  get room() {
    return room;
  },
  get mp() {
    return mp;
  },
  get net() {
    return net;
  },
  host: (name) => {
    if (name) save(STORE.name, name);
    return openRoom(true);
  },
  join: (code, name) => {
    if (name) save(STORE.name, name);
    return openRoom(false, code);
  },
  pick: (p) => {
    room.pick = { ...room.pick, ...p };
    sendRoom();
    showRoom();
  },
  startMatch: (extra) => startMatch(extra),
  arenaMap,
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
