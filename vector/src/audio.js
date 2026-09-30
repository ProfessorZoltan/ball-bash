// Vector's sound: Deflector's engine (src/audio/engine.js), the same
// sequencer, reverb and ping-pong delay, with a second orchestra beside its
// synthesisers. Every track carries a humanity from 0 to 1, and each voice the
// sequencer calls (pad, arp, bass, lead, bell, drums) takes its timbre from
// it, or from the track's own `voices`. At 0 it is the grid: saw arpeggios,
// pads that pump to the kick, a synth bass. In the middle it is mallets,
// electric piano, plucked bass and hand drums. At 1 it is people: piano,
// strings, guitar, flute, voices and brushes, and nothing ducks to a kick.
//
// Plucked and struck notes are rendered once into buffers (Karplus-Strong for
// strings, inharmonic partials for piano and bars) and played back, so the
// audio clock never waits on a synthesis loop. Bowed, blown and sung notes
// are played live, through formant and body filters.
import { AudioEngine, SOUND_DETAIL } from '../../src/audio/engine.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const TAU = Math.PI * 2;
const LOOKAHEAD = 0.3; // the engine's: how far ahead of the clock anything is scheduled
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ------------------------------------------------------------------ palette

/** The instruments rendered into a buffer per note. */
export const SAMPLED = ['piano', 'epiano', 'marimba', 'vibes', 'kalimba', 'glock', 'musicbox', 'guitar', 'harp', 'pluck', 'upright'];
const TUNED = ['piano', 'epiano', 'marimba', 'vibes', 'kalimba', 'glock', 'musicbox', 'guitar', 'harp'];
const LINES = ['synth', 'glide', 'cello', 'viola', 'violin', 'flute', 'whistle', 'reed', 'voice', ...TUNED, 'none'];
const PADS = ['synth', 'warm', 'strings', 'choir', 'harmonium', 'piano', 'epiano', 'strum', 'none'];
const KITS = ['synth', 'factory', 'hand', 'kit', 'brushes', 'orch'];

/** Every voice each slot can take. 'synth' is always the engine's own sound. */
export const VOICES = {
  pad: PADS,
  pad2: PADS,
  arp: ['synth', ...TUNED, 'none'],
  bell: ['synth', ...TUNED, 'none'],
  bass: ['synth', 'pluck', 'upright', 'arco', 'piano', 'none'],
  lead: LINES,
  counter: LINES,
  strum: ['guitar', 'none'],
  stab: ['synth', 'piano', 'strings', 'strum', 'none'],
  riser: ['synth', 'cymbal', 'roll', 'none'],
  drums: KITS,
  kick: KITS,
  snare: KITS,
  hat: KITS,
};

/** The hand percussion a track's `perc` layer can play. */
export const PERC = ['shaker', 'rim', 'conga', 'bongo', 'clave', 'block', 'tamb', 'anvil', 'clank', 'clap', 'snap', 'tick', 'timpani', 'swish'];

/** Every layer a section can name: the engine's, and Vector's four. */
export const LAYERS = ['pad', 'arp', 'bell', 'bass', 'lead', 'kick', 'snare', 'hat', 'stab', 'counter', 'strum', 'perc', 'pad2'];

/** What each slot sounds like at a humanity, when the track doesn't say. */
export function voicesFor(h) {
  return {
    pad: h < 0.3 ? 'synth' : h < 0.6 ? 'warm' : 'strings',
    pad2: 'choir',
    arp: h < 0.12 ? 'synth' : h < 0.3 ? 'kalimba' : h < 0.42 ? 'marimba' : h < 0.62 ? 'epiano' : h < 0.85 ? 'guitar' : 'piano',
    bell: h < 0.2 ? 'synth' : h < 0.5 ? 'glock' : h < 0.8 ? 'vibes' : 'musicbox',
    bass: h < 0.4 ? 'synth' : h < 0.62 ? 'pluck' : 'upright',
    lead: h < 0.3 ? 'synth' : h < 0.5 ? 'glide' : h < 0.7 ? 'cello' : h < 0.85 ? 'violin' : 'flute',
    counter: h < 0.5 ? 'glide' : 'cello',
    strum: 'guitar',
    stab: h < 0.4 ? 'synth' : h < 0.75 ? 'strings' : 'piano',
    riser: h < 0.4 ? 'synth' : 'cymbal',
    drums: h < 0.25 ? 'synth' : h < 0.4 ? 'factory' : h < 0.55 ? 'hand' : h < 0.8 ? 'kit' : 'brushes',
  };
}

/** The voice a slot plays in a section: the section's choice, then the track's, then its humanity's. */
export function pickVoice(track, section, slot) {
  const v = (section && section.voices && section.voices[slot]) || (track && track.voices && track.voices[slot]);
  if (v) return v;
  if (slot === 'kick' || slot === 'snare' || slot === 'hat') return pickVoice(track, section, 'drums');
  return voicesFor(clamp((track && track.humanity) || 0, 0, 1))[slot];
}

/** How much a boss fight speeds a track up: the grid doubles, people hurry a little. */
export function bossTempoFor(h) {
  return h < 0.3 ? 2 : h <= 0.6 ? 1.5 : 1.25;
}

/** How deep the kick pumps the pads: all the way on the grid, gone by the middle of the journey. */
export function pumpFor(h) {
  return clamp(1 - h / 0.45, 0, 1);
}

/**
 * Rendered notes are made on the even semitones only, and an odd note plays
 * its neighbour below a semitone faster, the way a sampler does: half the
 * memory and half the rendering, and a semitone's shift is inaudible.
 */
export const sampleRoot = (m) => m - (((m % 2) + 2) % 2);

/** A jingle's notes are short and quick: one rendered for every three semitones is plenty. */
const jingleRoot = (m) => m - (((m % 3) + 3) % 3);
const JINGLE_SECS = 1.2;

/** Chord tones across two octaves, as the engine's arpeggio reads them. */
const arpNotes = (chord, octave) => chord.concat(chord.map((m) => m + octave));
/** A guitar plays its own voicing of a chord when the track gives one. */
const guitarVoicing = (ch) => ch.guitar || ch.chord;
/** A piano stab: the chord, and its root an octave down for weight. */
const stabNotes = (chord) => [chord[0] - 12, ...chord];

/** Every note each rendered instrument will render for a track (as sample roots), so they can be made before they're needed. */
export function notesOf(T) {
  const need = new Map();
  const add = (inst, m) => {
    if (!RENDER[inst]) return;
    if (!need.has(inst)) need.set(inst, new Set());
    need.get(inst).add(sampleRoot(m));
  };
  const chords = T.progression || [];
  // Only the chord tones a pattern reaches: a bell that rings twice a bar needs two notes, not eight.
  const picked = (notes, pattern, even) =>
    pattern
      .map((i, s) => (i === null || i === undefined || i === false || (even && s % 2) ? null : notes[i % notes.length]))
      .filter((m) => m !== null);
  for (const sec of T.sections || []) {
    const L = new Set(sec.layers);
    const v = (slot) => pickVoice(T, sec, slot);
    for (const ch of chords) {
      if (L.has('arp') && T.arp) {
        const notes = picked(arpNotes(ch.chord, T.arp.octave ?? 12), T.arp.pattern, (sec.arpDensity || 16) !== 16);
        for (const m of notes) add(v('arp'), m + (sec.arpOctave || 0));
      }
      if (L.has('bell') && T.bell) for (const m of picked(arpNotes(ch.chord, T.bell.octave ?? 24), T.bell.pattern)) add(v('bell'), m);
      if (L.has('bass') && T.bass) for (const ev of T.bass.pattern) if (ev) add(v('bass'), ch.bass + ev[0]);
      for (const slot of ['pad', 'pad2']) {
        if (!L.has(slot)) continue;
        const pv = v(slot);
        for (const m of pv === 'strum' ? guitarVoicing(ch) : ch.pad || ch.chord) add(pv === 'strum' ? 'guitar' : pv, m);
      }
      if (L.has('strum') && T.strum) for (const m of guitarVoicing(ch)) add(v('strum'), m);
      if (L.has('stab')) {
        if (v('stab') === 'piano') for (const m of stabNotes(ch.chord)) add('piano', m);
        if (v('stab') === 'strum') for (const m of guitarVoicing(ch)) add('guitar', m);
      }
    }
    if (L.has('lead') && T.lead) for (const n of T.lead.notes) add(v('lead'), n[1]);
    if (L.has('counter') && T.counter) for (const n of T.counter.notes) add(v('counter'), n[1]);
  }
  return need;
}

// Where each instrument sits: its level, its place in the stereo field, and
// how much of it reaches the hall (reverb), the room and the delay. A voice
// marked `pump` is still part machine, and goes through the kick's duck.
const BUS = {
  piano: { gain: 1.05, pan: 0.05, reverb: 0.3, room: 0.5 },
  epiano: { gain: 0.82, autopan: [3.1, 0.5], reverb: 0.18, room: 0.2, delay: 0.22 },
  marimba: { gain: 0.9, pan: -0.15, reverb: 0.2, room: 0.4, delay: 0.1 },
  vibes: { gain: 0.75, pan: 0.2, tremolo: [5.2, 0.3], reverb: 0.35, room: 0.3, delay: 0.18 },
  kalimba: { gain: 0.84, pan: 0.2, reverb: 0.3, room: 0.2, delay: 0.4, pump: true },
  glock: { gain: 0.52, pan: 0.3, reverb: 0.35, room: 0.2, delay: 0.25 },
  musicbox: { gain: 0.6, pan: 0.25, reverb: 0.4, room: 0.35, delay: 0.1 },
  guitar: { gain: 1.25, pan: -0.2, reverb: 0.2, room: 0.4 },
  harp: { gain: 0.9, pan: 0.3, reverb: 0.4, room: 0.3, delay: 0.1 },
  pluck: { gain: 1.35, reverb: 0.03, room: 0.15 },
  upright: { gain: 1.45, reverb: 0.05, room: 0.3 },
  warm: { gain: 1, reverb: 0.5, pump: true },
  strings: { gain: 1, reverb: 0.55, room: 0.3 },
  choir: { gain: 1, reverb: 0.7, room: 0.2 },
  harmonium: { gain: 1, pan: -0.1, reverb: 0.35, room: 0.4 },
  glide: { gain: 1, reverb: 0.35, delay: 0.35, pump: true },
  cello: { gain: 1, pan: -0.15, reverb: 0.4, room: 0.4 },
  viola: { gain: 1, pan: 0.05, reverb: 0.4, room: 0.4 },
  violin: { gain: 1, pan: 0.15, reverb: 0.45, room: 0.35 },
  arco: { gain: 1, reverb: 0.3, room: 0.4 },
  flute: { gain: 1, pan: 0.1, reverb: 0.45, room: 0.3, delay: 0.12 },
  whistle: { gain: 1, pan: 0.1, reverb: 0.5, room: 0.2, delay: 0.15 },
  reed: { gain: 1, pan: -0.1, reverb: 0.35, room: 0.4 },
  voice: { gain: 1, reverb: 0.6, room: 0.2, delay: 0.1 },
  factory: { gain: 1.33, reverb: 0.25, room: 0.35 },
  hand: { gain: 1.48, reverb: 0.1, room: 0.45 },
  kit: { gain: 1.4, reverb: 0.08, room: 0.45 },
  brushes: { gain: 1.45, reverb: 0.12, room: 0.5 },
  orch: { gain: 0.83, reverb: 0.5, room: 0.3 },
  perc: { gain: 1, pan: 0.2, reverb: 0.1, room: 0.4 },
};

// A played note's damper: how quickly it falls silent when let go.
const DAMP = { piano: 0.08, epiano: 0.07, guitar: 0.05, harp: 0.12, pluck: 0.04, upright: 0.05 };

// Bowed strings: body filters, vibrato (cents), level and how the bow starts.
const BOWED = {
  cello: { lp: 2600, body: [240, 5, 1.1], vib: 14, rate: 5.2, level: 0.31, attack: 0.11, release: 0.22 },
  viola: { lp: 3400, body: [400, 4, 1.1], vib: 15, rate: 5.4, level: 0.34, attack: 0.09, release: 0.2 },
  violin: { lp: 5200, body: [2600, 4, 1], vib: 18, rate: 5.8, level: 0.33, attack: 0.08, release: 0.2 },
  arco: { lp: 1300, body: [120, 5, 1.2], vib: 7, rate: 4.8, level: 0.3, attack: 0.1, release: 0.25 },
};

// A vowel is where its formants sit, and they stay put whatever the pitch:
// that is what makes many voices sound like one.
export const VOWELS = {
  aah: [730, 1090, 2440],
  eh: [530, 1840, 2480],
  ee: [300, 2250, 3000],
  oh: [570, 840, 2410],
  ooh: [320, 870, 2240],
  uh: [520, 1190, 2390],
};
const FORMANT_Q = [7, 10, 14];
const FORMANT_GAIN = [1, 0.62, 0.3];

// Metal and wood as a few partials, [ratio, amplitude, seconds].
const ANVIL = [[1, 1, 0.45], [2.76, 0.55, 0.22], [5.18, 0.3, 0.12], [8.1, 0.15, 0.06]];
const CLANK = [[1, 1, 0.5], [2.32, 0.6, 0.3], [3.87, 0.35, 0.18]];
const PLATE = [[1, 1, 0.18], [1.59, 0.6, 0.12], [2.14, 0.45, 0.09], [2.3, 0.3, 0.07]];
const HOLLOW = [[1, 1, 0.09], [2.71, 0.5, 0.05], [4.1, 0.3, 0.03]];

// Every note the jingles use, rendered ahead when the level's humanity is set.
const JINGLES = {
  powerup: [72, 76, 79, 84, 88],
  shield: [67, 74, 79, 86],
  cell: [67, 74, 79, 86, 91, 98],
  down: [62, 58, 55, 50],
  checkpoint: [64, 71, 76],
  secret: [72, 79, 84, 91, 96],
  unlock: [67, 71, 74, 79],
  switch: [72, 79],
  exitOpen: [62, 69, 74, 78, 81],
  cleared: [74, 78, 81, 86, 90, 93],
  phase: [50, 57, 62, 69],
  victory: [62, 66, 69, 74, 78, 81],
  freeze: [93, 88, 84, 79],
};
const JINGLE_NOTES = [...new Set([...Object.values(JINGLES).flat(), ...JINGLES.checkpoint.map((n) => n + 3)])];

// A quiet bed under a level: a rendered loop, events on the audio clock, or both.
const AMB = {
  rain: { loop: 'rain', gain: 0.5 },
  water: { loop: 'water', gain: 0.6 },
  wind: { loop: 'wind', gain: 0.55 },
  fans: { loop: 'fans', gain: 0.45 },
  room: { loop: 'room', gain: 0.5 },
  hum: { loop: 'hum', gain: 0.18 },
  stream: { loop: 'stream', gain: 0.45 },
  tunnel: { loop: 'tunnel', gain: 0.55, event: 'train', every: [28, 55] },
  furnace: { loop: 'furnace', gain: 0.5, event: 'clank', every: [3, 9] },
  traffic: { loop: 'road', gain: 0.5, event: 'truck', every: [5, 12] },
  gulls: { event: 'gull', every: [4, 11] },
  birds: { event: 'bird', every: [1.2, 4] },
  clock: { event: 'clockTick', every: [1, 1] },
  drips: { event: 'drip', every: [0.8, 3.5] },
  data: { event: 'blip', every: [0.12, 0.7] },
};
export const AMBIENCE = Object.keys(AMB);
const AMB_LEVEL = 0.5;

// Sounds that can come many to a frame; one each is plenty.
const CUE_GAP = { step: 0.06, ricochet: 0.03, hit: 0.03, thunk: 0.04, hollow: 0.04, hum: 0.5, shot: 0.03, dry: 0.08, fizzle: 0.08, pop: 0.02 };

export class VectorAudio extends AudioEngine {
  constructor() {
    super();
    this.humanity = 0; // the music's, from the track playing
    this.sfxHuman = 0; // the sound effects', from setHumanity
    this.boss = false;
    this.bank = new Map(); // `${instrument}:${midi}` -> AudioBuffer
    this.loops = new Map(); // ambience name -> AudioBuffer
    this.queue = []; // notes to render in the gaps between ticks
    this.queued = new Set();
    this.buses = {};
    this.section = null;
    this.chord = null;
    this.stepDur = 0.15;
    this.lines = {}; // each melody's last note, for legato
    this.ringing = []; // the guitar strings the last strum left ringing
    this.amb = null;
    this.ambLevel = 1;
    this.lastCue = {};
    this.startBar = 0;
    this.tock = false;
    this.rand = rng(1);
  }

