// Defector's sound against the player's two volumes: its music reaches the
// speakers only through the music's volume, and every cue it plays (its chimes'
// echoes included) only through the effects'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DefectorAudio } from '../src/audio.js';
import { SEQUEL_TRACKS } from '../src/tracks.js';

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

test('Defector\'s music goes only through the music\'s volume, and every cue, echo and all, only through the effects\'', () => {
  const a = new DefectorAudio();
  const ctx = recordingContext();
  a.ctx = ctx;
  a.buildGraph();
  const feeds = ctx.made.filter((x) => x.outs.includes(a.master));
  assert.deepEqual(new Set(feeds), new Set([a.musicVol, a.sfxVol]), 'nothing reaches the speakers round the two volumes');
  let from = ctx.made.length;
  a.playTrack(SEQUEL_TRACKS.defector);
  clearInterval(a.timer);
  a.timer = null;
  for (let t = 0; t < 30; t += 0.025) {
    ctx.currentTime = t;
    a.tick();
  }
  const notes = ctx.made.slice(from);
  assert.ok(notes.length > 500, `${notes.length} nodes of music`);
  for (const x of notes) assert.ok(!downstream(x).has(a.sfxVol), 'a note of the music went through the effects');
  // Every cue the game can ask for, read off the audio's own list.
  const cues = [...DefectorAudio.prototype.cue.toString().matchAll(/case '(\w+)'/g)].map((m) => m[1]);
  assert.ok(cues.length >= 30, `${cues.length} cues`);
  from = ctx.made.length;
  for (const s of cues) {
    ctx.currentTime += 1;
    a.cue({ s, kind: 'big', air: 1, big: true, which: 1 });
  }
  const fx = ctx.made.slice(from);
  assert.ok(fx.length > 100, `${fx.length} nodes of effects`);
  for (const x of fx) assert.ok(!downstream(x).has(a.musicVol), 'a cue went through the music');
});
