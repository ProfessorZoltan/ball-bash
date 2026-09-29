// The player's two volumes, the music and the sound effects, on the engine all
// three games share: each bus reaches the speakers only through its own
// volume, a slider moves only its own, a volume set before there is any sound
// is the one the sound starts at, and no effect (not even its echo) comes
// through the music's volume, nor any note of the music through the effects'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine, volumeGain } from '../src/audio/engine.js';
import { TRACKS } from '../src/audio/tracks.js';

/** A stand-in for Web Audio that builds nothing but remembers what connects to what, and each gain's last setting. */
function recordingContext() {
  const made = [];
  class Param {
    constructor(v) {
      this.value = v;
    }
    setValueAtTime(v) {
      this.value = v;
      return this;
    }
    linearRampToValueAtTime(v) {
      this.value = v;
      return this;
    }
    exponentialRampToValueAtTime(v) {
      this.value = v;
      return this;
    }
    setTargetAtTime(v) {
      this.value = v;
      return this;
    }
    cancelScheduledValues() {
      return this;
    }
  }
  class Node {
    constructor(props) {
      this.outs = [];
      Object.assign(this, props);
      made.push(this);
    }
    connect(dest) {
      this.outs.push(dest);
      return dest;
    }
    disconnect() {
      this.outs = [];
    }
    start() {}
    stop() {}
  }
  const n = (props) => new Node(props);
  return {
    made,
    currentTime: 0,
    sampleRate: 48000,
    state: 'running',
    destination: n({}),
    createGain: () => n({ gain: new Param(1) }),
    createStereoPanner: () => n({ pan: new Param(0) }),
    createBiquadFilter: () => n({ type: 'lowpass', frequency: new Param(350), Q: new Param(1), gain: new Param(0) }),
    createDelay: () => n({ delayTime: new Param(0) }),
    createConvolver: () => n({ buffer: null }),
    createDynamicsCompressor: () => n({ threshold: new Param(-24), knee: new Param(30), ratio: new Param(12), attack: new Param(0.003), release: new Param(0.25) }),
    createOscillator: () => n({ type: 'sine', frequency: new Param(440), detune: new Param(0) }),
    createBufferSource: () => n({ buffer: null, loop: false, detune: new Param(0), playbackRate: new Param(1) }),
    createBuffer(channels, length, rate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: (i) => data[i] };
    },
  };
}

/** An engine on the stand-in, as `init` would leave it. */
function rig(engine = new AudioEngine()) {
  const ctx = recordingContext();
  engine.ctx = ctx;
  engine.buildGraph();
  return { a: engine, ctx };
}

/** Everything a node's sound goes on to, all the way to the speakers. */
function downstream(node) {
  const seen = new Set();
  const walk = (x) => {
    if (!x || seen.has(x)) return;
    seen.add(x);
    for (const d of x.outs || []) walk(d);
  };
  walk(node);
  return seen;
}

test('a volume is heard on a curve: half way is a quarter of the power, and the ends are silence and the mix as it was', () => {
  assert.equal(volumeGain(0), 0);
  assert.equal(volumeGain(1), 1);
  assert.equal(volumeGain(0.5), 0.25);
  for (let v = 0.05; v <= 1; v += 0.05) assert.ok(volumeGain(v) > volumeGain(v - 0.05), `louder at ${v.toFixed(2)}`);
  assert.equal(volumeGain(-1), 0, 'below silence is silence');
  assert.equal(volumeGain(3), 1, 'no louder than the mix');
  assert.equal(volumeGain('junk'), 0);
  assert.equal(volumeGain(undefined), 0);
});

test('the music and the effects each reach the speakers only through their own volume', () => {
  const { a, ctx } = rig();
  const feeds = ctx.made.filter((x) => x.outs.includes(a.master));
  assert.deepEqual(new Set(feeds), new Set([a.musicVol, a.sfxVol]), 'nothing reaches the speakers round the two volumes');
  assert.deepEqual(a.musicBus.outs, [a.musicVol]);
  assert.deepEqual(a.sfxBus.outs, [a.sfxVol]);
  assert.ok(downstream(a.sfxReverbSend).has(a.sfxVol) && !downstream(a.sfxReverbSend).has(a.musicVol), 'the effects\' echo is the effects\'');
  assert.ok(downstream(a.reverbSend).has(a.musicVol) && !downstream(a.reverbSend).has(a.sfxVol), 'the music\'s echo is the music\'s');
  assert.equal(a.sfxReverb.buffer, a.reverb.buffer, 'both echo in the same hall');
});