  /** Play on a context made elsewhere (an OfflineAudioContext, for the checker) instead of the browser's own. */
  attach(ctx) {
    this.ctx = ctx;
    this.buildGraph();
    return this;
  }

  buildGraph() {
    super.buildGraph();
    const c = this.ctx;
    const gain = (v) => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    // A small wooden room for the acoustic instruments, under the engine's
    // hall: close walls, and a short tail with the top taken off.
    this.roomSend = gain(1);
    this.room = c.createConvolver();
    // At the lightest detail the room stays empty, as the engine's halls do.
    if (!SOUND_DETAIL[this.detail] || SOUND_DETAIL[this.detail].reverb) this.room.buffer = roomImpulse(c);
    this.roomReturn = gain(0.2);
    this.roomSend.connect(this.room);
    this.room.connect(this.roomReturn);
    this.roomReturn.connect(this.musicBus);
    // The ambience has its own level, and fades on its own; it is not music, so the
    // effects' volume sets it too.
    this.ambBus = gain(0.0001);
    this.ambBus.connect(this.sfxVol);
    // A limiter after the engine's compressor: the engine's fullest sections
    // peak a little over full scale, and here music, ambience and cues all
    // land on top of each other.
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;
    this.comp.disconnect();
    this.comp.connect(this.limiter);
    this.limiter.connect(c.destination);
    this.buses = {};
    this.bank.clear();
    this.loops.clear();
    this.queue = [];
    this.queued.clear();
    // Most notes are rendered at half the context's rate: half the memory, and nothing above 12 kHz is missed.
    this.half = Math.max(16000, Math.round(c.sampleRate / 2));
  }

  // ------------------------------------------------------------- the story

  /** The sound effects' humanity, 0 (grid blips) to 1 (clicks, thuds and whooshes). The game sets it at each level's start. */
  setHumanity(h) {
    this.sfxHuman = clamp(Number(h) || 0, 0, 1);
    if (this.ctx) for (const [inst, m] of this.sfxNotes()) this.want(inst, m, true);
  }

  /** The rendered notes the cues play at this humanity: rendered ahead, never in the middle of a fight. */
  sfxNotes() {
    if (this.sfxHuman < 0.25) return [];
    const list = JINGLE_NOTES.map((m) => [this.jingleVoice(), m]);
    for (const m of [...JINGLES.down, ...JINGLES.phase]) list.push(['piano', m]);
    for (const m of JINGLES.freeze) list.push(['glock', m]);
    return list.map(([inst, m]) => [inst, jingleRoot(m), true]);
  }

  /** The boss fight: the track hurries, by less the more human it is, and opens up. Off, it settles back. */
  bossTime(on) {
    this.boss = !!on;
    const T = this.track;
    const bt = T ? T.bossTempo ?? bossTempoFor(T.humanity ?? 0) : 2;
    this.tempoTarget = on ? bt : 1;
    this.intensityTarget = on ? 0.85 : 0.25;
  }

  /** A gentle swell with the action (dynamics and filters, never the tempo). */
  setAction(v) {
    if (this.boss) return;
    this.intensityTarget = clamp(v, 0, 0.6);
  }

  /** How loud the ambience sits, 0 to 1 (indoors, a cutscene). */
  setAmbience(v) {
    this.ambLevel = clamp(v, 0, 1);
    if (!this.ctx || !this.amb) return;
    this.ambBus.gain.setTargetAtTime(Math.max(0.0001, AMB_LEVEL * this.ambLevel), this.ctx.currentTime, 0.3);
  }

  /** Play a track from its start, or from bar `from`. */
  playTrack(track, from = 0) {
    if (!this.ctx) return;
    this.humanity = clamp(track.humanity ?? 0, 0, 1);
    this.rand = rng(hash(track.title || 'vector'));
    this.lines = {};
    this.ringing = [];
    this.boss = false;
    this.startBar = from;
    this.prepare(track, from);
    const fx = track.fx || {};
    this.roomReturn.gain.setTargetAtTime(fx.room ?? 0.12 + 0.3 * this.humanity, this.ctx.currentTime, 0.05);
    this.trackStart = this.ctx.currentTime + 0.06; // where the engine puts the first step
    super.playTrack(track);
    this.startAmbience(track.ambience);
    this.intensityTarget = 0.2;
  }

  stopTrack(fade = 1.5) {
    super.stopTrack(fade);
    this.stopAmbience(fade);
  }

  tick() {
    if (this.startBar && this.track) {
      this.step = this.startBar * 16;
      this.startBar = 0;
    }
    super.tick();
    if (!this.track) return;
    // Like a step, a bed or a note that cannot be made costs only itself.
    try {
      this.ambienceTick();
      this.warmUp(4);
    } catch (err) {
      this.fault(err);
    }
  }

