// Vector's music and sound. The tracks are well formed for the engine that
// plays them, their humanity climbs from the grid to the Creator's house,
// every voice they name exists, and the whole of every track, every cue and
// the babble run through the real sequencer against a strict stand-in for
// Web Audio, which refuses what a browser would and counts what's built. The
// music and the effects each reach the speakers through their own volume, and
// the ambience and the voices are effects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VECTOR_TRACKS, LEVEL_TRACKS } from '../src/tracks.js';
import {
  VectorAudio,
  VOICES,
  PERC,
  AMBIENCE,
  LAYERS,
  SAMPLED,
  VOWELS,
  CUE_NAMES,
  voicesFor,
  pickVoice,
  bossTempoFor,
  pumpFor,
  notesOf,
  renderNote,
  renderLoop,
  planBabble,
  sampleRoot,
} from '../src/audio.js';

const KEYS = ['vector', 'edge', 'wilds', 'farm', 'foundry', 'freeway', 'rain', 'underline', 'harbour', 'ridge', 'workshop', 'creator', 'ending', 'echo'];
const tracks = () => KEYS.map((k) => [k, VECTOR_TRACKS[k]]);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const progressionBars = (T) => T.progression.reduce((n, ch) => n + ch.bars, 0);
const arrangementBars = (T) => T.sections.reduce((n, s) => n + s.bars, 0);
const layersUsed = (T) => new Set(T.sections.flatMap((s) => s.layers));
const is16 = (a) => Array.isArray(a) && a.length === 16;

// ------------------------------------------------------ a stand-in for Web Audio

/** A context that builds nothing, but refuses what a browser would refuse, and counts nodes. */
function mockContext(sampleRate = 48000) {
  const finite = (...xs) => {
    for (const x of xs) if (!Number.isFinite(x)) throw new TypeError(`non-finite value ${x}`);
  };
  class Param {
    constructor(v) {
      this.value = v;
      this.min = v;
    }
    setValueAtTime(v, t) {
      finite(v, t);
      this.min = Math.min(this.min, v);
      return this;
    }
    linearRampToValueAtTime(v, t) {
      finite(v, t);
      this.min = Math.min(this.min, v);
      return this;
    }
    exponentialRampToValueAtTime(v, t) {
      finite(v, t);
      if (!(Math.abs(v) > 0)) throw new RangeError('an exponential ramp cannot reach zero');
      this.min = Math.min(this.min, v);
      return this;
    }
    setTargetAtTime(v, t, tc) {
      finite(v, t, tc);
      if (tc < 0) throw new RangeError('negative time constant');
      this.min = Math.min(this.min, v);
      return this;
    }
    cancelScheduledValues(t) {
      finite(t);
      return this;
    }
  }
  const ctx = { currentTime: 0, sampleRate, nodes: 0, made: [] };
  class Node {
    constructor() {
      ctx.nodes++;
      ctx.made.push(this);
      this.outs = [];
    }
    connect(dest) {
      if (!dest || !(dest instanceof Node || dest instanceof Param)) throw new TypeError('connect to nothing');
      this.outs.push(dest);
      return dest;
    }
    disconnect() {}
  }
  class Source extends Node {
    start(t = 0, offset = 0) {
      finite(t, offset);
      if (this.started) throw new Error('started twice');
      this.started = true;
    }
    stop(t = 0) {
      finite(t);
      if (!this.started) throw new Error('stopped before it started');
    }
  }
  const node = (props) => Object.assign(new Node(), props);
  Object.assign(ctx, {
    destination: new Node(),
    createGain: () => node({ gain: new Param(1) }),
    createStereoPanner: () => node({ pan: new Param(0) }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: new Param(350), Q: new Param(1), gain: new Param(0) }),
    createDelay: () => node({ delayTime: new Param(0) }),
    createConvolver: () => node({ buffer: null }),
    createDynamicsCompressor: () => node({ threshold: new Param(-24), knee: new Param(30), ratio: new Param(12), attack: new Param(0.003), release: new Param(0.25) }),
    createOscillator: () => Object.assign(new Source(), { type: 'sine', frequency: new Param(440), detune: new Param(0) }),
    createBufferSource: () => Object.assign(new Source(), { buffer: null, loop: false, detune: new Param(0), playbackRate: new Param(1) }),
    createBuffer(channels, length, rate) {
      finite(channels, length, rate);
      if (rate < 3000 || rate > 768000 || length < 1) throw new RangeError(`bad buffer ${length} @ ${rate}`);
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: (i) => data[i] };
    },
  });
  ctx.Param = Param;
  return ctx;
}

