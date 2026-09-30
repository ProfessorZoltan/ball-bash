// Procedural music + sound effects built entirely from Web Audio primitives.
//
// The music is not a recording: every kick, bass note, arpeggio and pad chord
// is synthesised on the fly by a 16th-note sequencer driven by a track
// definition (see tracks.js). Because each step's duration is computed at the
// moment it is scheduled, the tempo can follow the ball speed continuously.

const LOOKAHEAD = 0.3; // seconds of audio scheduled ahead of the clock: a main thread held up for less than this costs no note
const MAX_AHEAD = 1.2; // how far ahead it reaches once the page has held it up: a hitch that long costs no note either
const TICK_MS = 25;
/**
 * How much output latency to ask for: 'snappy' is the browser's smallest buffer, 'steady' a 60 ms one that rides
 * out a busy machine, and 'safe' 150 ms, for one where even that stutters ('playback' is no bigger than steady's
 * on some systems, so it is asked for in seconds).
 */
export const AUDIO_LATENCY = { snappy: 'interactive', steady: 0.06, safe: 0.15 };
/**
 * How much sound there is to make, lightest last. Every node's work goes with the sample rate, so 32 kHz is a
 * third less of all of it and 22 kHz over half (the browser brings it up to the speakers' rate elsewhere, for
 * next to nothing); the lightest also leaves the reverbs empty, which were four parts in ten of what was left.
 * Chromium's sound thread falls behind on some machines where Firefox's, making the same sound, never does.
 */
export const SOUND_DETAIL = { full: { rate: null, reverb: true }, light: { rate: 32000, reverb: true }, lightest: { rate: 22050, reverb: false } };
const DETAILS = Object.keys(SOUND_DETAIL);