  /** Schedule everything up to `until` on the audio clock at once: for rendering offline, where no timer runs. */
  scheduleUntil(until) {
    const T = this.track;
    if (!T) return;
    if (this.startBar) {
      this.step = this.startBar * 16;
      this.startBar = 0;
    }
    this.tempoScale = this.tempoTarget;
    this.intensity = this.intensityTarget;
    while (this.nextStepTime < until) {
      const bpm = T.bpm * this.tempoScale;
      this.currentBpm = bpm;
      const stepDur = 60 / bpm / 4;
      this.scheduleStep(this.step, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.step++;
    }
    this.ambienceTick(until);
  }

  // -------------------------------------------------------------- sequencer

  scheduleStep(step, t, stepDur) {
    const T = this.track;
    const s = step % 16;
    const { section, barIn, virtualBar } = this.sectionAt(Math.floor(step / 16));
    const { chord, isStart, bars: chordBars } = this.chordAt(virtualBar);
    this.section = section;
    this.chord = chord;
    this.stepDur = stepDur;
    // Swing: the off-beats lean late, by as much of a step as the track asks.
    let at = t;
    if (T.swing && s % 2 === 1) at += T.swing * stepDur;
    if (T.shuffle && s % 4 === 2) at += T.shuffle * stepDur;
    super.scheduleStep(step, at, stepDur);
    const L = section.layers;
    if (L.has('pad2') && T.pad2 && s === 0 && (isStart || barIn === 0)) {
      const remaining = isStart ? chordBars : chordBars - ((virtualBar - section.start) % chordBars);
      this.padVoice(this.voice('pad2'), at, chord.pad || chord.chord, remaining * 16 * stepDur, section.padBright || 0, T.pad2);
    }
    if (L.has('strum') && T.strum && this.voice('strum') !== 'none') {
      const v = T.strum.pattern[s];
      if (v) this.strum(at, guitarVoicing(chord), Math.abs(v), v < 0 ? -1 : 1);
    }
    if (L.has('counter') && T.counter) {
      const pos = (barIn * 16 + s) % T.counter.length;
      for (const n of T.counter.notes) if (n[0] === pos) this.line('counter', this.voice('counter'), at, n[1], n[2] * stepDur);
    }
    if (L.has('perc') && T.perc) {
      for (const name in T.perc) {
        const v = T.perc[name][s];
        if (v) this.perc(name, at, v);
      }
    }
  }

  voice(slot) {
    return pickVoice(this.track, this.section, slot);
  }

  /** A human's hands: a few ms late at random, and never quite the same weight twice. */
  feel(t, vel) {
    const h = this.humanity;
    return [t + this.rand() * 0.008 * h, vel * (1 + (this.rand() - 0.5) * 0.22 * h)];
  }

  /** How hard the players dig in: a little harder as the action rises. */
  dyn() {
    return 0.8 + 0.4 * this.intensity;
  }

  // The engine's voices, each answering to the slot's chosen timbre.

  pad(t, midis, dur, bright = 0) {
    this.padVoice(this.voice('pad'), t, midis, dur, bright, (this.track && this.track.pad) || {});
  }

  padVoice(v, t, midis, dur, bright, o = {}) {
    switch (v) {
      case 'synth':
        return super.pad(t, midis, dur, bright);
      case 'warm':
        return this.warmPad(t, midis, dur, bright, o);
      case 'strings':
        return this.stringPad(t, midis, dur, bright, o);
      case 'choir':
        return this.choir(t, midis, dur, bright, o);
      case 'harmonium':
        return this.harmonium(t, midis, dur, bright);
      case 'piano':
      case 'epiano':
        return this.chordStrike(v, t, midis, dur, 0.45);
      case 'strum':
        return this.strum(t, this.chord ? guitarVoicing(this.chord) : midis, 0.8, 1, dur);
      default:
        return undefined;
    }
  }

  arp(t, midi, dur, step) {
    const v = this.voice('arp');
    if (v === 'synth') return super.arp(t, midi, dur, step);
    if (v === 'none') return;
    const A = this.track.arp;
    const accent = step % 4 === 0 ? 1 : step % 2 === 0 ? 0.84 : 0.72;
    const [at, vel] = this.feel(t, (A.vel ?? 0.65) * accent * this.dyn());
    this.strike(v, at, midi, vel, (A.ring ?? 4) * this.stepDur);
  }

  bell(t, midi, dur, step) {
    const v = this.voice('bell');
    if (v === 'synth') return super.bell(t, midi, dur, step);
    if (v === 'none') return;
    const [at, vel] = this.feel(t, (this.track.bell.vel ?? 0.55) * this.dyn());
    this.strike(v, at, midi, vel, dur);
  }

  bass(t, midi, dur, vel = 1) {
    const v = this.voice('bass');
    if (v === 'synth') return super.bass(t, midi, dur, vel);
    if (v === 'arco') return this.bowed('arco', t, midi, dur, vel, 'bass');
    if (v === 'none') return;
    const [at, v2] = this.feel(t, vel * (v === 'piano' ? 0.75 : 0.9) * this.dyn());
    this.strike(v, at, midi, v2, dur + 0.04);
  }

  lead(t, midi, dur) {
    this.line('lead', this.voice('lead'), t, midi, dur);
  }

  /** A melody note on whichever voice carries this line. */
  line(slot, v, t, midi, dur) {
    switch (v) {
      case 'synth':
        // The engine's lead keeps one legato memory; a second synth line glides on its own.
        if (slot === 'lead') return super.lead(t, midi, dur);
        return this.glide(t, midi, dur, slot);
      case 'glide':
        return this.glide(t, midi, dur, slot);
      case 'cello':
      case 'viola':
      case 'violin':
        return this.bowed(v, t, midi, dur, 1, slot);
      case 'flute':
      case 'whistle':
        return this.blown(v, t, midi, dur, slot);
      case 'reed':
        return this.reed(t, midi, dur, slot);
      case 'voice':
        return this.sing(t, midi, dur, slot);
      case 'none':
        return undefined;
      default: {
        const [at, vel] = this.feel(t, 0.78 * this.dyn());
        this.strike(v, at, midi, vel, dur + 0.12);
        return undefined;
      }
    }
  }

  stab(t, midis) {
    switch (this.voice('stab')) {
      case 'synth':
        return super.stab(t, midis);
      case 'piano':
        return this.chordStrike('piano', t, stabNotes(midis), 1.1, 0.95);
      case 'strings':
        return this.stringPad(t, midis.map((m) => m + 12), 0.32, 0.8, { attack: 0.025, release: 0.35, level: 1.6 });
      case 'strum':
        return this.strum(t, this.chord ? guitarVoicing(this.chord) : midis, 1, 1);
      default:
        return undefined;
    }
  }

  riser(t, dur) {
    switch (this.voice('riser')) {
      case 'synth':
        return super.riser(t, dur);
      case 'cymbal':
        return this.cymbalSwell(t, dur, 1);
      case 'roll':
        return this.drumRoll(t, dur);
      default:
        return undefined;
    }
  }

  kick(t, vel = 1) {
    const v = this.voice('kick');
    if (v === 'synth') {
      super.kick(t, vel);
      this.pump(t);
      return;
    }
    if (t > this.lastKickAt) this.lastKickAt = t;
    const d = this.bus(v).input;
    const [at, w] = this.feel(t, vel * this.dyn());
    if (v === 'factory') this.slam(d, at, w);
    else if (v === 'hand') this.lowDrum(d, at, w);
    else if (v === 'kit') this.bassDrum(d, at, w);
    else if (v === 'brushes') this.feltKick(d, at, w);
    else if (v === 'orch') this.timpani(d, at, w);
  }

  snare(t, vel = 1) {
    const v = this.voice('snare');
    if (v === 'synth') return super.snare(t, vel);
    const d = this.bus(v).input;
    const [at, w] = this.feel(t, vel * this.dyn());
    if (v === 'factory') this.anvil(d, at, w);
    else if (v === 'hand') this.slap(d, at, w);
    else if (v === 'kit') this.snareDrum(d, at, w);
    else if (v === 'brushes') this.brush(d, at, w);
    else if (v === 'orch') this.bigDrum(d, at, w);
    return undefined;
  }

  hat(t, vel = 1, open = false) {
    const v = this.voice('hat');
    if (v === 'synth') return super.hat(t, vel, open);
    const d = this.bus(v).input;
    const [at, w] = this.feel(t, vel * this.dyn());
    if (v === 'factory') this.metalTick(d, at, w, open);
    else if (v === 'hand') this.shaker(d, at, w, open);
    else if (v === 'kit') this.hihat(d, at, w, open);
    else if (v === 'brushes') this.ride(d, at, w, open);
    else if (v === 'orch') this.colLegno(d, at, w, open);
    return undefined;
  }

  /** The engine's kick has ducked the pads; this sets how deep, by how much of the grid is left in the track. */
  pump(t) {
    const T = this.track;
    const depth = 0.65 * (T && T.pump !== undefined ? T.pump : pumpFor(this.humanity));
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(1, t);
    if (depth < 0.01) return;
    d.linearRampToValueAtTime(1 - depth, t + 0.015);
    d.linearRampToValueAtTime(1, t + 0.28);
  }

  // ------------------------------------------------------ rendered notes

  /** An instrument's own channel: level, place, and what it sends to the hall, the room and the delay. */
  bus(name) {
    const have = this.buses[name];
    if (have) return have;
    const c = this.ctx;
    const spec = BUS[name] || {};
    const input = c.createGain();
    input.gain.value = spec.gain ?? 0.5;
    const pan = c.createStereoPanner();
    pan.pan.value = spec.pan ?? 0;
    input.connect(pan);
    pan.connect(spec.pump ? this.duck : this.musicBus);
    const send = (dest, v) => {
      if (!v) return;
      const g = c.createGain();
      g.gain.value = v;
      pan.connect(g);
      g.connect(dest);
    };
    send(this.reverbSend, spec.reverb);
    send(this.delaySend, spec.delay);
    send(this.roomSend, spec.room);
    // A vibraphone's motor turns the discs in its tubes: every bar wavers together.
    if (spec.tremolo) this.lfo(spec.tremolo[0], spec.tremolo[1] * input.gain.value, input.gain);
    // An electric piano's tremolo swings it across the room.
    if (spec.autopan) this.lfo(spec.autopan[0], spec.autopan[1], pan.pan);
    const b = { input, pan };
    this.buses[name] = b;
    return b;
  }

  lfo(rate, depth, param) {
    const o = this.osc('sine', rate, this.ctx.currentTime);
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(param);
    o.start();
    return o;
  }

  /** The buffer for one note of a rendered instrument, made now if it isn't ready; `short` for a jingle's cut-down copy. */
  note(inst, midi, short = false) {
    const key = (short ? '~' : '') + inst + ':' + midi;
    let buf = this.bank.get(key);
    if (buf) return buf;
    const r = RENDER[inst];
    if (!r || !this.ctx) return null;
    const rate = midi > r.full ? this.ctx.sampleRate : this.half;
    let data = r.make(rate, midi);
    if (short && data.length > rate * JINGLE_SECS) {
      data = data.slice(0, Math.floor(rate * JINGLE_SECS));
      const n = Math.floor(rate * 0.08);
      for (let i = 0; i < n; i++) data[data.length - 1 - i] *= i / n;
    }
    buf = this.ctx.createBuffer(1, data.length, rate);
    buf.getChannelData(0).set(data);
    this.bank.set(key, buf);
    return buf;
  }

  want(inst, midi, short = false) {
    midi = short ? jingleRoot(midi) : sampleRoot(midi);
    const key = (short ? '~' : '') + inst + ':' + midi;
    if (!RENDER[inst] || this.bank.has(key) || this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push([inst, midi, short]);
  }

  /** Render queued notes for up to `ms` of the main thread. */
  warmUp(ms) {
    const until = now() + ms;
    while (this.queue.length && now() < until) {
      const [inst, midi, short] = this.queue.shift();
      this.queued.delete((short ? '~' : '') + inst + ':' + midi);
      this.note(inst, midi, short);
    }
  }

  /** Keep only what this track (and the jingles) will play, and queue the rest, in the order the sections will want it. */
  prepare(track, from = 0) {
    const need = notesOf(track);
    const sfx = this.sfxNotes();
    const keep = new Set();
    for (const [inst, set] of need) for (const m of set) keep.add(inst + ':' + m);
    for (const [inst, m] of sfx) keep.add('~' + inst + ':' + m);
    for (const key of [...this.bank.keys()]) if (!keep.has(key)) this.bank.delete(key);
    this.queue = [];
    this.queued.clear();
    // The section playing first, then the next, round to the start.
    let bar = 0;
    let first = 0;
    track.sections.forEach((sec, i) => {
      if (from >= bar) first = i;
      bar += sec.bars;
    });
    const n = track.sections.length;
    for (let k = 0; k < n; k++) {
      const one = notesOf({ ...track, sections: [track.sections[(first + k) % n]] });
      for (const [inst, set] of one) for (const m of [...set].sort((a, b) => a - b)) this.want(inst, m);
    }
    for (const [inst, m] of sfx) this.want(inst, m, true);
  }

  /** One rendered note at t: through its instrument's channel, or `out`, damped after `hold` seconds if it rings that long. */
  strike(inst, t, midi, vel, hold = Infinity, out = null, short = false) {
    const root = short ? jingleRoot(midi) : sampleRoot(midi);
    const buf = this.note(inst, root, short);
    if (!buf) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    if (midi !== root) src.playbackRate.value = Math.pow(2, (midi - root) / 12);
    // Strings drift a hair out of tune; bars and hammers don't.
    if ((inst === 'guitar' || inst === 'harp') && src.detune) src.detune.value = (this.rand() - 0.5) * 5;
    const g = c.createGain();
    g.gain.value = vel;
    src.connect(g);
    g.connect(out || this.bus(inst).input);
    src.start(t);
    if (hold < buf.duration / src.playbackRate.value - 0.05) {
      const tc = DAMP[inst] ?? 0.1;
      g.gain.setValueAtTime(vel, t + hold);
      g.gain.setTargetAtTime(0, t + hold, tc);
      src.stop(t + hold + tc * 7);
    }
    return { src, g };
  }

  /** A chord on the piano or the electric piano, rolled the way hands put it down. */
  chordStrike(inst, t, midis, hold, vel) {
    midis.forEach((m, i) => {
      const [at, v] = this.feel(t + i * (0.008 + 0.006 * this.rand()), vel * (0.85 + 0.15 * this.rand()) * this.dyn());
      this.strike(inst, at, m, v * (i === 0 ? 0.9 : 0.75), hold);
    });
  }

  /** A strum: every string in 10 to 30 ms, low to high going down, and only the top strings coming back up. */
  strum(t, notes, vel, dir, hold = 3) {
    // A new stroke stops the strings still ringing from the last one.
    for (const s of this.ringing) {
      s.g.gain.cancelScheduledValues(t);
      s.g.gain.setTargetAtTime(0, t, 0.015);
      try {
        s.src.stop(t + 0.12);
      } catch (_) {
        // it had already stopped on its own
      }
    }
    this.ringing = [];
    const up = dir < 0;
    const strings = up ? [...notes].reverse().slice(0, 4) : notes;
    const span = (0.03 - 0.016 * vel) * (up ? 0.7 : 1); // a harder stroke crosses the strings quicker
    strings.forEach((m, i) => {
      const [at, v] = this.feel(t + (i * span) / Math.max(1, strings.length - 1), vel * (up ? 0.5 : 0.72) * (1 - i * 0.04) * this.dyn());
      const s = this.strike('guitar', at, m, v, hold);
      if (s) this.ringing.push(s);
    });
  }

  // --------------------------------------------------------- live voices

  /** Envelope on a new gain: rise over `attack`, hold, fall over `release` after `dur`. */
  envelope(t, level, attack, dur, release) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + Math.max(dur, attack + 0.01));
    g.gain.linearRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.01) + release);
    return g;
  }

  filter(type, freq, q = 0.7, gainDb = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (gainDb) f.gain.value = gainDb;
    return f;
  }

  /** A vibrato that waits: players settle into a note before they move it. */
  vibrato(t, rate, cents, delay, targets) {
    const c = this.ctx;
    const o = this.osc('sine', rate, t);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueAtTime(0, t + delay);
    g.gain.linearRampToValueAtTime(cents, t + delay + 0.45);
    o.connect(g);
    for (const p of targets) g.connect(p);
    return o;
  }

  /** The last synth pad before the strings: triangles, softer and slower, still pumping a little. */
  warmPad(t, midis, dur, bright, o) {
    const c = this.ctx;
    const attack = o.attack ?? 1.2;
    const release = o.release ?? 1.8;
    const g = this.envelope(t, 0.14, attack, dur, release);
    const lp = this.filter('lowpass', (o.cutoff ?? 600) + 700 * bright + 1400 * this.intensity, 0.8);
    lp.connect(g);
    g.connect(this.bus('warm').input);
    const oscs = [];
    for (const m of midis) {
      for (const det of [-8, 7]) {
        const w = this.osc('triangle', mtof(m), t);
        w.detune.value = det;
        w.connect(lp);
        oscs.push(w);
      }
    }
    const sub = this.osc('sine', mtof(midis[0] - 12), t);
    const sg = c.createGain();
    sg.gain.value = 0.6;
    sub.connect(sg);
    sg.connect(lp);
    oscs.push(sub);
    const end = t + dur + release + 0.1;
    for (const w of oscs) {
      w.start(t);
      w.stop(end);
    }
  }

  /** A string section: two players on every note, one each side, bowing in slowly and moving together. */
  stringPad(t, midis, dur, bright, o = {}) {
    const c = this.ctx;
    const attack = o.attack ?? 0.8;
    const release = o.release ?? 1.3;
    const g = this.envelope(t, 0.125 * (o.level ?? 1), attack, dur, release);
    const lp = this.filter('lowpass', 1700 + 1400 * bright + 1800 * this.intensity, 0.5);
    const body = this.filter('peaking', 520, 0.9, 3);
    const sides = [-0.45, 0.45].map((p) => {
      const pan = c.createStereoPanner();
      pan.pan.value = p;
      pan.connect(lp);
      return pan;
    });
    lp.connect(body);
    body.connect(g);
    g.connect(this.bus('strings').input);
    const oscs = [];
    const detunes = [];
    for (const m of midis) {
      sides.forEach((pan, i) => {
        const w = this.osc('sawtooth', mtof(m), t);
        w.detune.value = (i ? 1 : -1) * (4 + 4 * this.rand());
        w.connect(pan);
        oscs.push(w);
        detunes.push(w.detune);
      });
    }
    oscs.push(this.vibrato(t, 5.1, 7, attack * 0.8, detunes));
    const end = t + Math.max(dur, attack) + release + 0.1;
    for (const w of oscs) {
      w.start(t);
      w.stop(end);
    }
  }

  /** A soft wordless choir: every voice through one set of formants, so they sing the same vowel. */
  choir(t, midis, dur, bright, o = {}) {
    const c = this.ctx;
    const attack = o.attack ?? 1.1;
    const release = o.release ?? 1.6;
    const g = this.envelope(t, 0.24 * (o.level ?? 1) * (0.85 + 0.3 * this.intensity), attack, dur, release);
    g.connect(this.bus('choir').input);
    const pre = this.filter('lowpass', 3200 + 800 * bright, 0.5);
    this.formants(pre, g, o.vowel || 'aah', t, o.to, t + dur);
    const oscs = [];
    const detunes = [];
    // Nobody in a choir sings that low; those notes go up an octave.
    const notes = [...new Set(midis.map((m) => (m < 48 ? m + 12 : m)))];
    for (const m of notes) {
      for (const det of [-9, 8]) {
        const w = this.osc('sawtooth', mtof(m), t);
        w.detune.value = det + (this.rand() - 0.5) * 4;
        w.connect(pre);
        oscs.push(w);
        detunes.push(w.detune);
      }
    }
    oscs.push(this.vibrato(t, 5.3, 11, attack * 0.7, detunes));
    const breath = this.noiseSrc(t);
    const bg = c.createGain();
    bg.gain.value = 0.02;
    const bh = this.filter('highpass', 1500, 0.7);
    breath.connect(bh);
    bh.connect(bg);
    bg.connect(pre);
    const end = t + Math.max(dur, attack) + release + 0.1;
    for (const w of oscs) {
      w.start(t);
      w.stop(end);
    }
    breath.stop(end);
  }

  /** Three bandpass filters in parallel from `input` to `out`: a vowel, optionally sliding to another. */
  formants(input, out, vowel, t, to, until) {
    const c = this.ctx;
    const V = VOWELS[vowel] || VOWELS.aah;
    const bands = [];
    for (let i = 0; i < 3; i++) {
      const bp = this.filter('bandpass', V[i], FORMANT_Q[i]);
      const fg = c.createGain();
      fg.gain.value = FORMANT_GAIN[i] * 3;
      input.connect(bp);
      bp.connect(fg);
      fg.connect(out);
      if (to && VOWELS[to]) {
        bp.frequency.setValueAtTime(V[i], t);
        bp.frequency.linearRampToValueAtTime(VOWELS[to][i], until);
      }
      bands.push(bp);
    }
    return bands;
  }

  /** A reed organ: bellows push air through brass reeds, rich and a little breathless. */
  harmonium(t, midis, dur, bright) {
    const c = this.ctx;
    const g = this.envelope(t, 0.1, 0.18, dur, 0.3);
    const lp = this.filter('lowpass', 1500 + 800 * bright, 0.6);
    const body = this.filter('peaking', 950, 1, 4);
    lp.connect(body);
    body.connect(g);
    g.connect(this.bus('harmonium').input);
    const oscs = [];
    for (const m of midis) {
      for (const det of [-4, 4]) {
        const w = this.osc('sawtooth', mtof(m), t);
        w.detune.value = det;
        w.connect(lp);
        oscs.push(w);
      }
    }
    // The bellows never push quite evenly.
    const wob = this.osc('sine', 0.6, t);
    const wg = c.createGain();
    wg.gain.value = 0.006;
    wob.connect(wg);
    wg.connect(g.gain);
    oscs.push(wob);
    const end = t + dur + 0.4;
    for (const w of oscs) {
      w.start(t);
      w.stop(end);
    }
  }

  /** Whether a line's new note follows straight on from its last: then it slides, not starts. */
  legato(slot, t) {
    const prev = this.lines[slot];
    return prev && t - prev.end < 0.06 && t >= prev.start ? prev.f : 0;
  }

  /** The last synth lead: triangles and a sine, gliding between notes, still pumping a little. */
  glide(t, midi, dur, slot) {
    const f = mtof(midi);
    const from = this.legato(slot, t);
    const o1 = this.osc('triangle', f, t);
    const o2 = this.osc('sine', f * 2, t);
    if (from) {
      o1.frequency.setValueAtTime(from, t);
      o1.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      o2.frequency.setValueAtTime(from * 2, t);
      o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.05);
    }
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.18;
    const lp = this.filter('lowpass', 2400 + 1500 * this.intensity, 1);
    const g = this.envelope(t, 0.26, from ? 0.01 : 0.02, dur, 0.14);
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.bus('glide').input);
    const vib = this.vibrato(t, 5.5, 8, 0.25, [o1.detune, o2.detune]);
    for (const o of [o1, o2, vib]) {
      o.start(t);
      o.stop(t + dur + 0.2);
    }
    this.lines[slot] = { f, start: t, end: t + dur };
  }

  /** A bowed string: the bow's attack and its rasp, the body's resonance, a finger settling into pitch, and vibrato after. */
  bowed(kind, t, midi, dur, vel = 1, slot = 'lead') {
    const c = this.ctx;
    const B = BOWED[kind];
    const f = mtof(midi);
    const [at, v] = this.feel(t, vel * B.level * this.dyn());
    const from = this.legato(slot, at);
    const o = this.osc('sawtooth', f, at);
    if (from) {
      o.frequency.setValueAtTime(from, at);
      o.frequency.exponentialRampToValueAtTime(f, at + 0.07);
    } else {
      o.detune.setValueAtTime(-18, at);
      o.detune.linearRampToValueAtTime(0, at + 0.09);
    }
    const lp = this.filter('lowpass', B.lp + 1200 * this.intensity, 0.6);
    const body = this.filter('peaking', B.body[0], B.body[2], B.body[1]);
    const g = this.envelope(at, v, from ? 0.04 : B.attack, dur, B.release);
    // A long note swells a little as the bow travels.
    if (dur > 0.5) {
      g.gain.linearRampToValueAtTime(v * 1.12, at + dur * 0.6);
      g.gain.linearRampToValueAtTime(v, at + dur);
    }
    o.connect(lp);
    lp.connect(body);
    body.connect(g);
    g.connect(this.bus(kind).input);
    const vib = this.vibrato(at, B.rate + this.rand() * 0.4, B.vib, Math.min(0.25, dur * 0.35), [o.detune]);
    const end = at + dur + B.release + 0.05;
    for (const w of [o, vib]) {
      w.start(at);
      w.stop(end);
    }
    if (!from) {
      // The rasp of the bow biting the string, gone as the note speaks.
      const n = this.noiseSrc(at);
      const nb = this.filter('bandpass', Math.min(6000, f * 4), 0.9);
      const ng = c.createGain();
      ng.gain.setValueAtTime(v * 0.25, at);
      ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      n.connect(nb);
      nb.connect(ng);
      ng.connect(body);
      n.stop(at + 0.2);
    }
    this.lines[slot] = { f, start: at, end: at + dur };
  }

  /** A flute or a whistle: breath, a chiff to start, and a vibrato that moves the air as well as the pitch. */
  blown(kind, t, midi, dur, slot) {
    const c = this.ctx;
    const flute = kind === 'flute';
    const f = mtof(midi);
    const [at, v] = this.feel(t, (flute ? 0.32 : 0.23) * this.dyn());
    const from = this.legato(slot, at);
    const o1 = this.osc(flute ? 'triangle' : 'sine', f, at);
    const oscs = [o1];
    const g = this.envelope(at, v, from ? 0.03 : flute ? 0.07 : 0.04, dur, 0.1);
    const lp = this.filter('lowpass', flute ? 4200 : 5000, 0.5);
    o1.connect(lp);
    if (flute) {
      const o2 = this.osc('sine', f * 2, at);
      const g2 = c.createGain();
      g2.gain.value = 0.12;
      o2.connect(g2);
      g2.connect(lp);
      oscs.push(o2);
    }
    if (from) {
      for (const [i, o] of oscs.entries()) {
        o.frequency.setValueAtTime(from * (i + 1), at);
        o.frequency.exponentialRampToValueAtTime(f * (i + 1), at + 0.05);
      }
    } else if (!flute) {
      // A whistler finds the note from underneath.
      o1.detune.setValueAtTime(-70, at);
      o1.detune.linearRampToValueAtTime(0, at + 0.07);
    }
    lp.connect(g);
    g.connect(this.bus(kind).input);
    const vib = this.vibrato(at, flute ? 5 : 5.8, flute ? 11 : 22, Math.min(0.2, dur * 0.3), oscs.map((o) => o.detune));
    oscs.push(vib);
    if (flute) {
      const trem = c.createGain();
      trem.gain.value = v * 0.08;
      vib.connect(trem);
      trem.connect(g.gain);
    }
    // Breath: some always, and a puff at the start of a tongued note.
    const n = this.noiseSrc(at);
    const nb = this.filter('bandpass', flute ? 2600 : 3200, 0.8);
    const ng = c.createGain();
    const air = v * (flute ? 0.18 : 0.06);
    ng.gain.setValueAtTime(from ? air : air * 4, at);
    ng.gain.exponentialRampToValueAtTime(air, at + 0.05);
    ng.gain.setValueAtTime(air, at + dur);
    ng.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.1);
    n.connect(nb);
    nb.connect(ng);
    ng.connect(g);
    const end = at + dur + 0.15;
    for (const o of oscs) {
      o.start(at);
      o.stop(end);
    }
    n.stop(end);
    this.lines[slot] = { f, start: at, end: at + dur };
  }

  /** An accordion: two reeds a few cents apart, beating the way a musette does, and the bellows' swell. */
  reed(t, midi, dur, slot) {
    const c = this.ctx;
    const f = mtof(midi);
    const [at, v] = this.feel(t, 0.2 * this.dyn());
    const from = this.legato(slot, at);
    const oscs = [-9, 9].map((det) => {
      const o = this.osc('sawtooth', f, at);
      o.detune.value = det;
      if (from) {
        o.frequency.setValueAtTime(from, at);
        o.frequency.exponentialRampToValueAtTime(f, at + 0.03);
      }
      return o;
    });
    const low = this.osc('square', f / 2, at);
    const lg = c.createGain();
    lg.gain.value = 0.22;
    low.connect(lg);
    const lp = this.filter('lowpass', 2300 + 900 * this.intensity, 0.6);
    const body = this.filter('peaking', 1100, 1.2, 4);
    for (const o of oscs) o.connect(lp);
    lg.connect(lp);
    lp.connect(body);
    const g = this.envelope(at, v, from ? 0.02 : 0.05, dur, 0.08);
    body.connect(g);
    g.connect(this.bus('reed').input);
    const end = at + dur + 0.12;
    for (const o of [...oscs, low]) {
      o.start(at);
      o.stop(end);
    }
    this.lines[slot] = { f, start: at, end: at + dur };
  }

  /** One voice, singing a melody on a vowel. */
  sing(t, midi, dur, slot) {
    const f = mtof(midi);
    const T = this.track;
    const [at, v] = this.feel(t, 0.3 * this.dyn());
    const from = this.legato(slot, at);
    const o = this.osc('sawtooth', f, at);
    if (from) {
      o.frequency.setValueAtTime(from, at);
      o.frequency.exponentialRampToValueAtTime(f, at + 0.08);
    } else {
      o.detune.setValueAtTime(-25, at);
      o.detune.linearRampToValueAtTime(0, at + 0.1);
    }
    const pre = this.filter('lowpass', 3400, 0.5);
    const g = this.envelope(at, v, from ? 0.05 : 0.14, dur, 0.28);
    o.connect(pre);
    const vowel = (T && T[slot] && T[slot].vowel) || 'aah';
    this.formants(pre, g, vowel, at);
    g.connect(this.bus('voice').input);
    const vib = this.vibrato(at, 5.4, 20, Math.min(0.3, dur * 0.4), [o.detune]);
    for (const w of [o, vib]) {
      w.start(at);
      w.stop(at + dur + 0.32);
    }
    this.lines[slot] = { f, start: at, end: at + dur };
  }

  /** A cymbal swelled with soft mallets into the next section, and the crash that lands it. */
  cymbalSwell(t, dur, level = 1) {
    const d = this.bus('orch').input;
    const c = this.ctx;
    const src = this.noiseSrc(t);
    const hp = this.filter('highpass', 3500, 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * level, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    src.connect(hp);
    hp.connect(g);
    g.connect(d);
    src.stop(t + dur + 0.1);
    this.hiss(d, t + dur, 'highpass', 5000, 3000, 0.7, 0.14 * level, 1.6, 0.004);
  }

  /** A timpani roll, rising under the swell. */
  drumRoll(t, dur) {
    const c = this.ctx;
    const d = this.bus('orch').input;
    this.cymbalSwell(t, dur, 0.6);
    const src = this.noiseSrc(t);
    const bp = this.filter('bandpass', 150, 1.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    // The strokes: the roll's gain pulses at the rate of two hands.
    const am = c.createGain();
    am.gain.value = 0.6;
    const beat = this.osc('sine', 14, t);
    const bg = c.createGain();
    bg.gain.value = 0.4;
    beat.connect(bg);
    bg.connect(am.gain);
    src.connect(bp);
    bp.connect(am);
    am.connect(g);
    g.connect(d);
    beat.start(t);
    beat.stop(t + dur + 0.3);
    src.stop(t + dur + 0.3);
  }

  // ----------------------------------------------------------------- drums

  noiseSrc(t) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer;
    s.loop = true;
    s.start(t, this.rand() * 1.5);
    return s;
  }

  /** A tone from f0 to f1 (over `fall`, or the whole note), rising over `attack` and gone by `dur`. */
  tone(dest, t, wave, f0, f1, dur, vel, attack = 0.003, fall = dur) {
    const c = this.ctx;
    const o = this.osc(wave, f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + fall);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, vel), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.005));
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.03);
    return g;
  }

  /** Filtered noise, its filter sweeping from f0 to f1, rising over `attack` and gone by `dur`. */
  hiss(dest, t, type, f0, f1, q, vel, dur, attack = 0.001) {
    const c = this.ctx;
    const src = this.noiseSrc(t);
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, vel), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.005));
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.stop(t + Math.max(dur, attack) + 0.03);
    return g;
  }

  /** Struck metal or wood: a few partials, [ratio, amplitude, seconds], each dying at its own rate. */
  partials(dest, t, f, modes, vel) {
    for (const [r, a, d] of modes) this.tone(dest, t, 'sine', f * r, f * r, d, a * vel, 0.001);
  }

  /** A handful of grains from one noise source: crunching, crackling, jingling. */
  crackle(dest, t, dur, n, freq, q, vel) {
    const c = this.ctx;
    const src = this.noiseSrc(t);
    const f = this.filter('bandpass', freq, q);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    const times = [];
    for (let i = 0; i < n; i++) times.push(t + this.rand() * dur);
    times.sort((a, b) => a - b);
    for (const at of times) {
      g.gain.setValueAtTime(vel * (0.4 + 0.6 * this.rand()), at);
      g.gain.setTargetAtTime(0, at + 0.0005, 0.004);
    }
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.stop(t + dur + 0.06);
  }

  // The factory: a press for a kick, an anvil for a snare, hammered sheet for hats, steam for the open one.
  slam(d, t, v) {
    this.tone(d, t, 'sine', 125, 40, 0.5, 0.95 * v, 0.002, 0.12);
    this.hiss(d, t, 'lowpass', 1400, 300, 0.7, 0.5 * v, 0.09);
  }

  anvil(d, t, v, f = 1180) {
    this.partials(d, t, f * (0.98 + 0.04 * this.rand()), ANVIL, 0.3 * v);
    this.hiss(d, t, 'highpass', 4000, 4000, 0.7, 0.3 * v, 0.025);
  }

  metalTick(d, t, v, open) {
    this.hiss(d, t, 'bandpass', 7200, open ? 5000 : 7200, 4, 0.45 * v, open ? 0.3 : 0.03);
    this.tone(d, t, 'square', 3150, 3150, 0.018, 0.035 * v, 0.001);
  }

  // Hands: a frame drum's low tone, a slap on its rim, a shaker.
  lowDrum(d, t, v) {
    this.tone(d, t, 'sine', 108, 66, 0.38, 0.9 * v, 0.002, 0.07);
    this.hiss(d, t, 'lowpass', 700, 700, 0.8, 0.35 * v, 0.03);
  }

  slap(d, t, v) {
    this.hiss(d, t, 'bandpass', 1250, 1000, 0.9, 0.75 * v, 0.08);
    this.tone(d, t, 'sine', 370, 330, 0.1, 0.3 * v, 0.002);
    this.hiss(d, t, 'highpass', 5000, 5000, 0.7, 0.2 * v, 0.015);
  }

  shaker(d, t, v, open) {
    this.hiss(d, t, 'bandpass', 6500, 6500, 1.3, 0.38 * v, open ? 0.16 : 0.07, 0.012);
  }

  // A kit, played with sticks.
  bassDrum(d, t, v) {
    this.tone(d, t, 'sine', 95, 50, 0.45, 1.0 * v, 0.002, 0.08);
    this.tone(d, t, 'triangle', 190, 120, 0.06, 0.2 * v, 0.001);
    this.hiss(d, t, 'lowpass', 3000, 1000, 0.7, 0.3 * v, 0.012);
  }

  snareDrum(d, t, v) {
    this.tone(d, t, 'triangle', 205, 175, 0.1, 0.5 * v, 0.001);
    this.hiss(d, t, 'bandpass', 3800, 3000, 0.7, 0.7 * v, 0.19);
    this.hiss(d, t, 'highpass', 7000, 7000, 0.7, 0.25 * v, 0.06);
  }

  hihat(d, t, v, open) {
    this.hiss(d, t, 'highpass', 7800, 7800, 0.9, 0.32 * v, open ? 0.34 : 0.045);
    this.hiss(d, t, 'bandpass', 10500, 10500, 1.6, 0.18 * v, open ? 0.3 : 0.035);
  }

  // The same kit with brushes: a felt beater, a brush on the snare, a ride cymbal, a swish.
  feltKick(d, t, v) {
    this.tone(d, t, 'sine', 78, 52, 0.32, 0.75 * v, 0.004, 0.06);
    this.hiss(d, t, 'lowpass', 380, 380, 0.7, 0.15 * v, 0.03);
  }

  brush(d, t, v) {
    this.hiss(d, t, 'bandpass', 3100, 2600, 0.6, 0.5 * v, 0.17, 0.008);
    this.hiss(d, t, 'lowpass', 900, 700, 0.7, 0.12 * v, 0.06);
  }

  ride(d, t, v, open) {
    if (open) return this.swish(d, t, v);
    this.hiss(d, t, 'bandpass', 6200, 6200, 2.2, 0.2 * v, 0.1);
    return this.tone(d, t, 'sine', 4350, 4350, 0.35, 0.03 * v, 0.001);
  }

  swish(d, t, v) {
    return this.hiss(d, t, 'bandpass', 1800, 3600, 0.8, 0.4 * v, 0.32, 0.12);
  }

  // The orchestra: timpani tuned to the chord, a bass drum, strings struck with the wood of the bow.
  timpani(d, t, v) {
    let m = this.chord ? this.chord.bass : 38;
    while (m < 38) m += 12;
    while (m > 50) m -= 12;
    const f = mtof(m);
    this.tone(d, t, 'sine', f * 1.03, f, 1.5, 0.8 * v, 0.003, 0.1);
    this.tone(d, t, 'sine', f * 1.5, f * 1.5, 0.6, 0.2 * v, 0.003);
    this.hiss(d, t, 'lowpass', 800, 400, 0.7, 0.35 * v, 0.05);
  }

  bigDrum(d, t, v) {
    this.tone(d, t, 'sine', 130, 60, 0.7, 0.95 * v, 0.003, 0.14);
    this.hiss(d, t, 'lowpass', 1300, 500, 0.7, 0.45 * v, 0.1);
  }

  colLegno(d, t, v, open) {
    this.hiss(d, t, 'bandpass', 2300, 2300, 3, 0.3 * v, open ? 0.08 : 0.03);
    this.tone(d, t, 'triangle', 920, 860, 0.035, 0.12 * v, 0.001);
  }

  clap(d, t, v) {
    const c = this.ctx;
    const src = this.noiseSrc(t);
    const f = this.filter('bandpass', 1200, 1);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    // Several hands, a hair apart.
    for (const k of [0, 0.011, 0.021]) {
      g.gain.setValueAtTime(1.1 * v, t + k);
      g.gain.setTargetAtTime(0, t + k + 0.001, 0.003);
    }
    g.gain.setValueAtTime(0.8 * v, t + 0.03);
    g.gain.setTargetAtTime(0, t + 0.031, 0.04);
    src.connect(f);
    f.connect(g);
    g.connect(d);
    src.stop(t + 0.3);
  }

  /** One hit of the track's hand percussion. */
  perc(name, t, v) {
    const d = this.bus('perc').input;
    const [at, w] = this.feel(t, v * this.dyn());
    switch (name) {
      case 'shaker':
        return this.shaker(d, at, w, false);
      case 'rim':
        this.hiss(d, at, 'bandpass', 1900, 1900, 3.5, 0.5 * w, 0.03);
        return this.tone(d, at, 'triangle', 540, 500, 0.04, 0.3 * w, 0.001);
      case 'conga':
        this.tone(d, at, 'sine', 210, 190, 0.2, 0.55 * w, 0.002, 0.03);
        return this.hiss(d, at, 'bandpass', 1600, 1600, 1, 0.18 * w, 0.02);
      case 'bongo':
        this.tone(d, at, 'sine', 400, 370, 0.11, 0.45 * w, 0.002, 0.02);
        return this.hiss(d, at, 'bandpass', 2600, 2600, 1, 0.15 * w, 0.015);
      case 'clave':
        return this.tone(d, at, 'sine', 2500, 2450, 0.07, 0.35 * w, 0.001);
      case 'block':
        this.tone(d, at, 'sine', 1050, 1000, 0.05, 0.4 * w, 0.001);
        return this.tone(d, at, 'sine', 2650, 2600, 0.03, 0.15 * w, 0.001);
      case 'tamb':
        this.crackle(d, at, 0.05, 3, 8000, 2, 0.75 * w);
        return this.hiss(d, at, 'bandpass', 7500, 7500, 2, 0.45 * w, 0.14);
      case 'anvil':
        return this.anvil(d, at, w, 1560);
      case 'clank':
        return this.partials(d, at, 330, CLANK, 0.25 * w);
      case 'clap':
        return this.clap(d, at, w);
      case 'snap':
        this.hiss(d, at, 'bandpass', 2300, 2300, 2, 0.75 * w, 0.03);
        return this.tone(d, at, 'sine', 1800, 1500, 0.015, 0.18 * w, 0.001);
      case 'tick':
        this.hiss(d, at, 'highpass', 5000, 5000, 0.7, 0.3 * w, 0.006);
        return this.tone(d, at, 'square', 2900, 2900, 0.01, 0.05 * w, 0.001);
      case 'timpani':
        return this.timpani(d, at, w);
      case 'swish':
        return this.swish(d, at, w);
      default:
        return undefined;
    }
  }

  // --------------------------------------------------------------- ambience

  /** Start a track's bed: `{ rain: 0.8, hum: 0.2 }`, each kind at its level. */
  startAmbience(spec) {
    this.stopAmbience(0);
    if (!spec || !this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const a = { sources: [], events: [], pending: [] };
    const g = this.ambBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0001, AMB_LEVEL * this.ambLevel), t + 2.5);
    for (const kind in spec) {
      const k = AMB[kind];
      const level = spec[kind];
      if (!k || !level) continue;
      const out = c.createGain();
      out.gain.value = level * (k.gain ?? 1);
      out.connect(this.ambBus);
      // A loop is rendered on a later tick, not while the level is starting: it fades in over seconds anyway.
      if (k.loop) a.pending.push({ name: k.loop, out });
      if (k.event) {
        const [lo, hi] = k.every;
        // A clock keeps the track's time from its first beat.
        const first = kind === 'clock' ? Math.max(this.trackStart ?? 0, t + 0.02) : t + lo * 0.5 + this.rand() * (hi - lo);
        a.events.push({ fire: k.event, every: k.every, out, level, next: first });
      }
    }
    // Loops no track here uses are let go.
    const keep = new Set(Object.keys(spec).map((k) => AMB[k] && AMB[k].loop));
    for (const name of [...this.loops.keys()]) if (!keep.has(name)) this.loops.delete(name);
    this.amb = a;
  }

  stopAmbience(fade = 1.5) {
    const a = this.amb;
    this.amb = null;
    if (!a || !this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.ambBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(g.value, 0.0001), t);
    g.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, fade));
    for (const s of a.sources) {
      try {
        s.stop(t + Math.max(0.02, fade) + 0.05);
      } catch (_) {
        // already stopped
      }
    }
  }

  /** Start the next waiting loop (all of them, given a horizon), and fire the events that fall before `horizon` on the audio clock. */
  ambienceTick(horizon) {
    const a = this.amb;
    if (!a || !this.ctx) return;
    const t = this.ctx.currentTime;
    do {
      const p = a.pending.shift();
      if (!p) break;
      const src = this.ctx.createBufferSource();
      src.buffer = this.loop(p.name);
      src.loop = true;
      src.connect(p.out);
      src.start(t, this.rand() * src.buffer.duration);
      a.sources.push(src);
    } while (horizon !== undefined);
    const until = horizon ?? t + (this.ahead ?? LOOKAHEAD);
    for (const e of a.events) {
      // A tab left in the background doesn't come back to a flock of gulls at once.
      if (e.next < t - 1) e.next = t + 0.05;
      while (e.next < until) {
        this[e.fire](e.next, e.out);
        const [lo, hi] = e.every;
        e.next += lo + this.rand() * (hi - lo);
      }
    }
  }

  loop(name) {
    let buf = this.loops.get(name);
    if (buf) return buf;
    const sr = this.half;
    const chs = renderLoop(name, sr, hash(name));
    buf = this.ctx.createBuffer(2, chs[0].length, sr);
    buf.getChannelData(0).set(chs[0]);
    buf.getChannelData(1).set(chs[1]);
    this.loops.set(name, buf);
    return buf;
  }

  /** Somewhere in the stereo field, for a sound that comes from one place. */
  placed(out, pan, reverb = 0) {
    const c = this.ctx;
    const p = c.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(out);
    if (reverb) {
      const rs = c.createGain();
      rs.gain.value = reverb;
      p.connect(rs);
      rs.connect(this.sfxReverbSend);
    }
    return p;
  }

  gull(t, out) {
    const c = this.ctx;
    const p = this.placed(out, this.rand() * 1.6 - 0.8, 0.3);
    const n = 2 + Math.floor(this.rand() * 3);
    const k = 0.9 + this.rand() * 0.25;
    for (let i = 0, at = t; i < n; i++, at += 0.36 + this.rand() * 0.14) {
      const o = this.osc('sawtooth', 760 * k, at);
      o.frequency.exponentialRampToValueAtTime(1450 * k, at + 0.07);
      o.frequency.exponentialRampToValueAtTime(820 * k, at + 0.34);
      const bp = this.filter('bandpass', 1800, 2.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.09 * (1 - i * 0.15), at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.36);
      o.connect(bp);
      bp.connect(g);
      g.connect(p);
      o.start(at);
      o.stop(at + 0.4);
    }
  }

  bird(t, out) {
    const p = this.placed(out, this.rand() * 1.8 - 0.9, 0.2);
    const n = 2 + Math.floor(this.rand() * 4);
    const base = 2600 + this.rand() * 1800;
    for (let i = 0, at = t; i < n; i++, at += 0.07 + this.rand() * 0.06) {
      const f = base * (1 + 0.15 * this.rand());
      this.tone(p, at, 'sine', f, f * (1.2 + 0.3 * this.rand()), 0.06, 0.035, 0.005, 0.045);
    }
  }

  clockTick(t, out) {
    this.tock = !this.tock;
    const f = this.tock ? 2500 : 3100;
    const p = this.placed(out, -0.3);
    this.hiss(p, t, 'bandpass', f, f, 6, 0.5, 0.015);
    this.tone(p, t, 'sine', f * 0.45, f * 0.4, 0.03, 0.1, 0.001);
  }

  drip(t, out) {
    const p = this.placed(out, this.rand() * 1.4 - 0.7, 0.8);
    const f = 800 + this.rand() * 500;
    this.tone(p, t, 'sine', f, f * 2.4, 0.08, 0.1, 0.001, 0.035);
  }

  blip(t, out) {
    // A packet of the data river: a chord tone, high and small.
    const ch = this.chord ? this.chord.chord : [62, 66, 69];
    const m = ch[Math.floor(this.rand() * ch.length)] + (this.rand() < 0.5 ? 24 : 36);
    const p = this.placed(out, this.rand() * 1.6 - 0.8, 0.3);
    this.tone(p, t, this.rand() < 0.7 ? 'sine' : 'triangle', mtof(m), mtof(m), 0.12, 0.05, 0.002);
  }

  truck(t, out) {
    const c = this.ctx;
    const dur = 4 + this.rand() * 2;
    const dir = this.rand() < 0.5 ? -1 : 1;
    const p = c.createStereoPanner();
    p.pan.setValueAtTime(-0.85 * dir, t);
    p.pan.linearRampToValueAtTime(0.85 * dir, t + dur);
    p.connect(out);
    const src = this.noiseSrc(t);
    // Tyres on the joints of the viaduct, and the pitch dropping as it passes.
    const bp = this.filter('bandpass', 700, 0.8);
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(420, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + dur * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(p);
    src.stop(t + dur + 0.05);
    const eng = this.osc('sawtooth', 62, t);
    eng.frequency.linearRampToValueAtTime(50, t + dur);
    const lp = this.filter('lowpass', 220, 0.7);
    const eg = c.createGain();
    eg.gain.setValueAtTime(0.0001, t);
    eg.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.5);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    eng.connect(lp);
    lp.connect(eg);
    eg.connect(p);
    eng.start(t);
    eng.stop(t + dur + 0.05);
  }

  train(t, out) {
    const c = this.ctx;
    const dur = 8 + this.rand() * 3;
    const src = this.noiseSrc(t);
    const lp = this.filter('lowpass', 260, 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(out);
    // The wheels over the rail joints.
    const clack = this.noiseSrc(t);
    const bp = this.filter('bandpass', 1200, 1.2);
    const am = c.createGain();
    am.gain.value = 0;
    const beat = this.osc('square', 3.2, t);
    const bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.45);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    beat.connect(bg);
    bg.connect(am.gain);
    clack.connect(bp);
    bp.connect(am);
    am.connect(out);
    beat.start(t);
    for (const s of [src, clack, beat]) s.stop(t + dur + 0.05);
  }

  clank(t, out) {
    const p = this.placed(out, this.rand() * 1.4 - 0.7, 0.9);
    this.partials(p, t, 380 + this.rand() * 200, CLANK, 0.12);
  }

  // -------------------------------------------------------------- effects

  jingleVoice() {
    const h = this.sfxHuman;
    return h < 0.25 ? 'synth' : h < 0.5 ? 'kalimba' : h < 0.75 ? 'vibes' : 'harp';
  }

  /** Notes in a row, on the level's own instrument: sines on the grid, a kalimba, a vibraphone, a harp. */
  jingle(out, t, notes, gap, dur, vel, wave = 'sine', inst = this.jingleVoice()) {
    const c = this.ctx;
    const rs = c.createGain();
    rs.gain.value = 0.4;
    rs.connect(this.sfxReverbSend);
    notes.forEach((m, i) => {
      const at = t + i * gap;
      if (inst === 'synth') {
        const g = this.tone(out, at, wave, mtof(m), mtof(m), dur, vel, 0.006);
        g.connect(rs);
      } else {
        const s = this.strike(inst, at, m, vel * 2.2, dur + 0.3, out, true);
        if (s) s.g.connect(rs);
      }
    });
  }

  /** What the game says happened, as sound: `{ s, pan?, vol?, ... }`. */
  cue(e) {
    if (!this.ctx || !e) return;
    const fn = CUES[e.s];
    const vol = e.vol ?? 1;
    if (!fn || vol < 0.02) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    if (t0 - (this.lastCue[e.s] ?? -1) < (CUE_GAP[e.s] ?? 0.015)) return;
    this.lastCue[e.s] = t0;
    const out = c.createGain();
    // A centred panner costs 3 dB; this gives it back, so cues sit where Defector's do.
    out.gain.value = clamp(vol, 0, 1) * Math.SQRT2;
    const p = c.createStereoPanner();
    p.pan.value = clamp(e.pan ?? 0, -1, 1);
    out.connect(p);
    p.connect(this.sfxBus);
    const h = this.sfxHuman;
    // The grid's share and the body's, at equal power: halfway sounds like both at once.
    fn.call(this, out, t0 + 0.005, e, Math.cos((h * Math.PI) / 2), Math.sin((h * Math.PI) / 2));
  }

  footstep(o, t, surface) {
    // Hard floors ring louder than soft ones; a stride every half second shouldn't.
    const v = (0.8 + 0.4 * this.rand()) * ({ metal: 0.65, concrete: 0.6, wood: 0.6, grass: 0.8, snow: 1.1, water: 1.3 }[surface] ?? 1);
    const k = 0.92 + 0.16 * this.rand(); // no two steps quite alike
    switch (surface) {
      case 'grid':
        this.tone(o, t, 'sine', 1150 * k, 700 * k, 0.05, 0.06 * v);
        this.tone(o, t, 'square', 2400 * k, 2400 * k, 0.015, 0.015 * v, 0.001);
        break;
      case 'metal':
        this.hiss(o, t, 'bandpass', 2600 * k, 2000 * k, 3, 0.12 * v, 0.05);
        this.partials(o, t, 380 * k, HOLLOW, 0.05 * v);
        this.tone(o, t, 'sine', 110, 60, 0.05, 0.12 * v);
        break;
      case 'wood':
        this.tone(o, t, 'sine', 190 * k, 140 * k, 0.07, 0.16 * v);
        this.hiss(o, t, 'bandpass', 950 * k, 800 * k, 1.5, 0.1 * v, 0.05);
        break;
      case 'grass':
        this.hiss(o, t, 'highpass', 2400 * k, 3500 * k, 0.7, 0.07 * v, 0.09, 0.02);
        this.hiss(o, t, 'lowpass', 600, 600, 0.7, 0.05 * v, 0.05);
        break;
      case 'snow':
        this.crackle(o, t, 0.07, 5, 2600 * k, 1.2, 0.12 * v);
        this.hiss(o, t, 'lowpass', 500 * k, 300, 0.7, 0.1 * v, 0.1, 0.01);
        break;
      case 'water':
        this.hiss(o, t, 'bandpass', 700 * k, 2200 * k, 1.1, 0.16 * v, 0.14, 0.01);
        this.tone(o, t + 0.02, 'sine', 420 * k, 950 * k, 0.04, 0.04 * v);
        break;
      default: // concrete
        this.hiss(o, t, 'bandpass', 1300 * k, 900 * k, 0.8, 0.16 * v, 0.05);
        this.tone(o, t, 'sine', 95 * k, 60, 0.05, 0.12 * v);
    }
  }

  // ---------------------------------------------------------------- speech

  /** A line of dialogue as wordless babble: `opts.who` 'creator' (warm, human) or 'machine'. Returns its length in seconds. */
  speak(text, opts = {}) {
    const who = opts.who === 'machine' ? 'machine' : 'creator';
    const plan = planBabble(String(text ?? ''), who);
    if (!this.ctx || !plan.syl.length) return plan.length;
    const c = this.ctx;
    const machine = who === 'machine';
    const t0 = c.currentTime + 0.03;
    const end = t0 + plan.length + 0.2;
    const src = this.osc(machine ? 'square' : 'sawtooth', plan.syl[0].f, t0);
    const nodes = [src];
    let voiced = src;
    if (machine) {
      // Ring-modulated: the voice multiplied by a low tone, the way old radios made robots.
      const rm = c.createGain();
      rm.gain.value = 0;
      const car = this.osc('sine', 71, t0);
      car.connect(rm.gain);
      src.connect(rm);
      voiced = rm;
      nodes.push(car);
    } else {
      nodes.push(this.vibrato(t0, 5.2, 9, 0.1, [src.detune]));
    }
    const pre = this.filter('lowpass', machine ? 4200 : 3000, 0.5);
    voiced.connect(pre);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    const out = c.createGain();
    out.gain.value = clamp(opts.vol ?? 1, 0, 1) * (machine ? 0.28 : 0.4);
    env.connect(out);
    out.connect(this.sfxBus);
    const rs = c.createGain();
    rs.gain.value = 0.15;
    out.connect(rs);
    rs.connect(this.sfxReverbSend);
    const bands = this.formants(pre, env, plan.syl[0].vowel, t0);
    // Consonants are breath, not voice: one noise source, shaped a syllable at a time.
    const ns = this.noiseSrc(t0);
    const nf = this.filter('bandpass', 3000, 0.8);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t0);
    ns.connect(nf);
    nf.connect(ng);
    ng.connect(out);
    for (const u of plan.syl) {
      const a = t0 + u.t;
      src.frequency.setTargetAtTime(u.f, a, machine ? 0.004 : 0.03);
      const V = VOWELS[u.vowel];
      bands.forEach((bp, i) => bp.frequency.setTargetAtTime(V[i], a, 0.025));
      env.gain.setTargetAtTime(u.amp, a + 0.015, 0.012);
      env.gain.setTargetAtTime(0, a + u.dur * 0.82, 0.018);
      if (u.cons === 'fric') {
        nf.frequency.setValueAtTime(5200, a);
        ng.gain.setValueAtTime(0, a);
        ng.gain.linearRampToValueAtTime(0.16 * u.amp, a + 0.02);
        ng.gain.linearRampToValueAtTime(0, a + 0.055);
      } else if (u.cons === 'plos') {
        nf.frequency.setValueAtTime(1700, a);
        ng.gain.setValueAtTime(0.28 * u.amp, a);
        ng.gain.setTargetAtTime(0, a + 0.002, 0.008);
      }
    }
    for (const n of nodes) {
      n.start(t0);
      n.stop(end);
    }
    ns.stop(end);
    return plan.length;
  }
}