/** A VectorAudio on the stand-in, playing `T` with no timer: the test drives the clock. */
function rig(T, h = T.humanity) {
  const ctx = mockContext();
  const a = new VectorAudio().attach(ctx);
  a.setHumanity(h);
  a.playTrack(T);
  clearInterval(a.timer);
  a.timer = null;
  return { a, ctx };
}

// ------------------------------------------------------------------- the list

test('every track the game asks for is there, with a title, a key, a tempo and a humanity', () => {
  assert.deepEqual(Object.keys(VECTOR_TRACKS).sort(), [...KEYS].sort());
  assert.deepEqual(LEVEL_TRACKS, KEYS.slice(1, 11));
  const titles = new Set();
  for (const [key, T] of tracks()) {
    assert.ok(T.title && !titles.has(T.title), `${key}: a title of its own`);
    titles.add(T.title);
    assert.match(T.title, /^.+ \(.+\)$/, `${key}: 'Name (Something)'`);
    assert.ok(typeof T.key === 'string' && T.key.length > 0, `${key}: key`);
    assert.ok(T.bpm >= 40 && T.bpm <= 180, `${key}: bpm ${T.bpm}`);
    assert.ok(T.humanity >= 0 && T.humanity <= 1, `${key}: humanity ${T.humanity}`);
  }
  for (const key of LEVEL_TRACKS.slice(0, 9)) assert.match(VECTOR_TRACKS[key].title, / Theme\)$/, `${key} names its boss`);
  assert.match(VECTOR_TRACKS.creator.title, /\(Creator Theme\)$/);
});

test('humanity climbs level by level, from the grid to the Creator\'s house', () => {
  const hs = LEVEL_TRACKS.map((k) => VECTOR_TRACKS[k].humanity);
  assert.equal(hs[0], 0, 'the Edge of the Grid is pure grid');
  assert.equal(hs[9], 1, 'the workshop is all people');
  for (let i = 1; i < hs.length; i++) assert.ok(hs[i] > hs[i - 1], `${LEVEL_TRACKS[i]} is more human than ${LEVEL_TRACKS[i - 1]}`);
  assert.equal(VECTOR_TRACKS.creator.humanity, 1);
  assert.equal(VECTOR_TRACKS.ending.humanity, 1);
  assert.equal(VECTOR_TRACKS.vector.humanity, 0.5, 'the title stands in both worlds');
});

test('a boss hurries the grid\'s music most and the people\'s least, and the Creator\'s not at all', () => {
  assert.equal(bossTempoFor(0), 2);
  assert.equal(bossTempoFor(0.29), 2);
  assert.equal(bossTempoFor(0.45), 1.5);
  assert.equal(bossTempoFor(0.6), 1.5);
  assert.equal(bossTempoFor(0.66), 1.25);
  for (const [key, T] of tracks()) {
    const want = key === 'creator' || key === 'ending' ? 1 : bossTempoFor(T.humanity);
    assert.equal(T.bossTempo, want, `${key}: bossTempo`);
  }
});

