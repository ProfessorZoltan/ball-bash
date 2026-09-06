// Procedural music + sound effects built entirely from Web Audio primitives.
//
// The music is not a recording: every kick, bass note, arpeggio and pad chord
// is synthesised on the fly by a 16th-note sequencer driven by a track
// definition (see tracks.js). Because each step's duration is computed at the
// moment it is scheduled, the tempo can follow the ball speed continuously.

const LOOKAHEAD = 0.16; // seconds of audio scheduled ahead of the clock
const TICK_MS = 25;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.track = null;
    this.timer = null;
    this.intensity = 0; // 0..1, smoothed: opens filters, adds hats
    this.intensityTarget = 0;
    this.tempoScale = 1; // multiplier on the track BPM, smoothed
    this.tempoTarget = 1;
    this.currentBpm = 0;
    this.lastWall = 0;
  }

  get ready() {
    return !!this.ctx;
  }

  /** Must be called from a user gesture (click/tap/key) to unlock audio. */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.buildGraph();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  buildGraph() {
    const c = this.ctx;
    const gain = (v) => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    this.master = gain(this.muted ? 0 : 1);
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.master.connect(this.comp);
    this.comp.connect(c.destination);

    this.musicBus = gain(0.7);
    this.musicBus.connect(this.master);
    this.sfxBus = gain(0.9);
    this.sfxBus.connect(this.master);

    // Side-chain "pump": pads, arps and bass pass through this gain, which every
    // kick ducks for a moment. It is what gives the pulsing Tron feel.
    this.duck = gain(1);
    this.duck.connect(this.musicBus);
    this.drumBus = gain(1);
    this.drumBus.connect(this.musicBus);
    this.hatBus = c.createStereoPanner();
    this.hatBus.pan.value = 0.25;
    this.hatBus.connect(this.drumBus);
    this.snareBus = gain(1);
    this.snareBus.connect(this.drumBus);

    // Reverb: synthesised impulse response (stereo decaying noise).
    this.reverbSend = gain(1);
    this.reverb = c.createConvolver();
    this.reverb.buffer = makeImpulse(c, 2.8, 2.4);
    this.reverbReturn = gain(0.55);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.musicBus);
    this.snareBus.connect(this.reverbSend);

    // Ping-pong delay (dotted eighth, retimed with the tempo).
    this.delaySend = gain(1);
    this.dl = c.createDelay(2);
    this.dr = c.createDelay(2);
    this.dl.delayTime.value = 0.36;
    this.dr.delayTime.value = 0.36;
    const fbL = gain(0.4);
    const fbR = gain(0.4);
    const panL = c.createStereoPanner();
    panL.pan.value = -0.7;
    const panR = c.createStereoPanner();
    panR.pan.value = 0.7;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    this.delayReturn = gain(0.45);
    this.delaySend.connect(this.dl);
    this.dl.connect(panL);
    this.dl.connect(fbL);
    fbL.connect(this.dr);
    this.dr.connect(panR);
    this.dr.connect(fbR);
    fbR.connect(this.dl);
    panL.connect(tone);
    panR.connect(tone);
    tone.connect(this.delayReturn);
    this.delayReturn.connect(this.musicBus);

    this.noiseBuffer = makeNoise(c, 2);
  }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 1, t, 0.03);
  }

  /**
   * Feed the current ball speed. Tempo scales with speed relative to the
   * level's reference speed; intensity (filter brightness, extra hats)
   * rises toward the ball's maximum speed.
   */
  setBallSpeed(speed, refSpeed, minSpeed, maxSpeed) {
    this.intensityTarget = clamp((speed - minSpeed) / (maxSpeed - minSpeed), 0, 1);
    this.tempoTarget = clamp(0.75 + 0.25 * (speed / refSpeed), 0.72, 1.5);
  }

  // ----------------------------------------------------------------- sequencer

  playTrack(track) {
    if (!this.ctx) return;
    this.stopTrack(0);
    const c = this.ctx;
    this.track = track;
    this.layout = layoutSections(track);
    this.step = 0;
    this.nextStepTime = c.currentTime + 0.06;
    this.leadPrev = null;
    this.leadPrevEnd = 0;
    this.tempoScale = 1;
    this.tempoTarget = 1;
    this.intensity = 0;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(c.currentTime);
    g.setValueAtTime(0.0001, c.currentTime);
    g.exponentialRampToValueAtTime(0.7, c.currentTime + 0.6);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stopTrack(fade = 1.5) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.track = null;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    if (fade > 0) {
      g.setValueAtTime(Math.max(g.value, 0.0001), t);
      g.exponentialRampToValueAtTime(0.0001, t + fade);
    } else {
      g.setValueAtTime(0.0001, t);
    }
  }

  tick() {
    const c = this.ctx;
    const T = this.track;
    if (!T) return;
    const dt = TICK_MS / 1000;
    // Smooth tempo and intensity so hits feel like a surge, not a glitch.
    this.tempoScale = approach(this.tempoScale, this.tempoTarget, 0.7 * dt);
    this.intensity = approach(this.intensity, this.intensityTarget, 1.2 * dt);

    const now = c.currentTime;
    // If the tab was backgrounded and we fell far behind, skip ahead instead of
    // dumping a pile of late notes at once.
    if (this.nextStepTime < now - 0.25) this.nextStepTime = now + 0.05;
    while (this.nextStepTime < now + LOOKAHEAD) {
      const bpm = T.bpm * this.tempoScale;
      this.currentBpm = bpm;
      const stepDur = 60 / bpm / 4;
      this.scheduleStep(this.step, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.step++;
    }
    const beat = 60 / (T.bpm * this.tempoScale);
    this.dl.delayTime.setTargetAtTime(beat * 0.75, now, 0.25);
    this.dr.delayTime.setTargetAtTime(beat * 0.75, now, 0.25);
  }

  sectionAt(bar) {
    const { list, total, loopStart } = this.layout;
    let b = bar;
    if (b >= total) {
      const len = total - loopStart;
      b = loopStart + ((b - total) % len);
    }
    for (const s of list) {
      if (b >= s.start && b < s.end) return { section: s, barIn: b - s.start, virtualBar: b };
    }
    return { section: list[0], barIn: 0, virtualBar: 0 };
  }

  chordAt(bar) {
    const prog = this.track.progression;
    let total = 0;
    for (const ch of prog) total += ch.bars;
    const pb = bar % total;
    let acc = 0;
    for (const ch of prog) {
      if (pb < acc + ch.bars) return { chord: ch, startBar: acc, bars: ch.bars, isStart: pb === acc };
      acc += ch.bars;
    }
    return { chord: prog[0], startBar: 0, bars: prog[0].bars, isStart: true };
  }

  scheduleStep(step, t, stepDur) {
    const T = this.track;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const { section, barIn, virtualBar } = this.sectionAt(bar);
    const L = section.layers;
    const { chord, isStart, bars: chordBars } = this.chordAt(virtualBar);
    const inten = this.intensity;
    const lastBar = barIn === section.bars - 1;

    if (L.has('pad') && s === 0 && (isStart || barIn === 0)) {
      const remaining = isStart ? chordBars : chordBars - ((virtualBar - section.start) % chordBars);
      this.pad(t, chord.pad || chord.chord, remaining * 16 * stepDur, section.padBright || 0);
    }

    if (L.has('kick') && T.drums.kick[s]) this.kick(t, 1);
    if (L.has('snare')) {
      if (T.drums.snare[s]) this.snare(t, 1);
      if (section.fill && lastBar && s >= 12) this.snare(t, 0.45 + 0.15 * (s - 12));
    }
    if (L.has('hat')) {
      const v = T.drums.hat[s];
      if (v) this.hat(t, v * (0.55 + 0.45 * inten), !!T.drums.hatOpen[s]);
      else if (inten > 0.5 && s % 2 === 1) this.hat(t, 0.3 * inten, false);
    }
    if (L.has('bass')) {
      const ev = T.bass.pattern[s];
      if (ev) this.bass(t, chord.bass + ev[0], ev[1] * stepDur);
    }
    if (L.has('arp')) {
      const density = section.arpDensity || 16;
      if (density === 16 || s % 2 === 0) {
        const notes = arpNotes(chord.chord, T.arp.octave ?? 12);
        const idx = T.arp.pattern[s % T.arp.pattern.length];
        const midi = notes[idx % notes.length] + (section.arpOctave || 0);
        this.arp(t, midi, stepDur * (T.arp.gate ?? 0.55), s);
      }
    }
    if (L.has('lead') && T.lead) {
      const pos = (barIn * 16 + s) % T.lead.length;
      for (const n of T.lead.notes) if (n[0] === pos) this.lead(t, n[1], n[2] * stepDur);
    }
    if (L.has('stab') && barIn === 0 && s === 0) this.stab(t, chord.chord);
    if (section.riser && lastBar && s === 0) this.riser(t, 16 * stepDur);
  }

  // --------------------------------------------------------------- instruments

  osc(type, freq, t) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    return o;
  }

  noiseHit(t, type, freq, vel, decay, dest, q = 1) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + decay + 0.02);
    return f;
  }

  kick(t, vel = 1) {
    const c = this.ctx;
    const o = this.osc('sine', 175, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.05 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g);
    g.connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.42);
    this.noiseHit(t, 'highpass', 3000, 0.35 * vel, 0.018, this.drumBus);
    const d = this.duck.gain;
    d.cancelScheduledValues(t);
    d.setValueAtTime(1, t);
    d.linearRampToValueAtTime(0.35, t + 0.015);
    d.linearRampToValueAtTime(1, t + 0.28);
  }

  snare(t, vel = 1) {
    this.noiseHit(t, 'bandpass', 1800, 0.9 * vel, 0.17, this.snareBus, 0.7);
    this.noiseHit(t, 'highpass', 6000, 0.35 * vel, 0.09, this.snareBus);
    const c = this.ctx;
    const o = this.osc('triangle', 190, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.05);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g);
    g.connect(this.snareBus);
    o.start(t);
    o.stop(t + 0.12);
  }

  hat(t, vel = 1, open = false) {
    this.noiseHit(t, 'highpass', 8500, 0.28 * vel, open ? 0.25 : 0.045, this.hatBus);
  }

  bass(t, midi, dur, vel = 1) {
    const c = this.ctx;
    const f = mtof(midi);
    const o1 = this.osc('sawtooth', f, t);
    const o2 = this.osc('square', f / 2, t);
    const o3 = this.osc('sine', f / 2, t);
    const g2 = c.createGain();
    g2.gain.value = 0.35;
    const g3 = c.createGain();
    g3.gain.value = 0.7;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 7;
    flt.frequency.setValueAtTime(180, t);
    flt.frequency.exponentialRampToValueAtTime(900 + 1500 * this.intensity, t + 0.02);
    flt.frequency.exponentialRampToValueAtTime(200, t + Math.max(dur, 0.08));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55 * vel, t + 0.006);
    g.gain.setValueAtTime(0.55 * vel, t + Math.max(dur - 0.02, 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    o1.connect(flt);
    o2.connect(g2);
    g2.connect(flt);
    o3.connect(g3);
    g3.connect(flt);
    flt.connect(g);
    g.connect(this.duck);
    for (const o of [o1, o2, o3]) {
      o.start(t);
      o.stop(t + dur + 0.08);
    }
  }

  arp(t, midi, dur, step) {
    const c = this.ctx;
    const f = mtof(midi);
    const o1 = this.osc('sawtooth', f, t);
    o1.detune.value = 4;
    const o2 = this.osc('square', f, t);
    o2.detune.value = -6;
    const g2 = c.createGain();
    g2.gain.value = 0.4;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 4;
    let cutoff = 550 + 2800 * this.intensity;
    if (step % 4 === 0) cutoff *= 1.4;
    flt.frequency.setValueAtTime(cutoff * 1.6, t);
    flt.frequency.exponentialRampToValueAtTime(cutoff * 0.5, t + dur);
    const pan = c.createStereoPanner();
    pan.pan.value = ((step % 4) - 1.5) * 0.35;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o1.connect(flt);
    o2.connect(g2);
    g2.connect(flt);
    flt.connect(g);
    g.connect(pan);
    pan.connect(this.duck);
    const ds = c.createGain();
    ds.gain.value = 0.35;
    g.connect(ds);
    ds.connect(this.delaySend);
    const rs = c.createGain();
    rs.gain.value = 0.12;
    g.connect(rs);
    rs.connect(this.reverbSend);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.02);
    o2.stop(t + dur + 0.02);
  }

  pad(t, midis, dur, bright = 0) {
    const c = this.ctx;
    const attack = 0.9;
    const release = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + attack);
    g.gain.setValueAtTime(0.2, t + Math.max(dur - 0.1, attack));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + release);
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 700 + 700 * bright;
    flt.Q.value = 1.2;
    const lfo = this.osc('sine', 0.15, t);
    const lfoG = c.createGain();
    lfoG.gain.value = 250;
    lfo.connect(lfoG);
    lfoG.connect(flt.frequency);
    const oscs = [lfo];
    for (const m of midis) {
      const f = mtof(m);
      for (const det of [-9, 9]) {
        const o = this.osc('sawtooth', f, t);
        o.detune.value = det;
        o.connect(flt);
        oscs.push(o);
      }
    }
    const sub = this.osc('sine', mtof(midis[0] - 12), t);
    const subG = c.createGain();
    subG.gain.value = 0.5;
    sub.connect(subG);
    subG.connect(flt);
    oscs.push(sub);
    flt.connect(g);
    g.connect(this.duck);
    const rs = c.createGain();
    rs.gain.value = 0.55;
    g.connect(rs);
    rs.connect(this.reverbSend);
    const end = t + dur + release + 0.1;
    for (const o of oscs) {
      o.start(t);
      o.stop(end);
    }
  }

  lead(t, midi, dur) {
    const c = this.ctx;
    const f = mtof(midi);
    const o1 = this.osc('sawtooth', f, t);
    const o2 = this.osc('square', f / 2, t);
    if (this.leadPrev && t - this.leadPrevEnd < 0.06) {
      o1.frequency.setValueAtTime(this.leadPrev, t);
      o1.frequency.exponentialRampToValueAtTime(f, t + 0.04);
      o2.frequency.setValueAtTime(this.leadPrev / 2, t);
      o2.frequency.exponentialRampToValueAtTime(f / 2, t + 0.04);
    }
    const g2 = c.createGain();
    g2.gain.value = 0.3;
    const lfo = this.osc('sine', 5.5, t);
    const lfoG = c.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(7, t + 0.3);
    lfo.connect(lfoG);
    lfoG.connect(o1.detune);
    lfoG.connect(o2.detune);
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 2;
    flt.frequency.setValueAtTime(1200, t);
    flt.frequency.exponentialRampToValueAtTime(3400, t + 0.02);
    flt.frequency.exponentialRampToValueAtTime(1900, t + Math.max(dur, 0.1));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.012);
    g.gain.linearRampToValueAtTime(0.22, t + 0.12);
    g.gain.setValueAtTime(0.22, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.14);
    o1.connect(flt);
    o2.connect(g2);
    g2.connect(flt);
    flt.connect(g);
    g.connect(this.musicBus);
    const ds = c.createGain();
    ds.gain.value = 0.4;
    g.connect(ds);
    ds.connect(this.delaySend);
    const rs = c.createGain();
    rs.gain.value = 0.4;
    g.connect(rs);
    rs.connect(this.reverbSend);
    for (const o of [o1, o2, lfo]) {
      o.start(t);
      o.stop(t + dur + 0.16);
    }
    this.leadPrev = f;
    this.leadPrevEnd = t + dur;
  }

  stab(t, midis) {
    const c = this.ctx;
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 3;
    flt.frequency.setValueAtTime(300, t);
    flt.frequency.exponentialRampToValueAtTime(3500, t + 0.03);
    flt.frequency.exponentialRampToValueAtTime(500, t + 0.45);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    flt.connect(g);
    g.connect(this.musicBus);
    const rs = c.createGain();
    rs.gain.value = 0.5;
    g.connect(rs);
    rs.connect(this.reverbSend);
    for (const m of midis) {
      for (const det of [-8, 8]) {
        const o = this.osc('sawtooth', mtof(m + 12), t);
        o.detune.value = det;
        o.connect(flt);
        o.start(t);
        o.stop(t + 0.6);
      }
    }
  }

  riser(t, dur) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(5000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + dur);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.03);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicBus);
    const rs = c.createGain();
    rs.gain.value = 0.5;
    g.connect(rs);
    rs.connect(this.reverbSend);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------- effects

  sfxWall(speedNorm) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    if (t - this.lastWall < 0.03) return;
    this.lastWall = t;
    const o = this.osc('triangle', 260 + 520 * speedNorm, t);
    o.frequency.exponentialRampToValueAtTime((260 + 520 * speedNorm) * 0.6, t + 0.06);
    const g = c.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.08);
    this.noiseHit(t, 'bandpass', 2500 + 3000 * speedNorm, 0.22, 0.03, this.sfxBus, 1.5);
  }

  sfxPaddle(strength, isBoss) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const base = isBoss ? 230 : 480;
    const o = this.osc('square', base * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(base, t + 0.05);
    const g = c.createGain();
    g.gain.setValueAtTime(0.28 + 0.2 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.13);
    this.noiseHit(t, 'bandpass', 1800, 0.3 + 0.3 * strength, 0.05, this.sfxBus, 1);
    if (strength > 0.5) {
      const th = this.osc('sine', 120, t);
      th.frequency.exponentialRampToValueAtTime(55, t + 0.12);
      const tg = c.createGain();
      tg.gain.setValueAtTime(0.5, t);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      th.connect(tg);
      tg.connect(this.sfxBus);
      th.start(t);
      th.stop(t + 0.2);
    }
  }

  sfxWhack() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = this.noiseHit(t, 'bandpass', 500, 0.22, 0.16, this.sfxBus, 1.2);
    f.frequency.exponentialRampToValueAtTime(4000, t + 0.12);
  }

  sfxPlayerHit() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = this.osc('sawtooth', 200, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.42);
    this.noiseHit(t, 'bandpass', 800, 0.3, 0.2, this.sfxBus, 0.8);
  }

  sfxBossHit() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const f = this.noiseHit(t, 'lowpass', 4000, 0.8, 0.9, this.sfxBus, 0.5);
    f.frequency.exponentialRampToValueAtTime(300, t + 0.8);
    const th = this.osc('sine', 90, t);
    th.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.9, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    th.connect(tg);
    tg.connect(this.sfxBus);
    th.start(t);
    th.stop(t + 0.72);
    // Victory chord: rising D minor arpeggio into a sustained chord.
    const seq = [62, 65, 69, 74, 77, 81];
    seq.forEach((m, i) => {
      const tt = t + 0.35 + i * 0.07;
      const o = this.osc('sawtooth', mtof(m), tt);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.16, tt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.8 + i * 0.2);
      const flt = c.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(3000, tt);
      flt.frequency.exponentialRampToValueAtTime(600, tt + 2);
      o.connect(flt);
      flt.connect(g);
      g.connect(this.sfxBus);
      const rs = c.createGain();
      rs.gain.value = 0.6;
      g.connect(rs);
      rs.connect(this.reverbSend);
      o.start(tt);
      o.stop(tt + 2.4);
    });
  }

  /** Ice trail begins: a glassy crackle. */
  sfxIce() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    for (let i = 0; i < 5; i++) {
      const tt = t + i * 0.035 + Math.random() * 0.01;
      const f = this.noiseHit(tt, 'bandpass', 5000 + Math.random() * 4000, 0.18, 0.05, this.sfxBus, 6);
      f.frequency.exponentialRampToValueAtTime(9000, tt + 0.05);
    }
    const o = this.osc('sine', 2400, t);
    o.frequency.exponentialRampToValueAtTime(3600, t + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.32);
  }

  /** The player freezes: a shimmering downward chime. */
  sfxFreeze() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const notes = [1760, 1318, 988, 740];
    notes.forEach((f, i) => {
      const tt = t + i * 0.06;
      const o = this.osc('triangle', f, tt);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.22, tt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.5);
      o.connect(g);
      g.connect(this.sfxBus);
      const rs = c.createGain();
      rs.gain.value = 0.5;
      g.connect(rs);
      rs.connect(this.reverbSend);
      o.start(tt);
      o.stop(tt + 0.55);
    });
    this.noiseHit(t, 'highpass', 7000, 0.25, 0.4, this.sfxBus);
  }

  sfxCount(final = false) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = this.osc('sine', final ? 930 : 620, t);
    if (final) o.frequency.setValueAtTime(1240, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (final ? 0.35 : 0.1));
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + (final ? 0.36 : 0.11));
  }
}

// ------------------------------------------------------------------ helpers

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function approach(cur, target, maxDelta) {
  const d = target - cur;
  if (Math.abs(d) <= maxDelta) return target;
  return cur + Math.sign(d) * maxDelta;
}

/** Chord tones spread across two octaves: [r, 3, 5, r+12, 3+12, 5+12]. */
function arpNotes(chord, octave) {
  return chord.concat(chord.map((m) => m + octave));
}

function layoutSections(track) {
  let bar = 0;
  const list = [];
  for (const s of track.sections) {
    list.push({ ...s, start: bar, end: bar + s.bars, layers: new Set(s.layers) });
    bar += s.bars;
  }
  const loopIdx = Math.min(track.loopFrom ?? 0, list.length - 1);
  return { list, total: bar, loopStart: list[loopIdx].start };
}

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}