// ------------------------------------------------------------------- cues
//
// Each cue gets its own gain (distance) and panner (direction), the grid's
// share `m` and the body's `b`. At humanity 0 only the blips play; at 1 only
// the physical sounds; between, both, at equal power.

const CUES = {
  jump(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'triangle', 260, 520, 0.12, 0.13 * m);
    if (b > 0.05) {
      this.hiss(o, t, 'bandpass', 500, 1600, 1.2, 0.2 * b, 0.16, 0.02);
      this.hiss(o, t, 'highpass', 3500, 3500, 0.7, 0.05 * b, 0.07);
    }
  },
  land(o, t, e, m, b) {
    const k = Math.min(1, 0.35 + (e.air || 0) * 0.6);
    if (m > 0.05) {
      this.tone(o, t, 'sine', 140, 60, 0.1, 0.25 * k * m);
      this.hiss(o, t, 'lowpass', 500, 500, 1, 0.1 * k * m, 0.06);
    }
    if (b > 0.05) {
      this.tone(o, t, 'sine', 95, 45, 0.14, 0.4 * k * b);
      this.hiss(o, t, 'bandpass', 900, 500, 0.8, 0.22 * k * b, 0.08);
      if (k > 0.7) this.partials(o, t + 0.01, 310, HOLLOW, 0.06 * b * k);
    }
  },
  step(o, t, e) {
    this.footstep(o, t, e.surface || 'concrete');
  },
  fire(o, t, e, m, b) {
    const kind = e.kind || 'std';
    if (m > 0.05) {
      if (kind === 'big') this.tone(o, t, 'sawtooth', 180, 70, 0.3, 0.26 * m);
      else if (kind === 'triple') [0, 0.03, 0.06].forEach((d) => this.tone(o, t + d, 'square', 900, 400, 0.08, 0.08 * m));
      else if (kind === 'freeze') this.tone(o, t, 'sine', 1600, 2400, 0.16, 0.12 * m);
      else if (kind === 'strong') this.tone(o, t, 'square', 420, 110, 0.18, 0.24 * m);
      else if (kind === 'durable') this.tone(o, t, 'sine', 700, 350, 0.28, 0.16 * m);
      else {
        this.tone(o, t, 'square', 880, 440, 0.07, 0.08 * m);
        this.tone(o, t, 'sine', 300, 1200, 0.12, 0.12 * m);
      }
    }
    if (b > 0.05) {
      // A charge leaving the barrel: a thump of air and a whoosh, heavier for heavier charges.
      const w = { big: 1.5, strong: 1.3, durable: 1.1, triple: 0.7, freeze: 0.8 }[kind] ?? 1;
      const times = kind === 'triple' ? [0, 0.035, 0.07] : [0];
      for (const d of times) {
        this.tone(o, t + d, 'sine', 190 / w, 70 / w, 0.09 * w, 0.3 * b);
        this.hiss(o, t + d, 'bandpass', 1400 / w, 600 / w, 1, 0.2 * b, 0.1 * w, 0.004);
      }
      if (kind === 'freeze') this.crackle(o, t + 0.02, 0.12, 6, 6000, 3, 0.12 * b);
      if (kind === 'strong') this.hiss(o, t, 'highpass', 3000, 3000, 0.7, 0.2 * b, 0.03);
    }
  },
  ricochet(o, t, e, m, b) {
    const s = clamp(e.speed ?? 0.5, 0, 1);
    if (m > 0.05) {
      this.tone(o, t, 'triangle', 260 + 520 * s, (260 + 520 * s) * 0.6, 0.07, 0.24 * m);
      this.hiss(o, t, 'bandpass', 2500 + 3000 * s, 2500 + 3000 * s, 1.5, 0.16 * m, 0.03);
    }
    if (b > 0.05) {
      this.partials(o, t, 900 + 900 * s, HOLLOW, 0.1 * b);
      this.hiss(o, t, 'bandpass', 3000, 3000, 2, 0.14 * b * (0.5 + s), 0.025);
    }
  },
  deflect(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'square', 720, 480, 0.12, 0.2 * m);
      this.hiss(o, t, 'bandpass', 1800, 1800, 1, 0.22 * m, 0.05);
    }
    if (b > 0.05) {
      this.partials(o, t, 520, PLATE, 0.2 * b);
      this.tone(o, t, 'sine', 120, 60, 0.12, 0.25 * b);
    }
  },
  armor(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'square', 300, 200, 0.07, 0.16 * m);
    if (b > 0.05) {
      this.partials(o, t, 240, CLANK, 0.12 * b);
      this.hiss(o, t, 'bandpass', 1500, 1200, 1, 0.15 * b, 0.04);
    }
  },
  hit(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'square', 520, 240, 0.08, 0.18 * m);
    if (b > 0.05) {
      this.tone(o, t, 'sine', 160, 80, 0.08, 0.3 * b);
      this.hiss(o, t, 'bandpass', 1600, 1100, 1.2, 0.25 * b, 0.05);
    }
  },
  pop(o, t, e, m, b) {
    const big = !!e.big;
    if (m > 0.05) {
      this.hiss(o, t, 'bandpass', big ? 700 : 1400, big ? 700 : 1400, 0.8, (big ? 0.45 : 0.3) * m, big ? 0.4 : 0.22);
      this.tone(o, t, 'sawtooth', big ? 220 : 440, 60, big ? 0.35 : 0.18, 0.2 * m);
    }
    if (b > 0.05) {
      this.hiss(o, t, 'lowpass', big ? 2500 : 3500, 200, 0.8, (big ? 0.5 : 0.35) * b, big ? 0.5 : 0.25);
      this.tone(o, t, 'sine', big ? 90 : 130, 40, big ? 0.3 : 0.15, 0.35 * b);
      this.crackle(o, t + 0.04, big ? 0.35 : 0.18, big ? 9 : 5, 3000, 1.5, 0.12 * b);
    }
  },
  crate(o, t, e, m, b) {
    if (m > 0.05) {
      this.hiss(o, t, 'bandpass', 900, 900, 1, 0.35 * m, 0.25);
      this.tone(o, t, 'square', 300, 90, 0.2, 0.18 * m);
    }
    if (b > 0.05) {
      // Splintering: a crack, a knock, and the pieces coming apart.
      this.crackle(o, t, 0.09, 7, 1800, 1.2, 0.35 * b);
      this.tone(o, t, 'sine', 180, 120, 0.12, 0.3 * b);
      this.hiss(o, t + 0.03, 'bandpass', 1200, 700, 1, 0.12 * b, 0.2);
    }
  },
  // A panel with room behind it: not a crack but a knock that rings low and dies slowly.
  hollow(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'triangle', 150, 105, 0.4, 0.3 * m);
      this.tone(o, t, 'square', 300, 210, 0.05, 0.08 * m);
    }
    if (b > 0.05) {
      this.tone(o, t, 'sine', 118, 92, 0.5, 0.42 * b);
      this.tone(o, t, 'sine', 236, 190, 0.22, 0.12 * b);
      this.hiss(o, t, 'bandpass', 500, 420, 2, 0.12 * b, 0.12);
    }
  },
  // Near a secret still shut, a low hum, two notes a hair apart so it beats; a wall the grid never finished buzzes.
  hum(o, t, e) {
    const f = e.glitch ? 92 : 68;
    this.tone(o, t, e.glitch ? 'sawtooth' : 'sine', f, f, 1.8, e.glitch ? 0.03 : 0.06, 0.6);
    this.tone(o, t, 'sine', f * 1.012, f * 1.012, 1.8, 0.05, 0.6);
  },
  thunk(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'square', 400, 200, 0.06, 0.16 * m);
    if (b > 0.05) {
      this.tone(o, t, 'sine', 220, 160, 0.08, 0.28 * b);
      this.hiss(o, t, 'bandpass', 800, 800, 1.2, 0.15 * b, 0.04);
    }
  },
  stomp(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'square', 220, 660, 0.12, 0.22 * m);
    if (b > 0.05) {
      this.tone(o, t, 'sine', 120, 50, 0.16, 0.4 * b);
      this.hiss(o, t, 'lowpass', 1800, 300, 0.8, 0.3 * b, 0.12);
    }
  },
  powerup(o, t) {
    this.jingle(o, t, JINGLES.powerup, 0.05, 0.6, 0.12);
  },
  shield(o, t, e, m) {
    this.jingle(o, t, JINGLES.shield, 0.08, 0.9, 0.13);
    if (m > 0.05) this.hiss(o, t, 'highpass', 6000, 9000, 0.7, 0.05 * m, 0.4, 0.1);
  },
  // A shield cell: the shield's jingle, climbing further, and a swell under it.
  cell(o, t, e, m, b) {
    this.jingle(o, t, JINGLES.cell, 0.09, 1.3, 0.14);
    this.tone(o, t, 'sine', 196, 196, 1.6, 0.12, 0.4);
    if (m > 0.05) this.hiss(o, t, 'highpass', 5000, 9000, 0.7, 0.05 * m, 0.6, 0.15);
    if (b > 0.05) this.tone(o, t + 0.05, 'triangle', 392, 392, 1.2, 0.06 * b, 0.3);
  },
  cycle(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'square', 880, 1320, 0.05, 0.07 * m);
    if (b > 0.05) {
      // A ratchet: click, and clack.
      this.hiss(o, t, 'bandpass', 3200, 3200, 3, 0.25 * b, 0.012);
      this.hiss(o, t + 0.035, 'bandpass', 2400, 2400, 3, 0.2 * b, 0.015);
    }
  },
  dry(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'square', 180, 150, 0.06, 0.11 * m);
    if (b > 0.05) this.hiss(o, t, 'bandpass', 2000, 2000, 4, 0.2 * b, 0.015);
  },
  empty(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'triangle', 600, 300, 0.15, 0.1 * m);
    if (b > 0.05) {
      this.tone(o, t, 'sine', 330, 300, 0.06, 0.14 * b);
      this.hiss(o, t + 0.02, 'highpass', 3000, 3000, 0.7, 0.05 * b, 0.12, 0.02);
    }
  },
  portal(o, t, e, m, b) {
    const dark = !!e.which;
    if (m > 0.05) {
      this.tone(o, t, 'sine', dark ? 330 : 660, dark ? 165 : 1320, 0.25, 0.14 * m);
      this.tone(o, t, 'sine', 2000, 900, 0.2, 0.12 * m);
    }
    if (b > 0.05) {
      // A glass rim, rubbed: a pure tone swelling out of breath.
      const f = dark ? 294 : 587;
      this.tone(o, t, 'sine', f, f, 0.5, 0.14 * b, 0.08);
      this.tone(o, t, 'sine', f * 2.01, f * 2.01, 0.35, 0.04 * b, 0.1);
      this.hiss(o, t, 'bandpass', f * 3, f * 3, 2, 0.08 * b, 0.3, 0.05);
    }
  },
  fizzle(o, t, e, m, b) {
    if (m > 0.05) this.hiss(o, t, 'highpass', 3000, 3000, 1, 0.18 * m, 0.12);
    if (b > 0.05) this.crackle(o, t, 0.14, 7, 4200, 1.5, 0.25 * b);
  },
  unportal(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'sine', 500, 200, 0.2, 0.08 * m);
    if (b > 0.05) this.hiss(o, t, 'lowpass', 2500, 250, 0.8, 0.14 * b, 0.2, 0.01);
  },
  warp(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'sine', 200, 1200, 0.22, 0.13 * m);
      this.tone(o, t + 0.05, 'triangle', 1200, 300, 0.25, 0.09 * m);
    }
    if (b > 0.05) {
      this.hiss(o, t, 'bandpass', 300, 3000, 1.5, 0.22 * b, 0.18, 0.06);
      this.hiss(o, t + 0.16, 'bandpass', 3000, 500, 1.5, 0.16 * b, 0.2);
    }
  },
  hurt(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'sawtooth', 200, 50, 0.4, 0.3 * m);
      this.hiss(o, t, 'bandpass', 800, 800, 0.8, 0.22 * m, 0.2);
    }
    if (b > 0.05) {
      // The body taking it: a dent, a thud, a servo winding down.
      this.partials(o, t, 260, CLANK, 0.14 * b);
      this.tone(o, t, 'sine', 110, 45, 0.2, 0.4 * b);
      this.tone(o, t + 0.05, 'sawtooth', 700, 250, 0.25, 0.04 * b);
    }
  },
  down(o, t) {
    this.jingle(o, t, JINGLES.down, 0.18, 1.2, 0.14, 'triangle', this.sfxHuman < 0.25 ? 'synth' : 'piano');
  },
  freeze(o, t, e, m, b) {
    if (m > 0.05) {
      [1760, 1318, 988, 740].forEach((f, i) => this.tone(o, t + i * 0.06, 'triangle', f, f, 0.5, 0.18 * m, 0.01));
      this.hiss(o, t, 'highpass', 7000, 7000, 0.7, 0.2 * m, 0.4);
    }
    if (b > 0.05) {
      this.crackle(o, t, 0.3, 12, 5000, 2, 0.25 * b);
      if (this.sfxHuman >= 0.25) this.jingle(o, t + 0.03, JINGLES.freeze, 0.06, 0.5, 0.07 * b, 'sine', 'glock');
    }
  },
  spring(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'triangle', 200, 900, 0.25, 0.18 * m);
    if (b > 0.05) {
      // A real spring: a twang that wobbles as it settles.
      const g = this.tone(o, t, 'sine', 180, 520, 0.4, 0.22 * b, 0.002, 0.08);
      g.gain.setValueAtTime(0.22 * b, t + 0.01);
      const w = this.osc('sine', 18, t);
      const wg = this.ctx.createGain();
      wg.gain.value = 0.1 * b;
      w.connect(wg);
      wg.connect(g.gain);
      w.start(t);
      w.stop(t + 0.42);
      this.hiss(o, t, 'bandpass', 2400, 2400, 5, 0.08 * b, 0.2);
    }
  },
  pulse(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'sine', 220, 1400, 0.5, 0.24 * m, 0.02, 0.35);
      this.tone(o, t, 'sine', 70, 35, 0.3, 0.4 * m, 0.003, 0.25);
    }
    if (b > 0.05) {
      this.tone(o, t, 'sine', 80, 32, 0.4, 0.5 * b);
      this.hiss(o, t, 'lowpass', 600, 150, 0.7, 0.3 * b, 0.35, 0.04);
    }
  },
  swallow(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'sawtooth', 900, 55, 0.5, 0.16 * m, 0.03, 0.45);
      this.tone(o, t + 0.3, 'sine', 80, 30, 0.4, 0.4 * m, 0.03);
    }
    if (b > 0.05) {
      this.hiss(o, t, 'bandpass', 3000, 100, 1.2, 0.3 * b, 0.45, 0.05);
      this.tone(o, t + 0.35, 'sine', 70, 30, 0.35, 0.45 * b, 0.01);
    }
  },
  checkpoint(o, t) {
    this.jingle(o, t, JINGLES.checkpoint, 0.09, 0.8, 0.13);
  },
  secret(o, t) {
    this.jingle(o, t, JINGLES.secret, 0.07, 1.1, 0.11, 'triangle');
  },
  lock(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'sawtooth', 160, 90, 0.4, 0.25 * m);
    if (b > 0.05) {
      // A heavy bolt shot home: ka-chunk.
      this.hiss(o, t, 'bandpass', 2500, 2500, 2, 0.3 * b, 0.02);
      this.partials(o, t + 0.09, 170, CLANK, 0.2 * b);
      this.tone(o, t + 0.09, 'sine', 90, 50, 0.2, 0.45 * b);
    }
  },
  switch(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'square', 520, 1040, 0.12, 0.14 * m);
    if (b > 0.05) {
      this.hiss(o, t, 'bandpass', 2800, 2800, 3, 0.3 * b, 0.015);
      this.tone(o, t, 'sine', 260, 200, 0.06, 0.2 * b);
    }
    this.jingle(o, t + 0.05, JINGLES.switch, 0.06, 0.5, 0.1);
  },
  unlock(o, t, e, m, b) {
    this.jingle(o, t, JINGLES.unlock, 0.07, 0.7, 0.12);
    if (b > 0.05) this.hiss(o, t, 'bandpass', 900, 2200, 2, 0.12 * b, 0.25, 0.05);
  },
  door(o, t, e, m, b) {
    if (m > 0.05) {
      const g = this.tone(o, t, 'sawtooth', 90, 110, 0.6, 0.1 * m, 0.05);
      g.gain.setValueAtTime(0.1 * m, t + 0.45);
    }
    if (b > 0.05) {
      // Weight sliding in a track: rumble and scrape.
      this.hiss(o, t, 'lowpass', 300, 200, 0.7, 0.35 * b, 0.7, 0.08);
      this.hiss(o, t, 'bandpass', 1300, 900, 3, 0.08 * b, 0.6, 0.1);
    }
  },
  laser(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'sawtooth', 1200, 1100, 0.3, 0.07 * m, 0.01);
      this.tone(o, t, 'sine', 2400, 2400, 0.3, 0.05 * m, 0.01);
    }
    if (b > 0.05) {
      // A live wire: mains buzz and a crackle of arcing.
      const g = this.tone(o, t, 'sawtooth', 120, 120, 0.35, 0.12 * b, 0.01);
      g.gain.setValueAtTime(0.12 * b, t + 0.25);
      this.crackle(o, t, 0.3, 8, 3500, 1.2, 0.18 * b);
    }
  },
  crush(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'sawtooth', 300, 40, 0.4, 0.3 * m);
      this.hiss(o, t, 'lowpass', 3000, 300, 0.7, 0.35 * m, 0.35);
    }
    if (b > 0.05) {
      this.partials(o, t, 190, CLANK, 0.22 * b);
      this.tone(o, t, 'sine', 90, 35, 0.35, 0.55 * b);
      this.crackle(o, t + 0.02, 0.25, 10, 2200, 1, 0.25 * b);
    }
  },
  wave(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'sawtooth', 300, 600, 0.3, 0.11 * m);
    if (b > 0.05) {
      // Two hits on a big drum: here they come.
      this.tone(o, t, 'sine', 110, 60, 0.35, 0.45 * b);
      this.tone(o, t + 0.22, 'sine', 110, 60, 0.45, 0.5 * b);
    }
  },
  shot(o, t, e, m, b) {
    const big = e.kind === 'big' || e.kind === 'strong';
    if (m > 0.05) this.tone(o, t, 'square', big ? 400 : 700, big ? 150 : 300, 0.1, 0.1 * m);
    if (b > 0.05) {
      this.tone(o, t, 'sine', big ? 150 : 230, 80, 0.08, 0.2 * b);
      this.hiss(o, t, 'bandpass', big ? 900 : 1600, 700, 1, 0.14 * b, 0.07);
    }
  },
  bossHit(o, t, e, m, b) {
    if (m > 0.05) {
      this.tone(o, t, 'square', 160, 60, 0.18, 0.26 * m);
      this.hiss(o, t, 'bandpass', 1200, 1200, 1, 0.26 * m, 0.12);
    }
    if (b > 0.05) {
      this.partials(o, t, 150, CLANK, 0.2 * b);
      this.tone(o, t, 'sine', 80, 40, 0.25, 0.5 * b);
    }
  },
  bossDown(o, t, e, m, b) {
    if (m > 0.05) {
      this.hiss(o, t, 'lowpass', 4000, 300, 0.5, 0.6 * m, 0.9);
      this.tone(o, t, 'sine', 90, 30, 0.7, 0.7 * m, 0.003, 0.4);
      this.jingle(o, t + 0.35, [62, 65, 69, 74, 77, 81], 0.07, 1.8, 0.1 * m, 'sawtooth', 'synth');
    }
    if (b > 0.05) {
      // It comes down: a crash, the floor taking it, and something hopeful after.
      this.hiss(o, t, 'lowpass', 3000, 200, 0.6, 0.5 * b, 1.2);
      this.partials(o, t, 130, CLANK, 0.25 * b);
      this.tone(o, t, 'sine', 70, 30, 0.8, 0.6 * b);
      if (this.sfxHuman >= 0.25) this.jingle(o, t + 0.4, JINGLES.victory, 0.08, 1.8, 0.1 * b);
    }
  },
  rev(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'sawtooth', 90, 260, 0.8, 0.14 * m, 0.02);
    if (b > 0.05) {
      // An engine: a low saw whose firing pulses speed up with it.
      const c = this.ctx;
      const src = this.osc('sawtooth', 45, t);
      src.frequency.exponentialRampToValueAtTime(130, t + 0.7);
      const lp = this.filter('lowpass', 500, 2);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.25 * b, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      const fire = this.osc('square', 14, t);
      fire.frequency.exponentialRampToValueAtTime(40, t + 0.7);
      const fg = c.createGain();
      fg.gain.value = 0.1 * b;
      fire.connect(fg);
      fg.connect(g.gain);
      src.connect(lp);
      lp.connect(g);
      g.connect(o);
      for (const s of [src, fire]) {
        s.start(t);
        s.stop(t + 0.9);
      }
    }
  },
  lob(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'triangle', 300, 700, 0.18, 0.11 * m);
    if (b > 0.05) {
      this.tone(o, t, 'sine', 260, 130, 0.1, 0.3 * b);
      this.hiss(o, t, 'bandpass', 700, 1800, 1.5, 0.1 * b, 0.25, 0.04);
    }
  },
  fan(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'square', 900, 500, 0.12, 0.07 * m);
    if (b > 0.05) {
      const g = this.hiss(o, t, 'bandpass', 900, 1200, 1, 0.2 * b, 0.35, 0.05);
      const blade = this.osc('square', 24, t);
      const bg = this.ctx.createGain();
      bg.gain.value = 0.08 * b;
      blade.connect(bg);
      bg.connect(g.gain);
      blade.start(t);
      blade.stop(t + 0.38);
    }
  },
  thud(o, t, e, m, b) {
    this.tone(o, t, 'sine', 120, 40, 0.3, 0.35 * (m + 0.5 * b));
    this.hiss(o, t, 'lowpass', 400 + 400 * b, 200, 0.7, 0.28 * (m * 0.8 + b), 0.2 + 0.1 * b);
  },
  rumble(o, t, e, m, b) {
    this.hiss(o, t, 'lowpass', 200, 160, 1, 0.35, 0.8, 0.08);
    if (b > 0.05) {
      const g = this.tone(o, t, 'sine', 38, 32, 0.9, 0.3 * b, 0.1);
      g.gain.setValueAtTime(0.3 * b, t + 0.5);
    }
  },
  boing(o, t, e, m, b) {
    if (m > 0.05) this.tone(o, t, 'sine', 150, 600, 0.3, 0.18 * m);
    if (b > 0.05) {
      const g = this.tone(o, t, 'sine', 140, 420, 0.45, 0.25 * b, 0.003, 0.12);
      g.gain.setValueAtTime(0.25 * b, t + 0.01);
      const w = this.osc('sine', 11, t);
      w.frequency.exponentialRampToValueAtTime(5, t + 0.45);
      const wg = this.ctx.createGain();
      wg.gain.value = 0.12 * b;
      w.connect(wg);
      wg.connect(g.gain);
      w.start(t);
      w.stop(t + 0.47);
    }
  },
  phase(o, t, e, m, b) {
    if (m > 0.05) this.jingle(o, t, JINGLES.phase, 0.05, 1.2, 0.13 * m, 'sawtooth', 'synth');
    if (b > 0.05) {
      // The next movement: a low chord on the piano and a timpani under it.
      if (this.sfxHuman >= 0.25) this.jingle(o, t, JINGLES.phase, 0.015, 1.4, 0.12 * b, 'sine', 'piano');
      this.tone(o, t, 'sine', 73.4, 73.4, 1.2, 0.35 * b, 0.004);
    }
  },
  alarm(o, t, e, m, b) {
    if (m > 0.05) [0, 0.3, 0.6].forEach((d, i) => this.tone(o, t + d, 'square', i % 2 ? 660 : 880, i % 2 ? 660 : 880, 0.25, 0.1 * m, 0.01));
    if (b > 0.05) {
      // An electric bell: a clapper on a gong, twenty-odd times a second.
      const c = this.ctx;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14 * b, t + 0.02);
      g.gain.setValueAtTime(0.14 * b, t + 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      const am = c.createGain();
      am.gain.value = 0.5;
      const clap = this.osc('square', 22, t);
      const cg = c.createGain();
      cg.gain.value = 0.5;
      clap.connect(cg);
      cg.connect(am.gain);
      am.connect(g);
      g.connect(o);
      const oscs = [clap];
      for (const [r, a] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) {
        const w = this.osc('sine', 1250 * r, t);
        const wg = c.createGain();
        wg.gain.value = a;
        w.connect(wg);
        wg.connect(am);
        oscs.push(w);
      }
      for (const w of oscs) {
        w.start(t);
        w.stop(t + 1.15);
      }
    }
  },
  exitOpen(o, t) {
    this.jingle(o, t, JINGLES.exitOpen, 0.1, 1.4, 0.12);
  },
  // Three the game sends besides: a charge running out, a secret's cover
  // giving way, and a boss arriving (the music's own change does the rest).
  spark(o, t, e, m, b) {
    if (m > 0.05) this.hiss(o, t, 'highpass', 4000, 4000, 1, 0.08 * m, 0.08);
    if (b > 0.05) this.crackle(o, t, 0.08, 4, 4500, 1.5, 0.12 * b);
  },
  secretOpen(o, t, e, m, b) {
    this.hiss(o, t, 'bandpass', 600, 2400, 1.2, 0.12, 0.35, 0.05);
    if (b > 0.05) this.crackle(o, t, 0.2, 6, 2000, 1.2, 0.2 * b);
    this.jingle(o, t + 0.1, JINGLES.checkpoint.map((n) => n + 3), 0.06, 0.6, 0.08);
  },
  bossStart(o, t, e, m, b) {
    CUES.phase.call(this, o, t, e, m, b);
  },
  cleared(o, t) {
    this.jingle(o, t, JINGLES.cleared, 0.09, 1.6, 0.12, 'triangle');
  },
};