test('the kick pumps the pads on the grid and stops pumping by the middle of the journey', () => {
  assert.equal(pumpFor(0), 1);
  assert.ok(pumpFor(0.22) > 0 && pumpFor(0.22) < 1);
  assert.equal(pumpFor(0.45), 0);
  assert.equal(pumpFor(1), 0);
  const grid = rig(VECTOR_TRACKS.edge).a;
  grid.pump(1);
  assert.ok(Math.abs(grid.duck.gain.min - 0.35) < 1e-9, 'the grid ducks as deep as Deflector');
  const people = rig(VECTOR_TRACKS.workshop).a;
  people.pump(1);
  assert.equal(people.duck.gain.min, 1, 'people do not duck to a kick');
});

// ------------------------------------------------------------ the engine's format

test('every field the engine\'s sequencer reads is there and well formed', () => {
  for (const [key, T] of tracks()) {
    assert.ok(T.progression.length > 0, `${key}: progression`);
    for (const ch of T.progression) {
      assert.ok(Array.isArray(ch.chord) && ch.chord.length >= 3, `${key}: chord`);
      assert.ok(Array.isArray(ch.pad) && ch.pad.length >= 3, `${key}: pad voicing`);
      assert.ok(Number.isInteger(ch.bass), `${key}: bass root`);
      assert.ok(Number.isInteger(ch.bars) && ch.bars > 0, `${key}: bars`);
      if (ch.guitar) assert.ok(ch.guitar.length >= 4, `${key}: a guitar voicing has four strings or more`);
    }
    const L = layersUsed(T);
    for (const layer of L) assert.ok(LAYERS.includes(layer), `${key}: layer ${layer}`);
    if (L.has('arp')) {
      assert.ok(is16(T.arp.pattern), `${key}: arp pattern`);
      for (const i of T.arp.pattern) assert.ok(i === null || (Number.isInteger(i) && i >= 0), `${key}: arp step ${i}`);
    }
    if (L.has('bell')) {
      assert.ok(T.bell && is16(T.bell.pattern), `${key}: bell pattern`);
      for (const i of T.bell.pattern) assert.ok(i === null || (Number.isInteger(i) && i >= 0), `${key}: bell step ${i}`);
    }
    if (L.has('bass')) {
      assert.ok(is16(T.bass.pattern), `${key}: bass pattern`);
      for (const ev of T.bass.pattern) assert.ok(ev === 0 || (Number.isInteger(ev[0]) && ev[1] > 0), `${key}: bass step ${ev}`);
    }
    for (const drum of ['kick', 'snare', 'hat']) {
      if (!L.has(drum)) continue;
      assert.ok(is16(T.drums[drum]), `${key}: ${drum}`);
      for (const v of T.drums[drum]) assert.ok(v >= 0 && v <= 1, `${key}: ${drum} velocity`);
    }
    if (L.has('hat')) assert.ok(is16(T.drums.hatOpen), `${key}: hatOpen`);
    for (const [name, line] of [['lead', T.lead], ['counter', T.counter]]) {
      if (!L.has(name)) continue;
      assert.ok(line.length > 0 && line.length % 16 === 0, `${key}: ${name} length`);
      for (const [step, , len] of line.notes) assert.ok(Number.isInteger(step) && step >= 0 && step < line.length && len > 0, `${key}: ${name} note at ${step}`);
    }
    assert.ok(T.sections.length > 0, `${key}: sections`);
    for (const s of T.sections) assert.ok(Number.isInteger(s.bars) && s.bars > 0 && s.layers.length > 0, `${key}: section ${s.name}`);
    assert.ok(T.loopFrom >= 0 && T.loopFrom < T.sections.length, `${key}: loopFrom`);
  }
});

test('every section is a whole number of turns of its chords, so the melodies land on theirs', () => {
  for (const [key, T] of tracks()) {
    const n = progressionBars(T);
    for (const s of T.sections) assert.equal(s.bars % n, 0, `${key}: ${s.name} is ${s.bars} bars over an ${n}-bar progression`);
    for (const line of [T.lead, T.counter]) if (line) assert.equal(line.length % (n * 16), 0, `${key}: a melody spans whole progressions`);
  }
});

