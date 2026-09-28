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