test('a slider moves only its own volume, and mute still silences both', () => {
  const { a } = rig();
  a.setMusicVolume(0.5);
  assert.equal(a.musicVol.gain.value, 0.25);
  assert.equal(a.sfxVol.gain.value, 1, 'the effects are untouched');
  a.setSfxVolume(0);
  assert.equal(a.sfxVol.gain.value, 0);
  assert.equal(a.musicVol.gain.value, 0.25, 'the music is untouched');
  a.setMusicVolume(7);
  assert.equal(a.musicVolume, 1, 'kept to 0 to 1');
  assert.equal(a.musicVol.gain.value, 1);
  a.setMuted(true);
  assert.equal(a.master.gain.value, 0);
  a.setMuted(false);
  assert.equal(a.master.gain.value, 1);
  assert.equal(a.sfxVol.gain.value, 0, 'unmuting keeps the volumes');
});

test('a volume set before there is any sound is the one the sound starts at', () => {
  const engine = new AudioEngine();
  engine.setMusicVolume(0.3);
  engine.setSfxVolume(0.6);
  const { a } = rig(engine);
  assert.ok(Math.abs(a.musicVol.gain.value - 0.09) < 1e-12);
  assert.ok(Math.abs(a.sfxVol.gain.value - 0.36) < 1e-12);
});

test('no note of the music goes through the effects\' volume, and no effect, echo and all, through the music\'s', () => {
  const { a, ctx } = rig();
  let from = ctx.made.length;
  a.playTrack(TRACKS.antechamber);
  clearInterval(a.timer);
  a.timer = null;
  for (let t = 0; t < 30; t += 0.025) {
    ctx.currentTime = t;
    a.tick();
  }
  const notes = ctx.made.slice(from);
  assert.ok(notes.length > 500, `${notes.length} nodes of music`);
  for (const x of notes) assert.ok(!downstream(x).has(a.sfxVol), 'a note of the music went through the effects');
  const sfx = Object.getOwnPropertyNames(AudioEngine.prototype).filter((k) => /^sfx[A-Z]/.test(k));
  assert.ok(sfx.length >= 10, 'every sound effect the engine has');
  from = ctx.made.length;
  for (const k of sfx) {
    ctx.currentTime += 1;
    a[k](0.6, false);
  }
  const fx = ctx.made.slice(from);
  assert.ok(fx.length > 50, `${fx.length} nodes of effects`);
  for (const x of fx) assert.ok(!downstream(x).has(a.musicVol), 'an effect went through the music');
});

/** A rig with a track playing, its timer stopped so the test drives each tick. */
function playing() {
  const r = rig();
  r.a.playTrack(TRACKS.antechamber);
  clearInterval(r.a.timer);
  r.a.timer = null;
  return r;
}

test('a page that holds the music up makes it schedule further ahead, so the next hitch as long drops no note, and it comes back down once it keeps up', () => {
  const { a, ctx } = playing();
  for (let t = 0; t < 3; t += 0.025) {
    ctx.currentTime = t;
    a.tick();
  }
  assert.equal(a.ahead, 0.3, 'a page that keeps up schedules 0.3 s ahead');
  // Held up 0.5 s: the music ran dry, and from then on it looks further.
  ctx.currentTime += 0.5;
  a.tick();
  assert.ok(a.ahead >= 0.55, `looks ${a.ahead.toFixed(2)} s ahead after a hitch`);
  assert.ok(a.nextStepTime >= ctx.currentTime + a.ahead - 0.2, 'and has scheduled that far');
  // The same hitch again: the notes were already there.
  ctx.currentTime += 0.5;
  assert.ok(a.nextStepTime > ctx.currentTime, 'nothing ran dry the second time');
  a.tick();
  for (let k = 0; k < 60 * 40; k++) {
    ctx.currentTime += 0.025;
    a.tick();
  }
  assert.equal(a.ahead, 0.3, 'a minute of keeping up brings it back to 0.3 s');
});