test('Vector\'s own fields are well formed', () => {
  for (const [key, T] of tracks()) {
    const L = layersUsed(T);
    if (L.has('strum')) {
      assert.ok(is16(T.strum.pattern), `${key}: strum pattern`);
      for (const v of T.strum.pattern) assert.ok(v >= -1 && v <= 1, `${key}: a stroke`);
    }
    if (L.has('perc')) {
      assert.ok(T.perc && Object.keys(T.perc).length > 0, `${key}: perc`);
      for (const [name, pat] of Object.entries(T.perc)) {
        assert.ok(PERC.includes(name), `${key}: perc ${name}`);
        assert.ok(is16(pat) && pat.every((v) => v >= 0 && v <= 1), `${key}: perc ${name} pattern`);
      }
    }
    if (L.has('pad2')) assert.ok(T.pad2 && (!T.pad2.vowel || VOWELS[T.pad2.vowel]), `${key}: pad2`);
    for (const f of ['swing', 'shuffle']) if (T[f] !== undefined) assert.ok(T[f] >= 0 && T[f] < 0.5, `${key}: ${f}`);
    if (T.pump !== undefined) assert.ok(T.pump >= 0 && T.pump <= 1, `${key}: pump`);
    for (const [kind, level] of Object.entries(T.ambience || {})) {
      assert.ok(AMBIENCE.includes(kind), `${key}: ambience ${kind}`);
      assert.ok(level > 0 && level <= 1, `${key}: ambience ${kind} level`);
    }
  }
});

test('every note is one an instrument can play', () => {
  const inRange = (m, lo, hi, what) => assert.ok(Number.isInteger(m) && m >= lo && m <= hi, `${what}: ${m}`);
  for (const [key, T] of tracks()) {
    for (const ch of T.progression) {
      for (const m of [...ch.chord, ...ch.pad, ...(ch.guitar || [])]) inRange(m, 28, 84, `${key} chord`);
      if (T.bass) for (const ev of T.bass.pattern) if (ev) inRange(ch.bass + ev[0], 26, 64, `${key} bass`);
    }
    // A cello's line can sit as low as its C; nothing sings above a flute's top.
    for (const line of [T.lead, T.counter]) if (line) for (const n of line.notes) inRange(n[1], 36, 96, `${key} melody`);
    for (const [inst, notes] of notesOf(T)) for (const m of notes) inRange(m, 21, 100, `${key} ${inst}`);
  }
});

test('every voice a track names is one VectorAudio plays', () => {
  for (const [key, T] of tracks()) {
    const check = (voices, where) => {
      for (const [slot, v] of Object.entries(voices || {})) {
        assert.ok(VOICES[slot], `${where}: no slot called ${slot}`);
        assert.ok(VOICES[slot].includes(v), `${where}: ${slot} can't be ${v}`);
      }
    };
    check(T.voices, key);
    for (const s of T.sections) check(s.voices, `${key} ${s.name}`);
  }
  for (const h of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
    for (const [slot, v] of Object.entries(voicesFor(h))) assert.ok(VOICES[slot].includes(v), `humanity ${h}: ${slot} ${v}`);
  }
  assert.ok(Object.values(voicesFor(0)).filter((v) => v === 'synth').length >= 6, 'the grid is synthesisers');
  assert.ok(!Object.values(voicesFor(1)).includes('synth'), 'nothing is a synthesiser at the end');
});

test('a section\'s voices override its track\'s, and its track\'s override its humanity\'s', () => {
  const T = VECTOR_TRACKS.vector;
  assert.equal(pickVoice(T, T.sections[0], 'lead'), 'synth');
  assert.equal(pickVoice(T, T.sections[3], 'lead'), 'piano');
  assert.equal(pickVoice(T, T.sections[2], 'pad'), 'strings');
  assert.equal(pickVoice(VECTOR_TRACKS.freeway, null, 'hat'), 'synth', 'the half-acoustic kit keeps the grid\'s hats');
  assert.equal(pickVoice(VECTOR_TRACKS.freeway, null, 'kick'), 'kit');
  assert.equal(pickVoice({ humanity: 1, voices: { drums: 'orch' } }, null, 'snare'), 'orch', 'a drum falls back to the kit');
  assert.equal(pickVoice({ humanity: 0 }, null, 'arp'), 'synth');
});