/** Every sound effect the game can cue. */
export const CUE_NAMES = Object.keys(CUES);

// ----------------------------------------------------------------- babble

/**
 * A line of dialogue laid out as syllables, one per two or three letters:
 * `{ syl: [{ t, dur, f, vowel, cons, amp }], length }`. A statement falls as
 * it goes; a question rises at its end; the machine speaks in steps.
 */
export function planBabble(text, who = 'creator') {
  const machine = who === 'machine';
  const r = rng(hash(who + ':' + text));
  const base = machine ? 96 : 138;
  const units = [];
  let chunk = '';
  let want = 2 + (r() < 0.5 ? 1 : 0);
  const flush = () => {
    if (!chunk) return;
    units.push({ letters: chunk });
    chunk = '';
    want = 2 + (r() < 0.5 ? 1 : 0);
  };
  for (const ch of text.toLowerCase()) {
    if (/[\p{L}\p{N}']/u.test(ch)) {
      chunk += ch;
      if (chunk.length >= want) flush();
    } else if (ch === '?' || ch === '!' || ch === '.' || ch === '…') {
      flush();
      units.push({ pause: ch === '…' ? 0.45 : 0.3, end: ch });
    } else if (/[,;:\-—–]/.test(ch)) {
      flush();
      units.push({ pause: 0.14 });
    } else if (/\s/.test(ch)) {
      flush();
      units.push({ pause: 0.035 });
    }
  }
  flush();
  // The pitch of each sentence: highest at its start, lowest at its end, unless it asks.
  let group = [];
  const close = (end) => {
    const n = group.length;
    group.forEach((u, i) => {
      const x = n > 1 ? i / (n - 1) : 0;
      let k = machine ? [1, 1, 1.12, 0.89][Math.floor(r() * 4)] : 1.1 - 0.2 * x + (r() - 0.5) * 0.08;
      if (end === '?' && i >= n - 2) k *= machine ? 1.25 : 1.2 + 0.15 * (i - (n - 2));
      if (end === '!') k *= 1.12;
      u.f = base * k;
      u.amp = end === '!' ? 1 : 0.85;
    });
    group = [];
  };
  for (const u of units) {
    if (u.letters) group.push(u);
    else if (u.end) close(u.end);
  }
  close('.');
  const syl = [];
  let t = 0.02;
  let length = 0;
  for (const u of units) {
    if (u.pause) {
      t += u.pause;
      continue;
    }
    const dur = (machine ? 0.085 : 0.1 + 0.05 * r()) * Math.sqrt(u.letters.length / 2.5);
    const vowelLetter = [...u.letters].find((ch) => 'aeiouy'.includes(ch));
    const vowel = { a: 'aah', e: 'eh', i: 'ee', y: 'ee', o: 'oh', u: 'ooh' }[vowelLetter] || 'uh';
    const first = u.letters[0];
    const cons = 'szfvhxcj'.includes(first) ? 'fric' : 'ptkbdgq'.includes(first) ? 'plos' : null;
    syl.push({ t, dur, f: u.f, vowel, cons, amp: u.amp });
    t += dur;
    length = t;
  }
  return { syl, length: syl.length ? length + 0.1 : 0 };
}

// --------------------------------------------------------------- rendering
//
// Pure functions from a sample rate and a note to a Float32Array, so the
// tests can check them without a browser.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Bring a note to a common loudness, judged over its first 0.3 s (how loud a
 * pluck or a strike sounds is mostly its start), never letting its peak past
 * 0.98, and fade its last moment to silence.
 */
