// Defector: the page. The state machine (title, level card, play, pause,
// out of shields, cleared), the fixed 240 Hz loop, the HUD and the menus.
// It is the sequel's only DOM module besides the renderer and input: the
// game itself (game.js) never touches the page.
import { PHYSICS_DT, DIFFICULTIES, DEFAULT_DIFFICULTY, GAME_MARK, GAME_VERSION, SEQUEL_NAME, SEQUEL_TAGLINE, SEQUEL_LIT, STORE, POWERUPS, BOSS_INTRO, PLAYERS, VERSUS, MAX_PLAYERS } from './config.js';
import { LEVEL_DEFS, level } from './levels.js';
import { MAPS, arenaMap } from './maps.js';
import { BOSSES } from './bosses.js';
import { Game } from './game.js';
import { NET, MSG, HostLink, Mirror, GuestInputs } from './netplay.js';
import { NetClient, relayConfig, saveRelay } from '../../src/net.js';
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

let state = 'title'; // title, card, play, paused, down, cleared, done; room, mpmenu, mpend in multiplayer
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
    // Power-ups belong to the level they were found in: each level starts on the standard charge.
    // (A continue or a return to a checkpoint is the same level, and keeps them.)
    ammo: opts.ammo,
    loaded: opts.loaded,
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
    run = { level: 1, pool: d.shields === Infinity ? 'inf' : d.shields, difficulty: d.id, continues: 0, time: 0, shieldsLost: 0, defeated: 0, secrets: 0, powerups: 0 };
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

function showTitle(note = '') {
  state = 'title';
  mode = 'single';
  game = null;
  mp = null;
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
          <p class="small muted">Ten levels and one pool of shields, carried from each level to the next. Power-ups stay in the level they were found in.</p>
          <div class="row" style="justify-content:flex-start">
            ${resumeLabel ? `<button id="resume" class="primary">${resumeLabel}</button>` : ''}
            <button id="new" class="${resumeLabel ? '' : 'primary'}">New campaign</button>
          </div>
          <div class="field"><label for="diff">Difficulty</label><select id="diff">${DIFFICULTIES.map((x) => `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${x.name} · ${x.blurb}</option>`).join('')}</select></div>
          <div class="field"><label for="snd">Sound</label><select id="snd"><option value="on" ${settings.muted ? '' : 'selected'}>On</option><option value="off" ${settings.muted ? 'selected' : ''}>Off</option></select><label for="q">Quality</label><select id="q"><option value="high" ${settings.quality === 'high' ? 'selected' : ''}>High</option><option value="low" ${settings.quality === 'low' ? 'selected' : ''}>Low</option></select></div>
          <div class="field"><label for="aimline">Aim line</label><select id="aimline"><option value="on" ${settings.aimLine ? 'selected' : ''}>On</option><option value="off" ${settings.aimLine ? '' : 'selected'}>Off</option></select></div>
          <details><summary>Controls</summary>${controlsTable()}</details>
          <div class="mp">
            <h3>Multiplayer</h3>
            <p class="small muted">Up to three, each on their own screen: co-op through the campaign's levels, each robot on its own shields, or versus on six maps of their own.</p>
            <div class="field"><label for="mp-name">Your name</label><input id="mp-name" type="text" maxlength="16" value="${escapeHtml(myName())}" /></div>
            <div class="row" style="justify-content:flex-start">
              <button id="mp-host">Host a room</button>
              <input id="mp-code" class="code" type="text" maxlength="4" placeholder="CODE" aria-label="Room code" value="${escapeHtml(joinCode)}" />
              <button id="mp-join">Join</button>
            </div>
            <div id="mp-status" class="status">${escapeHtml(note)}</div>
            <details><summary>Relay</summary><div class="field"><label for="mp-relay">Address</label><input id="mp-relay" type="text" placeholder="the default, or 'local'" value="${escapeHtml(savedRelay())}" /></div><p class="hint" style="text-align:left">Friends on other networks meet through the online relay; on one Wi-Fi, open the game from <code>npm start</code> and put <code>local</code> here.</p></details>
          </div>
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
  $('mp-code').onkeydown = (e) => {
    if (e.key === 'Enter') $('mp-join').click();
    e.stopPropagation();
  };
  $('mp-name').onkeydown = (e) => e.stopPropagation();
  $('mp-relay').onkeydown = (e) => e.stopPropagation();
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
    else if (state === 'mpmenu') {
      state = 'play';
      $('overlay').hidden = true;
    }
  }
}