test('no two tracks are the same song with the notes swapped', () => {
  const seen = { progression: new Map(), lead: new Map(), arp: new Map(), arrangement: new Map() };
  for (const [key, T] of tracks()) {
    const sig = {
      progression: JSON.stringify(T.progression.map((ch) => [ch.chord, ch.bars])),
      lead: JSON.stringify(T.lead.notes),
      arp: JSON.stringify(T.arp && T.arp.pattern),
      arrangement: JSON.stringify(T.sections.map((s) => [s.bars, [...s.layers].sort()])),
    };
    for (const k of Object.keys(seen)) {
      assert.ok(!seen[k].has(sig[k]), `${key} has the same ${k} as ${seen[k].get(sig[k])}`);
      seen[k].set(sig[k], key);
    }
  }
  assert.equal(new Set(KEYS.map((k) => VECTOR_TRACKS[k].key + VECTOR_TRACKS[k].bpm)).size, KEYS.length, 'no two share a key and a tempo');
});

// ------------------------------------------------------------ the instruments

/** The pitch of a note, by autocorrelation around the expected period, in cents from `f0`. */
function centsOff(d, sr, f0) {
  const start = Math.floor(sr * 0.1);
  const n = Math.floor(sr * 0.15);
  const corr = (lag) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[start + i] * d[start + i + lag];
    return s;
  };
  let best = -Infinity;
  let lag = 0;
  for (let l = Math.floor(sr / (f0 * 1.1)); l <= Math.ceil(sr / (f0 / 1.1)); l++) {
    const c = corr(l);
    if (c > best) {
      best = c;
      lag = l;
    }
  }
  const [a, b, c] = [corr(lag - 1), corr(lag), corr(lag + 1)];
  const f = sr / (lag + (0.5 * (a - c)) / (a - 2 * b + c));
  return 1200 * Math.log2(f / f0);
}

test('every rendered instrument makes a finite, audible note that never clips', () => {
  for (const inst of SAMPLED) {
    for (const m of inst === 'pluck' || inst === 'upright' ? [28, 40, 52] : [45, 60, 76, 88]) {
      const sr = 24000;
      const d = renderNote(inst, m, sr);
      assert.ok(d.length >= sr * 0.5 && d.length <= sr * 3.6, `${inst} ${m}: ${d.length / sr} s`);
      let peak = 0;
      for (const x of d) {
        assert.ok(Number.isFinite(x), `${inst} ${m}: finite`);
        peak = Math.max(peak, Math.abs(x));
      }
      assert.ok(peak > 0.1 && peak <= 0.981, `${inst} ${m}: peak ${peak}`);
      assert.ok(d[d.length - 1] === 0, `${inst} ${m}: ends in silence, so it never clicks off`);
    }
  }
});

test('plucked strings play in tune, high notes included', () => {
  for (const inst of ['guitar', 'harp', 'pluck', 'upright']) {
    for (const m of inst === 'pluck' || inst === 'upright' ? [31, 40, 52] : [45, 57, 69, 81]) {
      const sr = m > 76 ? 48000 : 24000;
      const cents = centsOff(renderNote(inst, m, sr), sr, mtof(m));
      assert.ok(Math.abs(cents) < 5, `${inst} ${m}: ${cents.toFixed(1)} cents out`);
    }
  }
  for (const m of [48, 60, 72]) {
    const cents = centsOff(renderNote('piano', m, 24000), 24000, mtof(m));
    assert.ok(cents > -2 && cents < 15, `piano ${m}: stretched a little sharp, as a piano is (${cents.toFixed(1)} cents)`);
  }
});