function finish(d, sr, level = 0.2, tail = 0.03) {
  let m = 0;
  let sum = 0;
  const w = Math.min(d.length, Math.floor(sr * 0.3));
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > m) m = a;
    if (i < w) sum += a * a;
  }
  const rms = Math.sqrt(sum / Math.max(1, w));
  let k = rms > 0 ? level / rms : 0;
  if (m * k > 0.98) k = 0.98 / m;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  const n = Math.min(d.length, Math.floor(sr * tail));
  for (let i = 0; i < n; i++) d[d.length - 1 - i] *= i / n;
  return d;
}

/** One biquad (the RBJ cookbook's) over a rendered note, in place. */
function eq(d, sr, type, f, q, gainDb = 0) {
  const w = (TAU * f) / sr;
  const cw = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;
  if (type === 'peaking') {
    [b0, b1, b2, a0, a1, a2] = [1 + alpha * A, -2 * cw, 1 - alpha * A, 1 + alpha / A, -2 * cw, 1 - alpha / A];
  } else if (type === 'lowpass') {
    [b0, b1, b2, a0, a1, a2] = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha];
  } else if (type === 'highpass') {
    [b0, b1, b2, a0, a1, a2] = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha];
  } else {
    [b0, b1, b2, a0, a1, a2] = [alpha, 0, -alpha, 1 + alpha, -2 * cw, 1 - alpha];
  }
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i];
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    d[i] = y;
  }
  return d;
}

