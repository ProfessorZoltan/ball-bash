// Defector's sound: Deflector's own engine (src/audio/engine.js), the same
// synthesised kick, pads, arpeggios, bells and lead through the same reverb
// and ping-pong delay, playing the sequel's calmer tracks. The tempo never
// follows the action here; it holds the track's own until the boss fight,
// when it doubles.
import { AudioEngine } from '../../src/audio/engine.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class DefectorAudio extends AudioEngine {
  /** The boss fight: the track runs at twice its tempo, and opens up. Off, it settles back. */
  bossTime(on) {
    this.tempoTarget = on ? 2 : 1;
    this.intensityTarget = on ? 0.85 : 0.25;
  }

  /** A gentle swell with the action (filters and hats, never the tempo). */
  setAction(v) {
    if (this.tempoTarget > 1.5) return;
    this.intensityTarget = Math.max(0, Math.min(0.6, v));
  }

  playTrack(track) {
    super.playTrack(track);
    this.intensityTarget = 0.2;
  }

  /** A short tone: `wave` from f0 to f1 over dur, at vel. */
  blip(f0, f1, dur, vel = 0.25, wave = 'triangle', delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = this.osc(wave, f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
    return g;
  }

  /** Notes in a row, for chimes and jingles. */
  chime(notes, gap = 0.07, dur = 0.5, vel = 0.14, wave = 'sine') {
    if (!this.ctx) return;
    const c = this.ctx;
    notes.forEach((m, i) => {
      const t = c.currentTime + i * gap;
      const o = this.osc(wave, mtof(m), t);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.sfxBus);
      const rs = c.createGain();
      rs.gain.value = 0.4;
      g.connect(rs);
      rs.connect(this.reverbSend);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  noise(type, freq, vel, decay, q = 1) {
    if (!this.ctx) return null;
    return this.noiseHit(this.ctx.currentTime, type, freq, vel, decay, this.sfxBus, q);
  }

  /** What the game says happened (see Game.events), as sound. */
  cue(e) {
    if (!this.ctx) return;
    switch (e.s) {
      case 'jump':
        this.blip(260, 520, 0.12, 0.12, 'triangle');
        break;
      case 'land':
        this.blip(140, 60, 0.1, Math.min(0.3, 0.1 + e.air * 0.2), 'sine');
        this.noise('lowpass', 500, 0.12, 0.06);
        break;
      case 'fire':
        if (e.kind === 'big') this.blip(180, 70, 0.3, 0.3, 'sawtooth');
        else if (e.kind === 'triple') [0, 0.03, 0.06].forEach((d) => this.blip(900, 400, 0.08, 0.1, 'square', d));
        else if (e.kind === 'freeze') this.blip(1600, 2400, 0.16, 0.12, 'sine');
        else if (e.kind === 'strong') this.blip(420, 110, 0.18, 0.3, 'square');
        else if (e.kind === 'durable') this.blip(700, 350, 0.28, 0.16, 'sine');
        else this.sfxPulse();
        break;
      case 'ricochet':
        this.sfxWall(Math.min(1, (e.speed || 800) / 1500));
        break;
      case 'deflect':
        this.sfxPaddle(0.4, true);
        break;
      case 'armor':
        this.blip(300, 200, 0.07, 0.18, 'square');
        break;
      case 'hit':
      case 'thunk':
        this.blip(520, 240, 0.08, 0.2, 'square');
        break;
      case 'pop':
        this.noise('bandpass', e.big ? 700 : 1400, e.big ? 0.5 : 0.35, e.big ? 0.4 : 0.22, 0.8);
        this.blip(e.big ? 220 : 440, 60, e.big ? 0.35 : 0.18, 0.22, 'sawtooth');
        break;
      case 'crate':
        this.noise('bandpass', 900, 0.4, 0.25, 1);
        this.blip(300, 90, 0.2, 0.2, 'square');
        break;
      case 'stomp':
        this.blip(220, 660, 0.12, 0.25, 'square');
        break;
      case 'powerup':
        this.chime([72, 76, 79, 84, 88], 0.05, 0.6, 0.12);
        break;
      case 'shield':
        this.chime([67, 74, 79, 86], 0.08, 0.9, 0.14);
        break;
      case 'cycle':
        this.blip(880, 1320, 0.05, 0.08, 'square');
        break;
      case 'dry':
        this.blip(180, 150, 0.06, 0.12, 'square');
        break;
      case 'empty':
        this.blip(600, 300, 0.15, 0.1, 'triangle');
        break;
      case 'portal':
        this.blip(e.which ? 330 : 660, e.which ? 165 : 1320, 0.25, 0.15, 'sine');
        this.sfxPing(0.5);
        break;
      case 'fizzle':
        this.noise('highpass', 3000, 0.2, 0.12);
        break;
      case 'unportal':
        this.blip(500, 200, 0.2, 0.08, 'sine');
        break;
      case 'warp':
        this.blip(200, 1200, 0.22, 0.14, 'sine');
        this.blip(1200, 300, 0.25, 0.1, 'triangle', 0.05);
        break;
      case 'hurt':
        this.sfxPlayerHit();
        break;
      case 'down':
        this.chime([62, 58, 55, 50], 0.18, 1.2, 0.16, 'triangle');
        break;
      case 'freeze':
        this.sfxFreeze();
        break;
      case 'spring':
        this.blip(200, 900, 0.25, 0.2, 'triangle');
        break;
      case 'pulse':
        this.sfxPulse();
        break;
      case 'swallow':
        this.sfxSwallow();
        break;
      case 'checkpoint':
        this.chime([64, 71, 76], 0.09, 0.8, 0.14);
        break;
      case 'secret':
        this.chime([72, 79, 84, 91, 96], 0.07, 1.1, 0.12, 'triangle');
        break;
      case 'lock':
        this.blip(160, 90, 0.4, 0.3, 'sawtooth');
        break;
      case 'unlock':
        this.chime([67, 71, 74, 79], 0.07, 0.7, 0.14);
        break;
      case 'wave':
        this.blip(300, 600, 0.3, 0.12, 'sawtooth');
        break;
      case 'bossHit':
        this.blip(160, 60, 0.18, 0.3, 'square');
        this.noise('bandpass', 1200, 0.3, 0.12, 1);
        break;
      case 'bossDown':
        this.sfxBossHit();
        break;
      case 'rev':
        this.blip(90, 260, 0.8, 0.18, 'sawtooth');
        break;
      case 'lob':
        this.blip(300, 700, 0.18, 0.12, 'triangle');
        break;
      case 'fan':
        this.blip(900, 500, 0.12, 0.08, 'square');
        break;
      case 'thud':
        this.blip(120, 40, 0.3, 0.4, 'sine');
        this.noise('lowpass', 400, 0.3, 0.2);
        break;
      case 'rumble':
        this.noise('lowpass', 200, 0.4, 0.8, 1);
        break;
      case 'boing':
        this.blip(150, 600, 0.3, 0.2, 'sine');
        break;
      case 'phase':
        this.chime([50, 57, 62, 69], 0.05, 1.2, 0.16, 'sawtooth');
        break;
      case 'exitOpen':
        this.chime([62, 69, 74, 78, 81], 0.1, 1.4, 0.13);
        break;
      case 'cleared':
        this.chime([74, 78, 81, 86, 90, 93], 0.09, 1.6, 0.13, 'triangle');
        break;
      default:
        break;
    }
  }
}