test('the ambience loops are finite and quiet', () => {
  const kinds = ['rain', 'water', 'wind', 'fans', 'room', 'hum', 'stream', 'tunnel', 'furnace', 'road'];
  for (const name of kinds) {
    const [L, R] = renderLoop(name, 16000, 3);
    assert.equal(L.length, R.length, name);
    assert.ok(L.length >= 16000 * 2, `${name}: at least two seconds`);
    let peak = 0;
    for (const x of L) {
      assert.ok(Number.isFinite(x), `${name}: finite`);
      peak = Math.max(peak, Math.abs(x));
    }
    assert.ok(peak > 0.01 && peak < 1, `${name}: peak ${peak}`);
  }
});

// --------------------------------------------------------------- the whole thing

test('every bar of every track plays through without a fault, inside a node budget', () => {
  for (const [key, T] of tracks()) {
    const { a, ctx } = rig(T);
    const seconds = (arrangementBars(T) * 16 * 60) / T.bpm / 4;
    const before = ctx.nodes;
    a.scheduleUntil(seconds + 0.1);
    // The ambience's events over the same stretch.
    for (let t = 0; t < seconds; t += 5) {
      ctx.currentTime = t;
      a.ambienceTick(t + 5);
    }
    const perSecond = (ctx.nodes - before) / seconds;
    assert.ok(perSecond < 320, `${key}: ${perSecond.toFixed(0)} nodes a second`);
    // And the boss fight, a loop at its tempo.
    a.bossTime(true);
    assert.equal(a.tempoTarget, T.bossTempo, `${key}: boss tempo`);
    a.scheduleUntil(a.nextStepTime + 20);
    a.bossTime(false);
    assert.equal(a.tempoTarget, 1);
    a.stopTrack(1);
  }
});

test('every voice in the palette plays on its own', () => {
  const { a } = rig(VECTOR_TRACKS.ridge);
  const count = (fn) => {
    const before = a.ctx.nodes;
    fn();
    return a.ctx.nodes - before;
  };
  for (const v of VOICES.pad) {
    const n = count(() => a.padVoice(v, 1, [45, 57, 60, 64], 2, 0.3, {}));
    assert.ok(v === 'none' ? n === 0 : n > 0, `pad ${v}`);
  }
  for (const v of VOICES.lead) {
    const n = count(() => a.line('lead', v, 1, 72, 0.5));
    assert.ok(v === 'none' ? n === 0 : n > 0, `lead ${v}`);
  }
  for (const kit of VOICES.drums) {
    a.track = { ...a.track, voices: { drums: kit } };
    a.section = null;
    assert.ok(count(() => a.kick(1, 1)) > 0, `${kit} kick`);
    assert.ok(count(() => a.snare(1, 1)) > 0, `${kit} snare`);
    assert.ok(count(() => a.hat(1, 0.5, true)) > 0, `${kit} open hat`);
  }
  for (const p of PERC) assert.ok(count(() => a.perc(p, 1, 0.8)) > 0, `perc ${p}`);
  for (const v of ['synth', 'cymbal', 'roll']) {
    a.track = { ...a.track, voices: { riser: v } };
    assert.ok(count(() => a.riser(1, 2)) > 0, `riser ${v}`);
  }
});

test('every cue sounds at every humanity, placed and scaled as the game asks', () => {
  for (const h of [0, 0.3, 0.6, 1]) {
    const { a, ctx } = rig(VECTOR_TRACKS.harbour, h);
    for (const s of CUE_NAMES) {
      ctx.currentTime += 1;
      const before = ctx.nodes;
      a.cue({ s, pan: -0.5, vol: 0.8, kind: 'big', big: true, air: 1.2, speed: 0.7, which: 1, surface: 'snow' });
      assert.ok(ctx.nodes - before > 2, `${s} at humanity ${h}`);
    }
    for (const surface of ['grid', 'metal', 'concrete', 'wood', 'grass', 'snow', 'water', undefined]) {
      ctx.currentTime += 1;
      const before = ctx.nodes;
      a.cue({ s: 'step', surface });
      assert.ok(ctx.nodes - before > 2, `step on ${surface}`);
    }
    // Too far away to hear builds nothing; a sound the game doesn't know is ignored.
    ctx.currentTime += 1;
    const before = ctx.nodes;
    a.cue({ s: 'hit', vol: 0.001 });
    a.cue({ s: 'no such thing' });
    assert.equal(ctx.nodes, before);
  }
});