/**
 * A plucked string, Karplus-Strong: a burst of noise the length of one
 * period, fed round a loop that averages each sample with the last, so the
 * top dies first as it does on a real string. The loop is a buffer here, not
 * a DelayNode, which can't be shorter than 128 samples and so can't reach the
 * high notes. An allpass tunes the fraction of a sample the loop falls short.
 */
export function pluckString(sr, f, o = {}) {
  const len = Math.floor(sr * (o.secs ?? 2));
  const out = new Float32Array(len);
  const r = rng(o.seed ?? 1);
  const D = sr / f;
  let N = Math.floor(D - 0.5);
  let frac = D - 0.5 - N;
  if (frac < 0.1 && N > 2) {
    N -= 1;
    frac += 1;
  }
  const C = (1 - frac) / (1 + frac);
  // The average already loses a little every trip; the rest of the decay is ours to set.
  const want = Math.pow(0.001, 1 / (f * (o.t60 ?? 2)));
  const rho = Math.min(0.99996, want / Math.cos((Math.PI * f) / sr));
  const line = new Float32Array(N);
  const a = o.bright ?? 0.5; // how hard the pluck: a soft finger takes the top off
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += a * (r() * 2 - 1 - lp);
    line[i] = lp;
  }
  // Where the string is plucked can't be a node, so those harmonics go missing.
  const p = Math.max(1, Math.round(N * (o.pos ?? 0.15)));
  const exc = Float32Array.from(line);
  let mean = 0;
  for (let i = 0; i < N; i++) {
    line[i] = exc[i] - exc[(i + p) % N];
    mean += line[i];
  }
  mean /= N;
  for (let i = 0; i < N; i++) line[i] -= mean; // a constant would never decay
  let prev = 0;
  let ax = 0;
  let ay = 0;
  for (let i = 0, k = 0; i < len; i++) {
    const x = line[k];
    out[i] = x;
    const avg = 0.5 * (x + prev);
    prev = x;
    const y = C * avg + ax - C * ay;
    ax = avg;
    ay = y;
    line[k] = y * rho;
    if (++k === N) k = 0;
  }
  return out;
}

/** A struck bar or tine: a few partials (ratio, amplitude, seconds to 1/e), a mallet's attack, and its knock. */
export function barNote(sr, f, spec, seed = 1) {
  const len = Math.floor(sr * spec.secs);
  const out = new Float32Array(len);
  for (const [ratio, amp, tau] of spec.modes) {
    const fr = f * ratio;
    if (fr > sr * 0.45) continue;
    const w = (TAU * fr) / sr;
    const cw = 2 * Math.cos(w);
    let y1 = -Math.sin(w);
    let y2 = -Math.sin(2 * w);
    let g = amp;
    const d = Math.exp(-1 / (tau * sr));
    const n = Math.min(len, Math.ceil(tau * sr * 9.2)); // until it's 80 dB down
    for (let i = 0; i < n; i++) {
      const y = cw * y1 - y2;
      y2 = y1;
      y1 = y;
      out[i] += g * y;
      g *= d;
    }
  }
  const at = Math.max(1, Math.floor(spec.attack * sr));
  for (let i = 0; i < at && i < len; i++) out[i] *= i / at;
  if (spec.click) {
    const [amp, tau, a] = spec.click;
    const r = rng(seed);
    let lp = 0;
    const n = Math.min(len, Math.floor(tau * sr * 6));
    for (let i = 0; i < n; i++) {
      lp += a * (r() * 2 - 1 - lp);
      out[i] += amp * lp * Math.exp(-i / (tau * sr));
    }
  }
  return finish(out, sr);
}

// The bars: a marimba's tuned so its first overtone is two octaves up; a
// vibraphone's rings long; a kalimba's and a music box's tines are steel
// beams, whose overtones sit at 6.27 and 17.55 times the note.
const BARS = {
  marimba: (f) => {
    const t = clamp(0.95 * Math.pow(262 / f, 0.5), 0.15, 1.4);
    return { modes: [[1, 1, t], [3.93, 0.3, t * 0.22], [9.2, 0.08, t * 0.07]], attack: 0.0025, click: [0.12, 0.004, 0.25], secs: Math.min(1.8, t * 5 + 0.1) };
  },
  vibes: (f) => {
    const t = clamp(2.4 * Math.pow(262 / f, 0.35), 0.8, 3.2);
    return { modes: [[1, 1, t], [4, 0.14, t * 0.25], [10, 0.04, 0.08]], attack: 0.0015, click: [0.05, 0.002, 0.5], secs: Math.min(2.6, t * 3) };
  },
  kalimba: (f) => {
    const t = clamp(1.1 * Math.pow(262 / f, 0.3), 0.35, 1.6);
    return { modes: [[1, 1, t], [6.27, 0.2, 0.07], [17.55, 0.06, 0.02]], attack: 0.004, click: [0.1, 0.005, 0.3], secs: Math.min(2, t * 4) };
  },
  glock: (f) => {
    const t = clamp(1.5 * Math.pow(1046 / f, 0.3), 0.5, 2.2);
    return { modes: [[1, 1, t], [2.76, 0.4, t * 0.35], [5.4, 0.2, t * 0.15], [8.93, 0.1, t * 0.08]], attack: 0.0008, click: [0.15, 0.0015, 0.8], secs: Math.min(2.4, t * 3.5) };
  },
  musicbox: (f) => {
    const t = clamp(1.3 * Math.pow(1046 / f, 0.25), 0.5, 2);
    return { modes: [[1, 1, t], [6.27, 0.45, t * 0.18], [17.55, 0.2, t * 0.05]], attack: 0.0006, click: [0.08, 0.001, 0.9], secs: Math.min(2.2, t * 3.5) };
  },
};

/**
 * A piano note: partials that run sharp as they climb (a stiff string),
 * struck by a hammer an eighth of the way along, each dying at its own rate,
 * fast at first and then slow, with the two or three strings of each note a
 * hair apart so the tone swells and fades. Then the hammer's knock.
 */