// ------------------------------------------------------------ multiplayer
//
// A room is a relay room (src/net.js) with Defector's own messages in it
// (netplay.js). It lasts until you leave it: a match ends back in the room,
// with the same people. The host picks the mode (co-op on a level, or
// versus on a map) and starts; the host's page runs the one real game and
// the guests' pages mirror it, each predicting its own robot.

let net = null; // the connection, while in a room
let room = null; // { host, code, players: [{ slot, id, name }], pick, playing }
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
  const saved = load(STORE.room, {});
  return { mode: 'coop', level: 1, difficulty: settings.difficulty, map: MAPS[0].id, shields: VERSUS.shields, ...saved };
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
  const where = info.online ? `the online relay (${relayConfig()?.label || 'default'})` : 'this machine\'s LAN server';
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
    room = { host: true, code: n.code, players: [{ slot: 0, id: 'a', name: myName() }], pick: defaultPick(), playing: false };
    showRoom();
  });
  n.on('joined', () => {
    room = { host: false, code: n.code, players: [], pick: null, playing: false };
    n.send({ t: MSG.hello, v: NET.version, id: n.id, name: myName() });
    clearTimeout(helloTimer);
    // A room whose host never answers is not a Defector room (or not this version of it).
    helloTimer = setTimeout(() => room && !room.players.length && leaveRoom('That room did not answer: it is not a Defector room, or its host is on another version.'), 5000);
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
      const slot = mp.slotOf.get(m.id);
      const pl = game.players[slot];
      if (pl && !pl.out) {
        pl.out = true;
        game.closeEnd(null, pl);
        game.fx.word(pl.bot.x, pl.bot.top - 30, `${pl.name.toUpperCase()} LEFT`, pl.color, 1.6);
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
  if (m.v !== NET.version) return refuse(`This room is on a different version of Defector (${GAME_VERSION}). Reload the page to get the same one.`);
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
  audio.bossTime(false);
  showTitle(why);
}

/** The room: who is in it, and (for the host) what to play. */
function showRoom() {
  state = 'room';
  game = null;
  mp = null;
  $('hud').hidden = true;
  renderer.setLevel(room && room.pick && room.pick.mode === 'versus' ? arenaMap(room.pick.map === 'random' ? MAPS[0].id : room.pick.map) : level((room && room.pick && room.pick.level) || 1));
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
  const pick = room.pick;
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
        : `<div class="field"><label for="rp-map">Map</label><select id="rp-map">${maps}</select></div>${map ? `<p class="blurb">${map.blurb}</p>` : ''}<div class="field"><label for="rp-shields">Shields</label><select id="rp-shields">${shields}</select></div><p class="blurb">Last robot with shields wins. A power-up appears every 30 to 60 seconds, never nearer one robot than half as far as the next.</p>`);
  } else {
    const L = LEVEL_DEFS.find((x) => x.id === pick.level);
    const map = MAPS.find((m) => m.id === pick.map);
    picks =
      pick.mode === 'coop'
        ? `<p><b>Co-op</b> · level ${pick.level}, ${escapeHtml(L ? L.title : '')} · ${escapeHtml((DIFFICULTIES.find((x) => x.id === pick.difficulty) || {}).name || '')}</p>`
        : `<p><b>Versus</b> · ${pick.map === 'random' ? 'a different map each match' : escapeHtml(map ? map.title : '')} · ${pick.shields} shields each</p>`;
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
      <div class="row">${room.host ? `<button id="rp-start" class="primary" ${canStart ? '' : 'disabled'}>${pick && pick.mode === 'versus' && room.players.length < 2 ? 'Versus needs two' : 'Start'}</button>` : ''}<button id="rp-leave">Leave the room</button></div>
    </div>`);
  $('rp-leave').onclick = () => leaveRoom();
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
  playMusic('defector');
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
  const msg = { t: MSG.start, v: NET.version, mode: pick.mode, level: pick.level, map, roster, shields: shields === Infinity ? -1 : shields, checkpoint: extra.checkpoint ?? -1 };
  net.send(msg);
  beginMatch(msg);
  sendRoom();
}

/** Everyone: a match starts. */
function beginMatch(msg) {
  const meEntry = msg.roster.find((p) => p.id === net.id);
  if (!meEntry) {
    // Joined while it was on: this one goes on without us.
    room.playing = true;
    if (state !== 'room') showRoom();
    return;
  }
  const bp = msg.mode === 'versus' ? arenaMap(msg.map) : level(msg.level);
  const shields = msg.shields === -1 ? Infinity : msg.shields;
  game = new Game(bp, { mode: msg.mode, players: msg.roster.map((p) => ({ name: p.name })), local: meEntry.slot, shields, maxShields: shields, checkpoint: msg.checkpoint });
  mp = { host: room.host, msg, slotOf: new Map(msg.roster.map((p) => [p.id, p.slot])), snapT: 0, sendT: 0, ended: false };
  if (mp.host) mp.link = new HostLink(game);
  else {
    mp.mirror = new Mirror(game, meEntry.slot);
    mp.inputs = new GuestInputs();
  }
  room.playing = true;
  levelId = msg.mode === 'coop' ? msg.level : levelId;
  renderer.setLevel(bp);
  renderer.resize();
  acc = 0;
  state = 'play';
  input.reset();
  input.pressed.clear();
  $('overlay').hidden = true;
  $('hud').hidden = false;
  hud.lastPips = null;
  hud.lastAmmo = null;
  audio.bossTime(false);
  if (msg.mode === 'versus') {
    const m = MAPS.find((x) => x.id === msg.map);
    banner('VERSUS', m.title.toUpperCase(), `${msg.roster.length} robots · ${msg.shields === -1 ? '∞' : msg.shields} shields each`);
    playMusic(bp.track);
  } else {
    const L = def(msg.level);
    banner(`CO-OP · LEVEL ${msg.level}`, L.title.toUpperCase(), `${msg.roster.map((p) => p.name).join(', ')}`);
    playMusic(L.track);
  }
}

/** One frame of a match: the host steps the game and sends snapshots; a guest predicts and sends inputs. */
function mpFrame(dt) {
  const me = game.me;
  const bot = me.bot;
  const sh = renderer.worldToScreen(bot.shoulder.x, bot.shoulder.y);
  let it = input.intent({ aim: bot.aim, facing: bot.facing, origin: sh }, dt);
  if (state !== 'play' || me.out) it = { mx: 0, aim: bot.aim };
  acc += dt;
  let steps = 0;
  if (mp.host) {
    while (acc >= PHYSICS_DT && steps < 30) {
      game.step(PHYSICS_DT, mp.link.intents(it));
      it = { ...it, jumpPressed: false, fire: false, worm: [false, false], cycle: false };
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 30) acc = 0;
    mp.link.events(game.events);
    mp.snapT += dt;
    if (mp.snapT >= 1 / NET.snapHz) {
      mp.snapT = Math.min(mp.snapT - 1 / NET.snapHz, 1 / NET.snapHz);
      net.sendFast(mp.link.snapshot());
    }
    if (!mp.ended && game.ended()) {
      mp.ended = true;
      const g = game;
      setTimeout(() => mp && game === g && hostEnd(), 1400);
    }
  } else {
    while (acc >= PHYSICS_DT && steps < 30) {
      acc -= PHYSICS_DT;
      steps++;
    }
    if (steps >= 30) acc = 0;
    // A long frame goes as several records: the host takes at most 16 steps in one.
    let first = true;
    while (steps > 0 || first) {
      const n = Math.min(steps, 8);
      const rec = mp.inputs.record(first ? it : { ...it, jumpPressed: false, fire: false, worm: [false, false], cycle: false }, n);
      if (rec) mp.mirror.predict(rec);
      steps -= n;
      first = false;
    }
    mp.sendT += dt;
    if (mp.sendT >= 1 / NET.sendHz) {
      mp.sendT = 0;
      const m = mp.inputs.message(renderer.view());
      m.id = net.id;
      net.sendFast(m);
    }
    mp.mirror.show(performance.now() / 1000);
    mp.mirror.fade(dt);
  }
  events();
  hud();
}

/** Host: the level or the match is over. Tell everyone how it went. */
function hostEnd() {
  const g = game;
  const rows = g.players.map((p) => ({ slot: p.slot, name: p.name, hits: p.stats.hits, lost: p.stats.shieldsLost, falls: p.stats.falls, powerups: p.stats.powerups, out: p.out }));
  let result;
  if (g.mode === 'versus') result = { kind: 'over', mode: 'versus', map: mp.msg.map, winner: g.winner, time: g.time, rows };
  else if (g.phase === 'cleared') result = { kind: 'cleared', mode: 'coop', level: mp.msg.level, time: g.stats.time, secrets: g.stats.secrets, secretsTotal: g.stats.secretsTotal, defeated: g.stats.defeated, rows };
  else result = { kind: 'down', mode: 'coop', level: mp.msg.level, checkpoint: g.checkpoint, time: g.time, rows };
  net.send({ t: MSG.end, result });
  showResult(result);
}

/** The end of a match, on every screen; the host chooses what next. */
function showResult(r) {
  state = 'mpend';
  audio.bossTime(false);
  const who = (slot) => r.rows.find((x) => x.slot === slot);
  const colored = (row) => `<span style="color:${PLAYERS[row.slot].color}">${escapeHtml(row.name)}</span>`;
  let head;
  let table;
  if (r.kind === 'over') {
    const w = r.winner == null ? null : who(r.winner);
    head = `<div class="eyebrow">VERSUS · ${escapeHtml((MAPS.find((m) => m.id === r.map) || {}).title || '')}</div><h2>${w ? `${colored(w)} wins` : 'A draw'}</h2>`;
    table = `<table class="stats"><thead><tr><th>Robot</th><th>Hits</th><th>Shields lost</th><th>Falls</th><th>Power-ups</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${colored(x)}</td><td>${x.hits}</td><td>${x.lost}</td><td>${x.falls}</td><td>${x.powerups}</td></tr>`).join('')}</tbody></table>`;
  } else {
    const L = def(r.level);
    head = r.kind === 'cleared' ? `<div class="eyebrow">CO-OP · LEVEL ${r.level} CLEARED</div><h2>${escapeHtml(L.title)}</h2><p class="record">${BOSSES[L.boss].name} is stopped. ${fmt(r.time)}, ${r.secrets} of ${r.secretsTotal} secrets.</p>` : `<div class="eyebrow">CO-OP · OUT OF SHIELDS</div><h2>The whole team is out</h2><p class="intro">A continue brings everyone back at ${r.checkpoint >= 0 ? 'the last checkpoint' : 'the start of the level'} with full shields.</p>`;
    table = `<table class="stats"><thead><tr><th>Robot</th><th>Shields lost</th><th>Falls</th><th>Power-ups</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${colored(x)}</td><td>${x.lost}</td><td>${x.falls}</td><td>${x.powerups}</td></tr>`).join('')}</tbody></table>`;
  }
  let buttons = '';
  if (room && room.host) {
    if (r.kind === 'over') buttons = '<button id="re-again" class="primary">Rematch</button><button id="re-other">Another map</button>';
    else if (r.kind === 'cleared') buttons = `${r.level < LEVEL_DEFS.length ? `<button id="re-next" class="primary">Level ${r.level + 1}: ${escapeHtml(def(r.level + 1).title)}</button>` : ''}<button id="re-again" ${r.level < LEVEL_DEFS.length ? '' : 'class="primary"'}>Play it again</button>`;
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
  game = null;
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
  state = 'mpmenu';
  overlay(`
    <div class="panel narrow">
      <div class="eyebrow">MULTIPLAYER · THE MATCH PLAYS ON</div>
      <h2>${escapeHtml(game.mode === 'versus' ? 'Versus' : def(levelId).title)}</h2>
      <div class="row"><button id="mm-back" class="primary">Back to it</button>${room && room.host ? '<button id="mm-end">End the match (everyone back to the room)</button>' : ''}<button id="mm-leave">Leave the room</button></div>
      <details><summary>Controls</summary>${controlsTable()}</details>
    </div>`, true);
  $('mm-back').onclick = () => {
    state = 'play';
    $('overlay').hidden = true;
    input.reset();
  };
  if ($('mm-end')) $('mm-end').onclick = () => {
    net.send({ t: MSG.back });
    backToRoom();
  };
  $('mm-leave').onclick = () => leaveRoom();
  focusFirst();
}

// -------------------------------------------------------------------- HUD

function hud() {
  const h = game.hud();
  if (h.mode === 'versus') $('hud-level').textContent = `VERSUS · ${(MAPS.find((m) => m.id === mp.msg.map) || { title: '' }).title.toUpperCase()}`;
  else $('hud-level').textContent = `${levelId} · ${def(levelId).title.toUpperCase()}${h.mode === 'coop' ? ' · CO-OP' : ''}`;
  $('hud-time').textContent = fmt(h.time);
  $('hud-secrets').textContent = `${h.secrets}/${h.secretsTotal}`;
  $('hud-secrets').hidden = $('hud-secrets-label').hidden = h.mode === 'versus';
  // Everyone's shields, in their colours, under your own.
  if (game.multi) {
    const team = h.team.map((p) => `<span class="who ${p.out ? 'out' : ''}" style="color:${p.color}">${escapeHtml(p.name)} ${p.out ? 'OUT' : p.pool === Infinity ? '∞' : '◆'.repeat(Math.min(p.pool, 9))}</span>`).join('');
    if (team !== hud.lastTeam) {
      $('hud-team').innerHTML = team;
      hud.lastTeam = team;
    }
    $('hud-team').hidden = false;
  } else $('hud-team').hidden = true;
  const max = mp ? (mp.msg.shields === -1 ? Infinity : mp.msg.shields) : difficulty().shields;
  if (h.out) $('hud-shields').textContent = h.mode === 'coop' ? 'OUT · BACK AT THE NEXT CHECKPOINT' : 'OUT';
  else if (h.pool === Infinity) $('hud-shields').textContent = '∞';
  else {
    const n = Math.max(h.pool, max === Infinity ? h.pool : max);
    let s = '';
    for (let i = 0; i < n; i++) s += i < h.pool ? '◆' : '<span class="gone">◆</span>';
    $('hud-shields').innerHTML = s;
  }
  const pu = POWERUPS.find((p) => p.id === h.loaded);
  $('hud-loaded').innerHTML = pu ? `<span style="color:${pu.color}">${pu.name.toUpperCase()}</span>` : 'STANDARD';
  // Charges ready: one pip for each of the six the blaster may have in the air, dimmed while it is out.
  let pips = '';
  for (let i = 0; i < h.maxCharges; i++) pips += i < h.maxCharges - h.charges ? '●' : '<span class="gone">●</span>';
  if (pips !== hud.lastPips) {
    $('hud-charges').innerHTML = pips;
    hud.lastPips = pips;
  }
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

/** What another player's robot does that you hear too; their footsteps and the like you do not. */
const HEARD_FROM_OTHERS = new Set(['fire', 'hurt', 'out', 'revive', 'stomp', 'powerup', 'freeze', 'shield']);

function events() {
  const g = game;
  let action = 0;
  for (const e of g.events) {
    if (e.slot != null && e.slot !== g.local && !HEARD_FROM_OTHERS.has(e.s)) continue;
    if (mp) {
      if (e.s === 'out' && e.slot === g.local) banner(g.mode === 'coop' ? 'OUT OF SHIELDS' : 'VERSUS', 'OUT', g.mode === 'coop' ? 'back with one shield when a teammate reaches a checkpoint or the boss' : 'watch the rest play it out');
      if (e.s === 'revive' && e.slot === g.local) banner('CO-OP', 'BACK IN', 'one shield: make it count');
      if (e.s === 'go') banner('VERSUS', 'GO', '');
      if (e.s === 'down' || e.s === 'cleared' || e.s === 'over') {
        audio.cue(e);
        continue; // the host decides what comes next, for everyone
      }
    }
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
  if (state === 'play' && mp) {
    if (input.consume('Escape') || input.consume('p')) mpMenu();
  } else if (state === 'mpmenu') {
    if (input.consume('Escape') || input.consume('p')) {
      state = 'play';
      $('overlay').hidden = true;
      input.reset();
    }
  } else if (state === 'play') {
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

  if (mp && game && (state === 'play' || state === 'mpmenu' || state === 'mpend')) {
    mpFrame(dt);
  } else if (state === 'play' && game) {
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
  const alpha = state === 'play' || (mp && game) ? acc / PHYSICS_DT : 1;
  if (game) {
    renderer.updateCamera(game, alpha, dt);
    game.view = renderer.view();
    const ui = { device: input.device };
    if (settings.aimLine && (state === 'play' || state === 'paused') && !game.ended() && !game.me.out) {
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
  if (state === 'play' && !mp) pause(); // a match others are playing goes on
});
$('hud-pause').onclick = () => (mp ? mpMenu() : pause());
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
  renderer,
  input,
  audio,
  level,
};