test('a cue fired many times in one moment sounds once', () => {
  const { a, ctx } = rig(VECTOR_TRACKS.rain);
  ctx.currentTime = 3;
  const before = ctx.nodes;
  a.cue({ s: 'ricochet', speed: 1 });
  const one = ctx.nodes - before;
  for (let i = 0; i < 5; i++) a.cue({ s: 'ricochet', speed: 1 });
  assert.equal(ctx.nodes - before, one);
});

test('the cues\' instruments are rendered when the humanity is set, not in the middle of a fight', () => {
  const { a } = rig(VECTOR_TRACKS.ridge, 0.9);
  a.warmUp(1e6);
  const have = a.bank.size;
  for (const s of CUE_NAMES) a.cue({ s });
  assert.equal(a.bank.size, have, 'no cue had to render a note');
});

test('a track\'s rendered notes are made ahead and fit in memory', () => {
  for (const [key, T] of tracks()) {
    const { a } = rig(T);
    a.warmUp(1e6);
    let bytes = 0;
    for (const buf of a.bank.values()) bytes += buf.length * 4;
    assert.ok(bytes < 12e6, `${key}: ${(bytes / 1e6).toFixed(1)} MB of notes`);
    // Every note of the whole track is ready: playing it all renders nothing more.
    const have = a.bank.size;
    a.scheduleUntil((arrangementBars(T) * 16 * 60) / T.bpm / 4);
    assert.equal(a.bank.size, have, `${key}: a note was rendered while playing`);
  }
});

test('the notes a track needs first are rendered first', () => {
  // The harbour opens on a fingerpicked guitar alone; the squeezebox waits for the chorus.
  const ctx = mockContext();
  const a = new VectorAudio().attach(ctx);
  a.prepare(VECTOR_TRACKS.harbour);
  const first = notesOf({ ...VECTOR_TRACKS.harbour, sections: [VECTOR_TRACKS.harbour.sections[0]] }).get('guitar').size;
  assert.ok(a.queue.slice(0, first).every(([inst]) => inst === 'guitar'), 'the guitar leads the queue');
  // Started from the chorus, its bass and strummed chords come first, and the harp of the section after waits.
  a.prepare(VECTOR_TRACKS.harbour, 16);
  const harp = a.queue.findIndex(([inst]) => inst === 'harp');
  assert.ok(harp > 0 && a.queue.slice(0, harp).every(([inst]) => inst === 'upright' || inst === 'guitar'));
});

test('an odd semitone plays its even neighbour a semitone faster', () => {
  assert.equal(sampleRoot(61), 60);
  assert.equal(sampleRoot(60), 60);
  const { a } = rig(VECTOR_TRACKS.workshop);
  const s = a.strike('piano', 1, 61, 0.5);
  assert.ok(Math.abs(s.src.playbackRate.value - Math.pow(2, 1 / 12)) < 1e-9);
  assert.equal(a.strike('piano', 1, 60, 0.5).src.playbackRate.value, 1);
});

test('the action swells the music but never speeds it, and the boss holds it', () => {
  const { a } = rig(VECTOR_TRACKS.foundry);
  a.setAction(0.9);
  assert.equal(a.intensityTarget, 0.6);
  assert.equal(a.tempoTarget, 1);
  a.bossTime(true);
  a.setAction(0.1);
  assert.equal(a.intensityTarget, 0.85, 'the fight keeps its intensity');
  assert.equal(a.tempoTarget, 1.5);
});

// ------------------------------------------------------------------ the babble