/** The desktop app (Windows, macOS): Electron names itself in the user agent. */
export function onDesktop(ua = globalThis.navigator && globalThis.navigator.userAgent) {
  return /\bElectron\//.test(ua || '');
}

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
    this.lastKickAt = 0; // audio-clock time of the most recent scheduled kick
    // The desktop app is Chromium, whose sound thread falls behind on some machines where Firefox's never does:
    // there the sound starts on the steady buffer and a step lighter, and Auto can still go lighter from there.
    const desktop = onDesktop();
    this.latency = desktop ? 'steady' : 'snappy'; // a key of AUDIO_LATENCY
    this.detailChoice = 'auto'; // 'auto', or a key of SOUND_DETAIL the player chose
    this.autoFrom = desktop ? 'light' : 'full'; // where Auto starts
    this.detail = this.autoFrom; // what the sound is made at now: auto steps it down while the speakers keep running dry
    this.ahead = LOOKAHEAD; // how far ahead the music is scheduled now: further after the page has held it up
    this.revived = 0; // how often the sound has been brought back from a context that died
    // What went wrong since the page opened, for the player to see (healthLine) and to tell us:
    // dry, the music ran out of notes before the next were scheduled; skips, it fell so far behind that
    // it jumped ahead; dropouts, the speakers ran out of sound (lost, for how many seconds in all);
    // errors, a step or a sound that could not be made; frozen, how often the page itself was held up over a
    // quarter of a second (longest, the worst), and worst, the longest dropout with how long the page was held
    // up in the same second: as long, and it was the page (or the machine), not the sound; load and peak, the
    // sound thread's own, where the browser tells it.
    this.health = { dry: 0, skips: 0, dropouts: 0, lost: 0, errors: 0, lastError: '', frozen: 0, longest: 0, worst: null, load: null, peak: 0, played: 0 };
    // The player's own levels, 0 to 1 each: the music, and separately the sound
    // effects (and everything that is not music: ambience, voices). Kept while
    // there is no context yet, and put on the graph when there is.
    this.musicVolume = 1;
    this.sfxVolume = 1;
  }

  get ready() {
    return !!this.ctx;
  }

  /** Must be called from a user gesture (click/tap/key) to unlock audio. */
  async init() {
    this.held = false; // sound wanted again, whatever paused it
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const opts = { latencyHint: AUDIO_LATENCY[this.latency] ?? 'interactive' };
    const rate = SOUND_DETAIL[this.detail] && SOUND_DETAIL[this.detail].rate;
    if (rate) opts.sampleRate = rate;
    try {
      this.ctx = new AC(opts);
    } catch (_) {
      // a browser that takes no rate of ours: its own
      delete opts.sampleRate;
      this.ctx = new AC(opts);
    }
    // The browser's word that the device has failed (unplugged, taken, crashed): its clock may go on over a
    // silent stand-in, so the watchdog would never see it stop.
    const ctx = this.ctx;
    if (ctx.addEventListener) ctx.addEventListener('error', () => {
      if (this.ctx === ctx) this.revive('device');
    });
    this.driftSeen = null;
    // Where the browser measures its sound thread, its load is kept for the health line.
    const rc = ctx.renderCapacity;
    if (rc && rc.start) {
      try {
        rc.addEventListener('update', (e) => {
          if (this.ctx !== ctx) return;
          this.health.load = e.averageLoad;
          this.health.peak = Math.max(this.health.peak, e.peakLoad);
        });
        rc.start({ updateInterval: 1 });
      } catch (_) {
        // not in this browser
      }
    }
    this.buildGraph();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** The game's own pause: the sound stops where it is, and the watchdog leaves it stopped until resume(). */
  suspend() {
    this.held = true;
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.suspend().catch(() => {});
  }

  /** And on again from where it stopped. */
  resume() {
    this.held = false;
    if (this.ctx && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
  }

  /** Change the output latency: the context is rebuilt, and whatever was playing goes on on it. */
  async setLatency(key) {
    if (!(key in AUDIO_LATENCY)) return;
    this.latency = key;
    if (!this.ctx) return;
    await this.rebuild();
  }

  /**
   * The player's choice of detail: 'auto' (autoFrom, and lighter only while the speakers keep running dry), or a
   * key of SOUND_DETAIL, kept whatever happens. A change rebuilds the sound if there is any.
   */
  async setDetail(choice) {
    if (choice !== 'auto' && !(choice in SOUND_DETAIL)) return;
    this.detailChoice = choice;
    const want = choice === 'auto' ? this.autoFrom : choice;
    if (want === this.detail) return;
    this.detail = want;
    if (this.ctx) await this.rebuild();
  }

  /** A new context in place of this one, the track going on on it from the bar it had reached (where the game's own playTrack takes a bar). */
  async rebuild() {
    const track = this.track;
    const bar = Math.floor((this.step || 0) / 16);
    this.stopTrack(0);
    const old = this.ctx;
    this.ctx = null;
    try {
      await old.close();
    } catch (_) {
      // an already closed context; nothing to do
    }
    await this.init();
    if (track && this.ctx) this.playTrack(track, bar);
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
    // A listener on the output, for the watchdog: a NaN that gets into the mix silences it for good.
    if (c.createAnalyser) {
      this.probe = c.createAnalyser();
      this.probe.fftSize = 256;
      this.probeBuf = new Float32Array(256);
      this.comp.connect(this.probe);
    }

    // Each bus has its level in the mix, and after it the player's volume for it.
    this.musicVol = gain(volumeGain(this.musicVolume));
    this.musicVol.connect(this.master);
    this.sfxVol = gain(volumeGain(this.sfxVolume));
    this.sfxVol.connect(this.master);
    this.musicBus = gain(0.7);
    this.musicBus.connect(this.musicVol);
    this.sfxBus = gain(0.9);
    this.sfxBus.connect(this.sfxVol);

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
    // At the lightest detail the halls stay empty: an empty convolver costs nothing.
    const halls = !SOUND_DETAIL[this.detail] || SOUND_DETAIL[this.detail].reverb;
    if (halls) this.reverb.buffer = makeImpulse(c, 2.8, 2.4);
    this.reverbReturn = gain(0.55);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.musicBus);
    this.snareBus.connect(this.reverbSend);
    // The effects' own hall, on the same impulse: a hit's tail belongs to the
    // effects' volume, and goes when they do, whatever the music is doing. Its
    // return is as loud as the tail was when it came back through the music.
    this.sfxReverbSend = gain(1);
    this.sfxReverb = c.createConvolver();
    this.sfxReverb.buffer = this.reverb.buffer;
    this.sfxReverbReturn = gain((0.55 * 0.7) / 0.9);
    this.sfxReverbSend.connect(this.sfxReverb);
    this.sfxReverb.connect(this.sfxReverbReturn);
    this.sfxReverbReturn.connect(this.sfxBus);

    // Ping-pong delay (dotted eighth, retimed with the tempo).
    this.delaySend = gain(1);
    this.dl = c.createDelay(2);
    this.dr = c.createDelay(2);
    this.dl.delayTime.value = 0.36;
    this.dr.delayTime.value = 0.36;
    const fbL = gain(0.4);
    const fbR = gain(0.4);
    this.fb = [fbL, fbR];
    const panL = c.createStereoPanner();
    panL.pan.value = -0.7;
    const panR = c.createStereoPanner();
    panR.pan.value = 0.7;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4200;
    this.delayTone = tone;
    this.delayBeats = 0.75; // the delay's length in beats: a dotted eighth
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

  /** The music's volume, 0 (silent) to 1 (as mixed). */
  setMusicVolume(v) {
    this.musicVolume = clamp(Number(v) || 0, 0, 1);
    this.glideTo(this.musicVol, volumeGain(this.musicVolume));
  }

  /** The sound effects' volume (and ambience, and voices), 0 (silent) to 1 (as mixed). */
  setSfxVolume(v) {
    this.sfxVolume = clamp(Number(v) || 0, 0, 1);
    this.glideTo(this.sfxVol, volumeGain(this.sfxVolume));
  }

  /** A gain eased to a level over a moment, so a slider dragged does not click. */
  glideTo(node, v) {
    if (!this.ctx || !node) return;
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setTargetAtTime(v, t, 0.03);
  }

  /** Direct tempo control (the jukebox): multiplier on the track's BPM. */
  setTempoScale(scale) {
    this.tempoTarget = clamp(scale, 0.5, 1.8);
  }

  /** Direct intensity control (the jukebox). */
  setIntensity(v) {
    this.intensityTarget = clamp(v, 0, 1);
  }

  /**
   * Where the music is right now (the scheduler runs ahead of the clock):
   * the audible step, bar, section name and tempo.
   */
  playhead() {
    if (!this.track || !this.ctx) return null;
    const stepDur = 60 / (this.currentBpm || this.track.bpm) / 4;
    const ahead = Math.max(0, Math.ceil((this.nextStepTime - this.ctx.currentTime) / stepDur));
    const step = Math.max(0, this.step - ahead);
    const bar = Math.floor(step / 16);
    const { section, barIn } = this.sectionAt(bar);
    return { step, s16: step % 16, bar, section: section.name, barIn, sectionBars: section.bars, bpm: this.currentBpm, kickAge: this.ctx.currentTime - this.lastKickAt };
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
    this.intensityTarget = 0;
    this.currentBpm = track.bpm;
    // The room a track plays in. Every level's track has the same one; a track
    // may ask for a bigger, longer, darker space than the arcade's.
    const fx = track.fx || {};
    const now = c.currentTime;
    this.reverbReturn.gain.setTargetAtTime(fx.reverb ?? 0.55, now, 0.05);
    this.delayReturn.gain.setTargetAtTime(fx.delay ?? 0.45, now, 0.05);
    for (const f of this.fb) f.gain.setTargetAtTime(fx.feedback ?? 0.4, now, 0.05);
    this.delayTone.frequency.setTargetAtTime(fx.tone ?? 4200, now, 0.05);
    this.delayBeats = fx.delayBeats ?? 0.75;
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
    if (!T) {
      this.tickAt = null;
      return;
    }
    // The page's own hitches: how long since the last tick, 25 ms when all is well.
    const wall = this.wall();
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (this.tickAt != null && !hidden) {
      // Five seconds or more is a machine asleep, not a page held up.
      const gap = wall - this.tickAt < 5 ? wall - this.tickAt : 0;
      this.gapSince = Math.max(this.gapSince || 0, gap);
      // How long the music has played in view: what the counts are out of.
      this.health.played += gap;
      if (gap > 0.25) {
        this.health.frozen++;
        this.health.longest = Math.max(this.health.longest, gap);
      }
    }
    this.tickAt = hidden ? null : wall;
    const dt = TICK_MS / 1000;
    // Smooth tempo and intensity so hits feel like a surge, not a glitch.
    this.tempoScale = approach(this.tempoScale, this.tempoTarget, 0.7 * dt);
    this.intensity = approach(this.intensity, this.intensityTarget, 1.2 * dt);

    const now = c.currentTime;
    this.watch();
    // Held up (a page busy drawing): the music ran nearly dry before this tick. Schedule further ahead from
    // now on, so the next hitch as long costs no note, and come back down slowly once it keeps up.
    const seen = typeof document === 'undefined' || !document.hidden;
    if (this.nextStepTime < now + 0.02) {
      this.ahead = Math.min(MAX_AHEAD, this.ahead + 0.3);
      if (seen) this.health.dry++;
    } else this.ahead = Math.max(LOOKAHEAD, this.ahead - 0.0005);
    // If the tab was backgrounded and we fell far behind, skip ahead instead of
    // dumping a pile of late notes at once.
    if (this.nextStepTime < now - 0.25) {
      this.nextStepTime = now + 0.05;
      if (seen) this.health.skips++;
    }
    while (this.nextStepTime < now + this.ahead) {
      const bpm = T.bpm * this.tempoScale;
      this.currentBpm = bpm;
      const stepDur = 60 / bpm / 4;
      // A step that cannot be made costs that step, never the rest of the track: left where it was, it
      // would be tried again every tick, and the music would stop for good while the clock ran on.
      try {
        this.scheduleStep(this.step, this.nextStepTime, stepDur);
      } catch (err) {
        this.fault(err);
      }
      this.nextStepTime += stepDur;
      this.step++;
    }
    const beat = 60 / (T.bpm * this.tempoScale);
    this.dl.delayTime.setTargetAtTime(beat * this.delayBeats, now, 0.25);
    this.dr.delayTime.setTargetAtTime(beat * this.delayBeats, now, 0.25);
  }

  /**
   * The watchdog, from each tick: a context the browser or the system has
   * suspended or interrupted (not the game, with suspend()) is resumed; one that has closed, whose clock has
   * stopped though it says it is running, or whose output has gone to NaN is
   * dead, and a new one is built with the music started again on it.
   */
  watch() {
    const c = this.ctx;
    // An offline render (the listening tools) has a clock of its own that stands still until it starts.
    if (!c || this.reviving || typeof c.startRendering === 'function') return;
    if (typeof document !== 'undefined' && document.hidden) {
      this.clockSeen = null;
      this.driftSeen = null;
      return;
    }
    const wall = this.wall();
    if (c.state === 'suspended' || c.state === 'interrupted') {
      this.clockSeen = null;
      this.driftSeen = null;
      // Paused by the game itself (suspend()): left as it is.
      if (!this.held && wall - (this.lastResume ?? -9) > 1) {
        this.lastResume = wall;
        c.resume().catch(() => {});
      }
      return;
    }
    if (c.state === 'closed') {
      this.revive('closed');
      return;
    }
    if (!this.clockSeen || c.currentTime !== this.clockSeen.t) this.clockSeen = { t: c.currentTime, at: wall };
    else if (wall - this.clockSeen.at > 1.5) {
      this.revive('stopped');
      return;
    }
    if (this.probe && wall - (this.probeAt ?? 0) > 1) {
      this.probeAt = wall;
      this.probe.getFloatTimeDomainData(this.probeBuf);
      for (const x of this.probeBuf) {
        if (!Number.isFinite(x)) {
          this.revive('nan');
          return;
        }
      }
    }
    this.dropouts(wall);
  }

  /**
   * Dropouts, once a second: the speakers' clock against the page's. When the sound cannot be made in time the
   * speakers play nothing for a moment and the sound's clock falls behind the page's by as much, for good; a
   * jump of 20 ms or more in a second is one. Over two seconds is a pause (the system's, the game's), not one.
   */
  dropouts(wall) {
    const c = this.ctx;
    if (!c.getOutputTimestamp || wall - (this.driftAt ?? -9) < 1) return;
    this.driftAt = wall;
    const ts = c.getOutputTimestamp();
    if (!(ts && ts.contextTime > 0 && ts.performanceTime > 0)) return;
    const d = ts.performanceTime / 1000 - ts.contextTime;
    const last = this.driftSeen;
    this.driftSeen = d;
    if (last == null) return;
    const jump = d - last;
    const gap = this.gapSince || 0;
    this.gapSince = 0;
    if (jump >= 0.02 && jump < 2) {
      const h = this.health;
      h.dropouts++;
      h.lost += jump;
      if (!h.worst || jump > h.worst.lost) h.worst = { lost: jump, gap };
      // Three in half a minute, or one of a quarter of a second, and the sound is too much for this machine.
      this.recentDrops = (this.recentDrops || []).filter((at) => wall - at < 30);
      this.recentDrops.push(wall);
      if (jump >= 0.25 || this.recentDrops.length >= 3) this.lighten();
    }
  }

  /**
   * Auto detail: one step lighter, the sound rebuilt at it and the music going on; at most once every fifteen
   * seconds, so each step is heard out before the next, and never below the lightest or past a detail the
   * player chose.
   */
  lighten() {
    const i = DETAILS.indexOf(this.detail);
    const wall = this.wall();
    if (this.detailChoice !== 'auto' || i < 0 || i >= DETAILS.length - 1 || this.reviving) return null;
    if (wall - (this.lightenedAt ?? -99) < 15) return null;
    this.lightenedAt = wall;
    this.recentDrops = [];
    this.detail = DETAILS[i + 1];
    if (typeof console !== 'undefined') console.warn(`[sound] lighter: ${this.detail}`);
    this.reviving = true;
    this.clockSeen = null;
    this.driftSeen = null;
    return this.rebuild().finally(() => {
      this.reviving = false;
    });
  }

  /** Something that could not be made: counted, told once to the console, and passed over. */
  fault(err) {
    const msg = String((err && err.message) || err);
    this.health.errors++;
    this.health.lastError = msg;
    this.faultsTold = this.faultsTold || new Set();
    if (!this.faultsTold.has(msg) && typeof console !== 'undefined') console.warn(`[sound] ${msg}`, err);
    this.faultsTold.add(msg);
  }

  /** The sound's health in a line, for the pause screen: how it runs, and what has gone wrong since the page opened. */
  healthLine() {
    const c = this.ctx;
    if (!c) return 'Sound: not started yet.';
    const h = this.health;
    const ms = (s) => `${Math.round(s * 1000)} ms`;
    const out = c.outputLatency ? `, ${ms((c.baseLatency || 0) + c.outputLatency)} to the speakers` : '';
    const pc = (x) => `${Math.round(x * 100)}%`;
    const worst = h.worst ? `; worst ${ms(h.worst.lost)}, the page held up ${ms(h.worst.gap)} then` : '';
    // The browser's own count of what it could not play in time, where it keeps one (names differ by version).
    const ps = c.playoutStats;
    const gapN = ps && (ps.underrunEvents ?? ps.fallbackFramesEvents);
    const gapT = ps && (ps.underrunDuration ?? ps.fallbackFramesDuration ?? ps.fallbackDuration);
    const detail = `${this.detail} detail${this.detailChoice === 'auto' ? ' (auto)' : ''}`;
    const parts = [
      `Sound: ${c.state}, ${(c.sampleRate / 1000).toFixed(1)} kHz, ${detail}, ${this.latency} (${ms(c.baseLatency || 0)} buffer${out}).`,
      `Dropouts ${h.dropouts} in ${h.played < 60 ? `${Math.round(h.played)} s` : `${(h.played / 60).toFixed(1)} min`} of music${h.lost ? ` (${ms(h.lost)}${worst})` : ''}.`,
      `Page held up ${h.frozen}${h.longest ? ` (longest ${ms(h.longest)})` : ''}.`,
      h.load != null ? `Sound thread ${pc(h.load)} busy (peak ${pc(h.peak)}).` : '',
      gapN != null ? `Browser counts ${gapN} gaps${gapT != null ? ` (${Math.round(gapT)} ms)` : ''}.` : '',
      `Music late ${h.dry}, skipped ${h.skips}, rebuilt ${this.revived}${this.lastRevivedFor ? ` (${this.lastRevivedFor})` : ''}, errors ${h.errors}${h.lastError ? ` (${h.lastError})` : ''}.`,
    ];
    return parts.filter(Boolean).join(' ');
  }

  /** The time on the page's own clock, in seconds: the watchdog's, for how long the sound's has stood still. */
  wall() {
    return performance.now() / 1000;
  }

  /** A new context in place of a dead one, the music started again on it; at most once every ten seconds. */
  revive(why) {
    const wall = this.wall();
    if (this.reviving || wall - (this.lastRevive ?? -99) < 10) return null;
    this.lastRevive = wall;
    this.revived++;
    this.lastRevivedFor = why;
    this.reviving = true;
    this.clockSeen = null;
    this.driftSeen = null;
    if (typeof console !== 'undefined') console.warn(`[sound] rebuilt: ${why}`);
    return this.setLatency(this.latency).finally(() => {
      this.reviving = false;
    });
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
        if (idx !== null && idx !== undefined) {
          // A null step is a rest, for a figure that leaves room between its notes.
          const midi = notes[idx % notes.length] + (section.arpOctave || 0);
          this.arp(t, midi, stepDur * (T.arp.gate ?? 0.55), s);
        }
      }
    }
    if (L.has('bell') && T.bell) {
      const idx = T.bell.pattern[s % T.bell.pattern.length];
      if (idx !== null && idx !== undefined && idx !== false) {
        const notes = arpNotes(chord.chord, T.bell.octave ?? 24);
        this.bell(t, notes[idx % notes.length], stepDur * (T.bell.ring ?? 12), s);
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
    if (t > this.lastKickAt) this.lastKickAt = t;
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
    const voice = (this.track && this.track.arp) || {};
    const o1 = this.osc(voice.wave || 'sawtooth', f, t);
    o1.detune.value = 4;
    const o2 = this.osc(voice.wave === 'triangle' ? 'sine' : 'square', f, t);
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
    ds.gain.value = voice.delay ?? 0.35;
    g.connect(ds);
    ds.connect(this.delaySend);
    const rs = c.createGain();
    rs.gain.value = voice.reverb ?? 0.12;
    g.connect(rs);
    rs.connect(this.reverbSend);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.02);
    o2.stop(t + dur + 0.02);
  }

  /**
   * A bell: two sines a little over an octave apart, the upper one dying
   * first, sent almost whole into the delay so each strike trails off across
   * the stereo field. The course's voice; no level uses it.
   */
  bell(t, midi, dur, step) {
    const c = this.ctx;
    const f = mtof(midi);
    const o1 = this.osc('sine', f, t);
    const o2 = this.osc('sine', f * 2.01, t);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.5, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(dur, 0.6));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = c.createStereoPanner();
    pan.pan.value = Math.sin(step * 2.4) * 0.6;
    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(pan);
    pan.connect(this.duck);
    const ds = c.createGain();
    ds.gain.value = 0.7;
    g.connect(ds);
    ds.connect(this.delaySend);
    const rs = c.createGain();
    rs.gain.value = 0.35;
    g.connect(rs);
    rs.connect(this.reverbSend);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 0.02);
    o2.stop(t + dur + 0.02);
  }

  pad(t, midis, dur, bright = 0) {
    const c = this.ctx;
    const voice = (this.track && this.track.pad) || {};
    const attack = voice.attack ?? 0.9;
    const release = voice.release ?? 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + attack);
    g.gain.setValueAtTime(0.2, t + Math.max(dur - 0.1, attack));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + release);
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = (voice.cutoff ?? 700) + 700 * bright;
    flt.Q.value = voice.q ?? 1.2;
    const lfo = this.osc('sine', voice.lfoRate ?? 0.15, t);
    const lfoG = c.createGain();
    lfoG.gain.value = voice.lfoDepth ?? 250;
    lfo.connect(lfoG);
    lfoG.connect(flt.frequency);
    const oscs = [lfo];
    const spread = voice.detune ?? 9;
    for (const m of midis) {
      const f = mtof(m);
      for (const det of [-spread, spread]) {
        const o = this.osc(voice.wave || 'sawtooth', f, t);
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
      rs.connect(this.sfxReverbSend);
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
      rs.connect(this.sfxReverbSend);
      o.start(tt);
      o.stop(tt + 0.55);
    });
    this.noiseHit(t, 'highpass', 7000, 0.25, 0.4, this.sfxBus);
  }

  /** Glass breaking: a bright crash and a scatter of falling tinkles. */
  sfxShatter() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const f = this.noiseHit(t, 'highpass', 3500, 0.7, 0.35, this.sfxBus, 0.8);
    f.frequency.exponentialRampToValueAtTime(1200, t + 0.3);
    for (let i = 0; i < 9; i++) {
      const tt = t + 0.03 + Math.random() * 0.35;
      const freq = 2000 + Math.random() * 5000;
      const o = this.osc('triangle', freq, tt);
      o.frequency.exponentialRampToValueAtTime(freq * 0.6, tt + 0.25);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.12, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.3);
      o.connect(g);
      g.connect(this.sfxBus);
      const rs = c.createGain();
      rs.gain.value = 0.5;
      g.connect(rs);
      rs.connect(this.sfxReverbSend);
      o.start(tt);
      o.stop(tt + 0.32);
    }
  }

  /** A pane reglazing: a soft rising chime. */
  sfxReglaze() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    [880, 1320, 1760].forEach((f, i) => {
      const tt = t + i * 0.07;
      const o = this.osc('sine', f, tt);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.12, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.6);
      o.connect(g);
      g.connect(this.sfxBus);
      const rs = c.createGain();
      rs.gain.value = 0.6;
      g.connect(rs);
      rs.connect(this.sfxReverbSend);
      o.start(tt);
      o.stop(tt + 0.65);
    });
  }

  /** The Beacon emits a pulse: a rising sweep with a sub thump. */
  sfxPulse() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = this.osc('sine', 220, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g);
    g.connect(this.sfxBus);
    const rs = c.createGain();
    rs.gain.value = 0.5;
    g.connect(rs);
    rs.connect(this.sfxReverbSend);
    o.start(t);
    o.stop(t + 0.52);
    const th = this.osc('sine', 70, t);
    th.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    th.connect(tg);
    tg.connect(this.sfxBus);
    th.start(t);
    th.stop(t + 0.32);
  }

  /** The well takes something: a falling sweep that lands on a sub thump. */
  sfxSwallow() {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = this.osc('sawtooth', 900, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.45);
    const flt = c.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(2400, t);
    flt.frequency.exponentialRampToValueAtTime(180, t + 0.45);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(flt);
    flt.connect(g);
    g.connect(this.sfxBus);
    const rs = c.createGain();
    rs.gain.value = 0.6;
    g.connect(rs);
    rs.connect(this.sfxReverbSend);
    o.start(t);
    o.stop(t + 0.52);
    const th = this.osc('sine', 80, t + 0.3);
    th.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.0001, t + 0.3);
    tg.gain.linearRampToValueAtTime(0.5, t + 0.33);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    th.connect(tg);
    tg.connect(this.sfxBus);
    th.start(t + 0.3);
    th.stop(t + 0.72);
  }

  /** The ring catches the ball: a short bright ping. */
  sfxPing(strength = 0.5) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime;
    const o = this.osc('sine', 1600 + 800 * strength, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + 0.22);
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

/**
 * A volume setting (0 to 1) as a gain. Loudness is heard on a curve, so the
 * setting is squared: half way is a quarter of the power, about 12 dB down,
 * which sounds like about half as loud.
 */
export function volumeGain(v) {
  const k = clamp(Number(v) || 0, 0, 1);
  return k * k;
}

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