test('a context the browser suspends is resumed and one the game paused is left paused; one that has closed, whose clock has stopped, or whose output has gone to NaN is built anew', async () => {
  let wall = 100;
  const setUp = (extra = {}) => {
    const { a, ctx } = playing();
    Object.assign(ctx, extra);
    a.wall = () => wall;
    const built = [];
    a.setLatency = async (k) => {
      built.push(k);
    };
    return { a, ctx, built };
  };
  // Suspended: resumed, at most once a second.
  {
    let resumed = 0;
    const { a } = setUp({ state: 'suspended', resume: async () => resumed++ });
    a.tick();
    a.tick();
    assert.equal(resumed, 1);
    wall += 1.1;
    a.tick();
    assert.equal(resumed, 2);
  }
  // Paused by the game itself: left paused, however long, until the game carries on.
  {
    let resumed = 0;
    const { a, ctx, built } = setUp({ resume: async () => resumed++, suspend: async () => (ctx.state = 'suspended') });
    a.suspend();
    for (let k = 0; k < 400; k++) {
      wall += 0.025;
      a.tick();
    }
    assert.equal(resumed, 0, 'not resumed behind the pause');
    assert.deepEqual(built, [], 'nor built anew');
    a.resume();
    assert.equal(resumed, 1);
    wall += 20;
  }
  // A clock standing still for over a second and a half while it says it is running.
  {
    const { a, ctx, built } = setUp();
    ctx.currentTime = 5;
    for (let k = 0; k < 80; k++) {
      wall += 0.025;
      a.tick();
    }
    assert.deepEqual(built, ['snappy'], 'a new context, on the same latency');
    assert.equal(a.revived, 1);
    assert.equal(a.lastRevivedFor, 'stopped');
    await Promise.resolve();
    for (let k = 0; k < 80; k++) {
      wall += 0.025;
      a.tick();
    }
    assert.equal(built.length, 1, 'never twice in ten seconds');
  }
  // Closed.
  {
    wall += 20;
    const { a, built } = setUp({ state: 'closed' });
    a.tick();
    assert.equal(built.length, 1);
    assert.equal(a.lastRevivedFor, 'closed');
  }
  // The output gone to NaN.
  {
    wall += 20;
    const { a, ctx, built } = setUp();
    a.probe = { getFloatTimeDomainData: (b) => b.fill(NaN) };
    a.probeBuf = new Float32Array(8);
    for (let k = 0; k < 50; k++) {
      wall += 0.025;
      ctx.currentTime += 0.025;
      a.tick();
    }
    assert.equal(built.length, 1);
    assert.equal(a.lastRevivedFor, 'nan');
  }
  // An offline render, its clock still until it starts, is left alone.
  {
    wall += 20;
    const { a, ctx, built } = setUp({ startRendering: () => {} });
    ctx.currentTime = 0;
    for (let k = 0; k < 120; k++) {
      wall += 0.025;
      a.tick();
    }
    assert.equal(built.length, 0);
  }
});


test('a step that cannot be made costs only that step: the music goes on, and the fault is counted', () => {
  const { a, ctx } = playing();
  const warn = console.warn;
  console.warn = () => {};
  const made = a.scheduleStep.bind(a);
  const from = a.step; // playTrack schedules its first steps itself
  let tried = 0;
  a.scheduleStep = (step, t, d) => {
    tried++;
    if (step === 5) throw new RangeError('a note out of reach');
    return made(step, t, d);
  };
  for (let t = 0; t < 4; t += 0.025) {
    ctx.currentTime = t;
    a.tick();
  }
  console.warn = warn;
  assert.ok(a.step > 20, `the music went on to step ${a.step}`);
  assert.equal(tried, a.step - from, 'each step tried once, the bad one too');
  assert.equal(a.health.errors, 1);
  assert.equal(a.health.lastError, 'a note out of reach');
});

test('the speakers running dry is counted as a dropout, with how long; the page\'s own pause is not', () => {
  const { a, ctx } = playing();
  let wall = 50;
  a.wall = () => wall;
  // The speakers' clock and the page's in step, then the sound 80 ms behind, then a pause of five seconds.
  let lag = 0;
  ctx.getOutputTimestamp = () => ({ contextTime: ctx.currentTime, performanceTime: (ctx.currentTime + 10 + lag) * 1000 });
  const run = (secs) => {
    for (let k = 0; k < secs * 40; k++) {
      wall += 0.025;
      ctx.currentTime += 0.025;
      a.tick();
    }
  };
  run(3);
  assert.equal(a.health.dropouts, 0, 'in step: none');
  lag += 0.08;
  run(3);
  assert.equal(a.health.dropouts, 1);
  assert.ok(Math.abs(a.health.lost - 0.08) < 1e-6, `${a.health.lost} s lost`);
  lag += 5;
  run(3);
  assert.equal(a.health.dropouts, 1, 'a pause is no dropout');
  assert.match(a.healthLine(), /Dropouts 1 \(80 ms\)/);
});

test('a sound device the browser says has failed is built anew', async () => {
  const heard = {};
  globalThis.window = {
    AudioContext: function () {
      const c = recordingContext();
      c.addEventListener = (k, f) => (heard[k] = f);
      c.resume = async () => {};
      return c;
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const a = new AudioEngine();
    await a.init();
    const built = [];
    a.setLatency = async (k) => built.push(k);
    a.wall = () => 100;
    heard.error();
    assert.deepEqual(built, ['snappy']);
    assert.equal(a.lastRevivedFor, 'device');
    assert.match(a.healthLine(), /rebuilt 1 \(device\)/);
  } finally {
    console.warn = warn;
    delete globalThis.window;
  }
});