test('a line of dialogue babbles a syllable for every two or three letters', () => {
  const text = 'You were built to finish the grid';
  const letters = text.replace(/\s/g, '').length;
  const { syl, length } = planBabble(text);
  assert.ok(syl.length >= letters / 3 && syl.length <= letters / 2 + 6, `${syl.length} syllables for ${letters} letters`);
  assert.ok(length > 1 && length < 5, `${length} s`);
  for (let i = 1; i < syl.length; i++) assert.ok(syl[i].t >= syl[i - 1].t + syl[i - 1].dur - 1e-9, 'syllables in order, never overlapping');
  for (const u of syl) assert.ok(VOWELS[u.vowel], u.vowel);
});

test('a question rises at its end and a statement falls', () => {
  const q = planBabble('Why did you leave me behind?').syl;
  assert.ok(q[q.length - 1].f > q[0].f, 'the question rises');
  const s = planBabble('I built you to finish the grid.').syl;
  assert.ok(s[s.length - 1].f < s[0].f, 'the statement falls');
  const m = planBabble('Unit, return to the grid.', 'machine').syl;
  assert.ok(m.every((u) => u.f > 80 && u.f < 130), 'the machine keeps to a narrow band');
  assert.equal(planBabble('').length, 0);
  assert.equal(planBabble('...').length, 0);
});

test('speak builds its babble and returns how long it lasts, even before audio starts', () => {
  const silent = new VectorAudio();
  const len = silent.speak('Stop. Think about what you are doing!');
  assert.ok(len > 0.5, 'the subtitle can be timed without audio');
  const { a, ctx } = rig(VECTOR_TRACKS.creator);
  for (const who of ['creator', 'machine']) {
    const before = ctx.nodes;
    const l = a.speak('Stop. Think about what you are doing!', { who });
    assert.ok(Math.abs(l - len) < 1.5, `${who}: ${l} s`);
    assert.ok(ctx.nodes - before > 6 && ctx.nodes - before < 30, `${who}: ${ctx.nodes - before} nodes for the whole line`);
  }
});

// ------------------------------------------------------------------ the volumes

/** Everything a node's sound goes on to, all the way to the speakers. */
function downstream(node) {
  const seen = new Set();
  const walk = (n) => {
    if (!n || seen.has(n)) return;
    seen.add(n);
    for (const d of n.outs || []) walk(d);
  };
  walk(node);
  return seen;
}

test('the music and the effects each reach the speakers through their own volume, and the ambience and the voices are effects', () => {
  const { a, ctx } = rig(VECTOR_TRACKS.harbour);
  const feeds = ctx.made.filter((n) => n.outs.includes(a.master));
  assert.deepEqual(new Set(feeds), new Set([a.musicVol, a.sfxVol]), 'nothing reaches the speakers round the two volumes');
  assert.ok(downstream(a.ambBus).has(a.sfxVol) && !downstream(a.ambBus).has(a.musicVol), 'the ambience follows the effects');
  // A minute of the track, with its ambience off: none of its notes, echoes or
  // room goes through the effects' volume.
  a.stopAmbience(0);
  let from = ctx.made.length;
  a.scheduleUntil(60);
  const notes = ctx.made.slice(from);
  assert.ok(notes.length > 500);
  for (const n of notes) assert.ok(!downstream(n).has(a.sfxVol), 'a note of the music went through the effects');
  // Every cue, a minute of the ambience's events and a line of babble: none of it, echoes included, through the music's.
  from = ctx.made.length;
  for (const s of CUE_NAMES) {
    ctx.currentTime += 1;
    a.cue({ s, pan: -0.5, vol: 0.8, kind: 'big', big: true, air: 1.2, speed: 0.7, which: 1, surface: 'snow' });
  }
  a.startAmbience(VECTOR_TRACKS.harbour.ambience);
  for (let t = 60; t < 120; t += 5) {
    ctx.currentTime = t;
    a.ambienceTick(t + 5);
  }
  a.speak('Stop. Think about what you are doing!', { who: 'creator' });
  const fx = ctx.made.slice(from);
  assert.ok(fx.length > 200);
  for (const n of fx) assert.ok(!downstream(n).has(a.musicVol), 'an effect went through the music');
});