export function pianoNote(sr, midi) {
  const f0 = mtof(midi);
  const len = Math.floor(sr * clamp(3 - (midi - 40) * 0.04, 1.1, 3));
  const out = new Float32Array(len);
  const r = rng(midi * 131 + 7);
  const B = 0.00011 * Math.pow(2, (midi - 60) / 18);
  const tau1 = clamp(7 * Math.pow(65 / f0, 0.62), 0.5, 9);
  const x0 = 0.12 + 0.02 * r();
  const BLOCK = 32;
  for (let n = 1; n <= 28; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > sr * 0.45) break;
    const amp = Math.pow(n, -0.75) * Math.abs(Math.sin(Math.PI * n * x0)) * Math.exp(-fn / 4200) * (0.85 + 0.3 * r());
    if (amp < 1e-4) continue;
    const tau = tau1 / (1 + 0.12 * (n - 1) + fn / 3000);
    const fast = tau * 0.16;
    const beat = 0.15 + r() * 0.45 * Math.sqrt(n);
    const ph = r() * TAU;
    const env = (t) => amp * (0.7 * Math.exp(-t / fast) + 0.3 * Math.exp(-t / tau)) * (1 - 0.15 * (1 - Math.cos(TAU * beat * t + ph)));
    const w = (TAU * fn) / sr;
    const cw = 2 * Math.cos(w);
    let y1 = -Math.sin(w);
    let y2 = -Math.sin(2 * w);
    for (let i0 = 0; i0 < len; i0 += BLOCK) {
      const e0 = env(i0 / sr);
      if (e0 < 5e-5) break;
      const de = (env((i0 + BLOCK) / sr) - e0) / BLOCK;
      const n1 = Math.min(len, i0 + BLOCK);
      let e = e0;
      for (let i = i0; i < n1; i++) {
        const y = cw * y1 - y2;
        y2 = y1;
        y1 = y;
        out[i] += e * y;
        e += de;
      }
    }
  }
  const at = Math.floor(0.0015 * sr);
  for (let i = 0; i < at; i++) out[i] *= i / at;
  // The hammer and the soundboard: a dull knock, louder in the bass.
  const knock = 0.1 * (1 + clamp((60 - midi) / 40, 0, 1));
  let lp = 0;
  for (let i = 0; i < Math.min(len, Math.floor(0.04 * sr)); i++) {
    lp += 0.2 * (r() * 2 - 1 - lp);
    out[i] += knock * (lp * Math.exp(-i / (0.006 * sr)) + 0.5 * Math.sin((TAU * 85 * i) / sr) * Math.exp(-i / (0.025 * sr)));
  }
  return finish(out, sr, 0.2, 0.05);
}

/**
 * An electric piano: a tine struck by a hammer and sensed by a pickup, which
 * is to say a sine that barks when hit hard and mellows as it rings (FM with a
 * falling index), and the tine's own ping on top.
 */
export function epianoNote(sr, midi) {
  const f = mtof(midi);
  const len = Math.floor(sr * clamp(2.8 - (midi - 48) * 0.03, 1, 2.8));
  const out = new Float32Array(len);
  const tau = clamp(2.2 * Math.pow(220 / f, 0.4), 0.45, 3.5);
  const w = (TAU * f) / sr;
  const tine = f * 7 < sr * 0.4 ? 7 : 0;
  const at = 0.002 * sr;
  let ph = 0;
  let pt = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const I = 1.5 * Math.exp(-t / 0.2) + 0.35;
    const env = Math.exp(-t / tau) * Math.min(1, i / at);
    const ping = tine ? 0.18 * Math.exp(-t / 0.025) * Math.sin(pt) : 0;
    out[i] = (0.85 * Math.sin(ph + I * Math.sin(ph)) + ping) * env;
    ph += w;
    pt += w * tine;
    if (ph > TAU) ph -= TAU;
    if (pt > TAU) pt -= TAU;
  }
  return finish(out, sr);
}

function guitarNote(sr, midi) {
  const f = mtof(midi);
  const d = pluckString(sr, f, { secs: clamp(2.8 - (midi - 40) * 0.035, 1.2, 2.8), t60: clamp(4.5 * Math.pow(110 / f, 0.35), 1.2, 5), bright: 0.55, pos: 0.17, seed: midi * 17 + 3 });
  // The body: the air inside it and the top, the two humps every guitar has.
  eq(d, sr, 'peaking', 105, 1.6, 6);
  eq(d, sr, 'peaking', 215, 2, 3);
  eq(d, sr, 'highpass', 70, 0.7);
  return finish(d, sr);
}

function harpNote(sr, midi) {
  const f = mtof(midi);
  const d = pluckString(sr, f, { secs: clamp(2.6 - (midi - 48) * 0.03, 1.3, 2.6), t60: clamp(5 * Math.pow(110 / f, 0.3), 1.5, 5), bright: 0.45, pos: 0.3, seed: midi * 29 + 5 });
  eq(d, sr, 'peaking', 180, 1.2, 3);
  eq(d, sr, 'highpass', 60, 0.7);
  return finish(d, sr);
}

/** A bass guitar's string, plucked with a finger. */
function bassNote(sr, midi) {
  const f = mtof(midi);
  const d = pluckString(sr, f, { secs: 1.8, t60: 3.2, bright: 0.4, pos: 0.22, seed: midi * 13 + 1 });
  eq(d, sr, 'peaking', 90, 1, 3);
  eq(d, sr, 'lowpass', 2800, 0.7);
  return finish(d, sr);
}

/** An upright bass, pizzicato: a dark, short pluck, the big body under it, and the finger's thump. */
function uprightNote(sr, midi) {
  const f = mtof(midi);
  const d = pluckString(sr, f, { secs: 1.5, t60: clamp(1.6 * Math.pow(55 / f, 0.2), 0.8, 2), bright: 0.18, pos: 0.28, seed: midi * 11 + 9 });
  const r = rng(midi + 99);
  let lp = 0;
  for (let i = 0; i < Math.floor(0.03 * sr); i++) {
    lp += 0.12 * (r() * 2 - 1 - lp);
    d[i] += 0.3 * lp * Math.exp(-i / (0.008 * sr));
  }
  eq(d, sr, 'peaking', 95, 1.4, 6);
  eq(d, sr, 'peaking', 240, 1.5, 3);
  eq(d, sr, 'lowpass', 1800, 0.7);
  return finish(d, sr);
}

// Each rendered instrument, and the note above which it needs the full rate:
// a plucked string's loop loses a little every trip round, and above E5 at
// half the rate that is more than a string's whole sustain.
const RENDER = {
  piano: { make: pianoNote, full: 100 },
  epiano: { make: epianoNote, full: 100 },
  marimba: { make: (sr, m) => barNote(sr, mtof(m), BARS.marimba(mtof(m)), m), full: 100 },
  vibes: { make: (sr, m) => barNote(sr, mtof(m), BARS.vibes(mtof(m)), m), full: 100 },
  kalimba: { make: (sr, m) => barNote(sr, mtof(m), BARS.kalimba(mtof(m)), m), full: 100 },
  glock: { make: (sr, m) => barNote(sr, mtof(m), BARS.glock(mtof(m)), m), full: 96 },
  musicbox: { make: (sr, m) => barNote(sr, mtof(m), BARS.musicbox(mtof(m)), m), full: 96 },
  guitar: { make: guitarNote, full: 76 },
  harp: { make: harpNote, full: 76 },
  pluck: { make: bassNote, full: 60 },
  upright: { make: uprightNote, full: 60 },
};

/** One note of a rendered instrument, at the given sample rate. */
export function renderNote(inst, midi, sr) {
  return RENDER[inst].make(sr, midi);
}

// ------------------------------------------------------------ ambience loops

/** Crossfade a loop's tail into its head so it runs round without a seam. */
function loopify(chs, sr, fade) {
  const n = Math.floor(sr * fade);
  return chs.map((d) => {
    const len = d.length - n;
    const out = d.slice(0, len);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * (Math.PI / 2);
      out[i] = d[i] * Math.sin(x) + d[len + i] * Math.cos(x);
    }
    return out;
  });
}

/** Two channels of `secs` (plus the crossfade), each from `fill(data, r, channel)`. */
function stereo(sr, secs, fade, seed, fill) {
  const r = rng(seed);
  const chs = [0, 1].map((ch) => {
    const d = new Float32Array(Math.floor(sr * (secs + fade)));
    fill(d, r, ch);
    return d;
  });
  return fade ? loopify(chs, sr, fade) : chs;
}

/** Leaky-integrated noise: the rumble under everything. */
function brown(d, r, k, leak = 0.996) {
  let b = 0;
  for (let i = 0; i < d.length; i++) {
    b = leak * b + (r() * 2 - 1) * 0.03;
    d[i] += k * b;
  }
}

/** White noise through a one-pole lowpass at `f`. */
function darkNoise(d, sr, r, f, k) {
  const a = 1 - Math.exp((-TAU * f) / sr);
  let lp = 0;
  for (let i = 0; i < d.length; i++) {
    lp += a * (r() * 2 - 1 - lp);
    d[i] += k * lp;
  }
}

/** A drop, a bubble or a pop: a damped sine gliding from f0 by `glide`. */
function droplet(d, sr, at, f0, glide, tau, amp) {
  const n = Math.min(d.length - at, Math.floor(tau * sr * 6));
  const k = Math.exp(-1 / (tau * sr));
  let e = amp;
  if (!glide) {
    // A steady pitch: a rotating phasor, no sine per sample.
    const w = (TAU * f0) / sr;
    const cw = 2 * Math.cos(w);
    let y1 = 0;
    let y2 = -Math.sin(w);
    for (let i = 0; i < n; i++) {
      const y = cw * y1 - y2;
      y2 = y1;
      y1 = y;
      d[at + i] += e * y;
      e *= k;
    }
    return;
  }
  let ph = 0;
  const dw = (TAU * f0) / sr;
  for (let i = 0; i < n; i++) {
    ph += dw * (1 + (glide * i) / n);
    d[at + i] += e * Math.sin(ph);
    e *= k;
  }
}

const LOOPS = {
  rain: (sr, seed) =>
    stereo(sr, 6, 0.5, seed, (d, r) => {
      // The hiss of it everywhere: pink noise with the low end taken out.
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let hp = 0;
      let prev = 0;
      for (let i = 0; i < d.length; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099;
        b1 = 0.963 * b1 + w * 0.2965;
        b2 = 0.57 * b2 + w * 1.0527;
        const pink = (b0 + b1 + b2 + w * 0.1848) * 0.08;
        hp = 0.97 * (hp + pink - prev);
        prev = pink;
        d[i] = hp * 0.5;
      }
      // And the drops, near and far.
      const count = Math.floor((d.length / sr) * 110);
      for (let k = 0; k < count; k++) {
        const big = r() < 0.12;
        droplet(d, sr, Math.floor(r() * d.length), big ? 900 + r() * 900 : 2000 + r() * 5000, 0, big ? 0.012 : 0.003 + r() * 0.004, (big ? 0.25 : 0.12) * r() * r());
      }
    }),
  water: (sr, seed) =>
    stereo(sr, 8, 1, seed, (d, r, ch) => {
      // Laps against the quay: a wash rising and draining, bubbles as it goes.
      const a = 1 - Math.exp((-TAU * 650) / sr);
      let lp = 0;
      const laps = [];
      for (let t = ch * 1.1 + r(); t < d.length / sr; t += 2.2 + r()) laps.push(t);
      // The swell of every lap, summed a few hundred times a second: it moves far slower than that.
      let e = 0.08;
      for (let i = 0; i < d.length; i++) {
        if (i % 64 === 0) {
          const t = i / sr;
          e = 0.08;
          for (const s of laps) {
            const x = t - s;
            if (x > 0 && x < 0.5) e += 0.9 * Math.sin((x / 0.5) * (Math.PI / 2)) ** 2;
            else if (x >= 0.5) e += 0.9 * Math.exp(-(x - 0.5) / 0.6);
          }
        }
        lp += a * (r() * 2 - 1 - lp);
        d[i] = lp * e * 0.6;
      }
      for (const s of laps) {
        for (let k = 0; k < 10 + r() * 8; k++) droplet(d, sr, Math.floor((s + 0.4 + r() * 1.2) * sr), 400 + r() * 800, 0.6, 0.01 + r() * 0.02, 0.04 + r() * 0.05);
      }
    }),
  wind: (sr, seed) =>
    stereo(sr, 10, 1.5, seed, (d, r, ch) => {
      // Through the pines: a bandpass wandering over the rush, in gusts, and the needles' hiss on top.
      const ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU];
      let low = 0;
      let band = 0;
      let hpPrev = 0;
      let hp = 0;
      let fk = 0;
      let gust = 0;
      for (let i = 0; i < d.length; i++) {
        if (i % 32 === 0) {
          const t = i / sr;
          const fc = 380 + 220 * Math.sin(TAU * 0.09 * t + ph[0] + ch) + 120 * Math.sin(TAU * 0.23 * t + ph[1]);
          gust = Math.max(0.1, 0.45 + 0.3 * Math.sin(TAU * 0.06 * t + ph[2]) + 0.2 * Math.sin(TAU * 0.17 * t + ph[3] + ch));
          fk = 2 * Math.sin((Math.PI * fc) / sr);
        }
        const w = r() * 2 - 1;
        low += fk * band;
        const high = w - low - 0.8 * band;
        band += fk * high;
        hp = 0.9 * (hp + w - hpPrev);
        hpPrev = w;
        d[i] = band * gust * 0.5 + hp * gust * gust * 0.05;
      }
    }),
  fans: (sr, seed) =>
    stereo(sr, 4, 0.5, seed, (d, r, ch) => {
      darkNoise(d, sr, r, 500, 0.5);
      // Two racks of fans, a hair apart in speed: their blade tones beat.
      const f1 = 119.5 + ch * 0.8;
      const f2 = 121.2 - ch * 0.5;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] += 0.05 * Math.sin(TAU * f1 * t) + 0.04 * Math.sin(TAU * f2 * t + 1) + 0.02 * Math.sin(TAU * 2 * f1 * t) + 0.005 * Math.sin(TAU * 2870 * t);
      }
    }),
  room: (sr, seed) => stereo(sr, 4, 0.5, seed, (d, r) => brown(d, r, 0.5)),
  hum: (sr) =>
    // Mains hum and a neon buzz: exactly 120 cycles of 60 Hz, so it loops without a seam.
    stereo(sr, 2, 0, 1, (d, r, ch) => {
      for (let k = 1; k <= 14; k++) {
        const a = ((k % 2 ? 0.08 : 0.3) / Math.pow(k, 1.1)) * 0.5;
        const w = (TAU * 60 * k) / sr;
        const ph = k * ch * 0.3;
        const cw = 2 * Math.cos(w);
        let y1 = Math.sin(ph - w);
        let y2 = Math.sin(ph - 2 * w);
        for (let i = 0; i < d.length; i++) {
          const y = cw * y1 - y2;
          y2 = y1;
          y1 = y;
          d[i] += a * y;
        }
      }
    }),
  stream: (sr, seed) =>
    stereo(sr, 5, 0.5, seed, (d, r) => {
      darkNoise(d, sr, r, 1800, 0.12);
      const n = Math.floor((d.length / sr) * 50);
      for (let k = 0; k < n; k++) droplet(d, sr, Math.floor(r() * d.length), 300 + r() * 800, 0.5, 0.005 + r() * 0.012, 0.02 + r() * 0.05);
    }),
  tunnel: (sr, seed) =>
    stereo(sr, 6, 0.8, seed, (d, r) => {
      brown(d, r, 0.9, 0.998);
      darkNoise(d, sr, r, 700, 0.03);
    }),
  furnace: (sr, seed) =>
    stereo(sr, 6, 0.8, seed, (d, r) => {
      // A roar that flickers, and the odd crack of something in the fire.
      const a = 1 - Math.exp((-TAU * 280) / sr);
      let lp = 0;
      let flick = 0.7;
      for (let i = 0; i < d.length; i++) {
        if (i % 64 === 0) flick = clamp(flick + (r() - 0.5) * 0.08, 0.5, 1);
        lp += a * (r() * 2 - 1 - lp);
        d[i] = lp * flick * 0.8;
      }
      const n = Math.floor((d.length / sr) * 6);
      for (let k = 0; k < n; k++) droplet(d, sr, Math.floor(r() * d.length), 2500 + r() * 3000, 0, 0.0015, 0.1 * r());
    }),
  road: (sr, seed) =>
    stereo(sr, 6, 0.8, seed, (d, r) => {
      darkNoise(d, sr, r, 220, 0.7);
      darkNoise(d, sr, r, 5000, 0.015);
    }),
};

/** One ambience loop, two channels, at the given rate. */
export function renderLoop(name, sr, seed = 1) {
  return LOOPS[name](sr, seed);
}

/** A small room: a few close reflections, then a short tail with its top absorbed by wood and paper. */
function roomImpulse(c) {
  const sr = c.sampleRate;
  const len = Math.floor(sr * 0.9);
  const buf = c.createBuffer(2, len, sr);
  const r = rng(7);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += 0.25 * (r() * 2 - 1 - lp);
      d[i] = lp * Math.pow(1 - i / len, 3) * 0.9;
    }
    for (const [ms, a] of [[7, 0.5], [11, 0.4], [17, 0.3], [23, 0.28], [31, 0.2], [43, 0.15]]) {
      d[Math.floor((sr * ms * (ch ? 1.07 : 1)) / 1000)] += a * (r() > 0.5 ? 1 : -1);
    }
  }
  return buf;
}
